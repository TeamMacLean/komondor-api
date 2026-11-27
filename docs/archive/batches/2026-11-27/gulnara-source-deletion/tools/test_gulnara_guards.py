"""New four-source release and retained-copy guards; no production access/deletion."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('gulnara', Path(__file__).with_name('delete-gulnara-reviewed.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
sha = lambda b: hashlib.sha256(b).hexdigest()


def plan():
    now = dt.datetime.now(dt.timezone.utc)
    protected = [{'path': 'sample/file' + str(i), 'bytes': 1 if i else 41432635417 - 39,
                  'ino': i + 100, 'mtimeMs': 1, 'ctimeMs': 1, 'nlink': 2} for i in range(40)]
    return {'stage': 'gulnara-four-sources', 'releaseStatus': 'ready-for-user-submission',
            'reviewCompletedAt': now.isoformat(), 'expiresAt': (now + dt.timedelta(hours=6)).isoformat(),
            'apiHead': 'a' * 40, 'reviewSummarySha256': runner.REVIEW_SHA256,
            'destinationCheckSha256': runner.DESTINATION_SHA256, 'holdReleaseSha256': runner.RELEASE_SHA256,
            'held': [{'projectId': p, 'relativeRoot': r} for p, r in runner.HELD.items()],
            'protectedRoots': sorted(runner.PROTECTED_ROOTS), 'protectedFiles': protected,
            'projects': [{'projectId': p, 'relativeRoot': r, 'files': [{'ino': i + 1}]} for i, (p, r) in enumerate(runner.TARGETS.items())]}


class ExactScope(unittest.TestCase):
    def test_valid_four_source_scope(self):
        runner.check_stage(plan())

    def test_wrong_id_or_root_or_count_rejected(self):
        for change in ['id', 'root', 'extra', 'missing']:
            p = plan()
            if change == 'id': p['projects'][0]['projectId'] = '0' * 24
            if change == 'root': p['projects'][0]['relativeRoot'] = runner.DESTINATION
            if change == 'extra': p['projects'].append(copy.deepcopy(p['projects'][0]))
            if change == 'missing': p['projects'].pop()
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, 'four exact'):
                runner.check_stage(p)

    def test_wrong_stage_or_unreleased_rejected(self):
        for key, value in [('stage', 'remaining-167-released'), ('releaseStatus', 'blocked')]:
            p = plan(); p[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError): runner.check_stage(p)

    def test_any_protected_root_change_rejected(self):
        p = plan(); p['protectedRoots'].remove(runner.STAGING)
        with self.assertRaisesRegex(RuntimeError, 'Protected roots changed'): runner.check_stage(p)
        p = plan(); p['held'].pop()
        with self.assertRaisesRegex(RuntimeError, 'Protected Projects changed'): runner.check_stage(p)

    def test_copy_and_original_shared_inode_rejected(self):
        p = plan(); p['protectedFiles'][0]['ino'] = p['projects'][0]['files'][0]['ino']
        with self.assertRaisesRegex(RuntimeError, 'share original'): runner.check_stage(p)

    def test_wrong_copied_scope_rejected(self):
        for change in ['missing', 'duplicate', 'bytes', 'traversal']:
            p = plan()
            if change == 'missing': p['protectedFiles'].pop()
            if change == 'duplicate': p['protectedFiles'][1]['path'] = p['protectedFiles'][0]['path']
            if change == 'bytes': p['protectedFiles'][0]['bytes'] -= 1
            if change == 'traversal': p['protectedFiles'][0]['path'] = '../outside'
            with self.subTest(change=change), self.assertRaises(RuntimeError): runner.check_stage(p)

    def test_changed_evidence_bindings_rejected(self):
        for key in ['reviewSummarySha256', 'destinationCheckSha256', 'holdReleaseSha256']:
            p = plan(); p[key] = '0' * 64
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'binding changed'): runner.check_stage(p)


class ReceiptGuards(unittest.TestCase):
    def fixture(self, temporary, change=None):
        p = plan()
        native = {'total': 4, 'passed': 4, 'failed': [], 'at': p['reviewCompletedAt'], 'apiHead': p['apiHead']}
        release = {'kind': 'gulnara-source-hold-release-v1', 'operator': 'deeks',
                   'sourceProjectIds': list(runner.TARGETS), 'waitingForReplyWaivedByGeorge': True,
                   'manualHpcSubmissionRequired': True, 'sourceExclusionsReleasedForReview': True,
                   'releaseConditionalOnFreshChecks': True, 'sourceDeletionOnly': True,
                   'destinationAndStagingMustRemain': True, 's3MutationAuthorized': False, 'gargyRemainsHeld': True}
        copied = {'success': True, 'issues': [], 'destination': {'projectId': '6ae4ac89a6b876c643741d27',
                  'relativeRoot': runner.DESTINATION}, 'files': 40, 'sha256Verified': 40, 'bytes': 41432635417,
                  'md5Verified': 31, 'graph': {'unchangedSincePostMd5': True}, 'controlsUnchanged': True,
                  'originalsDistinctFromCopies': True, 'stagingIntact': True,
                  'sourceProjects': [{'projectId': k, 'relativeRoot': v} for k, v in runner.TARGETS.items()]}
        receipts = {'summary.json': native, 'hold-release.json': release, 'destination-check.json': copied}
        if change: change(receipts)
        for name, obj in receipts.items(): (temporary / name).write_text(json.dumps(obj))
        hashes = {'REVIEW_SHA256': sha((temporary / 'summary.json').read_bytes()),
                  'RELEASE_SHA256': sha((temporary / 'hold-release.json').read_bytes()),
                  'DESTINATION_SHA256': sha((temporary / 'destination-check.json').read_bytes())}
        return p, hashes

    def test_valid_receipts_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp); p, hashes = self.fixture(directory)
            with patch.multiple(runner, **hashes): runner.check_release_evidence(p, directory)

    def test_changed_receipt_bytes_stop(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp); p, hashes = self.fixture(directory)
            (directory / 'summary.json').write_text('{}')
            with patch.multiple(runner, **hashes):
                with self.assertRaisesRegex(RuntimeError, 'receipt changed'): runner.check_release_evidence(p, directory)

    def test_unreleased_or_expanded_permission_stops(self):
        for flag, value in [('waitingForReplyWaivedByGeorge', False), ('sourceDeletionOnly', False),
                            ('destinationAndStagingMustRemain', False), ('s3MutationAuthorized', True),
                            ('gargyRemainsHeld', False)]:
            with self.subTest(flag=flag), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                p, hashes = self.fixture(directory, lambda rs: rs['hold-release.json'].update({flag: value}))
                with patch.multiple(runner, **hashes):
                    with self.assertRaises(RuntimeError): runner.check_release_evidence(p, directory)

    def test_failed_destination_or_graph_stops(self):
        for flag in ['success', 'controlsUnchanged', 'originalsDistinctFromCopies', 'stagingIntact']:
            with self.subTest(flag=flag), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                p, hashes = self.fixture(directory, lambda rs: rs['destination-check.json'].update({flag: False}))
                with patch.multiple(runner, **hashes):
                    with self.assertRaises(RuntimeError): runner.check_release_evidence(p, directory)


class ProtectedCopies(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / 'reads'; self.root.mkdir()
        self.root_patch = patch.object(runner, 'ROOT', self.root); self.root_patch.start()
        for rel in runner.PROTECTED_ROOTS: (self.root / rel).mkdir(parents=True)
        self.final = self.root / runner.DESTINATION / 'sample' / 'raw.fq'
        self.stage = self.root / runner.STAGING / 'sample' / 'raw.fq'
        self.final.parent.mkdir(); self.stage.parent.mkdir()
        self.final.write_bytes(b'ACGT'); os.link(self.final, self.stage)
        st = self.final.stat()
        self.plan = {'protectedFiles': [{'path': 'sample/raw.fq', 'bytes': st.st_size, 'ino': st.st_ino,
                                        'mtimeMs': st.st_mtime_ns / 1e6, 'ctimeMs': st.st_ctime_ns / 1e6, 'nlink': 2}]}

    def tearDown(self):
        self.root_patch.stop(); self.temporary.cleanup()

    def test_exact_copies_pass_without_touching_them(self):
        runner.check_protected(self.plan)
        self.assertEqual(self.final.read_bytes(), b'ACGT'); self.assertEqual(self.stage.read_bytes(), b'ACGT')

    def test_missing_destination_or_stage_stops(self):
        self.stage.unlink()
        with self.assertRaises(RuntimeError): runner.check_protected(self.plan)
        self.assertTrue(self.final.exists())

    def test_changed_copy_stops(self):
        self.final.write_bytes(b'TGCA')
        with self.assertRaisesRegex(RuntimeError, 'timestamps changed'): runner.check_protected(self.plan)

    def test_added_file_stops(self):
        (self.final.parent / 'extra').write_text('unexpected')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected file'): runner.check_protected(self.plan)

    def test_symlinked_protected_directory_stops(self):
        gargy = self.root / runner.HELD['5fc012bda3efcb29338b7d58']
        gargy.rmdir(); gargy.symlink_to(self.final.parent, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'missing or symlinked'): runner.check_protected(self.plan)

    def test_nested_mount_stops(self):
        with patch.object(runner.os.path, 'ismount', return_value=True):
            with self.assertRaisesRegex(RuntimeError, 'nested mount'): runner.check_protected(self.plan)


if __name__ == '__main__':
    unittest.main()
