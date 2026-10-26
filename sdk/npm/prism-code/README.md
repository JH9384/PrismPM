# prism-code

The JavaScript runtime and command line for Prism SDK applications.

A Prism application is modeled in LexLean, proved in Lean 4, and built by
[PrismPM](https://github.com/UOR-Foundation/PrismPM) into two artifacts: a
Hologram `.holo` archive (the Core-Wasm guest, the model document, the
portable view, the proof and build provenance, all content-addressed) and a
six-file browser closure. This package opens both, verifies their identities,
runs the guest, and replays the modeled acceptance vectors. It does not
compile, prove or produce artifacts; that stays in the SDK image, which the
command line runs for you.

No required dependencies. ESM only. Node 22 or newer, or a browser. Signing and checking
attestations use the optional [`sigstore`](https://github.com/sigstore/sigstore-js)
packages, which need Node 22.22.2 or newer; nothing else loads them.

```
npm install prism-code
```

## Three calls

```js
import { load } from 'prism-code';

const app = await load('node_modules/prism-code/fixtures/Calculator.holo');

app.identities.verified;   // true: footer, blob labels and manifest cross-check with BLAKE3
app.limits;                // { request: 52, response: 27, guestAllocation: 65536 }

const response = await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
new TextDecoder().decode(response);   // '1\tok\t42'

await app.acceptance();    // { total: 22, passed: 22, failed: [] }
```

`load` takes bytes, a `Blob`, a file path or URL ending in `.holo`, or a
closure directory (path in Node, URL in a browser). `dispatch` runs each
request on a fresh instance of the guest, the same loop PrismPM's own
acceptance driver uses, and moves bytes only; text encoding is yours.

What the application object carries:

| Field | Archive | Closure |
| --- | --- | --- |
| `model` | `model.prism.json` | only when you pass `{ model }` |
| `profile` | `application.profile`, or the document schema for the numeric profile | same, or inferred from the glue |
| `limits`, `vectors` | from the model document | from the model when given |
| `provenance.model` | `prismpm/model-provenance/1` (commits, manifests, digests) | null |
| `provenance.browser` | null | `prismpm/browser-provenance/1` |
| `directory` | Hologram application-directory/v1 | null |
| `identities` | fingerprint, kappas, `verified` | digest checks, `mismatches`, `unverifiable` |
| `evidence` | pointers to Lean and LCNF manifests and toolchain commits | pointers |
| `view` | the HOLOVIEW decoded: `entry` and `files` | the closure files |

`evidence` points at what was proved and built; this package reads it, it does
not check proofs.

## Run it

```
npx prism-code run app.holo --port 8080
```

serves the archive's portable view and answers `POST /_hologram/intent` (the
request the view posts) by dispatching through the guest.

## Capabilities (experimental, #279)

A holo is granted nothing unless a capability file says otherwise.

```
npx prism-code run app.holo --capabilities caps.json [--capability-set online]
```

```json
{
  "schema": "prism/capabilities/1",
  "sets": {
    "default": {
      "allow-outbound-hosts": ["https://api.example.com", "https://*.cdn.example.com:8443"],
      "deny-outbound-hosts": ["https://admin.cdn.example.com:8443"],
      "allow-key-value-stores": ["default"],
      "allow-variables": ["*"],
      "deny-variables": ["signing_key"]
    }
  }
}
```

The runtime applies the `default` set unless `--capability-set` (or the
`capabilitySet` option) names another. A resource is granted when an `allow-`
entry of its kind matches it and no `deny-` entry does; deny always wins. Hosts
are `scheme://host[:port]` with `*` wildcards and `*.` subdomains; with no port
only the scheme's default port matches. An unknown member anywhere in the file
is an error (`capabilities.invalid`), never a silent grant.

```js
const app = await load(bytes, { capabilities: caps });  // or fromFile(path, { capabilities: 'caps.json' })
app.capabilities.allows('outbound-hosts', 'https://api.example.com/v1');  // true
app.capabilities.assert('variables', 'signing_key');  // throws CapabilityDeniedError
```

The guest's world, `hologram:guest/core-wasm@1`, has no imports, so the runtime
links none: a guest that declares an import fails to load with
`CapabilityDeniedError` (`capabilities.import`) whatever the file grants. The
format and its open questions are in `docs/proposals/279-capability-sets.md`;
the JSON Schema is `@prism-code/spec`'s `schemas/capabilities/capabilities-v1.schema.json`.

```
npx prism-code vectors app.holo       # replay every acceptance vector; exit 1 on a failure
```

`vectors` also takes a closure directory. A numeric-profile closure (the
Calculator) exposes only `calculate()`, so its wire format comes from the model
document: pass `--model model.prism.json`.

## Inspect without running

`inspect` prints the format revision, the section table with both digests of
every section, the manifest, the model, the provenance, the world and the
attestations. It reads the section table only. It never compiles or runs the
guest.

```
npx prism-code inspect Calculator.holo
```

```text
Name:      Calculator
Revision:  2026-10-23
Format:    HOLO physical version 4, flags 0
Size:      24801 B
Digest:    sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7
           blake3:4efe02106778d44a469cc0fc8f6998167af7c9075a3ac605c150098c0f5243bb
Footer:    8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba (BLAKE3 of the body)

Sections:
  INDEX  KIND  ROLE                   OFFSET  LENGTH  SHA256                                                            BLAKE3
  0      15    app-manifest           202     356     0088c507ec48bb78288d898327902037749c6bb9527546633c6a1adbc3ba8a6f  4ed201e5…
  …
World:
  Contract:        hologram:guest/core-wasm@1
  WIT:             hologram:guest@1.0.0 world core-wasm, worlds/core-wasm.wit
  WIT digest:      sha256:a566c87a359cadf98f652747f1b3574aa307ff5f652a190c6d99c350db9cf369
                   blake3:0774a8ecbfa945a427712ee7d7ad406195b2d07492ceae15cca0067276c9ced8
  Imports:         none
  Exports:         holo_alloc, holo_run, memory
  Guest:           conforms to the world
  Capability set:  blake3:cf46eb3028b50fde0444a1a648f5ce7cba94013f541c86537df54adf5d203e1c (requests nothing)

Attestations:
  none
```

Every block has the same lines in the same order, and every digest is printed
in full, so two outputs diff cleanly in CI. Each digest pair is sha256 and
BLAKE3 over the same bytes. A section's digest covers exactly its table bytes.
A content blob also lists the digest of its content, whose BLAKE3 is its
label. The footer is the BLAKE3 of every byte before it, not of the file.

Pass `--json` for the whole inspection as one canonical JSON object, keys
sorted, schema `prismpm/holo-inspection/1`. Pass `--format` with a dotted path
to print one value:

```
npx prism-code inspect Calculator.holo --format sections[0].digest.sha256
npx prism-code inspect Calculator.holo --format world
npx prism-code inspect Calculator.holo --format revision
```

A string prints as is. Anything else prints as canonical JSON. A path with no
value exits 2. A malformed path exits 64.

`Attestations` reads `none` until holos carry an attestation section. A damaged
holo is still inspected: `Verification` reports the footer, the blob labels and
the cross-references as `ok` or `FAIL`. A holo whose structure the reader does
not recognize exits 2 with the reader's error code.

The same object is available in code:

```js
import { inspect } from 'prism-code';

const inspection = await inspect(bytes);   // or: await (await load(path)).inspect()
inspection.sections[4].content.digest;     // { sha256, blake3 } of the guest
```

A closure directory has no section table. `inspect` on a closure prints the
0.2.0 summary of identities, limits, provenance and view files as JSON.

## Verify one (experimental)

`experimental_verify(holo, options)` and `app.experimental_verify(options)` return the same
`prism/verdict/1` that `prism check` and `@prism-code/verify` return, from the holo
alone, offline. The checks are `@prism-code/verify`'s, vendored as one file, so
the package still has no dependencies. The level is computed from the evidence in
the holo and no option raises it: a holo with no attestation bundle is `P0`, and
the default policy (`P2`) fails it.

```js
import { load, experimental_verify, VerificationError } from 'prism-code';

const app = await load('Calculator.holo');
const verdict = await app.experimental_verify({ minimum: 'P0' });
verdict.level;    // 'P0'
verdict.passed;   // true

try {
  await experimental_verify(bytes, { throw: true });
} catch (error) {
  if (error instanceof VerificationError) error.check; // 'provenance.statement'
}
```

The `world` option pins the world the holo must declare, in the shape of the
lock's `inputs.world` (issue #278), so a project's lock can be passed unchanged:

```js
await experimental_verify(bytes, { world: lock.inputs.world, throw: true });
// throws WorldMismatchError (check 'world.hash') when the contract or a digest differs
```

Independently of any pin, a guest whose imports and exports are not those of
its declared WIT world fails the `world.contract` check.

Options are `name`, `minimum` (`P0` to `P3`), `digests`, `world` and `throw`. The minimum
defaults to the `PRISM_MINIMUM_LEVEL` environment variable; `experimental_createClient(options)`
holds options for many calls; the options of one call replace the client's, and
the client's replace the environment's. A holo that fails a check is a verdict, and
with `throw: true` it is thrown as the typed error that explains it. A file with
no verdict (not a holo, an unknown format revision, an invalid option) always
throws.

Every error is a `PrismError` with a stable `code`: `VerificationError`
(`verification_failed`; `holo.*`, `provenance.*`, `policy.*` and no verdict),
`ProofMismatchError` (`proof_mismatch`; `proof.*`), `CapabilityDeniedError`
(`capability_denied`; `world.capabilities` and the runtime's `capabilities.*`), `WorldMismatchError`
(`world_mismatch`; `world.contract`, `world.hash`), `DeterminismViolationError`
(`determinism_violation`; `replay.divergence`) and `ReplayError` (`replay_failed`; other
`replay.*`). `check` is the verdict reason's check id, `diagnostic` its registered
code, `verdict` and `reasons` the whole result. Load and archive failures remain
`PrismCodeError`, a `PrismError` whose `code` is the check (`archive.magic`, ...).

## Build one

`check`, `build`, `verify` and `conformance` run `prismpm` inside the
digest-pinned SDK image named by `prismpm.lock` in the current directory, with
the same `docker run` invocation the UOR template uses. Docker is required;
the image is Linux (amd64 and arm64). `build` and `verify` also mount the
Docker socket.

```
cd my-prism-project
npx prism-code check
npx prism-code build
```

Nothing in this package can produce a `.holo` without the image, and no
native `prismpm` binary ships in this release.

## What is in a `.holo`

Little-endian: `HOLO`, u16 version 4, u16 flags, u16 section count, a table of
u64 kind, offset and length per section, the bodies in order, and a 32-byte
BLAKE3 footer of everything before it (the archive fingerprint). Sections: one
application manifest (the three kappas the directory requires), one metadata
section (the source manifest), two extensions (Hologram's application
directory, PrismPM's model provenance) and four content blobs, each prefixed by
its 71-byte `blake3:` label: the capability set, the Core-Wasm guest, the model
document and the HOLOVIEW bundle. The package verifies every label and the
footer with its own BLAKE3, and refuses structure it does not recognize with a
named error (`archive.version`, `archive.bounds`, `core.exports`, ...).

## Attestations (draft, #267)

A holo may carry signed statements in one more Extension row, the last one,
named `https://uor.foundation/extension/attestation-bundle/v1`. Its payload is
JSON Lines, one Sigstore bundle v0.3 per line. The footer still covers every
byte before it, bundle included. The design is
[docs/proposals/267-attestation-bundle.md](../../../docs/proposals/267-attestation-bundle.md).

```js
import { load, appendAttestations, stripAttestations } from 'prism-code';

const signed = appendAttestations(holoBytes, [bundle]); // other rows byte-identical, footer recomputed
const app = await load(signed);
app.attestations();          // [{ predicateType, statement, subjects, bytes, ... }]
stripAttestations(signed);   // the unsigned archive, byte for byte
```

The package decodes bundles and resolves each subject to a content blob by its
`blake3` label. Decoding does not verify signatures; `attest` and
`verify-attestation` below sign and check them. PrismPM's Rust reader refuses the
ninth row until the wire model admits it, so signed archives are for the
JavaScript runtime only for now.

## Sign and check attestations (experimental, #272)

```
prism-code attest app.holo --predicate proof.json --type https://uor.foundation/prism/proof/v1
prism-code verify-attestation app.holo \
  --certificate-identity https://github.com/acme/app/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

`attest` signs an in-toto Statement v1 and appends it as a Sigstore bundle v0.3
to the attestation section; the holo is rewritten in place unless you pass
`--output`. The subject is the guest blob with both digests (`--subject` adds or
changes subjects: `guest`, `view`, `model`, `capabilities`, or a `blake3:` label).

Keyless is the default: an OIDC token (GitHub Actions with `permissions: id-token: write`, or
`SIGSTORE_ID_TOKEN`) buys a short-lived Fulcio certificate, and the Rekor v2 entry and RFC 3161
timestamp of the public instance's signing configuration go into the bundle. `--key private.pem`
signs with a local key instead and uses no network; `--signing-config` points at a private instance.

`verify-attestation` checks every bundle of `--type` (default all) and passes when one
passes everything: both digests of each subject against the blob, the DSSE signature, the
certificate chain or the key, the log entry and the signed time, and the signer. A keyless policy needs
`--certificate-identity` (exact, never a pattern) or `--certificate-identity-regexp`, and
`--certificate-oidc-issuer`; without them any signer would pass, so the command refuses.
`--key public.pem` checks a keyed bundle. `--trusted-root trusted_root.json` pins the root and keeps the
whole check offline; without it the public instance's root is fetched over TUF. Exit codes: 0 verified,
1 not verified, 3 signing failed, 64 bad policy.

```js
import { experimental_attest, experimental_verifyAttestations } from 'prism-code/node';

const { holo } = await experimental_attest(bytes, { type, predicate, key: privatePem });
const result = await experimental_verifyAttestations(holo, { key: publicPem });
result.passed;   // true
result.results;  // [{ index, predicateType, subjects, passed, signer, time, error }]
```

Errors are typed: `SigningError` (`sign.*`), `SignatureInvalidError`, `IdentityMismatchError`,
`TransparencyError`, `SubjectMismatchError`, `AttestationNotFoundError`, `TrustRootError`; a bad policy is a
`VerificationError` with check `policy.invalid`. The verb is `verify-attestation` because
`prism-code verify` already runs `prismpm verify`. The design is
[docs/proposals/272-attest-verify.md](../../../docs/proposals/272-attest-verify.md).

## In the browser

```js
import { load, mount } from 'prism-code/browser';

const app = await load('/apps/Calculator.holo');   // fetch, verify, dispatch in the page
mount(document.querySelector('#app'), '/apps/calculator/');   // a closure in an iframe
```

Mounting a HOLOVIEW page in a browser needs a service worker for the intent
endpoint and is not in this release.

## Canonical source hashing (formerly 0.1.0)

`prism-code@0.1.0` was a source-canonicalization library. It is unchanged at
`prism-code/canonical`:

```js
import { canonicalize, codeHash, describe, differs } from 'prism-code/canonical';
```

The top-level re-exports still work in 0.2.x with a one-time deprecation
warning and are removed in 0.3.0.

## Limits

- Linux SDK image only; `build` and `verify` need the Docker socket.
- No proof checking: `evidence` is pointers, not verdicts.
- No `.holo` production in JavaScript. `attest` adds to a holo; it does not build one.
- Closure provenance can verify the adapter and the glue it was given; `model_id`
  and `view_model_id` name files outside the closure and are reported as
  unverifiable rather than assumed.

## License

MIT.
