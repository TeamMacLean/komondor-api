const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { crc64Nvme } = require("../../../lib/utils/crc64nvme");
const {
  compareTreeToManifest,
  createInventory,
  normalizedRelativePath,
  snapshotDifference,
  walkTree,
} = require("../../../lib/s3-archive/inventory");

const fsp = fs.promises;

describe("S3 archive filesystem inventory", () => {
  let root;

  beforeEach(async () => {
    root = await fsp.realpath(
      await fsp.mkdtemp(path.join(os.tmpdir(), "komondor-s3-inventory-")),
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsp.rm(root, { recursive: true, force: true });
  });

  test("includes hidden and untracked files and hashes their exact bytes", async () => {
    await fsp.mkdir(path.join(root, ".metadata"));
    await fsp.mkdir(path.join(root, "empty"));
    await fsp.writeFile(path.join(root, ".metadata", "state.json"), "hidden");
    await fsp.writeFile(path.join(root, "not-in-database.txt"), "untracked");

    const inventory = await createInventory(root);
    const byPath = new Map(
      inventory.entries.map((entry) => [entry.relPath, entry]),
    );

    expect([...byPath.keys()]).toEqual([
      ".metadata",
      ".metadata/state.json",
      "empty",
      "not-in-database.txt",
    ]);
    expect(byPath.get(".metadata/state.json")).toMatchObject({
      type: "file",
      disposition: "copy",
      size: 6,
      sha256: crypto.createHash("sha256").update("hidden").digest("hex"),
      crc64nvme: crc64Nvme("hidden"),
    });
    expect(byPath.get("not-in-database.txt")).toMatchObject({
      type: "file",
      disposition: "copy",
      size: 9,
    });
    expect(byPath.get("empty")).toMatchObject({ type: "dir", empty: true });
    expect(inventory.hpcSnapshot).toEqual({ dirCount: 3, entryCount: 4 });
  });

  test("records symlinks without following or hashing their targets", async () => {
    const outside = await fsp.mkdtemp(
      path.join(os.tmpdir(), "komondor-s3-outside-"),
    );
    const target = path.join(outside, "secret.txt");
    await fsp.writeFile(target, "must not be archived");
    await fsp.symlink(target, path.join(root, "external-link"));

    try {
      const inventory = await createInventory(root);

      expect(inventory.entries).toHaveLength(1);
      expect(inventory.entries[0]).toMatchObject({
        relPath: "external-link",
        type: "symlink",
        disposition: "skip",
        linkTarget: target,
      });
      expect(inventory.entries[0]).not.toHaveProperty("sha256");
      expect(
        inventory.entries.some((entry) => entry.relPath.includes("secret")),
      ).toBe(false);
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });

  test("uses no-follow open semantics if a regular file becomes a symlink", async () => {
    const victim = path.join(root, "victim.fastq");
    const original = path.join(root, "original.fastq");
    const outside = await fsp.mkdtemp(
      path.join(os.tmpdir(), "komondor-s3-race-"),
    );
    const outsideFile = path.join(outside, "different.fastq");
    await fsp.writeFile(victim, "expected bytes");
    await fsp.writeFile(outsideFile, "different bytes");

    const realOpen = fsp.open.bind(fsp);
    let replaced = false;
    jest.spyOn(fsp, "open").mockImplementation(async (filename, ...args) => {
      if (filename === victim && !replaced) {
        replaced = true;
        await fsp.rename(victim, original);
        await fsp.symlink(outsideFile, victim);
      }
      return realOpen(filename, ...args);
    });

    try {
      await expect(createInventory(root)).rejects.toThrow(
        /Cannot safely read victim\.fastq/,
      );
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });

  test("refuses an in-progress transfer marker", async () => {
    await fsp.writeFile(
      path.join(root, "reads.fastq.part-0123456789abcdef01234567"),
      "partial",
    );

    await expect(createInventory(root)).rejects.toThrow(
      /Partial transfer blocks archival/,
    );
  });

  test("does not mistake an ordinary filename containing .part- for a marker", async () => {
    await fsp.writeFile(path.join(root, "assembly.part-2.bam"), "complete");

    await expect(createInventory(root)).resolves.toMatchObject({
      entries: [expect.objectContaining({ relPath: "assembly.part-2.bam" })],
    });
  });

  test("refuses a source tree that changes between inventory passes", async () => {
    await fsp.writeFile(path.join(root, "stable.txt"), "stable");
    const realOpenDir = fsp.opendir.bind(fsp);
    let calls = 0;
    jest.spyOn(fsp, "opendir").mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) {
        await fsp.writeFile(
          path.join(root, "arrived-during-inventory.txt"),
          "new",
        );
      }
      return realOpenDir(...args);
    });

    await expect(createInventory(root)).rejects.toMatchObject({
      name: "ArchiveRefusalError",
      message: expect.stringMatching(/changed during inventory/),
      details: {
        differences: [
          { relPath: "arrived-during-inventory.txt", change: "added" },
        ],
      },
    });
  });

  test("accepts an exact exclusion only when that regular file cannot be read", async () => {
    const unreadable = path.join(root, "damaged.fastq");
    await fsp.writeFile(unreadable, "bytes");
    const realOpen = fsp.open.bind(fsp);
    jest.spyOn(fsp, "open").mockImplementation(async (filename, ...args) => {
      if (filename === unreadable) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }
      return realOpen(filename, ...args);
    });

    const inventory = await createInventory(root, {
      exclusions: new Map([
        [
          "damaged.fastq",
          { by: "operator", reason: "unrecoverable tape error" },
        ],
      ]),
    });

    expect(inventory.entries[0]).toMatchObject({
      relPath: "damaged.fastq",
      type: "file",
      disposition: "excluded",
      excludedBy: "operator",
      excludedReason: "unrecoverable tape error",
      readError: expect.stringMatching(/^EACCES:/),
    });
    expect(inventory.entries[0]).not.toHaveProperty("sha256");
  });

  test("accepts an exclusion when an opened file fails during streaming", async () => {
    const unreadable = path.join(root, "damaged-after-open.fastq");
    await fsp.writeFile(unreadable, "bytes");
    const realOpen = fsp.open.bind(fsp);
    jest.spyOn(fsp, "open").mockImplementation(async (filename, ...args) => {
      const handle = await realOpen(filename, ...args);
      if (filename === unreadable) {
        handle.createReadStream = () => {
          const { Readable } = require("stream");
          return new Readable({
            read() {
              this.destroy(
                Object.assign(new Error("media read failed"), { code: "EIO" }),
              );
            },
          });
        };
      }
      return handle;
    });

    const inventory = await createInventory(root, {
      exclusions: new Map([
        [
          "damaged-after-open.fastq",
          { by: "operator", reason: "documented media failure" },
        ],
      ]),
    });

    expect(inventory.entries[0]).toMatchObject({
      disposition: "excluded",
      excludedBy: "operator",
      excludedReason: "documented media failure",
      readError: expect.stringMatching(/^EIO:/),
    });
  });

  test("refuses exclusions for readable or nonexistent entries", async () => {
    await fsp.writeFile(path.join(root, "readable.fastq"), "bytes");

    await expect(
      createInventory(root, {
        exclusions: new Map([
          ["readable.fastq", { by: "operator", reason: "not wanted" }],
        ]),
      }),
    ).rejects.toThrow(/Refusing --exclude-entry for readable file/);

    await expect(
      createInventory(root, {
        exclusions: new Map([
          ["absent.fastq", { by: "operator", reason: "missing" }],
        ]),
      }),
    ).rejects.toThrow(/does not exist/);
  });

  test("compares a later tree to the sealed manifest metadata", async () => {
    await fsp.writeFile(path.join(root, "reads.fastq"), "ACGT");
    const inventory = await createInventory(root);

    await expect(
      compareTreeToManifest(root, inventory.entries),
    ).resolves.toMatchObject({
      matches: true,
      differences: [],
    });

    await fsp.writeFile(path.join(root, "unexpected.txt"), "extra");
    const comparison = await compareTreeToManifest(root, inventory.entries);

    expect(comparison.matches).toBe(false);
    expect(comparison.differences).toContainEqual({
      relPath: "unexpected.txt",
      change: "added",
    });
  });

  test("tolerates a changed device number against the sealed manifest but not a changed inode", async () => {
    await fsp.writeFile(path.join(root, "reads.fastq"), "ACGT");
    const inventory = await createInventory(root);

    // A remount or reboot re-assigns st_dev on a network mount; the file is
    // unchanged, so a sealed manifest recorded days earlier must still match.
    const remounted = inventory.entries.map((entry) => ({
      ...entry,
      dev: entry.dev + 1,
    }));
    await expect(compareTreeToManifest(root, remounted)).resolves.toMatchObject(
      {
        matches: true,
        differences: [],
      },
    );

    // A replaced file gets a new inode, which is still a difference.
    const replaced = inventory.entries.map((entry) =>
      entry.type === "file" ? { ...entry, ino: entry.ino + 1 } : entry,
    );
    const comparison = await compareTreeToManifest(root, replaced);
    expect(comparison.matches).toBe(false);
    expect(comparison.differences).toContainEqual({
      relPath: "reads.fastq",
      change: "changed",
      fields: ["ino"],
    });
  });

  test("normalises safe names and reports stable snapshot differences", () => {
    expect(normalizedRelativePath(path.join("sample", "reads.fastq"))).toBe(
      "sample/reads.fastq",
    );
    expect(() => normalizedRelativePath("../outside")).toThrow(/Unsafe/);
    expect(
      snapshotDifference(
        [{ relPath: "one", type: "file", size: 1 }],
        [{ relPath: "one", type: "file", size: 2 }],
      ),
    ).toEqual([{ relPath: "one", change: "changed", fields: ["size"] }]);
  });

  test("walkTree marks hard links but still inventories each pathname", async () => {
    const first = path.join(root, "first.fastq");
    const second = path.join(root, "second.fastq");
    await fsp.writeFile(first, "same inode");
    await fsp.link(first, second);

    const tree = await walkTree(root);

    expect(tree.entries.map((item) => item.relPath)).toEqual([
      "first.fastq",
      "second.fastq",
    ]);
    expect(tree.entries[0].hardLinkGroup).toBeTruthy();
    expect(tree.entries[1].hardLinkGroup).toBe(tree.entries[0].hardLinkGroup);
  });
});
