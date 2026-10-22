import test from 'node:test';
import {verifyCompletePublicationLinkage} from './checks.mjs';

test('OC-10 binds actual source declaration and complete captured publication context',
  {timeout: 3500000}, async t => {
    await verifyCompletePublicationLinkage(t);
  });
