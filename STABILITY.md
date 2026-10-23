# Stability and versioning

This file says what you can rely on in PrismPM and its packages.
It also says how versions change before and after 1.0.

## 1. Tiers

Every public surface carries one of four tiers.

| Tier | Promise | How you see it |
| --- | --- | --- |
| Experimental | May change or vanish in any release, including a patch. | `experimental_` prefix in JS APIs; `--unstable-<feature>` flag in the CLI. |
| Beta | Feature-complete and safe for production. May still change, always with a changelog entry. | Listed as Beta in section 5. |
| Stable | Covered by the deprecation policy in section 4. | Listed as Stable in section 5. |
| Deprecated | Keeps working through the whole current major. A migration guide is published. | Marked deprecated in docs, help text and the changelog. |

If you use an Experimental surface, pin the exact version.
A surface moves up one tier at a time, and each move gets a changelog line.

## 2. Before 1.0

This rule covers every package we publish.
That means the `prismpm` crate, the `prism-code` npm package, and every future `@prism-code/*` package.

- A minor bump (0.3 to 0.4) may break you.
- A patch bump (0.4.0 to 0.4.1) never breaks you.

Every breaking change gets one line in that version's entry in [CHANGELOG.md](CHANGELOG.md).
Each version entry uses these four headers, in this order:

```text
### Features Added
### Breaking Changes
### Bugs Fixed
### Other Changes
```

The Breaking Changes list is the per-version breaking log.
If it is empty, the release breaks nothing.

## 3. Format versions

File formats are versioned apart from package versions.
A package release never changes a format by accident.

The `.holo` physical format is version 4 today.
Every `.holo` begins with `HOLO` and little-endian physical version 4, as [SPEC.md](SPEC.md) section 3 defines.
Holo/1 is the Prism profile carried inside that container, not a format number.

Future format revisions are named by date, as `YYYY-MM-DD`.
A new revision is published only when the format changes.
Every reader states which revisions it accepts, and refuses the rest.

## 4. After 1.0

From 1.0 on, every package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html) proper.
Only a major bump may break a Stable surface.

A Stable surface is deprecated at least twelve months before it is removed.
The deprecation, its date and the migration guide appear in the changelog.

The Stable surface is exactly the list in section 5.
Anything not listed there is not Stable.

## 5. What is stable today

Nothing is Stable today.

| Surface | Where it lives | Tier |
| --- | --- | --- |
| `prismpm` CLI verbs (`check`, `build`, `verify`, `inspect`, `lock`, `export-browser`, `conformance` and the rest) | `crates/prismpm` | Experimental |
| `.holo` physical format 4 | [SPEC.md](SPEC.md) section 3 | Beta |
| `prismpm.lock`, which pins the SDK image by digest | project root of each application | Experimental |
| `prism-code` 0.2.0 API: `load`, `Application.dispatch`, `Application.acceptance` | `sdk/npm/prism-code` | Experimental |
| `@prism-code/verify` 0.1.0 API: `verify`, `inspect`, `FORMAT_REVISION` | `sdk/npm/verify` | Experimental |
| SDK image contract: the digest-pinned OCI index for `linux/amd64` and `linux/arm64` | [SPEC.md](SPEC.md) section 1 | Experimental |

The CLI binary will be renamed `prism`.
`prismpm` stays as an alias through every 1.x release.

## 6. Where the rules come from

- Experimental flags: [Deno stability and releases](https://docs.deno.com/runtime/fundamentals/stability_and_releases/).
- The `experimental_` prefix: [Vercel AI SDK versioning](https://ai-sdk.dev/docs/migration-guides/versioning).
- Stable, beta and experimental tiers: [LangChain release policy](https://docs.langchain.com/oss/python/release-policy).
- Date-stamped format revisions and a twelve-month deprecation window: [MCP versioning](https://modelcontextprotocol.io/specification/versioning).
- Minor may break before 1.0, patch never does: [OpenAI Agents SDK release process](https://openai.github.io/openai-agents-python/release/).
- Minor bumps for breaking changes before 1.0: [release-please `bump-minor-pre-major`](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md).
- Changelog headers: [Azure SDK release policies](https://azure.github.io/azure-sdk/policies_releases.html).
