---
title: Instantiate a holo
description: Create a running instance with exactly the capability set you grant.
available_in: "0.6"
---

Source: `@prism-code/spec` 2026-10-23, `types/holo.d.ts`, `worlds/core-wasm.wit`.

## Example

Status: `instantiate()` is not in prism-code 0.2.0, which runs each request on a fresh guest instance inside `dispatch()`. The world below is what an instance exports.

## What an instance exports

```ts
export type CoreWasmContract = 'hologram:guest/core-wasm@1';

export interface CoreWasmExports {
  memory: WebAssembly.Memory;
  holo_alloc(length: number): number;
  holo_run(offset: number, length: number): bigint;
}

export interface World {
  readonly version: 1;
  readonly package: string;
  readonly world: string;
  readonly file: string;
  readonly digest: { readonly blake3: string; readonly sha256: string };
  readonly imports: readonly WorldImport[];
  readonly exports: readonly WorldExport[];
}
```

```wit
package hologram:guest@1.0.0;

world core-wasm {
  /// Reserve `length` bytes of guest memory for a request and return their offset.
  export holo-alloc: func(length: u32) -> u32;

  /// Run the request at `offset` with `length` bytes. Returns `offset << 32 | length` of the response.
  export holo-run: func(offset: u32, length: u32) -> u64;
}
```

## Next steps

- [Dispatch inputs](/docs/api/dispatch)
- [Check a holo](/docs/api/verify)
- [Holo format](/docs/reference/holo-format)

Generated from @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.
