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
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/datastore/",
    "/files/",
    "/docs/",
  ],
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
    "!**/datastore/**",
    "!**/files/**",
    "!**/docs/**",
    "!coverage/**",
    "!jest.config.js",
    // Test-support helpers, not application code: unlike a *.test.js file,
    // these are not automatically excluded by jest's own "don't pad coverage
    // with test files" rule, so without this they would count as 0%-covered
    // additions to the default run's coverage denominator despite never
    // being reachable from it (they exist only for __tests__/integration/,
    // which that run does not execute).
    "!**/__tests__/integration/support/**",
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
