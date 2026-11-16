const { ObjectId } = require("mongoose").Types;
const { retentionYears, addUtcMonths, creationDate, computeRetentionDates, projectRetentionDates } = require("../../lib/hpc-retention");
const createdAt = new Date("2020-02-29T12:00:00.000Z");
const project = { _id: new ObjectId(), createdAt };
const now = new Date("2026-11-16T12:00:00.000Z");
const query = (values) => ({ select: () => ({ lean: async () => values }) });

test("age uses calendar years, clamping leap days", () => {
  expect(computeRetentionDates(project).archiveDueAt).toBe("2025-02-28T12:00:00.000Z");
  expect(addUtcMonths("2026-08-31T12:00:00.000Z", 6).toISOString()).toBe("2027-02-28T12:00:00.000Z");
});

test.each([0, -1, "", "x", 1.5, Infinity])("rejects invalid retention years %s", (value) => {
  expect(() => retentionYears(value)).toThrow(/positive whole/);
});

test("retention years has one configurable default", () => {
  const previous = process.env.HPC_RETENTION_YEARS;
  process.env.HPC_RETENTION_YEARS = "7";
  try { expect(computeRetentionDates(project).archiveDueAt).toBe("2027-02-28T12:00:00.000Z"); }
  finally {
    if (previous === undefined) delete process.env.HPC_RETENTION_YEARS;
    else process.env.HPC_RETENTION_YEARS = previous;
  }
});

test("ObjectId timestamps supply missing createdAt values", () => {
  const _id = ObjectId.createFromTime(Date.parse("2019-06-01T00:00:00.000Z") / 1000);
  expect(creationDate({ _id }).toISOString()).toBe("2019-06-01T00:00:00.000Z");
  expect(creationDate({ _id: String(_id) }).toISOString()).toBe("2019-06-01T00:00:00.000Z");
  expect(creationDate({ _id, createdAt }).toISOString()).toBe(createdAt.toISOString());
});

test("uses newest Run through Sample and ObjectId fallback, ignoring Sample age", async () => {
  const Sample = { find: jest.fn(() => query([{ _id: "s1" }])) };
  const Run = { find: jest.fn(() => query([
    { createdAt: new Date("2022-01-01Z") },
    { _id: ObjectId.createFromTime(Date.parse("2023-06-01Z") / 1000) },
    { createdAt: new Date("2018-01-01Z") },
  ])) };
  expect(await projectRetentionDates(project, { Sample, Run, now })).toMatchObject({
    ageBasisAt: "2023-06-01T00:00:00.000Z", archiveDueAt: "2028-06-01T00:00:00.000Z",
  });
  expect(Sample.find).toHaveBeenCalledWith({ project: project._id });
  expect(Run.find).toHaveBeenCalledWith({ sample: { $in: ["s1"] } });
});

test("project creation wins when later than all Runs", async () => {
  const Sample = { find: () => query([{ _id: "s1" }]) };
  const Run = { find: () => query([{ createdAt: new Date("2010-01-01Z") }]) };
  expect((await projectRetentionDates(project, { Sample, Run })).ageBasisAt).toBe(createdAt.toISOString());
});

test.each(["hpc", "migrating"])("%s keep date delays deletion but never archiving", (state) => {
  const result = computeRetentionDates({ ...project,
    storage: state === "migrating" ? { state, s3Uri: "s3://test/project" } : { state },
    preserveOnHpcUntil: new Date("2030-01-01T23:59:59.999Z"),
  });
  expect(result.archiveDueAt).toBe("2025-02-28T12:00:00.000Z");
  expect(result.hpcDeletionEligibleAt).toBe("2030-01-01T23:59:59.999Z");
});

test("verified pending copies use verification time even with a recent Run", () => {
  expect(computeRetentionDates({ ...project, storage: {
    state: "aws_pending_hpc_deletion", s3Uri: "s3://test/project", s3VerifiedAt: new Date("2026-10-01Z"),
  } }, { ageBasisAt: new Date("2026-11-01Z") }).hpcDeletionEligibleAt).toBe("2026-10-01T00:00:00.000Z");
});

test("already removed HPC copies have no deletion date", () => {
  const result = computeRetentionDates({ ...project, storage: { state: "aws", s3Uri: "s3://test/project",
    s3VerifiedAt: now, hpcVerifiedAbsentAt: now, archivedAt: now } });
  expect(result.hpcDeletionEligibleAt).toBeNull();
  expect(result.archiveDueAt).not.toBeNull();
});

test.each(["2027-01-01", "", 0, false, {}, []])("raw invalid keep value %p blocks deletion eligibility", (value) => {
  expect(computeRetentionDates({ ...project, preserveOnHpcUntil: value })).toMatchObject({
    hpcPreservationInvalid: true, hpcDeletionEligibleAt: null,
  });
});


test.each([null, "", 0, false, {}, "not-a-date"])("invalid verification timestamp %p cannot make deletion eligible", (value) => {
  expect(computeRetentionDates({ ...project, storage: {
    state: "aws_pending_hpc_deletion", s3Uri: "s3://test/project", s3VerifiedAt: value,
  } }).hpcDeletionEligibleAt).toBeNull();
});
