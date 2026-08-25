/**
 * Tests for the startup configuration check.
 *
 * The point of validateEnv is that a misconfigured process never reaches the
 * point of listening, so what is checked here is mostly the refusals: the
 * development credentials on a public interface, a Mongo URI with no database
 * name, a mount that is not there. It reports rather than exits, so all of it
 * runs in-process with no sockets and no database.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  validateEnv,
  resolveHost,
  resolveMongoUri,
  isLoopbackHost,
} = require("../../lib/utils/validateEnv");

// A check that depends on being unable to write somewhere is meaningless as
// root, which can write anywhere.
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const testUnlessRoot = isRoot ? test.skip : test;

let tmpRoot;
let datastore;
let transferDirectory;
let uploadDirectory;
let unwritable;
let regularFile;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "komondor-validate-env-"));
  datastore = path.join(tmpRoot, "datastore");
  transferDirectory = path.join(tmpRoot, "transfer");
  uploadDirectory = path.join(tmpRoot, "uploads");
  unwritable = path.join(tmpRoot, "read-only");
  regularFile = path.join(tmpRoot, "not-a-directory");

  fs.mkdirSync(datastore);
  fs.mkdirSync(transferDirectory);
  fs.mkdirSync(uploadDirectory);
  fs.mkdirSync(unwritable, { mode: 0o500 });
  fs.writeFileSync(regularFile, "");

  // The upload staging directory is the one path validateEnv does not take
  // from the env object it is handed: lib/utils/uploadPath.js resolves it from
  // process.env (or <cwd>/files) at call time, so it is pinned here rather
  // than left to depend on whether the checkout happens to have a files/.
  process.env.UPLOAD_DIRECTORY = uploadDirectory;
});

afterAll(() => {
  // Restored first: a 0o500 directory cannot have its contents removed.
  fs.chmodSync(unwritable, 0o700);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_DIRECTORY;
});

/** A configuration with nothing wrong with it, for one field to be broken. */
const validEnv = (overrides = {}) => ({
  NODE_ENV: "production",
  JWT_SECRET: "a-test-signing-secret",
  WEB_APP_URL: "https://komondor.example.org",
  MONGODB_URI: "mongodb://localhost:27017/komondor",
  DATASTORE_ROOT: datastore,
  HPC_TRANSFER_DIRECTORY: transferDirectory,
  ...overrides,
});

/** The single error mentioning `name`, or undefined. */
const errorFor = (result, name) =>
  result.errors.find((error) => error.includes(name));

describe("a fully configured environment", () => {
  test("passes", async () => {
    const result = await validateEnv(validEnv());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("development credentials containment", () => {
  test("refuses to bind development mode to a public interface", async () => {
    // routes/auth.js accepts DEV_USERS' fixed passwords in this mode, and .env
    // in this repo sets NODE_ENV=development: one bad copy is all it takes.
    const result = await validateEnv(
      validEnv({ NODE_ENV: "development", HOST: "0.0.0.0" }),
    );

    expect(result.ok).toBe(false);
    expect(errorFor(result, "development")).toMatch(/loopback/);
  });

  test("refuses a routable address just as firmly", async () => {
    const result = await validateEnv(
      validEnv({ NODE_ENV: "development", HOST: "10.0.0.5" }),
    );

    expect(result.ok).toBe(false);
  });

  test("allows development on the loopback default", async () => {
    // No HOST set at all: the default has to be the safe one, because that is
    // what `yarn dev` uses.
    const result = await validateEnv(validEnv({ NODE_ENV: "development" }));

    expect(result.ok).toBe(true);
  });

  test.each(["127.0.0.1", "127.0.1.1", "localhost", "::1", "[::1]"])(
    "allows development on %s",
    async (host) => {
      const result = await validateEnv(
        validEnv({ NODE_ENV: "development", HOST: host }),
      );

      expect(result.ok).toBe(true);
    },
  );

  test("says nothing about the bind address outside development", async () => {
    const result = await validateEnv(validEnv({ HOST: "0.0.0.0" }));

    expect(result.ok).toBe(true);
  });

  test("warns that the hardcoded credentials are live in development", async () => {
    const result = await validateEnv(validEnv({ NODE_ENV: "development" }));

    expect(result.warnings.join("\n")).toMatch(/DEV_USERS/);
  });
});

describe("resolveHost", () => {
  test("defaults to loopback in development", () => {
    expect(resolveHost({ NODE_ENV: "development" })).toBe("127.0.0.1");
  });

  test("defaults to every interface otherwise", () => {
    expect(resolveHost({ NODE_ENV: "production" })).toBe("0.0.0.0");
  });

  test("prefers an explicit HOST", () => {
    expect(resolveHost({ NODE_ENV: "production", HOST: " 10.1.2.3 " })).toBe(
      "10.1.2.3",
    );
  });

  test("ignores a blank HOST", () => {
    expect(resolveHost({ NODE_ENV: "development", HOST: "   " })).toBe(
      "127.0.0.1",
    );
  });
});

describe("isLoopbackHost", () => {
  test("does not accept an unknown spelling", () => {
    // Erring towards "not loopback" only ever refuses a boot; erring the other
    // way publishes the development credentials.
    expect(isLoopbackHost("127.1")).toBe(false);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
  });

  test("accepts the IPv4-mapped IPv6 form", () => {
    expect(isLoopbackHost("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("MONGODB_URI", () => {
  test("rejects a URI with no database name", async () => {
    // It connects, and then reads and writes the driver's default database.
    const result = await validateEnv(
      validEnv({ MONGODB_URI: "mongodb://localhost:27017" }),
    );

    expect(result.ok).toBe(false);
    expect(errorFor(result, "MONGODB_URI")).toMatch(/database/);
  });

  test("rejects a trailing slash with nothing after it", async () => {
    const result = await validateEnv(
      validEnv({ MONGODB_URI: "mongodb://localhost:27017/" }),
    );

    expect(result.ok).toBe(false);
  });

  test("rejects another protocol entirely", async () => {
    const result = await validateEnv(
      validEnv({ MONGODB_URI: "postgres://localhost:5432/komondor" }),
    );

    expect(result.ok).toBe(false);
    expect(errorFor(result, "MONGODB_URI")).toMatch(/mongodb/);
  });

  test("accepts a replica set's comma-separated hosts", async () => {
    // new URL() cannot parse this, which is why it is not used on its own.
    const result = await validateEnv(
      validEnv({
        MONGODB_URI: "mongodb://a.example:27017,b.example:27017/komondor?replicaSet=rs0",
      }),
    );

    expect(result.ok).toBe(true);
  });

  test("accepts an SRV URI with credentials and options", async () => {
    const result = await validateEnv(
      validEnv({
        MONGODB_URI:
          "mongodb+srv://user:p%40ss@cluster.example.net/komondor?retryWrites=true",
      }),
    );

    expect(result.ok).toBe(true);
  });

  test("accepts the locally assembled URI when none is configured", async () => {
    // Existing deployments set MONGODB_PORT and no URI; they must still boot.
    const env = validEnv({ MONGODB_PORT: "27018" });
    delete env.MONGODB_URI;

    const result = await validateEnv(env);

    expect(result.ok).toBe(true);
  });
});

describe("resolveMongoUri", () => {
  test("assembles the local URI from MONGODB_PORT", () => {
    expect(resolveMongoUri({ MONGODB_PORT: "27018" })).toBe(
      "mongodb://localhost:27018/komondor",
    );
  });

  test("falls back to the default port", () => {
    expect(resolveMongoUri({})).toBe("mongodb://localhost:27017/komondor");
  });

  test("prefers MONGODB_URI when it is set", () => {
    expect(
      resolveMongoUri({ MONGODB_URI: "mongodb://elsewhere/db", MONGODB_PORT: "1" }),
    ).toBe("mongodb://elsewhere/db");
  });
});

describe("required settings", () => {
  test("reports the missing JWT secret", async () => {
    const env = validEnv();
    delete env.JWT_SECRET;

    const result = await validateEnv(env);

    expect(result.ok).toBe(false);
    expect(errorFor(result, "JWT_SECRET")).toBeDefined();
  });

  test("reports the missing web app URL", async () => {
    const env = validEnv();
    delete env.WEB_APP_URL;

    const result = await validateEnv(env);

    expect(result.ok).toBe(false);
    expect(errorFor(result, "WEB_APP_URL")).toBeDefined();
  });

  test("rejects a web app URL that is not a URL", async () => {
    const result = await validateEnv(validEnv({ WEB_APP_URL: "komondor.example.org" }));

    expect(result.ok).toBe(false);
    expect(errorFor(result, "WEB_APP_URL")).toMatch(/URL/);
  });

  test("lists every problem at once", async () => {
    // One restart per missing variable is how a deploy takes an afternoon.
    const env = validEnv({ MONGODB_URI: "mongodb://localhost:27017" });
    delete env.JWT_SECRET;
    delete env.WEB_APP_URL;
    delete env.DATASTORE_ROOT;

    const result = await validateEnv(env);

    expect(result.errors).toHaveLength(4);
  });
});

describe("required mounts", () => {
  test("reports a datastore root that is not there", async () => {
    const result = await validateEnv(
      validEnv({ DATASTORE_ROOT: path.join(tmpRoot, "missing") }),
    );

    expect(result.ok).toBe(false);
    expect(errorFor(result, "DATASTORE_ROOT")).toMatch(/ENOENT/);
  });

  test("reports a transfer directory that is not there", async () => {
    const result = await validateEnv(
      validEnv({ HPC_TRANSFER_DIRECTORY: path.join(tmpRoot, "missing") }),
    );

    expect(result.ok).toBe(false);
    expect(errorFor(result, "HPC_TRANSFER_DIRECTORY")).toBeDefined();
  });

  testUnlessRoot("reports a mount it cannot write to", async () => {
    // A read-only mount is the normal shape of a failed NFS mount, and every
    // upload path needs to write.
    const result = await validateEnv(validEnv({ DATASTORE_ROOT: unwritable }));

    expect(result.ok).toBe(false);
    expect(errorFor(result, "DATASTORE_ROOT")).toMatch(/readable and writable/);
  });

  test("reports a path that is a file rather than a directory", async () => {
    // fs.access alone is happy with a file, and a stand-in file is what a
    // mount that never came up tends to leave behind.
    const result = await validateEnv(validEnv({ DATASTORE_ROOT: regularFile }));

    expect(result.ok).toBe(false);
    expect(errorFor(result, "DATASTORE_ROOT")).toMatch(/not a directory/);
  });

  test("reports an unset mount without touching the filesystem", async () => {
    const env = validEnv();
    delete env.HPC_TRANSFER_DIRECTORY;

    const result = await validateEnv(env);

    expect(errorFor(result, "HPC_TRANSFER_DIRECTORY")).toMatch(/not set/);
  });
});

describe("the upload staging directory", () => {
  // A broken upload root used to boot cleanly and report ready: neither this
  // check nor /ready looked at it, so the first sign of trouble was every
  // local-filesystem ingest failing after the client had been told its upload
  // had been accepted.
  afterEach(() => {
    process.env.UPLOAD_DIRECTORY = uploadDirectory;
  });

  test("passes when it is there and writable", async () => {
    const result = await validateEnv(validEnv());

    expect(errorFor(result, "UPLOAD_DIRECTORY")).toBeUndefined();
  });

  test("reports one that is not there", async () => {
    process.env.UPLOAD_DIRECTORY = path.join(tmpRoot, "missing-uploads");

    const result = await validateEnv(validEnv());

    expect(result.ok).toBe(false);
    expect(errorFor(result, "UPLOAD_DIRECTORY")).toMatch(/ENOENT/);
  });

  test("reports one that is a file rather than a directory", async () => {
    process.env.UPLOAD_DIRECTORY = regularFile;

    const result = await validateEnv(validEnv());

    expect(result.ok).toBe(false);
    expect(errorFor(result, "UPLOAD_DIRECTORY")).toMatch(/not a directory/);
  });

  testUnlessRoot("reports one it cannot write to", async () => {
    process.env.UPLOAD_DIRECTORY = unwritable;

    const result = await validateEnv(validEnv());

    expect(result.ok).toBe(false);
    expect(errorFor(result, "UPLOAD_DIRECTORY")).toMatch(
      /readable and writable/,
    );
  });
});

describe("the ingest worker's tunables", () => {
  // Both used to reach the worker as a bare Number(): a typo gave NaN, which
  // setInterval turns into a poll as fast as the event loop allows, and which
  // makes every lease expiry an Invalid Date — all while /ready stayed green.
  test("accepts sensible values", async () => {
    const result = await validateEnv(
      validEnv({ INGEST_POLL_MS: "5000", INGEST_LEASE_MINUTES: "60" }),
    );

    expect(result.ok).toBe(true);
  });

  test("says nothing when neither is set", async () => {
    // Unset means "use lib/ingest-queue.js's own defaults", not "misconfigured".
    const result = await validateEnv(validEnv());

    expect(errorFor(result, "INGEST_POLL_MS")).toBeUndefined();
    expect(errorFor(result, "INGEST_LEASE_MINUTES")).toBeUndefined();
  });

  test("rejects a poll interval that is not a number", async () => {
    const result = await validateEnv(validEnv({ INGEST_POLL_MS: "500O" }));

    expect(result.ok).toBe(false);
    expect(errorFor(result, "INGEST_POLL_MS")).toMatch(/not a number/);
  });

  test("rejects a poll interval that would hammer the database", async () => {
    const result = await validateEnv(validEnv({ INGEST_POLL_MS: "1" }));

    expect(result.ok).toBe(false);
    expect(errorFor(result, "INGEST_POLL_MS")).toMatch(/between/);
  });

  test("rejects a poll interval so long the queue would sit still", async () => {
    const result = await validateEnv(validEnv({ INGEST_POLL_MS: "86400000" }));

    expect(result.ok).toBe(false);
    expect(errorFor(result, "INGEST_POLL_MS")).toBeDefined();
  });

  test("rejects a lease that is not a number", async () => {
    const result = await validateEnv(
      validEnv({ INGEST_LEASE_MINUTES: "sixty" }),
    );

    expect(result.ok).toBe(false);
    expect(errorFor(result, "INGEST_LEASE_MINUTES")).toMatch(/not a number/);
  });

  test("rejects a zero-length lease", async () => {
    // Zero would expire the claim the instant it was taken, so every job would
    // be handed to the next poll while the first was still moving files.
    const result = await validateEnv(validEnv({ INGEST_LEASE_MINUTES: "0" }));

    expect(result.ok).toBe(false);
    expect(errorFor(result, "INGEST_LEASE_MINUTES")).toMatch(/between/);
  });

  test("rejects a lease longer than a day", async () => {
    const result = await validateEnv(
      validEnv({ INGEST_LEASE_MINUTES: "100000" }),
    );

    expect(result.ok).toBe(false);
    expect(errorFor(result, "INGEST_LEASE_MINUTES")).toBeDefined();
  });

  test("reports both at once", async () => {
    const result = await validateEnv(
      validEnv({ INGEST_POLL_MS: "nope", INGEST_LEASE_MINUTES: "nope" }),
    );

    expect(result.errors).toHaveLength(2);
  });
});

describe("TLS warnings", () => {
  test("warns that SMTP certificates are not verified", async () => {
    const result = await validateEnv(validEnv({ SMTP_HOST: "smtp.example.org" }));

    expect(result.warnings.join("\n")).toMatch(/rejectUnauthorized/);
  });

  test("does not refuse to start over it", async () => {
    // Mail is not worth refusing to serve sequence data for.
    const result = await validateEnv(validEnv({ SMTP_HOST: "smtp.example.org" }));

    expect(result.ok).toBe(true);
  });

  test("says nothing about SMTP when no host is configured", async () => {
    const result = await validateEnv(validEnv());

    expect(result.warnings.join("\n")).not.toMatch(/SMTP/);
  });

  test.each(["0", "false", "no", "OFF"])(
    "warns when NODE_TLS_REJECT_UNAUTHORIZED is %s",
    async (value) => {
      const result = await validateEnv(
        validEnv({ NODE_TLS_REJECT_UNAUTHORIZED: value }),
      );

      expect(result.warnings.join("\n")).toMatch(
        /NODE_TLS_REJECT_UNAUTHORIZED/,
      );
    },
  );

  test("says nothing when TLS verification is left on", async () => {
    const result = await validateEnv(
      validEnv({ NODE_TLS_REJECT_UNAUTHORIZED: "1" }),
    );

    expect(result.warnings).toEqual([]);
  });
});
