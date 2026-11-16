# Compression binding dependencies for the private resource component

This is a bounded dependency register, not a product facade or acceptance claim.
The independent generic private resource `/2` work does not require compression
primitives, a guessed product ABI, or changes to the existing `/1` component.

The primary source is compression
[`validation/product/host-contract.json` at 475bed5f](https://github.com/UOR-Foundation/compression/blob/475bed5f584efb2d4c64fd2c505d81c78f1b6735/validation/product/host-contract.json):
12,631 bytes, SHA-256
`f3d0e42d61b3f1cbcefcd160110b1b40475fc485adc371555df7f2600abba876`.
It declares `uorc/product-host/1` and explicitly sets nativeQualified,
browserQualified and pinnedSdkAccepted to false. The actual Api.sameResource
extraction probe establishes its doubled `Uorc.Uorc` qualification only for that
root. None of the remaining endpoint closure is inferred from that probe.

## Exact declared endpoint register

These are source declarations requiring actual complete typed export, IR,
coverage and generated-signature evidence before product glue is emitted.

| Endpoint | Declared root | Declared signature |
| --- | --- | --- |
| create | Uorc.Uorc.Product.Workspace.initial | Nat -> Workspace.State |
| invoke | Uorc.Uorc.Product.Workspace.invokeUser | Workspace.State -> Workspace.BoundUserIntent -> Workspace.Invocation |
| resourceReply | Uorc.Uorc.Product.Workspace.dispatch | Workspace.State -> Workspace.Intent -> Workspace.Update |
| runtimeReply | Uorc.Uorc.Product.Workspace.receiveRuntime | Workspace.State -> Workspace.RuntimeNotice -> Workspace.Update |
| present | Uorc.Uorc.Product.Presentation.present | Workspace.State -> Presentation.View |
| focusId | Uorc.Uorc.Product.Presentation.focusId | Workspace.FocusTarget -> String |
| permit | Uorc.Uorc.Product.Control.authorizePublication | Control.State -> Api.Run -> Api.ResourceRef -> Bool |
| read | Uorc.Uorc.Product.ResourceIO.requestRead | ResourceIO.Reader -> ResourceIO.ReadStep |
| readReply | Uorc.Uorc.Product.ResourceIO.readReply | ResourceIO.Reader -> ResourceIO.ReadReply -> ResourceIO.ReadStep |
| write | Uorc.Uorc.Product.ResourceIO.requestWrite | ResourceIO.Writer -> Api.Span -> ResourceIO.WriteStep |
| writeReply | Uorc.Uorc.Product.ResourceIO.writeReply | ResourceIO.Writer -> ResourceIO.WriteReply -> ResourceIO.WriteStep |
| storage | Uorc.Uorc.Product.Storage.reserve | Storage.Limits -> Storage.Usage -> Storage.Category -> Nat -> Result Storage.Usage Storage.Error |
| editLimit | Uorc.Uorc.Product.Workspace.editLimitText | Workspace.State -> Workspace.BoundLimit -> String -> Workspace.NumberEdit |
| prepare | Uorc.Uorc.Product.ResourceIO.startPreparation | Api.Run -> ResourceIO.Source -> Nat -> Storage.Limits -> Storage.State -> ResourceIO.PreparationStep |
| spoolReply | Uorc.Uorc.Product.ResourceIO.spoolReady | ResourceIO.Preparation -> Api.ResourceRef -> ResourceIO.PreparationStep |
| spoolRead | Uorc.Uorc.Product.ResourceIO.preparationRead | ResourceIO.Preparation -> ResourceIO.ReadReply -> ResourceIO.PreparationStep |
| spoolWrite | Uorc.Uorc.Product.ResourceIO.preparationWritten | ResourceIO.Preparation -> ResourceIO.WriteReply -> ResourceIO.PreparationStep |
| spoolSeal | Uorc.Uorc.Product.ResourceIO.spoolSealed | ResourceIO.Preparation -> Api.ResourceRef -> ResourceIO.Source -> ResourceIO.PreparationStep |
| spoolCancel | Uorc.Uorc.Product.ResourceIO.cancelPreparation | ResourceIO.Preparation -> ResourceIO.PreparationStep |
| spoolCancelledWrite | Uorc.Uorc.Product.ResourceIO.cancelledWriteAcknowledged | ResourceIO.Preparation -> ResourceIO.WriteReply -> ResourceIO.PreparationStep |
| spoolCleanup | Uorc.Uorc.Product.ResourceIO.cleanupPreparation | ResourceIO.Preparation -> ResourceIO.PreparationStep |
| spoolDeleted | Uorc.Uorc.Product.ResourceIO.spoolDeleted | ResourceIO.Preparation -> Api.Run -> Api.ResourceRef -> Nat -> ResourceIO.PreparationStep |

## Required binding evidence and semantics

1. **Complete typed closure.** Obtain actual roots/coverage/typed IR and nominal
   declarations for all selected endpoints and dependencies, generated Rust
   signatures, whole-closure checked fallibility, and reproducible/custodied
   export evidence. Existing library validation must reject unsupported types,
   unresolved calls and symbol collisions. A list of source strings is not this
   evidence; do not shorten or repair nominal names by guesswork.

   For the existing NativeLibrary route, provide the original same-build
   `model.prism.json`, `lexlean/snapshot.json`, `library/model-binding.json`,
   `library/roots.json`, `library/coverage.json`, `library/kernel.ir`,
   `library/package/generation-manifest.json`, `library/package/src/lib.rs`,
   package manifest/lock and original `.crate`, plus its genuine verification
   receipt and artifact hashes. These are the actual output paths of the reused
   library facility. The model binding supplies export/acceptance roots; roots
   and coverage identify requested/included definitions and erased proof
   dependencies, with external calls, opaque nodes and unsupported types
   explicitly accounted for. The generated manifest binds the IR digest and
   output files. Supply the complete artifact set for all selected roots,
   together with exact product source, compiler revision and language lock.
   A diagnostic compiler route may supply its corresponding original artifact
   set with equivalent explicit bindings; its compiler identity and unqualified
   SDK status must remain visible. No compiler or product lock is changed by
   this dependency request.

2. **Distinct control outcomes and authority.** Bind the exact Workspace.State,
   BoundUserIntent, Intent, RuntimeNotice, Invocation, Update and NumberEdit
   constructors. Preserve Invocation's modeled applied/stale disposition and
   message; do not flatten Invocation and Update into a new product transition.
   User actions enter invokeUser. Only captured trusted picker/collection replies
   enter dispatch, and only actual generated executor notices enter
   receiveRuntime. Retain revision/pickerSerial/slot/order and release stale newly
   returned leases. Resource/runtime replies are not browser JSON user endpoints.

3. **ResourceIO constructors and receipts.** Obtain exact Command, Reader,
   Writer, Source, ReadStep, WriteStep, Preparation, PreparationStep, ReadReply
   and WriteReply constructors and owner initialization paths. Capture actual
   run/lease/ticket/offset/extent. Keep one owned image ticket for every nonempty
   read/result span until full consumer acknowledgment, independently of original
   sequence ownership. Empty spans have no ticket; an empty cursor does not erase
   an outstanding result ticket. Distinct tickets need distinct lease identities
   even for equal Heap handles. Obtain the exact acknowledgment/release roots
   and signatures; the JSON does not declare their complete nominal export set.

4. **Storage and achieved cleanup.** Bind one serialized Storage.State through
   job/storage operations. Storage.reserve returns Usage; it is not permission
   to fork quota snapshots. Admit actual host capacity separately, report achieved
   partial writes/deletions, release only unused reservations, and retain pending
   writes through cancellation until their targeted achieved acknowledgment.
   Obtain exact Storage transfer/receipt and retired-cleanup definitions: the
   rule names Storage.transfer and retiredCleanupComplete do not supply fully
   qualified endpoint signatures. No nonzero retained/reserved storage may be
   forgotten. A publication copy needs separately admitted storage. Actual host
   custody/uncertainty survives guest retirement in a supervisor-owned ledger.

5. **One-Arena executor and failed prefix.** Obtain the actual aggregate owning
   Arena, CallerRoots and RuntimeResources.Usage; boundary AwaitingState has no
   Arena. Bind genuine detach/reattach only after full acknowledgment with no
   pending mutation/release/credit. Inspect generated borrow/clone behavior against
   that unique ownership protocol. Require exact failure envelopes preserving
   achieved arena, resource Delta and temporary-root tickets until source-directed
   cleanup. Restoring an old owner after outer ComputeError is not recovery of
   inaccessible intermediate ownership or logical peak. The conservative generic
   `/2` barrier blocks guest calls and release after that checked error; product
   recovery cannot be inferred from a source grant calculated on old state.

6. **Actual View and publication.** Bind Presentation.View, commands,
   FocusTarget/focusId and BoundLimit/NumberEdit exactly. Render every untrusted
   string literally regardless of safeText, use native accessible controls and
   source-bound ordered collection actions, and change focus only on a changed
   focus serial. Submit numeric fields as raw text to editLimitText; do not clamp
   or parse with host Number. Arbitrary-length String input does not establish
   arbitrary-precision generated Nat results: inspect actual parsing/fallibility.
   Empty optional quotas impose no additional product ceiling. Serialize the
   actual authorizePublication check with destination commit; record truthful
   published/notPublished/unknown while retaining achieved storage. Unknown blocks
   blind retry. Download initiation is not durable destination ownership.

7. **Target evidence.** Real native/worker-Wasm/browser providers must exercise
   bounded rereads, addressability refusal without truncation, partial I/O,
   cancellation, seal/deletion faults, cleanup uncertainty and publication
   reconciliation. Keep logical peakOwnedBytes, Storage.Usage and optional scoped
   PhysicalObservation separate; absence is unobserved. Component RuntimeMachine
   progress does not qualify the integrated product. Installed pinned-SDK and
   release acceptance remain separate from generic fixture evidence.

The next product step is complete typed extraction against this register, then
mechanical facade/dispatcher generation over those exact constructors. Generic
retained-owner `/2` implementation and its neutral native/Wasm fixture can
proceed independently. They do not claim any of these product gates passed.

## Proposed ownership boundary for coordination

Retirement needs a source-owned decision over the complete retained aggregate.
The declared publication permit governs the destination commit. Supply the exact
existing retirement/cleanup roots and their complete types if they already
provide the following contract; otherwise this is the proposed shape to review
with the product owner before any product source change:

```text
OwnedObservation<Owner, Observation> = { owner: Owner, observation: Observation }
ReleaseObservation<Owner, Observation> =
    retained(OwnedObservation<Owner, Observation>)
  | authorized(OwnedObservation<Owner, Observation>)

advance: Owner -> TrustedEvent -> OwnedObservation<Owner, Observation>
requestRelease: Owner -> ReleaseObservation<Owner, Observation>
```

These are role shapes, not proposed product nominal names. Existing Invocation,
Update and NumberEdit keep their distinct constructors. Their generated binding
must identify the actual successor owner and observations mechanically; an
existing result can satisfy a role without introducing another product wrapper.
Owner must include or uniquely retain the Workspace/executor aggregate,
ResourceIO owners, Storage.State and outstanding arena/span tickets. Every
modeled completion, cancellation, failure and cleanup step returns that achieved
owner. An authorized release requires all pending acknowledgments settled, all
retained/reserved storage and tickets discharged or receipt-backed transferred,
and every uncertain publication/cleanup disposition explicitly reconciled under
source rules. No host ledger comparison or completed-operation flag fills this
role. A failed step must preserve achieved arena, Delta and temporary roots in
the actual returned owner; an inaccessible prefix cannot be reconstructed from
the pre-call state.

The final binding also needs the exact source event/receipt constructors and
authority lanes. A user must not supply TrustedEvent callbacks through the user
intent channel. Generic `/2` implements the lifetime mechanism against a neutral
fixture while this actual product boundary is coordinated.
