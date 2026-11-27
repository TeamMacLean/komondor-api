"""Release predicates only: no deletion, scheduler calls, AWS or database access."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parent.parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = load('release_builder', BASE / 'tools/build_release.py')
runner = load('released_runner', BASE / 'remaining-167-released/delete-reviewed-projects.py')


class ReleaseChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = BASE / 'remaining-167-released'
        cls.draft = json.loads((BASE / 'remaining-167/deletion-plan.json').read_text())
        cls.plan = json.loads((cls.pack / 'deletion-plan.json').read_text())
        cls.accepted = json.loads((cls.pack / 'pilot-acceptance.json').read_text())
        cls.live = json.loads((cls.pack / 'fresh-release-state.json').read_text())
        cls.observed = dt.datetime.fromisoformat(cls.live['at'].replace('Z', '+00:00')) + dt.timedelta(seconds=60)

    def setUp(self):
        observed = self.observed
        class AtReview(dt.datetime):
            @classmethod
            def now(cls, tz=None):
                return observed if tz else observed.replace(tzinfo=None)
        self.clock = patch.object(dt, 'datetime', AtReview)
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def test_exact_unchanged_remaining_scope_and_exclusions(self):
        self.assertEqual(self.plan['projects'], self.draft['projects'])
        ids = {p['projectId'] for p in self.plan['projects']}
        self.assertEqual(len(ids), 167)
        self.assertFalse(ids & (set(runner.HELD) | set(runner.COMPLETED_ROOTS)))
        self.assertEqual(self.plan['held'], self.draft['held'])
        for key in ('reviewCompletedAt', 'expiresAt', 'apiHead', 'reviewSummarySha256'):
            self.assertEqual(self.plan[key], self.draft[key])
        runner.check_stage(self.plan)

    def test_valid_receipts_and_every_package_checksum(self):
        builder.validate(self.draft, self.accepted, self.live)
        runner.check_release_evidence(self.plan, self.pack)
        runner.fresh(self.plan)
        self.assertEqual(hashlib.sha256((self.pack / 'deletion-plan.json').read_bytes()).hexdigest(), runner.PLAN_SHA256)
        for line in (self.pack / 'SHA256SUMS').read_text().splitlines():
            expected, name = line.split('  ', 1)
            self.assertEqual(hashlib.sha256((self.pack / name).read_bytes()).hexdigest(), expected, name)

    def test_missing_or_altered_acceptance_file_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            pack = Path(temporary)
            (pack / 'fresh-release-state.json').write_bytes((self.pack / 'fresh-release-state.json').read_bytes())
            with self.assertRaises(FileNotFoundError):
                runner.check_release_evidence(self.plan, pack)
            altered = copy.deepcopy(self.accepted); altered['success'] = False
            (pack / 'pilot-acceptance.json').write_text(json.dumps(altered))
            with self.assertRaisesRegex(RuntimeError, 'Release receipt changed'):
                runner.check_release_evidence(self.plan, pack)

    def test_unaccepted_or_unconfirmed_pilot_rejected(self):
        for flag in ('success', 'nativeConfirmed', 'webChecked'):
            bad = copy.deepcopy(self.accepted); bad[flag] = False
            with self.subTest(flag=flag), self.assertRaisesRegex(RuntimeError, 'Pilot not accepted'):
                builder.validate(self.draft, bad, self.live)
        bad = copy.deepcopy(self.accepted); bad['projects'][0]['state'] = 'aws_pending_hpc_deletion'
        with self.assertRaisesRegex(RuntimeError, 'Pilot not natively completed'):
            builder.validate(self.draft, bad, self.live)

    def test_live_identity_drift_rejected(self):
        for key in ('relativeRoot', 'migrationId', 'sourceSha256', 'verificationSha256', 's3Uri', 's3VerifiedAt', 'fileCount', 'bytes'):
            bad = copy.deepcopy(self.live); bad['projects'][0][key] = 'changed'
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'Live identity changed'):
                builder.validate(self.draft, self.accepted, bad)

    def test_active_or_invalid_retention_and_missing_source_rejected(self):
        for flag in ('active', 'invalid'):
            bad = copy.deepcopy(self.live); bad['projects'][0]['preservation'][flag] = True
            with self.subTest(flag=flag), self.assertRaisesRegex(RuntimeError, 'Keep date blocks'):
                builder.validate(self.draft, self.accepted, bad)
        bad = copy.deepcopy(self.live); bad['projects'][0]['sourcePresent'] = False
        with self.assertRaisesRegex(RuntimeError, 'Missing source'):
            builder.validate(self.draft, self.accepted, bad)
        bad = copy.deepcopy(self.live); bad['held'][0]['present'] = False
        with self.assertRaisesRegex(RuntimeError, 'Held source unavailable'):
            builder.validate(self.draft, self.accepted, bad)

    def test_expired_review_or_extended_expiry_rejected(self):
        bad = copy.deepcopy(self.plan); bad['expiresAt'] = '2026-11-28T18:22:07.856000+00:00'
        with self.assertRaisesRegex(RuntimeError, 'Original review window changed'):
            runner.check_stage(bad)
        expired = {'reviewCompletedAt': '2026-11-26T12:22:07.856Z', 'expiresAt': '2026-11-26T18:22:07.856Z'}
        with self.assertRaisesRegex(RuntimeError, 'Review expired'):
            runner.fresh(expired)

    def test_same_count_wrong_id_or_completed_project_rejected(self):
        for project_id in list(runner.COMPLETED_ROOTS) + list(runner.HELD) + ['0' * 24]:
            bad = copy.deepcopy(self.plan); bad['projects'][0]['projectId'] = project_id
            with self.subTest(project_id=project_id), self.assertRaises(RuntimeError):
                runner.check_stage(bad)
        with self.assertRaises(RuntimeError):
            runner.check_stage(self.draft)

    def test_completed_roots_and_catalogue_must_still_pass(self):
        bad = copy.deepcopy(self.live); bad['completed'][0]['hpcAbsent'] = False
        with self.assertRaisesRegex(RuntimeError, 'Completed Project no longer absent'):
            builder.validate(self.draft, self.accepted, bad)
        bad = copy.deepcopy(self.live); bad['catalogue']['references'] -= 1
        with self.assertRaisesRegex(RuntimeError, 'Catalogue coverage changed'):
            builder.validate(self.draft, self.accepted, bad)
        bad = copy.deepcopy(self.live); bad['issues'] = ['unexpected']
        with self.assertRaisesRegex(RuntimeError, 'unresolved issues'):
            builder.validate(self.draft, self.accepted, bad)


if __name__ == '__main__':
    unittest.main()
