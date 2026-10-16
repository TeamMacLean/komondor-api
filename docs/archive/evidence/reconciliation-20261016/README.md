# Reconciliation validation evidence — 16 October 2026

See [the review](../../RECONCILIATION_REVIEW_2026-10-16.md) for scope and limitations.
`results.json` records command, exit status, timestamps, summaries, smoke/model-registration
results and hashes of the tested code. Each `.log.gz` is a losslessly compressed full log;
the JSON records the SHA-256 of its uncompressed bytes.

Three full runs completed: two passed, one had an HTTP parser failure in a route test.
One additional attempt crashed in V8 and is preserved separately. The smoke and
model-registration suites passed in all three completed full runs. The overall gate
is not green. Archive and scratch-Mongo integration runs passed. No test or CI rule
was weakened, and no merge or push was performed.
