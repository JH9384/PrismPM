# Security policy

## Report a vulnerability

Do not open a public issue.

Report it privately through [GitHub private vulnerability reporting](https://github.com/UOR-Foundation/PrismPM/security/advisories/new) on this repository.

Include the affected package and version, what an attacker can do, and how to reproduce it.
A failing `.holo`, model or command is the most useful thing you can send.

## Supported versions

| Version | Security fixes |
| --- | --- |
| Latest minor of each package | Yes |
| Anything older | No, upgrade to the latest minor |

From 1.0 on, the latest minor of the previous major also gets security fixes for twelve months after the next major ships.
[RELEASES.md](RELEASES.md) has the full support windows.

Nothing is Stable yet, as [STABILITY.md](STABILITY.md) section 5 says.
A security fix may change an Experimental surface in any release.

## What happens next

These are the timelines of the [foundation's security policy](https://github.com/UOR-Foundation/.github/blob/main/SECURITY.md), which covers this repository.

| Severity | Acknowledge | Triage | Patch released | Public disclosure |
| --- | --- | --- | --- | --- |
| Critical | 24 hours | 24 hours | 72 hours | After the patch is available |
| High | 24 hours | 48 hours | 7 days | After the patch is available |
| Medium | 48 hours | 5 days | 30 days | After the patch is available |
| Low | 5 days | 14 days | Next scheduled release | With the release notes |

1. We confirm we received your report and agree a severity with you.
2. We develop the fix in a private fork of the advisory.
3. We release a patch and publish a GitHub Security Advisory naming the affected versions.
4. We credit you in the advisory, unless you ask us not to.

Please keep the report private until the advisory is public.

## What counts

PrismPM's security claims are specific, so these are in scope:

- A holo that passes verification while its proof, attestation or digest does not hold.
- A guest that reaches a capability its grant denies.
- A signature, attestation or transparency check that accepts what it should refuse.
- A build that does not bind the inputs its lock names.
- Anything in the release chain that lets someone publish as this project.

A standards claim beyond what `standards.lock` records is not a vulnerability, since the release makes no such claim. Please file those as ordinary issues.

## How to verify what you have

To report accurately, or to check a fix, verify the artifact first.

### Release archives

Each GitHub Release from 0.4.0 on carries a `SHA256SUMS` file. The native archives carry a GitHub build provenance attestation.

```bash
sha256sum --check SHA256SUMS
```

```bash
gh attestation verify prismpm-<version>-x86_64-unknown-linux-gnu.tar.gz --repo UOR-Foundation/PrismPM
```

### OCI images

From 0.4.0 on, images are signed keylessly with cosign by `release.yml`. Verify by digest and never by tag: the digests are in the signed release assets, and tags are only discovery names.

```bash
cosign verify --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity-regexp '^https://github.com/UOR-Foundation/PrismPM/.github/workflows/release.yml@refs/tags/v<version>$' ghcr.io/uor-foundation/prismpm-sdk@sha256:<digest>
```

### npm packages

`prism-code` is published through npm trusted publishing with SLSA provenance. No npm token exists for it.

```bash
npm audit signatures
```

### crates.io

`prismpm` is not on crates.io yet. When it is, `release.yml` uploads it, and [docs/release/crates-io-publication.md](docs/release/crates-io-publication.md) says how.

## Keys

Signing is keyless. No long-lived signing key exists to leak or rotate: each signature comes from a short-lived certificate bound to the GitHub Actions workflow that made it.
A vulnerability in that chain, such as a workflow that can sign something it should not, is in scope.
