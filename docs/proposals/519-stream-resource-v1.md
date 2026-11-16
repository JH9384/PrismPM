# Persistent resource adapter v1: bounded implementation design

Status: independently reviewed design for the private first slice of #519.
This proposal does not change normative public profiles or qualify a compression
product. BinaryProgram /1 integration remains separate in #516.

## Authoritative source and export

Retain NativeLibrary /1 unchanged. A future explicit resource operation selects
one closed Foundation.Stream.V1.Model.ResourceAdapter sidecar in the SAME typed
snapshot as one NativeLibrary. Its closed monomorphic roots are configDecode,
init, step, errorEncode, dispositionEncode and summaryEncode; all must be declared
library exports. The disposition encoder is explicit because its bytes remain
source-owned policy rather than host publication evidence.
Nominal type identity, not structural resemblance or a user-provided Rust type
name, binds Config, State, Error, Summary, InputEvent and StepEvent. Init preserves
its modeled Result; step preserves its modeled failed constructor. Both keep
outer generated ComputeError distinct.
The ordinary library operation remains native only. The resource operation
requires its own source binding, exporter custody, two independent generations,
artifact replay and acceptance. Adding the sidecar never upgrades an existing
library acceptance receipt. Do not add model-document /8 solely for an unused
sidecar; register the future operation and closed sidecar contract before making
it public.

## First implementation slice

Implement the reusable HOST ownership boundary as a private, versioned browser
adapter module, with no public controller operation, new application profile or
claim that Core-Wasm /1 supports sessions. It accepts only a generated backend
with init(config Bytes), step(ownedResource, InputEvent) and release(ownedResource).
The generated backend owns actual typed Rust State (Option<State>) in ordinary
wasm-bindgen std allocation; only config/chunks, copied output and source-owned
encoded errors/summaries cross the boundary. The module never serializes State.
Source step returns a guest-internal Transition: needInput(State),
advanced(State), output(Bytes, State), complete(Summary), or
failed(Error, PublicationDisposition). Nonterminal transitions replace the owned
State; terminal transitions retain no State. The facade matches those exact
source constructors. With the actual borrowed generated calling convention,
Option::take moves the old State into a local guard, the facade borrows it for
step, stores any returned State, and drops the old local exactly once. It keeps
outer generated ComputeError separate. Only the state-free host tag and copied bytes
reach JavaScript. Source step has no additional inner Result in this profile.
The kernel is reusable infrastructure; source init/step owns application behavior
and final verification. Source event sequencing remains authoritative.

The first slice includes the ownership runtime, exact backend protocol, tests and
a real WebAssembly component probe using the pinned local toolchain. That probe
uses a concrete test-only facade over genuinely generated source functions; it
does not establish a production facade generator or acceptance of a new profile.
It does NOT introduce an unverified exporter operation to bypass existing proof
or custody controls. It leaves source root projection, production generation,
native adapter, import-free Core ABI, staged publication and real browser file/
worker/download acceptance as explicit follow-up gates on the same issue.

## Exact host boundary

The returned Session token is a newly allocated frozen object, registered in an
instance-private WeakMap. It is never a raw Wasm pointer or numeric table handle.
Another instance cannot accept it, even if both modules allocate identical raw
addresses. No identity counter exists and cannot wrap. Explicit release and
terminal events mark tokens stale; identity objects are never recycled. The
generated host wrapper is the declared cross-instance rejection boundary. Direct
calls to raw wasm-bindgen exports do not inherit that guarantee.

Each instance permits one in-flight Wasm call; recursive or concurrent calls are
refused without touching guest state. Async backend completion does not release
the busy guard. A caller can retry cancellation after a ConcurrentCall refusal;
the runtime never claims an in-flight operation was cancelled. Once an output
event returns, its copied bytes remain usable while a following cancel consumes
the session and yields no completion/publication permission. A cancel result may
not be output, needInput, advanced or complete: violation retires the instance.
Cancel must return the existing source failed(Error, PublicationDisposition)
variant. The host labels that reply cancelled and preserves its encoded source
error and disposition. This does not introduce a competing source cancelled
constructor. A generated ComputeError or trap while cancelling is still reported
as computation or fatal failure, never successful cancellation.

InputEvent is tick | chunk(Bytes) | endOfInput | cancel. Chunk/end require an
observed needInput; EOF is once only. Tick drives internal work after init and
after accepted input/output/advanced events. After EOF, needInput is a protocol
violation. Complete requires EOF; source final verification is an obligation of
the source step implementation, not inferred from the host phase alone.

StepEvent is needInput | advanced | output(Bytes) | complete(encoded Summary) |
failed(encoded Error, source PublicationDisposition). Actual State is private to
the backend object. ComputeError and adapter error remain distinct outcomes.
Init may return a modeled error or ComputeError without issuing a token.
Terminal complete, failed, cancellation and ComputeError consume and release the
backend resource. A terminal release failure retires the instance and reports
unknown resource outcome; it cannot be converted into source success.

The exact private backend tags are ready(resource object) from init;
needInput, advanced, output(bytes), complete(summary bytes), failed(error bytes,
disposition bytes), computeError(code) and resourceRefusal from the relevant
calls. resourceRefusal from init creates no resource; from step is terminal and
requires cleanup. ComputeError code is one of the actual seven pinned generated
variants, with no Debug-string parser. Backend release returns undefined after
dropping its wrapper; it is called once after every safe tagged terminal event.
The facade keeps an empty Option after consuming a terminal State, so freeing
the wasm-bindgen wrapper does not double-drop it. Unexpected thrown outcomes do
not call release. retire() must be a non-guest owner action (for example Worker
termination), never an attempted Wasm destructor after a trap.

## Buffers, bounds and fatal outcomes

All inbound and outbound byte arrays are copied at this boundary; responses do
not alias guest memory, caller input or prior output. No pointer/length is exposed
to the caller. Copy before guest execution permits a declared adapter resource
refusal without state transition; failure after execution is terminal with an
explicit cleanup result. Array type/length, active-session and configured
transport bounds are checked. Limits are caller-selected resource configuration,
not semantic compression caps. They do not establish physical heap bounds,
allocator recovery, decoder working space, wall time or bounded lifetime memory.
In particular, the pinned generated borrowed step may clone the complete State
when source returns it. Retaining typed State avoids serialization but does not
prove zero-copy execution or optimal step cost. Actual generated ownership,
copies and allocator behavior need independent performance qualification.

Explicit backend tagged failures are modeled error, generated ComputeError and
adapter resource refusal. A thrown Wasm trap, abort, unexpected exception or
malformed backend event yields fatal/unknown and poisons the entire instance.
The kernel issues no further guest calls, including destructors, after poisoning.
Known raw objects, the backend and an in-flight release candidate enter a strong
module-level quarantine. This prevents their references disappearing with the
runtime and scheduling wasm-bindgen's automatic guest-calling finalizers. A
test-only count observes quarantine entries without exposing raw resources.
The quarantine persists until the dedicated owner realm terminates. Failed
retirement intentionally retains memory and provides no lifetime heap bound.
Unreturned init temporaries, direct raw calls outside this boundary and actual
realm termination remain unknown; quarantine alone does not establish their
safety. The owner must terminate the whole dedicated Worker. Real Worker/GC
acceptance is required before this becomes a public resource profile.
Reclaiming the whole Wasm instance is required rather than asserting successful
per-session cleanup. Retirement is reported as requested or failed, never proven
physical reclamation from a callback returning.
Try/catch cannot recover every engine/process OOM. The kernel does not promise
it. Backend partial mutation on a thrown exception is never retried.

## Publication and separate Core ABI

An output event is provisional. Only source complete after EOF permits a
consumer to attempt publication. Source disposition is policy, not evidence of
filesystem/stdout/download effects. Publication staging and no-replace commit
belong to a separate consuming adapter; late write/flush/cleanup failures may be
Unknown and must never be rewritten as NotPublished. Native qualification must
exercise those real effects. The ownership kernel does not publish output.

Core-Wasm /1 remains fresh-instance Bytes -> Bytes with its existing allocator.
A persistent import-free profile requires a NEW ABI/world and explicit reclaimed
scratch/output buffers, bounds and allocator identity. #508's temporary allocator
reclamation alone does not provide caller-buffer release or typed resources.
Browser wasm-bindgen and native typed-state acceptance cannot qualify that ABI.

## Required counterexamples

Tests must cover all bytes, empty chunks, distinct sessions, stale/double-release,
cross-instance colliding raw resources, non-recycled token identity (including a
simulated wrapped backend index), concurrent/reentrant init/step/release,
cancellation during outstanding output and in-flight-call refusal, copied input/
output across guest mutation and memory growth, modeled versus computation
failure, oversized/malformed backend events, source completion before EOF,
duplicate EOF/input without demand, thrown allocation/trap versus explicit
resource refusal, release failure and instance-wide poisoning. Publication
failure tests remain in the consuming adapter, and must be listed as unrun until
it exists. Stub backends establish host ownership logic only; real generated
Wasm execution is separate component evidence, not installed SDK acceptance.

## Local first-slice evidence and remaining gates

The owning private Rust tests run the complete host counterexamples and the
real source/Lean/export/native-archive/wasm-bindgen web-loader probe. The latter
checks all 256 byte values, empty chunks, actual equal raw addresses in separate
instances, resident typed State, copied buffers across memory growth, terminal
cleanup, modeled errors, generated AddOverflow and an actual Wasm trap. Its
96-session allocation churn observes page reuse for that fixture only.

The module gate currently reports six inherited BinaryProgram integration
failures, also reproduced on the unchanged `5bb45991981bc9544d75019d941a2253b654e678`
base: missing Binary builder/verifier owner rows, contract-layer dependencies and
new cycle membership. This private component adds no further module violation;
the inherited failures must be resolved in #516 before combined acceptance.

Production source projection, generated native and Wasm facades with their own
custody and replay, a persistent import-free ABI, actual Worker/GC termination,
physical resource measurements, staging/publication failure tests, browser file/
worker/download flows, installed SDK acceptance and full V&V remain unqualified.
Neither this proposal nor the private component closes those broader #519 gates.
