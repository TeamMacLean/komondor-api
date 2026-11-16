const { resolveHpcPreservation } = require("./hpc-preservation");
const { resolveStorageState } = require("./storage-state");

const retentionYears = (value = process.env.HPC_RETENTION_YEARS ?? 5) => {
  const years = Number(value);
  if (!Number.isSafeInteger(years) || years <= 0) {
    throw new TypeError("HPC_RETENTION_YEARS must be a positive whole number.");
  }
  return years;
};

// Calendar arithmetic in UTC, clamping leap days/month ends instead of rolling
// them into the following month. A year is not a fixed number of milliseconds.
const addUtcMonths = (value, months) => {
  const date = new Date(value);
  if (!Number.isFinite(+date) || !Number.isSafeInteger(months)) {
    throw new TypeError("A valid date and whole number of months are required.");
  }
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const end = new Date(+date);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, end.getUTCDate()));
  if (!Number.isFinite(+date)) throw new TypeError("Retention date is outside the supported calendar.");
  return date;
};

const recordedDate = (value) => {
  if (!value || !(typeof value === "string" || value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(+date) ? date : null;
};

const creationDate = (record) => {
  if (record.createdAt !== undefined && record.createdAt !== null) {
    const date = new Date(record.createdAt);
    if (Number.isFinite(+date)) return date;
  }
  const id = record._id;
  if (id && typeof id.getTimestamp === "function") return id.getTimestamp();
  if (/^[a-f0-9]{24}$/i.test(String(id))) {
    return new Date(parseInt(String(id).slice(0, 8), 16) * 1000);
  }
  return null;
};

const computeRetentionDates = (project, {
  ageBasisAt = creationDate(project),
  now = Date.now(),
  retentionYears: years = retentionYears(),
} = {}) => {
  const age = ageBasisAt == null ? null : new Date(ageBasisAt);
  const archive = age && Number.isFinite(+age) ? addUtcMonths(age, retentionYears(years) * 12) : null;
  const preservation = resolveHpcPreservation(project, now);
  const state = resolveStorageState(project).state;
  let eligible = null;
  if (!preservation.invalid) {
    if (state === "hpc" || state === "migrating") eligible = archive;
    if (state === "aws_pending_hpc_deletion") {
      eligible = recordedDate(project.storage.s3VerifiedAt);
    }
    if (eligible && preservation.until) {
      eligible = new Date(Math.max(+eligible, +new Date(preservation.until)));
    }
  }
  return {
    ageBasisAt: age && Number.isFinite(+age) ? age.toISOString() : null,
    archiveDueAt: archive ? archive.toISOString() : null,
    hpcDeletionEligibleAt: eligible ? eligible.toISOString() : null,
    hpcPreservationInvalid: preservation.invalid,
  };
};

// This is deliberately asynchronous, outside Project.toJSON. Normal model
// queries retain the reconciliation middleware that hides retired records.
const projectRetentionDates = async (project, options = {}) => {
  const Sample = options.Sample || require("../models/Sample");
  const Run = options.Run || require("../models/Run");
  let age = creationDate(project);
  const samples = await Sample.find({ project: project._id }).select("_id").lean();
  if (samples.length) {
    // Sorting by createdAt alone misses old Runs that have no createdAt field.
    const runs = await Run.find({ sample: { $in: samples.map((sample) => sample._id) } })
      .select("_id createdAt").lean();
    for (const run of runs) {
      const created = creationDate(run);
      if (created && (!age || +created > +age)) age = created;
    }
  }
  return computeRetentionDates(project, { ...options, ageBasisAt: age });
};

module.exports = { recordedDate, retentionYears, addUtcMonths, creationDate, computeRetentionDates, projectRetentionDates };
