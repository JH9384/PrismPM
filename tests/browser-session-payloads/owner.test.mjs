import test from 'node:test';
import {verifyPayloadOwner} from './checks.mjs';
test('fresh modeled payload source, native/Wasm and actual browser staging with host mutants', {timeout:3500000}, async t=>{
  const {build,evidence,receipt}=await verifyPayloadOwner(t);
  t.diagnostic(JSON.stringify({work:build.work,receipt,scope:evidence.scope,cases:evidence.cases,
    journeys:evidence.journeys.length,mutants:evidence.mutants.length}));
});
