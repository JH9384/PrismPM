import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {directory} from './corpus.mjs';
import {rustCorpus} from './rust-corpus.mjs';
import {consumerEnvironment, verifyConsumerOutput} from './package.mjs';
const index = JSON.parse(readFileSync(new URL('lease-corpus.json', directory), 'utf8'));
const source = rustCorpus(index);

test('actual consumer environment cannot inherit compiler wrappers, features, flags, cache or toolchain overrides', () => {
  const env = consumerEnvironment({PATH: '/trusted', RUSTUP_HOME: '/rustup', CARGO_HOME: '/foreign',
    CARGO_TARGET_DIR: '/foreign-target', RUSTUP_TOOLCHAIN: 'other', RUSTC: '/foreign-rustc',
    RUSTC_WRAPPER: '/wrapper', RUSTC_WORKSPACE_WRAPPER: '/wrapper', RUSTFLAGS: '--cfg feature="std"',
    CARGO_ENCODED_RUSTFLAGS: '--cfg feature="std"', CARGO_BUILD_TARGET: 'other',
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS: '--cfg feature="std"',
    HOME: '/foreign-home', LD_PRELOAD: '/injected', LD_AUDIT: '/injected',
    LD_LIBRARY_PATH: '/foreign-lib', RUSTC_BOOTSTRAP: '1'}, '/private', '1.97.1');
  assert.deepEqual(env, {PATH: '/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin',
    RUSTUP_HOME: '/usr/local/rustup', HOME: '/private', LANG: 'C.UTF-8', CARGO_HOME: '/private/cargo',
    CARGO_TARGET_DIR: '/private/target', CARGO_NET_OFFLINE: 'true', CARGO_TERM_COLOR: 'never', RUSTUP_TOOLCHAIN: '1.97.1'});
  for (const override of [{CARGO_PROFILE_DEV_DEBUG: '0'}, {CARGO_INCREMENTAL: '0'}]) {
    assert.throws(() => consumerEnvironment(override, '/private', '1.97.1'));
  }
});

test('consumer report parser refuses missing, duplicate, filtered and failed executed cases', () => {
  // Parser fixture only: actual acceptance executes Cargo against captured bytes.
  const names = ['all_nine_generated_signatures', ...index.cases.map(row => `case_${row.name}`)];
  const output = names.map(name => `test ${name} ... ok`).join('\n')
    + '\ntest result: ok. 94 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n';
  verifyConsumerOutput(output, index);
  for (const changed of [
    output.replace(`test ${names[0]} ... ok\n`, ''),
    output.replace(names[1], names[0]),
    output.replace('0 filtered out', '1 filtered out'),
    output.replace('94 passed; 0 failed', '93 passed; 1 failed'),
    output + 'test result: ok. 94 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n',
  ]) assert.throws(() => verifyConsumerOutput(changed, index));
});

test('Rust consumer retains every explicit case and all nine actual generated ABI shapes', () => {
  assert.equal(source.match(/#\[test\]/g).length, 94);
  assert.equal(source.match(/let _: fn\(/g).length, 9);
  assert.equal(source.match(/fn case_/g).length, 93);
  for (const row of index.cases) assert(source.includes(`fn case_${row.name}()`));
  assert(source.includes('Result<Result<NativeLane, NativeLeaseError>, ComputeError>'));
  assert(source.includes('fn(&NativeLeaseBinding, &NativeLeaseBinding) -> bool'));
  assert(source.includes('18446744073709551615u64'));
});

test('changed explicit expected state, error or arguments change Rust acceptance, not model semantics', () => {
  for (const mutate of [
    value => { value.cases[0].expected.state.nextOperation = '1'; },
    value => { value.cases[1].expected.error = 'Busy'; },
    value => { value.cases[0].args[0] = 'ff'.repeat(32); },
  ]) {
    const changed = structuredClone(index); mutate(changed);
    assert.notEqual(rustCorpus(changed), source);
  }
});

test('Rust serializer rejects omissions, duplicates, unknown methods and out-of-range native numbers', () => {
  for (const mutate of [
    value => { value.cases.pop(); },
    value => { value.cases[1] = value.cases[0]; },
    value => { value.cases[0].method = 'callerCleanup'; },
    value => { value.cases[0].expected.state.observed = '18446744073709551616'; },
  ]) {
    const changed = structuredClone(index); mutate(changed);
    assert.throws(() => rustCorpus(changed));
  }
});
