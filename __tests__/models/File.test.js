/**
 * Tests for File.moveToFolderAndSave — the path every uploaded read file takes
 * into the datastore.
 *
 * These run against real files in a temporary directory. The cross-device
 * branch is reached by forcing fs.link to fail, which is what happens in
 * production when the upload staging area and the datastore are separate
 * mounts.
 */

// File.js destructures createWriteStream at module load, so it must be
// swappable at the module boundary rather than via a later spy.
let mockWriteStreamFactory = null;

jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    createWriteStream: (...args) =>
      mockWriteStreamFactory
        ? mockWriteStreamFactory(...args)
        : actual.createWriteStream(...args),
  };
});

const fs = require("fs");
const fsp = require("fs").promises;
const os = require("os");
const _path = require("path");
const { Writable } = require("stream");

const File = require("../../models/File");
const {
  getActiveTransfers,
  clearActiveTransfers,
} = require("../../lib/active-transfers");

/** Any partially copied files left behind in a directory. */
const partialsIn = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.includes(".part-"))
    : [];

let tmpRoot;
let datastoreRoot;
let stagingDir;
let hpcInboxDir;
let outsideDir;
const ORIGINAL_DATASTORE = process.env.DATASTORE_ROOT;
const ORIGINAL_HPC = process.env.HPC_TRANSFER_DIRECTORY;
const ORIGINAL_UPLOAD = process.env.UPLOAD_DIRECTORY;
const ORIGINAL_LINK_ROOTS = process.env.ALLOWED_LINK_ROOTS;

/** Builds an unsaved File document with a stubbed save(). */
const makeFile = (sourcePath) => {
  const doc = new File({
    name: "reads.fq",
    type: "run",
    uploadName: "reads.fq",
    originalName: "reads.fq",
    path: sourcePath,
  });
  doc.save = jest.fn().mockImplementation(() => Promise.resolve(doc));
  return doc;
};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(_path.join(os.tmpdir(), "komondor-file-"));
  datastoreRoot = _path.join(tmpRoot, "datastore");
  stagingDir = _path.join(tmpRoot, "staging");
  hpcInboxDir = _path.join(tmpRoot, "hpc-inbox");
  outsideDir = _path.join(tmpRoot, "outside");
  fs.mkdirSync(datastoreRoot, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(hpcInboxDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  process.env.DATASTORE_ROOT = datastoreRoot;
  // stagingDir models the ordinary (tus / local-filesystem) upload staging
  // area. hpcInboxDir is kept separate and only used by the tests that
  // specifically exercise HPC-inbox retention, below.
  process.env.UPLOAD_DIRECTORY = stagingDir;
  process.env.HPC_TRANSFER_DIRECTORY = hpcInboxDir;
  delete process.env.ALLOWED_LINK_ROOTS;

  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});

  clearActiveTransfers();
});

afterEach(() => {
  jest.restoreAllMocks();
  mockWriteStreamFactory = null;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (ORIGINAL_DATASTORE === undefined) {
    delete process.env.DATASTORE_ROOT;
  } else {
    process.env.DATASTORE_ROOT = ORIGINAL_DATASTORE;
  }
  if (ORIGINAL_HPC === undefined) {
    delete process.env.HPC_TRANSFER_DIRECTORY;
  } else {
    process.env.HPC_TRANSFER_DIRECTORY = ORIGINAL_HPC;
  }
  if (ORIGINAL_UPLOAD === undefined) {
    delete process.env.UPLOAD_DIRECTORY;
  } else {
    process.env.UPLOAD_DIRECTORY = ORIGINAL_UPLOAD;
  }
  if (ORIGINAL_LINK_ROOTS === undefined) {
    delete process.env.ALLOWED_LINK_ROOTS;
  } else {
    process.env.ALLOWED_LINK_ROOTS = ORIGINAL_LINK_ROOTS;
  }
});

afterAll(async () => {
  const mongoose = require("mongoose");
  await mongoose.connection.close();
});

describe("moveToFolderAndSave — same filesystem (link)", () => {
  test("moves the file to the destination", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    const dest = _path.join(datastoreRoot, "group", "raw", "reads.fq");
    expect(fs.readFileSync(dest, "utf8")).toBe("ACGT");
  });

  test("removes the source file", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    expect(fs.existsSync(source)).toBe(false);
  });

  test("creates missing intermediate directories", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("a", "b", "c", "reads.fq"));

    expect(
      fs.existsSync(_path.join(datastoreRoot, "a", "b", "c", "reads.fq")),
    ).toBe(true);
  });

  test("records the relative path and saves", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);
    const relPath = _path.join("group", "raw", "reads.fq");

    await doc.moveToFolderAndSave(relPath);

    expect(doc.path).toBe(relPath);
    expect(doc.save).toHaveBeenCalled();
  });
});

describe("moveToFolderAndSave — cross-device (copy fallback)", () => {
  /**
   * Forces the move out of staging to fail the way a cross-mount one does.
   *
   * The move is a hard link now rather than a rename, so this is what has to
   * be intercepted. Only the link *out of staging* fails: promoting a finished
   * copy to its final name happens entirely inside the datastore, on one
   * filesystem, and still succeeds — failing that too would model a filesystem
   * that does not exist.
   */
  const forceCrossDevice = () => {
    const realLink = fsp.link.bind(fsp);
    jest.spyOn(fsp, "link").mockImplementation((from, to) => {
      if (String(from).startsWith(datastoreRoot)) {
        return realLink(from, to);
      }
      const err = new Error("EXDEV: cross-device link not permitted");
      err.code = "EXDEV";
      return Promise.reject(err);
    });
    return realLink;
  };

  test("copies the file when the link fails", async () => {
    forceCrossDevice();
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGTACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    const dest = _path.join(datastoreRoot, "group", "raw", "reads.fq");
    expect(fs.readFileSync(dest, "utf8")).toBe("ACGTACGT");
  });

  test("removes the source only after the copy succeeds", async () => {
    forceCrossDevice();
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGTACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    expect(fs.existsSync(source)).toBe(false);
  });

  test("preserves file contents byte-for-byte", async () => {
    forceCrossDevice();
    const source = _path.join(stagingDir, "reads.fq");
    const payload = Buffer.from(
      Array.from({ length: 100000 }, (_, i) => i % 256),
    );
    fs.writeFileSync(source, payload);
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    const dest = _path.join(datastoreRoot, "group", "raw", "reads.fq");
    expect(fs.readFileSync(dest).equals(payload)).toBe(true);
  });

  test("leaves no partial file behind once the copy is promoted", async () => {
    forceCrossDevice();
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGTACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq"));

    expect(partialsIn(_path.join(datastoreRoot, "group", "raw"))).toEqual([]);
  });

  test("rejects a copy that is shorter than the source", async () => {
    // A stream that ends early still resolves cleanly, so only the byte count
    // catches it — and a short read file would pass silently downstream.
    forceCrossDevice();
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGTACGT");
    mockWriteStreamFactory = (destPath) => {
      fs.mkdirSync(_path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, "AC"); // fewer bytes than the source
      return new Writable({
        write(chunk, encoding, callback) {
          callback(); // silently accepts, writes nothing more
        },
      });
    };
    const doc = makeFile(source);

    await expect(
      doc.moveToFolderAndSave(_path.join("group", "raw", "reads.fq")),
    ).rejects.toThrow(/2 bytes but the source is 8 bytes/);
    expect(
      fs.existsSync(_path.join(datastoreRoot, "group", "raw", "reads.fq")),
    ).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
  });

  describe("when the copy fails part-way", () => {
    const REL_PATH = _path.join("group", "raw", "reads.fq");
    let source;
    let dest;

    /**
     * Simulates a copy that has already written some bytes and then fails —
     * a full disk, or the mount dropping mid-transfer.
     *
     * The bytes already on disk are staged directly so the assertion is
     * deterministic rather than racing the stream.
     */
    const forceCopyFailure = () => {
      forceCrossDevice();
      mockWriteStreamFactory = (destPath) => {
        fs.mkdirSync(_path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, "ACGT"); // bytes written before the failure
        return new Writable({
          write(chunk, encoding, callback) {
            callback(new Error("ENOSPC: no space left on device"));
          },
        });
      };
    };

    beforeEach(() => {
      source = _path.join(stagingDir, "reads.fq");
      dest = _path.join(datastoreRoot, REL_PATH);
      fs.writeFileSync(source, "ACGTACGT");
      forceCopyFailure();
    });

    test("rejects rather than reporting success", async () => {
      const doc = makeFile(source);

      await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(/ENOSPC/);
    });

    test("keeps the source file", async () => {
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(fs.existsSync(source)).toBe(true);
      expect(fs.readFileSync(source, "utf8")).toBe("ACGTACGT");
    });

    test("does not leave a truncated file at the destination", async () => {
      // A partial file left behind is indistinguishable from a complete read
      // to everything downstream.
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(fs.existsSync(dest)).toBe(false);
    });

    test("does not save the document", async () => {
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(doc.save).not.toHaveBeenCalled();
    });

    test("leaves the document's path pointing at the source", async () => {
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(doc.path).toBe(source);
    });

    test("cleans up the partial copy", async () => {
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(partialsIn(_path.dirname(dest))).toEqual([]);
    });
  });
});

describe("moveToFolderAndSave — move failures that are not cross-device", () => {
  const REL_PATH = _path.join("group", "raw", "reads.fq");

  /**
   * The destination already holds the file and the source is gone: what an
   * earlier attempt leaves behind when it moves the bytes and then fails
   * before the document is saved.
   */
  const stageAlreadyMoved = () => {
    const dest = _path.join(datastoreRoot, REL_PATH);
    fs.mkdirSync(_path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "COMPLETE-GENOMIC-DATA");
    return dest;
  };

  test("does not overwrite the file already at the destination", async () => {
    const dest = stageAlreadyMoved();
    const doc = makeFile(_path.join(stagingDir, "reads.fq")); // never created

    await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

    expect(fs.readFileSync(dest, "utf8")).toBe("COMPLETE-GENOMIC-DATA");
  });

  test("rejects rather than falling back to a copy", async () => {
    stageAlreadyMoved();
    const doc = makeFile(_path.join(stagingDir, "reads.fq"));

    await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(/ENOENT/);
  });

  test("names both paths so the state can be diagnosed", async () => {
    const dest = stageAlreadyMoved();
    const source = _path.join(stagingDir, "reads.fq");
    const doc = makeFile(source);

    await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
      new RegExp(`${source}.*${dest}`),
    );
  });
});

describe("moveToFolderAndSave — the source is pinned, not re-resolved", () => {
  // The containment check resolves the source through its symlinks, but that
  // answer is stale the moment it is given: for an hpc-mv the source root is a
  // directory unprivileged users write into by design. These model the swap
  // that the check alone could not see.
  const REL_PATH = _path.join("group", "raw", "reads.fq");
  let source;
  let dest;
  let victim;

  beforeEach(() => {
    source = _path.join(stagingDir, "reads.fq");
    dest = _path.join(datastoreRoot, REL_PATH);
    victim = _path.join(outsideDir, "victim.txt");
    fs.writeFileSync(source, "ACGT");
    fs.writeFileSync(victim, "SOMEONE-ELSES-DATA");
  });

  /** Re-points the source name at `victim` the moment link() is reached. */
  const swapSourceOnLink = () => {
    const realLink = fsp.link.bind(fsp);
    jest.spyOn(fsp, "link").mockImplementation(async (from, to) => {
      if (String(from) === source && fs.existsSync(source)) {
        fs.unlinkSync(source);
        fs.linkSync(victim, source);
      }
      return realLink(from, to);
    });
  };

  test("refuses a source swapped between the check and the link", async () => {
    swapSourceOnLink();
    const doc = makeFile(source);

    await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
      /replaced while it was being moved/,
    );
  });

  test("does not file the swapped-in file in the datastore", async () => {
    swapSourceOnLink();
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.readFileSync(victim, "utf8")).toBe("SOMEONE-ELSES-DATA");
  });

  test("does not save a document pointing at a file it never moved", async () => {
    swapSourceOnLink();
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

    expect(doc.save).not.toHaveBeenCalled();
  });

  test("moves via a symlink whose real target is inside a permitted root", async () => {
    // Was refused outright before the ELOOP fallback was added: O_NOFOLLOW
    // rejected any leaf symlink, even one isPermittedSource() had already
    // vouched for by resolving straight to an in-root target. Rewritten
    // because that blanket refusal is exactly what commit 366f656's
    // ALLOWED_LINK_ROOTS feature needed lifted (see FIX 2).
    const target = _path.join(stagingDir, "real-reads.fq");
    fs.writeFileSync(target, "ACGT");
    const link = _path.join(stagingDir, "linked.fq");
    fs.symlinkSync(target, link);
    const doc = makeFile(link);

    await doc.moveToFolderAndSave(REL_PATH);

    expect(fs.readFileSync(dest, "utf8")).toBe("ACGT");
    // The symlink itself is a staging-area upload artefact and is cleaned up;
    // the file it pointed at is untouched.
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
  });

  test("copies from the pinned handle, not from the name, when cross-device", async () => {
    // The copy fallback reads for however long a multi-GB read takes, which is
    // an enormous window to re-point the name in.
    const realLink = fsp.link.bind(fsp);
    jest.spyOn(fsp, "link").mockImplementation((from, to) => {
      if (String(from).startsWith(datastoreRoot)) {
        return realLink(from, to);
      }
      fs.unlinkSync(source);
      fs.linkSync(victim, source);
      const err = new Error("EXDEV: cross-device link not permitted");
      err.code = "EXDEV";
      return Promise.reject(err);
    });
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

    // Either the move copied the original bytes or it refused; what it must
    // never do is put the swapped-in file in the datastore.
    if (fs.existsSync(dest)) {
      expect(fs.readFileSync(dest, "utf8")).toBe("ACGT");
    }
    expect(fs.readFileSync(victim, "utf8")).toBe("SOMEONE-ELSES-DATA");
  });
});

describe("moveToFolderAndSave — ALLOWED_LINK_ROOTS symlink sources", () => {
  const REL_PATH = _path.join("group", "raw", "reads.fq");
  let scratchDir;
  let target;
  let link;

  beforeEach(() => {
    // Outside every permitted root on its own — only reachable via a
    // configured ALLOWED_LINK_ROOTS entry, modelling a symlink into /scratch.
    scratchDir = _path.join(outsideDir, "scratch");
    fs.mkdirSync(scratchDir, { recursive: true });
    target = _path.join(scratchDir, "big-run.fq");
    fs.writeFileSync(target, "ACGTACGT");
    link = _path.join(stagingDir, "linked.fq");
    fs.symlinkSync(target, link);
  });

  test("moves a symlink into the permitted root when it is configured", async () => {
    process.env.ALLOWED_LINK_ROOTS = scratchDir;
    const doc = makeFile(link);

    await doc.moveToFolderAndSave(REL_PATH);

    const dest = _path.join(datastoreRoot, REL_PATH);
    expect(fs.readFileSync(dest, "utf8")).toBe("ACGTACGT");
    expect(fs.existsSync(target)).toBe(true);
  });

  test("still refuses the same symlink when ALLOWED_LINK_ROOTS is not configured", async () => {
    // ALLOWED_LINK_ROOTS deliberately left unset by beforeEach: the previous
    // test's grant must not regress into a standing permission.
    const doc = makeFile(link);

    await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
      /source is not inside a permitted directory/,
    );

    expect(fs.existsSync(_path.join(datastoreRoot, REL_PATH))).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("ACGTACGT");
  });
});

describe("moveToFolderAndSave — HPC inbox source retention", () => {
  // Sources in the shared HPC transfer inbox are written by unprivileged
  // uploads the API does not own: a directory typo in the destination is one
  // keystroke away, so unlike every other permitted root the source is left
  // in place rather than destroyed. See BREAKING_CHANGES.md entry 32.
  const REL_PATH = _path.join("group", "raw", "reads.fq");

  test("leaves the source in place after retention copies it", async () => {
    // Retention always streams a copy now, on every device — a same-device
    // hard link would share the destination's inode with the source, which is
    // exactly what retention exists to avoid (see the file's own comment: a
    // re-scp over the staging name must not rewrite the archived bytes too).
    // There is no separate same-device-link code path here left to cover.
    const source = _path.join(hpcInboxDir, "reads.fq");
    fs.writeFileSync(source, "ACGTACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(REL_PATH);

    const dest = _path.join(datastoreRoot, REL_PATH);
    expect(fs.readFileSync(dest, "utf8")).toBe("ACGTACGT");
    expect(fs.readFileSync(source, "utf8")).toBe("ACGTACGT");
    expect(fs.statSync(dest).ino).not.toBe(fs.statSync(source).ino);
  });

  test("an interrupted copy leaves no truncated file at the real name, and a retry still succeeds", async () => {
    // Reproduced by execution before this fix: retention wrote fs.copyFile
    // straight to the final name, so an interrupt part-way through left a
    // permanently truncated file there, and every retry failed "destination
    // already exists" against bytes too short to ever pass a content check.
    // Streaming into a partial file first, and only promoting it once the
    // byte count is verified, is what makes an interrupt safe to retry.
    const source = _path.join(hpcInboxDir, "reads.fq");
    fs.writeFileSync(source, "ACGTACGT"); // 8 bytes
    const dest = _path.join(datastoreRoot, REL_PATH);

    mockWriteStreamFactory = (destPath) => {
      fs.mkdirSync(_path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, "ACGT"); // half the source, then stops
      return new Writable({
        write(chunk, encoding, callback) {
          callback();
        },
      });
    };

    const firstAttempt = makeFile(source);
    await expect(firstAttempt.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
      /4 bytes but the source is 8 bytes/,
    );

    // The real name was never touched — not created short, not left short.
    expect(fs.existsSync(dest)).toBe(false);
    expect(partialsIn(_path.dirname(dest))).toEqual([]);
    expect(fs.readFileSync(source, "utf8")).toBe("ACGTACGT");

    // A genuine retry, with the interruption lifted, succeeds rather than
    // hitting a stale "destination already exists".
    mockWriteStreamFactory = null;
    const retry = makeFile(source);
    await retry.moveToFolderAndSave(REL_PATH);

    expect(fs.readFileSync(dest, "utf8")).toBe("ACGTACGT");
  });

  test("copies from the pinned handle, not from a reopened path, if the staging name is swapped mid-move", async () => {
    // The exact TOCTOU a re-audit reproduced: a source retained for the whole
    // move is a live file a scientist can still touch. fs.copyFile(path, ...)
    // reopens the name fresh and would copy whatever is THERE when it runs,
    // not what isPermittedSource() actually vouched for. Streaming through
    // the already-open sourceHandle instead keeps reading the pinned bytes
    // even after the name is made to point elsewhere.
    const source = _path.join(hpcInboxDir, "reads.fq");
    const victim = _path.join(hpcInboxDir, "victim.fq");
    fs.writeFileSync(source, "PINNED-BYTES");
    fs.writeFileSync(victim, "SOMEONE-ELSES-DATA");

    // fs.open is the one call common to both the old and new implementation
    // of this branch, and it is what pins the handle in the first place —
    // firing the swap in the resolved open's continuation lands it exactly
    // between "the handle is pinned" and "the bytes are read", regardless of
    // which reads-by-path-or-by-handle strategy the rest of the move uses.
    const realOpen = fsp.open.bind(fsp);
    jest.spyOn(fsp, "open").mockImplementation(async (p, flags) => {
      const handle = await realOpen(p, flags);
      fs.unlinkSync(source);
      fs.linkSync(victim, source);
      return handle;
    });

    const doc = makeFile(source);
    await doc.moveToFolderAndSave(REL_PATH);

    const dest = _path.join(datastoreRoot, REL_PATH);
    expect(fs.readFileSync(dest, "utf8")).toBe("PINNED-BYTES");
  });

  test("refuses a copy whose source was rewritten in place while it was read", async () => {
    // An open fd defeats a path SWAP, but not an in-place rewrite of the same
    // inode — the descriptor keeps streaming whatever that inode now holds.
    // A re-audit executed this: a 1 MiB copy with the source re-scp'd over
    // itself after the first 4096 bytes, ending at the same length, promoted a
    // destination made of 4096 old bytes followed by 1,044,480 new ones and
    // reported success. Both the size check and the inode check still passed,
    // because neither of them moves when a file is rewritten in place.
    //
    // "scp over the same name" is the ordinary way a scientist resends a file
    // they think arrived wrong, so this needs no attacker at all — and the
    // failure is silent, mixed-content corruption, which is worse than any
    // stall.
    const source = _path.join(hpcInboxDir, "reads.fq");
    const OLD = Buffer.alloc(256 * 1024, "A");
    const NEW = Buffer.alloc(256 * 1024, "B");
    fs.writeFileSync(source, OLD);

    // Backdated so the rewrite below is guaranteed to move mtime, rather than
    // relying on the two writes landing in different milliseconds.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(source, past, past);

    const dest = _path.join(datastoreRoot, REL_PATH);
    const actualFs = jest.requireActual("fs");

    let rewritten = false;
    mockWriteStreamFactory = (destPath, options) => {
      const real = actualFs.createWriteStream(destPath, options);
      return new Writable({
        write(chunk, encoding, callback) {
          if (!rewritten) {
            rewritten = true;
            // Truncate-and-rewrite in place: same inode, same final length.
            const fd = fs.openSync(source, "r+");
            fs.writeSync(fd, NEW, 0, NEW.length, 0);
            fs.closeSync(fd);
          }
          real.write(chunk, encoding, callback);
        },
        final(callback) {
          real.end(callback);
        },
      });
    };

    const doc = makeFile(source);
    await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
      /source was modified while it was being copied/,
    );

    // Nothing promoted, nothing left behind: the retry gets a clean run at a
    // source that has now settled.
    expect(fs.existsSync(dest)).toBe(false);
    expect(partialsIn(_path.dirname(dest))).toEqual([]);
  });

  test("still updates the document's path even though the source is kept", async () => {
    const source = _path.join(hpcInboxDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(REL_PATH);

    expect(doc.path).toBe(REL_PATH);
    expect(doc.save).toHaveBeenCalled();
  });
});

describe("moveToFolderAndSave — a failed source unlink is not a cross-mount move", () => {
  // fs.link and fs.unlink(source) shared one try block, so an EPERM from the
  // *unlink* — what a sticky-bit shared directory returns for a file the
  // process does not own — was matched by the cross-device test and silently
  // sent down the copy branch.
  const REL_PATH = _path.join("group", "raw", "reads.fq");
  let source;
  let copyAttempts;

  beforeEach(() => {
    source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGTACGT");

    copyAttempts = 0;
    mockWriteStreamFactory = (...args) => {
      copyAttempts += 1;
      return jest.requireActual("fs").createWriteStream(...args);
    };

    const realUnlink = fsp.unlink.bind(fsp);
    jest.spyOn(fsp, "unlink").mockImplementation((target) => {
      if (String(target) === source) {
        const err = new Error("EPERM: operation not permitted, unlink");
        err.code = "EPERM";
        return Promise.reject(err);
      }
      return realUnlink(target);
    });
  });

  test("reports the permission failure rather than a copy failure", async () => {
    const doc = makeFile(source);

    await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(/EPERM/);
  });

  test("does not fall back to copying the file", async () => {
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

    expect(copyAttempts).toBe(0);
  });

  test("does not save the document", async () => {
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

    expect(doc.save).not.toHaveBeenCalled();
  });
});

describe("moveToFolderAndSave — transfer tracking", () => {
  const REL_PATH = _path.join("group", "raw", "reads.fq");

  test("tracks the transfer while the move is in flight", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);
    let seenDuringSave = [];
    doc.save = jest.fn().mockImplementation(() => {
      seenDuringSave = getActiveTransfers();
      return Promise.resolve(doc);
    });

    await doc.moveToFolderAndSave(REL_PATH);

    expect(seenDuringSave).toHaveLength(1);
    expect(seenDuringSave[0]).toMatchObject({ filename: "reads.fq" });
  });

  test("releases the transfer once the move completes", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(REL_PATH);

    expect(getActiveTransfers()).toEqual([]);
  });

  test("releases the transfer when the move fails", async () => {
    // A leaked entry would block every clean shutdown from here on.
    const doc = makeFile(_path.join(stagingDir, "missing.fq"));

    await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

    expect(getActiveTransfers()).toEqual([]);
  });

  test("releases the transfer when saving the document fails", async () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);
    doc.save = jest.fn().mockRejectedValue(new Error("E11000 duplicate key"));

    await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

    expect(getActiveTransfers()).toEqual([]);
  });
});

describe("moveToFolderAndSave — configuration and input guards", () => {
  test("rejects when DATASTORE_ROOT is not configured", async () => {
    delete process.env.DATASTORE_ROOT;
    const doc = makeFile(_path.join(stagingDir, "reads.fq"));

    await expect(doc.moveToFolderAndSave("group/raw/reads.fq")).rejects.toThrow(
      /DATASTORE_ROOT is not configured/,
    );
  });

  test("rejects when the document has no source path", async () => {
    const doc = makeFile(undefined);

    await expect(doc.moveToFolderAndSave("group/raw/reads.fq")).rejects.toThrow(
      /no source path/,
    );
  });

  test("rejects when the source file does not exist", async () => {
    const doc = makeFile(_path.join(stagingDir, "missing.fq"));

    await expect(
      doc.moveToFolderAndSave("group/raw/reads.fq"),
    ).rejects.toThrow();
    expect(doc.save).not.toHaveBeenCalled();
  });
});

describe("moveToFolderAndSave — destination containment", () => {
  /** The destination is assembled from originalName, straight off a request. */
  const move = (doc, relPath) => doc.moveToFolderAndSave(relPath);

  const stagedFile = () => {
    const source = _path.join(stagingDir, "reads.fq");
    fs.writeFileSync(source, "ACGT");
    return source;
  };

  test("refuses a destination that traverses out of the datastore", async () => {
    const source = stagedFile();
    const doc = makeFile(source);

    await expect(
      move(
        doc,
        _path.join("group", "raw", "..", "..", "..", "outside", "planted.fq"),
      ),
    ).rejects.toThrow(/destination is not inside the datastore/);

    expect(fs.existsSync(_path.join(outsideDir, "planted.fq"))).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
  });

  test("refuses a destination that traverses out via originalName alone", async () => {
    // What ../../../etc/cron.d/payload as a filename produces once the parent's
    // relative path is prepended.
    const source = stagedFile();
    const doc = makeFile(source);

    await expect(
      move(doc, _path.join("group", "raw", "../../../outside/payload")),
    ).rejects.toThrow(/destination is not inside the datastore/);

    expect(fs.existsSync(_path.join(outsideDir, "payload"))).toBe(false);
  });

  test("does not echo the rejected path back to the caller", async () => {
    // The message ends up on the Run as statusError, which the client reads.
    const doc = makeFile(stagedFile());

    await expect(move(doc, "../../outside/planted.fq")).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(".."),
      }),
    );
  });

  test("treats an absolute destination as datastore-relative rather than an override", async () => {
    // getRelativePath() has always returned a leading slash, so this must keep
    // working — but it must land inside the datastore, never at /outside.
    const source = stagedFile();
    const doc = makeFile(source);

    await move(doc, "/group/raw/reads.fq");

    const dest = _path.join(datastoreRoot, "group", "raw", "reads.fq");
    expect(fs.readFileSync(dest, "utf8")).toBe("ACGT");
  });

  test("refuses a destination containing a NUL byte", async () => {
    const source = stagedFile();
    const doc = makeFile(source);

    await expect(move(doc, "group/raw/reads\0.fq")).rejects.toThrow(
      /destination is not inside the datastore/,
    );
    expect(fs.existsSync(source)).toBe(true);
  });

  test("refuses a destination reached through a symlinked directory pointing outside", async () => {
    // Lexically "<datastore>/escape/reads.fq" never leaves the root; only the
    // symlink on disk gives it away.
    fs.symlinkSync(outsideDir, _path.join(datastoreRoot, "escape"));
    const source = stagedFile();
    const doc = makeFile(source);

    await expect(move(doc, _path.join("escape", "reads.fq"))).rejects.toThrow(
      /destination is not inside the datastore/,
    );

    expect(fs.existsSync(_path.join(outsideDir, "reads.fq"))).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
  });

  test("refuses a destination that is a symlink out of the datastore", async () => {
    const victim = _path.join(outsideDir, "victim.txt");
    fs.writeFileSync(victim, "DO-NOT-TOUCH");
    const rawDir = _path.join(datastoreRoot, "group", "raw");
    fs.mkdirSync(rawDir, { recursive: true });
    fs.symlinkSync(victim, _path.join(rawDir, "reads.fq"));
    const doc = makeFile(stagedFile());

    await expect(
      move(doc, _path.join("group", "raw", "reads.fq")),
    ).rejects.toThrow(/destination/);

    expect(fs.readFileSync(victim, "utf8")).toBe("DO-NOT-TOUCH");
  });

  test("refuses a dangling symlink at the destination", async () => {
    // A plain create would follow it and write the file wherever it points.
    const target = _path.join(outsideDir, "not-there-yet.fq");
    const rawDir = _path.join(datastoreRoot, "group", "raw");
    fs.mkdirSync(rawDir, { recursive: true });
    fs.symlinkSync(target, _path.join(rawDir, "reads.fq"));
    const doc = makeFile(stagedFile());

    await expect(
      move(doc, _path.join("group", "raw", "reads.fq")),
    ).rejects.toThrow(/destination/);

    expect(fs.existsSync(target)).toBe(false);
  });
});

describe("moveToFolderAndSave — source containment", () => {
  const REL_PATH = _path.join("group", "raw", "reads.fq");

  test("refuses a source outside every configured root", async () => {
    // File.path is a plain string on a document an uploader controls; without
    // this check the move reads — and then unlinks — any file the API can see.
    const victim = _path.join(outsideDir, "victim.txt");
    fs.writeFileSync(victim, "SOMEONE-ELSES-DATA");
    const doc = makeFile(victim);

    await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
      /source is not inside a permitted directory/,
    );

    expect(fs.readFileSync(victim, "utf8")).toBe("SOMEONE-ELSES-DATA");
    expect(fs.existsSync(_path.join(datastoreRoot, REL_PATH))).toBe(false);
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("refuses a source that traverses out of the staging directory", async () => {
    const victim = _path.join(outsideDir, "victim.txt");
    fs.writeFileSync(victim, "SOMEONE-ELSES-DATA");
    const doc = makeFile(_path.join(stagingDir, "..", "outside", "victim.txt"));

    await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
      /source is not inside a permitted directory/,
    );
    expect(fs.readFileSync(victim, "utf8")).toBe("SOMEONE-ELSES-DATA");
  });

  test("refuses a source that is a symlink pointing outside", async () => {
    const victim = _path.join(outsideDir, "victim.txt");
    fs.writeFileSync(victim, "SOMEONE-ELSES-DATA");
    const link = _path.join(stagingDir, "reads.fq");
    fs.symlinkSync(victim, link);
    const doc = makeFile(link);

    await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
      /source is not inside a permitted directory/,
    );

    expect(fs.readFileSync(victim, "utf8")).toBe("SOMEONE-ELSES-DATA");
    expect(fs.existsSync(link)).toBe(true);
  });

  test("does not echo the rejected source back to the caller", async () => {
    const doc = makeFile(_path.join(outsideDir, "victim.txt"));
    fs.writeFileSync(_path.join(outsideDir, "victim.txt"), "x");

    await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(outsideDir),
      }),
    );
  });

  test("accepts a source inside the datastore itself", async () => {
    // Re-filing a file already in the datastore is legitimate.
    const source = _path.join(datastoreRoot, "inbox", "reads.fq");
    fs.mkdirSync(_path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "ACGT");
    const doc = makeFile(source);

    await doc.moveToFolderAndSave(REL_PATH);

    expect(fs.readFileSync(_path.join(datastoreRoot, REL_PATH), "utf8")).toBe(
      "ACGT",
    );
  });
});

describe("moveToFolderAndSave — no-clobber at the destination", () => {
  const REL_PATH = _path.join("group", "raw", "reads.fq");

  /** An existing destination file, as an earlier completed move leaves it. */
  const existingDestination = () => {
    const dest = _path.join(datastoreRoot, REL_PATH);
    fs.mkdirSync(_path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "COMPLETE-GENOMIC-DATA");
    return dest;
  };

  const forceCrossDevice = () => {
    const realLink = fsp.link.bind(fsp);
    jest.spyOn(fsp, "link").mockImplementation((from, to) => {
      if (String(from).startsWith(datastoreRoot)) {
        return realLink(from, to);
      }
      const err = new Error("EXDEV: cross-device link not permitted");
      err.code = "EXDEV";
      return Promise.reject(err);
    });
  };

  describe("same filesystem", () => {
    test("refuses to replace a file already at the destination", async () => {
      const dest = existingDestination();
      const source = _path.join(stagingDir, "reads.fq");
      fs.writeFileSync(source, "NEWER-BUT-DIFFERENT");
      const doc = makeFile(source);

      await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
        /destination already exists/,
      );

      expect(fs.readFileSync(dest, "utf8")).toBe("COMPLETE-GENOMIC-DATA");
    });

    test("keeps the source when the destination is taken", async () => {
      existingDestination();
      const source = _path.join(stagingDir, "reads.fq");
      fs.writeFileSync(source, "NEWER-BUT-DIFFERENT");
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(fs.readFileSync(source, "utf8")).toBe("NEWER-BUT-DIFFERENT");
    });

    test("does not silently file the upload under a different name", async () => {
      existingDestination();
      const source = _path.join(stagingDir, "reads.fq");
      fs.writeFileSync(source, "NEWER-BUT-DIFFERENT");
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(fs.readdirSync(_path.join(datastoreRoot, "group", "raw"))).toEqual(
        ["reads.fq"],
      );
      expect(doc.save).not.toHaveBeenCalled();
    });
  });

  describe("cross-device", () => {
    test("refuses to replace a file already at the destination", async () => {
      forceCrossDevice();
      const dest = existingDestination();
      const source = _path.join(stagingDir, "reads.fq");
      fs.writeFileSync(source, "NEWER-BUT-DIFFERENT");
      const doc = makeFile(source);

      await expect(doc.moveToFolderAndSave(REL_PATH)).rejects.toThrow(
        /destination already exists/,
      );

      expect(fs.readFileSync(dest, "utf8")).toBe("COMPLETE-GENOMIC-DATA");
      expect(fs.readFileSync(source, "utf8")).toBe("NEWER-BUT-DIFFERENT");
    });

    test("cleans up the copy it could not promote", async () => {
      forceCrossDevice();
      existingDestination();
      const source = _path.join(stagingDir, "reads.fq");
      fs.writeFileSync(source, "NEWER-BUT-DIFFERENT");
      const doc = makeFile(source);

      await doc.moveToFolderAndSave(REL_PATH).catch(() => {});

      expect(partialsIn(_path.join(datastoreRoot, "group", "raw"))).toEqual([]);
    });

    test("still overwrites its own leftover partial from an earlier attempt", async () => {
      // The partial name is deterministic per file, so a retry has to be able
      // to reuse it — 'wx' must not lock the file out of ever moving again.
      forceCrossDevice();
      const source = _path.join(stagingDir, "reads.fq");
      fs.writeFileSync(source, "ACGTACGT");
      const doc = makeFile(source);
      const dest = _path.join(datastoreRoot, REL_PATH);
      fs.mkdirSync(_path.dirname(dest), { recursive: true });
      fs.writeFileSync(`${dest}.part-${doc._id}`, "STALE");

      await doc.moveToFolderAndSave(REL_PATH);

      expect(fs.readFileSync(dest, "utf8")).toBe("ACGTACGT");
      expect(partialsIn(_path.dirname(dest))).toEqual([]);
    });
  });
});
