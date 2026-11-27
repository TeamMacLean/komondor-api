# Gulnara execution — 26 November 2026

**Reassignment completed; all four services restored at 13:25:06.331 UTC.**
The r3 runner published all **40 files / 41,432,635,417 bytes** and applied all
**64 reviewed document changes**, with zero divergent records or unexpected
differences. The controller independently verified the completed graph and
physical copies before reopening API, Web, Power and Nudge; API readiness passed.
The execution pack is `/storage/komondor-gulnara-20261126-r3`. **Do not rerun
the completed operation or either old pack command.**

George authorized execution and confirmed the freeze of external writers to the
five affected project trees. George operated service control from his `tsldata`
terminal during three windows; the first two safely restored without reassignment
and the third completed it. No original source was deleted, no source hold was
released, and no S3 change or ENA submission occurred. The earlier abort removed
only its new empty publication root; no production payload file was removed.

The independent staged copy ran from **12:14:12 to 12:45:18 UTC** on v1333:
**40 files / 41,432,635,417 bytes**. Every source and separately reread staged file
matched the sealed SHA-256 and CRC64NVME values. The before/after selected
records were unchanged. All originals remain intact. Staging used independent
copies, never hardlinks from original sources. R3 published those copied inodes
through atomic, no-overwrite hardlinks and retained all 40 staging links until
separate cleanup review. Staging and final paths now share each copied inode,
so retaining those links does **not** consume another 41.43 GB of payload space.
The copied inodes remain independent of the original source files.

- Operation: `c1f78c6d-3a3f-4165-abe5-706ded74bf99`
- Reviewed plan SHA256: `6c45e852a95f4ebd768b3afc473cc4da3a403431fe651f74c8f598fab2ca2b51`
- R3 prepared BSON plan SHA256: `37fe42d9d183c880204beecb333a8a07d8f9caa948dd2549512ad6d4b35e4e1f`
- R3 runtime seal SHA256: `bc5f19936ec7dc56784f622a38c95a9f5c7adb0520c0c4fda5d96a3029cd14c2`
- R3 operator readiness SHA256: `cad1861edebb1e8557e6e568a6ba7e651f127e15a0745ea467f49fd7a4fd6c9e`
- Copy verification receipt SHA256: `d9d62d7686775b5d859adc5ff86f926d0f139de29e3c5fdbc16b9adf88121c06`
- Original prepared BSON plan SHA256, preserved as history: `70cc7e48bbddf541d505949365b314c3d6d60b950c52ab0608c3ffe35af7e4c1`
- Original runtime seal SHA256, preserved as history: `774c5f2792655dd2203ae26147eb91a8f7944f811778ec356bc8d0f2c086b23e`
- First operator readiness SHA256, preserved as history: `3b5df8d7a5ad54776b159c3adf8e71d57ab2e8f7ae65d841a6caa555165e7af4`
- Second operator readiness SHA256, preserved as history: `17c0a61112b7a3cd3c1c9fa77fe330d8c9b06d6cd7058b176b90a9753d9799b4`

The fresh r3 plan contains BSON-preserving before-images of the complete affected
graph, checked against the original prepared baseline before and after its
creation. The new runner requires the pinned original restoration receipt,
exited former processes and no old execution or mutation fences. Original copy
receipts were copied byte-for-byte into the new pack. Both packs' sealed inputs
are frozen: do not edit them or recreate either prepared plan in place.

The replacement publisher was independently reviewed and passed **75 combined
tests** with its runner, controller, export wrapper and existing verification
components. A synthetic rehearsal on the actual NFS mount passed full
publication, recovery after an interrupted link with a fresh payload hash, and
foreign-file collision refusal at **13:22:12 UTC**. All synthetic files were
removed; no production payload was touched. Normal publication uses the existing
byte-verification receipts and current inode metadata. An interrupted link
without its final receipt must be rehashed before adoption.

## Window outcomes

The successful r3 window paused at **13:23:39.566 UTC**, run
`2d9b913a-062b-416a-8f22-9c4762ce2ad1`, controller PID 2670431. The reviewed
runner (PID 2671394) started at **13:24:14.775 UTC**, completed publication and
all 64 changes, and recorded `window-complete.json` at **13:25:03.610 UTC**.
The controller independently found `applied: 64`, `diverged: 0`, no differing
fields, consistent published copies and no active mutation, then restored all
four services at **13:25:06.331 UTC**. All 40 final files and all 40 staging links
remain present; original source metadata stayed unchanged.

The first window restored all four services at **12:51:42.378 UTC**, before
publication or database work. Its HTTP stop check could misclassify a closed
pooled socket as a reachable listener. The exact production socket error was
not logged, but a local Node 24.11.1 reproduction produced this false result in
eight of eight trials. The additive r2 controller uses fresh TCP connections,
requires two consecutive explicit refusals and records each result. The
original receipts and readiness were preserved under `retry-history/attempt-01`.

The second window paused at **13:03:03 UTC**, run
`02632b8e-8dc9-4467-b166-6266f5fe8318`. The publisher stopped at **13:03:38 UTC**
after creating only the first empty final sample directory,
`/mnt/reads/ntalbot/xanthoria_parietina_mycobiont_rnaseq/21x_bmm1_ks`.
It requested mode `0700` as `deeks` (UID 14014), but the observed directory
belonged to `tsldata` (UID 11449), GID 12318, with mode `0770` despite the chmod
request. The ownership assertion correctly refused to proceed. No child
directory was published, and no database execution or mutation journal began.
The intended private-directory safety condition was not established.

An independently reviewed abort verified the full unchanged database graph,
all 12 staged sample trees, all 40 immutable copy receipts and current file
metadata, unchanged source metadata, and the exact empty claimed directory
(inode 61673012528). It preserved the evidence, used a single nonrecursive
`rmdir` on that newly created empty directory, and preserved the claim, intent
and dead mutator fence under `publication-abort-01`. No original directory or
payload was removed. The unchanged native copy/database verifier then passed,
and the controller independently confirmed the `before` state and restored
API, Web, Power and Nudge at **13:12:10.575 UTC**, with API readiness confirmed.
These post-abort checks used the original copy checksums and current metadata;
they did not rehash the payload again.

The original server pack remains `/storage/komondor-gulnara-20261126`. The private Mac directory
is `/Users/deeks/.codex/artifacts/gulnara-preflight-20261126/`; its
`ready-snapshot-01` contains the 68-file pre-window snapshot, with all received
hashes checked. The first restored attempt is retained in `restored-attempt-01`.
The old pack's abort receipts are in `publication-abort-01`, and its second
controller's restoration receipt is `window/restored.json`. The completed r3
pack is preserved privately in `r3-completed-snapshot-01`: **257 files /
2,266,989 bytes**, with all received hashes verified. Its separate
`window/restored.json` records the successful applied-state restoration.
Raw database before-images and source observations remain in those restricted
evidence locations. The selected portable copy/readiness receipts are preserved
here under [evidence](evidence/), with a [SHA256 register](evidence/SHA256.json).
The portable receipts are a selected evidence set, not every raw server file.
The sealed runtime records some private input filenames; those are server-pack
paths, not a claim that every raw database file is published in this repository.
The [completion receipt](evidence/completion-r3/COMPLETED.json) and accompanying
[completed evidence](evidence/completion-r3/) record the successful r3 run.
The two earlier attempts remain separately preserved in
[window-attempt evidence](evidence/window-attempts/).

## Validated tooling

[Validation receipt](executor-validation.json): **70 focused tests passed**.
A separate isolated real-Mongo rehearsal using the actual scoped records passed
64 conditional updates, repeat adoption and reversal, plus interruptions after
writes 5 and 17 followed by continuation or rollback. The actual deployed ENA
serializer was rehearsed against the scoped record snapshot with the reviewed
changes applied only in memory. Independent reviewers checked copy publication,
typed database/journal recovery, operator-window fences and the ENA export.
The additive r2 controller/listener checks passed 32 tests; its retry launcher
passed six tests and independent review. Those earlier rehearsals did not establish
the actual mount's publication ownership/mode semantics, which blocked that
attempt. R3's separate on-mount rehearsal and 75-test result are recorded above.

The database executor changed only 12 Samples, 12 Runs and 40 Files, advancing
16 old identity pins and establishing 48 new ones while preserving history.
No Project, Read or AdditionalFile document was written. `storage.*`,
`archiveMigration.*`, accessions, original HPC trees and sealed S3 archives
remain unchanged.

## Operator window and recovery

George operated the completed digest-pinned r3 window as `tsldata`. The controller
verified the files, code heads, unchanged graph,
actual effective access to the evidence/source/staging paths and unfinished work
**before stopping any service**, paused API, Web, Power and Nudge and wrote its
bound lease. The reviewed r3 publisher created receipted directories with the
mount's observed identity, then exclusively linked the independently verified
staged files into place. Existing destinations could not be overwritten or
adopted without exact operation evidence. The controller reopened only after
its independent consistent-graph and physical-copy check. A deadline alone
cannot reopen a partial graph.

The effective NFS access check matters: `/mnt/reads` mode bits alone do not
establish access (the server permits deeks despite the displayed root-owned
0770 mode). The actual `tsldata` pre-stop probe passed, but read/traverse access
does not prove that a new directory will have the requested owner or mode.
The second window demonstrated that distinction. No mount or original source
permissions were changed. Evidence directories use the existing shared operator
group 115234.

Inspected database recovery requires exact stale-lock hashes, exited prior
processes, preserved evidence and a newly sealed operator window. Resume and
rollback are supported only for recognized record states. R3 can prove consistent
partial links while the database remains unchanged; changed database states
require all 40 published files and complete publication receipts. A directory
created before its claim receipt is written remains an explicitly unsupported
automatic recovery case requiring inspection. The controller never reopens an
unknown or partially reassigned graph. The old empty-root abort is complete;
do not relax the original assertions or retry the unchanged old publisher.

## Application and ENA verification

The live admin website showed all 12 Samples in the destination, its HPC path
and normal archive-age date of **30 October 2031**. The representative Sample
`21X_BMM2_KS` resolved to the correct destination Project; its Run `KS21XB1`
showed the new path, two FASTQs and the MD5 sidecar. The copy-path button showed
a success notice, but the in-app browser did not expose clipboard contents;
the copied clipboard bytes were not verified. The current UI exposed no HTTP
download control. A separate published **100-byte MD5 file**, File
`612041f4e788b405b6ce6bc8`, was transferred over SSH to the Mac and independently
matched the sealed size, SHA-256
`40fbe1f8c65bf9966667840617aa4d84b67aafdcea32b9a172a6038128ba4292`
and CRC64NVME `28o8XiENhFg=`. This was not a browser download. A final independent
native graph/publication verification passed at **13:28:15 UTC** after the UI
checks.

The scoped ENA export passed at **13:25:25.894 UTC**: **12 rows / 24 paired
FASTQs**, excluding the seven known MD5 Read entries only from the exported
file list while preserving all records and 40 files. It used the deployed
serializer in an isolated, query-only scope and checked the live graph, original
copy checksums and current publication receipts. It was not a call to the live
authenticated export endpoint and did not rehash all payloads.

The [review CSV](evidence/completion-r3/ena-export-20261126-01/gulnara-ena.csv)
is also available on the server at
`/storage/komondor-gulnara-20261126-r3/ena-export-20261126-01/gulnara-ena.csv`.
Its SHA-256 is
`038dfbf08e59bfc37f79c8bb5f55acc37cf11c78cc854b742e78034d768c8a83`.
The CSV uses HPC `/tsl/data/reads`; `vm-paths.txt` records the equivalent
`/mnt/reads` paths confirmed by George. Actual ENA transfer-consumer access still
belongs to the submission workflow. **This is a validated review export, not an
ENA submission.**

## MD5 follow-up completed — 26 November 2026

**The technical reassignment and MD5 follow-up are done for now.** George has
sent the review email to Gulnara; her reply/sign-off is pending. The separate
[MD5 completion receipt](evidence/md5-completion-20261126/COMPLETED.json) records
the work, with [native checksum and validation evidence](evidence/md5-completion-20261126/).

All **24 FASTQs / 41,432,633,829 bytes** passed independently calculated MD5
against the preserved historical sidecars, and SHA-256 against the sealed copy
manifest, at **14:24:18.645 UTC**. All 16 sidecars also matched their sealed
size/SHA-256. For the seven sidecars represented as Reads, MD5 was independently
calculated from both the retained original and copied file; they matched and
the original/copy inodes were distinct. Those seven expected MD5s are explicitly
source-derived, not claimed as provider-supplied sidecar checksums.

The scoped importer conditionally updated **31 Reads and 12 Runs** at
**14:26:15.692 UTC**. Reads received expected/calculated MD5, comparison and
check timestamps; Runs received terminal processing/checksum status and actual
result counts. Only those fields and `updatedAt` changed. All before-images,
after-images and 86 write-ahead journal events were retained. A separate native
verification at **14:26:39.564 UTC** confirmed all 43 exact after-images, zero
divergent records and no control-record changes. The deployed application's
verification summary, freshly evaluated against the saved records at
**14:27:01.220 UTC**, passed all 12 Runs and all 31 Reads. Auxiliary file rows
remain `N/A` by extension in the Read-list UI; their source-to-copy comparisons
are nevertheless recorded honestly in the Run totals. No browser check was
performed for this follow-up.

The importer passed nine focused tests and independent review; the read-only
hasher passed seven tests. A real isolated MongoDB rehearsal accepted all 43
actual legacy before-images, rejected added-field drift in every case and
rejected BSON-type drift. A complete isolated import using the actual scope
and completed proof receipts also passed all 43 writes and all 12 application
summaries before production execution. No model hooks, queues, email delivery,
service changes, payload writes or archive changes were used.

The original and reassigned snapshots lacked legacy Run/Read MD5 fields, so
waiting alone could not have cleared the pending labels. The new operation
records actual comparisons; it does not rewrite the historical r3 completion
snapshot. Preserve those earlier receipts unchanged. The old r3 full-database
verifier predates these legitimate checksum-field updates; use the MD5
follow-up evidence for the current metadata state rather than rerunning the
completed reassignment.

Keep the ENA review CSV pending Gulnara's sign-off; an expendable working copy
may later be removed while the sealed repository CSV and audit receipts remain.
Original source HPC copies and AWS archives remain intact. Later removal of
source HPC copies would leave the new destination copies on HPC; restoring an
old source copy from AWS can incur retrieval charges and take time. Sign-off
precedes a separate cleanup/archive-revision review, not automatic deletion.
No source file, staging link or review CSV was removed.

## Remaining work

Retain all original sources, staged links and every receipt. Removing either
staging or final links changes the copied inode's verification metadata, so
cleanup requires a separate review. Do not edit sealed runtime files or retry
the completed operation. Review the scoped CSV with the actual submission
workflow, including consumer access and the eventual ENA submission.

The destination remains `hpc`; the live page shows its normal archive-age
eligibility as 30 October 2031 (the creation-based timestamp is
14:41:13.635 UTC). The four sources remain **documented manual deletion
exclusions** pending separate release/archive-revision review. Their
`preserveOnHpcUntil` values remain null; this operation installed no database
hold or keep date. Do not include these trees in deletion commands until that
separate review is recorded.
Gargy's preservation and all other archive work remain separate.
