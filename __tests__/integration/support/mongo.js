/**
 * Connects this test file's own mongoose instance to the real MongoDB the
 * integration CI job provisions (see the `integration` job in
 * .github/workflows/ci.yml). Jest gives every test file its own module
 * registry, so each file's `require("mongoose")` — and every model built on
 * it — is already independent; this only wraps connect/disconnect around it.
 */

const mongoose = require("mongoose");

/**
 * Connects to MONGODB_URI, the same variable name (and same
 * MONGODB_PORT-assembled fallback) lib/utils/validateEnv.js and server.js
 * read — so a mismatch between what this suite connects to and what the app
 * would connect to cannot hide here.
 * @returns {Promise<void>}
 */
const connect = async () => {
  const uri =
    process.env.MONGODB_URI && process.env.MONGODB_URI.trim() !== ""
      ? process.env.MONGODB_URI.trim()
      : `mongodb://localhost:${process.env.MONGODB_PORT || 27017}/komondor-integration-test`;

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

module.exports = { mongoose, connect, resetCollections, dropDatabase, disconnect };
