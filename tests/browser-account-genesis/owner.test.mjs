import test from 'node:test';
import {verifyAccountGenesis} from './checks.mjs';

test('DK-33 complete generated account genesis and actual cryptographic facts',
  {timeout: 3500000}, async t => {
    await verifyAccountGenesis(t);
  });
