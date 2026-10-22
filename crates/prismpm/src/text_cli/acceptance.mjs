// Execution of every acceptance vector through the Core-Wasm entry and the built program.
// The program is exercised only through its process interface; every comparison is on bytes.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

assert.equal(process.argv.length, 6);
assert.equal(process.platform, 'linux', 'command-line acceptance requires the supported Linux SDK');
const [wasmPath, programPath, planPath, workPath] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const work = resolve(workPath);
const program = resolve(programPath);
const hex = value => Buffer.from(value, 'hex');
const empty = Buffer.alloc(0);

const module = await WebAssembly.compile(readFileSync(wasmPath));
assert.deepEqual(WebAssembly.Module.imports(module), [], 'Core-Wasm has no imports');

function core(request) {
  // A fresh instance per request: the guest allocator never frees.
  const {exports: guest} = new WebAssembly.Instance(module, {});
  const at = guest.holo_alloc(request.length) >>> 0;
  assert.ok(at + request.length <= guest.memory.buffer.byteLength);
  new Uint8Array(guest.memory.buffer, at, request.length).set(request);
  const packed = BigInt.asUintN(64, guest.holo_run(at, request.length));
  const offset = Number(packed >> 32n);
  const size = Number(packed & 0xffffffffn);
  assert.ok(size <= plan.response_maximum && offset + size <= guest.memory.buffer.byteLength, 'bounded Core-Wasm result');
  return Buffer.from(new Uint8Array(guest.memory.buffer, offset, size));
}

function execute(args, input) {
  const result = spawnSync(program, args, {
    input, encoding: null, env: {}, timeout: 30000, maxBuffer: plan.response_maximum + 65536,
  });
  assert.equal(result.error, undefined, 'program invocation error');
  assert.equal(result.signal, null, 'program terminated abnormally');
  return result;
}

mkdirSync(work, {recursive: true});
let within = 0;
let oversized = 0;
plan.vectors.forEach((vector, index) => {
  const request = hex(vector.request);
  const expected = hex(vector.response);
  assert.deepEqual(core(request), expected, `Core-Wasm response of vector ${index}`);
  const path = join(work, `${index}.request`);
  writeFileSync(path, request);
  const runs = [
    ['stdin', [plan.command], request],
    ['file', [plan.command, path], undefined],
    ['stdin-dash', [plan.command, '-'], request],
  ];
  for (const [transport, args, input] of runs) {
    const result = execute(args, input);
    if (request.length <= plan.request_maximum && vector.refusal !== undefined) {
      // A workbench frame: the program refuses the guest's report, without output.
      assert.equal(result.status, vector.code, `${transport} refusal code of vector ${index}`);
      assert.deepEqual(result.stdout, empty, `${transport} refusal output of vector ${index}`);
      assert.deepEqual(result.stderr, Buffer.from(`${plan.binary}: ${vector.refusal}\n`));
    } else if (request.length <= plan.request_maximum) {
      assert.deepEqual(result.stdout, expected, `${transport} report bytes of vector ${index}`);
      assert.equal(result.status, vector.code, `${transport} exit code of vector ${index}`);
      assert.deepEqual(result.stderr, empty, `${transport} diagnostics of vector ${index}`);
    } else {
      // The request maximum is enforced before dispatch, with a typed refusal.
      assert.equal(result.status, plan.fault_code, `${transport} refusal code of vector ${index}`);
      assert.deepEqual(result.stdout, empty, `${transport} refusal output of vector ${index}`);
      const detail = transport === 'file' ? `: ${path}` : '';
      assert.deepEqual(result.stderr, Buffer.from(`${plan.binary}: InputLimit${detail}\n`));
    }
  }
  if (request.length <= plan.request_maximum) within += 1; else oversized += 1;
});

{
  const help = execute(['--help'], empty);
  assert.equal(help.status, 0);
  assert.deepEqual(help.stdout, Buffer.from(plan.help), 'help text');
  assert.deepEqual(help.stderr, empty);
  const version = execute(['--version'], empty);
  assert.equal(version.status, 0);
  assert.deepEqual(version.stdout, Buffer.from(plan.version), 'version line');
  assert.deepEqual(version.stderr, empty);
}
if (plan.examples.length > 0) {
  const listing = execute(['examples'], empty);
  assert.equal(listing.status, 0);
  assert.deepEqual(listing.stdout, Buffer.from(plan.examples.map(example => `${example.name}\n`).join('')));
}
for (const example of plan.examples) {
  const printed = execute(['examples', example.name], empty);
  assert.equal(printed.status, 0);
  assert.deepEqual(printed.stdout, Buffer.from(example.text), `example ${example.name}`);
  // `examples NAME | program command` must yield a classified report.
  const report = execute([plan.command], printed.stdout);
  assert.ok(plan.outcomes.some(outcome => outcome.code === report.status
    && report.stdout.subarray(0, Buffer.byteLength(outcome.prefix)).equals(Buffer.from(outcome.prefix))),
  `example ${example.name} is not classified`);
}

console.log(JSON.stringify({
  examples: plan.examples.length,
  oversized_vectors: oversized,
  schema: 'prismpm/text-cli-acceptance/1',
  transports: ['stdin', 'file', 'stdin-dash'],
  vectors: plan.vectors.length,
  within_request_maximum: within,
}));
