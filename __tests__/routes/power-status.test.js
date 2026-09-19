const request = require("supertest");
const express = require("express");
jest.mock("../../models/Run");
jest.mock("../../models/Read");
jest.mock("../../models/IngestJob");
const Run = require("../../models/Run");
const Read = require("../../models/Read");
const Job = require("../../models/IngestJob");
const router = require("../../routes/power-status");
const app = express();
app.use(express.json());
app.use(router);
const id = "6aaceaa21cd69d5d57b3c412";
const secret = "test-monitoring-secret-with-at-least-32-characters";
const query = (rows) => ({ select: () => ({ lean: async () => rows }) });
const post = (token = secret, body = { runIds: [id], username: "ben" }) =>
  request(app)
    .post("/internal/power/run-status")
    .set("X-Power-Status-Token", token)
    .send(body);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.POWER_STATUS_TOKEN = secret;
  Run.find.mockReturnValue(
    query([{ _id: id, status: "complete", md5VerificationStatus: "complete" }]),
  );
  Read.find.mockReturnValue(
    query([{ run: id, MD5: "a", destinationMd5: "a", md5Mismatch: false }]),
  );
  Job.find.mockReturnValue(query([{ runId: id, status: "done", attempts: 1 }]));
});
afterAll(() => {
  delete process.env.POWER_STATUS_TOKEN;
});

test("requires the dedicated credential and never queries without it", async () => {
  expect((await post("bad")).status).toBe(401);
  expect(Run.find).not.toHaveBeenCalled();
});
test("fails closed when unconfigured", async () => {
  delete process.env.POWER_STATUS_TOKEN;
  expect((await post()).status).toBe(503);
});
test("rejects injection and oversized batches", async () => {
  expect(
    (await post(secret, { runIds: [id], username: { $ne: null } })).status,
  ).toBe(400);
  expect(
    (await post(secret, { runIds: Array(101).fill(id), username: "ben" }))
      .status,
  ).toBe(400);
});
test("returns processing information for an existing run owned by another creator", async () => {
  Run.find.mockReturnValue(
    query([
      {
        _id: id,
        owner: "alice",
        status: "complete",
        md5VerificationStatus: "complete",
      },
    ]),
  );
  const res = await post(secret, { runIds: [id], username: "bob" });
  expect(res.status).toBe(200);
  expect(Run.find).toHaveBeenCalledWith({ _id: { $in: [id] } });
  expect(res.body.runs[0].verification.state).toBe("passed");
  expect(res.body.runs[0]).not.toHaveProperty("owner");
  expect(res.body.missing).toEqual([]);
});
test("reports missing IDs instead of a misleading successful empty response", async () => {
  Run.find.mockReturnValue(query([]));
  expect((await post()).body.missing).toEqual([id]);
});
