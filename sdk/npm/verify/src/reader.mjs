/**
 * The structural layer of a `.holo`: header, section table, footer position.
 * It never throws on bad bytes. Each step becomes a check, and the first
 * failure stops the walk, because nothing after a broken table can be located.
 *
 * Same layout as `parseArchive` in sdk/npm/prism-code/src/archive.mjs, written
 * against the @prism-code/spec constants; test/agreement.test.mjs compares the
 * two on the reference archive. Unlike that reader, an unknown section kind is
 * not an error here: the table still locates it, and the format check reports
 * it.
 */
import { MAGIC, PHYSICAL_VERSION, FLAGS, HEADER_LENGTH, TABLE_ENTRY_LENGTH, FOOTER_LENGTH } from './vendor/spec.mjs';

function u64(view, offset) {
  const value = view.getBigUint64(offset, true);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

/**
 * @returns {{ checks: { id: string, status: 'pass' | 'fail', detail: string }[],
 *   ok: boolean, sections: { index: number, kind: number, offset: number, length: number }[],
 *   bodyEnd: number }}
 */
export function readStructure(bytes) {
  const checks = [];
  const result = { checks, ok: false, sections: [], bodyEnd: Math.max(0, bytes.length - FOOTER_LENGTH) };
  const pass = (id, detail) => checks.push({ id, status: 'pass', detail });
  const fail = (id, detail) => {
    checks.push({ id, status: 'fail', detail });
    return result;
  };

  if (bytes.length < 4) return fail('archive.magic', `the input is ${bytes.length} bytes, too short for the ${MAGIC} magic`);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC) return fail('archive.magic', `expected magic ${MAGIC}, found ${JSON.stringify(magic)}`);
  pass('archive.magic', `magic ${MAGIC}`);

  if (bytes.length < HEADER_LENGTH + FOOTER_LENGTH) {
    return fail('archive.version', `the archive is ${bytes.length} bytes, shorter than its header and footer`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== PHYSICAL_VERSION) return fail('archive.version', `expected physical version ${PHYSICAL_VERSION}, found ${version}`);
  pass('archive.version', `physical version ${version}`);

  const flags = view.getUint16(6, true);
  if (flags !== FLAGS) return fail('archive.flags', `expected flags ${FLAGS}, found ${flags}`);
  pass('archive.flags', `flags ${flags}`);

  const count = view.getUint16(8, true);
  const tableEnd = HEADER_LENGTH + count * TABLE_ENTRY_LENGTH;
  const bodyEnd = bytes.length - FOOTER_LENGTH;
  if (tableEnd > bodyEnd) return fail('archive.table', `a table of ${count} sections needs ${tableEnd} bytes; the body has ${bodyEnd}`);
  let cursor = tableEnd;
  for (let i = 0; i < count; i++) {
    const at = HEADER_LENGTH + i * TABLE_ENTRY_LENGTH;
    const kind = u64(view, at);
    const offset = u64(view, at + 8);
    const length = u64(view, at + 16);
    if (kind === null || offset === null || length === null) return fail('archive.table', `section ${i} has a field above 2^53`);
    if (offset !== cursor) return fail('archive.table', `section ${i} starts at ${offset}, expected ${cursor}`);
    if (offset + length > bodyEnd) return fail('archive.table', `section ${i} ends at ${offset + length}, past the body end ${bodyEnd}: the archive is truncated`);
    result.sections.push({ index: i, kind, offset, length });
    cursor = offset + length;
  }
  if (cursor !== bodyEnd) {
    return fail('archive.table', `the sections end at ${cursor} but the footer starts at ${bodyEnd}: the archive is truncated or padded`);
  }
  pass('archive.table', `${count} sections, contiguous, ending at the footer`);
  result.ok = true;
  return result;
}
