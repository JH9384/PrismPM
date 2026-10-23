# Publishing the PrismPM crates to crates.io

This serves issue [#214](https://github.com/UOR-Foundation/PrismPM/issues/214).
It states what is checked before any upload, what the owner runs for the first
upload, how `release.yml` uploads afterwards, and a proposal for the versions of
crates imported by commit. Nothing has been uploaded. The first upload of each
name is the owner's: trusted publishing can be configured only for a crate that
exists ([#19](https://github.com/UOR-Foundation/PrismPM/issues/19)).

## State on 2026-10-23

None of `prism-stdlib`, `prismpm`, `lexlean`, `prod-ir`, `prod-codegen` or
`prism-calculator` exists on crates.io, so the names are free
(`https://crates.io/api/v1/crates/<name>` answers "does not exist" for each).

## The crates, in upload order

| Order | Crate | Version | Published from | The bytes that must match |
| --- | --- | --- | --- | --- |
| 1 | `prod-ir` | 0.1.0 | this repository, `vendor/lean4-prod/rust/prod-ir` | `vendor/lean4-prod/crates/prod-ir-0.1.0.crate`, sha256 `7cffc025…cdc21` |
| 2 | `prod-codegen` | 0.1.0 | this repository, `vendor/lean4-prod/rust/prod-codegen` | `vendor/lean4-prod/crates/prod-codegen-0.1.0.crate`, sha256 `29270825…09148` |
| 3 | `lexlean` | 0.3.0 | the LexLean repository ([LexLean#260](https://github.com/UOR-Foundation/LexLean/issues/260)) | `vendor/lexlean/lexlean-0.3.0.crate`, sha256 `6d235250…3e248`, cut from LexLean `cee0fbade` |
| 4 | `prism-stdlib` | 0.2.0 | this repository, `stdlib/generated/package` | `stdlib/generated/prism-stdlib-0.2.0.crate`, sha256 `58f398f5…52bca` |
| 5 | `prismpm` | 0.3.0 | this repository, `crates/prismpm` | none: nothing embeds it; it is packaged again once 1 to 4 are public |

The order is the dependency order: `prod-codegen` depends on `prod-ir`, and
`prismpm` depends on the other four. `prism-calculator` is not a crate of this
repository. It is the package `prismpm build` generates from
`tests/browser-system`, shipped as a release asset of the calculator reference
(`README.md`, "cargo/prism-calculator-0.1.0.crate"); publishing it is a separate
decision that this change does not make.

## What is checked before the owner uploads

`just package-release-crates-check` (a gate of `just vv`) now requires, for the
four crates of this repository:

1. **Reviewed bytes.** The crates `cargo package` builds in a clean stage are
   byte-identical to the three archives above (`cmp`), as before.
2. **The crate the SDK embeds.** `crates/prismpm/src/application_build.rs`
   includes `stdlib/generated/prism-stdlib-0.2.0.crate`, and `prismpm build`
   writes exactly those bytes into its private registry. The packaged crate, that
   file and the `crate_sha256` of `stdlib/release.json` are the same bytes. This
   is the acceptance criterion of #214: the crate on crates.io is the crate the SDK
   embeds. `package-release-crates.sh --identity CRATE` runs this check alone.
3. **A dry run.** `cargo publish --dry-run` for each crate, in upload order,
   repackages to the bytes of step 1. `prismpm` is dry-run with its four
   dependencies taken from the vendored copies through `--config patch.crates-io`,
   because cargo does not read a patch in a manifest when it prepares a package,
   and `cargo package -p prismpm` otherwise stops at "no matching package named
   `lexlean`". Its archive therefore lacks the registry checksums of those four in
   `Cargo.lock`, and the release job packages it again once they are public.
4. **What crates.io needs from each archive.** `scripts/crate-metadata-check.sh`
   reads the manifest cargo wrote into the archive: a description, a license, a
   repository, the readme the manifest names, and at most 10 MiB. `prismpm` is
   5.1 MiB compressed. All five manifests already carried what crates.io needs, so
   none was edited; `prod-ir` and `prod-codegen` name `github.com/auser/lean4-prod`
   as their repository, which cannot change without changing the pinned archives.

`release.yml`'s `crates` job runs the same sequence on a release tag, inside the
SDK image it releases: `cargo package`, `cmp` with the reviewed archive, the dry
run, the unchanged-bytes check after it, the metadata check, and only then the
upload.

## The upload: three modes

| Credential | What `crates` does |
| --- | --- |
| none | packages, compares, dry-runs and checks every crate, prints each digest, uploads nothing, and succeeds, so `release` is not held for an upload |
| `CARGO_REGISTRY_TOKEN` secret in the `crates.io` environment | the same, then uploads in order and waits until crates.io serves the same bytes |
| repository variable `CRATES_IO_TRUSTED_PUBLISHING` = `true` | the same, with a short-lived token from trusted publishing; for use once the owner has configured it for all five names |

With a credential the job also waits for `lexlean 0.3.0` before the crates that
need it, as before.

## What the owner runs

From a clean checkout of reviewed `main`, with the token in the environment of
this one command (cargo reads it; the script never stores or prints it):

```bash
CARGO_REGISTRY_TOKEN=<token> ./scripts/package-release-crates.sh --publish
```

It repeats every check above, refuses a dirty tree, uploads `prod-ir`,
`prod-codegen` and `prism-stdlib` after waiting for each to appear on crates.io
with the same SHA-256, requires `lexlean 0.3.0` to be public with the digest of
the vendored copy, and then packages and uploads `prismpm`. A version that is
already public with the same bytes is skipped; with other bytes the run stops.

`lexlean` comes first from the LexLean repository, and that has an open
question. PrismPM embeds the crate cut from LexLean `cee0fbade`, which is
version 0.3.0. The head of LexLean's `release/v0.4` has moved on and still says
0.3.0, so uploading from the head would claim `0.3.0` for bytes that this SDK
does not embed, and `--publish` refuses. The owner chooses between uploading
that exact crate (`git checkout cee0fbade`, then `cargo publish -p lexlean` in
the LexLean repository), or skipping `0.3.0`, importing a pre-release of LexLean
below, and uploading PrismPM against that. The second matches how LexLean#260
plans to number its crates, and is the recommendation.

After the uploads, configure trusted publishing for the five names, set
`CRATES_IO_TRUSTED_PUBLISHING`, and delete the token.

## Proposal: versions of crates imported by commit

Development imports upstream commits and a release pins only upstream releases
([#211](https://github.com/UOR-Foundation/PrismPM/issues/211)). Every template
instance admits only crates.io (`deny.toml`), so a commit import can only be a
published pre-release. This is a proposal, not something the code enforces.

- **Form.** `<next release>-dev.<n>`, for example `0.4.0-dev.1234`, where `n` is
  `git rev-list --first-parent --count <commit>` on the line the commit is on.
  `n` is the same for every clone, grows with each landing, and orders the
  versions. The pre-release sorts below `0.4.0`, so the release supersedes every
  one of them, and cargo selects a pre-release only for a requirement that names
  one, so `=0.4.0-dev.1234` is how a consumer pins it.
- **Not build metadata.** `0.4.0+<sha>` would put the commit in the version, but
  cargo ignores build metadata when it matches a requirement, so a consumer could
  not pin the commit with it. The commit is recoverable from the crate itself:
  cargo records it in `.cargo_vcs_info.json` inside every packaged crate, as in
  the `lexlean-0.3.0.crate` above.
- **Where the version must live.** In the bytes. `prism-stdlib` is embedded by the
  SDK, so the SDK must embed the pre-release-numbered archive, which means the
  stdlib generator takes the version, and `m0-lexlean-reconcile.yml` takes the
  LexLean version when it vendors a LexLean pre-release. Neither is changed here.
  Until they are, the job and `--publish` upload the versions the manifests
  carry, and the pre-release scheme is a reading of what those manifests should
  say at an import.
- **Release.** A release pins releases: `0.4.0` of PrismPM pins `lexlean 0.4.0`.

## Not verified

`release.yml` has never run, and this change does not run it. The `crates` job is
tested by reading its structure, with eleven planted changes and a `bash -n` of
its script (`scripts/release-phases.test.mjs`); its commands were not executed as
a job. What was executed, on the same archives and with the same cargo commands, is
`package-release-crates.sh --check` (offline) and `--dry-run` (online, no
credential), both exiting 0 on 2026-10-23. `--publish` is tested for its refusals
only. No upload was attempted, and no token was requested or stored.
