import test from 'node:test';
import {withCompilerOwner} from '../../tests/browser-view/serial-compiler-owner.mjs';
import {verifyWire, verifyModelMutation, verifyInventory, prerequisite} from '../../tests/browser-effects/checks.mjs';
import {verifyJourneys, verifyHostMutants} from '../../tests/browser-effects/browser.mjs';

test('DK-20 generated bounded byte effects and real private browser execution', {timeout: 3500000}, async t => {
  await withCompilerOwner(t, 'effects', async (compiler, retain) => {
    const build = await verifyWire(t, compiler); retain(build);
    await prerequisite(t, 'actual browser effects and exact std/no_std native transcripts', child => verifyJourneys(child, build));
    await prerequisite(t, 'planted private host boundary defects fail real browser execution', child => verifyHostMutants(child, build));
    await prerequisite(t, 'closed host/model diagnostic inventory', verifyInventory);
    for (const kind of ['binding', 'trailing', 'unknown']) {
      await prerequisite(t, 'actual LexLean ' + kind + ' mutation fails generated native and Wasm assertions', () => verifyModelMutation(kind, compiler));
    }
  });
});
