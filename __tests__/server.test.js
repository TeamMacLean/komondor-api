/**
 * Tests for server.js — the startup order and the shutdown guard.
 *
 * Startup: the listener must not open before the database is connected, and
 * must not open at all if the configuration is bad. Nothing here opens a real
 * socket or talks to a real database; app.listen and mongoose are mocked.
 *
 * Shutdown: PM2 follows SIGINT with SIGKILL after kill_timeout, so refusing to
 * shut down only ever buys a window — the guarantee against a truncated file
 * lives in File.moveToFolderAndSave. What is checked here is that the guard
 * blocks when it should, and just as importantly that it always gives way in
 * the end: a guard that can be stuck on refuses restarts forever.
 */

const mockServer = { close: jest.fn((done) => done && done()) };
const mockIngestWorker = { stop: jest.fn(() => Promise.resolve()) };

jest.mock("../app", () => ({
  listen: jest.fn(() => mockServer),
  setDraining: jest.fn(),
  registerReadinessCheck: jest.fn(),
}));

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

// The real one reads the environment and stats the configured mounts; what
// server.js does with the verdict is what matters here.
jest.mock("../lib/utils/validateEnv", () => ({
  validateEnv: jest.fn(),
  resolveHost: jest.fn(() => "127.0.0.1"),
  resolveMongoUri: jest.fn(() => "mongodb://localhost:27017/komondor"),
}));

// Thrown by the queue mock instead of loading, for the tests that need a
// checkout without the module or with a broken one.
let mockIngestQueueLoadError = null;

// Virtual: server.js tolerates lib/ingest-queue.js being absent, so this must
// not depend on whether the file is present in the checkout.
jest.mock(
  "../lib/ingest-queue",
  () => {
    if (mockIngestQueueLoadError) {
      throw mockIngestQueueLoadError;
    }

    return {
      startIngestWorker: jest.fn(() => mockIngestWorker),
      getLastTickAt: jest.fn(() => new Date()),
    };
  },
  { virtual: true },
);

/** An Error shaped like the one require() throws for a missing file. */
const moduleNotFound = () => {
  const error = new Error("Cannot find module './lib/ingest-queue'");
  error.code = "MODULE_NOT_FOUND";
  return error;
};

// Every load registers its own handlers for these. Only the ones a load adds
// are removed afterwards — Jest has its own on the last two.
const PROCESS_EVENTS = [
  "SIGINT",
  "SIGTERM",
  "unhandledRejection",
  "uncaughtException",
];

/**
 * Yields to the microtask queue.
 *
 * Fake timers are in use, which fake setImmediate and process.nextTick too, so
 * awaiting a plain promise is the only reliable way to let a chain settle.
 */
const flush = async () => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

/**
 * Loads a fresh server with a fresh transfer register. Both must come from the
 * same module registry or they would not share the register at all.
 *
 * @param {Object} [options]
 * @param {string[]} [options.configErrors] - Makes validateEnv report a bad config.
 * @param {string[]} [options.configWarnings] - Warnings validateEnv should report.
 * @param {Function} [options.connect] - Stands in for mongoose.connect.
 * @param {boolean} [options.wait=true] - Await the startup sequence before returning.
 */
const loadServer = async ({
  configErrors = [],
  configWarnings = [],
  connect,
  wait = true,
} = {}) => {
  jest.resetModules();

  const transfers = require("../lib/active-transfers");
  const { validateEnv } = require("../lib/utils/validateEnv");
  validateEnv.mockResolvedValue({
    ok: configErrors.length === 0,
    errors: configErrors,
    warnings: configWarnings,
  });

  const mongoose = require("mongoose");
  if (connect) {
    mongoose.connect.mockImplementation(connect);
  }

  const server = require("../server");
  if (wait) {
    await server.started;
  }

  return { ...server, ...transfers };
};

/**
 * Requires server.js with a fresh registry, without awaiting startup.
 *
 * For the cases where the require itself is what is under test: the ingest
 * queue is a hard dependency, so a broken one has to reach the caller rather
 * than be caught and reported later.
 *
 * @returns {Object} The server module's exports.
 */
const loadServerModule = () => {
  jest.resetModules();

  const { validateEnv } = require("../lib/utils/validateEnv");
  validateEnv.mockResolvedValue({ ok: true, errors: [], warnings: [] });

  return require("../server");
};

let exitSpy;
let warnSpy;
let errorSpy;
let listenersBefore;

beforeEach(() => {
  listenersBefore = new Map(
    PROCESS_EVENTS.map((event) => [event, new Set(process.listeners(event))]),
  );
  jest.clearAllMocks();
  jest.useFakeTimers();
  exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
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

describe("startup order", () => {
  test("does not open the listener until the database is connected", async () => {
    // The whole point: the socket used to open next to connect() with no
    // ordering between them, so the API accepted requests it could only 500.
    let connected;
    const { started } = await loadServer({
      wait: false,
      connect: () => new Promise((resolve) => (connected = resolve)),
    });
    const app = require("../app");
    await flush();

    expect(app.listen).not.toHaveBeenCalled();

    connected();
    await started;

    expect(app.listen).toHaveBeenCalled();
  });

  test("binds to the resolved host, not every interface by default", async () => {
    await loadServer();
    const app = require("../app");

    expect(app.listen).toHaveBeenCalledWith(
      expect.anything(),
      "127.0.0.1",
      expect.any(Function),
    );
  });

  test("starts the background jobs before it listens", async () => {
    await loadServer();
    const app = require("../app");
    const { initializeBackgroundJobs } = require("../lib/background-jobs");

    expect(initializeBackgroundJobs.mock.invocationCallOrder[0]).toBeLessThan(
      app.listen.mock.invocationCallOrder[0],
    );
  });

  test("exits without listening when the database is unreachable", async () => {
    await loadServer({ connect: () => Promise.reject(new Error("no route")) });
    const app = require("../app");
    await flush();

    expect(app.listen).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("does not open the listener if a signal arrives mid-startup", async () => {
    // Otherwise the socket opens into a process that has already decided to go.
    let connected;
    const { started, shutdown } = await loadServer({
      wait: false,
      connect: () => new Promise((resolve) => (connected = resolve)),
    });
    await flush();

    shutdown(0);
    connected();
    await started;

    expect(require("../app").listen).not.toHaveBeenCalled();
  });
});

describe("startup configuration check", () => {
  test("refuses to start when the configuration is bad", async () => {
    await loadServer({ configErrors: ["JWT_SECRET is not set"] });
    const app = require("../app");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(app.listen).not.toHaveBeenCalled();
  });

  test("does not connect to the database first", async () => {
    await loadServer({ configErrors: ["JWT_SECRET is not set"] });
    const mongoose = require("mongoose");

    expect(mongoose.connect).not.toHaveBeenCalled();
  });

  test("names every problem it found", async () => {
    // One restart per missing variable is how a deploy takes an afternoon.
    await loadServer({
      configErrors: ["JWT_SECRET is not set", "DATASTORE_ROOT is not set"],
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("JWT_SECRET"),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("DATASTORE_ROOT"),
    );
  });

  test("logs warnings but still starts", async () => {
    await loadServer({ configWarnings: ["SMTP TLS verification is disabled"] });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("SMTP TLS verification is disabled"),
    );
    expect(require("../app").listen).toHaveBeenCalled();
  });
});

describe("the ingest worker", () => {
  test("starts once the database is connected", async () => {
    await loadServer();
    const { startIngestWorker } = require("../lib/ingest-queue");

    expect(startIngestWorker).toHaveBeenCalled();
  });

  test("leaves the queue's own defaults alone", async () => {
    // The lease length in lib/ingest-queue.js is sized against how long an
    // ingest of a multi-terabyte read takes; a default repeated here would
    // quietly override that reasoning.
    await loadServer();
    const { startIngestWorker } = require("../lib/ingest-queue");

    expect(startIngestWorker).toHaveBeenCalledWith({});
  });

  test("passes on what the environment does configure", async () => {
    process.env.INGEST_POLL_MS = "1000";
    process.env.INGEST_LEASE_MINUTES = "5";

    try {
      await loadServer();
      const { startIngestWorker } = require("../lib/ingest-queue");

      expect(startIngestWorker).toHaveBeenCalledWith({
        intervalMs: 1000,
        leaseMs: 300000,
      });
    } finally {
      delete process.env.INGEST_POLL_MS;
      delete process.env.INGEST_LEASE_MINUTES;
    }
  });

  test("is reported to the readiness probe", async () => {
    await loadServer();
    const app = require("../app");

    expect(app.registerReadinessCheck).toHaveBeenCalledWith(
      "ingest-worker",
      expect.any(Function),
    );
  });

  test("reports a worker that has stopped polling as not ready", async () => {
    // The process is alive and the queue is filling up: exactly the state a
    // liveness probe cannot see and a readiness probe exists for.
    await loadServer();
    const readiness = require("../app").registerReadinessCheck.mock.calls[0][1];
    const { getLastTickAt } = require("../lib/ingest-queue");
    getLastTickAt.mockReturnValue(new Date(Date.now() - 60 * 60 * 1000));

    expect(readiness().ok).toBe(false);
  });

  test("reports a worker that polled recently as ready", async () => {
    await loadServer();
    const readiness = require("../app").registerReadinessCheck.mock.calls[0][1];

    expect(readiness().ok).toBe(true);
  });

  test("does not fail readiness before the first poll", async () => {
    // getLastTickAt is null until the worker's first tick, a second or two in.
    await loadServer();
    const readiness = require("../app").registerReadinessCheck.mock.calls[0][1];
    const { getLastTickAt } = require("../lib/ingest-queue");
    getLastTickAt.mockReturnValue(null);

    expect(readiness().ok).toBe(true);
  });

  test.each([[null], [undefined]])(
    "reports a worker still reporting %p long after it started as not ready",
    async (reported) => {
      // The grace above is bounded on purpose. "No tick recorded" is absence
      // of evidence, not evidence of health: a worker whose timer never fired
      // reports exactly this forever, and treating it as fresh is how a queue
      // nothing drains keeps a green /ready.
      jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      await loadServer();
      const readiness =
        require("../app").registerReadinessCheck.mock.calls[0][1];
      const { getLastTickAt } = require("../lib/ingest-queue");
      getLastTickAt.mockReturnValue(reported);

      jest.setSystemTime(new Date("2026-01-01T00:05:00Z")); // five minutes on

      expect(readiness().ok).toBe(false);
    },
  );

  test("is a hard dependency: a missing queue module is not survivable", () => {
    // app.js -> routes/runs.js requires lib/ingest-queue.js unconditionally,
    // one line before server.js's own require, so a checkout without the file
    // has already crashed at `require("./app")`. A try/catch around the second
    // require reads as resilience and provides none.
    mockIngestQueueLoadError = moduleNotFound();

    try {
      expect(() => loadServerModule()).toThrow(/Cannot find module/);
    } finally {
      mockIngestQueueLoadError = null;
    }
  });

  test("does not swallow a queue module that exists but will not load", () => {
    // The same goes for a broken one: it must reach the supervisor as a failed
    // start, not be reported later by a /ready this process never gets to.
    mockIngestQueueLoadError = new SyntaxError("Unexpected token )");

    try {
      expect(() => loadServerModule()).toThrow(/Unexpected token/);
    } finally {
      mockIngestQueueLoadError = null;
    }
  });

  test("is stopped before the database connection closes", async () => {
    // It holds jobs and talks to Mongo; leaving it polling a closing
    // connection only produces errors on the way out.
    const { shutdown } = await loadServer();
    const mongoose = require("mongoose");

    shutdown(0);
    await flush();

    expect(mockIngestWorker.stop).toHaveBeenCalled();
    expect(mockIngestWorker.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mongoose.connection.close.mock.invocationCallOrder[0],
    );
  });

  test("still exits when stopping it fails", async () => {
    mockIngestWorker.stop.mockRejectedValueOnce(new Error("stuck"));
    const { shutdown } = await loadServer();

    shutdown(0);
    await flush();

    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

describe("shutdown while files are moving", () => {
  test("refuses a clean shutdown", async () => {
    const { shutdown, addTransfer } = await loadServer();
    addTransfer("file-1", "huge.bam");

    shutdown(0);
    await Promise.resolve();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("names the files that are still moving", async () => {
    const { shutdown, addTransfer } = await loadServer();
    addTransfer("file-1", "huge.bam");

    shutdown(0);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("huge.bam"));
  });

  test("suggests a force-kill that will actually work", async () => {
    // SIGKILL is the only signal a process cannot refuse.
    const { shutdown, addTransfer } = await loadServer();
    addTransfer("file-1", "huge.bam");

    shutdown(0);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`kill -9 ${process.pid}`),
    );
  });

  test("does not stop the background jobs it is not shutting down", async () => {
    const { shutdown, addTransfer } = await loadServer();
    const { stopBackgroundJobs } = require("../lib/background-jobs");
    addTransfer("file-1", "huge.bam");

    shutdown(0);

    expect(stopBackgroundJobs).not.toHaveBeenCalled();
  });

  test("reports itself as draining all the same", async () => {
    // The refusal does not mean the process is staying: PM2 SIGKILLs 30s after
    // the SIGINT (ecosystem.config.js). Answering /ready with 200 across that
    // window keeps the load balancer sending new work to a process that is
    // trying to die and may be killed mid-request.
    const { shutdown, addTransfer } = await loadServer();
    const app = require("../app");
    addTransfer("file-1", "huge.bam");

    shutdown(0);

    expect(app.setDraining).toHaveBeenCalledWith(true);
  });

  test("goes back into the pool if nothing kills it after all", async () => {
    // The other half of the same decision: a refused shutdown that is never
    // followed through (an operator's own SIGINT, say) leaves a process that
    // is serving perfectly well, and one that stayed unready would sit out of
    // the pool with nothing to bring it back.
    const { shutdown, addTransfer } = await loadServer();
    const app = require("../app");
    addTransfer("file-1", "huge.bam");

    shutdown(0);
    jest.advanceTimersByTime(45000); // past PM2's 30s kill_timeout

    expect(app.setDraining).toHaveBeenLastCalledWith(false);
  });

  test("stays out of the pool once a shutdown does go ahead", async () => {
    // The window must not un-drain a process that is on its way out.
    const { shutdown, addTransfer, removeTransfer } = await loadServer();
    const app = require("../app");
    const token = addTransfer("file-1", "huge.bam");

    shutdown(0);
    removeTransfer(token);
    shutdown(0);
    jest.advanceTimersByTime(45000);

    expect(app.setDraining).toHaveBeenLastCalledWith(true);
  });

  test("shuts down once the transfer finishes", async () => {
    const { shutdown, addTransfer, removeTransfer } = await loadServer();
    const token = addTransfer("file-1", "huge.bam");
    shutdown(0);
    expect(exitSpy).not.toHaveBeenCalled();

    removeTransfer(token);
    shutdown(0);

    expect(mockServer.close).toHaveBeenCalled();
  });

  test("still exits on a crash path", async () => {
    // The process state is untrustworthy by then, and an interrupted copy is
    // left as a .part- file rather than a truncated read.
    const { shutdown, addTransfer } = await loadServer();
    addTransfer("file-1", "huge.bam");

    shutdown(1);

    expect(mockServer.close).toHaveBeenCalled();
  });

  test("reports what it is interrupting when it exits anyway", async () => {
    const { shutdown, addTransfer } = await loadServer();
    addTransfer("file-1", "huge.bam");

    shutdown(1);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("still tracked"),
    );
  });

  test("gives way to a transfer that has stalled", async () => {
    // Otherwise one copy hung on a dead mount blocks restarts indefinitely.
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { shutdown, addTransfer } = await loadServer();
    addTransfer("file-1", "stuck.bam");
    jest.setSystemTime(new Date("2026-01-02T00:00:00Z")); // a day later

    shutdown(0);

    expect(mockServer.close).toHaveBeenCalled();
  });
});

describe("shutdown when nothing is moving", () => {
  test("closes the HTTP listener", async () => {
    const { shutdown } = await loadServer();

    shutdown(0);

    expect(mockServer.close).toHaveBeenCalled();
  });

  test("stops the background jobs", async () => {
    const { shutdown } = await loadServer();
    const { stopBackgroundJobs } = require("../lib/background-jobs");

    shutdown(0);

    expect(stopBackgroundJobs).toHaveBeenCalled();
  });

  test("reports itself as draining before it closes anything", async () => {
    // So a load balancer stops sending work during the drain window rather
    // than watching requests die when the listener goes.
    const { shutdown } = await loadServer();
    const app = require("../app");
    const { stopBackgroundJobs } = require("../lib/background-jobs");

    shutdown(0);

    expect(app.setDraining).toHaveBeenCalledWith(true);
    expect(app.setDraining.mock.invocationCallOrder[0]).toBeLessThan(
      stopBackgroundJobs.mock.invocationCallOrder[0],
    );
  });

  test("exits even if closing the connections never settles", async () => {
    // Neither draining connections nor closing Mongo is guaranteed to finish.
    mockServer.close.mockImplementationOnce(() => {});
    const { shutdown } = await loadServer();

    shutdown(0);
    jest.advanceTimersByTime(10000);

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("ignores a second shutdown once one is under way", async () => {
    const { shutdown } = await loadServer();

    shutdown(0);
    const { stopBackgroundJobs } = require("../lib/background-jobs");
    shutdown(0);

    expect(stopBackgroundJobs).toHaveBeenCalledTimes(1);
  });
});
