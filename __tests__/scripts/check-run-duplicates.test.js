/**
 * Tests for scripts/check-run-duplicates.js's index-conflict decision logic.
 *
 * The CLI connects to real Mongo and calls process.exit, so its end-to-end
 * agreement with the server lives in integration/preflight-cli.test.js.
 * This file covers the pure decision points and exact --fix mutations with a
 * stateful collection stand-in.
 */

const {
  findSampleNameIndex,
  isEquivalentToSchemaIndex,
  hasSameSignatureAsSchemaIndex,
  collectionIndexDefaults,
  expectedOptionMatches,
  findIndexConflicts,
  fixStaleIndex,
  findInvalidRunShapes,
  INDEX_NAME,
} = require("../../scripts/check-run-duplicates");

/**
 * A stand-in for the mongodb driver's Collection that actually keeps state.
 *
 * indexes() used to return one frozen list no matter what dropIndex and
 * createIndex had done to it — a database that cannot exist, and the reason
 * fixStaleIndex could not be tested for what it leaves behind. It now
 * reflects the drops and creates made against it, so a test asserting the
 * repair worked is asserting something.
 *
 * aggregate() defaults to reporting no duplicates, since fixStaleIndex
 * re-checks for them immediately before dropping the old index.
 */
const makeCollection = (indexes) => {
  let current = [...indexes];

  return {
    indexes: jest.fn(async () => current),
    dropIndex: jest.fn(async (name) => {
      current = current.filter((idx) => idx.name !== name);
      return {};
    }),
    createIndex: jest.fn(async (key, options) => {
      current = [
        ...current,
        { v: 2, key, name: options.name, unique: options.unique },
      ];
      return options.name;
    }),
    aggregate: jest.fn().mockReturnValue({ toArray: async () => [] }),
  };
};

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

describe("findInvalidRunShapes", () => {
  test("checks the exact scalar types required by the compound index", async () => {
    const malformed = [{ _id: "r1", sample: ["a", "b"], name: "Run" }];
    const aggregate = jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(malformed),
    });

    await expect(findInvalidRunShapes({ aggregate })).resolves.toEqual(
      malformed,
    );

    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({
      $match: {
        $expr: {
          $or: [
            { $ne: [{ $type: "$sample" }, "objectId"] },
            { $ne: [{ $type: "$name" }, "string"] },
          ],
        },
      },
    });
    expect(pipeline).toContainEqual({ $limit: 100 });
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
        storageEngine: {
          wiredTiger: { configString: "block_compressor=zlib" },
        },
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
        {
          v: 2,
          name: "sample_1_name_1",
          key: { sample: 1, name: 1 },
          unique: true,
        },
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

describe("the different-name signature rule, as MongoDB 7.0.29 applies it", () => {
  // One probe per option against a real server, then written down here. The
  // server's rule for "same index under a different name" (error 85) is NOT
  // the same question as "would mongoose's build be a no-op" — using the
  // strict test for both is what reported a custom-named unique index
  // carrying storageEngine as safe while the server refused it and the app
  // would not boot.
  //
  //   unique                            REFUSES 85
  //   unique + background               REFUSES 85
  //   unique + storageEngine            REFUSES 85
  //   unique + hidden                   REFUSES 85
  //   unique + sparse                   ACCEPTS (a genuinely different index)
  //   unique + collation                ACCEPTS
  //   unique + partialFilterExpression  ACCEPTS
  //   NOT unique                        ACCEPTS
  const custom = (extra) => ({
    v: 2,
    name: "legacy_pair",
    key: { sample: 1, name: 1 },
    unique: true,
    ...extra,
  });

  test.each([
    ["bare unique", {}],
    ["background", { background: true }],
    ["storageEngine", { storageEngine: { wiredTiger: { configString: "x" } } }],
    ["hidden", { hidden: true }],
  ])("treats a custom-named unique index with %s as a conflict", (_, extra) => {
    expect(hasSameSignatureAsSchemaIndex(custom(extra), {})).toBe(true);
    expect(findIndexConflicts([custom(extra)])).toHaveLength(1);
  });

  test.each([
    ["sparse", { sparse: true }],
    ["collation", { collation: { locale: "en" } }],
    ["partialFilterExpression", { partialFilterExpression: { name: 1 } }],
  ])("leaves a custom-named unique index with %s alone", (_, extra) => {
    expect(hasSameSignatureAsSchemaIndex(custom(extra), {})).toBe(false);
    expect(findIndexConflicts([custom(extra)])).toEqual([]);
  });

  test("leaves a custom-named NON-unique index alone", () => {
    expect(
      hasSameSignatureAsSchemaIndex(
        { name: "legacy_pair", key: { sample: 1, name: 1 } },
        {},
      ),
    ).toBe(false);
  });
});

describe("collection-level index defaults", () => {
  // A collection created with a default collation stamps it onto EVERY index
  // it builds, including _id_ and including the perfectly healthy
  // sample_1_name_1 mongoose itself creates — verified, along with the fact
  // that Run.init() resolves happily against such a collection. Without this,
  // that healthy index was reported as a conflict and --fix would have
  // dropped and rebuilt it into the same state: a loop, on a collection that
  // was never broken.
  const collation = { locale: "en", strength: 3 };

  test("reads the defaults off _id_, which nothing configures per-index", () => {
    expect(
      collectionIndexDefaults([
        { name: "_id_", key: { _id: 1 }, collation },
        {
          name: INDEX_NAME,
          key: { sample: 1, name: 1 },
          unique: true,
          collation,
        },
      ]),
    ).toEqual({ collation });
  });

  test("reports no conflict for a healthy index carrying only the default", () => {
    expect(
      findIndexConflicts([
        { name: "_id_", key: { _id: 1 }, collation },
        {
          v: 2,
          name: INDEX_NAME,
          key: { sample: 1, name: 1 },
          unique: true,
          collation,
        },
      ]),
    ).toEqual([]);
  });

  test("does not mistake a different explicit collation for the collection default", () => {
    const differentCollation = { locale: "fr", strength: 2 };
    const custom = {
      v: 2,
      name: "legacy_pair",
      key: { sample: 1, name: 1 },
      unique: true,
      collation: differentCollation,
    };

    // MongoDB can build the schema's default-collation index alongside this
    // genuinely different custom index. Merely seeing that _id_ has *some*
    // collation must not turn every explicit collation into a default.
    expect(hasSameSignatureAsSchemaIndex(custom, { collation })).toBe(false);
    expect(
      findIndexConflicts([
        { name: "_id_", key: { _id: 1 }, collation },
        custom,
      ]),
    ).toEqual([]);
  });

  test("reports a same-name index whose explicit collation differs from the default", () => {
    expect(
      findIndexConflicts([
        { name: "_id_", key: { _id: 1 }, collation },
        {
          v: 2,
          name: INDEX_NAME,
          key: { sample: 1, name: 1 },
          unique: true,
          collation: { locale: "fr", strength: 2 },
        },
      ]),
    ).toHaveLength(1);
  });

  test("reports a same-name explicit-simple index when the collection default is non-simple", () => {
    // MongoDB omits `collation` from listIndexes for explicit simple. That
    // absence must NOT be mistaken for inheriting the collection's `en`
    // default: the schema's same-name create rejects this with error 86.
    expect(
      findIndexConflicts([
        { name: "_id_", key: { _id: 1 }, collation },
        {
          v: 2,
          name: INDEX_NAME,
          key: { sample: 1, name: 1 },
          unique: true,
        },
      ]),
    ).toHaveLength(1);
  });

  test("allows a custom-name explicit-simple index beside a non-simple default", () => {
    // The desired schema index inherits `en`; this existing index is
    // effectively simple, so MongoDB treats them as different and builds the
    // desired index alongside it.
    const customSimple = {
      v: 2,
      name: "legacy_simple",
      key: { sample: 1, name: 1 },
      unique: true,
    };
    expect(
      findIndexConflicts([
        { name: "_id_", key: { _id: 1 }, collation },
        customSimple,
      ]),
    ).toEqual([]);
  });

  test("matches collection defaults in both directions", () => {
    expect(
      expectedOptionMatches({ collation }, "collation", { collation }),
    ).toBe(true);
    expect(expectedOptionMatches({}, "collation", { collation })).toBe(false);
    expect(expectedOptionMatches({}, "collation", {})).toBe(true);
    expect(expectedOptionMatches({ collation }, "collation", {})).toBe(false);
  });

  test("still reports a collation set on ONE index, which _id_ does not share", () => {
    // The difference that matters: this one really is a different index.
    expect(
      findIndexConflicts([
        { name: "_id_", key: { _id: 1 } },
        {
          v: 2,
          name: INDEX_NAME,
          key: { sample: 1, name: 1 },
          unique: true,
          collation,
        },
      ]),
    ).toHaveLength(1);
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

  test("accepts hidden on the generated-name index", () => {
    // MongoDB 7 treats visibility as a planner setting, not a create-option
    // difference: the schema's same-name build is a no-op.
    expect(
      isEquivalentToSchemaIndex({
        name: "sample_1_name_1",
        key: { sample: 1, name: 1 },
        unique: true,
        hidden: true,
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
    // Wrapped, not replaced: the stand-in has to keep tracking state, or
    // fixStaleIndex's post-repair re-check sees a collection where the drop
    // never happened.
    const realDrop = collection.dropIndex.getMockImplementation();
    const realCreate = collection.createIndex.getMockImplementation();
    collection.dropIndex.mockImplementation(async (...args) => {
      order.push("drop");
      return realDrop(...args);
    });
    collection.createIndex.mockImplementation(async (...args) => {
      order.push("create");
      return realCreate(...args);
    });

    await fixStaleIndex(collection);

    expect(order).toEqual(["drop", "create"]);
  });

  test("reports the index list before and after, for the operator's record", async () => {
    const before = { name: "sample_1_name_1" };
    const collection = makeCollection([before]);

    await fixStaleIndex(collection);

    const logged = console.log.mock.calls
      .map((call) => call.join(" "))
      .join("\n");
    expect(logged).toContain("Before:");
    expect(logged).toContain("After:");
    // The stale index as it was, then the rebuilt one — read back from a
    // stand-in that actually applied the drop and the create, so this shows
    // the repair rather than two hard-coded lists.
    expect(logged).toContain(JSON.stringify([before], null, 2));
    expect(logged).toContain(
      JSON.stringify(
        [{ v: 2, key: { sample: 1, name: 1 }, name: INDEX_NAME, unique: true }],
        null,
        2,
      ),
    );
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
    const loggedError = errorSpy.mock.calls
      .map((call) => call.join(" "))
      .join("\n");
    expect(loggedError).toMatch(/no index/i);
    expect(loggedError).toMatch(/enforcing/i);
  });
});
