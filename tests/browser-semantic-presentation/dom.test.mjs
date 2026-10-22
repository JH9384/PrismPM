// Component-only; mandatory owning tests also supply generated artifacts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {engines, journey, journeyNames, verifyMutants} from './browser.mjs';

test('actual semantic DOM component and imported accessibility oracle', async t => {
  for (const engine of engines) {
    const result = await journey(t, null, {}, engine);
    assert.equal(result.engine, engine);
    assert.equal(result.modelChecked, false);
    assert.deepEqual(result.cases, journeyNames);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.palettes.map(row=>[row.colorScheme,row.disabled,row.disabledCount]),
      [['light',false,0],['light',true,5],['dark',false,0],['dark',true,5]],
      'complete enabled/pending observations retain distinct lifecycle and control-count fields');
  }
  const planted = counterexampleGate(t, ({browser, replace}) => replace(browser,
    'active.palettes.push({...palette, colorScheme, disabled, oracle:forced});',
    'active.palettes.push({...palette, colorScheme, disabled:palette.disabledCount, oracle:forced});'));
  assert.match(planted.error, /exact phase-bound palette observation inventory/,
    'the actual prior count-overwrite defect fails the component before compilation or mutant evidence');
});

test('actual semantic DOM mutants fail complete component journeys', async t => {
  for (const engine of engines) {
    const evidence = await verifyMutants(t, null, engine);
    assert.deepEqual(evidence.map(row => row.check), ['email-autocomplete', 'email-type',
      'error-associations', 'main-landmark', 'catalogue-preflight-0', 'wide-layout-columns',
      'forced-system-palette', 'forced-authored-disabled-background']);
  }
});

const repository = fileURLToPath(new URL('../../', import.meta.url));
function replaceOnce(source, from, to) {
  assert.equal(source.split(from).length, 2, 'one exact harness defect');
  return source.replace(from, to);
}
function counterexampleGate(t, change) {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-semantic-gate-'));
  let complete = false;
  t.after(() => {
    if (complete) rmSync(work, {recursive:true, force:true});
    else t.diagnostic('Retained failed semantic gate probe ' + work);
  });
  for (const path of ['sdk/browser', 'tests/browser-semantic-presentation', 'tests/browser-presentation'])
    cpSync(join(repository, path), join(work, path), {recursive:true, errorOnExist:true});
  for (const path of ['model/browser-semantic-presentation-oracles.json',
    'sdk/oracles/package.json', 'sdk/oracles/package-lock.json']) {
    mkdirSync(dirname(join(work, path)), {recursive:true});
    cpSync(join(repository, path), join(work, path), {errorOnExist:true});
  }
  const require = createRequire(new URL('../../sdk/oracles/package.json', import.meta.url));
  const axe = dirname(require.resolve('axe-core/package.json',
    {paths:[join(repository, 'sdk/oracles'), '/opt/prismpm/oracles']}));
  cpSync(axe, join(work, 'sdk/oracles/node_modules/axe-core'), {recursive:true, errorOnExist:true});
  const browser = join(work, 'tests/browser-semantic-presentation/browser.mjs');
  const server = join(work, 'sdk/browser/browser-test-server.mjs');
  change({work, browser, server, replace(path, from, to) {
    writeFileSync(path, replaceOnce(readFileSync(path, 'utf8'), from, to));
  }});
  const runner = join(work, 'gate.mjs');
  writeFileSync(runner, `import {verifyMutants} from './tests/browser-semantic-presentation/browser.mjs';
const killed=[];try{await verifyMutants({diagnostic(value){if(String(value).startsWith('killed semantic '))killed.push(value);}});
process.stdout.write(JSON.stringify({accepted:true,killed}));}catch(error){process.stdout.write(JSON.stringify({accepted:false,killed,error:String(error),code:error.code}));}
`, {flag:'wx'});
  const child = spawnSync(process.execPath, [runner], {cwd:work, encoding:'utf8', timeout:60000, maxBuffer:1048576});
  assert.ifError(child.error); assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.accepted, false, 'an unrelated failure or surviving mutant cannot confer evidence');
  assert.deepEqual(result.killed, [], 'no false mutant receipt before the actual intended counterexample');
  complete = true; return result;
}

test('missing imported accessibility oracle cannot count as semantic mutant evidence', t => {
  const result = counterexampleGate(t, ({browser, replace}) =>
    replace(browser, "'axe-core/package.json'", "'prismpm-negative-missing-axe-core/package.json'"));
  assert.equal(result.code, 'MODULE_NOT_FOUND');
});

test('actual browser launch failure cannot count as semantic mutant evidence', t => {
  const result = counterexampleGate(t, ({work, server, replace}) => {
    replace(server, '.launch({headless: true, executablePath})',
      '.launch({headless: true, executablePath:' + JSON.stringify(join(work, 'absent-browser')) + '})');
  });
  assert.match(result.error, /executable doesn't exist|ENOENT|does not exist/i);
});

test('actual closed-page failure cannot count as semantic mutant evidence', t => {
  const result = counterexampleGate(t, ({browser, replace}) =>
    replace(browser, 'await page.goto(baseURL);\n  await page.evaluate',
      'await page.close();\n  await page.goto(baseURL);\n  await page.evaluate'));
  assert.match(result.error, /Target page, context or browser has been closed/);
});

test('a no-op adapter mutation cannot count as semantic mutant evidence', t => {
  const result = counterexampleGate(t, ({browser, replace}) =>
    replace(browser, '"\'name\', \'organization\', \'off\', \'username\'"',
      '"\'name\', \'organization\', \'email\', \'username\'"'));
  assert.match(result.error, /mutant survived/);
});

test('a different semantic failure cannot count as the expected mutant counterexample', t => {
  const result = counterexampleGate(t, ({browser, replace}) =>
    replace(browser, "DOM_CASE, 'email-autocomplete'", "DOM_CASE, 'error-associations'"));
  assert.match(result.error, /exact expected semantic check/);
});
