const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {
  parseArgs,
  validateManifest,
  rawDestinationForRun,
  inspectFile,
} = require("../../scripts/inspect-power-submission.cjs");
const incident = require("../../scripts/power-entry-21-2026-09-18.json");
let directory;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "inspect-power-unit-"));
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

test.each(["/group/project/sample/run", "group/project/sample/run"])(
  "compares the logical Run.path %s to a datastore-relative File.path",
  (runPath) => {
    expect(rawDestinationForRun(runPath, "reads.fq.gz")).toBe(
      "group/project/sample/run/raw/reads.fq.gz",
    );
  },
);
test.each([
  undefined,
  "/",
  "/group/../outside",
  "/group/../../outside",
  "group\\outside",
])("rejects missing or unsafe logical run paths (%s)", (runPath) => {
  expect(rawDestinationForRun(runPath, "reads.fq.gz")).toBeNull();
});
test("does not remove an arbitrary datastore prefix from a genuinely different run path", () => {
  expect(rawDestinationForRun("/mnt/reads/group/run", "reads.fq.gz")).toBe(
    "mnt/reads/group/run/raw/reads.fq.gz",
  );
});

test("incident manifest has 24 distinct runs and 48 valid paired reads", () => {
  expect(validateManifest(incident)).toBe(incident);
  expect(incident.runs).toHaveLength(24);
  expect(incident.runs.every((r) => r.reads.length === 2)).toBe(true);
  expect(incident.projectId).toBe("69ea171428866e6f1f6f3f29");
});
test("unknown/mutation options fail instead of silently running", () => {
  expect(() => parseArgs(["--repair"])).toThrow();
  expect(() => parseArgs(["--env"])).toThrow();
  expect(parseArgs(["--hash", "--json", "--env", "prod.env"])).toMatchObject({
    hash: true,
    json: true,
    env: "prod.env",
  });
});
test.each(["../outside", "/absolute/file", "nested/../../outside"])(
  "refuses destination traversal: %s",
  async (relative) => {
    expect((await inspectFile(directory, relative, true)).state).toBe(
      "invalid_relative_path",
    );
  },
);
test("reports absent files and directories without treating them as valid files", async () => {
  expect((await inspectFile(directory, "missing")).state).toBe("missing");
  fs.mkdirSync(path.join(directory, "directory"));
  expect((await inspectFile(directory, "directory")).state).toBe(
    "not_regular_file",
  );
});
test("checks metadata without reading contents by default and hashes on request", async () => {
  const file = path.join(directory, "reads.fq.gz");
  fs.writeFileSync(file, "reads");
  expect(await inspectFile(directory, "reads.fq.gz")).toMatchObject({
    state: "present",
    bytes: 5,
  });
  expect(
    (await inspectFile(directory, "reads.fq.gz")).calculatedMd5,
  ).toBeUndefined();
  expect(
    (await inspectFile(directory, "reads.fq.gz", true)).calculatedMd5,
  ).toBe(crypto.createHash("md5").update("reads").digest("hex"));
  expect(fs.readFileSync(file, "utf8")).toBe("reads");
});
test("refuses symlinks outside the configured root before hashing", async () => {
  fs.mkdirSync(path.join(directory, "root"));
  fs.writeFileSync(path.join(directory, "outside"), "private");
  fs.symlinkSync("../outside", path.join(directory, "root/link"));
  const result = await inspectFile(path.join(directory, "root"), "link", true);
  expect(result.state).toBe("symlink_outside_root");
  expect(result.calculatedMd5).toBeUndefined();
});
test.each(["duplicate-id", "source-traversal", "invalid-md5"])(
  "rejects invalid manifests: %s",
  (kind) => {
    const manifest = JSON.parse(JSON.stringify(incident));
    if (kind === "duplicate-id") manifest.runs[1].id = manifest.runs[0].id;
    if (kind === "source-traversal")
      manifest.runs[0].reads[0].sourcePath =
        manifest.sourcePrefix + "/../outside";
    if (kind === "invalid-md5") manifest.runs[0].reads[0].md5 = "bad";
    expect(() => validateManifest(manifest)).toThrow();
  },
);
