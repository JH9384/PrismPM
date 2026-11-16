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
import { write as writeRust } from '../src/generate/rust.mjs';
import { write as writePython } from '../src/generate/python.mjs';
import { mutatedGuest, withGuest } from '../../verify/test/helpers.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const bin = here('../bin/prism-code.mjs');
const fixture = here('../fixtures/Calculator.holo');
const golden = here('./fixtures/generate/calculator-js');
const goldenRust = here('./fixtures/generate/calculator-rust');
const goldenPython = here('./fixtures/generate/calculator-python');
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
  const rust = run(['generate', fixture, '--out', join(out, 'rust'), '--lang', 'rust']);
  assert.equal(rust.code, 0, rust.err);
  assert.match(rust.out, /^wrote 4 of 4 files to .*rust \(rust, hologram:guest\/core-wasm@1, model blake3:e76544838a98\)$/m);
  const python = run(['generate', fixture, '--out', join(out, 'python'), '--lang', 'python']);
  assert.equal(python.code, 0, python.err);
  assert.match(python.out, /^wrote 4 of 4 files to .*python \(python, hologram:guest\/core-wasm@1, model blake3:e76544838a98\)$/m);
  const go = run(['generate', fixture, '--out', out, '--lang', 'go']);
  assert.equal(go.code, 64);
  assert.match(go.err, /--lang takes js, rust, python$/m);
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

// The Rust writer (#289, part 2).

test('the Calculator Rust bindings equal the golden files, and the record names rust', async () => {
  const out = scratch();
  const result = await generate({ holo, out, language: 'rust' });
  assert.deepEqual(result.files, ['Cargo.toml', 'lib.rs', 'world.rs', 'calculator.rs']);
  if (process.env.PRISM_CODE_UPDATE_GOLDEN) {
    mkdirSync(goldenRust, { recursive: true });
    for (const name of result.files) writeFileSync(join(goldenRust, name), readFileSync(join(out, name)));
  }
  assert.deepEqual(readdirSync(goldenRust).sort(), [...result.files].sort(), 'golden directory lists exactly the generated files');
  for (const name of result.files) {
    assert.equal(readFileSync(join(out, name), 'utf8'), lf(readFileSync(join(goldenRust, name), 'utf8')), `${name} differs from test/fixtures/generate/calculator-rust; rerun with PRISM_CODE_UPDATE_GOLDEN=1 and review the diff`);
  }
  assert.equal(result.record.language, 'rust');
  assert.deepEqual(result.record.world, lock.inputs.world);
  assert.deepEqual(result.record.model, lock.inputs.model);
  assert.equal((await generate({ holo, out, language: 'rust' })).status, 'unchanged');
  // Switching language in one directory removes the files only the other language wrote.
  await generate({ holo, out, language: 'js' });
  assert.deepEqual(readdirSync(out).sort(), ['calculator.d.ts', 'calculator.js', RECORD, 'world.d.ts', 'world.js'].sort());
});

test('the Rust writer refuses names it cannot bind and models it cannot read', async () => {
  const model = await codeModel(holo);
  const named = (file) => ({ ...model, application: { ...model.application, file } });
  assert.throws(() => writeRust(named('world')), (e) => e.code === 'generate.model');
  assert.throws(() => writeRust(named('9 lives')), (e) => e.code === 'generate.model');
  const ops = model.application.interface;
  const clash = { ...model, application: { ...model.application, interface: { ...ops, operations: [...ops.operations, { name: 'new', label: 'New' }] } } };
  assert.throws(() => writeRust(clash), (e) => e.code === 'generate.model' && /collides/.test(e.message));
  const imports = { ...model, world: { ...model.world, imports: [{ name: 'log' }] } };
  assert.throws(() => writeRust(imports), (e) => e.code === 'generate.world');
  const files = Object.fromEntries(writeRust({ ...model, application: { ...model.application, name: 'Echo', type: 'Echo', file: 'echo', description: null, interface: { kind: 'bytes' } } }));
  assert.deepEqual(Object.keys(files), ['Cargo.toml', 'lib.rs', 'world.rs', 'echo.rs']);
  assert.match(files['echo.rs'], /pub fn invoke\(&mut self, request: &\[u8\]\) -> Result<Vec<u8>, E>/);
});

const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
const noCargo = cargo.status === 0 ? false : 'cargo is not on PATH';

/** A Rust string literal for any request or response text. */
const rustText = (text) => JSON.stringify(text);

test('the generated crate builds, is formatted and lint-clean, and answers every acceptance vector as the guest does', { skip: noCargo, timeout: 600_000 }, async () => {
  const crate = scratch();
  await generate({ holo, out: crate, language: 'rust' });
  // The real guest answers each typed vector, sent as the client writes it; the Rust test replays those answers.
  const app = await load(holo);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const cases = [];
  for (const vector of app.vectors) {
    const [version, operation, left, right] = decoder.decode(vector.request).split('\t');
    const [, status, value] = decoder.decode(vector.response).split('\t');
    if (status === 'error' && !['overflow', 'division-by-zero'].includes(value)) continue;
    const request = `${version}\t${operation}\t${BigInt(left)}\t${BigInt(right)}`;
    const response = decoder.decode(await app.dispatch(encoder.encode(request)));
    cases.push({ request, response, operation, left: BigInt(left), right: BigInt(right), status, value });
  }
  assert.equal(cases.length, 15, 'every typed vector is replayed');
  const variant = (name) => name[0].toUpperCase() + name.slice(1);
  const code = (name) => name.split('-').map(variant).join('');
  mkdirSync(join(crate, 'tests'));
  writeFileSync(join(crate, 'tests', 'vectors.rs'), `use std::collections::HashMap;

use calculator_client::world::{dispatch, DispatchError, Guest, EXPORTS, WORLD};
use calculator_client::{Calculator, CalculatorError, CalculatorErrorCode, Operation, MODEL};

fn answers() -> HashMap<&'static str, &'static str> {
    HashMap::from([
${cases.map((c) => `        (${rustText(c.request)}, ${rustText(c.response)}),`).join('\n')}
    ])
}

fn guest(request: &[u8]) -> Result<Vec<u8>, String> {
    let request = std::str::from_utf8(request).unwrap();
    let answer = answers().get(request).copied();
    answer.map(|a| a.as_bytes().to_vec()).ok_or(format!("no vector sends {request:?}"))
}

#[test]
fn every_vector() {
    let mut calculator = Calculator::new(guest);
${cases.map((c) => {
    const call = `calculator.calculate(Operation::${variant(c.operation)}, ${c.left}, ${c.right})`;
    return c.status === 'ok'
      ? `    assert_eq!(${call}.unwrap(), ${BigInt(c.value)});`
      : `    assert!(matches!(${call}, Err(CalculatorError::Refused(CalculatorErrorCode::${code(c.value)}))));`;
  }).join('\n')}
    assert_eq!(calculator.add(20, 22).unwrap(), 42);
}

#[test]
fn identities() {
    assert_eq!(WORLD.name, ${rustText(lock.inputs.world.contract)});
    assert_eq!(WORLD.blake3, ${rustText(lock.inputs.world.blake3)});
    assert_eq!(WORLD.sha256, ${rustText(lock.inputs.world.sha256)});
    assert_eq!(MODEL.blake3, ${rustText(lock.inputs.model.blake3)});
    assert_eq!(MODEL.sha256, ${rustText(lock.inputs.model.sha256)});
    assert_eq!(EXPORTS, ["holo_alloc", "holo_run", "memory"]);
    assert_eq!(Operation::ALL.map(Operation::name), ["add", "subtract", "multiply", "divide"]);
}

#[test]
fn refusals_and_unreadable_answers() {
    let refused = |text: &'static str| move |_: &[u8]| Ok::<_, String>(text.as_bytes().to_vec());
    let code = |text| match Calculator::new(refused(text)).add(1, 2) {
        Err(CalculatorError::Refused(code)) => code,
        other => panic!("{other:?}"),
    };
    assert_eq!(code("1\\terror\\tdivision-by-zero").message(), "Division by zero.");
    assert_eq!(code("2\\tok\\t3"), CalculatorErrorCode::UnsupportedVersion);
    assert_eq!(code("1\\terror\\tnew-code"), CalculatorErrorCode::Other("new-code".into()));
    for text in ["1\\tok\\tthree", "1\\tok\\t3\\textra", "1\\tmaybe\\t3", "1"] {
        let answer = Calculator::new(refused(text)).add(1, 2);
        assert!(matches!(answer, Err(CalculatorError::Response(_))), "{text:?}: {answer:?}");
    }
    let unreachable = Calculator::new(|_: &[u8]| Err::<Vec<u8>, _>("down")).add(1, 2);
    assert_eq!(unreachable.unwrap_err().to_string(), "the request did not reach Calculator: down");
}

/// A guest over plain memory that answers each request with its bytes reversed.
struct Reverse {
    memory: Vec<u8>,
}

impl Guest for Reverse {
    type Error = String;

    fn holo_alloc(&mut self, length: u32) -> Result<u32, String> {
        let offset = self.memory.len() as u32;
        self.memory.resize(self.memory.len() + length as usize, 0);
        Ok(offset)
    }

    fn holo_run(&mut self, offset: u32, length: u32) -> Result<u64, String> {
        let request = self.memory[offset as usize..][..length as usize].to_vec();
        let at = self.holo_alloc(length)?;
        let reversed: Vec<u8> = request.into_iter().rev().collect();
        self.write_memory(at, &reversed)?;
        Ok(u64::from(at) << 32 | u64::from(length))
    }

    fn write_memory(&mut self, offset: u32, bytes: &[u8]) -> Result<(), String> {
        self.memory[offset as usize..][..bytes.len()].copy_from_slice(bytes);
        Ok(())
    }

    fn read_memory(&mut self, offset: u32, length: u32) -> Result<Vec<u8>, String> {
        let range = offset as usize..offset as usize + length as usize;
        self.memory.get(range).map(<[u8]>::to_vec).ok_or("outside memory".to_string())
    }
}

#[test]
fn the_world_protocol() {
    let mut guest = Reverse { memory: vec![0; 8] };
    assert_eq!(dispatch(&mut guest, b"abc").unwrap(), b"cba");
    let mut calculator = Calculator::new(|request: &[u8]| {
        let request = std::str::from_utf8(request).unwrap();
        let answer = answers()[request].as_bytes().to_vec();
        let mut guest = Reverse { memory: answer.into_iter().rev().collect() };
        let packed = guest.holo_run(0, guest.memory.len() as u32).unwrap();
        guest.read_memory((packed >> 32) as u32, packed as u32)
    });
    assert_eq!(calculator.divide(-7, 3).unwrap(), -2);
    let failed = DispatchError::<String>::Guest("trap".into());
    assert_eq!(failed.to_string(), "the guest failed: trap");
}
`);
  const env = { ...process.env, CARGO_TARGET_DIR: join(crate, 'target'), CARGO_TERM_COLOR: 'never' };
  // rustfmt on the generated crate alone (it follows lib.rs's modules); the test file above is not generated.
  for (const [tool, ...args] of [['rustfmt', '--check', '--edition', '2021', 'lib.rs'], ['cargo', 'clippy', '--offline', '--all-targets', '--', '-D', 'warnings'], ['cargo', 'test', '--offline', '--quiet']]) {
    const result = spawnSync(tool, args, { cwd: crate, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `${tool} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  // A model without typed operations: the client over bytes builds and is formatted too.
  const model = await codeModel(holo);
  const echo = join(crate, 'echo');
  mkdirSync(echo);
  for (const [name, text] of writeRust({ ...model, application: { ...model.application, name: 'Echo', type: 'Echo', file: 'echo', description: null, interface: { kind: 'bytes' } } })) {
    writeFileSync(join(echo, name), text);
  }
  for (const [tool, ...args] of [['rustfmt', '--check', '--edition', '2021', 'lib.rs'], ['cargo', 'clippy', '--offline', '--', '-D', 'warnings']]) {
    const result = spawnSync(tool, args, { cwd: echo, env, encoding: 'utf8' });
    assert.equal(result.status, 0, `echo: ${tool} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
});

// The Python writer (#289, part 3).

test('the Calculator Python bindings equal the golden files, and the record names python', async () => {
  const out = scratch();
  const result = await generate({ holo, out, language: 'python' });
  assert.deepEqual(result.files, ['__init__.py', 'identity.py', 'world.py', 'calculator.py']);
  if (process.env.PRISM_CODE_UPDATE_GOLDEN) {
    mkdirSync(goldenPython, { recursive: true });
    for (const name of result.files) writeFileSync(join(goldenPython, name), readFileSync(join(out, name)));
  }
  assert.deepEqual(readdirSync(goldenPython).sort(), [...result.files].sort(), 'golden directory lists exactly the generated files');
  for (const name of result.files) {
    assert.equal(readFileSync(join(out, name), 'utf8'), lf(readFileSync(join(goldenPython, name), 'utf8')), `${name} differs from test/fixtures/generate/calculator-python; rerun with PRISM_CODE_UPDATE_GOLDEN=1 and review the diff`);
  }
  assert.equal(result.record.language, 'python');
  assert.deepEqual(result.record.world, lock.inputs.world);
  assert.deepEqual(result.record.model, lock.inputs.model);
  assert.equal((await generate({ holo, out, language: 'python' })).status, 'unchanged');
});

test('the Python writer refuses names it cannot bind and models it cannot read', async () => {
  const model = await codeModel(holo);
  const named = (file) => ({ ...model, application: { ...model.application, file } });
  for (const file of ['world', 'identity', '9 lives']) assert.throws(() => writePython(named(file)), (e) => e.code === 'generate.model', file);
  const ops = model.application.interface;
  const clash = { ...model, application: { ...model.application, interface: { ...ops, operations: [...ops.operations, { name: 'calculate', label: 'Calculate' }] } } };
  assert.throws(() => writePython(clash), (e) => e.code === 'generate.model' && /collides/.test(e.message));
  assert.throws(() => writePython({ ...model, world: { ...model.world, imports: [{ name: 'log' }] } }), (e) => e.code === 'generate.world');
  // A keyword is bound with a trailing underscore.
  const keyword = Object.fromEntries(writePython({ ...model, application: { ...model.application, interface: { ...ops, operations: [{ name: 'pass', label: 'Pass' }] } } }));
  assert.match(keyword['calculator.py'], /def pass_\(self, left: int, right: int\) -> int:/);
});

const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
const noPython = python.status === 0 ? false : 'python3 is not on PATH';

test('the generated package imports nothing outside the standard library and answers every acceptance vector as the guest does', { skip: noPython, timeout: 120_000 }, async () => {
  const root = scratch();
  await generate({ holo, out: join(root, 'calculator_client'), language: 'python' });
  const model = await codeModel(holo);
  const echo = join(root, 'echo_client');
  mkdirSync(echo);
  for (const [name, text] of writePython({ ...model, application: { ...model.application, name: 'Echo', type: 'Echo', file: 'echo', description: null, interface: { kind: 'bytes' } } })) {
    writeFileSync(join(echo, name), text);
  }
  // The real guest answers each typed vector, sent as the client writes it; the Python check replays those answers.
  const app = await load(holo);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const cases = [];
  for (const vector of app.vectors) {
    const [version, operation, left, right] = decoder.decode(vector.request).split('\t');
    const [, status, value] = decoder.decode(vector.response).split('\t');
    if (status === 'error' && !['overflow', 'division-by-zero'].includes(value)) continue;
    const request = `${version}\t${operation}\t${BigInt(left)}\t${BigInt(right)}`;
    cases.push({ request, response: decoder.decode(await app.dispatch(encoder.encode(request))), operation, left: String(BigInt(left)), right: String(BigInt(right)), status, value });
  }
  assert.equal(cases.length, 15, 'every typed vector is replayed');
  writeFileSync(join(root, 'cases.json'), JSON.stringify(cases));
  writeFileSync(join(root, 'identities.json'), JSON.stringify(lock.inputs));
  const result = spawnSync('python3', ['-I', '-B', here('./fixtures/generate/check-python.py'), root], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout.trim(), 'ok 15');
});
