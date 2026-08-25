const fs = require("fs").promises;
const { constants: fsConstants } = require("fs");

const { uploadPath } = require("./uploadPath");

// Where the API binds when HOST is not set.
//
// Development defaults to loopback because routes/auth.js accepts a hardcoded
// DEV_USERS list with fixed passwords whenever NODE_ENV is "development", and
// nothing else gates it: .env in this repo sets NODE_ENV=development and
// ecosystem.config.js ships no env block, so one copied file is all that
// stands between those credentials and a public listener. Binding to loopback
// means such a mistake is unreachable from the network rather than merely
// unlikely.
const DEV_DEFAULT_HOST = "127.0.0.1";
const DEFAULT_HOST = "0.0.0.0";

const DEVELOPMENT = "development";

// The database the API has always used when the URI is assembled locally.
const LEGACY_MONGO_DB = "komondor";
const LEGACY_MONGO_PORT = 27017;

// How people spell "off" in an env file. Compared lower-cased.
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

// Bounds for the ingest worker's two tunables (server.js passes them to
// lib/ingest-queue.js).
//
// They are checked here because neither fails loudly. Both reach the worker as
// a bare Number(), so a typo like "500O" becomes NaN: setInterval(tick, NaN)
// polls as fast as the event loop allows — a hot loop hammering Mongo — and a
// NaN lease makes every claim's leaseExpiresAt an Invalid Date, so the worker
// throws on every job. In both cases the process keeps listening and /ready
// keeps answering 200, which is exactly the shape of failure that costs a day
// to find.
//
// The bounds are deliberately wide: the aim is to catch a typo, not to
// second-guess an operator. The queue's own defaults (5s, 60min) sit well
// inside them.
const INGEST_POLL_MS_MIN = 250;
const INGEST_POLL_MS_MAX = 5 * 60 * 1000;
const INGEST_LEASE_MINUTES_MIN = 1;
const INGEST_LEASE_MINUTES_MAX = 24 * 60;

/** True for a string with something other than whitespace in it. */
const isSet = (value) => typeof value === "string" && value.trim() !== "";

/** True when `value` reads as an explicit "off". */
const isDisabled = (value) =>
  typeof value === "string" && DISABLED_VALUES.has(value.trim().toLowerCase());

/**
 * Returns true when `host` is an address only this machine can reach.
 *
 * Recognising a loopback address wrongly is the dangerous direction, so this
 * is deliberately strict: an unrecognised spelling is reported as non-loopback
 * and refuses the boot, rather than being waved through.
 *
 * @param {string} host - The address the server would bind to.
 * @returns {boolean} True if the address is loopback-only.
 */
const isLoopbackHost = (host) => {
  if (typeof host !== "string") {
    return false;
  }

  // A bracketed literal is how an IPv6 address is written alongside a port.
  const bare = host.trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase();

  if (bare === "localhost" || bare === "::1") {
    return true;
  }

  // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1, and
  // "::ffff:127.0.0.1" is the IPv4-mapped spelling of the same address.
  const ipv4 = bare.startsWith("::ffff:") ? bare.slice("::ffff:".length) : bare;

  return /^127(\.\d{1,3}){3}$/.test(ipv4);
};

/**
 * Returns the address the server should bind to.
 * @param {Object} [env=process.env] - The environment to read.
 * @returns {string} The bind address.
 */
const resolveHost = (env = process.env) => {
  if (isSet(env.HOST)) {
    return env.HOST.trim();
  }

  return env.NODE_ENV === DEVELOPMENT ? DEV_DEFAULT_HOST : DEFAULT_HOST;
};

/**
 * Returns the MongoDB connection string the server should use.
 *
 * MONGODB_URI wins when set. The fallback reproduces what server.js has always
 * built from MONGODB_PORT, so existing deployments (which set no MONGODB_URI)
 * keep working — but it goes through the same validation, so a typo'd port is
 * still caught before anything listens.
 *
 * @param {Object} [env=process.env] - The environment to read.
 * @returns {string} The connection string.
 */
const resolveMongoUri = (env = process.env) => {
  if (isSet(env.MONGODB_URI)) {
    return env.MONGODB_URI.trim();
  }

  const port = isSet(env.MONGODB_PORT)
    ? env.MONGODB_PORT.trim()
    : String(LEGACY_MONGO_PORT);

  return `mongodb://localhost:${port}/${LEGACY_MONGO_DB}`;
};

/**
 * Checks a MongoDB connection string is one this API can actually use.
 *
 * `new URL()` is not enough on its own: it rejects the comma-separated host
 * list of a replica-set URI, which is perfectly valid here. And it would not
 * check the part that matters most — the database name. "mongodb://localhost"
 * connects happily and then reads and writes whichever database the driver
 * defaults to, which is how you end up with an API that looks healthy and an
 * empty collection list.
 *
 * @param {string} uri - The connection string to check.
 * @returns {{ok: boolean, error: (string|null)}} Why it was rejected, if it was.
 */
const parseMongoUri = (uri) => {
  if (!isSet(uri)) {
    return { ok: false, error: "is not set" };
  }

  const trimmed = uri.trim();
  const scheme = /^mongodb(\+srv)?:\/\//i.exec(trimmed);

  if (!scheme) {
    return {
      ok: false,
      error: 'must begin with "mongodb://" or "mongodb+srv://"',
    };
  }

  // Splitting on "?" and "/" cannot cut the URI in the wrong place: the
  // connection string spec requires both characters to be percent-encoded
  // inside a username or password.
  const authority = trimmed.slice(scheme[0].length).split("?")[0];
  const separator = authority.indexOf("/");
  const hosts = separator === -1 ? authority : authority.slice(0, separator);
  const database = separator === -1 ? "" : authority.slice(separator + 1);

  if (hosts.slice(hosts.lastIndexOf("@") + 1).trim() === "") {
    return { ok: false, error: "names no host" };
  }

  if (database.trim() === "") {
    return {
      ok: false,
      error:
        'names no database (expected something like "mongodb://localhost:27017/komondor") — ' +
        "without one the driver silently picks its own default",
    };
  }

  return { ok: true, error: null };
};

/**
 * Checks that a configured mount exists and can be both read and written.
 *
 * @param {string} name - The env var's name, for the message.
 * @param {string} value - The configured path.
 * @returns {Promise<string|null>} An error message, or null when usable.
 */
const checkMount = async (name, value) => {
  if (!isSet(value)) {
    return `${name} is not set`;
  }

  const path = value.trim();

  try {
    await fs.access(path, fsConstants.R_OK | fsConstants.W_OK);
  } catch (err) {
    return `${name} ("${path}") is not readable and writable by this process (${err.code || err.message})`;
  }

  // fs.access is happy with a plain file, and a mount that failed to come up
  // often leaves a file or a broken stand-in where the directory should be.
  try {
    const stats = await fs.stat(path);

    if (!stats.isDirectory()) {
      return `${name} ("${path}") is not a directory`;
    }
  } catch (err) {
    // Reported rather than thrown: validateEnv's caller expects a verdict, and
    // a path that vanished between the two calls is a configuration problem
    // like any other.
    return `${name} ("${path}") could not be inspected (${err.code || err.message})`;
  }

  return null;
};

/**
 * Checks an optional numeric setting parses and lands inside sane bounds.
 *
 * Unset is not an error: the module that consumes each of these owns its own
 * default, and a default repeated here would silently override that reasoning.
 * What is rejected is a value that was meant to say something and does not.
 *
 * @param {string} name - The env var's name, for the message.
 * @param {*} value - The configured value, if any.
 * @param {{min: number, max: number, unit: string}} bounds - Accepted range.
 * @returns {string|null} An error message, or null when usable (or unset).
 */
const checkNumericRange = (name, value, { min, max, unit }) => {
  const raw = value === undefined || value === null ? "" : String(value).trim();

  if (raw === "") {
    return null;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    return `${name} ("${raw}") is not a number`;
  }

  if (parsed < min || parsed > max) {
    return `${name} (${parsed}) must be between ${min} and ${max} ${unit}`;
  }

  return null;
};

/**
 * Validates the process configuration before anything starts listening.
 *
 * Deliberately pure enough to unit test: it reads the env object it is handed
 * rather than process.env, touches only the paths that env names, and reports
 * what it found instead of exiting. server.js owns the decision to terminate.
 *
 * Every problem is collected rather than thrown at the first one, so a
 * half-configured deployment is fixed in a single pass instead of one restart
 * per missing variable.
 *
 * @param {Object} [env=process.env] - The environment to validate.
 * @returns {Promise<{ok: boolean, errors: string[], warnings: string[]}>}
 */
const validateEnv = async (env = process.env) => {
  const errors = [];
  const warnings = [];

  const host = resolveHost(env);

  if (env.NODE_ENV === DEVELOPMENT && !isLoopbackHost(host)) {
    errors.push(
      `NODE_ENV is "development" but the server would bind to ${host}. ` +
        "Development mode accepts the hardcoded DEV_USERS credentials in routes/auth.js, " +
        "so it may only listen on loopback. Set HOST=127.0.0.1, or set NODE_ENV to something else.",
    );
  }

  const mongo = parseMongoUri(resolveMongoUri(env));

  if (!mongo.ok) {
    errors.push(`MONGODB_URI ${mongo.error}`);
  }

  if (!isSet(env.JWT_SECRET)) {
    errors.push(
      "JWT_SECRET is not set — tokens cannot be signed or verified without it",
    );
  }

  if (!isSet(env.WEB_APP_URL)) {
    errors.push(
      "WEB_APP_URL is not set — it is the only allowed CORS origin, so the web app cannot reach the API without it",
    );
  } else {
    try {
      const origin = new URL(env.WEB_APP_URL.trim());
      if (origin.protocol !== "http:" && origin.protocol !== "https:") {
        errors.push(
          `WEB_APP_URL ("${env.WEB_APP_URL.trim()}") is not an http(s) URL`,
        );
      }
    } catch (err) {
      errors.push(
        `WEB_APP_URL ("${env.WEB_APP_URL.trim()}") is not a valid URL (${err.message})`,
      );
    }
  }

  // Sequentially, so the aggregated list reads the same way every time.
  const datastore = await checkMount("DATASTORE_ROOT", env.DATASTORE_ROOT);
  if (datastore) {
    errors.push(datastore);
  }

  const transfer = await checkMount(
    "HPC_TRANSFER_DIRECTORY",
    env.HPC_TRANSFER_DIRECTORY,
  );
  if (transfer) {
    errors.push(transfer);
  }

  // The tus staging directory, where every local-filesystem upload lands
  // before a project claims it. Without this check a broken upload root booted
  // cleanly and reported ready, and the first symptom was an ingest failing
  // after the client had already been told its upload was accepted.
  //
  // Taken from lib/utils/uploadPath.js rather than from `env`: that module is
  // the single source of truth for the path and resolves it from process.env
  // (or <cwd>/files) per call, exactly as routes/uploads.js, lib/file-utils.js
  // and models/File.js do. Re-deriving it from `env` here would validate a
  // path that nothing else uses. The name in the message is the variable that
  // overrides it; the path in the message is what was actually resolved,
  // default included.
  const upload = await checkMount("UPLOAD_DIRECTORY", uploadPath());
  if (upload) {
    errors.push(upload);
  }

  const pollInterval = checkNumericRange(
    "INGEST_POLL_MS",
    env.INGEST_POLL_MS,
    {
      min: INGEST_POLL_MS_MIN,
      max: INGEST_POLL_MS_MAX,
      unit: "ms",
    },
  );
  if (pollInterval) {
    errors.push(pollInterval);
  }

  const lease = checkNumericRange(
    "INGEST_LEASE_MINUTES",
    env.INGEST_LEASE_MINUTES,
    {
      min: INGEST_LEASE_MINUTES_MIN,
      max: INGEST_LEASE_MINUTES_MAX,
      unit: "minutes",
    },
  );
  if (lease) {
    errors.push(lease);
  }

  if (env.NODE_ENV === DEVELOPMENT) {
    warnings.push(
      `NODE_ENV is "development": routes/auth.js accepts the hardcoded DEV_USERS passwords, ` +
        `and lib/utils/sendEmail.js logs mail instead of sending it. Bound to ${host}.`,
    );
  }

  if (isDisabled(env.NODE_TLS_REJECT_UNAUTHORIZED)) {
    warnings.push(
      "NODE_TLS_REJECT_UNAUTHORIZED is disabled — TLS certificates are unverified " +
        "process-wide, including LDAP and SMTP. Any network attacker can impersonate them.",
    );
  }

  if (isSet(env.SMTP_HOST)) {
    // Not conditional on an env var: lib/utils/sendEmail.js hardcodes
    // `tls: { rejectUnauthorized: false }`, so verification is off no matter
    // what the environment says. The warning stands until that file changes.
    warnings.push(
      `SMTP TLS certificate verification is disabled for ${env.SMTP_HOST.trim()} — ` +
        "lib/utils/sendEmail.js sets tls.rejectUnauthorized to false, so mail (including " +
        "anything it quotes) can be intercepted by whoever answers that address.",
    );
  }

  return { ok: errors.length === 0, errors, warnings };
};

module.exports = {
  validateEnv,
  resolveHost,
  resolveMongoUri,
  isLoopbackHost,
};
