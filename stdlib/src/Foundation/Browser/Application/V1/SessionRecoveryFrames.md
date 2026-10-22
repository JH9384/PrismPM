# Separate-frame recovery (private)

Private DK-30 component. No authority, freshness, storage or deployment claim.

`sourceRecoveryFrameLayoutBytes` consumes one complete canonical Session success
frame, including the original 64-MiB boundary. It validates the full source state
and permits only Ready/Closed without pending work. Its result is
`[1,6,[prefix,limits,principal,scope,epoch,execution]]`. `prefix` selects the exact
unchanged input bytes through the durable application field, before authority.
The offset comes from the source-owned canonical size model, not a host parser.

`sourceRecoveryFrameTailBytes` consumes
`[1,[1,layout,authority,execution,selector,presentation]]`. It checks the layout,
same principal/scope, nondecreasing authority epoch, different execution,
configured limits and Ready presentation. It emits `[1,7,[prefix,tail]]`, where
`tail` canonically replaces authority, absent pending state and volatile state.
It refuses when the combined prefix and tail exceed 64 MiB.

After complete canonical parsing and EOF, the source retains cursor spans for
authority, execution, selector and presentation. The tail is those exact spans
plus six fixed bytes (pending marker, volatile array, counters and Ready phase).
The existing source-owned largest-piece assembler avoids repeatedly copying a
maximal field. No host-selected offsets or reserialized application state enter
the recipe.

The closed SDK composition must capture the original input and all replacements,
derive the actual layout from that captured input, and pass precisely that layout
to the second generated entry. It may copy only the source-selected prefix and
append only the generated tail. The assembled success frame must pass complete
generated validation; descriptors bind all inputs, outputs and artifacts before
authenticated journal admission. A caller-supplied layout is never trusted.

The schema alone is not acceptance. Required evidence includes native/no_std/Wasm
parity, equivalence to the original recovery entry wherever its combined request
fits, exact 64-MiB state recovery, final-size overflow, full malformed input and
mutation tests, actual browser composition and all authenticated journal gates.
