/**
 * Tests for scripts/check-run-duplicates.js's index-conflict decision logic.
 *
 * Only findSampleNameIndex and fixStaleIndex are exported (main() is a CLI
 * entrypoint that connects to a real Mongo and calls process.exit, so it is
 * exercised end-to-end by __tests__/integration/startup-index-conflict.test.js
 * instead — that suite proves Run.init()/IngestJob.init() actually refuse to
 * boot on a poisoned index, which is the property this script exists to catch
 * before a deploy). This file covers the two pure decision points a mocked
 * collection can prove without a real database: which index (if any) a
 * background build would collide with, and exactly what a --fix repair does
 * to it.
 */

const {
  findSampleNameIndex,
  isEquivalentToSchemaIndex,
  findIndexConflicts,
  fixStaleIndex,
  INDEX_NAME,
} = require("../../scripts/check-run-duplicates");

/**
 * A minimal stand-in for the mongodb driver's Collection. aggregate()
 * defaults to reporting no duplicates, since fixStaleIndex re-checks for them
 * immediately before dropping the old index.
 */
const makeCollection = (indexes) => ({
  indexes: jest.fn().mockResolvedValue(indexes),
  dropIndex: jest.fn().mockResolvedValue({}),
  createIndex: jest.fn().mockResolvedValue(INDEX_NAME),
  aggregate: jest.fn().mockReturnValue({ toArray: async () => [] }),
});

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("INDEX_NAME", () => {
  test("is mongoose's auto-generated name for { sample: 1, name: 1 }", () => {
    // fixStaleIndex rebuilds under this exact name so the new index slots
    // into the same background build mongoose already attempts; a wrong
    // constant here would rebuild a same-shaped index under a different name
    // and leave the original conflict in place.
    expect(INDEX_NAME).toBe("sample_1_name_1");
  });
});

describe("findSampleNameIndex", () => {
  test("finds a stale non-unique index under the auto-generated name", async () => {
    const staleIndex = { name: "sample_1_name_1", key: { sample: 1, name: 1 } };
    const collection = makeCollection([
      { name: "_id_", key: { _id: 1 } },
      staleIndex,
    ]);

    await expect(findSampleNameIndex(collection)).resolves.toBe(staleIndex);
  });

  test("finds an index already built unique under that name", async () => {
    const uniqueIndex = {
      name: "sample_1_name_1",
      key: { sample: 1, name: 1 },
      unique: true,
    };
    const collection = makeCollection([{ name: "_id_" }, uniqueIndex]);

    const found = await findSampleNameIndex(collection);
    expect(found).toBe(uniqueIndex);
    expect(found.unique).toBe(true);
  });

  test("returns null when no index occupies the name", async () => {
    const collection = makeCollection([
      { name: "_id_", key: { _id: 1 } },
      { name: "createdAt_1", key: { createdAt: 1 } },
    ]);

    await expect(findSampleNameIndex(collection)).resolves.toBeNull();
  });

  test("returns null against an empty index list", async () => {
    const collection = makeCollection([]);

    await expect(findSampleNameIndex(collection)).resolves.toBeNull();
  });

  test("looks up by name only, and says nothing about whether that is the only conflict", async () => {
    // This function answers "what occupies the auto-generated name", nothing
    // more. It used to carry a comment asserting that a same-shaped index
    // under a DIFFERENT name "is not the collision this script is watching
    // for", which real MongoDB 7 flatly disproves — see findIndexConflicts
    // below, where an audit's executed reproduction now lives.
    const collection = makeCollection([
      { name: "sample_and_name_custom", key: { sample: 1, name: 1 } },
    ]);

    await expect(findSampleNameIndex(collection)).resolves.toBeNull();
  });
});

describe("findIndexConflicts", () => {
  // Every case below was executed against a real MongoDB 7.0.29 before being
  // written down; the verdicts are that server's, not a reading of the docs.
  test("reports an equivalent index under a different name", () => {
    // MongoDB: IndexOptionsConflict (85), "Index already exists with a
    // different name: sample_and_name_custom". The old check declared this
    // safe, and a deploy would have started with the index never built.
    const conflicts = findIndexConflicts([
      { name: "_id_", key: { _id: 1 } },
      {
        name: "sample_and_name_custom",
        key: { sample: 1, name: 1 },
        unique: true,
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].index.name).toBe("sample_and_name_custom");
    expect(conflicts[0].reason).toMatch(/different name/i);
  });

  test("allows a NON-equivalent index of the same keys under a different name", () => {
    // Executed: a non-unique { sample, name } index under another name does
    // NOT conflict — MongoDB treats differing options as a different index
    // and builds the unique one alongside it. Reporting this as a conflict
    // would send an operator to drop an index nothing was wrong with.
    expect(
      findIndexConflicts([
        { name: "sample_and_name_custom", key: { sample: 1, name: 1 } },
      ]),
    ).toEqual([]);
  });

  test("reports a same-name index carrying storageEngine", () => {
    // Executed: IndexOptionsConflict (85). This is the case that showed a
    // denylist of "options that must be absent" could only ever cover what
    // it had thought of — storageEngine was not on it, and passed as safe.
    const conflicts = findIndexConflicts([
      {
        name: "sample_1_name_1",
        key: { sample: 1, name: 1 },
        unique: true,
        storageEngine: { wiredTiger: { configString: "block_compressor=zlib" } },
      },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toMatch(/different options/i);
  });

  test("accepts an existing background:true index as equivalent", () => {
    // Executed: ACCEPTED. `background` is a build hint modern servers
    // ignore, and it survives in listIndexes output on older data — so an
    // allowlist that omitted it would report a conflict that is not one.
    expect(
      findIndexConflicts([
        {
          v: 2,
          name: "sample_1_name_1",
          key: { sample: 1, name: 1 },
          unique: true,
          background: true,
        },
      ]),
    ).toEqual([]);
  });

  test("reports nothing when the schema's own index is already in place", () => {
    expect(
      findIndexConflicts([
        { name: "_id_", key: { _id: 1 } },
        { v: 2, name: "sample_1_name_1", key: { sample: 1, name: 1 }, unique: true },
      ]),
    ).toEqual([]);
  });

  test("reports both a name collision and a differently-named twin at once", () => {
    const conflicts = findIndexConflicts([
      { name: "sample_1_name_1", key: { sample: 1, name: 1 } },
      { name: "legacy_pair", key: { sample: 1, name: 1 }, unique: true },
    ]);

    expect(conflicts.map((c) => c.index.name).sort()).toEqual([
      "legacy_pair",
      "sample_1_name_1",
    ]);
  });
});

describe("isEquivalentToSchemaIndex", () => {
  test("accepts an index matching keys and unique exactly, with nothing else set", () => {
    expect(
      isEquivalentToSchemaIndex({
        name: "sample_1_name_1",
        key: { sample: 1, name: 1 },
        unique: true,
      }),
    ).toBe(true);
  });

  test("refuses a non-unique index with the right keys", () => {
    expect(
      isEquivalentToSchemaIndex({
        name: "sample_1_name_1",
        key: { sample: 1, name: 1 },
      }),
    ).toBe(false);
  });

  test("refuses the right keys and unique, but carrying a partialFilterExpression", () => {
    // Reproduced against a re-audit's finding: this passed the old
    // keys-and-unique-only check as "safe" and then failed startup with
    // MongoDB error 86 (IndexKeySpecsConflict) anyway, because mongoose's own
    // schema.index() call declares no partialFilterExpression at all.
    expect(
      isEquivalentToSchemaIndex({
        name: "sample_1_name_1",
        key: { sample: 1, name: 1 },
        unique: true,
        partialFilterExpression: { status: { $ne: "deleted" } },
      }),
    ).toBe(false);
  });

  test("refuses the right keys and unique, but carrying a collation", () => {
    expect(
      isEquivalentToSchemaIndex({
        name: "sample_1_name_1",
        key: { sample: 1, name: 1 },
        unique: true,
        collation: { locale: "en", strength: 2 },
      }),
    ).toBe(false);
  });

  test("refuses wrong keys even if unique and otherwise bare", () => {
    expect(
      isEquivalentToSchemaIndex({
        name: "sample_1_name_1",
        key: { name: 1 },
        unique: true,
      }),
    ).toBe(false);
  });

  test("refuses null", () => {
    expect(isEquivalentToSchemaIndex(null)).toBe(false);
  });
});

describe("fixStaleIndex", () => {
  test("drops the stale index and rebuilds it as a unique index of the same name", async () => {
    const collection = makeCollection([{ name: "sample_1_name_1" }]);

    await fixStaleIndex(collection);

    expect(collection.dropIndex).toHaveBeenCalledWith(INDEX_NAME);
    expect(collection.createIndex).toHaveBeenCalledWith(
      { sample: 1, name: 1 },
      { unique: true, name: INDEX_NAME },
    );
  });

  test("drops before creating, not the other way round", async () => {
    // createIndex under the same name as a still-present index is exactly
    // the IndexKeySpecsConflict this whole script exists to catch — the old
    // index has to be gone first.
    const order = [];
    const collection = makeCollection([{ name: "sample_1_name_1" }]);
    collection.dropIndex.mockImplementation(async () => {
      order.push("drop");
      return {};
    });
    collection.createIndex.mockImplementation(async () => {
      order.push("create");
      return INDEX_NAME;
    });

    await fixStaleIndex(collection);

    expect(order).toEqual(["drop", "create"]);
  });

  test("reports the index list before and after, for the operator's record", async () => {
    const before = { name: "sample_1_name_1", unique: undefined };
    const after = { name: "sample_1_name_1", unique: true };
    const collection = {
      indexes: jest
        .fn()
        .mockResolvedValueOnce([before])
        .mockResolvedValueOnce([after]),
      dropIndex: jest.fn().mockResolvedValue({}),
      createIndex: jest.fn().mockResolvedValue(INDEX_NAME),
      aggregate: jest.fn().mockReturnValue({ toArray: async () => [] }),
    };

    await fixStaleIndex(collection);

    expect(collection.indexes).toHaveBeenCalledTimes(2);
    const logged = console.log.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("Before:");
    expect(logged).toContain("After:");
    expect(logged).toContain(JSON.stringify([before], null, 2));
    expect(logged).toContain(JSON.stringify([after], null, 2));
  });

  test("propagates a failed dropIndex rather than attempting createIndex anyway", async () => {
    const collection = makeCollection([{ name: "sample_1_name_1" }]);
    const dropError = new Error("ns not found");
    collection.dropIndex.mockRejectedValue(dropError);

    await expect(fixStaleIndex(collection)).rejects.toThrow("ns not found");
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  test("aborts without dropping anything if a duplicate has appeared since the initial check", async () => {
    // The re-check immediately before dropping — it narrows, not closes, the
    // window a concurrent write could open, but a duplicate present AT THIS
    // MOMENT must still stop the drop: rebuilding as unique would fail the
    // same way as the original problem, only now with the old index gone too.
    const collection = makeCollection([{ name: "sample_1_name_1" }]);
    collection.aggregate.mockReturnValue({
      toArray: async () => [{ _id: { sample: "s1", name: "run-1" } }],
    });

    await expect(fixStaleIndex(collection)).rejects.toThrow(/duplicate/i);
    expect(collection.dropIndex).not.toHaveBeenCalled();
    expect(collection.createIndex).not.toHaveBeenCalled();
  });

  test("throws loudly, naming the risk, when createIndex fails after dropIndex already succeeded", async () => {
    // The genuinely dangerous failure this script can now cause: the old
    // index is gone and the new one never landed. Silently swallowing this
    // (e.g. logging and exiting 0) would report success on a collection with
    // NO { sample, name } index enforcing anything at all.
    const collection = makeCollection([{ name: "sample_1_name_1" }]);
    const createError = new Error("E11000 duplicate key error");
    collection.createIndex.mockRejectedValue(createError);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(fixStaleIndex(collection)).rejects.toThrow(
      "E11000 duplicate key error",
    );

    expect(collection.dropIndex).toHaveBeenCalled();
    const loggedError = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedError).toMatch(/no index/i);
    expect(loggedError).toMatch(/enforcing/i);
  });
});
