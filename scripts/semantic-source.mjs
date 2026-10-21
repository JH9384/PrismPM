// One reader and writer for the semantic module of a LexLean source, whichever
// surface the source uses. The SDK sources are language-1.2 notation, which has
// no `\semanticdata{...}` line to match; LexLean itself reads a notation module
// back to its data form, so every script that inspects or mutates declarations
// goes through `prismpm-semantic-source`, a thin wrapper over
// `lexlean::sdk::{read_module, write_module, to_notation}`.
//
// PRISMPM_SEMANTIC_SOURCE names a built binary; without it the tool is run
// through cargo from this repository.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');

function tool(command, input) {
  const explicit = process.env.PRISMPM_SEMANTIC_SOURCE;
  const [program, args] = explicit
    ? [explicit, [command]]
    : ['cargo', ['run', '--offline', '--locked', '--quiet', '-p', 'repo-conformance', '--bin', 'prismpm-semantic-source', '--', command]];
  return execFileSync(program, args, { cwd: repository, input, encoding: 'utf8', maxBuffer: 1 << 28 });
}

const text = source => (typeof source === 'string' ? source : Buffer.from(source).toString('utf8'));

// The module of `source` (string or bytes) as a JSON value.
export function readSemantic(source) {
  return JSON.parse(tool('read', text(source)));
}

// `source` with its module replaced by `value`, in the surface it already uses.
export function writeSemantic(source, value) {
  return tool('write', JSON.stringify({ source: text(source), value }));
}

// Data-form source text rewritten as language-1.2 notation.
export function toNotation(source) {
  return tool('to-notation', text(source));
}
