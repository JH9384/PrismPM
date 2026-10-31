/**
 * The code model `prism-code generate` writes from (issue #289): one
 * language-neutral description of a holo's interface, built from its WIT
 * world and its model document. Each language has a writer that turns this
 * model into files, as Kiota's per-language writers share one code model.
 *
 * Nothing here runs the guest. The world comes from the WIT file the holo's
 * contract names, checked against the digest `inspect` reports (the lock's
 * `inputs.world`); the application comes from the model document.
 */
import { readFileSync } from 'node:fs';
import { parseArchive, resolveArchive } from '../archive.mjs';
import { inspect } from '../inspect.mjs';
import { blake3Hex } from '../blake3.mjs';
import { sha256Hex } from '../sha256.mjs';
import { fail } from '../errors.mjs';
import { readWorld } from './wit.mjs';

/** The WIT file of each world, by the path `@prism-code/spec`'s registry names, vendored beside this module. */
const WIT_FILES = Object.freeze({
  'worlds/core-wasm.wit': new URL('./core-wasm.wit', import.meta.url),
});

const encoder = new TextEncoder();

/** The WIT text of a world, LF line ends, checked against the digest the holo's contract names. */
async function worldText(world) {
  if (!world.file || !Object.hasOwn(WIT_FILES, world.file)) {
    fail('generate.world', `no WIT file for the world ${world.contract}; generate knows ${Object.keys(WIT_FILES).join(', ')}`);
  }
  const text = readFileSync(WIT_FILES[world.file], 'utf8').replace(/\r\n/g, '\n');
  const bytes = encoder.encode(text);
  const digest = { blake3: blake3Hex(bytes), sha256: await sha256Hex(bytes) };
  if (digest.blake3 !== world.digest.blake3 || digest.sha256 !== world.digest.sha256) {
    fail('generate.world', `the vendored ${world.file} is not the world ${world.contract} names (blake3 ${digest.blake3}, expected ${world.digest.blake3})`);
  }
  return text;
}

function worldModel(world, wit) {
  if (wit.package !== world.package || wit.name !== world.name) {
    fail('generate.world', `${world.file} declares ${wit.package} world ${wit.name}; ${world.contract} is ${world.package} world ${world.name}`);
  }
  const functions = (direction) => wit.items.filter((i) => i.direction === direction);
  // WIT cannot name an exported memory; the world's file states it in prose and the registry lists it.
  const declared = new Set(functions('export').map((f) => f.name));
  const memories = world.exports.filter((name) => !declared.has(name));
  if (memories.length !== 1 || memories[0] !== 'memory' || functions('export').some((f) => !world.exports.includes(f.name))) {
    fail('generate.world', `the exports of ${world.file} do not match ${world.contract}: ${world.exports.join(', ')}`);
  }
  if (functions('import').length !== world.imports.length) fail('generate.world', `the imports of ${world.file} do not match ${world.contract}`);
  return {
    contract: world.contract,
    package: world.package,
    name: world.name,
    file: world.file,
    digest: { blake3: world.digest.blake3, sha256: world.digest.sha256 },
    memory: 'memory',
    imports: functions('import').map(strip),
    exports: functions('export').map(strip),
  };
}

const strip = ({ wit, name, params, result, docs }) => ({ wit, name, params, result, docs });

/** `subtract-all` and `subtract_all` read as `subtractAll`. */
export function camel(name) {
  return name.replace(/[-_]+([a-z0-9])/g, (_, c) => c.toUpperCase());
}

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const pascal = (name) => camel(name.replace(/^[a-z]/, (c) => c.toUpperCase()));

/**
 * The numeric profile of `prismpm/model-document/1`: a request is
 * `1\t<operation>\t<left>\t<right>` over signed 64-bit integers, a response
 * `1\tok\t<value>` or `1\terror\t<code>`. The operation table and the error
 * messages are the model's; the wire codes are the profile's.
 */
function operationsInterface(application) {
  const view = application.view ?? {};
  const operations = (view.operations ?? []).map((o) => ({
    name: o.request_name,
    method: camel(o.request_name),
    label: o.label,
    discriminant: o.discriminant,
  }));
  const method = application.function_name;
  const methods = new Set([method, 'constructor']);
  for (const o of operations) {
    if (!/^[a-z][a-z0-9-]*$/.test(o.name)) fail('generate.model', `operation ${JSON.stringify(o.name)} is not a request name generate can bind`);
    if (methods.has(o.method)) fail('generate.model', `operation ${o.name} collides with the method ${o.method}`);
    methods.add(o.method);
  }
  if (operations.length === 0) fail('generate.model', 'the model document has no operations');
  return {
    kind: 'operations',
    version: '1',
    method,
    operationType: application.operation_type,
    errorType: application.error_type,
    operand: 's64',
    operations,
    errors: [
      { code: 'overflow', message: view.overflow_error ?? null },
      { code: 'division-by-zero', message: view.division_error ?? null },
      { code: 'malformed-request', message: view.input_error ?? null },
      { code: 'unsupported-version', message: null },
      { code: 'unknown-operation', message: null },
    ],
  };
}

function applicationModel(document, digest) {
  const application = document.application ?? fail('generate.model', 'the model document has no application');
  const name = application.name ?? application.cargo_name ?? fail('generate.model', 'the application has no name');
  const type = pascal(name);
  if (!PASCAL.test(type)) fail('generate.model', `the application name ${JSON.stringify(name)} is not one generate can turn into a class name`);
  const numeric = document.schema === 'prismpm/model-document/1' && /AsciiSigned(I|Int)64$/.test(application.input_grammar ?? '');
  return {
    name,
    type,
    file: type.replace(/[A-Z]/g, (c, i) => (i === 0 ? '' : '-') + c.toLowerCase()),
    description: application.cargo_description ?? null,
    schema: document.schema,
    model: { blake3: digest.blake3, sha256: digest.sha256 },
    limits: {
      request: application.request_maximum ?? null,
      response: application.response_maximum ?? null,
      guestAllocation: application.guest_allocation_maximum ?? null,
    },
    interface: numeric ? operationsInterface(application) : { kind: 'bytes' },
  };
}

/**
 * Build the code model of a `.holo` from its bytes. Refuses a holo whose
 * identities do not hold, whose guest does not conform to its world, or whose
 * world has no WIT file here.
 */
export async function codeModel(bytes) {
  const resolved = resolveArchive(parseArchive(bytes));
  const inspection = await inspect(bytes);
  const { world } = inspection;
  if (!world || world.digest === null) fail('generate.world', `the holo declares no world generate knows (${world?.contract ?? 'none'})`);
  if (world.conforms !== true) fail('generate.world', `the guest does not conform to ${world.contract}; run prism-code inspect`);
  const wit = readWorld(await worldText(world));
  return {
    world: worldModel(world, wit),
    application: applicationModel(resolved.modelDocument, inspection.model.digest),
  };
}
