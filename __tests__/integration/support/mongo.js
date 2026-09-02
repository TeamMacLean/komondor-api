/**
 * Connects this test file's own mongoose instance to the real MongoDB the
 * integration CI job provisions (see the `integration` job in
 * .github/workflows/ci.yml). Jest gives every test file its own module
 * registry, so each file's `require("mongoose")` — and every model built on
 * it — is already independent; this only wraps connect/disconnect around it.
 */

const mongoose = require("mongoose");
const { resolveMongoUri } = require("../../../lib/utils/validateEnv");

/**
 * Connects to MONGODB_URI, which must be set explicitly.
 *
 * This used to claim it shared "the same MONGODB_PORT-assembled fallback"
 * as lib/utils/validateEnv.js and server.js, and did not: the fallback here
 * named the database `komondor-integration-test`, while resolveMongoUri
 * names it `komondor`. With only MONGODB_PORT set, this suite therefore
 * seeded fixtures into one database while the server it SPAWNS
 * (startup-index-conflict.test.js runs the real server.js as a child
 * process, inheriting the environment) connected to another — so a test
 * asserting the server refuses to boot on a poisoned index was poisoning an
 * index the server never looked at. An audit found it; the comment above it
 * asserted the opposite.
 *
 * Rather than copy the app's fallback — which would point a suite that
 * empties every collection at the developer's own `komondor` database —
 * there is now no fallback at all. Set MONGODB_URI and both this process and
 * any process it spawns resolve to the same string by construction.
 * @returns {Promise<void>}
 * @throws {Error} When MONGODB_URI is not set.
 */
const connect = async () => {
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.trim() === "") {
    const appWouldUse = resolveMongoUri({
      MONGODB_PORT: process.env.MONGODB_PORT,
    });
    throw new Error(
      [
        "MONGODB_URI must be set explicitly to run the integration suite.",
        `Without it the app — and the server this suite spawns — resolves to ${appWouldUse},`,
        "which is a real database, not a scratch one.",
        "Run with e.g. MONGODB_URI=mongodb://localhost:27017/komondor-integration-test",
      ].join(" "),
    );
  }

  const uri = process.env.MONGODB_URI.trim();

  await mongoose.connect(uri, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 10000,
  });
};

/**
 * Empties every collection without dropping the database, so index builds
 * from a previous describe block are not repeated needlessly.
 *
 * Lists collections from the server (`db.listCollections()`), not from
 * `mongoose.connection.collections` — that registry only knows about
 * collections a model has been compiled against in THIS process, and every
 * jest test file gets its own fresh module registry (so its own fresh
 * mongoose instance, starting with an empty registry). Reset via the client
 * registry would silently skip whatever an earlier file, or an earlier
 * invocation against this same database, already wrote — exactly the gap
 * that let a leftover pending IngestJob turn a two-way claim race into a
 * false pass while writing this suite.
 * @returns {Promise<void>}
 */
const resetCollections = async () => {
  const collections = await mongoose.connection.db.listCollections().toArray();
  await Promise.all(
    collections.map((info) =>
      mongoose.connection.db
        .collection(info.name)
        .deleteMany({})
        .catch(() => {}),
    ),
  );
};

/**
 * Drops the whole database. Used only where a leftover conflicting index
 * (see startup-index-conflict.test.js) must not survive into the next test.
 * @returns {Promise<void>}
 */
const dropDatabase = async () => {
  await mongoose.connection.dropDatabase();
};

/** Closes the connection. Call from afterAll. */
const disconnect = async () => {
  await mongoose.disconnect();
};

module.exports = {
  mongoose,
  connect,
  resetCollections,
  dropDatabase,
  disconnect,
};
