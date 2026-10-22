// Build-input acquisition only. Does not install or execute a browser.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, readFileSync, statSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const browserInputs=Object.freeze([
  Object.freeze({engine:'firefox',revision:'1538',version:'153.0',bytes:113411079,
    sourceURI:'https://cdn.playwright.dev/builds/firefox/1538/firefox-debian-12.zip',
    executable:'firefox/firefox'}),
  Object.freeze({engine:'webkit',revision:'2336',version:'26.5',bytes:107153598,
    sourceURI:'https://cdn.playwright.dev/builds/webkit/2336/webkit-debian-12.zip',
    executable:'pw_run.sh'}),
]);

export function validateArchiveNames(text,input) {
  assert.ok(browserInputs.includes(input),'closed official browser input');
  assert.ok(text.endsWith('\n'),'complete ZIP listing');
  const names=text.slice(0,-1).split('\n');
  assert.ok(names.length>0&&names.length<=20000,'bounded ZIP entry count');
  assert.equal(new Set(names).size,names.length,'unique ZIP paths');
  for(const name of names) {
    assert.ok(name.length>0&&name.length<=4096,'bounded ZIP entry name');
    assert.ok(!name.startsWith('/')&&!name.includes('\\')&&!/[\x00-\x1f\x7f]/u.test(name),'relative ZIP paths');
    assert.ok(name.split('/').every(part=>part!=='.'&&part!=='..'),'no traversing ZIP paths');
  }
  assert.ok(names.includes(input.executable),'expected platform executable present');
  return names.length;
}

export function validateArchiveSize(path,input) {
  assert.ok(browserInputs.includes(input),'closed official browser input');
  const value=statSync(path,{throwIfNoEntry:true});
  assert.ok(value.isFile(),'regular downloaded archive');
  assert.equal(value.size,input.bytes,'exact official archive byte count');
}

async function sha256(path) {
  const hash=createHash('sha256');
  for await(const block of createReadStream(path))hash.update(block);
  return hash.digest('hex');
}

export async function qualifyBrowserInputs(destination) {
  assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
  const root=fileURLToPath(new URL('../',import.meta.url));
  const manifest=JSON.parse(readFileSync(join(root,'sdk/oracles/package.json'),'utf8'));
  const lock=JSON.parse(readFileSync(join(root,'sdk/oracles/package-lock.json'),'utf8'));
  assert.equal(manifest.dependencies.playwright,'1.62.1');
  assert.equal(lock.packages['node_modules/playwright'].version,'1.62.1');
  assert.equal(lock.packages['node_modules/playwright-core'].version,'1.62.1');
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:5000}).trim();
  assert.match(sourceCommit,/^[0-9a-f]{40}$/u);
  const sourceFiles=['scripts/qualify-debian-browser-inputs.mjs','sdk/oracles/package.json','sdk/oracles/package-lock.json'];
  execFileSync('git',['ls-files','--error-unmatch','--',...sourceFiles],{cwd:root,timeout:5000});
  execFileSync('git',['diff','--exit-code','HEAD','--',...sourceFiles],{cwd:root,timeout:5000});
  // A fresh destination prevents stale or partial downloads from being reused.
  await mkdir(destination,{recursive:false});
  const archives=[];
  for(const input of browserInputs) {
    const path=join(destination,`${input.engine}-debian-12.zip`);
    execFileSync('curl',['--disable','--proto','=https','--proto-redir','=https','--tlsv1.2',
      '--fail','--location','--silent','--show-error','--connect-timeout','15',
      '--max-time','180','--retry','2','--retry-max-time','420',
      '--max-filesize',String(input.bytes),'--output',path,input.sourceURI],
    {timeout:450000,maxBuffer:65536,stdio:['ignore','pipe','pipe']});
    validateArchiveSize(path,input);
    // The archive is validated, never extracted or executed during qualification.
    execFileSync('unzip',['-tqq',path],{timeout:120000,maxBuffer:1048576});
    const listing=execFileSync('unzip',['-Z1',path],{timeout:30000,maxBuffer:4194304,encoding:'utf8'});
    const entries=validateArchiveNames(listing,input);
    await writeFile(join(destination,`${input.engine}-entries.txt`),listing,{flag:'wx'});
    archives.push({...input,sha256:await sha256(path),entries,
      listingSha256:createHash('sha256').update(listing).digest('hex')});
  }
  const receipt={schema:'prismpm/browser-input-qualification/1',purpose:'input-acquisition-only',
    playwright:'1.62.1',platform:'debian12-x64',sourceCommit,
    oracleLockSha256:await sha256(join(root,'sdk/oracles/package-lock.json')),
    qualifierSha256:await sha256(fileURLToPath(import.meta.url)),archives};
  await writeFile(join(destination,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return receipt;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length,3,'one fresh output directory; no URL or revision overrides');
  console.log(JSON.stringify(await qualifyBrowserInputs(resolve(process.argv[2]))));
}
