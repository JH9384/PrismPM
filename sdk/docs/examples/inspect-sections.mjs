import { readFile } from 'node:fs/promises';
import { inspect } from 'prism-code';

const inspection = await inspect(await readFile('./Calculator.holo'));
console.log(inspection.name, 'format', inspection.physical_version);
for (const section of inspection.sections) console.log(section.role, section.length);
