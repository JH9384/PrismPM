// Drive the real Prism server (`prism-code mcp`) over stdio, as an agent does: one process, JSON-RPC lines.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../../bin/prism-code.mjs', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('../fixtures/journey/', import.meta.url));
const FAKE_DOCKER = fileURLToPath(new URL('./fake-docker.mjs', import.meta.url));

/** The shipping draft the fixture holo was built from, and that holo (prism-code 0.9.1, SDK image cd3b47d7, 2026-11-16). */
export const SHIPPING_DRAFT = JSON.parse(readFileSync(join(FIXTURES, 'shipping-method.draft.json'), 'utf8'));
export const SHIPPING_HOLO = join(FIXTURES, 'shipping-method.holo');
/** The seal that holo carries: the address of the spec.json Prism stores for the draft. It moves only if completion does. */
export const SHIPPING_SEAL = 'blake3:f1479464e810a32665f748c15721b9506d819a3236bc18a65ad8abfe9767ae99';

/** A new, empty project folder. */
export const project = () => mkdtempSync(join(tmpdir(), 'prism-stress-'));

/** The environment that puts the stand-in where Docker would be, with a plan for it (see fake-docker.mjs). */
export function fakeDocker(cwd, plan = {}) {
  mkdirSync(join(cwd, 'prism'), { recursive: true });
  return {
    PRISM_DOCKER: `"${process.execPath}" "${FAKE_DOCKER}"`,
    PRISM_DOCKER_MOUNT: 'native',
    FAKE_DOCKER_PLAN: JSON.stringify({ app: join(cwd, 'prism'), log: join(cwd, 'docker.log'), ...plan }),
  };
}

/**
 * Start a server in `cwd`. `call(name, args)` resolves `{ data, text, isError, error, ms }`:
 * `data` is the tool's structured result, `error` a JSON-RPC error. `kill()` ends it as a crash
 * does; `close()` ends it as an agent that shuts down does, and waits.
 */
export function startServer(cwd, { env = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'prism-stress-home-'));
  const child = spawn(process.execPath, [BIN, 'mcp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PRISM_HOME: home, PRISM_TELEMETRY: '0', PRISM_CODE_TIER: '', ...env } });
  let buffer = '';
  let stderr = '';
  let next = 1;
  const waiting = new Map();
  const stray = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const take = waiting.get(message.id);
      if (take) {
        waiting.delete(message.id);
        take(message);
      } else stray.push(message);
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((done) => child.on('exit', done));
  const rpc = (method, params, { timeoutMs = 60000 } = {}) =>
    new Promise((done, refuse) => {
      const id = next++;
      const timer = setTimeout(() => refuse(new Error(`${method} did not answer in ${timeoutMs} ms; stderr: ${stderr.slice(-400)}`)), timeoutMs);
      waiting.set(id, (message) => {
        clearTimeout(timer);
        done(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const call = async (name, args = {}, options) => {
    const started = performance.now();
    const reply = await rpc('tools/call', { name, arguments: args }, options);
    const ms = performance.now() - started;
    if (reply.error) return { error: reply.error, isError: true, text: reply.error.message, data: null, ms };
    const text = reply.result.content.map((c) => c.text).join('\n');
    return { data: reply.result.structuredContent ?? null, text, isError: reply.result.isError === true, error: null, ms };
  };
  return {
    pid: child.pid,
    rpc,
    call,
    raw: (line) => child.stdin.write(`${line}\n`),
    stray,
    stderr: () => stderr,
    kill: async () => {
      child.kill('SIGKILL');
      await exited;
    },
    close: async () => {
      child.stdin.end();
      await exited;
    },
  };
}

/** Call a long tool again while it says it is running; resolves the first answer that does not, and every answer before it. */
export async function until(server, name, args = {}, { tries = 200, pauseMs = 100 } = {}) {
  const seen = [];
  for (let i = 0; i < tries; i++) {
    const answer = await server.call(name, { wait: 0, ...args });
    seen.push(answer);
    if (answer.data?.state !== 'running' && answer.data?.state !== 'busy') return { answer, seen };
    await new Promise((done) => setTimeout(done, pauseMs));
  }
  throw new Error(`${name} was still running after ${tries} calls: ${JSON.stringify(seen.at(-1)?.data)}`);
}
