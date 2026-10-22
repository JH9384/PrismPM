// Synthetic closed-reader data only, never installed compiler acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {validateQualification} from './exporter-qualification.mjs';
import {lockFixture, qualificationFixture, sourceAuthorityFixture} from '../scripts/library-sdk-fixture.mjs';

test('compiler qualification retains both native constructions and all eight original exports', () => {
  for (const architecture of ['amd64', 'arm64']) {
    const fixture=lockFixture(),binding=fixture.binding(architecture);
    const inventory=Buffer.from(fixture.lock.platforms.find(row=>row.platform===binding.platform).inventory_document);
    validateQualification(qualificationFixture(binding), binding, sourceAuthorityFixture, inventory);
  }
});

test('qualification rejects missing phases, substituted authority and changed executions or exports', () => {
  for(const architecture of ['amd64','arm64']) {
  const fixture=lockFixture(),binding=fixture.binding(architecture);
  const inventory=Buffer.from(fixture.lock.platforms.find(row=>row.platform===binding.platform).inventory_document);
  const mutations=[
    value=>{delete value.construction;},
    value=>{value.binding.platform=binding.platform==='linux/amd64'?'linux/arm64':'linux/amd64';},
    value=>{value.manifests.pop();},
    value=>{value.manifests[1]+='\n';},
    value=>{value.construction.raw_construction.pop();},
    value=>{value.construction.raw_construction[1]=structuredClone(value.construction.raw_construction[0]);},
    value=>{value.construction.raw_construction[0].extraction.executable_sha256='0'.repeat(64);
      value.relocation.construction.construction.extraction.executable_sha256='0'.repeat(64);},
    value=>{value.construction.raw_construction[1].extraction.executable_sha256='0'.repeat(64);},
    ...[0,1,2,3].map(index=>value=>{value.relocation.observations[index].extraction.executable_sha256='0'.repeat(64);}),
    value=>{value.relocation.observations.pop();},
    value=>{value.relocation.observations[0].kernel.exit_code=1;},
    value=>{value.relocation.observations[0].kernel.argv[2]='--version';},
    value=>{value.relocation.observations[0].kernel.executable_sha256='0'.repeat(64);},
    value=>{value.relocation.observations[0].kernel.environment.LEAN_NUM_THREADS='9999';},
    value=>{value.relocation.observations[1].changed_build_files=[{path:'.lake/build/trace',change:'changed'}];},
    value=>{value.relocation.observations[0].exports.pop();},
    value=>{value.relocation.observations[0].exports[1].artifacts['kernel.ir']='other';},
    value=>{delete value.relocation.observations[0].exports[0].artifacts['coverage.json'];},
    value=>{value.relocation.observations[3]=structuredClone(value.relocation.observations[1]);},
  ];
  for(const [index,mutate] of mutations.entries()){const value=qualificationFixture(binding);
    assert.doesNotThrow(()=>validateQualification(value,binding,sourceAuthorityFixture,inventory),'each negative starts from an independently valid fixture');
    mutate(value);assert.throws(()=>validateQualification(value,binding,sourceAuthorityFixture,inventory),
      architecture+' negative '+index);}
  for(const authority of [{...sourceAuthorityFixture,archive_sha256:'0'.repeat(64)},{...sourceAuthorityFixture,toolchain:'leanprover/lean4:v4.30.0'}])
    assert.throws(()=>validateQualification(qualificationFixture(binding),binding,authority,inventory));
  for(const altered of [undefined,Buffer.from('{}'),Buffer.concat([inventory,Buffer.from('\n')]),
    Buffer.from(fixture.lock.platforms.find(row=>row.platform!==binding.platform).inventory_document)])
    assert.throws(()=>validateQualification(qualificationFixture(binding),binding,sourceAuthorityFixture,altered));
  for(const alter of [value=>{value.commands=value.commands.filter(row=>row.command!=='tar');},
    value=>{value.commands.find(row=>row.command==='tar').executable='/unaccepted/tar';},
    value=>{value.commands.find(row=>row.command==='tar').sha256='0'.repeat(64);},
    value=>{value.commands.push(value.commands.at(-1));}]) {
    const changed=JSON.parse(inventory);alter(changed);const bytes=Buffer.from(fixture.encode(changed));
    assert.throws(()=>validateQualification(qualificationFixture(binding),binding,sourceAuthorityFixture,bytes),
      'a rehashed caller inventory is not captured authority');
  }
  }
});
