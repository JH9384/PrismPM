---
title: Inspect a holo
description: Read the manifest, digests, world and attestations of a holo without running it.
---

Source: `prism-code` 0.2.0, `types/index.d.ts`; `@prism-code/spec` 2026-10-23, `types/holo.d.ts`.

## Example

Status: `inspect()` is not in prism-code 0.2.0. This page gains an executed example when the runtime ships it. The declarations below are what a reader decodes.

## Signature

```ts
export interface ArchiveIdentities {
  archiveFingerprint: string;
  footer: string;
  guestKappa: string;
  viewKappa: string;
  modelKappa: string;
  capabilitiesKappa: string;
  applicationKappa: string | null;
  verified: boolean;
  consistent: boolean;
}

export interface ParsedArchive {
  bytes: Uint8Array;
  body: Uint8Array;
  version: number;
  flags: number;
  sections: { index: number; kind: number; offset: number; length: number; body: Uint8Array }[];
  manifest: { uri: string; labels: string[]; suffix: Uint8Array; section: number };
  metadata: { text: string; section: number } | null;
  extensions: { name: string; payload: Uint8Array; text: string; section: number }[];
  blobs: { label: string; content: Uint8Array; section: number }[];
  footer: string;
  fingerprint: string;
  verification: { footer: boolean; labels: boolean; labelMismatches: { section: number; label: string; actual: string }[] };
}
```

## What a reader decodes

```ts
export interface SectionTableEntry {
  kind: SectionKindCode;
  offset: number;
  length: number;
}

export type AppManifestLabels = [capabilitySet: KappaLabel, guest: KappaLabel, view: KappaLabel];

export type ExtensionName =
  | 'https://hologram.foundation/extension/application-directory/v1'
  | 'https://uor.foundation/extension/prismpm-model/v1';

export type ContentBlobRole = 'capability-set' | 'guest' | 'model-document' | 'view';
```

## Next steps

- [Load a holo](/docs/api/load)
- [Check a holo](/docs/api/verify)
- [Holo format](/docs/reference/holo-format)

Generated from prism-code 0.2.0, @prism-code/spec 2026-10-23 at 5e1fa67fdd2aa79be8dfa042bd2911e54b8bd043.
