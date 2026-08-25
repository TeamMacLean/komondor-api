/**
 * Fresh, isolated filesystem roots for one integration test file, plus the
 * other env vars validateEnv.js requires before anything in lib/ or models/
 * will touch the filesystem or a Run. Real directories throughout — nothing
 * here is mocked.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const REQUIRED_KEYS = [
  "DATASTORE_ROOT",
  "HPC_TRANSFER_DIRECTORY",
  "UPLOAD_DIRECTORY",
  "JWT_SECRET",
  "WEB_APP_URL",
  "NODE_ENV",
];

/**
 * Creates fresh temp directories for DATASTORE_ROOT / HPC_TRANSFER_DIRECTORY /
 * UPLOAD_DIRECTORY and points process.env at them. Call once from a file's
 * beforeAll; pass the result to restoreEnv() from afterAll.
 *
 * @param {string} label - Identifies the temp dir on disk if cleanup ever fails.
 * @returns {Promise<{base: string, datastoreRoot: string, hpcDirectory: string,
 *   uploadDirectory: string, previous: Object<string, string|undefined>}>}
 */
const configureEnv = async (label) => {
  const base = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `komondor-it-${label}-`),
  );

  const datastoreRoot = path.join(base, "datastore");
  const hpcDirectory = path.join(base, "hpc");
  const uploadDirectory = path.join(base, "uploads");

  await Promise.all(
    [datastoreRoot, hpcDirectory, uploadDirectory].map((dir) =>
      fs.promises.mkdir(dir, { recursive: true }),
    ),
  );

  // Captured before being overwritten, so restoreEnv can put back whatever a
  // parallel-run env (or another file, since --runInBand still shares one
  // process) had set rather than just deleting the key.
  const previous = {};
  REQUIRED_KEYS.forEach((key) => {
    previous[key] = process.env[key];
  });

  process.env.DATASTORE_ROOT = datastoreRoot;
  process.env.HPC_TRANSFER_DIRECTORY = hpcDirectory;
  process.env.UPLOAD_DIRECTORY = uploadDirectory;
  process.env.JWT_SECRET = previous.JWT_SECRET || `it-secret-${label}`;
  process.env.WEB_APP_URL = previous.WEB_APP_URL || "http://localhost:5173";
  process.env.NODE_ENV = previous.NODE_ENV || "test";

  return { base, datastoreRoot, hpcDirectory, uploadDirectory, previous };
};

/**
 * Restores whatever configureEnv overwrote and removes its temp directories.
 * @param {object} configured - What configureEnv returned.
 * @returns {Promise<void>}
 */
const restoreEnv = async (configured) => {
  if (!configured) {
    return;
  }

  Object.entries(configured.previous).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  await fs.promises.rm(configured.base, { recursive: true, force: true });
};

module.exports = { configureEnv, restoreEnv };
