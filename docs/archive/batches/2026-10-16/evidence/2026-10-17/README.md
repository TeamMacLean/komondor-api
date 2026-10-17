# Read-only evidence provenance — 17 October 2026

All production operations in this folder are reads: metadata queries, directory
inventories and streaming hashes. Output was written on the operator's Mac, not
on v1333. The runners do not modify MongoDB, S3, project trees or production code.

- `relations-20261017T063115Z.*`: initial eight-project document export.
- `relations-20261017T064145Z.*`: authoritative refreshed export, including legacy
  string/ObjectId File-reference checks. All 48 documents are byte-identical to the
  first BSON snapshots and all blocker lists remain empty.
- `registration-groups.*`: the two group IDs/safe names used in the placeholder
  proposals; this did not create projects or send notifications.
- `paths-20261017T063123Z.*`: file-location evidence collected by the original
  collector version. Treat this as complete only when its command receipt reports
  exit code 0 and its JSON contains all eight projects/110 records.

Every command receipt records the exact SSH invocation and output SHA-256. The
relations/paths receipts also record target IDs/paths and collector SHA-256.
`collect-readonly-v1.cjs` is the exact source for the initial relations export and
path-hashing run. `collect-readonly.cjs` is the source for the refreshed relations
export and future read-only reruns. The only difference is defensive handling of
legacy string reference IDs in `collectRelations`; hashing/classification is unchanged.
The runner loads source into memory over SSH; the virtual Module filename in the
invocation is not a file written to the production checkout.

The raw relations JSON contains base64 BSON `{documents: [...]}` with a SHA-256
for each collection. Preserve those bytes for restoration; the decoded readable
`../../dependent-records.json` is a review view, not a lossless substitute.
No credentials are included. Owner names and ordinary project metadata are retained
in this private repository for the scoped disposal audit.

`correct-diagnostics.cjs` produces derived diagnostic reports from the immutable
October 16 observations. Those corrected labels are not fresh production observations.
