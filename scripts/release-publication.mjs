#!/usr/bin/env node
// Publication of the source-addressed OCI/native verification assets.
//
// Publication is release plumbing, not a build input, so it lives outside the
// build plumbing of scripts/factory.mjs: a publication fix never invalidates
// a build receipt. It only runs for real on the release tag (every branch run
// is a rehearsal), so it reads GitHub exactly as the REST API answers:
// - a release still in draft is absent from `releases/tags/{tag}`, which serves
//   published releases only; drafts are found in the release list;
// - a missing tag is a 404 of `git/ref/tags/{tag}`; `commits/{tag}` answers 422
//   for it, which is not a missing-object status.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createReadStream, lstatSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assetNames, policyFromEnvironment, publicationNotes, requirePrerequisites, verifyExistingRelease} from './release-phases.mjs';

const repository = 'UOR-Foundation/prismpm';
const releasePage = 100;

export {policyFromEnvironment};

export function publicationTag(environment) {
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'publication requires GitHub Actions context');
  assert.match(environment.GITHUB_SHA ?? '', /^[0-9a-f]{40}$/);
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) {
    const value = environment[key];
    assert(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value),
      'publication requires a canonical decimal ' + key);
  }
  // Gate transcripts and signature bundles are specific to an execution, not
  // deterministic functions of source alone. Never overwrite an earlier run.
  return `sdk-oci-${environment.GITHUB_SHA}-${environment.GITHUB_RUN_ID}-${environment.GITHUB_RUN_ATTEMPT}`;
}

function gh(args) {
  const result = spawnSync('gh', args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 300_000});
  if (result.error) throw result.error;
  assert.equal(result.signal, null, 'GitHub operation terminated');
  return result;
}

export function checkedWith(runner) {
  return args => {
    const result = runner(args);
    assert.equal(result.status, 0, `GitHub operation failed: ${result.stderr}`);
    return result.stdout;
  };
}

// `gh api --include` prints the status line, the headers and the body. Only a
// 404 is an absent object, and only where the caller allows absence.
export function apiWith(runner) {
  return (path, missingAllowed = false) => {
    const response = runner(['api', '--include', path]);
    const match = response.stdout.match(/^HTTP\/[^ ]+ (\d{3})[^\r\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/);
    assert.ok(match, `GitHub API did not return a status and body for ${path}`);
    if (missingAllowed && match[1] === '404' && response.status !== 0) return null;
    assert.equal(response.status, 0, `GitHub API request failed for ${path}: HTTP ${match[1]} ${response.stderr ?? ''}`);
    assert.equal(match[1], '200', `GitHub API answered HTTP ${match[1]} for ${path}`);
    return JSON.parse(match[2]);
  };
}

// The release with this tag, published or draft, or null.
export function releaseByTag(api, tag) {
  const published = api(`repos/${repository}/releases/tags/${tag}`, true);
  if (published !== null) {
    assert.equal(published.tag_name, tag);
    return published;
  }
  const drafts = [];
  for (let page = 1; ; page++) {
    const releases = api(`repos/${repository}/releases?per_page=${releasePage}&page=${page}`);
    assert.ok(Array.isArray(releases), 'GitHub release list is not a list');
    drafts.push(...releases.filter(release => release.tag_name === tag));
    if (releases.length < releasePage) break;
  }
  assert.ok(drafts.length <= 1, `more than one release claims ${tag}`);
  if (drafts.length === 0) return null;
  assert.equal(drafts[0].draft, true, `release ${tag} is published but absent from its tag endpoint`);
  return drafts[0];
}

// The commit a tag names, through annotated tag objects, or null.
export function tagCommit(api, tag) {
  const ref = api(`repos/${repository}/git/ref/tags/${tag}`, true);
  if (ref === null) return null;
  assert.equal(ref.ref, `refs/tags/${tag}`, 'GitHub returned a different tag reference');
  let object = ref.object;
  for (let depth = 0; object.type === 'tag'; depth++) {
    assert.ok(depth < 8, `tag ${tag} does not resolve to a commit`);
    object = api(`repos/${repository}/git/tags/${object.sha}`).object;
  }
  assert.equal(object.type, 'commit', `tag ${tag} names a ${object.type}, not a commit`);
  assert.match(object.sha, /^[0-9a-f]{40}$/);
  return object.sha;
}

export async function filesIn(directory) {
  const result = [];
  for (const name of readdirSync(directory).sort()) {
    assert.match(name, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    const path = join(directory, name), stat = lstatSync(path);
    assert.ok(stat.isFile(), 'release assets must be regular files');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    result.push({name, size: stat.size, digest: `sha256:${digest.digest('hex')}`});
  }
  assert.ok(result.length > 0);
  return result;
}

export const githubClient = (runner = gh, environment = process.env) =>
  ({api: apiWith(runner), checked: checkedWith(runner), environment});

export async function publishOci(directory, revision, client = githubClient()) {
  policyFromEnvironment(client.environment);
  assert.equal(client.environment.GITHUB_SHA, revision);
  const tag = publicationTag(client.environment), notes = publicationNotes(revision);
  const expected = {tag, revision, notes, files: await filesIn(directory)};
  assert.deepEqual(expected.files.map(file => file.name), assetNames(), 'publication asset closure is incomplete');
  const existing = releaseByTag(client.api, tag);
  const tagRecord = tagCommit(client.api, tag);
  if (tagRecord !== null) assert.equal(tagRecord, revision, 'existing tag targets a different source');
  if (existing !== null) {
    assert.equal(typeof existing.draft, 'boolean');
    assert.ok(tagRecord !== null || existing.draft, 'published release tag is absent');
    verifyExistingRelease(existing, expected, expected.files, tagRecord ?? revision, existing.draft);
  }
  if (existing === null) {
    // Draft staging prevents publication of a partially uploaded asset closure.
    client.checked(['release', 'create', tag, '--repo', repository, '--target', revision, '--draft', '--prerelease',
      '--title', `PrismPM OCI/native ${revision}`, '--notes', notes]);
    client.checked(['release', 'upload', tag, '--repo', repository, ...expected.files.map(file => join(directory, file.name))]);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'prismpm-oci-download-'));
  try {
    client.checked(['release', 'download', tag, '--repo', repository, '--dir', scratch]);
    const release = releaseByTag(client.api, tag);
    assert.ok(release !== null, `release ${tag} is absent after staging`);
    // A draft release does not create its tag until publication. Its exact
    // target_commitish is checked before publication, then the real tag after.
    const staged = existing === null || existing.draft;
    const currentTag = tagCommit(client.api, tag);
    assert.ok(currentTag !== null || staged, 'published release tag is absent');
    verifyExistingRelease(release, expected, await filesIn(scratch), currentTag ?? revision, staged);
    if (staged) {
      client.checked(['release', 'edit', tag, '--repo', repository, '--draft=false']);
      const published = releaseByTag(client.api, tag), publishedTag = tagCommit(client.api, tag);
      assert.ok(published !== null && publishedTag !== null, `release ${tag} did not publish its tag`);
      verifyExistingRelease(published, expected, await filesIn(scratch), publishedTag);
    }
  } finally { rmSync(scratch, {recursive: true, force: true}); }
  return `https://github.com/${repository}/releases/tag/${tag}`;
}

async function main([command, ...args]) {
  if (command === 'publish-oci' && args.length === 1) {
    requirePrerequisites('oci-native', JSON.parse(process.env.RELEASE_NEEDS));
    process.stdout.write(`${await publishOci(resolve(args[0]), process.env.GITHUB_SHA)}\n`);
  } else if (command === 'probe' && args.length === 1) {
    // Read-only: how this module sees a tag on the live API.
    const api = apiWith(gh);
    const release = releaseByTag(api, args[0]);
    process.stdout.write(`${JSON.stringify({tag: args[0], commit: tagCommit(api, args[0]),
      release: release && {draft: release.draft, prerelease: release.prerelease, target: release.target_commitish}})}\n`);
  } else {
    console.error('usage: release-publication.mjs publish-oci DIRECTORY | probe TAG');
    process.exit(64);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
