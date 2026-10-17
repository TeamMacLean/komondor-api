// Local, deterministic correction of the Oct 16 observations. No production access.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../../../../..');
const base = path.join(root, 'docs/hpc-verification-2026-10-16');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const reports = new Map();
const changes = [];
fs.mkdirSync(path.join(base, 'corrected-diagnostics'), { recursive: true });
for (const group of ['two_blades', 'jjones', 'ntalbot', 'skamoun']) {
  const name = `verify-${group}.json`;
  const original = fs.readFileSync(path.join(base, 'independent-review', name), 'utf8');
  const report = JSON.parse(original);
  let count = 0;
  for (const project of report.projects) {
    let changed = 0;
    for (const anomaly of project.seriousAnomalies || []) {
      if (!['read', 'additionalFile'].includes(anomaly.kind)) continue;
      assert(project.dbRecordsMissingOnDisk.some(m => m.kind === anomaly.kind && m.id === anomaly.id && m.expectedRelPath === anomaly.expectedRelPath));
      anomaly.recordKind = anomaly.kind;
      anomaly.kind = 'db-file-missing';
      changed++;
    }
    if (changed) {
      const kinds = project.summary.anomalyKinds;
      assert.equal((kinds.read || 0) + (kinds.additionalFile || 0), changed);
      kinds['db-file-missing'] = (kinds['db-file-missing'] || 0) + changed;
      delete kinds.read;
      delete kinds.additionalFile;
      count += changed;
      changes.push({ projectId: project.projectId, path: project.path, correctedMissingAnomalies: changed });
    }
    reports.set(project.projectId, project);
  }
  report.diagnosticCorrection = {
    appliedOn: '2026-10-17', originalReport: `../independent-review/${name}`,
    originalSha256: hash(original), correctedMissingAnomalies: count,
    method: 'Relabel existing missing-record anomalies only; matched by record kind, ID and expected path. No new production observation or hashing. Counts and dispositions unchanged.',
  };
  fs.writeFileSync(path.join(base, 'corrected-diagnostics', name), JSON.stringify(report, null, 2)+'\n');
}
const registerPath = path.join(root, 'docs/archive/batches/2026-10-16/register.json');
const register = JSON.parse(fs.readFileSync(registerPath));
for (const entry of register.entries) {
  const review = entry.production_review;
  if (!review) continue;
  review.report = review.report.replace('/independent-review/', '/corrected-diagnostics/');
  const p = reports.get(entry.project_id);
  if (p && p.summary && review.metrics) {
    assert.equal(review.metrics.seriousAnomalies, p.summary.seriousAnomalies);
    review.metrics.anomalyKinds = p.summary.anomalyKinds;
  }
}
register.diagnostic_correction = {
  applied_on: '2026-10-17', report_directory: 'hpc-verification-2026-10-16/corrected-diagnostics/',
  changes, original_observations_retained: true, dispositions_and_numeric_totals_unchanged: true,
};
fs.writeFileSync(registerPath, JSON.stringify(register, null, 2)+'\n');
const csvPath = path.join(root, 'docs/hpc-archive-candidates-2026-10-16.csv');
fs.writeFileSync(csvPath, fs.readFileSync(csvPath, 'utf8').replaceAll('hpc-verification-2026-10-16/independent-review/verify-', 'hpc-verification-2026-10-16/corrected-diagnostics/verify-'));
console.log(JSON.stringify({ projectsCorrected: changes.length, missingAnomaliesCorrected: changes.reduce((s,c)=>s+c.correctedMissingAnomalies,0), changes }, null, 2));
