/**
 * Tests for lib/utils/uploadPath.js and the coupling it exists to hold
 * together.
 *
 * Four modules have to agree on where tus stages an upload: routes/uploads.js
 * writes the bytes there, lib/file-utils.js moves them out, lib/fileUpload.js
 * builds a File path from it, and models/File.js has to list the directory as
 * a permitted move source or that move is refused.
 *
 * They previously did not agree. routes/uploads.js and lib/fileUpload.js
 * honoured an UPLOAD_DIRECTORY override while lib/file-utils.js and
 * models/File.js hardcoded <cwd>/files — so setting that variable stranded
 * every finished upload, and the symptom was a "refusing upload" from the path
 * guard rather than anything pointing at the misconfiguration.
 */

const os = require("os");
const fs = require("fs");
const _path = require("path");

const { uploadPath } = require("../../lib/utils/uploadPath");

const ORIGINAL = process.env.UPLOAD_DIRECTORY;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.UPLOAD_DIRECTORY;
  } else {
    process.env.UPLOAD_DIRECTORY = ORIGINAL;
  }
});

describe("uploadPath", () => {
  test("defaults to <cwd>/files", () => {
    delete process.env.UPLOAD_DIRECTORY;

    expect(uploadPath()).toBe(_path.join(process.cwd(), "files"));
  });

  test("honours UPLOAD_DIRECTORY", () => {
    process.env.UPLOAD_DIRECTORY = _path.join(os.tmpdir(), "komondor-uploads");

    expect(uploadPath()).toBe(
      _path.resolve(_path.join(os.tmpdir(), "komondor-uploads")),
    );
  });

  test("resolves a relative UPLOAD_DIRECTORY to an absolute path", () => {
    // The value reaches path-containment checks, which compare absolute paths.
    process.env.UPLOAD_DIRECTORY = "./scratch-uploads";

    expect(_path.isAbsolute(uploadPath())).toBe(true);
  });

  test("is read per call, not captured at require time", () => {
    // The suite sets and unsets this between cases; a value cached when the
    // first module loaded would freeze whichever one happened to be present.
    process.env.UPLOAD_DIRECTORY = _path.join(os.tmpdir(), "first");
    const first = uploadPath();

    process.env.UPLOAD_DIRECTORY = _path.join(os.tmpdir(), "second");

    expect(uploadPath()).not.toBe(first);
  });
});

describe("models/File permitted source roots follow UPLOAD_DIRECTORY", () => {
  let tmpRoot;
  let datastoreRoot;
  let uploadDir;
  const ORIGINAL_DATASTORE = process.env.DATASTORE_ROOT;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-uploadpath-"));
    datastoreRoot = _path.join(tmpRoot, "datastore");
    uploadDir = _path.join(tmpRoot, "elsewhere-uploads");
    fs.mkdirSync(datastoreRoot, { recursive: true });
    fs.mkdirSync(uploadDir, { recursive: true });

    process.env.DATASTORE_ROOT = datastoreRoot;
    // Deliberately NOT <cwd>/files, and not the HPC directory either: the only
    // thing that can make this source permitted is UPLOAD_DIRECTORY.
    process.env.UPLOAD_DIRECTORY = uploadDir;
    delete process.env.HPC_TRANSFER_DIRECTORY;

    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (ORIGINAL_DATASTORE === undefined) {
      delete process.env.DATASTORE_ROOT;
    } else {
      process.env.DATASTORE_ROOT = ORIGINAL_DATASTORE;
    }
  });

  afterAll(async () => {
    const mongoose = require("mongoose");
    await mongoose.connection.close();
  });

  test("a file staged in UPLOAD_DIRECTORY can be moved into the datastore", async () => {
    const File = require("../../models/File");

    const source = _path.join(uploadDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");

    const doc = new File({
      name: "reads.fq",
      type: "run",
      uploadName: "reads.fq",
      originalName: "reads.fq",
      path: source,
    });
    doc.save = jest.fn().mockImplementation(() => Promise.resolve(doc));

    // Before the shared helper this threw: models/File.js hardcoded
    // <cwd>/files, so an upload staged anywhere else was an unpermitted source.
    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    const dest = _path.join(datastoreRoot, "group", "raw", "reads.fq");
    expect(fs.readFileSync(dest, "utf8")).toBe("ACGT");
    expect(fs.existsSync(source)).toBe(false);
  });

  test("a file staged outside UPLOAD_DIRECTORY is still refused", () => {
    // The override widens the permitted set to the configured directory, not
    // to everywhere — otherwise the guard would be doing nothing.
    const File = require("../../models/File");

    const source = _path.join(tmpRoot, "not-an-upload.fq");
    fs.writeFileSync(source, "ACGT");

    const doc = new File({
      name: "not-an-upload.fq",
      type: "run",
      uploadName: "not-an-upload.fq",
      originalName: "not-an-upload.fq",
      path: source,
    });
    doc.save = jest.fn();

    return expect(
      doc.moveToFolderAndSave(_path.join("group", "raw", "not-an-upload.fq")),
    ).rejects.toThrow(/source is not inside a permitted directory/);
  });
});
