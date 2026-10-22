# Fresh read-only preview — 22 October 2026

**Step 1 implementation update:** [registration runbook](../../../../ARCHIVE_PROJECT_REGISTRATION.md)
and [exact 23-target input](registration-targets.json). The administrative registration
command and creation-history safeguards are implemented locally and tested on a
scratch database. Production is unchanged. File-path corrections, classification,
retirement and archival remain later steps; the earlier investigation below is
retained as evidence rather than an execution-completion claim.

**All 197 entries were inspected on v1333 as deeks, 16:46–16:51 UTC.** Collection
completed without errors. File counts and byte totals agree with the earlier
evidence for every entry. That establishes inventory totals, not unchanged content.
This is not a transaction snapshot or a writer freeze.

Production remained at `c6b9d77db069fa6dd808367086ff358302565b2f`, clean before and
after. No database record, file content, service or S3 object was changed, and no
notification was sent. All evidence is saved locally.

## What this means for George

**No new owner or disposition decision is currently required.** The chosen policy
gives a preservation route for all 197 entries, including files of unknown scientific
classification. Checks found no active ingest/run/MD5 work, outside references to
selected File documents, ambiguous longest-path parents, or unresolved referenced
File locations after accounting for the three documented filename corrections.
This does not certify scientific identity, prove external writers are stopped,
or establish full checksum coverage.

There are **176 entries to preserve/archive**, **11 KEEP**, **six existing explicit
direct-disposal decisions**, and **four empty entries to record or retire**. These
remain proposed actions. Nothing was archived or deleted by this inspection, and
no retirement mechanism has been implemented.

George accepts the registration/path correction approach; see the
[original-value retention design](ORIGINAL_VALUES_AND_CORRECTIONS.md). Production
execution still follows review of the exact changes and the separate go-ahead. Technical uncertainties may emerge during association checks and implementation.
The separate bulk checksum sweep has been cancelled. Unknown classification is already accepted; it must
not be disguised as reconstructed scientific metadata.

## Owners and registrations

All **23 proposed project registrations** still have no existing Project claim
against their exact physical root. [Ownership decisions and next steps](OWNERSHIP_AND_NEXT_STEPS.md)
record the follow-up investigation and George's fallback instruction:

| Set | Number | Observed Unix owner | Proposed catalogue handling |
|---|---:|---|---|
| Talbot `project_*` directories | 17 | `tsldata` | Register with `shrestha` as administrative custodian. Research clues do not establish a reliable individual owner. |
| Two Blades `Courville` | 1 | `shrestha` | Register with `shrestha` as administrative custodian. |
| Additional Saunders directories | 5 | `root` | Preserve/archive; register with `winj` as administrative custodian by George’s explicit selection. Original scientific ownership remains unresolved. |
| Existing Saunders records associated with five disposal directories | 5 | Retained in inventory | Keep existing `winj` owner and `kamouns` secondary owner. No disposition change. |

The read-only database lookup confirms `shrestha` is Ram-Krishna Shrestha and
`winj` is Joe Win. Existing database owners and secondary owners remain unchanged.
Unix ownership is retained as provenance; no filesystem ownership change is
proposed. The current creation route assigns the operator and may send email,
so it remains unsuitable for this migration without reviewed changes.

## Location proposals

- **107 of the 110 investigated records already store the observed physical path.**
  Keep their identities and paths; make relevant application consumers consistently
  use the validated stored location.
- **Three records in `jjones-008` need proposed stored-path corrections** from
  `.fastq.txt` to the existing `.fastq` files. All three now have complete current
  physical-byte hashes (6,049,593,971 bytes). This does not supply their missing
  historical upload checksums.
- **35 previous derived-path collisions** across three projects correspond to
  distinct physical paths for every pair. Do not merge or delete records to make
  those warnings disappear. The collision belongs to the derived-path assumption.
- No filesystem moves are proposed. Mixed-case roots, including the registered
  Jones mismatch, still require a consistent physical-path design across hooks
  and consumers. That code is not changed here.

See [exact per-record proposals](location-proposals.json), current associations
in [live-files.jsonl](live-files.jsonl), and
[the 35 collision pairs](previous-derived-path-collisions.json).

## The actual catalogue work

The 176 archive entries contain **15,397 physical files, totalling
13,448,802,534,476 bytes (13.45 TB decimal)**. Actual stored paths associate
**3,522 files with existing records**. The other **11,875** need catalogue entries
or explicit preservation as unclassified files. The scoped lookup found no
standalone orphan File documents for those paths.

These counts supersede the earlier partial untracked-path classification for
planning this scope. They include complete live inventories for unregistered
directories and the case-mismatched root, and match actual stored paths rather
than old `raw/` expectations. They do not indicate that new files appeared.

| Provisional class of the 11,875 uncatalogued files | Files |
|---|---:|
| Checksum-looking files | 4,958 |
| Other supporting-looking files | 1,298 |
| FASTQ-looking files | 3,795 |
| Other sequence/data formats | 1,428 |
| Unclassified | 396 |
| **Total** | **11,875** |

| Candidate parent | Files |
|---|---:|
| Existing Run | 9,453 |
| Existing Sample | 1,124 |
| Existing Project | 348 |
| Project to be registered | 950 |
| **Total** | **11,875** |

**3,315 FASTQ candidates sit beneath an existing Run's `raw/` directory.** That
supports proposed Read registration, but does not prove rawness, sample identity,
pairing or a valid complete FASTQ stream. Classification remains based on filename
and directory until content checks support it. Parent candidates are longest
existing path-prefix matches; none was ambiguous, but this is not scientific
identification. Unknown classification can remain preserved.

The two known projects without Run records remain so: `two_blades-007` has 12
Samples; `two_blades-012` has no Samples. Retain their files without fabricating
the missing Run metadata.

## Current observations retained; separate bulk sweep cancelled

**6,771 files / 6,961,044,378 bytes have fresh MD5 and SHA-256 observations.**
Each includes its physical path, size, timestamp, stable-file identity and receipt.
Both hashing runs finished successfully, at 16:52:46 and 16:55:13 UTC.

Coverage includes archive files at most 1 MiB, all files in the three pilots, and
the three filename-correction candidates. **8,626 files / 13,441,841,490,098 bytes
were not measured by this audit.** George has cancelled the separate remaining-data
sweep. These counts are coverage gaps, not outstanding audit jobs or a new pilot gate.

Normal `copy --execute` still hashes each project's physical bytes to seal its
manifest, then reads them again for upload and checks the stream/S3 checksums.
No extra whole-batch MD5/SHA-256 pass is required. This retains the mover's necessary
integrity checks; it does not make the transfer a single-read operation.

No legacy checksum field was filled or cleared, no original upload was newly
marked verified, and no checksum was written to MongoDB. Retain current archive
checksums with their manifest provenance; historical gaps remain explicit.
The earlier read-only jobs have finished; no bulk sweep is running.

- [Completed observations](current-checksums.jsonl)
- [Coverage and receipt summary](current-checksum-summary.json)
- [Unmeasured audit paths, not a job queue](current-checksum-pending.json)

## Retained records and next implementation work

The two empty projects and six explicitly disposed projects should retain their
records and dependent history when those dispositions are actually executed. Do
not run the older deletion filters. Retirement must be enforced by API queries
and writes, ingestion, MD5, ENA and Nudge, separately from HPC/S3 storage state.
All four empty entries remain empty in the live inspection.

The next reviewable implementation should cover:

1. Consistent validated physical paths, preserving old paths and references.
2. Administrative registration preserving legacy identifiers, without notifications
   or automatic moves, using the recorded administrative custodian where research ownership is unknown.
3. Current-checksum provenance distinct from historical upload verification.
4. Catalogue additions that preserve unknown classification and avoid duplicate
   File/Read records, with supporting files linked at an evidenced parent.
5. Retired records that remain auditable and cannot silently re-enter processing.

Prove the implementation on a scratch database before production writes. Refresh
identities and association checks before applying anything; this inspection is
not execution permission. Normal archive and manual deletion gates remain.

## Evidence and limits

[live-summary.json](live-summary.json), [live-projects.json](live-projects.json),
[live-files.jsonl](live-files.jsonl) and [live-exceptions.json](live-exceptions.json)
are derived from the retained SSH output. The empty exception list applies to
the structural checks implemented; it is not a blanket integrity certificate.

Raw output, command receipts and exact collector versions are under
[live-evidence](live-evidence/). MongoDB used raw read queries with automatic
index/collection creation disabled. The collector validated the NFS mount and
followed no symlinks or model save hooks. Hashing used read-only handles and
compared identities before and after reading, including the named path.
Observations were sequential and do not establish quiescence of external writers.
