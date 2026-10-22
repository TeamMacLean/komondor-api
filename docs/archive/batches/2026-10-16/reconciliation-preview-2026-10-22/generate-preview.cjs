// Offline evidence analysis only. This file never connects to MongoDB, SSH or S3.
// It writes derived reports only in this directory; source observations are immutable.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const batch = path.resolve(__dirname, '..');
const repo = path.resolve(batch, '../../../..');
const provenance = [];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function source(filename) {
  const bytes = fs.readFileSync(filename);
  provenance.push({path: path.relative(repo, filename), sha256: digest(bytes)});
  return JSON.parse(bytes);
}
function write(name, value) {
  fs.writeFileSync(path.join(__dirname, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
const counts = (rows, key) => rows.reduce((out, row) => {
  const value = typeof key === 'function' ? key(row) : row[key];
  out[value] = (out[value] || 0) + 1;
  return out;
}, {});
const md = value => String(value ?? 'unknown').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
const policy = source(path.join(__dirname, 'policy.json'));
const ownership = source(path.join(__dirname, 'ownership-decisions.json'));
const register = source(path.join(batch, 'register.json'));
const resolutions = source(path.join(batch, 'path-resolutions.json'));
const targets = source(path.join(batch, 'kamoun-delete-targets.json'));
const reports = Object.fromEntries(['two_blades', 'jjones', 'ntalbot', 'skamoun'].map(group => [group,
  source(path.join(repo, 'docs/hpc-verification-2026-10-16/corrected-diagnostics', `verify-${group}.json`))]));
assert.equal(register.entries.length, 192);
assert.equal(new Set(register.entries.map(e => e.entry_id)).size, 192);
assert.equal(targets.additional_pending.length, 5);

const knownCandidatePaths = new Map();
const locations = resolutions.projects.flatMap(project => project.records.map(record => {
  const prefix = project.projectPath.replace(/^\//, '') + '/';
  const stored = String(record.storedFilePath || '').replace(/^\//, '');
  const storedRelative = stored.startsWith(prefix) ? stored.slice(prefix.length) : null;
  const matchingStored = record.candidates.find(c => c.relPath === storedRelative);
  const proposed = matchingStored || (record.candidates.length === 1 ? record.candidates[0] : null);
  for (const candidate of record.candidates) {
    const key = `${project.entryId}|${candidate.relPath}`;
    const refs = knownCandidatePaths.get(key) || [];
    refs.push({readId: record.readId, fileId: record.fileId});
    knownCandidatePaths.set(key, refs);
  }
  return {
    entryId: project.entryId, projectId: project.projectId,
    readId: record.readId, fileId: record.fileId, runId: record.runId,
    previousExpectedRelativePath: record.expectedRelPath,
    previousStoredFilePath: record.storedFilePath,
    proposedPhysicalFilePath: proposed ? project.projectPath + '/' + proposed.relPath : null,
    proposal: matchingStored ? 'use-existing-stored-path' : proposed ? 'correct-stored-path-after-live-check' : 'retain-all-candidates-unresolved',
    proposedFileMoves: [], changeReadOrRunIdentity: false,
    preserveAllCandidatePaths: record.candidates.map(c => c.relPath),
    evidence: {observedFrom: resolutions.observedFrom, observedTo: resolutions.observedTo,
      source: '../path-resolutions.json', checksumsArePreviousObservations: true,
      candidates: record.candidates.map(c => ({relPath: c.relPath, bytes: c.bytes, md5: c.md5, sha256: c.sha256}))},
    currentChecksum: null, freshIdentityAndContentCheckRequired: true,
    executionStatus: 'proposal-only',
  };
}));
assert.equal(locations.length, 110);

const projects = register.entries.map(entry => {
  const review = entry.production_review;
  const observedProject = reports[entry.group].projects.find(p => p.projectId === entry.project_id);
  const inventory = reports[entry.group].unregisteredInventories.find(p => p.path === review.observed_data_directory);
  const approvedTarget = targets.approved_saunders.find(t => t.entry_id === entry.entry_id);
  let disposition = 'archive';
  if (entry.disposition === 'keep_on_hpc') disposition = 'keep';
  else if (entry.disposition === 'delete_without_archive_requested') disposition = 'existing-approved-direct-disposal';
  else if (review.verdict === 'EMPTY') disposition = 'retire-records-retain-history';
  else if (review.verdict === 'UNREGISTERED_EMPTY') disposition = 'record-empty-directory';
  const owner = review.db_owner || null;
  const registration = disposition === 'archive' && !entry.project_id;
  return {
    entryId: entry.entry_id, originalEntry: true, group: entry.group, name: entry.source_name,
    projectId: entry.project_id, disposition,
    registeredPath: review.registered_path,
    observedPhysicalRoot: approvedTarget?.canonical_target || review.observed_data_directory || review.registered_source_root,
    expectedFileCount: approvedTarget?.files ?? review.metrics.observedDirectoryFiles ?? review.metrics.diskRegularFiles ?? null,
    expectedBytes: approvedTarget?.bytes ?? review.metrics.observedDirectoryBytes ?? review.metrics.diskBytes ?? null,
    lastObservationAt: review.observed_at, liveRevalidated: false,
    owner: {existingDatabaseOwner: owner, existingSecondaryOwner: review.db_secondary_owner || null,
      exportOwner: entry.source_values.owner || null,
      proposedIdentifier: owner || entry.source_values.owner || null,
      evidence: owner ? 'existing-project-owner' : 'original-filesystem-export-owner',
      scientificOwnershipInferred: false, replaceExistingOwner: false,
      observedDirectoryUid: inventory?.directoryUid ?? null},
    needsProjectRegistration: registration,
    proposedRegistration: registration ? 'register-existing-tree-retain-legacy-owner-identifier-and-physical-root' : null,
    checksumAction: disposition === 'archive' ? 'observe-current-physical-bytes-preserve-legacy-gap' : 'outside-reconciliation-change-scope',
    checksumResult: null,
    reportedUntrackedPaths: review.metrics.diskFilesNotInDb || 0,
    reportedMissingExpectedPaths: review.metrics.dbRecordsMissingOnDisk || 0,
    reportedMissingDestinationChecksums: review.metrics.anomalyKinds?.['read-destination-md5-missing'] || 0,
    dbSamples: observedProject?.dbSamples ?? null, dbRuns: observedProject?.dbRuns ?? null,
    dbReads: observedProject?.dbReads ?? null, dbAdditionalFiles: observedProject?.dbAdditionalFiles ?? null,
    locationProposalCount: locations.filter(p => p.entryId === entry.entry_id).length,
    retirementProposal: ['retire-records-retain-history', 'existing-approved-direct-disposal'].includes(disposition)
      ? 'retain-project-and-dependent-records-with-provenance; never-mark-as-aws-without-an-archive' : null,
    ownerContactRequired: false, humanDispositionDecisionOutstanding: false,
    executionStatus: 'proposal-only',
  };
});
for (const target of targets.additional_pending) projects.push({
  entryId: target.entry_id, originalEntry: false, group: 'skamoun', name: path.posix.basename(target.canonical_target),
  projectId: null, disposition: 'archive', registeredPath: null, observedPhysicalRoot: target.canonical_target,
  expectedFileCount: target.files, expectedBytes: target.bytes, lastObservationAt: targets.inventory_observed_at,
  liveRevalidated: false,
  owner: {existingDatabaseOwner: null, existingSecondaryOwner: null, exportOwner: null, proposedIdentifier: null,
    evidence: 'legacy-identifier-lookup-pending; do-not-infer-owner-from-saunderd-prefix', scientificOwnershipInferred: false, replaceExistingOwner: false},
  needsProjectRegistration: true, proposedRegistration: 'register-existing-tree-preserve-legacy-identity-when-established',
  checksumAction: 'observe-current-physical-bytes-preserve-legacy-gap', checksumResult: null,
  reportedUntrackedPaths: null, reportedMissingExpectedPaths: null, reportedMissingDestinationChecksums: null,
  dbSamples: null, dbRuns: null, dbReads: null, dbAdditionalFiles: null, locationProposalCount: 0,
  retirementProposal: null, ownerContactRequired: false, humanDispositionDecisionOutstanding: false,
  executionStatus: 'proposal-only', decisionAuthority: 'policy.json: additionalSaundersDecision',
});
assert.equal(new Set(projects.map(p => p.entryId)).size, 197);
assert.equal(policy.checksumPolicy.separateBulkSweep, false);
for (const project of projects) {
  if (project.disposition === 'archive') project.checksumAction = 'normal-archive-manifest-and-upload-verification; no-separate-bulk-audit-sweep; preserve-legacy-gap';
  if (!project.needsProjectRegistration) continue;
  const decision = ownership.registrations.find(r => r.entryId === project.entryId);
  assert(decision, `Missing owner decision: ${project.entryId}`);
  assert.equal(decision.physicalRoot, project.observedPhysicalRoot);
  project.owner = {...project.owner, proposedIdentifier: decision.proposedCatalogueOwner,
    proposedRole: decision.ownerRole, evidence: 'ownership-decisions.json#'+project.entryId,
    observedUnixOwner: decision.observedUnixOwner, originalScientificOwner: null,
    scientificOwnershipInferred: false, replaceExistingOwner: false};
  project.proposedRegistration = 'register-existing-tree-with-reviewed-custodian; preserve-physical-root-and-legacy-provenance';
}
assert.equal(ownership.registrations.length, projects.filter(p=>p.needsProjectRegistration).length);
const projectById = new Map(projects.map(p => [p.entryId, p]));

function classify(relPath, existingReferences) {
  if (existingReferences.length) return 'existing-read-location-candidate';
  const name = path.posix.basename(relPath).toLowerCase();
  if (/(?:\.(?:md5|sha1|sha256|sha512)(?:sum)?(?:\.txt)?|^(?:md5|sha1|sha256|sha512)(?:sums?|checksums?)(?:\.txt)?)$/.test(name)) return 'checksum-file-candidate';
  if (/\.(?:fastq|fq)(?:\.gz|\.bz2|\.txt)?$/.test(name)) return 'fastq-candidate';
  if (/\.(?:fasta|fa|fna|fas|sff|bam|cram|h5|fast5|pod5)(?:\.gz|\.bz2)?$/.test(name)) return 'other-sequence-data-candidate';
  if (/\.(?:xml|json|csv|tsv|txt|log|pdf|html|htm|xlsx|xls|doc|docx|png|jpg|jpeg|svg|r|sh|py|pl|gff|gff3|gtf|bed|bai|fai)$/.test(name)) return 'supporting-file-candidate';
  return 'unclassified-preserve';
}
const files = [];
for (const entry of register.entries) {
  const observed = reports[entry.group].projects.find(p => p.projectId === entry.project_id);
  const reported = observed?.diskFilesNotInDb || [];
  assert.equal(reported.length, entry.production_review.metrics.diskFilesNotInDb || 0, `Incomplete path list for ${entry.entry_id}`);
  for (const relPath of reported) {
    assert(!path.posix.isAbsolute(relPath) && !relPath.split('/').some(p => p === '..' || p === '.' || !p));
    const refs = knownCandidatePaths.get(`${entry.entry_id}|${relPath}`) || [];
    const category = classify(relPath, refs);
    const project = projectById.get(entry.entry_id);
    const parts = relPath.split('/');
    const zones = parts.map((p,i) => ['raw','processed','additional','fastqc'].includes(p) ? i : -1).filter(i=>i>=0);
    const zone = zones.length === 1 ? zones[0] : null;
    const parentHint = zone !== null ? parts.slice(0,zone).join('/') : null;
    const inScope = project.disposition === 'archive';
    files.push({entryId: entry.entry_id, projectId: entry.project_id, relPath,
      proposedClass: category, classificationBasis: 'filename-and-directory-plus-prior-location-evidence; not-content-validation',
      existingRecordReferences: refs, parentPathHint: parentHint,
      parentRecordMatch: 'not-established-from-saved-summary', scientificMetadataInferred: false,
      proposal: !inScope ? 'no-reconciliation-change' : refs.length ? 'link-existing-record-preserve-all-copies'
        : category === 'checksum-file-candidate' ? 'register-supporting-checksum-file-without-adopting-legacy-digest'
        : category === 'supporting-file-candidate' ? 'register-supporting-file-after-content-and-parent-check'
        : 'catalogue-as-unclassified-until-supported-by-content-and-parent-evidence',
      inReconciliationScope: inScope, currentChecksum: null,
      previousObservationAt: entry.production_review.observed_at, freshObservationRequired: true,
      proposedFileMove: null, executionStatus: 'proposal-only'});
  }
}
assert.equal(files.length, 11626);
assert.equal(new Set(files.map(f=>`${f.entryId}|${f.relPath}`)).size, files.length);
const scopedFiles = files.filter(f=>f.inReconciliationScope);
const checksumGaps = projects.filter(p=>p.reportedMissingDestinationChecksums > 0);
const previousReads = new Map();
for (const p of resolutions.projects) for(const r of p.records) for(const c of r.candidates) previousReads.set(`${p.entryId}|${c.relPath}`, c);
const summary = {
  preparedOn: '2026-10-22', mode: 'offline-read-only-preview', sourceObservationDates: ['2026-10-16','2026-10-17'],
  liveInspection: 'pending-SSH-authentication', productionWrites: false, productionCodeChanges: false,
  currentChecksumsCalculatedThisPreview: 0, currentChecksumsStoredInDatabase: 0,
  originalEntries: 192, supplementaryEntries: 5, totalEntries: projects.length,
  dispositionCounts: counts(projects,'disposition'), originalDispositionCounts: counts(projects.filter(p=>p.originalEntry),'disposition'),
  projectRegistrationsProposed: projects.filter(p=>p.needsProjectRegistration).length,
  originalOwnerEnquiriesRemoved: 18, ownerEnquiriesOutstanding: 0, humanDispositionDecisionsOutstanding: 0,
  humanTechnicalDecisionsOutstanding: 'not-yet-quantifiable; fresh file/parent matching is required; unclassified preservation is accepted',
  observedUntrackedPathCount: files.length, observedUntrackedProjectCount: new Set(files.map(f=>f.entryId)).size,
  untrackedClassificationCounts: counts(files,'proposedClass'),
  archiveScopeUntrackedPathCount: scopedFiles.length, archiveScopeUntrackedProjectCount: new Set(scopedFiles.map(f=>f.entryId)).size,
  archiveScopeClassificationCounts: counts(scopedFiles,'proposedClass'),
  archiveScopeFastqProjectCount: new Set(scopedFiles.filter(f=>f.proposedClass==='fastq-candidate').map(f=>f.entryId)).size,
  missingDestinationChecksumProjectsAllDecisions: checksumGaps.length,
  missingDestinationChecksumRecordsAllDecisions: checksumGaps.reduce((n,p)=>n+p.reportedMissingDestinationChecksums,0),
  missingDestinationChecksumProjectsArchiveScope: checksumGaps.filter(p=>p.disposition==='archive').length,
  missingDestinationChecksumRecordsArchiveScope: checksumGaps.filter(p=>p.disposition==='archive').reduce((n,p)=>n+p.reportedMissingDestinationChecksums,0),
  locationProposals: counts(locations,'proposal'), locationRecords: locations.length,
  priorLocationCandidatePaths: previousReads.size,
  priorLocationCandidateByteSum: [...previousReads.values()].reduce((n,c)=>n+c.bytes,0),
  fileLevelCoverage: 'Only the reported untracked paths and 110 investigated Read records are individually listed. All other registered files, the 23 proposed registrations, and unreadable/missing/new paths require a fresh full inventory and database association collection. No project is declared execution-ready.',
};
assert.equal(summary.dispositionCounts.archive,176);
assert.equal(summary.originalDispositionCounts.archive,171);
assert.equal(summary.projectRegistrationsProposed,23);
assert.equal(summary.locationProposals['use-existing-stored-path'],107);
assert.equal(summary.locationProposals['correct-stored-path-after-live-check'],3);
assert.equal(summary.archiveScopeFastqProjectCount,59);
write('projects.json', projects);
write('registration-targets.json', {schemaVersion:1, batchId:'2026-10-16', targets: ownership.registrations.map(decision => {
  const project = projectById.get(decision.entryId);
  return {entryId:decision.entryId, relativePath:decision.physicalRoot.replace(/^\/mnt\/reads/,''),
    name:path.posix.basename(decision.physicalRoot), groupSafeName:project.group,
    owner:decision.proposedCatalogueOwner, observedUnixOwner:decision.observedUnixOwner,
    expectedFiles:project.expectedFileCount, expectedBytes:project.expectedBytes,
    decisionAuthority:'George, archive review chat, 22 October 2026',
    sourceReference:{entryId:decision.entryId,
      ownershipDecisions:'docs/archive/batches/2026-10-16/reconciliation-preview-2026-10-22/ownership-decisions.json',
      ownershipDecisionsSha256:digest(fs.readFileSync(path.join(__dirname,'ownership-decisions.json'))),
      originalSourceOwner:project.owner.exportOwner, observedAt:project.lastObservationAt}};
})});
write('file-classification.jsonl', files.map(f=>JSON.stringify(f)).join('\n')+'\n');
write('location-proposals.json', locations);
write('summary.json', summary);
write('provenance.json', {generatorSha256:digest(fs.readFileSync(__filename)), inputs:provenance,
  measurements:'Source file SHA-256 values establish report provenance only; they are not checksums of HPC data.',
  outputs:Object.fromEntries(['projects.json','registration-targets.json','file-classification.jsonl','location-proposals.json','summary.json'].map(f=>[f,digest(fs.readFileSync(path.join(__dirname,f)))]))});
const headings=['Entry','Project / directory','Disposition','Catalogue owner / proposed custodian','Registration needed','Observed files'];
const rows=projects.map(p=>[p.entryId,p.group+'/'+p.name,p.disposition,p.owner.proposedIdentifier || 'no registration proposed',p.needsProjectRegistration?'yes':'no',p.expectedFileCount].map(md));
write('PROJECT_DECISIONS.md', '# Reconciliation preview: all 197 entries\n\nDisposition/count baseline from 16–17 October; ownership proposals updated from the 22 October read-only review and George\'s fallback instruction. **No production changes applied.** See [live findings](LIVE_PREVIEW.md) and [ownership decisions](OWNERSHIP_AND_NEXT_STEPS.md). Five new Saunders registrations propose winj; the 17 Talbot directories and Courville propose shrestha. These are administrative custodians; original scientific ownership remains unresolved. Existing database owners are retained; Unix owner identifiers remain separate provenance in projects.json. The five supplementary entries are separate from the original 192. No separate bulk checksum sweep is required.\n\n| '+headings.join(' | ')+' |\n|'+headings.map(()=>'---').join('|')+'|\n'+rows.map(r=>'| '+r.join(' | ')+' |').join('\n')+'\n');
console.log(JSON.stringify(summary,null,2));
