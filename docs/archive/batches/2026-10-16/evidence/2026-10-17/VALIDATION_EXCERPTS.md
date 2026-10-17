# Validation log excerpts — 17 October 2026

Complete local logs are identified by SHA-256 in validation-results.json. These
excerpts preserve result counts, model-registration/smoke outcomes and the one
full-run failure for review through Git. Routine test console output is omitted.

## full-with-gzip-evidence-1.log

Command: `npm test -- --runInBand`. Exit: 0.

```text
PASS __tests__/scripts/model-registration.test.js
PASS __tests__/lib/s3-archive/smoke.test.js
Test Suites: 73 passed, 73 total
Tests:       2084 passed, 2084 total
Snapshots:   0 total
Time:        14.347 s, estimated 21 s
Ran all test suites.
```

## full-with-gzip-evidence-2.log

Command: `npm test -- --runInBand`. Exit: 1.

```text
FAIL __tests__/routes/uploads.test.js
  ● authentication on the upload mount › refuses an unauthenticated HEAD and an unauthenticated DELETE

    Parse Error: Expected HTTP/, RTSP/ or ICE/



PASS __tests__/scripts/model-registration.test.js
PASS __tests__/lib/s3-archive/smoke.test.js
FAIL __tests__/routes/uploads.test.js
  ● authentication on the upload mount › refuses an unauthenticated HEAD and an unauthenticated DELETE

    Parse Error: Expected HTTP/, RTSP/ or ICE/




Test Suites: 1 failed, 72 passed, 73 total
Tests:       1 failed, 2083 passed, 2084 total
Snapshots:   0 total
Time:        15.461 s
Ran all test suites.
```

## full-with-gzip-evidence-3.log

Command: `npm test -- --runInBand`. Exit: 0.

```text
PASS __tests__/scripts/model-registration.test.js
PASS __tests__/lib/s3-archive/smoke.test.js
Test Suites: 73 passed, 73 total
Tests:       2084 passed, 2084 total
Snapshots:   0 total
Time:        14.012 s, estimated 15 s
Ran all test suites.
```

## archive-tests-final.log

Command: `npm run test:archive`. Exit: 0.

```text
PASS __tests__/lib/s3-archive/smoke.test.js
Test Suites: 9 passed, 9 total
Tests:       167 passed, 167 total
Snapshots:   0 total
Time:        1.64 s
Ran all test suites matching /__tests__\/lib\/s3-archive\//i.
```

## integration-final.log

Command: `MONGODB_URI=mongodb://127.0.0.1:55459/komondor-batch-review-test npm run test:integration`. Exit: 0.

```text
Test Suites: 10 passed, 10 total
Tests:       58 passed, 58 total
Snapshots:   0 total
Time:        69.896 s
Ran all test suites matching /__tests__\/integration\//i.
```

## gzip-evidence-tests.log

Command: `npm test -- --runInBand __tests__/scripts/archive-gzip-evidence.test.js`. Exit: 0.

```text
Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        0.571 s
Ran all test suites matching /__tests__\/scripts\/archive-gzip-evidence.test.js/i.
```

## uploads-isolated-after-http-failure.log

Command: `npm test -- --runInBand __tests__/routes/uploads.test.js`. Exit: 0.

```text
Test Suites: 1 passed, 1 total
Tests:       39 passed, 39 total
Snapshots:   0 total
Time:        1.486 s
Ran all test suites matching /__tests__\/routes\/uploads.test.js/i.
```
