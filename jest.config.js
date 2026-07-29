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
};
