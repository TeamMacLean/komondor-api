# Read-only reconciliation preview — 22 October 2026

**Step 1 implementation update:** [registration runbook](../../../../ARCHIVE_PROJECT_REGISTRATION.md)
and [exact 23-target input](registration-targets.json). The administrative registration
command and creation-history safeguards are implemented locally and tested on a
scratch database. Production is unchanged. File-path corrections, classification,
retirement and archival remain later steps; the earlier investigation below is
retained as evidence rather than an execution-completion claim.

**Fresh inspection is now complete: read [LIVE_PREVIEW.md](LIVE_PREVIEW.md) first.**
All 197 entries were inspected on v1333 on 22 October. The initial current-checksum
pass measured 6,771 files; the separate sweep of the other 8,626 files is cancelled.
See [ownership and next steps](OWNERSHIP_AND_NEXT_STEPS.md): the five additional
Saunders registrations use `winj`; the other 18 use `shrestha`. Existing owners remain.
George accepts the registration/path correction approach; the
[original-value retention design](ORIGINAL_VALUES_AND_CORRECTIONS.md) explains how
changes will remain traceable. Production has not been changed. No production records, file
contents, services or S3 objects were changed. No email was sent.

The remainder records the earlier saved-evidence preview from 16–17 October.
Its counts, original owner proposals, checksum-sweep plan and pending-authentication
notes are historical and superseded; the live report
supplies the latest scope, associations and checksum coverage.

George's [recorded decisions](policy.json) supersede the older enquiry/deadline,
pending-Saunders and permanent database-deletion proposals. This preview does not
authorize implementing or executing the proposed database changes. Historical
registers, source files, observations and prior checksum evidence are unchanged.

## Decision table

| Proposed disposition | Original 192 | Additional Saunders | Total |
|---|---:|---:|---:|
| Preserve and archive | 171 | 5 | 176 |
| Existing explicit Kamoun direct-disposal decisions | 6 | 0 | 6 |
| Keep on HPC | 11 | 0 | 11 |
| Retire empty project records, retaining history | 2 | 0 | 2 |
| Record empty unregistered directories | 2 | 0 | 2 |
| **Total** | **192** | **5** | **197** |

The [complete decision table](PROJECT_DECISIONS.md) retains one row for every
original entry and adds five explicitly identified supplementary entries.
[projects.json](projects.json) includes physical/registered roots, owner evidence,
observed counts, proposed handling and execution status for every row.

The six existing disposal decisions do not authorize fresh deletion now. The 11
KEEP projects remain outside reconciliation changes. Nothing is deleted on silence.
The five additional Saunders directories are approved for preservation and archival;
they are not added to the direct-disposal list. No age cutoff has been introduced.

## What the planned owner enquiries were

They were for **17 Talbot `project_*` directories and `two_blades/Courville`** with
no Project record. They were not requests to replace existing legacy owners.
The old workflow waited for an answer/deadline before administrative registration.
George has now accepted preservation without those enquiries.

- Preserve every existing database `owner` and `secondaryOwner`.
- The original filesystem exports identify **`tsldata` for all 17 Talbot
  directories** and **`shrestha` for Courville**. Preserve these identifiers and
  their source. They are not proof of scientific ownership or current responsibility.
- Propose registering those existing directories under the correct groups while
  retaining the legacy identifier. Do not substitute `deeks` as the research owner.
- The five additional Saunders directories lack an established owner identifier
  in this evidence. A fresh read-only identity lookup remains necessary; do not
  infer an owner from the `saunderd` name prefix. An explicitly unknown owner is
  preferable to an invented one and need not block preservation.
- **No owner contact, administrator address or response deadline is required by
  this preview.** No new owner-disposition decisions remain for the 197 entries.

There are **23 proposed project registrations**: the original 18 plus the five
supplementary Saunders directories. This is a proposed count, subject to a fresh
check that nobody has registered the directories since the observations.
The old `POST /projects/new` recipe derives ownership from the authenticated user,
normalizes the directory name and attempts an overseer email. It must not be used
unchanged to implement this new policy.

## Location investigation: mostly an application assumption

The [110 per-record proposals](location-proposals.json) identify exact Read, File
and Run IDs, old expected/stored paths and all observed candidate paths.

| Finding | Records | Proposed solution |
|---|---:|---|
| Existing `File.path` already names an observed file | 107 | Make all relevant consumers resolve the verified stored location; retain the former derived expectation as audit history. |
| Stored filename ends in `.fastq.txt`, observed filename ends in `.fastq` | 3 | After fresh identity checks, correct the three stored physical paths; preserve former names/paths and record IDs. |
| No supported candidate location in the reviewed evidence | 0 | No file is presently proposed as lost on this evidence. This is limited to the 110 investigated records. |

The three path corrections belong to `jjones-008`. The precise values are in
`location-proposals.json`, under `proposal: correct-stored-path-after-live-check`.
No Sample/Run reassignment is proposed. No physical file move is proposed.
Preserve every duplicate physical path; do not merge Reads just because file bytes
match. One copy can have more than one historical reference.

The archive overlay currently derives `Run.path + /raw/ + File.originalName`;
the MD5 worker and web read list also derive locations. Merely editing `File.path`
does not fix those consumers. A reviewed implementation should consistently use
an explicitly validated physical path contained within the correct project root,
retain old expectations as history, and refuse escapes, symlinks and ambiguous
associations. A missing or invalid stored path must remain an explicit unresolved
state rather than falling back silently to whichever file happens to exist.

For the Jones root case mismatch, Courville and mixed-case Saunders roots, the
preferred proposal is to keep the observed physical spelling and separate it from
display/safe names. This needs review of Project/Sample/Run path derivation and
save hooks; the current code regenerates paths. The alternative is a separately
reviewed root rename with identity checks. Neither option has been implemented
or selected for execution here. Do not move Saunders data into empty shells merely
to make a discrepancy disappear.

## Current checksums only

New observations will hash the **physical file bytes as stored**, recording MD5
and SHA-256 in one pass, with observation time, canonical path, byte count,
stable-file identity and collector version. Gzip files are hashed compressed.
Their new baseline is not a statement about historical uncompressed checksums.

Store the result as a separately identified **current observation**. Do not fill
an absent original `MD5`, rewrite `destinationMd5` as if the old upload had been
checked, clear an old mismatch, or set a historical upload to verified. Existing
checksum text files are preserved as files; their contents are not adopted to
close the legacy gap. Retain all existing original fields and previous evidence.

The old reports contain 3,896 missing destination-checksum warnings across 101
entries; **3,164 across 90 entries are within the archive scope**. These are old
warning counts, not the number of physical files that require a current baseline.
Every preserved physical file needs its own current observation, including
uncatalogued files and files beneath newly registered projects.

**Zero new HPC data checksums have been calculated by this offline preview.**
The 112 candidate-file hashes from 17 October remain explicitly previous
observations, not current measurements. Report/provenance hashes created locally
must not be confused with checksums of HPC data. A fresh full inventory is needed
to determine total hashing bytes and plan a bounded/resumable read-only run.

## File classification preview

There are 11,626 reported untracked physical paths across 109 original entries.
Excluding KEEP and direct-disposal entries leaves **10,935 paths across 106
archive entries**. The file-level preview covers these reported paths, not the
entire filesystem. Newly registered directories and already-catalogued files
still require complete live collection.

| Provisional category | Archive-scope paths | Proposed handling |
|---|---:|---|
| Checksum-looking files | 4,646 | Supporting checksum files; preserve contents without adopting their historical claims. |
| Other supporting-looking files | 1,077 | Supporting files after content and parent checks. |
| FASTQ-looking files | 3,569 | Resolve existing references and logical parents before creating any Read. |
| Other sequence/data formats | 1,179 | Preserve; determine whether raw, processed or supporting from evidence. |
| Unclassified | 353 | Preserve with an explicit unclassified label. |
| Paths associated with the already-investigated Reads | 111 | Link to existing records; do not blindly create new Reads. |
| **Total** | **10,935** | |

These are filename/directory classifications, **not content validation**. FASTQ
does not mean raw: trimmed or processed data can use the same format. BAM/FASTA/HDF5
also do not establish a scientific role or sample identity. Missing scientific
metadata must remain unknown. There is no promise that all 5,723 supporting-looking
paths can immediately become AdditionalFile records at the right parent.

There are 110 reviewed Read records, 112 distinct candidate paths, and 111 of
those paths occur in the old untracked-path lists. These denominators differ
because database records, physical paths and untracked classifications differ.

[file-classification.jsonl](file-classification.jsonl) has one row for every
reported untracked path, including whether it is in scope, reference IDs where
known, a provisional parent-path hint, and what must be checked before linking it.
It contains no executable database updates. `currentChecksum: null` means not
measured in this preview; it must not be interpreted as a passing checksum.

The 3,569 FASTQ candidates span 59 archive entries. That is an automated matching
queue, not 59 questions for George. Two entries have no Run records in the saved
snapshot: `two_blades-007` (12 Samples) and `two_blades-012` (no Samples). Do not
invent biological metadata to complete their required Run fields. Preserve them
as unclassified sequence data until a supported association is available.

## Retain records instead of erasing history

For the two empty registered projects and six approved direct-disposal projects,
the existing scoped export covers 48 documents including dependents. Preserve
the IDs, original fields, references and before-images; propose retirement only
when the corresponding physical disposition is actually established. The two
empty unregistered directories have no Project record to retire.

Record status must remain separate from `storage.state`. Disposed data with no
S3 copy must never be labelled `aws`. Retired/missing records must be excluded
from normal write operations, background ingestion/MD5, ENA handling and Nudge,
while remaining searchable by administrators. Reappearance must require identity
checking before reactivation. Merely adding an unused `deleted` flag would not
provide that behaviour. No retirement support has been implemented by this preview.

## What remains before an execution proposal

1. Re-establish SSH and collect a fresh full inventory plus Project/Sample/Run/
   Read/AdditionalFile/File associations with read-only queries. Confirm the real
   mount, source identity and current application state; report changes separately.
2. Reconcile by existing IDs and verified physical paths first. Check all parent
   relationships, shared references, duplicates and unreadable/changing files.
   Do not identify a file solely by its basename or infer sample identity from a
   directory label. Collect current hashes under the policy above.
3. Produce exact proposed additions/updates/retirements and a separate exceptions
   list. Unknown classification can remain preserved; real identity conflicts,
   changed content and cross-project relationships remain holds.
4. Review the implementation needed for consistent physical paths, owner-preserving
   registration, current-checksum provenance and retirement across consumers.
   Ordinary save hooks can move bytes or send notifications and must not be invoked
   accidentally by a migration. Prove repeatability and recovery on a scratch copy.
5. Obtain George's next-stage approval before any production write. Any later
   archival still has a fresh live plan, writer freeze, verification and separate
   manual HPC deletion checkpoints.

No new owner/disposition decisions remain on the recorded evidence. **The number
of genuine technical exceptions is not yet known.** Fresh association/content
checks are necessary before claiming that every entry can be reconciled without
further input.

## Reproducibility

The offline generator uses Node built-ins only:

```bash
node docs/archive/batches/2026-10-16/reconciliation-preview-2026-10-22/generate-preview.cjs
```

It reads the existing register, four corrected reports, path resolutions and
target ledger, and writes only derived files in this preview directory. It has
no MongoDB, SSH or S3 integration. [provenance.json](provenance.json) records input,
generator and machine-readable output SHA-256 values. [summary.json](summary.json)
records counts, scope limitations and absence of fresh checksum measurements.
