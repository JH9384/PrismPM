#!/usr/bin/env node
/**
 * Generate types/documents.d.ts from the JSON Schemas in schemas/holo and
 * schemas/documents. Zero dependencies. It converts only the closed keyword
 * set these schemas use and throws on anything else.
 *
 *   node scripts/generate-types.mjs           write types/documents.d.ts
 *
 * The JSON Schemas are the source. The output is not committed: build.mjs
 * writes it, git ignores it and the package ships it. Rust (typify) and
 * Python (datamodel-code-generator) will read the same schema files.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const defaultRoot = new URL('../', import.meta.url);
const OUTPUT = 'types/documents.d.ts';
const SOURCES = [
  { folder: 'schemas/holo', prefix: 'Holo' },
  { folder: 'schemas/documents', prefix: '' },
];
const IGNORED = new Set(['$schema', '$id', '$comment', 'title', 'description', 'format', '$defs']);
const HANDLED = new Set([
  '$ref', 'type', 'const', 'enum', 'properties', 'required', 'additionalProperties', 'minProperties',
  'items', 'prefixItems', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'multipleOf', 'not', 'oneOf', 'anyOf', 'allOf',
]);

const pascal = (text) =>
  text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (name) => (identifier.test(name) ? name : JSON.stringify(name));

function doc(text, pad) {
  if (!text) return '';
  return `${pad}/** ${text.replace(/\*\//g, '* /')} */\n`;
}

function literal(value) {
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{ ${Object.entries(value).map(([k, v]) => `${key(k)}: ${literal(v)}`).join('; ')} }`;
  }
  return JSON.stringify(value);
}

const wrap = (text) => (/[|&]/.test(text) && !/^[[{(]/.test(text) ? `(${text})` : text);

function emit(schema, ns, pad) {
  if (schema === true) return 'unknown';
  if (schema === false) return 'never';
  for (const k of Object.keys(schema)) {
    if (!IGNORED.has(k) && !HANDLED.has(k)) throw new Error(`generate-types: unsupported keyword ${k} in ${ns}`);
  }
  if (schema.$ref !== undefined) {
    const match = /^#\/\$defs\/([^/]+)$/.exec(schema.$ref);
    if (!match) throw new Error(`generate-types: unsupported $ref ${schema.$ref}`);
    return `${ns}.${pascal(match[1])}`;
  }
  if ('const' in schema) return literal(schema.const);
  if (schema.enum !== undefined) return schema.enum.map(literal).join(' | ');

  const union = schema.oneOf ?? schema.anyOf;
  const unionText = union ? union.map((s) => wrap(emit(s, ns, pad))).join(' | ') : null;
  const intersection = schema.allOf ? schema.allOf.map((s) => wrap(emit(s, ns, pad))).join(' & ') : null;

  let base = null;
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    base = types.map((t) => baseType(t, schema, ns, pad)).join(' | ');
  } else if (schema.properties !== undefined) {
    base = objectType(schema, ns, pad);
  }
  // Without its own properties, a union of branches already fixes the type; `type` adds nothing.
  if (unionText && schema.properties === undefined) base = null;
  const parts = [base, unionText, intersection].filter(Boolean);
  if (parts.length === 0) return 'unknown';
  return parts.length === 1 ? parts[0] : parts.map(wrap).join(' & ');
}

function baseType(type, schema, ns, pad) {
  switch (type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return arrayType(schema, ns, pad);
    case 'object':
      return objectType(schema, ns, pad);
    default:
      throw new Error(`generate-types: unknown type ${type}`);
  }
}

function arrayType(schema, ns, pad) {
  if (schema.maxItems === 0) return '[]';
  if (schema.prefixItems !== undefined) {
    const head = schema.prefixItems.map((s) => emit(s, ns, pad));
    if (schema.items === false) return `[${head.join(', ')}]`;
    const rest = schema.items === undefined ? 'unknown' : emit(schema.items, ns, pad);
    return `[${head.join(', ')}, ...${wrap(rest)}[]]`;
  }
  const item = schema.items === undefined ? 'unknown' : emit(schema.items, ns, pad);
  return `${wrap(item)}[]`;
}

function objectType(schema, ns, pad) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const inner = `${pad}  `;
  const lines = Object.entries(properties).map(
    ([name, sub]) => `${doc(sub.description, inner)}${inner}${key(name)}${required.has(name) ? '' : '?'}: ${emit(sub, ns, inner)};\n`,
  );
  if (schema.additionalProperties !== false) lines.push(`${inner}[key: string]: unknown;\n`);
  if (lines.length === 0) return 'Record<string, unknown>';
  return `{\n${lines.join('')}${pad}}`;
}

function generate(root = defaultRoot) {
  const blocks = [];
  const names = new Set();
  for (const { folder, prefix } of SOURCES) {
    const files = readdirSync(new URL(folder, root)).filter((f) => f.endsWith('.schema.json')).sort();
    for (const file of files) {
      const schema = JSON.parse(readFileSync(new URL(`${folder}/${file}`, root), 'utf8'));
      const name = prefix + pascal(file.replace(/\.schema\.json$/, ''));
      if (names.has(name)) throw new Error(`generate-types: duplicate type ${name}`);
      names.add(name);
      const summary = [schema.title && schema.title !== name ? schema.title : null, schema.description, `Schema: ${folder}/${file}.`]
        .filter(Boolean)
        .join(' ');
      let block = `${doc(summary, '')}export type ${name} = ${emit(schema, name, '')};\n`;
      const defs = Object.entries(schema.$defs ?? {});
      if (defs.length > 0) {
        const seen = new Set();
        block += `export declare namespace ${name} {\n`;
        for (const [defName, def] of defs) {
          const typeName = pascal(defName);
          if (seen.has(typeName)) throw new Error(`generate-types: ${name}.${typeName} is defined twice`);
          seen.add(typeName);
          block += `${doc(def.description, '  ')}  type ${typeName} = ${emit(def, name, '  ')};\n`;
        }
        block += '}\n';
      }
      blocks.push(block);
    }
  }
  return (
    '// @generated by scripts/generate-types.mjs from schemas/holo and schemas/documents. Do not edit.\n' +
    '// Not committed: build.mjs writes it (npm run build) and git ignores it.\n\n' +
    blocks.join('\n')
  );
}

export { generate, OUTPUT };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(new URL(OUTPUT, defaultRoot), generate());
}
