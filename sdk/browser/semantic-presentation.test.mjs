import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyWire, verifyMutation, replayBrowser, closure, completeEvidence, captureBrowserEvidence} from '../../tests/browser-semantic-presentation/checks.mjs';
import {engines, journey, verifyMutants, verifyMaximum} from '../../tests/browser-semantic-presentation/browser.mjs';
import {prerequisite} from '../../tests/browser-view/prerequisites.mjs';

test('DK-38 private generated semantic presentation and actual DOM oracle', {timeout: 3500000}, async t => {
  const before = closure(), build = verifyWire(t);
  for (const engine of engines) {
    await prerequisite(t, engine + ' generated source, labels and design catalogue drive rendered DOM oracle journeys', async child => {
      const result = await journey(child, build, {}, engine); replayBrowser(build, result);
      assert.equal(result.engine, engine); assert.equal(result.cases.length, 7);
    });
  }
  await prerequisite(t, 'exact 64 MiB combined semantic envelopes execute and render in actual Chromium', child => verifyMaximum(child, build));
  for (const engine of engines) {
    await prerequisite(t, engine + ' semantic adapter defects fail generated browser journeys', async child => {
      const mutants = await verifyMutants(child, build, engine);
      build.browserMutationEvidence.push(captureBrowserEvidence({engine, mutants}));
    });
  }
  for (const kind of ['purpose', 'main', 'trailing', 'design', 'catalogue']) {
    await prerequisite(t, 'actual source ' + kind + ' mutant fails std/no_std/Wasm', () => verifyMutation(kind, build));
  }
  assert.deepEqual(closure(), before, 'all owning implementation and oracle inputs remained frozen');
  t.diagnostic('Retained complete private semantic component evidence ' + completeEvidence(build));
});
