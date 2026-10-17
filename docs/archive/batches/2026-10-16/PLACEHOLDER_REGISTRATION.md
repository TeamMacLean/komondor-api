# Placeholder registration and canonical roots

Proposal only. No project has been created and no directory has been moved by this
review. Apply after the discrepancy email's recorded deadline or an explicit archive
reply, following [ACTION_PLAN.md](ACTION_PLAN.md). **George must supply the Talbot
and Two Blades group-administrator email addresses: neither is in the register.**
Do not substitute `tsldata` for a deliverable address or send outreach automatically.

## Seventeen Talbot directories

[placeholder-projects.json](placeholder-projects.json) supplies all 17 exact payloads,
source paths, entry IDs and expected generated paths. The group IDs were read from
production on 17 October: [group evidence](evidence/2026-10-17/registration-groups.json)
and [command receipt](evidence/2026-10-17/registration-groups.command.json).
Verify the IDs and group safe names again immediately before creation.

One authenticated `POST /projects/new`, with JSON content type, has this shape:

```json
{
  "group": "5fc012bda3efcb29338b7cf2",
  "name": "project_1566",
  "shortDesc": "Archive batch 2026-10-16: existing unregistered directory project_1566",
  "longDesc": "Placeholder for the existing ntalbot/project_1566 tree; source entry ntalbot-037. Original data ownership is not established by this administrative registration. Preserve the batch decision, inventory and correspondence as provenance.",
  "nudgeable": false,
  "doNotSendToEna": true,
  "doNotSendToEnaReason": "Administrative archive placeholder; no ENA submission is authorized by this registration."
}
```

The other 16 payloads use their exact `project_*` directory spelling as `name`.
These names already normalize to themselves. Do not supply `path`, `safeName`,
`owner`, file uploads or invented Sample/Run/Read metadata. The route derives owner
from the authenticated operator, path from group and normalized name, and starts
at `storage.state=hpc`. It also creates a directory/NewsItem and attempts an overseer
email: creation is a production write and must be a deliberate later operator step.
Test notifications must go only to **deeks@nbi.ac.uk** via the reviewed notification
configuration; there is no recipient override in this POST payload. `nudgeable:false`
does not suppress the overseer email.

For **each** directory, George:

1. Confirms the approved entry/deadline, live group ID, real mounted source root and
   fresh recursive inventory. Rejects symlinks and unexpected changes. Confirms no
   Project already claims that path. Checks global `safeName` collisions (not only
   this group), because collisions generate a numeric suffix.
2. Records the request body and operator. Creates exactly one project using the payload.
   A timeout is an unknown outcome: inspect the database before any retry to avoid
   creating a second placeholder with a suffixed name.
3. Requires HTTP 201 and retains the returned Project ID, group, `safeName`, `path`
   and storage state. Reads that Project back. **The returned path must equal the
   existing directory's datastore-relative path exactly**, e.g.
   `/ntalbot/project_1566`, with canonical root `/mnt/reads/ntalbot/project_1566`.
   A generated `_2`, unexpected group or different case is a STOP, not a new archive
   target. Leave both trees intact and review how to undo the new metadata.
4. Checks the original directory identity and full inventory are unchanged after POST,
   including files omitted from the database. Records mapping original entry → new
   Project ID → canonical root, plus request/response and inventory hashes.
5. Runs a **fresh live archive `plan` on that ID**, inspects all anomalies and inventory,
   then follows the normal writer freeze/lock/copy/verification procedure. Registration
   grants CLI access to this tree; it does not itself prove archive safety.

## Courville: manual case normalization

Source is `/mnt/reads/two_blades/Courville` (100 files, 298,805,448,427 bytes in the
October 16 observation). `POST /projects/new` with `name:"Courville"` and Two Blades
group `5fc012bda3efcb29338b7cf3` generates `/two_blades/courville` if collision-free.
The payload is also in [placeholder-projects.json](placeholder-projects.json).
**Do not archive the newly generated empty lowercase directory.**

This is a reviewed procedure for George's later manual maintenance window; the literal
filesystem command must be prepared against fresh paths and reviewed before execution:

1. Inventory and identify the uppercase source, verify the live mount and no symlink
   components; confirm lowercase destination does not exist and no database Project
   or global safeName collision exists. Confirm no external writer uses either spelling.
2. Create the placeholder while the API is available. Require exactly
   `/two_blades/courville` in the returned and read-back Project, and verify its newly
   created root is empty. A different generated path stops the procedure.
3. Freeze all API/Power/external writers. Capture fresh source and empty destination
   inventories and filesystem identities. Both directories must be on the same filesystem;
   no source file may have changed since the reviewed inventory.
4. Manually remove **only the confirmed new empty lowercase root with `rmdir`**, then
   rename the uppercase source to the exact lowercase path using a same-filesystem
   rename operation. Require the destination still absent at rename time and exclusive
   writer control. Do not copy then delete, merge trees, overwrite a destination, or use
   `mv source existing-directory` (which can nest the entire source).
5. The renamed tree must retain the original root device/inode and all descendant
   paths, types, file sizes, mtimes and file identities. Root ctime may change from the
   rename. Check both absence of the uppercase path and presence of the full original
   inventory at lowercase path, then check the Project still points there. Record old
   and new canonical paths and the complete before/after evidence.
6. If rename or verification fails, stop with writers frozen; inspect the actual paths.
   Do not invent file records or delete unexpected data to complete the step. After
   success, run a fresh live `plan` and the normal archive checkpoints before any lock.

Five additional Saunders directories, if they receive archive decisions or reach the
silence deadline, require equivalent reviewed handling of their generated normalized
roots; their mixed case and punctuation must not be assumed to survive normalization.
The already registered Jones case mismatch is a separate manual root correction:
`/mnt/reads/jjones/witekk_s_americanum_gDNA_bgi` →
`/mnt/reads/jjones/witekk_s_americanum_gdna_bgi`. It needs the same fresh identity,
empty/absent destination and unchanged-tree checks, but **no placeholder POST**.
