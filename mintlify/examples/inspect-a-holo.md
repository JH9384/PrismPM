---
title: Inspect a holo
description: List the sections of a holo from code, without running it.
available_in: "0.5"
---

<Note>This page describes Prism 0.5, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>

Inspecting reads a holo and runs nothing, so it is safe on a file you do not yet trust. The output below was captured by running the code against the sample holo.

```js
import { readFile } from 'node:fs/promises';
import { inspect } from 'prism-code';

const inspection = await inspect(await readFile('./Calculator.holo'));
console.log(inspection.name, 'format', inspection.physical_version);
for (const section of inspection.sections) console.log(section.role, section.length);
```

```text
Calculator format 4
app-manifest 356
source-manifest 610
application-directory 1078
model-provenance 2194
guest 10569
view 3641
capability-set 175
model-document 5944
```

Each line is one section and its length in bytes. [The holo](/concepts/holo) explains what each section is for.

## Next steps

- [The holo](/concepts/holo)
- [Inspect a holo from the API](/api/inspect)
- [Holo format](/reference/holo-format)
