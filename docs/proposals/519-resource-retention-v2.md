# Private resource retention component /2

This separate private slice preserves the existing `/1` component and every
public profile. It implements generic owner retention and source-authorized
release with a neutral source fixture. It is not a compression binding,
filesystem/spool service, persistent import-free Core ABI, native isolation
profile, browser provider or installed-SDK acceptance receipt.

## Source-owned descriptor and exact roles

The fixture-local `Foundation.Stream.V2.Model.ResourceAdapter` is a closed
descriptor with exactly these mandatory String fields: profile,
configDecodeRoot, eventDecodeRoot, initRoot, advanceRoot, requestReleaseRoot and
observationEncodeRoot. Its profile is `prismpm/private-resource-component/2`.
Each role names a definition in the same typed snapshot and is bound to actual
generated signatures and nominal constructors. No State encoder or decoder
role exists. The descriptor does not dynamically execute caller-selected roots
or constitute a public source projector/registered profile.

| Source role | Neutral source signature |
| --- | --- |
| configDecode | Bytes -> Config |
| eventDecode | Bytes -> Event |
| init | Config -> Transition |
| advance | State -> Event -> Transition |
| requestRelease | State -> Transition |
| observationEncode | Observation -> Bytes |

Transition has exactly owner: State and observation: Observation. Every modeled
outcome retains its actual successor owner, including complete, cancelled,
modeled failure, cleanup pending and unknown disposition. Invalid event bytes
decode into a source Event and yield a modeled observation; the facade never
invents an early failed terminal state. Config accepts arbitrary marker bytes.
The source owns receipt/ticket/achieved-storage state and all semantic decisions.
Observation is a record whose status field has the source Status type. Only
requestRelease can return status Status::ReleaseAuthorized, after the source gate
checks terminal phase, Pending::Idle, ticket zero, written equal to deleted, and
known disposition. Completion,
cancellation, a modeled failure, a zero-looking host ledger or a caller Boolean
does not authorize release.

The initial slice requires the **actual generated Rust** configDecode,
eventDecode, init and observationEncode signatures to be infallible. Tests must
assert those signatures. LexLean mathematical totality alone does not exclude
an outer generated ComputeError. A future fallible initializer or encoder needs
an explicit owner-retention path: an error after adopting a known successor may
not drop that successor or retain only its predecessor. This first slice does
not silently accept those fallible shapes. Advance and requestRelease may have
the real generated outer Result<Transition, ComputeError> convention.

## Private backend convention

The backend retains the actual generated State in a typed owner. No whole-state
snapshot crosses the host boundary. Its closed safe reply shapes are:

* init(configBytes): ready with resource and copied source observation bytes.
* advance(resource, eventBytes): retained with source observation bytes.
* requestRelease(resource): retained or releaseAuthorized, each with source
  observation bytes and the actual successor state still held in the resource.
* release(resource): wrapper destruction only after the current serialized
  requestRelease returned the source grant and its observation was delivered.

The host lifecycle operations are init, advance, requestRelease,
retryObservation, abandon and close. Only init/advance/requestRelease call their
corresponding source/backend operations; retryObservation delivers the exact
cached reply, abandon takes the fatal/unknown retirement path, and close refuses
live ownership instead of implicitly requesting source cleanup.

The facade derives releaseAuthorized mechanically from the actual source
Observation.status value Status::ReleaseAuthorized only while handling
requestRelease.
The host does not parse observation bytes to infer lifecycle or reconstruct
State. A source observation from init/advance is never a release permit. The
grant belongs to the current captured session under the exclusive instance gate;
it is not a cached public Boolean, a supplied JSON field or reusable token.

The native and Wasm conformance facades must adopt the actual successor before
projecting it. Generated borrowed calls may deeply clone fields; avoiding state
serialization does not establish zero-copy cost, unique arena behavior for an
unbound product or a physical memory bound. The neutral fixture's achieved
storage/ticket witness is finite test state, not a product-wide quota or actual
provider receipt.

## Retention, checked errors and delivery failure

Public host tokens remain instance-private opaque identities. Reentrant and
concurrent calls refuse. A retained semantic terminal owner can still receive
source-declared receipt/cleanup/reconciliation events; its prior complete/cancel/
failure observation does not cause host destruction. Source unknown disposition
retains custody and rejects ordinary work/blind replay until the exact source
reconciliation protocol permits progress. Generic opaque bytes do not authenticate
an I/O receipt: the neutral fixture simulates receipts only. An eventual product
facade must separate user intent from trusted resource/runtime callback lanes.

The module strongly retains each instance's backend, owners, in-flight candidate
and pending observation independently of the caller's API object. Dropping that
object cannot schedule wasm-bindgen guest destructors without source permission.
Only successful close after all source-authorized releases removes healthy
custody; fatal custody remains quarantined until actual realm termination.
An abandoned caller can therefore retain memory indefinitely. This explicit
lifetime rule does not establish bounded lifetime memory or garbage-collector
reclamation. The native conformance wrapper likewise must retain an ungranted
typed owner instead of implicitly dropping it.

An outer generated ComputeError from advance/requestRelease restores or keeps
the known pre-call typed owner, records the exact generated variant and sets a
whole-instance checkedFailureHeld barrier. No further guest call, requestRelease
or recovery root is allowed. Explicit fatal abandonment and actual owner-realm
retirement report unknown. This preserves known ownership without claiming the
intermediate prefix or peak is recovered. A source grant computed from old state
cannot erase that uncertainty. Init/codec/encoder checked failures are outside
this slice's admitted infallible signatures.

If copying an observation fails after dispatch, retain the exact returned reply
and resource and block other guest calls. retryObservation copies the original
reply; it never replays init/advance/requestRelease. For a cached release grant,
successful delivery is followed by release exactly once. Repeated copy refusal
retains the same pending record. Explicit fatal abandonment preserves unknown
instead of pretending the event did not execute. Pre-call copy/resource refusal
is separate and may leave the owner unchanged only when no guest dispatch began.

close refuses while any owner or pending delivery remains. It does not iterate
destructors to clear the instance. A throwing release or malformed backend reply
poisons the instance; retain known owners and in-flight candidates in quarantine
and issue no later guest call. Retirement is requested/failed until independently
observed. It is not proof of source cleanup, storage disposal or physical
reclamation. Native catch_unwind cannot undo destructors already run; the stronger
isolated-native target requires verified panic=abort child isolation and a
supervisor outside the failed process, which this neutral component does not
qualify.

The exclusive busy guard also applies to abandon: reentrant/concurrent abandon
returns ConcurrentCall and cannot interrupt an in-flight or hung guest call.
An external owner must terminate an unresponsive worker/process independently.
This component does not qualify that external termination, hang recovery or
physical cleanup, and a refused abandon is not a cancellation/retirement receipt.

## Acceptance scope and product boundary

The required neutral checks include pending-write completion after cancellation,
achieved partial deletion with retained remainder, modeled failure after a
retained prefix, source unknown refusing ordinary retry, explicit grant required
before any destructor, checked-error owner retention and instance barrier,
observation-copy retry without guest replay, stale/foreign opaque tokens,
reentrant/concurrent refusal, release failure quarantine and unchanged `/1`
behavior. Execute the genuine source through native and Wasm facades; stubs alone
do not establish generated-state ownership. State all actual signature, clone,
wrapper-count and memory observations at their finite fixture scope.

Production source projection, a general facade generator, actual resource
providers and surviving storage/publication ledgers, real worker termination,
physical bounds and installed-SDK/product release acceptance remain separately
required. No public capability or diagnostic is introduced by the fixture.
The [compression dependency register](519-compression-binding-dependencies.md)
lists its actual 22 declared roots and missing typed export/constructor/custody
evidence. Generic `/2` progress does not mark any product gate accepted.
