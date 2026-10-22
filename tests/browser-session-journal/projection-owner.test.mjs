import test from 'node:test';
import {verifyProjectionOwner} from './projection-checks.mjs';

test('actual generated predecessor and observation with complete maxima and compiled source defects', {timeout: 3500000}, t => {
  const {build, evidence} = verifyProjectionOwner();
  t.diagnostic('retained private projection work ' + build.work);
  t.diagnostic(JSON.stringify({scope: evidence.scope, cases: evidence.cases,
    maxima: evidence.predecessorMaxima.length + evidence.observationMaxima.length,
    compiledMutants: evidence.mutations.length}));
});
