/**
 * Project.displayOnSite against a real MongoDB and the real routers.
 *
 * The flag is set the way the runbook sets it (docs/PROJECT_SITE_VISIBILITY.md):
 * a raw, narrowly filtered collection update, never through the API. Every
 * other write here is either a route under test or a fixture save.
 *
 * Only authentication is replaced; group access, the visibility helpers and
 * every model hook are real.
 */

const express = require("express");
const request = require("supertest");
const mongo = require("./support/mongo");
const { configureEnv, restoreEnv } = require("./support/env");

let mockUser = null;
jest.mock("../../routes/middleware", () => {
  const actual = jest.requireActual("../../routes/middleware");
  return {
    ...actual,
    isAuthenticated: (req, res, next) => {
      if (!mockUser) return res.status(401).send({ error: "Authentication required" });
      req.user = mockUser;
      return next();
    },
  };
});
// Creation emails are irrelevant here and would try to reach SMTP.
jest.mock("../../lib/utils/sendOverseerEmail", () => jest.fn().mockResolvedValue(true));

let configured;
let app;
let fixtures;
let Project;
let Sample;
let Run;
let NewsItem;

const ObjectId = () => mongo.mongoose.Types.ObjectId;
const db = () => mongo.mongoose.connection.db;
const raw = (collection, id) => db().collection(collection).findOne({ _id: id });

const admin = { username: "deeks", isAdmin: true };
let member;
let outsider;

// The fixture graph, rebuilt before each test.
let groupA;
let groupB;
let legacy; // no displayOnSite field at all
let shown; // explicit displayOnSite: true
let hidden; // explicit displayOnSite: false
let otherGroup; // displayOnSite: true, in a group the member cannot read
let legacySample;
let legacyRun;
let hiddenSample;
let hiddenRun;
let hiddenBefore; // raw hidden Project, just before it was hidden

const as = (user) => {
  mockUser = user;
  const agent = {
    get: (url) => request(app).get(url),
    post: (url) => request(app).post(url),
    put: (url) => request(app).put(url),
  };
  return agent;
};

const ids = (records) => (records || []).map((record) => String(record._id));

/**
 * Hides a Project exactly as the runbook's mongosh snippet does: exact id,
 * expected identity and expected current value in the filter.
 */
const hideLikeRunbook = async (project) => {
  const result = await db().collection("projects").updateOne(
    {
      _id: project._id,
      name: project.name,
      path: project.path,
      displayOnSite: { $exists: false },
    },
    { $set: { displayOnSite: false } },
  );
  expect(result.matchedCount).toBe(1);
  expect(result.modifiedCount).toBe(1);
};

beforeAll(async () => {
  // The suite empties collections: refuse anything but a loopback scratch DB.
  const uri = new URL(process.env.MONGODB_URI || "mongodb://invalid/invalid");
  if (
    uri.protocol !== "mongodb:" ||
    !["localhost", "127.0.0.1"].includes(uri.hostname) ||
    uri.username ||
    uri.password ||
    !/^(komondor-ci|komondor-integration-test)$/.test(uri.pathname.slice(1))
  ) {
    throw new Error("Site visibility integration tests require a loopback scratch database.");
  }

  configured = await configureEnv("site-visibility");
  await mongo.connect();

  fixtures = require("./support/fixtures");
  Project = require("../../models/Project");
  Sample = require("../../models/Sample");
  Run = require("../../models/Run");
  NewsItem = require("../../models/NewsItem");
  await Project.init(); // the unique name index is part of what is tested

  app = express();
  app.use(express.json());
  for (const router of ["projects", "samples", "runs", "search", "users", "news", "accessions"]) {
    app.use(require(`../../routes/${router}`));
  }
});

afterAll(async () => {
  await mongo.disconnect();
  await restoreEnv(configured);
});

beforeEach(async () => {
  await mongo.resetCollections();
  delete process.env.FULL_RECORDS_ACCESS_USERS;

  groupA = await fixtures.makeGroup();
  groupB = await fixtures.makeGroup();
  member = { username: "member", groups: [String(groupA._id)] };
  outsider = { username: "outsider", groups: [String(groupB._id)] };

  legacy = await fixtures.makeProject(groupA, { name: "sitevis legacy", owner: "alice" });
  shown = await fixtures.makeProject(groupA, { name: "sitevis shown", owner: "alice" });
  // An old id makes this Project overdue in the retention report below.
  hidden = await fixtures.makeProject(groupA, {
    _id: ObjectId().createFromTime(Date.parse("2010-01-01T00:00:00Z") / 1000),
    name: "sitevis hidden",
    owner: "alice",
  });
  otherGroup = await fixtures.makeProject(groupB, { name: "sitevis other group", owner: "alice" });

  legacySample = await fixtures.makeSample(legacy, groupA, { name: "sitevis legacy sample" });
  legacyRun = await fixtures.makeRun(legacySample, groupA, { name: "sitevis legacy run" });
  hiddenSample = await fixtures.makeSample(hidden, groupA, { name: "sitevis hidden sample" });
  hiddenRun = await fixtures.makeRun(hiddenSample, groupA, { name: "sitevis hidden run" });

  // Operational state the flag must never disturb.
  await db().collection("projects").updateOne(
    { _id: hidden._id },
    {
      $set: {
        storage: { state: "hpc" },
        preserveOnHpcUntil: new Date("2030-01-31T23:59:59.999Z"),
        hpcPreservationRequestedBy: "Owner",
        hpcPreservationReason: "Ongoing analysis",
        accessions: ["PRJEB0001"],
      },
    },
  );
  await db().collection("projects").updateOne({ _id: shown._id }, { $set: { displayOnSite: true } });
  await db().collection("projects").updateOne({ _id: otherGroup._id }, { $set: { displayOnSite: true } });

  hiddenBefore = await raw("projects", hidden._id);
  await hideLikeRunbook(hidden);
});

describe("lists, search, profiles and news", () => {
  test("missing and true are visible; only an explicit false is hidden", async () => {
    const res = await as(member).get("/projects");

    expect(res.status).toBe(200);
    expect(ids(res.body.projects).sort()).toEqual([String(legacy._id), String(shown._id)].sort());
  });

  test("displayOnSite: true grants nothing outside the caller's groups", async () => {
    const list = await as(member).get("/projects");
    expect(ids(list.body.projects)).not.toContain(String(otherGroup._id));

    const direct = await as(member).get(`/project?id=${otherGroup._id}`);
    expect(direct.status).toBe(403);

    const theirs = await as(outsider).get("/projects");
    expect(ids(theirs.body.projects)).toEqual([String(otherGroup._id)]);
  });

  test("ordinary admin browsing hides the project too", async () => {
    const res = await as(admin).get("/projects");

    expect(ids(res.body.projects).sort()).toEqual(
      [String(legacy._id), String(shown._id), String(otherGroup._id)].sort(),
    );
  });

  test("samples and runs under it leave their lists", async () => {
    const samples = await as(admin).get("/samples");
    const runs = await as(admin).get("/runs");

    expect(ids(samples.body.samples)).toEqual([String(legacySample._id)]);
    expect(ids(runs.body.runs)).toEqual([String(legacyRun._id)]);
  });

  test("search and autocomplete omit it and its descendants", async () => {
    const all = await as(admin).get("/search?query=sitevis");
    expect(all.status).toBe(200);
    const { projects, samples, runs } = all.body.results;
    expect(ids(projects)).not.toContain(String(hidden._id));
    expect(ids(projects)).toContain(String(legacy._id));
    expect(ids(samples)).toEqual([String(legacySample._id)]);
    expect(ids(runs)).toEqual([String(legacyRun._id)]);

    for (const [path, id] of [
      ["/search/project", hidden._id],
      ["/search/sample", hiddenSample._id],
      ["/search/run", hiddenRun._id],
    ]) {
      const res = await as(admin).get(`${path}?query=hidden`);
      expect(res.status).toBe(200);
      expect(res.body.error).toBeUndefined();
      expect(ids(res.body.results)).not.toContain(String(id));
      expect(res.body.results).toHaveLength(0);
    }
  });

  test("user profiles leave it out of the owner's project list", async () => {
    const res = await as(admin).get("/user?username=alice");

    expect(ids(res.body.user.projects)).not.toContain(String(hidden._id));
    expect(ids(res.body.user.projects)).toContain(String(legacy._id));
  });

  test("news drops items about it and its samples and runs", async () => {
    // The save hooks really did record them.
    expect(await NewsItem.countDocuments({ typeId: String(hidden._id) })).toBe(1);
    expect(await NewsItem.countDocuments({ typeId: String(hiddenSample._id) })).toBe(1);
    expect(await NewsItem.countDocuments({ typeId: String(hiddenRun._id) })).toBe(1);

    const res = await as(admin).get("/news");
    const shownIds = res.body.news.map((item) => String(item.link.query.id));

    expect(shownIds).toEqual(expect.arrayContaining([String(legacy._id), String(legacyRun._id)]));
    for (const id of [hidden._id, hiddenSample._id, hiddenRun._id]) {
      expect(shownIds).not.toContain(String(id));
    }
  });
});

describe("direct requests answer as for a missing record", () => {
  test("project, sample and run detail are the ordinary 404", async () => {
    const missing = new (ObjectId())();
    const cases = [
      [`/project?id=${hidden._id}`, `/project?id=${missing}`],
      [`/sample?id=${hiddenSample._id}`, `/sample?id=${missing}`],
      [`/run?id=${hiddenRun._id}`, `/run?id=${missing}`],
      [`/runs/${hiddenRun._id}/status`, `/runs/${missing}/status`],
      [`/samples/names/${hidden._id}`, `/samples/names/${missing}`],
      [`/runs/names/${hiddenSample._id}`, `/runs/names/${missing}`],
    ];
    for (const user of [admin, member]) {
      for (const [hiddenUrl, missingUrl] of cases) {
        const [a, b] = [await as(user).get(hiddenUrl), await as(user).get(missingUrl)];
        expect([hiddenUrl, a.status]).toEqual([hiddenUrl, 404]);
        expect(a.body.error).toBe(b.body.error);
        // No file locations, paths or names escape in the refusal.
        const body = JSON.stringify(a.body);
        expect(body).not.toContain(hidden.path);
        expect(body).not.toContain("sitevis hidden");
      }
    }
  });

  test("visible detail still carries its file location", async () => {
    const res = await as(member).get(`/run?id=${legacyRun._id}`);

    expect(res.status).toBe(200);
    expect(res.body.location).toBeTruthy();
  });

  test("batch status reports the hidden run as missing", async () => {
    const res = await as(admin)
      .post("/runs/batch-status")
      .send({ runIds: [String(hiddenRun._id), String(legacyRun._id)] });

    expect(res.status).toBe(200);
    expect(res.body.runs.map((run) => String(run.runId))).toEqual([String(legacyRun._id)]);
    expect(res.body.missing).toEqual([String(hiddenRun._id)]);
  });
});

describe("no new or changed descendants under a hidden project", () => {
  test("sample creation is refused, even for an existing name", async () => {
    for (const name of ["brand new sample", hiddenSample.name]) {
      const res = await as(member).post("/samples/new").send({
        project: String(hidden._id),
        group: String(groupA._id),
        name,
        scientificName: "Homo sapiens",
        commonName: "human",
        ncbi: "9606",
        conditions: "control",
      });
      expect(res.status).toBe(404);
      expect(res.body.idempotent).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(String(hiddenSample._id));
    }
    expect(await Sample.countDocuments({ project: hidden._id })).toBe(1);
  });

  test("run creation is refused as for a sample that does not exist", async () => {
    const res = await as(member).post("/runs/new").send({
      sample: String(hiddenSample._id),
      group: String(groupA._id),
      name: hiddenRun.name,
      sequencingProvider: "in-house",
      sequencingTechnology: "illumina",
      librarySource: "genomic",
      libraryType: "FASTQ - Single",
      librarySelection: "random",
      libraryStrategy: "wgs",
      owner: "member",
      rawFilesUploadInfo: { method: "hpc-mv", relativePath: "member/inbox" },
      rawFiles: [{ name: "r1.fastq.gz" }],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("The submitted sample does not exist.");
    expect(await Run.countDocuments({ sample: hiddenSample._id })).toBe(1);
  });

  test("reingest and nudgeable toggles are refused without writing", async () => {
    const runBefore = await raw("runs", hiddenRun._id);

    const reingest = await as(admin).post(`/runs/${hiddenRun._id}/reingest`).send({});
    expect(reingest.status).toBe(404);
    expect(await raw("runs", hiddenRun._id)).toEqual(runBefore);

    const toggle = await as(admin)
      .put("/project/toggle-nudgeable")
      .send({ _id: String(hidden._id), nudgeable: false });
    expect(toggle.status).toBe(404);
    expect((await raw("projects", hidden._id)).nudgeable).toBe(hiddenBefore.nudgeable);
  });
});

describe("ENA export and accession writes", () => {
  test("the accessions CSV leaves out hidden runs", async () => {
    const res = await as(admin).get("/accessions/csv");

    expect(res.status).toBe(200);
    expect(res.body.csv).toContain(String(legacyRun._id));
    expect(res.body.csv).not.toContain(String(hiddenRun._id));
    expect(res.body.csv).not.toContain(String(hidden._id));
  });

  test("accession writes to hidden records answer 404 and change nothing", async () => {
    for (const [type, record, collection] of [
      ["project", hidden, "projects"],
      ["sample", hiddenSample, "samples"],
      ["run", hiddenRun, "runs"],
    ]) {
      const before = await raw(collection, record._id);
      const res = await as(admin)
        .post("/accessions/new")
        .send({ type, typeId: String(record._id), accessions: ["ERX999"] });
      expect([type, res.status]).toEqual([type, 404]);
      expect(await raw(collection, record._id)).toEqual(before);
    }
  });
});

describe("name uniqueness without disclosure", () => {
  test("/projects/names withholds hidden names", async () => {
    const res = await as(member).get("/projects/names");

    expect(res.body.projectNames).toEqual(expect.arrayContaining(["sitevis legacy", "sitevis shown"]));
    expect(res.body.projectNames).not.toContain("sitevis hidden");
  });

  test("a clash with a hidden name is the same generic 409 as a visible clash", async () => {
    const create = (name) =>
      as(member).post("/projects/new").send({
        name,
        group: String(groupA._id),
        shortDesc: "short",
        longDesc: "long",
      });

    const hiddenClash = await create("sitevis hidden");
    const visibleClash = await create("sitevis legacy");

    expect(hiddenClash.status).toBe(409);
    expect(hiddenClash.body).toEqual(visibleClash.body);
    expect(hiddenClash.body.code).toBe("PROJECT_NAME_UNAVAILABLE");
    const body = JSON.stringify(hiddenClash.body);
    for (const secret of [String(hidden._id), hidden.path, "alice", String(groupA._id), "E11000"]) {
      expect(body).not.toContain(secret);
    }
    expect(await Project.countDocuments({ name: "sitevis hidden" })).toBe(1);
    expect(await raw("projects", hidden._id)).toEqual({ ...hiddenBefore, displayOnSite: false });
  });
});

describe("request bodies cannot set the flag", () => {
  test.each([[false], [true], ["false"], [0], [{ $ne: null }]])(
    "POST /projects/new ignores displayOnSite %p",
    async (value) => {
      const res = await as(member).post("/projects/new").send({
        name: `sitevis body ${JSON.stringify(value)}`,
        group: String(groupA._id),
        shortDesc: "short",
        longDesc: "long",
        displayOnSite: value,
      });

      expect(res.status).toBe(201);
      const stored = await raw("projects", new (ObjectId())(res.body.project._id));
      expect(stored).not.toHaveProperty("displayOnSite");
    },
  );

  test("sample creation and nudgeable toggles leave the parent's flag alone", async () => {
    const sample = await as(member).post("/samples/new").send({
      project: String(legacy._id),
      group: String(groupA._id),
      name: "sitevis body sample",
      scientificName: "Homo sapiens",
      commonName: "human",
      ncbi: "9606",
      conditions: "control",
      displayOnSite: false,
    });
    expect(sample.status).toBe(201);
    expect(await raw("samples", new (ObjectId())(sample.body.sample._id))).not.toHaveProperty("displayOnSite");

    const toggle = await as(member)
      .put("/project/toggle-nudgeable")
      .send({ _id: String(legacy._id), nudgeable: false, displayOnSite: false });
    expect(toggle.status).toBe(200);
    expect(await raw("projects", legacy._id)).not.toHaveProperty("displayOnSite");
  });

  test("the retention form refuses it as an unsupported field", async () => {
    const res = await as(admin).put("/project/hpc-preservation").send({
      _id: String(legacy._id),
      preserveOnHpcUntil: null,
      expectedPreserveOnHpcUntil: null,
      hpcPreservationReason: "x",
      displayOnSite: false,
    });

    expect(res.status).toBe(400);
    expect(await raw("projects", legacy._id)).not.toHaveProperty("displayOnSite");
  });

  test("the model stores only real booleans", async () => {
    for (const value of ["false", "no", 0, "maybe", {}]) {
      const doc = await Project.findById(legacy._id);
      doc.displayOnSite = value;
      await expect(doc.validate()).rejects.toThrow(/displayOnSite/);
    }
    await expect(
      Project.updateOne({ _id: legacy._id }, { $set: { displayOnSite: "false" } }),
    ).rejects.toThrow();
    expect(await raw("projects", legacy._id)).not.toHaveProperty("displayOnSite");
  });
});

describe("privileged audit and operational tooling still see it", () => {
  test("admin audit endpoints return the hidden record; others are refused", async () => {
    const history = await as(admin).get(`/project/reconciliation-history?id=${hidden._id}`);
    expect(history.status).toBe(200);

    const record = await as(admin).get(`/admin/reconciliation-record?collection=projects&id=${hidden._id}`);
    expect(record.status).toBe(200);
    expect(record.body.record.displayOnSite).toBe(false);
    expect(record.body.record.name).toBe("sitevis hidden");

    const refused = await as(member).get(`/admin/reconciliation-record?collection=projects&id=${hidden._id}`);
    expect(refused.status).toBe(403);
  });

  test("models, archive loading and the retention report are unfiltered", async () => {
    expect(ids(await Project.find({}))).toContain(String(hidden._id));
    expect(await Sample.countDocuments({ project: hidden._id })).toBe(1);
    expect(await Run.countDocuments({ sample: hiddenSample._id })).toBe(1);

    const { loadProject } = require("../../lib/s3-archive/state");
    expect(String((await loadProject(Project, hidden._id))._id)).toBe(String(hidden._id));

    const { buildReport } = require("../../scripts/hpc-deletion-due-report");
    const report = await buildReport({
      Project,
      Sample,
      Run,
      db: db(),
      now: new Date("2031-06-01T00:00:00.000Z"),
      webAppUrl: "https://example.test",
      years: 5,
    });
    expect(report.rows.map((row) => row.project_name)).toContain("sitevis hidden");
  });
});

describe("restoring visibility", () => {
  test("unsetting restores a previously missing field and changes nothing else", async () => {
    const result = await db().collection("projects").updateOne(
      { _id: hidden._id, name: hidden.name, path: hidden.path, displayOnSite: false },
      { $unset: { displayOnSite: "" } },
    );
    expect([result.matchedCount, result.modifiedCount]).toEqual([1, 1]);

    expect(await raw("projects", hidden._id)).toEqual(hiddenBefore);
    expect(ids((await as(member).get("/projects")).body.projects)).toContain(String(hidden._id));
    expect((await as(member).get(`/project?id=${hidden._id}`)).status).toBe(200);
    expect((await as(member).get(`/run?id=${hiddenRun._id}`)).status).toBe(200);
    expect(ids((await as(admin).get("/samples")).body.samples)).toContain(String(hiddenSample._id));
  });

  test("a project that was explicitly true is restored to true", async () => {
    const before = await raw("projects", shown._id);
    await db().collection("projects").updateOne(
      { _id: shown._id, name: shown.name, displayOnSite: true },
      { $set: { displayOnSite: false } },
    );
    expect(ids((await as(member).get("/projects")).body.projects)).not.toContain(String(shown._id));

    await db().collection("projects").updateOne(
      { _id: shown._id, name: shown.name, displayOnSite: false },
      { $set: { displayOnSite: true } },
    );
    expect(await raw("projects", shown._id)).toEqual(before);
    expect(ids((await as(member).get("/projects")).body.projects)).toContain(String(shown._id));
  });
});
