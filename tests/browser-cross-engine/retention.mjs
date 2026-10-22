// Private acceptance orchestration; requires real captured generated artifacts.
import assert from 'node:assert/strict';
import {browserPins} from '../../sdk/browser/browser-test-server.mjs';
import {verifySessionStorage} from '../browser-session-journal/storage-browser.mjs';
import {verifyStorageTranscript, verifyStorageHostMutations} from '../browser-session-journal/storage-verification.mjs';

export async function verifyRetentionEngines(t, build) {
  const results = [];
  for (const engine of Object.keys(browserPins)) {
    let failure;
    await t.test(engine + ' executes complete generated storage and native replay', {timeout: 180000}, async suite => {
      try {
        build.unchanged(); const cases = [];
        const calls = await verifySessionStorage({async test(name, body) {
          let problem;
          await suite.test(name, async () => {try {await body();} catch (error) {problem = error; throw error;}});
          if (problem) throw problem; cases.push(name);
        }}, build.wasm.retention, {engine, inputs: build.inputs});
        assert.equal(cases.length, 11);
        const transcript = verifyStorageTranscript(build, calls, engine);
        const mutations = await verifyStorageHostMutations(suite, build.wasm.retention, {engine, inputs: build.inputs});
        assert.equal(mutations.length, 6); build.unchanged();
        results.push({engine, version: browserPins[engine].version, cases, transcript, mutations});
      } catch (error) {failure = error; throw error;}
    });
    if (failure) throw failure;
  }
  assert.deepEqual(results.map(row => row.engine), ['chromium', 'firefox', 'webkit']);
  return results;
}
