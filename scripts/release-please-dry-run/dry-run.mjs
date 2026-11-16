#!/usr/bin/env node
/**
 * What the next release would be, with no writes: the pull requests release-please
 * would open, and the tag and GitHub Release body each would produce once merged.
 *
 * It runs release-please's own code at the version release-please-action bundles,
 * against the real commit history of the branch. Only two things are not real, and
 * both are read-only stand-ins: the config and manifest come from this checkout, and
 * the merged pull request handed to the tagging step is the one just built. Nothing
 * here calls a method that writes, and in CI the token has read permissions only.
 *
 *   node scripts/release-please-dry-run/dry-run.mjs [options]
 *
 *   --repo <owner/name>     default $GITHUB_REPOSITORY, then UOR-Foundation/prismpm
 *   --branch <name>         default main
 *   --config <file>         default release-please-config.json
 *   --manifest <file>       default .release-please-manifest.json
 *   --released <p=v@sha>    treat package path p as released at version v on commit sha,
 *                           for rehearsing before a tag exists; repeatable
 *   --commit <subject|path> add a commit on top of the history, for rehearsing a bump;
 *                           path defaults to .; \n in the subject starts a new line; repeatable
 *   --json                  print JSON instead of Markdown
 *
 * Exits 1 when a would-be changelog entry fails `node sdk/docs/changelog.mjs` after the
 * same normalization the workflow applies, so a pass means no hand edit is needed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Errors, GitHub, Manifest, setLogger } from 'release-please';
import { entryFor, finishReleaseEntry, releaseEntryProblems, LEGACY_THROUGH } from '../../sdk/docs/lib/changelog.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUIET = { error() {}, warn() {}, info() {}, debug() {}, trace() {} };
const inRepository = (path) => (isAbsolute(path) ? path : join(ROOT, path));

function localFile(path, branch) {
  const file = inRepository(path);
  if (!existsSync(file)) throw new Errors.FileNotFoundError(path);
  const parsedContent = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  return { sha: createHash('sha1').update(parsedContent).digest('hex'), content: Buffer.from(parsedContent).toString('base64'), parsedContent, mode: '100644', branch };
}

/** A release that does not exist yet, as releaseIterator reports one. */
export function parseReleased(spec) {
  const match = /^(.+)=(\d+\.\d+\.\d+[^@]*)@([0-9a-f]{7,40})$/.exec(spec);
  if (!match) throw new Error(`--released ${spec}: expected path=version@sha`);
  return { path: match[1], version: match[2], sha: match[3] };
}

export function parseCommit(spec, index) {
  const [subject, path = '.'] = spec.split('|');
  return { sha: `${index + 1}`.padStart(40, 'f'), message: subject.replaceAll('\\n', '\n'), files: path === '.' ? ['README.md'] : [`${path}/README.md`] };
}

/** Reads the real repository, with the stand-ins the header names. Only readers are replaced or used. */
async function rehearsalClient({ repo, branch, token, released, extraCommits, tagOf }) {
  const [owner, name] = repo.split('/');
  const github = await GitHub.create({ owner, repo: name, token, defaultBranch: branch });
  github.getFileContentsOnBranch = async (path, ref) => localFile(path, ref);
  github.getFileContents = async (path) => localFile(path, branch);

  const realReleases = github.releaseIterator.bind(github);
  github.releaseIterator = async function* (options) {
    for (const r of released) yield { name: tagOf(r), tagName: tagOf(r), sha: r.sha, notes: '', url: '' };
    yield* realReleases(options);
  };
  const realCommits = github.mergeCommitIterator.bind(github);
  github.mergeCommitIterator = async function* (target, options) {
    for (const commit of extraCommits) yield commit;
    yield* realCommits(target, options);
  };
  return github;
}

function mergedPullRequest(candidate, number) {
  return {
    headBranchName: candidate.headRefName, baseBranchName: 'main', number, sha: '0'.repeat(40), mergeCommitOid: '0'.repeat(40),
    title: candidate.title.toString(), body: candidate.body.toString(), labels: ['autorelease: pending'], files: [],
  };
}

export async function dryRun(options) {
  const config = JSON.parse(readFileSync(inRepository(options.config), 'utf8'));
  const tagOf = ({ path, version }) => {
    const settings = config.packages[path] ?? {};
    const withComponent = settings['include-component-in-tag'] ?? true;
    return `${withComponent && settings.component ? `${settings.component}-` : ''}v${version}`;
  };
  const github = await rehearsalClient({ ...options, tagOf });
  const manifest = await Manifest.fromManifest(github, options.branch, options.config, options.manifest);
  const candidates = await manifest.buildPullRequests();

  const results = [];
  for (const [index, candidate] of candidates.entries()) {
    github.pullRequestIterator = async function* (_target, status) {
      if (status === 'MERGED') yield mergedPullRequest(candidate, index + 1);
    };
    for (const release of await manifest.buildReleases()) {
      const changelog = `${release.path === '.' ? '' : `${release.path}/`}CHANGELOG.md`;
      const update = candidate.updates.find((u) => u.path === changelog);
      const before = existsSync(join(ROOT, changelog)) ? readFileSync(join(ROOT, changelog), 'utf8').replaceAll('\r\n', '\n') : '';
      const written = update ? update.updater.updateContent(before) : before;
      const normalized = finishReleaseEntry(written);
      const legacy = release.path === '.' ? LEGACY_THROUGH : '0.0.0';
      results.push({
        path: release.path,
        version: candidate.version.toString(),
        title: candidate.title.toString(),
        branch: candidate.headRefName,
        files: [...new Set(candidate.updates.map((u) => (u.path === options.manifest ? '.release-please-manifest.json' : u.path)).filter((path, i) => candidate.updates[i].createIfMissing !== false || path === '.release-please-manifest.json' || existsSync(join(ROOT, path))))],
        tag: release.tag.toString(),
        name: release.name,
        prerelease: Boolean(release.prerelease),
        body: entryFor(normalized, candidate.version.toString()),
        bodyAsWritten: release.notes,
        problemsAsWritten: releaseEntryProblems(written, legacy).map((p) => p.message),
        problems: releaseEntryProblems(normalized, legacy).map((p) => p.message),
      });
    }
  }
  return results;
}

function markdown(results) {
  if (!results.length) return 'No package has a releasable commit, so no release pull request would open.\n';
  return results.map((r) => [
    `## ${r.tag}`, '',
    `- Release pull request: \`${r.title}\` from \`${r.branch}\``,
    `- Files it changes: ${r.files.map((f) => `\`${f}\``).join(', ')}`,
    `- GitHub Release: name \`${r.name}\`, prerelease ${r.prerelease}`,
    `- Changelog check as release-please writes it: ${r.problemsAsWritten.length ? r.problemsAsWritten.join('; ') : 'passes'}`,
    `- Changelog check after normalization: ${r.problems.length ? `FAILS: ${r.problems.join('; ')}` : 'passes, no hand edit needed'}`,
    '', 'Release body:', '', '````markdown', (r.body ?? '').trim(), '````', '',
  ].join('\n')).join('\n');
}

async function main() {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.env.GITHUB_REPOSITORY || 'UOR-Foundation/prismpm' },
    branch: { type: 'string', default: 'main' },
    config: { type: 'string', default: 'release-please-config.json' },
    manifest: { type: 'string', default: '.release-please-manifest.json' },
    released: { type: 'string', multiple: true, default: [] },
    commit: { type: 'string', multiple: true, default: [] },
    json: { type: 'boolean', default: false },
  } });
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('set GITHUB_TOKEN or GH_TOKEN; read access is enough');
  setLogger(QUIET);
  const results = await dryRun({ ...values, token, released: values.released.map(parseReleased), extraCommits: values.commit.map(parseCommit) });
  process.stdout.write(values.json ? `${JSON.stringify(results, null, 2)}\n` : markdown(results));
  return results.some((r) => r.problems.length) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error) => { console.error(error.stack); process.exitCode = 2; });
}
