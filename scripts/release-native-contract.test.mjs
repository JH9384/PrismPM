// Fast source-contract regression tests, not native or SDK acceptance evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {canonical, hash} from './sdk-bootstrap-retention.mjs';
import {nativeInvocations, releaseContext, validateNative} from './release-gate-evidence.mjs';

const manifest = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');
const version = manifest.match(/\[workspace\.package\][\s\S]*?^version = "([^"]+)"/m)?.[1];
assert(version, 'workspace release version must be present');
const errors = readFileSync(new URL('../model/errors.toml', import.meta.url), 'utf8');
const diagnostic = errors.split('[[error]]').find(section => /^code = "PP6101"$/m.test(section));
const exit = Number(diagnostic?.match(/^exit = (\d+)$/m)?.[1]);
assert(Number.isInteger(exit), 'registered PP6101 exit class must be present');
const image = `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'b'.repeat(64)}`;
const describe = (path, bytes) => ({path, byte_length: bytes.length, sha256: hash(bytes)});

for (const [architecture, target] of [['amd64', 'x86_64'], ['arm64', 'aarch64']]) {
  const invocations = nativeInvocations('/unit-only/source', image, architecture, 1000, 1000);
  test(`${architecture}: mutable-reference smoke expectations use registered PP6101 exit`, () => {
    assert.equal(invocations.length, 4);
    for (const [prefix, args, status] of invocations) {
      assert.equal(status, prefix.endsWith('-error') ? exit : 0);
      if (prefix.endsWith('-error')) assert.equal(args.at(-1), 'ghcr.io/uor-foundation/calculator:mutable');
    }
  });
  test(`${architecture}: native evidence accepts the workspace release archive version`, () => {
    const context = releaseContext('a'.repeat(40), architecture, image, '123', '1');
    const files = new Map();
    for (const [prefix, args, status] of invocations) {
      const stdout = Buffer.from('unit-only output\n'), stderr = Buffer.alloc(0);
      files.set(`${prefix}.stdout`, stdout); files.set(`${prefix}.stderr`, stderr);
      files.set(`${prefix}.json`, Buffer.from(canonical({command: 'docker', arguments: args, status,
        signal: null, descendants_reaped: true, capture_failed: false, orphaned: false, overflow: false,
        interrupted: null, stdout: describe(`${prefix}.stdout`, stdout), stderr: describe(`${prefix}.stderr`, stderr)})));
    }
    files.set('native-result.json', Buffer.from(canonical({schema: 'prismpm/native-equivalence-retention/1',
      scope: 'original-native-sdk-comparison-only', ...context, root: '/unit-only/source', uid: 1000, gid: 1000,
      archive: describe(`prismpm-${version}-${target}-unknown-linux-gnu.tar.gz`, Buffer.from('unit-only archive'))})));
    validateNative(files, context);
  });
}
