import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../lib/generate.mjs';
import { prismCode } from '../lib/runtime.mjs';
import { loadSpec } from '../lib/spec.mjs';
import { writeOutput } from '../generate.mjs';
import { branchReadme, stage } from '../publish.mjs';

const publish = fileURLToPath(new URL('../publish.mjs', import.meta.url));
const spec = await loadSpec();
const files = await render({ spec, runtime: prismCode() });

test('stage writes the branch README and publishes only when a page changed', () => {
  const root = mkdtempSync(join(tmpdir(), 'prism-docs-publish-'));
  try {
    const commit = 'a'.repeat(40);
    const site = join(root, 'site');
    writeOutput(files, site);
    const first = stage(site, { commit, repository: 'o/r' });
    assert.equal(first.changed, true, 'no previous branch: publish');
    assert.equal(readFileSync(join(site, 'README.md'), 'utf8'), branchReadme({ commit, repository: 'o/r' }));
    assert.match(branchReadme({ commit, repository: 'o/r' }), /Do not edit it/);

    // The previous branch: same pages, generated from another commit, with its own README.
    const previous = join(root, 'previous');
    cpSync(site, previous, { recursive: true });
    for (const rel of ['reference/holo-format.md', 'README.md']) {
      writeFileSync(join(previous, rel), readFileSync(join(previous, rel), 'utf8').replaceAll(spec.commit, 'b'.repeat(40)).replaceAll(commit, 'b'.repeat(40)));
    }
    const same = stage(site, { commit, repository: 'o/r', previous });
    assert.equal(same.changed, false, 'only the commit stamps differ');

    writeFileSync(join(previous, 'guides', 'ship.md'), 'an older page\n');
    rmSync(join(previous, 'sdks', 'rust.md'));
    const changed = stage(site, { commit, repository: 'o/r', previous });
    assert.deepEqual([changed.changed, changed.modified, changed.added], [true, ['guides/ship.md'], ['sdks/rust.md']]);

    const cli = spawnSync(process.execPath, [publish, site, '--commit', commit, '--previous', previous], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout, 'changed=true\n');
    assert.match(cli.stderr, /changed: guides\/ship\.md/);

    assert.throws(() => stage(site, { commit: 'abc', repository: 'o/r' }), /full commit id/);
    writeFileSync(join(site, 'stray.md'), 'x\n');
    assert.throws(() => stage(site, { commit, repository: 'o/r' }), /not the docs site layout: unexpected stray\.md/);
    rmSync(join(site, 'stray.md'));
    rmSync(join(site, 'llms.txt'));
    assert.throws(() => stage(site, { commit, repository: 'o/r' }), /missing llms\.txt/);
    assert.ok(existsSync(join(site, 'README.md')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
