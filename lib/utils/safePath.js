const _path = require("path");
const fs = require("fs").promises;

/**
 * True when `value` carries a C0 control character or DEL.
 *
 * A control character in a filename is never legitimate, and rejecting one
 * here is cheaper than escaping it in every consumer. Three separate problems
 * share this one cause:
 *
 *   - NUL truncates the path at the syscall boundary, so "safe.txt\0../../etc"
 *     is opened as "safe.txt" by the kernel while every JavaScript-level guard
 *     saw the longer string;
 *   - a newline or carriage return splits any single-line log record the name
 *     is interpolated into. lib/utils/hpcAudit.js quotes its fields so the
 *     audit trail itself is no longer forgeable, but the refusal diagnostics in
 *     routes/read-file.js and routes/directory-files.js are plain
 *     console.error lines and are not escaped;
 *   - the rest of the C0 range and DEL reach anything that renders a filename —
 *     a terminal, `File.name` in a web client — as escape sequences.
 *
 * Refusing upstream stops all three in every consumer at once, which is why
 * this is not solved at the sinks.
 *
 * @param {string} value - The string to test.
 * @returns {boolean} True if a control character is present.
 */
const hasControlCharacter = (value) =>
  // The C0 range plus DEL. Written as an explicit range rather than \p{Cc} so
  // it does not depend on the unicode flag, and deliberately not extended to
  // C1 (\u0080-\u009f): those are legitimate bytes in a non-UTF-8 filename.
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f]/.test(value);

/**
 * Strips leading and trailing slashes from a user-supplied directory name.
 *
 * Two different falsy answers, and the difference is load-bearing:
 *
 *   - `""` — nothing usable was supplied. That includes a non-string, and it
 *     includes "/" , which strips to nothing and legitimately means "the root
 *     itself". Callers that need a *named* target already test for falsiness;
 *     callers that do not are joining against a root, where "" is the correct
 *     no-op segment.
 *   - `null` — the name was actively refused, because it carries an interior
 *     control character (see {@link hasControlCharacter}).
 *
 * Refusal must not collapse into `""`. `resolveWithin(root, "")` resolves to
 * the root and succeeds, so returning "" for a hostile name would turn a
 * rejection into a silent normalisation: "WGS_Test\0/01.RawData" would stop
 * being refused and start meaning "the transfer root". `null` is not a string,
 * so `resolveWithin`/`resolveWithinReal` refuse it as a segment and every
 * consumer fails closed without a check of its own. Both values are falsy, so
 * the callers that do check keep working unchanged.
 *
 * Trimming still removes leading and trailing whitespace — a stray newline at
 * either end included — so only a control character a trim cannot reach is
 * treated as hostile.
 *
 * @param {string} name - The raw directory name.
 * @returns {string|null} The trimmed name, "" when nothing usable was supplied,
 *   or null when the name was refused.
 */
const cleanDirectoryName = (name) => {
  if (typeof name !== "string") {
    return "";
  }

  let result = name.trim();

  if (hasControlCharacter(result)) {
    return null;
  }

  while (result.startsWith("/")) {
    result = result.slice(1);
  }
  while (result.endsWith("/")) {
    result = result.slice(0, -1);
  }

  return result;
};

/**
 * Returns true when `candidate` is `root` itself or sits underneath it.
 *
 * A plain `candidate.startsWith(root)` test is not sufficient: with a root of
 * "/data/uploads" it also accepts "/data/uploads-elsewhere". Comparing against
 * `root + path.sep` avoids that.
 *
 * @param {string} root - The absolute containing directory.
 * @param {string} candidate - The absolute path to test.
 * @returns {boolean} True if candidate is contained by root.
 */
const isWithin = (root, candidate) => {
  if (typeof root !== "string" || typeof candidate !== "string") {
    return false;
  }

  const resolvedRoot = _path.resolve(root);
  const resolvedCandidate = _path.resolve(candidate);

  if (resolvedCandidate === resolvedRoot) {
    return true;
  }

  const rootWithSep = resolvedRoot.endsWith(_path.sep)
    ? resolvedRoot
    : resolvedRoot + _path.sep;

  return resolvedCandidate.startsWith(rootWithSep);
};

/**
 * Resolves user-supplied path segments against a trusted root, refusing anything
 * that escapes it.
 *
 * Guards against two distinct attacks:
 *   - traversal: a segment of "../../etc" walking above the root;
 *   - absolute override: `path.resolve("/data", "/etc/passwd")` discards the
 *     root entirely and yields "/etc/passwd".
 *
 * @param {string} root - The trusted absolute root directory.
 * @param {...string} segments - Untrusted path segments.
 * @returns {string|null} The resolved absolute path, or null if it escapes the
 *   root or the root is not configured.
 */
const resolveWithin = (root, ...segments) => {
  if (typeof root !== "string" || root.trim() === "") {
    return null;
  }

  const resolvedRoot = _path.resolve(root);

  for (const segment of segments) {
    if (typeof segment !== "string") {
      return null;
    }
    // A NUL byte truncates the path at the syscall boundary.
    if (segment.includes("\0")) {
      return null;
    }
    // An absolute segment would discard the root in path.resolve.
    if (_path.isAbsolute(segment)) {
      return null;
    }
  }

  const candidate = _path.resolve(resolvedRoot, ...segments);

  return isWithin(resolvedRoot, candidate) ? candidate : null;
};

/**
 * Like {@link resolveWithin}, but additionally refuses a path that resolves to
 * the root itself.
 *
 * Callers that list or read a *named* target must not be able to address the
 * root by supplying a name that normalises away — ".", "./", "a/.." and
 * friends all resolve back to the root and would otherwise expose its whole
 * contents.
 *
 * @param {string} root - The trusted absolute root directory.
 * @param {...string} segments - Untrusted path segments.
 * @returns {string|null} The resolved absolute path, or null if it escapes the
 *   root or is the root itself.
 */
const resolveBelow = (root, ...segments) => {
  const resolved = resolveWithin(root, ...segments);

  if (resolved === null) {
    return null;
  }

  return resolved === _path.resolve(root) ? null : resolved;
};

/**
 * Reduces a user-supplied filename to a bare basename, refusing anything that
 * carried a directory component.
 *
 * The lexical guards above only hold if the *filename* is a filename. A request
 * body that calls its file "../../../etc/cron.d/payload" turns any join into a
 * traversal, so names coming off the wire are collapsed here before they are
 * used to build a path.
 *
 * @param {string} name - The raw, untrusted filename.
 * @returns {string|null} The basename, or null when the value is unusable.
 */
const safeBasename = (name) => {
  if (typeof name !== "string") {
    return null;
  }
  // A NUL byte truncates the path at the syscall boundary.
  if (name.includes("\0")) {
    return null;
  }

  const trimmed = name.trim();

  // "" has no name at all; "." and ".." address a directory, not a file.
  if (trimmed === "" || trimmed === "." || trimmed === "..") {
    return null;
  }

  // Any other control character, for the reasons in hasControlCharacter. The
  // NUL check above is kept because it runs before the trim and states its own
  // reason; this catches the rest of the C0 range and DEL.
  if (hasControlCharacter(trimmed)) {
    return null;
  }

  // Backslashes are rejected on POSIX hosts too. path.basename() there treats
  // "..\\..\\etc\\passwd" as one long filename, so the separators would survive
  // into the datastore and be split again by any Windows or SMB client reading
  // it back.
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }

  const base = _path.basename(trimmed);

  return base === trimmed ? base : null;
};

/**
 * Resolves `candidate` through any symlinks, tolerating a path that does not
 * exist yet.
 *
 * realpath() fails outright on a path whose last components are still to be
 * created, which is every destination we are about to write. Walking up to the
 * nearest existing ancestor, resolving *that*, and re-appending the rest gives
 * the real location the write would land in.
 *
 * @param {string} candidate - An absolute path, existing or not.
 * @returns {Promise<string|null>} The resolved path, or null if it cannot be
 *   trusted (a dangling symlink, a symlink loop, a permission error).
 */
const realpathOfNearestExisting = async (candidate) => {
  let current = _path.resolve(candidate);
  const missing = [];

  for (;;) {
    try {
      const real = await fs.realpath(current);
      return missing.length > 0 ? _path.join(real, ...missing) : real;
    } catch (err) {
      // Anything other than "not there yet" — ELOOP, EACCES — means we cannot
      // say where this path really points, so it does not get the benefit of
      // the doubt.
      if (err.code !== "ENOENT") {
        return null;
      }

      // realpath() also reports ENOENT for a symlink whose target is missing.
      // lstat() separates the two: a dangling symlink must be refused, because
      // a later create would follow it and write wherever it points.
      const exists = await fs
        .lstat(current)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        return null;
      }

      const parent = _path.dirname(current);
      if (parent === current) {
        // Walked all the way to the filesystem root without finding anything.
        return null;
      }

      missing.unshift(_path.basename(current));
      current = parent;
    }
  }
};

/**
 * Like {@link resolveWithin}, but also defeats symlink escapes.
 *
 * The lexical check alone is satisfied by "<root>/link/passwd" even when `link`
 * is a symlink to /etc — the string never leaves the root, but the write does.
 *
 * Returns the *lexical* path, not the resolved one, so callers write to the
 * location they expect (and the stored document keeps naming it) rather than to
 * a realpath that may differ, e.g. /var vs /private/var on macOS.
 *
 * @param {string} root - The trusted absolute root directory.
 * @param {...string} segments - Untrusted path segments.
 * @returns {Promise<string|null>} The resolved absolute path, or null if it
 *   escapes the root or the root itself does not exist.
 */
const resolveWithinReal = async (root, ...segments) => {
  const candidate = resolveWithin(root, ...segments);
  if (candidate === null) {
    return null;
  }

  const realRoot = await fs.realpath(_path.resolve(root)).catch(() => null);
  if (realRoot === null) {
    return null;
  }

  const realCandidate = await realpathOfNearestExisting(candidate);
  if (realCandidate === null) {
    return null;
  }

  if (isWithin(realRoot, realCandidate)) {
    return candidate;
  }

  // Symlinking a big file or a whole project directory into the staging area,
  // rather than copying terabytes, is ordinary practice on a cluster. Refusing
  // every link that leaves the root broke that. A link may leave, but only into
  // a storage root an operator has named.
  return (await isWithinPermittedLinkRoot(realCandidate)) ? candidate : null;
};

/**
 * Storage roots a symlink inside a managed directory is allowed to point into.
 * Colon-separated absolute paths, e.g. "/scratch:/projects".
 *
 * @returns {string[]} The configured roots, or [] when none are set.
 */
const permittedLinkRoots = () =>
  (process.env.ALLOWED_LINK_ROOTS || "")
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => _path.isAbsolute(entry));

/**
 * Whether a resolved path sits inside one of the configured link roots.
 *
 * Each configured root is realpath'd before comparing: a root reached through a
 * symlink itself ("/scratch" -> "/mnt/scratch") would never match otherwise, and
 * would fail silently as a refusal.
 *
 * @param {string} realCandidate - An already-realpath'd absolute path.
 * @returns {Promise<boolean>} True if an operator has permitted this location.
 */
const isWithinPermittedLinkRoot = async (realCandidate) => {
  for (const allowed of permittedLinkRoots()) {
    const realAllowed = await fs
      .realpath(_path.resolve(allowed))
      .catch(() => null);
    if (realAllowed !== null && isWithin(realAllowed, realCandidate)) {
      return true;
    }
  }
  return false;
};

/**
 * Symlink-aware containment check for a path that has already been assembled.
 *
 * For paths that arrive whole — a stored document's own `path`, say — where
 * there are no untrusted segments left to resolve, only a location to vouch
 * for.
 *
 * @param {string} root - The trusted absolute root directory.
 * @param {string} candidate - The absolute path to test.
 * @returns {Promise<boolean>} True if candidate really sits under root.
 */
const assertWithinReal = async (root, candidate) => {
  if (typeof root !== "string" || root.trim() === "") {
    return false;
  }
  if (typeof candidate !== "string" || candidate.trim() === "") {
    return false;
  }
  if (candidate.includes("\0")) {
    return false;
  }

  // Cheap lexical reject first: no point stat-ing a path that is already out.
  if (!isWithin(root, candidate)) {
    return false;
  }

  const realRoot = await fs.realpath(_path.resolve(root)).catch(() => null);
  if (realRoot === null) {
    return false;
  }

  const realCandidate = await realpathOfNearestExisting(candidate);
  if (realCandidate === null) {
    return false;
  }

  // Same allowance as resolveWithinReal: a source may be a symlink into a
  // storage root an operator has named.
  return (
    isWithin(realRoot, realCandidate) ||
    (await isWithinPermittedLinkRoot(realCandidate))
  );
};

module.exports = {
  permittedLinkRoots,
  isWithinPermittedLinkRoot,
  hasControlCharacter,
  cleanDirectoryName,
  isWithin,
  resolveWithin,
  resolveBelow,
  safeBasename,
  resolveWithinReal,
  assertWithinReal,
};
