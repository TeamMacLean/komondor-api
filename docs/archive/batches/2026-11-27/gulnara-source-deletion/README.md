# Gulnara original-source HPC deletion — 27 November 2026

**Completed 27 November 2026.** George’s Slurm job **25340876** removed all
four reviewed source roots, with all 14 expected events and process exit 0.
Native confirmation passed for all four at **14:42:13 UTC**. The final full
batch audit found **174 AWS-only Projects plus Gargy on HPC and AWS**. All
four source website pages show HPC removal confirmed / transfer verified in
AWS. Xanthoria’s 12 Samples, 12 Runs and 40 files remain intact, as do staging
and Gargy. Do not resubmit this completed deletion package or rerun either
confirmation helper. [Aggregate completion receipt](evidence/COMPLETED.json).

George instructed “lets do gulnara's 4 now”, waiving the earlier requirement
to wait for Gulnara's reply for these four original source trees. No reply or
sign-off from Gulnara is recorded. The exact decision is preserved in
[hold-release.json](evidence/hold-release.json); it authorizes preparation of
the separately reviewed job and George's own HPC submission.

## Exact deletion scope

| Project | ID | HPC path | Files | Bytes |
| --- | --- | --- | ---: | ---: |
| Lichen CoCulture_I 2 days | `61204424e788b405b6ce6bde` | `/tsl/data/reads/ntalbot/lichen_coculture_i_2_days` | 99 | 105,611,175,618 |
| Lichen CoCulture_I 9 days | `611ff26de788b405b6ce6a4c` | `/tsl/data/reads/ntalbot/lichen_coculture_i_9_days` | 122 | 103,438,441,044 |
| Lichen CoCulture_I 21 days | `5fd1ed55d8dd4a63058cc1c9` | `/tsl/data/reads/ntalbot/lichen_coculture_i_21_days` | 142 | 173,734,125,362 |
| Lichen CoCulture_I 42 days | `5fdb2d62d7661b6ec22a0571` | `/tsl/data/reads/ntalbot/lichen_coculture_i_42_days` | 89 | 99,954,671,448 |

Total: **452 files / 482,738,413,472 bytes**. All four complete original trees
remain preserved in their sealed S3 archives. Only the selected 40 files /
41,432,635,417 bytes were copied into the new Xanthoria destination; the full
original archives contain the other source data too.

## Fresh review

The server evidence is under
`/storage/komondor-gulnara-source-review-20261127-01`. Native read-only
`deletion-command` reviews passed for all four at **14:13:23.753 UTC**, with
exit 0. They printed candidate removal commands but did not execute them.
Checks covered exact Project/migration identities, canonical NFS roots,
retained source manifests, current S3 inventory, object versions/ownership,
full-object CRC64NVME and sizes, incomplete multipart uploads, current
preservation status, source-tree metadata and unchanged database snapshots.

The catalogue review accounts for all 452 source entries: 412 File records
remain associated with the sources and 40 reassigned File records point into
Xanthoria. Current API checkout `12e7f1da1537b693f60c86d692f0c3236edcf299`
was clean and unchanged through the review. Its website visibility additions
do not alter the native archive or retention code. This checkout observation
does not independently identify the running API process's loaded head.

The native evidence was copied into [server-review](evidence/server-review/)
and all 31 copied files matched SHA-256 against server originals. Its archive
is recorded in [native-copy-receipt.json](evidence/native-copy-receipt.json).
Historical archive manifests and verification dates remain unchanged.

The destination review passed at **14:20:29.491 UTC** with exit 0 and no
issues: all 40 files / 41,432,635,417 bytes matched SHA-256, and all 31 stored
Read MD5 values matched (including 24 FASTQs). All scoped database records,
original/copy identities and staging links remained unchanged. Its 51 copied
evidence files matched SHA-256 against server originals; see
[destination-copy-receipt.json](evidence/destination-copy-receipt.json).

The separate destination review uses the completed post-MD5 database snapshot,
not the earlier reassignment snapshot. It checks all scoped records unchanged,
fresh SHA-256 for all 40 destination files, MD5 for the 31 Read records,
independent source/copy inodes and the 40 intact staging hardlinks.

## Protected material

- Gargy `5fc012bda3efcb29338b7d58`,
  `/tsl/data/reads/two_blades/gargy_2019_rnaseq`, remains preserved through
  **26 November 2027**.
- Xanthoria `6ae4ac89a6b876c643741d27`,
  `/tsl/data/reads/ntalbot/xanthoria_parietina_mycobiont_rnaseq`, remains on HPC.
- All staging links under
  `/tsl/data/reads/ntalbot/.gulnara-staging-20261126-c1f78c6d-3a3f-4165-abe5-706ded74bf99`
  remain. Staging cleanup requires a separate review because removing links
  changes the copied files' inode metadata.
- The ENA working CSV, sealed repository CSV, all audit evidence, all AWS
  objects, the six separate no-S3 disposals and every unrelated HPC root are
  outside this job.

## Execution and follow-up

The reviewed builder releases a package only after both reviews pass. Its
runner pins the four targets and evidence hashes, preflights every source
before removing any, then rechecks each source before removal. Destination
and staging metadata are checked before and after each removal. It refuses
changed files, unexpected paths or symlinks, nested mounts, altered receipts,
missing protected copies, expired evidence and execution outside Slurm.

The Slurm allocation remains one node, one task, one CPU, 1 GB and a two-hour
limit. Evidence expires six hours after the earlier fresh review completes.
Keep source/copy trees and preservation decisions unchanged while queued or
running; the HPC job uses sealed local evidence rather than querying MongoDB.
The source runner's 28 isolated guard tests and independent review passed.

The finished package also passed read-only validation on v1333 at
**14:22:06 UTC**, checking the real NFS source and protected-copy metadata
without deletion or database/AWS writes. The validator's 10 fixture tests
and independent review passed. The actual package was independently checked
against the sealed and fresh receipts. See [READY.json](evidence/READY.json)
and [package-readonly.json](evidence/package-readonly.json).

Package: `/storage/komondor-gulnara-source-delete-20261127-01`.
Plan SHA-256: `e136a50e1ac04046197eafb51f60e08bade81fa750c16d30870ec1366302f8cf`.
It refuses removal after **27 November 2026, 20:13:23 UTC**.

The submission commands in the sealed package are historical and must not
be rerun. George copied the package from the software node and submitted it
from the Slurm submission node. Preserve the exact package and raw job logs.

## Completed execution and database confirmation

George reports Slurm **COMPLETED / 0:0**, 14:24:32–14:25:04 UTC (**32 seconds**).
The copied raw logs independently prove successful runner completion and GNU
time exit 0: **30.39 seconds**, **18,176 KiB peak RSS**, one CPU and 1 GB.
All ten package checksums passed; all four preflights preceded any deletion;
all **14 ordered audit events** match the exact sealed plan. The job removed
**452 files / 482,738,413,472 logical bytes** and reported protected copies
intact. Final Slurm accounting remains user-reported; the startup RUNNING
snapshot in stdout is not a final scheduler record.
[Raw logs and audit](evidence/job-25340876/),
[reported scheduler result](evidence/reported-job-25340876.json).

Independent mount checks at **14:28:16 UTC** proved all four source roots
absent and every destination/staging file’s size, inode, timestamps and link
count unchanged. Gargy remained present.
[Post-job observation](evidence/post-job-observation.json).

The initial confirmation attempt stopped before any native command because
production had advanced from `12e7f1d` to `2474c4a`. Inspection of the clean
checkout and preserved full diff showed new date policy only for archive
plan/lock operations; `confirmAbsent` was byte-identical. No database change
occurred in that stopped attempt. The original plan and receipts were retained
unchanged, and an independently reviewed r2 continuation pinned the new head
and code-review receipt. Its 12 guard tests passed.
[Code review](evidence/api-change-review.json),
[preserved diff](evidence/api-change-2474c4a.diff),
[stopped-attempt receipt](evidence/confirmation-attempt-1-failure.json).

The r2 continuation dry-ran all four native confirmations before executing
any. All four confirmations and final checks passed at **14:42:13.902 UTC**.
Only the native confirmation fields changed. Original S3 identities and
verification dates, all source association records, the typed post-MD5
destination graph, Gargy and all destination/staging metadata remained
unchanged. No S3 object or additional HPC payload was deleted by confirmation.
[Native completion](evidence/native-confirmation/completed.json),
[commands](evidence/native-confirmation/commands.json).

The final **175-Project** read-only audit at **14:42:35.192 UTC** independently
matched every archive identity and original verification date: **174 Projects
are `aws` / `completed` with their HPC roots absent; Gargy alone remains
`aws_pending_hpc_deletion` / `verified`, present and preserved through
26 November 2027**. The new Xanthoria destination is outside that batch.
[Full cohort audit](evidence/native-confirmation/cohort-final.json).

All four source pages were checked in the live browser and show **HPC removal
confirmed / Transfer verified in AWS**, with sample records visible. Xanthoria
shows **On HPC** and all 12 Samples; Gargy shows both locations and its saved
keep date. [Website observations](evidence/website-checks-20261127.json).

All 46 copied native evidence files matched server SHA-256 values. The
443,321-byte archive has SHA-256
`b01ea88dcb253646f85a753c7bc9ea12b79088b92b87d1a620ca8db729f38ab4`.
[Copy receipt and per-file hashes](evidence/native-confirmation-copy.json).
Server evidence remains at
`/storage/komondor-gulnara-source-confirm-r2-20261127T144132Z`.
All stopped-attempt, review, job and confirmation receipts are retained.
Actual quota reclamation or filesystem snapshot retention was not measured.

## Remaining separate work

No original-batch HPC removal remains except Gargy under its keep date.
Gulnara’s scientific review/reply, ENA submission and any later AWS revision
are separate. Keep the ENA working CSV and all staging links until their own
review; retain sealed evidence permanently. The six no-S3 manual disposals
remain outside this archive cleanup. Nothing was emailed, deployed, committed
or pushed by this completion step.
