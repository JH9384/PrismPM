import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedTypes, checkPullRequest, subjectProblem } from './conventional-commits.mjs';

test('the subjects this repository already writes conform', () => {
  for (const subject of [
    'fix(test): make the standalone browser owners pass under LexLean 0.4 (V&V blocker) (#404)',
    'docs(release): tag-prep for v0.4.0 and the prism-code 0.3.0 npm release (Part of #194) (#399)',
    'feat(spec,prism-code): provenance statement for every built holo (part 1 of #268) (#359)',
    'build(release): admit PrismPM 0.4.0 in the release machinery (#194) (#381)',
    'ci: run V&V as three parts and trim repeated checks',
    'feat(holo)!: canonical v4 container frame',
    'chore(main): release 0.4.1',
    'revert: feat(holo): canonical v4 container frame',
  ]) assert.equal(subjectProblem(subject), null, subject);
});

test('a free-form subject, an unknown type and a malformed scope are refused', () => {
  assert.match(subjectProblem('ADR-016: .holo normative home'), /not "type\(scope\): subject"/);
  assert.match(subjectProblem('Store blake3-vectors.json with LF endings (#370)'), /not "type\(scope\): subject"/);
  assert.match(subjectProblem('wip: release-please config'), /"wip" is not a type/);
  assert.match(subjectProblem('feat(Holo): capital scope'), /scope "Holo"/);
  assert.match(subjectProblem('feat(): empty scope'), /scope ""/);
  assert.match(subjectProblem('feat:  two spaces'), /must start with text/);
  assert.match(subjectProblem('feat: '), /must start with text/);
});

test('the accepted types are the changelog types, so a type cannot reach main and vanish from the log', () => {
  assert.deepEqual(allowedTypes({ 'changelog-sections': [{ type: 'feat' }, { type: 'fix' }, { type: 'fix' }] }), ['feat', 'fix']);
  for (const type of ['feat', 'fix', 'docs', 'ci', 'chore', 'revert']) assert.ok(allowedTypes().includes(type), type);
});

test('the title always has to conform', () => {
  const { errors } = checkPullRequest({ title: 'Add a thing', commits: ['feat: add a thing', 'fix: and fix it'] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /pull request title/);
});

test('a lone commit has to conform, because a squash merge keeps its subject over the title', () => {
  const { errors } = checkPullRequest({ title: 'feat(holo): add a thing', commits: ['add a thing'] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /only commit/);
  assert.deepEqual(checkPullRequest({ title: 'feat(holo): add a thing', commits: ['feat(holo): add a thing\n\nBody.'] }).errors, []);
});

test('merge commits do not count, and other subjects in a longer pull request only warn', () => {
  const merged = checkPullRequest({ title: 'feat: a', commits: ['feat: a', "Merge branch 'main' into topic"] });
  assert.deepEqual(merged, { errors: [], warnings: [] });
  const longer = checkPullRequest({ title: 'feat: a', commits: ['feat: a', 'wip: more'] });
  assert.deepEqual(longer.errors, []);
  assert.equal(longer.warnings.length, 1);
});
