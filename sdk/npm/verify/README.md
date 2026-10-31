# @prism-code/verify

`@prism-code/verify` checks a holo without running it. It ships no runtime, no WebAssembly engine and no network code. Use it in a browser, a service worker or Node. Confirm a holo first, then decide whether to fetch the runtime.

This is 0.1.0 and Experimental (see [STABILITY.md](../../../STABILITY.md)). It checks everything a holo carries today. Signed statements, and with them levels above P0, arrive with the attestation bundle.

## Install

```bash
npm install @prism-code/verify
```

The package has no dependencies. It carries the format constants and JSON Schemas of `@prism-code/spec`, copied by `scripts/vendor.mjs` and checked against their source in CI.

## Signature

```ts
function verify(bytes: Uint8Array | ArrayBuffer, policy?: Policy): Promise<Verdict>;
function inspect(bytes: Uint8Array | ArrayBuffer): Inspection;

const FORMAT_REVISION: string; // "2026-10-23"
const ASSURANCE: { LEVELS, RANK, NAMES, DEFAULT_MINIMUM, ... };
const INSPECTION_SCHEMA: "prismpm/holo-inspection/1";
function verifyTransparency(bundle: object, trustedRoot: object, options?: TransparencyOptions): Promise<TransparencyResult>;
class VerifyError extends Error { code: string }
```

`index.d.ts` has the full types.

## Parameters

| Name | Type | Meaning |
|---|---|---|
| `bytes` | `Uint8Array` or `ArrayBuffer` | The whole holo, read from a file, a fetch or a drag and drop. |
| `policy.minimum` | `"P0"` to `"P3"` | The lowest level the policy accepts. Default `"P2"`. |
| `policy.name` | string | The policy name shown in the verdict. Default `"default"`. |
| `policy.digests` | object | Expected digests for `archive`, `guest`, `view`, `model` or `capabilities`. Each takes `sha256`, `blake3` or both. Every digest given must match. |
| `policy.capabilities` | object or `null` | The capability set granted to the holo: one set of a `prism/capabilities/1` file (`allow-` and `deny-` lists of outbound hosts, key-value stores and variables), or `null`, the default, for nothing. A world that imports a kind the set grants none of is a `world.capabilities` reason (issue #283). |
| `policy.effects` | array | The impure effects the world may import (issue #282): any of `clock`, `random`, `socket`, `filesystem`, `unknown`. Absent allows any; `[]` is the pure-world policy. A world importing an effect not listed is a `policy.effects` reason. |
| `policy.world` | object or `null` | The WIT world the holo must declare, in the shape of the lock's `inputs.world` (`contract`, `sha256`, `blake3`), so a project's lock is passed unchanged. Any member may be left out. `null` expects no world, which no holo satisfies. A mismatch is a `world.hash` reason. |

`archive` is the whole file. The others are the content blobs the documents name.

## Returns

`verify` resolves to a `prism/verdict/1` object, the verdict `prism check` and the runtime return (issue #269, `docs/proposals/269-assurance-levels.md`).

| Field | Meaning |
|---|---|
| `schema` | `"prism/verdict/1"`. |
| `holo` | The archive fingerprint: `blake3:` and the BLAKE3 of every byte before the footer. |
| `level` | The highest level no reason withholds. The policy never changes it. |
| `policy` | The `name` and `minimum` the holo was judged against. |
| `passed` | True when the level reaches `policy.minimum` and every pinned digest matched. |
| `reasons` | Every check that did not pass: `check`, `withholds`, `message` and sometimes `code`. |

`inspect` returns a `prismpm/holo-inspection/1` object, the same one `prism-code`'s `inspect` returns (issue #271). For the reference archive the two are equal key for key.

- `sections` lists every section with its kind, role, offset, length and name. Its `digest` holds sha256 and BLAKE3 over exactly the table bytes.
- A content blob adds its `label` and a `content` object: length, both digests over the bytes after the label, and `label_matches`. These are the digests an attestation subject names (ADR-015).
- The top level holds the `revision`, the whole-file `digest`, the stored `footer`, and summaries of the manifest, model, provenance and world.
- `attestations` is empty until holos carry an attestation section (issue #267).
- `verification` holds three flags: footer, labels and cross-references.

Damage after the section table is reported, not thrown. A document that does not decode is `null`.

## Levels today

The levels are P0 unverified, P1 provenance, P2 proof checked and P3 proof, replay and world. P1 needs the archive to recompute and a signed provenance statement. No holo carries signed statements yet, so every holo is P0 today, and the default policy, P2, fails.

What this package does check today appears as reasons that withhold P1:

| Reason | Reported when |
|---|---|
| `holo.integrity` | The footer is not the BLAKE3 of the body, a content blob's `blake3:` label is not the BLAKE3 of its content, the manifest, directory and provenance name different blobs, or the model document's sha256 is not the `model_id` the provenance records. |
| `holo.documents` | The application manifest is not the 356-byte Wire form, or the source manifest, directory, provenance or model document is not JSON valid against its schema, or names a contract or schema the format revision does not use. |
| `world.contract` | The guest module does not have the imports and exports of the WIT world its contract names: an import the world does not list, a missing or extra export, or an export of another kind or signature (issue #278). Not checked when the guest fails its label, which `holo.integrity` already reports. |
| `provenance.statement` | Always, until the attestation bundle exists (issues #267 and #268). |
| `proof.statement` | Always, until the proof predicate is carried (issue #266). Withholds P2. |
| `replay.statement` | Always, until `verify` reads statements (issue #267). Replay itself has arrived (issue #284): `prism-code replay` writes the statement. Withholds P3. |
| `policy.level` | The level is below `policy.minimum`. Code `PP5601`. |
| `policy.digests.<part>` | A pinned digest does not match. |
| `world.capabilities` | The world the contract names imports a capability kind `policy.capabilities` grants nothing of, or an import that names no kind. Code `PP5602`. It withholds P3, and it fails the policy at every level: the default policy requires the world within the grant (issue #283). `worldPolicy(contract, set)` runs the same check alone and also reports whether the world is pure. |
| `policy.effects` | The policy lists the effects it allows and the world imports another (issue #282). It withholds no level. |
| `world.hash` | The policy pins a world and the holo's world differs: another contract, another digest, or `null`. It withholds no level. |

So until the bundle lands, read a verdict this way: no `holo.integrity` and no `holo.documents` reason means the holo is intact and well-formed. A P0 policy accepts any readable holo, tampered or not, because P0 promises nothing. Pin a digest when you need a pass or fail answer today.

## Policy files

`verify(bytes, { name, rego, capabilities })` judges a holo by a Rego policy (issue #285, [docs/proposals/285-policy-file.md](../../../docs/proposals/285-policy-file.md)). Without `rego`, the shipped default policy decides, and `minimum`, `digests`, `world` and `effects` adjust it.

`POLICIES` holds the source of `default`, `pure-only` and `provenance-only`. `policyInput(bytes, { capabilities })` returns the `prism/policy-input/1` document a policy reads. `parsePolicy(source)` and `evaluatePolicy(parsed, input)` run a policy on a document alone, and return `{ minimum, denied, denials }`.

The evaluator, `src/rego.mjs`, is a closed subset of Rego v1 with no dependencies. It refuses what it does not implement, by name, and `test/rego-opa.test.mjs` pins its answers against OPA.

## Example

Serve `Calculator.holo` next to this page and open it.

```html
<script type="module">
  import { verify } from "./node_modules/@prism-code/verify/browser.js";

  const response = await fetch("./Calculator.holo");
  const bytes = new Uint8Array(await response.arrayBuffer());

  const verdict = await verify(bytes);
  document.body.textContent =
    (verdict.passed ? "pass " : "fail ") + verdict.level + "\n" +
    verdict.reasons.map((r) => r.check + ": " + r.message).join("\n");
</script>
```

```text
fail P0
provenance.statement: The holo carries no provenance statement; format revision 2026-10-23 has no attestation bundle (issues #267 and #268).
proof.statement: The holo carries no proof statement (issue #266).
replay.statement: The holo carries no replay statement (issue #284).
policy.level: The level is P0; the policy requires P2 or above.
```

Flip one byte of the guest and two reasons come first:

```text
holo.integrity: The footer 8408e089...21ba does not equal the BLAKE3 of the body, 8705cfe4...4735: the archive was altered.
holo.integrity: Section 4 is labelled blake3:2adca3e7...a380 but its content hashes to blake3:fadd77ba...92eb.
```

Pin the digest you got elsewhere, such as the sha256 of an OCI layer, and accept P0:

```js
const verdict = await verify(bytes, {
  name: "pinned",
  minimum: "P0",
  digests: { archive: { sha256: "84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7" } },
});
// verdict.passed is true only for these exact bytes.
```

`browser.js` is one file with no imports. Load it from a page with no bundler and no import map. With a bundler, import `@prism-code/verify` instead.

## Transparency log and timestamps

`verifyTransparency(bundle, trustedRoot, options)` checks the two pieces of third-party evidence a Sigstore bundle carries, offline (issue #275, `docs/proposals/275-transparency-log.md`). It does not read a holo and does not change a verdict yet: pass it a bundle, such as the `bundle` of an entry that `prism-code`'s `readAttestations` returns.

`trustedRoot` is a Sigstore `trusted_root.json` that you pin (`schemas/attestation/trusted-root.schema.json` in `@prism-code/spec`). The bundle never supplies its own. The verifier fetches nothing and reads no clock: the signed time of the timestamps decides which keys and certificates apply, so a bundle whose certificates have since expired still verifies.

```js
import { verifyTransparency } from "@prism-code/verify";

const result = await verifyTransparency(bundle, trustedRoot);
// { passed: true, time: "2026-05-13T19:23:33.000Z", checks: [...], reasons: [] }
```

| Option | Meaning |
|---|---|
| `entries` | The least number of log entries that must verify. Default 1. |
| `timestamps` | The least number of RFC 3161 timestamps that must verify. Default 1. A Rekor v2 entry has no integrated time, so the timestamp is the clock. |
| `crypto` | Where WebCrypto comes from. Default `globalThis.crypto`. |

Every check runs. A failed one is a reason with the shape of a verdict reason (`check`, `withholds`, `message`):

| Check | Fails when |
|---|---|
| `timestamp` | A timestamp is not signed by a pinned authority, is outside that authority's validity, does not cover the bundle's signature, or falls outside the signing certificate's validity. |
| `certificate.chain` | The signing certificate does not chain to a pinned certificate authority that was valid at the signed time. |
| `tlog.kind`, `tlog.log` | The entry is none of `hashedrekord` 0.0.2, `dsse` 0.0.2 (Rekor v2) or `dsse` 0.0.1 (Rekor v1), or names a log the root does not pin. |
| `tlog.body` | The logged body is not this bundle's digest, signature or certificate. |
| `tlog.inclusion` | The proof is missing, is for another index, or does not recompute the root hash. |
| `tlog.checkpoint` | The checkpoint is malformed, disagrees with the proof, or carries no valid signature from the pinned log key. |
| `timestamp.count`, `tlog.count` | Fewer verified than `timestamps` or `entries`. |
| `crypto.unavailable` | WebCrypto is missing. |

It rejects with `VerifyError` code `trustedroot.invalid` for a root that is not usable, and `input` for a bundle that is not an object.

Not checked: the DSSE signature, the signing identity, revocation and checkpoint witnesses. Those belong to `prism verify` (issue #272). A Rekor v1 `dsse` entry is checked by its inclusion proof and signed checkpoint; its signed entry timestamp is not used.

## Proof statement checks

`src/statements.mjs` holds the eight checks of a `prism/proof/v1` statement against the holo it travels in (issue #266): `proof.envelope`, `proof.statement`, `proof.subject`, `proof.model`, `proof.verifier`, `proof.verdict` and `proof.tcb`, diagnostics `PP5501` to `PP5507`, each withholding P2. `proof.level` is a shape failure since #269 and reports as `proof.statement`. `verify` joins them when a format revision admits the attestation section (#267's wire model change); until then a holo that carries one has no verdict, and `prism-code check` exits 2 on it. The module is not exported.

## Errors

`verify` rejects, and `inspect` throws, only when there is no verdict to give. `prism-code check` (and later `prism check`) exits 2 in the same cases.

| `VerifyError` code | When |
|---|---|
| `input` | `bytes` is not a typed array, a `DataView` or an `ArrayBuffer`. |
| `policy.invalid` | The policy has an unknown member, an unknown level, a digest or `policy.world` digest that is not 64 lowercase hex characters, a `policy.world` with an unknown member, or a `policy.capabilities` with an unknown member or a list that is not strings. |
| `trustedroot.invalid` | `verifyTransparency` only: the trusted root has the wrong media type, a missing validity period or a certificate that does not parse. |
| `archive.magic`, `archive.version`, `archive.flags`, `archive.table` | The file is not a readable holo: wrong magic, another physical version, or a section table that does not end at the footer, as in a truncated file. |
| `format.revision` | `verify` only: the holo is intact, but its sections or extensions match no format revision this package knows. Upgrade the package. |

A failed check is a reason in a verdict, not an error.

## Size

`browser.js` is about 265 KB. Most of it is the JSON Schemas of the model document versions a holo can carry, BLAKE3, the log and timestamp checks, and the Rego evaluator with the shipped policies.

## How it is built

- `src/vendor/` holds byte-for-byte copies: BLAKE3 from `prism-code`, the constants, the assurance levels and the schemas from `@prism-code/spec`, and the schema validator from the spec's tests. `prism-code`'s entry point imports `node:crypto`, and `@prism-code/spec` is not on npm yet, so neither can be a dependency of a browser package today. `node scripts/vendor.mjs --check` fails when a copy drifts.
- The assurance levels come from `@prism-code/spec` (`assurance-levels.mjs`, copied into `src/vendor/`). The tests validate every verdict against `prism/verdict/1`, and compare the copy of the verdict schema in `test/fixtures/` with the spec's.
- `inspect` builds the shape `prism-code` returns (`prismpm/holo-inspection/1`). `test/fixtures/Calculator.inspect.json` copies the golden of `prism-code`, and the tests compare the two readers on intact and damaged holos.
- SHA-256 is plain JavaScript, so `inspect` stays synchronous and works on plain-HTTP pages, where `crypto.subtle` does not exist.
- `node scripts/build-browser.mjs` writes `browser.js` with no bundler: each module becomes a function scope. It refuses any import that is not a relative path inside `src/`.
- The tests run `browser.js` in a bare `vm` context with only ECMAScript and `TextDecoder`, and compare its results with `src/`.

```bash
node --test "test/*.test.mjs"
node scripts/vendor.mjs --check
node scripts/build-browser.mjs --check
```

## Next steps

- [`prism-code`](../prism-code/README.md), the runtime that loads and runs a holo.
- [`@prism-code/spec`](../spec/README.md), the formats as data.
- [ADR-015](../../../docs/adr/015-dual-digests.md), why every part has a sha256 and a BLAKE3.
