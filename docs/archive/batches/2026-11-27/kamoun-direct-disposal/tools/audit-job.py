#!/usr/bin/env python3
"""Audit the exact Kamoun no-S3 Slurm receipts locally; never contact HPC, AWS or MongoDB."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

JOB_ID = '25342010'
PLAN_SHA = '9830c9b1e81a6d5100dd99331fffb57dd2794cc592bb231c5b53b4e295271d55'
RETIREMENT_SHA = 'db51476307a2365576f3aa513a65efc5c367fab78ea57464a55c0319a6c56b7a'
JSONL_NAME = 'deletion-' + JOB_ID + '.jsonl'
STDOUT_NAME = 'komondor-kamoun-6-' + JOB_ID + '.log'
TARGETS = {
    '5fc012bda3efcb29338b7cf9': ('skamoun/saunderd_pstriiformis_Project_TCS_ClareLewis_JIC.CL.20130227.01', 260, 48614994012),
    '5fc012bda3efcb29338b7cf5': ('skamoun/saunderd_pstriiformis_South_African_isolates', 24, 109802811903),
    '5fc012bda3efcb29338b7d5c': ('skamoun/saunderd_pstriiformis_TSL.DS.20130516.01_TCS_68', 106, 72013629033),
    '5fc012bda3efcb29338b7d7a': ('skamoun/xiao_scr74', 62, 161447455740),
    '5fc012bda3efcb29338b7d0d': ('skamoun/saunderd_pstriiformis_Project_GEL139_ClareLewis_JIC.CL.20121001.01', 641, 239985996303),
    '5fc012bda3efcb29338b7cf8': ('skamoun/saunderd_pstriiformis_TSL.DS.20130626.01_TCS_83', 124, 158139688071),
}
CHECKSUM_NAMES = {
    'HELD_PATHS.txt', 'HPC_PATHS.txt', 'PROJECTS.tsv', 'README.md',
    'delete-direct-disposal.py', 'delete.sbatch', 'deletion-plan.json',
    'inventory.json', 'inventory_direct_disposal.py', 'retirement-receipt.json', 'sealed-source-baseline.json',
}
EVENT_COUNTS = {'started': 1, 'preflight-passed': 6, 'deletion-started': 6,
                'deleted': 6, 'complete': 1}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, 'Duplicate JSON key: ' + key)
        value[key] = item
    return value


def parse_json(raw):
    return json.loads(raw, object_pairs_hook=unique_object,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite JSON value')))


def timestamp(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None and result.utcoffset().total_seconds() == 0,
            'Expected a UTC timestamp')
    return result


def read_regular(path):
    require(path.name in {'deletion-plan.json', JSONL_NAME, STDOUT_NAME}, 'Unexpected input filename')
    current = Path(path.absolute().anchor)
    for part in path.absolute().parts[1:]:
        current /= part
        require(not current.is_symlink(), 'Symlink in evidence path')
    require(stat.S_ISREG(path.lstat().st_mode), 'Evidence is not a regular file')
    return path.read_bytes()


def exact(event, expected):
    require(set(event) == set(expected) | {'at'}, 'Unexpected event fields: ' + str(event.get('event')))
    require(all(type(event[key]) is type(value) and event[key] == value for key, value in expected.items()),
            'Event identity, flags, path or bytes differ: ' + str(event.get('event')))


def one_match(pattern, text, name, flags=re.MULTILINE):
    matches = re.findall(pattern, text, flags)
    require(len(matches) == 1, 'Missing or repeated ' + name)
    return matches[0]


def audit_bytes(plan_raw, jsonl_raw, stdout_raw):
    require(sha(plan_raw) == PLAN_SHA, 'Pinned deletion plan differs')
    plan = parse_json(plan_raw)
    require(plan['kind'] == 'komondor-direct-disposal-plan-v1' and
            plan['stage'] == 'kamoun-six-no-s3' and plan['releaseStatus'] == 'ready-for-user-submission',
            'Unreleased or wrong deletion plan')
    projects = plan['projects']
    require(len(projects) == 6 and {p['projectId'] for p in projects} == set(TARGETS), 'Plan Project scope differs')
    targets = []
    for project in projects:
        relative, count, size = TARGETS[project['projectId']]
        require(project['relativeRoot'] == relative and project['hpcPath'] == '/tsl/data/reads/' + relative
                and project['fileCount'] == count and project['bytes'] == size, 'Plan target details differ')
        targets.append({'projectId': project['projectId'], 'hpcPath': project['hpcPath'], 'files': count, 'bytes': size})
    require(sum(p['files'] for p in targets) == 1217 and sum(p['bytes'] for p in targets) == 790004575062,
            'Plan totals differ')
    reviewed, expiry = timestamp(plan['reviewCompletedAt']), timestamp(plan['expiresAt'])
    require(0 < (expiry - reviewed).total_seconds() <= 21600, 'Wrong review expiry')
    require(jsonl_raw.endswith(b'\n'), 'Incomplete JSONL final line')
    lines = jsonl_raw.decode('utf-8').splitlines()
    require(len(lines) == 20 and all(line and line == line.strip() for line in lines), 'Wrong JSONL event count or blank lines')
    events = [parse_json(line) for line in lines]
    require(all(type(event) is dict for event in events), 'Event is not an object')
    counts = dict(Counter(event.get('event') for event in events))
    require(counts == EVENT_COUNTS, 'Duplicate, missing, unexpected or failed events')
    times = [timestamp(event['at']) for event in events]
    require(times == sorted(times) and all(reviewed <= at <= expiry for at in times), 'Event time/order outside review')
    require(plan['retirementReceiptSha256'] == RETIREMENT_SHA and
            reviewed <= timestamp(plan['retirementCompletedAt']) <= timestamp(plan['planCreatedAt']) <= times[0],
            'Job began before retirement or release')
    host = events[0].get('host')
    require(isinstance(host, str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}', host), 'Invalid execution host')
    mount = events[0].get('mount')
    require(type(mount) is dict and set(mount) == {'mountAncestor', 'device'}, 'Invalid mount receipt')
    ancestor = mount.get('mountAncestor')
    require(type(ancestor) is str and ancestor in {'/tsl', '/tsl/data', '/tsl/data/reads'}
            and type(mount['device']) is int and mount['device'] > 0, 'Invalid HPC mount ancestry')
    exact(events[0], {'event': 'started', 'execute': True, 'host': host, 'uid': 14014,
                      'slurmJobId': JOB_ID, 'planSha256': PLAN_SHA, 'stage': 'kamoun-six-no-s3',
                      'retirementReceiptSha256': RETIREMENT_SHA, 'noS3Copy': True, 'mount': mount})
    for index, project in enumerate(projects):
        exact(events[index + 1], {'event': 'preflight-passed', 'projectId': project['projectId']})
        exact(events[7 + 2 * index], {'event': 'deletion-started', 'projectId': project['projectId'], 'path': project['hpcPath']})
        exact(events[8 + 2 * index], {'event': 'deleted', 'projectId': project['projectId'], 'path': project['hpcPath'], 'files': project['fileCount'], 'bytes': project['bytes'], 'noS3Copy': True})
    exact(events[-1], {'event': 'complete', 'projects': 6, 'files': 1217, 'bytes': 790004575062,
                       'retiredRecordsRetained': True, 'protectedRootsIntact': True, 'noS3Copy': True,
                       'independentAbsenceConfirmationRequired': True})
    require(times[-1] >= times[0], 'Completion precedes start')

    text = stdout_raw.decode('utf-8')
    require(text.endswith('\n') and '\x00' not in text and '\r' not in text, 'Incomplete or malformed job stdout')
    embedded = [line for line in text.splitlines() if line.startswith('{')]
    require(embedded == lines, 'Embedded stdout audit differs from JSONL')
    require(not re.search(r'(?im)STOPPED|Traceback|Permission denied|No such file|command terminated|command exited with non-zero|^.*:\s*FAILED\s*$', text),
            'Failure diagnostic in job stdout')
    passed_checks = re.findall(r'^([A-Za-z0-9_.-]+): OK$', text, re.MULTILINE)
    require(len(passed_checks) == 11 and set(passed_checks) == CHECKSUM_NAMES, 'Package checksums incomplete or repeated')
    require(text.splitlines()[:11] == [name + ': OK' for name in passed_checks], 'Package checks did not run first')
    allocation = 'Job=' + JOB_ID + ' Tasks=1 CPUsPerTask=1 Nodes=1 MemoryPerNodeMB=1024'
    require(text.splitlines()[11] == allocation and text.splitlines()[12] == host, 'Job allocation/host differs')
    require(text.count(allocation) == 1, 'Repeated job allocation')
    command = 'python3 delete-direct-disposal.py --plan deletion-plan.json --sha256 ' + PLAN_SHA + ' --execute --log ' + JSONL_NAME
    timed_command = one_match(r'^\s*Command being timed: "(.*)"$', text, 'timed command')
    require(timed_command == command, 'Timed command scope differs')
    time_index = text.index('Command being timed:')
    require(time_index > text.index(lines[-1]) and text.rfind(lines[-1]) == text.index(lines[-1]), 'Time report precedes completion or log repeated')
    exit_status = int(one_match(r'^\s*Exit status: (\d+)$', text, 'process exit status'))
    require(exit_status == 0 and text.rstrip().endswith('Exit status: 0'), 'Process did not finish with exit 0')
    gnu_time = {
        'userCpuSeconds': float(one_match(r'^\s*User time \(seconds\): ([0-9.]+)$', text, 'user CPU time')),
        'systemCpuSeconds': float(one_match(r'^\s*System time \(seconds\): ([0-9.]+)$', text, 'system CPU time')),
        'cpuPercent': int(one_match(r'^\s*Percent of CPU this job got: (\d+)%$', text, 'CPU percentage')),
        'wallClock': one_match(r'^\s*Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): ([0-9:.]+)$', text, 'wall time'),
        'maximumResidentKiB': int(one_match(r'^\s*Maximum resident set size \(kbytes\): (\d+)$', text, 'peak memory')),
        'swaps': int(one_match(r'^\s*Swaps: (\d+)$', text, 'swap count')),
        'signalsDelivered': int(one_match(r'^\s*Signals delivered: (\d+)$', text, 'signal count')),
        'processExitStatus': exit_status,
    }
    require(gnu_time['signalsDelivered'] == 0, 'Signals delivered during job')
    snapshot = None
    if 'JobId=' in text:
        require(one_match(r'^JobId=(\d+) JobName=(\S+)$', text, 'scontrol job identity') == (JOB_ID, 'komondor-kamoun-6'), 'scontrol identity differs')
        require('UserId=deeks(14014)' in text and 'TimeLimit=02:00:00' in text, 'scontrol user or time limit differs')
        snapshot = {'state': one_match(r'\bJobState=(\S+)', text, 'startup state'),
                    'exitCode': one_match(r'\bExitCode=(\S+)', text, 'startup exit code'),
                    'finalAccounting': False}
        require(snapshot['state'] == 'RUNNING' and snapshot['exitCode'] == '0:0', 'Startup snapshot failed')
    return {
        'kind': 'kamoun-direct-disposal-job-audit-v1', 'success': True, 'jobId': JOB_ID,
        'planSha256': PLAN_SHA, 'projects': 6, 'files': 1217, 'bytes': 790004575062,
        'exactTargets': targets,
        'events': {'started': 1, 'preflightPassed': 6, 'deletionStarted': 6, 'deleted': 6, 'complete': 1, 'total': 20},
        'eventCounts': counts, 'exactPlanOrder': True, 'allPreflightsBeforeFirstDeletion': True,
        'noDuplicateMissingOrUnexpectedEvents': True, 'rawEmbeddedAuditExactlyMatchesJsonl': True,
        'noFailureEventsOrDiagnosticErrors': True, 'protectedRootsIntactAccordingToRunner': True, 'retiredRecordsRetainedAccordingToRunner': True,
        'independentAbsenceConfirmationRequired': True, 'noS3Copy': True, 'retirementReceiptSha256': RETIREMENT_SHA, 'execute': True, 'allEventsWithinReview': True,
        'processExitCode': exit_status, 'host': host, 'uid': 14014, 'operator': 'deeks',
        'reviewCompletedAt': plan['reviewCompletedAt'], 'expiresAt': plan['expiresAt'],
        'startedAt': events[0]['at'], 'completedAt': events[-1]['at'],
        'runnerElapsedSeconds': (times[-1] - times[0]).total_seconds(),
        'packageChecksumChecksPassed': passed_checks,
        'allocation': {'nodes': 1, 'tasks': 1, 'cpusPerTask': 1, 'memoryPerNodeMiB': 1024, 'timeLimit': '02:00:00'},
        'gnuTime': gnu_time, 'slurmLaunchSnapshot': snapshot,
        'slurmStatus': {'source': 'not-supplied', 'state': 'UNKNOWN', 'exitCode': None},
        'schedulerFinalStateIndependentlyVerified': False,
        'issues': [],
        'limits': ['Final Slurm accounting is separate; this audit verifies runner completion and GNU time exit 0 only.',
                   'This audit checks execution receipts. Mounted-source absence and protected-root presence require separate evidence. Retirement was already completed; this audit performs no database writes.'],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--jsonl', type=Path, required=True)
    parser.add_argument('--stdout', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require(args.plan.name == 'deletion-plan.json' and args.jsonl.name == JSONL_NAME
            and args.stdout.name == STDOUT_NAME, 'Input names differ from exact job')
    paths = [args.plan, args.jsonl, args.stdout]
    raw = [read_regular(path) for path in paths]
    result = audit_bytes(*raw)
    result['inputs'] = [{'name': path.name, 'sha256': sha(value), 'bytes': len(value)} for path, value in zip(paths, raw)]
    require(all(read_regular(path) == value for path, value in zip(paths, raw)), 'Input evidence changed during audit')
    result['at'] = datetime.now(timezone.utc).isoformat()
    require(args.output.name == 'job-' + JOB_ID + '-audit.json', 'Unexpected output filename')
    require(not os.path.lexists(args.output), 'Audit output already exists')
    os.umask(0o077)
    with args.output.open('x') as handle:
        json.dump(result, handle, indent=2); handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
    print(json.dumps({'success': True, 'jobId': JOB_ID, 'projects': 6, 'files': 1217, 'bytes': 790004575062, 'output': str(args.output)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('AUDIT FAILED: ' + str(error), file=sys.stderr)
        sys.exit(1)
