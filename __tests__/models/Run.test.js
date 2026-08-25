/**
 * Tests for the Run schema's declared indexes.
 *
 * No database: schema.indexes() is what mongoose sends to createIndex, so it is
 * the honest source for whether a constraint is a constraint or only a hint.
 * The one that matters here is { sample, name } — POST /runs/new checks for an
 * existing run with Run.findOne({ sample, name }) and treats a hit as an
 * idempotent repeat. A non-unique index makes that check advisory: two
 * concurrent identical POSTs both miss the findOne, both insert, and the second
 * run queues a second ingest for the same source files, which can only fail
 * once the first has moved them.
 */

const Run = require("../../models/Run");

describe("Run indexes", () => {
  const indexes = Run.schema.indexes();

  /** The options declared for the first index matching `keys`. */
  const optionsFor = (keys) => {
    const match = indexes.find(
      ([indexKeys]) => JSON.stringify(indexKeys) === JSON.stringify(keys),
    );
    return match && match[1];
  };

  test("the idempotency index on { sample, name } is unique", () => {
    const options = optionsFor({ sample: 1, name: 1 });

    expect(options).toBeDefined();
    expect(options.unique).toBe(true);
  });

  test("name on its own stays non-unique", () => {
    // Two groups may legitimately name a run the same thing; only the pairing
    // with a sample is unique. (models/Run.js says as much on the field.)
    expect(optionsFor({ name: 1 })).toBeUndefined();
  });

  test("the query indexes the background jobs lean on are still declared", () => {
    expect(optionsFor({ status: 1 })).toBeDefined();
    expect(optionsFor({ md5VerificationStatus: 1 })).toBeDefined();
    expect(optionsFor({ group: 1, createdAt: -1 })).toBeDefined();
  });
});
