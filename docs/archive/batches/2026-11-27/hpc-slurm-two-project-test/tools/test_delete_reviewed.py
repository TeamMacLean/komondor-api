import importlib.util
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import datetime as dt
import copy
import json

spec = importlib.util.spec_from_file_location('deletion', Path(__file__).with_name('delete-reviewed-projects.py'))
deletion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deletion)


class Guards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'reads'
        self.root.mkdir()
        self.patch = patch.object(deletion, 'ROOT', self.root)
        self.patch.start()
        self.target = self.root / 'group' / 'project'
        (self.target / 'raw').mkdir(parents=True)
        self.file = self.target / 'raw' / 'reads.fq'
        self.file.write_bytes(b'@read\nACGT\n+\nIIII\n')
        self.held = self.root / 'group' / 'keep'
        self.held.mkdir(); (self.held / 'safe').write_text('retain')
        st = self.file.stat()
        self.project = {'projectId': 'test-only', 'relativeRoot': 'group/project',
                        'hpcPath': str(self.target), 'fileCount': 1, 'bytes': st.st_size,
                        'files': [{'path': 'raw/reads.fq', 'bytes': st.st_size, 'mtimeMs': st.st_mtime_ns/1e6,
                                   'ctimeMs': st.st_ctime_ns/1e6, 'ino': st.st_ino}]}

    def tearDown(self):
        self.patch.stop(); self.temp.cleanup()

    def test_valid_then_remove_only_exact_target(self):
        self.assertEqual(deletion.check_tree(self.project), self.target)
        events = []
        deletion.remove_checked(self.project, events.append)
        self.assertFalse(self.target.exists())
        self.assertEqual((self.held / 'safe').read_text(), 'retain')
        self.assertEqual([e['event'] for e in events], ['deletion-started', 'deleted'])

    def test_added_file_prevents_any_deletion(self):
        (self.target / 'new.fastq').write_text('new data')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected file'):
            deletion.remove_checked(self.project, lambda e: None)
        self.assertTrue(self.file.exists())

    def test_same_size_changed_file_stops(self):
        self.file.write_bytes(b'X' * self.file.stat().st_size)
        with self.assertRaisesRegex(RuntimeError, 'time changed'):
            deletion.check_tree(self.project)

    def test_missing_file_stops(self):
        self.file.unlink()
        with self.assertRaisesRegex(RuntimeError, 'Files missing'):
            deletion.check_tree(self.project)

    def test_symlink_to_retained_data_stops(self):
        (self.target / 'keep-link').symlink_to(self.held, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'Symlink'):
            deletion.check_tree(self.project)
        self.assertTrue((self.held / 'safe').exists())

    def test_target_symlink_stops(self):
        moved = self.target.with_name('moved')
        self.target.rename(moved); self.target.symlink_to(moved, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'symlinked'):
            deletion.check_tree(self.project)

    def test_nested_mount_stops(self):
        with patch.object(deletion.os.path, 'ismount', return_value=True):
            with self.assertRaisesRegex(RuntimeError, 'mount'):
                deletion.check_tree(self.project)

    def test_path_traversal_and_group_root_stop(self):
        for value in ('../outside', '/outside', 'a//b', 'a/../b', 'a/./b'):
            with self.assertRaises(RuntimeError):
                deletion.relative(value)
        self.project['relativeRoot'] = 'group'
        with self.assertRaisesRegex(RuntimeError, 'group/root'):
            deletion.check_tree(self.project)

    def test_stale_review_stops(self):
        now = dt.datetime.now(dt.timezone.utc)
        plan = {'reviewCompletedAt': (now-dt.timedelta(hours=7)).isoformat(),
                'expiresAt': (now-dt.timedelta(hours=1)).isoformat()}
        with self.assertRaisesRegex(RuntimeError, 'Review expired'):
            deletion.fresh(plan)
        plan = {'reviewCompletedAt': (now-dt.timedelta(minutes=1)).isoformat(),
                'expiresAt': (now+dt.timedelta(hours=7)).isoformat()}
        with self.assertRaisesRegex(RuntimeError, 'six hours'):
            deletion.fresh(plan)

    def test_missing_delete_permission_stops_before_rm(self):
        with patch.object(deletion.os, 'access', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'Cannot remove Project'):
                deletion.remove_checked(self.project, lambda e: None)
        self.assertTrue(self.file.exists())

    def test_failed_rm_has_no_success_receipt(self):
        events = []
        with patch.object(deletion.subprocess, 'run', side_effect=RuntimeError('permission denied')):
            with self.assertRaisesRegex(RuntimeError, 'permission denied'):
                deletion.remove_checked(self.project, events.append)
        self.assertEqual([e['event'] for e in events], ['deletion-started'])
        self.assertTrue(self.file.exists())


if __name__ == '__main__':
    unittest.main()
