/**
 * Prove and build a spec: write the model, run the SDK image, and turn every
 * answer into something a person can act on. A wrong axiom set is fixed and
 * the proof run again without asking, because it is bookkeeping, not intent.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { PrismError } from '../errors.mjs';
import { fromFile } from '../node.mjs';
import { counterexample, describeConditions, isProposed, triesEveryCase } from './spec.mjs';
import { isStateful, names, renderSpecDocument } from './render.mjs';
import { respondSession, runSession, statefulCounterexample } from './stateful.mjs';
import { bind, isBound, modelMismatches, modelPath, newestHolo, rememberModel, writeApp, writeSession, writeSpecDocument } from './project.mjs';
import { BUILD_SCRIPT, DEFAULT_SDK_IMAGE, buildProgress, axiomViolations, declarationAt, forbiddenAxioms, forbiddenMessage, docker, hasImage, imageOf, parseDiagnostics, resolveDocker, runInImage, steps } from './sdk.mjs';
import { SDK_IMAGE_DOWNLOAD } from '../setup-machine.mjs';
import { parseRepository } from '../github.mjs';
import { TEMPLATE_REPOSITORY, commitApp, createFromTemplate, fetchLive, gitRoot, originRepository, publishRepository, pushClone, readyForGitHub, signedInLogin, suggestedRepository, waitForWorkflows } from './github.mjs';
import { TEMPLATE_EXAMPLE, TEMPLATE_TEST, appJson, conformanceText, featureText, idsToml, lexleanLockText, liveUrl, rustTestText, suiteOf } from './template.mjs';
import { VERSION } from '../version.mjs';
import { gapLedger, propertyShape } from '../gaps.mjs';
import { checkSpecBinding } from './binding.mjs';
import { WORD_MAX, boundedSpec, ruleWords, unboundedFields } from './kernel-prove.mjs';

const PROVE_SCRIPT_FULL = [
  'echo "@@step prelock"; lexlean lock 2>&1; code=$?; echo "@@exit prelock $code"; [ $code -eq 0 ] || exit $code',
  'echo "@@step format"; lexlean fmt --all 2>&1; code=$?; echo "@@exit format $code"; [ $code -eq 0 ] || exit $code',
  'echo "@@step lock"; lexlean lock 2>&1; code=$?; echo "@@exit lock $code"; [ $code -eq 0 ] || exit $code',
  'echo "@@step check"; prismpm check 2>&1; code=$?; echo "@@exit check $code"; [ $code -eq 0 ] || exit $code',
  'echo "@@step verify"; lexlean verify --all 2>&1; code=$?; echo "@@exit verify $code"; exit $code',
].join('; ');

const MAX_AXIOM_ROUNDS = 8;

/** The image this app is or will be pinned to. */
const imageFor = (dir, session) => (isBound(dir) ? imageOf(dir) : session.image ?? DEFAULT_SDK_IMAGE);

/**
 * Whether the rule judge reads this spec, so Lean's kernel can check it in
 * this process and the app needs no build (kernel-prove.mjs, rule-app.mjs).
 */
export function kernelReads(spec) {
  try {
    ruleWords(spec);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the app's guarantees are checked. A rule app the rule judge reads is
 * `kernel`: Lean's kernel, in this process, with no SDK image and nothing
 * sent. Any other app is `local`, in the SDK image on this machine.
 * `PRISM_CODE_TIER` names one instead: `local`, `kernel`, or `hosted`, which
 * sends the model to the UOR MCP server and stores it unlisted, not
 * privately; Prism never chooses that on its own.
 */
export function proveWhere(dir, session, { env = process.env } = {}) {
  const tier = env.PRISM_CODE_TIER;
  if (tier === 'hosted' || tier === 'kernel' || tier === 'local') return tier;
  return session?.spec && kernelReads(session.spec) ? 'kernel' : 'local';
}

/** A kernel answer that is no verdict on the app: the kernel did not run, or a guarantee is beyond this route. The SDK image can still prove it. */
export const beyondKernel = (r) => !r.ok && (r.code === 'kernel.unavailable' || r.code === 'kernel.refused' || ((r.properties ?? []).some((p) => p.status === 'unknown') && !(r.properties ?? []).some((p) => p.status === 'failing')));

/**
 * Where the app is built: always `local`, in the SDK image on this machine,
 * which is downloaded first when it is missing. Only `remote: 'github'` (the
 * caller named a repository or asked for GitHub) builds on GitHub Actions.
 */
export function buildWhere(dir, session, { remote = null } = {}) {
  return remote === 'github' ? 'github' : 'local';
}

/**
 * Make sure Docker, the image and the project's SDK pin are in place. With
 * `pull`, a missing image is downloaded first and the log says so; without it,
 * a missing image is refused.
 */
export async function prepare(dir, session, log, { pull = false } = {}) {
  const d = resolveDocker();
  if (d.error) return { ok: false, message: d.error };
  const image = imageFor(dir, session);
  if (!hasImage(image)) {
    if (!pull) return { ok: false, message: `The SDK image is not on this machine. Run \`npx prism-code@latest setup --pull\` in a terminal to download it (about ${SDK_IMAGE_DOWNLOAD}), or set PRISM_CODE_TIER=hosted to prove on the hosted verifier, which stores the model unlisted, not privately.\n  ${image}` };
    log(`The SDK image is not on this machine yet. Downloading it once now, about ${SDK_IMAGE_DOWNLOAD}; this can take a while.`);
    const pulled = await docker(['pull', image], { onLine: (l) => /^(Status|Digest|[0-9a-f]{12}: Pull complete)/.test(l) && log(l) });
    if (pulled.code !== 0) return { ok: false, message: `Could not download the SDK image:\n${tail(pulled.output)}` };
  }
  if (!isBound(dir)) {
    log('Pinning the project to the SDK image (prismpm update)...');
    const r = await bind(dir, image, { onLine: log });
    if (!r.ok) return { ok: false, message: `Could not pin the SDK image:\n${tail(r.output)}` };
  }
  return { ok: true };
}

const tail = (text, n = 25) => String(text).split(/\r?\n/).filter((l) => !l.startsWith('@@')).slice(-n).join('\n');

/**
 * The step a script was in when its output stopped: it began and never said how
 * it ended. A step that fails says so (`@@exit step code`), so a missing exit
 * means the shell itself went away: the container was killed, Docker or WSL
 * restarted, or the machine ran out of memory. Measured on 2026-11-16: three
 * builds of four ended this way on a loaded machine and were reported as a
 * failed build, or as a Prism bug.
 */
export function cutOff(output) {
  const begun = [...String(output).matchAll(/^@@step (\S+)\s*$/gm)].map((m) => m[1]);
  const last = begun.at(-1);
  return last && !steps(output).some((s) => s.step === last) ? last : null;
}

/** The result of a job whose environment stopped under it: not the spec's fault, not Prism's, and safe to run again. */
function interrupted(dir, kind, step, run, seconds) {
  writeFileSync(join(dir, '.prism-last.log'), run.output);
  return {
    ok: false,
    interrupted: true,
    stage: kind,
    step,
    seconds,
    message: `The ${kind} did not finish: its environment stopped during the ${step} step, before that step reported a result. Docker or WSL restarted, the machine ran out of memory, or the process was killed. Nothing is wrong with the spec, and nothing it had finished is lost.`,
    next: `Call prism_${kind} again. If it stops again, free memory or close other builds first; what it printed is in prism/.prism-last.log.`,
  };
}

/** A holo under `.prism/build` that the toolchain finished verifying: a record under `.prism/verified` names its build and its bytes. */
export function verifiedHolo(dir) {
  const root = join(dir, '.prism', 'verified');
  if (!existsSync(root)) return null;
  const find = (value) => {
    if (Array.isArray(value)) return value.map(find).find(Boolean) ?? null;
    if (!value || typeof value !== 'object') return null;
    if (typeof value.path === 'string' && value.path.endsWith('.holo') && typeof value.sha256 === 'string') return value;
    return Object.values(value).map(find).find(Boolean) ?? null;
  };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let record;
    try {
      record = JSON.parse(readFileSync(join(root, entry.name, 'manifest.json'), 'utf8'));
    } catch {
      continue;
    }
    const artifact = typeof record.build_id === 'string' && /^[0-9a-f]{64}$/.test(record.build_id) ? find(record) : null;
    if (!artifact || artifact.path.includes('/') || artifact.path.includes('\\')) continue;
    const holo = join(dir, '.prism', 'build', record.build_id, artifact.path);
    if (existsSync(holo) && createHash('sha256').update(readFileSync(holo)).digest('hex') === artifact.sha256) return holo;
  }
  return null;
}

/**
 * Take a build that finished with no Prism server watching, when an agent
 * restarted its server while the build ran. It counts only when the toolchain
 * recorded it as verified, the holo names this spec, and Lean had proved this
 * model; `built` then replays the acceptance vectors as it does for any build.
 * Returns the build's result, or null when there is nothing to adopt.
 */
export async function adoptBuild(dir, session) {
  const holo = verifiedHolo(dir);
  if (!holo || !session.spec || !existsSync(modelPath(dir, session.spec))) return null;
  if (!session.status.proved || session.status.proved.modelSha !== session.status.modelSha) return null;
  if (modelMismatches(dir, { axioms: session.axioms ?? {} }).length) return null;
  if (!checkSpecBinding(new Uint8Array(readFileSync(holo)), session.spec).ok) return null;
  rememberModel(dir, session);
  session.status.proved.modelSha = session.status.modelSha;
  const result = await built(dir, session, holo, 0, { where: 'local' });
  return result.ok ? result : null;
}

/** Seconds since anything under the app's build folders changed, or null when there is none: a build still running keeps writing there. */
export function buildQuietFor(dir, { now = Date.now() } = {}) {
  let newest = 0;
  const visit = (d, depth) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(d, entry.name);
      try {
        newest = Math.max(newest, statSync(p).mtimeMs);
      } catch {
        // A file the build removed between the listing and the look.
      }
      if (entry.isDirectory() && depth < 4) visit(p, depth + 1);
    }
  };
  visit(join(dir, '.prism'), 0);
  visit(join(dir, 'target'), 0);
  return newest ? Math.max(0, Math.round((now - newest) / 1000)) : null;
}

/**
 * Lean proves every property. Returns `{ ok, properties, message, diagnostics }`,
 * with each property `proved`, `failing` or `unknown`. `gaps` is the ledger a
 * failure that is Prism's or Lean's, not the user's, is recorded in (gaps.mjs).
 */
export async function prove(dir, session, { log = () => {}, overwrite = false, where = null, client = null, gaps = gapLedger(), env = process.env } = {}) {
  const first = writeApp(dir, session, { overwrite });
  if (first.edited) return { ok: false, edited: true, message: `${relative(dir, first.path)} was edited by hand since Prism wrote it. Call the same tool again with overwrite: true to replace it from the spec, or change the spec to match.` };
  // A route the caller or the user named is kept; one Prism chose may fall back to the SDK image.
  const named = where !== null || env.PRISM_CODE_TIER === 'kernel';
  where ??= proveWhere(dir, session, { env });
  if (where === 'hosted') return proveHosted(dir, session, { log, client, gaps });
  if (where === 'kernel') {
    const checked = await proveKernel(dir, session, { log });
    if (named || !beyondKernel(checked)) return checked;
    log("Lean's kernel in this process could not settle every guarantee, so Lean proves the model in the SDK image instead.");
  }
  const ready = await prepare(dir, session, log);
  if (!ready.ok) return { ok: false, message: ready.message };
  overwrite = true;
  const spec = session.spec;
  const n = names(spec);
  const started = Date.now();
  for (let round = 1; round <= MAX_AXIOM_ROUNDS; round++) {
    const written = writeApp(dir, session, { overwrite: overwrite || round > 1 });
    if (written.edited) {
      return { ok: false, edited: true, message: `${relative(dir, written.path)} was edited by hand since Prism wrote it. Call the same tool again with overwrite: true to replace it from the spec, or change the spec to match.` };
    }
    log(round === 1 ? 'Formatting, locking and checking the model, then asking Lean to prove it...' : `Correcting an axiom set and proving again (round ${round})...`);
    const run = await runInImage(dir, PROVE_SCRIPT_FULL, { onLine: (l) => /^(error|warning|verified|checked|check passed)/.test(l) && log(l) });
    rememberModel(dir, session);
    const diagnostics = parseDiagnostics(run.output);
    const failed = steps(run.output).find((s) => s.code !== 0);
    const fixes = axiomViolations(diagnostics);
    // Planted defect G5: an observed sorryAx or Lean.ofReduceBool is refused, never recorded as the expected set.
    if (forbiddenAxioms(fixes).length) return { ok: false, message: forbiddenMessage(forbiddenAxioms(fixes)) };
    if (fixes.length && diagnostics.every((d) => d.code === 'LLV7005')) {
      for (const f of fixes) session.axioms[f.name] = f.axioms;
      continue;
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    if (run.code === 0) return provedResult(dir, session, seconds, { where: 'local' });
    if (cutOff(run.output)) return interrupted(dir, 'prove', cutOff(run.output), run, seconds);
    return explainFailure(dir, session, { run, diagnostics, failed, seconds, gaps });
  }
  return { ok: false, message: 'The axiom sets did not settle after several rounds. This is a Prism bug; the last output is in prism/.prism-last.log.' };
}

/** Record that every property was proved, and say so. `proof` says where, and for a hosted proof its attestation. */
function provedResult(dir, session, seconds, proof) {
  const spec = session.spec;
  const n = names(spec);
  session.status.properties = Object.fromEntries(spec.properties.map((p) => [p.id, 'proved']));
  session.status.proved = { modelSha: session.status.modelSha, at: new Date().toISOString(), seconds, ...proof };
  writeSpecDocument(dir, session);
  const where = proof.where === 'hosted' ? ' on the hosted verifier' : '';
  return {
    ok: true,
    seconds,
    where: proof.where,
    ...(proof.attestation ? { attestation: proof.attestation } : {}),
    properties: spec.properties.map((p) => ({ id: p.id, theorem: theoremsOf(n, p).join(', '), says: p.says, status: 'proved' })),
    message: spec.properties.length
      ? `Lean proved all ${spec.properties.length} propert${spec.properties.length === 1 ? 'y' : 'ies'} for every request${where}, in ${seconds} s.`
      : `The model checks and verifies${where} in ${seconds} s. No property is stated, so nothing about the rules is proved.`,
  };
}

/** The theorems that prove a property: one for prism/spec/1, one per action and the start for a state property of prism/spec/2. */
const theoremsOf = (n, p) => n.properties[p.id].theorems ?? [n.properties[p.id].theorem];

/** A Lean warning, such as an unused simp argument: reported, never a reason the proof failed. LexLean files Lean's warnings under LLV7002 with the word in the message. */
export const isWarning = (d) => d.severity === 'warning' || /^Lean rejected `[^`]+` \(warning\):/.test(d.message);

/** A `lexlean/diagnostic/1` from the hosted verifier, in the shape `parseDiagnostics` gives. */
export function fromHosted(d) {
  const p = d.primary;
  return { severity: d.severity ?? 'error', code: d.code, message: String(d.message ?? ''), span: p?.path ? { file: p.path, line: p.line_start, column: p.column_start } : null };
}

/**
 * The proof on the hosted verifier: no Docker, no image. Every module under
 * `src/` is named, as `lexlean verify --all` verifies them, so the proofs
 * module, which is not an entrypoint, is proved too, and the answer counts
 * only when each of them comes back verified. Axiom sets are corrected and
 * proved again as in the image.
 */
async function proveHosted(dir, session, { log, client, gaps }) {
  const hosted = await import('../hosted.mjs');
  client ??= hosted.hostedClient({ version: VERSION, gaps });
  const started = Date.now();
  for (let round = 1; round <= MAX_AXIOM_ROUNDS; round++) {
    writeApp(dir, session, { overwrite: true });
    log(round === 1
      ? `Asking Lean to prove the model on the hosted verifier ${client.url}, so the SDK image is not needed yet. The files under prism/src/ are sent and stored unlisted: not searchable, but readable by anyone with the draft's ID.`
      : `Correcting an axiom set and proving again (round ${round})...`);
    let project;
    try {
      project = hosted.hostedProject(dir);
    } catch (error) {
      if (error.code !== 'hosted.layout') throw error;
      return { ok: false, message: `The hosted verifier cannot take this app (${error.message}). This is a Prism bug: the app folder should have the template's shape.` };
    }
    const all = { ...project, entrypoints: project.files.map((f) => f.path).filter((p) => hosted.moduleOf(p)) };
    let outcome;
    try {
      outcome = await hosted.hostedVerify(client, all, { onWait: (s) => s % 30 < 5 && log(`Lean is working, ${s} s...`) });
    } catch (error) {
      if (!String(error.code).startsWith('hosted.')) throw error;
      return { ok: false, message: `The hosted verifier did not prove the model: ${error.message}` };
    }
    rememberModel(dir, session);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (outcome.state === 'verified') {
      const record = hosted.writeHostedRecord(dir, { ...outcome, url: client.url, entrypoints: all.entrypoints });
      return provedResult(dir, session, seconds, { where: 'hosted', attestation: outcome.record.attestation_id, record: relative(dir, record).split('\\').join('/') });
    }
    const diagnostics = outcome.diagnostics.map(fromHosted);
    const fixes = axiomViolations(diagnostics);
    if (forbiddenAxioms(fixes).length) return { ok: false, message: forbiddenMessage(forbiddenAxioms(fixes)) };
    if (fixes.length && diagnostics.filter((d) => !isWarning(d)).every((d) => d.code === 'LLV7005')) {
      for (const f of fixes) session.axioms[f.name] = f.axioms;
      continue;
    }
    const output = diagnostics.map((d) => `${d.severity}[${d.code}]: ${d.message}${d.span ? `\n  --> ${d.span.file}:${d.span.line}:${d.span.column}` : ''}`).join('\n');
    return explainFailure(dir, session, { run: { code: 1, output }, diagnostics, failed: { step: 'verify', code: 1 }, seconds, gaps });
  }
  return { ok: false, message: 'The axiom sets did not settle after several rounds. This is a Prism bug; the last output is in prism/.prism-last.log.' };
}

/** What the kernel route does not claim, said with every answer it gives. */
/** What a rule app reads of a number field the spec leaves unbounded, said wherever the bounds are claimed. */
const boundsNote = (spec) => {
  const open = unboundedFields(spec);
  return open.length ? ` The spec gives ${open.map((n) => `\`${n}\``).join(', ')} no upper bound; this app reads ${open.length === 1 ? 'it' : 'them'} up to ${WORD_MAX} and refuses more.` : '';
};

const KERNEL_SCOPE = 'This checks the rules as the rule judge reads them, in this process, with no SDK image. prism_build makes the app that rule judge, so the check is about the app it builds. It is not a proof of the rendered model: PRISM_CODE_TIER=local proves that in the SDK image.';

/**
 * The check with Lean's kernel in this process: no Docker, no image, nothing
 * sent. A guarantee the kernel accepts is `kernel-checked`, never `proved`,
 * because the lemma speaks about the rule judge and not about the rendered
 * model, so `status.proved` is left alone and a build still proves the model.
 * A guarantee the kernel refuses is `failing` only when a request breaks it.
 */
async function proveKernel(dir, session, { log }) {
  const spec = session.spec;
  const { KERNEL_AXIOMS, KernelUnread, kernelProve, ruleWords } = await import('./kernel-prove.mjs');
  log("Asking Lean's kernel, in this process, to check every guarantee. No SDK image is used and nothing is sent.");
  let result;
  try {
    result = await kernelProve(spec, { log });
  } catch (error) {
    if (error instanceof KernelUnread) return { ok: false, where: 'kernel', code: error.code, message: `Lean's kernel in this process cannot read this spec: ${error.message}. Prove it in the SDK image instead: set PRISM_CODE_TIER=local and call prism_prove again.` };
    // The kernel not running says nothing about the app, so it is never reported as a failed proof.
    return { ok: false, where: 'kernel', code: 'kernel.unavailable', message: `Lean's kernel could not run in this process (${error.message}). This says nothing about the app. Set PRISM_CODE_TIER=local and call prism_prove again to prove it in the SDK image.` };
  }
  rememberModel(dir, session);
  const seconds = Math.round(result.ms / 100) / 10;
  const refused = spec.properties.filter((_, i) => !result.judged[i].accepted);
  // The verdict is the verified guest's (kernel-verdict.mjs): it compares what was pinned with what was derived,
  // the spec's statement with the one the kernel was shown, and the axioms observed with those declared.
  const { guestVerdict } = await import('./kernel-verdict.mjs');
  const { pinnedHolo, statementOf } = await import('./rule-app.mjs');
  const stated = ruleWords(spec);
  let verdict;
  try {
    verdict = await guestVerdict(pinnedHolo(), { pinned: result.pinned, derived: { kernel: result.evidence.kernel, library: result.evidence.library }, bundle: result.evidence.bundle, statement: statementOf(stated.words, stated.guarantees), checked: result.evidence.statement, declared: KERNEL_AXIOMS, observed: result.evidence.axioms, accepted: refused.length === 0 });
  } catch (error) {
    verdict = { ok: false, code: error.code ?? 'verdictRuntimeFailed' };
  }
  if (!verdict.ok) return { ok: false, where: 'kernel', code: 'kernel.unavailable', message: `The verdict guest gave no verdict (${verdict.code}). This says nothing about the app. Set PRISM_CODE_TIER=local and call prism_prove again to prove it in the SDK image.` };
  if (refused.length === 0 && verdict.verdict !== 'proved') return { ok: false, where: 'kernel', code: 'kernel.refused', message: `Lean's kernel accepted every guarantee, and the verdict guest answered ${verdict.verdict}: a pinned address, the statement or the axioms (${result.evidence.axioms.join(', ') || 'none'}) are not the declared ones. Nothing is recorded.` };
  result.evidence.verdict = verdict.verdict;
  const broken = new Map(refused.map((p) => [p.id, counterexample(spec, p)]));
  const statusOf = (p) => (!broken.has(p.id) ? 'kernel-checked' : broken.get(p.id).request !== null ? 'failing' : 'unknown');
  session.status.properties = Object.fromEntries(spec.properties.map((p) => [p.id, statusOf(p)]));
  session.status.kernelChecked = refused.length ? null : { modelSha: session.status.modelSha, at: new Date().toISOString(), seconds, ...result.evidence };
  writeSpecDocument(dir, session);
  const properties = spec.properties.map((p) => ({ id: p.id, says: p.says, status: statusOf(p) }));
  if (refused.length === 0) {
    return {
      ok: true,
      seconds,
      where: 'kernel',
      evidence: result.evidence,
      properties,
      message: spec.properties.length
        ? `Lean's kernel accepted all ${spec.properties.length} guarantee${spec.properties.length === 1 ? '' : 's'} for every request in the fields' bounds, in ${seconds} s.${boundsNote(spec)} ${KERNEL_SCOPE}`
        : `No property is stated, so there was nothing for Lean's kernel to check. ${KERNEL_SCOPE}`,
    };
  }
  const explained = refused.map((p) => {
    const found = broken.get(p.id);
    return found.request !== null
      ? `${p.id} is false. The request \`${found.request}\` meets "${describeConditions(p.when)}" and the rules answer ${found.outcome} (${found.rule ?? 'otherwise'}).`
      : `Lean's kernel did not accept ${p.id} ("${p.says}"), and none of ${found.checked} sampled requests breaks it. This route cannot yet prove every true guarantee, one that says "is not" among them, so this is not a verdict on ${p.id}. Set PRISM_CODE_TIER=local and call prism_prove again to prove it in the SDK image.`;
  });
  return { ok: false, seconds, where: 'kernel', properties, message: `${explained.join('\n')}\n${KERNEL_SCOPE}`, next: refused.some((p) => broken.get(p.id).request !== null) ? 'Change a rule or restate the property (prism_answer with step rules or properties), then prove again.' : undefined };
}

/**
 * The build with no SDK image: Lean's kernel checks the guarantees, then the
 * app is written as the pinned rule judge's holo and this spec's numbers,
 * named together, and its vectors are replayed through that judge. It writes
 * no holo, so `status.holo` and `status.proved` are left alone.
 */
async function buildKernel(dir, session, { log, overwrite }) {
  const first = writeApp(dir, session, { overwrite });
  if (first.edited) return { ok: false, edited: true, stage: 'prove', message: `${relative(dir, first.path)} was edited by hand since Prism wrote it. Call the same tool again with overwrite: true to replace it from the spec, or change the spec to match.` };
  const started = Date.now();
  const checked = await proveKernel(dir, session, { log });
  if (!checked.ok) return { ...checked, stage: 'prove' };
  const { loadRuleApp, ruleAppRecord } = await import('./rule-app.mjs');
  log("Writing the app as the verified rule judge and this spec's numbers. Nothing is compiled.");
  const { bytes, address } = ruleAppRecord(session.spec, { proof: checked.evidence });
  const path = join(dir, '.prism', 'build', `${session.spec.name}.rule-app.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  let app;
  let acceptance;
  try {
    app = await loadRuleApp(readFileSync(path));
    acceptance = await app.acceptance();
  } catch (error) {
    return { ok: false, stage: 'build', where: 'kernel', message: `The rule judge could not run this app (${error.message}). This is a Prism bug, not a problem with your spec.` };
  }
  // The app as a page: static files any host serves, written only for an app whose vectors all pass.
  let site = null;
  if (acceptance.failed.length === 0) {
    const { writeRuleAppSite } = await import('./rule-app-site.mjs');
    site = writeRuleAppSite(join(dir, '.prism', 'site'), bytes).directory;
  }
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  session.status.ruleApp = { path, address, site, at: new Date().toISOString(), seconds, passed: acceptance.passed, total: acceptance.total, holo: app.record.kernel.holo };
  writeSpecDocument(dir, session);
  const ok = acceptance.failed.length === 0;
  const count = session.spec.properties.length;
  return {
    ok,
    stage: 'build',
    where: 'kernel',
    seconds,
    app: path,
    address,
    site,
    holo: app.record.kernel.holo,
    vectors: { passed: acceptance.passed, total: acceptance.total },
    message: ok
      ? `Built in ${seconds} s with no SDK image and nothing compiled: the app is the verified rule judge and this spec's numbers, named together as ${address}. Lean's kernel accepted ${count === 0 ? 'no guarantee, because none is stated' : `all ${count} guarantee${count === 1 ? '' : 's'}`} for that rule judge. Tested: ${acceptance.passed} of ${acceptance.total} acceptance vectors pass through it.${boundsNote(session.spec)} The text of a request is read outside the guest, so refusing malformed text is tested, not proved. Its page is the folder ${relative(process.cwd(), site) || site}: static files any host serves, which check the app in the browser before it answers. This is not a holo: prism_try answers from it, a build on GitHub (name a repository) makes a holo there, and PRISM_CODE_TIER=local builds one in the SDK image.`
      : `Written, but ${acceptance.failed.length} of ${acceptance.total} acceptance vectors fail through the rule judge. That is a Prism bug: the evaluator and the rule judge disagree.`,
  };
}

/**
 * Say why a proof failed. Two failures are not the user's and are recorded as
 * gaps: a property Lean did not prove that no sampled request breaks, and a
 * generated model the toolchain refused.
 */
function explainFailure(dir, session, { run, diagnostics, failed, seconds, gaps = null }) {
  const spec = session.spec;
  const n = names(spec);
  writeFileSync(join(dir, '.prism-last.log'), run.output);
  if (run.code === 69 || run.code === 70) return { ok: false, message: tail(run.output) };
  const source = (file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8') : '');
  const byTheorem = Object.fromEntries(spec.properties.flatMap((p) => theoremsOf(n, p).map((t) => [t, p])));
  const failing = [];
  const other = [];
  for (const d of diagnostics) {
    if (isWarning(d)) continue;
    const decl = d.span && /\.lex\.tex$/.test(d.span.file) ? declarationAt(source(d.span.file), d.span.line) : null;
    const property = decl && byTheorem[decl];
    if (property && d.code === 'LLV7002') {
      if (!failing.includes(property)) failing.push(property);
    } else if (d.code === 'LLV7005') {
      const fix = axiomViolations([d])[0];
      if (fix && fix.forbidden.length === 0) session.axioms[fix.name] = fix.axioms;
      else if (fix) other.push(d);
    } else other.push(d);
  }
  session.status.properties = Object.fromEntries(spec.properties.map((p) => [p.id, failing.includes(p) ? 'failing' : 'unknown']));
  writeSpecDocument(dir, session);
  if (failing.length && other.length === 0) {
    const explained = failing.map((p) => {
      if (isStateful(spec)) {
        const found = statefulCounterexample(spec, p);
        if (found.steps === null) gaps?.record({ kind: 'unproved', construct: propertyShape(p), code: codeOf(diagnostics, p, byTheorem, source) });
        return found.steps !== null
          ? `${p.id} is false. The session \`${found.steps.join(';')}\` ${p.action ? `ends with ${p.action} answering ${found.outcome} (${found.rule ?? 'otherwise'})` : `reaches the state ${found.state}`}.`
          : `Lean could not prove ${p.id} ("${p.says}"), and none of ${found.checked} sampled reachable states breaks it. A state property is proved by induction, so it may hold yet not be kept by some action from a state no session reaches; add the state property that rules that state out, or restate it.`;
      }
      const found = counterexample(spec, p);
      if (found.request === null) gaps?.record({ kind: 'unproved', construct: propertyShape(p), code: codeOf(diagnostics, p, byTheorem, source) });
      if (found.request !== null) return `${p.id} is false. The request \`${found.request}\` meets "${describeConditions(p.when)}" and the rules answer ${found.outcome} (${found.rule ?? 'otherwise'}).`;
      // Measured on 2026-11-16: a guarantee Prism proposed for a spec of 24 rules, true for every
      // request, was refused by Lean's arithmetic step, and this message blamed the sampling.
      const strike = `strike it to build without it (pass the spec to prism_spec again without ${p.id}); what it says stays tested by the acceptance vectors.${isProposed(p) ? ' Prism proposed it; the user did not state it.' : ''}`;
      return triesEveryCase(spec)
        ? `${p.id} ("${p.says}") holds for every request: Prism tried every case the rules tell apart (${found.checked}), and none breaks it. Lean could not finish its proof; that is a limit of the prover on this spec, not a fault in it. So ${strike}`
        : `Lean could not prove ${p.id} ("${p.says}"), and none of ${found.checked} sampled requests breaks it. ${spec.fields.every((f) => f.kind === 'choice' || f.max !== undefined) ? 'A request the sampling did not try may break it: one where two fields are compared.' : 'It may hold only for requests the sampling missed, such as very large numbers.'} Restate it more narrowly, or ${strike}`;
    });
    return { ok: false, seconds, properties: spec.properties.map((p) => ({ id: p.id, status: session.status.properties[p.id] })), message: explained.join('\n'), next: 'Change a rule or restate the property (prism_answer with step rules or properties), then prove again.' };
  }
  const step = failed?.step ?? 'run';
  gaps?.record({ kind: 'model-refused', construct: step, code: (other.length ? other : diagnostics)[0]?.code ?? null });
  return {
    ok: false,
    seconds,
    message: `The ${step} step failed. This means Prism generated a model the toolchain refuses, which is a Prism bug, not a problem with your spec.`,
    diagnostics: (other.length ? other : diagnostics).slice(0, 8).map((d) => ({ code: d.code, message: d.message.split('\n').slice(0, 6).join('\n'), at: d.span ? `${d.span.file}:${d.span.line}` : null })),
    output: diagnostics.length ? undefined : tail(run.output),
  };
}

/** The code of the diagnostic that refused property `p`. */
function codeOf(diagnostics, p, byTheorem, source) {
  const d = diagnostics.find((x) => !isWarning(x) && x.span && /\.lex\.tex$/.test(x.span.file) && byTheorem[declarationAt(source(x.span.file), x.span.line)] === p);
  return d?.code ?? null;
}

/**
 * Prove, then build the holo and replay its acceptance vectors through the
 * guest. `remote: 'github'` has the repository's own GitHub Actions build the
 * committed app instead, and this machine verifies what comes back, so no
 * Docker and no SDK image are needed here.
 */
export async function build(dir, session, { log = () => {}, overwrite = false, remote = null, root = null, repository = null, env = process.env, gaps = gapLedger() } = {}) {
  // A rule app the rule judge reads needs no build (rule-app.mjs). Never for a GitHub build, which makes a holo there.
  const tier = env.PRISM_CODE_TIER;
  if (!remote && !repository && (tier === 'kernel' || (tier !== 'local' && tier !== 'hosted' && session.spec && kernelReads(session.spec)))) {
    const made = await buildKernel(dir, session, { log, overwrite });
    if (tier === 'kernel' || !(made.stage === 'prove' && beyondKernel(made))) return made;
    log("Lean's kernel in this process could not settle every guarantee, so the app is proved and built in the SDK image instead.");
  }
  // From here the app is a holo built from the rendered model, so the proof is the model's.
  const modelWhere = tier === 'hosted' ? 'hosted' : 'local';
  const proved = session.status.proved && session.status.proved.modelSha === session.status.modelSha && existsSync(modelPath(dir, session.spec)) && session.status.lastSpec === JSON.stringify(session.spec);
  if (!proved) {
    const p = await prove(dir, session, { log, overwrite, gaps, where: modelWhere, env });
    session.status.lastSpec = JSON.stringify(session.spec);
    writeSession(dir, session);
    if (!p.ok) return { ...p, stage: 'prove' };
  }
  // The one path: the model built is exactly what spec.json renders to, byte for byte. Anything else is refused.
  const mismatched = modelMismatches(dir, { axioms: session.axioms ?? {} });
  if (mismatched.length) {
    return { ok: false, stage: 'build', mismatched, message: `model does not match spec.json: ${mismatched.join(', ')}. The model is generated from prism/spec.json alone; change spec.json (or the spec through prism_spec) and build again, or pass overwrite to regenerate the model from it.` };
  }
  const where = buildWhere(dir, session, { env, remote: repository && !remote ? 'github' : remote });
  // The GitHub template writes a decision app's claims, scenarios and tests; a stateful app builds here until it has its own.
  if (where === 'github' && isStateful(session.spec)) return { ok: false, stage: 'build', message: 'A stateful app (prism/spec/2) builds on this machine for now: the GitHub template writes the claims, scenarios and tests of a decision app. Call prism_build without a repository.' };
  if (where === 'github') return buildRemote(dir, session, { log, root: root ?? defaultRoot(dir), repository });
  // A build needs the image, and a hosted proof did not: pull it now if it is missing, saying so, and pin the app to it.
  const ready = await prepare(dir, session, log, { pull: true });
  if (!ready.ok) {
    const hint = resolveDocker().error ? ' Or sign in to GitHub (gh auth login) and build again: the app then builds on GitHub Actions and this machine needs no Docker.' : '';
    return { ok: false, stage: 'build', message: `${ready.message}${hint}` };
  }
  const started = Date.now();
  log('Building the app: Lean export, Rust, WebAssembly, the holo and its independent acceptance run. The first build takes ten minutes or more...');
  // Each stage the build enters becomes a progress line, so a caller polling the log sees which one is running (#585).
  const run = await runInImage(dir, BUILD_SCRIPT, {
    socket: true,
    onLine: (l) => {
      const stage = buildProgress(l);
      if (stage) log(stage);
      else if (/^(error|warning|verified|built|wrote|PP\d|  \w)/.test(l)) log(l);
    },
  });
  // The build formats the model; remember it as formatted, so the next proof does not take it for a hand edit.
  const wasProved = session.status.proved?.modelSha === session.status.modelSha;
  rememberModel(dir, session);
  // Formatting changes no meaning, so a proof of the model before it still stands.
  if (wasProved) session.status.proved.modelSha = session.status.modelSha;
  const seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(join(dir, '.prism-last.log'), run.output);
  if (run.code !== 0 && cutOff(run.output)) return interrupted(dir, 'build', cutOff(run.output), run, seconds);
  if (run.code !== 0) {
    const diagnostics = parseDiagnostics(run.output);
    return { ok: false, stage: 'build', seconds, message: 'The build failed. The last lines are below; the whole log is prism/.prism-last.log.', diagnostics: diagnostics.slice(0, 8), output: diagnostics.length ? undefined : tail(run.output, 30) };
  }
  const holo = newestHolo(dir);
  if (!holo) return { ok: false, stage: 'build', seconds, message: 'The build passed but wrote no holo that Prism could find under prism/.prism/build. That is a fault in Prism or the toolchain, not in the spec.', next: 'Call prism_build again with overwrite: true. If no holo appears again, what the build printed is in prism/.prism-last.log.' };
  return built(dir, session, holo, seconds, { where: 'local' });
}

/** The folder an app's repository starts at: the folder holding `prism/`, or the app folder itself. */
const defaultRoot = (dir) => (basename(dir) === 'prism' && !existsSync(join(dir, '..', 'prism.toml')) ? dirname(dir) : dir);

/**
 * Build on GitHub Actions and verify here. With no repository yet, ask for
 * one: creating a public repository is the user's call, so the result names
 * the suggested repository and the agent calls again with `repository` once
 * the user approves. Then add what the workflow needs, commit Prism's own
 * paths and nothing else, create or connect the repository, and build that
 * commit. `steps` is injectable for tests.
 */
/**
 * What a GitHub build asks first when there is nowhere to build yet: no repository named, no clone
 * this journey made, and no origin. Null when there is somewhere. The server asks it before any
 * proof starts: measured on 2026-11-16, the question came only after minutes of proving, and a
 * repository passed meanwhile joined that build and was ignored.
 */
export function askForRepository(dir, session, { repository = null, steps = {} } = {}) {
  const s = { gitRoot, originRepository, signedInLogin, ...steps };
  if (repository) return null;
  const made = session.status?.repository;
  if (made?.clone && existsSync(made.clone)) return null;
  const top = s.gitRoot(dir);
  if (top && s.originRepository(top)) return null;
  const suggested = suggestedRepository(s.signedInLogin(), session.spec);
  return {
    ok: false,
    stage: 'build',
    needs: 'repository',
    suggested,
    message: `The app builds on GitHub Actions, so it needs a GitHub repository, and there is none yet. Ask the user to approve creating the public repository ${suggested} (or another name they choose) from the UOR-Foundation/template, then call prism_build with repository set to it. It gets the template's frame, page and gate, and a live URL on GitHub Pages.`,
  };
}

export async function buildRemote(dir, session, { log = () => {}, root, repository = null, steps = {} } = {}) {
  const s = { gitRoot, originRepository, signedInLogin, readyForGitHub, commitApp, publishRepository, remoteBuild: null, ...steps };
  const started = Date.now();
  const top = s.gitRoot(dir);
  const base = top ?? resolve(root ?? defaultRoot(dir));
  const origin = top ? s.originRepository(top) : null;
  const named = repository ? parseRepository(repository) : null;
  if (repository && !named) return { ok: false, stage: 'build', message: `repository must be owner/name, not ${JSON.stringify(repository)}.` };
  // An app this journey made from the template builds in its own clone, again and again.
  const made = session.status.repository;
  if (made?.clone && existsSync(made.clone) && (!named || named.full.toLowerCase() === made.full.toLowerCase())) return buildFromTemplate(dir, session, { log, repository: made.full, clone: made.clone, steps });
  // A new app becomes an instance of the template: its frame, page, gate and Pages URL.
  if (!origin && named) return buildFromTemplate(dir, session, { log, repository: named.full, clone: join(base, named.repo), create: true, steps });
  if (!origin && !named) return askForRepository(dir, session, { steps: s });
  if (origin && named && origin.full.toLowerCase() !== named.full.toLowerCase()) {
    return { ok: false, stage: 'build', message: `This folder's origin is ${origin.full}, not ${named.full}. Call prism_build without repository to build in ${origin.full}.` };
  }
  try {
    const written = await s.readyForGitHub({ root: base, dir, session, log });
    const app = relative(base, dir).split(sep).join('/') || '.';
    const paths = [...new Set([app, ...written])];
    const { committed, sha } = s.commitApp({ root: base, paths, message: `prism: ${session.spec.name}` });
    if (committed) log(`Committed ${paths.join(', ')} as ${sha.slice(0, 12)}.`);
    if (!origin) {
      log(`Putting the app on GitHub as ${named.full}...`);
      const published = s.publishRepository({ root: base, repository: named.full });
      session.status.repository = { full: published.repository, created: published.created };
    }
  } catch (error) {
    return { ok: false, stage: 'build', message: `Could not get the app ready to build on GitHub: ${error.message}` };
  }
  log("Building on GitHub Actions: the repository's build.yml runs prismpm verify in the SDK image, and this machine checks what comes back.");
  let result;
  try {
    const remoteBuild = s.remoteBuild ?? (await import('../remote-github.mjs')).remoteBuild;
    // Prism's paths are committed; anything else the user has not committed stays out of the build.
    result = await remoteBuild({ cwd: base, allowDirty: true, version: VERSION, log });
  } catch (error) {
    if (!(error instanceof PrismError)) throw error;
    return { ok: false, stage: 'build', message: `The remote build was refused: ${error.code}: ${error.message}` };
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  if (result.exitCode !== 0) {
    return { ok: false, stage: 'build', seconds, message: `The build came back from ${result.run.url} but did not pass here: verdict ${result.verdict.level ?? 'none'}, ${result.vectors.passed} of ${result.vectors.total} vectors. What came back is at ${result.staging}.` };
  }
  if (!resolve(result.holo).startsWith(resolve(dir))) {
    return { ok: false, stage: 'build', seconds, message: `The repository's build.yml built ${result.project}, not ${relative(base, dir) || '.'}; the workflow and the app folder disagree.` };
  }
  return built(dir, session, result.holo, seconds, { where: 'github', repository: result.repository, run: result.run.url, fingerprint: result.fingerprint, signer: result.signature.identity ?? `a workflow of ${result.repository}`, checkedBy: result.signature.via });
}

/** Write the app into a template clone: `app/` from the journey's project, and every file the gate and the page read. */
export function writeTemplateApp(clone, dir, session) {
  const spec = session.spec;
  const n = names(spec);
  const read = (path) => readFileSync(join(clone, path), 'utf8');
  const write = (path, text) => {
    mkdirSync(dirname(join(clone, path)), { recursive: true });
    writeFileSync(join(clone, path), text);
  };
  // The app's Rust test takes the place of the example's, so the template's ratchet (audit-prism:
  // no new non-Prism file, no growth in non-Prism lines) sees the example's file replaced by a
  // smaller one, not a file added. An instance an earlier prism-code wrote keeps the file it has.
  // Measured on 2026-11-16: written as `<suite>.rs`, the gate refused every app.
  const earlier = `crates/conformance/tests/${suiteOf(spec)}.rs`;
  const test = existsSync(join(clone, earlier)) ? earlier : TEMPLATE_TEST;
  for (const path of TEMPLATE_EXAMPLE) rmSync(join(clone, path), { force: true });
  for (const entry of readdirSync(join(clone, 'app', 'src'))) if (entry.endsWith('.lex.tex')) rmSync(join(clone, 'app', 'src', entry));
  const sources = [`src/${n.module}.lex.tex`, ...(existsSync(join(dir, 'src', `${n.proofs}.lex.tex`)) ? [`src/${n.proofs}.lex.tex`] : [])];
  for (const path of [...sources, 'lakefile.toml', 'lake-manifest.json', 'prismpm.toml']) write(`app/${path}`, readFileSync(join(dir, path)));
  // Both modules are entrypoints, so prismpm verify has the Lean kernel check every property's theorem in the gate.
  write('app/lexlean.toml', readFileSync(join(dir, 'lexlean.toml'), 'utf8').replace(/^entrypoints = \[[^\]]*\]$/m, `entrypoints = [${sources.map((p) => JSON.stringify(p)).join(', ')}]`));
  const files = Object.fromEntries(['lexlean.toml', 'lake-manifest.json', 'lakefile.toml', 'lean-toolchain'].map((p) => [p, readFileSync(join(clone, 'app', p))]));
  write('app/lexlean.lock', lexleanLockText(read('app/lexlean.lock'), files));
  write('model/ids.toml', idsToml(spec, read('model/ids.toml')));
  write(`features/suites/${suiteOf(spec)}.feature`, featureText(spec));
  write(test, rustTestText(spec));
  // The spec the app is sealed to, beside its model: without it, nobody holding the repository can
  // run `prism-code check --spec` on the app it publishes.
  write('app/spec.json', readFileSync(join(dir, 'spec.json')));
  write('CONFORMANCE.md', conformanceText(spec, read('CONFORMANCE.md')));
  // The spec a reader opens first, where OpenSpec's tools look for it.
  write(`openspec/specs/${spec.name}/spec.md`, renderSpecDocument(spec, session.status));
  write('site/app.json', appJson(spec, read('site/app.json'), { repository: session.status.repository.full, attestation: session.status.proved?.attestation ?? null }));
}

/**
 * Build a template instance: create it from UOR-Foundation/template when
 * `create`, write the app into its clone, push, and wait for its gate
 * (`bootstrap`) and its page (`pages`). Pages builds and verifies the holo in
 * the SDK image and signs its provenance; this machine then fetches the live
 * holo and replays its acceptance vectors.
 */
async function buildFromTemplate(dir, session, { log, repository, clone, create = false, steps = {} }) {
  const s = { createFromTemplate, pushClone, waitForWorkflows, fetchLive, client: null, ...steps };
  const started = Date.now();
  const live = liveUrl(repository);
  let sha;
  try {
    if (create) {
      log(`Creating ${repository} from ${TEMPLATE_REPOSITORY}, with GitHub Pages...`);
      await s.createFromTemplate({ repository, into: clone });
      session.status.repository = { full: repository, created: true, template: true, clone, live };
      writeSession(dir, session);
    }
    writeTemplateApp(clone, dir, session);
    sha = s.pushClone({ clone, message: `${session.spec.title}: the app, its claims and its page, from prism-code` });
    if (sha) log(`Pushed ${sha.slice(0, 12)} to ${repository}.`);
    else {
      const head = spawnSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
      sha = String(head.stdout).trim();
      log(`Nothing changed since ${sha.slice(0, 12)}; checking its runs.`);
    }
  } catch (error) {
    return { ok: false, stage: 'build', message: `Could not get the app onto GitHub: ${error.message}` };
  }
  log('Waiting for the gate (bootstrap) and the page (pages): the SDK builds and verifies the holo, and Lean checks every theorem. About ten minutes.');
  let runs;
  try {
    const client = s.client ?? (await import('../remote-github.mjs')).gitHubClient({ token: (await import('../remote-github.mjs')).tokenOf().token, version: VERSION });
    runs = await s.waitForWorkflows({ repository, sha, workflows: ['pages.yml', 'bootstrap.yml'], log, client });
  } catch (error) {
    return { ok: false, stage: 'build', message: `Could not follow the runs on GitHub: ${error.message}` };
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const failed = Object.entries(runs).filter(([, r]) => r.conclusion !== 'success');
  // The page can be live while the gate failed: pages builds, verifies and publishes on its own. Say
  // so, and check what is live, rather than report that nothing is (measured on 2026-11-16).
  if (failed.length && runs['pages.yml']?.conclusion === 'success') {
    const gate = runs['bootstrap.yml'];
    let check = null;
    try {
      const holo = join(dir, '.prism', 'live', sha, `${session.spec.title}.holo`);
      await s.fetchLive({ live, into: holo });
      const binding = checkSpecBinding(new Uint8Array(readFileSync(holo)), session.spec);
      check = binding.ok ? `The live holo matches prism/spec.json (${binding.specAddress}).` : `The live holo does not match prism/spec.json: ${binding.message}`;
    } catch (error) {
      check = `The live holo could not be checked: ${error.message}.`;
    }
    return {
      ok: false,
      stage: 'build',
      seconds,
      live,
      repository: `https://github.com/${repository}`,
      message: `The page is live at ${live}, built and verified by pages.yml. ${check} But the gate, bootstrap.yml, ended ${gate?.conclusion ?? 'without a result'}: ${gate?.html_url ?? ''}. The app does not meet the template's contract until it passes; the log there says why.`,
    };
  }
  if (failed.length) {
    return { ok: false, stage: 'build', seconds, repository: `https://github.com/${repository}`, message: `${failed.map(([w, r]) => `${w} ended ${r.conclusion}: ${r.html_url}`).join('; ')}. The log there says why; nothing is live from this commit.` };
  }
  let holo;
  try {
    holo = join(dir, '.prism', 'live', sha, `${session.spec.title}.holo`);
    await s.fetchLive({ live, into: holo });
  } catch (error) {
    return { ok: false, stage: 'build', seconds, repository: `https://github.com/${repository}`, message: `The gate and the page passed, but ${error.message}.` };
  }
  return built(dir, session, holo, seconds, { where: 'github', repository, live, run: runs['pages.yml'].html_url, gate: runs['bootstrap.yml'].html_url, fingerprint: null, signer: `the pages workflow of ${repository}` });
}

/**
 * Where Lean checked the proofs of what was built, said plainly: proved names
 * only a run the kernel finished, and says where it ran. The acceptance
 * vectors are tested, never proved.
 */
export function proofSentence(session, proof) {
  if (proof.where === 'github') return 'Lean checked every property in the GitHub build gate, not on this machine.';
  const proved = session.status.proved;
  if (!proved || proved.modelSha !== session.status.modelSha) return 'No proof of this model is recorded, so nothing about its rules is proved.';
  if (proved.where === 'hosted') return 'Lean proved every property on the hosted verifier, not on this machine; that proof is trusted, not local.';
  return 'Lean proved every property on this machine (lexlean verify --all) before the build.';
}

/** Record a built holo, replay its vectors here and say how to run it. `proof` says where it was built. */
async function built(dir, session, holo, seconds, proof) {
  // What the holo says about the spec it came from. A holo that names another spec is not this app.
  const binding = checkSpecBinding(new Uint8Array(readFileSync(holo)), session.spec);
  if (binding.reason === 'mismatch') {
    return { ok: false, stage: 'build', spec: binding, message: `The built holo does not match prism/spec.json. ${binding.message}` };
  }
  const app = await fromFile(holo);
  const acceptance = await app.acceptance();
  session.status.holo = holo;
  session.status.vectors = acceptance.total;
  session.status.built = { at: new Date().toISOString(), seconds, passed: acceptance.passed, total: acceptance.total, ...proof };
  writeFileSync(join(dir, 'run-policy.json'), '{"minimum": "P0"}\n');
  writeSpecDocument(dir, session);
  const rel = relative(process.cwd(), holo) || holo;
  const policy = relative(process.cwd(), join(dir, 'run-policy.json')) || join(dir, 'run-policy.json');
  const where = proof.live
    ? ` on GitHub Actions, where the gate (${proof.gate}) and the page (${proof.run}) passed; the live holo was fetched and checked here`
    : proof.where === 'github'
      ? ` on GitHub Actions (${proof.run}), provenance signed by ${proof.signer} and checked here`
      : '';
  const ok = acceptance.failed.length === 0;
  return {
    ok,
    stage: 'build',
    seconds,
    holo,
    spec: { sealed: binding.ok, specAddress: binding.specAddress, ...(binding.ok ? {} : { note: binding.message }) },
    where: proof.where,
    ...(proof.live ? { live: proof.live } : {}),
    ...(proof.where === 'github' ? { repository: `https://github.com/${proof.repository}`, actions: proof.run, fingerprint: proof.fingerprint ?? app.identities?.archiveFingerprint ?? null } : {}),
    vectors: { passed: acceptance.passed, total: acceptance.total },
    message: ok
      ? `${proof.live ? `Live at ${proof.live}. ` : ''}Built in ${seconds} s${where}. ${proofSentence(session, proof)} Tested: ${acceptance.passed} of ${acceptance.total} acceptance vectors pass in the built guest. The holo does not carry the proof: it has no signed proof statement, so the default \`prism-code check\` reports P0; run it with the run policy below.`
      : `Built, but ${acceptance.failed.length} of ${acceptance.total} acceptance vectors fail in the guest. That is a Prism bug: the evaluator and the model disagree.`,
    run: {
      serve: `npx prism-code run "${rel}" --policy "${policy}" --port 8080`,
      once: `npx prism-code run "${rel}" "${exampleRequest(session.spec)}" --policy "${policy}"`,
      note: `The run policy accepts P0. ${proofSentence(session, proof)} The holo does not carry that proof: it holds no signed proof statement, so \`prism-code check\` under the default policy (P2) reports P0 and fails (#582).`,
    },
  };
}

function exampleRequest(spec) {
  if (isStateful(spec)) return spec.examples[0]?.steps.join(';') ?? spec.actions[0].name;
  return spec.examples[0]?.request ?? spec.fields.map((f) => (f.kind === 'choice' ? f.values[0] : String(f.min ?? 1))).join(' ');
}

/** Answer one request: from the built guest when there is one, else from the spec. */
export async function tryRequest(session, request) {
  if (isStateful(session.spec)) return trySession(session, request);
  const { respond, decodeRequest, judge } = await import('./spec.mjs');
  const bytes = new TextEncoder().encode(request);
  const expected = respond(session.spec, bytes);
  const decoded = decodeRequest(session.spec, request);
  const why = decoded ? judge(session.spec, decoded).rule ?? 'otherwise' : 'malformed';
  if (session.status.holo && existsSync(session.status.holo)) {
    const app = await fromFile(session.status.holo);
    const answer = new TextDecoder().decode(await app.dispatch(bytes));
    return { request, answer, from: 'the built app', decidedBy: why, agreesWithSpec: answer === expected };
  }
  const record = session.status.ruleApp;
  if (record?.path && existsSync(record.path)) {
    const { loadRuleApp, ruleAppRecord } = await import('./rule-app.mjs');
    try {
      const app = await loadRuleApp(readFileSync(record.path));
      // A record written for an earlier spec is not this app: answer from the spec until it is built again.
      if (ruleAppRecord(session.spec, { proof: app.record.proof }).address === app.address) {
        const answer = new TextDecoder().decode(await app.dispatch(bytes));
        // The built app is the bounded one, so that is the spec it is held to.
        const bounded = respond(boundedSpec(session.spec), bytes);
        return { request, answer, from: 'the built app (the rule judge)', decidedBy: bounded === 'invalid' ? 'malformed' : why, agreesWithSpec: answer === bounded };
      }
    } catch {
      // A record that is refused answers nothing; the spec still can.
    }
  }
  return { request, answer: expected, from: 'the spec (not built yet)', decidedBy: why };
}

/** Answer one session of a stateful app: from the built app when there is one, else from the spec, with what each step answered. */
async function trySession(session, request) {
  const bytes = new TextEncoder().encode(request);
  const expected = respondSession(session.spec, bytes);
  const steps = runSession(session.spec, request.split(';')).map((r, i) => ({ step: request.split(';')[i], answer: r.outcome, decidedBy: r.rule ?? (r.outcome === 'invalid' ? 'malformed' : 'otherwise') }));
  if (session.status.holo && existsSync(session.status.holo)) {
    const app = await fromFile(session.status.holo);
    const answer = new TextDecoder().decode(await app.dispatch(bytes));
    return { request, answer, from: 'the built app', steps, agreesWithSpec: answer === expected };
  }
  return { request, answer: expected, from: 'the spec (not built yet)', steps };
}
