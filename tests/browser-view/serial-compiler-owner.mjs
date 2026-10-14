// Test-only reuse of genuine freshly constructed tools, never model outputs.
import assert from 'node:assert/strict';
import {createCompilerOwner, requireCompilerOwner} from './compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from './compiler-owner-checks.mjs';
import {captureVerificationProducts} from './verification-products.mjs';

const families = new Set(['effects', 'presentation', 'operation-journal', 'budget', 'publication']);
export async function withCompilerOwner(t, family, action) {
  assert(families.has(family), 'existing serial compiler family required');
  assert.equal(typeof action, 'function');
  const owner = createCompilerOwner(family);
  let retirementAttempted = false;
  t.after(() => { if (!retirementAttempted) { retirementAttempted = true; owner.close(); } });
  const substitutions = verifyCompilerOwnerSubstitutions(owner), retained = [];
  const retain = build => {
    assert.equal(build.compilerOwner, owner.identity, 'subject uses its genuine fresh family owner');
    assert.equal(typeof build.verifyEvidence, 'function');
    assert(!retained.includes(build), 'subject retained once');
    build.verifyEvidence(); retained.push(build);
  };
  const subjectsStarted = performance.now();
  const result = await action(owner, retain);
  const subjectMilliseconds = performance.now() - subjectsStarted;
  assert(retained.length > 0, 'original complete positive subject required');
  const products = retained.map(build => { build.verifyEvidence(); return captureVerificationProducts(build.work, family); });
  retirementAttempted = true;
  const retirement = owner.close();
  assert.equal(retirement.status, 'retired'); assert.equal(retirement.compiler, owner.identity);
  for (const [index, build] of retained.entries()) {
    assert.deepEqual(captureVerificationProducts(build.work, family), products[index],
      'all generated source, proof, package, native and Wasm products survive tool retirement');
    build.verifyEvidence();
  }
  assert.throws(() => requireCompilerOwner(owner, family), /compiler owner closed/);
  assert.throws(() => owner.close(), /compiler owner closed/);
  t.diagnostic(JSON.stringify({scope: 'fresh-serial-tools-only', compiler: owner.evidence,
    substitutions, retirement, subjectMilliseconds}));
  return {result, compiler: owner.identity, substitutions, retirement};
}
