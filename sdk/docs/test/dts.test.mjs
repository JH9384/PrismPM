import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaration, exportsOf, member } from '../lib/dts.mjs';

const dts = `/** A thing. */
export interface Thing {
  /** Its name. */
  name: string;
  run(input: Uint8Array,
      limits?: number): Promise<Uint8Array>;
  stop(): void;
}

export type Kind = 'a' | 'b';

/** Open it. */
export function open(source: string | URL, options?: {
  model?: string;
}): Promise<Thing>;

export declare const VERSION: 4;

export { helper } from './other.js';
`;

test('declaration returns the block without its comments', () => {
  assert.equal(declaration(dts, 'Thing'), 'export interface Thing {\n  name: string;\n  run(input: Uint8Array,\n      limits?: number): Promise<Uint8Array>;\n  stop(): void;\n}');
  assert.equal(declaration(dts, 'Kind'), "export type Kind = 'a' | 'b';");
  assert.equal(declaration(dts, 'VERSION'), 'export declare const VERSION: 4;');
  assert.throws(() => declaration(dts, 'Nothing'), /no declaration named Nothing/);
});

test('member returns one signature, across lines', () => {
  assert.equal(member(dts, 'Thing', 'run'), 'run(input: Uint8Array,\n      limits?: number): Promise<Uint8Array>;');
  assert.equal(member(dts, 'Thing', 'stop'), 'stop(): void;');
  assert.throws(() => member(dts, 'Thing', 'fly'), /no member fly/);
});

test('exportsOf lists every export with a one-line declaration', () => {
  assert.deepEqual(exportsOf(dts), [
    { name: 'Thing', kind: 'interface', line: 'Thing' },
    { name: 'Kind', kind: 'type', line: "Kind = 'a' | 'b'" },
    { name: 'open', kind: 'function', line: 'open(source: string | URL, options?: { model?: string; }): Promise<Thing>' },
    { name: 'VERSION', kind: 'const', line: 'VERSION: 4' },
    { name: 'helper', kind: 'export', line: 'from ./other.js' },
  ]);
});
