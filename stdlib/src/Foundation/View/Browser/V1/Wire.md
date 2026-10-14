# Browser presentation prerequisite

DK-23 defines `prismpm/browser-presentation/1` for a private closed DOM adapter.
It does not accept a public application, effective grants, recovery, a product
release, deployment, accessibility certification or Foundation policy.
`PP2011` remains mandatory. `Wire.cddl` defines the exact wire shape.

`Presentation` contains revision, lifecycle, status label, live mode, focus and
ordered `Node` records. `Content` is a closed tagged union. `Intent` contains
revision, action identifier and ordered `FieldValue` records. All counters and
identifiers are uint32. Phase is Ready/Pending/ReplayRequired/Closed (0–3); live
mode is Off/Polite/Assertive (0–2). Zero status means absent; otherwise it is a
one-based reference into the independently source-bound label catalogue.
Content labels are zero-based catalogue references. The catalogue is the DK-21
strictly ordered unique source label list (at most 256 labels, 4096 UTF-8 bytes
per text). A frame never supplies or approves its own catalogue.

Nodes have implicit identifiers 1 through length. Parent zero denotes the
private adapter root; every other parent is an earlier section, navigation or
form. Parent depth is at most 16. Forms cannot have a form ancestor. Fields and
actions must be direct form children. No node has an externally supplied DOM
identifier, tag, role, attribute, class, style, URL, HTML or script. Dynamic
strings are strict UTF-8 text, preserving BOM and Unicode without normalization.

There are at most 256 nodes, 64 actions, 16 field bindings per action, 256 choice
options across the frame, 4096 body table cells across the frame and 16 columns
per table. Each table row exactly matches its columns. Catalogue-choice (tag 7)
identifiers are strictly increasing and nonzero; selection is zero (none) or an existing option.
Action identifiers are unique and nonzero; bindings are strictly increasing
field node identifiers in the same form. At most one action per form is marked
default. An enabled action binds only enabled fields. Only Ready permits enabled
fields/actions. Required empty values are rejected at dispatch, not display.
Text field defaults fit their declared UTF-8 byte maximum. Focus zero retains
focus; nonzero names an existing node. Closed requires focus zero.

The generated codec stores flat table rows privately as at most 256
`TableChunk` records of at most 16 rows; all non-final chunks contain 16 rows.
Chunking adds no wire arrays or values and changes no row/cell limit. It bounds
generated call-stack depth under the pinned compiler's existing stack policy;
writers flatten the chunks back into the identical canonical row array.

The whole frame is limited to 64 MiB (67108864 bytes), including framing. It
must also fit the source-declared View maximum. Dynamic text may occupy the
remaining frame budget. These are operational View budgets, not Organization,
Workspace or other application data limits. An intent must additionally fit
the primary's source-declared request maximum. No accepted frame is normalized:
decode/re-encode must preserve every byte.

Acceptance combines the exact 64 MiB frame with maximum node/row/cell and
combined structural shapes, placing the large payload at both ends. Separate
small structural and single-text maximum tests do not replace these cases.

Before constructing each primitive/array, both decoders consume from a shared
20000-value budget, propagated across sibling collections. Exhaustion is a
limit failure, not a memory trap. A conservative bound for every valid combined
shape is 17160 values: 8 frame values, 12 per node, 64×16 action bindings,
256×3 choice values, 4096 cells, at most 4096 nonempty rows and 256×16 column
labels. Genuine combined-maximum fixtures execute alongside an aggregate bomb
whose individual list bounds are legal. Payload byte limits remain unchanged.

The private renderer validates the complete frame and referenced catalogue
before any DOM mutation. A revision may advance, or repeat with identical bytes;
a changed equal/lower revision rejects. Keyed controls retain edits
only while node kind, generated default/selection and source-owned draft epoch
remain equal. The model advances the epoch to reset a submitted draft or change
editing context, including when the new default is identical. Epoch is not
principal or organization authority. Focus retention applies only to a surviving
same-kind control. A draft reset may retain focus, but not the old selection;
explicit nonzero focus selects the generated target. Before an actual edit, submitted text is
the exact generated default even where native controls display normalized line
endings; after an edit it is the actual native control value. Native controls and form
submission supply keyboard behavior. Status has the generated live mode and
the root is busy in Pending. Close removes listeners and late dispatch results
cannot reopen a closed view. Intent fields are captured in the exact modeled
order; revision is a stale-event guard, not principal/session authority. The
private dispatcher must independently authenticate and authorize commands.
The existence or enabled state of a control grants no effect or role.

The adapter connects an empty `role=status`, `aria-atomic=true` region before
inserting a message and retains that same connected element across revisions.
Only changed text is written; identical-frame replay is silent. Modeled live
mode still applies, and a status update does not itself request focus. These
DOM obligations follow [W3C ARIA22](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22).
DOM observation does not prove screen-reader speech, announcement timing or
complete WCAG conformance; assistive-technology assessment remains required.

Each private dispatch callback receives `(intentBytes, token)` and returns one
final frame or Promise. `progressPresentation(view, token, bytes)` admits
intermediate frames only for that adapter's live opaque token. Both objects
are branded before bytes are read. Source `progressFits` requires valid frames,
current Ready/Pending, next Pending and a strictly greater uint32 revision.
The final result correlates to the last accepted progress frame, not the initial
frame. Tokens carry no permission, effect outcome, account or session authority.

Invalid live progress revokes only its invocation; forged, foreign and previous
tokens cannot revoke another invocation. Successful external render, including
an identical refresh, invalidates old progress and its final result. Rejected
external preflight preserves it. Pending single-flight ends only when the
original callback settles or the adapter closes. Settlement, failure and close
delete the token binding before further callbacks/focus reactions. ReplayRequired
and Closed cannot be reset by progress or a late final result. Complete byte,
model and catalogue preflight precedes mutation; an internal DOM failure clears
and closes the adapter, rather than promising rollback of reused controls.
Retained progress/Promise handlers contain no captured intent or secret value.
Diagnostics bind an opaque accepted render context: a revoked old result,
rejection or reentrant throw cannot write an alert into its replacement context.
Owning maxima include two full 64 MiB presentations in the compiled progress
predicate and browser transition, with unchanged 1 GiB guest memory and
one-over/revocation checks; this is not a whole-browser heap or availability SLA.

Secret-input tag 10 is exactly `[10,label,enabled,required,maximum,draftEpoch]`.
It has no value/default field. Its strict UTF-8 bound shares the existing
1–67108864-byte domain; whole-intent framing and the primary request maximum
also apply. Required/enabled, form bindings and source-owned draft epochs obey
the ordinary field rules. It renders only a labeled native password input,
without a value attribute, spellchecking or a generated default.

`presentationRequiresSecret` and `intentRequiresSecret` classify actual modeled
action/field bindings, not caller flags. An action binding any secret field
requires the private `secretDispatch` option at frame admission, including
disabled actions; absent sinks reject rather than hiding/disabling controls.
Only that transient sink receives the captured intent, including its bound
ordinary fields. The ordinary `dispatch` never receives a secret-route intent.
The adapter retains no submission log or secret default. It clears live secret
controls before invoking the sink, also on changed field context/draft epoch,
non-Ready lifecycle, replacement/removal and close. Equal Ready context may
retain an unsubmitted live draft. Session changes must advance the modeled
draft epoch or close/replace the adapter; revisions alone are not sessions.

The sink must be source-bound ephemeral authentication logic returning only
nonsecret presentation/evidence before durable admission. The ordinary durable
session must reject raw secret-route commands/context. This component does not
authenticate that sink or establish enrollment, recovery or secret custody;
it cannot prevent a trusted callback from persisting/echoing its input. It makes
no JavaScript-memory-erasure, password-manager, malicious same-origin-code or
device-compromise guarantee. Oracle transcripts use synthetic test secrets,
never a production submission recorder. `PP2011` remains unchanged.

DK-31 adds text-choice tag 11:
`[11,label,enabled,required,selected,[[id,text],...],draftEpoch]`.
Each option has a unique nonzero uint32 identifier and 1–4096 strict UTF-8 bytes
of plain text. Source order is display order; duplicate names are permitted.
Tag 7 bytes, sorted identifiers and catalogue references remain unchanged.
Both kinds share the existing aggregate 256-option limit and 64 MiB frame cap.
The field label and DK-29 helper/error references still use the source catalogue;
option names neither extend nor mutate it. The renderer uses native options and
`textContent`, never markup, names as identities, positions or URL attributes.

Selection intents contain stable identifiers only. Surviving edited selections
retain those identifiers across reorder; a filtered-out selection falls back to
the source default. Changed kind, default or draft epoch resets the draft.
Source session sizing includes exact dynamic UTF-8 bytes and canonical framing.
Applications independently authorize the selected object and provide meaningful
names/disambiguation. Nonempty names and automated accessibility checks cannot
establish usability or complete accessibility conformance.
