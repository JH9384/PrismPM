import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import test from 'node:test';

test('complete published OSCAL JSON structural oracle and genuine defect owner', async () => {
  assert.ok(existsSync(new URL('../../sdk/oracles/oscal/Cargo.toml', import.meta.url)),
    'the real published-engine oracle must exist before structural acceptance');
  const {verifyCompleteOscalOracle} = await import('./owner.mjs');
  await verifyCompleteOscalOracle();
});
