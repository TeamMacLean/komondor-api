# Read-only evidence provenance — 17 October 2026

All production operations in this folder are reads: metadata queries, directory
inventories and streaming hashes. Output was written on the operator's Mac, not
on v1333. The runners do not modify MongoDB, S3, project trees or production code.

- `relations-20261017T063115Z.*`: initial eight-project document export.
- `relations-20261017T064145Z.*`: authoritative refreshed export, including legacy
  string/ObjectId File-reference checks. All 48 documents are byte-identical to the
  first BSON snapshots and all blocker lists remain empty.
- `candidate-size-estimate.*`: metadata-only estimate of candidate counts/bytes,
  including stored File paths whose basenames differ from the expected name. This
  is a runtime estimate, not checksum verification or a file-identity decision.
- `flagged-path-metadata.*`: focused Read/File/Run metadata for the 26 gzip
  checksum discrepancies in three Jones projects.
- `gzip-diagnostics-20261017T072328Z.*`: failed auxiliary attempt; the diagnostic
  closed its file descriptor before the final stat check. No checksum result was
  accepted. The exact failed source is retained as `collect-gzip-diagnostics-v1.cjs`.
- `gzip-diagnostics-20261017T072649Z.*`: successful corrected diagnostic, supported
  by four unit tests (including corrupt trailer and symlink refusal). All 26 decoded
  streams match the recorded original MD5; their compressed-byte checksums differ.
  This does not claim that the compressed bytes match the historical checksum.
- `registration-groups.*`: the two group IDs/safe names used in the placeholder
  proposals; this did not create projects or send notifications.
- `extension-paths-20261017T070916Z.*`: three explicitly observed `.fastq`
  alternatives for the missing `.fastq.txt` names in jjones-008, hashed with
  `collect-extension-candidates.cjs`. This supplements, not duplicates, the primary
  job, which has no candidates for these three records.
- `paths-20261017T063123Z.*`: interrupted original attempt, exit 255, no JSON
  result returned. Empty stdout is retained as `.stdout.txt`, with its original
  name recorded in the command receipt. Its progress is not checksum evidence.
- `paths-retry-20261017T115634Z*`: repeated read-only comparison using the same
  hashing/classification implementation. `run-path-retry.py` saves each project's
  output and command receipt separately on the Mac, with at most two concurrent
  readers. Four complete reports (59 records) were saved; the connection ended at 12:32 UTC
  before the other four projects completed. No aggregate was accepted. Failed empty
  outputs are retained as `.stdout.txt`, with their execution names in the receipts.

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


## Resumable record observations

`resume-path-review.py` validates/reuses the four complete project reports and,
with `--execute`, observes only remaining records. No flag means local validation
only. It checks for surviving old collectors before launching at most two readers.
`collect-path-record.cjs` differs from `collect-readonly.cjs` only by including the
SHA-256 of the complete inventory in its result; hashing and classification are
unchanged. Each record job still checks its whole project tree before/after.
Aggregation requires identical whole-tree fingerprints across record jobs, exact
record coverage, consistent code/Git identity and consistent duplicate candidate
hashes. Per-observation timestamps and source receipts are retained. It does not
claim a database snapshot transaction or a freeze for a future archive.

Eight local synthetic aggregation tests cover missing/duplicate records, changed
inventories, conflicting file hashes, changed module code and reuse of complete
project evidence. The test command is
`python3 __tests__/scripts/archive-path-resume.test.py`.

## Completed aggregate and decisions

`paths-record-20261017T125243Z-*` contains the 51 successful resumed record observations.
Together with the four earlier complete project reports (59 records), these form
[the 110-record aggregate](paths-complete-20261017T125243Z.json) and
[its provenance receipt](paths-complete-20261017T125243Z.command.json).
All per-record whole-tree fingerprints agree within each project; duplicate candidate
hashes, source modules and clean production Git identities also agree.

The successful local derivation command was:

```bash
node docs/archive/batches/2026-10-16/evidence/2026-10-17/summarize-paths.cjs paths-complete-20261017T125243Z.json
```

It binds the three extension alternatives and all 26 gzip diagnostics to the primary
observations. [The derived report](../../PATH_RESOLUTIONS.md) distinguishes 51 physical
original-MD5 matches, 26 decoded-payload matches and 33 records without a valid original
MD5. No file move or database repair is proposed. The finalized action table was
produced by the one-time `finalize-path-actions.py` against the `e0b5e03` checkpoint.
