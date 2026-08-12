/**
 * Tests for the shutdown guard in server.js.
 *
 * PM2 follows SIGINT with SIGKILL after kill_timeout, so refusing to shut down
 * only ever buys a window — the guarantee against a truncated file lives in
 * File.moveToFolderAndSave. What is checked here is that the guard blocks when
 * it should, and just as importantly that it always gives way in the end:
 * a guard that can be stuck on refuses restarts forever.
 */

const mockServer = { close: jest.fn((done) => done && done()) };

jest.mock("../app", () => ({ listen: jest.fn(() => mockServer) }));

jest.mock("mongoose", () => ({
  connect: jest.fn(() => Promise.resolve()),
  connection: {
    close: jest.fn(() => Promise.resolve()),
    on: jest.fn(),
  },
}));

jest.mock("../lib/background-jobs", () => ({
  initializeBackgroundJobs: jest.fn(),
  stopBackgroundJobs: jest.fn(),
}));

// Every load registers its own handlers for these. Only the ones a load adds
// are removed afterwards — Jest has its own on the last two.
const PROCESS_EVENTS = [
  "SIGINT",
  "SIGTERM",
  "unhandledRejection",
  "uncaughtException",
];

/**
 * Loads a fresh server with a fresh transfer register. Both must come from the
 * same module registry or they would not share the register at all.
 */
const loadServer = () => {
  jest.resetModules();
  const transfers = require("../lib/active-transfers");
  const { shutdown } = require("../server");
  return { shutdown, ...transfers };
};

let exitSpy;
let warnSpy;
let listenersBefore;

beforeEach(() => {
  listenersBefore = new Map(
    PROCESS_EVENTS.map((event) => [event, new Set(process.listeners(event))]),
  );
  jest.useFakeTimers();
  exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  PROCESS_EVENTS.forEach((event) => {
    const before = listenersBefore.get(event);
    process
      .listeners(event)
      .filter((listener) => !before.has(listener))
      .forEach((listener) => process.removeListener(event, listener));
  });
});

describe("shutdown while files are moving", () => {
  test("refuses a clean shutdown", async () => {
    const { shutdown, addTransfer } = loadServer();
    addTransfer("file-1", "huge.bam");

    shutdown(0);
    await Promise.resolve();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("names the files that are still moving", () => {
    const { shutdown, addTransfer } = loadServer();
    addTransfer("file-1", "huge.bam");

    shutdown(0);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("huge.bam"));
  });

  test("suggests a force-kill that will actually work", () => {
    // SIGKILL is the only signal a process cannot refuse.
    const { shutdown, addTransfer } = loadServer();
    addTransfer("file-1", "huge.bam");

    shutdown(0);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`kill -9 ${process.pid}`),
    );
  });

  test("does not stop the background jobs it is not shutting down", () => {
    const { shutdown, addTransfer } = loadServer();
    const { stopBackgroundJobs } = require("../lib/background-jobs");
    addTransfer("file-1", "huge.bam");

    shutdown(0);

    expect(stopBackgroundJobs).not.toHaveBeenCalled();
  });

  test("shuts down once the transfer finishes", () => {
    const { shutdown, addTransfer, removeTransfer } = loadServer();
    const token = addTransfer("file-1", "huge.bam");
    shutdown(0);
    expect(exitSpy).not.toHaveBeenCalled();

    removeTransfer(token);
    shutdown(0);

    expect(mockServer.close).toHaveBeenCalled();
  });

  test("still exits on a crash path", () => {
    // The process state is untrustworthy by then, and an interrupted copy is
    // left as a .part- file rather than a truncated read.
    const { shutdown, addTransfer } = loadServer();
    addTransfer("file-1", "huge.bam");

    shutdown(1);

    expect(mockServer.close).toHaveBeenCalled();
  });

  test("reports what it is interrupting when it exits anyway", () => {
    const { shutdown, addTransfer } = loadServer();
    addTransfer("file-1", "huge.bam");

    shutdown(1);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("still tracked"),
    );
  });

  test("gives way to a transfer that has stalled", () => {
    // Otherwise one copy hung on a dead mount blocks restarts indefinitely.
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { shutdown, addTransfer } = loadServer();
    addTransfer("file-1", "stuck.bam");
    jest.setSystemTime(new Date("2026-01-02T00:00:00Z")); // a day later

    shutdown(0);

    expect(mockServer.close).toHaveBeenCalled();
  });
});

describe("shutdown when nothing is moving", () => {
  test("closes the HTTP listener", () => {
    const { shutdown } = loadServer();

    shutdown(0);

    expect(mockServer.close).toHaveBeenCalled();
  });

  test("stops the background jobs", () => {
    const { shutdown } = loadServer();
    const { stopBackgroundJobs } = require("../lib/background-jobs");

    shutdown(0);

    expect(stopBackgroundJobs).toHaveBeenCalled();
  });

  test("exits even if closing the connections never settles", () => {
    // Neither draining connections nor closing Mongo is guaranteed to finish.
    mockServer.close.mockImplementationOnce(() => {});
    const { shutdown } = loadServer();

    shutdown(0);
    jest.advanceTimersByTime(10000);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("ignores a second shutdown once one is under way", () => {
    const { shutdown } = loadServer();

    shutdown(0);
    const { stopBackgroundJobs } = require("../lib/background-jobs");
    shutdown(0);

    expect(stopBackgroundJobs).toHaveBeenCalledTimes(1);
  });
});
