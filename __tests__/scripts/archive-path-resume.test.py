"""Local, synthetic evidence-aggregation tests. No SSH or database calls."""
import importlib.util
import pathlib
import sys
import unittest

sys.dont_write_bytecode = True

root = pathlib.Path(__file__).resolve().parents[2]
source = root / 'docs/archive/batches/2026-10-16/evidence/2026-10-17/resume-path-review.py'
spec = importlib.util.spec_from_file_location('archive_path_resume', source)
resume = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resume)


class EvidenceAssembly(unittest.TestCase):
    def setUp(self):
        self.original_targets = resume.targets
        resume.targets = [dict(entryId='synthetic', projectId='project', projectPath='/group/project', missing=[{'id':'a'}, {'id':'b'}])]

    def tearDown(self):
        resume.targets = self.original_targets

    def observation(self, read_id):
        candidate = dict(relPath=read_id, bytes=10, md5='a'*32, sha256='b'*64, stable=True)
        project = dict(entryId='synthetic', projectId='project', projectPath='/group/project', sourceRoot='/test-only/group/project',
                       inventoryRegularFiles=2, inventoryBytes=20, inventorySha256='c'*64,
                       treeUnchangedDuringAudit=True, uniqueFilesHashed=1,
                       records=[dict(readId=read_id, candidates=[candidate])])
        data = dict(startedAt='2026-10-17T01:00:00Z', finishedAt='2026-10-17T01:01:00Z',
                    gitBefore={'commit':'test','status':''}, gitAfter={'commit':'test','status':''},
                    moduleSha256={'test':'d'*64}, operator='synthetic', host='test-only', mode='paths', projects=[project])
        return data, {'receipt':read_id+'.command.json', 'output':read_id+'.json'}

    def test_combines_records_in_target_order_with_matching_full_tree_fingerprints(self):
        aggregate = resume.assemble([self.observation('b'), self.observation('a')])
        p=aggregate['projects'][0]
        self.assertEqual([r['readId'] for r in p['records']], ['a','b'])
        self.assertEqual(p['uniqueFilesHashed'], 2)
        self.assertEqual(p['observationMode'], 'per-record-with-identical-whole-tree-fingerprints')

    def test_rejects_changed_tree_fingerprint(self):
        a,b=self.observation('a'),self.observation('b')
        b[0]['projects'][0]['inventorySha256']='e'*64
        with self.assertRaises(AssertionError): resume.assemble([a,b])

    def test_requires_fingerprint_for_multi_observation_project(self):
        a,b=self.observation('a'),self.observation('b')
        del b[0]['projects'][0]['inventorySha256']
        with self.assertRaises(AssertionError): resume.assemble([a,b])

    def test_rejects_duplicate_record_instead_of_claiming_completeness(self):
        with self.assertRaises(AssertionError): resume.assemble([self.observation('a'),self.observation('a')])

    def test_rejects_missing_record(self):
        with self.assertRaises(AssertionError): resume.assemble([self.observation('a')])

    def test_rejects_changed_candidate_content_shared_by_records(self):
        a,b=self.observation('a'),self.observation('b')
        c=b[0]['projects'][0]['records'][0]['candidates'][0]
        c['relPath']='a';c['sha256']='f'*64
        with self.assertRaises(AssertionError): resume.assemble([a,b])

    def test_rejects_changed_code_between_observations(self):
        a,b=self.observation('a'),self.observation('b')
        b[0]['moduleSha256']['test']='e'*64
        with self.assertRaises(AssertionError): resume.assemble([a,b])

    def test_retains_complete_project_evidence_without_inventing_a_fingerprint(self):
        a,b=self.observation('a'),self.observation('b')
        p=a[0]['projects'][0];p['records'].extend(b[0]['projects'][0]['records'])
        del p['inventorySha256']
        result=resume.assemble([a])['projects'][0]
        self.assertEqual(result['observationMode'],'one-complete-project')
        self.assertNotIn('inventorySha256',result)
        self.assertEqual(result['uniqueFilesHashed'],2)


if __name__ == '__main__':
    unittest.main()
