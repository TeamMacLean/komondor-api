# Plant Capture Enhancer pilot — historical execution notes

**Current position — 27 November 2026:** copying finished on 3 November.
The live Plant Capture restore passed on 23 October at 16:49:16 UTC. Manual
HPC removals and native confirmations are complete for **174 of the 175**
archived Projects; Gargy alone remains on HPC and AWS, protected through
26 November 2027. Plant Capture and Gulnara's four old sources are among the
completed removals. Gulnara's new destination and staging files remain on HPC.
The separate **six Kamoun disposals without S3** are also complete; their
metadata and history were retained.

See [current status](../../../STATUS.md),
[final archive and disposal outcomes](../../2026-11-27/PUBLICATION.md), and
[verified transfer completion](../../../evidence/transfer-completion-20261103/README.md).
Those records supersede the progress counts, ETAs, pending gates and instructions
in the dated notes below. **Do not replay any launch, service or deletion commands
from these historical notes.**

George removed the initial seven-day post-copy hold on 23 October. There is no
remaining waiting-period or deletion task for the completed Projects. Active
keep dates still apply to retained Projects. Earlier 15-minute, hourly and daily
AI schedules were stopped; checks are manual/ad hoc. The server-local observer
was separate from AI monitoring; its current configuration is not established
by this historical record.

The original unedited notes are preserved in the checksummed main-checkout
snapshot under `/Users/deeks/.codex/artifacts/archive-completion-preserved-20261127/`.
The following sections retain the evidence and decisions as reported at their
dated checkpoints; words such as “current” or “latest” refer to those dates.

---

## Historical continuation r8 — 26 October 2026, 17:42 UTC/GMT

**AWS SSO was renewed by the user, validated against the expected account/role, and the transfer restarted at 17:41:34.** Current runner is `copy-batch-r8.cjs`, PID **3668776**; selector files are `copy-worker-r8.json`, `copy-summary-r8.json`, `copy-r8.log`. It adopted all **115/174 verified bulk Projects** (116/175 including pilot; **2,503,010,972,940 bytes**) without reupload or timestamp changes and continues **59 remaining Projects** with one worker and unchanged conservative S3 settings.

The stopped inventoried Project `5fc012bda3efcb29338b7d51`, migration `6adb2eb05f563cce90e7479a`, had zero payload objects, zero control objects, no source manifest and zero unfinished multipart uploads. Its canonical roots, retained source and native copy-preview summary/anomalies matched the reviewed plan. Fresh identity and native-status evidence are in `auth-recovery-20261026T173512Z`. r8 accepts only this exact old authentication event (including phase and timestamp) after renewal; new authentication errors still stop immediately. No DB error was cleared directly. The original failed attempt remains preserved; this Project starts at attempt **2/6**, with at most five remaining attempts. Fresh Projects retain six attempts. Existing native checksum, source, ownership/version, multipart and DB fences remain.

The read-only preflight passed (115 adopted, 59 remaining), all 115 previously mirrored completion hashes were unchanged, and the old queue/session had no remaining processes. Syntax, exact-auth-event and retry-budget tests passed on Mac and server; six supervisor safety tests passed. A fresh exclusive launcher, intent, logs, receipts and SHA-256 seal prevent blind reruns or overlap. Launch evidence was mirrored and independently hash-verified in `r8-launch-evidence-20261026T174223Z`.

The server crontab still checks every five minutes with no AI, now using `supervisor-20261026.py`. It observes r7/r8 and never automatically launches or restarts a queue; bounded proxy retries remain inside the native worker. Old scripts/seals and crontab are preserved. A live supervisor tick confirmed r8 active. The current native copy started at 17:41:51 and process I/O shows source reading during checksum inventory; do not describe this initial inventory as uploaded bytes. At 17:42 no new errors were reported.

**AI automation remains paused; checks are manual.** Use `collect-monitor-20261026.py STAMP` and `mirror-monitor-evidence-v4.py STAMP` for r8-compatible fresh snapshots. The old auth error in r7 is historical, resolved by this inspected continuation. Preserve all originals. Final deletion still requires all verified transfers, passed pilot restore, fresh review and the user's manual commands; no seven-day hold remains. Reliability/minimal intervention remains ahead of speed. The earlier Sunday ETA needs reassessment after the 12h26m authentication outage; fresh r7 progress had been about 62 GB/hour including verification.

## Initial Plant Capture Enhancer pilot — 23 October 2026

## Historical operations — 25 October 2026

**Daily Codex/AI checks are PAUSED at the user’s request. Future AI checks are manual.** A separate server-local supervisor is installed in deeks’s crontab every five minutes and uses no AI. It remains independent of the Mac and VPN. This supersedes all previous daily/hourly/15-minute AI monitoring instructions below.

At 08:50 UTC/GMT on 25 October, the live queue had **96/174 complete bulk receipts**, plus the pilot = **97/175 verified Projects**, **1,452,727,929,995 verified bytes including the pilot**. It was running. Three Projects were held after proxy retry exhaustion: `5fc012bda3efcb29338b7d64`, `5fc012bda3efcb29338b7d7c`, `5fc012bda3efcb29338b7d6d`. All previous 69 receipt hashes were unchanged and 27 newly completed Projects were mirrored and independently verified, giving 96 in the Mac index.

Connection tuning is applied only to the `komondor-archive-mover` profile: classic S3 transfer client, maximum two concurrent S3 requests, standard retry mode, maximum eight request attempts. Other profiles and account/role settings were checked unchanged; the previous config is backed up privately on the server. An isolated tuned identity and full-checksum HEAD test passed before activation. Existing upload processes are allowed to finish; subsequent AWS CLI processes read the tuning. No new AWS services were created; ordinary S3 request charges still apply.

`supervisor-20261025.py --tick` runs from server cron and records `supervisor-health.json`, `supervisor-events.jsonl`, `supervisor-cron.log`, and `supervisor-drain-r6.json`. It checks the actual process and its upload children, log growth and process-tree I/O. Two hours without observable I/O/log progress flags attention without killing an upload. It requested r6’s documented graceful stop: finish the current native operation, then exit. No upload child was signaled and no overlapping worker was launched. The automatic 08:50 scheduled tick was observed and confirmed the original worker still progressing.

Once the r6 session and upload children have exited, the supervisor validates the tuning/config hash and reviewed script seal, runs a fresh read-only native/DB preflight, then starts detached `copy-batch-r7.cjs --execute` once. r7 adopts completed Projects without reupload or timestamp changes. Every partial Project gets at most **two additional audited attempts under the changed, tested tuning**, with the original attempt histories preserved; fresh Projects retain six native attempts. Each resume still checks exact migration/canonical paths, sealed source digest, existing ownership/full checksums/versions and no unfinished multipart uploads. Exact proxy failures can retry and then quarantine; authentication, source, integrity, ownership, multipart and unexplained failures stop for manual attention. This is a one-time tuned recovery stage addressing connection settings, not an unlimited budget reset.

Failed/ambiguous preflight or launch records cannot be rerun automatically. Unexpected exits or fatal failures require inspection; there is no blind automatic restart. `supervisor-launch-intent-r7.json` fences launch, `copy-preflight-r7.json` preserves preflight evidence, and a file lock prevents concurrent supervisor ticks. After r7 exits the supervisor reports complete or needs-attention rather than starting another attempt cycle. It never deletes/finalizes archives, changes services, takes locks, contacts owners, emails, commits or pushes.

At this snapshot **r6 was still running and graceful handover was pending**; do not infer r7 has started. Read `copy-active.json`, `supervisor-health.json`, `copy-launch-r7.json` when present and current logs on every manual check. `status-batch-r7.cjs` will become active during the fenced handover. `collect-monitor-20261025.py STAMP` gathers current r6/r7 evidence; `mirror-monitor-evidence-v3.py STAMP` supports r5/r6/r7 fresh evidence snapshots. Never rerun an existing stamp after an unknown outcome.

Validation: eight supervisor safety tests passed locally and on v1333; runner tests verified the two-/six-attempt bounds and fatal-error fences; syntax and script-hash checks passed. Live dry-run, first real graceful-stop request, duplicate-tick no-overlap check, and an automatic cron tick passed. The r7 live preflight is deliberately deferred until the current copy finishes; any failure remains visible in server health and prevents launch.

Receipts and tuning/supervisor proof are under `supervisor-evidence-20261025T084904Z` in the Mac batch pack. The pilot restore remains verified. No seven-day hold remains, but fresh final review and the user’s own deletion commands are still required after all transfers are verified.


**Latest monitoring cadence — 23 October 2026:** once daily at **12:00 Europe/London**, explicitly requested by the user to conserve AI usage. This supersedes all hourly and 15-minute cadence instructions below. Do not automatically increase frequency. Transfers run independently; any interruption needing intervention may wait until the daily check. All existing recovery authority and manual-deletion boundaries remain in force.

**Latest user decision — 23 October 2026:** the seven-day / 168-hour hold is removed. Once all 175 nominated Projects have verified S3 transfers and the live pilot restore passes, prepare a deletion review immediately. Before presenting commands, check every Project’s identity, canonical source/destination, verified database state, sealed source and verification evidence, and fresh S3 inventory against its manifest; investigate every discrepancy. Use the deployed native source/archive checks required for deletion. Perform deeper object checksum/version/ownership spot checks across a few representative Projects, including the largest payload and a Project with many files. No additional cold restore per Project or separate full payload checksum sweep is required. The user personally runs HPC deletion commands after reviewing the results; this monitor must not delete or finalize archives. Retain originals until that manual step. Historic receipts and their +168-hour review dates remain immutable evidence of the superseded plan and no longer impose a waiting period. Record storage.s3VerifiedAt unchanged. Checks run hourly by explicit user request to conserve AI usage; do not automatically increase frequency.

The latest decision above supersedes the original pilot authorization and review-clock text below, which is retained as historical context. See [the current bulk-copy plan](../bulk-copy-2026-10-23/README.md).

**Copy and real-file cold restore verified. Earlier pending-state entries below are historical.**
The user green-lit this single pilot and a minimum seven-calendar-day review
after successful real-file restoration and application acceptance. No HPC
deletion, archive finalization, broader batch execution, owner contact, merge
or push is authorized by this record.

## Identity and scope

| Item | Recorded value |
| --- | --- |
| Decision | `jjones-056` |
| Project | Plant Capture Enhancer — `5fc012bda3efcb29338b7d4b` |
| Migration | `6adb1abcbed8ab3ef3948eb3` |
| Owners | `witekk`, secondary `jonesj`; unchanged |
| HPC source | `/mnt/reads/jjones/plant_capture_enhancer` |
| S3 destination | `s3://tsl-hpc-reads/jjones/plant_capture_enhancer` |
| Payload | Three files, 34,647,343 bytes; two Reads and one AdditionalFile PDF |
| Storage | `DEEP_ARCHIVE`, `AES256`, account `958120753368`, region `eu-west-1` |
| State | `aws_pending_hpc_deletion`, phase `verified` |

The fresh plan had no missing or untracked files, symlinks, special files or
exclusions. Three empty directories were recorded. The two expected
`read-destination-md5-missing` anomalies were explicitly acknowledged for Read
IDs `5fc012cca3efcb29338b9b1d` and `5fc012cba3efcb29338b979a`.
Historical checksum fields were retained; current archive checksums are separate.

## Maintenance and verified copy

The user ran the new, pilot-specific controller as `tsldata` on `v1333`,
attesting that external writers and direct API callers were frozen. It verified
all four release revisions, clean checkouts, Power source hashes, zero queued
work, the expected API instance, drained API connections and data-file handles.
Web, Power and Nudge stopped before the API. This accounts for embedded
AdditionalFile activity as well as queued workers.

All four services were paused at **08:25:19.989 UTC**. A fresh paused MongoDB
checkpoint contained **56,457 documents across 17 collections**, stable across
two reads. Its files were independently checked on the Mac for SHA-256, BSON
framing, document counts and exact decode/reserialize round trips. This does
not claim a new database restore rehearsal; earlier recovery evidence remains
applicable.

The project locked at **08:28:45.825 UTC**. The user's controller restored all
four services at **08:29:02.116 UTC**, after approximately 3 minutes 42 seconds
with all four stopped. API readiness passed before dependants restarted. All
four HTTP health checks returned 200 again at 08:41:43 UTC.

Copy verification sealed at **08:30:52.069 UTC**. The source tree, exact object
key set, size and full-object CRC64NVME checks passed. Independent HEAD checks
verified all three objects' encryption, storage class, size, checksum and
project/migration/source-manifest ownership metadata. No foreign objects or
unfinished multipart uploads were present. All three HPC originals remain.

- Paused backup manifest SHA-256: `64d27cc6acc58c1ccd39c9ad91de7370c69dc2bdc5e3f50fe7eac4164592014a`.
- Source manifest SHA-256: `53d3a4a89236ddbff477eac5a63f1acc302992fbc9029cadb54629f665312f08`.
- Verification report SHA-256: `472e6d76dd2cd29b8c2f6642c78ea4c20c1f57a0ff19a5554d0cf92252c59747`.

## Application acceptance

- Normal API project, sample and run routes return the correct inherited state
  and all three file locations. A sample-create request using the already
  existing sample name is rejected with 409 `PROJECT_STORAGE_READ_ONLY`, both
  while migrating and after copy verification.
- Signed-in Sequences views show the real project, sample and run, the S3
  locations, write-protection explanation and absent upload/new-child controls.
  Both original MD5 values remain; the missing historical checks are labelled
  “Not checked before archive.” The PDF and sequencing-file copy buttons show
  success notices. Clipboard API readback returned empty, so exact copied bytes
  were not independently confirmed by this browser check.
- Signed-in Power **Validate and review** rejects the pilot specifically for
  `aws_pending_hpc_deletion`. Final submission was never invoked. Power retains
  10 completed and 12 error entries, with zero unfinished tracking rows.
- The deployed Nudge pure classifier gives the same `NOT_NUDGEABLE` decision
  before and after archival. The live service remains in dry-run mode. No
  Nudge run or email was invoked for this check.
- All ten scoped Project/Sample/Run/Read/File/AdditionalFile/Group documents
  were compared with the paused backup. Only the Project's `storage`,
  `archiveMigration` and `updatedAt` fields changed. Scientific metadata,
  original paths, owners and correction history remain unchanged.

The temporary API checker initially expected S3 file URIs while `migrating`.
That expectation was corrected: HPC remains authoritative until verification.
The corrected check passed. No application source was changed. The private
preservation checker also needed the deployed BSON package's constructor API
before its successful read-only comparison. Controller orchestration tests
covered nine normal/failure cases; the CLI output parser passed three cases.

## Remaining restore and review gate

At **08:31:39.651 UTC**, AWS accepted a Standard restore with two days of
temporary availability for this real sequencing file:

`jjones/plant_capture_enhancer/pce/pce/raw/PCE_TKD180301086-AK3145_HCGHWBCX2_L2_1.fq.gz`

Expected size is **17,209,559 bytes**, SHA-256
`e7a9e2fed3b1d8d4dc1c22de343c7a3cdd2bb7c8f147488bc21a22a5e8adccf9`,
CRC64NVME `LNflJKcrReM=`. The latest check still reported
`ongoing-request="true"`. The review clock has **not started**.

The user authorized an hourly follow-up in this chat. Automation
`komondor-pilot-restore-verification` checks the restore, downloads to a private
evidence directory when ready, verifies size/SHA-256/CRC64NVME, and reports only
completion or a problem. Keep the computer and desktop app running for these
local checks. Authentication expiry requires the user's normal SSH/SSO renewal.

The follow-up must record the later of application acceptance and successful
restore verification as the review start. Set the earliest review end at least
seven calendar days later in Europe/London. Passing that date does not authorize
deletion. The user must separately approve the next stage and personally run
any eventual, freshly verified HPC deletion command. Keep this pilot's original
tree frozen throughout review. Other workloads can resume normal operation.

## Evidence and continuation

- Server pilot pack: `/storage/komondor-pilot-plant-capture-20261023/`.
- Service controller receipts: `/storage/komondor-pilot-window-20261023/`.
- Mac evidence: `/Users/deeks/.codex/artifacts/archive-pilot-plant-capture-20261023/`.
- Application acceptance: Mac `application-acceptance.json`; server
  `application-evidence/application-acceptance.json`.
- Server `restore.cjs verify` is the narrow continuation command, run with
  `/storage/.nvm/versions/node/v24.11.1/bin/node` as `deeks`. Exit 2 means pending;
  exit 0 requires a successful `restore-verified.json`; exit 1 needs inspection.
  Do not rerun `request`, lock, copy or the maintenance controller.
- Inspect an existing `restore-verified.json` or partial `restored/` directory
  before retrying. Preserve evidence and do not overwrite partial downloads.

The private packs contain database snapshots and are not for committing.
Operational handover, repository review/merge/push and wider batch execution
remain separate stages. The production application revisions are unchanged.

## Live pilot restore verified — 23 October 2026

At **16:49:16.352 UTC (17:49 BST)**, the representative real R1 restored from S3 matched the sealed source manifest: **17,209,559 bytes**, SHA-256 `e7a9e2fed3b1d8d4dc1c22de343c7a3cdd2bb7c8f147488bc21a22a5e8adccf9`, CRC64NVME `LNflJKcrReM=`. The receipt and sealed manifests were mirrored to the Mac and independently checked; the retained server download’s size and SHA-256 also matched. Receipt SHA-256: `025298af6f0246992591c01a121ba3af9e4fa1f673abeb0d7ee8cbab7ab038e7`. Mac evidence: `/Users/deeks/.codex/artifacts/archive-pilot-plant-capture-20261023/restore-completion-20261023T164841Z/`.

The pilot restore requirement is satisfied. Bulk copying remains in progress: 66/174 bulk receipts and 67/175 Projects verified at 16:49 UTC, with no audit issues and all HPC roots retained. The hourly monitor remains active for transfer completion and the final deletion review. This milestone does not authorize automatic HPC deletion.

## Historical continuation r6 — 24 October 2026

The r5 worker stopped on 23 October at 17:30:40 UTC after 69 complete bulk receipts. The institutional proxy repeatedly failed during uploads for Project `5fc012bda3efcb29338b7d64` (`jjones-025`, 1,080 files); its six-attempt native retry budget was exhausted. This is unrelated to the Mac VPN outage. Its originals and all prior evidence remain.

Before continuation, the old queue and upload children were confirmed exited; current AWS identity/account/role passed. A fresh native status/source-manifest audit checked all **757 existing objects** for ownership, full checksum, version, encryption and storage class, with **zero foreign objects and zero unfinished multipart uploads**. The source remained retained. Completed receipt hashes and verified timestamps were unchanged.

The reviewed `copy-batch-r6.cjs --execute` started at **2026-10-24T18:07:28.548055Z**, PID **2641588**, detached from SSH. It adopts the 69 completed Projects and processes the other **104 untouched locked Projects** with **one worker** to reduce concurrent proxy connections. The exhausted Project is quarantined and not retried by r6. Underlying proxy reliability remains unresolved. Exact proxy failures retain the original six-attempt bound; any later exhausted Project is recorded in `copy-quarantines-r6.jsonl` and held aside while the untouched queue continues. Authentication, integrity, source-change, ownership, multipart and unexplained/fence failures still stop globally. No retry budgets were reset, services changed, new locks acquired, application sources deployed, originals deleted or archives finalized.

`copy-active.json` now selects `copy-worker-r6.json`, `copy-summary-r6.json` and `copy-r6.log`. Read-only `status-batch.cjs` supports r6 and reports quarantines as unresolved issues. Inspect `copies/*/r6-attempt-*`, `copies/*/worker-error-r6.json` and `copy-quarantines-r6.jsonl`; r2–r5 failures are historical except the explicitly quarantined Project. The Mac evidence helper is `mirror-monitor-evidence-v2.py` for r5/r6; preserve fresh snapshot names and verify prior receipt hashes. All prior helpers and seals remain.

Node syntax and SHA-256 seal checks passed on both hosts. Recovery/error-class tests and the new queue-policy tests passed; live read-only preflight validated 69 complete, one quarantined and 104 untouched Projects before launch. Post-launch status confirmed the worker active and its first copy started. Evidence is mirrored under `r6-launch-evidence-20261024T180728Z` in the Mac batch pack. The stopped-r5 archive SHA-256 is `38b8832c538b9e39b790980aaa95b2c415ae6fe08a807ecd41d35d94a6f94979`.

Current verified total at launch: **69/174 bulk Projects**, plus the verified pilot = **70/175**; **485,505,897,856 verified bytes including the pilot**. The pilot restore passed on 23 October. Daily **12:00 Europe/London** checks remain. The earlier Thursday 29 October ETA needs new throughput evidence after the day lost and the single-worker change; do not repeat it as current. The user’s removal of the seven-day hold and manual-deletion/final-review requirements still govern.
