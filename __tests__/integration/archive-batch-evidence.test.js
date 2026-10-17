const mongo = require('./support/mongo');
const B = require('bson');
const crypto = require('crypto');
const { collectRelations } = require('../../docs/archive/batches/2026-10-16/evidence/2026-10-17/collect-readonly.cjs');
const bson = new B();
const id = () => new mongo.mongoose.Types.ObjectId();

describe('batch dependent-record evidence against scratch MongoDB', () => {
  beforeAll(mongo.connect);
  // Deliberately seed legacy duplicates; indexes from other suites must not mask them.
  beforeEach(mongo.dropDatabase);
  afterAll(mongo.disconnect);
  async function fixture() {
    const p = { _id: id(), path: '/group/project.with.dots', createdAt: new Date() };
    const s = { _id: id(), project: p._id };
    const r = { _id: id(), sample: s._id, status: 'complete' };
    const f = { _id: id(), path: p.path + '/sample/run/raw/a' };
    const read = { _id: id(), run: r._id, file: f._id };
    const af = ['project', 'sample', 'run'].map((key, i) => ({ _id: id(), [key]: [p._id,s._id,r._id][i], file: id() }));
    const files = [f,...af.map(a=>({_id:a.file,path:p.path+'/additional/'+a._id})), {_id:id(),path:p.path+'/orphan-file'}];
    const docs = { projects:[p], samples:[s], runs:[r], reads:[read], additionalfiles:af, files, ingestjobs:[{_id:id(),runId:r._id,status:'done'}], newsitems:[{_id:id(),typeId:String(p._id)},{_id:id(),typeId:r._id}] };
    for (const [c, values] of Object.entries(docs)) await mongo.mongoose.connection.db.collection(c).insertMany(values);
    return {p,s,r,f,read,af,docs};
  }
  test('exports every dependent document with types intact and exact identity filters without changing MongoDB', async () => {
    const {p,docs} = await fixture();
    const db = mongo.mongoose.connection.db;
    await db.collection('files').insertOne({_id:id(),path:'/group/projectXwithXdots/unrelated'});
    const result = await collectRelations(db,p,bson);
    expect(Object.values(result.blockers).every(v=>v.length===0)).toBe(true);
    for (const [c, values] of Object.entries(docs)) {
      const snap = result.snapshots[c], bytes=Buffer.from(snap.bsonBase64,'base64');
      expect(snap.count).toBe(values.length);
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(snap.sha256);
      const decoded = bson.deserialize(bytes).documents;
      expect(decoded.map(d=>String(d._id)).sort()).toEqual(values.map(d=>String(d._id)).sort());
      expect(decoded.every(d=>d._id._bsontype==='ObjectID')).toBe(true);
      expect(result.deletionFilters[c]._id.$in.map(v=>v.$oid).sort()).toEqual(values.map(d=>String(d._id)).sort());
      expect(await db.collection(c).countDocuments()).toBe(values.length+(c==='files'?1:0));
    }
    expect(bson.deserialize(Buffer.from(result.snapshots.projects.bsonBase64,'base64')).documents[0].createdAt).toBeInstanceOf(Date);
    expect(result.cleanupExecuted).toBe(false);
  });
  test('includes legacy string File references and blocks outside string references', async () => {
    const {p,read,f} = await fixture();
    const db=mongo.mongoose.connection.db;
    await db.collection('reads').updateOne({_id:read._id},{$set:{file:String(f._id)}});
    await db.collection('reads').insertOne({_id:id(),run:id(),file:String(f._id)});
    await db.collection('additionalfiles').insertOne({_id:id(),project:id(),file:String(f._id)});
    const result=await collectRelations(db,p,bson);
    expect(result.snapshots.files.count).toBe(5);
    expect(result.blockers.missingFileReferences).toEqual([]);
    expect(result.blockers.foreignReads).toHaveLength(1);
    expect(result.blockers.foreignAdditionalFiles).toHaveLength(1);
  });
  test('blocks shared files, cross-parent additional files, active work and missing/outside File records', async () => {
    const {p,r,f,read,af} = await fixture();
    const db=mongo.mongoose.connection.db;
    await db.collection('reads').insertOne({_id:id(),run:id(),file:f._id,sibling:read._id});
    await db.collection('additionalfiles').insertOne({_id:id(),project:id(),file:f._id});
    await db.collection('additionalfiles').updateOne({_id:af[0]._id},{$set:{run:id()}});
    await db.collection('files').deleteOne({_id:af[1].file});
    await db.collection('files').updateOne({_id:f._id},{$set:{path:'/other/project/file'}});
    await db.collection('ingestjobs').insertOne({_id:id(),runId:r._id,status:'claimed'});
    await db.collection('runs').updateOne({_id:r._id},{$set:{md5VerificationStatus:'in_progress'}});
    const result=await collectRelations(db,p,bson);
    for (const blocker of Object.values(result.blockers)) expect(blocker.length).toBe(1);
  });
});
