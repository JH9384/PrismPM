/**
 * Registry credentials, as Docker finds them (issue #292,
 * docs/proposals/292-push-pull-oci.md). Node only.
 *
 * In order: Docker's config (`credHelpers`, then `auths`, then `credsStore`), and
 * for `ghcr.io` only the `GHCR_TOKEN` and `GITHUB_TOKEN` variables. A secret is
 * returned to the registry client and never printed. No flag takes a token, so
 * none appears in a process list.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DOCKER_HUB_KEY = 'https://index.docker.io/v1/';
const HELPER_NAME = /^[A-Za-z0-9_.-]+$/;
const HELPER_TIMEOUT_MS = 30000;

/** The keys Docker's config may file a registry under. */
function configKeys(registry) {
  if (registry === 'docker.io' || registry === 'index.docker.io' || registry === 'registry-1.docker.io') return [DOCKER_HUB_KEY, 'docker.io', 'index.docker.io', 'registry-1.docker.io'];
  return [registry, `https://${registry}`, `http://${registry}`, `https://${registry}/`, `https://${registry}/v1/`];
}

async function readConfig(env) {
  const directory = env.DOCKER_CONFIG || join(env.HOME || env.USERPROFILE || homedir(), '.docker');
  try {
    const config = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));
    return config !== null && typeof config === 'object' ? config : {};
  } catch {
    return {};
  }
}

/** Ask `docker-credential-<name> get`. Any failure counts as no credential. */
function askHelper(name, server, env) {
  if (!HELPER_NAME.test(name)) return Promise.resolve(null);
  return new Promise((done) => {
    let child;
    try {
      child = spawn(`docker-credential-${name}`, ['get'], { stdio: ['pipe', 'pipe', 'ignore'], env, timeout: HELPER_TIMEOUT_MS, windowsHide: true });
    } catch {
      done(null);
      return;
    }
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', () => done(null));
    child.on('close', (code) => {
      if (code !== 0) {
        done(null);
        return;
      }
      try {
        const { Username: username, Secret: secret } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof secret !== 'string' || secret === '') done(null);
        // Docker's convention for an identity token: the username is the literal `<token>`.
        else done(username === '<token>' ? { identityToken: secret } : { username: username ?? '', password: secret });
      } catch {
        done(null);
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(server);
  });
}

function fromAuths(entry) {
  if (entry === null || typeof entry !== 'object') return null;
  if (typeof entry.identitytoken === 'string' && entry.identitytoken !== '') return { identityToken: entry.identitytoken };
  if (typeof entry.username === 'string' && typeof entry.password === 'string') return { username: entry.username, password: entry.password };
  if (typeof entry.auth === 'string' && entry.auth !== '') {
    const decoded = Buffer.from(entry.auth, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon > 0) return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1).replace(/\0+$/, '') };
  }
  return null;
}

async function fromDockerConfig(registry, env) {
  const config = await readConfig(env);
  const keys = configKeys(registry);
  const helpers = config.credHelpers ?? {};
  for (const key of keys) {
    if (typeof helpers[key] === 'string') {
      const found = await askHelper(helpers[key], key, env);
      if (found) return found;
    }
  }
  const auths = config.auths ?? {};
  for (const key of keys) {
    const found = fromAuths(auths[key]);
    if (found) return found;
  }
  if (typeof config.credsStore === 'string') {
    for (const key of keys) {
      const found = await askHelper(config.credsStore, key, env);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The credential for one registry, or null for anonymous.
 *
 * @param {string} registry the registry name of a reference
 * @param {{ env?: object }} [options]
 * @returns {Promise<{ username: string, password: string } | { identityToken: string } | null>}
 */
export async function dockerCredentials(registry, options = {}) {
  const env = options.env ?? process.env;
  const found = await fromDockerConfig(registry, env);
  if (found) return found;
  if (registry === 'ghcr.io') {
    const token = env.GHCR_TOKEN || env.GITHUB_TOKEN;
    // The token is ambient, so it may go to GitHub's token endpoint and nowhere else, whatever a challenge says.
    if (token) return { username: env.GITHUB_ACTOR || 'x-access-token', password: token, onlyRealmHost: 'ghcr.io' };
  }
  return null;
}
