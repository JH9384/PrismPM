import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {encodeEffectWire as encode, decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {corpus, initial, command, plan, begin, completion, continued, effect, bytes, MAXIMUM} from './corpus.mjs';
import {compactOperation, decodeRequest, encodeRequest} from './wire.mjs';
import {measure, reservation} from './budget.mjs';
import {assertBaselineSources, assertFrozenInputs, prepare, modules, repository, sha} from './compile.mjs';
import {frozenInputs} from './checks.mjs';

test('whole-owner closure captures every imported model and rejects drift before source mutation', () => {
  const inputs = frozenInputs(), sources = new Map();
  // Parse all actual group entries without linking or evaluating modules.
  // Runtime imports remain separately bound by the owner's fixed input list.
  const parser = String.raw`
    import assert from 'node:assert/strict';
    import {readFileSync} from 'node:fs';
    import {createHash} from 'node:crypto';
    import {dirname, relative, resolve} from 'node:path';
    import {SourceTextModule} from 'node:vm';
    const {root, inputs} = JSON.parse(readFileSync(0, 'utf8'));
    const pending = ['sdk/browser/session-model-test.mjs',
      'tests/browser-session/wire.test.mjs', 'tests/browser-session/provenance.test.mjs'];
    const visited = new Set();
    while (pending.length) {
      const path = pending.pop(); if (visited.has(path)) continue;
      assert(visited.size < 256, 'bounded owning static module graph');
      assert(Object.hasOwn(inputs, path), 'captured local module input: ' + path);
      const bytes = readFileSync(resolve(root, path));
      assert(bytes.length <= 4194304, 'bounded owning static module');
      assert.equal(createHash('sha256').update(bytes).digest('hex'), inputs[path], 'captured module hash: ' + path);
      const source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      const declarations = new SourceTextModule(source).dependencySpecifiers;
      visited.add(path);
      for (const specifier of declarations) {
        if (specifier.startsWith('node:')) continue;
        assert(specifier.startsWith('./') || specifier.startsWith('../'), 'closed local import');
        const dependency = relative(root, resolve(root, dirname(path), specifier));
        assert(dependency.endsWith('.mjs') && dependency.split('/').every(part =>
          /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'), 'confined local import');
        pending.push(dependency);
      }
    }
    process.stdout.write(JSON.stringify([...visited].sort()));
  `;
  const inspect = captured => spawnSync(process.execPath,
    ['--experimental-vm-modules', '--input-type=module', '-e', parser], {
      input: JSON.stringify({root: fileURLToPath(new URL('../../', import.meta.url)), inputs: captured}),
      encoding: 'utf8', env: {NODE_NO_WARNINGS: '1', TZ: 'UTC'}, timeout: 10000, maxBuffer: 1048576,
    });
  const complete = inspect(inputs);
  assert.ifError(complete.error); assert.equal(complete.signal, null); assert.equal(complete.status, 0, complete.stderr);
  const path = 'sdk/account-genesis-artifact.mjs';
  assert(JSON.parse(complete.stdout).includes(path), 'actual imported helper: ' + path);
  const omitted = {...inputs}; delete omitted[path];
  const refused = inspect(omitted);
  assert.ifError(refused.error); assert.equal(refused.signal, null); assert.equal(refused.status, 1);
  assert(refused.stderr.includes('captured local module input: ' + path), refused.stderr);
  assert.throws(() => assertFrozenInputs(omitted), /actual frozen session input closure/);
  assert.throws(() => assertFrozenInputs({...inputs, [path]: '0'.repeat(64)}), /actual frozen session input closure/);
  for (const module of modules) {
    const path = module === 'Fixture' ? 'tests/browser-session/src/Fixture.lex.tex'
      : 'stdlib/src/' + module.replaceAll('.', '/') + '.lex.tex';
    const bytes = readFileSync(join(repository, path));
    assert.equal(inputs[path], sha(bytes), path); sources.set(module, bytes);
  }
  for (const path of ['sdk/browser/identity.mjs', 'tests/browser-view/driver-cache.mjs',
    'tests/fixtures/library/native-library/project/lexlean.toml', 'tests/browser-workspace/src/main.rs',
    'tests/browser-journal/driver/src/main.rs', 'model/authorities.toml', 'model/dependencies.toml',
    'rust-toolchain.toml', 'lean-toolchain', 'LICENSE-MIT', 'LICENSE-APACHE', 'vendor/lean4-prod/lean.tar',
    'vendor/lean4-prod/rust/MANIFEST.sha256', 'vendor/lexlean/MANIFEST.sha256']) {
    assert.equal(inputs[path], sha(readFileSync(join(repository, path))), path);
  }
  for (const tree of ['vendor/lexlean','vendor/lean4-prod/rust']) {
    const lines=readFileSync(join(repository,tree,'MANIFEST.sha256'),'utf8').trimEnd().split('\n');
    for(const line of lines) {
      const match=/^([0-9a-f]{64})  (.+)$/.exec(line); assert.ok(match);
      const path=tree+'/'+match[2];assert.equal(inputs[path],sha(readFileSync(join(repository,path))),path);
    }
    const path=tree+'/'+/^([0-9a-f]{64})  (.+)$/.exec(lines[0])[2];
    const changed={...inputs,[path]:'0'.repeat(64)};
    assert.throws(()=>prepare(null,null,changed),/complete frozen session owner inputs/);
    const missing={...inputs};delete missing[path];
    assert.throws(()=>assertFrozenInputs(missing),/complete frozen session owner inputs/);
  }
  assertBaselineSources(sources, new Map(sources));
  assert.throws(() => assertBaselineSources(sources, null), /positive source closure/);
  for (const module of modules) {
    const absent = new Map(sources); absent.delete(module);
    assert.throws(() => assertBaselineSources(absent, sources), /module inventory/);
    const changed = new Map(sources); changed.set(module, Buffer.concat([sources.get(module), Buffer.from('\n')]));
    assert.throws(() => assertBaselineSources(changed, sources), /immutable positive source/);
  }
});

test('finite contextual sharing round-trips all canonical positive and typed-negative frames', () => {
  let count = 0;
  for (const row of corpus()) {
    if (row.response[2] === 2) continue;
    assert.deepEqual(encodeRequest(decodeRequest(row.request)), row.request, row.id); count++;
  }
  assert.ok(count >= 780);
});

test('field-scoped references reject explicit-equal and arbitrary reference positions', () => {
  const ready = initial(), selected = command(ready), p = plan(ready, selected), active = begin(ready, selected, p);
  const original = [2, ready, selected, p, active[4][4]], packed = compactOperation(original);
  for (const [path, equal] of [[[2, 2], ready[3][3]], [[3, 0], packed[2]], [[3, 1], packed[1]]]) {
    const copy = structuredClone(packed); let at = copy; for (const key of path.slice(0, -1)) at = at[key];
    at[path.at(-1)] = [1, equal]; assert.throws(() => decodeRequest(encode([1, copy])), /noncanonical/);
    for (const bad of [[2], [0, 1], [1], [0, 0xffffffff]]) {at[path.at(-1)] = bad; assert.throws(() => decodeRequest(encode([1, copy])));}
  }
  const changed = structuredClone(original); changed[3][1][3][2] = bytes(3, 97);
  assert.deepEqual(decodeRequest(encodeRequest(changed)), changed, 'differing explicit full state remains available to kernel equality');
});

test('compact framing keeps maximum distinct Commit requests representable across multiple steps', () => {
  const ready = initial(), manifest = decode(ready[2]);
  // Actual effect manifest is captured from the modeled baseline, with only the
  // selected Store byte budget raised to its already-defined one-MiB maximum.
  manifest[3].find(row => row[0] === 'store')[1][1][1] = 1048576;
  ready[2] = encode(manifest);
  const objects = Array.from({length: 16}, (_, index) => bytes(1048576, index + 1));
  const selected = command(ready), p = plan(ready, selected, [0], effect(ready, 'store', [7, ['head', [0], 'sha256:' + 'a'.repeat(64), objects]]));
  const active = begin(ready, selected, p), result = completion(active, [7, 'sha256:' + 'a'.repeat(64)]);
  const following = plan(active, selected, [1, [p[4], result]], effect(active, 'store', [7, ['head', [0], 'sha256:' + 'b'.repeat(64), objects]]));
  const next = continued(active, following);
  assert.equal(reservation(active).fits, true);
  const raw = compactOperation([4, active, result, next[3][2], following, next[4][4]]);
  assert.ok(measure(raw) > 32 * 1048576 && measure(raw) < MAXIMUM);
  const encoded = encode([1, raw]); assert.equal(encoded.length, measure([1, raw]));
});

test('source-declared global reservation refuses infeasible future distinct payloads before effect admission', () => {
  const ready = initial(), selected = command(ready);
  assert.equal(reservation(begin(ready, selected)).fits, true);
  ready[1][2] = MAXIMUM;
  assert.equal(reservation(begin(ready, command(ready))).fits, false);
  ready[1][5] = 1;
  assert.equal(reservation(begin(ready, command(ready))).fits, true, 'unused future continuation limit does not constrain final step');
});

test('size oracle agrees with full canonical frames at every CBOR head discontinuity', () => {
  for (const length of [0, 23, 24, 255, 256, 65535, 65536]) {
    for (const value of [length, bytes(length), [1, [3, length, bytes(length)]]]) assert.equal(measure(value), encode(value).length);
  }
  for (const length of [1, 23, 24, 127, 128, 255, 256, 512]) {
    const value = ['r'.repeat(length), bytes(23), bytes(24)]; assert.equal(measure(value), encode(value).length);
  }
  const ready = initial(), manifest = decode(ready[2]), selected = command(ready);
  const guest = manifest[3].find(row => row[0] === 'guest')[1][1], store = manifest[3].find(row => row[0] === 'store')[1][1];
  const digest = 'sha256:' + 'f'.repeat(64), signature = bytes(64);
  const rows = [
    ['guest', [0, [guest[0], guest[1], guest[2], bytes(1)]], [0, bytes(guest[4])]],
    ['random', [1, 65536], [1, bytes(65536)]], ['digest', [2, bytes(1)], [2, digest]],
    ['sign', [3, bytes(1)], [3, signature]], ['verify', [4, [bytes(1), signature]], [4, true]],
    ['store', [5, digest], [5, [1, bytes(store[1])]]], ['store', [6, 'head'], [6, [1, [digest, bytes(store[1])]]]],
    ['store', [7, ['head', [0], digest, [bytes(1)]]], [7, digest]],
  ];
  for (const [resource, operation, output] of rows) {
    const p = plan(ready, selected, [0], effect(ready, resource, operation)), active = begin(ready, selected, p);
    assert.equal(reservation(active).selectedMaximum, Math.max(encode(output).length, encode([8, [12]]).length), resource + operation[0]);
    const value = compactOperation([3, active, completion(active, output), bytes(1), bytes(1), ready[4][4]]);
    assert.equal(measure([1, value]), encode([1, value]).length);
  }
});
