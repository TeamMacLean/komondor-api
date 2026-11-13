const fs = require("fs").promises;
const path = require("path");
const { resolveStorageState, relativePathWithinProject } = require("./storage-state");

const isoDate = (value) => {
  if (!value || !(typeof value === "string" || value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/**
 * A small, read-only directory observation for an authorized project page.
 * It does not walk payloads, call AWS, or change archive evidence. S3 status is
 * the recorded verified lifecycle; directory presence is not byte verification.
 */
const projectStorageLocations = async (project, {
  filesystem = fs,
  datastoreRoot = process.env.DATASTORE_ROOT,
  readsRoot = process.env.READS_ROOT_PATH || "/tsl/data/reads",
  now = Date.now,
} = {}) => {
  const state = resolveStorageState(project).state;
  const storage = project?.storage || {};
  const verifiedAt = isoDate(storage.s3VerifiedAt);
  const s3Uri = typeof storage.s3Uri === "string" && storage.s3Uri.startsWith("s3://")
    ? storage.s3Uri : null;
  const aws = { status: "unknown", uri: s3Uri, verifiedAt: null };
  if (["aws", "aws_pending_hpc_deletion"].includes(state) && verifiedAt && s3Uri) {
    Object.assign(aws, { status: "verified", verifiedAt });
  } else if (state === "hpc") {
    aws.status = "not_archived";
  } else if (state === "migrating") {
    aws.status = "unverified";
  }
  const hpc = { status: "unknown", uri: null, checkedAt: null, reason: "invalid_project_path" };
  const result = { hpc, aws };
  const relative = typeof project?.path === "string" ? project.path.replace(/^\//, "") : "";
  const segments = relative.split("/");
  if (state === "invalid" || segments.length < 2 ||
      segments.some((segment) => !segment || segment === "." || segment === "..") ||
      /[\\\0]/.test(relative) || relativePathWithinProject(project, project.path) !== "") return result;

  hpc.uri = path.posix.join(readsRoot, relative);
  hpc.reason = "storage_unavailable";
  if (!datastoreRoot || !path.isAbsolute(datastoreRoot) || path.resolve(datastoreRoot) === path.parse(datastoreRoot).root) return result;
  const checkedAt = new Date(now()).toISOString();
  hpc.checkedAt = checkedAt;
  try {
    const root = await filesystem.realpath(datastoreRoot);
    if (root === path.parse(root).root) return result;
    if (!(await filesystem.stat(root)).isDirectory()) return result;
    const candidate = path.resolve(root, relative);
    if (!within(root, candidate)) return result;
    let actual;
    try {
      actual = await filesystem.realpath(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // An empty/missing mount can make every project look absent. Only show
      // recorded absence when the archive workflow has already confirmed it.
      const absentAt = isoDate(storage.hpcVerifiedAbsentAt);
      if (state === "aws" && absentAt) {
        Object.assign(hpc, { status: "absent", checkedAt: absentAt, reason: "absence_recorded" });
      } else {
        hpc.reason = "path_not_found";
      }
      return result;
    }
    if (!within(root, actual)) {
      hpc.reason = "path_outside_storage";
      return result;
    }
    if (!(await filesystem.stat(actual)).isDirectory()) {
      hpc.reason = "not_a_directory";
      return result;
    }
    Object.assign(hpc, { status: "present", reason: null });
  } catch (_error) {
    // Permission/mount errors must not turn into a false "not on HPC" flag.
    hpc.reason = "storage_unavailable";
  }
  return result;
};

module.exports = { projectStorageLocations };
