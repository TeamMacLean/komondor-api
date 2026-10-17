const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { hashFile, classify, validMd5 } = require('../../docs/archive/batches/2026-10-16/evidence/2026-10-17/collect-readonly.cjs');

describe('read-only batch evidence', () => {
  let root;
  beforeEach(async () => { root = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'batch-evidence-'))); });
  afterEach(async () => { await fs.promises.rm(root, { recursive: true, force: true }); });
  const candidate = (relPath, md5 = 'a'.repeat(32), sha256 = 'b'.repeat(64)) => ({ relPath, md5, sha256 });
  async function entry() {
    await fs.promises.writeFile(path.join(root, 'read.fastq'), 'original bytes\n');
    return { ...(await fs.promises.stat(path.join(root, 'read.fastq'))), type: 'file', relPath: 'read.fastq' };
  }
  test('hashes the actual bytes with both algorithms', async () => {
    const result = await hashFile(root, await entry());
    expect(result).toMatchObject({ bytes: 15, stable: true, md5: crypto.createHash('md5').update('original bytes\n').digest('hex'), sha256: crypto.createHash('sha256').update('original bytes\n').digest('hex') });
  });
  test('refuses a changed inventory instead of certifying replacement bytes', async () => {
    const e = await entry();
    await fs.promises.writeFile(path.join(root, e.relPath), 'replacement');
    await expect(hashFile(root, e)).rejects.toThrow('changed before hashing');
  });
  test('refuses symlink candidates', async () => {
    const e = await entry();
    await fs.promises.symlink(path.join(root, e.relPath), path.join(root, 'link'));
    await expect(hashFile(root, { ...e, relPath: 'link' })).rejects.toThrow('symlink');
  });
  test.each(['../read.fastq', '/read.fastq', './read.fastq', 'a//read.fastq'])('refuses unsafe relative path %s', async relPath => {
    await expect(hashFile(root, { type: 'file', relPath })).rejects.toThrow('Unsafe candidate');
  });
  test.each([undefined, '', 'none', '0', 'a'.repeat(31)])('does not treat %s as an original checksum', value => expect(validMd5(value)).toBeNull());
  test('normalizes a valid original MD5', () => expect(validMd5(' A'.trim().repeat(32))).toBe('a'.repeat(32)));
  test('limits absent-file conclusions to the actual search scope', () => {
    expect(classify([], null, new Set())).toMatchObject({ category: 'b', scope: expect.stringContaining('not a claim') });
  });
  test('preserves an original-matching same-run copy in place', () => {
    const a = candidate('run/processed/a');
    expect(classify([a], a.md5, new Set([a.relPath]))).toMatchObject({ category: 'a', originalMd5Match: true });
  });
  test('states when there is no original checksum to compare', () => {
    const a = candidate('run/processed/a');
    expect(classify([a], null, new Set([a.relPath]))).toMatchObject({ category: 'a', originalMd5Match: null });
  });
  test('holds a checksum mismatch', () => {
    const a = candidate('run/processed/a');
    expect(classify([a], 'c'.repeat(32), new Set([a.relPath]))).toMatchObject({ category: 'c', resolved: false });
  });
  test('compares both duplicate candidates and preserves both', () => {
    const a = candidate('run/processed/a'), b = candidate('other/raw/a');
    expect(classify([a,b], a.md5, new Set([a.relPath]))).toMatchObject({ category: 'c', resolved: true, allCandidateBytesEqual: true });
  });
  test('holds distinct copies when there is no recorded original hash', () => {
    const a = candidate('run/processed/a'), b = candidate('other/raw/a', 'c'.repeat(32), 'd'.repeat(64));
    expect(classify([a,b], null, new Set([a.relPath]))).toMatchObject({ category: 'c', resolved: false });
  });
  test('resolves a distinct duplicate only with a unique original-matching same-run copy', () => {
    const a = candidate('run/processed/a'), b = candidate('other/raw/a', 'c'.repeat(32), 'd'.repeat(64));
    expect(classify([a,b], a.md5, new Set([a.relPath]))).toMatchObject({ category: 'c', resolved: true });
    expect(classify([a,b], b.md5, new Set([a.relPath]))).toMatchObject({ category: 'c', resolved: false });
  });
});
