const {
  auditHpcAccess,
  requireAnyGroupMembership,
  AUDIT_PREFIX,
} = require("../../lib/utils/hpcAudit");

jest.mock("../../lib/utils/groupAccess", () => ({
  groupsICanRead: jest.fn(),
}));

const { groupsICanRead } = require("../../lib/utils/groupAccess");

describe("auditHpcAccess", () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records the caller and the exact resolved path", () => {
    auditHpcAccess({
      action: "claim",
      user: { username: "mallory" },
      path: "/hpc/inbound/group_b/PATIENT_R1.fastq.gz",
      detail: "type=run",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0];
    expect(line).toContain(AUDIT_PREFIX);
    expect(line).toContain("action=claim");
    expect(line).toContain("user=mallory");
    expect(line).toContain("path=/hpc/inbound/group_b/PATIENT_R1.fastq.gz");
    expect(line).toContain("outcome=ok");
    expect(line).toContain("detail=type=run");
  });

  it("goes to stdout, not stderr — these are normal operation, not errors", () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    auditHpcAccess({ action: "list", user: { username: "bob" }, path: "/x" });

    expect(logSpy).toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("does not throw when the user is missing", () => {
    expect(() =>
      auditHpcAccess({ action: "read", user: undefined, path: "/x" }),
    ).not.toThrow();
    expect(logSpy.mock.calls[0][0]).toContain("user=unknown");
  });

  it("omits the detail field entirely when there is none", () => {
    auditHpcAccess({ action: "read", user: { username: "bob" }, path: "/x" });
    expect(logSpy.mock.calls[0][0]).not.toContain("detail=");
  });
});

describe("requireAnyGroupMembership", () => {
  const build = () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    return { req: { user: { username: "bob" } }, res, next: jest.fn() };
  };

  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    groupsICanRead.mockReset();
  });

  it("lets a caller with at least one group through", async () => {
    groupsICanRead.mockResolvedValue([{ _id: "g1" }]);
    const { req, res, next } = build();

    await requireAnyGroupMembership()(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("refuses a caller who belongs to no group", async () => {
    groupsICanRead.mockResolvedValue([]);
    const { req, res, next } = build();

    await requireAnyGroupMembership()(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("fails closed when the group lookup errors", async () => {
    groupsICanRead.mockRejectedValue(new Error("mongo down"));
    const { req, res, next } = build();

    await requireAnyGroupMembership()(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
