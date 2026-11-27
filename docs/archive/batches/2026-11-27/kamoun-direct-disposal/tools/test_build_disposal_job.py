import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('disposal_builder_tests', HERE / 'build_disposal_job.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
BASE = HERE.parent


class ReleaseGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.inventory = BASE / 'evidence/filesystem-preflight-r2-20261127.json'
        self.retirement = BASE / 'evidence/retirement-completed.json'
        self.native_plan = BASE / 'retirement-plan.json'
        self.out = self.root / builder.PACKAGE
        self.authority = 'George explicitly authorised these six Kamoun delete rows without an S3 copy.'

    def prepare(self, receipt=None):
        return builder.prepare(self.inventory, receipt or self.retirement, self.native_plan, self.authority)

    def changed_receipt(self, change):
        value = json.loads(self.retirement.read_text())
        change(value)
        p = self.root / ('receipt-' + str(len(list(self.root.iterdir()))) + '.json')
        p.write_text(json.dumps(value))
        return p

    def test_actual_complete_receipt_builds_exact_private_regular_archive(self):
        result = builder.build(self.inventory, self.retirement, self.native_plan, self.out, self.authority)
        self.assertTrue(result['success'])
        self.assertFalse(result['submitted'])
        self.assertEqual(result['files'], 1217)
        self.assertEqual(result['bytes'], 790004575062)
        plan = json.loads((self.out / 'deletion-plan.json').read_text())
        self.assertEqual((builder.timestamp(plan['expiresAt']) - builder.timestamp(plan['reviewCompletedAt'])).total_seconds(), 21600)
        self.assertEqual(plan['retirementReceiptSha256'], builder.sha(self.retirement.read_bytes()))
        self.assertEqual(len(result['members']), 12)
        with tarfile.open(result['archive']) as tar:
            members = tar.getmembers()
            self.assertEqual({m.name for m in members}, {builder.PACKAGE + '/' + n for n in result['members']})
            for m in members:
                self.assertTrue(m.isfile())
                self.assertFalse(m.pax_headers)
                self.assertNotIn('/._', m.name)
                self.assertNotIn('__pycache__', m.name)
                self.assertEqual(m.mode & 0o077, 0)
                self.assertEqual(tar.extractfile(m).read(), (self.out / Path(m.name).name).read_bytes())
        self.assertEqual(stat.S_IMODE(self.out.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(Path(result['archive']).stat().st_mode), 0o600)
        self.assertEqual(result['archiveSha256'], builder.sha(Path(result['archive']).read_bytes()))
        for line in (self.out / 'SHA256SUMS').read_text().splitlines():
            digest, name = line.split('  ')
            self.assertEqual(builder.sha((self.out / name).read_bytes()), digest)
        code = (self.out / 'delete-direct-disposal.py').read_text()
        self.assertNotIn('__PLAN_SHA256__', code)
        self.assertNotIn('__RETIREMENT_SHA256__', code)
        self.assertNotIn('DRAFT:', code)
        self.assertNotIn('Unreplaced hash tokens', code)
        self.assertNotIn('collections', plan)
        self.assertNotIn('graph', plan)

    def test_missing_or_failed_or_incomplete_retirement_refuses_before_output(self):
        changes = [lambda x: x.update(success=False), lambda x: x.update(retiredRecords=2458),
                   lambda x: x.update(written=2458), lambda x: x.update(physicalDeletionPerformed=True),
                   lambda x: x['projectIds'].pop(), lambda x: x['counts'].update(files=1216)]
        for change in changes:
            with self.subTest(change=change):
                with self.assertRaises(RuntimeError):
                    builder.build(self.inventory, self.changed_receipt(change), self.native_plan, self.out, self.authority)
                self.assertFalse(self.out.exists())
        with self.assertRaises(FileNotFoundError):
            self.prepare(self.root / 'missing.json')

    def test_each_required_retirement_assurance_is_enforced(self):
        fields = ['dependentRecordsRetained', 'beforeImagesVerified', 'writesBlocked', 'externalWritersFrozen',
                  'noS3Copy', 'manualFilesystemDeletionRequired', 'sourceInventoryUnchanged',
                  'storageAndArchiveFieldsUnchanged', 'priorHistoryPreserved']
        for field in fields:
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.prepare(self.changed_receipt(lambda x: x.update({field: False})))

    def test_wrong_plan_api_or_future_receipt_refuses(self):
        for change in [lambda x: x.update(planSha256='0' * 64), lambda x: x.update(apiHead='0' * 40),
                       lambda x: x.update(at='2099-01-01T00:00:00Z'),
                       lambda x: x.update(executionAt='2026-11-27T00:00:00Z')]:
            with self.assertRaises(RuntimeError):
                self.prepare(self.changed_receipt(change))

    def test_sealed_inventory_change_or_symlink_refuses(self):
        altered = self.root / 'changed-inventory.json'
        altered.write_bytes(self.inventory.read_bytes() + b' ')
        with self.assertRaisesRegex(RuntimeError, 'Sealed source inventory changed'):
            builder.prepare(altered, self.retirement, self.native_plan, self.authority)
        link = self.root / 'receipt-link.json'
        link.symlink_to(self.retirement)
        with self.assertRaisesRegex(RuntimeError, 'regular file'):
            self.prepare(link)

    def test_expired_inventory_cannot_be_released(self):
        class Later(datetime):
            @classmethod
            def now(cls, tz=None):
                return datetime(2026, 11, 27, 21, 0, tzinfo=timezone.utc)
        with patch.object(builder, 'datetime', Later), self.assertRaisesRegex(RuntimeError, 'review expired'):
            self.prepare()

    def test_existing_package_or_archive_is_not_overwritten(self):
        self.out.mkdir()
        marker = self.out / 'keep'
        marker.write_text('untouched')
        with self.assertRaisesRegex(RuntimeError, 'replace existing'):
            builder.build(self.inventory, self.retirement, self.native_plan, self.out, self.authority)
        self.assertEqual(marker.read_text(), 'untouched')
        archive = self.root / (builder.PACKAGE + '.tar.gz')
        archive.write_bytes(b'keep')
        with self.assertRaisesRegex(RuntimeError, 'replace existing'):
            builder.build(self.inventory, self.retirement, self.native_plan, self.out, self.authority)
        self.assertEqual(archive.read_bytes(), b'keep')

    def test_authority_and_expected_directory_required(self):
        with self.assertRaisesRegex(RuntimeError, 'authority'):
            builder.prepare(self.inventory, self.retirement, self.native_plan, '')
        with self.assertRaisesRegex(RuntimeError, 'directory name'):
            builder.build(self.inventory, self.retirement, self.native_plan, self.root / 'wrong', self.authority)


if __name__ == '__main__':
    unittest.main()
