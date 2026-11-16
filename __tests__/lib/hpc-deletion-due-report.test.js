const { parseArgs, buildReport, emailReport, toCsv, displayHpcPath } = require("../../scripts/hpc-deletion-due-report");
const now = new Date("2026-11-16T12:00:00.000Z");
const base = { _id: "000000000000000000000001", owner: "owner", group: { name: "Group" }, name: "Project", path: "/group/project", createdAt: new Date("2010-01-01Z") };
const query = (values) => ({ select: () => ({ lean: async () => values }) });
const report = (projects, ledger = []) => buildReport({
  Project: { find: () => ({ populate: () => ({ lean: async () => projects }) }) },
  Sample: { find: () => query([]) }, Run: { find: () => query([]) },
  db: { collection: () => ({ find: () => ({ toArray: async () => ledger }) }) },
  now, webAppUrl: "https://example.test/", years: 5,
});

test("CLI options default to a six month stdout report", () => {
  expect(parseArgs([])).toEqual({ withinMonths: 6, email: false });
  expect(parseArgs(["--within-months", "0", "--out", "/tmp/report.csv", "--email"])).toEqual({ withinMonths: 0, out: "/tmp/report.csv", email: true });
});

test.each([["--within-months", "-1"], ["--within-months", "1.2"], ["--out"], ["--email", "--email"], ["--unknown"]])("rejects malformed arguments %j", (...args) => {
  expect(() => parseArgs(args)).toThrow();
});

test("includes overdue and window dates, excludes dates after window, counts invalid separately", async () => {
  const result = await report([
    base,
    { ...base, _id: "2", preserveOnHpcUntil: new Date("2027-01-01T23:59:59.999Z") },
    { ...base, _id: "3", preserveOnHpcUntil: new Date("2027-07-01T23:59:59.999Z") },
    { ...base, _id: "4", preserveOnHpcUntil: "" },
    { ...base, _id: "5", storage: { state: "aws_pending_hpc_deletion", s3Uri: "s3://test/project", s3VerifiedAt: new Date("2026-10-01Z") } },
  ]);
  expect(result.rows.map((row) => row.project_id)).toEqual([base._id, "5", "2", "4"]);
  expect(result.counts).toEqual({ overdue: 2, dueWithinWindow: 1, notYetOnAws: 3, keepDatesExpiring: 1, invalid: 1, unknownEligibility: 0 });
  expect(result.rows[3]).toMatchObject({ eligible_from: "", notes: expect.stringContaining("invalid keep date") });
  expect(result.rows[0]).toMatchObject({ group_name: "Group", hpc_path: "/tsl/data/reads/group/project", project_url: `https://example.test/project?id=${base._id}` });
});

test("manual disposal follows existing reconciliation ledger, not an invented marker", async () => {
  const result = await report([base], [{ project: base._id, disposition: "existing-approved-direct-disposal", executionStatus: "reconciled", entryId: "synthetic-001" }]);
  expect(result.rows[0].notes).toContain("existing-approved-direct-disposal");
  expect(result.rows[0].notes).toContain("manual disposal without an AWS copy");
  expect(result.rows[0].notes).not.toContain("copy to AWS required");
});

test("CSV quotes commas, quotes and line breaks; neutralizes formula cells", () => {
  const csv = toCsv([{ project_name: 'One, "two"\nthree', keep_reason: '=HYPERLINK("x")' }]);
  expect(csv).toContain('"One, ""two""\nthree"');
  expect(csv).toContain('"\'=HYPERLINK(""x"")"');
  expect(csv.split("\r\n")[0].split(",")).toHaveLength(15);
});

test("CSV path matches the page and refuses malformed paths", () => {
  expect(displayHpcPath(base, "/custom/reads")).toBe("/custom/reads/group/project");
  expect(displayHpcPath({ ...base, path: "/group/../project" }, "/reads")).toBe("");
});

test("emails only configured recipients with counts and the CSV attachment", async () => {
  const result = await report([base]);
  const sendEmail = jest.fn();
  await emailReport(result, { sendEmail, recipients: "george@example.test, backup@example.test" });
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: ["george@example.test", "backup@example.test"],
    subject: "Komondor: 1 projects due for HPC deletion review by 2027-05-16",
    message: expect.stringContaining("review list, not a deletion instruction"),
    attachments: [expect.objectContaining({ content: result.csv, contentType: "text/csv; charset=utf-8" })],
  }));
  expect(sendEmail.mock.calls[0][0]).not.toHaveProperty("cc");
  await expect(emailReport(result, { sendEmail, recipients: " , " })).rejects.toThrow(/HPC_DUE_REPORT_TO/);
});


test.each([0, false, {}, "not-a-date"])("invalid verification timestamp %p never counts as verified AWS", async (value) => {
  const result = await report([{ ...base, preserveOnHpcUntil: "invalid", storage: {
    state: "aws_pending_hpc_deletion", s3Uri: "s3://test/project", s3VerifiedAt: value,
  } }]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].on_aws).toBe("no");
});


test("retains corrupt creation dates through ObjectId fallback instead of silently omitting old projects", async () => {
  const _id = require("mongoose").Types.ObjectId.createFromTime(Date.parse("2010-01-01Z") / 1000);
  const result = await report([{ ...base, _id, createdAt: "garbage" }]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ eligible_from: "2015-01-01", age_basis_at: "2010-01-01T00:00:00.000Z", overdue: "yes" });
});

test.each([
  ["missing verification", { storage: { state: "aws_pending_hpc_deletion", s3Uri: "s3://test/project" } }, /verification timestamp/],
  ["numeric verification", { storage: { state: "aws_pending_hpc_deletion", s3Uri: "s3://test/project", s3VerifiedAt: 0 } }, /verification timestamp/],
  ["invalid storage", { storage: { state: "broken" } }, /HPC copy presence unknown/],
  ["invalid aws storage", { storage: { state: "aws" } }, /HPC copy presence unknown/],
  ["missing age basis", { _id: "invalid-id", createdAt: "garbage" }, /age basis/],
])("keeps %s as an undated attention row, never as due", async (_label, changes, reason) => {
  const result = await report([{ ...base, ...changes }]);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ eligible_from: "", overdue: "no", on_aws: "no" });
  expect(result.rows[0].notes).toMatch(/eligibility unknown/);
  expect(result.rows[0].notes).toMatch(reason);
  expect(result.counts).toMatchObject({ overdue: 0, dueWithinWindow: 0, unknownEligibility: 1 });
});

test("email subject counts only due projects while body accounts for invalid and unknown rows", async () => {
  const result = await report([
    base,
    { ...base, _id: "2", preserveOnHpcUntil: "invalid" },
    { ...base, _id: "3", storage: { state: "broken" } },
  ]);
  const sendEmail = jest.fn();
  await emailReport(result, { sendEmail, recipients: "review@example.test" });
  expect(sendEmail.mock.calls[0][0]).toMatchObject({
    subject: "Komondor: 1 projects due for HPC deletion review by 2027-05-16",
    message: expect.stringContaining("Eligibility unknown (administrator attention required): 1"),
  });
  expect(sendEmail.mock.calls[0][0].message).toContain("Invalid keep dates (administrator attention required): 1");
});
