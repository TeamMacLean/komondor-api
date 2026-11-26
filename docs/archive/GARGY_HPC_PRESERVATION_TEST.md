# Gargy — candidate for George's HPC preservation test

Prepared 13 November; updated 26 November 2026. **Database retention verification
passed in George's supplied output; browser checks remain pending.** The
[evidence](evidence/hpc-retention-20261126/README.md) is a user-supplied read-back,
not a direct agent production check.
George reported the feature and retention follow-up deployed on 16 November
([record](DEPLOYMENT_2026-11-16_RETENTION_FOLLOWUP.md)).

On 26 November George confirmed he had told **Sara one year unless she asks
otherwise**. The saved preserve-through date is **26 November 2027**, inclusive
through 23:59:59.999 UTC. Requested by: **Sara**.
Saved reason: "One year of HPC retention agreed with Sara; retain through
26 November 2027 unless an extension is requested." This replaces the earlier unspecified duration and five-year
suggestion; see the [keep-date decision](HPC_RETENTION.md#keep-dates-to-set-george).

## Exact candidate

| Field | Value |
| --- | --- |
| Project ID | `5fc012bda3efcb29338b7d58` |
| Project | `Gargy-2019_RNAseq` in the production read-back |
| Requested HPC directory | `/tsl/data/reads/two_blades/gargy_2019_rnaseq/` |
| Recorded archive-host root | `/mnt/reads/two_blades/gargy_2019_rnaseq` |
| S3 prefix | `s3://tsl-hpc-reads/two_blades/gargy_2019_rnaseq` |
| Migration ID | `6adb2e0b5f563cce90e74409` |
| Recorded S3 verification | `2026-10-30T20:18:30.550Z` |
| Recorded payload | 59 files, 274,802,985,983 bytes |

Identity comes from the unchanged
[3 November register](evidence/transfer-completion-20261103/completed-project-register-20261103T121635Z.json).
That is historical transfer evidence, not a fresh presence check. The two HPC
mount roots must not be substituted blindly.

Gargy remains in the [manual retention exclusions](HPC_RETENTION.md), independent
of Gulnara. Keep its source tree for the agreed year and preserve the S3
archive. Testing or clearing the date is not deletion approval; expiry permits
fresh manual review only.

## Manual test after deployment

1. Open the project page for the exact ID above as local `admin` (George's
   LDAP/ENA-admin login does not have this permission). Read any existing
   keep date, requester and reason first. Confirm the current deployed versions,
   project identity and both displayed paths. AWS should show its recorded
   verification date. HPC should show a current directory presence observation;
   if it is unknown or absent, investigate before treating the copy as present.
2. Inspect **Preserve on HPC until**, **Requested by** and **Reason** against
   the saved values above. The audited batch already set them; no repeat save
   is needed for this display check. A later deliberate change can test the
   admin save path separately and must be recorded as such.
3. Reload the page. Confirm the saved date persists, both location indicators
   remain independent, and the notice tells users to contact **George Deeks**
   if they need longer HPC retention. The requester and reason must also
   show, and the name is a `mailto:` link if the web
   `HPC_RETENTION_CONTACT_EMAIL` is set.
4. View the same project as a non-admin user who has access. Confirm the date
   and extension notice are visible, and the editing controls are absent.
5. Have the AI/operator inspect the latest Project's `preserveOnHpcUntil` and
   [manual exclusions](hpc-retention-holds.json) during deletion review. The
   deployed feature's native `status --json` also reports `preserveOnHpcUntil`,
   `hpcPreservationActive` and `hpcPreservationInvalid`.
6. If checking the command safeguard, use only the native read-only
   `deletion-command` preparation for this ID. With a future date it must refuse
   and emit **no deletion command**. Do not execute any output, remove files,
   or run `confirm-absent` as part of this test. An unexpected success is a
   failed test to investigate, not permission to delete.
7. Record the actual chosen date, test time, deployed API/web heads and results
   below. Leave the date set after the test. Any later release of the separate
   manual exclusion needs an explicit recorded decision from George.

## Result — database passed; browser checks pending

- Saved preserve-through date (UTC): `2027-11-26T23:59:59.999Z`
- Saved requester/reason: Sara and the exact reason above; verified
- BSON date type: `date`; history entries: 1; matching latest audit: passed
- Database verification evidence supplied: 26 November 2026; exact apply/verification time not present in the output
- API/web deployed heads: latest reported API `48bcd53`, web `284f762`
  (16 November); record the actual running heads when testing
- Admin form save path: not exercised by the mongosh batch; browser reload/display: pending
- Reader-visible notice / no reader editing control: pending
- AWS/HPC location observations: pending
- Optional deletion-command refusal: pending
- Source files and S3 archive retained: required

The feature does not schedule deletion. All future deletions still require fresh
source/S3 verification and George's own manual action.
