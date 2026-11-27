import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    loaded = importlib.util.module_from_spec(spec); spec.loader.exec_module(loaded); return loaded


helper = module('disposal_inventory_test', 'inventory_direct_disposal.py')
runner = module('disposal_runner_test', 'delete-direct-disposal.py')


class InventoryGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        tiny = {pid: (row[0], row[1], 1, 4) for pid, row in helper.TARGETS.items()}
        self.targets = patch.object(helper, 'TARGETS', tiny); self.targets.start(); self.addCleanup(self.targets.stop)
        self.projects = []
        for pid, (entry, relative, count, size) in tiny.items():
            folder = self.root / relative; folder.mkdir(parents=True)
            project = {'entryId': entry, 'projectId': pid, 'relativeRoot': relative, 'fileCount': count, 'bytes': size}
            if pid == helper.KNOWN_LINK_PROJECT:
                link = folder / helper.KNOWN_LINK_PATH; link.parent.mkdir(parents=True)
                (link.parent / helper.KNOWN_LINK_TARGET).write_bytes(b'data')
                link.symlink_to(helper.KNOWN_LINK_TARGET)
            else:
                (folder / 'reads.fq').write_bytes(b'data')
            self.projects.append(project)
        self.snapshots = [helper.scan_tree(self.root, p) for p in self.projects]
        self.baselines = []
        for snapshot in self.snapshots:
            old = copy.deepcopy(snapshot)
            old['entries'] = [{key: e[key] for key in ('path', 'type', 'size', 'linkTarget') if key in e and (key != 'size' or e['type'] != 'dir')} for e in old['entries']]
            self.baselines.append(old)
        self.held = [{'projectId': pid, 'relativeRoot': helper.PINNED_HELD.get(pid, 'skamoun/keep_' + pid)} for pid in sorted(helper.HELD_IDS)]
        for item in self.held:
            (self.root / item['relativeRoot']).mkdir(parents=True)

    def test_exact_fixture_paths_sizes_metadata_and_known_link(self):
        # Fixture tests deliberately reduce file sizes; production baseline seal is tested separately.
        for now, old in zip(self.snapshots, self.baselines):
            helper.compare_historical(now, old); helper.compare_fresh(helper.scan_tree(self.root, now), now)
        self.assertEqual(len(helper.check_held(self.root, self.held)), 13)
        self.assertEqual(sum(e['type'] == 'symlink' for p in self.snapshots for e in p['entries']), 1)

    def test_unexpected_added_or_missing_file_rejected(self):
        p = self.projects[0]; target = self.root / p['relativeRoot']
        (target / 'extra').write_bytes(b'')
        with self.assertRaisesRegex(RuntimeError, 'totals differ'):
            helper.scan_tree(self.root, p)
        (target / 'extra').unlink(); (target / 'reads.fq').unlink()
        with self.assertRaisesRegex(RuntimeError, 'totals differ'):
            helper.scan_tree(self.root, p)

    def test_same_count_size_wrong_path_rejected(self):
        p = self.projects[0]; target = self.root / p['relativeRoot']
        (target / 'reads.fq').rename(target / 'renamed.fq')
        with self.assertRaisesRegex(RuntimeError, 'Source paths changed'):
            helper.compare_historical(helper.scan_tree(self.root, p), self.baselines[0])

    def test_fresh_metadata_change_rejected(self):
        p = self.projects[0]; target = self.root / p['relativeRoot'] / 'reads.fq'
        target.write_bytes(b'edit')
        with self.assertRaisesRegex(RuntimeError, 'metadata changed'):
            helper.compare_fresh(helper.scan_tree(self.root, p), self.snapshots[0])

    def test_known_link_retarget_or_target_symlink_rejected(self):
        p = next(p for p in self.projects if p['projectId'] == helper.KNOWN_LINK_PROJECT)
        link = self.root / p['relativeRoot'] / helper.KNOWN_LINK_PATH
        link.unlink(); link.symlink_to('/outside')
        with self.assertRaisesRegex(RuntimeError, 'Known symlink target differs'):
            helper.scan_tree(self.root, p)
        link.unlink(); link.symlink_to(helper.KNOWN_LINK_TARGET)
        target = link.parent / helper.KNOWN_LINK_TARGET; target.unlink(); target.symlink_to('/outside')
        with self.assertRaises(RuntimeError):
            helper.scan_tree(self.root, p)

    def test_unreviewed_directory_symlink_never_traversed(self):
        p = self.projects[0]; target = self.root / p['relativeRoot']
        (target / 'outside').symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'Unreviewed symlink'):
            helper.scan_tree(self.root, p)

    def test_new_hardlink_rejected(self):
        p = self.projects[0]; target = self.root / p['relativeRoot']
        os.link(target / 'reads.fq', self.root / 'outside-hardlink')
        with self.assertRaisesRegex(RuntimeError, 'hardlinked'):
            helper.scan_tree(self.root, p)

    def test_nested_mount_and_symlinked_root_rejected(self):
        p = self.projects[0]; target = self.root / p['relativeRoot']; (target / 'nested').mkdir()
        real = os.path.ismount
        with patch.object(helper.os.path, 'ismount', side_effect=lambda x: Path(x) == target / 'nested' or real(x)):
            with self.assertRaisesRegex(RuntimeError, 'Nested mount'):
                helper.scan_tree(self.root, p)
        outside = self.root / 'held-away'; target.rename(outside); target.symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, 'symlinked'):
            helper.scan_tree(self.root, p)

    def test_exact_held_ids_and_overlap(self):
        with self.assertRaises(RuntimeError):
            helper.held_paths(self.held[:-1])
        changed = copy.deepcopy(self.held)
        chosen = next(p for p in changed if p['projectId'] not in helper.PINNED_HELD)
        chosen['relativeRoot'] = self.projects[0]['relativeRoot'] + '/nested'
        with self.assertRaisesRegex(RuntimeError, 'overlap'):
            helper.held_paths(changed)

    def test_mount_local_device_number_can_differ_only(self):
        changed = copy.deepcopy(self.snapshots[0]); changed['rootMetadata']['dev'] += 10
        for e in changed['entries']: e['dev'] += 10
        helper.compare_fresh(changed, self.snapshots[0])
        changed['entries'][0]['ino'] += 1
        with self.assertRaises(RuntimeError): helper.compare_fresh(changed, self.snapshots[0])

    def test_rm_receives_only_exact_checked_target(self):
        p = self.snapshots[0]; events = []; target = self.root / p['relativeRoot']
        def remove(args, check):
            self.assertEqual(args, ['rm', '-rf', '--one-file-system', '--', str(target)])
            self.assertTrue(check); shutil.rmtree(target)
        with patch.object(runner, 'ROOT', self.root), patch.object(runner.subprocess, 'run', side_effect=remove):
            runner.remove_checked(p, helper, events.append)
        self.assertEqual([x['event'] for x in events], ['deletion-started', 'deleted'])
        self.assertEqual(len(helper.check_held(self.root, self.held)), 13)

    def test_failed_rm_emits_no_success(self):
        p = self.snapshots[0]; events = []
        with patch.object(runner, 'ROOT', self.root), patch.object(runner.subprocess, 'run', side_effect=RuntimeError('rm failed')):
            with self.assertRaisesRegex(RuntimeError, 'rm failed'):
                runner.remove_checked(p, helper, events.append)
        self.assertEqual([x['event'] for x in events], ['deletion-started'])


class SealsAndRelease(unittest.TestCase):
    def test_real_baseline_is_pinned(self):
        value = helper.load_baseline(HERE / 'sealed-source-baseline.json')
        self.assertEqual(sum(p['fileCount'] for p in value['projects']), 1217)
        self.assertEqual(sum(p['bytes'] for p in value['projects']), 790004575062)

    def test_draft_hashes_are_not_release_hashes(self):
        for value in (runner.PLAN_SHA256, runner.HELPER_SHA256, runner.INVENTORY_SHA256, runner.RETIREMENT_SHA256):
            self.assertNotEqual(len(value), 64)

    def test_freshness_requires_at_most_six_hours(self):
        now = datetime.now(timezone.utc)
        plan = {'reviewCompletedAt': (now-timedelta(minutes=1)).isoformat(), 'expiresAt': (now+timedelta(hours=1)).isoformat()}
        runner.fresh(plan)
        plan['expiresAt'] = (now+timedelta(hours=7)).isoformat()
        with self.assertRaisesRegex(RuntimeError, 'six hours'): runner.fresh(plan)
        plan['expiresAt'] = (now-timedelta(seconds=1)).isoformat()
        with self.assertRaisesRegex(RuntimeError, 'expired'): runner.fresh(plan)

    def test_wrong_vm_mount_rejected(self):
        raw = json.dumps({'filesystems':[{'target':'/mnt/reads','source':'other:/reads','fstype':'nfs'}]})
        with patch.object(helper.subprocess, 'check_output', return_value=raw):
            with self.assertRaisesRegex(RuntimeError, 'Unexpected reads mount'): helper.inspect_mount(Path('/mnt/reads'))


class RetirementGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.pack = Path(self.tmp.name).resolve()
        now = datetime.now(timezone.utc)
        projects = []
        for pid, (entry, relative, count, size) in helper.TARGETS.items():
            projects.append({'projectId':pid, 'entryId':entry, 'relativeRoot':relative,
                             'fileCount':count, 'bytes':size, 'hpcPath':'/tsl/data/reads/'+relative})
        held = [{'projectId':pid,'relativeRoot':helper.PINNED_HELD.get(pid,'skamoun/keep_'+pid)} for pid in sorted(helper.HELD_IDS)]
        self.inventory = {'kind':'kamoun-direct-disposal-inventory-v1','success':True,
                          'at':(now-timedelta(minutes=1)).isoformat(), 'projects':projects, 'heldPaths':held,
                          'baselineSha256':helper.BASELINE_SHA256,'historicalPathsTypesAndSizesMatched':True,
                          'sourceMetadataStable':True,'regularFiles':1217,'regularBytes':790004575062,'symlinks':1}
        self.retirement = {'kind':'komondor-direct-disposal-retirement-v1','success':True,'operator':'deeks',
                           'retiredProjects':6,'projectIds':list(helper.TARGETS),'planSha256':'f'*64,
                           'at':(now-timedelta(seconds=30)).isoformat(),
                           'dependentRecordsRetained':True,'beforeImagesVerified':True,'writesBlocked':True,
                           'externalWritersFrozen':True,'noS3Copy':True,'manualFilesystemDeletionRequired':True,
                           'sourceInventoryUnchanged':True}
        self.plan = {'kind':'komondor-direct-disposal-plan-v1','stage':'kamoun-six-no-s3',
                     'releaseStatus':'ready-for-user-submission','hpcRoot':'/tsl/data/reads',
                     'baselineSha256':helper.BASELINE_SHA256, 'projects':projects,'heldPaths':held,
                     'retirementPlanSha256':'f'*64,'reviewCompletedAt':self.inventory['at'],
                     'planCreatedAt':now.isoformat(),'expiresAt':(now+timedelta(hours=5)).isoformat(),
                     'authorization':{'operator':'deeks','deleteWithoutS3':True,'manualHpcSubmissionRequired':True,
                                      'userInstruction':'Explicit fixture authority','sourceProjectIds':list(helper.TARGETS)}}

    def validate(self):
        inv=json.dumps(self.inventory).encode();ret=json.dumps(self.retirement).encode()
        (self.pack/'inventory.json').write_bytes(inv);(self.pack/'retirement-receipt.json').write_bytes(ret)
        self.plan['inventorySha256']=hashlib.sha256(inv).hexdigest()
        self.plan['retirementReceiptSha256']=hashlib.sha256(ret).hexdigest()
        with patch.object(runner,'INVENTORY_SHA256',self.plan['inventorySha256']),patch.object(runner,'RETIREMENT_SHA256',self.plan['retirementReceiptSha256']):
            return runner.verify_plan(self.plan,self.pack,helper)

    def test_completed_retirement_gate_passes(self):
        self.assertEqual(set(self.validate()),{'inventory.json','retirement-receipt.json'})

    def test_every_retirement_safety_condition_required(self):
        for key in ('dependentRecordsRetained','beforeImagesVerified','writesBlocked','externalWritersFrozen',
                    'noS3Copy','manualFilesystemDeletionRequired','sourceInventoryUnchanged'):
            with self.subTest(key=key):
                self.retirement[key]=False
                with self.assertRaisesRegex(RuntimeError,'safety condition missing'): self.validate()
                self.retirement[key]=True

    def test_partial_or_wrong_project_retirement_rejected(self):
        self.retirement['retiredProjects']=5
        with self.assertRaisesRegex(RuntimeError,'retirement receipt missing'): self.validate()
        self.retirement['retiredProjects']=6;self.retirement['projectIds'][0]='other'
        with self.assertRaisesRegex(RuntimeError,'Retirement scope'): self.validate()

    def test_no_s3_authority_and_manual_step_required(self):
        for key in ('deleteWithoutS3','manualHpcSubmissionRequired'):
            self.plan['authorization'][key]=False
            with self.assertRaisesRegex(RuntimeError,'authority missing'):self.validate()
            self.plan['authorization'][key]=True

    def test_retirement_plan_or_temporal_order_cannot_change(self):
        self.retirement['planSha256']='e'*64
        with self.assertRaisesRegex(RuntimeError,'plan identity'):self.validate()
        self.retirement['planSha256']='f'*64
        self.retirement['at']='2026-01-01T00:00:00+00:00'
        with self.assertRaisesRegex(RuntimeError,'order is incorrect'):self.validate()

    def test_wrong_receipt_digest_rejected_before_trust(self):
        self.validate()
        with patch.object(runner,'INVENTORY_SHA256',self.plan['inventorySha256']),patch.object(runner,'RETIREMENT_SHA256',self.plan['retirementReceiptSha256']):
            (self.pack/'retirement-receipt.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError,'receipt changed'):runner.verify_plan(self.plan,self.pack,helper)


if __name__ == '__main__':
    unittest.main()
