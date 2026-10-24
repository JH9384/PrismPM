---
title: Check a holo
description: Check digest, provenance, proof and world against a policy and get a verdict.
---

Source: `@prism-code/spec` 2026-10-23, `types/holo.d.ts`.

## Example

Status: `verify()` is not in prism-code 0.2.0, which checks the digest footer and every section label on load. This page gains an executed example when the runtime ships the verdict.

## What a reader declares

```ts
export type FormatRevision = '2026-10-23';

export interface RevisionSupport {
  accepts: readonly FormatRevision[];
}

export interface FormatRevisionIdentifiers {
  physicalVersion: number;
  flags: number;
  sectionOrder: readonly SectionKindCode[];
  appManifestUri: string;
  extensions: readonly ExtensionName[];
  coreWasmContract: CoreWasmContract;
  holoviewVersion: number;
  sourceManifestVersion: number;
  provenanceSchema: string;
  modelDocumentSchemas: readonly string[];
}
```

## Next steps

- [Instantiate a holo](/docs/api/instantiate)
- [Attestations reference](/docs/reference/attestations)
- [Load a holo](/docs/api/load)

Generated from @prism-code/spec 2026-10-23 at 7185a44586ee29b9299da00b7668be529816b12c.
