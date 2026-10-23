import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constraintsOf, defRows, rows, tableRows } from '../lib/schema.mjs';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'items'],
  properties: {
    kind: { const: 15 },
    name: { type: 'string', minLength: 1, maxLength: 8, pattern: '^[a-z]+$' },
    items: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      prefixItems: [{ type: 'integer', minimum: 0 }, { enum: ['a', 'b'] }],
    },
    list: { type: 'array', uniqueItems: true, items: { $ref: '#/$defs/Entry' } },
    choice: { oneOf: [{ type: 'object', required: ['tag'], properties: { tag: { const: 'none' } } }, { type: 'null' }] },
  },
  $defs: { Entry: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uri' } } } },
};

test('rows flatten properties, tuples, items and oneOf forms with required flags', () => {
  const paths = rows(schema).map((r) => `${r.path}${r.required ? '*' : ''}`);
  assert.deepEqual(paths, [
    'kind*',
    'name',
    'items*',
    'items[0]*',
    'items[1]*',
    'list',
    'list[]*',
    'choice',
    'choice (form 1)',
    'choice (form 1).tag*',
    'choice (form 2)',
  ]);
});

test('constraints are data in code spans, never prose', () => {
  assert.equal(constraintsOf(schema.properties.kind), '= `15`');
  assert.equal(constraintsOf(schema.properties.name), 'matches `^[a-z]+$`; 1 to 8 characters');
  assert.equal(constraintsOf(schema.properties.items), 'exactly 2 items');
  assert.equal(constraintsOf(schema.properties.items.prefixItems[1]), 'one of `"a"`, `"b"`');
  assert.equal(constraintsOf(schema.properties.list), 'unique items');
  assert.equal(constraintsOf(schema.properties.list.items), 'see Entry');
  assert.equal(constraintsOf(schema), 'no other members');
});

test('tableRows and defRows produce four cells per row', () => {
  for (const row of [...tableRows(schema), ...defRows(schema, 'Entry')]) assert.equal(row.length, 4);
  assert.deepEqual(defRows(schema, 'Entry')[0], ['`id`', 'string', 'yes', 'format uri']);
  assert.throws(() => defRows(schema, 'Missing'), /no \$defs\.Missing/);
});
