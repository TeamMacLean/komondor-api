import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('builder', HERE/'build_split.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class SplitChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parent_raw = builder.PARENT.read_bytes()
        cls.parent = json.loads(cls.parent_raw)
        cls.selection = json.loads((HERE.parent/'evidence/selection-live.json').read_text())
        cls.plans = builder.split(cls.parent, cls.parent_raw, cls.selection)

    def test_exact_partition_and_unchanged_evidence(self):
        pilot, rest = self.plans['pilot-2'], self.plans['remaining-167']
        self.assertEqual(len(pilot['projects']), 2)
        self.assertEqual(len(rest['projects']), 167)
        combined = pilot['projects'] + rest['projects']
        self.assertEqual(len({p['projectId'] for p in combined}), 169)
        self.assertEqual(sorted(combined, key=lambda p:p['projectId']),
                         sorted(self.parent['projects'], key=lambda p:p['projectId']))
        for plan in self.plans.values():
            for key in ('reviewCompletedAt', 'expiresAt', 'held', 'reviewSummarySha256', 'apiHead'):
                self.assertEqual(plan[key], self.parent[key])

    def test_pilot_only_exact_approved_ids(self):
        builder.deletion.check_stage(self.plans['pilot-2'])
        bad = copy.deepcopy(self.plans['pilot-2'])
        bad['projects'][0] = self.plans['remaining-167']['projects'][0]
        with self.assertRaisesRegex(RuntimeError, 'two approved'):
            builder.deletion.check_stage(bad)

    def test_stage_count_mismatch(self):
        bad = copy.deepcopy(self.plans['pilot-2'])
        bad['projects'].append(bad['projects'][0])
        with self.assertRaisesRegex(RuntimeError, 'two approved'):
            builder.deletion.check_stage(bad)

    def test_remainder_cannot_be_released_by_marker(self):
        for release in ('blocked-pending-pilot-review', 'ready-for-user-submission'):
            bad = copy.deepcopy(self.plans['remaining-167'])
            bad['releaseStatus'] = release
            with self.assertRaisesRegex(RuntimeError, 'blocked until pilot'):
                builder.deletion.check_stage(bad)

    def test_review_cannot_be_extended_or_rebased(self):
        for key, value in [('expiresAt', '2026-11-28T18:22:07.856000+00:00'),
                           ('parentPlanSha256', '0'*64), ('reviewCompletedAt', '2026-11-27T13:00:00Z')]:
            bad = copy.deepcopy(self.plans['pilot-2']); bad[key] = value
            with self.assertRaises(RuntimeError):
                builder.deletion.check_stage(bad)

    def test_missing_actual_reads_rejected(self):
        bad = copy.deepcopy(self.selection)
        bad['projects'][0]['reads'] = []
        with self.assertRaises(AssertionError):
            builder.split(self.parent, self.parent_raw, bad)


if __name__ == '__main__':
    unittest.main()
