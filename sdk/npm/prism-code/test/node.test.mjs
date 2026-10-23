import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromFile, serve } from '../src/node.mjs';

const fixture = new URL('../fixtures/Calculator.holo', import.meta.url);

test('serve() publishes the HOLOVIEW files and answers application.invoke intents', async () => {
  const app = await fromFile(fixture);
  const { url, close } = await serve(app, { port: 0 });
  try {
    const index = await fetch(url);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(await index.text(), /<html/);
    const css = await fetch(new URL('app.css', url));
    assert.match(css.headers.get('content-type'), /text\/css/);
    const missing = await fetch(new URL('nope.txt', url));
    assert.equal(missing.status, 404);

    const intent = await fetch(new URL('_hologram/intent', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, name: 'application.invoke', payload: '1\tmultiply\t-6\t7' }),
    });
    assert.equal(intent.status, 200);
    assert.deepEqual(await intent.json(), { version: 1, outputs: ['1\tok\t-42'] });

    const bad = await fetch(new URL('_hologram/intent', url), { method: 'POST', body: '{"version":2}' });
    assert.equal(bad.status, 400);
  } finally {
    await close();
  }
});

test('fromFile() refuses a missing path by name', async () => {
  await assert.rejects(fromFile('does-not-exist.holo'), (error) => error.code === 'load.path');
});
