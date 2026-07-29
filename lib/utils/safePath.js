const _path = require("path");

/**
 * Strips leading and trailing slashes from a user-supplied directory name.
 * @param {string} name - The raw directory name.
 * @returns {string} The trimmed name, or "" when the input is not a usable string.
 */
const cleanDirectoryName = (name) => {
  if (typeof name !== "string") {
    return "";
  }

  let result = name.trim();

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

module.exports = {
  cleanDirectoryName,
  isWithin,
  resolveWithin,
  resolveBelow,
};
