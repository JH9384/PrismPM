// prismpm/sdk-lock/3 (issue #264): the input lock is the /2 lock plus `inputs`, and nothing else changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { blake3Hex } from '../../prism-code/src/blake3.mjs';
import { SCHEMAS } from '../index.mjs';
import { validate } from './json-schema.mjs';
import { here, readJson, schema } from './reference.mjs';

const V2 = SCHEMAS['prismpm/sdk-lock/2'];
const V3 = SCHEMAS['prismpm/sdk-lock/3'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const copy = (value) => JSON.parse(JSON.stringify(value));

/**
 * The SDK fields are illustrative but internally consistent: the image digest is the sha256 of
 * `sdk_index`, and each inventory digest is the sha256 of its document. The inputs carry the
 * calculator example's real model, spec and world digests (docs/proposals/264-input-lock.md).
 */
const lock = readJson('fixtures/sdk-lock-v3.json');

/** A /3 lock minus `inputs`, renamed /2: what every existing SDK reader receives. */
function projection(value) {
  const { inputs: _inputs, ...rest } = copy(value);
  return { ...rest, schema: 'prismpm/sdk-lock/2' };
}

/** The spec digest encoding from the proposal: BLAKE3 over framed (path, bytes) pairs. */
function specDigest(files) {
  const parts = [Buffer.from('prismpm/spec-inputs/1\n')];
  const paths = Object.keys(files).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  for (const path of paths) {
    const name = Buffer.from(path);
    const body = Buffer.from(files[path]);
    const u32 = Buffer.alloc(4);
    u32.writeUInt32BE(name.length);
    const u64 = Buffer.alloc(8);
    u64.writeBigUInt64BE(BigInt(body.length));
    parts.push(u32, name, u64, body);
  }
  return blake3Hex(new Uint8Array(Buffer.concat(parts)));
}

test('the sample /3 lock validates, and its /2 projection validates against the /2 schema', () => {
  assert.deepEqual(validate(schema(V3), lock), []);
  assert.deepEqual(validate(schema(V2), projection(lock)), []);
});

test('the sample SDK fields are internally consistent', () => {
  assert.equal(lock.sdk_image.split('@sha256:')[1], sha256(lock.sdk_index));
  for (const row of lock.platforms) {
    assert.equal(row.inventory_digest, `sha256:${sha256(row.inventory_document)}`, row.platform);
    assert.deepEqual(JSON.parse(row.inventory_document).artifacts, row.inventory, row.platform);
  }
});

test('the /3 schema is the /2 schema plus `inputs`', () => {
  const v2 = schema(V2);
  const v3 = schema(V3);
  assert.deepEqual(Object.keys(v3.properties).sort(), [...Object.keys(v2.properties), 'inputs'].sort());
  for (const [name, property] of Object.entries(v2.properties)) {
    if (name !== 'schema') assert.deepEqual(v3.properties[name], property, name);
  }
  assert.deepEqual(v3.required, [...v2.required, 'inputs'].sort());
  assert.equal(v3.additionalProperties, false);
});

test('an existing /2 lock stays a valid /2 lock and is not a /3 lock', () => {
  const old = projection(lock);
  assert.deepEqual(validate(schema(V2), old), []);
  assert.notDeepEqual(validate(schema(V3), old), []);
  assert.notDeepEqual(validate(schema(V3), { ...old, schema: 'prismpm/sdk-lock/3' }), [], 'a /3 lock without inputs');
});

test('the world digests are the digests of worlds/core-wasm.wit', () => {
  // The digests name the committed bytes; a Windows checkout may have rewritten LF to CRLF.
  const text = readFileSync(here('../worlds/core-wasm.wit'), 'utf8').replaceAll('\r\n', '\n');
  const wit = new Uint8Array(Buffer.from(text, 'utf8'));
  assert.equal(lock.inputs.world.sha256, sha256(wit));
  assert.equal(lock.inputs.world.blake3, blake3Hex(wit));
});

test('the spec digest encoding matches the reference vectors', () => {
  assert.equal(specDigest({}), '38270f9a684133fd4a9e08731bd9d24b9e90cc92eb757b6fb548ca33589a361b');
  const files = { 'b.lex.tex': 'B', 'a/prismpm.toml': 'A\n' };
  assert.equal(specDigest(files), 'fc0cc56804659d03cdf3e6a74ab4053a7037a24b4f8c24ab02c050b0c9bad798');
  assert.equal(specDigest({ 'a/prismpm.toml': 'A\n', 'b.lex.tex': 'B' }), specDigest(files), 'file order');
  assert.notEqual(specDigest({ ...files, 'b.lex.tex': 'C' }), specDigest(files), 'a content edit');
});

const rejects = (value, why) => assert.notDeepEqual(validate(schema(V3), value), [], `accepted ${why}`);
const mutate = (edit) => {
  const value = copy(lock);
  edit(value);
  return value;
};

test('negative controls: the /3 schema rejects malformed inputs', () => {
  rejects(mutate((v) => delete v.inputs), 'a missing inputs object');
  rejects(mutate((v) => delete v.inputs.model.sha256), 'a model without sha256');
  rejects(mutate((v) => delete v.inputs.model.blake3), 'a model without blake3');
  rejects(mutate((v) => (v.inputs.model.blake3 = `blake3:${v.inputs.model.blake3}`)), 'a prefixed blake3 digest');
  rejects(mutate((v) => (v.inputs.model.sha512 = v.inputs.model.sha256)), 'a third model digest');
  rejects(mutate((v) => (v.inputs.spec.basis = 'lexlean-source-id')), 'an unknown spec basis');
  rejects(mutate((v) => (v.inputs.spec.sha256 = v.inputs.model.sha256)), 'a sha256 spec digest');
  rejects(mutate((v) => (v.inputs.toolchain.rustc = 'stable')), 'a channel name for rustc');
  rejects(mutate((v) => (v.inputs.toolchain.lean = '4.32.1')), 'a Lean version without its v prefix');
  rejects(mutate((v) => delete v.inputs.toolchain.wasm_bindgen), 'a missing wasm-bindgen version');
  rejects(mutate((v) => (v.inputs.world.contract = 'hologram:guest/core-wasm@2')), 'an unknown guest contract');
  rejects(mutate((v) => (v.inputs.world = {})), 'an empty world');
  rejects(mutate((v) => (v.inputs.generation = {})), 'missing generator identities');
  rejects(mutate((v) => (v.inputs.extra = 1)), 'an unknown inputs member');
  rejects(mutate((v) => (v.schema = 'prismpm/sdk-lock/2')), 'the /2 schema name');
});

test('a model without an application has a null world', () => {
  assert.deepEqual(validate(schema(V3), mutate((v) => (v.inputs.world = null))), []);
});
