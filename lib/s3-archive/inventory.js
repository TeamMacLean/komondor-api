const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { isPartialTransferFile } = require("../active-transfers");
const { Crc64Nvme } = require("../utils/crc64nvme");
const { ArchiveRefusalError } = require("./errors");

const fsp = fs.promises;
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const SNAPSHOT_FIELDS = [
  "type",
  "size",
  "mode",
  "uid",
  "gid",
  "mtimeMs",
  "ctimeMs",
  "dev",
  "ino",
  "nlink",
  "linkTarget",
];

// Fields that identify an entry across processes, hosts and remounts. `dev` is
// deliberately absent: on a network mount st_dev is assigned at mount time, so
// a remount or reboot between sealing and verification would otherwise make
// every sealed entry look replaced and strand the migration. `dev` still takes
// part in the three-pass inventory, which runs inside one process.
const SEALED_IDENTITY_FIELDS = Object.freeze(
  SNAPSHOT_FIELDS.filter((field) => field !== "dev"),
);

const normalizedRelativePath = (value) => {
  // Preserve the filesystem spelling for the S3 key. Callers that correlate
  // with MongoDB normalize a separate comparison key to NFC.
  const normalized = String(value).split(path.sep).join("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0")
  ) {
    throw new ArchiveRefusalError(
      `Unsafe archive entry path: ${JSON.stringify(value)}`,
    );
  }
  return normalized;
};

const typeFor = (stat) => {
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "dir";
  if (stat.isSymbolicLink()) return "symlink";
  return "special";
};

const statSnapshot = (stat, type, linkTarget = null) => ({
  type,
  size: stat.size,
  mode: stat.mode,
  uid: stat.uid,
  gid: stat.gid,
  mtimeMs: stat.mtimeMs,
  ctimeMs: stat.ctimeMs,
  dev: stat.dev,
  ino: stat.ino,
  nlink: stat.nlink,
  linkTarget,
});

const sameSnapshot = (left, right) =>
  SNAPSHOT_FIELDS.every((field) => left[field] === right[field]);

const snapshotDifference = (before, after, fields = SNAPSHOT_FIELDS) => {
  const byPath = new Map(after.map((entry) => [entry.relPath, entry]));
  const differences = [];
  for (const entry of before) {
    const current = byPath.get(entry.relPath);
    if (!current) {
      differences.push({ relPath: entry.relPath, change: "removed" });
      continue;
    }
    const changed = fields.filter((field) => entry[field] !== current[field]);
    if (changed.length) {
      differences.push({
        relPath: entry.relPath,
        change: "changed",
        fields: changed,
      });
    }
    byPath.delete(entry.relPath);
  }
  for (const relPath of byPath.keys()) {
    differences.push({ relPath, change: "added" });
  }
  return differences.sort((a, b) => a.relPath.localeCompare(b.relPath));
};

/** Walk a tree without following any symbolic link. */
const walkTree = async (sourceRoot) => {
  const entries = [];
  let dirCount = 1;

  const walkDirectory = async (absoluteDirectory, relativeDirectory) => {
    const directory = await fsp.opendir(absoluteDirectory);
    let children = 0;
    try {
      for await (const dirent of directory) {
        children += 1;
        if (isPartialTransferFile(dirent.name)) {
          throw new ArchiveRefusalError(
            `Partial transfer blocks archival: ${path.join(absoluteDirectory, dirent.name)}`,
          );
        }

        const relPath = normalizedRelativePath(
          relativeDirectory
            ? `${relativeDirectory}/${dirent.name}`
            : dirent.name,
        );
        const absolutePath = path.join(sourceRoot, ...relPath.split("/"));
        const stat = await fsp.lstat(absolutePath);
        const type = typeFor(stat);
        const linkTarget =
          type === "symlink" ? await fsp.readlink(absolutePath) : null;
        const entry = {
          relPath,
          ...statSnapshot(stat, type, linkTarget),
          disposition: type === "file" ? "copy" : "skip",
          hardLinkGroup:
            type === "file" && stat.nlink > 1
              ? `${stat.dev}:${stat.ino}`
              : null,
        };
        entries.push(entry);

        if (type === "dir") {
          dirCount += 1;
          entry.empty = (await walkDirectory(absolutePath, relPath)) === 0;
        }
      }
    } finally {
      await directory.close().catch(() => {});
    }
    return children;
  };

  await walkDirectory(sourceRoot, "");
  entries.sort((a, b) =>
    Buffer.from(a.relPath).compare(Buffer.from(b.relPath)),
  );
  return { entries, dirCount, entryCount: entries.length };
};

const digestHandle = async (handle) => {
  const sha256 = crypto.createHash("sha256");
  const crc64 = new Crc64Nvme();
  let bytes = 0;
  const stream = handle.createReadStream({ autoClose: false, start: 0 });
  for await (const chunk of stream) {
    bytes += chunk.length;
    sha256.update(chunk);
    crc64.update(chunk);
  }
  return {
    bytes,
    sha256: sha256.digest("hex"),
    crc64nvme: crc64.toBase64(),
  };
};

const openAndHashEntry = async (sourceRoot, entry, exclusions) => {
  const absolutePath = path.join(sourceRoot, ...entry.relPath.split("/"));
  const exclusion =
    exclusions.get(entry.relPath) ||
    exclusions.get(entry.relPath.normalize("NFC"));
  let handle;
  try {
    handle = await fsp.open(absolutePath, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch (error) {
    if (exclusion && ["EACCES", "EIO", "EPERM"].includes(error.code)) {
      return {
        ...entry,
        disposition: "excluded",
        excludedBy: exclusion.by,
        excludedReason: exclusion.reason,
        readError: `${error.code}: ${error.message}`,
      };
    }
    throw new ArchiveRefusalError(
      `Cannot safely read ${entry.relPath}: ${error.code || error.message}`,
    );
  }

  try {
    let digest;
    try {
      const before = await handle.stat();
      if (!sameSnapshot(entry, statSnapshot(before, typeFor(before)))) {
        throw new ArchiveRefusalError(
          `Source changed during inventory: ${entry.relPath}`,
        );
      }
      digest = await digestHandle(handle);
      const after = await handle.stat();
      if (
        !sameSnapshot(entry, statSnapshot(after, typeFor(after))) ||
        digest.bytes !== entry.size
      ) {
        throw new ArchiveRefusalError(
          `Source changed during inventory: ${entry.relPath}`,
        );
      }
    } catch (error) {
      if (
        exclusion &&
        !(error instanceof ArchiveRefusalError) &&
        ["EACCES", "EIO", "EPERM"].includes(error.code)
      ) {
        return {
          ...entry,
          disposition: "excluded",
          excludedBy: exclusion.by,
          excludedReason: exclusion.reason,
          readError: `${error.code}: ${error.message}`,
        };
      }
      throw error;
    }
    if (exclusion) {
      throw new ArchiveRefusalError(
        `Refusing --exclude-entry for readable file: ${entry.relPath}`,
      );
    }
    return { ...entry, ...digest };
  } finally {
    await handle.close();
  }
};

/**
 * Stable three-pass inventory. Exclusions is a Map of NFC relative path to
 * `{reason, by}` and is accepted only when opening a regular file fails.
 */
const createInventory = async (sourceRoot, { exclusions = new Map() } = {}) => {
  const first = await walkTree(sourceRoot);
  const knownPaths = new Set(
    first.entries.flatMap((entry) => [
      entry.relPath,
      entry.relPath.normalize("NFC"),
    ]),
  );
  for (const excludedPath of exclusions.keys()) {
    if (!knownPaths.has(excludedPath)) {
      throw new ArchiveRefusalError(
        `Excluded entry does not exist in the project tree: ${excludedPath}`,
      );
    }
  }

  const entries = [];
  for (const entry of first.entries) {
    entries.push(
      entry.type === "file"
        ? await openAndHashEntry(sourceRoot, entry, exclusions)
        : entry,
    );
  }

  const third = await walkTree(sourceRoot);
  const differences = snapshotDifference(first.entries, third.entries);
  if (differences.length) {
    throw new ArchiveRefusalError(
      "Source tree changed during inventory; rerun the command",
      { differences },
    );
  }

  return {
    entries,
    hpcSnapshot: { dirCount: first.dirCount, entryCount: first.entryCount },
  };
};

const compareTreeToManifest = async (sourceRoot, manifestEntries) => {
  const current = await walkTree(sourceRoot);
  const expected = manifestEntries.map((entry) => {
    const snapshot = { relPath: entry.relPath };
    for (const field of SNAPSHOT_FIELDS) snapshot[field] = entry[field];
    return snapshot;
  });
  // Sealed identity only: the manifest may be days old and the mount may have
  // been re-established since, which changes st_dev but nothing about the file.
  const differences = snapshotDifference(
    expected,
    current.entries,
    SEALED_IDENTITY_FIELDS,
  );
  return {
    matches: differences.length === 0,
    differences,
    snapshot: { dirCount: current.dirCount, entryCount: current.entryCount },
  };
};

module.exports = {
  SEALED_IDENTITY_FIELDS,
  SNAPSHOT_FIELDS,
  compareTreeToManifest,
  createInventory,
  digestHandle,
  normalizedRelativePath,
  sameSnapshot,
  snapshotDifference,
  statSnapshot,
  walkTree,
};
