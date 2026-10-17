// Derive review records locally from a completed, authenticated read-only run.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const here = __dirname;
const batch = path.resolve(here, '../..');
const source = process.argv[2];
assert(/^paths-complete-\d{8}T\d{6}Z\.json$/.test(source || ''), 'Supply the completed aggregate filename');
const receipt = JSON.parse(fs.readFileSync(path.join(here, source.replace('.json', '.command.json'))));
const bytes = fs.readFileSync(path.join(here, source));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
assert.equal(receipt.exitCode, 0);
assert.equal(sha(bytes), receipt.outputSha256);
assert.equal(receipt.runnerFile, 'resume-path-review.py');
assert.equal(sha(fs.readFileSync(path.join(here, receipt.runnerFile))), receipt.runnerSha256);
const raw = JSON.parse(bytes);
assert.equal(new Set(raw.projects.map(p=>p.entryId)).size, 8);
assert.deepEqual(raw.projects.map(p=>p.entryId).sort(), receipt.targets.map(t=>t.entryId).sort());
assert.deepEqual(raw.observationEvidence, receipt.observationEvidence);
const observations = [];
for (const item of receipt.observationEvidence) {
  const commandBytes = fs.readFileSync(path.join(here, item.receipt));
  assert.equal(sha(commandBytes), item.receiptSha256);
  const command = JSON.parse(commandBytes);
  assert.equal(command.exitCode, 0);
  assert(['collect-readonly.cjs', 'collect-path-record.cjs'].includes(command.collectorFile));
  assert.equal(sha(fs.readFileSync(path.join(here, command.collectorFile))), command.collectorSha256);
  const resultBytes = fs.readFileSync(path.join(here, item.output));
  assert.equal(sha(resultBytes), item.outputSha256);
  assert.equal(command.outputSha256, item.outputSha256);
  const result = JSON.parse(resultBytes);
  assert.equal(result.projects.length, 1);
  const project = result.projects[0];
  assert(project.treeUnchangedDuringAudit);
  assert.equal(command.targets.length, 1);
  const target = command.targets[0];
  assert.equal(project.projectId, target.projectId);
  assert.equal(project.projectPath, target.projectPath);
  assert.equal(project.entryId, target.entryId);
  assert.deepEqual(project.records.map(r=>r.readId).sort(), target.missing.map(m=>m.id).sort());
  assert.deepEqual(result.gitBefore, raw.gitBefore);
  assert.deepEqual(result.gitAfter, raw.gitAfter);
  assert.deepEqual(result.moduleSha256, raw.moduleSha256);
  observations.push({result, item});
}
for (const aggregate of raw.projects) {
  const parts = observations.filter(o=>o.result.projects[0].entryId===aggregate.entryId);
  assert(parts.length);
  assert.deepEqual(aggregate.observationEvidence, parts.map(o=>o.item));
  const records = parts.flatMap(o=>o.result.projects[0].records);
  assert.equal(new Set(records.map(r=>r.readId)).size, records.length);
  assert.equal(records.length, aggregate.records.length);
  for (const r of records) assert.deepEqual(aggregate.records.find(a=>a.readId===r.readId), r);
  for (const {result} of parts) {
    const p=result.projects[0];
    for (const field of ['projectId','projectPath','sourceRoot','inventoryRegularFiles','inventoryBytes']) assert.equal(p[field],aggregate[field]);
    if (parts.length>1) {
      assert(/^[a-f0-9]{64}$/.test(p.inventorySha256 || ''));
      assert.equal(p.inventorySha256, aggregate.inventorySha256, 'Tree changed between observations');
    }
  }
}
assert.equal(raw.projects.length, 8);
assert.deepEqual(raw.gitBefore, raw.gitAfter);
assert.equal(raw.gitAfter.status, '');
assert.equal(raw.projects.reduce((n,p)=>n+p.records.length,0), 110);
const supplementalSource = 'extension-paths-20261017T070916Z.json';
const supplementalReceipt = JSON.parse(fs.readFileSync(path.join(here, supplementalSource.replace('.json','.command.json'))));
const supplementalBytes = fs.readFileSync(path.join(here, supplementalSource));
assert.equal(supplementalReceipt.exitCode, 0);
assert.equal(sha(supplementalBytes), supplementalReceipt.outputSha256);
assert.equal(sha(fs.readFileSync(path.join(here, supplementalReceipt.collectorFile))), supplementalReceipt.collectorSha256);
const supplement = JSON.parse(supplementalBytes);
assert.deepEqual(supplement.gitBefore, supplement.gitAfter);
assert.deepEqual(supplement.gitAfter, raw.gitAfter);
assert.equal(supplement.projects.length,1);
const extra = supplement.projects[0];
const original = raw.projects.find(p=>p.entryId==='jjones-008');
assert.equal(extra.entryId,original.entryId);
assert.equal(extra.projectId,original.projectId);
assert.equal(extra.projectPath,original.projectPath);
assert(extra.treeUnchangedDuringAudit);
assert.equal(extra.inventoryBytes,original.inventoryBytes);
assert.equal(extra.inventoryRegularFiles,original.inventoryRegularFiles);
assert.equal(extra.records.length,3);
for(const r of extra.records){
  const prior=original.records.find(x=>x.readId===r.readId);assert(prior);
  for(const field of ['fileId','runId','runPath','expectedRelPath','storedFilePath','validOriginalMD5'])assert.equal(r[field],prior[field]);
  r.initialNamedPathSearch = prior.resolution;
  r.supplementalEvidence = 'evidence/2026-10-17/'+supplementalSource;
}
// The initial search had no exact-name/stored-path candidates. Do not call that
// a loss after the observed extension variants have been independently hashed.
raw.projects[raw.projects.indexOf(original)] = extra;
const gzipSource='gzip-diagnostics-20261017T072649Z.json';
const gzipReceipt=JSON.parse(fs.readFileSync(path.join(here,gzipSource.replace('.json','.command.json'))));
const gzipBytes=fs.readFileSync(path.join(here,gzipSource));
assert.equal(gzipReceipt.exitCode,0);assert.equal(sha(gzipBytes),gzipReceipt.outputSha256);
assert.equal(sha(fs.readFileSync(path.join(here,gzipReceipt.collectorFile))),gzipReceipt.collectorSha256);
const gzip=JSON.parse(gzipBytes);assert.equal(gzip.records.length,26);
for(const g of gzip.records){
 const p=raw.projects.find(p=>p.projectId===g.projectId);assert(p);
 const r=p.records.find(r=>r.readId===g.readId);assert(r);
 const c=r.candidates.find(c=>c.relPath===g.relPath);assert(c);
 assert.equal(c.bytes,g.physical.bytes);assert.equal(c.md5,g.physical.md5);assert.equal(c.sha256,g.physical.sha256);
 assert(g.stable&&g.gzipTrailerValidated&&g.decodedMatchesOriginal);
 assert.equal(r.validOriginalMD5,String(g.originalMD5).trim().toLowerCase());
 assert.equal(r.validOriginalMD5,g.decoded.md5);
 const projectPrefix=p.projectPath.replace(/^\//,'')+'/';
 const runRelative=r.runPath.replace(/^\//,'').slice(projectPrefix.length);
 assert(c.relPath.startsWith(runRelative+'/'));
 assert.equal(r.resolution.category,'c');
 r.initialPhysicalChecksumResolution=r.resolution;
 r.compressionDiagnostic={source:'evidence/2026-10-17/'+gzipSource,...g};
 r.resolution={...r.resolution,resolved:true,resolutionType:'gzip-content-checksum-match',
   physicalOriginalMd5Match:false,decodedOriginalMd5Match:true,
   resolution:'The compressed bytes differ from the recorded MD5, but the complete validated gzip payload matches it exactly. Preserve and archive the gzip file unchanged; retain both checksum interpretations and this proof. This does not claim compressed-byte equality to the historical checksum.'};
}
const register = JSON.parse(fs.readFileSync(path.join(batch, 'register.json')));
const projects = raw.projects.map(p => {
  const target = receipt.targets.find(t=>t.entryId===p.entryId);
  assert(target && p.projectId===target.projectId && p.projectPath===target.projectPath);
  assert(p.treeUnchangedDuringAudit);
  assert.deepEqual(p.records.map(r=>r.readId).sort(),target.missing.map(m=>m.id).sort());
  for (const r of p.records) {
    assert.equal(r.proposedFileMoves.length, 0);
    assert.equal(r.proposedDatabaseWrites.length, 0);
    for (const c of r.candidates) assert(c.stable && /^[a-f0-9]{32}$/.test(c.md5) && /^[a-f0-9]{64}$/.test(c.sha256));
  }
  const counts = { a:0, b:0, cResolved:0, cHold:0 };
  for (const r of p.records) counts[r.resolution.category==='c' ? (r.resolution.resolved?'cResolved':'cHold') : r.resolution.category]++;
  return { ...p, counts, action:counts.cHold?'HOLD_PATH_AMBIGUITY':'ARCHIVE_WITH_DOCUMENTED_DISCREPANCIES',
    proposedFileMoves:[], proposedDatabaseWrites:[],
    archiveProcedure:'Preserve the complete tree and database history. Review fresh plan; acknowledge actual known anomalies. Verify dbExpectedMissing, anomalies and all physical file checksums in the sealed source manifest. Retain this resolution record with the manifest digest in the batch receipt.' };
});
const result={observedFrom:raw.startedAt,observedTo:raw.finishedAt,source:'evidence/2026-10-17/'+source,sourceSha256:receipt.outputSha256,supplementalSource:'evidence/2026-10-17/'+supplementalSource,supplementalSourceSha256:supplementalReceipt.outputSha256,gzipDiagnosticSource:'evidence/2026-10-17/'+gzipSource,gzipDiagnosticSha256:gzipReceipt.outputSha256,productionWrites:false,projects};
fs.writeFileSync(path.join(batch,'path-resolutions.json'),JSON.stringify(result,null,2)+'\n');
const total={a:0,b:0,cResolved:0,cHold:0};for(const p of projects)for(const k of Object.keys(total))total[k]+=p.counts[k];
const allRecords = projects.flatMap(p=>p.records);
const physicalMatches = allRecords.filter(r=>r.validOriginalMD5 && r.candidates.some(c=>c.md5===r.validOriginalMD5)).length;
const decodedMatches = allRecords.filter(r=>r.compressionDiagnostic?.decodedMatchesOriginal).length;
const noOriginal = allRecords.filter(r=>!r.validOriginalMD5).length;
let md=`# Resolution of 110 missing expected file paths\n\nPrimary read-only production comparison: ${raw.startedAt} to ${raw.finishedAt}, v1333 as deeks. Supplemental checks were completed earlier on the same day; their original timestamps are retained.\nNo files moved, no MongoDB edits, no S3 writes. Production remained at\n\`${raw.gitAfter.commit}\` with a clean checkout.\n\nOf the 110 records, **${physicalMatches}** have a physical candidate matching the recorded\noriginal MD5, **${decodedMatches}** have a validated gzip payload matching it, and\n**${noOriginal}** have no valid original MD5. Current hashes for that last group\ndo not establish historical checksum equality. None requires a file move.\n\n[Complete per-record decisions and hashes](path-resolutions.json),\n[raw output](evidence/2026-10-17/${source}),\n[exact command/output hash](evidence/2026-10-17/${source.replace('.json','.command.json')}),\nand per-project command receipts/progress logs linked from that receipt are retained.\nThe [extension-variant supplement](evidence/2026-10-17/${supplementalSource}) and\n[its exact command](evidence/2026-10-17/${supplementalSource.replace('.json','.command.json')})\ncover three Jones filenames ending in .fastq on disk but .fastq.txt in the database.\nThey supersede the initial exact-name search for those three records.\nA [gzip-content diagnostic](evidence/2026-10-17/${gzipSource}) resolves 26 further\nchecksum discrepancies: compressed bytes differ, while each complete decoded payload\nmatches its recorded original MD5. All gzip trailers validated. The diagnostic uses\nthe identical physical bytes as the primary hash run, checked by size, MD5 and SHA-256.\n\n## What replaces FIX_PATHS_THEN_ARCHIVE\n\nDo **not** repair File.path, move files into raw/, or rewrite historical Read records\nto make this discrepancy disappear. The CLI derives the expected Read location from\nRun.path + raw/ + File.originalName; changing File.path alone does not change that\nexpectation. Its inventory copies all present readable regular files in the project,\nincluding processed/ and unregistered files. None of these eight project resolutions proposes\na file move. Any later move needs a separately reviewed manual command and fresh\nidentity/content checks; a plan label is not permission to move bytes.\n\n- **a — ${total.a} records:** one located candidate in the same run. Compare actual\n  content MD5 to the recorded original when valid; if none was recorded, explicitly\n  retain that limitation. Preserve the tree and seal the path discrepancy.\n- **b — ${total.b} records:** expected and stored locations are absent, with no\n  same-basename regular file anywhere in this project's full inventory. Archive\n  existing bytes with the missing record/loss documented. This establishes absence\n  of the recorded file, not that an unknown renamed copy cannot exist elsewhere;\n  it does not claim recovery of missing data.\n- **c resolved — ${total.cResolved} records:** all candidate copies were hashed. The\n  decision states whether copies are byte-identical, one uniquely matches the\n  original MD5, or a validated gzip payload matches that MD5 within the same run.\n  The 26 gzip cases explicitly preserve the compressed-byte mismatch; historical\n  checksum interpretation is not silently rewritten. Preserve all copies and history.\n- **c hold — ${total.cHold} records:** unresolved mismatch or ambiguity. Hold the\n  affected project for a separately recorded decision; do not silently choose a\n  copy, rename a file or use anomaly acknowledgement to claim identity.\n\n## Per-project disposition\n\n| Entry | Project | Missing expected | a | b | c resolved | c hold | Proposed action |\n|---|---|---:|---:|---:|---:|---:|---|\n`;
for(const p of projects)md+=`| ${p.entryId} | \`${p.projectPath}\` | ${p.records.length} | ${p.counts.a} | ${p.counts.b} | ${p.counts.cResolved} | ${p.counts.cHold} | ${p.action} |\n`;
md+='\n## Required manifest and review receipt\n\nBefore each lock, take a fresh live plan and compare it to this record. Each\nRead/Run/File record was re-read unchanged after its comparison, and each project\ntree was re-inventoried unchanged at the end. These sequential database reads are\nnot a transaction or a freeze for a future archive. Preserve all physical paths, including duplicate\ncopies. Acknowledgement is for documented historical anomalies only.\n\nAfter copy seals the source manifest, check every expected missing Read ID/path in\n`dbExpectedMissing` and `anomalies` (`kind:db-file-missing`, `recordKind:read`). Check\nall retained physical candidate paths, sizes and SHA-256 values in `entries`. The CLI\nseals these inventory facts; it does **not** automatically embed this external\nresolution prose or the complete database export. Keep a batch review receipt that\nbinds this JSON SHA-256 and review commit to the exact migration ID, source-manifest\nS3 version/pointer and digest. Retain original missing paths and duplicate-db-path\nanomalies rather than replacing them with invented normal metadata. This is an\narchive of the surviving physical tree, not a claim the historical database is complete.\n\nNever edit an already sealed manifest. A mismatch with this audit requires review\nbefore manual HPC deletion, even if the upload itself verified. Normal restore,\nverification and manual deletion checkpoints remain in force.\n';
for(const p of projects){
  md+=`\n## ${p.entryId} — ${p.projectPath}\n\nProject ID: \`${p.projectId}\`. ${p.records.length} expected paths reviewed;\n${p.uniqueFilesHashed} distinct regular files hashed. Proposed file moves: **none**.\nProposed database writes: **none**. Action: **${p.action}**.\n\n| Read ID | Missing expected relative path | Resolution | Valid recorded original MD5 | Candidate count |\n|---|---|---|---|---:|\n`;
  for(const r of p.records)md+=`| \`${r.readId}\` | \`${r.expectedRelPath}\` | ${r.resolution.category}${r.resolution.category==='c' ? (r.resolution.resolved?' — resolved':' — HOLD'):''} | ${r.validOriginalMD5?'`'+r.validOriginalMD5+'`':'none recorded'} | ${r.candidates.length} |\n`;
  for(const r of p.records.filter(r=>r.resolution.category==='c')){
    md+=`\nCandidate comparison for Read \`${r.readId}\`:\n\n| Candidate relative path | Bytes | Actual MD5 | SHA-256 |\n|---|---:|---|---|\n`;
    for(const c of r.candidates)md+=`| \`${c.relPath}\` | ${c.bytes} | \`${c.md5}\` | \`${c.sha256}\` |\n`;
    md+=`\n${r.resolution.resolution}\n`;
    if(r.compressionDiagnostic){const g=r.compressionDiagnostic;md+=`\nDecoded payload: ${g.decoded.bytes} bytes; MD5 \`${g.decoded.md5}\`; SHA-256 \`${g.decoded.sha256}\`. The full gzip trailer validated. Preserve the gzip object and its compressed-byte SHA-256; do not replace the historical MD5 or pretend it matched the encoded bytes.\n`;}

  }
}
fs.writeFileSync(path.join(batch,'PATH_RESOLUTIONS.md'),md);
for(const p of projects){
  const e=register.entries.find(e=>e.entry_id===p.entryId);assert(e);
  e.path_resolution_review={observed_at:raw.finishedAt,record:'path-resolutions.json',counts:p.counts,action:p.action,proposed_file_moves:[],proposed_database_writes:[]};
}
register.current_action_plan={recorded_on:'2026-10-17',document:'ACTION_PLAN.md',csv:'action-plan.csv',supersedes:['AWAITING_GROUP_DECISION for the three exports','age cutoff labels for this batch','FIX_PATHS_THEN_ARCHIVE'],retains:'Original entries/source decisions and October 16 production observations remain historical evidence; KEEP and manual deletion gates stand.'};
fs.writeFileSync(path.join(batch,'register.json'),JSON.stringify(register,null,2)+'\n');
console.log(JSON.stringify({records:110,counts:total,projects:projects.map(p=>({entryId:p.entryId,counts:p.counts,action:p.action}))},null,2));
