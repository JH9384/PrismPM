#!/usr/bin/env node
/**
 * Opens or updates the release pull requests, for every package whose current
 * version is already tagged.
 *
 * A release on top of a version that was never tagged would skip that version and
 * link its changelog entry to a compare page that does not exist, so such a package
 * waits. It waits alone: the root tag vVERSION is the factory's cut (release-cut.yml)
 * and can lag by days, and prism-code versions on its own tags. release-please-action
 * reads its config from the branch and cannot leave one package out, so this runs the
 * same release-please library (the version the pinned action bundles) with the config
 * narrowed in memory. The config file itself is never changed.
 *
 *   GITHUB_TOKEN=... node scripts/release-please-dry-run/open-pr.mjs [--repo owner/name] [--branch main]
 *
 * Writes `prs` and `prs_created` to $GITHUB_OUTPUT in the shape release-please-action
 * gives them. Exits 1 when no package can be released.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = 'release-please-config.json';
const MANIFEST = '.release-please-manifest.json';

/** The packages whose last version must be tagged before a release builds on it. */
export const GUARDED = ['.', 'sdk/npm/prism-code'];

/** The tag release-please gives a package's version under this config. */
export function tagOf(config, path, version) {
  const settings = config.packages[path] ?? {};
  const withComponent = settings['include-component-in-tag'] ?? config['include-component-in-tag'] ?? true;
  const v = (settings['include-v-in-tag'] ?? config['include-v-in-tag'] ?? true) ? 'v' : '';
  return `${withComponent && settings.component ? `${settings.component}-` : ''}${v}${version}`;
}

/** The config with each guarded package whose tag is missing left out, and what was left out. */
export function narrow(config, manifest, tagExists) {
  const waiting = GUARDED
    .map((path) => ({ path, tag: tagOf(config, path, manifest[path]) }))
    .filter(({ tag }) => !tagExists(tag));
  const packages = Object.fromEntries(Object.entries(config.packages).filter(([path]) => !waiting.some((w) => w.path === path)));
  if (!Object.keys(packages).length) throw new Error('no package can be released: every one waits for its tag');
  return { config: { ...config, packages }, waiting };
}

/**
 * The release branches whose merged pull requests release-please never tags: a package
 * with skip-github-release gets its tag from the factory's cut (release-cut.yml), so its
 * merged pull request keeps the label `autorelease: pending` for good. Left in, it would
 * make release-please refuse every other package's release pull request.
 */
export function factoryCutBranches(config, targetBranch) {
  return Object.values(config.packages)
    .filter((settings) => settings['skip-github-release'] ?? config['skip-github-release'])
    .map((settings) => `release-please--branches--${targetBranch}--components--${settings.component}`);
}

async function main() {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.env.GITHUB_REPOSITORY || 'UOR-Foundation/prismpm' },
    branch: { type: 'string', default: 'main' },
  } });
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('set GITHUB_TOKEN or GH_TOKEN');
  const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  const [owner, repo] = values.repo.split('/');

  const { GitHub, Manifest } = await import('release-please');
  const github = await GitHub.create({ owner, repo, token, defaultBranch: values.branch });
  const tags = new Set();
  for (const { tag } of GUARDED.map((path) => ({ tag: tagOf(read(CONFIG), path, read(MANIFEST)[path]) }))) {
    try {
      await github.octokit.git.getRef({ owner, repo, ref: `tags/${tag}` });
      tags.add(tag);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  const { config, waiting } = narrow(read(CONFIG), read(MANIFEST), (tag) => tags.has(tag));
  for (const { path, tag } of waiting) console.log(`::warning::${path} waits: tag ${tag} does not exist, so no release pull request builds on it`);

  // Only the config is replaced, and only in memory; every other file is read from the branch.
  const real = github.getFileContentsOnBranch.bind(github);
  github.getFileContentsOnBranch = async (path, branch) => {
    if (path !== CONFIG) return real(path, branch);
    const parsedContent = JSON.stringify(config, null, 2);
    return { sha: '', mode: '100644', branch, parsedContent, content: Buffer.from(parsedContent).toString('base64') };
  };
  const manifest = await Manifest.fromManifest(github, values.branch, CONFIG, MANIFEST);
  const factoryCut = new Set(factoryCutBranches(read(CONFIG), values.branch));
  const merged = manifest.findMergedReleasePullRequests.bind(manifest);
  manifest.findMergedReleasePullRequests = async function* () {
    for await (const pr of merged()) if (!factoryCut.has(pr.headBranchName)) yield pr;
  };
  // release-please returns no pull request, with only a log line, when it refuses; a
  // refusal must fail the run instead of reading as nothing to release.
  const build = manifest.buildPullRequests.bind(manifest);
  let built = 0;
  manifest.buildPullRequests = async () => { const candidates = await build(); built = candidates.length; return candidates; };
  const prs = (await manifest.createPullRequests()).filter(Boolean);
  if (built > prs.length) throw new Error(`release-please built ${built} release pull requests and opened ${prs.length}: read its warnings above`);
  for (const pr of prs) console.log(`release pull request #${pr.number} from ${pr.headBranchName}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `prs_created=${prs.length > 0}\nprs=${JSON.stringify(prs)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`::error::${error.message}`); process.exitCode = 1; });
}
