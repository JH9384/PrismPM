// The static world-within-policy check in the runtime (issue #283, docs/proposals/283-world-within-policy.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, CapabilityDeniedError, classForCheck, errorFromVerdict } from '../src/index.mjs';
import { worldPolicy, ASSURANCE } from '../src/vendor/verify.mjs';
import { reference } from '../../verify/test/helpers.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const caps = (set) => ({ schema: 'prism/capabilities/1', sets: { default: set } });

test('the reference archive loads with its world: within the grant, pure, no impure effect', async () => {
  for (const capabilities of [null, caps({}), caps({ 'allow-variables': ['*'] })]) {
    const app = await load(reference(), { capabilities });
    assert.deepEqual({ ...app.world }, { contract: 'hologram:guest/core-wasm@1', within: true, pure: true, effects: [] });
    assert.ok(Object.isFrozen(app.world));
  }
});

test('the grant exposes its members, and null when nothing is granted', async () => {
  assert.equal((await load(reference())).capabilities.members, null);
  const app = await load(reference(), { capabilities: caps({ 'allow-variables': ['log_level'] }) });
  assert.deepEqual(app.capabilities.members, { 'allow-variables': ['log_level'] });
});

test('the runtime and the verifier share one function: worldPolicy', () => {
  assert.deepEqual(worldPolicy('hologram:guest/core-wasm@1', null), { known: true, within: true, problems: [], pure: true, effects: [] });
});

test('holo.experimental_verify judges the grant the holo was loaded with, and an option replaces it', async () => {
  const app = await load(reference(), { capabilities: caps({ 'allow-variables': ['*'] }) });
  const verdict = await app.experimental_verify({ minimum: 'P0' });
  assert.ok(!verdict.reasons.some((r) => r.check === 'world.capabilities'));
  assert.equal((await app.experimental_verify({ minimum: 'P0', capabilities: null })).passed, true);
});

test('world.capabilities maps to CapabilityDeniedError, and a failed verdict names it before a level shortfall', () => {
  assert.equal(classForCheck('world.capabilities'), CapabilityDeniedError);
  const verdict = {
    schema: 'prism/verdict/1',
    holo: `blake3:${'0'.repeat(64)}`,
    level: 'P0',
    policy: { name: 'default', minimum: 'P2' },
    passed: false,
    reasons: [
      { check: 'provenance.statement', withholds: 'P1', message: 'No provenance.' },
      { check: 'world.capabilities', code: 'PP5602', withholds: 'P3', message: 'The world exceeds the granted capabilities.' },
      { check: 'policy.level', code: 'PP5601', withholds: null, message: 'Below P2.' },
    ],
  };
  const error = errorFromVerdict(verdict, ASSURANCE.RANK);
  assert.ok(error instanceof CapabilityDeniedError);
  assert.equal(error.check, 'world.capabilities');
  assert.equal(error.diagnostic, 'PP5602');
});

test('prism-code run prints the world line', async () => {
  // run gates on check (#282); every holo is P0 today, so this runs under a P0 policy to reach the world line.
  const p0 = join(mkdtempSync(join(tmpdir(), 'prism-world-p0-')), 'p0.json');
  writeFileSync(p0, JSON.stringify({ minimum: 'P0' }));
  const child = spawn(process.execPath, [bin, 'run', '--policy', p0, fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url))], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  await new Promise((done, fail) => {
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('world:')) done();
    });
    child.on('exit', () => fail(new Error(`run exited: ${out}`)));
  });
  child.kill();
  assert.match(out, /\ncapabilities: none granted\nworld: hologram:guest\/core-wasm@1 within the grant, pure\n/);
});
