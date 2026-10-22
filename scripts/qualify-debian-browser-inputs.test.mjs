import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,truncateSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browserInputs,validateArchiveNames,validateArchiveSize} from './qualify-debian-browser-inputs.mjs';

test('qualification admits only the two fixed official Debian browser archives',()=>{
  assert.equal(Object.isFrozen(browserInputs),true);
  assert.equal(browserInputs.every(Object.isFrozen),true);
  assert.deepEqual(browserInputs.map(({engine,revision,bytes})=>[engine,revision,bytes]),
    [['firefox','1538',113411079],['webkit','2336',107153598]]);
  for(const input of browserInputs) {
    assert.equal(input.sourceURI,`https://cdn.playwright.dev/builds/${input.engine}/${input.revision}/${input.engine}-debian-12.zip`);
    assert.equal(validateArchiveNames(`${input.executable}\n`,input),1);
    for(const text of ['',input.executable,`${input.executable}\n${input.executable}\n`,
      '/absolute\n','../escape\n','dir/../escape\n','dir\\escape\n','wrong-platform\n',
      `${input.executable}\ncontrol\x00\n`])assert.throws(()=>validateArchiveNames(text,input));
    assert.throws(()=>validateArchiveNames(`${input.executable}\n`,{...input}));
  }
});

test('partial oversized absent and substituted downloads cannot be qualified',()=>{
  const work=mkdtempSync(join(tmpdir(),'prismpm-browser-input-size-'));
  try {
    const path=join(work,'archive');writeFileSync(path,'',{flag:'wx'});
    for(const input of browserInputs) {
      for(const bytes of [0,input.bytes-1,input.bytes+1]){truncateSync(path,bytes);assert.throws(()=>validateArchiveSize(path,input));}
      truncateSync(path,input.bytes);validateArchiveSize(path,input);
      assert.throws(()=>validateArchiveSize(path,{...input}));
      assert.throws(()=>validateArchiveSize(work,input));
    }
    assert.throws(()=>validateArchiveSize(join(work,'absent'),browserInputs[0]));
  }finally{rmSync(work,{recursive:true,force:true});}
});

test('qualification workflow cannot publish or execute its unqualified input',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/browser-input-qualification.yml',import.meta.url),'utf8');
  assert.match(workflow,/contents: read/u);assert.match(workflow,/persist-credentials: false/u);
  assert.match(workflow,/timeout-minutes: 20/u);assert.match(workflow,/pull_request:/u);
  for(const action of workflow.matchAll(/uses: ([^\s]+)/gu))assert.match(action[1],/@[0-9a-f]{40}$/u);
  assert.doesNotMatch(workflow,/secrets\.|write-all|contents: write|pull_request_target|id-token:|packages:/u);
  const source=readFileSync(new URL('./qualify-debian-browser-inputs.mjs',import.meta.url),'utf8');
  assert.match(source,/execFileSync\('unzip',\['-tqq',path\]/u);
  assert.match(source,/execFileSync\('unzip',\['-Z1',path\]/u);
  assert.doesNotMatch(source,/execFileSync\((?:path|input\.executable)/u);
});
