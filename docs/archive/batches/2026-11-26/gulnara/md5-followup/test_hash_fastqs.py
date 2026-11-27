import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('hash_fastqs', Path(__file__).with_name('hash-fastqs.py'))
runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)


class HashTests(unittest.TestCase):
    def fixture(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        base = Path(temp.name).resolve(); root = base / 'project'; root.mkdir()
        review = {'kind': 'gulnara-md5-sidecar-readonly-review', 'projectId': runner.PROJECT, 'coverageComplete': True, 'conflicts': [], 'copyManifestSha256': 'a' * 64, 'fastqCount': 24, 'sidecarCount': 16, 'fastqs': [], 'sidecars': []}
        for sample in range(12):
            directory = root / ('sample%d' % sample); directory.mkdir(); sid = '%024x' % (sample + 1)
            rows = []
            for pair in (1, 2):
                p = directory / ('reads%d_%d.fq.gz' % (sample, pair)); content = ('sample%d-read%d-data' % (sample, pair)).encode() * 4; p.write_bytes(content)
                row = {'sampleId': sid, 'fileId': '%024x' % (100 + sample * 2 + pair), 'path': str(p), 'bytes': len(content), 'sealedSha256': hashlib.sha256(content).hexdigest(), 'expectedMd5FromSidecars': hashlib.md5(content).hexdigest(), 'sidecarFileIds': []}; rows.append(row); review['fastqs'].append(row)
            for side in range(2 if sample < 4 else 1):
                sub = directory / ('side%d' % side); sub.mkdir(); p = sub / 'MD5.txt'; content = ''.join(r['expectedMd5FromSidecars'] + '  ' + Path(r['path']).name + '\n' for r in rows).encode(); p.write_bytes(content)
                fid = '%024x' % (1000 + sample * 2 + side); review['sidecars'].append({'sampleId': sid, 'fileId': fid, 'path': str(p), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
                for row in rows:
                    row['sidecarFileIds'].append(fid)
        inp = base / 'review.json'; inp.write_text(json.dumps(review)); digest = hashlib.sha256(inp.read_bytes()).hexdigest()
        return base, root, review, inp, digest

    def test_all_hashes_sidecar_own_bytes_and_private_fresh_output(self):
        base, root, review, inp, digest = self.fixture(); out = base / 'result'
        result = runner.run(str(inp), str(out), digest, root=str(root))
        self.assertTrue(result['allVerified']); self.assertEqual(len(result['fastqs']), 24); self.assertEqual(len(result['sidecars']), 16)
        self.assertTrue(all(isinstance(value, str) for value in result['fastqs'][0]['record']['metadata'].values()))
        self.assertEqual(len(list(out.glob('fastq-*.json'))), 24); self.assertFalse((out / 'failed.json').exists())
        sidecar = result['sidecars'][0]['record']; self.assertEqual(sidecar['calculatedMd5'], hashlib.md5(Path(sidecar['path']).read_bytes()).hexdigest())
        self.assertEqual(out.stat().st_mode & 0o777, 0o700); self.assertEqual((out / 'completed.json').stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError): runner.run(str(inp), str(out), digest, root=str(root))

    def test_payload_mismatch_retains_successes_but_never_completes(self):
        base, root, review, inp, digest = self.fixture(); bad = Path(review['fastqs'][1]['path']); original = bad.read_bytes(); bad.write_bytes(bytes([original[0] ^ 1]) + original[1:]); out = base / 'failed'
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'): runner.run(str(inp), str(out), digest, root=str(root))
        self.assertFalse((out / 'completed.json').exists()); self.assertTrue((out / 'failed.json').exists()); self.assertEqual(len(list(out.glob('fastq-*.json'))), 1)

    def test_sidecar_seal_and_mapping_changes_fail_before_any_fastq_receipt(self):
        base, root, review, inp, digest = self.fixture(); Path(review['sidecars'][0]['path']).write_text('changed'); out = base / 'failed'
        with self.assertRaisesRegex(ValueError, 'Sidecar size/SHA256'): runner.run(str(inp), str(out), digest, root=str(root))
        self.assertFalse((out / 'completed.json').exists()); self.assertEqual(len(list(out.glob('fastq-*.json'))), 0)
        with self.assertRaisesRegex(ValueError, 'Duplicate sidecar'): runner.parse_sidecar(b'0' * 32 + b'  x\n' + b'1' * 32 + b'  x\n')

    def test_scope_duplicate_ids_omitted_sidecar_and_escape_are_refused(self):
        _, root, review, _, _ = self.fixture()
        for mutate in [lambda r: r['fastqs'][1].update(fileId=r['fastqs'][0]['fileId']), lambda r: r['fastqs'][0]['sidecarFileIds'].pop(), lambda r: r['fastqs'][0].update(path=str(root / '..' / 'foreign')), lambda r: r.update(projectId='f' * 24)]:
            changed = copy.deepcopy(review); mutate(changed)
            with self.assertRaises(ValueError): runner.validate_review(changed, str(root))

    def test_symlink_leaf_and_ancestor_are_refused(self):
        base, _, review, _, _ = self.fixture(); p = Path(review['fastqs'][0]['path']); saved = p.with_name('saved'); p.rename(saved); p.symlink_to(saved)
        with self.assertRaises(OSError): runner.hash_fastq(review['fastqs'][0])
        p.unlink(); saved.rename(p); alias = base / 'alias'; alias.symlink_to(p.parent, target_is_directory=True)
        changed = dict(review['fastqs'][0], path=str(alias / p.name))
        with self.assertRaises(OSError): runner.hash_fastq(changed)

    def test_same_size_write_during_hash_is_detected_even_with_restored_mtime(self):
        _, _, review, _, _ = self.fixture(); row = review['fastqs'][0]; p = Path(row['path']); original = p.read_bytes(); initial = p.stat(); touched = False
        def change(_):
            nonlocal touched
            if not touched:
                touched = True; p.write_bytes(bytes([original[0] ^ 1]) + original[1:]); os.utime(p, ns=(initial.st_atime_ns, initial.st_mtime_ns))
        with self.assertRaisesRegex(ValueError, 'metadata changed'): runner.hash_fastq(row, chunk_size=8, after_chunk=change)

    def test_review_digest_and_wrong_expected_md5_fail(self):
        base, root, review, inp, _ = self.fixture()
        with self.assertRaisesRegex(ValueError, 'input SHA256'): runner.run(str(inp), str(base / 'result'), '0' * 64, root=str(root))
        row = dict(review['fastqs'][0], expectedMd5FromSidecars='0' * 32)
        with self.assertRaisesRegex(ValueError, 'MD5 mismatch'): runner.hash_fastq(row)


if __name__ == '__main__':
    unittest.main()
