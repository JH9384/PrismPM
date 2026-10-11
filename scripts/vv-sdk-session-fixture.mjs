// Instrumented shell boundaries for orchestration tests, not SDK acceptance.
import {chmodSync, copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function sessionFixture(root, environment = process.env, options = {}) {
  mkdirSync(join(root, 'scripts'), {recursive: true});
  mkdirSync(join(root, 'bin'), {recursive: true});
  copyFileSync(new URL('./vv.sh', import.meta.url), join(root, 'scripts/vv.sh'));
  writeFileSync(join(root, 'scripts/bootstrap-verify.sh'),
    `node -e 'require("node:fs").appendFileSync("session.jsonl",JSON.stringify({kind:"bootstrap",args:process.argv.slice(1)})+"\\n")' -- "$@"\nexit ${options.bootstrapFailure ?? 0}\n`);
  const executable = (name, body) => {
    const path = join(root, 'bin', name);
    writeFileSync(path, `#!${process.execPath}\n${body}\n`);
    chmodSync(path, 0o700);
  };
  const preamble = `const fs=require('node:fs');const args=process.argv.slice(2);const record=(kind)=>fs.appendFileSync('session.jsonl',JSON.stringify({kind,args,image:process.env.PRISMPM_TEST_SDK_IMAGE??null})+'\\n');`;
  executable('node', preamble + `
    if(args[0]==='--test' && args[1]==='scripts/devcontainer-init.test.mjs'){record('init');if(${!!options.readDuringPreparation})fs.appendFileSync('preparation-stdin',fs.readFileSync(0));process.exit(${options.initFailure ?? 0});}
    if(args[0]==='scripts/registry-smoke.mjs'){record('registry-ready');process.exit(${options.registryFailure ?? 0});}
    if(args[0]==='scripts/sdk-image-inputs.mjs'){record('build');if(${!!options.buildFailureAfterLoad})fs.writeFileSync('loaded-tag',args.at(-1));process.exit(${options.buildFailureAfterLoad ? 43 : options.buildFailure ?? 0});}
    if(${!!options.release} && args[0]==='scripts/release-gate-evidence.mjs'){
      const n=fs.existsSync('count')?Number(fs.readFileSync('count'))+1:1;fs.writeFileSync('count',String(n));
      const assert=require('node:assert/strict');assert.equal(args[1],'source-run');assert.equal(args[9],String(n));
      record('source-run');process.stdout.write('call:'+n+'\\n');process.exit(n===1?${options.first ?? 0}:${options.second ?? 0});
    }
    const child=require('node:child_process').spawnSync(${JSON.stringify(process.execPath)},args,{stdio:'inherit'});
    if(child.error)throw child.error;process.exit(child.status??1);
  `);
  executable('git', preamble + `require('node:assert/strict').deepEqual(args,['rev-parse','HEAD']);process.stdout.write('a'.repeat(40)+'\\n');`);
  executable('docker', preamble + `
    record('docker');
    const operation=args.slice(0,2).join(' ');
    if(operation==='volume create'){fs.writeFileSync('volume-owner',args[args.indexOf('--label')+1].split('=')[1]);if(${!!options.volumeLostResponse})process.exit(51);}
    else if(operation==='volume inspect')process.stdout.write(${options.volumeConflict ? "'foreign'" : "fs.readFileSync('volume-owner','utf8')"});
    else if(operation==='container create'){if(${!!options.containerConflict})process.exit(1);fs.writeFileSync('created-container','owned');if(${!!options.containerLostResponse})process.exit(47);process.stdout.write('d'.repeat(64)+'\\n');}
    else if(operation==='container port')process.stdout.write('127.0.0.1:43567\\n');
    else if(operation==='container inspect'){
      if(args.at(-1).includes('io.prismpm.vv-session'))process.stdout.write('d'.repeat(64)+' '+(${!!options.containerConflict}?'foreign':fs.readFileSync('volume-owner','utf8'))+'\\n');
      else process.stdout.write('172.17.0.4\\n');
    }
    else if(operation==='image inspect'){
      if(!args.includes('--format'))process.exit(${options.tagConflict ? 0 : 1});
      if(args.at(-1)==='{{.Id}}')process.stdout.write('sha256:'+(${!!options.tagReplacement}&&fs.existsSync('count')?'e':'f').repeat(64)+'\\n');
      else process.stdout.write(${JSON.stringify(options.reference ?? `127.0.0.1:43567/prismpm-vv-sdk@sha256:${'b'.repeat(64)}\n`)});
    }
    else if(operation==='image tag'){fs.writeFileSync('tagged-image',args.at(-1));if(${!!options.tagLostResponse})process.exit(53);}
    else if(!['container rm','volume rm','image rm','container cp','container start','container logs','image tag','image push'].includes(operation))throw Error('unexpected Docker operation '+operation);
    if(operation==='container rm' && ${!!options.cleanupFailure})process.exit(41);
  `);
  executable('cargo', preamble + `
    require('node:assert/strict').deepEqual(args,${JSON.stringify(options.expectedCargoArgs ?? ['xtask', 'vv'])});record('cargo');
    const n=fs.existsSync('count')?Number(fs.readFileSync('count'))+1:1;fs.writeFileSync('count',String(n));
    process.exit(n===1?${options.first ?? 0}:${options.second ?? 0});
  `);
  executable('just', `require('node:assert/strict').deepEqual(process.argv.slice(2),['vv']);
    const child=require('node:child_process').spawnSync('bash',['scripts/vv.sh'],{stdio:'inherit'});
    if(child.error)throw child.error;process.exit(child.status??1);
  `);
  const env = {...environment, PATH: `${join(root, 'bin')}:${environment.PATH}`};
  delete env.PRISMPM_TEST_SDK_IMAGE;
  if (options.image) env.PRISMPM_TEST_SDK_IMAGE = options.image;
  return env;
}
