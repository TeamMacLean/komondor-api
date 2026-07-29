/**
 * Tests for lib/utils/sendEmail.js and lib/utils/sendOverseerEmail.js.
 *
 * Nothing here opens a real SMTP connection: nodemailer is mocked so the
 * composed message and the transport configuration can be asserted.
 */

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));

jest.mock("nodemailer", () => ({ createTransport: mockCreateTransport }));

const ORIGINAL_ENV = process.env.NODE_ENV;

/**
 * Re-imports the email modules so they pick up the current NODE_ENV, which they
 * read at module scope.
 */
const loadModules = () => {
  let sendEmail;
  let sendOverseerEmail;
  jest.isolateModules(() => {
    sendEmail = require("../../lib/utils/sendEmail");
    sendOverseerEmail = require("../../lib/utils/sendOverseerEmail");
  });
  return { sendEmail, sendOverseerEmail };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockSendMail.mockResolvedValue({ messageId: "abc123" });
  process.env.NODE_ENV = "production";
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env.NODE_ENV = ORIGINAL_ENV;
});

describe("sendEmail", () => {
  test("sends the composed message through the transport", async () => {
    const { sendEmail } = loadModules();

    await sendEmail({ subject: "Hello", message: "Body text" });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Hello", text: "Body text" }),
    );
  });

  test("returns the transport's message id", async () => {
    const { sendEmail } = loadModules();

    await expect(
      sendEmail({ subject: "Hello", message: "Body" }),
    ).resolves.toContain("abc123");
  });

  test("does not send in development mode", async () => {
    process.env.NODE_ENV = "development";
    const { sendEmail } = loadModules();

    const result = await sendEmail({ subject: "Hello", message: "Body" });

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(result).toMatch(/Dev mode/);
  });

  test("wraps a transport failure in a descriptive error", async () => {
    mockSendMail.mockRejectedValue(new Error("connection refused"));
    const { sendEmail } = loadModules();

    await expect(
      sendEmail({ subject: "Hello", message: "Body" }),
    ).rejects.toThrow(/connection refused/);
  });
});

describe("sendMd5VerificationEmail", () => {
  test("reports success when there are no mismatches", async () => {
    const { sendEmail } = loadModules();

    await sendEmail.sendMd5VerificationEmail({
      runId: "r1",
      runName: "run one",
      filesVerified: 4,
      mismatches: 0,
      errors: 0,
      duration: 1500,
    });

    const sent = mockSendMail.mock.calls[0][0];
    expect(sent.subject).toContain("SUCCESS");
    expect(sent.text).toContain("Files Verified: 4");
    expect(sent.text).toContain("1.50s");
  });

  test("reports failure and warns when checksums mismatch", async () => {
    const { sendEmail } = loadModules();

    await sendEmail.sendMd5VerificationEmail({
      runId: "r1",
      runName: "run one",
      filesVerified: 4,
      mismatches: 2,
      errors: 0,
      duration: 1000,
    });

    const sent = mockSendMail.mock.calls[0][0];
    expect(sent.subject).toContain("FAILED");
    expect(sent.text).toContain("2 file(s) have MD5 checksum mismatches");
  });

  test("warns separately about verification errors", async () => {
    const { sendEmail } = loadModules();

    await sendEmail.sendMd5VerificationEmail({
      runId: "r1",
      runName: "run one",
      filesVerified: 1,
      mismatches: 0,
      errors: 3,
      duration: 100,
    });

    expect(mockSendMail.mock.calls[0][0].text).toContain(
      "3 file(s) encountered errors",
    );
  });
});

describe("sendOverseerEmail", () => {
  test.each([["Project"], ["Sample"], ["Run"]])(
    "sends a notification for a new %s",
    async (type) => {
      const { sendOverseerEmail } = loadModules();

      await sendOverseerEmail({
        type,
        data: { _id: "id1", name: "thing", owner: "alice" },
      });

      const sent = mockSendMail.mock.calls[0][0];
      expect(sent.subject).toContain(`New ${type}`);
      expect(sent.text).toContain("thing");
      expect(sent.text).toContain("alice");
    },
  );

  test("links to the entity using its lowercased type", async () => {
    const { sendOverseerEmail } = loadModules();

    await sendOverseerEmail({
      type: "Project",
      data: { _id: "id1", name: "thing", owner: "alice" },
    });

    expect(mockSendMail.mock.calls[0][0].text).toContain("project?id=id1");
  });

  test("includes the ENA flag for projects", async () => {
    const { sendOverseerEmail } = loadModules();

    await sendOverseerEmail({
      type: "Project",
      data: { _id: "id1", name: "thing", owner: "alice", doNotSendToEna: false },
    });

    expect(mockSendMail.mock.calls[0][0].text).toContain("Send to ENA: true");
  });

  test("omits the ENA flag for non-projects", async () => {
    const { sendOverseerEmail } = loadModules();

    await sendOverseerEmail({
      type: "Sample",
      data: { _id: "id1", name: "thing", owner: "alice", doNotSendToEna: false },
    });

    expect(mockSendMail.mock.calls[0][0].text).not.toContain("Send to ENA");
  });

  test("falls back to the parent project's owner", async () => {
    const { sendOverseerEmail } = loadModules();

    await sendOverseerEmail({
      type: "Sample",
      data: { _id: "id1", name: "thing", project: { owner: "bob" } },
    });

    expect(mockSendMail.mock.calls[0][0].text).toContain("bob");
  });

  test("rejects an unknown entity type without sending", async () => {
    const { sendOverseerEmail } = loadModules();

    await expect(
      sendOverseerEmail({ type: "Banana", data: { _id: "id1" } }),
    ).rejects.toThrow(/Invalid entity type/);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
