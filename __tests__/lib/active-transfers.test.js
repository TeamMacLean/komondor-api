/**
 * Tests for lib/active-transfers.js — the register shutdown consults before
 * deciding whether it is safe to exit.
 *
 * The failure that matters here is a false negative: an entry cleared while a
 * transfer is still running lets the process exit mid-copy, which is the exact
 * situation the register exists to prevent.
 */

const {
  addTransfer,
  removeTransfer,
  getActiveTransfers,
  getBlockingTransfers,
  isPartialTransferFile,
  clearActiveTransfers,
} = require("../../lib/active-transfers");

beforeEach(() => {
  clearActiveTransfers();
});

describe("addTransfer / getActiveTransfers", () => {
  test("reports a registered transfer", () => {
    addTransfer("file-1", "reads.fq");

    expect(getActiveTransfers()).toHaveLength(1);
    expect(getActiveTransfers()[0]).toMatchObject({
      id: "file-1",
      filename: "reads.fq",
    });
  });

  test("reports nothing when idle", () => {
    expect(getActiveTransfers()).toEqual([]);
  });

  test("keeps two concurrent transfers of the same file apart", () => {
    // Keying by {id, filename} collapsed these into one entry, so finishing
    // either one cleared the flag for both.
    const first = addTransfer("file-1", "reads.fq");
    const second = addTransfer("file-1", "reads.fq");

    expect(first).not.toBe(second);
    expect(getActiveTransfers()).toHaveLength(2);
  });

  test("still reports a transfer after an identical one finishes", () => {
    const first = addTransfer("file-1", "reads.fq");
    addTransfer("file-1", "reads.fq");

    removeTransfer(first);

    expect(getActiveTransfers()).toHaveLength(1);
  });

  test("reports how long each transfer has been running", () => {
    addTransfer("file-1", "reads.fq");

    expect(getActiveTransfers()[0].ageMs).toBeGreaterThanOrEqual(0);
  });

  test("orders transfers oldest first", async () => {
    addTransfer("file-1", "old.fq");
    await new Promise((resolve) => setTimeout(resolve, 5));
    addTransfer("file-2", "new.fq");

    expect(getActiveTransfers().map((t) => t.id)).toEqual(["file-1", "file-2"]);
  });
});

describe("removeTransfer", () => {
  test("clears the transfer it was given", () => {
    const token = addTransfer("file-1", "reads.fq");

    removeTransfer(token);

    expect(getActiveTransfers()).toEqual([]);
  });

  test("reports whether anything was removed", () => {
    const token = addTransfer("file-1", "reads.fq");

    expect(removeTransfer(token)).toBe(true);
    expect(removeTransfer(token)).toBe(false);
  });

  test("tolerates an unknown token", () => {
    // Callers release in a finally, which can run before a token exists.
    expect(() => removeTransfer("no-such-token")).not.toThrow();
    expect(() => removeTransfer(undefined)).not.toThrow();
  });

  test("leaves other transfers alone", () => {
    const token = addTransfer("file-1", "reads.fq");
    addTransfer("file-2", "other.fq");

    removeTransfer(token);

    expect(getActiveTransfers().map((t) => t.id)).toEqual(["file-2"]);
  });
});

describe("getBlockingTransfers", () => {
  const ONE_HOUR = 60 * 60 * 1000;

  afterEach(() => {
    jest.useRealTimers();
  });

  test("counts a fresh transfer as in flight", () => {
    addTransfer("file-1", "reads.fq");

    const { inFlight, stalled } = getBlockingTransfers(ONE_HOUR);

    expect(inFlight).toHaveLength(1);
    expect(stalled).toHaveLength(0);
  });

  test("stops blocking on a transfer that has stalled", () => {
    // One copy hung on an unresponsive mount must not refuse every clean
    // shutdown from then on.
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    addTransfer("file-1", "stuck.bam");
    jest.setSystemTime(new Date("2026-01-01T02:00:00Z"));

    const { inFlight, stalled } = getBlockingTransfers(ONE_HOUR);

    expect(inFlight).toHaveLength(0);
    expect(stalled).toHaveLength(1);
  });

  test("keeps blocking on healthy transfers alongside a stalled one", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    addTransfer("file-1", "stuck.bam");
    jest.setSystemTime(new Date("2026-01-01T02:00:00Z"));
    addTransfer("file-2", "fresh.bam");

    const { all, inFlight, stalled } = getBlockingTransfers(ONE_HOUR);

    expect(all).toHaveLength(2);
    expect(inFlight.map((t) => t.id)).toEqual(["file-2"]);
    expect(stalled.map((t) => t.id)).toEqual(["file-1"]);
  });

  test("reports nothing to block on when idle", () => {
    expect(getBlockingTransfers(ONE_HOUR)).toMatchObject({
      all: [],
      inFlight: [],
      stalled: [],
    });
  });
});

describe("isPartialTransferFile", () => {
  test("recognises an in-progress copy", () => {
    expect(isPartialTransferFile("reads.fq.part-651f9c0a1b2c3d4e5f6a7b8c")).toBe(
      true,
    );
  });

  test("leaves ordinary files alone", () => {
    expect(isPartialTransferFile("reads.fq")).toBe(false);
    expect(isPartialTransferFile("sample.part.fq")).toBe(false);
  });

  test("leaves a real file that merely looks similar alone", () => {
    // Hiding this one would report it as missing from disk.
    expect(isPartialTransferFile("assembly.part-2.bam")).toBe(false);
    expect(isPartialTransferFile("reads.part-651f9c0a1b2c.fq")).toBe(false);
  });

  test("tolerates non-string input", () => {
    expect(isPartialTransferFile(undefined)).toBe(false);
    expect(isPartialTransferFile(null)).toBe(false);
  });
});
