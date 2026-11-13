# Transfer completion evidence — 3 November 2026

These four JSON files are byte-for-byte copies of the saved completion evidence
from `~/.codex/artifacts/archive-batch-20261023/`. They were collected or assembled
on 3 November from the existing server receipts and read-only production checks.
Publishing them does not perform a new production check or change any archive.

## Recorded result

- All **175 Projects**, including the live pilot, were verified in S3:
  **15,397 files / 13,448,802,534,476 bytes**.
- The final Project's `storage.s3VerifiedAt` is **2 November 2026,
  20:55:20.889 UTC**. The bulk worker exited successfully at **20:55:27.365 UTC**.
- The read-only completion audit was captured **3 November, 12:16 UTC**:
  174 bulk completion receipts, all 175 Projects in `aws_pending_hpc_deletion`
  with phase `verified`, and no outstanding queue errors or quarantines.
- The real pilot restore passed on **23 October, 16:49:16.352 UTC**. Its receipt
  records matching byte count, SHA-256 and CRC64NVME.
- All HPC source roots were retained at the observation time. No HPC deletion or
  archive finalization is established or authorized by these records.

## Files and provenance

- [Transfer completion summary](transfer-complete-20261103T121635Z.json):
  reconciled totals, final timestamps and remaining deletion-review requirements.
- [Completed Project register](completed-project-register-20261103T121635Z.json):
  all 175 identities, migration IDs, canonical paths, verified timestamps,
  file/byte totals and sealed manifest digests.
- [Final server receipts](completion-final-receipts-20261103T121635Z.json):
  original serialized worker exit, queue summary, empty quarantine log and pilot
  restore receipt, each with its SHA-256. Embedded `text` fields are preserved.
- [Read-only completion observation](monitor-bulk-20261103T121635Z.json):
  database/local-evidence audit, all 174 bulk receipts and operational metadata.
  Its `currentErrors` may include earlier failed attempts retained for audit;
  current completion is determined by `status.allCopied`, `status.issues`, the
  successful queue summary and the final exit receipt. Earlier preactivation
  metadata, including `liveTransferSwitched: false`, describes its original
  preparation stage and is preserved as history.

The summary's `evidenceMirror` and `evidenceArchiveSha256` refer to an additional
retained local evidence snapshot; that archive and the complete per-Project
payload manifests are not bundled here. This directory preserves completion
proof, not the payloads or a new independent S3 inventory.

## Deletion review remains separate

The original 168-hour waiting period was removed by George on 23 October.
Historical `earliestDeletionReviewAt` / `earliestWholeBatchDeletionReviewAt`
values remain unchanged in the source evidence and are superseded planning
values, not a current hold or an AWS lock. Pilot restore success, fresh native
source/archive checks and George's manual deletion remain required.

Gulnara's deletion-review exclusions were recorded later on 3 November and are
not included in these earlier completion snapshots.
The [Gulnara ENA reassignment](../../GULNARA_ENA_REASSIGNMENT_2026-10-30.md)
requires retaining the four Lichen CoCulture_I source trees (2, 9, 21 and 42 days)
until the independent destination copies are verified and their release is
reviewed. The planning note installs no production hold: operators must skip
those four during deletion review. A completed transfer is not permission to
remove them.

On 13 November George also required retaining Gargy 2019 RNAseq on HPC until
explicitly released. Consult the [current five-Project retention register](../../HPC_RETENTION.md)
before any deletion review; the dated completion JSON files remain unchanged.

## SHA-256 of the unchanged source files

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `transfer-complete-20261103T121635Z.json` | 1078 | `1be3fc67d6ed0eacee6dbf77ae621b3d9d1c6c21deae3fea2cb92ae67c772b34` |
| `completed-project-register-20261103T121635Z.json` | 159901 | `6972ba92fa011a15957d42b146110ce23b5aa47ff892d98f015dad58e0845db2` |
| `completion-final-receipts-20261103T121635Z.json` | 7550 | `6a3a5d9bea9a4c4f48a5dfe3e807d0d02aa629fc37db5c5f4800a275773df1e3` |
| `monitor-bulk-20261103T121635Z.json` | 200611 | `23ffc1da46019cf0e34322ba950fcb4cda3ce4dd25ee2b2e75721709fd9bf745` |
