/**
 * The proof of one guarantee, written as Lean kernel terms: no elaborator, no
 * tactic, nothing searched for. It runs wherever JavaScript does, so the same
 * writer serves `prism-code` on a machine and an app's page in a browser.
 *
 * Nothing here is trusted to be right. The kernel judges what it writes, and
 * a wrong term is refused.
 */
export const NAMESPACE = 'PrismLive.Kernel.';
/** The name the proved statement is declared under, and the axioms a proof of it may rest on. */
export const HOLDS = 'Prism.guarantee.holds';
export const KERNEL_AXIOMS = Object.freeze(['Quot.sound', 'propext']);

/** The library's names, terms and levels by index (lean4export's format), so a proof names what it already holds. */
export function readLibrary(text) {
  const lib = { names: [''], name: new Map([['', 0]]), expr: [], exprAt: new Map(), level: new Map(), types: new Map(), next: [1, 0, 1] };
  for (const line of text.split('\n')) {
    if (!line) continue;
    const o = JSON.parse(line);
    if ('in' in o) {
      const pre = lib.names[(o.str || o.num).pre];
      const full = (pre ? `${pre}.` : '') + (o.str ? o.str.str : o.num.i);
      lib.names[o.in] = full;
      lib.name.set(full, o.in);
      lib.next[0] = Math.max(lib.next[0], o.in + 1);
    } else if ('il' in o) {
      const { il, ...node } = o;
      lib.level.set(JSON.stringify(node), il);
      lib.next[2] = Math.max(lib.next[2], il + 1);
    } else if ('ie' in o) {
      const { ie, ...node } = o;
      lib.expr[ie] = node;
      lib.exprAt.set(JSON.stringify(node), ie);
      lib.next[1] = Math.max(lib.next[1], ie + 1);
    } else if (o.thm || o.def) {
      const d = o.thm || o.def;
      lib.types.set(d.name, d.type);
    }
  }
  return lib;
}

/**
 * One guarantee's proof, written after the library: the words and the
 * guarantee as data, `wordsCheck` on them stated true by evaluation, and
 * `ruleJudge_sound` applied to that. Returns the lines the kernel reads.
 */
export function proofLines(lib, words, guarantee) {
  const out = [];
  const own = new Map();
  const ownExpr = [];
  const ownAt = new Map();
  let [nextName, nextExpr, nextLevel] = lib.next;
  const term = (node) => {
    const key = JSON.stringify(node);
    const have = lib.exprAt.get(key) ?? ownAt.get(key);
    if (have !== undefined) return have;
    const e = nextExpr++;
    ownExpr[e] = node;
    ownAt.set(key, e);
    out.push(JSON.stringify({ ...node, ie: e }));
    return e;
  };
  const node = (e) => lib.expr[e] ?? ownExpr[e];
  const name = (full) => {
    let pre = 0;
    let path = '';
    for (const part of full.split('.')) {
      path = path ? `${path}.${part}` : part;
      const have = lib.name.get(path) ?? own.get(path);
      if (have !== undefined) {
        pre = have;
        continue;
      }
      const n = nextName++;
      own.set(path, n);
      out.push(JSON.stringify({ in: n, str: { pre, str: part } }));
      pre = n;
    }
    return pre;
  };
  const known = (full) => {
    const n = lib.name.get(full);
    if (n === undefined) throw new Error(`the library does not hold ${full}`);
    return n;
  };
  const C = (full, us = []) => term({ const: { name: known(full), us } });
  const app = (f, ...args) => args.reduce((fn, arg) => term({ app: { arg, fn } }), f);
  const nat = (n) => term({ natVal: String(n) });
  const one = lib.level.get(JSON.stringify({ succ: 0 })) ?? (() => {
    const l = nextLevel++;
    out.push(JSON.stringify({ il: l, succ: 0 }));
    return l;
  })();
  const list = (T, xs) => xs.reduceRight((tail, x) => app(C('List.cons', [0]), T, x, tail), app(C('List.nil', [0]), T));
  const declare = (kind, full, type, value) => {
    const n = name(full);
    out.push(JSON.stringify(kind === 'def' ? { def: { all: [n], hints: { regular: 1 }, levelParams: [], name: n, safety: 'safe', type, value } } : { thm: { all: [n], levelParams: [], name: n, type, value } }));
    return term({ const: { name: n, us: [] } });
  };
  // The lemma's statement with its first binders taken by closed terms.
  const instantiate = (type, args) => {
    let body = type;
    for (let k = 0; k < args.length; k++) body = node(body).forallE.body;
    const memo = new Map();
    const go = (e, depth) => {
      const key = `${e}:${depth}`;
      if (memo.has(key)) return memo.get(key);
      const x = node(e);
      let r = e;
      if ('bvar' in x) r = x.bvar < depth ? e : x.bvar - depth < args.length ? args[args.length - 1 - (x.bvar - depth)] : term({ bvar: x.bvar - args.length });
      else if (x.app) r = term({ app: { arg: go(x.app.arg, depth), fn: go(x.app.fn, depth) } });
      else if (x.forallE) r = term({ forallE: { ...x.forallE, type: go(x.forallE.type, depth), body: go(x.forallE.body, depth + 1) } });
      else if (x.lam) r = term({ lam: { ...x.lam, type: go(x.lam.type, depth), body: go(x.lam.body, depth + 1) } });
      else if (x.letE) r = term({ letE: { ...x.letE, type: go(x.letE.type, depth), value: go(x.letE.value, depth), body: go(x.letE.body, depth + 1) } });
      else if (x.proj) r = term({ proj: { ...x.proj, struct: go(x.proj.struct, depth) } });
      memo.set(key, r);
      return r;
    };
    return go(body, 0);
  };
  const Nat = C('Nat');
  const Bool = C('Bool');
  const True = C('Bool.true');
  // One name for every guarantee: each is judged on its own, so a proof's bytes do not depend on where it sits.
  const at = 'Prism.guarantee.';
  const cond = ([field, op, value]) => app(C(`${NAMESPACE}Cond.mk`), nat(field), nat(op), nat(value));
  const P = declare('def', `${at}words`, app(C('List', [0]), Nat), list(Nat, words.map(nat)));
  const p = declare('def', `${at}guarantee`, C(`${NAMESPACE}Property`), app(C(`${NAMESPACE}Property.mk`), C(guarantee.always ? 'Bool.true' : 'Bool.false'), list(C(`${NAMESPACE}Cond`), guarantee.when.map(cond)), nat(guarantee.outcome)));
  const checked = declare('thm', `${at}checked`, app(C('Eq', [one]), Bool, app(C(`${NAMESPACE}wordsCheck`), P, p), True), app(C('Eq.refl', [one]), Bool, True));
  declare('thm', `${at}holds`, instantiate(lib.types.get(known(`${NAMESPACE}ruleJudge_sound`)), [P, p, checked]), app(C(`${NAMESPACE}ruleJudge_sound`), P, p, checked));
  return `${out.join('\n')}\n`;
}
