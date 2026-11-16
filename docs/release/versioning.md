# How a version is chosen and cut

This page serves issue [#262](https://github.com/UOR-Foundation/PrismPM/issues/262).
The policy is [STABILITY.md](../../STABILITY.md) section 2; this page says how the repository enforces it.

## The rule

Before 1.0, for the `prismpm` crate and every npm package under `sdk/npm/`:

- a version whose entry lists a breaking change is a minor bump (0.4.0 to 0.5.0);
- every other version is a patch bump (0.4.0 to 0.4.1).

## The tooling

| File | What it is |
| --- | --- |
| `release-please-config.json` | `bump-minor-pre-major: true`, `bump-patch-for-minor-pre-major: false`; one package per release unit (the root, which carries the Cargo workspace version in `Cargo.toml`, and the four npm packages); changelog sections named as the four headers. |
| `.release-please-manifest.json` | The last released version of each package. Edit it by hand when a release is tagged outside release-please. |
| `.github/workflows/release-please.yml` | Run by hand, it opens or updates release pull requests and makes their entries pass the check, or with mode `dry-run` prints what they would be. A merged release pull request starts its `tag` job, which cuts the tag and the GitHub Release. It never publishes. |
| `.github/workflows/conventional-commits.yml` | Holds the pull request title, and a lone commit's subject, to the form release-please reads. |
| `scripts/release-please-dry-run/dry-run.mjs` | Prints the pull requests, tags and release bodies release-please would produce, and writes nothing. |
| `node sdk/docs/changelog.mjs` | Holds `CHANGELOG.md` and each `sdk/npm/*/CHANGELOG.md` to the four headers and the bump rule. Runs in `docs generate` on every pull request. |

release-please reads the commit subjects since each package's last tag and proposes the next version and changelog entry in a pull request.
It sees only subjects in the form `type(scope): subject`; any other subject is skipped, so a breaking change under a free-form subject would be missed.
Write the pull request title that way (`feat(scope): ...`; a breaking change is `feat(scope)!: ...` or has a `BREAKING CHANGE:` footer), because a squash merge uses it as the subject.

## What the changelog check enforces

An entry after 0.4.0 in the root changelog, and every entry in a package changelog:

- uses only `### Features Added`, `### Breaking Changes`, `### Bugs Fixed`, `### Other Changes`, once each and in that order;
- has `### Breaking Changes` (`None.` when it breaks nothing);
- lists breaking changes only as a minor bump over the entry before it, and lists none only as a patch bump;
- has a date once it is a released version rather than `## [Unreleased]`.

The 0.1.0 entry keeps the Keep a Changelog headers it was published with (`LEGACY_THROUGH` in `sdk/docs/lib/changelog.mjs`).
`release-check` reads the dated 0.4.0 entry and the `### Compatibility` policy, which sits above the entries.

release-please writes a `⚠ BREAKING CHANGES` heading first, and nothing at all when a release breaks nothing.
`node sdk/docs/changelog.mjs --normalize <path>` fixes both and folds in `## [Unreleased]`, and the workflow runs it on each release pull request, so nobody edits the entry.
If a note under `## [Unreleased]` lists a breaking change that no commit marked with `!`, the check refuses the patch bump. Set `release-as` for that package to the minor, and remove it once the tag exists.

## Cutting a release

[RELEASES.md](../../RELEASES.md) has the policy, and [the proposal](../proposals/303-release-automation.md) has the full flow.

1. Run the `release-please` workflow from the Actions tab, with mode `open-pr`. It refuses until `v<version>` and `prism-code-v<version>` exist for the versions in the manifest. Then it opens a release pull request per package that has releasable commits, and on each branch folds `## [Unreleased]` into the new entry, normalizes the entry and updates `Cargo.lock`: release-please edits the workspace version in `Cargo.toml` but cannot edit the package array of `Cargo.lock`.
2. For a root release, make the release's own preparation changes first. `release-check` and `release.yml` name the version they release (`0.4.0` today), so each root release still needs a preparation pull request.
3. Review and merge the release pull request. Its `tag` job creates the tag and the GitHub Release, with the changelog entry as the body.
4. Publish. The new tag started no workflow, so for npm run `gh workflow run npm-prism-code.yml --ref prism-code-vX.Y.Z`. `release.yml` publishes the crates and the images, and cannot publish a root version other than `0.4.0` until the preparation in step 2 is done.
5. If a release was cut outside release-please, set the package's version in `.release-please-manifest.json` to the tagged version.

The three npm packages that have never been published (`@prism-code/spec`, `@prism-code/verify`, `create-prism-code`) have no tag yet.
Until each has one, release-please walks the whole history for it, so the manifest alone is not enough: set `bootstrap-sha` in the config to the commit of the first release.

## Options weighed

| Option | Fits | Cost |
| --- | --- | --- |
| release-please, manifest mode (chosen) | One tool for the crate and all four npm packages; computes the bump from commit subjects; the `Cargo.toml` versions are updated through `extra-files`. | Writes `CHANGELOG.md` from subjects, so entries are shorter than the hand-written ones; the breaking heading needs the edit above; free-form subjects are invisible to it. |
| `cargo-release` or `release-plz` | Compute Rust bumps. | Rust only; the npm packages stay manual. `release-plz` publishes to crates.io by default. |
| The changelog check alone, no bot | Keeps the hand-written entries. | A person chooses the bump and the check refuses a wrong one. |
