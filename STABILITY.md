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
| `prism-code` 0.3.0 API: `load`, `Application.dispatch`, `Application.acceptance` | `sdk/npm/prism-code` | Experimental |
| `@prism-code/verify` 0.1.0 API: `verify`, `inspect`, `verifyTransparency`, `FORMAT_REVISION` | `sdk/npm/verify` | Experimental |
| `prism-code` `inspect`, `Application.inspect`, `prism-code inspect` and the `prismpm/holo-inspection/1` shape | `sdk/npm/prism-code` | Experimental |
| Holo build provenance: the `https://uor.foundation/prism/holo-build/v1` statement, its `min` and `max` modes, and `provenanceStatement`, `attachProvenance`, `readProvenance` in `prism-code` | [docs/proposals/268-build-provenance.md](docs/proposals/268-build-provenance.md) | Experimental |
| `prism-code` `experimental_verify`, `experimental_createClient`, `Application.experimental_verify` and the `PrismError` hierarchy with its stable codes | `sdk/npm/prism-code` | Experimental |
| `prism-code` middleware: `Application.experimental_middleware` (the stack, its four steps and the `Pluggable` shape), `MIDDLEWARE_STEPS`, `experimental_tracing`, `MiddlewareError` and the `middleware.*` codes | `sdk/npm/prism-code` | Experimental |
| SDK image contract: the digest-pinned OCI index for `linux/amd64` and `linux/arm64` | [SPEC.md](SPEC.md) section 1 | Experimental |
| `prism-code` containers ([#348](https://github.com/UOR-Foundation/PrismPM/issues/348)): `prism.containers`, the `prism/container/1` shape, `EXIT_CODES`, `run <holo> <input>`, `--rm`, `rm` and the `PRISM_HOME` store | `sdk/npm/prism-code` | Experimental |
| `prism-code` CLI plugins ([#293](https://github.com/UOR-Foundation/PrismPM/issues/293)): `prism-<name>` on the PATH runs as `prism-code <name>`, the `prism-cli-plugin-metadata` and `prism-cli-plugin-hooks` calls (schema version 1), `errorHooks`, `PRISM_CODE_NO_HOOKS`, and the first-party `prism-doctor` | `sdk/npm/prism-code` | Experimental |
| `@prism-code/conformance` 0.1.0: the `prism-conformance` CLI, the scenarios and check ids, the shim contract `prism/conformance-shim/1`, the `prism/conformance-declaration/1` and `prism/conformance-results/1` shapes | `sdk/npm/conformance` | Experimental |

The CLI binary will be renamed `prism`.
`prismpm` stays as an alias through every 1.x release.

## 6. Experimental in v0.5

The Verification API ships in v0.5 as Experimental, issue [#277](https://github.com/UOR-Foundation/PrismPM/issues/277).
Pin the exact version if you use any surface in this section.
Each moves up one tier at the v0.6 feature freeze ([#291](https://github.com/UOR-Foundation/PrismPM/issues/291)) and is Stable at 1.0 ([#306](https://github.com/UOR-Foundation/PrismPM/issues/306)).

The CLI has no `--unstable-<feature>` flag yet.
Until it has, this list is the marker: every verb and flag below is Experimental whether or not it carries the prefix.
A flag marked planned is named here so you can plan for it; its spelling may change before it ships.

### 6.1 CLI verbs and flags

| Verb or flag | Issue | State |
| --- | --- | --- |
| `lock`, `lock --check` | [#265](https://github.com/UOR-Foundation/PrismPM/issues/265) | On main |
| `update`, `update --toolchain`, `update --standards-lock`, `update --dry-run` | [#265](https://github.com/UOR-Foundation/PrismPM/issues/265) | On main |
| `build --update` | [#264](https://github.com/UOR-Foundation/PrismPM/issues/264) | On main |
| `prism-code inspect <holo>`, `--json`, `--format <path>` | [#271](https://github.com/UOR-Foundation/PrismPM/issues/271) | On main |
| `inspect <path.holo>`, `--json`, `--format <path>` in the Rust CLI | [#271](https://github.com/UOR-Foundation/PrismPM/issues/271) | On main |
| `prism-code check <holo>`, `--policy <file>`, `--json` and exit codes 0, 1, 2 | [#270](https://github.com/UOR-Foundation/PrismPM/issues/270) | On main |
| `--policy` on `prism-code check` and `run` taking a Rego file or the name of a shipped policy (`default`, `pure-only`, `provenance-only`) | [#285](https://github.com/UOR-Foundation/PrismPM/issues/285) | On main |
| `prism-code build --check` | [#270](https://github.com/UOR-Foundation/PrismPM/issues/270) | On main |
| `check` as a typed verdict in the Rust CLI, with `--json`, `--policy <file>` and exit codes 0, 1, 2 | [#270](https://github.com/UOR-Foundation/PrismPM/issues/270) | Planned |
| `build --provenance=<min\|max>`, `build --no-provenance` | [#268](https://github.com/UOR-Foundation/PrismPM/issues/268) | Planned |
| `prism-code attest <holo> --predicate <file> --type <uri>`, `--subject`, `--key`, `--output`, `--signing-config` | [#272](https://github.com/UOR-Foundation/PrismPM/issues/272) | On main |
| `prism-code verify-attestation <holo>`, `--certificate-identity`, `--certificate-identity-regexp`, `--certificate-oidc-issuer`, `--key`, `--type`, `--trusted-root`, `--entries`, `--timestamps`, `--json` | [#272](https://github.com/UOR-Foundation/PrismPM/issues/272) | On main |
| `prism-code push <holo> <reference>`, `--key`, `--keyless`, `--no-attestations`, `--signing-config`, `--store`, `--plain-http`, `--json` | [#292](https://github.com/UOR-Foundation/PrismPM/issues/292) | On main |
| `prism-code pull <reference> [<out.holo>]`, `--policy`, `--key`, `--certificate-identity`, `--certificate-identity-regexp`, `--certificate-oidc-issuer`, `--type`, `--trusted-root`, `--entries`, `--timestamps`, `--store`, `--plain-http`, `--json` and exit codes 0, 1, 2, 3, 64 | [#292](https://github.com/UOR-Foundation/PrismPM/issues/292) | On main |
| The reference grammar: `registry/repo[:tag]`, `@sha256:`, `@blake3:`, `dir://`; the `blake3-<fingerprint>` tag; the `prism/push-result/1` and `prism/pull-result/1` shapes | [#292](https://github.com/UOR-Foundation/PrismPM/issues/292) | On main |
| The OCI layout of a holo: media type `application/vnd.uor.prism.holo.v1`, the fixed `created` annotation and the `foundation.uor.prism.*` annotations. Each is part of the manifest digest | [#292](https://github.com/UOR-Foundation/PrismPM/issues/292) | On main |
| `prism-code run --capabilities <file>`, `--capability-set <name>` | [#279](https://github.com/UOR-Foundation/PrismPM/issues/279) | On main |
| `prism-code run <holo>` gated on `check`, `--policy <file>`, `--allow-unverified`; the policy member `effects` and the `policy.effects` reason | [#282](https://github.com/UOR-Foundation/PrismPM/issues/282) | On main |
| `prism-code run <holo> <input>`, `--input`, `--rm`; `prism-code inspect <container>`; `prism-code rm <container>`; the exit codes of `EXIT_CODES`; `PRISM_HOME` | [#348](https://github.com/UOR-Foundation/PrismPM/issues/348) | On main |
| `prism-code init [<dir>]`, `--name`, `--template`, `--sdk-image`, `--force`; `npm create prism-code` | [#281](https://github.com/UOR-Foundation/PrismPM/issues/281) | On main |
| `prism-code dev [<dir>]`, `--port`, `--no-open`, `--policy <file>`, `--build <command>`, `--holo <path>`; the studio on port 4100, its Check and Replay tabs and the `prism/dev-state/1` state it reads | [#288](https://github.com/UOR-Foundation/PrismPM/issues/288) | On main |
| `prism-code manifest [<dir>]`, `--target <browser\|node>`, `--json` | [#280](https://github.com/UOR-Foundation/PrismPM/issues/280) | On main |
| `prism-code providers <up\|down> [<dir>]`, `--target <browser\|node>`, `--json`; the `prism-provider-kv` binary, its flags and file layout | [#294](https://github.com/UOR-Foundation/PrismPM/issues/294) | On main |
| The provider wire protocol: `prism-provider-<type>` on the PATH, its arguments, the `info`, `debug`, `error` and `setenv` messages, `PRISM_PROVIDER_MESSAGES`; the `provider-` prefix reserved from plugin names | [#294](https://github.com/UOR-Foundation/PrismPM/issues/294) | On main |
| The `prism.toml` manifest and its `prism.browser.toml` and `prism.node.toml` overlays, read by the Rust CLI | [#280](https://github.com/UOR-Foundation/PrismPM/issues/280) | Planned |
| `prism-code export <name@sha256:digest>`, `--out <dir>`, `--tar <file>`, `--project <dir>`, `--json`, and the `<name>.attestations.jsonl` file beside the output | [#290](https://github.com/UOR-Foundation/PrismPM/issues/290) | On main |
| `attest <path.holo> --predicate <file> --type <uri> --key <pem>`, `--subject`, `--output` in the Rust CLI | [#272](https://github.com/UOR-Foundation/PrismPM/issues/272) | On main |
| `verify-attestation <path.holo>`, `--certificate-identity`, `--certificate-identity-regexp`, `--certificate-oidc-issuer`, `--key`, `--type`, `--trusted-root`, `--entries`, `--timestamps`, `--json` in the Rust CLI | [#272](https://github.com/UOR-Foundation/PrismPM/issues/272) | On main |
| Keyless (OIDC) signing in the Rust `attest`; fetching the trusted root over TUF in the Rust `verify-attestation` | [#272](https://github.com/UOR-Foundation/PrismPM/issues/272) | Planned |

Today `prismpm check` validates the model and `prismpm verify` checks the Lean proofs.
In the JavaScript CLI `check` already judges a holo and returns a verdict (#270), and the model check is `prism-code build --check`; the Rust CLI follows when it reads the attestation section (#267).
Both CLIs name the attestation verb `verify-attestation`, because `prism-code verify` already runs `prismpm verify`, which is build verification (`docs/proposals/272-attest-verify.md`).
`prismpm verify-attestation` judges a holo and returns a verdict, `prismpm/attestation-verification-result/1`, on exit 0 and 1 alike; `check` follows when #270 ships in the Rust CLI.
That change is breaking and gets its changelog line.

### 6.1.1 Deprecated

| Surface | Replacement | Removed in |
| --- | --- | --- |
| `prism-code check [args]` with no holo, which runs `prismpm check` in the SDK image | `prism-code build --check [args]`, the same command | `prism-code` 0.4.0 |

Until then the old spelling runs as before and prints a warning naming the replacement.

### 6.2 SDK exports

| Package | Surface | Issue |
| --- | --- | --- |
| `prism-code` | `experimental_verify`, `experimental_createClient`, `Application.experimental_verify`, `MINIMUM_LEVEL_ENV` and the `PRISM_MINIMUM_LEVEL` variable | [#276](https://github.com/UOR-Foundation/PrismPM/issues/276) |
| `prism-code` | `PrismError`, `VerificationError`, `ProofMismatchError`, `CapabilityDeniedError`, `DeterminismViolationError`, `ReplayError`, `ERROR_CLASSES`, `classForCheck`, `errorForReason`, `errorFromVerdict` and every error `code` | [#276](https://github.com/UOR-Foundation/PrismPM/issues/276) |
| `prism-code` | `prism`, `createPrism`, `memoryContainerStore`, `CONTAINER_SCHEMA`, `EXIT_CODES`, `exitCodeFor`, the `Container` object and the `prism/container/1` shape, and the `container.*` error codes. These carry no `experimental_` prefix because their names are the developer view of #346; this row is the marker. | [#348](https://github.com/UOR-Foundation/PrismPM/issues/348) |
| `prism-code/node` | `fileContainerStore`, `containersDirectory` | [#348](https://github.com/UOR-Foundation/PrismPM/issues/348) |
| `prism-code/node` | `experimental_attest`, `experimental_verifyAttestations`, `experimental_verifyBundle`, `GITHUB_ACTIONS_ISSUER`; the optional `sigstore` dependencies they load | [#272](https://github.com/UOR-Foundation/PrismPM/issues/272) |
| `prism-code` | `SigningError`, `SignatureInvalidError`, `IdentityMismatchError`, `TransparencyError`, `SubjectMismatchError`, `AttestationNotFoundError`, `TrustRootError` and their `code`s | [#272](https://github.com/UOR-Foundation/PrismPM/issues/272) |
| `prism-code/node` | `experimental_push`, `experimental_pull`, `openEndpoint`, `openStore`, `createRegistryClient`, `dockerCredentials`, `parseReference`, `formatReference`, `holoManifest`, `referrerManifest`, `registryStatement`, `registryStatements`, `fingerprintTag`, `referrersTag`, `parseChallenge`, `isLoopback`, the media type and annotation constants | [#292](https://github.com/UOR-Foundation/PrismPM/issues/292) |
| `prism-code` | `RegistryError`, `RegistryAuthError`, `ReferrersUnsupportedError`, `ManifestNotFoundError`, `DigestMismatchError`, `PullVerificationError`, `ReferenceInvalidError` and their `code`s and `registry.*`, `store.*`, `referrers.*`, `digest.*`, `pull.*`, `reference.*` checks | [#292](https://github.com/UOR-Foundation/PrismPM/issues/292) |
| `@prism-code/spec` | `OCI`: the holo's media type, its fixed `created` value and its annotation names | [#292](https://github.com/UOR-Foundation/PrismPM/issues/292) |
| `prism-code/node` | `experimental_exportBrowser`, `experimental_checkExport`; `ExportMismatchError` and its `code` and `check` ids in `prism-code` | [#290](https://github.com/UOR-Foundation/PrismPM/issues/290) |
| `prism-code` | `inspect`, `formatInspection`, `INSPECTION_SCHEMA`, `Application.inspect` | [#271](https://github.com/UOR-Foundation/PrismPM/issues/271) |
| `prism-code` | `readAttestations`, `attestationSection`, `decodeBundle`, `appendAttestations`, `stripAttestations`, `encodeArchive`, `ATTESTATION_EXTENSION`, `BUNDLE_MEDIA_TYPE` | [#267](https://github.com/UOR-Foundation/PrismPM/issues/267) |
| `prism-code` | `parseCapabilities`, `grantOf`, `CAPABILITIES_SCHEMA`, `CAPABILITY_KINDS`, `DEFAULT_SET`, `Application.capabilities`, the `capabilities` and `capabilitySet` load options, and the `capabilities.*` check ids of `CapabilityDeniedError` | [#279](https://github.com/UOR-Foundation/PrismPM/issues/279) |
| `prism-code` | `Application.world` (`contract`, `within`, `pure`, `effects`), `CapabilityGrant.members`, the `capabilities` option of `experimental_verify`, and `CapabilityDeniedError` with check `world.capabilities` at load | [#283](https://github.com/UOR-Foundation/PrismPM/issues/283) |
| `prism-code` | `parseManifest`, `validateManifest`, `lintManifest`, `mergeOverlay`, `manifestCapabilities`, `resolveVariables`, `parseToml`, `MANIFEST_FILE`, `MANIFEST_TARGETS`, `MANIFEST_VERSION`, and the `manifest.*` error codes; `readManifest` in `prism-code/node` | [#280](https://github.com/UOR-Foundation/PrismPM/issues/280) |
| `prism-code` | `manifestProviders`, `ProviderError`, `ProviderNotFoundError`, `ProviderReplyError`, `ProviderFailedError` and their `code`s and `provider.*` checks, the `provider-not-granted` lint warning, the `providers` capability kind and the check `capabilities.providers`; `resolveProviders`, `releaseProviders`, `PROVIDER_MESSAGES`, `PROVIDER_MESSAGES_ENV`, `PROVIDER_TIMEOUT_MS` in `prism-code/node` | [#294](https://github.com/UOR-Foundation/PrismPM/issues/294) |
| `prism-code` | `PolicyParseError`, `PolicyEvaluationError`, `PolicyDeniedError` and their `code`s, and the `rego` option of `experimental_verify` | [#285](https://github.com/UOR-Foundation/PrismPM/issues/285) |
| `@prism-code/verify` | `POLICIES`, `POLICY_INPUT_SCHEMA`, `parsePolicy`, `evaluatePolicy`, `policyInput`, `policy.rego`, the accepted Rego subset, and the `policy.parse` and `policy.evaluation` codes | [#285](https://github.com/UOR-Foundation/PrismPM/issues/285) |
| `@prism-code/verify` | `worldPolicy`, `policy.capabilities`, the `world.capabilities` reason (`PP5602`), and the inspection's `world.pure` and `world.effects` | [#283](https://github.com/UOR-Foundation/PrismPM/issues/283) |
| `@prism-code/verify` | `verify`, `inspect`, `verifyTransparency`, `ASSURANCE`, `VerifyError`, `FORMAT_REVISION`, `INSPECTION_SCHEMA` | [#273](https://github.com/UOR-Foundation/PrismPM/issues/273), [#275](https://github.com/UOR-Foundation/PrismPM/issues/275) |
| `@prism-code/spec` | The `prism/proof/v1` types and schema, the `prism/verdict/1` schema, assurance levels, the attestation and Sigstore bundle schemas, the trusted-root schema, the lock schemas, the `prism/capabilities/1` schema and types, the `prism/manifest/1` schema and types, each with its provider members, and the `prism/policy-input/1` schema and types, `POLICY` and the shipped policy files | [#266](https://github.com/UOR-Foundation/PrismPM/issues/266), [#269](https://github.com/UOR-Foundation/PrismPM/issues/269), [#267](https://github.com/UOR-Foundation/PrismPM/issues/267), [#264](https://github.com/UOR-Foundation/PrismPM/issues/264), [#279](https://github.com/UOR-Foundation/PrismPM/issues/279), [#280](https://github.com/UOR-Foundation/PrismPM/issues/280), [#294](https://github.com/UOR-Foundation/PrismPM/issues/294), [#285](https://github.com/UOR-Foundation/PrismPM/issues/285) |
| `@prism-code/conformance` | `runSuite`, `renderMatrix`, `runGate`, `loadScenarios`, the shim contract `prism/conformance-shim/1`, every check id, and `COMPLIANCE.md`'s cells | [#287](https://github.com/UOR-Foundation/PrismPM/issues/287) |

`prism-code` entries land in the first release after 0.2.0.
`@prism-code/verify`, `@prism-code/spec` and `@prism-code/conformance` are not published yet.
The `prism/replay/v1` predicate is a placeholder owned by M3 and carries no promise.

### 6.3 Verdict fields

Every field of `prism/verdict/1` is Experimental, as is the `prismpm/holo-inspection/1` shape.

| Field | Meaning |
| --- | --- |
| `schema` | Always `prism/verdict/1`. |
| `holo` | The archive fingerprint, `blake3:` and 64 lowercase hex characters. |
| `level` | `P0` to `P3`, computed from the evidence. The policy never changes it. |
| `policy.name`, `policy.minimum` | The policy the holo was judged against and the lowest level it accepts. |
| `passed` | True when the policy accepts the holo. |
| `reasons[].check` | A dotted check id such as `proof.subject` or `policy.level`. |
| `reasons[].code` | A registered diagnostic such as `PP5601`, when one exists. |
| `reasons[].withholds` | The lowest level the failure withholds, or null. |

`reasons[].message` is a sentence for a person and is never part of the contract.
The exit codes of `check` (0 pass, 1 fail, 2 cannot verify) follow the verdict and are Experimental with it.

## 7. Where the rules come from

- Experimental flags: [Deno stability and releases](https://docs.deno.com/runtime/fundamentals/stability_and_releases/).
- The `experimental_` prefix: [Vercel AI SDK versioning](https://ai-sdk.dev/docs/migration-guides/versioning).
- Stable, beta and experimental tiers: [LangChain release policy](https://docs.langchain.com/oss/python/release-policy).
- Date-stamped format revisions and a twelve-month deprecation window: [MCP versioning](https://modelcontextprotocol.io/specification/versioning).
- Minor may break before 1.0, patch never does: [OpenAI Agents SDK release process](https://openai.github.io/openai-agents-python/release/).
- Minor bumps for breaking changes before 1.0: [release-please `bump-minor-pre-major`](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md).
- Changelog headers: [Azure SDK release policies](https://azure.github.io/azure-sdk/policies_releases.html).
