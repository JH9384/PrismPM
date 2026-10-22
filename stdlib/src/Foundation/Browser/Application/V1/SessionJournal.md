# Private session-journal metadata

DK-30 integration prerequisite; not authentication, storage acknowledgement,
recovery proof, an accepted SDK or public application admission. `PP2011` stays
closed until the complete journal/runtime owners pass.

`SessionJournal` owns immutable binding, ordered metadata admission, pending
anchors and checkpoint segment accounting. `SessionJournalWire` owns canonical
CBOR to EOF. DK-24 payload descriptors retain their exact 64-MiB/64-chunk domain;
separate operation and successor frames are never nested inside one larger frame.
The metadata codec has the unchanged 64-MiB input and 1-GiB Wasm limits.
Entry parsing and replay use ordered binary subdivision, preserving complete
canonical parsing before transitions. The 1024-record wire bound is unchanged;
linear recursion across whole records must not consume the 64-KiB Wasm stack.

## Binding and transitions

Genesis binds source closure, instance, storage-origin digest, actual signing
key/context, namespace, distinct journal/staging heads, retained-record maximum
and witness policy. Its operation is the exact canonical Initialize frame.
The actual signed envelope digest becomes the genesis/head identity. Names and
digests do not prove permission. Policy/key changes require an independently
authenticated successor-journal handoff, never an in-place binding edit.

Each record binds genesis, contiguous uint32 sequence, exact predecessor head,
complete before/after positions and separate canonical operation descriptor.
Generated source projections determine positions; the host cannot invent phase,
command, epoch or successor facts. Actual source/recovery execution recomputes
the transition before metadata admission. Ordinary transitions preserve epoch;
RecoveryReady/RecoveryTerminal permit only nondecreasing source-admitted epochs.

Begin and Continue derive the pending anchor from the actual signed envelope
after signing; the envelope never contains its own digest. Continue consumes an
actual completion, increments the same command's step and installs its new
anchor atomically. Unknown retains the original anchor and observed receipt.
Close and Checkpoint preserve both. Only Settle or authenticated RecoveryTerminal
clears pending. RecoveryReady reopens quiescent Closed state; neither recovery
operation authorizes an effect retry or bypasses DK-26 late-result refusal.
Only RecoveryTerminal carries a recovery plan. Its Prepared envelope/position
match the retained anchor; separate settle and rebind descriptors link through
the exact quiescent intermediate position and actual terminal receipt. Generated
context projections of current/Prepared frames must match the bound context
digest. Recomputing both source transitions is mandatory, not a host assertion
that two descriptors are related.

## Required composition boundary

- Authenticate every signed envelope and independently admitted current
  authority/freshness witness. A typed position, signature or local counter is
  not a freshness witness. Missing evidence cannot authorize private reads,
  effects, recovery, checkpoint installation or retirement.
- Preserve DK-24 application/journal namespace and signing-context disjointness
  and DK-25 custody inventory; application effects cannot access journal keys.
- Recompute actual operation, predecessor, successor and receipt descriptors
  from source-owned canonical bytes. Verify complete payload lengths, ordered
  chunks and hashes; a shape-valid descriptor is not a verified payload.
- Publish Prepared only through acknowledged atomic head CAS that checks its
  complete chunk closure still exists. Readback before a separate CAS races GC.
- Capture and source-validate every active head and staging closure. Checkpoint
  installation and retirement atomically compare the exact protected frontier;
  retain original genesis, current state, prefix commitment and the complete
  original current-step Prepared envelope/snapshot/payload/receipt closure.
  A frontier descriptor alone does not establish retention safety.
- A modeled transactional retirement primitive is required: existing store CAS
  provides no garbage collector. Interruption leaves old complete history or
  the new complete checkpoint recoverable, including competing tabs/heads.
- Reserve the next full-size operation, successor, actual receipt, Unknown,
  Close and checkpoint closures before execution. Metadata reserves the next
  terminal record and four ordinals for Begin/Continue; these scalar checks do
  not establish object-store capacity or the full command reservation. Storage
  accounting must preserve all 512 steps through safe checkpoints, not retain
  512 worst-case payloads inside the existing 4096-object store.

Checkpoint preserves the exact current position/anchor, resets only retained
segment count, and consumes a global ordinal. It may preserve unresolved work
but cannot resolve it. Counters never wrap. Replay authenticates and applies the
complete prefix before checkpoint acceptance; reopen authenticates current
checkpoint trust and freshness rather than trusting a locally signed snapshot.

The entire storage origin is the custody boundary; URL paths, database names
and non-extractable keys do not isolate same-origin applications.
