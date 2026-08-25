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
  fixStaleIndex,
  INDEX_NAME,
} = require("../../scripts/check-run-duplicates");

/** A minimal stand-in for the mongodb driver's Collection, indexes() only. */
const makeCollection = (indexes) => ({
  indexes: jest.fn().mockResolvedValue(indexes),
  dropIndex: jest.fn().mockResolvedValue({}),
  createIndex: jest.fn().mockResolvedValue(INDEX_NAME),
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

  test("does not match on key shape alone, only the name", async () => {
    // A same-shaped index under a different name (e.g. explicitly named by an
    // earlier migration) is not the collision this script is watching for —
    // mongoose's background build only collides on the auto-generated name.
    const collection = makeCollection([
      { name: "sample_and_name_custom", key: { sample: 1, name: 1 } },
    ]);

    await expect(findSampleNameIndex(collection)).resolves.toBeNull();
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
});
