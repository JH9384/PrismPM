/**
 * Runs a runtime's entrypoint shim once. README.md states the contract: one
 * process per request, a JSON document on stdin, a JSON document on stdout, exit
 * 0 whenever the shim answered. Anything else means the shim itself broke, which
 * is reported apart from a wrong answer and is never excused by a declaration.
 */
import { spawn } from 'node:child_process';

export const SHIM_CONTRACT = 'prism/conformance-shim/1';
export const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 64 * 1024 * 1024;

/** Variables a scenario sets for itself must not leak in from the machine running the suite. */
function environment(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('PRISM_')) env[key] = value;
  return { ...env, ...extra };
}

/**
 * Send one request. Resolves `{ response }` for a well-formed answer, or
 * `{ broken }`, a sentence saying how the shim failed. Never rejects.
 */
export function callShim(command, request, { cwd, env = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const [program, ...args] = command;
    const executable = program === 'node' ? process.execPath : program;
    let child;
    try {
      child = spawn(executable, args, { cwd, env: environment(env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve({ broken: `the shim did not start: ${error.message}` });
      return;
    }
    const out = [];
    const err = [];
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ broken: `the shim gave no answer within ${timeoutMs} ms` }), timeoutMs);
    child.on('error', (error) => finish({ broken: `the shim did not start: ${error.message}` }));
    // A shim may exit without reading stdin; that is judged by its answer, not by the broken pipe.
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) finish({ broken: `the shim wrote more than ${MAX_OUTPUT} bytes` });
      else out.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (err.length < 64) err.push(chunk);
    });
    child.on('close', (code, signal) => {
      const tail = Buffer.concat(err).toString('utf8').trim().split('\n').slice(-3).join(' ').slice(0, 400);
      if (code !== 0) {
        finish({ broken: `the shim exited ${code ?? signal}${tail ? `: ${tail}` : ''}` });
        return;
      }
      let response;
      try {
        response = JSON.parse(Buffer.concat(out).toString('utf8'));
      } catch {
        finish({ broken: `the shim's stdout is not one JSON document${tail ? `: ${tail}` : ''}` });
        return;
      }
      const shape = problemOfResponse(response);
      finish(shape ? { broken: shape } : { response });
    });
    child.stdin.end(JSON.stringify({ contract: SHIM_CONTRACT, ...request }));
  });
}

function problemOfResponse(response) {
  if (response === null || typeof response !== 'object' || Array.isArray(response)) return 'the shim answered something other than a JSON object';
  if (response.ok === true) return 'result' in response ? null : 'the shim answered ok true with no result';
  if (response.ok !== false) return 'the shim answered with no boolean ok';
  if ('unsupported' in response) return typeof response.unsupported === 'string' ? null : 'unsupported must be a sentence';
  if (typeof response.error?.code !== 'string') return 'the shim answered ok false with no error.code and no unsupported';
  return null;
}
