/**
 * Registry credentials, as Docker finds them (issue #292,
 * docs/proposals/292-push-pull-oci.md). Node only.
 *
 * In order: Docker's config (`credHelpers`, then `auths`, then `credsStore`), and
 * for `ghcr.io` only the `GHCR_TOKEN` and `GITHUB_TOKEN` variables. A secret is
 * returned to the registry client and never printed. No flag takes a token, so
 * none appears in a process list.
 *
 * `storeCredential` and `eraseCredential` write where Docker would (#447), so what
 * `prism.auth.login` stores is what `docker` and `push` read. Their errors quote no
 * helper output and no config text, because either may hold a secret.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { RegistryError } from './errors.mjs';

const DOCKER_HUB_KEY = 'https://index.docker.io/v1/';
const HELPER_NAME = /^[A-Za-z0-9_.-]+$/;
const HELPER_TIMEOUT_MS = 30000;

/** The keys Docker's config may file a registry under. */
function configKeys(registry) {
  if (registry === 'docker.io' || registry === 'index.docker.io' || registry === 'registry-1.docker.io') return [DOCKER_HUB_KEY, 'docker.io', 'index.docker.io', 'registry-1.docker.io'];
  return [registry, `https://${registry}`, `http://${registry}`, `https://${registry}/`, `https://${registry}/v1/`];
}

/** Where Docker keeps its config for this environment. */
function configPath(env) {
  return join(env.DOCKER_CONFIG || join(env.HOME || env.USERPROFILE || homedir(), '.docker'), 'config.json');
}

async function readConfig(env) {
  try {
    const config = JSON.parse(await readFile(configPath(env), 'utf8'));
    return config !== null && typeof config === 'object' ? config : {};
  } catch {
    return {};
  }
}

/** Stop a helper that hangs. Not `spawn`'s `timeout`: its timer outlives a helper that failed to start and holds the process open. */
const helperTimer = (child) => setTimeout(() => child.kill(), HELPER_TIMEOUT_MS);

/** Ask `docker-credential-<name> get`. Any failure counts as no credential. */
function askHelper(name, server, env) {
  if (!HELPER_NAME.test(name)) return Promise.resolve(null);
  return new Promise((done) => {
    let child;
    try {
      child = spawn(`docker-credential-${name}`, ['get'], { stdio: ['pipe', 'pipe', 'ignore'], env, windowsHide: true });
    } catch {
      done(null);
      return;
    }
    const timer = helperTimer(child);
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', () => {
      clearTimeout(timer);
      done(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
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

/** The credential Docker's config gives a registry and the store that held it, or null. */
async function fromDockerConfig(registry, env) {
  const config = await readConfig(env);
  const keys = configKeys(registry);
  const helpers = config.credHelpers ?? {};
  for (const key of keys) {
    if (typeof helpers[key] === 'string') {
      const found = await askHelper(helpers[key], key, env);
      if (found) return { credential: found, store: { kind: 'helper', name: helpers[key] } };
    }
  }
  const auths = config.auths ?? {};
  for (const key of keys) {
    const found = fromAuths(auths[key]);
    if (found) return { credential: found, store: { kind: 'config', path: configPath(env) } };
  }
  if (typeof config.credsStore === 'string') {
    for (const key of keys) {
      const found = await askHelper(config.credsStore, key, env);
      if (found) return { credential: found, store: { kind: 'helper', name: config.credsStore } };
    }
  }
  return null;
}

/** The variable that gives `ghcr.io` an ambient token, or null. Only its name leaves this module. */
function ambientVariable(registry, env) {
  if (registry !== 'ghcr.io') return null;
  return ['GHCR_TOKEN', 'GITHUB_TOKEN'].find((name) => env[name]) ?? null;
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
  if (found) return found.credential;
  if (registry === 'ghcr.io') {
    const token = env.GHCR_TOKEN || env.GITHUB_TOKEN;
    // The token is ambient, so it may go to GitHub's token endpoint and nowhere else, whatever a challenge says.
    if (token) return { username: env.GITHUB_ACTOR || 'x-access-token', password: token, onlyRealmHost: 'ghcr.io' };
  }
  return null;
}

/**
 * What `dockerCredentials` would find for a registry, without the secret: its
 * type, its username and the store that holds it, or null.
 *
 * @param {string} registry
 * @param {object} env
 * @returns {Promise<{ type: 'password' | 'identity-token', username: string | null, store: object } | null>}
 */
export async function describeCredential(registry, env) {
  const found = await fromDockerConfig(registry, env);
  if (found) {
    const { credential, store } = found;
    return credential.identityToken ? { type: 'identity-token', username: null, store } : { type: 'password', username: credential.username, store };
  }
  const variable = ambientVariable(registry, env);
  return variable ? { type: 'password', username: env.GITHUB_ACTOR || 'x-access-token', store: { kind: 'environment', variable } } : null;
}

/** Docker's choice of where a login goes: the registry's helper, else the default helper, else the config file. */
function writableStore(registry, config, env) {
  const helpers = config.credHelpers ?? {};
  for (const key of configKeys(registry)) {
    if (typeof helpers[key] === 'string') return { kind: 'helper', name: helpers[key], key };
  }
  const key = configKeys(registry)[0];
  return typeof config.credsStore === 'string' ? { kind: 'helper', name: config.credsStore, key } : { kind: 'config', path: configPath(env), key };
}

/** The store a login to this registry writes to. */
export async function storeForRegistry(registry, env) {
  const { key: _key, ...store } = writableStore(registry, await readConfig(env), env);
  return store;
}

/** Every store this environment configures, by name and path. A helper is not asked anything. */
export async function listStores(env) {
  const config = await readConfig(env);
  const stores = [{ kind: 'config', path: configPath(env) }];
  const scoped = new Map();
  for (const [key, name] of Object.entries(config.credHelpers ?? {})) {
    if (typeof name === 'string') scoped.set(name, [...(scoped.get(name) ?? []), key]);
  }
  for (const [name, registries] of scoped) stores.push({ kind: 'helper', name, registries });
  if (typeof config.credsStore === 'string') stores.push({ kind: 'helper', name: config.credsStore, registries: null });
  const variable = ambientVariable('ghcr.io', env);
  if (variable) stores.push({ kind: 'environment', variable, registries: ['ghcr.io'] });
  return stores;
}

const storeFailure = (message) => new RegistryError(message, { check: 'store.credentials' });
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The config to rewrite. A file that exists and does not parse is refused: rewriting it would lose what it holds. */
async function readConfigToWrite(env) {
  const path = configPath(env);
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw storeFailure(`the Docker config ${path} cannot be read (${error.code})`);
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    throw storeFailure(`the Docker config ${path} is not JSON, so it was left as it is`);
  }
  if (!isRecord(config)) throw storeFailure(`the Docker config ${path} is not a JSON object, so it was left as it is`);
  return config;
}

/** Write beside the target and rename, as Docker does, readable by the owner only. A symbolic link stays a link. */
async function writeConfig(config, env) {
  const path = configPath(env);
  const target = await realpath(path).catch(() => path);
  const scratch = `${target}.prism-${randomBytes(6).toString('hex')}.tmp`;
  try {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(scratch, `${JSON.stringify(config, null, '\t')}\n`, { mode: 0o600, flag: 'wx' });
    await rename(scratch, target);
  } catch (error) {
    throw storeFailure(`the Docker config ${path} cannot be written (${error.code})`);
  } finally {
    await rm(scratch, { force: true }).catch(() => {});
  }
}

/** Run `docker-credential-<name> <verb>`. It answers by exit code only: its output is never read, because it may echo the secret. */
function runHelper(name, verb, input, env) {
  if (!HELPER_NAME.test(name)) return Promise.resolve(false);
  return new Promise((done) => {
    let child;
    try {
      child = spawn(`docker-credential-${name}`, [verb], { stdio: ['pipe', 'ignore', 'ignore'], env, windowsHide: true });
    } catch {
      done(false);
      return;
    }
    const timer = helperTimer(child);
    child.on('error', () => {
      clearTimeout(timer);
      done(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** Drop this registry's entries from `auths`. Returns whether any went. */
function dropAuths(registry, config) {
  if (!isRecord(config.auths)) return false;
  let dropped = false;
  for (const key of configKeys(registry)) {
    if (Object.hasOwn(config.auths, key)) {
      delete config.auths[key];
      dropped = true;
    }
  }
  return dropped;
}

/**
 * Store a username and password where Docker would. It holds only when the
 * credential reads back as the one `dockerCredentials` will give.
 *
 * @param {string} registry
 * @param {{ username: string, password: string }} credential
 * @param {object} env
 * @returns {Promise<object>} the store written to
 */
export async function storeCredential(registry, { username, password }, env) {
  const config = await readConfigToWrite(env);
  const { key, ...store } = writableStore(registry, config, env);
  if (store.kind === 'helper') {
    const stored = await runHelper(store.name, 'store', JSON.stringify({ ServerURL: key, Username: username, Secret: password }), env);
    if (!stored) throw storeFailure(`docker-credential-${store.name} did not store the credential for ${registry}`);
    // `auths` is read before a default helper, so an old entry there would shadow what was just stored.
    if (dropAuths(registry, config)) await writeConfig(config, env);
  } else {
    dropAuths(registry, config);
    if (!isRecord(config.auths)) config.auths = {};
    config.auths[key] = { auth: Buffer.from(`${username}:${password}`).toString('base64') };
    await writeConfig(config, env);
  }
  const found = (await fromDockerConfig(registry, env))?.credential;
  if (found?.username !== username || found?.password !== password) throw storeFailure(`the credential for ${registry} was written to the ${store.kind} store but does not read back`);
  return store;
}

/**
 * Remove a registry's credential from every store of Docker's config that holds
 * it, under every name it may be filed by. It holds only when nothing in the
 * config still answers for the registry.
 *
 * @param {string} registry
 * @param {object} env
 * @returns {Promise<{ removed: boolean, ambient: string | null }>} `ambient` names a variable that still gives a token, which no logout can clear
 */
export async function eraseCredential(registry, env) {
  const config = await readConfigToWrite(env);
  const removed = (await fromDockerConfig(registry, env)) !== null;
  const helpers = config.credHelpers ?? {};
  const names = new Set([...configKeys(registry).map((key) => helpers[key]), config.credsStore].filter((name) => typeof name === 'string'));
  for (const name of names) {
    for (const key of configKeys(registry)) {
      if (await askHelper(name, key, env)) await runHelper(name, 'erase', key, env);
    }
  }
  if (dropAuths(registry, config)) await writeConfig(config, env);
  if ((await fromDockerConfig(registry, env)) !== null) throw storeFailure(`the credential for ${registry} is still in a store: a credential helper did not erase it`);
  return { removed, ambient: ambientVariable(registry, env) };
}
