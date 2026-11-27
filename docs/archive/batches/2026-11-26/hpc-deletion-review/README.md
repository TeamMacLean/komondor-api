# HPC deletion review — 26 November 2026

**Completed at 19:39 GMT: 170 Projects passed, no unresolved discrepancies.**
The reviewed set contains **14,886 payload files and 12,691,261,135,021 bytes
(12.69 TB decimal)**. Independent validation on the Mac also passed.

- [Exact HPC paths, one per line](HPC_PATHS.txt): `/tsl/data/reads/...`, preserving case.
- [Project names, IDs, paths, sizes and verification times](PROJECTS.tsv).
- [Machine-readable review receipt](REVIEW.json).
- [Five retained paths — excluded from the deletion list](HELD_PATHS.txt).

George authorised completing the read-only review and preparing exact HPC
paths; he will choose individual CLI deletion or a separately reviewed Slurm
procedure afterwards. **Nothing was deleted or finalized.** No service changes,
Slurm submission, application deployment or AWS permission changes occurred.

Scope: the sealed 175-project completion register, excluding the five manual
holds. All 175 roots remain present and all 175 Projects remain
`aws_pending_hpc_deletion` / `verified`. Gargy is retained through
**26 November 2027, 23:59:59.999 UTC**. The four Lichen CoCulture source Projects
(2, 9, 21 and 42 days) remain held pending Gulnara's sign-off and explicit release
review. Those five contain 757,541,399,455 bytes. The six Kamoun no-S3 disposal
entries, 11 retained KEEP Projects and Gulnara's new destination are outside the
deletion list.

Server evidence pack: `/storage/komondor-deletion-review-20261126-02`.
The native `deletion-command` was run only to capture its printed output; that
output is never executed. Eight concurrent read-only Project checks, lower CPU
priority, used the existing certificate-based archive identity and bounded read
retries. API checkout at initial observation: `550074e2b24a03c25cb0568c393b9bffed1bd701`.

The initial audit checked every recorded Project/migration/path and manifest
digest against the completion register; raw preservation types; overlapping
Project roots; canonical retained source roots; and the original passing pilot
restore receipt. Every candidate then received native fresh archive identity,
bucket protection, sealed-manifest, full-object checksum, ownership, exact key
set and source-tree checks. **All 170 native commands exited zero with empty
stderr**, finishing at 19:32:38 UTC. Manifests, object HEAD responses and printed
commands are retained.
No per-Project cold restore or new full payload checksum sweep was performed;
S3 full-object CRC64NVME values were checked against the sealed source checksums,
and native source checks compared current file identity/metadata with the sealed
tree. Current status facts were captured directly alongside these native checks,
without duplicating the entire object-HEAD pass through the status command.

Independent catalogue checks at 18:21 and **19:34 UTC** found **14,886 File records and 14,886
related records**, all owned by the correct candidate Project, no cross-Project
references and no active ingest/run work. The same location helper used by the
website reports HPC present and AWS verified for all 175 Projects.

The final review rechecked every current S3 key/size, ETag and modification time,
checked there were no incomplete multipart uploads, compared all source trees
again, and re-read archive identities and keep dates. Every current object
remained the object checked by the native pass; all had version IDs, AES256
encryption and DEEP_ARCHIVE storage. No unarchived non-directory entries were
found. The 8,336 structural/empty directory entries are retained in manifests;
they are not missing payload objects.

**Twelve additional checksum/ownership/version comparisons passed** across:

- Sequencing of NLRs from tetraploid wheat lines (largest Project: 577.79 GB).
- Solanum americanum nanopore sequencing (most files: 1,202).
- P. striiformis TCS (JIC.CL.20130409.01), a newly registered Project.
- Plant Capture Enhancer, the real restore pilot. Its R1 still has the exact
  version ID and sealed checksums proven by the 23 October restore receipt.

The first supplemental attempt used `HEAD --version-id`; all four representative
Projects returned 403 for that operation. The recorded workload policy grants
`GetObject`, not `GetObjectVersion`. Permissions were left unchanged. The
replacement check used permitted **fresh current-object HEADs**, requiring their
version IDs, full checksums and ownership to equal the native pass. It also
repeated the final inventory/source/date checks for all 170 Projects. All passed.
The failed requests and the passing replacement evidence are both preserved;
there is no unresolved archive discrepancy.

`final-check-v3.cjs` in the server pack is the executed version of
`tools/final-check.cjs`; its authoritative outputs are `final-check-r2.json`
per Project and `final-review-r2.json`. `catalogue-refresh.cjs --final` produced
`catalogue-final.json`. Earlier scripts and receipts are preserved unchanged.

Tooling provenance: attempt 01 was stopped early after finding that the wrapper
expected an unversioned source-manifest filename. All evidence remains on the
server; no data operations occurred. Attempt 02 uses the correct `.v1.json`
filename. Its initial `reviewPassed` flag conservatively includes skipped
directories; final review accepted directories only, never an unarchived
regular file, symlink or special file. Consequently the preliminary
`summary.json` wrapper's `passed`/`failed` counts describe that conservative
screen, not native command exit codes. The authoritative final result is
`final-review-r2.json`: **170 passed, zero failed**.

The complete [server evidence archive](evidence/server-audit-20261126.tar.gz)
was copied to the repository working tree and its SHA-256 independently checked:
`b71f30a2344e3b69be0e4ee196dabe0ee79a9098fde1058b884bc8060ac6b71a`.
Readable summaries are also under [evidence](evidence/). `tools/build_review.py`
independently checked manifest hashes, file checksums, ownership, current
inventory, version comparisons and path mapping before creating the output
files. Its path safety tests reject duplicate, overlapping, escaping and malformed
targets. The HPC path-list SHA-256 is
`188830e82403b540df940d1464726ad0ccbaa2d1284564cdd792cbf62be2cbc9`.

The historical seven-day hold was removed by George on 23 October. There is no
additional waiting period; current preservation dates and manual exclusions
still apply. Any final path list is an observed review, not permission to ignore
later changes. Keep sources frozen; recheck holds and mount availability before
George executes deletion. If delayed or anything changes, repeat the relevant
fresh checks. After physical deletion, native `confirm-absent` is a separate
reviewed step; it has not been run.
