/**
 * Tests for lib/upload-quota.js — the admission control in front of the tus
 * upload mount.
 *
 * The failures that matter are in both directions: a limit that does not bite
 * leaves the disk fillable by anyone with an account, and a limit that bites
 * when it should not refuses a legitimate 30 GB read set with a 429.
 */

const fs = require("fs");
const os = require("os");
const _path = require("path");

const {
  getLimits,
  getFreeBytes,
  getUserUsage,
  checkUploadAllowed,
  registerUpload,
  touchUpload,
  releaseUpload,
  getUploadRecord,
  listUploads,
  isUploadOwner,
  getRecordedOwner,
  pruneIdleUploads,
  cleanupAbandonedUploads,
  clearUploads,
  assertUploadComplete,
  recoverUploadReservations,
} = require("../../lib/upload-quota");

const GIB = 1024 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;

const QUOTA_ENV = [
  "UPLOAD_MAX_BYTES",
  "UPLOAD_MAX_CONCURRENT_PER_USER",
  "UPLOAD_MAX_INFLIGHT_BYTES_PER_USER",
  "UPLOAD_MIN_FREE_BYTES",
  "UPLOAD_IDLE_MINUTES",
  "UPLOAD_ABANDONED_HOURS",
];

const ORIGINAL_ENV = {};

let tmpRoot;

beforeAll(() => {
  QUOTA_ENV.forEach((name) => {
    ORIGINAL_ENV[name] = process.env[name];
  });
  tmpRoot = fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-quota-"));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  clearUploads();
  QUOTA_ENV.forEach((name) => delete process.env[name]);

  // The free-space floor defaults to 5 GiB, and getFreeBytes measures the REAL
  // disk. Left at its default, every test here passes or fails depending on how
  // much space the machine happens to have — which is how the whole suite came
  // to fail on a host sitting at 4.4 GB free. Neutralise it by default; the two
  // tests that are actually about free space raise it themselves.
  process.env.UPLOAD_MIN_FREE_BYTES = "0";

  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  QUOTA_ENV.forEach((name) => {
    if (ORIGINAL_ENV[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = ORIGINAL_ENV[name];
    }
  });
});

describe("getLimits", () => {
  test("falls back to defaults sized for sequencing data", () => {
    // beforeEach pins this to 0 so unrelated tests do not read the real disk;
    // the default is exactly what this test is about, so clear it again.
    delete process.env.UPLOAD_MIN_FREE_BYTES;

    const limits = getLimits();

    expect(limits.maxUploadBytes).toBe(50 * GIB);
    expect(limits.maxConcurrentPerUser).toBe(10);
    expect(limits.minFreeBytes).toBe(5 * GIB);
    expect(limits.abandonedMs).toBe(48 * HOUR);
  });

  test("reads each limit from the environment", () => {
    process.env.UPLOAD_MAX_BYTES = "1024";
    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "2";
    process.env.UPLOAD_ABANDONED_HOURS = "6";

    const limits = getLimits();

    expect(limits.maxUploadBytes).toBe(1024);
    expect(limits.maxConcurrentPerUser).toBe(2);
    expect(limits.abandonedMs).toBe(6 * HOUR);
  });

  test("keeps the default when a value is unusable, and says so", () => {
    // Silently reading "10 GB" as 0 would refuse every upload, and the 413s
    // would be blamed on the client.
    process.env.UPLOAD_MAX_BYTES = "10 GB";

    expect(getLimits().maxUploadBytes).toBe(50 * GIB);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("UPLOAD_MAX_BYTES"),
    );
  });

  test("picks up a limit changed after the module was loaded", () => {
    expect(getLimits().maxConcurrentPerUser).toBe(10);

    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "3";

    expect(getLimits().maxConcurrentPerUser).toBe(3);
  });
});

describe("the register", () => {
  test("totals a user's open uploads and bytes", () => {
    registerUpload({ id: "a", username: "alice", size: 100 });
    registerUpload({ id: "b", username: "alice", size: 250 });
    registerUpload({ id: "c", username: "bob", size: 900 });

    expect(getUserUsage("alice")).toEqual({ count: 2, bytes: 350 });
    expect(getUserUsage("bob")).toEqual({ count: 1, bytes: 900 });
    expect(getUserUsage("nobody")).toEqual({ count: 0, bytes: 0 });
  });

  test("charges an upload of unknown length the per-upload maximum", () => {
    // Otherwise "declare no length" is the way around the byte cap.
    process.env.UPLOAD_MAX_BYTES = "5000";

    registerUpload({ id: "a", username: "alice" });

    expect(getUserUsage("alice")).toEqual({ count: 1, bytes: 5000 });
  });

  test("releases a slot, and tolerates an id it never had", () => {
    registerUpload({ id: "a", username: "alice", size: 10 });

    expect(releaseUpload("a")).toBe(true);
    expect(releaseUpload("a")).toBe(false);
    expect(listUploads()).toEqual([]);
  });

  test("drops registrations that have gone quiet", () => {
    const now = Date.now();
    registerUpload({
      id: "old",
      username: "alice",
      size: 10,
      now: now - 2 * HOUR,
    });
    registerUpload({ id: "new", username: "alice", size: 10, now });

    expect(pruneIdleUploads(now)).toEqual(["old"]);
    expect(getUploadRecord("new")).toBeDefined();
  });

  test("a touched upload survives the idle sweep", () => {
    const now = Date.now();
    registerUpload({
      id: "a",
      username: "alice",
      size: 10,
      now: now - 2 * HOUR,
    });

    expect(touchUpload("a", now)).toBe(true);
    expect(pruneIdleUploads(now)).toEqual([]);
  });

  test("touching an unknown upload reports that there was nothing to touch", () => {
    expect(touchUpload("missing")).toBe(false);
  });
});

describe("checkUploadAllowed", () => {
  const directory = () => tmpRoot;

  test("admits an upload that is within every limit", async () => {
    const decision = await checkUploadAllowed({
      id: "a".repeat(32),
      username: "alice",
      size: 1024,
      directory: directory(),
    });

    expect(decision).toEqual({ allowed: true });
  });

  test("refuses a request with no authenticated user", async () => {
    const decision = await checkUploadAllowed({
      id: "a".repeat(32),
      username: undefined,
      size: 1,
      directory: directory(),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("refuses a file larger than the per-upload maximum with 413", async () => {
    process.env.UPLOAD_MAX_BYTES = "1000";

    const decision = await checkUploadAllowed({
      id: "a".repeat(32),
      username: "alice",
      size: 1001,
      directory: directory(),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe(413);
    expect(decision.error).toContain("exceeds the maximum upload size");
  });

  test("refuses too many concurrent uploads with 429", async () => {
    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "2";
    registerUpload({ id: "a", username: "alice", size: 1 });
    registerUpload({ id: "b", username: "alice", size: 1 });

    const decision = await checkUploadAllowed({
      id: "a".repeat(32),
      username: "alice",
      size: 1,
      directory: directory(),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe(429);
  });

  test("counts only the requesting user against the concurrency cap", async () => {
    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "2";
    registerUpload({ id: "a", username: "bob", size: 1 });
    registerUpload({ id: "b", username: "bob", size: 1 });

    const decision = await checkUploadAllowed({
      id: "a".repeat(32),
      username: "alice",
      size: 1,
      directory: directory(),
    });

    expect(decision.allowed).toBe(true);
  });

  test("refuses more in-flight bytes than a user may hold with 429", async () => {
    process.env.UPLOAD_MAX_INFLIGHT_BYTES_PER_USER = "1000";
    registerUpload({ id: "a", username: "alice", size: 900 });

    const decision = await checkUploadAllowed({
      id: "a".repeat(32),
      username: "alice",
      size: 200,
      directory: directory(),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe(429);
    expect(decision.error).toContain("bytes of uploads in progress");
  });

  test("lets a user back in once an abandoned slot goes idle", async () => {
    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "1";
    process.env.UPLOAD_IDLE_MINUTES = "30";
    const now = Date.now();
    registerUpload({
      id: "dropped",
      username: "alice",
      size: 1,
      now: now - 2 * HOUR,
    });

    const decision = await checkUploadAllowed({
      id: "a".repeat(32),
      username: "alice",
      size: 1,
      directory: directory(),
      now,
    });

    expect(decision.allowed).toBe(true);
    expect(getUploadRecord("dropped")).toBeUndefined();
  });

  test("refuses an upload that would eat the disk headroom with 507", async () => {
    process.env.UPLOAD_MIN_FREE_BYTES = String(Number.MAX_SAFE_INTEGER);

    const decision = await checkUploadAllowed({
      id: "a".repeat(32),
      username: "alice",
      size: 1,
      directory: directory(),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe(507);
    expect(decision.error).toContain("free space");
  });

  test("admits an upload when free space cannot be measured", async () => {
    // "Cannot measure" must not mean "no space": that would refuse every
    // upload on any platform without statfs.
    const decision = await checkUploadAllowed({
      id: "a".repeat(32),
      username: "alice",
      size: 1,
      directory: _path.join(tmpRoot, "does-not-exist"),
    });

    expect(decision.allowed).toBe(true);
  });
});

describe("checkUploadAllowed — admission is atomic", () => {
  /** Fires `count` admission requests for one user without awaiting between. */
  const admitTogether = (count, { username = "alice", size = 1 } = {}) =>
    Promise.all(
      Array.from({ length: count }, (_unused, index) =>
        checkUploadAllowed({
          id: String(index).padStart(32, "0"),
          username,
          size,
          directory: tmpRoot,
        }),
      ),
    );

  test("registers the upload itself, so the caller cannot leave a gap", async () => {
    await checkUploadAllowed({
      id: "b".repeat(32),
      username: "alice",
      size: 512,
      directory: tmpRoot,
    });

    expect(getUserUsage("alice")).toEqual({ count: 1, bytes: 512 });
  });

  test("holds the concurrency cap against requests that arrive together", async () => {
    // The check used to await the free-space probe before the caller
    // registered anything, so every one of these saw a usage of zero.
    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "3";

    const decisions = await admitTogether(20);

    expect(decisions.filter((d) => d.allowed)).toHaveLength(3);
    expect(getUserUsage("alice").count).toBe(3);
    decisions
      .filter((d) => !d.allowed)
      .forEach((d) => expect(d.status).toBe(429));
  });

  test("holds the in-flight byte cap against requests that arrive together", async () => {
    process.env.UPLOAD_MAX_INFLIGHT_BYTES_PER_USER = "1000";
    process.env.UPLOAD_MAX_CONCURRENT_PER_USER = "1000";

    const decisions = await admitTogether(20, { size: 400 });

    expect(decisions.filter((d) => d.allowed)).toHaveLength(2);
    expect(getUserUsage("alice").bytes).toBe(800);
  });

  test("releases the reservation when the disk check refuses the upload", async () => {
    // Otherwise a full volume would permanently consume the user's slots.
    process.env.UPLOAD_MIN_FREE_BYTES = String(Number.MAX_SAFE_INTEGER);

    const decision = await checkUploadAllowed({
      id: "c".repeat(32),
      username: "alice",
      size: 1,
      directory: tmpRoot,
    });

    expect(decision.status).toBe(507);
    expect(getUserUsage("alice")).toEqual({ count: 0, bytes: 0 });
    expect(getUploadRecord("c".repeat(32))).toBeUndefined();
  });

  test("reserves nothing when the request is refused before admission", async () => {
    process.env.UPLOAD_MAX_BYTES = "10";

    await checkUploadAllowed({
      id: "d".repeat(32),
      username: "alice",
      size: 11,
      directory: tmpRoot,
    });

    expect(getUserUsage("alice")).toEqual({ count: 0, bytes: 0 });
  });

  test("refuses an admission request that names no upload", async () => {
    // Nothing to reserve the slot under; falling back to approving it
    // unreserved is the behaviour that made the caps advisory.
    jest.spyOn(console, "error").mockImplementation(() => {});

    const decision = await checkUploadAllowed({
      username: "alice",
      size: 1,
      directory: tmpRoot,
    });

    expect(decision.allowed).toBe(false);
    expect(getUserUsage("alice")).toEqual({ count: 0, bytes: 0 });
  });
});

describe("getFreeBytes", () => {
  test("reports free space on a real directory", async () => {
    expect(await getFreeBytes(tmpRoot)).toBeGreaterThan(0);
  });

  test("reports null rather than throwing on an unreadable path", async () => {
    expect(await getFreeBytes(_path.join(tmpRoot, "nope"))).toBeNull();
  });
});

describe("isUploadOwner", () => {
  test("accepts only the exact owner", () => {
    expect(isUploadOwner("alice", "alice")).toBe(true);
    expect(isUploadOwner("alice", "bob")).toBe(false);
  });

  test("refuses an upload with no recorded owner", () => {
    // Every upload the unauthenticated mount accepted looks like this.
    expect(isUploadOwner(null, "alice")).toBe(false);
    expect(isUploadOwner(undefined, "alice")).toBe(false);
    expect(isUploadOwner("", "")).toBe(false);
  });

  test("refuses an unauthenticated caller", () => {
    expect(isUploadOwner("alice", undefined)).toBe(false);
  });
});

describe("cleanupAbandonedUploads", () => {
  let sweepDir;
  const ID_A = "a".repeat(32);
  const ID_B = "b".repeat(32);
  const ID_C = "c".repeat(32);

  const writeUpload = (id, info, bytes = "") => {
    fs.writeFileSync(_path.join(sweepDir, id), bytes);
    if (info !== null) {
      fs.writeFileSync(
        _path.join(sweepDir, `${id}.json`),
        JSON.stringify({ id, ...info }),
      );
    }
  };

  beforeEach(() => {
    sweepDir = fs.mkdtempSync(_path.join(tmpRoot, "sweep-"));
  });

  test("removes an upload that was started and never finished", async () => {
    writeUpload(ID_A, { size: 100, offset: 10 });

    const result = await cleanupAbandonedUploads({
      directory: sweepDir,
      now: Date.now() + 100 * HOUR,
    });

    expect(result.removed).toEqual([ID_A]);
    expect(fs.existsSync(_path.join(sweepDir, ID_A))).toBe(false);
    expect(fs.existsSync(_path.join(sweepDir, `${ID_A}.json`))).toBe(false);
  });

  test("frees the register entry for anything it removes", async () => {
    writeUpload(ID_A, { size: 100, offset: 10 });
    registerUpload({ id: ID_A, username: "alice", size: 100 });

    await cleanupAbandonedUploads({
      directory: sweepDir,
      now: Date.now() + 100 * HOUR,
    });

    expect(getUploadRecord(ID_A)).toBeUndefined();
  });

  test("leaves an upload that is still within the abandonment window", async () => {
    writeUpload(ID_A, { size: 100, offset: 10 });

    const result = await cleanupAbandonedUploads({
      directory: sweepDir,
      now: Date.now(),
    });

    expect(result.removed).toEqual([]);
    expect(fs.existsSync(_path.join(sweepDir, ID_A))).toBe(true);
  });

  test("keeps a finished upload and reports it instead", async () => {
    // A finished upload is a file the user has not yet attached to a project.
    // Deleting it destroys data they still expect to find.
    writeUpload(ID_B, { size: 4, offset: 4 }, "ACGT");

    const result = await cleanupAbandonedUploads({
      directory: sweepDir,
      now: Date.now() + 100 * HOUR,
    });

    expect(result.completed).toEqual([ID_B]);
    expect(result.removed).toEqual([]);
    expect(fs.existsSync(_path.join(sweepDir, ID_B))).toBe(true);
  });

  test("removes a finished upload only when explicitly asked", async () => {
    writeUpload(ID_B, { size: 4, offset: 4 }, "ACGT");

    const result = await cleanupAbandonedUploads({
      directory: sweepDir,
      now: Date.now() + 100 * HOUR,
      includeCompleted: true,
    });

    expect(result.removed).toEqual([ID_B]);
    expect(fs.existsSync(_path.join(sweepDir, ID_B))).toBe(false);
  });

  test("reports a blob with no sidecar rather than deleting it", async () => {
    // Uploads the old server accepted kept their metadata outside the upload
    // directory, so every one of them looks like this.
    writeUpload(ID_C, null, "orphaned");

    const result = await cleanupAbandonedUploads({
      directory: sweepDir,
      now: Date.now() + 100 * HOUR,
    });

    expect(result.orphans).toEqual([ID_C]);
    expect(result.removed).toEqual([]);
    expect(fs.existsSync(_path.join(sweepDir, ID_C))).toBe(true);
  });

  test("removes an orphan when explicitly asked", async () => {
    writeUpload(ID_C, null, "orphaned");

    const result = await cleanupAbandonedUploads({
      directory: sweepDir,
      now: Date.now() + 100 * HOUR,
      includeOrphans: true,
    });

    expect(result.removed).toEqual([ID_C]);
    expect(fs.existsSync(_path.join(sweepDir, ID_C))).toBe(false);
  });

  test("never touches a file that is not named like an upload", async () => {
    fs.writeFileSync(_path.join(sweepDir, "notes.txt"), "operator notes");

    const result = await cleanupAbandonedUploads({
      directory: sweepDir,
      now: Date.now() + 100 * HOUR,
      includeOrphans: true,
    });

    expect(result.removed).toEqual([]);
    expect(fs.existsSync(_path.join(sweepDir, "notes.txt"))).toBe(true);
  });

  test("reports a missing directory instead of throwing", async () => {
    const result = await cleanupAbandonedUploads({
      directory: _path.join(sweepDir, "gone"),
    });

    expect(result.errors).toHaveLength(1);
    expect(result.removed).toEqual([]);
  });

  describe("sidecars left behind by a claimed upload", () => {
    test("removes a sidecar whose blob is gone", async () => {
      // What lib/file-utils.js leaves: it hard-links the blob into the
      // datastore and unlinks it, and nothing ever removed the '<id>.json'.
      fs.writeFileSync(
        _path.join(sweepDir, `${ID_A}.json`),
        JSON.stringify({ id: ID_A, size: 4, offset: 4 }),
      );

      const result = await cleanupAbandonedUploads({
        directory: sweepDir,
        now: Date.now() + 100 * HOUR,
      });

      expect(result.sidecars).toEqual([`${ID_A}.json`]);
      expect(fs.existsSync(_path.join(sweepDir, `${ID_A}.json`))).toBe(false);
    });

    test("frees the register entry for a sidecar it removes", async () => {
      fs.writeFileSync(_path.join(sweepDir, `${ID_A}.json`), "{}");
      registerUpload({ id: ID_A, username: "alice", size: 100 });

      await cleanupAbandonedUploads({
        directory: sweepDir,
        now: Date.now() + 100 * HOUR,
      });

      expect(getUploadRecord(ID_A)).toBeUndefined();
    });

    test("keeps a sidecar whose blob is still there", async () => {
      // Still a live upload's metadata: removing it would strand the blob as
      // an unattributable orphan.
      writeUpload(ID_B, { size: 4, offset: 4 }, "ACGT");

      const result = await cleanupAbandonedUploads({
        directory: sweepDir,
        now: Date.now() + 100 * HOUR,
      });

      expect(result.sidecars).toEqual([]);
      expect(fs.existsSync(_path.join(sweepDir, `${ID_B}.json`))).toBe(true);
    });

    test("keeps a widowed sidecar that is still inside the window", async () => {
      // tus writes the blob and the sidecar as two steps; a sidecar seen in
      // that window has a blob on the way.
      fs.writeFileSync(_path.join(sweepDir, `${ID_A}.json`), "{}");

      const result = await cleanupAbandonedUploads({
        directory: sweepDir,
        now: Date.now(),
      });

      expect(result.sidecars).toEqual([]);
      expect(fs.existsSync(_path.join(sweepDir, `${ID_A}.json`))).toBe(true);
    });

    test("does not report the sidecar it removed alongside a blob twice", async () => {
      writeUpload(ID_A, { size: 100, offset: 10 });

      const result = await cleanupAbandonedUploads({
        directory: sweepDir,
        now: Date.now() + 100 * HOUR,
      });

      expect(result.removed).toEqual([ID_A]);
      expect(result.sidecars).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    test("leaves a JSON file that is not named like an upload", async () => {
      fs.writeFileSync(_path.join(sweepDir, "manifest.json"), "{}");

      const result = await cleanupAbandonedUploads({
        directory: sweepDir,
        now: Date.now() + 100 * HOUR,
      });

      expect(result.sidecars).toEqual([]);
      expect(fs.existsSync(_path.join(sweepDir, "manifest.json"))).toBe(true);
    });
  });
});

describe("getRecordedOwner", () => {
  let ownerDir;
  const ID = "f".repeat(32);

  beforeEach(() => {
    ownerDir = fs.mkdtempSync(_path.join(tmpRoot, "owner-"));
  });

  /** Writes the sidecar the tus FileStore keeps beside a blob. */
  const writeSidecar = (id, metadata) =>
    fs.writeFileSync(
      _path.join(ownerDir, `${id}.json`),
      JSON.stringify({ id, size: 4, offset: 4, metadata }),
    );

  test("reads the owner stamped into the tus sidecar", async () => {
    writeSidecar(ID, { owner: "alice", filename: "reads.fq" });

    expect(await getRecordedOwner(ownerDir, ID)).toBe("alice");
  });

  test("falls back to the in-process register while the upload is open", async () => {
    registerUpload({ id: ID, username: "alice", size: 4 });

    expect(await getRecordedOwner(ownerDir, ID)).toBe("alice");
  });

  test("reports no owner for an upload that recorded none", async () => {
    // Every upload the old unauthenticated mount accepted looks like this.
    writeSidecar(ID, { filename: "reads.fq" });

    expect(await getRecordedOwner(ownerDir, ID)).toBeNull();
    expect(isUploadOwner(await getRecordedOwner(ownerDir, ID), "alice")).toBe(
      false,
    );
  });

  test("reports no owner for an upload it has never heard of", async () => {
    expect(await getRecordedOwner(ownerDir, ID)).toBeNull();
  });
});

describe("assertUploadComplete", () => {
  let dir;
  const ID = "e".repeat(32);

  beforeEach(() => {
    dir = fs.mkdtempSync(_path.join(tmpRoot, "complete-"));
  });

  const writeSidecar = (id, info) =>
    fs.writeFileSync(_path.join(dir, `${id}.json`), JSON.stringify({ id, ...info }));

  test("refuses an upload whose offset is behind its declared size", async () => {
    // The auditor reproduced acceptance of exactly this: size 100, offset 1.
    fs.writeFileSync(_path.join(dir, ID), Buffer.alloc(1));
    writeSidecar(ID, { size: 100, offset: 1 });

    await expect(assertUploadComplete(dir, ID)).rejects.toThrow();
  });

  test("refuses when the sidecar claims done but the blob's real size disagrees", async () => {
    // Simulates a disk write that never actually finished landing.
    fs.writeFileSync(_path.join(dir, ID), Buffer.alloc(50));
    writeSidecar(ID, { size: 100, offset: 100 });

    await expect(assertUploadComplete(dir, ID)).rejects.toThrow();
  });

  test("refuses a deferred-length upload that never got a final size", async () => {
    fs.writeFileSync(_path.join(dir, ID), Buffer.alloc(10));
    writeSidecar(ID, { offset: 10, sizeIsDeferred: true });

    await expect(assertUploadComplete(dir, ID)).rejects.toThrow();
  });

  test("refuses an upload with no sidecar at all", async () => {
    await expect(assertUploadComplete(dir, ID)).rejects.toThrow();
  });

  test("resolves silently for a genuinely complete upload", async () => {
    fs.writeFileSync(_path.join(dir, ID), Buffer.alloc(100));
    writeSidecar(ID, { size: 100, offset: 100 });

    await expect(assertUploadComplete(dir, ID)).resolves.toBeUndefined();
  });
});

describe("checkUploadAllowed — the free-space floor is global", () => {
  test("admits a request alone but refuses a second once the first is reserved", async () => {
    // The auditor reproduced this with 1,100 bytes free and a 100-byte floor:
    // two 700-byte uploads from different users each independently saw
    // ~1,100 free and were both admitted, together overrunning the floor.
    const free = await getFreeBytes(tmpRoot);
    process.env.UPLOAD_MIN_FREE_BYTES = String(free - 1000);

    const first = await checkUploadAllowed({
      id: "a".repeat(32),
      username: "alice",
      size: 700,
      directory: tmpRoot,
    });

    expect(first).toEqual({ allowed: true });

    const second = await checkUploadAllowed({
      id: "b".repeat(32),
      username: "bob",
      size: 700,
      directory: tmpRoot,
    });

    expect(second.allowed).toBe(false);
    expect(second.status).toBe(507);
    // Refused, not consumed: bob's own reservation must not linger.
    expect(getUserUsage("bob")).toEqual({ count: 0, bytes: 0 });
  });

  test("does not count itself twice: a lone request is still charged once", async () => {
    const free = await getFreeBytes(tmpRoot);
    process.env.UPLOAD_MIN_FREE_BYTES = String(free - 1000);

    const decision = await checkUploadAllowed({
      id: "c".repeat(32),
      username: "alice",
      size: 700,
      directory: tmpRoot,
    });

    expect(decision).toEqual({ allowed: true });
  });
});

describe("recoverUploadReservations", () => {
  let dir;
  const DONE_ID = "1".repeat(32);
  const OPEN_ID = "2".repeat(32);

  beforeEach(() => {
    dir = fs.mkdtempSync(_path.join(tmpRoot, "recover-"));
  });

  const writeUpload = (id, info, bytes) => {
    fs.writeFileSync(_path.join(dir, id), Buffer.alloc(bytes));
    fs.writeFileSync(
      _path.join(dir, `${id}.json`),
      JSON.stringify({ id, ...info }),
    );
  };

  test("re-registers only the incomplete upload, with its owner and bytes", async () => {
    writeUpload(
      DONE_ID,
      { size: 4, offset: 4, metadata: { owner: "alice" } },
      4,
    );
    writeUpload(
      OPEN_ID,
      { size: 100, offset: 30, metadata: { owner: "bob" } },
      30,
    );

    const recovered = await recoverUploadReservations(dir);

    expect(recovered).toBe(1);
    expect(getUploadRecord(DONE_ID)).toBeUndefined();
    expect(getUploadRecord(OPEN_ID)).toMatchObject({
      username: "bob",
      size: 100,
    });
  });

  test("skips an incomplete upload with no recorded owner", async () => {
    writeUpload(OPEN_ID, { size: 100, offset: 30 }, 30);

    const recovered = await recoverUploadReservations(dir);

    expect(recovered).toBe(0);
    expect(getUploadRecord(OPEN_ID)).toBeUndefined();
  });

  test("reports zero rather than throwing on a missing directory", async () => {
    expect(await recoverUploadReservations(_path.join(dir, "gone"))).toBe(0);
  });
});
