import assert from 'node:assert/strict';
import test from 'node:test';
import {withCompilerOwner} from '../../tests/browser-view/serial-compiler-owner.mjs';
import {verifyWire, replayBrowser, verifyModelMutation, verifyInventory, prerequisite} from '../../tests/browser-presentation/checks.mjs';
import {verifyJourneys, verifyMutants, verifyMaximum} from '../../tests/browser-presentation/browser.mjs';

test('DK-23 actual generated closed presentation and private browser execution', {timeout: 3500000}, async t => {
  await withCompilerOwner(t, 'presentation', async (compiler, retain) => {
    const build = await verifyWire(t, compiler); retain(build);
    await prerequisite(t, 'actual generated source-owned presentation and exact observed std/no_std native transcripts', async child => {
      replayBrowser(build, await verifyJourneys(child, build));
  });
  await prerequisite(t, 'real Chromium renders every exact generated 64 MiB combined shape observed independently in native execution', async child => {
    const observed = await verifyMaximum(child, build);
    assert.deepEqual(observed.map(row => row.id), build.maximumFrames.map(row => row.id));
    for (let index = 0; index < observed.length; index++) {
      assert.equal(observed[index].request_sha256, build.maximumFrames[index].request);
      assert.equal(observed[index].response_sha256, build.maximumFrames[index].response);
      assert.equal(observed[index].frame_length, build.maximumFrames[index].length);
    }
    assert.ok(build.progressMaximumBrowser?.modelChecked);
    replayBrowser(build, build.progressMaximumBrowser, 'maximum-progress-browser');
  });
  await prerequisite(t, 'actual unsafe DOM, stale/draft and closed-lifecycle guard mutations fail', child => verifyMutants(child, build));
  await prerequisite(t, 'closed diagnostic registry', verifyInventory);
  for (const kind of ['binding', 'trailing', 'secretbound', 'secretroute', 'progress']) await prerequisite(t, 'actual LexLean ' + kind + ' mutant fails native/no_std/Wasm', () => verifyModelMutation(kind, compiler));
  });
});
