# Archive execution completion — 27 November 2026

The approved archive cleanup and six separate Kamoun direct disposals are complete. The completion release starts from `origin/master` `5a707a1`; the already-published `codex/archive-status-20261126` branch at `4b0895a` is incorporated here, preserving its eleven November 26 evidence commits. Those commits were not yet on master. George approved promotion to master and the production documentation sync on 27 November. It adds execution evidence and reconciles current documentation, including the previously unpublished unattended-transfer guide and dated October operation notes. It changes no application code or production data. Do not rerun historical deletion packages, controllers or confirmation helpers.

## Final outcome

- **174 of the 175 S3-verified Projects are AWS-only.** Native confirmations preserved identities and original transfer dates. Gargy alone retains its HPC copy through 26 November 2027. All S3 objects are preserved. [All-175 final audit](gulnara-source-deletion/evidence/native-confirmation/cohort-final.json).
- **Six additional Kamoun DELETE entries, with no S3 copy, are complete.** Job 25342010 deleted exactly 1,217 files / 790,004,575,062 bytes. All 2,459 metadata records and history remain retired. [Final receipt](kamoun-direct-disposal/evidence/COMPLETED.json).
- **Thirteen protected roots remain:** Joe’s eleven with saved dates through 26 November 2031, Gargy through 26 November 2027, and Gulnara’s Xanthoria destination under its normal policy. [Independent filesystem observation](kamoun-direct-disposal/evidence/job-25342010-observation-01.json).
- No Joe email, Gulnara reply chase or further cleanup is due. Reports, optional staging/CSV cleanup and future deletions are ad hoc.

## Execution records

| Stage | Job | Evidence |
| --- | --- | --- |
| Plant Capture manual deletion | Manual | [Record](../2026-11-26/hpc-first-deletion/README.md) |
| Two small real-read projects | 25339708 | [Record](hpc-slurm-two-project-test/README.md) |
| Remaining 167 projects | 25340024 | [Audit](hpc-slurm-two-project-test/evidence/job-25340024-audit.json) |
| Four Gulnara source projects | 25340876 | [Record](gulnara-source-deletion/README.md) |
| Six Kamoun direct disposals | 25342010 | [Record](kamoun-direct-disposal/README.md) |

Final Slurm accounting was supplied by George; copied raw execution logs independently establish runner completion and exit status. Independent mounted-filesystem and database checks establish the recorded final state. File bytes removed are logical totals; physical quota reclamation and snapshot retention were not measured.

## Production sync and closure

George approved master publication and production sync. The documentation-only
release `e13c3ea` was fast-forwarded on v1333 at **16:30 UTC**. No runtime code,
dependency, service or database change was required. The post-pull read-only
check again passed all cohort, retention, disposal and application-health checks.
[Production sync receipt](production-documentation-sync-20261127.json).
The follow-up commit records this receipt and closure wording only. No data-work
blocker remains; the chat can be archived once its local checkouts are synced.

## Final live verification

The [fresh read-only check](final-live-check-20261127.json) at **16:29 UTC**
passed: all 175 archive states and original verification dates match, 174
roots are absent, Gargy is retained, all thirteen protected roots/date policies
match and all six disposal roots are absent with their Project records retired.
API, Web, Power and Nudge each returned HTTP 200. The mounted datastore and
database identity match the sealed evidence. [Read-only observer](final-live-check.cjs).

## Publication boundaries

The initial [machine-readable manifest](publication-manifest.json) records source sizes and SHA-256 digests for all 410 files examined. It publishes 376 readable evidence/tool files; 18 full database snapshots or duplicate transport archives remain external, and 16 generated Python caches are excluded. Only unsealed narrative README/handover links and historical-status notices are adjusted for publication; sealed receipts, scripts, plans and package checksums are unchanged. The sealed November 26 review README retains its historical archive link; that external target is identified in the register below. The manifest records both hashes where a narrative differs.

Full raw database graphs contain historical research metadata and are not needed in Git to review completion. To leave the two local API checkouts clean, all 420 working files (68,315,547 bytes) were preserved and checksum-verified under `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127`. The original untracked trees were renamed into its `originals/` directory, not deleted; verified copies are in `snapshots/`. All eighteen external artifacts match their original hashes. Their current local locations are listed below and in the [preservation receipt](local-preservation-20261127.json). The recorded v1333 evidence packs are unchanged. Keep the artifact directory; archiving this chat does not authorize deleting these evidence copies.

Some historical forensic tests need the exact retained raw plan (notably the Kamoun retirement and release-builder tests). Retrieve the listed artifact, verify its digest and use an isolated review environment; do not run execution commands against production. Historical package commands are evidence, not current instructions.

## External artifact register

<a id="artifact-1"></a>
### 2026-11-26/hpc-deletion-review/evidence/server-audit-20261126.tar.gz

- Bytes: 5,965,287.
- SHA-256: `b71f30a2344e3b69be0e4ee196dabe0ee79a9098fde1058b884bc8060ac6b71a`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-26/hpc-deletion-review/evidence/server-audit-20261126.tar.gz`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-deletion-review-20261126-02`.
- Retained as: sealed-binary-archive. Original bytes unchanged.

<a id="artifact-2"></a>
### 2026-11-26/hpc-first-deletion/evidence/plant-capture-confirmation-server-20261127.tar.gz

- Bytes: 5,090.
- SHA-256: `e4bcb23fc487ec454b1ce4e94c3b790483d5c6601526ffb1dfc139bb3fb7ba06`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-26/hpc-first-deletion/evidence/plant-capture-confirmation-server-20261127.tar.gz`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-plant-capture-confirm-20261127T110444Z`.
- Retained as: sealed-binary-archive. Original bytes unchanged.

<a id="artifact-3"></a>
### 2026-11-27/gulnara-source-deletion/evidence/destination-review-20261127T142029Z.tar.gz

- Bytes: 108,392.
- SHA-256: `50e9dd13be4a06105b57448315540497a7142425ad8a53bc376db8fe87b547cb`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/gulnara-source-deletion/evidence/destination-review-20261127T142029Z.tar.gz`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-gulnara-source-review-20261127-01 and /storage/komondor-gulnara-source-confirm-r2-20261127T144132Z`.
- Retained as: sealed-binary-archive. Original bytes unchanged.

<a id="artifact-4"></a>
### 2026-11-27/gulnara-source-deletion/evidence/native-confirmation/destination-graph-after.json

- Bytes: 258,470.
- SHA-256: `44643780dd06713fcc381f9115c476068b52fabf9884c8e597cb7ee97aae0a3f`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/gulnara-source-deletion/evidence/native-confirmation/destination-graph-after.json`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-gulnara-source-review-20261127-01 and /storage/komondor-gulnara-source-confirm-r2-20261127T144132Z`.
- Retained as: raw-database-graph. Original bytes unchanged.

<a id="artifact-5"></a>
### 2026-11-27/gulnara-source-deletion/evidence/native-confirmation/destination-graph-baseline.json

- Bytes: 258,162.
- SHA-256: `bad9782ead46998a2c60d011fb8f6546cd05bb01d6639d3367f6ae81b42e6a3d`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/gulnara-source-deletion/evidence/native-confirmation/destination-graph-baseline.json`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-gulnara-source-review-20261127-01 and /storage/komondor-gulnara-source-confirm-r2-20261127T144132Z`.
- Retained as: raw-database-graph. Original bytes unchanged.

<a id="artifact-6"></a>
### 2026-11-27/gulnara-source-deletion/evidence/native-confirmation/destination-graph-before.json

- Bytes: 258,162.
- SHA-256: `6dc384471bae38a4e069bc87b096c7c99887c862e151bd7eff9c413ae8a54351`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/gulnara-source-deletion/evidence/native-confirmation/destination-graph-before.json`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-gulnara-source-review-20261127-01 and /storage/komondor-gulnara-source-confirm-r2-20261127T144132Z`.
- Retained as: raw-database-graph. Original bytes unchanged.

<a id="artifact-7"></a>
### 2026-11-27/gulnara-source-deletion/evidence/native-confirmation-20261127T144213Z.tar.gz

- Bytes: 443,321.
- SHA-256: `b01ea88dcb253646f85a753c7bc9ea12b79088b92b87d1a620ca8db729f38ab4`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/gulnara-source-deletion/evidence/native-confirmation-20261127T144213Z.tar.gz`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-gulnara-source-review-20261127-01 and /storage/komondor-gulnara-source-confirm-r2-20261127T144132Z`.
- Retained as: sealed-binary-archive. Original bytes unchanged.

<a id="artifact-8"></a>
### 2026-11-27/gulnara-source-deletion/evidence/native-review-20261127T141323Z.tar.gz

- Bytes: 279,448.
- SHA-256: `f571e39a3338ae1661e2095c60840e5a2cb1c80ddeaf2af6415a18187e4548db`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/gulnara-source-deletion/evidence/native-review-20261127T141323Z.tar.gz`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-gulnara-source-review-20261127-01 and /storage/komondor-gulnara-source-confirm-r2-20261127T144132Z`.
- Retained as: sealed-binary-archive. Original bytes unchanged.

<a id="artifact-9"></a>
### 2026-11-27/gulnara-source-deletion/evidence/server-review/destination-evidence/destination-db-after.json

- Bytes: 258,162.
- SHA-256: `bad9782ead46998a2c60d011fb8f6546cd05bb01d6639d3367f6ae81b42e6a3d`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/gulnara-source-deletion/evidence/server-review/destination-evidence/destination-db-after.json`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-gulnara-source-review-20261127-01 and /storage/komondor-gulnara-source-confirm-r2-20261127T144132Z`.
- Retained as: raw-database-graph. Original bytes unchanged.

<a id="artifact-10"></a>
### 2026-11-27/gulnara-source-deletion/evidence/server-review/destination-evidence/destination-db-before.json

- Bytes: 258,162.
- SHA-256: `f2fcefa6a8b4c80772604297fe458783869e95136af79d872c6074a2415bd13f`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/gulnara-source-deletion/evidence/server-review/destination-evidence/destination-db-before.json`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-gulnara-source-review-20261127-01 and /storage/komondor-gulnara-source-confirm-r2-20261127T144132Z`.
- Retained as: raw-database-graph. Original bytes unchanged.

<a id="artifact-11"></a>
### 2026-11-27/hpc-remaining-deletion/evidence/native-refresh-20261127.tar.gz

- Bytes: 4,794,162.
- SHA-256: `64dd0fb8c431eb67bb5f9f93b90e24195895c2bc6466c1bfa47f5e6355258ee1`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/hpc-remaining-deletion/evidence/native-refresh-20261127.tar.gz`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-deletion-refresh-20261127-01`.
- Retained as: sealed-binary-archive. Original bytes unchanged.

<a id="artifact-12"></a>
### 2026-11-27/hpc-slurm-two-project-test/evidence/bulk-native-confirmation-server-20261127.tar.gz

- Bytes: 9,774,589.
- SHA-256: `8b345727c83f7eee455392540a083c4a3f3c1d7e0f60d239fd8ce1aedd7c1824`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/hpc-slurm-two-project-test/evidence/bulk-native-confirmation-server-20261127.tar.gz`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-slurm-bulk-confirm-20261127T133428Z and /storage/komondor-hpc-delete-split-20261127-01`.
- Retained as: sealed-binary-archive. Original bytes unchanged.

<a id="artifact-13"></a>
### 2026-11-27/hpc-slurm-two-project-test/evidence/native-confirmation-server-20261127.tar.gz

- Bytes: 36,951.
- SHA-256: `e18a0fa6b83ba3bfae4980c3a20de35a7bcd8f848709460fb78c394eb16be364`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/hpc-slurm-two-project-test/evidence/native-confirmation-server-20261127.tar.gz`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-slurm-bulk-confirm-20261127T133428Z and /storage/komondor-hpc-delete-split-20261127-01`.
- Retained as: sealed-binary-archive. Original bytes unchanged.

<a id="artifact-14"></a>
### 2026-11-27/kamoun-direct-disposal/evidence/db-preflight-20261127.json

- Bytes: 5,618,890.
- SHA-256: `244a5582e7e54ee9f1b05d820f3c8a6f4be3aa4a98432d4972e850f84c12b4b5`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/kamoun-direct-disposal/evidence/db-preflight-20261127.json`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-kamoun-disposal-20261127-01, /storage/komondor-kamoun-disposal-backup-20261127-01 and /storage/komondor-kamoun-retirement-20261127-01`.
- Retained as: raw-database-graph. Original bytes unchanged.

<a id="artifact-15"></a>
### 2026-11-27/kamoun-direct-disposal/evidence/retirement-evidence-20261127T150600Z.tar.gz

- Bytes: 1,599,735.
- SHA-256: `0e8556d081bba266e10a33c3f67beecea6a97a414e02b84921cac4d503dd56ef`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/kamoun-direct-disposal/evidence/retirement-evidence-20261127T150600Z.tar.gz`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-kamoun-disposal-20261127-01, /storage/komondor-kamoun-disposal-backup-20261127-01 and /storage/komondor-kamoun-retirement-20261127-01`.
- Retained as: sealed-binary-archive. Original bytes unchanged.

<a id="artifact-16"></a>
### 2026-11-27/kamoun-direct-disposal/komondor-kamoun-six-delete-20261127-01.tar.gz

- Bytes: 98,331.
- SHA-256: `16fbfe33a8b6019330220117b679984c0bead80e3c27fca73be453449b488d19`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/kamoun-direct-disposal/komondor-kamoun-six-delete-20261127-01.tar.gz`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-kamoun-disposal-20261127-01, /storage/komondor-kamoun-disposal-backup-20261127-01 and /storage/komondor-kamoun-retirement-20261127-01`.
- Retained as: sealed-binary-archive. Original bytes unchanged.

<a id="artifact-17"></a>
### 2026-11-27/kamoun-direct-disposal/retirement-plan-r1.json

- Bytes: 6,206,137.
- SHA-256: `e9dbd1828b6d93fb0a77bea7041b2dc5f545a881fdab89810a10618ac490beed`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/kamoun-direct-disposal/retirement-plan-r1.json`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-kamoun-disposal-20261127-01, /storage/komondor-kamoun-disposal-backup-20261127-01 and /storage/komondor-kamoun-retirement-20261127-01`.
- Retained as: raw-database-graph. Original bytes unchanged.

<a id="artifact-18"></a>
### 2026-11-27/kamoun-direct-disposal/retirement-plan.json

- Bytes: 6,206,246.
- SHA-256: `47a03545ab758e871b8e07bea9daf57c02276f70bd245783878c1d4887bacd4e`.
- Preserved local copy: `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/snapshots/execution-worktree/docs/archive/batches/2026-11-27/kamoun-direct-disposal/retirement-plan.json`.
- Server evidence pack(s), as recorded in the execution receipts: `/storage/komondor-kamoun-disposal-20261127-01, /storage/komondor-kamoun-disposal-backup-20261127-01 and /storage/komondor-kamoun-retirement-20261127-01`.
- Retained as: raw-database-graph. Original bytes unchanged.
