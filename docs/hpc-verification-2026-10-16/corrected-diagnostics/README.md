# Corrected diagnostic labels, 17 October 2026

These four reports derive from the unchanged `../independent-review/` observations.
They correct the `kind` overwrite in `overlayDatabase`: missing-file anomalies now
have `kind: "db-file-missing"` and separate `recordKind: "read"` or `"additionalFile"`.
The `dbRecordsMissingOnDisk` records keep their existing `kind` field.

The structured register's anomaly-kind counts and CSV evidence links use these
corrected reports. File counts, missing-path counts, serious-anomaly counts,
observation times and decisions are unchanged. This is not a fresh inspection.
Raw reports and their original provenance hashes remain intact, including the
older Claude reports one directory above. Do not use their old `read` anomaly
label to infer that missing files were absent from the audit.

Reproduce locally from the repository root:

```sh
node docs/archive/batches/2026-10-16/evidence/2026-10-17/correct-diagnostics.cjs
```

Each corrected report records its original report hash. The script verifies each
relabelled anomaly against its original missing-record entry before updating it.
