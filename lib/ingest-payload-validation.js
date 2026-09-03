"use strict";

// Deliberately model-free. Deployment inspection imports this module before
// connecting to production MongoDB, so loading it must not compile a model or
// register an index. The HTTP route imports the same functions.
const { safeBasename } = require("./utils/safePath");

const fileEntryName = (file) => file && file.name;

const fileEntryShapeError = (file, method, relativePathCovered) => {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return "must be an object";
  }

  const name = fileEntryName(file);
  if (!name || typeof name !== "string") {
    if (file.data && typeof file.data === "object" && file.data.name) {
      return "carries its name under data.name; send it as name";
    }
    return "is missing a name";
  }

  if (
    method !== undefined &&
    !["hpc-mv", "local-filesystem"].includes(method)
  ) {
    return "has an invalid uploadMethod; expected 'hpc-mv' or 'local-filesystem'";
  }

  const canonicalName = safeBasename(file.name);
  if (canonicalName !== file.name) {
    return canonicalName === null
      ? "has a name that is not a usable filename"
      : `has a name that is not a bare filename (send "${canonicalName}")`;
  }

  if (typeof file.sibling === "string") {
    const canonicalSibling = safeBasename(file.sibling);
    if (canonicalSibling !== file.sibling) {
      return canonicalSibling === null
        ? "names a sibling that is not a usable filename"
        : `names a sibling that is not a bare filename (send "${canonicalSibling}")`;
    }
  }

  if (
    method === "local-filesystem" &&
    (!file.uploadName || typeof file.uploadName !== "string")
  ) {
    return "is missing uploadName";
  }

  if (
    file.md5 !== undefined &&
    file.md5 !== null &&
    typeof file.md5 !== "string"
  ) {
    return "has a non-string md5";
  }

  if (
    method === "hpc-mv" &&
    !relativePathCovered &&
    typeof file.relativePath !== "string"
  ) {
    return "is missing relativePath";
  }

  if (file.sibling !== undefined && typeof file.sibling !== "string") {
    return "has a non-string sibling";
  }
  if (file.paired !== undefined && typeof file.paired !== "boolean") {
    return "has a non-boolean paired flag";
  }
  if (file.indexed !== undefined && typeof file.indexed !== "boolean") {
    return "has a non-boolean indexed flag";
  }

  // Reciprocal sibling names are the one relationship language accepted by
  // both clients and the worker. rowID existed only in API tests.
  if (file.rowID !== undefined) {
    return "uses unsupported rowID pairing; send reciprocal sibling names";
  }

  const hasSibling = typeof file.sibling === "string";
  if (file.indexed === true && hasSibling) {
    return "is an indexed read and cannot declare a sibling";
  }
  if (file.paired === true && !hasSibling) {
    return "is marked paired but names no sibling";
  }
  if (file.paired === false && hasSibling) {
    return "names a sibling but is marked unpaired";
  }

  return null;
};

const validateFileList = (
  files,
  label,
  methodFor,
  relativePathCoveredFor,
  { crossEntry = true } = {},
) => {
  if (!Array.isArray(files)) {
    return [
      `${
        label === "Raw file" ? "rawFiles" : "additionalFiles"
      } must be an array`,
    ];
  }

  const errors = [];
  files.forEach((file, index) => {
    const error = fileEntryShapeError(
      file,
      methodFor(file),
      relativePathCoveredFor(file),
    );
    if (error) {
      errors.push(`${label} at index ${index} ${error}`);
    }

    // Additional files never pass through Read pairing finalisation.
    if (
      label === "Additional file" &&
      file &&
      (file.sibling !== undefined || file.paired === true)
    ) {
      errors.push(`${label} at index ${index} cannot declare read pairing`);
    }
  });

  const canonicalNames = files
    .map(fileEntryName)
    .filter((name) => typeof name === "string")
    .map((name) => safeBasename(name) || name);
  const duplicates = [
    ...new Set(
      canonicalNames.filter(
        (name, index) => canonicalNames.indexOf(name) !== index,
      ),
    ),
  ];
  duplicates.forEach((name) => {
    errors.push(`${label} name "${name}" appears more than once`);
  });

  // A partial correction can name one mate. The merged full payload is checked
  // below through validateIngestFilesPayload.
  if (!crossEntry) {
    return errors;
  }

  const byCanonical = new Map();
  files.forEach((file) => {
    const name = fileEntryName(file);
    if (typeof name === "string") {
      byCanonical.set(safeBasename(name) || name, file);
    }
  });
  const present = new Set(byCanonical.keys());

  files.forEach((file, index) => {
    if (!file || typeof file.sibling !== "string") {
      return;
    }
    const own = safeBasename(fileEntryName(file) || "") || fileEntryName(file);
    const sibling = safeBasename(file.sibling) || file.sibling;

    if (sibling === own) {
      errors.push(`${label} at index ${index} names itself as its own sibling`);
      return;
    }
    if (!present.has(sibling)) {
      errors.push(
        `${label} at index ${index} names sibling "${file.sibling}", which is not in the list`,
      );
      return;
    }

    const mate = byCanonical.get(sibling);
    const mateSibling =
      mate && typeof mate.sibling === "string"
        ? safeBasename(mate.sibling) || mate.sibling
        : null;
    if (mateSibling !== own) {
      errors.push(
        `${label} at index ${index} names sibling "${file.sibling}", but "${file.sibling}" does not name it back; pairing must be mutual`,
      );
    }
  });

  return errors;
};

const validatePartialFilesPayload = (body) => {
  const errors = [];

  if (body.rawFiles !== undefined) {
    const rawMethod = body.rawFilesUploadInfo?.method;
    const relativePathCovered =
      typeof body.rawFilesUploadInfo?.relativePath === "string";
    errors.push(
      ...validateFileList(
        body.rawFiles,
        "Raw file",
        () => rawMethod,
        () => relativePathCovered,
        { crossEntry: false },
      ),
    );
  }

  if (body.additionalFiles !== undefined) {
    errors.push(
      ...validateFileList(
        body.additionalFiles,
        "Additional file",
        (file) =>
          file && file.uploadMethod !== undefined
            ? file.uploadMethod
            : "local-filesystem",
        () => false,
        { crossEntry: false },
      ),
    );
  }

  return errors;
};

/**
 * Structural raw-read contract without transport-location requirements.
 * Durable workers use this before touching bytes: upload ownership/path
 * checks still belong to file processing, while names and relationships must
 * be safe even for a stale or directly seeded job.
 */
const validateStoredRawFiles = (rawFiles) => {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return ["At least one raw file is required"];
  }

  return validateFileList(
    rawFiles,
    "Raw file",
    () => undefined,
    () => true,
  );
};

const validateIngestFilesPayload = (body) => {
  const errors = [];

  if (!body.rawFilesUploadInfo || !body.rawFilesUploadInfo.method) {
    errors.push("Upload method is required (rawFilesUploadInfo.method)");
  } else if (
    !["hpc-mv", "local-filesystem"].includes(body.rawFilesUploadInfo.method)
  ) {
    errors.push(
      "Invalid upload method. Must be 'hpc-mv' or 'local-filesystem'",
    );
  }

  if (!Array.isArray(body.rawFiles) || body.rawFiles.length === 0) {
    errors.push("At least one raw file is required");
  } else {
    const rawMethod = body.rawFilesUploadInfo?.method;
    const relativePathCovered =
      typeof body.rawFilesUploadInfo?.relativePath === "string";
    errors.push(
      ...validateFileList(
        body.rawFiles,
        "Raw file",
        () => rawMethod,
        () => relativePathCovered,
      ),
    );
  }

  if (body.additionalFiles !== undefined) {
    errors.push(
      ...validateFileList(
        body.additionalFiles,
        "Additional file",
        (file) =>
          file && file.uploadMethod !== undefined
            ? file.uploadMethod
            : "local-filesystem",
        () => false,
      ),
    );
  }

  return errors;
};

/**
 * Validate raw-file relationship flags against the selected LibraryType.
 * Kept beside the structural payload validator so fresh create, reingest and
 * the worker all enforce the same boundary instead of maintaining three
 * subtly different copies.
 *
 * @param {Array<object>} rawFiles - The complete raw-file payload.
 * @param {{paired?: boolean,indexed?: boolean}} libraryType - Resolved option.
 * @returns {Array<string>} Human-readable contradictions, if any.
 */
const validateRawFilesForLibraryType = (rawFiles, libraryType) => {
  if (!Array.isArray(rawFiles) || !libraryType) {
    return [];
  }

  const errors = [];
  // The HTTP boundary calls the structural validator first, but durable jobs
  // can predate it or be edited directly. Do not let a null/array entry turn a
  // deployment inspection (or worker backstop) into an unrelated TypeError.
  const usableRawFiles = rawFiles.filter(
    (file) => file && typeof file === "object" && !Array.isArray(file),
  );
  const nonIndexReads = usableRawFiles.filter((file) => file.indexed !== true);
  const indexReads = usableRawFiles.filter((file) => file.indexed === true);

  if (
    libraryType.paired === true &&
    (nonIndexReads.length < 2 ||
      nonIndexReads.some((file) => typeof file.sibling !== "string"))
  ) {
    errors.push(
      "A paired library requires every non-index raw file to have a reciprocal sibling",
    );
  }

  if (
    libraryType.paired !== true &&
    usableRawFiles.some((file) => typeof file.sibling === "string")
  ) {
    errors.push("An unpaired library cannot declare sibling reads");
  }

  if (libraryType.indexed === true && indexReads.length === 0) {
    errors.push("An indexed library requires at least one indexed raw file");
  }

  if (libraryType.indexed !== true && indexReads.length > 0) {
    errors.push("A non-indexed library cannot declare indexed raw files");
  }

  return errors;
};

module.exports = {
  validateIngestFilesPayload,
  validatePartialFilesPayload,
  validateRawFilesForLibraryType,
  validateStoredRawFiles,
};
