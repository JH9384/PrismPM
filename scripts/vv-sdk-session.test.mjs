import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {sessionFixture} from './vv-sdk-session-fixture.mjs';

function run(t, options = {}, args = ['--with-sdk', 'bash', '-euo', 'pipefail', '-c', 'just vv\njust vv']) {
  const root = mkdtempSync(join(tmpdir(), 'prismpm-vv-session-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const env = sessionFixture(root, process.env, options);
  if (options.shellMutation) {
    const path = join(root, 'scripts/vv.sh'), original = readFileSync(path, 'utf8');
    const changed = options.shellMutation(original);
    assert.notEqual(changed, original, 'source mutation must alter the actual copied shell');
    writeFileSync(path, changed);
  }
  const result = spawnSync('bash', ['scripts/vv.sh', ...args], {cwd: root, env, input: options.input, encoding: 'utf8', timeout: 15_000});
  assert.ifError(result.error);
  const path = join(root, 'session.jsonl');
  return {...result, root, rows: existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse) : []};
}

for (const [first, second] of [[0, 0], [19, 0], [0, 23], [19, 23]]) {
  test(`one owned SDK session preserves both complete commands and failures ${first}/${second}`, t => {
    const result = run(t, {first, second});
    assert.equal(result.status, first || second, result.stderr);
    const builds = result.rows.filter(row => row.kind === 'build');
    assert.equal(builds.length, 1);
    const calls = result.rows.filter(row => row.kind === 'cargo');
    assert.equal(calls.length, first ? 1 : 2);
    for (const call of calls) assert.equal(call.image, `127.0.0.1:43567/prismpm-vv-sdk@sha256:${'b'.repeat(64)}`);
    const cleanup = result.rows.filter(row => row.kind === 'docker' && row.args[1] === 'rm');
    assert.equal(cleanup.length, 4);
    assert(result.rows.indexOf(cleanup[0]) > result.rows.indexOf(calls.at(-1)));
    const created = result.rows.find(row => row.kind === 'docker' && row.args.slice(0, 2).join(' ') === 'container create');
    const name = created.args[created.args.indexOf('--name') + 1];
    assert.deepEqual(cleanup[0].args, ['container', 'rm', '--force', 'd'.repeat(64)]);
    assert.deepEqual(cleanup[1].args, ['volume', 'rm', name.replace('prismpm-vv-registry-', 'prismpm-vv-registry-config-')]);
    assert.deepEqual(cleanup[2].args, ['image', 'rm', '127.0.0.1:43567/prismpm-vv-sdk:gate']);
    const tag = builds[0].args.at(-1);
    assert.match(tag, /^prismpm-vv-sdk:gate-[0-9]+-[0-9]+$/);
    assert.deepEqual(cleanup[3].args, ['image', 'rm', tag]);
  });
}
test('a supplied immutable SDK is inherited without creating or removing Docker resources', t => {
  const image = `ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:${'c'.repeat(64)}`;
  const result = run(t, {image});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.rows.filter(row => ['build', 'docker'].includes(row.kind)).length, 0);
  assert.deepEqual(result.rows.filter(row => row.kind === 'cargo').map(row => row.image), [image, image]);
});
for (const options of [{buildFailure: 31}, {registryFailure: 37}, {reference: 'invalid\n'},
  {reference: `127.0.0.1:43567/prismpm-vv-sdk@sha256:${'z'.repeat(64)}\n`}]) {
  test(`SDK preparation failure prohibits both verification commands: ${JSON.stringify(options)}`, t => {
    const result = run(t, options);
    assert.notEqual(result.status, 0);
    assert.equal(result.rows.filter(row => row.kind === 'cargo').length, 0);
    assert(result.rows.some(row => row.kind === 'docker' && row.args[0] === 'container' && row.args[1] === 'rm'));
  });
}
test('missing session command fails before acquisition or verification', t => {
  const result = run(t, {}, ['--with-sdk']);
  assert.equal(result.status, 64);
  assert.deepEqual(result.rows, []);
});
test('ordinary just-vv path retains one full run with the same owned cleanup', t => {
  const result = run(t, {}, []);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.rows.filter(row => row.kind === 'build').length, 1);
  assert.equal(result.rows.filter(row => row.kind === 'cargo').length, 1);
});
for (const first of [0, 29]) {
  test(`exact package-api preserves preflights, owning command and exit ${first} without SDK acquisition`, t => {
    const result = run(t, {first, expectedCargoArgs: ['xtask', 'package-api']}, ['package-api']);
    assert.equal(result.status, first, result.stderr);
    assert.deepEqual(result.rows.map(row => row.kind), ['init', 'bootstrap', 'cargo']);
    assert.deepEqual(result.rows[0].args, ['--test', 'scripts/devcontainer-init.test.mjs', 'scripts/reconcile-lexlean.test.mjs']);
    assert.deepEqual(result.rows[1].args, ['--check-source']);
    assert.deepEqual(result.rows[2].args, ['xtask', 'package-api']);
    assert.equal(result.rows[2].image, null);
  });
}
for (const args of [[], ['vv'], ['package-api', 'extra'], ['package-api', ''],
  ['PACKAGE-API'], ['Package-api'], [''], ['unknown']]) {
  test(`non-source-only arguments retain SDK preparation: ${JSON.stringify(args)}`, t => {
    const expectedCargoArgs = ['xtask', ...(args.length ? args : ['vv'])];
    const result = run(t, {expectedCargoArgs}, args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.rows.filter(row => row.kind === 'build').length, 1);
    const calls = result.rows.filter(row => row.kind === 'cargo');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, expectedCargoArgs);
    assert.equal(calls[0].image, `127.0.0.1:43567/prismpm-vv-sdk@sha256:${'b'.repeat(64)}`);
    assert(result.rows.indexOf(calls[0]) > result.rows.findIndex(row => row.kind === 'bootstrap'));
    assert(result.rows.some(row => row.kind === 'docker' && row.args.slice(0, 2).join(' ') === 'container rm'));
  });
}
test('--with-sdk package-api retains its explicit owned SDK session', t => {
  const result = run(t, {expectedCargoArgs: ['xtask', 'package-api']},
    ['--with-sdk', 'cargo', 'xtask', 'package-api']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.rows.filter(row => row.kind === 'build').length, 1);
  assert.equal(result.rows.find(row => row.kind === 'cargo').image,
    `127.0.0.1:43567/prismpm-vv-sdk@sha256:${'b'.repeat(64)}`);
});
for (const [options, expectedKinds, status] of [
  [{initFailure: 31}, ['init'], 31],
  [{bootstrapFailure: 37}, ['init', 'bootstrap'], 37],
]) {
  test(`package-api cannot bypass a failed preflight: ${JSON.stringify(options)}`, t => {
    const result = run(t, options, ['package-api']);
    assert.equal(result.status, status, result.stderr);
    assert.deepEqual(result.rows.map(row => row.kind), expectedKinds);
  });
}
test('exact package-api preserves an independently supplied immutable SDK reference', t => {
  const image = `ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:${'c'.repeat(64)}`;
  const result = run(t, {image, expectedCargoArgs: ['xtask', 'package-api']}, ['package-api']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.rows.map(row => row.kind), ['init', 'bootstrap', 'cargo']);
  assert.equal(result.rows[2].image, image);
});
for (const category of ['holo-stdlib', 'desktop-browser']) {
  const args = ['conformance', category];
  for (const first of [0, 29]) {
    test(`exact source-only conformance ${category} preserves both preflights and owning exit ${first}`, t => {
      const result = run(t, {first, expectedCargoArgs: ['xtask', ...args]}, args);
      assert.equal(result.status, first, result.stderr);
      assert.deepEqual(result.rows.map(row => row.kind), ['init', 'bootstrap', 'cargo']);
      assert.deepEqual(result.rows[0].args, ['--test', 'scripts/devcontainer-init.test.mjs', 'scripts/reconcile-lexlean.test.mjs']);
      assert.deepEqual(result.rows[1].args, ['--check-source']);
      assert.deepEqual(result.rows[2].args, ['xtask', ...args]);
      assert.equal(result.rows[2].image, null);
    });
  }
  for (const [options, expectedKinds, status] of [
    [{initFailure: 31}, ['init'], 31],
    [{bootstrapFailure: 37}, ['init', 'bootstrap'], 37],
  ]) {
    test(`source-only conformance ${category} cannot bypass failed preflight ${status}`, t => {
      const result = run(t, options, args);
      assert.equal(result.status, status, result.stderr);
      assert.deepEqual(result.rows.map(row => row.kind), expectedKinds);
    });
  }
  test(`source-only conformance ${category} preserves a supplied immutable SDK reference`, t => {
    const image = `ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:${'c'.repeat(64)}`;
    const result = run(t, {image, expectedCargoArgs: ['xtask', ...args]}, args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.rows.map(row => row.kind), ['init', 'bootstrap', 'cargo']);
    assert.deepEqual(result.rows[2].args, ['xtask', ...args]);
    assert.equal(result.rows[2].image, image);
  });
  test(`explicit --with-sdk conformance ${category} retains its owned runtime image`, t => {
    const result = run(t, {expectedCargoArgs: ['xtask', ...args]}, ['--with-sdk', 'cargo', 'xtask', ...args]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.rows.filter(row => row.kind === 'build').length, 1);
    const calls = result.rows.filter(row => row.kind === 'cargo');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ['xtask', ...args]);
    assert.equal(calls[0].image, `127.0.0.1:43567/prismpm-vv-sdk@sha256:${'b'.repeat(64)}`);
    assert(result.rows.some(row => row.kind === 'docker' && row.args.slice(0, 2).join(' ') === 'container rm'));
  });
}
for (const args of [
  ['conformance'], ['conformance', 'all'], ['conformance', 'contracts'],
  ['conformance', 'core'], ['conformance', 'system-oci'], ['conformance', 'verification-schemas'],
  ['conformance', 'holo-stdlib', '--nocapture'], ['conformance', 'desktop-browser', 'extra'],
  ['conformance', 'holo-stdlib', ''], ['conformance', 'desktop-browser', ''],
  ['Conformance', 'holo-stdlib'], ['CONFORMANCE', 'desktop-browser'],
  ['conformance', 'HOLO-STDLIB'], ['conformance', 'Desktop-browser'],
  ['conformance', 'holo-stdlib '], ['conformance', 'desktop-browser\n'],
  ['conformance', 'conformance_ho'], ['conformance', 'conformance_dk'],
  ['conformance', 'desktop-browser,holo-stdlib'], ['conformance', ''],
  ['holo-stdlib'], ['desktop-browser'], ['other', 'holo-stdlib'], ['other', 'desktop-browser'],
]) {
  test(`non-exact conformance argv retains runtime SDK acquisition: ${JSON.stringify(args)}`, t => {
    const expectedCargoArgs = ['xtask', ...args];
    const result = run(t, {expectedCargoArgs}, args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.rows.filter(row => row.kind === 'build').length, 1);
    const calls = result.rows.filter(row => row.kind === 'cargo');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, expectedCargoArgs);
    assert.equal(calls[0].image, `127.0.0.1:43567/prismpm-vv-sdk@sha256:${'b'.repeat(64)}`);
    assert(result.rows.indexOf(calls[0]) > result.rows.findIndex(row => row.kind === 'bootstrap'));
    assert(result.rows.some(row => row.kind === 'docker' && row.args.slice(0, 2).join(' ') === 'container rm'));
  });
}
const exactCategory = '{ test "${2:-}" = holo-stdlib || test "${2:-}" = desktop-browser; }';
for (const [name, from, to, args] of [
  ['arity guard', 'test "$#" -eq 2 && ', '', ['conformance', 'holo-stdlib', 'extra']],
  ['command guard', 'test "${1:-}" = conformance &&', 'true &&', ['other', 'desktop-browser']],
  ['closed category guard', exactCategory, 'true', ['conformance', 'system-oci']],
  ['unreviewed category addition', exactCategory, '{ test "${2:-}" = core || ' + exactCategory.slice(2), ['conformance', 'core']],
]) {
  test(`actual shell mutant without ${name} is rejected by SDK-acquisition witness`, t => {
    const result = run(t, {expectedCargoArgs: ['xtask', ...args], shellMutation: source => {
      assert.equal(source.split(from).length, 2, 'one exact source guard');
      return source.replace(from, to);
    }}, args);
    assert.equal(result.status, 0, result.stderr);
    const calls = result.rows.filter(row => row.kind === 'cargo');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ['xtask', ...args]);
    assert.equal(calls[0].image, null, 'mutant reached the real shell dispatch without image acquisition');
    assert.throws(() => assert.equal(result.rows.filter(row => row.kind === 'build').length, 1,
      'required SDK image acquisition'), /required SDK image acquisition/);
  });
}
for (const [name, line, expectedKinds] of [
  ['initial source preflight', 'node --test scripts/devcontainer-init.test.mjs scripts/reconcile-lexlean.test.mjs\n', ['bootstrap', 'cargo']],
  ['bootstrap source preflight', 'bash scripts/bootstrap-verify.sh --check-source\n', ['init', 'cargo']],
]) {
  test(`actual shell mutant omitting ${name} is rejected by ordered preflight witness`, t => {
    const args = ['conformance', 'holo-stdlib'];
    const result = run(t, {expectedCargoArgs: ['xtask', ...args], shellMutation: source => {
      assert.equal(source.split(line).length, 2, 'one exact source preflight');
      return source.replace(line, '');
    }}, args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.rows.map(row => row.kind), expectedKinds);
    assert.deepEqual(result.rows.at(-1).args, ['xtask', ...args]);
    assert.throws(() => assert.deepEqual(result.rows.map(row => row.kind), ['init', 'bootstrap', 'cargo'],
      'both ordered source preflights'), /both ordered source preflights/);
  });
}
for (const options of [{volumeConflict: true}, {containerConflict: true}, {tagConflict: true}]) {
  test(`foreign resource conflicts never delete the conflicting resource: ${JSON.stringify(options)}`, t => {
    const result = run(t, options);
    assert.notEqual(result.status, 0);
    assert.equal(result.rows.filter(row => row.kind === 'cargo').length, 0);
    const cleanup = result.rows.filter(row => row.kind === 'docker' && row.args[1] === 'rm');
    if (options.volumeConflict) assert.deepEqual(cleanup, []);
    if (options.containerConflict) assert.deepEqual(cleanup.map(row => row.args[0]), ['volume']);
    if (options.tagConflict) assert.deepEqual(cleanup.map(row => row.args[0]), ['container', 'volume']);
  });
}
test('changed image identities are reported without deleting replacement tags', t => {
  const result = run(t, {tagReplacement: true});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /identity changed; refusing removal/);
  assert.equal(result.rows.filter(row => row.kind === 'docker' && row.args.slice(0, 2).join(' ') === 'image rm').length, 0);
});
for (const first of [0, 19]) {
  test(`cleanup failures are visible while preserving the verification exit ${first}`, t => {
    const result = run(t, {first, cleanupFailure: true});
    assert.equal(result.status, first || 1);
    assert.match(result.stderr, /SDK session cleanup failed/);
  });
}
test('lost create response reconciles only the exact labeled container and preserves failure', t => {
  const result = run(t, {containerLostResponse: true});
  assert.equal(result.status, 47);
  assert.equal(readFileSync(join(result.root, 'created-container'), 'utf8'), 'owned');
  const cleanup = result.rows.filter(row => row.kind === 'docker' && row.args[1] === 'rm');
  assert.deepEqual(cleanup.map(row => row.args[0]), ['container', 'volume']);
  assert.equal(cleanup[0].args.at(-1), 'd'.repeat(64));
  assert.equal(result.rows.filter(row => row.kind === 'cargo').length, 0);
});
test('failed build after load reports uncertain retained tag without unsafe removal', t => {
  const result = run(t, {buildFailureAfterLoad: true});
  assert.equal(result.status, 43);
  const tag = readFileSync(join(result.root, 'loaded-tag'), 'utf8');
  assert(result.stderr.includes(`inspect possibly retained tag: ${tag}`));
  assert.equal(result.rows.filter(row => row.kind === 'docker' && row.args.slice(0, 2).join(' ') === 'image rm').length, 0);
  assert.equal(result.rows.filter(row => row.kind === 'cargo').length, 0);
});
test('lost volume-create response reconciles the label without running verification', t => {
  const result = run(t, {volumeLostResponse: true});
  assert.equal(result.status, 51);
  const cleanup = result.rows.filter(row => row.kind === 'docker' && row.args[1] === 'rm');
  assert.deepEqual(cleanup.map(row => row.args[0]), ['volume']);
  assert.equal(result.rows.filter(row => row.kind === 'cargo').length, 0);
});
test('lost image-tag response reconciles the loaded image identity without running verification', t => {
  const result = run(t, {tagLostResponse: true});
  assert.equal(result.status, 53);
  const tag = readFileSync(join(result.root, 'tagged-image'), 'utf8');
  const cleanup = result.rows.filter(row => row.kind === 'docker' && row.args[1] === 'rm');
  assert.deepEqual(cleanup.map(row => row.args[0]), ['container', 'volume', 'image', 'image']);
  assert.equal(cleanup[2].args.at(-1), tag);
  assert.equal(result.rows.filter(row => row.kind === 'cargo').length, 0);
});
test('preparation cannot consume the two-run command here-document', t => {
  const result = run(t, {readDuringPreparation: true, input: 'just vv\njust vv\n'},
    ['--with-sdk', 'bash', '-euo', 'pipefail', '-c', 'exec bash -euo pipefail -c "$(cat)"']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.rows.filter(row => row.kind === 'cargo').length, 2);
  assert.equal(readFileSync(join(result.root, 'preparation-stdin')).length, 0);
});
test('session command receives its original binary stdin untouched', t => {
  const input = Buffer.from([0, 10, 255, 65]);
  const result = run(t, {readDuringPreparation: true, input},
    ['--with-sdk', 'node', '-e', 'process.stdout.write(require("node:fs").readFileSync(0).toString("hex"))']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input.toString('hex'));
  assert.equal(readFileSync(join(result.root, 'preparation-stdin')).length, 0);
});

for (const category of ['holo-stdlib', 'desktop-browser']) {
  const args = ['conformance', category];
  const expectedCargoArgs = ['xtask', ...args];
  for (const first of [0, 29]) {
    test(`exact source-only ${category} preserves both preflights and cargo exit ${first}`, t => {
      const result = run(t, {first, expectedCargoArgs}, args);
      assert.equal(result.status, first, result.stderr);
      assert.deepEqual(result.rows.map(row => row.kind), ['init', 'bootstrap', 'cargo']);
      assert.deepEqual(result.rows[0].args, ['--test', 'scripts/devcontainer-init.test.mjs', 'scripts/reconcile-lexlean.test.mjs']);
      assert.deepEqual(result.rows[1].args, ['--check-source']);
      assert.deepEqual(result.rows[2].args, expectedCargoArgs);
      assert.equal(result.rows[2].image, null);
    });
  }
  for (const [options, expectedKinds, status] of [
    [{initFailure: 31}, ['init'], 31],
    [{bootstrapFailure: 37}, ['init', 'bootstrap'], 37],
  ]) {
    test(`source-only ${category} cannot bypass failed preflight ${status}`, t => {
      const result = run(t, {...options, expectedCargoArgs}, args);
      assert.equal(result.status, status, result.stderr);
      assert.deepEqual(result.rows.map(row => row.kind), expectedKinds);
    });
  }
  test(`source-only ${category} preserves a supplied immutable image without Docker changes`, t => {
    const image = `ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:${'c'.repeat(64)}`;
    const result = run(t, {image, expectedCargoArgs}, args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.rows.map(row => row.kind), ['init', 'bootstrap', 'cargo']);
    assert.deepEqual(result.rows[2].args, expectedCargoArgs);
    assert.equal(result.rows[2].image, image);
  });
  test(`explicit --with-sdk ${category} still creates its owned immutable SDK session`, t => {
    const result = run(t, {expectedCargoArgs}, ['--with-sdk', 'cargo', ...expectedCargoArgs]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.rows.filter(row => row.kind === 'build').length, 1);
    const call = result.rows.find(row => row.kind === 'cargo');
    assert.deepEqual(call.args, expectedCargoArgs);
    assert.equal(call.image, `127.0.0.1:43567/prismpm-vv-sdk@sha256:${'b'.repeat(64)}`);
  });
}

for (const args of [
  ['conformance'], ['conformance', 'all'], ['conformance', 'contracts'],
  ['conformance', 'core'], ['conformance', 'system-oci'],
  ['conformance', 'verification-schemas'], ['CONFORMANCE', 'holo-stdlib'],
  ['conformance', 'Holo-stdlib'], ['conformance', 'Desktop-browser'],
  ['conformance', 'holo-stdlib', 'extra'], ['conformance', 'holo-stdlib', ''],
  ['conformance', 'desktop-browser', 'extra'], ['conformance', 'desktop-browser', ''],
]) {
  test(`image-consuming or nonexact category arguments retain acquisition: ${JSON.stringify(args)}`, t => {
    const expectedCargoArgs = ['xtask', ...args];
    const result = run(t, {expectedCargoArgs}, args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.rows.filter(row => row.kind === 'build').length, 1);
    const calls = result.rows.filter(row => row.kind === 'cargo');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, expectedCargoArgs);
    assert.equal(calls[0].image, `127.0.0.1:43567/prismpm-vv-sdk@sha256:${'b'.repeat(64)}`);
    assert(result.rows.indexOf(calls[0]) > result.rows.findIndex(row => row.kind === 'bootstrap'));
  });
}
