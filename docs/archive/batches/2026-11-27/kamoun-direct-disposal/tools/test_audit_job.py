import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('kamoun_job_audit', HERE / 'audit-job.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.plan_raw = (HERE.parent / 'komondor-kamoun-six-delete-20261127-01/deletion-plan.json').read_bytes()
        self.plan = json.loads(self.plan_raw)
        self.events = [{'event': 'started', 'execute': True, 'host': 't384n18', 'uid': 14014,
                        'slurmJobId': audit.JOB_ID, 'planSha256': audit.PLAN_SHA, 'stage': 'kamoun-six-no-s3', 'retirementReceiptSha256': audit.RETIREMENT_SHA, 'noS3Copy': True, 'mount': {'mountAncestor':'/tsl/data','device':50}}]
        self.events += [{'event': 'preflight-passed', 'projectId': p['projectId']} for p in self.plan['projects']]
        for p in self.plan['projects']:
            self.events += [{'event': 'deletion-started', 'projectId': p['projectId'], 'path': p['hpcPath']},
                            {'event': 'deleted', 'projectId': p['projectId'], 'path': p['hpcPath'], 'files': p['fileCount'], 'bytes': p['bytes'], 'noS3Copy': True}]
        self.events += [{'event': 'complete', 'projects': 6, 'files': 1217, 'bytes': 790004575062, 'protectedRootsIntact': True, 'retiredRecordsRetained': True, 'noS3Copy': True, 'independentAbsenceConfirmationRequired': True}]
        start = datetime(2026, 11, 27, 15, 20, 00, tzinfo=timezone.utc)
        for n, event in enumerate(self.events):
            event['at'] = (start + timedelta(seconds=n)).isoformat()

    def logs(self, events=None):
        events = self.events if events is None else events
        jsonl = ''.join(json.dumps(event, sort_keys=True) + '\n' for event in events)
        stdout = ''.join(name + ': OK\n' for name in sorted(audit.CHECKSUM_NAMES))
        stdout += 'Job=25342010 Tasks=1 CPUsPerTask=1 Nodes=1 MemoryPerNodeMB=1024\nt384n18\nPython 3.9.25\nrm (GNU coreutils) 8.32\n'
        stdout += jsonl
        stdout += '\tCommand being timed: "python3 delete-direct-disposal.py --plan deletion-plan.json --sha256 ' + audit.PLAN_SHA + ' --execute --log deletion-25342010.jsonl"\n'
        stdout += ('\tUser time (seconds): 0.5\n\tSystem time (seconds): 0.4\n'
                   '\tPercent of CPU this job got: 3%\n'
                   '\tElapsed (wall clock) time (h:mm:ss or m:ss): 0:32.00\n'
                   '\tMaximum resident set size (kbytes): 17000\n'
                   '\tSwaps: 0\n\tSignals delivered: 0\n\tExit status: 0\n')
        return jsonl.encode(), stdout.encode()

    def run_audit(self, events=None):
        return audit.audit_bytes(self.plan_raw, *self.logs(events))

    def test_exact_success(self):
        result = self.run_audit()
        self.assertTrue(result['success'])
        self.assertEqual(result['events']['total'], 20)
        self.assertEqual(result['bytes'], 790004575062)
        self.assertFalse(result['schedulerFinalStateIndependentlyVerified'])
        self.assertEqual(result['slurmStatus']['source'], 'not-supplied')

    def test_wrong_plan_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Pinned deletion plan'):
            audit.audit_bytes(self.plan_raw + b' ', *self.logs())

    def test_duplicate_or_missing_event_is_rejected(self):
        for events in (self.events + [self.events[-1]], self.events[:-1]):
            with self.assertRaisesRegex(ValueError, 'event count'):
                self.run_audit(events)

    def test_all_preflights_must_precede_deletions(self):
        changed = copy.deepcopy(self.events)
        changed[6], changed[7] = changed[7], changed[6]
        for a, b in zip(changed, self.events):
            a['at'] = b['at']
        with self.assertRaises(ValueError):
            self.run_audit(changed)

    def test_wrong_identity_path_bytes_and_flags_fail(self):
        for index, key, value in [(0, 'slurmJobId', 'other'), (0, 'execute', False),
                                  (7, 'path', '/tsl/data/reads/skamoun'), (8, 'bytes', 1), (8, 'files', 1),
                                  (19, 'protectedRootsIntact', False), (19, 'noS3Copy', False), (0, 'uid', 1),
                                  (19, 'independentAbsenceConfirmationRequired', False)]:
            with self.subTest(key=key):
                changed = copy.deepcopy(self.events); changed[index][key] = value
                with self.assertRaisesRegex(ValueError, 'Event identity'):
                    self.run_audit(changed)

    def test_expired_or_reversed_event_time_fails(self):
        for when in ('2026-11-27T21:00:00+00:00', '2026-11-27T15:19:59+00:00'):
            changed = copy.deepcopy(self.events); changed[-1]['at'] = when
            with self.assertRaisesRegex(ValueError, 'Event time/order'):
                self.run_audit(changed)

    def test_job_cannot_predate_retirement_or_release(self):
        changed = copy.deepcopy(self.events)
        start = datetime(2026, 11, 27, 15, 5, 0, tzinfo=timezone.utc)
        for index, event in enumerate(changed):
            event['at'] = (start + timedelta(seconds=index)).isoformat()
        with self.assertRaisesRegex(ValueError, 'before retirement or release'):
            self.run_audit(changed)

    def test_stdout_must_embed_exact_jsonl(self):
        raw, out = self.logs()
        with self.assertRaisesRegex(ValueError, 'Embedded stdout'):
            audit.audit_bytes(self.plan_raw, raw, out.replace(b'"uid": 14014', b'"uid": 9'))

    def test_failure_diagnostic_rejected_even_with_success_receipt(self):
        raw, out = self.logs()
        out = out.replace(b'\tExit status: 0', b'Permission denied\n\tExit status: 0')
        with self.assertRaisesRegex(ValueError, 'Failure diagnostic'):
            audit.audit_bytes(self.plan_raw, raw, out)

    def test_missing_checksum_nonzero_exit_wrong_allocation_fail(self):
        raw, out = self.logs()
        for old, new in [(b'retirement-receipt.json: OK\n', b''), (b'Exit status: 0', b'Exit status: 1'),
                         (b'CPUsPerTask=1', b'CPUsPerTask=2')]:
            with self.subTest(old=old):
                with self.assertRaises(ValueError):
                    audit.audit_bytes(self.plan_raw, raw, out.replace(old, new))

    def test_duplicate_json_keys_are_rejected(self):
        raw, out = self.logs()
        old = b'"uid": 14014'
        new = b'"uid": 1, "uid": 14014'
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            audit.audit_bytes(self.plan_raw, raw.replace(old, new), out.replace(old, new))


if __name__ == '__main__':
    unittest.main()
