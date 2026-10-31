/**
 * The reference archive, decoded by prism-code's own reader. The parser is
 * imported from sdk/npm/prism-code, never copied, so a disagreement between
 * the reader and these schemas fails a test.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArchive, resolveArchive } from '../../prism-code/src/archive.mjs';

export const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
export const readJson = (relative) => JSON.parse(readFileSync(here(relative), 'utf8'));
export const schema = (packagePath) => readJson(`../${packagePath}`);

/**
 * calculator-example `artifacts/Calculator.holo` at commit
 * 5051dc6adb18e9ca2b6ae4ca7090e638329831ef. PrismPM's prism-code fixture is
 * the same file.
 */
export const REFERENCE_ARCHIVE = '../../prism-code/fixtures/Calculator.holo';

/** Every reference archive (#278), by name: the Calculator and the Payment Approval text application. */
export const REFERENCE_ARCHIVES = Object.freeze({
  Calculator: REFERENCE_ARCHIVE,
  PaymentApproval: '../../prism-code/fixtures/PaymentApproval.holo',
});
export const REFERENCE_SHA256 = '84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7';

const hex = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true });

export function loadReference(path = REFERENCE_ARCHIVE) {
  const bytes = readFileSync(here(path));
  const parsed = parseArchive(bytes);
  const resolved = resolveArchive(parsed);
  const extension = (name) => JSON.parse(parsed.extensions.find((e) => e.name === name).text);
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    parsed,
    resolved,
    /** Shaped as schemas/holo/archive.schema.json. */
    archive: {
      magic: utf8.decode(bytes.subarray(0, 4)),
      version: parsed.version,
      flags: parsed.flags,
      sections: parsed.sections.map(({ kind, offset, length }) => ({ kind, offset, length })),
      footer: parsed.footer,
    },
    /** Shaped as schemas/holo/app-manifest.schema.json. */
    appManifest: { uri: parsed.manifest.uri, labels: parsed.manifest.labels, suffix: hex(parsed.manifest.suffix) },
    sourceManifest: JSON.parse(parsed.metadata.text),
    directory: extension('https://hologram.foundation/extension/application-directory/v1'),
    provenance: extension('https://uor.foundation/extension/prismpm-model/v1'),
    modelDocument: resolved.modelDocument,
    capabilitySetHex: hex(resolved.capabilities.content),
    guest: resolved.guest.content,
  };
}

/** Exported functions of a core wasm module with their parameter and result types, read from its binary. */
export function wasmExports(bytes) {
  const VALTYPE = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64' };
  let at = 8;
  const leb = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[at++];
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
    }
  };
  const name = () => {
    const length = leb();
    const text = utf8.decode(bytes.subarray(at, at + length));
    at += length;
    return text;
  };
  const types = [];
  const functions = [];
  const exports = [];
  while (at < bytes.length) {
    const id = bytes[at++];
    const size = leb();
    const end = at + size;
    if (id === 1) {
      for (let n = leb(); n > 0; n--) {
        at++; // 0x60
        const params = Array.from({ length: leb() }, () => VALTYPE[bytes[at++]]);
        const results = Array.from({ length: leb() }, () => VALTYPE[bytes[at++]]);
        types.push({ params, results });
      }
    } else if (id === 2) {
      throw new Error('the Core-Wasm contract allows no imports');
    } else if (id === 3) {
      for (let n = leb(); n > 0; n--) functions.push(leb());
    } else if (id === 7) {
      for (let n = leb(); n > 0; n--) {
        const exportName = name();
        const kind = bytes[at++];
        const index = leb();
        exports.push({ name: exportName, kind: ['func', 'table', 'memory', 'global'][kind], index });
      }
    }
    at = end;
  }
  return exports.map((e) =>
    e.kind === 'func' ? { name: e.name, kind: e.kind, ...types[functions[e.index]] } : { name: e.name, kind: e.kind },
  );
}
