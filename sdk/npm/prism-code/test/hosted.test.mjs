// The hosted tiers: which projects the prism-app profile can take, the MCP exchange with a stand-in server,
// the coverage rule that keeps an answer about other modules from passing, and where the CLI routes a tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTED_PROFILE, HOSTED_RECORD_SCHEMA, formatDiagnostics, hostedCheck, hostedClient, hostedProject, hostedVerify, moduleOf, readLexleanToml, writeHostedRecord } from '../src/hosted.mjs';

// Gap telemetry (src/gaps.mjs) keeps its ledger under PRISM_HOME: keep what these tests record out of the developer's own.
process.env.PRISM_HOME = mkdtempSync(join(tmpdir(), 'prism-home-'));

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const template = fileURLToPath(new URL('../templates/text-request', import.meta.url));
const IMAGE = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:36da25ef924d84899453f24ec0c117a7a220e708037933eb8b499caa7723d99e';
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-hosted-'));
const PROFILE = { id: 'p1', name: HOSTED_PROFILE, roots: ['src'], packages: [{ package: 'lexlean.core' }, { package: 'lexlean.std.nat' }, { package: 'prism.arch' }] };

/** A copy of the init template, which has the shape the profile takes. */
function instance() {
  const dir = join(scratch(), 'app');
  cpSync(template, dir, { recursive: true });
  return dir;
}

/**
 * A stand-in for the server: answers each tool from `tools`, and each `tasks/get` from `polls` in turn.
 * Records every request. `statuses` are HTTP statuses to answer before the real answer.
 */
function server({ tools = {}, polls = [], statuses = [] } = {}) {
  const seen = [];
  const fetch = async (_url, { headers, body }) => {
    const request = JSON.parse(body);
    seen.push({ method: request.method, name: headers['mcp-name'], params: request.params });
    if (statuses.length > 0) return { status: statuses.shift(), text: async () => 'bad gateway' };
    let result;
    if (request.method === 'tasks/get') result = polls.shift();
    else result = tools[request.params.name](request.params.arguments);
    // The gateway answers some calls as a stream; the last event with an id is the answer.
    const text = request.method === 'tasks/get' ? `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n\n` : JSON.stringify({ jsonrpc: '2.0', id: request.id, result });
    return { status: 200, text: async () => text };
  };
  return { seen, client: hostedClient({ url: 'https://lexlean.example.test/', fetch, sleep: async () => {}, retryMs: 0 }) };
}

const profiles = () => ({ structuredContent: { profiles: [PROFILE] } });
const draftWrite = (args) => ({ structuredContent: { draft: `prism-app/${args.files.length}files` } });
const verified = (modules) => ({ taskId: 't1', status: 'completed', result: { content: [{ type: 'text', text: JSON.stringify({ attestation_id: 'a'.repeat(64), build_id: 'b', keyid: 'k', modules, semantic_id: 's', source_id: 'o' }) }], structuredContent: { state: 'verified' } } });

test('a module is named by its path under src/', () => {
  assert.equal(moduleOf('src/Foundation/Bytes.lex.tex'), 'Foundation.Bytes');
  assert.equal(moduleOf('src/TextRequest.lex.tex'), 'TextRequest');
  assert.equal(moduleOf('lib/TextRequest.lex.tex'), null);
  assert.equal(moduleOf('src/notes.md'), null);
});

test('lexlean.toml: the top-level keys and the package of every [[lexicon_source]]', () => {
  const config = readLexleanToml('spec = "lexlean/project/1"\r\nsource_roots = ["src"]\nentrypoints = ["src/A.lex.tex"]\n\n[[lexicon_source]]\npackage = "lexlean.std.nat"\nkind = "builtin"\n\n[limits]\npackage = "not a lexicon"\n\n[[lexicon_source]]\npackage = "prism.arch" # local\npath = "language/prism.arch"\n');
  assert.deepEqual(config.source_roots, ['src']);
  assert.deepEqual(config.entrypoints, ['src/A.lex.tex']);
  assert.deepEqual(config.lexicon_source.map((s) => s.package), ['lexlean.std.nat', 'prism.arch']);
});

test('the init template has the shape the hosted profile takes; other shapes are hosted.layout', () => {
  const project = hostedProject(instance());
  assert.deepEqual(project.entrypoints, ['src/TextRequest.lex.tex']);
  assert.deepEqual(project.packages, ['lexlean.std.nat', 'prism.arch']);
  assert.ok(project.files.every((f) => f.path.startsWith('src/')), 'only the files under src/ are sent');
  assert.ok(project.files.some((f) => f.path === 'src/Foundation/Bytes.lex.tex'));

  const roots = instance();
  writeFileSync(join(roots, 'lexlean.toml'), readFileSync(join(roots, 'lexlean.toml'), 'utf8').replace('source_roots = ["src"]', 'source_roots = ["src", "extra"]'));
  assert.throws(() => hostedProject(roots), (e) => e.code === 'hosted.layout' && /source_roots/.test(e.message));
  const entry = instance();
  writeFileSync(join(entry, 'lexlean.toml'), readFileSync(join(entry, 'lexlean.toml'), 'utf8').replace('src/TextRequest.lex.tex', 'src/Missing.lex.tex'));
  assert.throws(() => hostedProject(entry), (e) => e.code === 'hosted.layout' && /Missing\.lex\.tex is not in src/.test(e.message));
  assert.throws(() => hostedProject(scratch()), (e) => e.code === 'hosted.layout');
});

test('a hosted verify sends the entrypoints, polls the task and returns the record when they are verified', async () => {
  const project = hostedProject(instance());
  const { seen, client } = server({
    tools: { lexlean_profiles: profiles, lexlean_draft_write: draftWrite, lexlean_verify: () => ({ taskId: 't1', status: 'working', pollIntervalMs: 5000 }) },
    polls: [{ taskId: 't1', status: 'working' }, verified(['Foundation.Bytes', 'TextRequest'])],
  });
  const outcome = await hostedVerify(client, project);
  assert.equal(outcome.state, 'verified');
  assert.equal(outcome.record.attestation_id, 'a'.repeat(64));
  const verify = seen.find((r) => r.name === 'lexlean_verify');
  assert.deepEqual(verify.params.arguments.files, ['src/TextRequest.lex.tex'], 'the project names what is verified, not the profile');
  assert.ok(verify.params._meta['io.modelcontextprotocol/clientCapabilities'].extensions['io.modelcontextprotocol/tasks'], 'verify runs as a task');
  assert.equal(seen.filter((r) => r.method === 'tasks/get').length, 2);

  const dir = scratch();
  const path = writeHostedRecord(dir, { ...outcome, url: client.url, entrypoints: project.entrypoints }, { now: () => new Date('2026-11-06T00:00:00Z') });
  assert.equal(path, join(dir, '.lexlean', 'hosted', `${'a'.repeat(64)}.json`));
  const record = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(record.schema, HOSTED_RECORD_SCHEMA);
  assert.equal(record.server, 'https://lexlean.example.test/');
  assert.deepEqual(record.profile, { name: HOSTED_PROFILE, id: 'p1' });
  assert.deepEqual(record.modules, ['Foundation.Bytes', 'TextRequest']);
});

test('planted: an answer about other modules is hosted.coverage, never a pass', async () => {
  // What the server answered for the chess referee when no files were named: its profile's own entrypoint.
  const { client } = server({
    tools: { lexlean_profiles: profiles, lexlean_draft_write: draftWrite, lexlean_verify: () => verified(['Contract', 'Foundation.Bytes']) },
  });
  await assert.rejects(hostedVerify(client, hostedProject(instance())), (e) => e.code === 'hosted.coverage' && /not the entrypoint module TextRequest; nothing about this project was proved/.test(e.message));
});

test('a refused proof returns its diagnostics; a missing package and a lost server are refusals', async () => {
  const failed = { taskId: 't1', status: 'completed', result: { content: [{ type: 'text', text: JSON.stringify({ command: 'verify', diagnostics: [{ code: 'LLV7002', message: 'Lean rejected `X` (error): unsolved goals\nmore' }] }) }], structuredContent: { state: 'failed' } } };
  const refused = server({ tools: { lexlean_profiles: profiles, lexlean_draft_write: draftWrite, lexlean_verify: () => failed } });
  const outcome = await hostedVerify(refused.client, hostedProject(instance()));
  assert.equal(outcome.state, 'failed');
  assert.equal(outcome.diagnostics[0].code, 'LLV7002');

  const narrow = server({ tools: { lexlean_profiles: () => ({ structuredContent: { profiles: [{ ...PROFILE, packages: [{ package: 'lexlean.core' }] }] } }) } });
  await assert.rejects(hostedVerify(narrow.client, hostedProject(instance())), (e) => e.code === 'hosted.layout' && /lexlean\.std\.nat, prism\.arch/.test(e.message));
  assert.equal(narrow.seen.some((r) => r.name === 'lexlean_draft_write'), false, 'nothing is sent when the profile cannot take it');

  const down = server({ statuses: [502, 502, 502] });
  await assert.rejects(hostedVerify(down.client, hostedProject(instance())), (e) => e.code === 'hosted.unreachable');
  assert.equal(down.seen.length, 3, 'a 502 is tried twice more, then refused');
});

test('a 502 is tried again, and a hosted check returns the command result', async () => {
  const { seen, client } = server({
    statuses: [502],
    tools: { lexlean_profiles: profiles, lexlean_draft_write: draftWrite, lexlean_check: (args) => ({ structuredContent: { command: 'check', success: true, diagnostics: [], modules: ['TextRequest'], args } }) },
  });
  const { outcome } = await hostedCheck(client, hostedProject(instance()));
  assert.equal(outcome.success, true);
  assert.deepEqual(Object.keys(outcome.args), ['project'], 'no all and no files: the server selects the draft\'s own files, not the profile\'s Contract');
  assert.equal(seen[0].name, 'lexlean_profiles');
});

test('routing from app/: the lockfile at the repository root is found, so the local tier has its image, and only --hosted sends anything (dry run)', () => {
  // A template instance: prismpm.lock at the root, the LexLean project in app/, where the user runs the tiers.
  const dir = scratch();
  mkdirSync(join(dir, '.git'));
  cpSync(template, join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'prismpm.lock'), JSON.stringify({ sdk_image: IMAGE }));
  const env = { ...process.env, PRISM_CODE_DRY_RUN: '1', PRISM_HOME: join(scratch(), '.prism') };
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: join(dir, 'app'), env, encoding: 'utf8' });

  const local = run('verify', '--lean', '--local');
  assert.equal(local.status, 0, local.stderr);
  assert.match(local.stdout, /prismpm-sdk@sha256:36da25ef[0-9a-f]{56} lexlean verify --project /, 'the image comes from ../prismpm.lock');
  // Planted defect G9: the SDK image is not on this machine. Nothing is sent: the tier stays local.
  const lean = run('verify', '--lean');
  assert.doesNotMatch(lean.stderr + lean.stdout, /hosted verifier|mcp\.uor\.foundation/);
  assert.match(lean.stdout, /prismpm-sdk@sha256:36da25ef[0-9a-f]{56} lexlean verify --project /);
  const check = run('build', '--check');
  assert.doesNotMatch(check.stderr + check.stdout, /hosted verifier|mcp\.uor\.foundation/);
  assert.match(run('build', '--check', '--hosted').stderr, /^build --check: lexlean check on the hosted verifier https:\/\/mcp\.uor\.foundation\/ \(profile prism-app\), because --hosted asked for it: sending 4 files under src\//);

  // Above the repository's root nothing is looked for.
  const outer = scratch();
  writeFileSync(join(outer, 'prismpm.lock'), JSON.stringify({ sdk_image: IMAGE }));
  const repo = join(outer, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  cpSync(template, join(repo, 'app'), { recursive: true });
  const alone = spawnSync(process.execPath, [bin, 'build', '--check'], { cwd: join(repo, 'app'), env, encoding: 'utf8' });
  assert.equal(alone.status, 64, alone.stderr);
  assert.match(alone.stderr, /^prismpm\.lock not found here or above\. build --check runs on this machine.*Pass --hosted/);
});

test('a refused proof prints where: file, line and column, the whole goal under it, and long goals cut', () => {
  const goal = Array.from({ length: 30 }, (_, i) => `  x${i} : Nat`).join('\n');
  const text = formatDiagnostics([
    { code: 'LLV7002', message: `Lean rejected \`PrismTemplateContract.LeapRule\` (error): omega could not prove the goal:\n${goal}\n`, primary: { path: 'src/LeapRule.lex.tex', line_start: 41, column_start: 3 } },
    { code: 'LLV1001', message: 'no place', primary: null },
  ], { dir: 'app' });
  const lines = text.split('\n');
  assert.equal(lines[0], '  app/src/LeapRule.lex.tex:41:3: LLV7002 Lean rejected `PrismTemplateContract.LeapRule` (error): omega could not prove the goal:');
  assert.equal(lines[1], '      x0 : Nat', 'the goal follows the colon');
  assert.equal(lines[19], '      x18 : Nat');
  assert.equal(lines[20], '    ... 11 more lines');
  assert.equal(lines[21], '  LLV1001 no place');
  assert.equal(formatDiagnostics([{ code: 'X', message: 'm', primary: { path: 'src/A.lex.tex', line_start: 7 } }]), '  src/A.lex.tex:7: X m');
});

test('--help after a verb prints that verb and touches no Docker and no lockfile', () => {
  const dir = scratch();
  // A Docker that cannot run: reaching it would fail the command.
  const env = { ...process.env, PRISM_HOME: join(scratch(), '.prism'), PRISM_DOCKER: join(dir, 'no-such-docker') };
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, env, encoding: 'utf8' });
  for (const [args, shows] of [
    [['build', '--help'], /^  prism-code build --check .*\n[\s\S]*  prism-code build --remote github /],
    [['build', '--remote', 'github', '--help'], /--allow-dirty/],
    [['build', '--check', '-h'], /proofs are not|syntax and types, not proofs/],
    [['verify', '--help'], /^  prism-code verify \[args\][\s\S]*  prism-code verify --lean /],
    [['setup', '--help'], /^  prism-code setup [\s\S]*Options for setup: {4}--agent <id>[\s\S]*--pull /],
    [['axioms', '--help'], /^  prism-code axioms /],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stdout, shows, args.join(' '));
    assert.doesNotMatch(r.stdout, /prism-code verify-attestation|prism-code inspect /, `${args.join(' ')} prints only its own verb`);
    assert.equal(r.stderr, '', `${args.join(' ')} says nothing about an image or a lockfile`);
  }
  assert.doesNotMatch(run('build', '--help').stdout, /unstable-author/, 'the author route is gone');
  const author = run('build', '--unstable-author');
  assert.equal(author.status, 64, 'G8 planted defect: an agent writing the model is refused');
  assert.match(author.stderr, /unknown option --unstable-author/);
});

test('routing: every tier runs on this machine unless --hosted asks, and lexlean flags stay local (dry run)', () => {
  const dir = scratch();
  cpSync(template, join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'prismpm.lock'), JSON.stringify({ sdk_image: IMAGE }));
  const env = { ...process.env, PRISM_CODE_DRY_RUN: '1', PRISM_HOME: join(scratch(), '.prism') };
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: dir, env, encoding: 'utf8' });

  // Planted defect G9: no image on this machine. Before, verify --lean sent src/ to the hosted verifier on its own.
  const lean = run('verify', '--lean');
  assert.equal(lean.status, 0, lean.stderr);
  assert.match(lean.stdout, /prismpm-sdk@sha256:[0-9a-f]{64} lexlean verify --project /);
  assert.doesNotMatch(lean.stderr + lean.stdout, /hosted verifier|hosted lexlean|mcp\.uor\.foundation/);

  const hosted = run('verify', '--lean', '--hosted');
  assert.equal(hosted.status, 0, hosted.stderr);
  assert.match(hosted.stdout, /^hosted lexlean_verify https:\/\/mcp\.uor\.foundation\/ profile prism-app files src\/TextRequest\.lex\.tex\n$/);
  assert.match(hosted.stderr, /, because --hosted asked for it: sending the 4 files under app\/src\/, which the server stores unlisted: not searchable, but readable by anyone with the draft's ID; --local verifies in the SDK image instead/);
  assert.match(run('verify', '--lean', '--hosted', '--all').stdout, /files src\/Foundation\/Bytes\.lex\.tex .*src\/TextRequest\.lex\.tex/);
  assert.match(run('verify', '--lean', '--local').stdout, /prismpm-sdk@sha256:[0-9a-f]{64} lexlean verify --project /);
  assert.match(run('verify', '--lean', '--trace').stdout, / lexlean verify --project .* --trace\n$/, 'a lexlean flag runs where lexlean is');
  assert.equal(run('verify', '--lean', '--hosted', '--trace').status, 64, 'a lexlean flag is refused when hosted was asked for');
  assert.equal(run('verify', '--lean', '--hosted', '--local').status, 64);

  const check = run('build', '--check');
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, / prismpm check\n$/);
  assert.doesNotMatch(check.stderr + check.stdout, /hosted verifier|hosted lexlean|mcp\.uor\.foundation/);
  const hostedCheck = run('build', '--check', '--hosted');
  assert.equal(hostedCheck.status, 0, hostedCheck.stderr);
  assert.match(hostedCheck.stdout, /hosted lexlean_check https:\/\/mcp\.uor\.foundation\/ profile prism-app draft\nskipped  prismpm check: the lockfile and its SDK pins are checked only in the image; run without --hosted to check them there/);
  assert.match(run('build', '--check', '--local').stdout, / prismpm check\n$/);
  assert.match(run('build', '--check', '--verbose').stdout, / prismpm check --verbose\n$/);
  assert.match(run('verify').stdout, / prismpm verify\n$/, 'a full verify always needs the image');

  const layout = join(dir, 'app', 'lexlean.toml');
  writeFileSync(layout, readFileSync(layout, 'utf8').replace('source_roots = ["src"]', 'source_roots = ["model"]'));
  mkdirSync(join(dir, 'app', 'model'), { recursive: true });
  const refused = run('verify', '--lean', '--hosted');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /hosted\.layout: source_roots is \["model"\].*\nThis project cannot be verified on the hosted verifier; run it in the SDK image with --local/);
});
