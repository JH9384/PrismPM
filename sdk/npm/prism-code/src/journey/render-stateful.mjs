/**
 * Render a `prism/spec/2` spec (stateful.mjs) into the LexLean model of a text
 * application that keeps state, its proofs, its acceptance vectors and SPEC.md.
 *
 * The model is a state machine: a `State` structure of `Nat` values (a choice
 * is its code), `initial`, and for each action two total functions of the
 * state and the action's inputs, `after<Action>` (the next state, each field
 * its own `if` chain) and `reply<Action>` (the answer's code, one `if`
 * chain), over the same rule guards: a rule's conditions, and that each of
 * its changes keeps its number within bounds. Every guard is a `Nat` comparison, so each property
 * is proved by `linear_arithmetic`, as for prism/spec/1.
 *
 * The text profile answers one request with one response and keeps nothing,
 * so a session is one request: its steps separated by `;`, replayed from
 * `initial` by the guest. The answer is the last step's outcome and the state
 * it leaves. Every state the guest computes is reachable, so what Lean proves
 * of reachable states holds of every answer. The state machine does not
 * depend on that projection: the session world (`hologram:guest/core-wasm@2`,
 * #629, with its profile in #630) can run the same `after` and `reply` one
 * step at a time, and the spec and its seal stay the same.
 *
 * Nothing here reads anything but the spec, so the same spec gives the same
 * bytes.
 */
import { INVALID, MAX_DIGITS } from './spec.mjs';
import { LEAN_RESERVED, QP, camel, conjunction, describedBy, hex, moduleName, moduleText, pascal, quote, stem, withAxioms } from './render.mjs';
import {
  SESSION_BYTES,
  act,
  encodeStep,
  holdsIn,
  initialState,
  inputCandidates,
  reachableStates,
  respondSession,
  sessionLimits,
} from './stateful.mjs';

const FIXED = [
  'State', 'Turn', 'Move', 'byteAt', 'digitsValue', 'parseDigits', 'parseNumber', 'sliceOf', 'tokenEnd', 'moveAt', 'decodeStep', 'applyMove', 'replay',
  'initial', 'digitByte', 'decimalOf', 'encodeAnswer', 'stateText', 'dispatch', 'application', 'startInBounds', 'breaksStartInBounds',
  'turnState', 'turnAnswer', 'moveAction', 'moveNext', 'moveMore',
];

/** Every identifier the model and its proofs use, derived once so the model, the vectors and SPEC.md agree. */
export function statefulNames(spec) {
  const used = new Set(FIXED);
  const claim = (base) => {
    let name = base;
    for (let i = 2; used.has(name) || LEAN_RESERVED.has(name); i++) name = `${base}${i}`;
    used.add(name);
    return name;
  };
  const module = moduleName(spec);
  const width = Math.max(0, ...spec.actions.map((a) => a.inputs.length));
  const args = Array.from({ length: width }, (_, i) => claim(`moveArg${i + 1}`));
  const state = {};
  for (const f of spec.state) {
    const id = claim(camel(f.name));
    state[f.name] = { id, choices: {} };
    if (f.kind === 'choice') for (const v of f.values) state[f.name].choices[v] = claim(`${id}${pascal(v)}`);
  }
  const answers = {};
  for (const o of spec.outcomes) answers[o] = claim(`answer${pascal(o)}`);
  const actions = {};
  for (const [ai, a] of spec.actions.entries()) {
    const P = pascal(a.name);
    const inputs = {};
    for (const f of a.inputs) {
      const id = claim(camel(`${a.name}-${f.name}`));
      const bounded = f.kind === 'choice' || f.min !== undefined || f.max !== undefined;
      inputs[f.name] = { id, parse: bounded ? claim(`parse${P}${pascal(f.name)}`) : 'parseNumber', choices: {} };
      if (f.kind === 'choice') for (const v of f.values) inputs[f.name].choices[v] = claim(`${id}${pascal(v)}`);
    }
    actions[a.name] = {
      code: ai + 1,
      after: claim(`after${P}`),
      reply: claim(`reply${P}`),
      decode: a.inputs.map((_, j) => claim(`decode${P}${j + 1}`)),
      keepsBounds: claim(`${camel(a.name)}KeepsBounds`),
      inputs,
    };
  }
  const properties = {};
  for (const p of spec.properties) {
    const s = p.id.toLowerCase().replace(/[^a-z0-9]/g, '');
    properties[p.id] = p.action
      ? { theorems: [claim(`${s}Holds`)] }
      : { theorems: [claim(`${s}AtStart`), ...spec.actions.map((a) => claim(`${s}KeptBy${pascal(a.name)}`))] };
  }
  return { module, proofs: `${module}Proofs`, prefix: `Prism${module}`, args, state, answers, actions, properties, stateful: true };
}

/**
 * The axioms each theorem is expected to rest on, as Lean observed them for the dinner-seats
 * example: a bounds theorem, over every field of the state, uses all three standard axioms; a
 * property theorem uses two. A verify that observes another set still rewrites it (engine.mjs),
 * and anything outside these three is refused.
 */
const BOUNDS_AXIOMS = '[Classical.choice, Quot.sound, propext]';

const NONE = (t) => `(ctor Option.none [${t}])`;
const SOME = (t, v) => `(ctor Option.some [${t}] ${v})`;
const LEN = (s) => `(Foundation.Bytes::byteLength ${s})`;
const SPACE = 32;
const SEMICOLON = 59;

/**
 * A condition as a `Bool` term. `subject(field)` is the expression a name
 * stands for (a state value or an input), and `constant(field, value)` the
 * code of a choice.
 */
function condition(c, subject, constant) {
  const left = subject(c.field);
  if (c.op === 'is') return `(${left} =? (${constant(c.field, c.value)}))`;
  if (c.op === 'is not') return `(not (${left} =? (${constant(c.field, c.value)})))`;
  const right = typeof c.value === 'object' ? subject(c.value.field) : String(c.value);
  switch (c.op) {
    case '<': return `(${left} <? ${right})`;
    case '<=': return `(${left} <=? ${right})`;
    case '>': return `(${right} <? ${left})`;
    case '>=': return `(${right} <=? ${left})`;
    case '=': return `(${left} =? ${right})`;
    case '!=': return `(not (${left} =? ${right}))`;
    default: throw new Error(`unknown op ${c.op}`);
  }
}

/** The guard that a change keeps its number within bounds; null when it always does. */
function changeGuard(spec, c, subject) {
  const f = spec.state.find((x) => x.name === c.field);
  if (f.kind === 'choice' || (c.op === 'set' && typeof c.value === 'number')) return null;
  const v = typeof c.value === 'object' ? subject(c.value.field) : String(c.value);
  const old = subject(c.field);
  const min = f.min ?? 0;
  if (c.op === 'set') return conjunction([...(min > 0 ? [`(${min} <=? ${v})`] : []), `(${v} <=? ${f.max})`]);
  if (c.op === 'add') return `((${old} + ${v}) <=? ${f.max})`;
  return min > 0 ? `((${v} + ${min}) <=? ${old})` : `(${v} <=? ${old})`;
}

/** The value a state field takes after a rule. */
function changed(spec, rule, field, subject, constant) {
  const c = rule.change.find((x) => x.field === field.name);
  if (!c) return subject(field.name);
  if (field.kind === 'choice') return `(${constant(field.name, c.value)})`;
  const v = typeof c.value === 'object' ? subject(c.value.field) : String(c.value);
  if (c.op === 'set') return v;
  if (c.op === 'add') return `(${subject(field.name)} + ${v})`;
  return `(prim subtract ${subject(field.name)} ${v} : Nat)`;
}

const ruleGuard = (spec, rule, subject, constant) =>
  conjunction([...rule.when.map((c) => condition(c, subject, constant)), ...rule.change.map((c) => changeGuard(spec, c, subject)).filter(Boolean)]) || 'true';

/** Subjects and constants inside the app module: `state` is the parameter, inputs are named parameters. */
function scope(spec, n, action, { state = 'state', q = (x) => x } = {}) {
  const inputs = action ? n.actions[action.name].inputs : {};
  const subject = (field) => (n.state[field] ? `(project ${state} ${n.state[field].id})` : inputs[field].id);
  const constant = (field, value) => q(n.state[field] ? n.state[field].choices[value] : inputs[field].choices[value]);
  return { subject, constant };
}

/** The model's declarations, in order. */
export function statefulDeclarations(spec, n = statefulNames(spec), { specAddress = null } = {}) {
  const out = [];
  const def = (name, parameters, result, body, axioms = null, recursive = null) => out.push({ name, kind: 'definition', parameters, result, body, axioms, ...(recursive ? { recursive } : {}) });
  const width = n.args.length;

  for (const f of spec.state) if (f.kind === 'choice') f.values.forEach((v, i) => def(n.state[f.name].choices[v], [], 'Nat', String(i)));
  for (const a of spec.actions) for (const f of a.inputs) if (f.kind === 'choice') f.values.forEach((v, i) => def(n.actions[a.name].inputs[f.name].choices[v], [], 'Nat', String(i)));
  spec.outcomes.forEach((o, i) => def(n.answers[o], [], 'Nat', String(i)));

  out.push({ name: 'State', kind: 'structure', fields: spec.state.map((f) => `{name: ${n.state[f.name].id}, type: Nat}`) });
  out.push({ name: 'Turn', kind: 'structure', fields: ['{name: turnState, type: State}', '{name: turnAnswer, type: Nat}'] });
  out.push({ name: 'Move', kind: 'structure', fields: ['{name: moveAction, type: Nat}', '{name: moveNext, type: Nat}', '{name: moveMore, type: Nat}', ...n.args.map((x) => `{name: ${x}, type: Nat}`)] });

  def('initial', [], 'State', `(record State {${spec.state.map((f) => `${n.state[f.name].id} := ${f.kind === 'choice' ? `(${n.state[f.name].choices[f.start]})` : String(f.start)}`).join(', ')}})`);

  // The actions: one `if` chain of rule guards for the next state, and the same chain for the answer.
  for (const a of spec.actions) {
    const names = n.actions[a.name];
    const { subject, constant } = scope(spec, n, a);
    const params = ['state : State', ...a.inputs.map((f) => `${names.inputs[f.name].id} : Nat`)];
    // One record whose every field is an `if` chain, never an `if` of records: the proof form
    // simplifies before it splits, so a projection of a record inside an `if` would stay opaque.
    // A field's chain runs to the last rule that changes it; an earlier rule that leaves it keeps it.
    const valueAfter = (f) => {
      const last = a.rules.findLastIndex((r) => r.change.some((c) => c.field === f.name));
      return a.rules.slice(0, last + 1).reduceRight((rest, r) => `(if ${ruleGuard(spec, r, subject, constant)} then ${changed(spec, r, f, subject, constant)} else ${rest})`, subject(f.name));
    };
    def(names.after, params, 'State', `(record State {${spec.state.map((f) => `${n.state[f.name].id} := ${valueAfter(f)}`).join(', ')}})`);
    def(names.reply, params, 'Nat', a.rules.reduceRight((rest, r) => `(if ${ruleGuard(spec, r, subject, constant)} then (${n.answers[r.then]}) else ${rest})`, `(${n.answers[a.otherwise]})`));
  }

  // Reading a session: bytes, never text, as prism/spec/1 reads a request (render.mjs).
  def('byteAt', ['s : Bytes', 'i : Nat'], '(Option Nat)', `(match (prim index s i : (Option UInt8))
    | Option.none => ${NONE('Nat')}
    | Option.some b => ${SOME('Nat', '(prim to_nat b : Nat)')})`, QP);
  def('digitsValue', ['s : Bytes', 'i : Nat', 'acc : Nat', 'fuel : Nat'], '(Option Nat)', `(match fuel
    | Nat.zero => ${SOME('Nat', 'acc')}
    | Nat.succ rest => (match (byteAt s i)
      | Option.none => ${NONE('Nat')}
      | Option.some d => (if ((d <? 48) || (57 <? d)) then ${NONE('Nat')} else (digitsValue s (i + 1) ((prim multiply acc 10 : Nat) + (prim subtract d 48 : Nat)) rest))))`, QP, 'fuel');
  def('parseDigits', ['s : Bytes'], '(Option Nat)', `(if (${LEN('s')} =? 0) then ${NONE('Nat')} else (if (${MAX_DIGITS} <? ${LEN('s')}) then ${NONE('Nat')} else (match (byteAt s 0)
    | Option.none => ${NONE('Nat')}
    | Option.some lead => (if ((lead =? 48) && (1 <? ${LEN('s')})) then ${NONE('Nat')} else (digitsValue s 0 0 ${LEN('s')})))))`, QP);
  def('parseNumber', ['value : Bytes'], '(Option Nat)', '(parseDigits value)', QP);
  for (const a of spec.actions) {
    for (const f of a.inputs) {
      const input = n.actions[a.name].inputs[f.name];
      if (f.kind === 'choice') {
        def(input.parse, ['value : Bytes'], '(Option Nat)', f.values.reduceRight((rest, v) => `(if (prim equal value ${hex(v)} : Bool) then ${SOME('Nat', `(${input.choices[v]})`)} else ${rest})`, NONE('Nat')));
      } else if (input.parse !== 'parseNumber') {
        let accept = SOME('Nat', 'parsed');
        if (f.max !== undefined) accept = `(if (${f.max} <? parsed) then ${NONE('Nat')} else ${accept})`;
        if (f.min !== undefined && f.min > 0) accept = `(if (parsed <? ${f.min}) then ${NONE('Nat')} else ${accept})`;
        def(input.parse, ['value : Bytes'], '(Option Nat)', `(match (parseNumber value)\n    | Option.none => ${NONE('Nat')}\n    | Option.some parsed => ${accept})`, QP);
      }
    }
  }
  def('sliceOf', ['s : Bytes', 'start : Nat', 'count : Nat'], 'Bytes', `(match (prim slice s start count : (Option Bytes))\n    | Option.none => 0x\n    | Option.some part => part)`);
  // Where a token ends: the next space or `;`, or the end of the session.
  def('tokenEnd', ['s : Bytes', 'i : Nat', 'fuel : Nat'], 'Nat', `(match fuel
    | Nat.zero => i
    | Nat.succ rest => (match (byteAt s i)
      | Option.none => i
      | Option.some d => (if ((d =? ${SPACE}) || (d =? ${SEMICOLON})) then i else (tokenEnd s (i + 1) rest))))`, QP, 'fuel');
  // A step ends at the end of the session, or at a `;` with another step after it.
  const argParams = n.args.map((x) => `${x} : Nat`);
  const move = (more, next) => SOME('Move', `(record Move {moveAction := action, moveNext := ${next}, moveMore := ${more}${n.args.map((x) => `, ${x} := ${x}`).join('')}})`);
  def('moveAt', ['s : Bytes', 'e : Nat', 'action : Nat', ...argParams], '(Option Move)', `(if (e =? ${LEN('s')}) then ${move(0, 'e')} else (match (byteAt s e)
    | Option.none => ${NONE('Move')}
    | Option.some d => (if ((d =? ${SEMICOLON}) && ((e + 1) <? ${LEN('s')})) then ${move(1, '(e + 1)')} else ${NONE('Move')})))`, QP);
  // One decoder per input of each action, as prism/spec/1 decodes fields: a space, the token, then the next.
  for (const a of spec.actions) {
    const names = n.actions[a.name];
    const k = a.inputs.length;
    const vs = (j) => Array.from({ length: j }, (_, i) => `v${i + 1}`);
    const finish = (values) => `(moveAt s e ${names.code}${Array.from({ length: width }, (_, i) => ` ${values[i] ?? '0'}`).join('')})`;
    for (let j = k; j >= 1; j--) {
      const input = names.inputs[a.inputs[j - 1].name];
      const next = j === k ? finish(vs(k)) : `(${names.decode[j]} s e ${vs(j).join(' ')})`;
      def(names.decode[j - 1], ['s : Bytes', 'at : Nat', ...vs(j - 1).map((v) => `${v} : Nat`)], '(Option Move)', `(match (byteAt s at)
    | Option.none => ${NONE('Move')}
    | Option.some d => (if (d =? ${SPACE}) then (let e : Nat := (tokenEnd s (at + 1) ${LEN('s')}); (match (${input.parse} (sliceOf s (at + 1) (prim subtract e (at + 1) : Nat)))
      | Option.none => ${NONE('Move')}
      | Option.some v${j} => ${next})) else ${NONE('Move')}))`, QP);
    }
  }
  const byWord = spec.actions.reduceRight((rest, a) => {
    const names = n.actions[a.name];
    const go = a.inputs.length ? `(${names.decode[0]} s e)` : `(moveAt s e ${names.code}${' 0'.repeat(width)})`;
    return `(if (prim equal word ${hex(a.name)} : Bool) then ${go} else ${rest})`;
  }, NONE('Move'));
  def('decodeStep', ['s : Bytes', 'i : Nat'], '(Option Move)', `(let e : Nat := (tokenEnd s i ${LEN('s')}); (let word : Bytes := (sliceOf s i (prim subtract e i : Nat)); ${byWord}))`, QP);
  const applied = spec.actions.reduceRight((rest, a) => {
    const names = n.actions[a.name];
    const call = (fn) => `(${fn} state${a.inputs.map((_, i) => ` (project m ${n.args[i]})`).join('')})`;
    return `(if ((project m moveAction) =? ${names.code}) then (record Turn {turnState := ${call(names.after)}, turnAnswer := ${call(names.reply)}}) else ${rest})`;
  }, '(record Turn {turnState := state, turnAnswer := 0})');
  def('applyMove', ['state : State', 'm : Move'], 'Turn', applied);
  def('replay', ['s : Bytes', 'i : Nat', 'state : State', 'fuel : Nat'], '(Option Turn)', `(match fuel
    | Nat.zero => ${NONE('Turn')}
    | Nat.succ rest => (match (decodeStep s i)
      | Option.none => ${NONE('Turn')}
      | Option.some m => (if ((project m moveMore) =? 0) then ${SOME('Turn', '(applyMove state m)')} else (replay s (project m moveNext) (project (applyMove state m) turnState) rest))))`, QP, 'fuel');

  // The answer: the outcome, then each state value as ` name=value`.
  def('digitByte', ['d : Nat'], 'Bytes', Array.from({ length: 9 }, (_, i) => i).reduceRight((rest, i) => `(if (d =? ${i}) then ${hex(String(i))} else ${rest})`, hex('9')));
  def('decimalOf', ['value : Nat', 'fuel : Nat'], 'Bytes', `(match fuel
    | Nat.zero => 0x
    | Nat.succ rest => (if (value <? 10) then (digitByte value) else (prim append (decimalOf (prim quotient value 10 0 : Nat) rest) (digitByte (prim remainder value 10 0 : Nat)) : Bytes)))`, null, 'fuel');
  def('encodeAnswer', ['code : Nat'], 'Bytes', spec.outcomes.reduceRight((rest, o) => `(if (code =? (${n.answers[o]})) then ${hex(o)} else ${rest})`, hex(INVALID)));
  const valueText = (f) => {
    const subject = `(project state ${n.state[f.name].id})`;
    if (f.kind === 'number') return `(decimalOf ${subject} ${MAX_DIGITS + 1})`;
    return f.values.reduceRight((rest, v) => `(if (${subject} =? (${n.state[f.name].choices[v]})) then ${hex(v)} else ${rest})`, '0x');
  };
  def('stateText', ['state : State'], 'Bytes', spec.state.reduce((acc, f) => `(prim append ${acc} (prim append ${hex(` ${f.name}=`)} ${valueText(f)} : Bytes) : Bytes)`, '0x'));

  const limits = sessionLimits(spec);
  def('dispatch', ['value : Bytes'], 'Bytes', `(if (${limits.requestMaximum} <? ${LEN('value')}) then ${hex(INVALID)} else (match (replay value 0 (initial) ${LEN('value')})
    | Option.none => ${hex(INVALID)}
    | Option.some turn => (prim append (encodeAnswer (project turn turnAnswer)) (stateText (project turn turnState)) : Bytes)))`, QP);

  const vectors = statefulAcceptanceVectors(spec);
  const root = `${n.prefix}.${n.module}.dispatch`;
  const AV = 'Foundation.View.Text.V1.Model::AcceptanceVector';
  const vectorList = vectors.reduceRight((rest, v) => `(cons (record ${AV} {request := ${hex(v.bytes)}, response := ${hex(v.response)}}) ${rest})`, `(nil ${AV})`);
  const view = `(record Foundation.View.Text.V1.Model::TextView {title := ${quote(spec.title)}, heading := ${quote(spec.title)}, inputLabel := ${quote('Session: steps separated by ;')}, submitLabel := "Run", outputLabel := "Answer and state", inputError := "Invalid session", responseError := "Invalid response"})`;
  def(
    'application',
    [],
    'Foundation.View.Text.V1.Model::TextApplication',
    `(record Foundation.View.Text.V1.Model::TextApplication {profile := "prismpm/text-application/1", name := ${quote(stem(spec.title))}, cargoName := ${quote(`prism-${spec.name}`)}, cargoVersion := "0.1.0", cargoDescription := ${quote(describedBy(spec, specAddress))}, cargoRepository := "https://github.com/UOR-Foundation/PrismPM", cargoHomepage := "https://github.com/UOR-Foundation/PrismPM", libraryRoots := (cons ${quote(root)} (nil String)), acceptanceVectors := ${vectorList}, entryRoot := ${quote(root)}, coreContract := "hologram:guest/core-wasm@1", requestMaximum := (${limits.requestMaximum} : UInt32), responseMaximum := (${limits.responseMaximum} : UInt32), guestAllocationMaximum := (${limits.guestAllocationMaximum} : UInt32), capabilitiesEmpty := true, fatArchive := true, primaryLayer := (0 : UInt8), viewLayer := (1 : UInt8), view := ${view}})`,
  );
  return out;
}

/** The state's bounds as `Bool` terms over `subject`. */
const stateBounds = (spec, subject) =>
  spec.state.flatMap((f) => (f.kind === 'choice' ? [`(${subject(f.name)} <? ${f.values.length})`] : [...((f.min ?? 0) > 0 ? [`(${f.min} <=? ${subject(f.name)})`] : []), `(${subject(f.name)} <=? ${f.max})`]));
/** The bounds a decoded input satisfies. */
const inputBounds = (action, subject) =>
  action.inputs.flatMap((f) => (f.kind === 'choice' ? [`(${subject(f.name)} <? ${f.values.length})`] : [...((f.min ?? 0) > 0 ? [`(${f.min} <=? ${subject(f.name)})`] : []), ...(f.max !== undefined ? [`(${subject(f.name)} <=? ${f.max})`] : [])]));
/** A state property as one `Bool` term: `always` is its conditions, `never` their negation. */
const invariant = (p, subject, constant) => {
  const all = conjunction(p.when.map((c) => condition(c, subject, constant)));
  return p.kind === 'always' ? all : `(not ${all})`;
};

/**
 * The proofs module. Each state property is proved by induction over the
 * steps of a session, as two kinds of theorem: it holds at the start, and
 * every action keeps it, from any state within bounds where every state
 * property holds. Every action keeps the bounds, and the start is within
 * them. Each action property is proved for every such state, so for every
 * reachable one. Lean checks each theorem; that the theorems together cover
 * every reachable state is the induction, stated here and in SPEC.md.
 */
export function statefulProofDeclarations(spec, n = statefulNames(spec)) {
  const out = [];
  const q = (name) => `${n.module}::${name}`;
  const constants = [...Object.values(n.answers), ...Object.values(n.state).flatMap((f) => Object.values(f.choices)), ...Object.values(n.actions).flatMap((a) => Object.values(a.inputs).flatMap((f) => Object.values(f.choices)))];
  const invariants = spec.properties.filter((p) => !p.action);
  const theorem = (name, parameters, body, uses, axioms = QP) => {
    const breaks = `breaks${pascal(name)}`;
    out.push({ name: breaks, kind: 'definition', parameters, result: 'Bool', body, axioms: null });
    const args = parameters.map((p) => p.split(' : ')[0]).join(' ');
    out.push({ name, kind: 'theorem', parameters, statement: `((${breaks}${args ? ` ${args}` : ''}) = false)`, unfold: [...new Set([breaks, ...uses.map(q), ...constants.map(q)])].sort(), axioms });
  };
  const atStart = scope(spec, n, null, { state: `(${q('initial')})`, q });
  theorem('startInBounds', [], `(not ${conjunction(stateBounds(spec, atStart.subject))})`, ['initial'], BOUNDS_AXIOMS);
  for (const p of invariants) theorem(n.properties[p.id].theorems[0], [], `(not ${invariant(p, atStart.subject, atStart.constant)})`, ['initial']);
  for (const a of spec.actions) {
    const names = n.actions[a.name];
    const params = [`state : ${q('State')}`, ...a.inputs.map((f) => `${names.inputs[f.name].id} : Nat`)];
    const call = `(${q(names.after)} state${a.inputs.map((f) => ` ${names.inputs[f.name].id}`).join('')})`;
    const before = scope(spec, n, a, { q });
    const after = scope(spec, n, a, { state: call, q });
    const hypotheses = [...stateBounds(spec, before.subject), ...inputBounds(a, before.subject)];
    theorem(names.keepsBounds, params, conjunction([...hypotheses, `(not ${conjunction(stateBounds(spec, after.subject))})`]), [names.after], BOUNDS_AXIOMS);
    const held = invariants.map((p) => invariant(p, before.subject, before.constant));
    for (const p of invariants) {
      theorem(n.properties[p.id].theorems[1 + spec.actions.indexOf(a)], params, conjunction([...hypotheses, ...held, `(not ${invariant(p, after.subject, after.constant)})`]), [names.after]);
    }
    for (const p of spec.properties.filter((x) => x.action === a.name)) {
      const answer = `((${q(names.reply)} state${a.inputs.map((f) => ` ${names.inputs[f.name].id}`).join('')}) =? (${q(n.answers[p.then])}))`;
      theorem(n.properties[p.id].theorems[0], params, conjunction([...hypotheses, ...held, ...p.when.map((c) => condition(c, before.subject, before.constant)), p.kind === 'never' ? answer : `(not ${answer})`]), [names.reply]);
    }
  }
  return out;
}

/** The app module. */
export function renderStatefulModel(spec, { axioms = {}, specAddress = null } = {}) {
  const n = statefulNames(spec);
  return moduleText(n.module, ['Foundation.Bytes', 'Foundation.View.Text.V1.Model'], withAxioms(statefulDeclarations(spec, n, { specAddress }), axioms));
}

/** The proofs module. Never null: the bounds are always proved, stated properties or not. */
export function renderStatefulProofs(spec, { axioms = {} } = {}) {
  const n = statefulNames(spec);
  return moduleText(n.proofs, [n.module], withAxioms(statefulProofDeclarations(spec, n), axioms));
}

/**
 * The acceptance vectors: every prefix of every example session, one session
 * per distinct way the rules decide from the reachable states sampled, and
 * the malformed sessions every app must refuse, each answered by the
 * evaluator. One vector is exactly the guest allocation bound long.
 */
export function statefulAcceptanceVectors(spec) {
  const enc = (s) => new TextEncoder().encode(s);
  const out = [];
  const seen = new Set();
  const add = (bytes, why) => {
    const key = Buffer.from(bytes).toString('hex');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ bytes, request: new TextDecoder().decode(bytes), response: respondSession(spec, bytes), why });
  };
  const session = (steps) => steps.join(';');
  for (const e of spec.examples) for (let i = 1; i <= e.steps.length; i++) if (session(e.steps.slice(0, i)).length <= SESSION_BYTES) add(enc(session(e.steps.slice(0, i))), 'example');

  const conds = [...spec.actions.flatMap((a) => a.rules.flatMap((r) => r.when)), ...spec.properties.flatMap((p) => p.when)];
  const shapes = new Set();
  let decided = 0;
  for (const { state, steps } of reachableStates(spec, 400)) {
    for (const a of spec.actions) {
      for (const inputs of inputCandidates(spec, a)) {
        const r = act(spec, state, a, inputs);
        const env = { ...state, ...inputs };
        const shape = `${a.name}|${r.rule}|${conds.map((c) => (env[c.field] === undefined || (typeof c.value === 'object' && env[c.value.field] === undefined) ? '-' : holdsIn(c, env) ? 1 : 0)).join('')}`;
        if (shapes.has(shape)) continue;
        shapes.add(shape);
        const text = session([...steps, encodeStep(a, inputs)]);
        if (text.length > SESSION_BYTES) continue;
        add(enc(text), r.rule ? `decided by ${r.rule}` : `${a.name} otherwise`);
        if (++decided >= 32) break;
      }
      if (decided >= 32) break;
    }
    if (decided >= 32) break;
  }

  const { requestMaximum, guestAllocationMaximum } = sessionLimits(spec);
  const first = spec.actions[0];
  const valid = encodeStep(first, inputCandidates(spec, first)[0] ?? {});
  add(enc(''), 'empty session');
  add(Uint8Array.of(0xff), 'not UTF-8');
  add(enc('unknown'), 'not an action');
  add(enc(`${valid};`), 'a trailing semicolon');
  add(enc(`${valid};;${valid}`), 'an empty step');
  add(enc(` ${valid}`), 'a leading space');
  add(enc(`${valid} extra`), 'an extra input');
  for (const a of spec.actions) {
    const parts = encodeStep(a, inputCandidates(spec, a)[0] ?? {}).split(' ');
    if (parts.length > 1) {
      add(enc(parts.slice(0, -1).join(' ')), `${a.name} with an input missing`);
      add(enc(parts.join('  ')), `${a.name} with two spaces`);
    }
    a.inputs.forEach((f, i) => {
      const with_ = (v) => enc(parts.map((p, j) => (j === i + 1 ? v : p)).join(' '));
      if (f.kind === 'choice') add(with_('unknown'), `${a.name} ${f.name} not a choice`);
      else {
        add(with_('07'), `${a.name} ${f.name} with a leading zero`);
        add(with_('-1'), `${a.name} ${f.name} negative`);
        add(with_('1'.padEnd(19, '0')), `${a.name} ${f.name} with 19 digits`);
        add(with_('x'), `${a.name} ${f.name} not a number`);
        if (f.min !== undefined && f.min > 0) add(with_(String(f.min - 1)), `${a.name} ${f.name} below its minimum`);
        if (f.max !== undefined) add(with_(String(f.max + 1)), `${a.name} ${f.name} above its maximum`);
      }
    });
  }
  add(enc('x'.repeat(requestMaximum)), 'exactly the request bound');
  add(enc('x'.repeat(requestMaximum + 1)), 'one byte over the request bound');
  add(enc('x'.repeat(guestAllocationMaximum)), 'exactly the guest allocation bound');
  return out;
}

/** SPEC.md for a stateful app, in the OpenSpec format, each requirement marked proved or tested. */
export function renderStatefulSpecDocument(spec, status = {}) {
  const n = statefulNames(spec);
  const badge = (id) => ({ proved: 'proved by Lean for every reachable state', failing: 'not proved: see the counterexample', tested: 'tested only' })[status.properties?.[id]] ?? 'to be proved by Lean for every reachable state';
  const because = (why) => (why ? `, because ${why.replace(/[.]$/, '')}` : '');
  const accepts = (f) => (f.kind === 'choice' ? f.values.map((v) => `\`${v}\``).join(', ') : `whole number${f.min !== undefined ? ` from ${f.min}` : ''}${f.max !== undefined ? ` up to ${f.max}` : ''}`);
  const start = initialState(spec);
  const lines = [
    `# ${spec.name} Specification`,
    '',
    '<!-- Generated by Prism from prism/spec.json (prism/spec/2). Change the app through your agent with /prism, not by editing this file. -->',
    '',
    '## Purpose',
    '',
    `${spec.title}: ${spec.purpose.replace(/[.]?$/, '.')}`,
    '',
    '## Requirements',
    '',
    '### Requirement: The state stays within its bounds',
    '',
    `The app SHALL keep ${spec.state.map((f) => `\`${f.name}\` ${f.kind === 'choice' ? `one of ${accepts(f)}` : `from ${f.min ?? 0} up to ${f.max}`}`).join(', ')}, starting at ${spec.state.map((f) => `\`${f.name}=${start[f.name]}\``).join(', ')}.`,
    '',
    `Verified: proved by Lean (theorems \`startInBounds\`, ${spec.actions.map((a) => `\`${n.actions[a.name].keepsBounds}\``).join(', ')}).`,
    '',
    ...spec.properties.flatMap((p) => [
      `### Requirement: ${p.id} ${p.says.replace(/[.]$/, '')}`,
      '',
      `${p.says.replace(/[.]$/, '')}${because(p.why)}.`,
      '',
      `Verified: ${badge(p.id)} (${p.id}, ${n.properties[p.id].theorems.map((t) => `\`${t}\``).join(', ')}).`,
      '',
    ]),
    ...spec.actions.flatMap((a) => [
      `### Requirement: Action ${a.name}`,
      '',
      `The app SHALL take \`${[a.name, ...a.inputs.map((f) => `<${f.name}>`)].join(' ')}\`${a.means ? `, which ${a.means.replace(/[.]$/, '')}` : ''}, and try its rules in order; the first whose conditions hold and whose changes keep the state within bounds SHALL decide. Otherwise it SHALL answer \`${a.otherwise}\` and change nothing${because(a.otherwiseWhy)}.`,
      '',
      ...a.rules.map((r) => `- ${r.id}: ${r.says}${r.why ? ` (${r.why.replace(/[.]$/, '')})` : ''}`),
      ...(a.rules.length ? [''] : []),
      ...a.inputs.map((f) => `- \`${f.name}\`: ${accepts(f)}${f.means ? `; ${f.means}` : ''}`),
      ...(a.inputs.length ? [''] : []),
      'Verified: tested by the acceptance vectors.',
      '',
    ]),
    '### Requirement: Sessions and answers',
    '',
    `The app SHALL read a session as its steps separated by \`;\`, each an action and its inputs separated by single spaces, at most ${SESSION_BYTES} bytes, replay it from the start state, and answer the last step's outcome, one of ${spec.outcomes.map((o) => `\`${o}\``).join(', ')}, followed by the state as \`name=value\`. It SHALL answer \`invalid\` when any step is malformed.`,
    '',
    '| State | Holds | Means |',
    '| --- | --- | --- |',
    ...spec.state.map((f) => `| \`${f.name}\` | ${f.kind === 'choice' ? accepts(f) : `whole number from ${f.min ?? 0} up to ${f.max}`} | ${f.means ?? ''} |`),
    '',
    '| Answer | Means |',
    '| --- | --- |',
    ...spec.outcomes.map((o) => `| \`${o}\` | ${spec.meanings?.[o] ?? ''} |`),
    '| `invalid` | a step is malformed |',
    '',
    'Verified: reading a session is tested, not proved.',
    '',
    ...(spec.limits ? ['## Out of scope', '', ...spec.limits.map((l) => `- ${l}`), ''] : []),
    '## Examples',
    '',
    ...(spec.examples.length
      ? spec.examples.flatMap((e) => e.steps.map((s, i) => `- \`${s}\` gives \`${e.answers[i]}\``).concat(['']))
      : ['No example yet.', '']),
    '## What is proved and what is tested',
    '',
    'Lean proves that the start state is within bounds and that every action keeps it so, and each state property at the start and kept by every action from any state within bounds where all state properties hold. By induction over the steps of a session, each then holds in every reachable state. Each action property is proved for every such state. The proofs are about `after` and `reply`, the functions the WebAssembly guest runs, because both come from the same model.',
    '',
    `Reading sessions is tested, not proved: ${status.vectors ?? 'the'} acceptance vectors replay through the built guest, malformed and oversized sessions included.`,
    '',
    'Nothing here says the rules are the right rules. That is the part only you can judge.',
    '',
    '## Files',
    '',
    '- `prism/spec.json` is this spec as data, the app\'s one input, in canonical JSON (RFC 8785). The model is rendered from it alone, so the same spec.json always gives the same model.',
    `- \`src/${n.module}.lex.tex\` is the LexLean model generated from it, and \`src/${n.proofs}.lex.tex\` its theorems.`,
    '',
  ];
  return lines.join('\n');
}

