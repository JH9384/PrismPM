/**
 * JSON Schema (draft 2020-12, the subset the spec package uses) to table rows.
 * One row per property, with its path, type, whether it is required and its
 * constraints. Descriptions are not copied: they are the schema author's
 * prose, and the vocabulary lint applies to prose. The constraints are data.
 */

function typeOf(schema) {
  if (schema.const !== undefined) {
    if (schema.const === null) return 'null';
    return typeof schema.const;
  }
  if (schema.enum) return typeof schema.enum[0];
  if (Array.isArray(schema.type)) return schema.type.join(' or ');
  if (schema.type) return schema.type;
  if (schema.oneOf) return `one of ${schema.oneOf.length} forms`;
  if (schema.$ref) return schema.$ref.replace(/^#\/\$defs\//, '');
  if (schema.properties) return 'object';
  if (schema.prefixItems || schema.items) return 'array';
  return 'any';
}

/** A literal from the schema, as a code span: it is an identifier, not prose. */
function literal(value) {
  return `\`${JSON.stringify(value)}\``;
}

export function constraintsOf(schema) {
  const out = [];
  if (schema.const !== undefined) out.push(`= ${literal(schema.const)}`);
  if (schema.enum) out.push(`one of ${schema.enum.map(literal).join(', ')}`);
  if (schema.pattern) out.push(`matches \`${schema.pattern}\``);
  if (schema.format) out.push(`format ${schema.format}`);
  if (schema.minLength !== undefined && schema.maxLength !== undefined) {
    out.push(`${schema.minLength} to ${schema.maxLength} characters`);
  } else if (schema.minLength !== undefined) out.push(`at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}`);
  else if (schema.maxLength !== undefined) out.push(`at most ${schema.maxLength} character${schema.maxLength === 1 ? '' : 's'}`);
  if (schema.minimum !== undefined && schema.maximum !== undefined) out.push(`${schema.minimum} to ${schema.maximum}`);
  else if (schema.minimum !== undefined) out.push(`at least ${schema.minimum}`);
  else if (schema.maximum !== undefined) out.push(`at most ${schema.maximum}`);
  if (schema.minItems !== undefined && schema.maxItems !== undefined) {
    out.push(schema.minItems === schema.maxItems ? `exactly ${schema.minItems} items` : `${schema.minItems} to ${schema.maxItems} items`);
  } else if (schema.minItems !== undefined) out.push(`at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`);
  else if (schema.maxItems !== undefined) out.push(`at most ${schema.maxItems} item${schema.maxItems === 1 ? '' : 's'}`);
  if (schema.uniqueItems) out.push('unique items');
  if (schema.not?.const !== undefined) out.push(`not ${literal(schema.not.const)}`);
  if (schema.additionalProperties === false && schema.properties) out.push('no other members');
  if (schema.$ref) out.push(`see ${schema.$ref.replace(/^#\/\$defs\//, '')}`);
  return out.join('; ');
}

/**
 * Flatten a schema into rows `{ path, type, required, constraints }`.
 * Array items are written `name[]`, tuple positions `name[0]`, and the forms of a
 * `oneOf` as `name (form 1)`.
 */
export function rows(schema, { prefix = '', required = false, out = [] } = {}) {
  if (prefix) out.push({ path: prefix, type: typeOf(schema), required, constraints: constraintsOf(schema) });
  const req = new Set(schema.required ?? []);
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    rows(child, { prefix: prefix ? `${prefix}.${name}` : name, required: req.has(name), out });
  }
  if (schema.prefixItems) {
    schema.prefixItems.forEach((child, i) => rows(child, { prefix: `${prefix}[${i}]`, required: true, out }));
  } else if (schema.items && typeof schema.items === 'object') {
    rows(schema.items, { prefix: `${prefix}[]`, required: true, out });
  }
  if (schema.oneOf) {
    schema.oneOf.forEach((child, i) => rows(child, { prefix: `${prefix} (form ${i + 1})`, required, out }));
  }
  return out;
}

/** Table rows for the top-level object of a schema. */
export function tableRows(schema) {
  return rows(schema).map((r) => [`\`${r.path}\``, r.type, r.required ? 'yes' : 'no', r.constraints]);
}

/** Table rows for one `$defs` entry. */
export function defRows(schema, name) {
  const def = schema.$defs?.[name];
  if (!def) throw new Error(`schema has no $defs.${name}`);
  return tableRows(def);
}

export const HEADER = ['Field', 'Type', 'Required', 'Constraint'];
