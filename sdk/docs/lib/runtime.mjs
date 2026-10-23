/**
 * prism-code as the generator sees it: the sibling package in this repository,
 * its type declarations, its version, the error codes its source raises and
 * the reference holo it ships as a fixture.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './spec.mjs';

export const PRISM_CODE_DIR = join(ROOT, 'sdk', 'npm', 'prism-code');
export const FIXTURE_DIR = join(PRISM_CODE_DIR, 'fixtures');
export const FIXTURE = join(FIXTURE_DIR, 'Calculator.holo');

/** Every `fail('<code>', ...)` call in the source, with the files that raise it. */
export function errorCodes(srcDir = join(PRISM_CODE_DIR, 'src')) {
  const codes = new Map();
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.mjs')).sort()) {
    const text = readFileSync(join(srcDir, file), 'utf8');
    for (const m of text.matchAll(/fail\('([a-z]+\.[a-z]+)'/g)) {
      if (!codes.has(m[1])) codes.set(m[1], new Set());
      codes.get(m[1]).add(file);
    }
  }
  return [...codes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, files]) => ({ code, files: [...files].sort() }));
}

export function prismCode() {
  const pkg = JSON.parse(readFileSync(join(PRISM_CODE_DIR, 'package.json'), 'utf8'));
  const types = readFileSync(join(PRISM_CODE_DIR, 'types', 'index.d.ts'), 'utf8').replace(/\r\n/g, '\n');
  const fixture = readFileSync(FIXTURE);
  const sha256 = createHash('sha256').update(fixture).digest('hex');
  return {
    name: pkg.name,
    version: pkg.version,
    types,
    errorCodes: errorCodes(),
    url: pathToFileURL(join(PRISM_CODE_DIR, 'src', 'index.mjs')).href,
    fixture: { path: FIXTURE, name: 'Calculator.holo', sha256, bytes: fixture.length },
    source: () => `${pkg.name} ${pkg.version}`,
    fixtureSource: () => `Calculator.holo sha256:${sha256}`,
  };
}
