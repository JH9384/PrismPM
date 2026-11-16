// Run as a child of no-node.test.mjs: load the browser entry points on a host with no Node surface, and print what they did.
// Every built-in import is refused, and `process` and `Buffer` are gone, so this also covers `process.getBuiltinModule`.
import { readFileSync } from 'node:fs';
import { isBuiltin, registerHooks } from 'node:module';

const holo = readFileSync(new URL('../../fixtures/Calculator.holo', import.meta.url));
const host = process;
const write = process.stdout.write.bind(process.stdout);

registerHooks({
  resolve(specifier, context, next) {
    if (isBuiltin(specifier)) throw new Error(`refused ${specifier}`);
    return next(specifier, context);
  },
});
delete globalThis.process;
delete globalThis.Buffer;

const fetched = [];
const response = (bytes) => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
globalThis.fetch = async (url) => {
  // A closure is a directory of files, read here; its glue is then imported from the same URL.
  if (url.protocol === 'file:') return response(readFileSync(url));
  fetched.push(String(url));
  return response(holo);
};
const warnings = [];
console.warn = (message) => warnings.push(message);

const encode = (text) => new TextEncoder().encode(text);
const decode = (bytes) => new TextDecoder().decode(bytes);
const run = async (app) => ({
  verified: app.identities.verified,
  response: decode(await app.dispatch(encode('1\tadd\t20\t22'))),
  acceptance: await app.acceptance(),
  level: (await app.experimental_verify({ minimum: 'P0' })).level,
});

const report = { host: { process: typeof process, buffer: typeof Buffer } };
report.refused = await import('node:fs').then(() => false, (error) => error.message);

const top = await import('../../src/index.mjs');
const browser = await import('../../src/browser.mjs');
const canonical = await import('../../src/canonical/index.js');

report.topBytes = await run(await top.load(new Uint8Array(holo)));
report.topUrl = await run(await top.load('https://prism.test/Calculator.holo'));
report.browserUrl = await run(await browser.load('https://prism.test/Calculator.holo'));
report.fetched = fetched;

const { model } = await top.load(new Uint8Array(holo));
const closure = await browser.load(new URL('../fixtures/calculator-closure/', import.meta.url).href, { model });
report.closure = { kind: closure.kind, verified: closure.identities.verified, response: decode(await closure.dispatch(encode('1\tadd\t20\t22'))), acceptance: await closure.acceptance() };

report.hash = canonical.codeHash('const x = 1;  \r\n\r\n');
report.describe = canonical.describe('﻿a\r\nb');
report.topHash = top.codeHash('const x = 1;\n');
report.topDiffers = top.differs('a', 'a\n');
report.warnings = warnings;
try {
  canonical.codeHash('x', { algorithm: 'sha512' });
  report.sha512 = 'returned';
} catch (error) {
  report.sha512 = error.code;
}

write(JSON.stringify(report), () => {
  host.exitCode = 0;
});
