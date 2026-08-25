const {
  auditHpcAccess,
  requireHpcGroupAccess,
  AUDIT_PREFIX,
} = require("../../lib/utils/hpcAudit");

/** Any C0 control character surviving unescaped into an emitted line. */
const CONTROL_CHARS = /[\u0000-\u001f]/;

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
    expect(line).toBe(
      `${AUDIT_PREFIX} action="claim" user="mallory" ` +
        `path="/hpc/inbound/group_b/PATIENT_R1.fastq.gz" outcome="ok" ` +
        `detail="type=run"`,
    );
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
    expect(logSpy.mock.calls[0][0]).toContain('user="unknown"');
  });

  it("omits the detail field entirely when there is none", () => {
    auditHpcAccess({ action: "read", user: { username: "bob" }, path: "/x" });
    expect(logSpy.mock.calls[0][0]).not.toContain("detail=");
  });

  describe("the trail cannot be forged by log injection", () => {
    // HPC_TRANSFER_DIRECTORY is writable by unprivileged users by design and
    // no path cleaner strips an interior newline — cleanDirectoryName only
    // trims the ends, safeBasename only refuses NUL and separators. So a file
    // whose *name* carries a newline reaches this sink verbatim. Raw
    // interpolation let that name emit a second, perfectly-formed record
    // attributing a cross-group claim to a named colleague.
    const FORGED = `${AUDIT_PREFIX} action="claim" user="alice" path="/hpc/inbound/group_b/PATIENT.fastq.gz" outcome="ok"`;

    it("emits exactly one physical line when the path carries a newline", () => {
      const evilPath = `/hpc/inbound/mine/note.txt\n${FORGED}`;

      auditHpcAccess({
        action: "read",
        user: { username: "mallory" },
        path: evilPath,
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const line = logSpy.mock.calls[0][0];

      expect(line.split("\n")).toHaveLength(1);
      expect(CONTROL_CHARS.test(line)).toBe(false);
      // The whole hostile value survives as one quoted field, so an operator
      // reading the trail sees the real filename rather than a second record.
      expect(line).toBe(
        `${AUDIT_PREFIX} action="read" user="mallory" ` +
          `path=${JSON.stringify(evilPath)} outcome="ok"`,
      );
    });

    it("cannot be truncated by a carriage return in the path", () => {
      // \r alone repaints the line in a terminal and splits the record for
      // some log shippers, which is how an attributed party erases their own
      // genuine line without needing a newline at all.
      auditHpcAccess({
        action: "read",
        user: { username: "mallory" },
        path: "/hpc/inbound/mine/a.txt\r         ",
      });

      const line = logSpy.mock.calls[0][0];
      expect(CONTROL_CHARS.test(line)).toBe(false);
      expect(line).toContain("\\r");
    });

    it("escapes a newline in the username", () => {
      // The username is not a constant either: it comes off the directory.
      auditHpcAccess({
        action: "read",
        user: { username: `mallory\n${FORGED}` },
        path: "/x",
      });

      const line = logSpy.mock.calls[0][0];
      expect(line.split("\n")).toHaveLength(1);
      expect(CONTROL_CHARS.test(line)).toBe(false);
    });

    it("escapes a newline in the detail field", () => {
      auditHpcAccess({
        action: "claim",
        user: { username: "mallory" },
        path: "/x",
        detail: `type=run\n${FORGED}`,
      });

      const line = logSpy.mock.calls[0][0];
      expect(line.split("\n")).toHaveLength(1);
      expect(CONTROL_CHARS.test(line)).toBe(false);
    });

    it("escapes a quote so a field cannot be closed early", () => {
      auditHpcAccess({
        action: "read",
        user: { username: "mallory" },
        path: '/x" user="alice',
      });

      const line = logSpy.mock.calls[0][0];
      // One field named `user` opens a quote, and it is the real caller: the
      // injected one is `user=\"alice`, whose quote is escaped and therefore
      // part of the path value rather than the start of a field.
      expect(line.match(/ user="/g)).toHaveLength(1);
      expect(line).toContain('user="mallory"');
      expect(line).toContain('\\" user=\\"alice');
    });

    it("renders a non-string value as one quoted scalar", () => {
      // A structured value here would give a line parser a second shape to
      // understand, which is the ambiguity the quoting exists to remove.
      auditHpcAccess({
        action: "read",
        user: { username: "bob" },
        path: { toString: () => "/x" },
      });

      expect(logSpy.mock.calls[0][0]).toContain('path="/x"');
    });
  });
});

describe("requireHpcGroupAccess", () => {
  // A live groupsICanRead() lookup was removed in 366f656 as disproportionate
  // for this threat model; these pin the cheaper replacement, which trusts
  // the JWT claims already on req.user instead.
  let logSpy;
  let req;
  let res;
  let next;
  const ORIGINAL_FULL_ACCESS = process.env.FULL_RECORDS_ACCESS_USERS;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    req = { originalUrl: "/directory-files?targetDirectoryName=batch1" };
    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL_FULL_ACCESS === undefined) {
      delete process.env.FULL_RECORDS_ACCESS_USERS;
    } else {
      process.env.FULL_RECORDS_ACCESS_USERS = ORIGINAL_FULL_ACCESS;
    }
  });

  test("passes a user with real group membership", () => {
    req.user = { username: "alice", groups: ["group1"], isAdmin: false };

    requireHpcGroupAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("refuses a user with an empty groups array and no elevated access", () => {
    req.user = { username: "alice", groups: [], isAdmin: false };

    requireHpcGroupAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({
      error: "You do not belong to any group",
    });
  });

  test("refuses a user with no groups claim at all", () => {
    // A misconfigured token, or one from before the groups claim existed.
    req.user = { username: "alice", isAdmin: false };

    requireHpcGroupAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("passes an admin with an empty groups array", () => {
    req.user = { username: "alice", groups: [], isAdmin: true };

    requireHpcGroupAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("passes a FULL_RECORDS_ACCESS_USERS principal with an empty groups array", () => {
    process.env.FULL_RECORDS_ACCESS_USERS = "alice";
    req.user = { username: "alice", groups: [], isAdmin: false };

    requireHpcGroupAccess(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test("audits the refusal on the shared trail, naming the caller and the request URL", () => {
    req.user = { username: "alice", groups: [], isAdmin: false };

    requireHpcGroupAccess(req, res, next);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe(
      `${AUDIT_PREFIX} action="denied" user="alice" ` +
        `path="/directory-files?targetDirectoryName=batch1" ` +
        `outcome="no-group-membership"`,
    );
  });

  test("does not audit a caller who was let through", () => {
    req.user = { username: "alice", groups: ["group1"], isAdmin: false };

    requireHpcGroupAccess(req, res, next);

    expect(logSpy).not.toHaveBeenCalled();
  });
});
