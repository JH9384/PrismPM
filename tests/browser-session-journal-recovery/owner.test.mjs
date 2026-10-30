import test from 'node:test';
import {verifyRecoveryOwner} from './checks.mjs';

// Measured complete 24-mutant workload exceeded the former 58-minute cap.
// The unchanged vectors/maxima/mutants took 4,278 s on LexLean 0.3 and 5,188 s
// on LexLean 0.4 (about 49 s per `driver verify`, 25 fresh builds), 96% of the
// former 90-minute bound; 118 minutes keeps the same work with margin. Stage
// timings expose remaining cost; byte-equivalent closure checks avoid reparsing.
test('fresh linked source/kernel/native/Wasm recovery and metadata components', {timeout: 7100000}, t => {
  const {build, evidence} = verifyRecoveryOwner();
  t.diagnostic('retained private recovery component work ' + build.work);
  t.diagnostic(JSON.stringify({scope: evidence.scope, cases: evidence.cases}));
  t.diagnostic(JSON.stringify({actualMaxima: evidence.maxima.length, compiledMutants: evidence.mutations.length}));
});
