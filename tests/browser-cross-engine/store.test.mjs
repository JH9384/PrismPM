import assert from 'node:assert/strict';
import test from 'node:test';
import {browserPins} from '../../sdk/browser/browser-test-server.mjs';
import {verifyStore} from '../../sdk/browser/store-browser.mjs';

for (const engine of Object.keys(browserPins)) {
  test(engine + ' executes the unchanged complete Store journeys', {timeout: 180000}, async t => {
    const names = [];
    await verifyStore({async test(name, options, body) {
      names.push(name); await t.test(name, options, body);
    }}, {engine});
    assert.equal(names.length, 4);
    assert.equal(new Set(names).size, names.length);
  });
}
