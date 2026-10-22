# Publication phases

`release.yml` accepts an exact `main` dispatch or the `v0.3.0` tag. Source
verification runs `just vv` twice without cleanup. All existing image, native,
package, oracle, bootstrap and reproducibility gates remain required.

With `publish-crates=false`, OCI images are pushed by digest without discovery aliases.
The `sdk-oci-<source SHA>-<run ID>-<attempt>` GitHub prerelease publishes their immutable references,
native archives, supply-chain files, checksums and reproducibility results.
It does not grant SDK acceptance or claim Cargo/ecosystem completion. Distinct
executions retain distinct evidence; validated GitHub run IDs and attempts name
their publications. The same attempt may reuse only an identical public prerelease:
metadata, source tag and every
downloaded asset must match. Complete, identical drafts may resume publication;
different bytes and incomplete drafts fail closed. The workflow never deletes,
overwrites or silently repairs them. Each credentialed writer independently
checks the allowed repository, source revision, event, ref and Cargo choice.

Both native installed-SDK two-run records and their original command transcripts,
genuine product-CLI evidence, and complete browser/library logs are retained in
that same immutable publication. Deterministic USTAR archives bind each original
file; missing, substituted, aliased or over-bound inputs stop publication.
Both source `just vv` runs retain separate stdout, stderr, exit status, original
VV receipt and four bootstrap outputs. Installed SDK runs likewise retain all
four fresh bootstrap outputs per run before the next run can replace them.
Native/SDK comparisons retain all four commands and separate output streams,
including expected exit code 6; negative stdout and stderr must both agree.
Source and native records bind source, architecture, GitHub run and attempt;
native records additionally bind the immutable SDK and native archive bytes.
Failed command originals are uploaded for diagnosis, never packed as success.
After a command exits, output pipes have five seconds to drain; an orphaned
pipe holder fails capture and its owned process group receives TERM, then KILL
after five further seconds. No deadline is imposed on a running foreground gate.
Private Docker/Buildx configuration is excluded, never published as evidence.
Capture bounds are 64 MiB per metadata/stderr file, 256 MiB per original command
stdout (including the installed CLI binary), and 1 GiB per complete gate closure;
excess evidence fails, never truncates. Source revision and immutable SDK image
remain bound independently of the run-specific discovery tag.
Retaining these records does not authenticate their claims or issue SDK acceptance.

New publications upload into a draft, download and compare every asset, then
publish. Both clean OCI rebuilds must equal the shipped platform digest with
the same labels, epoch and media types. Every declared layer in both layouts
is freshly streamed through EOF and checked against its exact size and digest.
Metadata is bounded to 16 MiB; each layer to 32 GiB, with at most 4,096 layers
and 128 GiB of declared layer bytes per layout. Files must be independent,
regular and unaliased. File and directory identities are checked during reads
and again before layout acceptance. This observes custody; it does not claim
atomic filesystem isolation. Missing or damaged layers and equal but unshipped
builds fail.
Buildx 0.28.0 uses digest-pinned BuildKit 0.26.2 and its `docker-container`
driver; the default Docker driver does not support digest-only exports.

Cargo publication is a separate explicit phase. Only its success permits the
existing versioned discovery aliases and `v0.3.0` publication job. Neither phase
substitutes for the independent ecosystem acceptance contract.

Each platform's full Syft 1.51.1 SPDX bytes are a layer in an OCI 1.1 artifact
whose subject is the exact child image. Its signed manifest binds source,
platform, image index and config. Cosign 3.1.3 verifies the pinned trust root,
GitHub issuer, exact workflow/ref/trigger/name and source SHA; ORAS re-fetches
the manifest and complete SPDX, checking both digests and byte equality.
Raw SPDX, subject/config bytes, artifact manifest/record, Sigstore bundle and
verification output remain downloadable. This proves authenticated transport,
not inventory completeness, vulnerability disposition or SDK acceptance.
`release-phases.mjs sbom-verify` reconstructs the same bindings and repeats
cryptographic registry verification; a saved success file is not sufficient.
Image-index signatures use the same exact source/workflow/ref/event policy and
pinned trust root; a signature from another allowed release ref is insufficient.

Before SDK acceptance, the release path still requires twice-run verification
in the exact shipped SDK images; the
source-devcontainer runs are not that evidence. No SDK acceptance receipt or
consumer lock is changed by this workflow split.

Regression tests: `node --test scripts/release-phases.test.mjs` in the PrismPM
devcontainer. They reject missing/failed/skipped gates, Cargo coupling,
unshipped reproducible bytes, source/ref drift and changed existing releases.
Publication tests use an isolated GitHub command fixture, not live publication.
The planted self-comparison defect in the shipped-digest check failed the real
reproducibility regression; restoring the comparison restored the passing gate.
Bypassing the raw-SPDX digest comparison also failed both candidate and release
payload regressions. Real ORAS roundtrips preserve payloads exceeding 16 MiB;
real offline Sigstore fixtures test signature verification and rejection.
