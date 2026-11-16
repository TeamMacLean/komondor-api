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

  // init captures BSON before Mongoose can turn strings/numbers into Dates.
  const hasRaw = project.$locals && Object.prototype.hasOwnProperty.call(project.$locals, "rawHpcPreservation");
  const value = hasRaw ? project.$locals.rawHpcPreservation : project.preserveOnHpcUntil;
  const fieldExists = hasRaw ? project.$locals.rawHpcPreservationPresent
    : Object.prototype.hasOwnProperty.call(project, "preserveOnHpcUntil");
  // Deprecated BSON undefined decodes to an own property with JS undefined.
  // Only a genuinely missing field is equivalent to an absent hold.
  if (value === undefined && fieldExists) return invalid;
  if (value === undefined || value === null) {
    return { until: null, active: false, invalid: false };
  }
  try {
    if (!(value instanceof Date)) return invalid;
    const date = parsePreservationDate(value.toISOString());
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

const parseNewPreservationDate = (value, now = Date.now()) => {
  const date = parsePreservationDate(value);
  if (date && (!value.endsWith("T23:59:59.999Z") || date.getTime() <= new Date(now).getTime())) {
    throw new TypeError("Use a future UTC end-of-day timestamp (YYYY-MM-DDT23:59:59.999Z), or null to clear.");
  }
  return date;
};

module.exports = { parsePreservationDate, parseNewPreservationDate, resolveHpcPreservation };
