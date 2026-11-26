#!/usr/bin/env python3
"""Build portable review artifacts from the dated read-only observations.

Local files only. These JSON plans are not executable writes or typed backups.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
IDENTITY_FIELDS = ['path', 'name', 'safeName', 'owner', 'group', 'project', 'sample', 'run', 'file', 'originalName']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    source_names = ['database-02.json', 'filesystem-02.json', 'environment-01.json', 'permissions-01.json']
    raw = {name: (args.evidence_dir / name).read_bytes() for name in source_names}
    evidence = {name: json.loads(data) for name, data in raw.items()}
    d = evidence['database-02.json']['result']
    f = evidence['filesystem-02.json']['result']
    env = evidence['environment-01.json']['result']
    assert not d['issues'] and not f['issues'] and f['ok']
    assert d['summary']['proposedPathUpdates'] == 64 and f['summary']['files'] == 40
    assert f['summary']['bytes'] == 41432635417
    assert not f['destinationChildren'] and not d['notes']
    assert d['topology']['setName'] is None
    for component, filename in [('database', 'db-preflight.cjs'), ('filesystem', 'fs-preflight.cjs')]:
        assert evidence[component+'-02.json']['scriptSha256'] == hashlib.sha256((BASE/filename).read_bytes()).hexdigest()
    docmaps = {collection: {x['_id']: x for x in rows} for collection, rows in d['documents'].items()}
    sample_map, run_map, file_map = (docmaps[k] for k in ['samples','runs','files'])
    target_id = '6ae4ac89a6b876c643741d27'
    target = docmaps['projects'][target_id]
    mappings = {(m['collection'], m['id']): m for m in d['mappings']}
    assert len(mappings) == 64
    physical = {}
    manifest = []
    for sample in f['samples']:
        project = docmaps['projects'][sample['projectId']]
        prefix = project['path'].lstrip('/')
        expected = {e['relPath']: e for e in sample['manifestEntries'] if e['type'] == 'file'}
        verification = {e['relPath']:e for e in sample['verificationEntries']}
        for entry in sample['entries']:
            if entry['type'] != 'file':
                continue
            old_path = prefix + '/' + entry['relPath']
            assert old_path not in physical
            sealed = expected[entry['relPath']]
            file_id = sealed['db']['fileId']
            assert file_map[file_id]['path'].lstrip('/') == old_path
            assert sealed['size'] == entry['size']
            assert verification[entry['relPath']]['verified']
            change = mappings[('files',file_id)]
            row = {'projectId':project['_id'],'sampleId':sample['sampleId'],'fileId':file_id,
                   'source': '/mnt/reads/'+old_path,'destination':'/mnt/reads/'+change['newPath'].lstrip('/'),
                   'bytes':entry['size'],'sha256':sealed['sha256'],'crc64nvme':sealed['crc64nvme'],
                   'sourceMetadata':entry,'sealedS3Key':sealed['s3Key']}
            manifest.append(row)
            physical[old_path] = row
    assert set(physical) == {x['path'].lstrip('/') for x in file_map.values()}
    assert len(manifest)==40 and sum(x['bytes'] for x in manifest)==41432635417
    fastq, sidecar_reads = [], []
    for read in d['documents']['reads']:
        file = file_map[read['file']]
        run = run_map[read['run']]
        sample = sample_map[run['sample']]
        copied = physical[file['path'].lstrip('/')]
        row = {'sampleId':sample['_id'],'sampleName':sample['name'],'runId':run['_id'],'runName':run['name'],
               'readId':read['_id'],'fileId':file['_id'],'originalName':file['originalName'],
               'sourcePath':file['path'],'proposedFilePath':mappings[('files',file['_id'])]['newPath'],
               'proposedV1333Path':copied['destination'],'proposedDefaultExportPath':'/tsl/data/reads/'+mappings[('files',file['_id'])]['newPath'].lstrip('/'),
               'bytes':copied['bytes'],'sha256':copied['sha256'],'crc64nvme':copied['crc64nvme'],
               'paired':read.get('paired'), 'siblingReadId':read.get('sibling')}
        if file['path'].endswith('.fq.gz'):
            assert read.get('paired') is True
            fastq.append(row)
        else:
            assert file['originalName']=='MD5.txt' and file['path'].endswith('/MD5.txt')
            sidecar_reads.append(row)
    assert len(fastq)==24 and len(sidecar_reads)==7
    assert set(Counter(r['runId'] for r in fastq).values()) == {2}
    fastq_ids = {r['readId']:r for r in fastq}
    for r in fastq:
        sibling=fastq_ids[r['siblingReadId']]
        assert sibling['runId']==r['runId'] and sibling['siblingReadId']==r['readId']
    operations=[]
    for (collection, oid), mapping in sorted(mappings.items()):
        before=docmaps[collection][oid]
        changes={'path':mapping['newPath']}
        if collection=='samples': changes['project']=target_id
        after={**before, **changes}
        identity={k:after[k] for k in IDENTITY_FIELDS if k in after}
        operations.append({'collection':collection,'id':oid,'businessChanges':{
            key:{'before':before[key],'after':value} for key,value in changes.items()},
            'existingIdentity':before.get('reconciliation',{}).get('identity'),
            'proposedIdentity':identity,'existingHistoryEntries':len(before.get('reconciliationHistory',[])),
            'auditPolicy':'Retain existing history and typed before-image; append this operation; preserve original createdAt; set execution updatedAt. Advance existing identity or establish this reviewed identity.'})
    assert sum(o['existingIdentity'] is not None for o in operations)==16
    provenance={'sourceEvidence':[{'filename':name,'sha256':hashlib.sha256(data).hexdigest()} for name,data in raw.items()],
                'collectorDigests':{component:evidence[component+'-02.json']['scriptSha256'] for component in ['database','filesystem']},
                'scopeSha256':evidence['database-02.json']['scopeSha256'],
                'representation':'Derived review JSON; original private read-only output retained on Mac. Not a typed BSON backup or executable mutation plan.'}
    summary={'schemaVersion':1,'recordedOn':'2026-11-26','status':'read_only_preflight_passed_execution_not_performed',
             'observedAt':{'database':d['finishedAt'],'filesystem':f['completedAt'],'environment':env['at']},
             'counts':{'projects':5,'samples':12,'runs':12,'files':40,'bytes':41432635417,'fastqFiles':24,'checksumTextFiles':16,
                       'reads':31,'readRowsContainingChecksumText':7,'additionalFiles':9,'proposedUpdates':64,'existingPinnedFileIdentities':16,
                       'newIdentityPinsProposed':48,'sourceProjectOnlyAttachmentsRetained':len(d['related']['projectAdditionalFiles'])},
             'targetProject':{k:target[k] for k in ['_id','name','path','createdAt','storage']},
             'targetObservedEmpty':True,'expectedArchiveDueAfterReassignmentIfNoNewerRuns':'2031-10-30T14:41:13.635Z',
             'sourceProjects':[{'_id':p['_id'],'name':p['name'],'path':p['path'],'storage':p['storage'],'archiveMigration':p['archiveMigration']} for p in d['documents']['projects'] if p['_id']!=target_id],
             'checks':{'databaseIssues':[],'filesystemIssues':[],'exactDiskDatabaseSealedFileIdsMatch':True,'noObservedActiveIngestJobs':True,
                       'runProcessingFields':'Absent on all twelve legacy runs; absence is not independent proof of no external writer.',
                       'payloadChecksumsRecomputed':False,'freshS3RequestsMade':False,'metadataSnapshotAtomic':False},
             'capacity':f['capacity'],'topology':d['topology'],'environment':env,'permissions':evidence['permissions-01.json'],
             'enaGate':'Current export includes seven MD5.txt Read rows. Use a reviewed scope-specific 24-FASTQ list; validate the actual submission CSV and consumer mounts. No records reclassified here.',
             'remainingExecutionGates':['tested copy and journalled CAS/recovery executors','fresh frozen inventory and BSON-preserving backups','full source/destination checksum verification','operator writer freeze and service window','ENA file-list and consumer path validation'],
             'retention':'Four original source trees remain excluded until explicit release review; no archive changes, deletion, or hold release.',
             **provenance}
    outputs={'preflight-summary.json':summary,
             'change-plan.json':{'schemaVersion':1,'status':'proposed_not_executed','destinationProjectId':target_id,'count':64,'operations':operations,
                                 'unchanged':'Project storage/archive/retention fields, Project records, all Read/AdditionalFile associations and IDs, all biological metadata and accessions.',
                                 'requires':'Fresh typed BSON before-images, exact comparison conditions, copy verification receipt, freeze receipt, append-only journal and recovery tests.',**provenance},
             'copy-manifest.json':{'schemaVersion':1,'status':'proposed_not_copied','count':40,'bytes':41432635417,'entries':sorted(manifest,key=lambda r:r['source']),
                                   'copyMode':'Independent byte copies, no original moves/hardlinks, no overwrite. Include directories; full checksums deferred to copy verification.',**provenance},
             'ena-fastq-preview.json':{'schemaVersion':1,'status':'preview_not_a_submission_csv','destinationProjectId':target_id,'fastqCount':24,'runs':12,
                                       'sequenceFiles':sorted(fastq,key=lambda r:r['proposedFilePath']),
                                       'excludedFromSubmissionOnly':sorted(sidecar_reads,key=lambda r:r['sourcePath']),
                                       'exclusionDoesNotDeleteOrReclassify':'All seven MD5 Read records and all forty copied files remain. Consumer path and actual CSV validation required.',**provenance}}
    args.output_dir.mkdir(parents=True,exist_ok=True)
    for name, value in outputs.items():
        with (args.output_dir/name).open('x') as out:
            json.dump(value,out,indent=2,ensure_ascii=False);out.write('\n')
    print(json.dumps({'outputs':list(outputs),'files':len(manifest),'bytes':sum(x['bytes'] for x in manifest),'operations':len(operations),'fastq':len(fastq)}))


if __name__=='__main__':main()
