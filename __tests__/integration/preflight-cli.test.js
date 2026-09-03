/**
 * Executes the deployment preflight itself against real MongoDB, then issues
 * the exact unique createIndex request declared by Run's schema. Encoding an
 * expected CLI exit without asking the server the same question is how
 * several false-safe release gates survived.
 */

const { spawn } = require("child_process");
const path = require("path");
const { configureEnv, restoreEnv } = require("./support/env");
const rootMongo = require("./support/mongo");

let envHandle;

beforeAll(async () => {
  envHandle = await configureEnv("preflight-cli");
  await rootMongo.connect();
});

afterAll(async () => {
  await rootMongo.disconnect();
  await restoreEnv(envHandle);
});

beforeEach(async () => {
  await rootMongo.dropDatabase();
});

const runPreflight = (...args) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "../../scripts/check-run-duplicates.js"), ...args],
      {
        cwd: path.join(__dirname, "../.."),
        env: { ...process.env },
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
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

const createSchemaIndex = () =>
  rootMongo.mongoose.connection.db.collection("runs").createIndex(
    { sample: 1, name: 1 },
    {
      name: "sample_1_name_1",
      unique: true,
    },
  );

const expectSchemaIndexRefused = async (...codes) => {
  let refusal;
  try {
    await createSchemaIndex();
  } catch (err) {
    refusal = err;
  }

  expect(refusal).toBeDefined();
  expect(codes).toContain(refusal.code);
};

// mongodb 3.7's createIndex helper silently drops `hidden`. The raw command
// is the only way this test can establish the actual server state it claims.
const createRawIndex = async (options) => {
  const db = rootMongo.mongoose.connection.db;
  const existing = await db
    .listCollections({ name: "runs" }, { nameOnly: true })
    .toArray();
  if (existing.length === 0) {
    await db.createCollection("runs");
  }
  await db.command({
    createIndexes: "runs",
    indexes: [
      {
        key: { sample: 1, name: 1 },
        ...options,
      },
    ],
  });
};

describe("check-run-duplicates CLI", () => {
  test("treats a fresh database with no runs collection as safe", async () => {
    const result = await runPreflight();

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/does not exist yet/i);
    expect(result.stdout).toMatch(/Safe to deploy/i);
    expect(result.stderr).toBe("");
    await expect(createSchemaIndex()).resolves.toBe("sample_1_name_1");
  });

  test("refuses array-valued indexed fields that hide a multikey collision", async () => {
    const runs = rootMongo.mongoose.connection.db.collection("runs");
    await runs.insertMany([
      { sample: ["a", "b"], name: "Run" },
      { sample: ["b", "c"], name: "Run" },
    ]);

    const result = await runPreflight();

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/violate the Run schema/i);
    expect(result.stdout).not.toMatch(/Safe to deploy/i);
    expect(result.stderr).toBe("");
    await expectSchemaIndexRefused(11000);
  });

  test("allows a custom index with a collation different from the collection default", async () => {
    const db = rootMongo.mongoose.connection.db;
    await db.createCollection("runs", {
      collation: { locale: "en", strength: 2 },
    });
    await db.collection("runs").createIndex(
      { sample: 1, name: 1 },
      {
        name: "legacy_french_pair",
        unique: true,
        collation: { locale: "fr", strength: 2 },
      },
    );

    const result = await runPreflight();

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Safe to deploy/i);
    expect(result.stderr).toBe("");
    await expect(createSchemaIndex()).resolves.toBe("sample_1_name_1");
  });

  test("accepts the generated unique index with an inherited collection collation", async () => {
    const db = rootMongo.mongoose.connection.db;
    await db.createCollection("runs", {
      collation: { locale: "en", strength: 2 },
    });
    await db
      .collection("runs")
      .createIndex(
        { sample: 1, name: 1 },
        { name: "sample_1_name_1", unique: true },
      );

    const result = await runPreflight();

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Safe to deploy/i);
    expect(result.stderr).toBe("");
    await expect(createSchemaIndex()).resolves.toBe("sample_1_name_1");
  });

  test("flags a generated-name explicit-simple index under a non-simple collection default", async () => {
    const db = rootMongo.mongoose.connection.db;
    await db.createCollection("runs", {
      collation: { locale: "en", strength: 2 },
    });
    await db.collection("runs").createIndex(
      { sample: 1, name: 1 },
      {
        name: "sample_1_name_1",
        unique: true,
        collation: { locale: "simple" },
      },
    );
    const listed = (await db.collection("runs").indexes()).find(
      (index) => index.name === "sample_1_name_1",
    );
    expect(listed.collation).toBeUndefined();

    const result = await runPreflight();

    expect(result.code).toBe(3);
    expect(result.stdout).toMatch(/will stop the unique/i);
    expect(result.stderr).toBe("");
    await expectSchemaIndexRefused(86);
  });

  test("allows a custom-name explicit-simple index under a non-simple collection default", async () => {
    const db = rootMongo.mongoose.connection.db;
    await db.createCollection("runs", {
      collation: { locale: "en", strength: 2 },
    });
    await db.collection("runs").createIndex(
      { sample: 1, name: 1 },
      {
        name: "legacy_simple_pair",
        unique: true,
        collation: { locale: "simple" },
      },
    );

    const result = await runPreflight();

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Safe to deploy/i);
    expect(result.stderr).toBe("");
    await expect(createSchemaIndex()).resolves.toBe("sample_1_name_1");
  });

  test("flags a custom-name index that inherits the collection default", async () => {
    const db = rootMongo.mongoose.connection.db;
    await db.createCollection("runs", {
      collation: { locale: "en", strength: 2 },
    });
    await db
      .collection("runs")
      .createIndex(
        { sample: 1, name: 1 },
        { name: "legacy_inherited_pair", unique: true },
      );

    const result = await runPreflight();

    expect(result.code).toBe(3);
    expect(result.stdout).toMatch(/will stop the unique/i);
    expect(result.stderr).toBe("");
    await expectSchemaIndexRefused(85);
  });

  test("accepts a generated-name hidden index and proves the hidden setup", async () => {
    await createRawIndex({
      name: "sample_1_name_1",
      unique: true,
      hidden: true,
    });
    const listed = (
      await rootMongo.mongoose.connection.db.collection("runs").indexes()
    ).find((index) => index.name === "sample_1_name_1");
    expect(listed.hidden).toBe(true);

    const result = await runPreflight();

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Safe to deploy/i);
    expect(result.stderr).toBe("");
    await expect(createSchemaIndex()).resolves.toBe("sample_1_name_1");
  });

  test.each([
    ["bare equivalent", {}],
    [
      "storage-engine option",
      {
        storageEngine: {
          wiredTiger: { configString: "block_compressor=zlib" },
        },
      },
    ],
  ])(
    "flags a custom-named %s index that Run.init would refuse",
    async (_label, options) => {
      const runs = rootMongo.mongoose.connection.db.collection("runs");
      await runs.createIndex(
        { sample: 1, name: 1 },
        { name: "legacy_unique_pair", unique: true, ...options },
      );

      const result = await runPreflight();

      expect(result.code).toBe(3);
      expect(result.stdout).toMatch(/will stop the unique/i);
      expect(result.stdout).not.toMatch(/Safe to deploy/i);
      expect(result.stderr).toBe("");
      await expectSchemaIndexRefused(85);
    },
  );

  test("flags a custom-name raw hidden index that the server treats as equivalent", async () => {
    await createRawIndex({
      name: "legacy_hidden_pair",
      unique: true,
      hidden: true,
    });
    const listed = (
      await rootMongo.mongoose.connection.db.collection("runs").indexes()
    ).find((index) => index.name === "legacy_hidden_pair");
    expect(listed.hidden).toBe(true);

    const result = await runPreflight();

    expect(result.code).toBe(3);
    expect(result.stdout).toMatch(/will stop the unique/i);
    expect(result.stderr).toBe("");
    await expectSchemaIndexRefused(85);
  });

  test.each([
    ["non-unique", {}],
    ["sparse", { unique: true, sparse: true }],
    [
      "partial",
      {
        unique: true,
        partialFilterExpression: { name: { $type: "string" } },
      },
    ],
  ])(
    "allows a custom-named %s same-key index to coexist",
    async (_label, options) => {
      const runs = rootMongo.mongoose.connection.db.collection("runs");
      await runs.createIndex(
        { sample: 1, name: 1 },
        { name: "different_pair_index", ...options },
      );

      const result = await runPreflight();

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/Safe to deploy/i);
      expect(result.stderr).toBe("");
      await expect(createSchemaIndex()).resolves.toBe("sample_1_name_1");
    },
  );

  test("--fix repairs a custom-named equivalent index end to end", async () => {
    const runs = rootMongo.mongoose.connection.db.collection("runs");
    await runs.createIndex(
      { sample: 1, name: 1 },
      { name: "legacy_unique_pair", unique: true },
    );

    const result = await runPreflight("--fix");
    const indexes = await runs.indexes();

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Fixed/i);
    expect(result.stderr).toBe("");
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "sample_1_name_1",
          key: { sample: 1, name: 1 },
          unique: true,
        }),
      ]),
    );
    expect(indexes.some((index) => index.name === "legacy_unique_pair")).toBe(
      false,
    );
    await expect(createSchemaIndex()).resolves.toBe("sample_1_name_1");
  });
});
