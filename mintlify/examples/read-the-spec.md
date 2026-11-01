---
title: Read the spec package
description: Read the format revision and other constants a tool needs from the spec package.
available_in: "0.5"
---

<Note>This page describes Prism 0.5, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>

A tool that reads holos should take its constants from the spec package rather than copy them. The output below was captured by running the code.

```js
import { FORMAT_REVISION, MAGIC, PHYSICAL_VERSION, SECTION_COUNT, SECTION_ORDER, PROOF_PREDICATE_TYPE } from '@prism-code/spec';

console.log(FORMAT_REVISION);
console.log(MAGIC, PHYSICAL_VERSION, SECTION_COUNT);
console.log(SECTION_ORDER.join(' '));
console.log(PROOF_PREDICATE_TYPE);
```

```text
2026-10-23
HOLO 4 8
15 8 14 14 16 16 16 16
https://uor.foundation/prism/proof/v1
```

## Next steps

- [Spec package](/api/spec-package)
- [Holo format](/reference/holo-format)
- [Attestations reference](/reference/attestations)
