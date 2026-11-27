import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('readonly_validator', HERE / 'verify-package-readonly.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.pack = Path(self.tmp.name).resolve()
        for name in validator.PACKAGE_FILES - {'SHA256SUMS'}:
            (self.pack / name).write_text('fixture: ' + name + '\n')
        self.reseal()
        self.plan_sha = validator.sha((self.pack / 'deletion-plan.json').read_bytes())
        self.runner_sha = validator.sha((self.pack / 'delete-reviewed-projects.py').read_bytes())

    def reseal(self):
        (self.pack / 'SHA256SUMS').write_text(''.join(
            validator.sha((self.pack / name).read_bytes()) + '  ' + name + '\n'
            for name in sorted(validator.PACKAGE_FILES - {'SHA256SUMS'})))

    def read(self):
        return validator.read_package(self.pack, self.plan_sha, self.runner_sha)

    def test_valid_package_is_unchanged(self):
        before = {p.name: p.read_bytes() for p in self.pack.iterdir()}
        self.assertEqual(self.read(), before)
        self.assertEqual({p.name: p.read_bytes() for p in self.pack.iterdir()}, before)

    def test_wrong_pinned_hashes_fail(self):
        with self.assertRaisesRegex(RuntimeError, 'Pinned plan'):
            validator.read_package(self.pack, '0' * 64, self.runner_sha)
        with self.assertRaisesRegex(RuntimeError, 'Pinned runner'):
            validator.read_package(self.pack, self.plan_sha, '0' * 64)

    def test_changed_receipt_fails(self):
        (self.pack / 'destination-check.json').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
            self.read()

    def test_extra_missing_and_symlink_package_members_fail(self):
        (self.pack / 'extra').write_text('x')
        with self.assertRaisesRegex(RuntimeError, 'file set'):
            self.read()
        (self.pack / 'extra').unlink()
        (self.pack / 'summary.json').unlink()
        with self.assertRaisesRegex(RuntimeError, 'file set'):
            self.read()
        (self.pack / 'summary.json').symlink_to(self.pack / 'README.md')
        with self.assertRaisesRegex(RuntimeError, 'Symlink'):
            self.read()

    def test_checksum_path_escape_fails(self):
        (self.pack / 'SHA256SUMS').write_text('0' * 64 + '  ../outside\n')
        with self.assertRaisesRegex(RuntimeError, 'Malformed'):
            self.read()

    def test_import_creates_no_bytecode_or_main_execution(self):
        (self.pack / 'delete-reviewed-projects.py').write_text(
            'def main():\n    raise AssertionError("main called")\n'
            'def remove_checked():\n    raise AssertionError("delete called")\n'
            'if __name__ == "__main__":\n    main()\n')
        before = set(self.pack.iterdir())
        validator.load_runner(self.pack, (self.pack / 'delete-reviewed-projects.py').read_bytes())
        self.assertEqual(set(self.pack.iterdir()), before)


class TranslationTests(unittest.TestCase):
    def setUp(self):
        self.checked = []
        self.physical = Path('/temporary-fixture-mount')
        self.runner = types.SimpleNamespace(
            ROOT=validator.HPC_ROOT, PLAN_SHA256='plan', TARGETS={'a': 'group/a', 'b': 'group/b'},
            PROTECTED_ROOTS={'group/retained'}, fresh=lambda plan: None,
            check_stage=lambda plan: None, check_release_evidence=lambda plan, pack: None,
            relative=lambda value: value,
            main=lambda: self.fail('Runner main must never be called'),
            remove_checked=lambda *args: self.fail('Deletion must never be called'))
        def protected(plan):
            self.assertEqual(self.runner.ROOT, self.physical)
            self.assertEqual(plan['hpcRoot'], str(validator.HPC_ROOT))
        def tree(project):
            self.assertEqual(self.runner.ROOT, self.physical)
            self.assertEqual(project['hpcPath'], str(self.physical / project['relativeRoot']))
            self.checked.append(project['projectId'])
            return Path(project['hpcPath'])
        self.runner.check_protected = protected
        self.runner.check_tree = tree
        self.plan = {'kind': 'komondor-reviewed-hpc-deletion-v1', 'hpcRoot': str(validator.HPC_ROOT),
                     'projects': [{'projectId': pid, 'relativeRoot': root, 'hpcPath': str(validator.HPC_ROOT / root),
                                   'nativeReviewPassed': True, 'fileCount': 1, 'bytes': 5}
                                  for pid, root in self.runner.TARGETS.items()]}

    def verify(self):
        return validator.validate_loaded_plan(self.runner, self.plan, Path('/fixture-pack'), 'plan', self.physical)

    def test_only_copied_paths_and_module_root_are_translated(self):
        original = copy.deepcopy(self.plan)
        result = self.verify()
        self.assertEqual(self.checked, ['a', 'b'])
        self.assertEqual(self.plan, original)
        self.assertEqual(self.runner.ROOT, validator.HPC_ROOT)
        self.assertEqual(result[0]['hpcPath'], '/tsl/data/reads/group/a')
        self.assertEqual(result[0]['vmPath'], '/temporary-fixture-mount/group/a')

    def test_changed_hpc_path_is_not_translated_or_checked(self):
        self.plan['projects'][0]['hpcPath'] = '/tsl/data/reads/group/retained'
        with self.assertRaisesRegex(RuntimeError, 'Original HPC path'):
            self.verify()
        self.assertEqual(self.checked, [])

    def test_failed_source_check_restores_root_and_preserves_plan(self):
        original = copy.deepcopy(self.plan)
        self.runner.check_tree = lambda project: (_ for _ in ()).throw(RuntimeError('source changed'))
        with self.assertRaisesRegex(RuntimeError, 'source changed'):
            self.verify()
        self.assertEqual(self.runner.ROOT, validator.HPC_ROOT)
        self.assertEqual(self.plan, original)

    def test_wrong_nfs_source_fails(self):
        wrong = {'filesystems': [{'target': '/mnt/reads', 'source': 'another:/reads', 'fstype': 'nfs4'}]}
        with patch.object(validator.subprocess, 'check_output', return_value=json.dumps(wrong)):
            with self.assertRaisesRegex(RuntimeError, 'Unexpected reads mount'):
                validator.inspect_mount()


if __name__ == '__main__':
    unittest.main()
