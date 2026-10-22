import test from 'node:test';
import {verifySignedContext} from '../../tests/browser-signed-context/checks.mjs';

test('DK-32 complete generated signed-context and actual cryptographic evidence owner',
  {timeout: 3500000}, verifySignedContext);
