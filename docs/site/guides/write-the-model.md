---
title: Write the model
description: Hand-written LexLean is not a way to build a Prism application.
available_in: "0.6"
---
Writing the model yourself is not a way to build a Prism application, and this page no longer describes one. Every application has one input, `prism/spec.json`; see [Write the spec](/docs/guides/write-from-examples). A model that is not what `prism/spec.json` renders to is refused at build, so a hand-written or hand-edited model cannot become an application.

Hand-written LexLean still has a place in this repository: its own templates, libraries and the LexLean projects the SDK verifies. Those are not applications built from a spec, and they are maintained here rather than authored through Prism.

## Next steps

- [Write the spec](/docs/guides/write-from-examples)
- [Verify and inspect](/docs/guides/verify-and-inspect)
