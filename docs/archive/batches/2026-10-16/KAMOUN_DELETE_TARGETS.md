# Kamoun direct-disposal targets

Proposal for George, 17 October 2026. Nothing has been removed. The six original
sheet decisions remain delete without an S3 copy. The five additional directories
are a separate pending set, not five more approved deletions. All counts below
are the 16 October read-only observations and must be refreshed before execution.
Machine-readable targets: [kamoun-delete-targets.json](kamoun-delete-targets.json).

## 1. Five Saunders directories associated with sheet rows

Delete only the mixed-case data directory named below after confirming its
association with the approved sheet row. The empty lowercase registered shell
is a different directory. Do not substitute that shell for the data target.

| Entry | Canonical data target on v1333 | Files | Bytes |
|---|---|---:|---:|
| `skamoun-002` | `/mnt/reads/skamoun/saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130227.01` | 260 | 48,614,994,012 |
| `skamoun-003` | `/mnt/reads/skamoun/saunderd_pstriiformis_South_African_isolates` | 24 | 109,802,811,903 |
| `skamoun-005` | `/mnt/reads/skamoun/saunderd_pstriiformis_TSL.DS.20130516.01_TCS_68` | 106 | 72,013,629,033 |
| `skamoun-015` | `/mnt/reads/skamoun/saunderd_pstriiformis_Project_GEL139_ClareLewis_JIC.CL.20121001.01` | 641 | 239,985,996,303 |
| `skamoun-016` | `/mnt/reads/skamoun/saunderd_pstriiformis_TSL.DS.20130626.01_TCS_83` | 124 | 158,139,688,071 |

Total: **628,557,119,322 bytes**. The ledger also records each associated shell's
Project ID and exact lowercase path. Removing the Project alone is prohibited:
each has a Sample and at least one Run. Use the dependent-record proposal and
retain the complete pre-deletion document export before database cleanup.

## 2. Xiao_SCR74 is a separate populated project

| Entry | Canonical data target on v1333 | Files | Bytes |
|---|---|---:|---:|
| `skamoun-013` | `/mnt/reads/skamoun/xiao_scr74` | 62 | 161,447,455,740 |

Project ID: `5fc012bda3efcb29338b7d7a`. The observation includes **4 Samples,
4 Runs, 8 Reads and 1 AdditionalFile**. This is a lowercase registered project,
not a Saunders shell. Its Files, IngestJobs and NewsItems must also be enumerated.
After the approved physical deletion, use the reviewed dependent-record procedure
to remove the exact associated records, with the exported documents and disposal
receipt retained outside the project. Do not set `storage.state=aws` or invent an
S3 URI: this decision explicitly has no archive copy. Do not leave an apparently
live HPC project with missing Reads. Keep services/writers frozen until the
reviewed metadata cleanup is complete; if cleanup fails, record the partial
outcome and resolve it before reopening this project's write paths.

The six sheet deletes total **790,004,575,062 bytes**.

## 3. Five additional Saunders directories awaiting Kamoun's answer

These supplementary IDs do not add rows to the original 192-entry register.
The first email asks for a decision on each exact directory. An explicit delete
reply must be recorded against its target before it joins the deletion list.
On silence after the recorded deadline, register and archive; never delete
without an archive on silence. Any later HPC deletion follows normal archive
verification and its separate manual checkpoint. Mixed-case registration uses
the same reviewed canonical-root handling as Courville, not an assumed path.

| Supplementary entry | Canonical data target on v1333 | Files | Bytes |
|---|---|---:|---:|
| `skamoun-extra-001` | `/mnt/reads/skamoun/saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130409.01` | 268 | 65,286,846,255 |
| `skamoun-extra-002` | `/mnt/reads/skamoun/saunderd_pstriiformis_TCS_DianeSaunders_TSL.DS.20130809.01_113` | 38 | 32,165,487,135 |
| `skamoun-extra-003` | `/mnt/reads/skamoun/saunderd_pstriiformis_TSL.DS.20130722.01_TCS_99` | 16 | 6,156,498,502 |
| `skamoun-extra-004` | `/mnt/reads/skamoun/saunderd_pstriiformis_TSL.DS.20130730.01_TCS_105` | 34 | 41,786,044,848 |
| `skamoun-extra-005` | `/mnt/reads/skamoun/saunderd_pstriiformis_TSL.DS.20131010.01rev2_1x_Rapid_Lane_TCS_144` | 64 | 27,554,681,601 |

Total pending: **172,949,558,341 bytes**. All ten Saunders directories total
**801,506,677,663 bytes**. Six sheet deletes plus these five pending directories
would be **962,954,133,403 bytes** if all five receive explicit delete decisions;
that combined size is not deletion permission.

## Manual checkpoint immediately before each deletion

George checks a **fresh inventory of the exact canonical target against its
approved record**. Save the inventory and approval reference to this batch's
evidence folder outside `/mnt/reads`. Verify the real reads mount is present,
the target is a directory below `/mnt/reads/skamoun/` with no symlinked path
component, and its exact case, files and total bytes match the reviewed target.
Record a recursive path/type/size/mtime inventory and the target's filesystem
identity; inspect any difference and obtain a reviewed replacement record rather
than accepting changed contents automatically. A missing mount is not an empty
directory. Confirm no writer or unresolved external database reference uses this
tree; the dependent-record check must be complete first.

Freeze writers and keep that evidence current through the manual deletion.
Delete one exact, quoted approved path at a time: no glob, prefix matching or
recursive removal of the group root. The archive CLI's `deletion-command` does
not apply to direct disposal. Record operator, UTC time, entry ID, literal path,
approval, inventory hash and observed outcome. Remove an associated empty shell
with `rmdir` only after inspecting its nested empty directories; never use a
recursive force-delete to make an unexpected shell look empty.
