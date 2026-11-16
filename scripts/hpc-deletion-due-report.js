#!/usr/bin/env node

const fs = require("fs").promises;
const path = require("path");
const { projectRetentionDates, addUtcMonths, retentionYears, recordedDate } = require("../lib/hpc-retention");
const { resolveHpcPreservation } = require("../lib/hpc-preservation");
const { resolveStorageState, relativePathWithinProject } = require("../lib/storage-state");

const COLUMNS = [
  "owner_username", "group_name", "project_name", "project_url", "eligible_from",
  "project_id", "storage_state", "on_aws", "overdue", "hpc_path", "keep_until",
  "keep_requested_by", "keep_reason", "age_basis_at", "notes",
];

const parseArgs = (args) => {
  const options = { withinMonths: 6, email: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (flag === "--email") options.email = true;
    else if (flag === "--help") options.help = true;
    else if (flag === "--out" || flag === "--within-months") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      if (flag === "--out") options.out = value;
      else if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error("--within-months must be a non-negative whole number");
      } else options.withinMonths = Number(value);
    } else throw new Error(`Unknown option: ${flag}`);
  }
  return options;
};

const dateOnly = (value) => value ? new Date(value).toISOString().slice(0, 10) : "";
const csvCell = (value) => {
  let text = String(value ?? "");
  // Project names/reasons are user-entered: don't turn them into spreadsheet
  // formulae when George opens the CSV. The apostrophe is intentional.
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
};
const toCsv = (rows) => [COLUMNS.join(","), ...rows.map((row) => COLUMNS.map((key) => csvCell(row[key])).join(","))].join("\r\n") + "\r\n";

const displayHpcPath = (project, root) => {
  const relative = typeof project.path === "string" ? project.path.replace(/^\//, "") : "";
  const segments = relative.split("/");
  if (segments.length < 2 || segments.some((segment) => !segment || segment === "." || segment === "..") ||
      /[\\\0]/.test(relative) || relativePathWithinProject(project, project.path) !== "") return "";
  return path.posix.join(root, relative);
};

const buildReport = async ({
  Project, Sample, Run, db,
  now = new Date(), withinMonths = 6,
  years = retentionYears(),
  webAppUrl = process.env.WEB_APP_URL,
  readsRoot = process.env.READS_ROOT_PATH || "/tsl/data/reads",
}) => {
  if (!Number.isSafeInteger(withinMonths) || withinMonths < 0) throw new Error("Invalid report window");
  if (!webAppUrl || !/^https?:\/\//.test(webAppUrl)) throw new Error("WEB_APP_URL must be an http(s) URL");
  const nowAt = new Date(now);
  const windowEnd = addUtcMonths(nowAt, withinMonths);
  // Read every active Project, then resolve its lifecycle. Filtering only by
  // known state strings would silently discard corrupt states needing review.
  const projects = await Project.find({}).populate("group", "name").lean();
  // Existing operational ledger, read only. No schema/model initialization on
  // this collection and no new disposition markers or owner contact.
  const ledger = projects.length ? await db.collection("archiveReconciliations").find({
    project: { $in: projects.map((project) => project._id) },
  }, { projection: { project: 1, disposition: 1, executionStatus: 1, entryId: 1 } }).toArray() : [];
  const dispositions = new Map();
  for (const entry of ledger) {
    const key = String(entry.project);
    if (!dispositions.has(key)) dispositions.set(key, []);
    dispositions.get(key).push(entry);
  }
  const rows = [];
  const counts = { overdue: 0, dueWithinWindow: 0, notYetOnAws: 0, keepDatesExpiring: 0, invalid: 0, unknownEligibility: 0 };
  for (const project of projects) {
    const storage = resolveStorageState(project);
    const state = storage.state;
    // Only a valid completed lifecycle is enough to omit the HPC review row.
    if (state === "aws") continue;
    const dates = await projectRetentionDates(project, { Sample, Run, now: nowAt, retentionYears: years });
    const preservation = resolveHpcPreservation(project, nowAt);
    const eligible = dates.hpcDeletionEligibleAt;
    if (eligible && +new Date(eligible) > +windowEnd) continue;
    const onAws = state === "aws_pending_hpc_deletion" &&
      typeof project.storage.s3Uri === "string" && project.storage.s3Uri.startsWith("s3://") &&
      !!recordedDate(project.storage.s3VerifiedAt);
    const overdue = eligible !== null && +new Date(eligible) <= +nowAt;
    const notes = [];
    if (preservation.invalid) { notes.push("invalid keep date"); counts.invalid++; }
    if (!eligible) {
      if (!preservation.invalid) counts.unknownEligibility++;
      const reasons = [];
      if (state === "invalid") {
        reasons.push("invalid storage state; HPC copy presence unknown");
      }
      if (project.storage?.state === "aws_pending_hpc_deletion" && !recordedDate(project.storage.s3VerifiedAt)) {
        reasons.push("verification timestamp missing or unreadable");
      }
      if (["hpc", "migrating"].includes(state) && !dates.ageBasisAt) reasons.push("age basis unavailable");
      notes.push(`eligibility unknown${reasons.length ? ": " + reasons.join("; ") : ""}; administrator review required`);
    }
    for (const entry of dispositions.get(String(project._id)) || []) {
      notes.push(`reconciliation ${entry.entryId || ""}: ${entry.disposition || "unspecified"} (${entry.executionStatus || "unknown"})`);
      if (entry.disposition === "existing-approved-direct-disposal") {
        notes.push("manual disposal without an AWS copy; separate review, not ordinary archive backlog; do not use archive CLI");
      }
    }
    if (!onAws && state !== "invalid" && !notes.some((note) => note.includes("manual disposal"))) {
      notes.push("copy to AWS required before deletion review");
    }
    if (overdue) counts.overdue++;
    else if (eligible) counts.dueWithinWindow++;
    if (!onAws) counts.notYetOnAws++;
    if (preservation.until && +new Date(preservation.until) > +nowAt && +new Date(preservation.until) <= +windowEnd) counts.keepDatesExpiring++;
    rows.push({
      owner_username: project.owner || "", group_name: project.group?.name || "",
      project_name: project.name || "", project_url: `${webAppUrl.replace(/\/+$/, "")}/project?id=${encodeURIComponent(String(project._id))}`,
      eligible_from: dateOnly(eligible), project_id: String(project._id), storage_state: state,
      on_aws: onAws ? "yes" : "no", overdue: overdue ? "yes" : "no",
      hpc_path: state === "invalid" ? "" : displayHpcPath(project, readsRoot), keep_until: dateOnly(preservation.until),
      keep_requested_by: project.hpcPreservationRequestedBy || "", keep_reason: project.hpcPreservationReason || "",
      age_basis_at: dates.ageBasisAt || "", notes: notes.join("; "),
      // Used to order timestamps within a UTC date; omitted by toCsv.
      eligibleAt: eligible,
    });
  }
  rows.sort((a, b) => (a.eligibleAt || "9999").localeCompare(b.eligibleAt || "9999") || a.project_id.localeCompare(b.project_id));
  return { rows, counts, windowEnd: windowEnd.toISOString(), csv: toCsv(rows) };
};

const emailReport = async (report, { sendEmail, recipients = process.env.HPC_DUE_REPORT_TO } = {}) => {
  const to = String(recipients || "").split(",").map((address) => address.trim()).filter(Boolean);
  if (!to.length) throw new Error("HPC_DUE_REPORT_TO must list the report recipient(s)");
  const { counts } = report;
  await sendEmail({
    to,
    subject: `Komondor: ${counts.overdue + counts.dueWithinWindow} projects due for HPC deletion review by ${dateOnly(report.windowEnd)}`,
    message: [
      "This is a review list, not a deletion instruction. Nothing is deleted automatically.",
      `Overdue: ${counts.overdue}`,
      `Due within the window: ${counts.dueWithinWindow}`,
      `Not yet on AWS: ${counts.notYetOnAws}`,
      `Keep dates expiring within the window: ${counts.keepDatesExpiring}`,
      `Invalid keep dates (administrator attention required): ${counts.invalid}`,
      `Eligibility unknown (administrator attention required): ${counts.unknownEligibility}`,
      "The subject counts dated review candidates only. Invalid keep dates and other unknown eligibility rows are attention items, not confirmed due projects.",
      "Other counts can overlap. Unknown eligibility excludes rows already counted as invalid keep dates.",
      "Manual-disposal dispositions in notes require their separate review. Owners are not emailed by this report.",
    ].join("\n"),
    attachments: [{ filename: `hpc-deletion-due-${dateOnly(report.windowEnd)}.csv`, content: report.csv, contentType: "text/csv; charset=utf-8" }],
  });
};

const main = async (args = process.argv.slice(2)) => {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write("Usage: node scripts/hpc-deletion-due-report.js [--within-months 6] [--out file.csv] [--email]\n");
    return;
  }
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
  // Disable implicit schema/index/collection writes BEFORE compiling models.
  const mongoose = require("mongoose");
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  const years = retentionYears();
  if (options.email && !String(process.env.HPC_DUE_REPORT_TO || "").split(",").some((value) => value.trim())) {
    throw new Error("HPC_DUE_REPORT_TO must list the report recipient(s)");
  }
  require("../models/Group");
  const Project = require("../models/Project");
  const Sample = require("../models/Sample");
  const Run = require("../models/Run");
  const { resolveMongoUri } = require("../lib/utils/validateEnv");
  try {
    await mongoose.connect(resolveMongoUri(process.env), {
      autoIndex: false, autoCreate: false, useNewUrlParser: true,
      useUnifiedTopology: true, serverSelectionTimeoutMS: 10000,
    });
    const report = await buildReport({ Project, Sample, Run, db: mongoose.connection.db, ...options, years });
    if (options.out) await fs.writeFile(options.out, report.csv, { encoding: "utf8", flag: "wx", mode: 0o600 });
    else process.stdout.write(report.csv);
    if (options.email) {
      // sendEmail's development/test diagnostics must not corrupt CSV stdout.
      const log = console.log;
      console.log = (...values) => console.error(...values);
      try { await emailReport(report, { sendEmail: require("../lib/utils/sendEmail") }); }
      finally { console.log = log; }
    }
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { parseArgs, buildReport, emailReport, toCsv, displayHpcPath, main };
