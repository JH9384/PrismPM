# prism-code

JavaScript runtime/CLI for Prism SDK applications: open `.holo` archives and
browser closures (v1, six files; v2, plus Hologram fonts, icons and a web app
manifest), verify identities, dispatch Core-Wasm and replay
acceptance vectors. Compilation/proofs/artifact production stay in the SDK image.

ESM, Node 22+ or browser, no required dependencies. Only signing/attestation
checks load optional Sigstore packages (Node 22.22.2+).

```sh
npm install prism-code
```

Offline quickstart/API map; [complete guide][guide] for detailed examples,
output and design references. Source, TypeScript types, templates and
Calculator fixtures ship here. `prism-code --help` lists CLI arguments.
Experimental APIs remain experimental; repository `SPEC.md` is normative.

## Set up this machine (experimental)

```sh
npx prism-code@latest setup         # agents, skill and GitHub sign-in; no Docker needed, ends with what to do next
npx prism-code@latest setup --local # also Docker (also inside WSL) and the image cache; --pull also gets the SDK image
npx prism-code build --check        # T0: the model is well formed, seconds; hosted until the image is here
npx prism-code verify --lean        # T1: every proof and its exact axioms, about a minute; hosted until the image is here
npx prism-code axioms --write       # set every declaration's axiom policy in one pass
npx prism-code verify               # T2: the guest, the vectors and the holo, minutes
npx prism-code build --remote github # no Docker: your GitHub repository builds it, this machine verifies it
```

`setup` pulls nothing by default. Until the SDK image (about 5.7 GB) is here,
`build --check` and `verify --lean` run on the hosted verifier at
`https://mcp.uor.foundation/`, which receives the files under `src/` and stores
them unlisted: not searchable, but readable by anyone with the draft's ID.
`--local` runs either in the image instead. `build --check` checks syntax and
types, not proofs; `verify --lean` proves. The first
`build`, `verify` or `axioms` pulls the image and says so first. With no Docker at
all, `build --remote github` has the repository's own GitHub Actions build one
commit (the template's `build.yml`) and verifies what comes back here: the
commit, the digests, the signed provenance, the verdict and every vector.

`setup` records the program that reaches Docker, so later commands spawn it,
and moves `/tmp` off memory onto a cache volume: a full verify of the chess
example went from 814 s to 284 s on WSL. Judge each edit by the cheapest tier
that can refuse it. [Rows, tiers and overrides][guide-machine].

## Set up your agents (experimental)

```sh
npx prism-code@latest setup --dry-run
npx prism-code@latest setup
prism-code open "holo://build?agent=claude-code&q=Go%20to%20uor.foundation%20and%20build%20me%20a%20Prism%20app%20that%20tells%20whether%20a%20year%20is%20a%20leap%20year."
```

`setup` adds the MCP server `lexlean` at `https://mcp.uor.foundation/` to
each agent it finds: Claude Code at user scope, Codex, Cursor and VS Code.
For Claude Desktop it prints the Connectors step. It installs the
`prism` skill this package ships into `~/.claude/skills` and
`~/.agents/skills`. It registers the
`holo://` handler for the OS and remembers the preferred agent
(`--agent <id>`). Existing servers, files it cannot parse, and a `holo://`
handler another program owns, such as the Hologram app, are left alone.
`open` hands the sentence (at most 2000 characters) to the agent: a terminal
that runs `claude` or `codex` after Enter, the install link and clipboard
for Cursor and VS Code, or the Claude and ChatGPT prompt URL. Another host or
parameter exits 2. [Details and a check per OS][guide-setup].

Beside `lexlean`, `setup` adds the local server `prism` to the same agents,
Claude Desktop included: `prism-code mcp` on stdio.

## Build a verified app from one sentence (experimental)

With the `prism` server connected, ask the agent for a Prism app in one
sentence, such as "build me a Prism app for loan approval". The agent
translates the sentence into a draft, passes it to `prism_spec` to be completed
and checked, and shows it to you once for approval, properties first: Lean
proves them, so they must be the ones you mean. Nothing is built until you
approve. The spec has six parts, and the agent asks about a part only when it
cannot infer it:

| Part | Says | Becomes |
| --- | --- | --- |
| purpose | what the app decides, in one sentence | the app's name and description |
| fields | what goes into one request, and what each field means | a line of space-separated fields, each a number or a choice |
| outcomes | what the answer can be, and what each answer means | the answers, plus `invalid` for a malformed request |
| rules | `when ... then ...`, in order, then `otherwise`, each with its reason | the decision the guest runs |
| properties | what must `never` or `always` happen, each with the harm it prevents | one theorem each, proved by Lean |
| examples | real requests and their answers | acceptance vectors |

A model writes only what you said: a `title`, the `fields`, the `rules` and
the `otherwise` answer, and a property only when you stated one. That is the
draft form of `prism/spec/1`, and Prism completes it, the same way every time
(`completeSpec` in `src/journey/complete.mjs`, a pure function):

| Left out | Prism derives |
| --- | --- |
| `outcomes` | the answers the rules and `otherwise` give, in first-appearance order; never `invalid` |
| `purpose`, `name` | one sentence from the answers and the fields; the name from the title |
| `examples` | the first request each rule decides, and one for `otherwise`, at most six |
| `properties` (fewer than three) | proposals, up to three in all: `always <answer> when <conditions>` for each rule no earlier rule overrides, then `never <answer> when <field> is <value>` for each answer a choice never gets |

A proposal is kept only when no request breaks it, every candidate request
having been tried, and its `why` starts "Proposed by Prism", so the review
shows it as proposed, first, and you keep or strike it before Lean proves it.
A spec that already holds `purpose`, `outcomes`, `properties` and `examples` is
not a draft: it is taken as written and nothing is proposed again, so a
guarantee you struck stays struck. Prism also drops, and says so in `notes`, an
`invalid` listed among the answers that no rule answers, and a guarantee whose
conditions no request can meet; and it reads a number field compared with a
bare word that names another number field (`"value": "limit"`) as that field. The completed spec is what `prism/spec.json`
holds and what the app's seal names.

For a caller that can hold a model's answer to a JSON schema,
`src/journey/spec-schema.mjs` exports `DRAFT_JSON_SCHEMA` (the draft form,
about 2 KiB, closed, whole non-negative bounds) and `SPEC_JSON_SCHEMA` (the
whole spec). `checkSpec` completes and checks a spec in one call, and
`repairMessage` turns a refusal into what to tell the model: each false
guarantee as the JSON it wrote, beside the rule that decides against it and the
request that shows it, with the two ways out. Why: [#666][issue-666].

[issue-666]: https://github.com/UOR-Foundation/PrismPM/issues/666

Beside these, `limits` lists what the app does not decide. Reasons, meanings
and limits are for people: no proof depends on them, and they are kept with
what they describe, so a reason is dropped when its rule changes.

Prism writes the spec as `prism/SPEC.md` in the [OpenSpec](https://openspec.dev)
format: a `## Purpose`, then a `### Requirement:` with SHALL and a
`#### Scenario:` with WHEN and THEN for every guarantee and rule, each marked
proved by Lean or tested. The app's repository carries the same file at
`openspec/specs/<name>/spec.md`.

The draft is checked as a whole. A property the rules break comes back
with the request that breaks it, and an example the rules contradict comes back
with the rule that decides it. `prism_build` then writes the LexLean model in
`prism/`, has Lean prove every property (hosted, sending `prism/src/` to be stored
unlisted, until the SDK image is here), builds the holo in the SDK image with
the cache `setup` created, and replays its acceptance vectors through the
guest. Wrong axiom sets are corrected without asking. Proving takes about a
minute; a first build takes ten minutes or more. The properties are proved;
the reading of requests and the examples are tested.

The tools are `prism_start`, `prism_answer`, `prism_spec` (read the whole spec
as `prism/spec/1` JSON, or replace it with a draft or a whole spec), `prism_prove`, `prism_build`, `prism_try`
(answer one request) and `prism_status`. Proving and building run as jobs, so a
call returns `running` and the next call picks the job up. Design:
[docs/proposals/325-prism-journey.md](../../../docs/proposals/325-prism-journey.md).

### What the journey reports, and how to turn it off

When a journey asks for something Prism or Lean cannot do, `prism-code` writes a
fingerprint to `$PRISM_HOME/gaps.jsonl`, with no question and no agent step:

| Kind | When | Construct |
| --- | --- | --- |
| `refusal` | an answer or spec is refused by a validation rule | the rule, such as `fields.too-many` or `outcome.unknown` |
| `roundtrip` | a valid spec does not come back from its own answers: a Prism bug | the part, and the rule that refused it, such as `rules:choice.value` |
| `unproved` | Lean did not prove a property that no sampled request breaks | its shape, such as `always:choice-is+number-le-field`, with the Lean code |
| `model-refused` | the toolchain refused the model Prism generated | the step, with the diagnostic code |

A fingerprint is the kind, the construct, the diagnostic code and the
`prism-code` version: never a word, name or number the user wrote. The next call
`prism-code` makes to the hosted verifier carries the unsent ones, counted, in
its `_meta` under `foundation.uor/prism-gaps`, with a random install ID; no
other request is made, so with the SDK image here they stay on this machine
until a hosted call. `PRISM_TELEMETRY=0` or `DO_NOT_TRACK=1` records and sends
nothing. `setup` says so in one line.

## Load, dispatch and replay vectors

```js
import { load } from 'prism-code';

const app = await load('node_modules/prism-code/fixtures/Calculator.holo');
app.identities.verified; // true: footer, blob labels and manifest checked with BLAKE3
app.limits;             // { request: 52, response: 27, guestAllocation: 65536 }
const response = await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
new TextDecoder().decode(response); // '1\tok\t42'
await app.acceptance();            // { total: 22, passed: 22, failed: [] }
```

`load` accepts bytes, a `Blob`, a `.holo` path/URL, or a closure directory
(path in Node, URL in a browser). Each dispatch uses a fresh guest instance
and moves bytes only; callers choose text encoding.

An altered holo does not open. When the footer is not the BLAKE3 of the body,
a blob does not hash to its label, or the manifest, directory and provenance
name different blobs, `load` rejects with `DigestMismatchError` (`check`
`holo.integrity`), and so does a closure whose files do not match its
provenance. `load(source, { allowUnverified: true })` opens it anyway, with
`identities.verified` false; nothing that reads it should treat its answers
as the application's. `prism-code vectors` refuses it the same way, and with
`--allow-unverified` replays it and exits 1.

Fields: `model`, `profile`, `limits`, `vectors`, `directory`, `identities`,
`evidence`, `view`, `provenance.model/browser`. Archives supply model, limits,
vectors, directory, kappas, fingerprint and model provenance; browser
provenance is null. Closures need `{ model }` for model/limits/vectors, infer
profile from glue, have null directory/model provenance. `view` holds
HOLOVIEW entry/files or closure files; `evidence` is pointers, not proof
checking. Closure identities report mismatches/unverifiable external IDs.

```sh
npx prism-code vectors app.holo
npx prism-code vectors closure/ --model model.prism.json
```

`vectors` exits 1 on failure. Numeric-profile closures expose only
`calculate()`; pass their model for the wire format.

## Run and containers (experimental)

```sh
npx prism-code run app.holo --port 8080 --policy policy.json
npx prism-code run app.holo --port 8080 --allow-unverified
npx prism-code run app.holo "$REQUEST" --policy policy.json --rm
npx prism-code run app.holo --input "$REQUEST" --allow-unverified
npx prism-code inspect <container> --json
npx prism-code inspect <container> --format state.exitCode
npx prism-code rm <container>
```

Without input, `run` serves the portable view and dispatches
`POST /_hologram/intent`. With input, it runs one container, prints only
guest output to stdout and returns its exit code. It checks the holo under
its policy and grant before instantiation. Default policy requires P2:
unsigned reference holos are P0 and refused. Explicitly choose a policy
like `{"minimum":"P0"}` or `--allow-unverified`, which warns on every start.
Closures cannot be judged and require that flag. Bad policy/non-holo exits 2.

```js
import { prism } from 'prism-code';
const container = await prism.containers.run('app.holo', '1\tadd\t20\t22', {
  policy: { minimum: 'P0' },
});
container.status;   // 'exited'; states: created, running, exited
container.exitCode; // 0
container.text();   // '1\tok\t42'
await container.inspect(); // prism/container/1: id, image, state, verdict, output
await container.remove();
```

`create`/`start` is the two-step API; `rm: true` removes on exit. Failed runs
return codes; unopenable images reject without creating a container. CLI
records retain times/output, never input, under `$PRISM_HOME/containers`
(default `~/.prism/containers`) until removed.
`EXIT_CODES` and `exitCodeFor(error)` share this mapping:

| Exit | Reason |
| --- | --- |
| 0 | Success |
| 1 | Verification verdict failure, attestation error, other `PrismError` |
| 2 | Verification without verdict, `PrismCodeError`, `CapabilityDeniedError` |
| 3 | `SigningError` |
| 10 | `ProofMismatchError` |
| 11 | `WorldMismatchError` |
| 12 | `DeterminismViolationError` |
| 13 | `ReplayError` |
| 70 | Untyped failure, guest trap or runtime bug |

## Capabilities and world (experimental)

Capability files grant explicitly; deny wins.

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

```sh
npx prism-code run app.holo --capabilities caps.json --capability-set default --allow-unverified
```

```js
const app = await load(bytes, { capabilities: caps, capabilitySet: 'default' });
app.capabilities.allows('outbound-hosts', 'https://api.example.com/v1');
app.capabilities.assert('variables', 'signing_key'); // CapabilityDeniedError
app.world; // { contract: 'hologram:guest/core-wasm@1', within: true, pure: true, effects: [] }
await app.experimental_verify();
```

`fromFile(path, { capabilities: 'caps.json' })` reads a file. Default set is
`default`; `capabilitySet` selects another. Hosts use `scheme://host[:port]`,
`*` wildcards and `*.` subdomains; no port means the scheme's default.
Unknown members fail `capabilities.invalid`.

Before compilation, an ungranted world import fails `world.capabilities`
(PP5602). A pure world has no clock, random, socket, filesystem or unknown
import. The current `hologram:guest/core-wasm@1` imports/links nothing;
guest imports fail `capabilities.import` regardless of grants. A policy's
`effects: []` requires purity; `["clock"]` allows the clock. Vendored
`worldPolicy` keeps runtime/verifier decisions equal.

## Create, configure and build (experimental)

```sh
npx prism-code init calculator
# equivalent: npm create prism-code calculator
npx prism-code init calculator --sdk-image ghcr.io/uor-foundation/prismpm-sdk@sha256:<digest> --force
cd calculator
npx prism-code build --check
npx prism-code build
```

`init` writes `prism.toml` (version 0.1.0, nothing granted) and `text-request`:
language-1.2 model, `prism.arch`, Lean workspace, `lexlean.lock`. The template
is byte-identical to the reviewed ho-11 fixture. Existing files require
`--force`. Supply a real SDK digest: `--sdk-image` copies `standards.lock`
and runs `prismpm update --toolchain <image>` to write `prismpm.lock`.
There is no default image.

`build`, `build --check`, `verify`, `conformance` run `prismpm` in the image
pinned by the current directory's `prismpm.lock`. Docker and a Linux
amd64/arm64 SDK image are required; `build` and `verify` mount the Docker
socket. `build --check` validates the model and writes nothing. No native
`prismpm` ships here; JavaScript alone cannot build a `.holo`.

```toml
[application]
name = "exchange"
version = "0.1.0"

[model]
source = "model"
watch = ["model/**/*.lex.tex", "examples/*.json"]

[capabilities]
allow-outbound-hosts = ["https://api.exchange.example"]
allow-variables = ["log_level", "exchange_api_key"]

[variables]
log_level = "info"
exchange_api_key = { secret = true }
```

```sh
npx prism-code manifest . --target node --json
```

`manifest` validates/lints and exits 2 on failure. Secret literals and
credential-shaped strings fail `manifest.secret` without echoing values.
`--target browser|node` overlays `prism.browser.toml` or `prism.node.toml`:
tables merge by key; arrays/other values replace. `[capabilities]` is an
inline set or `file` and `set`. `env(NAME)` reads that name; `{ secret = true }` reads the uppercase
variable name (e.g. `EXCHANGE_API_KEY`); missing values fail `manifest.env`.

```js
import { fromFile, readManifest } from 'prism-code/node';
import { resolveVariables } from 'prism-code';
const { manifest, grant } = await readManifest('.', { target: 'node' });
const app = await fromFile('app.holo', grant);
const vars = resolveVariables(manifest, process.env);
```

`parseManifest` and `manifestCapabilities` are also exported. JSON schemas:
`@prism-code/spec`'s `schemas/manifest/manifest-v1.schema.json` and
`schemas/capabilities/capabilities-v1.schema.json`.

### Develop locally

An agent never writes the model: `build --unstable-author` was removed. Every
app comes from one `prism/spec/1` spec through the guided path, `prism-code mcp`.

```sh
npx prism-code dev
npx prism-code dev path/to/project --policy policy.json --no-open
npx prism-code dev --build "make holo" --image out/app.holo
```

Studio watches, rebuilds and checks at `http://localhost:4100`; `--port`
changes it, conflicts fail. Check shows verdict/reasons, edit-to-verdict
time and agreement with the browser verifier. Failed builds retain a
visibly stale verdict. The studio Replay tab remains unavailable. The page
loads nothing externally. Without `--build` or `[model].build`, dev uses
`build --update`, rewriting `prismpm.lock` pins: commit it with source.
This needs Docker/lock; configured build commands run with your permissions.

## Inspect and verify offline (experimental)

```sh
npx prism-code inspect Calculator.holo
npx prism-code inspect Calculator.holo --json
npx prism-code inspect Calculator.holo --format sections[0].digest.sha256
npx prism-code check Calculator.holo --policy policy.json --json
```

`inspect` reads revision, SHA-256/BLAKE3 sections, manifest, model,
provenance, world, attestations and integrity without running the guest.
Human output has stable order/full digests; JSON: canonical
`prismpm/holo-inspection/1`. `--format` selects dotted paths: raw strings,
otherwise canonical JSON; missing values exit 2, malformed paths 64.
Readable damage reports failed integrity; unknown structures exit 2.
Closures return a JSON identities/limits/provenance/view summary.

```js
import { inspect, experimental_verify, VerificationError } from 'prism-code';
const inspection = await inspect(bytes); // also app.inspect()
const verdict = await app.experimental_verify({ minimum: 'P0' });
verdict.level;  // P0 for unsigned holo
verdict.passed; // true under explicit P0 policy
await experimental_verify(bytes, { world: lock.inputs.world, throw: true });
```

`experimental_verify` / `app.experimental_verify` return `prism/verdict/1`
offline; no option raises the evidence's level. Options: `name`, `minimum`
(P0–P3), `digests`, `world`, `throw`. `experimental_createClient(options)`
sets defaults: call overrides client overrides `PRISM_MINIMUM_LEVEL`.
`world` accepts `lock.inputs.world`; contract/hash changes fail `world.hash`.
Imports/exports must match WIT independently. `throw: true` throws typed
verdict failures; invalid options/revisions/non-holos always throw (no verdict).

`check` runs the same checks without Docker. `--policy` takes shipped
`default`, `pure-only`, `provenance-only`, a JSON options file (also `effects`),
or `.rego`. Default requires P2 and world-within-grant. Environment minimum
applies unless JSON specifies it; Rego sets its own. JSON may name itself;
otherwise the verdict names its path. A policy is never read from the holo.

```rego
package prism.policy
import rego.v1
minimum := "P0"
deny contains {"rule": "policy.house.pure", "message": "the world must be pure"} if {
  input.world.pure == false
}
```

| `check` exit | Meaning | `--json` stdout |
| --- | --- | --- |
| 0 | Policy passed | verdict |
| 1 | Policy failed/denied | verdict |
| 2 | No verdict: bad archive/revision or unreadable/invalid/unevaluable policy | empty |

Treat exit 2 as failure. CI may redirect `--json > verdict.json` and retain
it on failure. With `throw: true`, denial is `PolicyDeniedError`; bad Rego
is `PolicyParseError` / `PolicyEvaluationError`, exit 2.

P1 requires a signed provenance statement; P2 also needs a signed proof
statement for the actual guest. Trust only the signer named with
`--key public.pem`, or `--certificate-identity` / `--certificate-identity-regexp`
plus `--certificate-oidc-issuer` and `--trusted-root`. Without a signer even
signed holos are P0; changed/wrong guest fails `proof.subject`. P2+ text
names what it trusts the signer for. Reference builds still lack these
statements; JS extensions do not imply Rust wire admission. `check` without
a holo is a usage error: the model check is `build --check`.

Errors extend `PrismError` with stable `code`; verification adds `check`,
registered `diagnostic`, `verdict`, `reasons`.

Classes/codes: `VerificationError` / `verification_failed`,
`ProofMismatchError` / `proof_mismatch`, `CapabilityDeniedError` /
`capability_denied`, `WorldMismatchError` / `world_mismatch`,
`DeterminismViolationError` / `determinism_violation`, `ReplayError` /
`replay_failed`. `PrismCodeError` uses the load/archive check, e.g. `archive.magic`.

## Histories and typed clients (experimental)

```sh
npx prism-code record app.holo --output app.history.json
npx prism-code replay app.history.json --image app.holo
npx prism-code replay histories/ --image app.holo --statement replay.json
npx prism-code run app.holo --record live.history.json --allow-unverified
npx prism-code generate Calculator.holo --out src/calculator
```

`prism/history/1` records ordered dispatches/outcomes. Acceptance vectors
are the first history; a recorder or `run --record` captures live calls.
Replay compares every outcome byte-for-byte, detecting changed answers even
when new vectors changed too. CLI exits 0 unchanged, 1 diverged, 2 unable.

```js
const history = await app.history();
const recorder = app.experimental_recorder();
await recorder.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
const recorded = await recorder.history();
const { statement, divergenceCount } = await app.experimental_replay([history, recorded]);
```

Divergence throws `DeterminismViolationError` with every divergence in
`details`; `throw: false` returns instead. Unreplayable inputs always throw
`ReplayError`. The deterministic in-toto v1 statement
(`https://uor.foundation/prism/replay/v1`) binds guest, model, history digests,
divergence count and runtime, with no clock. Sign with `attest`.
`check <holo> --replay <file>` can withhold P3, never support it from unsigned
sidecars. Signed statements in the holo need the named signer.

`generate --out` is required; no `node_modules` writes; only `--lang js`.
Calculator gets import-free `world.js`/`.d.ts` (WIT checks, instantiate,
fresh-instance dispatch), `calculator.js`/`.d.ts` (`Calculator`,
`CalculatorError`, `MODEL`, `OPERATIONS`).

```js
import { Calculator } from './calculator/calculator.js';
const calculator = new Calculator(app.dispatch);
await calculator.add(20, 22);  // 42n
await calculator.divide(1, 0); // CalculatorError, code 'division-by-zero'
```

Models without typed operations get `invoke(bytes)`. `prism-generate.json`
binds language, generator version/source SHA-256, world/model (lock shapes)
and file hashes. Intact reruns write nothing; edited generated files are
regenerated, unrelated files never overwritten. Rust/Python writers are future work.

## Attestations and registry transport (experimental)

```sh
prism-code attest app.holo --predicate proof.json --type https://uor.foundation/prism/proof/v1
prism-code verify-attestation app.holo \
  --certificate-identity https://github.com/acme/app/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
# Local keys, offline:
prism-code attest app.holo --predicate proof.json --type https://uor.foundation/prism/proof/v1 --key private.pem --output signed.holo
prism-code verify-attestation signed.holo --key public.pem
```

Bundles are Sigstore v0.3 JSON Lines in the final Extension row
(`https://uor.foundation/extension/attestation-bundle/v1`), covered by the
footer. `appendAttestations(holoBytes, [bundle])` keeps other rows identical
and recomputes the footer; `stripAttestations(signed)` restores the unsigned
archive. `app.attestations()` decodes types/statements/subjects/bytes; decoding
does not verify signatures. Subjects resolve by `blake3` labels. Rust wire
admission remains separate.

`attest` signs in-toto v1 and appends a bundle, rewriting in place unless
`--output`. Default subject is guest with both digests; `--subject` selects
guest, view, model, capabilities or a `blake3:` label. Keyless uses GitHub OIDC
(`id-token: write`) or `SIGSTORE_ID_TOKEN`, Fulcio, Rekor v2 and RFC 3161
timestamps. `--key` signs offline; `--signing-config` selects a private instance.

`verify-attestation` checks subject digests, DSSE signature, key/certificate
chain, log, signed time and signer; one bundle of `--type` (default all)
must pass everything. Keyless requires exact identity or identity regexp plus
issuer, or it refuses. `--key` checks keyed bundles;
`--trusted-root trusted_root.json` pins the root for offline verification;
otherwise TUF fetches the public root. Exits: 0 verified, 1 refused,
3 signing failed, 64 bad policy.

```js
import { experimental_attest, experimental_verifyAttestations } from 'prism-code/node';
const { holo } = await experimental_attest(bytes, { type, predicate, key: privatePem });
const result = await experimental_verifyAttestations(holo, { key: publicPem });
// passed; results: index, predicateType, subjects, passed, signer, time, error
```

Typed failures: `SigningError` (`sign.*`), `SignatureInvalidError`,
`IdentityMismatchError`, `TransparencyError`, `SubjectMismatchError`,
`AttestationNotFoundError`, `TrustRootError`; bad policy is `VerificationError`
with `policy.invalid`. `verify` delegates to SDK; `verify-attestation` checks signatures.

```sh
prism-code push app.holo ghcr.io/acme/app:1.0 --keyless
prism-code pull ghcr.io/acme/app:1.0 app.holo --key public.pem
prism-code pull ghcr.io/acme/app:1.0 dir://./store:1.0
prism-code push dir://./store:1.0 registry.internal/app:1.0
```

`push` stores one deterministic OCI Distribution 1.1 layer/manifest. Each
bundle becomes a byte-identical cosign-style referrer; older registries use
`sha256-<digest>` tag fallback. `--key` / `--keyless` also sign per-predicate
manifest statements for cosign; otherwise push warns. `oras discover` lists them.

`pull` writes only after manifest/layer digests, footer, labels, BLAKE3
annotations, policy verdict (default P0 or `PRISM_MINIMUM_LEVEL`), attestation
subjects and, when a signer is named, a signature pass. Signer flags match
`verify-attestation`; without one it reports signatures unchecked.
Exits: 0 success, 1 digest/check failure, 2 registry unavailable,
3 signing failure, 64 usage.

| Reference | Meaning |
| --- | --- |
| `ghcr.io/acme/app:1.0` | Tag; default `latest`; registry required |
| `ghcr.io/acme/app@sha256:<hex>` | Manifest digest |
| `ghcr.io/acme/app@blake3:<hex>` | Pull-only archive fingerprint via checked `blake3-<hex>` tag |
| `dir://./store:1.0`, `--store ./store app:1.0` | Offline OCI layout, readable by `oras --oci-layout` |

Offline layouts preserve referrers and republish with the same digest.
Credentials use Docker `credHelpers`, `auths`, `credsStore`, or `GHCR_TOKEN` /
`GITHUB_TOKEN` for ghcr.io; no token flag. Loopback allows HTTP; other HTTP
registries require `--plain-http`.

Node APIs: `experimental_push(bytes, reference, { key })` returns digest /
fingerprint; `experimental_pull(reference, { key, output })` returns holo /
verdict. Errors: `RegistryAuthError`, `ReferrersUnsupportedError`,
`DigestMismatchError`, `PullVerificationError`, `ManifestNotFoundError`,
`RegistryError`, `ReferenceInvalidError`.

## Export and browser (experimental)

```sh
prism-code export ghcr.io/acme/calculator@sha256:<digest> --out site
prism-code export ghcr.io/acme/calculator@sha256:<digest> --tar site.tar
```

`export` reads a verified release in `.prism/oci` from `prismpm build`/`pull`,
not a copied folder or holo (which lacks the browser adapter). Output:
`index.html`, `app.js`, `app.css`, `<stem>.js`, `<stem>_bg.wasm`,
`provenance.json`, and for closure v2 the brand fonts, their licences, `icon.svg`,
`icon-512.png` and `manifest.webmanifest`. `--tar`: deterministic ustar, sorted, mode 0644,
owner/mtime 0, no directory entry. Bundles go unchanged alongside to
`<name>.attestations.jsonl`. Default `--out` is `export`; destinations must
be new. `--project` defaults to cwd; `--json` prints `prismpm/browser-export/2`.

Files are checked against stored blobs, layer digests and manifest then
read back. Mismatch removes output and throws `ExportMismatchError`
(`export_mismatch`, exit 2), check `export.manifest`, `export.layer`,
`export.files` or `export.tree`. Integrity grants no publication authority.
Node: `experimental_exportBrowser({ reference, out })` returns
receipt/path/attestations; `experimental_checkExport({ releaseDigest, path })`
returns files/tree digest.

```js
import { load, mount } from 'prism-code/browser';
const app = await load('/apps/Calculator.holo');
mount(document.querySelector('#app'), '/apps/calculator/'); // closure iframe
```

HOLOVIEW mounting needs an intent service worker and is not in this release.
`prism-code`, `/browser`, `/canonical` import no `node:` modules and work on
browsers/edge hosts. The `browser` field excludes `/node` for bundlers;
browser `load` fetches paths as URLs.

## Plugins and providers (experimental)

`prism-<name>` on PATH runs as `prism-code <name>`, preserving args/exit.
Built-ins win, then first PATH directory. Windows: case-insensitive, PATHEXT
order, `.cmd`/`.bat` quoting for `cmd.exe`. Help lists plugins. Required
`prism-cli-plugin-metadata` JSON:

```json
{"schemaVersion":"1","vendor":"UOR Foundation","version":"0.2.0","shortDescription":"...","errorHooks":["check","build"]}
```

Invalid metadata prevents running. On subscribed command failure,
`prism-cli-plugin-hooks` receives `{schemaVersion, command, args, exitCode}`
on stdin. `{"messages":[...]}` adds at most ten stderr lines under "What's
next:"; failure, invalid output or 5s timeout adds nothing.
`PRISM_CODE_NO_HOOKS=1` disables hooks. `npx prism-code doctor` (`prism-doctor`)
checks Node, Docker, lock and optional Sigstore; exit 1 on failure. Its hook
helps SDK commands failing with 64 (no lock) / 69 (no Docker).

Providers run outside the holo as caller, inheriting environment: capabilities
bound whether they run, not behavior. Type and returned variables need grants.

```toml
[capabilities]
allow-providers = ["kv"]
allow-variables = ["rates_url", "rates_store"]

[capabilities.rates]
provider = { type = "kv", options = { set = ["base=EUR"] } }
```

```sh
npx prism-code providers up --json
npx prism-code providers down
```

Node: `readManifest`, `resolveProviders`, `releaseProviders`.
`resolveProviders(project)` returns `{ env, providers, withheld }`; the host
passes `env` on. The pure guest cannot read it; `run` ignores `prism.toml`.

Protocol in project directory:
`prism-provider-<type> --project-name <application> up|down [--<option>=<value> ...] <name>`.
Stdout JSON Lines `{type,message}`: `info`, `debug`, `error`, `setenv`.
`setenv` message `URL=...` for `rates` becomes `RATES_URL`. Success needs exit
0 and no error message. Errors never quote potentially secret replies:
`CapabilityDeniedError`, `ProviderNotFoundError`, `ProviderReplyError`,
`ProviderFailedError`. Packaged `prism-provider-kv` stores
`.prism/kv/<application>/<store>.json`, supports `store`, `dir`, repeated
`set = ["key=value"]`, deletes on down.

## Compatibility

0.1.0 hashing stays at `prism-code/canonical`: `canonicalize`, `codeHash`,
`describe`, `differs`. Hashes are host-independent. Without `node:crypto`,
synchronous JS SHA-256 is used; other algorithms fail `canonical.algorithm`
(WebCrypto is asynchronous). Legacy top-level exports were deprecated in
0.2.x for removal in 0.3.0. No Lean proof checking, native SDK binary or
JavaScript-only holo production is promised here.

## License

MIT.

[guide]: https://github.com/UOR-Foundation/PrismPM/blob/main/sdk/npm/prism-code/docs/guide.md
[guide-setup]: https://github.com/UOR-Foundation/PrismPM/blob/main/sdk/npm/prism-code/docs/guide.md#set-up-your-agents-experimental
[guide-machine]: https://github.com/UOR-Foundation/PrismPM/blob/main/sdk/npm/prism-code/docs/guide.md#set-up-this-machine-experimental
