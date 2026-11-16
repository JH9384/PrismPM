// `build --remote github`: the repository, the commit, the API exchange with a stand-in GitHub, the artifact
// reader, and every check a downloaded build must pass, each with the defect that makes it fail. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { GITHUB_ACTIONS_ISSUER } from '../src/attest.mjs';
import { check } from '../src/check.mjs';
import { DigestMismatchError } from '../src/errors.mjs';
import { fromFile } from '../src/node.mjs';
import {
  REMOTE_BUILD_SCHEMA,
  SLSA_PROVENANCE_V1,
  buildRef,
  checkProvenance,
  checkRecord,
  commitOf,
  gitHubClient,
  identityPattern,
  parseRepository,
  remoteBuild,
  repositorySigner,
  repositoryOf,
  tokenOf,
  unzip,
  verifyRemoteBuild,
  verifySignature,
  waitForRun,
} from '../src/remote-github.mjs';

const holoPath = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const holoBytes = new Uint8Array(readFileSync(holoPath));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const REPO = { owner: 'acme', repo: 'prism-luhn', full: 'acme/prism-luhn' };
const SHA = 'c'.repeat(40);
const BUILD = sha256('build');
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-remote-'));
const enc = (text) => new TextEncoder().encode(text);

let fingerprint;
test.before(async () => {
  fingerprint = (await fromFile(holoPath)).identities.archiveFingerprint;
});

/** A zip archive of `entries` (path to bytes), each stored or deflated. CRCs are zero: the reader checks the holo's SHA-256, not CRCs. */
function zip(entries, { deflate = true } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const [name, content] of entries) {
    const nameBytes = enc(name);
    const data = deflate ? new Uint8Array(deflateRawSync(content)) : content;
    const method = deflate ? 8 : 0;
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(content.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes]);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(content.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes]));
    parts.push(local, data);
    offset += local.length + data.length;
  }
  const directory = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(directory), ...u32(offset), ...u16(0)]);
  return new Uint8Array(Buffer.concat([...parts, ...central, eocd].map((p) => Buffer.from(p))));
}

/** The record the runner writes. */
const record = (over = {}) => ({ schema: REMOTE_BUILD_SCHEMA, repository: REPO.full, sha: SHA, run_id: 7, run_url: 'https://github.com/acme/prism-luhn/actions/runs/7', workflow_ref: 'acme/prism-luhn/.github/workflows/build.yml@refs/heads/prism/build/' + SHA, event: 'push', ref: 'refs/heads/prism/build/' + SHA, project: 'app', build: BUILD, holo: 'Calculator.holo', fingerprint, holo_sha256: sha256(holoBytes), ...over });

/** A Sigstore bundle whose DSSE payload is an SLSA v1 statement about `subjectSha256`, built in `repo` from `sha`. Unsigned: the signature check is injected. */
function bundle({ subjectSha256 = sha256(holoBytes), repo = REPO.full, sha = SHA, predicateType = SLSA_PROVENANCE_V1 } = {}) {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'Calculator.holo', digest: { sha256: subjectSha256 } }],
    predicateType,
    predicate: {
      buildDefinition: {
        buildType: 'https://actions.github.io/buildtypes/workflow/v1',
        externalParameters: { workflow: { ref: 'refs/heads/prism/build/' + sha, repository: `https://github.com/${repo}`, path: '.github/workflows/build.yml' } },
        resolvedDependencies: [{ uri: `git+https://github.com/${repo}@refs/heads/prism/build/${sha}`, digest: { gitCommit: sha } }],
      },
      runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' } },
    },
  };
  return { mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json', verificationMaterial: {}, dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64'), payloadType: 'application/vnd.in-toto+json', signatures: [{ sig: 'AA==' }] } };
}

/** The artifact's files, with every part replaceable. */
const files = ({ rec = record(), holo = holoBytes, provenance = bundle(), extra = {} } = {}) => new Map([
  ['build.json', enc(JSON.stringify(rec))],
  [`build/${rec.holo}`, holo],
  ['build/manifest.json', enc('{"files":[]}')],
  ['provenance.sigstore.json', enc(JSON.stringify(provenance))],
  ...Object.entries(extra).map(([k, v]) => [k, enc(v)]),
]);

const signed = async () => ({ identity: `https://github.com/${REPO.full}/.github/workflows/build.yml@refs/heads/prism/build/${SHA}`, issuer: GITHUB_ACTIONS_ISSUER, time: null });
const rejects = (promise, code, pattern) => assert.rejects(promise, (e) => e.code === code && (!pattern || pattern.test(e.message)) || (() => { throw new Error(`got ${e.code}: ${e.message}`); })());

test('a GitHub remote is read from https, ssh and owner/name; anything else is refused', () => {
  for (const url of ['https://github.com/acme/prism-luhn.git', 'https://github.com/acme/prism-luhn', 'git@github.com:acme/prism-luhn.git', 'ssh://git@github.com/acme/prism-luhn', 'acme/prism-luhn']) {
    assert.deepEqual(parseRepository(url), REPO, url);
  }
  assert.equal(parseRepository('https://gitlab.com/acme/prism-luhn'), null);
  assert.equal(parseRepository('acme'), null);
  const git = (stdout, status = 0) => () => ({ status, stdout, stderr: '' });
  assert.deepEqual(repositoryOf('/x', { run: git('git@github.com:acme/prism-luhn.git\n') }), REPO);
  assert.throws(() => repositoryOf('/x', { run: git('', 128) }), (e) => e.code === 'remote.repository' && /--repo/.test(e.message));
  assert.throws(() => repositoryOf('/x', { run: git('https://example.com/a/b\n') }), (e) => e.code === 'remote.repository');
  assert.throws(() => repositoryOf('/x', { override: 'nope' }), (e) => e.code === 'remote.repository');
  assert.deepEqual(repositoryOf('/x', { override: 'acme/prism-luhn', run: () => { throw new Error('never asked'); } }), REPO);
});

test('the token comes from the environment, else gh; none is a refusal, and it is never in a message', () => {
  assert.deepEqual(tokenOf({ env: { GH_TOKEN: 'ghp_secret' }, run: () => { throw new Error('never asked'); } }), { token: 'ghp_secret', source: 'GH_TOKEN' });
  assert.equal(tokenOf({ env: {}, run: () => ({ status: 0, stdout: 'gho_fromgh\n' }) }).token, 'gho_fromgh');
  assert.throws(() => tokenOf({ env: {}, run: () => ({ status: 1, stdout: '' }) }), (e) => e.code === 'remote.auth' && !/gh[op]_/.test(e.message));
});

test('the commit is the ref as committed; a dirty tree is refused unless --allow-dirty or a named ref', () => {
  const run = (dirty) => (cmd, args) => (args.includes('rev-parse') ? { status: 0, stdout: `${SHA}\n` } : { status: 0, stdout: dirty ? ' M src/App.lex.tex\n' : '' });
  assert.deepEqual(commitOf('/x', { run: run(false) }), { sha: SHA, dirty: false });
  assert.throws(() => commitOf('/x', { run: run(true) }), (e) => e.code === 'remote.dirty' && /--allow-dirty/.test(e.message));
  assert.deepEqual(commitOf('/x', { run: run(true), allowDirty: true }), { sha: SHA, dirty: true });
  assert.equal(commitOf('/x', { run: run(true), ref: 'main' }).sha, SHA, 'a named ref builds that commit whatever the tree holds');
  assert.throws(() => commitOf('/x', { run: () => ({ status: 128, stdout: '' }) }), (e) => e.code === 'remote.ref');
});

test('a zip archive is read, stored or deflated; a damaged one is refused', () => {
  const entries = [['build.json', enc('{"a":1}')], ['build/Calculator.holo', holoBytes], ['build/dir/', new Uint8Array()]];
  for (const deflate of [true, false]) {
    const out = unzip(zip(entries, { deflate }));
    assert.deepEqual([...out.keys()], ['build.json', 'build/Calculator.holo'], 'directories are skipped');
    assert.equal(sha256(out.get('build/Calculator.holo')), sha256(holoBytes));
  }
  assert.throws(() => unzip(enc('not a zip at all, nothing to find here')), (e) => e.code === 'remote.artifact');
  const damaged = zip(entries);
  damaged[damaged.length - 6] ^= 0xff; // the central directory offset
  assert.throws(() => unzip(damaged), (e) => e.code === 'remote.artifact');
});

test('the signing identity is a workflow of this repository, at a ref, and nothing else', () => {
  const pattern = identityPattern(REPO);
  assert.match(`https://github.com/acme/prism-luhn/.github/workflows/build.yml@refs/heads/prism/build/${SHA}`, pattern);
  assert.match('https://github.com/acme/prism-luhn/.github/workflows/pages.yml@refs/heads/main', pattern);
  assert.doesNotMatch('https://github.com/acme/prism-luhn-evil/.github/workflows/build.yml@refs/heads/main', pattern);
  assert.doesNotMatch('https://github.com/other/prism-luhn/.github/workflows/build.yml@refs/heads/main', pattern);
  assert.doesNotMatch('https://github.com/acme/prism-luhn/.github/workflows/build.yml', pattern, 'no ref, no identity');
});

test('build.json must be this commit and this repository; the provenance must be about this holo, from here', () => {
  assert.equal(checkRecord(files(), { repo: REPO, sha: SHA }).build, BUILD);
  assert.throws(() => checkRecord(files({ rec: record({ sha: 'd'.repeat(40) }) }), { repo: REPO, sha: SHA }), (e) => e.code === 'remote.commit');
  assert.throws(() => checkRecord(files({ rec: record({ repository: 'other/repo' }) }), { repo: REPO, sha: SHA }), (e) => e.code === 'remote.signer');
  assert.throws(() => checkRecord(files({ rec: record({ schema: 'prism/remote-build/9' }) }), { repo: REPO, sha: SHA }), (e) => e.code === 'remote.artifact');
  assert.throws(() => checkRecord(files({ rec: record({ holo: '../escape.holo' }) }), { repo: REPO, sha: SHA }), (e) => e.code === 'remote.artifact');
  assert.throws(() => checkRecord(files({ rec: record({ holo: 'sub/escape.holo' }) }), { repo: REPO, sha: SHA }), (e) => e.code === 'remote.artifact');
  assert.equal(checkRecord(files({ rec: record({ holo: 'Leap year.holo' }) }), { repo: REPO, sha: SHA }).holo, 'Leap year.holo', 'a holo is named after its app, spaces included');
  assert.throws(() => checkRecord(new Map(), { repo: REPO, sha: SHA }), (e) => e.code === 'remote.artifact' && /no build\.json/.test(e.message));

  const ok = checkProvenance(bundle(), { repo: REPO, sha: SHA, holoSha256: sha256(holoBytes) });
  assert.equal(ok.workflowPath, '.github/workflows/build.yml');
  assert.throws(() => checkProvenance(bundle({ subjectSha256: sha256('other') }), { repo: REPO, sha: SHA, holoSha256: sha256(holoBytes) }), (e) => e.code === 'remote.subject');
  assert.throws(() => checkProvenance(bundle({ repo: 'other/repo' }), { repo: REPO, sha: SHA, holoSha256: sha256(holoBytes) }), (e) => e.code === 'remote.signer');
  assert.throws(() => checkProvenance(bundle({ sha: 'd'.repeat(40) }), { repo: REPO, sha: SHA, holoSha256: sha256(holoBytes) }), (e) => e.code === 'remote.commit');
  assert.throws(() => checkProvenance(bundle({ predicateType: 'https://example.com/other' }), { repo: REPO, sha: SHA, holoSha256: sha256(holoBytes) }), (e) => e.code === 'remote.provenance');
  assert.throws(() => checkProvenance({ dsseEnvelope: { payload: 'bm90IGpzb24=' } }, { repo: REPO, sha: SHA, holoSha256: '' }), (e) => e.code === 'remote.provenance');
});

test('check trusts the statements signed into a remote build only when a workflow of its repository signed them (#582)', async () => {
  let asked;
  const result = await verifyRemoteBuild(files(), {
    cwd: scratch(),
    repo: REPO,
    sha: SHA,
    verifyBundle: signed,
    checkHolo: async (path, options) => {
      asked = options;
      return check(path, options);
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(asked.signer.certificateOidcIssuer, GITHUB_ACTIONS_ISSUER);
  assert.ok(asked.signer.certificateIdentityRegexp.test(`https://github.com/${REPO.full}/.github/workflows/build.yml@refs/heads/prism/build/${SHA}`));
  assert.ok(!asked.signer.certificateIdentityRegexp.test(`https://github.com/other/repo/.github/workflows/build.yml@refs/heads/main`));
  assert.deepEqual(repositorySigner(REPO), asked.signer);
});

test('a verified build is written under .prism/build/<build>/ and nothing is written there before every check passed', async () => {
  const cwd = scratch();
  const result = await verifyRemoteBuild(files(), { cwd, repo: REPO, sha: SHA, runInfo: { id: 7, url: 'u' }, verifyBundle: signed, run: () => { throw new Error('gh was not needed'); } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.run.url, 'u');
  assert.equal(result.fingerprint, fingerprint);
  assert.equal(result.signature.via, 'sigstore');
  assert.equal(result.holo, join(cwd, 'app', '.prism', 'build', BUILD, 'Calculator.holo'));
  assert.ok(existsSync(join(cwd, 'app', '.prism', 'build', BUILD, 'manifest.json')));
  assert.ok(existsSync(join(cwd, 'app', '.prism', 'remote', SHA, 'provenance.sigstore.json')));
  assert.equal(result.vectors.total, 22);
  assert.equal(result.vectors.passed, 22);
  assert.ok(result.verdict.level, 'a verdict was reached');

  // The live run's app was `Leap year.holo`: a name with a space is written where the runner put it.
  const spaced = await verifyRemoteBuild(files({ rec: record({ holo: 'Leap year.holo' }) }), { cwd: scratch(), repo: REPO, sha: SHA, verifyBundle: signed });
  assert.equal(spaced.exitCode, 0);
  assert.ok(spaced.holo.endsWith(join('.prism', 'build', BUILD, 'Leap year.holo')));
  assert.ok(existsSync(spaced.holo));
});

test('planted: a flipped byte in the holo is a digest mismatch, and .prism/build/ stays empty', async () => {
  const cwd = scratch();
  const flipped = new Uint8Array(holoBytes);
  flipped[100] ^= 0x01;
  await assert.rejects(verifyRemoteBuild(files({ holo: flipped }), { cwd, repo: REPO, sha: SHA, verifyBundle: signed }), (e) => e instanceof DigestMismatchError && /changed in transit/.test(e.message));
  assert.ok(!existsSync(join(cwd, 'app', '.prism', 'build')));
});

test('planted: a flipped byte with a matching record is caught by the provenance subject, before any signature', async () => {
  const cwd = scratch();
  const flipped = new Uint8Array(holoBytes);
  flipped[100] ^= 0x01;
  let signatureAsked = false;
  await rejects(verifyRemoteBuild(files({ holo: flipped, rec: record({ holo_sha256: sha256(flipped) }) }), { cwd, repo: REPO, sha: SHA, verifyBundle: async () => { signatureAsked = true; return signed(); } }), 'remote.subject');
  assert.equal(signatureAsked, false);
  assert.ok(!existsSync(join(cwd, 'app', '.prism', 'build')));
});

test('planted: an artifact from another commit, and provenance from another repository, are refused', async () => {
  const cwd = scratch();
  await rejects(verifyRemoteBuild(files({ rec: record({ sha: 'd'.repeat(40) }) }), { cwd, repo: REPO, sha: SHA, verifyBundle: signed }), 'remote.commit');
  await rejects(verifyRemoteBuild(files({ provenance: bundle({ repo: 'other/repo' }) }), { cwd, repo: REPO, sha: SHA, verifyBundle: signed }), 'remote.signer');
  await rejects(verifyRemoteBuild(files({ rec: record({ fingerprint: 'f'.repeat(64) }) }), { cwd, repo: REPO, sha: SHA, verifyBundle: signed }), 'remote.fingerprint');
  assert.ok(!existsSync(join(cwd, 'app', '.prism', 'build')));
});

test('planted: a signature the verifier rejects is that error; an unsigned artifact is refused', async () => {
  const cwd = scratch();
  const { SignatureInvalidError } = await import('../src/errors.mjs');
  await assert.rejects(verifyRemoteBuild(files(), { cwd, repo: REPO, sha: SHA, verifyBundle: async () => { throw new SignatureInvalidError('bad signature'); } }), (e) => e instanceof SignatureInvalidError);
  const unsigned = files();
  unsigned.delete('provenance.sigstore.json');
  await rejects(verifyRemoteBuild(unsigned, { cwd, repo: REPO, sha: SHA, verifyBundle: signed }), 'remote.provenance', /not signed/);
});

test('without the Sigstore packages the signature goes to gh; without gh too, a refusal names both', async () => {
  const { PrismError } = await import('../src/errors.mjs');
  const unavailable = async () => { throw new PrismError('no sigstore', { code: 'attest.unavailable' }); };
  const calls = [];
  const gh = (status, stdout = '[]', error = undefined) => (cmd, args) => { calls.push([cmd, ...args]); return { status, stdout, stderr: 'refused', error }; };
  const ok = await verifySignature(bundle(), { repo: REPO, holoPath: 'x.holo', verifyBundle: unavailable, run: gh(0, JSON.stringify([{ verificationResult: { signature: { certificate: { sourceRepositoryURI: 'https://github.com/acme/prism-luhn' } } } }])) });
  assert.equal(ok.via, 'gh');
  assert.equal(ok.identity, 'https://github.com/acme/prism-luhn');
  assert.deepEqual(calls[0].slice(0, 5), ['gh', 'attestation', 'verify', 'x.holo', '--repo']);
  assert.ok(calls[0].includes('acme/prism-luhn'));
  await rejects(verifySignature(bundle(), { repo: REPO, holoPath: 'x.holo', verifyBundle: unavailable, run: gh(1) }), 'remote.attestation', /refused/);
  await rejects(verifySignature(bundle(), { repo: REPO, holoPath: 'x.holo', verifyBundle: unavailable, run: gh(null, '', { code: 'ENOENT' }) }), 'remote.attestation', /Sigstore packages.*gh/);
});

/** A stand-in GitHub: answers the API paths the build asks, in the order a real build meets them. */
function github({ runs = [], conclusion = 'success', workflow = true, push = true, artifactFiles = files() } = {}) {
  const seen = [];
  let polls = 0;
  const fetch = async (url, init) => {
    const path = url.replace('https://api.github.com', '');
    seen.push(path);
    assert.match(init.headers.authorization, /^Bearer /);
    const json = (status, body) => ({ status, ok: status < 400, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });
    if (path === `/repos/${REPO.full}`) return json(200, { private: false, permissions: { push } });
    if (path.startsWith(`/repos/${REPO.full}/actions/runs?head_sha=`)) return json(200, { workflow_runs: runs.length ? runs : seen.filter((p) => p.includes('head_sha')).length > 1 ? [{ id: 7, head_sha: SHA, path: '.github/workflows/build.yml', status: 'in_progress', conclusion: null, html_url: 'https://github.com/acme/prism-luhn/actions/runs/7', created_at: '2026-11-06T00:00:00Z' }] : [] });
    if (path === `/repos/${REPO.full}/actions/runs/7`) return json(200, { id: 7, head_sha: SHA, status: ++polls < 2 ? 'in_progress' : 'completed', conclusion: polls < 2 ? null : conclusion, html_url: 'https://github.com/acme/prism-luhn/actions/runs/7' });
    if (path.startsWith(`/repos/${REPO.full}/actions/runs/7/artifacts`)) return json(200, { artifacts: [{ id: 99, name: `prism-build-${SHA}`, expired: false }] });
    if (path === `/repos/${REPO.full}/actions/artifacts/99/zip`) {
      const bytes = zip([...artifactFiles]);
      return { status: 200, ok: true, text: async () => '', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
    return json(404, { message: `unexpected ${path}` });
  };
  const gitCalls = [];
  const run = (cmd, args) => {
    gitCalls.push([cmd, ...args]);
    if (cmd === 'gh') return { status: 0, stdout: 'gho_token\n' };
    if (args.includes('get-url')) return { status: 0, stdout: `git@github.com:${REPO.full}.git\n` };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${SHA}\n` };
    if (args.includes('status')) return { status: 0, stdout: '' };
    // The workflow is read from the commit itself, which may not be on GitHub yet.
    if (args.includes('cat-file')) return { status: workflow ? 0 : 1, stdout: '', stderr: workflow ? '' : 'fatal: path not in tree' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { fetch, run, gitCalls, seen };
}

test('the whole build: push the ref, find the run, wait, download, verify, write, delete the ref', async () => {
  const cwd = scratch();
  const gh = github();
  const log = [];
  const result = await remoteBuild({ cwd, env: {}, fetch: gh.fetch, run: gh.run, sleep: async () => {}, verifyBundle: signed, log: (l) => log.push(l) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.run.url, 'https://github.com/acme/prism-luhn/actions/runs/7');
  assert.equal(result.refDeleted, true);
  const pushes = gh.gitCalls.filter((c) => c[0] === 'git' && c.includes('push'));
  assert.deepEqual(pushes.map((c) => c.at(-1)), [`${SHA}:${buildRef(SHA)}`, `:${buildRef(SHA)}`], 'one push of the commit to its build ref, one delete after');
  assert.ok(existsSync(result.holo));
  assert.match(log.join('\n'), /building c{12} in acme\/prism-luhn \(public\)/);
  assert.ok(!log.join('\n').includes('gho_token'), 'the token is never logged');
});

test('planted: a run that failed is a failure, never a build; no workflow and no push right are refusals before any push', async () => {
  const cwd = scratch();
  const failed = github({ conclusion: 'failure' });
  await rejects(remoteBuild({ cwd, env: {}, fetch: failed.fetch, run: failed.run, sleep: async () => {}, verifyBundle: signed }), 'remote.run', /ended failure/);
  assert.ok(!existsSync(join(cwd, 'app', '.prism', 'build')));

  const none = github({ workflow: false });
  await rejects(remoteBuild({ cwd, env: {}, fetch: none.fetch, run: none.run, sleep: async () => {}, verifyBundle: signed }), 'remote.workflow', /holds no \.github\/workflows\/build\.yml/);
  assert.equal(none.gitCalls.some((c) => c.includes('push')), false);
  assert.equal(none.seen.some((p) => p.includes('/contents/')), false, 'the commit is read locally, not through the API, because it may not be on GitHub yet');

  const readOnly = github({ push: false });
  await rejects(remoteBuild({ cwd, env: {}, fetch: readOnly.fetch, run: readOnly.run, sleep: async () => {}, verifyBundle: signed }), 'remote.permission');
  assert.equal(readOnly.gitCalls.some((c) => c.includes('push')), false);
});

test('an existing run for the commit is reused without a push, and a wait that runs out is remote.timeout', async () => {
  const cwd = scratch();
  const existing = github({ runs: [{ id: 7, head_sha: SHA, path: '.github/workflows/pages.yml', status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/prism-luhn/actions/runs/7', created_at: '2026-11-06T00:00:00Z' }] });
  const result = await remoteBuild({ cwd, env: { GITHUB_TOKEN: 't' }, fetch: existing.fetch, run: existing.run, sleep: async () => {}, verifyBundle: signed });
  assert.equal(result.exitCode, 0);
  assert.equal(result.pushed, false);
  const pushes = existing.gitCalls.filter((c) => c[0] === 'git' && c.includes('push'));
  assert.deepEqual(pushes.map((c) => c.at(-1)), [`:${buildRef(SHA)}`], 'no push of the commit, only the delete of a build ref that may be left from an earlier attempt');
  assert.equal(result.refDeleted, true);

  let clock = 0;
  const client = gitHubClient({ token: 't', fetch: async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ id: 7, status: 'in_progress', html_url: 'u' }) }), sleep: async (ms) => { clock += ms; } });
  await rejects(waitForRun(client, REPO, { id: 7, status: 'in_progress', head_sha: SHA, html_url: 'u' }, { timeoutMs: 60000, now: () => clock }), 'remote.timeout', /--ref/);
});

test('the API client: a 5xx is tried again, a 404 is null, another failure carries the status', async () => {
  let calls = 0;
  const client = gitHubClient({ token: 't', retryMs: 0, sleep: async () => {}, fetch: async () => (++calls === 1 ? { status: 502, ok: false, text: async () => 'bad gateway' } : { status: 200, ok: true, text: async () => '{"ok":true}' }) });
  assert.deepEqual(await client.json('/x'), { ok: true });
  assert.equal(calls, 2);
  const missing = gitHubClient({ token: 't', fetch: async () => ({ status: 404, ok: false, text: async () => '{"message":"Not Found"}' }) });
  assert.equal(await missing.json('/x'), null);
  const forbidden = gitHubClient({ token: 't', fetch: async () => ({ status: 403, ok: false, text: async () => '{"message":"Resource not accessible"}' }) });
  await rejects(forbidden.json('/x'), 'remote.api', /HTTP 403: Resource not accessible/);
});
