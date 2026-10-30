import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {captureCompilerInputs, createCompilerOwner, requireCompilerOwner} from './compiler-owner.mjs';
import {compilerDriverDirectory} from './compiler-owner-checks.mjs';
import {captureVerificationProducts} from './verification-products.mjs';
import * as effectsAdapter from '../browser-effects/compile.mjs';
import * as presentationAdapter from '../browser-presentation/compile.mjs';
import * as operationJournalAdapter from '../browser-operation-journal/compile.mjs';
import * as budgetAdapter from '../browser-budget/compile.mjs';
import * as publicationAdapter from '../publication-admission/compile.mjs';

test('driver substitution lookup includes P256 and rejects missing or ambiguous source inventory', () => {
  for (const directory of ['browser-view', 'browser-session', 'browser-p256', 'browser-signed-context', 'browser-session-operation', 'browser-pkce', 'holo-primary-component', 'publication-admission', 'publication-context-linkage', 'browser-session-journal-retention',
    'browser-custody', 'browser-effects', 'browser-budget', 'browser-operation-journal',
    'browser-presentation', 'browser-account-genesis']) {
    const path = 'tests/' + directory + '/driver/src/main.rs';
    assert.equal(compilerDriverDirectory({[path]: 'not-authority'}), 'tests/' + directory + '/driver');
  }
  assert.equal(compilerDriverDirectory({'tests/browser-session-journal/reservation-driver/src/main.rs': 'not-authority'}),
    'tests/browser-session-journal/reservation-driver');
  assert.throws(() => compilerDriverDirectory({'tests/browser-session-journal/other-driver/src/main.rs': 'not-authority'}),
    /one source-bound family driver/);
  for (const paths of [[], ['tests/browser-p123/driver/src/main.rs'],
    ['tests/browser-p256/driver/src/main.rs', 'tests/browser-session/driver/src/main.rs']])
    assert.throws(() => compilerDriverDirectory(Object.fromEntries(paths.map(path => [path, 'not-authority']))),
      /one source-bound family driver/);
  assert.throws(() => compilerDriverDirectory({'tests/browser-view/driver/src/main.rs':'not-authority',
    'tests/browser-custody/driver/src/main.rs':'not-authority'}), /one source-bound family driver/);
});

test('verification-only source reads retain the complete descriptor and digest checks without whole-file buffers', t => {
  const root=fs.mkdtempSync(join(tmpdir(),'prismpm-source-stream-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const path=join(root,'source'),bytes=Buffer.alloc(1024*1024,97);
  fs.writeFileSync(path,bytes,{mode:0o600});
  const source=fs.readFileSync(new URL('./compiler-owner.mjs',import.meta.url),'utf8');
  const begin=source.indexOf('function unchanged(before, after) {');
  const end=source.indexOf('\n// A bounded filesystem observation',begin);
  assert(begin>=0&&end>begin);
  const allocations=[],alloc=Buffer.alloc.bind(Buffer);
  const measuredBuffer={alloc(size){allocations.push(size);return alloc(size);}};
  const file=runInNewContext(source.slice(begin,end)+'\nfile;',
    {...fs,assert,createHash,Buffer:measuredBuffer});
  const digest=createHash('sha256').update(bytes).digest('hex');
  assert.equal(file(path,digest,false),undefined);
  assert(Math.max(...allocations)<=65536,'verification streams rather than retaining the entire file');
  assert.deepEqual(Buffer.from(file(path,digest)),bytes,'actual staging still receives the complete source bytes');
  assert.throws(()=>file(path,'0'.repeat(64),false),/captured compiler source/);
  fs.appendFileSync(path,'changed');
  assert.throws(()=>file(path,digest,false),/captured compiler source/);
  fs.writeFileSync(path,bytes);
  const alias=join(root,'alias');fs.linkSync(path,alias);
  assert.throws(()=>file(path,digest,false),/single-link/);
  fs.unlinkSync(alias);fs.symlinkSync(path,alias);
  assert.throws(()=>file(alias,digest,false),/unaliased/);
  for(const anchor of ['file(join(repository, path), digest, false)', 'file(join(work, path), digest, false)'])
    assert.equal(source.split(anchor).length,2,'both actual verification loops select streaming checks');
});

test('compiler owner refuses forged handles and unregistered tool families', () => {
  for (const value of [null, {}, {runDriver() {}, runExporter() {}, verify() {}}])
    assert.throws(() => requireCompilerOwner(value, {}), /actual fresh compiler owner/);
  for (const name of ['', '../escape', 'caller-driver', null, {toString() {throw Error('coercion');}}])
    assert.throws(() => createCompilerOwner(name, {}), /registered compiler family/);
});

test('all five existing adapters reject forged owners before any construction', () => {
  const adapters = {effects:effectsAdapter, presentation:presentationAdapter,
    'operation-journal':operationJournalAdapter, budget:budgetAdapter, publication:publicationAdapter};
  for (const [family, adapter] of Object.entries(adapters)) {
    const inputs = ['budget', 'presentation', 'publication'].includes(family) ? adapter.frozenInputs() : null;
    for (const forged of [{}, {runDriver() {}, runExporter() {}, verify() {}}]) {
      const args = family === 'operation-journal' ? [null, false, forged]
        : family === 'presentation' ? [null, null, inputs, forged]
          : ['budget', 'publication'].includes(family) ? [null, inputs, forged] : [null, forged];
      assert.throws(() => adapter.prepare(...args), /actual fresh compiler owner/, family);
    }
  }
});

test('five existing adapters preserve exact driver and exporter arguments across shared-tool dispatch', () => {
  // Argument-boundary unit only; no recorder is compiler or SDK evidence.
  for (const family of ['effects', 'presentation', 'operation-journal', 'budget', 'publication']) {
    const path = family === 'publication' ? '../publication-admission/compile.mjs' : '../browser-' + family + '/compile.mjs';
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const central = ['presentation', 'publication'].includes(family);
    const licenseRoot = family === 'presentation' ? 'licenses' : 'repository';
    const verifyCall = central ? "compiler.runDriver(['verify', join(project, 'lexlean.toml')], work)"
      : "invokeDriver(['verify', join(project, 'lexlean.toml')])";
    const nativeCall = central ? "compiler.runDriver(['native', ir, generated, " + licenseRoot + "], work)"
      : "invokeDriver(['native', ir, generated, repository])";
    const wasmCall = central ? 'compiler.runDriver([mode, ir, guest, ' + licenseRoot + '], work)'
      : 'invokeDriver([mode, ir, guest, repository])';
    const finalBarrier = family === 'presentation'
      ? "requireCompilerOwner(compiler, 'presentation'); verifyEvidence();"
      : family === 'publication' ? 'pins(); compiler.verify();' : 'if (shared) shared.verify(); else compiler.unchanged();';
    const check = text => {
      assert(text.includes("requireCompilerOwner(compilerOwner, '" + family + "')"));
      const observed = [];
      const owner = {runDriver(...args) {observed.push(args);}, runExporter() {}};
      const context = {join, work:'/actual-private-work', repository:'/actual-source',
        project:'/actual-private-subject/project', ir:'/actual-private-subject/export/kernel.ir',
        generated:'/actual-private-subject/generated', guest:'/actual-private-subject/guest-a',
        licenses:'/actual-private-subject/licenses', mode:'wasm'};
      if (central) {
        const binding = /const compiler = [\s\S]*?;/.exec(text);
        assert(binding, 'one genuine central compiler binding');
        const selections = [];
        const compiler = runInNewContext(binding[0] + '\ncompiler;', {
          compilerOwner:owner,
          requireCompilerOwner(value, selected) {selections.push([value, selected]); return value;},
          createCompilerOwner() {assert.fail('borrowed path cannot construct a second compiler');},
          captureCompilerInputs() {assert.fail('borrowed path cannot replace selected compiler inputs');},
        });
        assert.equal(compiler, owner);
        assert.equal(selections.length, 1); assert.equal(selections[0][0], owner); assert.equal(selections[0][1], family);
        for (const call of [verifyCall, nativeCall, wasmCall]) {
          assert(text.includes(call), 'exact central driver call: ' + call);
          runInNewContext(call, {...context, compiler});
        }
        assert.deepEqual(JSON.parse(JSON.stringify(observed)), [
          [['verify', '/actual-private-subject/project/lexlean.toml'], '/actual-private-work'],
          [['native', context.ir, context.generated, context[licenseRoot]], '/actual-private-work'],
          [['wasm', context.ir, context.guest, context[licenseRoot]], '/actual-private-work'],
        ]);
      } else {
        const begin = text.indexOf('    let compiler, invokeDriver;');
        const end = text.indexOf('\n    }', begin);
        assert(begin >= 0 && end > begin, 'one shared/fresh driver construction branch');
        const invoke = runInNewContext(text.slice(begin, end + '\n    }'.length) + '\ninvokeDriver;', {
          ...context, shared:owner, inputs:{},
          stageCompiler() {return {manifest:'/actual-captured-driver/Cargo.toml'};},
          createPrivateDriverTarget() {return '/actual-private-work/driver-target';},
          run() {assert.fail('shared path cannot adopt a fallback compiler');},
        });
        const argv = ['verify', '/actual-private-subject/project/lexlean.toml'];
        invoke(argv);
        assert.deepEqual(JSON.parse(JSON.stringify(observed)), [[argv, '/actual-source']]);
      }
      const exported = [];
      const roots = ['PrismPM.Fixture.root'], lean = '/actual-private-subject/lean', out = '/actual-private-subject/export';
      if (central) {
        const exporter = /compiler\.runExporter\(\['--module', 'PrismPM\.Fixture', \.\.\.roots\.flatMap\(root => \['--root', root\]\),[\s\S]*?\], join\(lean, '\.lake\/build\/lib\/lean'\)\)/.exec(text);
        assert(exporter, 'one central exporter bound to this fresh generated Lean');
        runInNewContext(exporter[0], {join, roots, lean, exported:out,
          compiler:{runExporter(...args) {exported.push(args);}}});
        assert.deepEqual(JSON.parse(JSON.stringify(exported)), [[
          ['--module', 'PrismPM.Fixture', '--root', roots[0], '--ir-module',
            family === 'presentation' ? 'BrowserPresentation' : 'BrowserPublication', '--out', out],
          lean + '/.lake/build/lib/lean',
        ]]);
      } else {
        const exporter = /const invokeExporter = args => shared \?[\s\S]*?;\n/.exec(text);
        assert(exporter, 'one unchanged model-path exporter boundary');
        const invokeExporter = runInNewContext(exporter[0] + '\ninvokeExporter;', {
          shared:{runExporter(...args) {exported.push(args);}}, join, lean,
          exporter:{bin:'/must-not-adopt',dir:'/must-not-adopt'},
          run() {assert.fail('shared path adopted an independent or cached executable');},
        });
        const args = ['--module','PrismPM.Fixture','--root',roots[0],'--out',out];
        invokeExporter(args);
        assert.deepEqual(JSON.parse(JSON.stringify(exported)), [[args, lean + '/.lake/build/lib/lean']]);
      }
      for (const call of [verifyCall, nativeCall, wasmCall]) assert(text.includes(call));
      assert(text.includes("run('lake', ['build', 'PrismGenerated'], lean)"));
      assert(text.includes("'two independent generated Core-Wasm packages'"));
      assert(text.includes(finalBarrier));
    };
    check(source);
    const mutations = [
      ["requireCompilerOwner(compilerOwner, '" + family + "')", "requireCompilerOwner(compilerOwner, 'absent-family')"],
      central ? ['compiler.runDriver(', 'untrusted.runDriver('] : ['if (shared) invokeDriver =', 'if (false) invokeDriver ='],
      central ? [verifyCall, verifyCall.replace('], work)', '], repository)')]
        : ['shared.runDriver(args, repository)', 'shared.runDriver(args, work)'],
      central ? ["], join(lean, '.lake/build/lib/lean'))", "], '/prior-export')"]
        : ["shared.runExporter(args, join(lean, '.lake/build/lib/lean'))", "shared.runExporter(args, '/prior-export')"],
      [verifyCall, verifyCall.replace("['verify',", "['check',")],
      [nativeCall, nativeCall.replace(', ' + licenseRoot + ']', ', work]')],
      [wasmCall, wasmCall.replace(', guest,', ', generated,')],
      ["run('lake', ['build', 'PrismGenerated'], lean)", 'undefined'],
      ["'two independent generated Core-Wasm packages'", "'REMOVED'"],
      [finalBarrier, 'undefined;'],
    ];
    assert.equal(mutations.length, 10, 'every original dispatch and refusal mutation remains');
    for (const [from, to] of mutations) {
      assert(source.includes(from), 'real mutation anchor: ' + family + ': ' + from);
      const changed = source.replaceAll(from, to); assert.notEqual(changed, source);
      assert.throws(() => check(changed), undefined, family + ': ' + from);
    }
  }
});

test('all four generated mutant owners recheck final evidence and actual compiler identity after execution', () => {
  // Execute the actual owner function with boundary fixtures; this is not
  // generated-model, native/Wasm, compiler, SDK or full-gate qualification.
  for (const family of ['budget', 'effects', 'operation-journal', 'publication']) {
    const directory = family === 'publication' ? 'publication-admission' : 'browser-' + family;
    const source = fs.readFileSync(new URL('../' + directory + '/checks.mjs', import.meta.url), 'utf8');
    const begin = source.indexOf('export function verifyModelMutation(');
    const next = source.indexOf('\nexport ', begin + 1);
    assert(begin >= 0);
    const body = source.slice(begin, next < 0 ? source.length : next).replace('export function ', 'function ');
    const ownerJoin = /if\s*\(compilerOwner\)\s*assert\.equal\(build\.(?:compilerOwner|compiler\.identity),\s*compilerOwner\.identity(?:,[^;]*)?\);/.exec(body);
    assert(ownerJoin, 'one actual provided-owner identity join: ' + family);
    const invoke = (text, {wrongOwner = false, evidenceFailure = false} = {}) => {
      const events = [], vector = {id:({budget:'BudgetApplication',effects:'CompletionSubstitution',
        'operation-journal':'TerminalMismatch3',publication:'ContextChangedSubjectsource'})[family],
      request:Buffer.alloc(0),response:Buffer.alloc(0)};
      const identity = wrongOwner ? 'foreign-owner' : 'actual-owner';
      const build = {work:'/private/mutant',runner:'/private/mutant/runner',compilerOwner:identity,
        compiler:{identity},verified:{source_id:'source',attestation_id:'attestation'},generation:{ir_sha256:'ir'},
        wasmBytes:Buffer.alloc(0),journalBytes:Buffer.alloc(0),partitionBytes:Buffer.alloc(0),
        compileNative(standard) {events.push(standard ? 'std' : 'no-std'); return '/private/native';},
        verifyEvidence() {events.push('evidence'); if (evidenceFailure) throw Error('actual final evidence refusal');}};
      const inputs = {}, function_ = runInNewContext(text + '\nverifyModelMutation;', {
        assert, Buffer, join, prepare:() => build, corpus:() => [vector], partitionCorpus:() => [vector],
        tsv:() => '', writeFileSync() {}, rmSync() {events.push('cleanup');}, assertFrozenInputs() {}, frozenInputs:() => inputs,
        sha:() => 'digest', run() {throw Error('native output mismatch');},
        executeWasm() {events.push('wasm'); throw Error('generated Wasm output mismatch');},
      });
      const args = ['budget', 'publication'].includes(family)
        ? [family === 'budget' ? 'identity' : 'binding', inputs, {identity:'actual-owner'}]
        : ['binding', {identity:'actual-owner'}];
      let error;
      try {function_(...args);} catch (caught) {error = caught;}
      return {events, error};
    };
    const check = text => {
      const completed = invoke(text), successCleanup = ['effects', 'operation-journal'].includes(family) ? ['cleanup'] : [];
      const failureCleanup = family === 'effects' ? ['cleanup'] : [];
      assert.ifError(completed.error);
      assert.deepEqual(completed.events, ['std', 'no-std', 'wasm', 'evidence', ...successCleanup],
        'final source/proof/IR check follows both real execution boundaries: ' + family);
      const foreign = invoke(text, {wrongOwner:true});
      assert.equal(foreign.error?.code, 'ERR_ASSERTION', 'actual identity assertion refuses the foreign compiler');
      assert.equal(foreign.error.actual, 'foreign-owner');
      assert.equal(foreign.error.expected, 'actual-owner');
      assert.deepEqual(foreign.events, failureCleanup, 'identity refusal preserves existing cleanup policy: ' + family);
      const refused = invoke(text, {evidenceFailure:true});
      assert.match(String(refused.error), /actual final evidence refusal/);
      assert.deepEqual(refused.events, ['std', 'no-std', 'wasm', 'evidence', ...failureCleanup],
        'final evidence refusal preserves existing cleanup policy: ' + family);
    };
    check(body);
    if (family === 'effects') {
      const outside = body.replace(ownerJoin[0], '').replace('  try {', ownerJoin[0] + '\n  try {');
      assert.notEqual(outside, body, 'actual existing Effects cleanup boundary');
      assert.throws(() => check(outside), /identity refusal preserves existing cleanup policy/,
        'moving the identity guard outside the existing try must lose cleanup and fail its witness');
    }
    const noEvidence = body.replace('build.verifyEvidence();', '');
    assert.notEqual(noEvidence, body);
    assert.throws(() => check(noEvidence), undefined, 'missing final evidence check: ' + family);
    const noJoin = body.replace(ownerJoin[0], '');
    assert.notEqual(noJoin, body);
    assert.throws(() => check(noJoin), undefined, 'missing provided-owner join: ' + family);
    const early = body.replace('build.verifyEvidence();', '').replace(
      'assert.throws(()=>executeWasm(', 'build.verifyEvidence();assert.throws(()=>executeWasm(');
    const spacedEarly = early === noEvidence ? noEvidence.replace(
      'assert.throws(() => executeWasm(', 'build.verifyEvidence();assert.throws(() => executeWasm(') : early;
    assert.notEqual(spacedEarly, noEvidence, 'actual final Wasm invocation anchor: ' + family);
    assert.throws(() => check(spacedEarly), undefined, 'evidence cannot precede final execution: ' + family);
  }
});

test('four serial owners retire exactly once on early failure without retrying an attempted close', () => {
  // Source-extracted lifecycle unit, not a substitute for the owning compiler
  // executions or provider/container retirement evidence.
  const owners = [
    ['budget', '../../sdk/browser/budget-model-test.mjs'],
    ['effects', '../../sdk/browser/effects-test.mjs'],
    ['presentation', '../../sdk/browser/presentation.test.mjs'],
    ['operation-journal', '../browser-operation-journal/checks.mjs'],
  ];
  for (const [family, path] of owners) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const check = text => {
      const after = /t\.after\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!retirementAttempted\)\s*\{\s*retirementAttempted\s*=\s*true;\s*owner\.close\(\);\s*\}[\s\S]*?\}\);/.exec(text);
      const normal = /retirementAttempted\s*=\s*true;\s*const retirement\s*=\s*owner\.close\(\);/.exec(text);
      assert(after && normal, 'both actual once-only retirement paths: ' + family);
      const creation = text.indexOf("createCompilerOwner('" + family + "')");
      const boundary = family === 'presentation' ? text.indexOf('finally { assert.equal(process.umask()')
        : text.indexOf('verifyCompilerOwnerSubstitutions(owner)');
      assert(creation >= 0 && creation < after.index && after.index + after[0].length < boundary,
        'failure retirement is armed before substitution, model execution or final umask assertion');
      const lifecycle = (closeFails = false) => {
        const events = [], callbacks = [];
        const finish = runInNewContext('let retirementAttempted = false;\n' + after[0]
          + '\n() => {' + normal[0] + '};', {
          t:{after(callback) {callbacks.push(callback);}},
          owner:{close() {events.push('close'); if (closeFails) throw Error('actual retirement refusal');}},
        });
        assert.equal(callbacks.length, 1);
        return {events, finish, cleanup:callbacks[0]};
      };
      for (const failure of ['substitution', 'action']) {
        const early = lifecycle();
        assert.throws(() => {throw Error('actual early ' + failure + ' refusal');}, /actual early/);
        early.cleanup(); early.cleanup();
        assert.deepEqual(early.events, ['close'], 'one fallback close after early ' + failure);
      }
      const completed = lifecycle(); completed.finish(); completed.cleanup(); completed.cleanup();
      assert.deepEqual(completed.events, ['close'], 'successful normal close is never repeated');
      const refused = lifecycle(true);
      assert.throws(refused.finish, /actual retirement refusal/);
      refused.cleanup(); refused.cleanup();
      assert.deepEqual(refused.events, ['close'], 'failed normal close is never retried');
      const fallbackRefused = lifecycle(true);
      assert.throws(fallbackRefused.cleanup, /actual retirement refusal/); fallbackRefused.cleanup();
      assert.deepEqual(fallbackRefused.events, ['close'], 'failed fallback close is never retried');
    };
    check(source);
    const after = /t\.after\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!retirementAttempted\)\s*\{\s*retirementAttempted\s*=\s*true;\s*owner\.close\(\);\s*\}[\s\S]*?\}\);/.exec(source);
    const normal = /retirementAttempted\s*=\s*true;\s*const retirement\s*=\s*owner\.close\(\);/.exec(source);
    for (const changed of [
      source.replace(after[0], ''),
      source.replace(normal[0], normal[0].replace(/retirementAttempted\s*=\s*true;/, '')),
      source.replace(after[0], after[0].replace(/retirementAttempted\s*=\s*true;/, '')),
      source.replace(after[0], '') + '\n' + after[0],
    ]) {
      assert.notEqual(changed, source);
      assert.throws(() => check(changed), undefined, 'deleted or moved real retirement guard: ' + family);
    }
  }
});

test('fresh independent drivers pin hash optimization without changing construction or acceptance',()=>{
  // Construction-argument unit only. Full owning executions remain required.
  const source=fs.readFileSync(new URL('./compiler-owner.mjs',import.meta.url),'utf8');
  const begin=source.indexOf("    run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0',");
  const end=source.indexOf('\n    const driverBuildMs',begin);
  assert(begin>=0&&end>begin);const calls=[];
  runInNewContext(source.slice(begin,end),{run(...args){calls.push(args);},join,
    work:'/actual-private-owner',manifest:'driver/Cargo.toml',target:'/actual-fresh-target'});
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['cargo',[
    'build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0',
    '--config','build.incremental=false','--config','profile.dev.package.sha2.opt-level=3',
    '--manifest-path','/actual-private-owner/driver/Cargo.toml'],
    '/actual-private-owner',{CARGO_TARGET_DIR:'/actual-fresh-target'}]]);
  for(const family of ['view','command','query']){
    const source=fs.readFileSync(new URL('../browser-'+family+'/compile.mjs',import.meta.url),'utf8');
    const begin=source.indexOf("run('cargo',['build','--locked','--offline','--jobs','1',");
    const suffix="],repository,{CARGO_TARGET_DIR:driverTarget});";
    const end=source.indexOf(suffix,begin);
    assert(begin>=0&&end>begin,'actual fallback construction '+family);
    const calls=[];
    runInNewContext(source.slice(begin,end+suffix.length),{run(...args){calls.push(args);},join,
      draft:'/actual-source/tests/browser-'+family,repository:'/actual-source',driverTarget:'/actual-fresh-'+family});
    assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['cargo',[
      'build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0',
      '--config','build.incremental=false','--config','profile.dev.package.sha2.opt-level=3',
      '--manifest-path','/actual-source/tests/browser-'+family+'/driver/Cargo.toml'],
      '/actual-source',{CARGO_TARGET_DIR:'/actual-fresh-'+family}]]);
  }
  const remaining = [
    ...['budget','custody','dynamic-choice','effects','operation-journal','semantic-presentation']
      .map(family=>({path:'tests/browser-'+family+'/compile.mjs',manifest:'/captured-compiler/Cargo.toml',cwd:'/actual-work'})),
    {path:'tests/browser-journal/compile.mjs',manifest:'/actual-draft/driver/Cargo.toml',cwd:'/actual-source'},
    ...['session-journal','session-payloads']
      .map(family=>({path:'tests/browser-'+family+'/compile.mjs',manifest:'/captured-manifest/Cargo.toml',cwd:'/actual-work'})),
    {path:'tests/browser-session-journal-recovery/compile.mjs',manifest:'/captured-manifest/Cargo.toml',cwd:'/actual-work',program:'/pinned-cargo',target:'/actual-owned-target'},
    {path:'sdk/browser/workspace-model-test.mjs',manifest:'/actual-source/tests/browser-workspace/Cargo.toml',cwd:'/actual-source'},
    {path:'sdk/browser/envelope-model-test.mjs',manifest:'/actual-fixture/driver/Cargo.toml',cwd:'/actual-source'},
  ];
  // Reservation and Recovery Frames borrow registered owners; their build is pinned above.
  assert.equal(remaining.length,12);assert.equal(new Set(remaining.map(row=>row.path)).size,12);
  for(const row of remaining){
    const source=fs.readFileSync(new URL('../../'+row.path,import.meta.url),'utf8');
    const check = text => {
      const fresh=row.path==='tests/browser-budget/compile.mjs'
        ? /const driverTarget\s*=\s*join\(work,\s*'driver-target'\)/
        : row.program ? /const target\s*=\s*createPrivateDriverTarget\(work\)/
        : /const driverTarget\s*=\s*createPrivateDriverTarget\(work\)/;
      assert.match(text,fresh,'original fresh owned target '+row.path);
      const calls=[];
      const selected=[...text.matchAll(/run\((?:'cargo'|toolchain\.programs\.cargo\.path),\s*\['build',\s*'--locked',\s*'--offline',\s*'--jobs',\s*'1',[\s\S]*?\],\s*(?:repository|work),\s*\{CARGO_TARGET_DIR:\s*(?:driverTarget|target)\}\)/g)];
      assert.equal(selected.length,1,'one actual private driver construction '+row.path);
      runInNewContext(selected[0][0],{run(...args){calls.push(args);},join,
        compiler:{manifest:'/captured-compiler/Cargo.toml'},manifest:'/captured-manifest/Cargo.toml',
        draft:'/actual-draft',fixture:'/actual-fixture',repository:'/actual-source',work:'/actual-work',
        driverTarget:'/actual-fresh-target',target:'/actual-owned-target',toolchain:{programs:{cargo:{path:'/pinned-cargo'}}}});
      assert.deepEqual(JSON.parse(JSON.stringify(calls)),[[row.program??'cargo',[
        'build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0',
        '--config','build.incremental=false','--config','profile.dev.package.sha2.opt-level=3',
        '--manifest-path',row.manifest],row.cwd,{CARGO_TARGET_DIR:row.target??'/actual-fresh-target'}]]);
    };
    check(source);
    const setting=/'--config',\s*'profile\.dev\.package\.sha2\.opt-level=3'/;
    assert.equal([...source.matchAll(new RegExp(setting.source,'g'))].length,1);
    for(const replacement of ['',"'--config', 'profile.dev.package.sha2.opt-level=2'",
      "'--config', 'profile.dev.opt-level=3'","'--config', 'profile.test.package.sha2.opt-level=3'",
      "$&,$&","$&,'--config','profile.dev.package.sha2.opt-level=0'"]){
      const changed=source.replace(setting,replacement);assert.notEqual(changed,source);
      assert.throws(()=>check(changed),row.path+': '+replacement);
    }
    for(const [from,to]of [["'--locked'","'REMOVED'"],["'--offline'","'REMOVED'"],
      ["'--jobs', '1'","'--jobs', '2'"],["'profile.dev.debug=0'","'profile.dev.debug=2'"],
      ["'build.incremental=false'","'build.incremental=true'"]]){
      const expression=new RegExp(from.replaceAll('.', '\\.').replaceAll(', ', ',\\s*'));
      const changed=source.replace(expression,to);assert.notEqual(changed,source);
      assert.throws(()=>check(changed),row.path+': '+from);
    }
    const changed=source.replace(row.path==='tests/browser-budget/compile.mjs'
      ? "join(work, 'driver-target')" : 'createPrivateDriverTarget(work)', "'/unproved-shared-target'");
    assert.notEqual(changed,source);assert.throws(()=>check(changed),row.path+': fresh target substitution');
  }
});

test('product preservation detects generated source proof package native Wasm and custody defects', t => {
  for (const family of ['effects', 'budget', 'operation-journal', 'presentation', 'publication']) {
    const work=fs.mkdtempSync(join(tmpdir(),'prismpm-product-preservation-'));
    t.after(()=>fs.rmSync(work,{recursive:true,force:true}));
    const put=(relative,bytes='product-preservation unit fixture')=>{
      const path=join(work,relative);fs.mkdirSync(join(path,'..'),{recursive:true});
      fs.writeFileSync(path,bytes);return path;
    };
    const executable=family==='publication'?'publication-admission-runner':'browser-'+family+'-runner';
    const paths=['project/source.lex.tex','lean/modules/source','export/kernel.ir',
      'generated/Cargo.toml',
      ...(family==='presentation' ? ['licenses/LICENSE-MIT',
        'runner-std/src/main.rs','runner-no-std/src/main.rs',
        'native-target-std/release/'+executable,'native-target-no-std/release/'+executable,
        'native-std-observer','native-no-std-observer']
        : ['runner/src/main.rs','native-target/release/'+executable])];
    if(family==='operation-journal')paths.push('generated-b/Cargo.toml');
    const guests=family==='effects'?['a','b','echo']:['budget','publication'].includes(family)?['a','b']:
      family==='presentation'?['a','b','fixture','labels','intent','secret','route','sink',
        'maxroute','maxsink','maxfield','maxsecret','progress','maxprogress']:
        ['a','b','echo','journal','partition','journal-b','partition-b'];
    for(const guest of guests)paths.push('guest-'+guest+'/Cargo.toml',
      (family==='presentation' ? 'guest-target-'+guest : 'guest-'+guest+'/target')
        +'/wasm32-unknown-unknown/release/product.wasm');
    if(family==='presentation')for(const guest of guests)paths.push('guest-'+guest+'-execution.wasm');
    for(const path of paths)put(path);
    const native=join(work,(family==='presentation'?'native-target-std':'native-target')+'/release/'+executable);
    const linked=join(native,'../cargo-deps-link');
    fs.linkSync(native,linked);
    const linkedProducts=captureVerificationProducts(work,family);
    assert.equal(linkedProducts.files.find(row=>row.path===native.slice(work.length+1)).links,'2',
      'preserve genuine Cargo-style product link count, not single-link source policy');
    fs.appendFileSync(linked,'changed through link');
    assert.throws(()=>assert.deepEqual(captureVerificationProducts(work,family),linkedProducts));
    fs.writeFileSync(linked,'product-preservation unit fixture');
    const verify=(snapshot)=>assert.deepEqual(captureVerificationProducts(work,family),snapshot);
    for(const relative of paths) {
      const path=join(work,relative),before=captureVerificationProducts(work,family);
      const bytes=fs.readFileSync(path);
      fs.appendFileSync(path,'changed');
      assert.throws(()=>verify(before),undefined,'changed actual product: '+relative);
      fs.writeFileSync(path,bytes);
      const restored=captureVerificationProducts(work,family);
      fs.renameSync(path,path+'-saved');
      assert.throws(()=>verify(restored),undefined,'deleted actual product: '+relative);
      fs.renameSync(path+'-saved',path);
    }
    const path=join(work,paths[0]),before=captureVerificationProducts(work,family);
    fs.renameSync(path,path+'-saved');fs.copyFileSync(path+'-saved',path);
    assert.throws(()=>verify(before),undefined,'same-byte replacement is not original product custody');
    fs.unlinkSync(path);fs.renameSync(path+'-saved',path);
    const current=captureVerificationProducts(work,family),mode=fs.lstatSync(path).mode;
    fs.chmodSync(path,mode^0o040);
    assert.throws(()=>verify(current),undefined,'product mode change');
    fs.chmodSync(path,mode);
    const stable=captureVerificationProducts(work,family);
    put('generated/added');
    assert.throws(()=>verify(stable),undefined,'added package artifact');
    fs.unlinkSync(join(work,'generated/added'));
    for (const relative of ['generated/src/target', 'project/src/target', 'lean/modules/target', 'export/target']) {
      const prior = captureVerificationProducts(work,family);
      const payload = put(relative + '/payload');
      assert.throws(()=>verify(prior),undefined,'nested source/proof/package target cannot hide an artifact: '+relative);
      const captured = captureVerificationProducts(work,family);
      fs.appendFileSync(payload,'changed');
      assert.throws(()=>verify(captured),undefined,'nested target payload change: '+relative);
      fs.unlinkSync(payload);fs.rmdirSync(join(work,relative));
    }
    fs.renameSync(path,path+'-saved');fs.symlinkSync(path+'-saved',path);
    assert.throws(()=>captureVerificationProducts(work,family),/aliases|unaliased/);
    fs.unlinkSync(path);fs.renameSync(path+'-saved',path);
    const root=join(work,'lean'),rootMode=fs.lstatSync(root).mode;
    fs.chmodSync(root,rootMode|0o020);
    assert.throws(()=>captureVerificationProducts(work,family),/group\/other writable/);
    fs.chmodSync(root,rootMode);
    const guest=join(work,'guest-'+guests[0]);
    fs.renameSync(guest,guest+'-substituted');
    assert.throws(()=>captureVerificationProducts(work,family),/exact independent generated guest inventory/);
    fs.renameSync(guest+'-substituted',guest);
  }
});

test('compiler owner refuses malformed or incomplete input closures before building', () => {
  const families = ['view', 'effects', 'presentation', 'session', 'operation-journal', 'budget', 'custody', 'p256', 'signed-context', 'session-operation', 'pkce', 'holo-primary-component', 'session-retention', 'session-journal-reservation', 'session-recovery-frames', 'publication-linkage', 'account-genesis', 'publication'];
  const source = fs.readFileSync(new URL('./compiler-owner.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('const families = Object.freeze({');
  const end = source.indexOf('\nconst owners = ', begin);
  assert(begin >= 0 && end > begin);
  const registered = runInNewContext(source.slice(begin, end) + '\nObject.keys(families);');
  assert.deepEqual([...registered].sort(), [...families].sort(), 'every registered family retains all malformed-input controls');
  let called = false;
  const accessor = {get malicious() {called = true; return '0'.repeat(64);}};
  for (const family of families) for (const inputs of [null, [], accessor, {'../escape': '0'.repeat(64)},
    {'vendor/lexlean/MANIFEST.sha256': 'invalid'}, {'a': null}, {'a': 42}, {}])
    assert.throws(() => createCompilerOwner(family, inputs),
      /compiler input (map|path|digest|closure)/);
  assert.equal(called, false, 'input accessors cannot run before immutable capture');
  for (const name of families) {
    const inputs = captureCompilerInputs(name);
    for (const missing of ['tests/browser-view/compile.mjs', 'tests/browser-view/compiler-artifact.mjs',
      'tests/browser-view/compiler-owner-checks.mjs',
      'tests/browser-view/verification-products.mjs', 'vendor/lean4-prod/lean.tar']) {
      const changed = {...inputs}; delete changed[missing];
      assert.throws(() => createCompilerOwner(name, changed), /complete closed compiler input closure/);
    }
    for (const substituted of ['tests/browser-view/compiler-owner-checks.mjs', 'tests/browser-view/verification-products.mjs'])
      assert.throws(() => createCompilerOwner(name, {...inputs, [substituted]:'0'.repeat(64)}),
        /captured compiler source/, 'actual helper digest substitution: ' + name + ': ' + substituted);
    assert.throws(() => createCompilerOwner(name, {...inputs, unexpected: '0'.repeat(64)}), /complete closed compiler input closure/);
  }
});

// Complete preservation fixtures only, not generated-model or compiler acceptance.
function productGuardFixture(t) {
  const work = fs.mkdtempSync(join(tmpdir(), 'prismpm-product-guard-'));
  t.after(() => fs.rmSync(work, {recursive:true, force:true}));
  const put = (relative, bytes = 'product custody guard fixture') => {
    const path = join(work, relative);
    fs.mkdirSync(join(path, '..'), {recursive:true}); fs.writeFileSync(path, bytes);
    return path;
  };
  for (const path of ['project/source.lex.tex', 'lean/modules/source', 'export/kernel.ir',
    'generated/Cargo.toml', 'runner/src/main.rs', 'native-target/release/browser-effects-runner',
    ...['a', 'b', 'echo'].flatMap(name => ['guest-' + name + '/Cargo.toml',
      'guest-' + name + '/target/wasm32-unknown-unknown/release/product.wasm'])]) put(path);
  return {work, put, capture: () => captureVerificationProducts(work, 'effects')};
}

test('product preservation admits depth 64 and refuses the next actual product directory', t => {
  const {work, capture} = productGuardFixture(t);
  let path = join(work, 'generated');
  for (let depth = 1; depth <= 64; depth++) {path = join(path, 'd'); fs.mkdirSync(path);}
  const admitted = capture();
  assert(admitted.directories.some(row => row.path === path.slice(work.length + 1)));
  fs.mkdirSync(join(path, 'd'));
  assert.throws(capture, /bounded generated directory depth/);
});

test('product preservation bounds actual directory enumeration at exactly 8192 entries', t => {
  const {work, put, capture} = productGuardFixture(t);
  // The workspace inventory is enumerated in full, including non-guest entries;
  // these do not consume the separate retained-file inventory budget.
  for (let count = fs.readdirSync(work).length; count < 8192; count++)
    put('entry-' + count.toString().padStart(5, '0'), '');
  assert.equal(fs.readdirSync(work).length, 8192);
  capture();
  put('entry-over-limit', '');
  assert.throws(capture, /bounded generated directory entries/);
});

test('product preservation refuses aliases files and writable exact guest cache roots', t => {
  const {work, capture} = productGuardFixture(t);
  const target = join(work, 'guest-a/target'), saved = join(work, 'preserved-cache-target');
  capture(); fs.renameSync(target, saved);
  fs.writeFileSync(target, 'not a Cargo cache directory');
  assert.throws(capture, /owned real guest Cargo cache required/);
  fs.unlinkSync(target); fs.symlinkSync(saved, target);
  assert.throws(capture, /generated products cannot be aliases/);
  fs.unlinkSync(target); fs.renameSync(saved, target);
  const mode = fs.lstatSync(target).mode;
  fs.chmodSync(target, mode | 0o020);
  assert.throws(capture, /owned real guest Cargo cache required/);
  fs.chmodSync(target, mode); capture();
});

test('product preservation retains all nine directory fields and refuses metadata drift during traversal', t => {
  const {work, capture} = productGuardFixture(t);
  const before = capture(), directory = join(work, 'project');
  for (const row of before.directories) {
    const value = fs.lstatSync(join(work, row.path), {bigint:true});
    assert.deepEqual(row, {path:row.path, device:value.dev.toString(), inode:value.ino.toString(),
      uid:value.uid.toString(), gid:value.gid.toString(), mode:Number(value.mode),
      links:value.nlink.toString(), size:value.size.toString(),
      mtime:value.mtimeNs.toString(), ctime:value.ctimeNs.toString()});
  }
  const stamp = fs.lstatSync(directory);
  fs.utimesSync(directory, stamp.atime, new Date(stamp.mtimeMs + 2000));
  const changed = capture();
  assert.deepEqual(changed.files, before.files, 'directory-only change preserves every file');
  assert.notDeepEqual(changed.directories, before.directories, 'directory timestamps are custody');
  const source = fs.readFileSync(new URL('./verification-products.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('function observeProduct(path) {');
  assert(begin >= 0);
  const body = source.slice(begin);
  assert.equal(body.split('export function captureVerificationProducts(').length, 2);
  let injected = false;
  const observingCapture = runInNewContext(body.replace('export function captureVerificationProducts(',
    'function captureVerificationProducts(') + '\ncaptureVerificationProducts;',
    {...fs, assert, createHash, join, Buffer, process, readSync(...args) {
      if (!injected) {
        injected = true;
        const value = fs.lstatSync(directory);
        fs.utimesSync(directory, value.atime, new Date(value.mtimeMs + 2000));
      }
      return fs.readSync(...args);
    }});
  assert.throws(() => observingCapture(work, 'effects'), /generated directory changed during observation/);
  assert.equal(injected, true, 'actual filesystem mutation occurred within the real file read');
});
