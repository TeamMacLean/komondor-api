# Initial archive migration coverage on 30 October 2026

**The initial migration covers 175 of 366 Komondor Project records: 47.8%, or roughly half.**
This is the share of database project records selected for the batch. It is not
the percentage of bytes uploaded, upload completion, or HPC data deleted.

## Production snapshot

George supplied the output of a read-only `mongosh` query on 30 October 2026.
The [saved project ID and storage-state pairs](evidence/release-planning-20261030/project-storage-states.json)
contain 366 distinct IDs. The query maps missing/null storage state to legacy `hpc`.
An exact capture time was not supplied.

| Storage state | Projects | Share of all records |
| --- | ---: | ---: |
| `aws_pending_hpc_deletion` | 163 | 44.5% |
| `migrating` | 12 | 3.3% |
| `hpc` | 190 | 51.9% |
| `aws` | 1 | 0.3% |
| **Total** | **366** | **100.0%** |

For this snapshot, the 163 verified projects plus the 12 migrating/queued projects
are the 175-project batch: `175 / 366 * 100 = 47.8142%`. The sole `aws` record,
`6ad24adfe34eae4923a3cda4`, is the [disposable archive rehearsal](STAGE3_APPLICATION_REHEARSAL_2026-10-16.md).
The denominator includes retained hidden/test records; it is not a count of only
scientific projects visible on the website. Storage state does not prove whether
an HPC directory is physically present.

## How the scope reached 175 projects

The [17 October action plan at commit `c0b8f66`](https://github.com/TeamMacLean/komondor-api/blob/c0b8f66/docs/archive/batches/2026-10-16/action-plan.csv)
contains 153 distinct registered project IDs selected for archive. All 153 occur
in the supplied snapshot in `migrating` or `aws_pending_hpc_deletion` state.

The later production reconciliation added 22 registrations: 16 Talbot numeric
directories, Two Blades `Courville`, and five additional Saunders directories
selected for preservation. One of the original 17 proposed Talbot registrations
was consolidated into an existing project, so it did not add a Project record.
These additions bring the scope to **153 + 22 = 175** distinct projects.

This later scope is recorded in the **Deploy AWS features** chat
(`01a167c9-d4ad-7351-a34f-f991caf86f3c`), which reports the 22 October reconciliation
in `reconciliation-production-2026-10-22/OUTCOMES.json` and the 23 October queue
construction: 174 bulk projects plus one real-project pilot. Those production
artifacts are referenced by that chat and are not copied into this checkout.
The scope reconciliation covers project selection and database IDs; it is not
an independent audit of every S3 object.

Selection follows the supplied Dan/Kamoun lists and the later agreed tidying
decisions. It is not a universal automatic five-year rule. The `plus5years`
exports concern old directory timestamps, which do not establish the age of
every contained file or scientific completion. KEEP and separate disposal
decisions remain distinct. HPC deletion is a separate manual review and action;
batch inclusion or a verified upload does not trigger automatic deletion.

## Refresh the database counts

Run this read-only query in the intended production database. Reconcile the
current selected IDs with the current batch record before updating its numerator;
storage-state counts alone do not identify every future selected project.

```javascript
db.projects.aggregate([
  { $group: { _id: { $ifNull: ["$storage.state", "hpc"] }, projects: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]).toArray();
```
