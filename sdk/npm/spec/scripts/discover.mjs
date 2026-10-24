/**
 * What the files in this package say about themselves.
 *
 * Every schema, document family and predicate is found by reading the
 * directories, never from a list that someone edits. A new schema is added by
 * adding its files; `build.mjs` turns what this module finds into the
 * generated entry point, and the docs generator turns it into the schema and
 * predicate tables.
 *
 * Layout read here:
 *   schemas/holo/<name>.schema.json          one key of HOLO_SCHEMAS per file
 *   schemas/documents/<family>-v<N>.schema.json
 *                                            a document whose `schema` member is
 *                                            fixed by `properties.schema.const`
 *   schemas/<group>/<name>.schema.json       any other schema, reachable by path
 *   predicates/<name>-v<N>.json              the registry row of a predicate
 *   predicates/<name>-v<N>.d.ts              its type
 *   predicates/<name>-v<N>.schema.json       its schema, absent while a placeholder
 *   types/<name>.d.ts                        type declarations, re-exported by index.d.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

const SCHEMA_SUFFIX = '.schema.json';
const PREDICATE_BASE = 'https://uor.foundation/prism';
const VERSIONED = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)-v([0-9]+)$/;

const readJson = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));
const files = (dir, rel) => (existsSync(join(dir, rel)) ? readdirSync(join(dir, rel)).filter((f) => statSync(join(dir, rel, f)).isFile()).sort() : []);
const folders = (dir, rel) => (existsSync(join(dir, rel)) ? readdirSync(join(dir, rel)).filter((f) => statSync(join(dir, rel, f)).isDirectory()).sort() : []);

export const pascal = (text) =>
  text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');

export const upperSnake = (text) => text.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();

const byFamilyThenVersion = (a, b) => (a.family === b.family ? a.version - b.version : a.family < b.family ? -1 : 1);

function fail(message) {
  throw new Error(`spec discovery: ${message}`);
}

function schemaRecord(dir, group, file) {
  const path = `${group}/${file}`;
  const schema = readJson(dir, path);
  if (typeof schema.$id !== 'string') fail(`${path} has no $id`);
  const stem = file.slice(0, -SCHEMA_SUFFIX.length);
  // The sdk-lock schemas are byte-identical copies of the repository's and carry no title; their type name stands in.
  return { path, group, stem, id: schema.$id, title: typeof schema.title === 'string' ? schema.title : pascal(stem), schema };
}

/**
 * @param {string} [dir] the package directory
 */
export function discover(dir = PACKAGE_DIR) {
  const schemaFolders = folders(dir, 'schemas');
  const schemas = [];
  for (const group of schemaFolders) {
    for (const file of files(dir, `schemas/${group}`)) {
      if (file.endsWith(SCHEMA_SUFFIX)) schemas.push(schemaRecord(dir, `schemas/${group}`, file));
    }
  }

  // Holo section schemas: one HOLO_SCHEMAS key per file.
  const holo = schemas
    .filter((s) => s.group === 'schemas/holo')
    .map((s) => ({ key: upperSnake(s.stem), path: s.path, id: s.id, title: s.title }));

  // Documents: the `schema` member the schema fixes is the document's name.
  const documents = schemas
    .filter((s) => s.group === 'schemas/documents')
    .map((s) => {
      const match = VERSIONED.exec(s.stem);
      if (!match) fail(`${s.path} must be named <family>-v<N>.schema.json`);
      const name = s.schema.properties?.schema?.const;
      if (typeof name !== 'string') fail(`${s.path} must fix its document name with properties.schema.const`);
      return { name, path: s.path, id: s.id, title: s.title, family: match[1], version: Number(match[2]), type: `${pascal(match[1])}V${match[2]}` };
    })
    .sort(byFamilyThenVersion);
  const names = new Set();
  for (const doc of documents) {
    if (names.has(doc.name)) fail(`two schemas in schemas/documents fix the document name ${doc.name}`);
    names.add(doc.name);
  }
  const families = [...new Set(documents.map((d) => d.family))].map((family) => ({
    family,
    type: pascal(family),
    members: documents.filter((d) => d.family === family).map((d) => d.type),
  }));

  // Predicates: one row file, one type file, and a schema unless the row is a placeholder.
  const predicates = files(dir, 'predicates')
    .filter((f) => f.endsWith('.json') && !f.endsWith(SCHEMA_SUFFIX) && VERSIONED.test(f.slice(0, -'.json'.length)))
    .map((file) => {
      const stem = file.slice(0, -'.json'.length);
      const [, name, version] = VERSIONED.exec(stem);
      const row = readJson(dir, `predicates/${file}`);
      const schemaPath = `predicates/${stem}${SCHEMA_SUFFIX}`;
      const hasSchema = existsSync(join(dir, schemaPath));
      const typesPath = `predicates/${stem}.d.ts`;
      if (!existsSync(join(dir, typesPath))) fail(`predicates/${file} needs its type file ${typesPath}`);
      for (const key of ['status', 'owner', 'description']) if (row[key] === undefined) fail(`predicates/${file} has no ${key}`);
      return {
        stem,
        name,
        version: Number(version),
        predicateType: `${PREDICATE_BASE}/${name}/v${version}`,
        constant: `${upperSnake(name)}${version === '1' ? '' : `_V${version}`}_PREDICATE_TYPE`,
        status: row.status,
        owner: row.owner,
        schema: hasSchema ? schemaPath : null,
        description: row.description,
        types: typesPath,
      };
    })
    .sort((a, b) => (a.name === b.name ? a.version - b.version : a.name < b.name ? -1 : 1));
  // Every predicate schema, and registry.schema.json, which describes the generated registry.
  for (const file of files(dir, 'predicates').filter((f) => f.endsWith(SCHEMA_SUFFIX))) {
    schemas.push(schemaRecord(dir, 'predicates', file));
  }

  const types = files(dir, 'types').filter((f) => f.endsWith('.d.ts')).map((f) => f.slice(0, -'.d.ts'.length));

  schemas.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { schemas, holo, documents, families, predicates, types };
}

/** The generated `predicates/registry.json`, row for row what the old hand-edited file held. */
export function registryOf(found) {
  return {
    schema: 'prism/predicate-registry/1',
    predicates: found.predicates.map((p) => ({
      predicateType: p.predicateType,
      status: p.status,
      owner: p.owner,
      schema: p.schema,
      description: p.description,
    })),
  };
}
