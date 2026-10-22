// These are source-pin negative controls, never generated product acceptance.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import {pinnedPaths,verifyHologramSourcePins} from './hologram-source-pins.mjs';
const root=new URL('../',import.meta.url).pathname;
test('current reviewed interoperability pins match every unchanged archive/codec input and reviewed browser driver',()=>{
 assert.equal(verifyHologramSourcePins(root).length,4);
 const old=readFileSync(new URL('../crates/prismpm/tests/hologram_interop.rs',import.meta.url),'utf8');
 assert(!old.includes('790ad3b5006ca64f562f788c6a66de09720cc4025e79addc482792b86b8e9aea'));
});
test('source preflight refuses changed bytes, absent assertions and aliased files before compiler/oracle work',t=>{
 const root=mkdtempSync(join(tmpdir(),'prism-hologram-pin-control-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};
 const body=path=>readFileSync(new URL('../'+path,import.meta.url));
 const source=readFileSync(new URL('../crates/prismpm/tests/hologram_interop.rs',import.meta.url),'utf8');
 put('crates/prismpm/tests/hologram_interop.rs',source);mkdirSync(join(root,'crates/prismpm/vendor','..'),{recursive:true});symlinkSync('../../vendor',join(root,'crates/prismpm/vendor'));
 for(const path of pinnedPaths)put(path.replace('crates/prismpm/vendor/','vendor/'),body(path));
 verifyHologramSourcePins(root);
 for(const path of pinnedPaths){const actual=path.replace('crates/prismpm/vendor/','vendor/');put(actual,'changed');assert.throws(()=>verifyHologramSourcePins(root));put(actual,body(path));}
 for(const changed of [source.replace('assert_eq!','removed_assert'),source.replace(/[a-f0-9]{64}/,'a'.repeat(64)),source+source,
  '/*'+source+'*/',source.replace('#[test]','#[ignore]'),source.replace('#[test]','#[cfg(any())]\n#[test]'),
  'const DISABLED: &str = r###"'+source+'"###;']){
  put('crates/prismpm/tests/hologram_interop.rs',changed);assert.throws(()=>verifyHologramSourcePins(root));
 }
 put('crates/prismpm/tests/hologram_interop.rs',source);
 const path='tests/holo-codec-oracle/Cargo.lock';rmSync(join(root,path));symlinkSync('Cargo.toml',join(root,path));assert.throws(()=>verifyHologramSourcePins(root));
});
