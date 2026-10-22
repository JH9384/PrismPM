import test from 'node:test';
import {verifyRetentionOwner} from './checks.mjs';
test('fresh source/kernel/native/Wasm retention with actual browser transactions and source mutants', {timeout: 3500000}, async t => {
  const {build, evidence} = await verifyRetentionOwner(t);
  t.diagnostic('retained private retention work ' + build.work);
  t.diagnostic(JSON.stringify({scope: evidence.scope, cases: evidence.cases,
    actualMaxima: evidence.maxima.length, compiledMutants: evidence.mutations.length, browser: evidence.browser.length}));
});
