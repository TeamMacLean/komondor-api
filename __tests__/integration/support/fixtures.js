/**
 * Builds the real Group -> Project -> Sample -> Run chain these tests need,
 * and the on-disk shapes (tus uploads, staged read files) lib/file-utils.js
 * and lib/ingest-queue.js expect. Every document is a genuine save() through
 * the real models, so every pre/post hook (safeName generation, path
 * derivation, directory creation) runs exactly as it would in production —
 * required() calls env.configureEnv() first, so DATASTORE_ROOT exists.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");

// Unique per call, not per process: two describe blocks in the same file (or
// two files run back to back under --runInBand) must not collide on Group's
// and Project's unique `name` indexes.
const unique = (label) => `${label}-${crypto.randomBytes(4).toString("hex")}`;

// These fixtures save Runs directly, deliberately bypassing the HTTP route.
// The production worker nevertheless resolves every Run's libraryType from
// the option collection before it moves bytes. Keep the default fixture
// internally coherent with the real seeded option rather than relying on an
// orphaned string that the route could never have accepted.
const defaultLibraryType = {
  value: "FASTQ - Single",
  paired: false,
  indexed: false,
  extensions: [".fastq.gz", ".fq.gz"],
};

/**
 * @param {object} [overrides] - Fields to override on the Group.
 * @returns {Promise<mongoose.Document>} The saved Group.
 */
const makeGroup = async (overrides = {}) => {
  const Group = require("../../../models/Group");
  return new Group({
    name: unique("group"),
    ldapGroups: ["it-ldap-group"],
    ...overrides,
  }).save();
};

/**
 * @param {mongoose.Document} group - The owning Group.
 * @param {object} [overrides] - Fields to override on the Project.
 * @returns {Promise<mongoose.Document>} The saved Project.
 */
const makeProject = async (group, overrides = {}) => {
  const Project = require("../../../models/Project");
  return new Project({
    name: unique("project"),
    owner: "it-owner",
    shortDesc: "Integration test project",
    longDesc: "Created by __tests__/integration/",
    group: group._id,
    ...overrides,
  }).save();
};

/**
 * @param {mongoose.Document} project - The owning Project.
 * @param {mongoose.Document} group - The owning Group.
 * @param {object} [overrides] - Fields to override on the Sample.
 * @returns {Promise<mongoose.Document>} The saved Sample.
 */
const makeSample = async (project, group, overrides = {}) => {
  const Sample = require("../../../models/Sample");
  return new Sample({
    name: unique("sample"),
    project: project._id,
    group: group._id,
    owner: "it-owner",
    scientificName: "Homo sapiens",
    commonName: "human",
    ncbi: "9606",
    conditions: "control",
    ...overrides,
  }).save();
};

/**
 * @param {mongoose.Document} sample - The owning Sample.
 * @param {mongoose.Document} group - The owning Group.
 * @param {object} [overrides] - Fields to override on the Run.
 * @returns {Promise<mongoose.Document>} The saved Run.
 */
const makeRun = async (sample, group, overrides = {}) => {
  const Run = require("../../../models/Run");
  const LibraryType = require("../../../models/options/LibraryType");
  const libraryType = overrides.libraryType || defaultLibraryType.value;

  if (libraryType === defaultLibraryType.value) {
    await LibraryType.updateOne(
      { value: defaultLibraryType.value },
      { $setOnInsert: defaultLibraryType },
      { upsert: true }
    );
  }

  return new Run({
    name: unique("run"),
    sample: sample._id,
    group: group._id,
    sequencingProvider: "in-house",
    sequencingTechnology: "illumina",
    librarySource: "genomic",
    libraryType,
    librarySelection: "random",
    libraryStrategy: "wgs",
    owner: "it-owner",
    ...overrides,
  }).save();
};

/**
 * The full chain in one call.
 * @param {object} [overrides] - { group, project, sample, run } field overrides.
 * @returns {Promise<{group: mongoose.Document, project: mongoose.Document,
 *   sample: mongoose.Document, run: mongoose.Document}>}
 */
const makeRunChain = async (overrides = {}) => {
  const group = await makeGroup(overrides.group);
  const project = await makeProject(group, overrides.project);
  const sample = await makeSample(project, group, overrides.sample);
  const run = await makeRun(sample, group, overrides.run);
  return { group, project, sample, run };
};

/**
 * Stages an upload by driving a REAL @tus/server + FileStore over HTTP, rather
 * than hand-writing a sidecar.
 *
 * This used to fabricate the sidecar, setting `offset` to the declared size to
 * represent a finished upload. FileStore never produces that state: it writes
 * `offset: 0` at creation and never updates it, deriving the true offset from
 * the blob's size instead. The fabricated state therefore hid a bug that
 * rejected — and made deletable — every genuinely completed upload. Driving the
 * real server is the only way these tests can speak to what production does.
 *
 * @param {object} params
 * @param {string} params.directory - The upload staging directory.
 * @param {number} params.declaredSize - Sent as Upload-Length.
 * @param {number} [params.blobBytes] - Bytes actually PATCHed; defaults to
 *   declaredSize (a genuinely complete upload). Fewer leaves it part-uploaded.
 * @param {string} [params.owner] - Stamped into metadata.owner.
 * @param {string} [params.originalName] - Stamped into metadata.filename.
 * @returns {Promise<string>} The tus upload id.
 */
const writeStagedUpload = async ({
  directory,
  declaredSize,
  blobBytes = declaredSize,
  owner = "it-owner",
  originalName = "reads.fastq.gz",
}) => {
  const { Server } = require("@tus/server");
  const { FileStore } = require("@tus/file-store");

  const tus = new Server({
    path: "/uploads",
    datastore: new FileStore({ directory }),
  });
  const server = http.createServer((req, res) => tus.handle(req, res));

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const send = (options, payload) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, ...options },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res));
        }
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });

  try {
    const b64 = (value) => Buffer.from(String(value)).toString("base64");

    const created = await send({
      method: "POST",
      path: "/uploads",
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(declaredSize),
        "Upload-Metadata": `filename ${b64(originalName)},owner ${b64(owner)}`,
      },
    });

    const id = String(created.headers.location).split("/").pop();

    if (blobBytes > 0) {
      await send(
        {
          method: "PATCH",
          path: `/uploads/${id}`,
          headers: {
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": "0",
            "Content-Type": "application/offset+octet-stream",
            "Content-Length": String(blobBytes),
          },
        },
        Buffer.alloc(blobBytes, "x")
      );
    }

    return id;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

module.exports = {
  unique,
  makeGroup,
  makeProject,
  makeSample,
  makeRun,
  makeRunChain,
  writeStagedUpload,
};
