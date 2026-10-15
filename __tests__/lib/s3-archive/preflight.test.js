const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  RESERVED_TOP_LEVEL_SEGMENTS,
} = require("../../../lib/s3-archive/config");
const { validateProjectRoot } = require("../../../lib/s3-archive/preflight");

const fsp = fs.promises;

describe("archive source-root validation", () => {
  let datastoreRoot;

  beforeAll(async () => {
    // realpath: macOS hands out /var/... symlinks for temporary directories,
    // and the validator requires DATASTORE_ROOT to be its canonical path.
    datastoreRoot = await fsp.realpath(
      await fsp.mkdtemp(path.join(os.tmpdir(), "komondor-preflight-")),
    );
    await fsp.mkdir(path.join(datastoreRoot, "group", "project"), {
      recursive: true,
    });
  });

  afterAll(async () => {
    await fsp.rm(datastoreRoot, { recursive: true, force: true });
  });

  test("accepts an ordinary two-segment project path", async () => {
    await expect(
      validateProjectRoot({ datastoreRoot }, { path: "group/project" }),
    ).resolves.toEqual({
      sourceRoot: path.join(datastoreRoot, "group", "project"),
      sourceRelativeRoot: "group/project",
      exists: true,
    });
  });

  test.each(RESERVED_TOP_LEVEL_SEGMENTS)(
    "refuses a project whose group is the reserved name %s",
    async (segment) => {
      // The refusal must land before any filesystem or S3 work, so that a
      // colliding group can never reach lock.
      await expect(
        validateProjectRoot({ datastoreRoot }, { path: `${segment}/project` }),
      ).rejects.toThrow(/reserved archive prefix/);
    },
  );

  test("allows a reserved name deeper in the path", async () => {
    await fsp.mkdir(path.join(datastoreRoot, "group", "_control"), {
      recursive: true,
    });

    await expect(
      validateProjectRoot({ datastoreRoot }, { path: "group/_control" }),
    ).resolves.toMatchObject({ sourceRelativeRoot: "group/_control" });
  });

  test("still refuses a path that is too shallow or unsafe", async () => {
    await expect(
      validateProjectRoot({ datastoreRoot }, { path: "group" }),
    ).rejects.toThrow(/at least two safe segments/);
    await expect(
      validateProjectRoot({ datastoreRoot }, { path: "group/../../etc" }),
    ).rejects.toThrow(/at least two safe segments/);
  });
});
