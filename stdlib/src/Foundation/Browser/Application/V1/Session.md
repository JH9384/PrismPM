# Private session kernel

DK-26 is a pure modeled transition/codec prerequisite. It does not authenticate
authority facts, persist contexts, execute effects, checkpoint history, accept
an application or open `PP2011`. Holo/1 and accepted component wires are unchanged.

Source application wrappers own authority admission and domain decisions. The
kernel binds their exact selected principal/scope/epoch, command, complete prior
state, continuation and requested effect; no host-selected authorization flag
exists. Private codec observations are not a public dispatch API.

Durable state contains the instance, next durable command, application bytes,
admitted authority and pending command. Volatile state contains the current
execution, next effect operation, view revision, selector, presentation and phase. ReadOnly changes
only volatile state, after actual DK23 Intent admission. Source selectors must
be reconstructed/validated against durable state by the application wrapper;
they cannot carry independent permission state. Ordinary secret actions reject.

Begin consumes a durable command number once and records its exact request and
continuation. It reserves the declared maximumSteps in the transient effect
counter and maximumSteps + 2 view revisions for progress, Unknown and Close.
Every subsequent step binds the same command and the actual completed prior
request/result; step and all counters cannot wrap. DK18 owns
effect/request/result constraints. Unknown retains the pending record and
blocks new admission; Close retains it and cannot be undone by a late result.
Rebind changes only quiescent execution/view state, resets the transient effect
counter with a different execution identifier and never retries an unresolved effect.
Inequality does not prove identifier freshness. Completions additionally bind
the immutable application/policy closure, instance, exact command, step and
continuation, so an A–B–A execution cycle cannot consume an earlier command's
envelope. Equality alone does not authenticate a completion or protect against
forged labels; the future journal must bind these fields to its actual receipt.
Begin and Continue require and increment the exact transient operation counter;
it is separate from the durable command sequence and cannot wrap.

SourceSessionLimits declare application, selector, continuation, evidence,
Intent and presentation byte budgets (each 1–64 MiB), plus 1–512 effects per command. The complete
encoded frame including every wrapper is at most 64 MiB. Fixed field-scoped
references share only the exact typed predecessor named by the grammar. Equal
explicit values are noncanonical; differing explicit values still undergo full
kernel comparison. There is no global dictionary or arbitrary index. Full
typed context is reconstructed in LexLean, never by an authoritative host.
Actual execution
must fit the fixed finite 1 GiB Wasm ceiling; valid aggregate maxima are executed,
not inferred from scalar limits. Independently legal fields may exceed a frame.
Before every effect, source arithmetic reserves every terminal/refusal/Unknown
result family, replacement application/selector/presentation and subsequent
Close, including canonical byte-string headers and all fixed context metadata.
Remaining steps additionally reserve distinct next request/continuation and
the largest admitted grant domains; repeated predecessor values are references,
not repeated payloads. Future metadata reserves full uint32 widths. No maximum
payload buffers are allocated. A globally overlarge budget produces typed
FrameExhausted before effect admission; no field is clamped. This global policy
can refuse a narrower source path which would fit. Per-command source budgets
or streaming would require a separate reviewed contract, never a host hint.
The future public wrapper must bind presentationMaximum to DK21 View.maximum.

Source size folds match actual View/Effects writer lengths and typed errors,
including codec-valid but semantically invalid values. The owning oracle runs
both real writers and the folds through generated native and Wasm execution.
Commit serialization uses accepted scalar/item encoders with bounded balanced
assembly of at most 16 objects; bytes, error order and wire limits are unchanged.
Completion comparison uses DK18 structural request equality only within both
requests' exact writer domains, compares actual result encodings and checks
both complete encoded lengths. Identical malformed values are not equal for
this purpose. The oracle includes typed writer failures and full-size Commit
completion comparisons, not only values admitted by the wire decoder.

Required owning corpus: initialization and malformed bindings; readonly durable
invariance; generated visible/disabled/stale/misbound/secret Intent; exact
principal/scope/epoch/command/plan matching; all effect families and typed
results; continuation and exact step maxima; counter overflows; unknown/close
retention; changed execution, ABA and unresolved-replay refusal; complete contextual
binding; canonical CBOR/trailing/UTF-8 errors; exact aggregate maxima/one-over.
Actual source guard mutants must fail native and Wasm behavioral assertions.

SessionJournal remains required: atomic durable genesis, signed command/context,
Prepared-before-execution, authentic terminal/full-history replay, progress
correlation, checkpoints/segment retirement, rollback witnesses and real host
faults. Kernel state named Ready does not prove a durability acknowledgment.
