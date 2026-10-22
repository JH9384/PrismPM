# Private session observations

Input is the unchanged canonical Session success frame `[1,0,state]`, at most
64 MiB. The generated reader consumes every field and EOF; the complete typed
session predicate runs before any observation is emitted.

Output is `[1,5,[binding,instance,principal,scope,authority-epoch,phase,
next-command,execution,next-effect,maximum-steps,pending]]`, where pending is
`[0]` or `[1,[command-sequence,step,maximum-steps,exact-effect-request-bytes]]`.
Session and CBOR errors retain the existing `[1,1,error]` / `[1,2,error]` frames.

These are observations of captured generated state, not authentication,
permissions, freshness or proof of an effect. The journal binds the original
complete state bytes by hash and uses the exact source-owned predecessor and
transition. It must not reconstruct or authorize domain state in JavaScript.
The existing Session ABI, 64-MiB bound and 1-GiB Wasm ceiling are unchanged.
