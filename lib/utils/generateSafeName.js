/**
 * Converts an arbitrary display name into a filesystem-safe slug.
 * @param {string} unsafeName - The display name.
 * @returns {string} A lowercase name containing only [a-z0-9_].
 */
function toSafeName(unsafeName) {
  if (typeof unsafeName !== "string") {
    throw new TypeError("A name is required to generate a safe name");
  }

  return unsafeName
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase();
}

/**
 * Generates a safe name that does not collide with any in `list`, appending a
 * numeric suffix (`_2`, `_3`, …) until it is unique.
 *
 * @param {string} name - The desired display name.
 * @param {Array<{safeName: string}>} list - Existing records to avoid colliding with.
 * @returns {Promise<string>} The unique safe name.
 */
const generateSafeNameFunc = (name, list) => {
  return new Promise((good, bad) => {
    let safeName;
    try {
      safeName = toSafeName(name);
    } catch (error) {
      bad(error);
      return;
    }

    if (!safeName) {
      bad(new Error(`Could not derive a safe name from "${name}"`));
      return;
    }

    // Records without a safeName cannot collide; comparing them would throw.
    const existing = (Array.isArray(list) ? list : [])
      .filter((entry) => entry && typeof entry.safeName === "string")
      .map((entry) => entry.safeName.toLowerCase());
    const taken = new Set(existing);

    let testName = safeName;
    let testCount = 1;

    // Bounded so a pathological list can never spin forever.
    const MAX_ATTEMPTS = 10000;
    while (taken.has(testName.toLowerCase())) {
      testCount += 1;
      if (testCount > MAX_ATTEMPTS) {
        bad(
          new Error(
            `Could not generate a unique safe name for "${name}" after ${MAX_ATTEMPTS} attempts`,
          ),
        );
        return;
      }
      testName = safeName + "_" + testCount;
    }

    good(testName);
  });
};

module.exports = {
  default: generateSafeNameFunc,
  toSafeName,
};
