# First manual HPC deletion — Plant Capture inspection ready, 27 November 2026

George requested starting with one small old Project, leaving the four Gulnara
source Projects for separate review at the end. This does not release their
manual exclusions. Gargy remains excluded through its recorded keep date,
26 November 2027 (UTC end of day).

Selected from the completed 170-Project review:

- **Halioticida_Haliocrustida**, Project `5fc012bda3efcb29338b7d30`.
- Two files, **9,129 bytes**; verified in S3 on 23 October 2026.
- HPC: `/tsl/data/reads/skamoun/halioticida_haliocrustida`.
- VM: `/mnt/reads/skamoun/halioticida_haliocrustida`.

`prepare.cjs` performs only fresh read-only status and native deletion-command
checks, pins the target to the completed review, checks preservation and the
reads mount, and saves a preparation receipt. It never executes printed commands
or finalizes an archive.

The first connection attempt failed before the script ran; its evidence is
preserved. George restored VPN/SSH on 27 November.

**Fresh checks passed at 10:19:35 GMT on 27 November**:
[receipt](evidence/prepared-20261127.json). Native status and deletion-command
both exited zero with empty stderr. The source tree, S3 objects, sealed evidence
and preservation checks passed. No malformed keep dates were found. Gargy's
active date was re-read. Server evidence:
`/storage/komondor-hpc-first-deletion-20261127T101935Z/prepared.json`.

George requested AWS CLI inspection, Chrome/AWS navigation, the production URL,
HPC inspection and finally his manual deletion command, in that order.
The non-empty spot-check object is
`additional/Copy of ENQ-1934_PIP-1347_PSEQ-1206_datasum_20.10.16.xlsx`.
The second object is an empty `.md5` sidecar; this tiny Project contains no reads.
A standalone AWS CLI HEAD using the existing server workload profile passed:
[response](evidence/manual-head-20261127.json).

- Size: 9,129 bytes; storage class: DEEP_ARCHIVE.
- Full-object CRC64NVME: `kawkuaesEMk=`.
- Version: `m3G_vCCOG40k4O.MH5wVQu.bQutg6AFC`.
- A fresh SHA-256 read of the spreadsheet through the VM mount matched the sealed source:
  `cf0721f9b36fec6c12a28c3ae10eab1cffc6a1461390ab44758866d6e196b290`.

Production page:
https://sequences.tsl.ac.uk/project?id=5fc012bda3efcb29338b7d30

**Paused: do not use the previously supplied deletion command for this first
raw-read demonstration.** George correctly pointed out that a spreadsheet-only
Project does not demonstrate preservation of raw reads. No deletion has been
reported, and Codex has performed no deletion or archive confirmation.

## Raw-read investigation, 27 November 10:32 GMT

[Live hierarchy evidence](evidence/raw-read-investigation-20261127.json) records
zero Samples, Runs and Reads for Halioticida_Haliocrustida. Additional searches
for Sample/Run/File paths under its Project path found no raw-read records.
There are two AdditionalFiles: the spreadsheet and its empty MD5 sidecar.

The pre-transfer [22 October live catalogue](../../2026-10-16/reconciliation-preview-2026-10-22/live-projects.json)
already recorded zero Samples, Runs and Reads, one registered AdditionalFile,
and two physical files totalling 9,129 bytes. The accompanying
[planning record](../../2026-10-16/reconciliation-preview-2026-10-22/projects.json)
also records the same physical count/size from 16 October. The sidecar was
subsequently registered during reconciliation. Thus the source inventory and
archive agree; this is not evidence of raw files being omitted by this transfer.
These observations do not establish whether reads existed at some earlier time.
The similarly named Halioticida_Haliphthoros is a separate Project and path.

A better first raw-read demonstration is **Plant Capture Enhancer**
(`5fc012bda3efcb29338b7d4b`): the same live check confirms one Sample, one Run,
two Reads linked to the R1/R2 `.fq.gz` files under `pce/pce/raw/`, and one
additional PDF. Its archive totals 34,647,343 bytes and its R1 was the successful
live cold-restore test. Refresh its native deletion checks before supplying a
replacement manual deletion instruction; no replacement deletion command has
yet been supplied in this investigation.

The four Gulnara exclusions and Gargy's date remain unchanged. After any later
manual deletion is reported, independently verify the real reads mount and
exact root absence before native archive confirmation.

## Plant Capture inspection prepared, 27 November 10:56 GMT

George independently inspected Halioticida in Sequences Store and on HPC,
confirmed its spreadsheet-only content and accepted preserving it as-is in S3.
It remains a valid reviewed deletion candidate; no deletion has been reported.
He requested the four-interface inspection using Plant Capture Enhancer instead.

`prepare-plant-capture.cjs` is the same fixed-target read-only preparation with
the reviewed Plant Capture identity/path substituted. Fresh native status and
deletion-command both passed with empty stderr:
[evidence](evidence/prepared-plant-capture-20261127.json). No active or invalid
preservation hold applies. Gargy's hold and the four Gulnara exclusions remain.

[Manual inspection evidence](evidence/plant-capture-manual-inspection-20261127.txt)
records successful current S3 HEADs for both raw FASTQs, fresh SHA-256 hashes
of both retained HPC files, and the existing successful R1 restore receipt.
R1: 17,209,559 bytes, CRC64NVME `LNflJKcrReM=`.
R2: 17,160,504 bytes, CRC64NVME `oRBpuyK1qpc=`.
Both are DEEP_ARCHIVE with FULL_OBJECT checksums. The restored R1's version ID
matches the current HEAD. No new restore request was made.

Production: https://sequences.tsl.ac.uk/project?id=5fc012bda3efcb29338b7d4b

HPC raw files: `/tsl/data/reads/jjones/plant_capture_enhancer/pce/pce/raw/`.
S3 raw prefix: `s3://tsl-hpc-reads/jjones/plant_capture_enhancer/pce/pce/raw/`.
Manual inspection is the current step; nothing has been deleted or finalized.

## Manual deletion authorised, 27 November

George accepted all four inspection steps and explicitly requested manual
Plant Capture deletion first, followed by the remaining eligible Projects if
successful. Fresh preparation at 2026-11-27T11:01:33.494Z passed status and
native deletion-command again; receipt:
[evidence](evidence/plant-capture-before-manual-deletion-20261127.json).
The exact HPC root supplied for his manual terminal step is
`/tsl/data/reads/jjones/plant_capture_enhancer`.
No deletion report has yet been received; do not run confirm-absent until the
real mount and absence are independently established. Then use native
confirm-absent dry run followed by execute with George's verified Komondor
identity, saving evidence and checking state `aws`, phase `completed` and the
website's location result. No direct storage/archiveMigration edits.

After this succeeds, the remaining reviewed archive candidates number 169;
refresh their checks before George's manual batch deletion. Gargy's active
keep date and the four Gulnara exclusions remain in force. The six no-S3
manual-disposal entries are a separate scope. This request does not release
those exclusions.

## First deletion completed and website checked

George reported the successful HPC removal command. Native `confirm-absent`
dry run and execute both passed. Absence was recorded at
2026-11-27T11:04:54.790Z; Project state is `aws`, migration phase
`completed`, confirmed by `deeks`. The mount remained present. The one Sample,
one Run, two Reads and one AdditionalFile are unchanged. S3 URI and original
transfer verification timestamp are unchanged.

[Confirmation receipt](evidence/plant-capture-confirmed-20261127.json).
Complete server evidence: `/storage/komondor-plant-capture-confirm-20261127T110444Z`.

The live Sequences Store page was inspected in Chrome after confirmation and
showed **Archived in AWS**, **HPC removal confirmed**, **Absence recorded
27 November 2026 at 11:04 UTC**, and **Transfer verified in AWS**. PCE remains
listed as a Sample and the PDF remains listed as an AdditionalFile. This was
an actual browser check, in addition to the API location helper assertions.

The remaining 169 candidate refresh is underway in
`/storage/komondor-deletion-refresh-20261127-01`; it is read-only and will not
remove or finalize any Project. All five exclusions remain unchanged.
