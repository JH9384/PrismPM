import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyView,verifyModelMutation,refuseBypasses} from '../../tests/browser-view/checks.mjs';
import {createCompilerOwner,requireCompilerOwner} from '../../tests/browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../../tests/browser-view/compiler-owner-checks.mjs';
import {prerequisite} from '../../tests/browser-view/prerequisites.mjs';
test('DK-15 exact registered modeled interaction, presentation and rejections',()=>{
  refuseBypasses();
  const source=readFileSync(new URL('../../stdlib/src/Foundation/View/Workspace/V1/Interaction.lex.tex',import.meta.url),'utf8');
  const ast=JSON.parse(/\\semanticdata\{(.*)\}/.exec(source)[1]);
  for(const name of['workspaceInteractionBytes','workspacePresentationBytes']){
    const definitions=ast.declarations.filter(d=>d.name===name);assert.equal(definitions.length,1);assert.equal(definitions[0].kind,'definition');assert.ok(definitions[0].body);
  }
  assert.match(source,/\\importmodule\{Foundation.View.V1.Interaction\}/);
  const register=readFileSync(new URL('../../model/browser-view-diagnostics.toml',import.meta.url),'utf8');
  const expected=ast.declarations.find(d=>d.name==='WorkspaceInteractionError').constructors.map((d,index)=>({byte:index+1,name:d.name}));
  assert.deepEqual([...register.matchAll(/^byte = ([0-9]+)\nname = "([A-Za-z]+)"$/gm)].map(m=>({byte:Number(m[1]),name:m[2]})),expected);
});
test('DK-15 complete fresh modeled View semantics and actual compiler mutants',{timeout:3500000},async t=>{
  const owner=createCompilerOwner('view');
  const substitutions=verifyCompilerOwnerSubstitutions(owner);
  const build=await verifyView(t,owner);assert.equal(build.compilerOwner,owner.identity);
  for(const kind of['session','rows'])await prerequisite(t,'actual generated '+kind+' mutation is rejected',()=>{t.diagnostic(JSON.stringify(verifyModelMutation(kind,owner)));});
  const retirement=owner.close();
  assert.throws(()=>requireCompilerOwner(owner,'view'),/compiler owner closed/);
  assert.throws(()=>owner.close(),/compiler owner closed/);
  t.diagnostic(JSON.stringify({compiler:owner.evidence,substitutions,retirement}));
});
