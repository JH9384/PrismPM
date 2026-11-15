// Publication against a model of the GitHub REST API that answers with the
// statuses the live API gives (release-publication.mjs probe TAG reads them):
// a draft is absent from releases/tags/{tag}, a missing tag is a 404 of
// git/ref/tags/{tag} and a 422 of commits/{tag}. The client under test parses
// the same `gh api --include` output it parses in a release run.
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {assetNames, publicationNotes, workspaceVersion} from './release-phases.mjs';
import {apiWith, githubClient, publicationTag, publishOci, releaseByTag, tagCommit} from './release-publication.mjs';

const repository = 'UOR-Foundation/prismpm';
const revision = 'a'.repeat(40);
// Publication runs at the version tag: the factory's cut dispatches it there.
const version = workspaceVersion();
const environment = (change = {}) => ({GITHUB_REPOSITORY: repository, GITHUB_REF: `refs/tags/v${version}`,
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: revision, DISPATCH_VERSION: version, PUBLISH_CRATES: 'false', REHEARSAL: 'false',
  GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123456789', GITHUB_RUN_ATTEMPT: '1', ...change});
const firstTag = `sdk-oci-${revision}-123456789-1`;
const reasons = {200: 'OK', 404: 'Not Found', 422: 'Unprocessable Entity', 500: 'Internal Server Error'};

function github({unrelated = 0} = {}) {
  // Newest first, as GitHub lists them; unrelated releases fill earlier pages.
  const releases = Array.from({length: unrelated}, (_, index) => ({tag_name: `v0.0.${index}`, target_commitish: 'b'.repeat(40),
    draft: false, prerelease: false, body: '', assets: [], bytes: new Map()}));
  const refs = new Map(), tagObjects = new Map(), requests = [], writes = [];
  const respond = (status, body) => ({status: status === 200 ? 0 : 1, stderr: status === 200 ? '' : `gh: HTTP ${status}`,
    stdout: `HTTP/2.0 ${status} ${reasons[status]}\r\nContent-Type: application/json; charset=utf-8\r\nX-Github-Request-Id: 0\r\n\r\n${JSON.stringify(body)}`});
  const view = ({bytes, ...release}) => structuredClone(release);
  const find = tag => releases.find(release => release.tag_name === tag);
  const prefix = `repos/${repository}/`;
  const api = path => {
    requests.push(path);
    assert.ok(path.startsWith(prefix), path);
    const rest = path.slice(prefix.length);
    let match;
    if ((match = rest.match(/^releases\/tags\/([^/?]+)$/))) {
      const release = find(match[1]);
      return release && !release.draft ? respond(200, view(release)) : respond(404, {message: 'Not Found'});
    }
    if ((match = rest.match(/^releases\?per_page=(\d+)&page=(\d+)$/))) {
      const size = Number(match[1]), page = Number(match[2]);
      return respond(200, releases.slice((page - 1) * size, page * size).map(view));
    }
    if ((match = rest.match(/^git\/ref\/tags\/([^/?]+)$/))) {
      const object = refs.get(match[1]);
      return object ? respond(200, {ref: `refs/tags/${match[1]}`, object}) : respond(404, {message: 'Not Found'});
    }
    if ((match = rest.match(/^git\/tags\/([0-9a-f]{40})$/))) {
      const object = tagObjects.get(match[1]);
      return object ? respond(200, {sha: match[1], object}) : respond(404, {message: 'Not Found'});
    }
    if ((match = rest.match(/^commits\/([^/?]+)$/))) {
      let object = refs.get(match[1]);
      while (object?.type === 'tag') object = tagObjects.get(object.sha);
      return object ? respond(200, {sha: object.sha}) : respond(422, {message: `No commit found for SHA: ${match[1]}`});
    }
    return respond(404, {message: 'Not Found'});
  };
  const release = args => {
    const [, operation, tag] = args;
    assert.equal(args[args.indexOf('--repo') + 1], repository);
    assert.ok(!args.includes('--clobber'), 'publication never overwrites');
    if (operation !== 'download') writes.push(args);
    const existing = find(tag);
    if (operation === 'create') {
      assert.equal(existing, undefined, 'a release tag is created once');
      assert.ok(args.includes('--draft') && args.includes('--prerelease'));
      releases.unshift({tag_name: tag, target_commitish: args[args.indexOf('--target') + 1], draft: true, prerelease: true,
        body: args[args.indexOf('--notes') + 1], assets: [], bytes: new Map()});
    } else if (operation === 'upload') {
      assert.ok(existing);
      for (const path of args.slice(5)) {
        const name = path.split('/').at(-1), bytes = readFileSync(path);
        assert.ok(!existing.bytes.has(name), 'an uploaded asset is never replaced');
        existing.bytes.set(name, bytes); existing.assets.push({name, size: bytes.length});
      }
    } else if (operation === 'download') {
      if (!existing) return {status: 1, stdout: '', stderr: 'release not found'};
      const target = args[args.indexOf('--dir') + 1];
      for (const [name, bytes] of existing.bytes) writeFileSync(join(target, name), bytes);
    } else if (operation === 'edit') {
      assert.deepEqual(args.slice(-1), ['--draft=false']);
      existing.draft = false;
      // Publication creates the lightweight tag at the target.
      if (!refs.has(tag)) refs.set(tag, {type: 'commit', sha: existing.target_commitish});
    } else assert.fail(`unexpected release operation ${operation}`);
    return {status: 0, stdout: '', stderr: ''};
  };
  const runner = args => args[0] === 'api' ? (assert.equal(args[1], '--include'), api(args[2])) : release(args);
  return {releases, refs, tagObjects, requests, writes, runner, find};
}

function assets(t, content = () => 'abc') {
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-publication-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  for (const name of assetNames()) writeFileSync(join(directory, name), content(name));
  return directory;
}

test('the model answers missing objects with the live API statuses', () => {
  const model = github();
  const api = apiWith(model.runner);
  assert.equal(api(`repos/${repository}/git/ref/tags/${firstTag}`, true), null);
  assert.equal(api(`repos/${repository}/releases/tags/${firstTag}`, true), null);
  // The old lookup: absence through commits/{tag} is a 422, never a missing object.
  assert.throws(() => api(`repos/${repository}/commits/${firstTag}`, true), /HTTP 422/);
  assert.throws(() => api(`repos/${repository}/git/ref/tags/${firstTag}`), /HTTP 404/);
});

test('a new publication stages a draft, verifies every byte, then publishes its tag', async t => {
  const directory = assets(t), model = github();
  assert.equal(await publishOci(directory, revision, githubClient(model.runner, environment())),
    `https://github.com/${repository}/releases/tag/${firstTag}`);
  assert.deepEqual(model.writes.map(args => args[1]), ['create', 'upload', 'edit']);
  const release = model.find(firstTag);
  assert.equal(release.draft, false);
  assert.equal(release.body, publicationNotes(revision));
  assert.deepEqual(model.refs.get(firstTag), {type: 'commit', sha: revision});
  // The draft was read back from the release list, since its tag endpoint 404s.
  assert.ok(model.requests.some(path => path.includes('/releases?per_page=100&page=1')));
  const again = model.writes.length;
  assert.equal(await publishOci(directory, revision, githubClient(model.runner, environment())),
    `https://github.com/${repository}/releases/tag/${firstTag}`);
  assert.equal(model.writes.length, again, 'an identical published release is read-only');
});

test('a draft beyond the first page of releases is still found', async t => {
  const directory = assets(t), model = github({unrelated: 250});
  // Order the staged draft last, three pages in.
  const runner = args => {
    const result = model.runner(args);
    if (args[1] === 'create') model.releases.push(model.releases.shift());
    return result;
  };
  await publishOci(directory, revision, githubClient(runner, environment()));
  assert.equal(model.find(firstTag).draft, false);
  assert.ok(model.requests.some(path => path.endsWith('&page=3')));
});

test('a complete draft resumes and a corrupt one never becomes public', async t => {
  for (const corrupt of [false, true]) {
    const directory = assets(t), model = github();
    await assert.rejects(publishOci(directory, revision, githubClient(args => {
      if (args[1] === 'edit') throw new Error('interrupted before publication');
      return model.runner(args);
    }, environment())), /interrupted/);
    assert.equal(model.find(firstTag).draft, true);
    if (corrupt) model.find(firstTag).bytes.set(assetNames()[0], Buffer.from('abd'));
    model.writes.length = 0;
    const result = publishOci(directory, revision, githubClient(model.runner, environment()));
    if (corrupt) {
      await assert.rejects(result, /cannot be overwritten/);
      assert.equal(model.find(firstTag).draft, true);
      assert.deepEqual(model.writes, []);
    } else {
      await result;
      assert.deepEqual(model.writes.map(args => args[1]), ['edit']);
      assert.equal(model.find(firstTag).draft, false);
    }
  }
});

test('an existing release is never rewritten and every substitution is refused', async t => {
  const directory = assets(t);
  const published = () => {
    const model = github();
    model.releases.unshift({tag_name: firstTag, target_commitish: revision, draft: false, prerelease: true,
      body: publicationNotes(revision), assets: assetNames().map(name => ({name, size: 3})),
      bytes: new Map(assetNames().map(name => [name, Buffer.from('abc')]))});
    model.refs.set(firstTag, {type: 'commit', sha: revision});
    return model;
  };
  const same = published();
  await publishOci(directory, revision, githubClient(same.runner, environment()));
  assert.deepEqual(same.writes, []);
  const other = 'b'.repeat(40);
  for (const change of [
    model => model.find(firstTag).bytes.set(assetNames()[0], Buffer.from('abd')),
    model => { model.find(firstTag).prerelease = false; },
    model => { model.find(firstTag).body = 'accepted'; },
    model => { model.find(firstTag).target_commitish = other; },
    model => { model.find(firstTag).assets.shift(); },
    model => { const release = model.find(firstTag); release.assets.push({...release.assets[0]}); },
    model => model.refs.set(firstTag, {type: 'commit', sha: other}),
    model => model.refs.delete(firstTag),
  ]) {
    const model = published();
    change(model);
    await assert.rejects(publishOci(directory, revision, githubClient(model.runner, environment())));
    assert.deepEqual(model.writes, [], 'a refused publication writes nothing');
  }
  rmSync(join(directory, assetNames()[0]));
  const missing = github();
  await assert.rejects(publishOci(directory, revision, githubClient(missing.runner, environment())), /asset closure is incomplete/);
  assert.deepEqual(missing.requests, []);
});

test('tags resolve through annotated tag objects to exactly one commit', () => {
  const model = github(), api = apiWith(model.runner);
  const tagObject = 'c'.repeat(40), nested = 'd'.repeat(40);
  model.refs.set('lightweight', {type: 'commit', sha: revision});
  model.refs.set('annotated', {type: 'tag', sha: tagObject});
  model.tagObjects.set(tagObject, {type: 'tag', sha: nested});
  model.tagObjects.set(nested, {type: 'commit', sha: revision});
  model.refs.set('tree', {type: 'tree', sha: 'e'.repeat(40)});
  assert.equal(tagCommit(api, 'lightweight'), revision);
  assert.equal(tagCommit(api, 'annotated'), revision);
  assert.equal(tagCommit(api, 'absent'), null);
  assert.throws(() => tagCommit(api, 'tree'), /names a tree/);
  assert.equal(releaseByTag(api, 'absent'), null);
  // Any status other than 200 or an allowed 404 is a failure, never absence.
  const failing = apiWith(args => ({...model.runner(args), status: 1,
    stdout: 'HTTP/2.0 500 Internal Server Error\r\nContent-Type: application/json\r\n\r\n{}'}));
  assert.throws(() => tagCommit(failing, 'lightweight'), /HTTP 500/);
  assert.throws(() => releaseByTag(failing, 'lightweight'), /HTTP 500/);
});

test('each attempt has its own discovery tag and an invalid run context performs no I/O', async t => {
  const directory = assets(t), model = github();
  for (const [run, attempt] of [['123456789', '1'], ['123456789', '2'], ['987654321', '1']]) {
    const tag = `sdk-oci-${revision}-${run}-${attempt}`;
    assert.equal(publicationTag(environment({GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt})), tag);
    assert.equal(await publishOci(directory, revision, githubClient(model.runner, environment({GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt}))),
      `https://github.com/${repository}/releases/tag/${tag}`);
    assert.equal(model.find(tag).draft, false);
  }
  assert.equal(model.releases.length, 3, 'reruns never collide with earlier evidence');
  const requests = model.requests.length, writes = model.writes.length;
  for (const change of [{GITHUB_ACTIONS: undefined}, {GITHUB_ACTIONS: 'false'}, {GITHUB_SHA: 'b'.repeat(40)},
    ...['', '0', '01', '-1', '1.0', '1e3', ' 1', '1\n', '../main', undefined]
      .flatMap(value => [{GITHUB_RUN_ID: value}, {GITHUB_RUN_ATTEMPT: value}])]) {
    await assert.rejects(publishOci(directory, revision, githubClient(model.runner, environment(change))));
    assert.equal(model.requests.length, requests, 'an invalid run identity fails before API access');
    assert.equal(model.writes.length, writes);
  }
});

test('the release workflow publishes through this module only', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.equal(workflow.match(/node scripts\/release-publication\.mjs publish-oci release\n/g)?.length, 1);
  assert.ok(!workflow.includes('release-phases.mjs publish-oci'));
});
