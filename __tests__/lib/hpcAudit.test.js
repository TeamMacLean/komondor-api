const {
  auditHpcAccess,
  requireAnyGroupMembership,
  AUDIT_PREFIX,
} = require("../../lib/utils/hpcAudit");

jest.mock("../../lib/utils/groupAccess", () => ({
  groupsICanRead: jest.fn(),
}));

const { groupsICanRead } = require("../../lib/utils/groupAccess");

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

describe("requireAnyGroupMembership", () => {
  let logSpy;

  const build = (user = { username: "bob" }) => {
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    return {
      req: { user, originalUrl: "/directory-files?targetDirectoryName=batch1" },
      res,
      next: jest.fn(),
    };
  };

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
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

  describe("fails closed on a shape change, not just on an empty array", () => {
    // `!groups || groups.length === 0` admitted every truthy non-array: a bare
    // object has no `.length`, so `undefined === 0` is false and the caller
    // sailed through the one membership check the staging area has.
    it.each([
      ["a bare object", {}],
      ["an object with a bogus length", { length: 3 }],
      ["a string", "group-1"],
      ["a number", 1],
      ["true", true],
    ])("refuses when groupsICanRead resolves to %s", async (_label, value) => {
      groupsICanRead.mockResolvedValue(value);
      const { req, res, next } = build();

      await requireAnyGroupMembership()(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("an empty group collection does not lock the admin out", () => {
    // groupsICanRead resolves an admin to Group.find({deleted: {$ne: true}}),
    // so an empty result means the *system* holds no live group — a fresh
    // install, or every group soft-deleted — not that the admin belongs to
    // nothing. Refusing them there is unrecoverable through the API.
    it("lets an admin through and records the passage", async () => {
      groupsICanRead.mockResolvedValue([]);
      const { req, res, next } = build({ username: "admin", isAdmin: true });

      await requireAnyGroupMembership()(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();

      const line = logSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(line).toContain(AUDIT_PREFIX);
      expect(line).toContain('action="admin-no-groups"');
      expect(line).toContain('user="admin"');
    });

    it("still refuses a non-admin", async () => {
      groupsICanRead.mockResolvedValue([]);
      const { req, res, next } = build({ username: "bob", isAdmin: false });

      await requireAnyGroupMembership()(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("refuses a truthy non-boolean isAdmin", async () => {
      // isAdmin is a real boolean everywhere it is set, so anything else here
      // is a shape change and gets the fail-closed answer.
      groupsICanRead.mockResolvedValue([]);
      const { req, res, next } = build({ username: "bob", isAdmin: "yes" });

      await requireAnyGroupMembership()(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("refusals stay on the same stream as the rest of the trail", () => {
    // Production splits stdout and stderr into separate files. A denial on
    // stderr means grepping the audit log for the one token misses every
    // refusal, which is precisely the record an operator is looking for.
    it("puts the groupless denial on stdout", async () => {
      groupsICanRead.mockResolvedValue([]);
      const { req, res, next } = build();

      await requireAnyGroupMembership()(req, res, next);

      const stdout = logSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(stdout).toContain(AUDIT_PREFIX);
      expect(stdout).toContain('action="denied"');
      expect(stdout).toContain('user="bob"');
      expect(stdout).toContain('outcome="no-group-membership"');
      expect(console.error).not.toHaveBeenCalled();
    });

    it("puts the lookup-failure refusal on stdout as well as the stack on stderr", async () => {
      groupsICanRead.mockRejectedValue(new Error("mongo down"));
      const { req, res, next } = build();

      await requireAnyGroupMembership()(req, res, next);

      const stdout = logSpy.mock.calls.map((call) => call[0]).join("\n");
      expect(stdout).toContain('action="denied"');
      expect(stdout).toContain('outcome="group-lookup-failed"');
      // The exception itself is a real error and still belongs in the error log.
      expect(console.error).toHaveBeenCalled();
    });

    it("escapes a hostile request target in the denial line", async () => {
      // req.originalUrl is entirely attacker-chosen, so the refusal record is
      // an injection sink too — and a refused caller is exactly the one with a
      // motive to forge a line.
      groupsICanRead.mockResolvedValue([]);
      const { req, res, next } = build();
      req.originalUrl = `/directory-files?x=1\n${AUDIT_PREFIX} action="claim" user="alice" path="/hpc/x" outcome="ok"`;

      await requireAnyGroupMembership()(req, res, next);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const line = logSpy.mock.calls[0][0];
      expect(line.split("\n")).toHaveLength(1);
      expect(CONTROL_CHARS.test(line)).toBe(false);
    });
  });
});
