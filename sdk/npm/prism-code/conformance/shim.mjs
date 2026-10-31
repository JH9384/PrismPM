#!/usr/bin/env node
/**
 * The entrypoint shim of the JavaScript runtime for @prism-code/conformance. It
 * reads one request on stdin, calls the runtime's public API, and writes one
 * answer on stdout. sdk/npm/conformance/README.md states the contract.
 *
 * It judges nothing and adds no behaviour: it only translates. A Rust or Python
 * runtime writes the same thing in its own language. It is not in the published
 * package.
 */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { experimental_verify, grantOf, inspect, load, parseCapabilities, PrismError } from '../src/index.mjs';
import { FORMAT_REVISIONS } from '../src/inspect.mjs';

const CONTRACT = 'prism/conformance-shim/1';
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** Only the members the contract names. A message is for a person and never compared. */
function errorEnvelope(error) {
  if (!(error instanceof PrismError)) return { code: 'internal', message: String(error?.stack ?? error) };
  return { code: error.code, check: error.check, diagnostic: error.diagnostic, details: error.details, verdict: error.verdict, message: error.message };
}

const hexToBytes = (hex) => new Uint8Array(Buffer.from(hex, 'hex'));
const bytesToHex = (bytes) => Buffer.from(bytes).toString('hex');

/** What a load reports, in the contract's shape. */
function loaded(app) {
  return {
    kind: app.kind,
    name: app.name,
    verified: app.identities.verified,
    fingerprint: app.identities.archiveFingerprint,
    limits: app.limits,
    vectors: app.vectors.length,
    world: app.world,
    capabilities: { set: app.capabilities.set },
  };
}

function loadOptions(input) {
  const options = {};
  if (input.capabilities !== undefined) options.capabilities = input.capabilities;
  if (input.capabilitySet !== undefined) options.capabilitySet = input.capabilitySet;
  return options;
}

const OPERATIONS = {
  describe: async () => ({
    contract: CONTRACT,
    runtime: 'js',
    name: 'prism-code',
    version,
    revisions: Object.keys(FORMAT_REVISIONS),
    operations: Object.keys(OPERATIONS),
  }),
  load: async ({ bytes, input }) => loaded(await load(bytes, loadOptions(input))),
  verify: async ({ bytes, input }) => experimental_verify(bytes, { ...(input.policy ?? {}), throw: input.throw === true }),
  inspect: async ({ bytes }) => inspect(bytes),
  dispatch: async ({ bytes, input }) => {
    const app = await load(bytes);
    const responses = [];
    for (const request of input.requests) {
      try {
        responses.push({ hex: bytesToHex(await app.dispatch(hexToBytes(request))) });
      } catch (error) {
        responses.push({ error: errorEnvelope(error) });
      }
    }
    return { responses };
  },
  acceptance: async ({ bytes }) => {
    const { total, passed } = await (await load(bytes)).acceptance();
    return { total, passed };
  },
  capabilities: async ({ input }) => {
    const file = input.capabilities === undefined ? null : parseCapabilities(input.capabilities);
    const grant = input.capabilitySet === undefined ? grantOf(file) : grantOf(file, input.capabilitySet);
    const answers = (input.queries ?? []).map(({ kind, resource }) => grant.allows(kind, resource));
    for (const { kind, resource } of input.asserts ?? []) grant.assert(kind, resource);
    return { set: grant.set, answers };
  },
};

async function answer(request) {
  const operation = OPERATIONS[request.op];
  if (!operation) return { ok: false, unsupported: `no operation ${request.op}` };
  try {
    const bytes = request.archive === undefined ? undefined : new Uint8Array(await readFile(request.archive));
    return { ok: true, result: await operation({ bytes, input: request.input ?? {} }) };
  } catch (error) {
    return { ok: false, error: errorEnvelope(error) };
  }
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
process.stdout.write(`${JSON.stringify(await answer(request))}\n`);
