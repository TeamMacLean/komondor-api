module.exports = {
  testEnvironment: "node",

  // Runs before the framework is installed in each worker. See the file: it
  // turns off HTTP connection pooling, which is the cause of the intermittent
  // "socket hang up" / "Parse Error: Missing expected CR after response line"
  // failures that landed on an arbitrary route test in ~8% of full runs.
  // Turns off HTTP connection pooling. Hygiene, not a cure: read the file — it
  // records the measurements that show it does NOT fix the intermittent
  // "socket hang up" transport failures, and what else was ruled out.
  setupFiles: ["<rootDir>/__tests__/setup/httpAgent.js"],

  // A fraction, not a worker count. jest's default is cores-1, which on an
  // 8-core dev box means 7 workers each independently requiring mongoose: a
  // 450-module graph, reached transitively by most of the 67 suites, and
  // I/O-bound rather than CPU-bound. Several copies of it in flight on a
  // memory-constrained machine become a page-fault storm -- `sys` time
  // overtakes `user`, wall-clock inflates 5-18x, and tests needing
  // milliseconds of CPU blow jest's 5s *wall-clock* deadline. The symptom is
  // always "Exceeded timeout of 5000 ms", never an assertion, and it lands on
  // an arbitrary suite. Distinct from the transport flake documented in
  // __tests__/setup/httpAgent.js ("socket hang up"), which is still open.
  //
  // Nothing is given up by capping it. The whole suite is ~31s of single-core
  // work (--maxWorkers=1), so the extra workers were never buying throughput:
  // 2 workers finish a full run in 13-34s, i.e. at parity with the *best*
  // 7-worker run and ahead of its typical one. The starved tests are not slow
  // -- the two that failed a 16s run were a POST asserting a 400 and one
  // mocked update, and both passed 20 consecutive isolated runs with zero
  // timeouts.
  //
  // Timeout failures observed here, by setting, on an 8-core/8GB box:
  // 7 workers 1 run in 4; 4 workers 1 in 3; 3 workers 2 in 12; 2 workers 0 in
  // 6. Tuned on a machine often at load 20-60 with no free RAM, so the margin
  // matters more than the last few seconds. Raising testTimeout was rejected:
  // these tests need milliseconds, so a higher deadline would only hide a
  // genuine hang. Reducing per-suite setup was rejected too -- the cost is
  // mongoose itself, and dropping it means weakening the ~60 suites that need
  // real schemas and ObjectIds.
  //
  // Expressed as a percentage so it tracks the machine rather than this one:
  // 25% is 2 workers on an 8-core box and clamps to 1 on the 2-core
  // ubuntu-latest runners, which is already where cores-1 put CI -- so CI
  // behaviour is unchanged, and CI never saw this flake.
  //
  // Do NOT pair this with workerIdleMemoryLimit. Recycling a worker makes it
  // re-require that same graph from cold, which is the expensive thing here:
  // 50% + a 512MB limit failed 3 of 3 runs at 53-118s, against 16-21s without.
  maxWorkers: "25%",
  coveragePathIgnorePatterns: [
    "/node_modules/",
    // The nested-checkout exclusion, repeated here for the same reason it is
    // repeated in testPathIgnorePatterns below: `collectCoverageFrom` already
    // drops these files, but a CLI --collectCoverageFrom would replace that
    // glob array wholesale, and a worktree's files must never reach the
    // ratchet's denominator. <rootDir>-anchored: see the note below.
    "<rootDir>/.claude/",
    "/datastore/",
    "/files/",
    "/docs/",
  ],
  // A nested checkout is another repository, not additional tests/coverage.
  modulePathIgnorePatterns: ["<rootDir>/.claude/worktrees/"],
  testMatch: [
    "**/__tests__/**/*.js",
    "!**/__tests__/setup/**",
    // Shared fixtures for __tests__/integration/, not tests themselves. Kept
    // out via testMatch (not testPathIgnorePatterns): the CI integration job
    // overrides testPathIgnorePatterns on its own invocation to reach
    // __tests__/integration/ past the default-run exclusion below, and that
    // override must not accidentally let this directory get collected as
    // suites with no tests in them.
    "!**/__tests__/integration/support/**",
    "**/?(*.)+(spec|test).js",
    "!**/routes/test.js",
  ],
  // __tests__/integration/ needs a real mongod and is excluded from the
  // default run (this list, unlike testMatch, cannot be re-opened by a CLI
  // --testPathPattern — the CI integration job overrides this array on its
  // own invocation instead of relying on a narrower positive match).
  testPathIgnorePatterns: [
    "/node_modules/",
    // Git worktrees live at <rootDir>/.claude/worktrees/<branch>/ — inside the
    // repository — so the crawler would otherwise collect another branch's
    // suites as this checkout's own: 69 suites here, 139 with one worktree
    // present, and a haste-map name collision on the duplicate package.json.
    //
    // `modulePathIgnorePatterns` above is what keeps them out today (it drops
    // them before discovery ever sees them), but that is a module-visibility
    // setting doing test-discovery work by side effect. Stated here as well
    // because this is the array a CLI --testPathIgnorePatterns replaces, and
    // the CI/nightly integration jobs do exactly that — so the exclusion is
    // named in both of those invocations too, or moving it here one day would
    // silently hand the worktrees back to them.
    //
    // Anchored to <rootDir> deliberately. These patterns match against
    // ABSOLUTE paths, and a worktree checkout is itself under a `.claude/`
    // directory, so a bare "/.claude/" matches every test file in one and
    // finds zero tests (measured: 0 of 69).
    "<rootDir>/.claude/",
    "/__tests__/setup/",
    "/__tests__/integration/",
    "/datastore/",
    "/files/",
    "/docs/",
    "/routes/test.js",
  ],
  collectCoverageFrom: [
    "**/*.js",
    "!**/node_modules/**",
    "!**/.claude/worktrees/**",
    // Suites excluded from this run (notably integration) otherwise enter the
    // coverage denominator as unexecuted application code. Measure production
    // code, never test bodies or their fixtures.
    "!**/__tests__/**",
    "!**/datastore/**",
    "!**/files/**",
    "!**/docs/**",
    "!coverage/**",
    "!jest.config.js",
    // CLI entrypoints, not application code. Their exported logic
    // (findIndexConflicts, validateStoredJob, ...) is unit-tested and counts
    // above; their main() bodies are exercised end to end by
    // __tests__/integration/*-cli.test.js against a real mongod, which the
    // default run — and therefore this coverage figure — never executes.
    // Left in the denominator, 370 lines of integration-tested CLI plus the
    // untested ldap-diagnostic.js dragged the global figure under the ratchet
    // while every unit test passed; a deployment review reproduced the red
    // gate. Excluding them keeps the ratchet a statement about application
    // code, which is what a regression in it would actually mean.
    "!scripts/**",
  ],
  // A ratchet, not a target. Set from a real `npx jest --coverage` measurement
  // and then rounded down by 3-4 points, so the build is green on arrival but a
  // regression reddens it.
  //
  // The headroom is deliberate: `collectCoverageFrom` is "**/*.js", so adding
  // an untested file lowers the global figure even when no existing file got
  // worse. Raise these numbers when the real figure has moved up and stayed
  // up — never lower them to make a red build pass.
  //
  // Measured at the close of the hardening refactor:
  //   stmts 78.69, branch 73.89, funcs 69.90, lines 78.79
  // (the previous floor was 67/59/53/67, set against 70.55/62.74/56.73/70.74
  // before that work landed its tests; leaving it there left ~11 points of
  // slack, enough for a substantial regression to pass unnoticed).
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 70,
      functions: 66,
      lines: 75,
    },
  },
};
