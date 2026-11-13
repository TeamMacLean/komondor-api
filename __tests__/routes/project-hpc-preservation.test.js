const express = require("express");
const request = require("supertest");

let mockUser = { username: "deeks", isAdmin: true };
jest.mock("../../models/Project", () => ({ findOneAndUpdate: jest.fn(), findById: jest.fn() }));
jest.mock("../../routes/middleware", () => ({
  isAuthenticated: (req, res, next) => {
    if (!mockUser) return res.status(401).send({ error: "Authentication required" });
    req.user = mockUser;
    return next();
  },
}));
jest.mock("../../lib/project-storage-locations", () => ({ projectStorageLocations: jest.fn() }), { virtual: true });
jest.mock("../../lib/utils/sendOverseerEmail");
jest.mock("../../routes/_utils", () => ({
  handleError: (res, error, status, message) => res.status(status).send({ error: message || error.message }),
  compareFilesToDirectory: jest.fn(),
}));

const Project = require("../../models/Project");
const router = require("../../routes/projects");
const app = express();
app.use(express.json());
app.use(router);

describe("PUT /project/hpc-preservation", () => {
  const id = "64f1c0000000000000000000";
  const until = "2027-11-13T23:59:59.999Z";
  const body = { _id: id, preserveOnHpcUntil: until, expectedPreserveOnHpcUntil: null };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { username: "deeks", isAdmin: true };
    Project.findOneAndUpdate.mockResolvedValue({ _id: id, preserveOnHpcUntil: new Date(until) });
  });

  test.each([
    [null, 401], [{ username: "owner", isAdmin: false }, 403],
    [{ username: "owner", isAdmin: "true" }, 403], [{ isAdmin: true }, 403],
  ])("requires an authenticated admin with an actor identity (%p)", async (user, status) => {
    mockUser = user;
    expect((await request(app).put("/project/hpc-preservation").send(body)).status).toBe(status);
    expect(Project.findOneAndUpdate).not.toHaveBeenCalled();
    expect(Project.findById).not.toHaveBeenCalled();
  });

  test.each([
    { _id: { $ne: null } }, { preserveOnHpcUntil: "2027-02-29T00:00:00.000Z" },
    { preserveOnHpcUntil: false }, { preserveOnHpcUntil: { $gt: null } },
    { expectedPreserveOnHpcUntil: "2027-11-13" },
    { storage: { state: "hpc" } }, { hpcPreservationHistory: [] },
    { owner: "somebody-else" },
  ])("rejects invalid input or unrelated field injection before database access (%p)", async (changes) => {
    expect((await request(app).put("/project/hpc-preservation").send({ ...body, ...changes })).status).toBe(400);
    expect(Project.findOneAndUpdate).not.toHaveBeenCalled();
    expect(Project.findById).not.toHaveBeenCalled();
  });

  test("requires the expected prior value even for a new hold", async () => {
    expect((await request(app).put("/project/hpc-preservation").send({ _id: id, preserveOnHpcUntil: until })).status).toBe(400);
    expect(Project.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("atomically sets a public date and actor-stamped private history, without changing lifecycle", async () => {
    const result = await request(app).put("/project/hpc-preservation").send(body);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ projectId: id, preserveOnHpcUntil: until });
    expect(Project.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, preserveOnHpcUntil: null },
      { $set: { preserveOnHpcUntil: new Date(until) }, $push: {
        hpcPreservationHistory: { at: expect.any(Date), by: "deeks", previousUntil: null, until: new Date(until) },
      } },
      { new: true, runValidators: true },
    );
    expect(Project.findById).not.toHaveBeenCalled();
  });

  test("an admin can clear an existing date, retaining its old value in history", async () => {
    Project.findOneAndUpdate.mockResolvedValue({ _id: id, preserveOnHpcUntil: null });
    const result = await request(app).put("/project/hpc-preservation").send({ ...body, preserveOnHpcUntil: null, expectedPreserveOnHpcUntil: until });
    expect(result.status).toBe(200);
    expect(result.body.preserveOnHpcUntil).toBeNull();
    const [filter, update] = Project.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: id, preserveOnHpcUntil: new Date(until) });
    expect(update.$push.hpcPreservationHistory).toMatchObject({ previousUntil: new Date(until), until: null, by: "deeks" });
    expect(update.$set).toEqual({ preserveOnHpcUntil: null });
  });

  test("allows recording an expired date without extending protection", async () => {
    const expired = "2020-01-01T23:59:59.999Z";
    Project.findOneAndUpdate.mockResolvedValue({ _id: id, preserveOnHpcUntil: new Date(expired) });
    const result = await request(app).put("/project/hpc-preservation").send({ ...body, preserveOnHpcUntil: expired });
    expect(result.status).toBe(200);
    expect(result.body.preserveOnHpcUntil).toBe(expired);
  });

  test("returns 409 when a stale page no longer matches; it never retries an overwrite", async () => {
    Project.findOneAndUpdate.mockResolvedValue(null);
    Project.findById.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: id }) }) });
    const result = await request(app).put("/project/hpc-preservation").send(body);
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/changed.*Reload/);
    expect(Project.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test("distinguishes a missing project from a stale prior date", async () => {
    Project.findOneAndUpdate.mockResolvedValue(null);
    Project.findById.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
    expect((await request(app).put("/project/hpc-preservation").send(body)).status).toBe(404);
  });

  test("does not report success after a failed database write", async () => {
    Project.findOneAndUpdate.mockRejectedValue(new Error("database unavailable"));
    expect((await request(app).put("/project/hpc-preservation").send(body)).status).toBe(500);
    expect(Project.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
