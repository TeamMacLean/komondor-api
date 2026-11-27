#!/usr/bin/env python3
"""Seal the observed six-project scope locally; never connects to production."""
import hashlib,json,pathlib,datetime
p=pathlib.Path(__file__).resolve().parent.parent
read=lambda f:json.loads((p/f).read_text())
sha=lambda f:hashlib.sha256((p/f).read_bytes()).hexdigest()
spec=read('targets.json');graph=read('evidence/db-preflight-20261127.json');inventory=read('evidence/filesystem-preflight-r2-20261127.json');identity=read('evidence/database-identity-r2.json')
assert not graph['issues'] and all(x['ok'] for x in graph['preservation'])
assert inventory['success'] and inventory['sourceMetadataStable'] and inventory['historicalPathsTypesAndSizesMatched']
assert identity['activeIngest']==identity['activeRuns']==0
now=datetime.datetime.now(datetime.timezone.utc)
plan={'kind':'kamoun-direct-disposal-retirement-v1','version':1,'actor':'deeks','batchId':'kamoun-direct-disposal-2026-11-27','apiHead':spec['apiHead'],
 'databaseIdentity':{k:identity[k] for k in ['name','host','port','collectionUuid']},'datastoreRoot':'/mnt/reads','preparedAt':now.isoformat(),'expiresAt':(now+datetime.timedelta(hours=6)).isoformat(),
 'targets':spec['targets'],'inventory':inventory,'graph':{k:graph[k] for k in ['collections','protectedCollections']},
 'inventoryToolSha256':sha('tools/inventory_direct_disposal.py'),'baselineSha256':sha('tools/sealed-source-baseline.json'),'heldPathsSha256':sha('held-paths.json'),
 'noS3Copy':True,'manualFilesystemDeletionRequired':True,'retainHistory':True,
 'decisionAuthority':'Original six Kamoun spreadsheet DELETE decisions, preserved in the 22 October outcome ledger; George explicitly requested execution on 27 November 2026. External writers confirmed frozen in this chat. Metadata/history retained; George submits the separate HPC deletion job.',
 'evidenceHashes':{f:sha(f) for f in ['targets.json','evidence/db-preflight-20261127.json','evidence/filesystem-preflight-r2-20261127.json','evidence/database-identity-r2.json','evidence/external-writer-freeze.json']}}
out=p/'retirement-plan.json'
with out.open('x') as f:json.dump(plan,f,indent=2);f.write('\n')
print(json.dumps({'planSha256':sha('retirement-plan.json'),'records':sum(len(v) for v in graph['collections'].values()),'expiresAt':plan['expiresAt']}))
