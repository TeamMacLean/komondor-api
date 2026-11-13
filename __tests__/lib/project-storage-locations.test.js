const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const { projectStorageLocations } = require("../../lib/project-storage-locations");

const verifiedAt = "2026-10-30T20:18:30.550Z";
const now = () => Date.parse("2026-11-13T12:00:00.000Z");
let root;
const project = (state = "hpc") => ({
  path: "/group/project",
  storage: state === "hpc" ? { state } : {
    state, s3Uri: "s3://bucket/group/project",
    ...(state !== "migrating" ? { s3VerifiedAt: verifiedAt } : {}),
    ...(state === "aws" ? { hpcVerifiedAbsentAt: verifiedAt, archivedAt: verifiedAt } : {}),
  },
});
const observe = (value, options = {}) => projectStorageLocations(value, {
  datastoreRoot: root, readsRoot: "/tsl/data/reads", now, ...options,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "komondor-locations-"));
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));

test.each(["hpc", "migrating", "aws_pending_hpc_deletion", "aws"])(
  "observes the directory independently of %s lifecycle", async (state) => {
    await fs.mkdir(path.join(root, "group/project"), { recursive: true });
    const result = await observe(project(state));
    expect(result.hpc).toEqual({ status: "present", uri: "/tsl/data/reads/group/project", checkedAt: new Date(now()).toISOString(), reason: null });
    expect(result.aws.status).toBe(state === "hpc" ? "not_archived" : state === "migrating" ? "unverified" : "verified");
    expect(result.aws.verifiedAt).toBe(["aws", "aws_pending_hpc_deletion"].includes(state) ? verifiedAt : null);
  },
);

test("pending deletion does not claim HPC presence or infer deletion from a missing path", async () => {
  expect((await observe(project("aws_pending_hpc_deletion"))).hpc).toMatchObject({ status: "unknown", reason: "path_not_found" });
});

test("AWS-only shows dated, recorded absence when the directory is missing", async () => {
  expect((await observe(project("aws"))).hpc).toMatchObject({ status: "absent", checkedAt: verifiedAt, reason: "absence_recorded" });
});

test.each(["/group/../outside", "/group/project/../../", "/", "/group", "//group/project", "/group\\project", "/group/\0project"])(
  "refuses unsafe project paths before filesystem access: %s", async (unsafe) => {
    const filesystem = { realpath: jest.fn() };
    expect((await observe({ ...project(), path: unsafe }, { filesystem })).hpc.status).toBe("unknown");
    expect(filesystem.realpath).not.toHaveBeenCalled();
  },
);

test("refuses a symlink escaping the configured datastore", async () => {
  await fs.mkdir(path.join(root, "group"));
  await fs.symlink(os.tmpdir(), path.join(root, "group/project"));
  expect((await observe(project())).hpc).toMatchObject({ status: "unknown", reason: "path_outside_storage" });
});

test("a file at the project path is not a retained directory", async () => {
  await fs.mkdir(path.join(root, "group"));
  await fs.writeFile(path.join(root, "group/project"), "wrong type");
  expect((await observe(project())).hpc).toMatchObject({ status: "unknown", reason: "not_a_directory" });
});

test("an unavailable datastore never claims HPC absence", async () => {
  const filesystem = { realpath: jest.fn().mockRejectedValue(Object.assign(new Error("permission"), { code: "EACCES" })) };
  expect((await observe(project("aws"), { filesystem })).hpc).toMatchObject({ status: "unknown", reason: "storage_unavailable" });
});

test("invalid lifecycle or mismatched sealed relative root does not probe HPC", async () => {
  const filesystem = { realpath: jest.fn() };
  for (const value of [{ ...project(), storage: { state: "broken" } }, { ...project(), archiveMigration: { sourceRelativeRoot: "other/project" } }]) {
    expect((await observe(value, { filesystem })).hpc.status).toBe("unknown");
  }
  expect(filesystem.realpath).not.toHaveBeenCalled();
});
