import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {label,profile} from './metadata-layer.mjs';

const dockerfile = readFileSync(new URL('./Dockerfile',import.meta.url),'utf8');
const recipe = dockerfile.split('FROM runtime_base AS metadata_files\n')[1]?.split('\nFROM runtime_base AS runtime\n')[0];
assert(recipe && recipe.startsWith('RUN set -eu;'));
const command = recipe.trim().slice(4).replace(/\\\n/g,' ');

test('actual publisher recipe copies exact bounded files with a terminal closed ancestry layer', t => {
  const directory = mkdtempSync(join(tmpdir(),'sdk-metadata-publisher-'));
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const source = join(directory,'installed'), output = join(directory,'metadata'); mkdirSync(source);
  const files = {'inventory.json':Buffer.from('exact original inventory\n'), 'standards.lock':Buffer.from('exact original standards\n')};
  for (const [name,bytes] of Object.entries(files)) writeFileSync(join(source,name),bytes);
  // Relocate only the two filesystem roots; execute the checked-in RUN recipe.
  const run = () => spawnSync('/bin/sh',['-ec',command.replaceAll('/sdk-metadata',output)
    .replaceAll(' /opt/prismpm/share/',' ' + source + '/')],{timeout:5000,maxBuffer:65536});
  const result = run(); assert.ifError(result.error); assert.equal(result.status,0,result.stderr.toString());
  const walk = (path,prefix = '') => readdirSync(path).sort().flatMap(name => {
    const full = join(path,name), relative = prefix + name, stat = lstatSync(full);
    assert(!stat.isSymbolicLink()); assert.equal(stat.mtimeMs,0);
    assert.equal(stat.mode & 0o777,stat.isDirectory() ? 0o755 : 0o444);
    return [relative,...(stat.isDirectory() ? walk(full,relative + '/') : [])];
  });
  assert.deepEqual(walk(output),['opt','opt/prismpm','opt/prismpm/share','opt/prismpm/share/inventory.json','opt/prismpm/share/standards.lock']);
  for (const [name,bytes] of Object.entries(files)) assert.deepEqual(readFileSync(join(output,'opt/prismpm/share',name)),bytes);
  const terminal = dockerfile.split('\nFROM runtime_base AS runtime\n')[1].split('\n# Redistributable')[0].trim();
  assert.equal(terminal,'COPY --link --from=metadata_files /sdk-metadata/ /\nLABEL ' + label + '="' + profile + '"');
  // Each package stage ends at the next FROM; later stages build other images.
  for (const stage of dockerfile.split('\nFROM runtime AS ').slice(1).map(stage => stage.split('\nFROM ')[0]))
    assert(!/^(?:RUN|COPY|ADD|VOLUME|ONBUILD)\s/m.test(stage),'downstream package must retain terminal metadata');
  for (const [name,limit] of [['inventory.json',8388608],['standards.lock',16777216]]) {
    const path = join(source,name); writeFileSync(path,Buffer.alloc(limit + 1)); assert.notEqual(run().status,0);
    writeFileSync(path,files[name]);
    rmSync(path); symlinkSync(join(source,Object.keys(files).find(key => key !== name)),path); assert.notEqual(run().status,0);
    rmSync(path); writeFileSync(path,files[name]);
  }
  // Make the output tree removable by the test owner even for non-root gates.
  for (const name of Object.keys(files)) chmodSync(join(output,'opt/prismpm/share',name),0o600);
});
