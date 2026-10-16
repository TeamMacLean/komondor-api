# S3 archive operator runbook

**Start here every six months.** Projects are selected and archived manually;
there is no scheduled job and no automatic HPC deletion.

- First use or changed infrastructure: [deployment and acceptance](S3_PROJECT_ARCHIVAL_DEPLOYMENT.md).
- Before every batch: [renew SSO login](#before-each-archive-batch).
- Routine batch: [semi-annual procedure](#semi-annual-procedure).
- Each selected project: [archive one project](#archive-one-project).
- Interrupted or failed work: [recovery](#recovery).
- Retrieve data: [restore a real archived file](#restore-a-real-archived-file).
- Design and limits: [architecture decisions](S3_PROJECT_ARCHIVAL_ARCHITECTURE_DECISIONS.md).

Run commands from the deployed `komondor-api` checkout on the host with the
canonical datastore mount. The tool archives `DATASTORE_ROOT`, never
`HPC_TRANSFER_DIRECTORY`. Payload mirrors `GROUP/PROJECT/...` beneath the
configured S3 root; manifests live in `_control/projects/ID/MIGRATION/` and
stay in Standard. Payload defaults to Deep Archive.

## Before each archive batch

On the archive execution host (currently **v1333**), open the operator shell or
tmux session as the **same Linux user that will run the archive commands**.
Configure the named SSO profile once for each operator account using the
[deployment instructions](S3_PROJECT_ARCHIVAL_DEPLOYMENT.md#3-configure-sso-and-the-operator-shell).
SSO configuration and cached login tokens normally belong to that user's home
directory: a login on HPC or as `deeks` does not establish access on v1333 or as
`tsldata`.

Before starting each batch, renew the login and verify the identity:

```bash
export AWS_ARCHIVE_PROFILE=komondor-archive-mover
aws sso login --profile "$AWS_ARCHIVE_PROFILE" --use-device-code --no-browser
aws sts get-caller-identity --profile "$AWS_ARCHIVE_PROFILE" --output json --no-cli-pager
```

Open the displayed URL on the laptop and complete authorization as the archive
SSO user. Check that the returned AWS account and assumed mover role match the
deployment record. Raw `aws` commands do not read the repository `.env`, so the
explicit profile above is required even when archive settings are saved there.
Saved settings do not keep a login valid indefinitely. If it expires during a
batch, log in again under the same Linux user and follow [recovery](#recovery)
for the existing migration. A tmux session protects against SSH disconnects,
not credential expiry.

## Semi-annual procedure

The administrator schedules two manual reviews per year, roughly six months
apart. Record the next due date in the team's operational calendar; this
runbook does not create an automation.

1. **Open a batch record outside the datastore.** Record date, operator/reviewer,
   deployed commits, AWS CLI version, account/role/bucket/base prefix, last
   successful restore rehearsal and the approved selection/deletion policy.
   Use the evidence template below. Confirm a current Mongo backup exists.
2. **Review unfinished migrations first.** In an authenticated Mongo shell for
   the intended database, list `migrating` and `aws_pending_hpc_deletion`
   projects. Run `status` on each and resolve or explicitly carry it forward.
   Never start a second attempt just because the last batch was months ago.
3. **Select candidates with project owners.** Use age as a shortlist, then
   confirm the project is finished, no incoming sequencing/ingest/MD5 work is
   pending, no external jobs write its tree, and it is not under an operational
   hold. Select by ID. This tool does not infer a safe age cutoff.
4. **Renew access and recheck infrastructure.** Complete the
   [batch login check](#before-each-archive-batch), then verify account/role,
   versioning, lifecycle, encryption-key access
   and the datastore mount. Every CLI invocation enforces the AWS checks; an
   infrastructure failure is a stop, never permission to bypass preflight.
   Confirm API/web/Power/Nudge releases still honour archived states. Repeat
   the deployment rehearsal after relevant changes or when the last evidence
   is no longer adequate; perform a representative restore check each batch.
5. **Plan the batch.** Run `plan` for every selected ID and retain the output.
   Review file counts, total bytes, largest file and anomalies. Estimate time
   using measured host throughput, allowing for inventory hashing and HEAD
   checks; a large file may restart from zero. There is no arbitrary TB cap.
   Record owner approval and decisions about unexpected, missing or unreadable
   data before execution. Start with one project; process projects sequentially.
6. **Archive each project** using the next section. Keep its source frozen
   from lock until deletion or an allowed abort. Other projects can keep using
   the API after the short lock window. Save logs, IDs, digests and receipts.
7. **Review pending archives separately.** Observe the recorded review interval,
   inspect the evidence and obtain the designated deletion approval. Only then
   obtain a fresh deletion command, review it and execute it manually. Record
   `confirm-absent` afterwards. Leaving a project pending is valid.
8. **Close the batch.** Reconcile selected IDs against outcomes: `aws`, pending
   review, failed/resumable, or deferred with a reason. Account for any
   exclusions, leftover multipart uploads, retained object versions and costs.
   Check the archived projects in the UI. Save the batch record and next review
   date; ensure a named person owns every unfinished migration.

Useful read-only Mongo queries (the legacy missing state means HPC):

```javascript
db.projects.find(
  { "storage.state": { $in: ["migrating", "aws_pending_hpc_deletion"] } },
  { name: 1, path: 1, storage: 1, archiveMigration: 1 }
)
db.projects.find(
  { $or: [{ "storage.state": "hpc" }, { "storage.state": { $exists: false } }] },
  { name: 1, path: 1, createdAt: 1 }
)
```

A missing/old `createdAt` is not approval. Review the project with its owner.

## Archive one project

### 1. Set identity and inspect the plan

Use the exports and profile configured during deployment and renewed in the
[batch login check](#before-each-archive-batch). The `.env` belongs to this exact
checkout/database; raw `aws` calls require explicit profile arguments. In the
operator shell, set real values:

```bash
export ARCHIVE_PROJECT_ID='REPLACE_WITH_24_HEX_ID'
export ARCHIVE_OPERATOR='REPLACE_WITH_EXISTING_KOMONDOR_USERNAME'
export ARCHIVE_RECORD='/REPLACE/WITH/DURABLE/BATCH/PROJECT_RECORD'
mkdir -p "$ARCHIVE_RECORD"
chmod 700 "$ARCHIVE_RECORD"
aws sts get-caller-identity --profile "$AWS_ARCHIVE_PROFILE"
node scripts/move-project-to-s3.js plan --project-id "$ARCHIVE_PROJECT_ID" > "$ARCHIVE_RECORD/plan.json"
```

Read the output and exit status. Confirm the exact source and S3 destination,
counts, largest file and all anomalies. `plan` inventories structure without
hashing file contents. Do not proceed because a JSON file exists: exit 1 may
mean serious anomalies need review; exit 2 means configuration/preflight failed.
Keep each attempt's evidence in a distinct record directory.

### 2. Quiesce and lock

Stop all API instances and their workers using the recorded deployment service
commands. Drain outstanding requests, ingest and MD5 work. Stop or freeze other
writers to this project's tree (scheduled pipelines, users, manual copies).
A failed readiness probe alone is not proof of quiescence: verify processes and
queues as well. `KOMONDOR_READY_URL` must name the real local API, not an unused
port. The CLI refuses lock if it receives any HTTP response.

Preview the lock, then execute it:

```bash
node scripts/move-project-to-s3.js lock --project-id "$ARCHIVE_PROJECT_ID" --moved-by "$ARCHIVE_OPERATOR"
node scripts/move-project-to-s3.js lock --project-id "$ARCHIVE_PROJECT_ID" --moved-by "$ARCHIVE_OPERATOR" --execute > "$ARCHIVE_RECORD/lock.json"
```

Pass: state `migrating`, phase `locked`, a new migration ID, expected source and
destination. Record that ID as `ARCHIVE_MIGRATION_ID`:

```bash
export ARCHIVE_MIGRATION_ID='REPLACE_WITH_ID_FROM_LOCK'
```

For reviewed serious anomalies, append `--acknowledge-known-anomalies` to both
commands and keep the written decision. Do not use it to bypass an unfinished
job; hard blockers are not overrideable. If lock fails, inspect `status` before
retrying. Restart the compatible API and verify readiness after a successful
lock; this project must now reject writes. Keep external writers frozen.

### 3. Seal, copy and verify

Use a persistent terminal session for a long copy. It may run across renewed
SSO role credentials; an expired login needs the recovery procedure.

```bash
node scripts/move-project-to-s3.js copy --project-id "$ARCHIVE_PROJECT_ID" --moved-by "$ARCHIVE_OPERATOR"
node scripts/move-project-to-s3.js copy --project-id "$ARCHIVE_PROJECT_ID" --moved-by "$ARCHIVE_OPERATOR" --execute > "$ARCHIVE_RECORD/copy.log" 2> "$ARCHIVE_RECORD/copy.stderr"
node scripts/move-project-to-s3.js status --project-id "$ARCHIVE_PROJECT_ID" --json > "$ARCHIVE_RECORD/status.json"
```

Read **both logs and exit status** before continuing. Add
`--acknowledge-known-anomalies` to copy only after reviewing the actual inventory.
The executing copy hashes all regular files, seals its manifest, streams files
through the AWS CLI, verifies each object's full CRC64NVME/size/ownership and
approved storage class, checks the exact key set, and compares the local tree
again. It records a successful verification report before moving to
`aws_pending_hpc_deletion` / `verified`.

Existing complete files are reusable only when they match the sealed manifest.
Resume uploads use the manifest's recorded storage class, even if the shell
setting changed. A mismatch between approved multi-AZ classes is a visible
warning to investigate; ONEZONE_IA, REDUCED_REDUNDANCY and unknown classes fail.
Control manifests stay in Standard. Do not run raw `s3 sync` over this destination.

If an unreadable regular file cannot be recovered, the named data owner must
explicitly approve losing it before exclusion. For each exact relative path,
pass a paired `--exclude-entry 'relative/path' --exclude-reason 'specific reason'`
to copy. The tool only allows exclusions for its supported unreadable-file
errors, records them in the manifest and warns at deletion. Excluded bytes are
**not archived**; deletion removes any remaining local copy. Skipped symlinks
and special files are also not recreated as S3 payload. Review their implications.

Copy exit 3 means a mutation/copy failed; preserve the source and use recovery.
A completed upload alone, a log saying "copied", or old evidence is insufficient
for deletion. Required state is pending deletion with a passing sealed report.

### 4. Review and delete manually

Wait the agreed review interval. Save the source manifest and verification
report using their **exact URIs from status**, with the mover profile. Compare
their SHA-256 values with the digests recorded in status (Linux `sha256sum`, or
macOS `shasum -a 256`). Store them outside the source root. Review exclusions,
class warnings and the batch's restore evidence; for the first real pilot,
verify a representative file's restored bytes before approval.

Immediately before deletion, with the source still frozen:

```bash
node scripts/move-project-to-s3.js deletion-command --project-id "$ARCHIVE_PROJECT_ID" > "$ARCHIVE_RECORD/deletion-command.txt" 2> "$ARCHIVE_RECORD/deletion.stderr"
```

Require exit 0 and review stderr. This command rechecks AWS retention/identity,
the sealed manifests, current object HEADs/key set and local tree. Read its
comments and compare the quoted absolute path with the approved project root.
Run the **single printed `rm -rf -- '…'` command manually**, only after the
recorded approval. Never pipe the output to a shell, execute the output file as
a script, or reuse a command generated days earlier. If source or destination
access changes, preserve the data and recheck.

The tool never removes HPC files. There is a human-controlled interval between
checking and deletion; no writer may change either copy during that interval.
Versioning does not substitute for that operating rule.

### 5. Confirm absence and close this project

```bash
node scripts/move-project-to-s3.js confirm-absent --project-id "$ARCHIVE_PROJECT_ID" --confirmed-by "$ARCHIVE_OPERATOR"
node scripts/move-project-to-s3.js confirm-absent --project-id "$ARCHIVE_PROJECT_ID" --confirmed-by "$ARCHIVE_OPERATOR" --execute > "$ARCHIVE_RECORD/confirmed.json"
node scripts/move-project-to-s3.js status --project-id "$ARCHIVE_PROJECT_ID" --json > "$ARCHIVE_RECORD/final-status.json"
```

Pass: the exact root is absent (even an empty directory is not absent), state
`aws`, phase `completed`. Check that the datastore mount is present: a missing
mount is not proof of deletion. Verify the web display and S3 location. Record
the confirming operator/time and leave the bucket data and manifests intact.
`confirm-absent` records the absence and checks the sealed verification report;
it does not repeat every payload HEAD, and it never restores files.

## Recovery

Start with `status --project-id ID --json` and retain its output. Keep the same
bucket/base prefix and canonical source root used at lock. Every command,
including status, requires working mover credentials and valid bucket retention;
if preflight fails, resolve that before expecting a status report.

| Situation | Action |
| --- | --- |
| Login/credentials expired | Log in to the same profile; then resume the same ID/manifest |
| Source sealed, phase source_sealed/copying/copied | `resume` below; completed files are checked and reused, unfinished files restart at byte zero |
| Locked/inventoried, no sealed manifest and empty destination | Fix the cause and retry copy, or use the allowed pre-copy abort |
| Source changed after sealing | Stop; preserve changed data separately. Restore the original sealed tree if possible, otherwise reviewed cleanup/restart |
| Foreign objects, extra keys or checksum mismatch | Preserve evidence and source; investigate ownership and unintended writers before cleanup |
| Pending deletion but local tree changed | Preserve additions/changes; do not delete them just to make a check green |
| HPC deleted but confirm-absent failed | Restore credentials/mount/database access, then confirm; do not relock or recopy |

Resume:

```bash
node scripts/move-project-to-s3.js resume --project-id "$ARCHIVE_PROJECT_ID" --migration-id "$ARCHIVE_MIGRATION_ID" --resumed-by "$ARCHIVE_OPERATOR"
node scripts/move-project-to-s3.js resume --project-id "$ARCHIVE_PROJECT_ID" --migration-id "$ARCHIVE_MIGRATION_ID" --resumed-by "$ARCHIVE_OPERATOR" --execute
```

A process killed outright, or a host crash, can leave an incomplete multipart
upload because its error cleanup never runs. A successful `resume` verifies the
completed objects; it does not necessarily remove that earlier unfinished
upload. Check `status` and retain its listed upload IDs in the batch record.
The seven-day lifecycle rule cleans abandoned parts. If cleaning sooner, abort
only an exact upload ID whose ownership and stopped writer you have established
from the original job evidence. Do not delete completed objects or another
operator's active upload to tidy a successful migration.

Before sealing only, abort:

```bash
node scripts/move-project-to-s3.js abort-before-copy --project-id "$ARCHIVE_PROJECT_ID" --migration-id "$ARCHIVE_MIGRATION_ID" --aborted-by "$ARCHIVE_OPERATOR" --execute
```

The abort must see zero current destination/control objects and multipart
uploads, and no recorded source digest. It returns the project to HPC. A source
manifest PUT followed by a failed Mongo fence can leave an orphan: retry copy
can adopt it only if the complete manifest bytes match. Otherwise, status shows
the control object for reviewed cleanup; do not overwrite it.

For an irrecoverable sealed attempt, retain its evidence and preserve the local
data first. Status prints cleanup suggestions **only for eligible failed
attempts**. Review every key and ownership classification. Use the separate
cleanup role, adding `--profile YOUR_CLEANUP_PROFILE` explicitly to each raw
AWS command; status deliberately does not choose that role. Never execute the
whole output automatically, widen a prefix, or remove foreign objects merely
to get an empty listing. Move current control records to
`_control/projects/PROJECT_ID/abandoned/OLD_ID/`, hide the reviewed current
payload keys, and abort the exact incomplete upload IDs. Retain versions.
Switch back to the mover role, then:

```bash
node scripts/move-project-to-s3.js restart --project-id "$ARCHIVE_PROJECT_ID" --migration-id "$ARCHIVE_MIGRATION_ID" --restarted-by "$ARCHIVE_OPERATOR"
node scripts/move-project-to-s3.js restart --project-id "$ARCHIVE_PROJECT_ID" --migration-id "$ARCHIVE_MIGRATION_ID" --restarted-by "$ARCHIVE_OPERATOR" --execute
```

Restart requires an empty **current** payload/control prefix and no multipart
uploads; it records a new migration ID and a link to the old attempt. Save the
new ID and run copy. Noncurrent versions may remain in a versioned bucket.
Do not reset storage fields manually or change the archive root to escape a
refusal. The CLI cannot resume a migration sealed with the obsolete
`data/`/`control/` layout under the new layout.

## Restore a real archived file

Restore is a read/recovery activity; it does not return a project to writable
HPC state. Obtain the sealed source manifest from the URI in status and verify
its recorded SHA-256. Select one `disposition: "copy"` entry, copying its exact
`s3Key`, `size` and `sha256`. For a Deep Archive object:

```bash
export ARCHIVE_BUCKET='REPLACE_WITH_BUCKET'
export ARCHIVE_KEY='REPLACE_WITH_EXACT_MANIFEST_KEY'
export ARCHIVE_RESTORE_DIR='/REPLACE/WITH/NEW/RETRIEVAL/DIRECTORY'
mkdir -m 700 "$ARCHIVE_RESTORE_DIR"
aws s3api restore-object --profile "$AWS_ARCHIVE_PROFILE" --bucket "$ARCHIVE_BUCKET" --key "$ARCHIVE_KEY" --restore-request '{"Days":2,"GlacierJobParameters":{"Tier":"Standard"}}'
# Check later; wait for Restore to contain ongoing-request="false":
aws s3api head-object --profile "$AWS_ARCHIVE_PROFILE" --bucket "$ARCHIVE_BUCKET" --key "$ARCHIVE_KEY" --checksum-mode ENABLED
aws s3 cp --profile "$AWS_ARCHIVE_PROFILE" "s3://$ARCHIVE_BUCKET/$ARCHIVE_KEY" "$ARCHIVE_RESTORE_DIR/restored-file" --only-show-errors
sha256sum "$ARCHIVE_RESTORE_DIR/restored-file"
wc -c < "$ARCHIVE_RESTORE_DIR/restored-file"
```

Use `shasum -a 256` instead on macOS. Both hash and byte count must equal the
sealed entry; save the result with the manifest digest and object key. Verify
HEAD ownership metadata against the manifest too. Do not overwrite an existing
source file or infer success from a completed restore request. If the current
object is missing or suspect, stop and have an archive administrator inspect
retained versions against the sealed manifest; never accept a different version
without verifying its identity and bytes. A whole-project restore also needs
path/metadata reconstruction from the manifest and is a separate recovery task.

## Evidence template

Copy into the batch record; fill every applicable field, mark others with a
reason. Do not store secrets, access tokens or connection strings here.

```text
Batch date / next review due:
Operator / reviewer:
Release hashes / host / Node / AWS CLI:
Account / role ARN / bucket / region / base prefix:
Policy: candidate cutoff, owner approval, deletion review interval:
Mongo backup reference / freeze and service commands:
Restore rehearsal date / receipt reference:

Project ID / name / source root / destination:
Owner approval / holds checked:
Plan file count / bytes / largest file / anomalies and decisions:
Migration ID / sealed source SHA-256 / verification SHA-256:
Copy logs / status / class warnings / exclusions:
Restore sample key / SHA-256 / byte count / evidence:
Deletion approval / fresh check time / operator / deletion time:
Confirm-absent result / final state / UI check:
Deferred or failed work / owner / next action:
```
