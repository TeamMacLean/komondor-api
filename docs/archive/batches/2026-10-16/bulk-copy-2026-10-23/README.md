# October 2026 bulk transfer — historical execution notes

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

## Historical snapshot: unattended authentication active — 26 October 2026, 21:08 UTC/GMT

**The AWS login-expiry fix is live.** At 21:04:19, `copy-batch-r10.cjs` (PID **4002094**) took over after r8 finished its current Project and all old queue/upload processes exited. It adopted **118/174 completed bulk Projects** unchanged and continues **56 remaining**. Including the pilot, **119/175 Projects and 2,727,913,567,671 bytes** are verified. The 21:08 read-only audit has no issues and all HPC roots remain. The current Project is `6051c37ad7661b6ec22a06e3` / `two_blades-029` (77,132,674,232 bytes); source-inventory process reads grew by 14,087,290,511 bytes since 21:05. Those reads are progress, not uploaded bytes.

The live isolated CLI profile `komondor-archive-workload` uses **IAM Roles Anywhere** role `arn:aws:iam::958120753368:role/KomondorArchiveV1333`. Its certificate is valid until **24 January 2027, 20:36:45 UTC**. Temporary credentials renew automatically via the official verified AWS signing helper and a private locked cache, with bounded proxy retries. A real expiry test passed at **20:54:31**, after the original test credentials expired at 20:54:14: replacement credentials authenticated as the same exact role without SSO or a human login. Native pilot ownership/version/full-checksum checks also passed. Permissions exactly match the existing archive mover, including explicit deletion denial. The original SSO profile/role and bucket policy are unchanged. Private keys and temporary credentials are excluded from evidence.

r9's one-time activation controller exited after a read-only preflight caught a leading-slash mismatch in a new path guard. It launched no copy and changed no selector/cron/database state. All failed evidence is preserved. The inspected r10 correction matches native leading-slash normalization; path/account/state regression tests and server supervisor tests passed. The fresh r10 preflight, file seals, single-worker check and launch succeeded. **Do not rerun any launcher or activation controller.** `workload-auth-verified.json` was sealed before launch, so its historical `liveTransferSwitched: false` remains unchanged; the r10 launch, selector and `unattended-auth-20261026/activation-complete.json` prove the switch.

The existing server cron now uses `supervisor-workload-r10.py` every five minutes, with zero AI calls and no automatic queue restart. It confirms the live r10 identity and activity. Source/integrity/authentication failures remain fail-closed; fresh Projects retain their original six-attempt cap. **AI automation remains paused.** The server transfer and automatic credential renewal do not require the Mac, VPN or AI checks. This removes the personal-login expiry dependency, not every possible network/storage failure.

Public setup/launch evidence is mirrored in `workload-r10-evidence-20261026T210935Z` (52 files; tar SHA-256 `52b036680964842a295e716813344d05ffe9c0b0a244829487ff0ac611bc25b5`); every member and script seal matches. Completed evidence snapshot `completed-evidence-20261026T210230Z` has all 118 completion receipts checked (tar SHA-256 `2d955961858eebacfb47e1f748b9152d9bcfa5e7b483a3eeaa51b3dd066fcfe3`); the previous 117 hashes and all verified timestamps are unchanged. Latest verified transfer: **21:01:37.507 UTC**. Manual collection: `collect-monitor-workload-r10.py STAMP`; inspect, then `mirror-monitor-evidence-v7.py STAMP`. Use fresh names and the actual observation timestamp inside each snapshot.

All earlier dated sections below are historical and superseded by this section. The user removed the seven-day hold; deletion still requires all 175 verified, the passed pilot restore, fresh per-Project source/archive review and representative deeper checks, followed by the user's own reviewed manual deletion commands. No deletion or finalization has occurred.

## Historical continuation r8 — 26 October 2026, 17:42 UTC/GMT

## Workload-identity handover pending — 26 October 2026, 20:47 UTC/GMT

The user renewed the existing Mac administrator session and explicitly requested unattended server authentication. The dedicated role `arn:aws:iam::958120753368:role/KomondorArchiveV1333`, Roles Anywhere trust anchor and profile are created and read-back verified. Permissions exactly match the existing mover, including the explicit deletion deny; the SSO role and bucket policy are unchanged. The server certificate expires **24 January 2027 at 20:36:45 UTC**. Private keys and temporary credentials are outside the evidence pack. The native pilot status/full-checksum/version/ownership checks passed using the new identity; no SSO is configured in its isolated profile. Public preparation/evidence is in `unattended-auth-20261026/`.

r8 PID 3668776 was asked at 20:44 to finish its current native operation and stop via its existing graceful signal handler. Its active upload continued. **Do not interrupt upload children or start another queue.** A sealed one-time server controller, `activate-workload-r9.py`, PID 3962673, was launched detached at 20:46:29. It waits for the test credentials to actually expire after 20:54:14, tests fresh certificate credentials without a human login, waits for the old worker/session to exit cleanly, checks all 117 previously mirrored receipt hashes, and performs the fresh r9 native/database/source/evidence preflight before one launch. New untouched Projects retain the six-attempt bound. Authentication/integrity/fence failures remain fatal; no exhausted budget is reset. The controller has a two-hour upper wait bound and never retries a launch. Inspect `activation-result-r9.json`, `activation-error-r9.json`, `workload-auth-verified.json` and `copy-active.json`; never blindly rerun any launcher/controller. No r9 activation has yet been confirmed in this snapshot.

The controller can complete this switch without the Mac/VPN or AI. It updates only the existing server observer cron to the reviewed r9 observer during activation. AI automation stays paused. Once r9 is confirmed, use `collect-monitor-workload-r9.py STAMP` and `mirror-monitor-evidence-v5.py STAMP` for fresh manual snapshots. All originals and earlier receipts remain retained; deletion is still the user's own reviewed manual step.

## Unattended authentication preparation — 26 October 2026, 20:04 UTC/GMT

The user requested removal of the recurring human SSO dependency, with no AI checks. The proposed fix is a dedicated archive workload role through IAM Roles Anywhere. Preparation is in `unattended-auth-20261026/README.md` and `audit-admin.py` in the Mac batch pack. **Not activated:** the current server mover lacks IAM/Roles Anywhere administration permissions and the Mac `tsl-admin` session is expired. The user has been asked to renew that existing administrator login on the Mac. Read the prepared plan, inspect actual policies/trust anchors/bucket policy, then validate isolated machine credentials before a reviewed graceful runner handover. No credentials, IAM resources, live runner, cron, application or service settings have been changed by this preparation. Do not claim the expiry problem is fixed or restore AI automation.

At 20:04:17 r8 remains active with **117/174 bulk completions, 118/175 including pilot, 2,650,861,874,912 verified bytes**, no issues. Both new completion receipts were mirrored and verified; all 115 earlier hashes unchanged. Snapshot `completed-evidence-20261026T200700Z`, SHA-256 `63ff09f704832067fa0100a8c2468b26f5d0c5aaf8e07bd48f239ed590a22c21`. Source snapshots use a requested stamp later than the actual server observation; always use the timestamp inside the observation as the check time.

**AWS SSO was renewed by the user, validated against the expected account/role, and the transfer restarted at 17:41:34.** Current runner is `copy-batch-r8.cjs`, PID **3668776**; selector files are `copy-worker-r8.json`, `copy-summary-r8.json`, `copy-r8.log`. It adopted all **115/174 verified bulk Projects** (116/175 including pilot; **2,503,010,972,940 bytes**) without reupload or timestamp changes and continues **59 remaining Projects** with one worker and unchanged conservative S3 settings.

The stopped inventoried Project `5fc012bda3efcb29338b7d51`, migration `6adb2eb05f563cce90e7479a`, had zero payload objects, zero control objects, no source manifest and zero unfinished multipart uploads. Its canonical roots, retained source and native copy-preview summary/anomalies matched the reviewed plan. Fresh identity and native-status evidence are in `auth-recovery-20261026T173512Z`. r8 accepts only this exact old authentication event (including phase and timestamp) after renewal; new authentication errors still stop immediately. No DB error was cleared directly. The original failed attempt remains preserved; this Project starts at attempt **2/6**, with at most five remaining attempts. Fresh Projects retain six attempts. Existing native checksum, source, ownership/version, multipart and DB fences remain.

The read-only preflight passed (115 adopted, 59 remaining), all 115 previously mirrored completion hashes were unchanged, and the old queue/session had no remaining processes. Syntax, exact-auth-event and retry-budget tests passed on Mac and server; six supervisor safety tests passed. A fresh exclusive launcher, intent, logs, receipts and SHA-256 seal prevent blind reruns or overlap. Launch evidence was mirrored and independently hash-verified in `r8-launch-evidence-20261026T174223Z`.

The server crontab still checks every five minutes with no AI, now using `supervisor-20261026.py`. It observes r7/r8 and never automatically launches or restarts a queue; bounded proxy retries remain inside the native worker. Old scripts/seals and crontab are preserved. A live supervisor tick confirmed r8 active. The current native copy started at 17:41:51 and process I/O shows source reading during checksum inventory; do not describe this initial inventory as uploaded bytes. At 17:42 no new errors were reported.

**AI automation remains paused; checks are manual.** Use `collect-monitor-20261026.py STAMP` and `mirror-monitor-evidence-v4.py STAMP` for r8-compatible fresh snapshots. The old auth error in r7 is historical, resolved by this inspected continuation. Preserve all originals. Final deletion still requires all verified transfers, passed pilot restore, fresh review and the user's manual commands; no seven-day hold remains. Reliability/minimal intervention remains ahead of speed. The earlier Sunday ETA needs reassessment after the 12h26m authentication outage; fresh r7 progress had been about 62 GB/hour including verification.

## Initial approved bulk copy — 23 October 2026

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

The user approved copying all nominated archival projects to AWS now, while
retaining every HPC original. Copying no longer waits for the live pilot's cold
restore. This decision supersedes the pilot-only scope and its original review
clock; the original pilot receipts remain unchanged as historical evidence.

## Scope

The reconciled `OUTCOMES.json` is the source of truth: 176 archive decision
entries represent 175 distinct Projects. Entries `ntalbot-026` and `ntalbot-031`
cover one Project, including the completed project_2178 consolidation. Archive
that combined root once. The verified Plant Capture Enhancer pilot is already
copied, leaving 174 Projects to copy.

KEEP decisions, direct disposal, empty-directory records and retired empty
records are outside this copy queue. No age cutoff or owner enquiries apply.

## Copy and retention

1. Run fresh structural plans, review any changed or unexpected conditions,
   take a database checkpoint and use a guarded maintenance window to lock
   nominated Projects against writes. The user controls services through their
   `tsldata` terminal. Services can return after locking; payload transfer does
   not require continued application downtime.
2. Use the deployed archival implementation to inventory, copy and verify
   every Project. Preserve current file bytes, scientific metadata, ownership,
   original verification gaps and reconciliation history. Perform the normal
   archive checksums, without another separate bulk checksum sweep.
3. Retain each HPC tree until the final review and the user’s manual deletion.
   The latest user decision removes the seven-day hold. Preserve the verified
   transfer timestamp `storage.s3VerifiedAt` and all historic receipts.
4. Before deletion, require the live pilot restore to have passed, review any
   exceptions, and run fresh manifest/object and source-tree checks. A manual
   nominal AWS inspection complements those checks. A separate cold retrieval
   test for every Project is not required.
5. The user personally runs the later verified HPC deletion commands. Only
   then may absence be verified and archive state finalized. This copy stage
   does not authorize deletion or automatic deletion after a timer.

The successful earlier synthetic cold retrieval remains valid evidence. The
current representative live-file restore is an additional system check, not a
reason to postpone independent copies.

## Location information

Komondor already records the verified transfer time in `storage.s3VerifiedAt`.
The intended presentation is HPC presence, AWS presence and that transfer date.
Both copies can coexist. HPC and S3 use the same relative hierarchy with
different root prefixes. No additional user-facing deletion-status field is
needed; retain the internal lifecycle and verification evidence.

## Evidence

Private execution pack: `/storage/komondor-archive-batch-20261023/` on v1333;
Mac mirror: `/Users/deeks/.codex/artifacts/archive-batch-20261023/`.
`scope.json` records the deduplicated roots and authority. Project plans and
transfer receipts are recorded separately. This document records the approved
plan; it does not claim the bulk transfer has completed.

Fresh plans completed at 09:44:10 UTC: **174 remaining Projects, 15,394 files,
13,448,767,887,133 bytes**. There were no missing/untracked files, symlinks,
special files or exclusions. The reviewed notes comprise 3,162 historical
missing destination MD5 checks, 10,901 stored-versus-derived location notes and
3,268 empty directories. The exact plans and historical gap IDs are sealed in
`reviewed-plans.json`; no other serious anomaly is accepted.

The first maintenance window paused all services at 09:48:07 UTC. Its fresh
checkpoint contains 56,469 documents in 17 collections, stable across two reads;
independent SHA-256 and BSON round-trip verification passed on the Mac. Manifest
SHA-256: `c2caf0a312b20294d75f526aad7b305c2f2fbb18278be7767779cf8d9e15880f`.
The user explicitly confirmed that no external jobs were writing to nominated
trees. The first launch had stopped before service changes because a helper
file lacked `tsldata` read permission; explicit read ACLs corrected that.

The worker locked **44 Projects**, then stopped on failures connecting through
the institutional AWS proxy. No bulk payload was uploaded in this window.
All four applications were restored at **09:58:36 UTC**, and returned HTTP 200.
A comparison of all 362 Project records against the paused checkpoint confirms
that only `storage`, `archiveMigration` and `updatedAt` changed on those 44;
all other Projects are unchanged. All HPC originals remain.

A fresh continuation controller completed the remaining 130 locks, preserving
the 44 recorded migrations without repeating their locks. Bounded
retries cover temporary proxy failures on read operations only. Identity,
bucket retention and destination checks remain fresh; only local CLI version
and help output is reused while its executable is unchanged. Retry tests cover
exhaustion, refusal to retry mutations or expired credentials, deadline guards,
cache invalidation and uncached AWS identity checks. The nine controller failure
scenarios and lock scope/deadline guards also passed. Production application
source remains unchanged.

The second window paused services at **10:13:51 UTC**. Its incremental checkpoint
captured all 362 Project records twice, with independent Mac verification and
an explicit link to the original full database checkpoint. Incremental manifest
SHA-256: `4c06ebe1eea1f089c420cd177da82d928e3dfa77937d58bb6dee9b3de0fb94a3`.
All **174 bulk Projects were locked at 10:26:35 UTC**, with no final errors.
Comparison against the original paused checkpoint passed for all 362 Projects:
only the nominated Projects' `storage`, `archiveMigration` and `updatedAt`
fields changed; all other Project records remained unchanged.

The controller restored all four applications at **10:26:53 UTC**. The API,
Sequences, Power and Nudge returned HTTP 200 before the detached copy queue
started at **10:27:23 UTC**. The queue uses two concurrent Projects, smallest
first, through the deployed archive implementation. Copies are in progress;
this is not a whole-batch completion receipt. Each completed Project receives
sealed source/verification evidence and a receipt containing its verified S3
transfer time and earliest deletion-review time. All HPC originals remain.

The initial copy queue stopped at **10:30:01 UTC** after six verified Projects:
the institutional proxy failed during uploads on two other Projects. Inspection
confirmed matching sealed manifests, only migration-owned completed objects,
and no incomplete multipart uploads. The stopped worker and all receipts were
retained. A continuation preflight then stopped before transfer mutations because
Mongoose presents an absent nested error field as an empty object; checking the
actual error message corrected that issue. A read-only state check passed for
six completed and 168 remaining Projects.

The corrected continuation started at **10:36:34 UTC**. It preserves all six
completed Projects and uses native `resume` for the two inspected partial
transfers. Any further proxy recovery requires fresh source-manifest, ownership,
object-checksum and version checks, with no outstanding multipart uploads.
Attempts are bounded to six per Project; other errors stop the queue for review.
Completed objects are reused, with their versions checked again after completion.
Recovery-policy tests cover identity, phase, digest, ownership, multipart and
error-class refusal. Application source and services remain unchanged.

Both interrupted Projects subsequently passed verification at **10:37:18** and
**10:37:23 UTC**. Previously completed object versions were unchanged. Eight
bulk Projects are verified at this checkpoint and the next two are copying;
the batch is still in progress.

`copy-active.json` identifies the current worker/log/summary; earlier failed
summaries are historical evidence. Use `status-batch.cjs` for current state.

At 10:45:25 UTC the continuation stopped after 11 complete receipts. One further
Project was verified by the native tool but its evidence download hit the AWS
CRT form of the proxy CONNECT error; another upload was partial. The inspected
r5 continuation started at **10:47:23 UTC**, preserving completed work and
recognizing both exact proxy error forms. It repairs the already-verified
Project's receipt without reuploading it, resumes the partial Project after
the same checks, and continues the remaining locked Projects. Bounded retries
still exclude authentication, integrity, ownership, source-change and fence
failures. The preflight and retry-policy checks passed before launch.

With the user's explicit approval, the hourly
`komondor-pilot-restore-verification` automation now monitors **both the bulk
transfer and the live pilot restore**. It reports completion, a problem or
required user action, and stays quiet during normal progress. It remains active
until both operations have completed and been reported. It does not restart
failed queues blindly, control services, or delete/finalize archives. Repository
merge/push and production UI changes are separate deployment work.

## Initial monitoring cadence

The user subsequently requested **15-minute checks** while proxy interruptions
are being resolved, prioritizing continued transfer progress. The same monitor
returns to hourly after at least two hours of observed healthy progress and
eight consecutive successful scheduled checks without new proxy failures or
unresolved issues. It returns to 15 minutes after a later interruption.

The monitor may investigate and execute an inspected continuation within the
already-approved copy scope, preserving completed Projects and native safety
checks. This supersedes its earlier monitor-only restriction. It must not launch
overlapping workers, blindly reset an exhausted retry budget, change services,
expand scope or delete/finalize data. Repeated unsuccessful recovery of the same
cause requires reporting the blocker. Normal checks remain quiet.

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
