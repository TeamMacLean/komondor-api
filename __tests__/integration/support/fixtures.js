/**
 * Builds the real Group -> Project -> Sample -> Run chain these tests need,
 * and the on-disk shapes (tus uploads, staged read files) lib/file-utils.js
 * and lib/ingest-queue.js expect. Every document is a genuine save() through
 * the real models, so every pre/post hook (safeName generation, path
 * derivation, directory creation) runs exactly as it would in production —
 * required() calls env.configureEnv() first, so DATASTORE_ROOT exists.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Unique per call, not per process: two describe blocks in the same file (or
// two files run back to back under --runInBand) must not collide on Group's
// and Project's unique `name` indexes.
const unique = (label) => `${label}-${crypto.randomBytes(4).toString("hex")}`;

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
  return new Run({
    name: unique("run"),
    sample: sample._id,
    group: group._id,
    sequencingProvider: "in-house",
    sequencingTechnology: "illumina",
    librarySource: "genomic",
    libraryType: "paired",
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
 * Writes a real tus upload (blob + '<id>.json' sidecar) into `directory`,
 * matching exactly what @tus/file-store's FileKvStore writes on disk (see
 * node_modules/@tus/utils/dist/kvstores/FileKvStore.js: `JSON.stringify` of
 * the Upload — id/size/offset/metadata — at "<directory>/<id>.json").
 *
 * @param {object} params
 * @param {string} params.directory - The upload staging directory.
 * @param {number} params.declaredSize - The sidecar's `size`.
 * @param {number} [params.blobBytes] - Bytes actually written to the blob;
 *   defaults to declaredSize (a genuinely complete upload).
 * @param {number} [params.declaredOffset] - The sidecar's `offset`; defaults
 *   to declaredSize (matches a finished upload unless overridden).
 * @param {string} [params.owner] - Stamped into metadata.owner.
 * @param {string} [params.originalName] - Stamped into metadata.filename.
 * @returns {Promise<string>} The generated 32-hex-char upload id.
 */
const writeStagedUpload = async ({
  directory,
  declaredSize,
  blobBytes = declaredSize,
  declaredOffset = declaredSize,
  owner = "it-owner",
  originalName = "reads.fastq.gz",
}) => {
  const id = crypto.randomBytes(16).toString("hex");

  await fs.promises.writeFile(
    path.join(directory, id),
    Buffer.alloc(blobBytes, "x"),
  );

  await fs.promises.writeFile(
    path.join(directory, `${id}.json`),
    JSON.stringify({
      id,
      size: declaredSize,
      offset: declaredOffset,
      metadata: { owner, filename: originalName },
      creation_date: new Date().toISOString(),
    }),
  );

  return id;
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
