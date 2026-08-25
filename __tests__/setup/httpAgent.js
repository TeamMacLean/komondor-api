/**
 * Disables HTTP connection pooling for the test run.
 *
 * READ THE MEASUREMENT BELOW BEFORE TRUSTING THIS FILE. It is a reasonable
 * hygiene change, but it is NOT the fix for the suite's intermittent transport
 * failures, and it was written while chasing them.
 *
 * The symptom: roughly one full run in twelve fails with a bare "socket hang up"
 * (sometimes "Parse Error: Missing expected CR after response line") on an
 * arbitrary route test — at least ten different victims observed. It carries no
 * assertion text, because no assertion ran. It reproduces on master, so no code
 * on this branch causes it.
 *
 * The rationale for this file: Node 19 made `http.globalAgent` keep-alive by
 * default, and supertest starts an ephemeral server per request and closes it
 * immediately, so a pooled socket routinely outlives the server it points at.
 * Reusing one would land the client part-way into a dead connection, which is
 * what the symptom looks like. Pooling buys nothing here — every request goes to
 * a different short-lived server — so switching it off costs no test time.
 *
 * What was actually measured, on Node 26.7.0 (20 full runs of the route and app
 * suites per cell):
 *
 *   supertest 6.3.4, pooling on   — 1 failure in 8
 *   supertest 7.2.2, pooling off  — 1 failure in 20
 *   supertest 7.2.2, pooling on   — 2 failures in 20
 *
 * Three failures in forty runs either way. That is noise, not a fix. Upgrading
 * supertest 6 -> 7 (superagent 8 -> 10) did not fix it either; that upgrade was
 * kept on its own merits, not this one.
 *
 * Also ruled out, so nobody repeats the work:
 *   - Not the application code: 4000 sequential express+supertest requests with
 *     none of this repo's code loaded produced zero failures.
 *   - Not fake timers: only three lib suites use them and none drives a listener.
 *   - Not parallelism alone: it still occurs under --runInBand.
 *
 * The root cause is unresolved and needs an owner. CI tolerates it explicitly —
 * see the "Unit tests with coverage" step in .github/workflows/ci.yml, which
 * retries ONLY when every failure matches a bare transport error, caps the count,
 * and refuses to retry a suite that failed to load or a coverage-ratchet failure.
 * That is a mitigation, not a cure: an 8% red rate trains people to re-run red
 * builds, which is the reflex that waves a real regression through.
 */

const http = require("http");
const https = require("https");

http.globalAgent = new http.Agent({ keepAlive: false, maxSockets: Infinity });
https.globalAgent = new https.Agent({ keepAlive: false, maxSockets: Infinity });
