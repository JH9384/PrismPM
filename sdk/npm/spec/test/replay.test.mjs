// The replay predicate prism/replay/v1 and the history format prism/history/1 (#284): the calculator fixtures validate
// and agree with the reference archive, and the schemas reject what docs/proposals/284-histories-replay.md forbids.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spec } from './spec.mjs';
import { validate } from './json-schema.mjs';
import { here, loadReference, readJson, schema } from './reference.mjs';

const { ATTESTATION, REPLAY_PREDICATE_TYPE } = spec;

const REPLAY_SCHEMA = 'predicates/replay-v1.schema.json';
const HISTORY_SCHEMA = 'schemas/history/history-v1.schema.json';
const ref = loadReference();
const statement = readJson('fixtures/attestation/statement/calculator-replay.json');
const history = readJson('fixtures/history/history-v1/calculator.json');
const copy = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const unlabel = (label) => label.slice('blake3:'.length);
const toHex = (bytes) => Buffer.from(bytes).toString('hex');

const replayErrors = (predicate) => validate(schema(REPLAY_SCHEMA), predicate);
const historyErrors = (value) => validate(schema(HISTORY_SCHEMA), value);
const rejects = (errors, why) => assert.notDeepEqual(errors, [], `the schema accepted ${why}`);

test('the replay schema $id is the reserved one and the registry row is no longer a placeholder', () => {
  assert.equal(schema(REPLAY_SCHEMA).$id, `${REPLAY_PREDICATE_TYPE}/schema.json`);
  const row = readJson('../predicates/registry.json').predicates.find((p) => p.predicateType === REPLAY_PREDICATE_TYPE);
  assert.deepEqual({ status: row.status, schema: row.schema, owner: row.owner }, { status: 'experimental', schema: REPLAY_SCHEMA, owner: { issue: 284 } });
});

test('the replay-v1 predicate fixture is the predicate of the calculator statement, and both validate', () => {
  assert.deepEqual(readJson('fixtures/predicates/replay-v1/calculator.json'), statement.predicate);
  assert.deepEqual(validate(schema(ATTESTATION.STATEMENT_SCHEMA), statement), []);
  assert.deepEqual(replayErrors(statement.predicate), []);
  assert.equal(statement.predicateType, REPLAY_PREDICATE_TYPE);
});

test('the calculator statement names the guest and model of the reference archive, by both digests', () => {
  assert.equal(statement.subject.length, 1);
  assert.deepEqual(statement.subject[0].digest, { blake3: unlabel(ref.resolved.guest.label), sha256: sha256(ref.guest) });
  const { model } = statement.predicate;
  assert.deepEqual(model, { blake3: unlabel(ref.resolved.model.label), sha256: sha256(ref.resolved.model.content) });
  assert.equal(model.sha256, ref.provenance.model_id);
});

test('the calculator statement counts its history: every vector replayed and none diverged', () => {
  const { histories, divergenceCount } = statement.predicate;
  assert.equal(divergenceCount, 0);
  assert.deepEqual(histories.map((h) => [h.events, h.divergences]), [[ref.modelDocument.application.acceptance_vectors.length, 0]]);
});

test('the history digest covers canonical JSON with no trailing newline, whatever the file spelled', () => {
  const canonical = Buffer.from(readFileSync(here('fixtures/history/history-v1/calculator.json'), 'utf8').trimEnd());
  assert.equal(sha256(canonical), statement.predicate.histories[0].digest.sha256);
});

test('the calculator history is the acceptance vectors of the model, in order', () => {
  const vectors = ref.modelDocument.application.acceptance_vectors;
  assert.deepEqual(history.events, vectors.map((v) => ({ request: toHex(v.request), response: toHex(v.response) })));
  assert.deepEqual(history.recordedFrom.guest, statement.subject[0].digest);
  assert.deepEqual(history.recordedFrom.model, statement.predicate.model);
  assert.equal(history.application, 'Calculator');
});

test('the predicate schema rejects a statement that claims nothing or names a digest of one algorithm', () => {
  const base = statement.predicate;
  const edit = (change) => {
    const next = copy(base);
    change(next);
    return replayErrors(next);
  };
  rejects(edit((p) => (p.histories = [])), 'no history');
  rejects(edit((p) => (p.histories[0].events = 0)), 'a history of no events');
  rejects(edit((p) => (p.divergenceCount = -1)), 'a negative count');
  rejects(edit((p) => (p.divergenceCount = 1.5)), 'a fractional count');
  rejects(edit((p) => delete p.histories[0].digest.blake3), 'a history digest with sha256 only');
  rejects(edit((p) => delete p.model.sha256), 'a model digest with blake3 only');
  rejects(edit((p) => (p.model.sha1 = '0'.repeat(40))), 'a third digest');
  rejects(edit((p) => (p.verifiedLevels = ['P3'])), 'a claimed level, which a checker would never read');
  rejects(edit((p) => (p.runtime.name = 'Prism Code')), 'a runtime name with a space');
  rejects(edit((p) => delete p.runtime.version), 'a runtime with no version');
});

test('the history schema takes a response or an error, never both or neither', () => {
  const event = (value) => historyErrors({ ...history, events: [value] });
  assert.deepEqual(event({ request: '', response: '' }), []);
  assert.deepEqual(event({ request: '00', error: 'core.allocation' }), []);
  rejects(event({ request: '00' }), 'an event with no outcome');
  rejects(event({ request: '00', response: '00', error: 'core.trap' }), 'an event with two outcomes');
  rejects(event({ request: '0', response: '' }), 'an odd number of hex digits');
  rejects(event({ request: 'AB', response: '' }), 'uppercase hex, a second spelling of the same bytes');
  rejects(event({ request: '00', error: 'trap' }), 'an error that is not a dotted code');
  rejects(event({ request: '00', response: '', at: 3 }), 'an unknown member');
  rejects(historyErrors({ ...history, events: [] }), 'a history of nothing');
  rejects(historyErrors({ ...history, schema: 'prism/history/2' }), 'another version');
});

/** The members a schema object declares, walking every $ref except the digest set the type imports. */
function schemaMembers(root) {
  const members = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) {
      const name = node.$ref.split('/').pop();
      if (name !== 'PrismDigestSet') walk(root.$defs[name]);
      return;
    }
    for (const [name, value] of Object.entries(node.properties ?? {})) {
      members.add((node.required ?? []).includes(name) ? name : `${name}?`);
      walk(value);
    }
    walk(node.items);
  };
  walk(root);
  return members;
}

test('the ReplayPredicateV1 type and the schema declare the same members', () => {
  const source = readFileSync(here('../predicates/replay-v1.d.ts'), 'utf8')
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .split('export interface ReplayStatementV1')[0];
  const declared = new Set([...source.matchAll(/^\s+([A-Za-z]+\??):/gm)].map((m) => m[1]));
  assert.deepEqual(declared, schemaMembers(schema(REPLAY_SCHEMA)));
});

test('the HistoryV1 type and the schema declare the same members', () => {
  const source = readFileSync(here('../types/history.d.ts'), 'utf8')
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/^\s+[a-z]+\?: never;$/gm, '');
  const declared = new Set([...source.matchAll(/^\s+([A-Za-z]+\??):/gm)].map((m) => m[1]));
  const walked = new Set();
  const history = schema(HISTORY_SCHEMA);
  for (const [name] of Object.entries(history.properties)) walked.add(history.required.includes(name) ? name : `${name}?`);
  for (const variant of history.properties.events.items.oneOf) for (const name of Object.keys(variant.properties)) walked.add(name);
  assert.deepEqual(declared, walked);
});
