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

Zero runtime dependencies. ESM only. Node 22 or newer, or a browser.

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

```
npx prism-code vectors app.holo       # replay every acceptance vector; exit 1 on a failure
npx prism-code inspect app.holo       # identities, limits, provenance, view files as JSON
```

Both also take a closure directory. A numeric-profile closure (the Calculator)
exposes only `calculate()`, so its wire format comes from the model document:
pass `--model model.prism.json`.

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
`blake3` label. It does not verify signatures; that is `@prism-code/verify`
(#273). PrismPM's Rust reader refuses the ninth row until the wire model admits
it, so signed archives are for the JavaScript runtime only for now.

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
- No `.holo` production in JavaScript.
- Closure provenance can verify the adapter and the glue it was given; `model_id`
  and `view_model_id` name files outside the closure and are reported as
  unverifiable rather than assumed.

## License

MIT.
