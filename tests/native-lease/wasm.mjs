// Execute compiler-generated Core-Wasm; no JavaScript lease implementation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {command} from '../../scripts/product-sdk-check.mjs';
import {consumerEnvironment} from './package.mjs';

assert.equal(process.version, 'v22.23.2');
const [mode, path, ...extra] = process.argv.slice(2);
if (mode === '--execute') {
  assert(extra.length === 0 || (extra.length === 1 && extra[0] === '--wrong-expected'));
  const bytes = readFileSync(path);
  assert(WebAssembly.validate(bytes));
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  for (const [name, kind] of [['memory', 'memory'], ['holo_alloc', 'function'], ['holo_run', 'function']]) {
    assert(WebAssembly.Module.exports(module).some(row => row.name === name && row.kind === kind));
  }
  function execute(input, expected, name) {
    // The compiler's bump allocator belongs to this invocation alone.
    const {memory, holo_alloc: allocate, holo_run: run} = new WebAssembly.Instance(module, {}).exports;
    const pointer = allocate(input.length);
    assert(Number.isInteger(pointer) && pointer >= 0);
    new Uint8Array(memory.buffer, pointer, input.length).set(input);
    const packed = BigInt.asUintN(64, run(pointer, input.length));
    const offset = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
    assert.equal(length, 1, name);
    assert.deepEqual([...new Uint8Array(memory.buffer, offset, length)], [expected], name);
  }
  for (let index = 0; index < 93; index++) {
    execute([index], extra.length && index === 0 ? 0 : 1, `native-wasm-case-${index}`);
  }
  for (const input of [[], [93], [0, 0]]) execute(input, 255, 'invalid-selector');
  process.stdout.write(JSON.stringify({scope: 'generated-lease-wasm-corpus-only', cases: 93,
    invalid_selectors: 3, imports: 0,
    wasm_sha256: createHash('sha256').update(bytes).digest('hex')}));
} else {
  assert(mode && path === undefined && extra.length === 0);
  const temporary = mkdtempSync(join(tmpdir(), 'prismpm-native-wasm-'));
  try {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const toolchain = [...readFileSync(join(root, 'rust-toolchain.toml'), 'utf8')
      .matchAll(/^channel\s*=\s*"([^"]+)"$/gm)];
    assert.equal(toolchain.length, 1);
    const env = consumerEnvironment(process.env, temporary, toolchain[0][1]);
    const built = await command('/usr/local/cargo/bin/cargo', ['build', '--locked', '--offline', '--release'],
      {cwd: mode, env, timeout: 300000});
    process.stderr.write(built.stderr);
    const wasm = join(env.CARGO_TARGET_DIR, 'wasm32-unknown-unknown/release/native_lease_wasm.wasm');
    const original = readFileSync(wasm);
    const driver = fileURLToPath(import.meta.url);
    const positive = await command(process.execPath, [driver, '--execute', wasm], {cwd: mode, env, timeout: 30000});
    const negative = await command(process.execPath, [driver, '--execute', wasm, '--wrong-expected'],
      {cwd: mode, env, timeout: 30000, status: 1});
    assert(negative.stderr.includes('native-wasm-case-0'));
    assert(negative.stderr.includes('AssertionError'));
    assert.deepEqual(readFileSync(wasm), original);
    const receipt = JSON.parse(positive.stdout);
    assert.equal(receipt.wasm_sha256, createHash('sha256').update(original).digest('hex'));
    process.stdout.write(JSON.stringify({...receipt, runtime_mutants: 1}));
  } finally { rmSync(temporary, {recursive: true, force: true}); }
}
