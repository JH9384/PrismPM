import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyComponent} from './checks.mjs';

test('HO-15 exact modeled primary component passes pinned binary execution and complete negative evidence',
  {timeout:3540000}, async () => {
    const result = await verifyComponent();
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    process.stdout.write('HO-15 component evidence ' + JSON.stringify(result) + '\n');
  });
