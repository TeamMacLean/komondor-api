// Canonical UTC timestamps avoid ambiguous dates and Date's calendar rollover.
const parsePreservationDate = (value) => {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new TypeError("Use a UTC ISO timestamp (YYYY-MM-DDTHH:mm:ss.sssZ) or null.");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new TypeError("The HPC preservation date is not a real calendar date.");
  }
  return date;
};

const resolveHpcPreservation = (project, now = Date.now()) => {
  const invalid = { until: null, active: false, invalid: true };
  if (!project || typeof project !== "object") return invalid;
  // Mongoose can omit a malformed stored Date while retaining its cast error.
  if (
    project.$errors?.preserveOnHpcUntil ||
    project.$__?.validationError?.errors?.preserveOnHpcUntil
  ) return invalid;

  const value = project.preserveOnHpcUntil;
  if (value === undefined || value === null) {
    return { until: null, active: false, invalid: false };
  }
  try {
    const date = value instanceof Date
      ? parsePreservationDate(value.toISOString())
      : parsePreservationDate(value);
    const nowMs = new Date(now).getTime();
    if (!Number.isFinite(nowMs)) return invalid;
    return {
      until: date.toISOString(),
      active: nowMs < date.getTime(),
      invalid: false,
    };
  } catch (_error) {
    return invalid;
  }
};

module.exports = { parsePreservationDate, resolveHpcPreservation };
