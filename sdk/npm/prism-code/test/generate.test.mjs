// `prism-code generate`: bindings and a typed client from the WIT world (issue #289).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load, compileGuest, parseArchive, resolveArchive, PrismCodeError } from '../src/index.mjs';
import { generate, RECORD } from '../src/generate/index.mjs';
import { codeModel } from '../src/generate/model.mjs';
import { readWorld } from '../src/generate/wit.mjs';
import { write } from '../src/generate/js.mjs';
import { mutatedGuest, withGuest } from '../../verify/test/helpers.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const bin = here('../bin/prism-code.mjs');
const fixture = here('../fixtures/Calculator.holo');
const golden = here('./fixtures/generate/calculator-js');
const holo = new Uint8Array(readFileSync(fixture));
const lock = JSON.parse(readFileSync(here('../../spec/test/fixtures/documents/sdk-lock-v3/calculator.json'), 'utf8'));
const lf = (text) => text.replace(/\r\n/g, '\n');
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-generate-'));

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', ...options });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function snapshot(directory) {
  return Object.fromEntries(readdirSync(directory).sort().map((name) => {
    const path = join(directory, name);
    return [name, { bytes: readFileSync(path, 'latin1'), mtime: statSync(path).mtimeMs }];
  }));
}

test('the Calculator bindings equal the golden files', async () => {
  const out = scratch();
  const result = await generate({ holo, out });
  assert.equal(result.status, 'written');
  assert.deepEqual(result.files, ['world.js', 'world.d.ts', 'calculator.js', 'calculator.d.ts']);
  if (process.env.PRISM_CODE_UPDATE_GOLDEN) {
    mkdirSync(golden, { recursive: true });
    for (const name of result.files) writeFileSync(join(golden, name), readFileSync(join(out, name)));
  }
  assert.deepEqual(readdirSync(golden).sort(), [...result.files].sort(), 'golden directory lists exactly the generated files');
  for (const name of result.files) {
    assert.equal(readFileSync(join(out, name), 'utf8'), lf(readFileSync(join(golden, name), 'utf8')), `${name} differs from test/fixtures/generate/calculator-js; rerun with PRISM_CODE_UPDATE_GOLDEN=1 and review the diff`);
  }
});

test('a second run writes nothing: byte-identical files, untouched, and the run says unchanged', async () => {
  const out = scratch();
  await generate({ holo, out });
  const before = snapshot(out);
  const again = await generate({ holo, out });
  assert.equal(again.status, 'unchanged');
  assert.deepEqual(again.files, []);
  assert.deepEqual(snapshot(out), before, 'no file was rewritten');
  // A fresh directory gets the same bytes: the output is a function of the inputs alone.
  const other = scratch();
  await generate({ holo, out: other });
  for (const [name, { bytes }] of Object.entries(before)) assert.equal(readFileSync(join(other, name), 'latin1'), bytes, name);
});

test('the record pins the lock\'s inputs.world and inputs.model, the generator and every file', async () => {
  const out = scratch();
  const { record } = await generate({ holo, out });
  const onDisk = JSON.parse(readFileSync(join(out, RECORD), 'utf8'));
  assert.deepEqual(onDisk, record);
  assert.equal(record.schema, 'prismpm/generate-record/1');
  assert.equal(record.language, 'js');
  assert.deepEqual(record.world, lock.inputs.world);
  assert.deepEqual(record.model, lock.inputs.model);
  assert.equal(record.generator.name, 'prism-code');
  assert.match(record.generator.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(record.files).sort(), ['calculator.d.ts', 'calculator.js', 'world.d.ts', 'world.js']);
});

test('an edited or deleted file is regenerated, and nothing else is touched', async () => {
  const out = scratch();
  await generate({ holo, out });
  const original = readFileSync(join(out, 'calculator.js'), 'utf8');
  writeFileSync(join(out, 'calculator.js'), `${original}// edited\n`);
  writeFileSync(join(out, 'notes.md'), 'mine\n');
  const fixed = await generate({ holo, out });
  assert.equal(fixed.status, 'written');
  assert.deepEqual(fixed.files, ['calculator.js']);
  assert.equal(readFileSync(join(out, 'calculator.js'), 'utf8'), original);
  assert.equal(readFileSync(join(out, 'notes.md'), 'utf8'), 'mine\n');
});

test('an output path is required, and a file generate did not write is never overwritten', async () => {
  for (const out of [undefined, '']) {
    await assert.rejects(generate({ holo, out }), (e) => e instanceof PrismCodeError && e.code === 'generate.output');
  }
  const cwd = scratch();
  const usage = run(['generate', fixture], { cwd });
  assert.equal(usage.code, 64);
  assert.match(usage.err, /generate needs --out <dir>/);
  assert.deepEqual(readdirSync(cwd), [], 'nothing was written to the working directory');

  const out = scratch();
  writeFileSync(join(out, 'world.js'), 'mine\n');
  await assert.rejects(generate({ holo, out }), (e) => e.code === 'generate.output' && /was not written by prism-code generate/.test(e.message));
  assert.equal(readFileSync(join(out, 'world.js'), 'utf8'), 'mine\n');
  assert.equal(existsSync(join(out, RECORD)), false);
});

test('the CLI writes, then reports up to date; --lang names the writers that exist', () => {
  const out = join(scratch(), 'generated');
  const first = run(['generate', fixture, '--out', out]);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /^wrote 4 of 4 files to .*generated \(js, hologram:guest\/core-wasm@1, model blake3:e76544838a98\)$/m);
  const second = run(['generate', fixture, '--out', out, '--lang', 'js']);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /is up to date/);
  const rust = run(['generate', fixture, '--out', out, '--lang', 'rust']);
  assert.equal(rust.code, 64);
  assert.match(rust.err, /--lang takes js; rust and python are not written yet \(#289\)/);
});

test('the generated client answers every acceptance vector as the guest does, through both transports', async () => {
  const out = scratch();
  await generate({ holo, out });
  const { Calculator, CalculatorError, OPERATIONS, MODEL } = await import(pathToFileURL(join(out, 'calculator.js')).href);
  const world = await import(pathToFileURL(join(out, 'world.js')).href);
  assert.deepEqual(OPERATIONS, ['add', 'subtract', 'multiply', 'divide']);
  assert.deepEqual({ blake3: MODEL.blake3, sha256: MODEL.sha256 }, lock.inputs.model);
  assert.deepEqual({ ...world.WORLD }, lock.inputs.world);

  const app = await load(holo);
  const module = await compileGuest(resolveArchive(parseArchive(holo)).guest.content);
  const transports = { 'app.dispatch': app.dispatch, 'world.dispatch': (request) => world.dispatch(module, request) };
  const decoder = new TextDecoder();
  for (const [label, dispatch] of Object.entries(transports)) {
    const calculator = new Calculator(dispatch);
    assert.equal(await calculator.add(20, 22), 42n, label);
    assert.equal(await calculator.divide(-7n, 3n), -2n, label);
    let replayed = 0;
    for (const vector of app.vectors) {
      const [, operation, left, right] = decoder.decode(vector.request).split('\t');
      const [, status, value] = decoder.decode(vector.response).split('\t');
      // Wire-level refusals (a malformed request, another version) are vectors the typed client cannot send.
      if (status === 'error' && !['overflow', 'division-by-zero'].includes(value)) continue;
      replayed++;
      const answer = calculator.calculate(operation, BigInt(left), BigInt(right));
      if (status === 'ok') assert.equal(await answer, BigInt(value), `${label}: ${operation} ${left} ${right}`);
      else await assert.rejects(answer, (e) => e instanceof CalculatorError && e.code === value, `${label}: ${operation} ${left} ${right}`);
    }
    assert.equal(replayed, 15, `${label}: every typed vector replayed`);
    await assert.rejects(calculator.divide(1, 0), { name: 'CalculatorError', code: 'division-by-zero', message: 'Division by zero.' });
    await assert.rejects(calculator.calculate('modulo', 1, 2), TypeError);
    await assert.rejects(calculator.add(2 ** 53, 1), RangeError, 'an unsafe number is refused before it is sent');
    await assert.rejects(calculator.add(2n ** 63n, 0n), RangeError);
  }
  assert.throws(() => world.instantiate(new WebAssembly.Module(mutatedGuest('extra export'))), TypeError);
});

test('a guest that does not conform to its world is refused', async () => {
  await assert.rejects(generate({ holo: withGuest(mutatedGuest('renamed export')), out: scratch() }), (e) => e.code === 'generate.world');
});

test('the vendored WIT file is @prism-code/spec\'s, and it reads as the world the registry lists', async () => {
  const vendored = lf(readFileSync(here('../src/generate/core-wasm.wit'), 'utf8'));
  assert.equal(vendored, lf(readFileSync(here('../../spec/worlds/core-wasm.wit'), 'utf8')));
  const world = readWorld(vendored);
  assert.equal(world.package, 'hologram:guest@1.0.0');
  assert.equal(world.name, 'core-wasm');
  assert.deepEqual(world.items.map((i) => [i.direction, i.name, i.params.map((p) => p.core), i.result.core]), [
    ['export', 'holo_alloc', ['i32'], 'i32'],
    ['export', 'holo_run', ['i32', 'i32'], 'i64'],
  ]);
  for (const bad of ['package a:b;\nworld w {\n  export f: func(x: string);\n}\n', 'package a:b;\nworld w {\n  use x;\n}\n', 'package a:b;\n']) {
    assert.throws(() => readWorld(bad), (e) => e.code === 'generate.wit');
  }
});

test('a model without typed operations gets a client over bytes', async () => {
  const model = await codeModel(holo);
  model.application = { ...model.application, name: 'Echo', type: 'Echo', file: 'echo', description: null, schema: 'prismpm/model-document/5', interface: { kind: 'bytes' } };
  const files = Object.fromEntries(write(model));
  assert.deepEqual(Object.keys(files), ['world.js', 'world.d.ts', 'echo.js', 'echo.d.ts']);
  assert.match(files['echo.d.ts'], /invoke\(request: Uint8Array\): Promise<Uint8Array>;/);
  const out = scratch();
  writeFileSync(join(out, 'echo.js'), files['echo.js']);
  const { Echo } = await import(pathToFileURL(join(out, 'echo.js')).href);
  assert.deepEqual(await new Echo((r) => r.slice().reverse()).invoke(Uint8Array.of(1, 2, 3)), Uint8Array.of(3, 2, 1));
});
