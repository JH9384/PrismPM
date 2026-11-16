---
title: Write the spec
description: One JSON file, prism/spec.json, is the whole input of a Prism app.
available_in: "0.6"
---
Every Prism application is built from one JSON file, `prism/spec.json`, and no other way. You write or edit that file, through an agent or by hand; Prism turns it into LexLean, Lean proves every property it states, and the holo is built. The same JSON always gives the same LexLean and the same application, byte for byte.

You never write LexLean. A model that is not what `prism/spec.json` renders to is refused at build.

## The path

1. An agent drafts the spec from one sentence and passes it to `prism_spec`, or you edit `prism/spec.json` yourself. This is the only step that is not deterministic.
2. Prism reads it strictly: a member `prism/spec/1` does not define, a duplicate key, a number that is not a whole number within plus or minus 2^53, or text the model cannot carry is refused, naming its JSON path. Text is never altered.
3. Prism writes it back as canonical JSON ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)) and records its SHA-256 as the `specHash`.
4. Prism renders the LexLean model and its proofs from `prism/spec.json` alone.
5. Lean proves every property, in the SDK image on your machine.
6. The holo is built, and its acceptance vectors replay the spec's examples.

## What a spec says

- `fields`: what one request holds, in order. Each is a whole number with bounds, or a choice from a fixed list.
- `outcomes`: the answers it may give. `invalid` is reserved for a malformed request.
- `rules`: tried in order; the first that matches decides. `otherwise` answers when none match.
- `properties`: what must never or always happen. Each becomes a theorem Lean proves.
- `examples`: requests and their expected answers. Each becomes an acceptance vector.
- `purpose`, `means`, `meanings`, `why` and `limits`: prose for the person reviewing it. No proof rests on them.

## Changing an application

Edit `prism/spec.json`, or pass the changed spec to `prism_spec`. Prism reads the file on every call, so an edit you made yourself becomes the spec. Then prove and build again: a change to the JSON changes the model, and a change to the model changes the holo.

## Next steps

- [Use with agents](/docs/guides/agents)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Audit a holo](/docs/guides/audit)
