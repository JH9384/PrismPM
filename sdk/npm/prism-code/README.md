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
npx prism-code run app.holo --port 8080 [--policy policy.json] [--allow-unverified]
```

serves the archive's portable view and answers `POST /_hologram/intent` (the
request the view posts) by dispatching through the guest.

`run` gates on `check` (#282): it judges the holo against the policy, with the
capability set it will run under, before anything is instantiated. A holo
that fails is refused with its verdict on stderr and the exit code of the reason
(1 for every holo today, see the table under Containers); no verdict (an
unreadable policy, a file that is not a holo) is exit 2. Every holo is P0
until holos carry signed statements, so under the default policy (P2) every
`run` is refused today: pass a policy that accepts the holo, such as
`{"minimum": "P0"}`, or `--allow-unverified`, which runs it anyway and prints a
warning on every start. A closure cannot be judged and runs only with the flag.

With an input, `run` is one run as a container (below) and does not serve:
`prism-code run app.holo "$REQUEST"` or `--input "$REQUEST"`.

A policy's `effects` lists the impure effects the world may import: `[]` is
the pure-world policy, which refuses a world importing a clock, random,
socket, filesystem or unknown interface (`policy.effects`); `["clock"]` grants
the clock.

## Containers (experimental, #348)

One run of a holo is a container: `created`, `running` or `exited`, with a start
and finish time, an exit code and the returned output, kept until removed.

```js
import { prism } from 'prism-code';

const container = await prism.containers.run('app.holo', '1\tadd\t20\t22', { policy: { minimum: 'P0' } });
container.status;     // 'exited'
container.exitCode;   // 0
container.text();     // '1\tok\t42'
await container.inspect();   // { schema: 'prism/container/1', id, image: { digest, ... }, state, verdict, output }
await container.remove();
```

`create` then `start` is the two-step form. `rm: true` removes it on exit. A run
is gated on `check`, and a failed run is an exit code, never a rejection; an image
that cannot be opened makes no container, and the call rejects.

```
npx prism-code run app.holo "$REQUEST" [--rm] [--policy policy.json] [--allow-unverified]
npx prism-code inspect <container> [--json] [--format state.exitCode]
npx prism-code rm <container>
```

stdout holds the guest's output and nothing else, and the process exits with the
container's code. The command line keeps one file per container in
`$PRISM_HOME/containers`, by default `~/.prism/containers`, with the output and never
the input. `EXIT_CODES` and `exitCodeFor(error)` are the table both use:

| Exit | From |
| --- | --- |
| 0 | Success |
| 1 | `VerificationError` with a verdict, an attestation error, any other `PrismError` |
| 2 | `VerificationError` with no verdict, `PrismCodeError`, `CapabilityDeniedError` |
| 3 | `SigningError` |
| 10 | `ProofMismatchError` |
| 11 | `WorldMismatchError` |
| 12 | `DeterminismViolationError` |
| 13 | `ReplayError` |
| 70 | Anything untyped: a guest trap, or a bug in the runtime |

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

### The world within the grant (experimental, #283)

Before the guest is compiled, the runtime compares the imports of the world
its contract names with the granted set. A world that imports a capability
kind the set grants none of never loads: `CapabilityDeniedError`
(`world.capabilities`, the verdict's `PP5602`). `app.world` reports the
result, and whether the world is pure: no clock, random, socket, filesystem or
unknown import, so its runs replay.

```js
app.world;  // { contract: 'hologram:guest/core-wasm@1', within: true, pure: true, effects: [] }
await app.experimental_verify();  // judges world.capabilities against the set the holo was loaded with
```

`hologram:guest/core-wasm@1` imports nothing, so it is within every grant and
pure. The check is `@prism-code/verify`'s `worldPolicy`, vendored, so the
runtime, `holo.verify()` and the browser verifier cannot disagree. Design:
`docs/proposals/283-world-within-policy.md`.

## Start a project (experimental, #281)

```
npx prism-code init calculator                       # or: npm create prism-code calculator
npx prism-code init calculator --sdk-image ghcr.io/uor-foundation/prismpm-sdk@sha256:<digest> --force
```

`init` writes `prism.toml` (application `calculator` 0.1.0, nothing granted) and the
`text-request` template: a language-1.2 text application, its `prism.arch` lexicon, its Lean
workspace and the `lexlean.lock` that binds them. The template is a byte-for-byte copy of the
reviewed fixture `tests/fixtures/holo/ho-11-text-application`, so the project starts from a model
the repository's own gate checks; edit it from there. Existing files are never overwritten without
`--force`.

`--sdk-image` binds the project to an SDK image: it copies the image's `standards.lock` and runs
`prismpm update --toolchain <image>` in it, which writes `prismpm.lock`. Then `npx prism-code
build --check` checks the model in that image, and `npx prism-code check <app.holo>` judges a built
holo. No PrismPM SDK release exists yet, so there is no default image.

## The prism.toml manifest (experimental, #280)

A project names its application, its model and its grant in `prism.toml`:

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
exchange_api_key = { secret = true }   # read from EXCHANGE_API_KEY at run time
```

```
npx prism-code manifest [<dir>] [--target browser|node] [--json]
```

`manifest` checks and lints the file and exits 2 when it fails. A secret
written as a literal (`{ value = "...", secret = true }`) or any string shaped
like a credential is an error (`manifest.secret`), and the message never echoes
the value. `--target` merges `prism.browser.toml` or `prism.node.toml` over
`prism.toml`: tables merge key by key, and arrays and other values replace.
`[capabilities]` is one capability set written inline, or `file` and `set`
naming a capability file.

```js
import { parseManifest, manifestCapabilities, resolveVariables } from 'prism-code';
import { readManifest } from 'prism-code/node';

const { manifest, grant } = await readManifest('.', { target: 'node' });
const app = await fromFile('app.holo', grant);               // the manifest's grant
const vars = resolveVariables(manifest, process.env);        // env(NAME) unset: throws manifest.env
```

The schema is `@prism-code/spec`'s `schemas/manifest/manifest-v1.schema.json`;
the design is `docs/proposals/280-prism-toml.md`.

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

## Replay a history (experimental)

A history, `prism/history/1`, is the dispatches of one application in order, each with its recorded outcome. A holo's acceptance vectors are its first history, and `run --record` or a recorder takes another from live dispatches. A replay runs every event against a build and compares the outcomes byte for byte, so a build that changed what it answers fails, even when its own vectors changed with it.

```
npx prism-code history app.holo --output app.history.json     # the acceptance vectors as a history
npx prism-code replay app.history.json --holo app.holo        # exit 0 unchanged, 1 diverged, 2 could not replay
npx prism-code replay histories/ --holo app.holo --statement replay.json
npx prism-code run app.holo --record live.history.json        # every dispatch, as it happens
```

```js
const app = await load('app.holo');
const history = await app.history();

const recorder = app.experimental_recorder();
await recorder.dispatch(encoder.encode('1\tadd\t20\t22'));
const recorded = await recorder.history();

const { statement, divergenceCount } = await app.experimental_replay([history, recorded]);
```

A divergence rejects with `DeterminismViolationError` (`replay.divergence`), and every divergence is in its `details`. With `throw: false` the result comes back instead. A replay that cannot be carried out always rejects with `ReplayError`.

`statement` is an in-toto Statement v1 of type `https://uor.foundation/prism/replay/v1`: the guest as its subject, the model, every history by its sha256 and BLAKE3, the divergence count and the runtime. It holds no clock, so the same replay writes the same bytes. Sign it with `prism-code attest`. `check <holo> --replay <file>` judges a statement from beside the holo, which can withhold P3 and never support it because it is unsigned. Reading signed statements from the holo waits on #270, and until then every holo is P0. The design is `docs/proposals/284-histories-replay.md`.

## Generate a typed client (experimental)

`prism-code generate` writes bindings and a typed client from the holo's WIT
world and its model into a directory you name. There is no default directory,
and nothing is written into `node_modules`.

```
npx prism-code generate Calculator.holo --out src/calculator
```

For the Calculator it writes four files, ES modules with TypeScript
declarations beside them, that import nothing:

- `world.js`, `world.d.ts`: the world `hologram:guest/core-wasm@1`, read from
  its WIT file. `instantiate(module)` checks the guest's exports, and
  `dispatch(module, request)` runs one request on a fresh instance.
- `calculator.js`, `calculator.d.ts`: the `Calculator` class, with one method
  per operation of the model, `CalculatorError` with the guest's error codes,
  and `MODEL`, `OPERATIONS`.

```js
import { load } from 'prism-code';
import { Calculator, CalculatorError } from './calculator/calculator.js';

const app = await load('Calculator.holo');
const calculator = new Calculator(app.dispatch);
await calculator.add(20, 22);      // 42n
await calculator.divide(1, 0);     // rejects: CalculatorError, code 'division-by-zero'
```

A model without typed operations gets a client with `invoke(bytes)`.

Beside the files, `prism-generate.json` records the language, the generator
(version and the sha256 of its source), the world and the model the files came
from, and the sha256 of each file. The world and the model are shaped like
`inputs.world` and `inputs.model` of `prismpm.lock`. A second run with the same
inputs and intact files writes nothing and says the directory is up to date. An
edited generated file is written again; a file in the directory that
`generate` did not write is never overwritten.

`--lang js` is the only writer today. Rust and Python writers follow on the
same code model (#289).

## Check one in CI (experimental)

`prism-code check <app.holo>` judges a holo against a policy and prints the
verdict: the assurance level, whether the policy passed, and every reason. It
runs the same checks as `experimental_verify`, offline, with no Docker.

```
npx prism-code check Calculator.holo
npx prism-code check Calculator.holo --policy policy.json --json
```

| Exit | Meaning | stdout with `--json` |
| --- | --- | --- |
| 0 | A verdict was reached and the policy passed. | one verdict |
| 1 | A verdict was reached and the policy failed or denied. | one verdict |
| 2 | No verdict: not a holo, an unreadable, unparsable or unevaluable policy, an unknown format revision. | nothing |

The policy is a verify-time input, never read from the holo. `--policy` takes a
Rego file (`.rego`), the name of a shipped policy (`pure-only`,
`provenance-only`, `default`), or a JSON file with `name`, `minimum` (`P0` to
`P3`), `digests`, `world` and `effects`, the options of `experimental_verify`,
which adjust the default policy. Without `--policy` the default policy asks for
`P2` or above and the declared world within the granted capabilities;
`PRISM_MINIMUM_LEVEL` sets the minimum when the policy does not, and never
applies to a Rego policy, which states its own. A file is named in the verdict by
its path, unless JSON names itself. The format is in
[docs/proposals/285-policy-file.md](../../../docs/proposals/285-policy-file.md).

A Rego policy is in the package `prism.policy` and decides with `minimum` and `deny`:

```rego
package prism.policy

import rego.v1

minimum := "P0"

deny contains {"rule": "policy.house.pure", "message": "the world must be pure"} if {
	input.world.pure == false
}
```

A policy that denies is a verdict and exits 1, with the rule as the reason's
`check`; with `throw: true` it is `PolicyDeniedError`. A policy that does not parse
is `PolicyParseError` and one that cannot be evaluated is `PolicyEvaluationError`,
and both exit 2.

A CI job gates on the exit code and keeps the verdict when it fails:

```yaml
- name: Check the holo
  run: npx prism-code check dist/app.holo --policy prism-policy.json --json > verdict.json
- name: Keep the verdict
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: verdict
    path: verdict.json
```

Treat exit 2 as a failure: it means nothing was judged. Today every holo is
`P0`, because no build writes a provenance or proof statement into the holo
yet, so the default policy fails it; a holo that carries an attestation
section exits 2 until the format revision that admits it lands with #267's
wire model change. From `P2` up, the text form also prints what the check
trusts the signer for.

`prism-code check` with no holo is the 0.2.0 spelling of `build --check`. It
still runs, prints a deprecation warning, and is removed in 0.4.0.

## Develop with the studio (experimental, #288)

`prism-code dev` watches a project, rebuilds and re-checks on every save, and
serves a local studio at `http://localhost:4100`. The port is fixed: `--port`
moves it, and a port in use is an error.

```
npx prism-code dev
npx prism-code dev path/to/project --policy policy.json --no-open
npx prism-code dev --build "make holo" --holo out/app.holo
```

The Check tab shows the verdict `check` prints for the same holo, with its
level and every reason, and the time from the edit to the verdict. The page
also judges the bytes itself with `@prism-code/verify` and says whether the two
agree. The Replay tab says `unavailable` until `prism replay` ships.

A build that fails, or names no holo, leaves no current verdict: the last one
stays visible, labeled as describing source that has since changed. The page
loads nothing from outside the machine. The build is separate: without
`--build` or `[model].build` it runs `prism-code build --update`, which rewrites the model's pins in
`prismpm.lock` as you save, so commit the lock with your source. It needs Docker and
`prismpm.lock`. A build command from `prism.toml` runs with your permissions.

## Build one

`build`, `build --check`, `verify` and `conformance` run `prismpm` inside the
digest-pinned SDK image named by `prismpm.lock` in the current directory, with
the same `docker run` invocation the UOR template uses. Docker is required;
the image is Linux (amd64 and arm64). `build` and `verify` also mount the
Docker socket. `build --check` runs `prismpm check`: it validates the model
and writes nothing.

```
cd my-prism-project
npx prism-code build --check
npx prism-code build
```

Nothing in this package can produce a `.holo` without the image, and no
native `prismpm` binary ships in this release.

## Plugins (experimental, #293)

An executable named `prism-<name>` on the PATH runs as `prism-code <name>`,
with its arguments unchanged and its exit code returned, the way Docker runs
`docker-<name>`. The same binary will run as `prism <name>` once the CLI is
renamed. A built-in verb always wins over a plugin, and the first PATH
directory that has the plugin wins. On Windows the first `PATHEXT` extension
found wins (`.exe` before `.cmd` by default), names are case-insensitive, and
`.cmd` and `.bat` plugins get their arguments quoted for `cmd.exe`, so npm
shims work. `prism-code --help` lists plugins under their own heading.

A plugin answers one call with JSON on stdout, and is listed as invalid and
never run when it does not:

```
$ prism-doctor prism-cli-plugin-metadata
{"schemaVersion":"1","vendor":"UOR Foundation","version":"0.2.0","shortDescription":"...","errorHooks":["check","build"]}
```

`errorHooks` names the verbs whose failures the plugin wants to hear about,
as Docker's `error-hooks` do since Engine 29.3.0. When one of them exits
non-zero, prism-code runs `prism-<name> prism-cli-plugin-hooks` with
`{"schemaVersion":"1","command":"build","args":[...],"exitCode":69}` on stdin,
and prints the returned `{"messages":[...]}` (at most ten lines) to stderr
under "What's next:". A hook that fails, times out (5 s) or prints something
else says nothing. `PRISM_CODE_NO_HOOKS=1` turns hooks off.

The first-party plugin is `prism-doctor`, a second binary in this package:

```
npx prism-code doctor
```

It checks Node.js, Docker, `./prismpm.lock` and the optional sigstore
packages, and exits 1 when a check fails. Its error hook suggests it when
`check`, `build`, `verify`, `conformance` or `export-browser` exit 64 (no
lockfile) or 69 (no Docker).

## Provider services (experimental, #294)

A capability in `prism.toml` can name a provider: an executable that provisions
something the application needs and says how to reach it, after Docker Compose
provider services. Nothing runs unless the capability set allows the type, and
a returned variable is produced only when the set allows its name.

```toml
[capabilities]
allow-providers = ["kv"]
allow-variables = ["rates_url", "rates_store"]

[capabilities.rates]
provider = { type = "kv", options = { set = ["base=EUR"] } }
```

```
$ npx prism-code providers up
rates: created store rates
rates (kv): RATES_URL, RATES_STORE
$ npx prism-code providers up --json    # the same, with the values
$ npx prism-code providers down         # release it; kv deletes the store
```

```js
import { readManifest, resolveProviders, releaseProviders } from 'prism-code/node';

const project = await readManifest('.');
const { env, providers, withheld } = await resolveProviders(project);
// env.RATES_URL, env.RATES_STORE; withheld lists what the set does not allow, by name
```

`resolveProviders` sets the environment on no process. A host passes it on.
Today nothing inside a holo can read it: the guest world imports nothing, and
`prism-code run` does not read `prism.toml`.

Writing a provider takes one small protocol. Prism runs it in the project
directory, with the options as flags and the capability's name last:

```
prism-provider-<type> --project-name <application> up [--<option>=<value> ...] <name>
prism-provider-<type> --project-name <application> down [--<option>=<value> ...] <name>
```

It replies on stdout with one JSON object per line:

```
{"type":"info","message":"created store rates"}
{"type":"setenv","message":"URL=file:///home/ada/exchange/.prism/kv/exchange/rates.json"}
```

The types are `info`, `debug`, `error` and `setenv`. `setenv` `URL=...` from the
capability `rates` becomes `RATES_URL`. Exit 0 with no `error` message is
success, and anything else fails with a typed error: `CapabilityDeniedError`,
`ProviderNotFoundError`, `ProviderReplyError` or `ProviderFailedError`. No error
quotes a reply line, because a reply may hold a secret. The provider inherits
the caller's environment and runs as the user, outside the holo, so the capability
set bounds whether it runs, not what it does.

`prism-provider-kv` is the reference provider, a third binary in this package. It
keeps a store as one JSON file, `.prism/kv/<application>/<store>.json`, and takes
`store`, `dir` and repeated `set = ["key=value"]`. The protocol and its reasons
are in `docs/proposals/294-provider-services.md`.

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

## Push and pull (experimental, #292)

```
prism-code push app.holo ghcr.io/acme/app:1.0 --keyless
prism-code pull ghcr.io/acme/app:1.0 app.holo \
  --certificate-identity https://github.com/acme/app/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

`push` puts the holo in any OCI Distribution 1.1 registry as one layer of a deterministic manifest, so the
same file has one digest everywhere. Each line of its attestation section becomes a referrer with the same bytes,
in the layout cosign writes. A registry without the referrers API gets the spec's `sha256-<digest>` tag instead.
With `--key` or `--keyless`, `push` also signs a statement per predicate that names the manifest, which is what
`cosign verify-attestation` looks for; without a signer it warns. `oras discover` lists them all.

`pull` writes nothing until the holo has passed, in order: the manifest and layer digests, the archive's footer and
labels, the BLAKE3 annotations, the verdict of `check` under `--policy` (default P0, or `PRISM_MINIMUM_LEVEL`),
the subjects of every attestation, and, when you name a signer with the flags of `verify-attestation`, at least one
signature. Without a signer it says signatures were not checked. Exit codes: 0 done, 1 a digest or a check failed,
2 no answer from the registry, 3 signing failed, 64 usage.

| Reference | Means |
| --- | --- |
| `ghcr.io/acme/app:1.0` | A tag; `latest` when none is given. A registry is required: there is no default. |
| `ghcr.io/acme/app@sha256:<hex>` | The manifest digest. |
| `ghcr.io/acme/app@blake3:<hex>` | The archive fingerprint, pull only, through the `blake3-<hex>` tag `push` writes. The bytes are checked, so the tag proves nothing by itself. |
| `dir://./store:1.0`, `--store ./store app:1.0` | A local OCI image layout, for offline use. `oras --oci-layout` reads it. |

`pull ghcr.io/acme/app:1.0 dir://./store:1.0` keeps the holo and its referrers for offline use, and `push
dir://./store:1.0 registry.internal/app:1.0` publishes them again with the same digest.

Credentials come from Docker's config (`credHelpers`, `auths`, `credsStore`), and for `ghcr.io` from `GHCR_TOKEN` or
`GITHUB_TOKEN`. No flag takes a token. A loopback registry speaks HTTP; any other needs `--plain-http`.

```js
import { experimental_push, experimental_pull } from 'prism-code/node';

const pushed = await experimental_push(bytes, 'ghcr.io/acme/app:1.0', { key: privatePem });
pushed.digest;       // sha256:...
pushed.fingerprint;  // blake3:...
const { holo, verdict } = await experimental_pull('ghcr.io/acme/app:1.0', { key: publicPem, output: 'app.holo' });
```

Errors are typed: `RegistryAuthError`, `ReferrersUnsupportedError`, `DigestMismatchError`, `PullVerificationError`,
`ManifestNotFoundError`, `RegistryError`, `ReferenceInvalidError`. The design is
[docs/proposals/292-push-pull-oci.md](../../../docs/proposals/292-push-pull-oci.md).

## Export for the browser (experimental, #290)

```
prism-code export ghcr.io/acme/calculator@sha256:<digest> --out site
prism-code export ghcr.io/acme/calculator@sha256:<digest> --tar site.tar
```

`export` writes the six-file browser export of a release that `prismpm build`
or `prismpm pull` left verified in `.prism/oci`: `index.html`, `app.js`,
`app.css`, the wasm-bindgen glue `<stem>.js`, the adapter `<stem>_bg.wasm` and
`provenance.json`. `--tar` writes the same six files as one deterministic ustar
archive instead (name order, mode 0644, owner 0, mtime 0, no directory entry).
The holo's attestation bundles, when it carries any, go byte for byte to
`<name>.attestations.jsonl` beside the output, as buildx writes attestation
files beside its `local` and `tar` output. `--out` defaults to `export`; both
are new names in the project (`--project`, default the current directory), and
nothing that exists is replaced. `--json` prints the `prismpm/browser-export/1`
receipt `prismpm export-browser` prints.

The bytes come from the release, not from a `.holo` (a holo carries the core
guest, not the browser adapter) and not from a copied folder. Each file is read
from its stored release blob, checked against its layer digest and its build
manifest row (`manifest.json`), written, and read back. A file whose bytes
differ is an `ExportMismatchError` (`export_mismatch`, exit 2) with `check`
`export.manifest`, `export.layer`, `export.files` or `export.tree`, and the
export is removed. The shared Action's Pages closure check reads the release
and the exported directory with the same code. This checks integrity only; it
grants no publication or deployment authority.

```js
import { experimental_exportBrowser, experimental_checkExport } from 'prism-code/node';

const { receipt, path, attestations } = experimental_exportBrowser({ reference, out: 'site' });
experimental_checkExport({ releaseDigest: receipt.release_digest, path: 'site' }); // { files, tree_digest }
```

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
