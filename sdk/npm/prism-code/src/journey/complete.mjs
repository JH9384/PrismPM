/**
 * The draft form of `prism/spec/1`, and the step that completes it.
 *
 * A model's job is translation: it writes what the user said, which is a
 * `title`, the `fields`, the ordered `rules` and the `otherwise` answer.
 * Everything else a spec holds restates those or adds to them, so Prism derives
 * it here, the same way every time:
 *
 *   outcomes    the answers the rules and `otherwise` give, in first-appearance order
 *   purpose     one sentence built from the answers and the fields
 *   name        from the title, as the session derives it
 *   examples    the first request each rule decides, and one for `otherwise`
 *   properties  guarantees read off the rules, each marked as proposed
 *
 * It also reads the few slips that have one meaning, and names each in a note:
 * an `invalid` listed among the answers that nothing answers, a guarantee no
 * request can meet, and a number field compared with a bare word that names
 * another number field.
 *
 * A spec is a draft when it leaves out any of `purpose`, `outcomes`,
 * `properties` or `examples`. A stored spec holds all four (Prism writes them,
 * empty when there is nothing), so it is never completed again and a guarantee
 * the user struck does not come back. A draft is still `prism/spec/1`:
 * completing it gives an ordinary spec, and a spec that is already whole comes
 * back as `validateSpec` gives it.
 *
 * Pure: no clock, no randomness, no files. The same input gives the same spec,
 * and so the same canonical bytes and the same address.
 */
import { INVALID, PROPOSED, SpecError, counterexample, decodeRequest, describeConditions, describeProperty, describeRule, encodeRequest, holds, isProposed, judge, nameFromPurpose, respond, sampleRequests, sampleSize, unreachableRules, validateSpec } from './spec.mjs';
import { canonicalJson, checkMembers, parseStrictJson } from './spec-file.mjs';
import { STATEFUL_SCHEMA, statefulCounterexample } from './stateful.mjs';

export { PROPOSED, isProposed };

/** What a model need not write: Prism derives each when a draft leaves it out. */
export const DERIVED_MEMBERS = Object.freeze(['purpose', 'outcomes', 'properties', 'examples']);
/** A draft with fewer guarantees than this gets proposals, up to this many in all. */
export const GUARANTEES_WANTED = 3;
/** A draft with no examples gets at most this many. */
export const EXAMPLES_WANTED = 6;

const SAMPLE_LIMIT = 200000;

const refuse = (message, where, rule) => {
  throw new SpecError(message, where, rule);
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const listOf = (v) => (Array.isArray(v) ? v : []);
const words = (list, last) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} ${last} ${list.at(-1)}`);

/** Whether a spec is a draft: a `prism/spec/1` spec that leaves out something Prism derives. */
export const isDraft = (spec) => isObject(spec) && spec.schema !== STATEFUL_SCHEMA && DERIVED_MEMBERS.some((key) => spec[key] === undefined);

/** The purpose of a draft that states none: what it answers, and from what. Always text a model can carry. */
export function purposeFrom(outcomes, fields) {
  const long = `Decides ${words(outcomes, 'or')} from ${words(fields, 'and')}.`;
  return long.length <= 200 ? long : `Decides one of ${outcomes.length} answers from ${fields.length} fields.`;
}

/**
 * The name of a draft that states none: from the title when there is one, as
 * the session reads `Title: sentence` (session.mjs), else from the purpose.
 */
export const nameFrom = (title, purpose) => (typeof title === 'string' && title.trim() ? nameFromPurpose(`${title}:`) : nameFromPurpose(purpose));

/** A rule or guarantee as its author wrote it: without the id and the sentence Prism adds. */
function written(item, describe) {
  const { id, says, ...rest } = item;
  return says !== undefined && says !== describe(item) ? { ...rest, says } : rest;
}

const propertyKey = (p) => JSON.stringify([p.kind, p.then, p.when]);

/**
 * Whether trying every candidate request settles what a conjunction can meet.
 * The candidates are the edges of every comparison, so they reach every region
 * the constants cut out; a chain of three or more number fields compared with
 * each other can need three distinct values inside one region, which the edges
 * do not always hold. Such a guarantee is never called empty.
 */
function settledBySample(spec, conditions) {
  const compared = new Set();
  for (const c of conditions) {
    if (isObject(c.value)) {
      compared.add(c.field);
      compared.add(c.value.field);
    }
  }
  return compared.size <= 2 && sampleSize(spec) <= SAMPLE_LIMIT;
}

/**
 * Complete a spec. Takes JSON text or a value; returns
 * `{ spec, draft, proposed, notes }`:
 *
 * - `spec`: the whole, validated spec, the one to store and seal.
 * - `draft`: whether the input left out something Prism derives.
 * - `proposed`: the ids of the guarantees Prism proposed.
 * - `notes`: what Prism dropped or could not do, each a sentence to show.
 *
 * Throws `SpecError`, naming its rule, when the input is not a spec even so.
 * A spec whose own guarantee or example the rules break is completed without
 * proposals or examples: `checkSpec` says what is wrong with it.
 */
export function completeSpec(input) {
  const raw = typeof input === 'string' ? parseStrictJson(input) : structuredClone(input);
  if (isObject(raw) && raw.schema === STATEFUL_SCHEMA) {
    checkMembers(raw);
    return { spec: validateSpec(raw), draft: false, proposed: [], notes: [] };
  }
  // The same strict reading spec.json gets: no member the schema does not define, whole numbers only.
  checkMembers(raw);
  canonicalJson(raw);
  const draft = isDraft(raw);
  const notes = [];
  const work = { ...raw };

  // A number is never compared with text, so a bare word that names a number field, where a number
  // field is compared, has one meaning: that field. Measured with Qwen3 30B (#666), this was every
  // refusal of a rules-only draft, six runs of thirty. It is read as the field, and named.
  const numbers = new Set(listOf(work.fields).filter((f) => isObject(f) && f.kind === 'number' && typeof f.name === 'string').map((f) => f.name));
  // The comparison word has one meaning too: equality on a choice is `is`, and `is` on a number is `=`.
  // Answers given as text are already read this way (`condition` in spec.mjs). Measured with Qwen3 30B
  // on 2026-11-15: `=` and `==` on a choice refused two drafts of two, and `is not` on a number one of forty.
  const choices = new Map(listOf(work.fields).filter((f) => isObject(f) && f.kind === 'choice' && typeof f.name === 'string' && Array.isArray(f.values)).map((f) => [f.name, f.values]));
  const CHOICE_WORD = { '=': 'is', '==': 'is', '!=': 'is not' };
  const NUMBER_WORD = { is: '=', '==': '=', 'is not': '!=' };
  const readWord = (c) => {
    if (!isObject(c) || typeof c.op !== 'string') return c;
    const choice = choices.has(c.field) && choices.get(c.field).includes(c.value);
    const number = numbers.has(c.field) && (typeof c.value === 'number' || numbers.has(c.value) || (isObject(c.value) && numbers.has(c.value.field)));
    const word = choice ? CHOICE_WORD[c.op] : number ? NUMBER_WORD[c.op] : undefined;
    if (!word) return c;
    const value = isObject(c.value) ? c.value.field : c.value;
    notes.push(`Read \`${c.field} ${c.op} ${value}\` as \`${c.field} ${word} ${value}\`: ${choice ? 'a choice is compared with `is` or `is not`' : 'a number is compared with `=` or `!=`'}.`);
    return { ...c, op: word };
  };
  const readField = (item) => {
    if (!isObject(item) || !Array.isArray(item.when)) return item;
    const when = item.when.map(readWord).map((c) => {
      if (!isObject(c) || !numbers.has(c.field) || typeof c.value !== 'string' || !numbers.has(c.value)) return c;
      notes.push(`Read \`${c.field} ${c.op} "${c.value}"\` as a comparison with the field ${c.value}: a number is never compared with text.`);
      return { ...c, value: { field: c.value } };
    });
    return { ...item, when };
  };
  if (Array.isArray(work.rules)) work.rules = work.rules.map(readField);
  if (Array.isArray(work.properties)) work.properties = work.properties.map(readField);
  const rules = listOf(work.rules).filter(isObject);

  if (draft && listOf(work.outcomes).length === 0) {
    if (rules.length === 0) refuse('Give at least one rule.', 'rules', 'rules.none');
    if (typeof work.otherwise !== 'string' || !work.otherwise) refuse('Say which answer applies when no rule matches.', 'rules', 'rules.otherwise');
    const answers = [...new Set([...rules.map((r) => r.then), work.otherwise].filter((w) => typeof w === 'string'))];
    if (answers.includes(INVALID)) refuse('`invalid` is the answer Prism gives a malformed request; a rule or `otherwise` cannot answer it. Pick another word.', 'outcomes', 'outcomes.reserved');
    if (answers.length < 2) refuse(`Every rule and \`otherwise\` answer ${answers[0]}, so the app decides nothing. Give at least two answers.`, 'outcomes', 'outcomes.too-few');
    work.outcomes = answers;
  } else if (listOf(work.outcomes).includes(INVALID)) {
    // A model that lists `invalid` and never answers it meant the answer Prism already gives.
    const answered = [...rules, ...listOf(work.properties).filter(isObject)].some((x) => x.then === INVALID) || work.otherwise === INVALID;
    if (!answered) {
      work.outcomes = work.outcomes.filter((o) => o !== INVALID);
      notes.push('Dropped `invalid` from the answers: Prism already answers it for a malformed request, and no rule answers it.');
    }
  }
  if (draft && (work.purpose === undefined || work.purpose === null || work.purpose === '')) {
    work.purpose = purposeFrom(listOf(work.outcomes).map(String), listOf(work.fields).filter(isObject).map((f) => String(f.name)));
  }
  if (draft && !work.name) work.name = nameFrom(work.title, work.purpose);
  work.properties = listOf(work.properties);
  work.examples = listOf(work.examples);

  let spec = validateSpec(work);

  // A guarantee about requests that cannot happen (a weight below the least weight) says nothing,
  // and Lean would prove nothing by it. It is dropped and named, only when every request was tried.
  if (spec.properties.length && sampleSize(spec) <= SAMPLE_LIMIT) {
    const met = spec.properties.map(() => false);
    for (const request of sampleRequests(spec, SAMPLE_LIMIT)) spec.properties.forEach((p, i) => (met[i] ||= p.when.every((c) => holds(c, request))));
    const empty = spec.properties.filter((p, i) => !met[i] && settledBySample(spec, p.when));
    if (empty.length) {
      for (const p of empty) notes.push(`Dropped the guarantee "${p.kind} ${p.then} when ${describeConditions(p.when)}": no request meets its conditions, so it says nothing.`);
      work.properties = work.properties.filter((_, i) => !empty.includes(spec.properties[i]));
      spec = validateSpec(work);
    }
  }

  const sound = spec.properties.every((p) => counterexample(spec, p).request === null) && spec.examples.every((e) => respond(spec, new TextEncoder().encode(e.request)) === e.response);
  if (!draft || !sound) return { spec, draft, proposed: [], notes };

  // One pass over the candidate requests: what each rule decides, and what each choice is answered.
  const total = sampleSize(spec);
  const exhaustive = total <= SAMPLE_LIMIT;
  const reach = spec.rules.map(() => ({ met: false, overridden: false, first: null }));
  const index = new Map(spec.rules.map((r, i) => [r.id, i]));
  let firstOtherwise = null;
  const answered = new Map();
  // Past the limit nothing is proposed, so only the examples are read off the pass: the first request
  // each rule decides. It then stops once every rule and `otherwise` has one, and keeps no other count.
  let wanted = spec.rules.length + 1;
  for (const request of sampleRequests(spec, SAMPLE_LIMIT)) {
    const { outcome, rule } = judge(spec, request);
    if (rule === null) {
      if (firstOtherwise === null) wanted--;
      firstOtherwise ??= encodeRequest(spec, request);
    } else {
      if (reach[index.get(rule)].first === null) wanted--;
      reach[index.get(rule)].first ??= encodeRequest(spec, request);
    }
    if (!exhaustive) {
      if (wanted === 0) break;
      continue;
    }
    spec.rules.forEach((r, i) => {
      if (!r.when.every((c) => holds(c, request))) return;
      reach[i].met = true;
      if (rule !== r.id) reach[i].overridden = true;
    });
    for (const f of spec.fields) {
      if (f.kind !== 'choice') continue;
      const key = `${f.name} ${request[f.name]}`;
      if (!answered.has(key)) answered.set(key, new Set());
      answered.get(key).add(outcome);
    }
  }

  const proposals = [];
  if (spec.properties.length < GUARANTEES_WANTED) {
    if (!exhaustive) {
      notes.push(`No guarantee is proposed: the rules cut the requests into ${total} cases, more than the ${SAMPLE_LIMIT} Prism tries, so a proposal could not be checked against every one.`);
    } else {
      const candidates = [];
      spec.rules.forEach((r, i) => {
        if (reach[i].met && !reach[i].overridden) candidates.push({ kind: 'always', when: structuredClone(r.when), then: r.then, why: `${PROPOSED} from ${r.id}: no earlier rule overrides it.` });
      });
      for (const f of spec.fields) {
        if (f.kind !== 'choice') continue;
        for (const v of f.values) {
          const got = answered.get(`${f.name} ${v}`);
          for (const o of spec.outcomes) if (got && !got.has(o)) candidates.push({ kind: 'never', when: [{ field: f.name, op: 'is', value: v }], then: o, why: `${PROPOSED} from the rules: no request with ${f.name} ${v} is answered ${o}.` });
        }
      }
      const have = new Set(spec.properties.map(propertyKey));
      for (const candidate of candidates) {
        if (spec.properties.length + proposals.length >= GUARANTEES_WANTED) break;
        if (have.has(propertyKey(candidate))) continue;
        const trial = validateSpec({ ...work, properties: [...work.properties, ...proposals, candidate] });
        if (counterexample(trial, trial.properties.at(-1)).request !== null) continue;
        have.add(propertyKey(candidate));
        proposals.push(candidate);
      }
    }
  }
  if (proposals.length) work.properties = [...work.properties, ...proposals];

  if (spec.examples.length === 0) {
    const decided = spec.rules.map((r, i) => (reach[i].first === null ? null : { request: reach[i].first, response: r.then })).filter(Boolean);
    const last = firstOtherwise === null ? [] : [{ request: firstOtherwise, response: spec.otherwise }];
    work.examples = [...decided.slice(0, EXAMPLES_WANTED - last.length), ...last];
  }

  spec = validateSpec(work);
  return { spec, draft, proposed: spec.properties.filter(isProposed).map((p) => p.id), notes };
}

/**
 * Check a spec as the journey does, in one call: complete it, then look for a
 * guarantee the rules break and an example they answer differently. Returns
 *
 *   { ok, spec, draft, proposed, notes, refusal, broken, examples }
 *
 * - `refusal`: `{ rule, where, message }` when the input is not a spec, else null.
 * - `broken`: for each guarantee the rules break, the guarantee and the rule
 *   that decides against it as their author wrote them, with the request that
 *   shows the conflict and what it answers (`rule` is null when `otherwise` decided).
 * - `examples`: for each example the rules answer differently, the example and
 *   what the rules answer.
 *
 * `repairMessage` turns a result that is not ok into what to tell the author.
 */
export function checkSpec(input) {
  let done;
  try {
    done = completeSpec(input);
  } catch (error) {
    if (!(error instanceof SpecError)) throw error;
    return { ok: false, spec: null, draft: false, proposed: [], notes: [], refusal: { rule: error.rule ?? null, where: error.where ?? null, message: error.message }, broken: [], examples: [] };
  }
  const { spec } = done;
  const notes = [...done.notes];
  const broken = [];
  const examples = [];
  if (spec.schema === STATEFUL_SCHEMA) {
    for (const p of spec.properties) {
      const found = statefulCounterexample(spec, p);
      if (found.steps !== null) broken.push({ id: p.id, guarantee: written(p, () => undefined), steps: found.steps, request: found.steps.join(';'), answer: found.outcome ?? null, state: found.state ?? null, rule: null });
    }
    return { ok: broken.length === 0, ...done, notes, refusal: null, broken, examples };
  }
  for (const p of spec.properties) {
    const found = counterexample(spec, p);
    if (found.request === null) continue;
    const rule = found.rule ? spec.rules.find((r) => r.id === found.rule) : null;
    broken.push({ id: p.id, guarantee: written(p, describeProperty), request: found.request, answer: found.outcome, ruleId: found.rule, rule: rule ? written(rule, describeRule) : null });
  }
  for (const e of spec.examples) {
    const answer = respond(spec, new TextEncoder().encode(e.request));
    if (answer === e.response) continue;
    const request = decodeRequest(spec, e.request);
    examples.push({ example: e, answer, ruleId: request ? judge(spec, request).rule : null, malformed: !request });
  }
  const dead = unreachableRules(validateSpec({ ...spec, properties: [], examples: [] }));
  if (dead.length) notes.push(`${dead.join(', ')} never decides anything: an earlier rule always matches first, or its conditions cannot all hold.`);
  return { ok: broken.length === 0 && examples.length === 0, ...done, notes, refusal: null, broken, examples };
}

/**
 * What to tell the author of a spec the checker refused, or null when it was
 * accepted. A broken guarantee is named as the JSON its author wrote, beside
 * the rule that decides against it and the request that shows the conflict,
 * with the two ways out: a message that only says a guarantee "does not hold"
 * was measured to be written back unchanged. Any other refusal is given in the
 * checker's own words.
 */
export function repairMessage(result) {
  if (!result || result.ok) return null;
  const again = 'Then write the whole spec again with nothing else changed.';
  if (result.refusal) {
    const where = result.refusal.where ? ` (at ${result.refusal.where})` : '';
    return `Prism checked the spec and refused it:\n- ${result.refusal.message}${where}\nFix exactly that. ${again}`;
  }
  const lines = [];
  for (const b of result.broken.slice(0, 6)) {
    const by = b.steps
      ? `the session \`${b.request}\` ${b.answer ? `ends answering ${b.answer}` : `reaches the state ${b.state}`}`
      : `the request \`${b.request}\` answers ${b.answer}, ${b.rule ? `by the rule ${JSON.stringify(b.rule)}` : `because no rule matches and \`otherwise\` is ${b.answer}`}`;
    lines.push(`- The guarantee ${JSON.stringify(b.guarantee)} is false: ${by}.`);
  }
  for (const e of result.examples.slice(0, 6)) {
    lines.push(`- The example ${JSON.stringify(e.example)} is wrong: ${e.malformed ? 'it is not a request (the fields in order, separated by single spaces), so the answer is invalid' : `the rules answer ${e.answer}`}.`);
  }
  const how = [];
  if (result.broken.length) how.push('For each false guarantee, fix it in one of two ways: delete that guarantee from "properties", or change the rules so that request gets the answer the guarantee names.');
  if (result.examples.length) how.push('For each wrong example, delete it from "examples" or give it the answer the rules give.');
  return `Prism checked the spec and refused it:\n${lines.join('\n')}\n${how.join(' ')} ${again}`;
}
