# Two-stage Slurm deletion — completed 27 November 2026

**Historical checkpoint at 13:44 UTC: 170 of the 175 S3-verified Projects
are now AWS-only. Five remain on both HPC and AWS: Gargy and Gulnara's four
Lichen CoCulture sources.** All native confirmations and final checks passed
at **13:44:28.951 UTC** on 27 November.
[Aggregate completion receipt and evidence hashes](evidence/bulk-completion-20261127.json).

**Do not rerun or resubmit any package in this record.** The original single 169-project
job, pilot-2, blocked remaining-167 draft and remaining-167-released package are
preserved as historical evidence. Their README submission commands, path lists
and original 18:22:07 GMT expiry are not current deletion instructions.

Later that day, Gulnara's four source deletions were completed and natively
confirmed, giving **174 AWS-only Projects and Gargy retained on HPC/AWS**.
The six separate no-S3 disposals also completed. See the
[current completion index](../PUBLICATION.md). The five-held-root statements
below describe the earlier 13:44 checkpoint, not the final state.

## Completed follow-up: job 25340024

George submitted the released 167-project job. It ran from approximately
13:14:31 to 13:24:17 UTC. Inspection of both copied raw logs found exactly
**503 events**: one start, all 167 preflights before any deletion, 167 matching
start/deleted pairs, and one completion. Project IDs, paths, order and bytes
exactly match the sealed plan: **14,860 files / 12,690,838,486,686 bytes**.
There are no missing, duplicate, unexpected or failed events. The embedded
job-log audit exactly matches the standalone JSONL, and all events occurred
within the original review window.

GNU time records process exit **0**, **9m46.05s** elapsed, **6.11s user CPU +
7.10s system CPU**, **2% CPU**, **32,192 KiB peak RSS** and no swaps. Allocation
was one node, one task, one CPU, 1 GB and a two-hour limit. George supplied final
Slurm `COMPLETED` / `0:0`; the copied log contains its startup `scontrol`
snapshot, not final `sacct` accounting. Runner completion and process exit 0
are independently supported by the raw log.

- [Independent job-log audit and input hashes](evidence/job-25340024-audit.json).
- [Original deletion JSONL](evidence/deletion-25340024.jsonl).
- [Original job/resource log](evidence/komondor-remaining-167-25340024.log).
- Released plan SHA-256: `bb298f391cf1df504b1e5983fdba1a948c5d248f4ea343758a5ceef4e5ecfee7`.

## Native confirmation and final state

Independent mount checks proved all 167 exact source roots absent and all five
held roots present. The confirmation helper first saved immutable before-images,
checked sealed source/verification evidence, identity, preservation and active
work, then dry-ran all 167 native confirmations before executing any. Four
bounded workers used the deployed `confirm-absent` workflow; no direct storage
field edits were made. Every after-state and the final audit passed.

Native completion: **2026-11-27T13:44:28.951Z**; helper exit 0 at 13:44:29 UTC.
All **167 Projects are `aws` / `completed`**. Associated catalogue records,
archive identities and original `storage.s3VerifiedAt` dates are unchanged.
The unchanged catalogue contains **1,288 Samples, 1,563 Runs, 2,844 Reads and
12,016 AdditionalFiles**.
All five held Projects and the three previously completed Projects—including
their associated records—are unchanged. Final mounted observations confirm
167 newly absent roots, three previously absent roots and five retained roots.
No AWS objects were deleted; no service or application-code change was needed.

Evidence:

- [Native completion and final per-Project results](evidence/bulk-native-confirmation.json).
- [Independent confirmation-evidence audit](evidence/bulk-native-confirmation-audit.json).
- [Evidence-copy receipt and checksums](evidence/bulk-native-evidence-copy.json).
- [Complete server evidence archive](../PUBLICATION.md#artifact-12).
- Server evidence: `/storage/komondor-slurm-bulk-confirm-20261127T133428Z`.

The native receipt preserves the user report as it was at launch, explicitly
marking job logs uninspected by that helper. The job-log audit above records
the separate independent inspection; the native helper itself did not inspect
raw logs. Neither historical receipt was rewritten to change its provenance.

Representative live Chrome checks covered the largest payload (**Sequencing of
NLRs from tetraploid wheat lines**) and largest file count (**Solanum americanum
nanopore sequencing**). Both display **Archived in AWS / HPC removal confirmed /
Transfer verified in AWS**, with samples still visible. The retained Gargy
control displays **On HPC / Transfer verified in AWS**, its samples and the
approved keep date **26 November 2027**. These are representative UI checks;
all 167 database/location checks are in the native evidence.
[Website observations](evidence/bulk-website-checks-20261127.json).

## Earlier pilot and review — historical, do not rerun

Plant Capture Enhancer was manually deleted by George and natively confirmed
at 11:04 UTC. The remaining 169 native archive/source checks passed at
12:22:07 UTC, followed by catalogue ownership/reference checks. Every payload
version, checksum and ownership record matched prior verification evidence.
[Original native review](../hpc-remaining-deletion/README.md).

George requested two small Projects with real Read files first, then a separate
167-project follow-up after inspection:

| Pilot project | Project ID | Files | Bytes | Catalogue |
| --- | --- | ---: | ---: | --- |
| Resistance to Albugo laibachii in Sf-2 | 5fc012bda3efcb29338b7d4e | 7 | 89,834,094 | 1 Sample, 1 Run, 2 raw Reads, 5 AdditionalFiles |
| MiSeq RenSeq of Brassica accessions | 5fc012bda3efcb29338b7d13 | 16 | 298,166,898 | 2 Samples, 1 Run, 2 raw Reads, 14 AdditionalFiles |

Pilot job **25339708** removed both roots at 12:53 UTC: `COMPLETED` / `0:0`,
five seconds, one CPU, 16,640 KiB peak RSS. Native confirmations finished at
12:59:06 UTC; both live website pages showed HPC removal confirmed. Associated
records and S3 verification dates were unchanged. The 13:03:11 UTC release
check then verified 167 present source roots, five holds, three completed roots
and 14,860 catalogue files/references with no issues.

- [Exact split and plan hashes](evidence/split-validation.json).
- [Actual pilot Sample/Run/Read/File associations](evidence/selection-live.json).
- [17 Linux filesystem/split checks](evidence/linux-validation.txt).
- [Pilot acceptance](evidence/pilot-acceptance.json) and [native confirmation](evidence/native-confirmation.json).
- [Fresh follow-up release check](evidence/fresh-release-state.json).
- Nine focused release-guard tests and independent package review passed.

The original packages remain unchanged in `pilot-2/`, `remaining-167/` and
`remaining-167-released/`. The latter was staged at
`/storage/komondor-hpc-delete-remaining167-20261127-01`; pilot preparation was
under `/storage/komondor-hpc-delete-split-20261127-01/`. These locations are
historical evidence, not jobs awaiting submission. No automatic dependency or
agent scheduler submission was used.

## Remaining exclusions

- Preserve `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` through
  **26 November 2027**, unless the approved retention decision changes.
- Preserve the four `ntalbot/lichen_coculture_i_*_days` source Projects until
  Gulnara's sign-off and a separate cleanup/archive-revision review. Her new
  Xanthoria destination and the completed reassignment/MD5 work are unaffected.
- The six no-S3 disposal entries remain a separate manual task.

Future deletion of retained Projects needs new current checks and an explicit
hold release; none of these completed plans can be reused. No per-Project cold
restore or blanket seven-day waiting period is required. All sealed evidence
is retained. This documentation update does not commit, push, deploy or send
messages.
