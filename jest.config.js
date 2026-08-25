module.exports = {
  testEnvironment: "node",
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/datastore/",
    "/files/",
    "/docs/",
  ],
  testMatch: [
    "**/__tests__/**/*.js",
    "**/?(*.)+(spec|test).js",
    "!**/routes/test.js",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
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
