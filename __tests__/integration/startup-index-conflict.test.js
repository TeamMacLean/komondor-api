/**
 * Real Mongo: a hand-built conflicting index reproduces the exact
 * IndexKeySpecsConflict/IndexOptionsConflict scenario scripts/check-run-duplicates.js
 * exists to catch (see its header comment) — a pre-existing index occupying
 * Run's auto-generated `sample_1_name_1` name with different options, left
 * over from before that index was declared `unique`.
 *
 * mongoose's implicit background index sync only *logs* a conflict like
 * this; it does not reject or throw (see the same header comment). That is
 * exactly why server.js awaits Model.init() explicitly and exits fatally on
 * its rejection instead of relying on the implicit build — this file proves
 * that rejection is real against a real server, not a unit-mocked stand-in
 * for one.
 */

const { configureEnv, restoreEnv } = require("./support/env");
const rootMongo = require("./support/mongo");

let envHandle;

beforeAll(async () => {
  envHandle = await configureEnv("startup-index-conflict");
  await rootMongo.connect();
});

afterAll(async () => {
  await rootMongo.disconnect();
  await restoreEnv(envHandle);
});

beforeEach(async () => {
  await rootMongo.dropDatabase();
});

/**
 * Creates, via the raw driver (never through mongoose, which would just
 * build the schema's own index correctly), an index sitting on the exact
 * auto-generated name a schema index needs, but with different options —
 * the pre-existing-non-unique-index scenario the doc comment in
 * scripts/check-run-duplicates.js describes.
 * @param {string} collectionName - The collection to poison.
 * @param {object} keys - The index's key spec.
 * @param {string} name - The auto-generated name the real schema index needs.
 */
const createConflictingIndex = async (collectionName, keys, name) => {
  await rootMongo.mongoose.connection.db
    .collection(collectionName)
    .createIndex(keys, { name, unique: false });
};

/**
 * Model.init() caches its result on the Model object itself (`Model.$init`,
 * see node_modules/mongoose/lib/model.js) — a second call on the same
 * `require("../../models/Run")` would just replay whatever the first call
 * saw, never touching an index poisoned in between. Each scenario below
 * therefore needs a model that has never had .init() called on it before,
 * which needs its own mongoose instance connected fresh: jest.resetModules()
 * clears the require cache (so requiring the model rebuilds it against a new
 * mongoose instance) but does not touch already-open connections, so the
 * outer describe's rootMongo connection above stays valid for dropDatabase
 * and the raw-driver index poisoning throughout.
 * @param {string} modelPath - Path (relative to this file) to the model.
 * @returns {Promise<{model: mongoose.Model, cleanup: () => Promise<void>}>}
 */
const freshModel = async (modelPath) => {
  jest.resetModules();
  const freshMongo = require("./support/mongo");
  await freshMongo.connect();
  const model = require(modelPath);

  return { model, cleanup: () => freshMongo.disconnect() };
};

describe("Run.init() / IngestJob.init() against a pre-poisoned index", () => {
  test("Run.init() rejects when a same-named index has different options", async () => {
    await createConflictingIndex(
      "runs",
      { sample: 1, name: 1 },
      "sample_1_name_1",
    );

    const { model: Run, cleanup } = await freshModel("../../models/Run");
    try {
      await expect(Run.init()).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  test("Run.init() rejects when a same-named index has different key specs", async () => {
    // The other half of the pair named in the FIX prompt: same auto-generated
    // name, but built on the wrong keys entirely (IndexKeySpecsConflict
    // rather than IndexOptionsConflict).
    await createConflictingIndex("runs", { name: 1 }, "sample_1_name_1");

    const { model: Run, cleanup } = await freshModel("../../models/Run");
    try {
      await expect(Run.init()).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  test("IngestJob.init() also rejects on a poisoned index — server.js awaits both", async () => {
    // IngestJob's own compound index: { status: 1, leaseExpiresAt: 1, createdAt: 1 }.
    await createConflictingIndex(
      "ingestjobs",
      { status: 1 },
      "status_1_leaseExpiresAt_1_createdAt_1",
    );

    const { model: IngestJob, cleanup } = await freshModel(
      "../../models/IngestJob",
    );
    try {
      await expect(IngestJob.init()).rejects.toThrow();
    } finally {
      await cleanup();
    }
  });

  test("control: Run.init() resolves cleanly with no conflicting index present", async () => {
    // Proves the two failing cases above are really about the poisoned
    // index, not about something generically wrong with calling init() in
    // this test environment.
    const { model: Run, cleanup } = await freshModel("../../models/Run");
    try {
      await expect(Run.init()).resolves.toBeDefined();
    } finally {
      await cleanup();
    }
  });
});

describe("server.js startup wiring, spawned as a real process", () => {
  // The property server.js/models/Run.js/models/IngestJob.js are actually
  // relied on for: mongoose's own implicit background index sync only LOGS a
  // conflict like this (see this file's header comment and
  // scripts/check-run-duplicates.js) — a process that just called
  // mongoose.connect() and started listening would start "successfully"
  // with the broken index silently in place. This spawns the real entry
  // point, not a unit-mocked stand-in for it, so a regression back to that
  // old behaviour fails here even if every model-level test above is
  // (wrongly) mocked away somewhere else in the future.
  test("exits non-zero, without ever opening a listener, when the index build fails", async () => {
    const { spawn } = require("child_process");
    const path = require("path");

    await createConflictingIndex(
      "runs",
      { sample: 1, name: 1 },
      "sample_1_name_1",
    );

    const child = spawn(
      process.execPath,
      [path.join(__dirname, "../../server.js")],
      {
        cwd: path.join(__dirname, "../.."),
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: "0",
          HOST: "127.0.0.1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new Error(
            `server.js did not exit within 15s. stdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
      }, 15000);

      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/index build failed/i);
    // The listener must never open on a process that is about to exit —
    // otherwise a load balancer could route a request into the narrow
    // window before it dies.
    expect(stdout).not.toMatch(/API running on/);
  }, 20000);
});
