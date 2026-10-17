const fs=require('fs'),path=require('path'),os=require('os'),zlib=require('zlib'),crypto=require('crypto');
const {hashGzip}=require('../../docs/archive/batches/2026-10-16/evidence/2026-10-17/collect-gzip-diagnostics.cjs');
let root;
beforeEach(async()=>{root=await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(),'gzip-evidence-')));});
afterEach(async()=>{await fs.promises.rm(root,{recursive:true,force:true});});
test('separates raw gzip checksum from decoded checksum and validates the still-open file',async()=>{
 const bytes=zlib.gzipSync(Buffer.from('hello')),p=path.join(root,'reads.gz');await fs.promises.writeFile(p,bytes);
 const r=await hashGzip(p);
 expect(r).toMatchObject({physical:{bytes:bytes.length,md5:crypto.createHash('md5').update(bytes).digest('hex')},decoded:{bytes:5,md5:'5d41402abc4b2a76b9719d911017c592'},gzipTrailerValidated:true,stable:true});
 expect(r.physical.md5).not.toBe(r.decoded.md5);
});
test('does not certify corrupt gzip data even if decompression emitted content',async()=>{
 const bytes=zlib.gzipSync(Buffer.from('hello')),p=path.join(root,'bad.gz');bytes[bytes.length-8]^=1;await fs.promises.writeFile(p,bytes);
 await expect(hashGzip(p)).rejects.toThrow();
});
test('rejects symlink candidates',async()=>{
 const p=path.join(root,'reads.gz'),link=path.join(root,'link.gz');await fs.promises.writeFile(p,zlib.gzipSync(Buffer.from('hello')));await fs.promises.symlink(p,link);
 await expect(hashGzip(link)).rejects.toThrow('Symlink');
});
test('handles a valid empty gzip stream without confusing it with missing data',async()=>{
 const p=path.join(root,'empty.gz');await fs.promises.writeFile(p,zlib.gzipSync(Buffer.alloc(0)));
 expect((await hashGzip(p)).decoded).toMatchObject({bytes:0,md5:'d41d8cd98f00b204e9800998ecf8427e'});
});
