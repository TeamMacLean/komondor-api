# Stage 3 evidence subset — 16 October 2026

See the [rehearsal record](../../STAGE3_APPLICATION_REHEARSAL_2026-10-16.md)
for the scope, operator approvals, observed results and remaining pilot checks.
These files concern only the synthetic project `6ad24adfe34eae4923a3cda4`.

- `source-manifest.v1.json` and `verification-report.v1.json` are byte-preserved
  downloads of the sealed S3 control records. Their SHA-256 values match
  `migration.manifests` in `final-cli-status.json`.
- `final-cli-status.json` is the deployed CLI's final status output: archived,
  completed, three owned objects, no incomplete uploads, source root absent.
- `final-health.json` records the final API read-back and service health checks;
  this is an operator probe, not an archive CLI receipt.
- `acceptance-summary.json` combines the operator's lifecycle receipts,
  API/Nudge results and browser observations. Browser observations are recorded
  manually; hashes identify the supporting screenshots retained outside Git.
  It also includes the bounded service window's preflight and restart records.

This is a reviewable subset, not the complete logs or a shared backup policy.
The full local/server evidence locations are in the rehearsal record. No
passwords, tokens, configuration secrets or scientific payload are included.

To check the retained files against the summary, from the repository root:

```bash
python3 - <<'PY'
import hashlib
import json
from pathlib import Path

root = Path('docs/archive/evidence/stage3-20261016')
summary = json.loads((root / 'acceptance-summary.json').read_text())
for name, expected in summary['retainedFileSha256'].items():
    actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
    assert actual == expected, name
print('All retained evidence digests match.')
PY
```

Digest agreement detects changes to the saved records. It does not by itself
prove that a new production project is safe to delete.
