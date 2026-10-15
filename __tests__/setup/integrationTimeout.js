/**
 * Raises jest's per-test deadline for the integration suites only.
 *
 * Those suites talk to a real mongod and spawn real child processes, so an
 * index build or a server boot can legitimately exceed jest's 5s default on a
 * loaded machine. Observed as "Exceeded timeout of 5000 ms" landing on an
 * arbitrary suite -- power-submission-cli and startup-index-conflict both hit
 * it -- in roughly 2 of 6 full integration runs, while the same suites pass
 * every time in isolation.
 *
 * The unit suite keeps the 5s deadline deliberately. Those tests need
 * milliseconds, so a longer deadline there would hide a genuine hang rather
 * than fix anything; `maxWorkers` in jest.config.js is what stopped them
 * starving each other. This file is the integration half of that story and
 * must not become a blanket `testTimeout`.
 *
 * Why here and not on the command line: the integration suite is started from
 * three places -- package.json's `test:integration`, ci.yml and nightly.yml --
 * and a CLI array option such as --testPathIgnorePatterns *replaces*
 * jest.config.js's value rather than merging with it. A per-invocation
 * --testTimeout would have to be repeated in all three and would silently drop
 * out of any new one. `setupFilesAfterEnv` is config, is not replaced by those
 * overrides, and so travels with the tests however they are invoked.
 */
const INTEGRATION_TIMEOUT_MS = 30_000;

// Populated by jest before setupFilesAfterEnv runs; the absolute path of the
// suite about to execute.
const testPath = (expect.getState && expect.getState().testPath) || "";

if (/__tests__[\\/]integration[\\/]/.test(testPath)) {
  jest.setTimeout(INTEGRATION_TIMEOUT_MS);
}

module.exports = { INTEGRATION_TIMEOUT_MS };
