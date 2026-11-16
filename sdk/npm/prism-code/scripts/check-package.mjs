// Validate npm's pack manifest against the reviewed distribution inventory.
// Run after npm pack --dry-run --json > pack.json, as npm-prism-code.yml does.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The cap is the sum of the reviewed allowances in scripts/package-allowances/, one file per
// change that grew the package: { "kib": n, "reason": "what the bytes are for (about x KiB)" }.
// A change that needs room adds its own file, so parallel changes never edit the same line.
const ALLOWANCES = new URL('./package-allowances/', import.meta.url);
export const PACKAGE_ALLOWANCES = readdirSync(ALLOWANCES).filter((name) => name.endsWith('.json')).sort()
  .map((name) => {
    const allowance = JSON.parse(readFileSync(new URL(name, ALLOWANCES), 'utf8'));
    assert.deepEqual(Object.keys(allowance).sort(), ['kib', 'reason'], `${name} holds exactly kib and reason`);
    assert.ok(Number.isInteger(allowance.kib) && allowance.kib > 0, `${name} grants a whole, positive number of KiB`);
    assert.ok(typeof allowance.reason === 'string' && allowance.reason.trim() !== '', `${name} says what the bytes are for`);
    return { name, ...allowance };
  });
export const PACKAGE_LIMIT = PACKAGE_ALLOWANCES.reduce((sum, { kib }) => sum + kib, 0) * 1024;
export const PACKAGE_FILES = JSON.parse(readFileSync(new URL('../test/fixtures/package-files.json', import.meta.url), 'utf8'));

export function checkPackage(pack) {
  assert.equal(pack.name, 'prism-code');
  assert.deepEqual(pack.files.map(({ path }) => path).sort(), PACKAGE_FILES,
    'Review distribution additions/removals explicitly in test/fixtures/package-files.json');
  assert.equal(pack.unpackedSize, pack.files.reduce((sum, { size }) => sum + size, 0),
    'npm unpackedSize must account for every distributed file');
  assert.ok(pack.unpackedSize <= PACKAGE_LIMIT,
    `Unpacked package is ${pack.unpackedSize} bytes; cap is ${PACKAGE_LIMIT}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [pack] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  checkPackage(pack);
  console.log(`${pack.files.length} required files, ${pack.unpackedSize}/${PACKAGE_LIMIT} unpacked bytes`);
}
