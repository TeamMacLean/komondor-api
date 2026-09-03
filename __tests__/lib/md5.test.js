/**
 * Tests for lib/utils/md5.js
 *
 * The property under test is the one the two path-form callers depend on and
 * neither of them can restate: calculateFileMd5, handed a *path*, opens it
 * with O_NOFOLLOW, so a symlink at the leaf is refused rather than followed.
 *
 * Containment does not cover this. lib/utils/safePath.js's resolveWithinReal
 * answers "yes" for a symlink whose target is still inside the root — realpath
 * lands on a path under the root, which is all it asks — so a leaf symlink
 * pointing at another group's file passes every containment check in the
 * codebase. O_NOFOLLOW is the only thing between that link and its target's
 * bytes, for both callers that hand in a path:
 *
 *   - lib/md5-verification.js verifyReadMd5, which would otherwise record a
 *     checksum MATCH for a read whose bytes are somebody else's file;
 *   - lib/file-utils.js adoptAlreadyMovedFile, which would otherwise adopt a
 *     planted symlink as though it were the real bytes.
 */

const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs").promises;
const os = require("os");
const path = require("path");

const { calculateFileMd5 } = require("../../lib/utils/md5");

describe("calculateFileMd5", () => {
  let tmpRoot;
  let realFile;
  const CONTENT = "ACGTACGTACGT";
  const CONTENT_MD5 = crypto.createHash("md5").update(CONTENT).digest("hex");

  beforeEach(() => {
    tmpRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "komondor-md5-"))
    );
    realFile = path.join(tmpRoot, "real.fq");
    fs.writeFileSync(realFile, CONTENT);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("hashes the bytes at a path", () => {
    return expect(calculateFileMd5(realFile)).resolves.toBe(CONTENT_MD5);
  });

  test("hashes the bytes behind an already-open handle", async () => {
    const handle = await fsp.open(realFile, "r");

    try {
      await expect(calculateFileMd5(handle)).resolves.toBe(CONTENT_MD5);
    } finally {
      await handle.close();
    }
  });

  test("leaves a caller-owned handle open and reusable", async () => {
    // copy verification hashes and then fstats the same pinned descriptor.
    // ReadStream.destroy() closed that descriptor despite autoClose:false on
    // supported Node releases, turning the post-digest integrity check into
    // EBADF. Positional reads do not take ownership of it.
    const handle = await fsp.open(realFile, "r");

    try {
      await calculateFileMd5(handle);

      await expect(handle.stat()).resolves.toMatchObject({
        size: Buffer.byteLength(CONTENT),
      });

      const bytes = Buffer.alloc(Buffer.byteLength(CONTENT));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      expect(bytesRead).toBe(bytes.length);
      expect(bytes.toString()).toBe(CONTENT);
    } finally {
      await handle.close();
    }
  });

  test("hashes from byte zero without moving the caller's descriptor position", async () => {
    const handle = await fsp.open(realFile, "r");
    const first = Buffer.alloc(4);
    const next = Buffer.alloc(4);

    try {
      await handle.read(first, 0, first.length, null);
      expect(first.toString()).toBe(CONTENT.slice(0, 4));

      await expect(calculateFileMd5(handle)).resolves.toBe(CONTENT_MD5);

      // The hash uses explicit positions, so the caller's sequential offset
      // is still byte 4 rather than EOF (or an implementation-specific spot).
      await handle.read(next, 0, next.length, null);
      expect(next.toString()).toBe(CONTENT.slice(4, 8));
    } finally {
      await handle.close();
    }
  });

  test("given a path does not follow a symlink at the leaf", async () => {
    // The attack this refuses: the leaf name is a symlink to a file the caller
    // is not entitled to. Every lexical and realpath-based containment check
    // in the codebase is satisfied here — the link and its target sit in the
    // same directory — so the refusal has to come from the open itself.
    const link = path.join(tmpRoot, "link.fq");
    fs.symlinkSync(realFile, link);

    await expect(calculateFileMd5(link)).rejects.toMatchObject({
      code: "ELOOP",
    });
  });

  test("given a path does not report the target's digest for a symlink", async () => {
    // Stated as a digest rather than as an error code, because the harm is not
    // "an open failed": it is that the caller is told the bytes behind the
    // link are the bytes it asked about. A future change that swapped ELOOP
    // for some other refusal would keep this green; one that started
    // following the link cannot.
    const link = path.join(tmpRoot, "link.fq");
    fs.symlinkSync(realFile, link);

    const digest = await calculateFileMd5(link).catch(() => null);

    expect(digest).not.toBe(CONTENT_MD5);
    expect(digest).toBeNull();
  });

  test("given a path does not follow a symlink pointing outside its directory", async () => {
    // The same refusal where the target is somewhere a containment check would
    // actually object to, so the two failure modes cannot be conflated: even
    // here the open, not the path check, is what stops it.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "komondor-md5-out-"));
    const secret = path.join(outside, "secret");
    fs.writeFileSync(secret, "TOP SECRET");
    const link = path.join(tmpRoot, "elsewhere.fq");
    fs.symlinkSync(secret, link);

    try {
      await expect(calculateFileMd5(link)).rejects.toMatchObject({
        code: "ELOOP",
      });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test("still hashes a real file reached through a symlinked directory", async () => {
    // O_NOFOLLOW applies to the final component only, and it has to stay that
    // way: DATASTORE_ROOT is a mount point in production and an intermediate
    // symlink there is ordinary, not hostile. Refusing those would break every
    // deployment that has one.
    const linkedDir = path.join(tmpRoot, "linked");
    fs.mkdirSync(path.join(tmpRoot, "actual"));
    fs.writeFileSync(path.join(tmpRoot, "actual", "reads.fq"), CONTENT);
    fs.symlinkSync(path.join(tmpRoot, "actual"), linkedDir);

    await expect(
      calculateFileMd5(path.join(linkedDir, "reads.fq"))
    ).resolves.toBe(CONTENT_MD5);
  });

  test("reports a missing file rather than resolving to a digest", async () => {
    await expect(
      calculateFileMd5(path.join(tmpRoot, "absent.fq"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
