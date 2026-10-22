// Real SDK filesystem custody checks in a disposable root-owned container.
// These checks do not authenticate an image or qualify seed adoption.
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {immutablePath} from './exporter-seed-admission.mjs';

assert.equal(process.getuid(), 0, 'custody adversaries require a disposable root-owned container');
const trusted = mkdtempSync('/opt/prismpm-custody/fixture-');
const writable = mkdtempSync('/tmp/prismpm-custody-');
try {
  const file = join(trusted, 'file'); writeFileSync(file, 'custody fixture', {mode: 0o444});
  assert.equal(immutablePath(file), file);
  const direct = join(trusted, 'direct'); symlinkSync('file', direct);
  assert.equal(immutablePath(direct), file);
  const indirect = join(trusted, 'indirect'); symlinkSync('direct', indirect);
  assert.equal(immutablePath(indirect), file);
  const hidden = join(writable, 'intermediate'); symlinkSync(file, hidden);
  const alias = join(trusted, 'unsafe'); symlinkSync(hidden, alias);
  assert.equal(realpathSync(alias), file, 'both endpoints alone appear trusted');
  assert.throws(() => immutablePath(alias), /custody/, 'writable intermediate ancestry must be refused');
  chmodSync(file, 0o666); assert.throws(() => immutablePath(direct), /custody/); chmodSync(file, 0o444);
  symlinkSync('cycle-b', join(trusted, 'cycle-a')); symlinkSync('cycle-a', join(trusted, 'cycle-b'));
  assert.throws(() => immutablePath(join(trusted, 'cycle-a')), /cycle or depth/);
  process.stdout.write(JSON.stringify({scope: 'filesystem-custody-only', checks: 6, status: 'passed'}) + '\n');
} finally {
  rmSync(trusted, {recursive: true}); rmSync(writable, {recursive: true});
}
