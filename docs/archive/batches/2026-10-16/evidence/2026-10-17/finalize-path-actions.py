"""One-time local derivation against the action plan at e98b9d2, after summarize-paths.cjs. No production access."""
import csv,json,pathlib,collections
b=pathlib.Path('docs/archive/batches/2026-10-16')
resolution=json.loads((b/'path-resolutions.json').read_text())
byid={p['entryId']:p for p in resolution['projects']}
p=b/'action-plan.csv'
with p.open(newline='') as f:
 reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
for r in rows:
 if r['entry_id'] in byid:
  v=byid[r['entry_id']];c=v['counts'];r['action']=v['action'];r['needs_acknowledge_known_anomalies']='yes'
  r['why']=f"Read-only content review: {c['a']} same-run resolved; {c['b']} recorded files absent; {c['cResolved']} duplicate/ambiguous cases resolved; {c['cHold']} held. Preserve tree and DB history; no file moves. See PATH_RESOLUTIONS.md."
with p.open('w',newline='') as f:
 w=csv.DictWriter(f,fields,lineterminator='\n');w.writeheader();w.writerows(rows)
assert len(rows)==192 and not any(r['action']=='FIX_PATHS_THEN_ARCHIVE' for r in rows)
p=b/'ACTION_PLAN.md';s=p.read_text()
s=s.replace('**Review checkpoint: BLOCKED pending complete primary hash evidence.** See [PATH_REVIEW_STATUS.md](PATH_REVIEW_STATUS.md). All eight former `FIX_PATHS_THEN_ARCHIVE` rows are now `HOLD_PATH_REVIEW`; do not move files or edit File.path.\n\n','')
s=s.replace('supersedes `FIX_PATHS_THEN_ARCHIVE` with the per-project evidence-based handling\nonce recorded.', 'supersedes `FIX_PATHS_THEN_ARCHIVE` with [the completed per-project content review](PATH_RESOLUTIONS.md).')
s=s.replace('path repairs and empty-record cleanup are done where found;', 'location discrepancies and missing historical files are documented without automatic path repairs; empty-record cleanup follows the scoped proposal;')
old='''| HOLD_PATH_REVIEW | 3 | 7 | 1.15 TB | Content review incomplete; preserve tree and records |
| HOLD_PATH_REVIEW | 4 | 1 | 0.16 TB | Content review incomplete; preserve tree and records |'''
parts=[]
bucket=collections.defaultdict(list)
for r in rows:
 if r['entry_id'] in byid:bucket[(r['action'],r['wave'])].append(r)
for (act,wave),items in sorted(bucket.items()):
 meaning='Preserve tree; seal missing-path facts; retain content review' if act=='ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES' else 'Unresolved content identity; separate decision required before lock'
 parts.append(f"| {act} | {wave} | {len(items)} | {sum(int(r['disk_bytes']) for r in items)/1e12:.2f} TB | {meaning} |")
assert old in s;s=s.replace(old,'\n'.join(parts))
archive_count=sum(r['action'] in ('ARCHIVE','ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES','FIX_RENAME_THEN_ARCHIVE') for r in rows)
holds=sum(r['action']=='HOLD_PATH_AMBIGUITY' for r in rows)
s=s.replace('145 entries have proposed archive-wave assignments; eight more are held pending content review. These are proposed dispositions, not completed archives.',f'{archive_count} entries are assigned to four archive waves without new owner outreach; {holds} additional entries are held for unresolved content identity. These are proposed dispositions, not completed archives.')
s=s.replace('Those are recorded facts about the upload era, not reasons to stop; they are sealed into the manifest.', 'Documented historical metadata anomalies can be acknowledged and sealed into the manifest. Unresolved content identity, active work, changed source trees or unverifiable bytes still stop the affected project; acknowledgement does not waive them.')
start=s.index('1. **Content review and manual cleanup.**');end=s.index('\n2. **Emails',start)
s=s[:start]+'''1. **Review discrepancies and prepare manual cleanup.** Use [PATH_RESOLUTIONS.md](PATH_RESOLUTIONS.md) for all eight projects/110 missing expected paths: preserve the tree and database history, document losses and resolved copies, and hold any unresolved content identity. No File.path repair or raw/ relocation is proposed. The separate Jones root case correction follows the [manual canonical-root procedure](PLACEHOLDER_REGISTRATION.md) and needs its literal command reviewed against fresh evidence. The two empty project cleanups and five Saunders shells use [the exact dependent-record procedure](DEPENDENT_RECORD_CLEANUP.md); George executes only after fresh exports/checks. The two empty unregistered directories (`two_blades/medicago_trucatala___19__pacbio` and `ntalbot/project_946`) require fresh mounted-root inspection and empty-only `rmdir`, never recursive force-deletion.''' + s[end:]
s=s.replace('The five additional directories remain pending.', 'The six existing sheet deletion decisions do not depend on a new reply. The five additional directories remain pending.')
s=s.replace('and costs under a pound per terabyte per month in Deep Archive','and preserves recoverability')
s=s.replace('43 with no file records; missing-path projects remain held pending the content review.', '43 with no file records plus the discrepancy projects released by their content review; held projects remain out of execution.')
s=s.replace('## Classification of the 192 entries', '''The CSV's `hpc_path` preserves the original PowerScale export path. It is not a
shell deletion argument on v1333. Derive and freshly verify the canonical mounted
root from the registered Project or the explicit target ledger before any operation.

Before executing the archive waves, deploy the separately reviewed release that
includes the corrected `db-file-missing` / `recordKind` diagnostic. The read-only
evidence was collected against production `c6b9d77`; this review has not deployed
the branch or changed the production checkout. Do not expect the old release to
emit the corrected manifest anomaly labels.

## Classification of the 192 entries''')
p.write_text(s)
p=b/'README.md';s=p.read_text();marker='## What the production review establishes';s=s.replace(marker,'''## October 17 content-resolution evidence

[PATH_RESOLUTIONS.md](PATH_RESOLUTIONS.md) and [path-resolutions.json](path-resolutions.json)
record the eight-project, 110-path content review and explicitly identify any holds.
They supersede size-only relocation suggestions. The October 16 findings below remain
historical metadata observations, not checksum evidence. Nothing was moved or deleted.

'''+marker);p.write_text(s)
print('Updated 192-row plan; archive wave assignments:',archive_count,'content holds:',holds)

# Make the older entry point explicitly historical where policy/evidence moved on.
p=pathlib.Path('docs/HPC_ARCHIVE_CANDIDATES_2026-10-16.md');s=p.read_text()
s=s.replace('**Current decision table:** [192 original entries with owner/contact, decision and finding](archive/batches/2026-10-16/README.md).', '''**Current execution proposal (17 October):** [ACTION_PLAN.md](archive/batches/2026-10-16/ACTION_PLAN.md)
and its [192-row decision CSV](archive/batches/2026-10-16/action-plan.csv).
The [original source decision table](archive/batches/2026-10-16/README.md) remains historical evidence;
its waiting/age labels do not override the settled policy or later content review.''')
s=s.replace('Dan’s three exports contain 156 entries: Two Blades 48, Jones 56 and Talbot 52. All remain earmarked,\nawaiting group decisions.', '''Dan’s three exports contain 156 entries: Two Blades 48, Jones 56 and Talbot 52.
George has settled archive consent for those exports by the prior notice/silence policy.
Only discrepancies receive new outreach with a deadline; no age cutoff applies to this batch.
The older CSV's `AWAITING_GROUP_DECISION` labels are preserved import history, not current holds.''')
s=s.replace('## Specific directories requiring decisions', '''## Later evidence and current handling

[The October 17 content review](archive/batches/2026-10-16/PATH_RESOLUTIONS.md)
supersedes size-only relocation suggestions for all eight projects / 110 expected paths.
Preserve the trees and historical records; do not repair File.path or move files into raw/.
Its per-record decisions state original-checksum matches, missing-checksum limitations,
duplicate comparisons and gzip payload evidence. A fresh live plan is still required.

[Corrected diagnostic reports](hpc-verification-2026-10-16/corrected-diagnostics/verify-jjones.json)
and the other three group files in that directory derive `db-file-missing` plus `recordKind`
from the original observations. The 110 corrected labels change no numeric totals or
source decisions. The raw October 16 reports remain untouched.

The current [Kamoun target ledger](archive/batches/2026-10-16/KAMOUN_DELETE_TARGETS.md),
[dependent-record proposal](archive/batches/2026-10-16/DEPENDENT_RECORD_CLEANUP.md) and
[placeholder procedure](archive/batches/2026-10-16/PLACEHOLDER_REGISTRATION.md) govern
the manual follow-up below. Six sheet delete decisions stand; five extra Saunders
directories await answers. Fresh exact-target checks remain necessary before deletion.

## Historical directory findings and follow-up identified on October 16''')
s=s.replace('## Missing registered paths','## Missing registered paths observed on October 16')
s=s.replace('## Owner follow-up\n\nFilter the CSV by `AWAITING_GROUP_DECISION` for the 156 unaudited entries. Each row includes the source owner,\ndatabase owner, available contact email, a specific owner question and technical follow-up.\nGroup administrators must confirm contacts for missing/outdated owner records. No addresses were guessed\nfrom usernames. Also ask Kamoun about exact Saunders directory identities and the five additional directories.\nExisting KEEP decisions need no archival outreach. Technical findings on KEEP entries are retained for completeness.', '''## Current discrepancy follow-up

Use the action plan's `CONTACT_DEADLINE` rows: 17 Talbot directories and Courville,
plus the separate five pending Saunders directories in the Kamoun ledger. Do not
send a new approval request for every `AWAITING_GROUP_DECISION` row in the historical
CSV. George must supply the Talbot and Two Blades group-administrator addresses;
available source/database contacts are not proof of current responsibility.
Six existing Kamoun delete decisions do not depend on a new reply. Nothing is
deleted on silence, and all later deletion remains a separate manual checkpoint.
KEEP decisions need no archival outreach. No owner messages were sent by this review.''')
p.write_text(s)
p=b/'README.md';s=p.read_text();s=s.replace('## Decision table\n\nEach row below corresponds to one original entry.', '''## Historical source decision table

Each row below corresponds to one original entry. Imported waiting labels below are
superseded by [the current action CSV](action-plan.csv); use that CSV for execution
and discrepancy outreach.''');p.write_text(s)
