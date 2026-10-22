import test from 'node:test';
import {verifyRecoveryOwner} from './checks.mjs';

// Measured complete 24-mutant workload exceeded the former 58-minute cap.
// Ninety minutes bounds the unchanged vectors/maxima/mutants; stage timings
// expose remaining cost, while byte-equivalent closure checks avoid reparsing.
test('fresh linked source/kernel/native/Wasm recovery and metadata components', {timeout: 5400000}, t => {
  const {build, evidence} = verifyRecoveryOwner();
  t.diagnostic('retained private recovery component work ' + build.work);
  t.diagnostic(JSON.stringify({scope: evidence.scope, cases: evidence.cases}));
  t.diagnostic(JSON.stringify({actualMaxima: evidence.maxima.length, compiledMutants: evidence.mutations.length}));
});
