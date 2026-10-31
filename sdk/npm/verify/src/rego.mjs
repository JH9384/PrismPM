/**
 * A closed subset of Rego v1, the policy language of `prism check --policy`
 * (issue #285, docs/proposals/285-policy-file.md).
 *
 * Why it is here: this package has no dependencies and runs in a browser, and
 * no npm package evaluates Rego source without a compile step. The rule that
 * keeps a hand-written evaluator honest is that it refuses, and never guesses:
 * a construct outside the subset is a parse error that names it, so a policy
 * that both this file and OPA accept gets the same answer from each. Where
 * OPA would turn a mistake into `undefined`, such as `count(1)`, this file
 * stops with an evaluation error, so a mistake cannot read as a pass. There is
 * no type checker here: OPA refuses `1 == "1"` when it compiles, and this file
 * answers false.
 *
 * The subset, which the OPA differential test in test/rego-corpus.mjs pins:
 *
 *   module    `package prism.policy`, optionally `import rego.v1`, then rules
 *   rules     `x := term`, `x := term if body`, `x if body`, `default x := term`,
 *             `x contains term`, `x contains term if body`
 *   literals  `some v in c`, `some k, v in c`, `every v in c { }`, `not expr`,
 *             `x := term`, and an expression
 *   exprs     a term; `== != < <= > >=`; `x in c`
 *   terms     strings, numbers, true, false, null, arrays, objects, sets,
 *             comprehensions, references, and the functions in BUILTINS
 *
 * Refused: functions, partial objects, `else`, `with`, `=`, arithmetic and set
 * operators, `_` and unbound variables in a reference, `data`, and other imports.
 * Nothing here reads a clock, the network or randomness.
 */

/** `kind` is `parse` or `evaluation`; the caller turns it into its typed error. */
export class RegoError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'RegoError';
    this.kind = kind;
  }
}

const UNDEFINED = Symbol('undefined');
const MAX_SOURCE = 256 * 1024;
const MAX_DEPTH = 64;
const STEP_BUDGET = 2_000_000;
const PACKAGE = 'prism.policy';
/** The rules that make the decision. Everything else exists to serve them. */
const DECISIONS = Object.freeze(['minimum', 'deny']);
const RESERVED = new Set(['as', 'default', 'else', 'every', 'false', 'if', 'import', 'in', 'not', 'null', 'package', 'some', 'true', 'with']);
const COMPARE = new Set(['==', '!=', '<', '<=', '>', '>=']);
const PUNCTUATION = [':=', '==', '!=', '<=', '>=', '{', '}', '[', ']', '(', ')', ',', '.', ':', ';', '|', '<', '>', '='];
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/y;

const at = (token) => `line ${token.line}, column ${token.column}`;
const parseError = (token, message) => new RegoError('parse', `${at(token)}: ${message}`);

/* ------------------------------------------------------------------ lexer */

function lex(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const here = () => ({ line, column: i - lineStart + 1 });
  const push = (type, value, position, length) => {
    tokens.push({ type, value, ...position });
    i += length;
  };
  while (i < source.length) {
    const c = source[i];
    if (c === '\n') {
      if (tokens.at(-1)?.type !== 'newline') tokens.push({ type: 'newline', ...here() });
      i++;
      line++;
      lineStart = i;
    } else if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') {
      i++;
    } else if (c === '#') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '"') {
      const position = here();
      let end = i + 1;
      while (end < source.length && source[end] !== '"' && source[end] !== '\n') end += source[end] === '\\' ? 2 : 1;
      if (source[end] !== '"') throw parseError(position, 'a string is not closed on its line');
      let value;
      try {
        value = JSON.parse(source.slice(i, end + 1));
      } catch {
        throw parseError(position, 'a string has an escape Rego does not have');
      }
      push('string', value, position, end + 1 - i);
    } else if (c === '`') {
      const position = here();
      const end = source.indexOf('`', i + 1);
      if (end < 0) throw parseError(position, 'a raw string is not closed');
      const text = source.slice(i + 1, end);
      push('string', text, position, end + 1 - i);
      const breaks = text.split('\n').length - 1;
      if (breaks > 0) {
        line += breaks;
        lineStart = i - (text.length - text.lastIndexOf('\n') - 1) - 1;
      }
    } else if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(source[i + 1] ?? ''))) {
      NUMBER.lastIndex = i;
      const text = NUMBER.exec(source)[0];
      push('number', Number(text), here(), text.length);
    } else if (/[A-Za-z_]/.test(c)) {
      IDENTIFIER.lastIndex = i;
      const text = IDENTIFIER.exec(source)[0];
      push('identifier', text, here(), text.length);
    } else {
      const mark = PUNCTUATION.find((p) => source.startsWith(p, i));
      if (!mark) {
        if ('+-*/%&'.includes(c)) throw parseError(here(), `the operator ${c} is outside the subset this evaluator accepts`);
        throw parseError(here(), `unexpected character ${JSON.stringify(c)}`);
      }
      push('punctuation', mark, here(), mark.length);
    }
  }
  tokens.push({ type: 'end', ...here() });
  return tokens;
}

/* ----------------------------------------------------------------- parser */

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    this.depth = 0;
  }

  get token() {
    return this.tokens[this.index];
  }

  is(type, value) {
    return this.token.type === type && (value === undefined || this.token.value === value);
  }

  punctuation(value) {
    return this.is('punctuation', value);
  }

  word(value) {
    return this.is('identifier', value);
  }

  next() {
    return this.tokens[this.index++];
  }

  skipNewlines() {
    while (this.is('newline')) this.index++;
  }

  describe() {
    const { type, value } = this.token;
    if (type === 'end') return 'the end of the file';
    if (type === 'newline') return 'the end of the line';
    return type === 'string' ? JSON.stringify(value) : String(value);
  }

  expect(value) {
    if (!this.punctuation(value)) throw parseError(this.token, `expected ${value}, found ${this.describe()}`);
    return this.next();
  }

  expectWord(value) {
    if (!this.word(value)) throw parseError(this.token, `expected ${value}, found ${this.describe()}`);
    return this.next();
  }

  name(what) {
    if (!this.is('identifier')) throw parseError(this.token, `expected ${what}, found ${this.describe()}`);
    if (RESERVED.has(this.token.value)) throw parseError(this.token, `${this.token.value} is a keyword and cannot be ${what}`);
    return this.next();
  }

  endOfStatement() {
    if (this.is('end')) return;
    if (this.word('else')) throw parseError(this.token, 'else is outside the subset this evaluator accepts');
    if (!this.is('newline')) throw parseError(this.token, `expected the end of the line, found ${this.describe()}`);
    this.skipNewlines();
  }

  module() {
    this.skipNewlines();
    if (!this.word('package')) throw parseError(this.token, `a policy starts with package ${PACKAGE}`);
    const start = this.next();
    const parts = [this.name('a package name').value];
    while (this.punctuation('.')) {
      this.next();
      parts.push(this.name('a package name').value);
    }
    if (parts.join('.') !== PACKAGE) throw parseError(start, `the package must be ${PACKAGE}, not ${parts.join('.')}`);
    this.endOfStatement();
    while (this.word('import')) {
      const token = this.next();
      const parts2 = [this.name('an import').value];
      while (this.punctuation('.')) {
        this.next();
        parts2.push(this.name('an import').value);
      }
      if (parts2.join('.') !== 'rego.v1') throw parseError(token, `only rego.v1 may be imported, not ${parts2.join('.')}`);
      this.endOfStatement();
    }
    const rules = [];
    while (!this.is('end')) rules.push(this.rule());
    return rules;
  }

  rule() {
    if (this.word('default')) {
      this.next();
      const name = this.name('a rule name');
      this.expect(':=');
      const head = this.term();
      this.endOfStatement();
      return { kind: 'default', name: name.value, at: name, head, body: [] };
    }
    const name = this.name('a rule name');
    let rule;
    if (this.punctuation('(')) throw parseError(this.token, `${name.value} is a function, and functions are outside the subset this evaluator accepts`);
    if (this.punctuation('[')) throw parseError(this.token, `${name.value} is a partial object, which is outside the subset this evaluator accepts; use a set or an object literal`);
    if (this.punctuation('=')) throw parseError(this.token, `write ${name.value} := with :=, because = is outside the subset this evaluator accepts`);
    if (this.word('contains')) {
      this.next();
      const head = this.term();
      rule = { kind: 'set', name: name.value, at: name, head, body: this.optionalBody() };
    } else if (this.punctuation(':=')) {
      this.next();
      const head = this.term();
      rule = { kind: 'complete', name: name.value, at: name, head, body: this.optionalBody() };
    } else if (this.word('if')) {
      rule = { kind: 'complete', name: name.value, at: name, head: { t: 'value', value: true }, body: this.optionalBody() };
    } else {
      throw parseError(this.token, `expected :=, contains or if after ${name.value}, found ${this.describe()}`);
    }
    this.endOfStatement();
    return rule;
  }

  optionalBody() {
    if (!this.word('if')) return [];
    this.next();
    if (!this.punctuation('{')) return [this.literal()];
    this.next();
    const body = this.body('}');
    this.expect('}');
    return body;
  }

  body(closer) {
    const literals = [];
    for (;;) {
      while (this.is('newline') || this.punctuation(';')) this.next();
      if (this.punctuation(closer)) break;
      literals.push(this.literal());
      if (!this.is('newline') && !this.punctuation(';') && !this.punctuation(closer)) {
        throw parseError(this.token, `expected the end of a statement, found ${this.describe()}`);
      }
    }
    if (literals.length === 0) throw parseError(this.token, 'a body is empty');
    return literals;
  }

  variables() {
    const names = [this.name('a variable')];
    if (this.punctuation(',')) {
      this.next();
      names.push(this.name('a variable'));
    }
    return names;
  }

  literal() {
    const start = this.token;
    if (this.word('some')) {
      this.next();
      const names = this.variables();
      if (!this.word('in')) throw parseError(this.token, 'write some x in collection; a bare some is outside the subset this evaluator accepts');
      this.next();
      return { l: 'some', at: start, names, domain: this.term() };
    }
    if (this.word('every')) {
      this.next();
      const names = this.variables();
      this.expectWord('in');
      const domain = this.term();
      this.expect('{');
      const body = this.body('}');
      this.expect('}');
      return { l: 'every', at: start, names, domain, body };
    }
    if (this.word('not')) {
      this.next();
      return { l: 'not', at: start, expr: this.expression() };
    }
    if (this.is('identifier') && !RESERVED.has(start.value) && this.tokens[this.index + 1].type === 'punctuation' && this.tokens[this.index + 1].value === ':=') {
      this.index += 2;
      return { l: 'assign', at: start, name: start, term: this.term() };
    }
    return { l: 'expr', at: start, expr: this.expression() };
  }

  expression() {
    const left = this.term();
    const token = this.token;
    if (token.type === 'punctuation' && COMPARE.has(token.value)) {
      this.next();
      return { e: 'compare', at: token, op: token.value, left, right: this.term() };
    }
    if (this.word('in')) {
      this.next();
      return { e: 'in', at: token, left, right: this.term() };
    }
    if (this.punctuation('=')) throw parseError(token, 'write == or :=, because = is outside the subset this evaluator accepts');
    if (this.punctuation(',')) throw parseError(token, 'k, v in collection as an expression is outside the subset this evaluator accepts; use some k, v in collection');
    if (this.word('with')) throw parseError(token, 'with is outside the subset this evaluator accepts');
    if (this.word('as')) throw parseError(token, 'as is outside the subset this evaluator accepts');
    return { e: 'term', at: left.at ?? token, term: left };
  }

  term() {
    if (++this.depth > MAX_DEPTH) throw parseError(this.token, `terms nest deeper than ${MAX_DEPTH}`);
    let term = this.primary();
    for (;;) {
      if (this.punctuation('.')) {
        this.next();
        if (!this.is('identifier')) throw parseError(this.token, `expected a member name, found ${this.describe()}`);
        const token = this.next();
        term = this.indexed(term, { t: 'value', value: token.value });
      } else if (this.punctuation('[')) {
        const token = this.next();
        if (this.word('_')) throw parseError(this.token, 'a wildcard in a reference is outside the subset this evaluator accepts; use some x in collection');
        const key = this.term();
        this.expect(']');
        term = this.indexed(term, key, token);
      } else {
        break;
      }
    }
    this.depth--;
    return term;
  }

  indexed(term, key, token) {
    return term.t === 'ref' ? { ...term, path: [...term.path, key] } : { t: 'ref', at: term.at ?? token, base: term, path: [key] };
  }

  primary() {
    const token = this.token;
    if (token.type === 'string' || token.type === 'number') {
      this.next();
      return { t: 'value', at: token, value: token.value };
    }
    if (token.type === 'identifier') {
      if (token.value === 'true' || token.value === 'false' || token.value === 'null') {
        this.next();
        return { t: 'value', at: token, value: token.value === 'null' ? null : token.value === 'true' };
      }
      if (RESERVED.has(token.value)) throw parseError(token, `${token.value} cannot start a term`);
      return this.nameOrCall();
    }
    if (this.punctuation('(')) {
      this.next();
      this.skipNewlines();
      const inner = this.term();
      this.skipNewlines();
      this.expect(')');
      return inner;
    }
    if (this.punctuation('[')) return this.arrayTerm();
    if (this.punctuation('{')) return this.braceTerm();
    throw parseError(token, `expected a term, found ${this.describe()}`);
  }

  nameOrCall() {
    const token = this.next();
    // A dotted name followed by ( is a function; anything else is a variable and its reference.
    let lookahead = this.index;
    let name = token.value;
    while (this.tokens[lookahead].type === 'punctuation' && this.tokens[lookahead].value === '.' && this.tokens[lookahead + 1].type === 'identifier') {
      name += `.${this.tokens[lookahead + 1].value}`;
      lookahead += 2;
    }
    if (this.tokens[lookahead].type === 'punctuation' && this.tokens[lookahead].value === '(') {
      this.index = lookahead + 1;
      const args = this.commaSeparated(')');
      this.expect(')');
      const builtin = Object.hasOwn(BUILTINS, name) ? BUILTINS[name] : undefined;
      if (!builtin) throw parseError(token, `the function ${name} is outside the subset this evaluator accepts; it has ${Object.keys(BUILTINS).join(', ')}`);
      if (builtin.arity !== args.length) throw parseError(token, `${name} takes ${builtin.arity} arguments, not ${args.length}`);
      return { t: 'call', at: token, name, args };
    }
    if (token.value === '_') throw parseError(token, 'a wildcard outside some and every is outside the subset this evaluator accepts');
    if (token.value === 'data') throw parseError(token, 'data is outside the subset this evaluator accepts; a policy reads input and its own rules');
    return { t: 'var', at: token, name: token.value };
  }

  commaSeparated(closer) {
    const items = [];
    this.skipNewlines();
    while (!this.punctuation(closer)) {
      items.push(this.term());
      this.skipNewlines();
      if (!this.punctuation(',')) break;
      this.next();
      this.skipNewlines();
    }
    return items;
  }

  arrayTerm() {
    const start = this.next();
    this.skipNewlines();
    if (this.punctuation(']')) {
      this.next();
      return { t: 'array', at: start, items: [] };
    }
    const first = this.term();
    this.skipNewlines();
    if (this.punctuation('|')) return this.comprehension('array', start, { head: first }, ']');
    const items = [first];
    if (this.punctuation(',')) {
      this.next();
      items.push(...this.commaSeparated(']'));
    }
    this.skipNewlines();
    this.expect(']');
    return { t: 'array', at: start, items };
  }

  braceTerm() {
    const start = this.next();
    this.skipNewlines();
    if (this.punctuation('}')) {
      this.next();
      return { t: 'object', at: start, entries: [] };
    }
    const first = this.term();
    this.skipNewlines();
    if (this.punctuation(':')) {
      this.next();
      this.skipNewlines();
      const value = this.term();
      this.skipNewlines();
      if (this.punctuation('|')) return this.comprehension('object', start, { key: first, value }, '}');
      const entries = [[first, value]];
      while (this.punctuation(',')) {
        this.next();
        this.skipNewlines();
        if (this.punctuation('}')) break;
        const key = this.term();
        this.skipNewlines();
        this.expect(':');
        this.skipNewlines();
        entries.push([key, this.term()]);
        this.skipNewlines();
      }
      this.expect('}');
      return { t: 'object', at: start, entries };
    }
    if (this.punctuation('|')) return this.comprehension('set', start, { head: first }, '}');
    const items = [first];
    if (this.punctuation(',')) {
      this.next();
      items.push(...this.commaSeparated('}'));
    }
    this.skipNewlines();
    this.expect('}');
    return { t: 'set', at: start, items };
  }

  comprehension(shape, start, parts, closer) {
    this.next();
    const body = this.body(closer);
    this.expect(closer);
    return { t: 'comprehension', at: start, shape, ...parts, body };
  }
}

/* ---------------------------------------------------------- static checks */

/** Every variable is bound before it is used, and no name is rebound. OPA would reorder a body; here the order is the order written. */
function checkScopes(rule, ruleNames, uses) {
  const bind = (token, scope) => {
    const { value: name } = token;
    if (name === '_') return;
    if (name === 'input' || ruleNames.has(name) || scope.has(name)) throw parseError(token, `${name} is already bound; a name cannot be rebound in this evaluator`);
    scope.add(name);
  };
  const walkTerm = (term, scope) => {
    switch (term.t) {
      case 'value':
        return;
      case 'var':
        if (term.name === 'input' || scope.has(term.name)) return;
        if (ruleNames.has(term.name)) {
          uses.add(term.name);
          return;
        }
        throw parseError(term.at, `${term.name} is unsafe: nothing binds it before this use, in the order written`);
      case 'ref':
        walkTerm(term.base, scope);
        for (const key of term.path) walkTerm(key, scope);
        return;
      case 'call':
        for (const arg of term.args) walkTerm(arg, scope);
        return;
      case 'array':
      case 'set':
        for (const item of term.items) walkTerm(item, scope);
        return;
      case 'object':
        for (const [key, value] of term.entries) {
          walkTerm(key, scope);
          walkTerm(value, scope);
        }
        return;
      case 'comprehension': {
        const inner = new Set(scope);
        walkBody(term.body, inner);
        for (const part of [term.head, term.key, term.value]) if (part) walkTerm(part, inner);
        return;
      }
      default:
        throw new RegoError('parse', `unknown term ${term.t}`);
    }
  };
  const walkExpression = (expr, scope) => {
    if (expr.e === 'term') walkTerm(expr.term, scope);
    else {
      walkTerm(expr.left, scope);
      walkTerm(expr.right, scope);
    }
  };
  const walkBody = (body, scope) => {
    for (const literal of body) {
      if (literal.l === 'some') {
        walkTerm(literal.domain, scope);
        for (const name of literal.names) bind(name, scope);
      } else if (literal.l === 'every') {
        walkTerm(literal.domain, scope);
        const inner = new Set(scope);
        for (const name of literal.names) bind(name, inner);
        walkBody(literal.body, inner);
      } else if (literal.l === 'not') {
        walkExpression(literal.expr, scope);
      } else if (literal.l === 'assign') {
        walkTerm(literal.term, scope);
        bind(literal.name, scope);
      } else {
        walkExpression(literal.expr, scope);
      }
    }
  };
  const scope = new Set();
  walkBody(rule.body, scope);
  walkTerm(rule.head, scope);
}

function checkRules(rules) {
  const byName = new Map();
  for (const rule of rules) {
    if (rule.name === 'input' || rule.name === 'data' || rule.name === '_') throw parseError(rule.at, `a rule cannot be named ${rule.name}`);
    if (!byName.has(rule.name)) byName.set(rule.name, []);
    byName.get(rule.name).push(rule);
  }
  if (!byName.has('minimum')) throw parseError({ line: 1, column: 1 }, 'a policy defines minimum, the lowest assurance level it accepts, such as minimum := "P2"');
  const dependencies = new Map();
  const names = new Set(byName.keys());
  for (const [name, group] of byName) {
    const kinds = new Set(group.map((r) => (r.kind === 'default' ? 'complete' : r.kind)));
    if (kinds.size > 1) throw parseError(group[0].at, `${name} is defined both with contains and with := or if`);
    if (group.filter((r) => r.kind === 'default').length > 1) throw parseError(group[0].at, `${name} has more than one default`);
    if (name === 'deny' && !kinds.has('set')) throw parseError(group[0].at, 'deny is a set: write deny contains {"rule": ..., "message": ...} if { ... }');
    if (name === 'minimum' && !kinds.has('complete')) throw parseError(group[0].at, 'minimum is one value: write minimum := "P2"');
    const uses = new Set();
    for (const rule of group) checkScopes(rule, names, uses);
    dependencies.set(name, uses);
  }
  // Recursion would not terminate on its own, and OPA refuses it too.
  const state = new Map();
  const visit = (name, trail) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'open') throw parseError(byName.get(name)[0].at, `the rules recurse: ${[...trail, name].join(' -> ')}`);
    state.set(name, 'open');
    for (const used of dependencies.get(name)) visit(used, [...trail, name]);
    state.set(name, 'done');
  };
  for (const name of DECISIONS) if (byName.has(name)) visit(name, []);
  // A rule that decides nothing is a mistake that would read as a pass: an `allow` this file never consults, or a misspelled `deny`.
  for (const [name, group] of byName) {
    if (state.get(name) !== 'done') throw parseError(group[0].at, `the rule ${name} decides nothing: only minimum and deny decide, and neither uses it`);
  }
  return byName;
}

/** Parse a policy. Throws `RegoError` of kind `parse`. Returns the program `evaluateRego` runs. */
export function parseRego(source) {
  if (typeof source !== 'string') throw new RegoError('parse', 'a policy is text');
  if (source.length > MAX_SOURCE) throw new RegoError('parse', `a policy is at most ${MAX_SOURCE} bytes`);
  try {
    return Object.freeze({ rules: checkRules(new Parser(lex(source)).module()) });
  } catch (error) {
    if (error instanceof RangeError) throw new RegoError('parse', 'the policy nests too deeply');
    throw error;
  }
}

/* ----------------------------------------------------------------- values */

class RegoSet {
  constructor() {
    this.members = new Map();
  }

  add(value) {
    this.members.set(canonical(value), value);
  }

  has(value) {
    return this.members.has(canonical(value));
  }

  get size() {
    return this.members.size;
  }

  /** Members in canonical order, so that nothing depends on insertion. */
  values() {
    return [...this.members.keys()].sort().map((key) => this.members.get(key));
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegoSet);
const isCollection = (value) => Array.isArray(value) || value instanceof RegoSet || isObject(value);

function canonical(value) {
  if (value instanceof RegoSet) return `set(${[...value.members.keys()].sort().join(',')})`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const equal = (a, b) => canonical(a) === canonical(b);

/** Compare strings by code point, as Go compares UTF-8 bytes. JavaScript's own order is by UTF-16 unit. */
function compareStrings(a, b) {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const delta = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (delta !== 0) return delta;
  }
  return x.length - y.length;
}

function typeName(value) {
  if (value === null) return 'null';
  if (value instanceof RegoSet) return 'set';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

/** The text sprintf %v prints, as OPA prints a term: a string as itself at the top, quoted inside a collection. */
function display(value, top = true) {
  if (typeof value === 'string') return top ? value : JSON.stringify(value);
  if (value instanceof RegoSet) return value.size === 0 ? 'set()' : `{${value.values().map((v) => display(v, false)).join(', ')}}`;
  if (Array.isArray(value)) return `[${value.map((v) => display(v, false)).join(', ')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}: ${display(value[k], false)}`).join(', ')}}`;
  return JSON.stringify(value);
}

class BuiltinError extends Error {}

const wants = (name, position, type, value) => {
  if (typeName(value) !== type) throw new BuiltinError(`${name} wants a ${type} as argument ${position}, and got a ${typeName(value)}`);
  return value;
};

function sprintf(format, args) {
  wants('sprintf', 1, 'string', format);
  wants('sprintf', 2, 'array', args);
  let used = 0;
  const text = format.replace(/%(.?)/gs, (_, verb) => {
    if (verb === '%') return '%';
    if (!'svd'.includes(verb) || verb === '') throw new BuiltinError(`sprintf has no verb %${verb} in this evaluator; it has %s, %v, %d and %%`);
    if (used >= args.length) throw new BuiltinError(`the sprintf format wants more than the ${args.length} values it was given`);
    const value = args[used++];
    if (verb === 's' && typeof value !== 'string') throw new BuiltinError(`sprintf %s wants a string, and got a ${typeName(value)}; use %v`);
    if (verb === 'd' && !Number.isInteger(value)) throw new BuiltinError(`sprintf %d wants an integer, and got a ${typeName(value)}`);
    return display(value);
  });
  if (used !== args.length) throw new BuiltinError(`the sprintf format uses ${used} of the ${args.length} values it was given`);
  return text;
}

function concat(separator, items) {
  wants('concat', 1, 'string', separator);
  if (!Array.isArray(items) && !(items instanceof RegoSet)) throw new BuiltinError(`concat wants an array or a set as argument 2, and got a ${typeName(items)}`);
  const list = Array.isArray(items) ? items : [...items.values()].sort((a, b) => (typeof a === 'string' && typeof b === 'string' ? compareStrings(a, b) : 0));
  for (const item of list) wants('concat', 2, 'string', item);
  return list.join(separator);
}

function count(value) {
  if (value instanceof RegoSet) return value.size;
  if (Array.isArray(value)) return value.length;
  if (isObject(value)) return Object.keys(value).length;
  if (typeof value === 'string') return [...value].length;
  throw new BuiltinError(`count wants a collection or a string, and got a ${typeName(value)}`);
}

/** The functions a policy may call. A name not listed here is refused when the policy is parsed. */
const BUILTINS = Object.freeze({
  concat: { arity: 2, run: concat },
  contains: { arity: 2, run: (a, b) => wants('contains', 1, 'string', a).includes(wants('contains', 2, 'string', b)) },
  count: { arity: 1, run: count },
  endswith: { arity: 2, run: (a, b) => wants('endswith', 1, 'string', a).endsWith(wants('endswith', 2, 'string', b)) },
  'object.get': {
    arity: 3,
    run: (object, key, fallback) => {
      wants('object.get', 1, 'object', object);
      wants('object.get', 2, 'string', key);
      return Object.hasOwn(object, key) ? object[key] : fallback;
    },
  },
  'object.keys': {
    arity: 1,
    run: (object) => {
      const set = new RegoSet();
      for (const key of Object.keys(wants('object.keys', 1, 'object', object))) set.add(key);
      return set;
    },
  },
  set: { arity: 0, run: () => new RegoSet() },
  sprintf: { arity: 2, run: sprintf },
  startswith: { arity: 2, run: (a, b) => wants('startswith', 1, 'string', a).startsWith(wants('startswith', 2, 'string', b)) },
  type_name: { arity: 1, run: typeName },
});

/* -------------------------------------------------------------- evaluator */

class Evaluator {
  constructor(program, input) {
    this.rules = program.rules;
    this.input = input;
    this.cache = new Map();
    this.steps = 0;
    this.current = null;
  }

  fail(message) {
    const where = this.current ? `rule ${this.current.name} at line ${this.current.at.line}: ` : '';
    return new RegoError('evaluation', `${where}${message}`);
  }

  tick() {
    if (++this.steps > STEP_BUDGET) throw this.fail(`the evaluation took more than ${STEP_BUDGET} steps`);
  }

  rule(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const group = this.rules.get(name);
    const outer = this.current;
    this.current = group[0];
    let value;
    if (group[0].kind === 'set') {
      value = new RegoSet();
      for (const rule of group) {
        this.current = rule;
        this.solve(rule.body, Object.create(null), (env) => {
          const head = this.term(rule.head, env);
          if (head !== UNDEFINED) value.add(head);
        });
      }
    } else {
      value = UNDEFINED;
      for (const rule of group) {
        if (rule.kind === 'default') continue;
        this.current = rule;
        this.solve(rule.body, Object.create(null), (env) => {
          const head = this.term(rule.head, env);
          if (head === UNDEFINED) return;
          if (value !== UNDEFINED && !equal(value, head)) throw this.fail(`${name} has two different values, ${display(value, false)} and ${display(head, false)}`);
          value = head;
        });
      }
      const fallback = group.find((rule) => rule.kind === 'default');
      if (value === UNDEFINED && fallback) {
        this.current = fallback;
        value = this.term(fallback.head, Object.create(null));
      }
    }
    this.current = outer;
    this.cache.set(name, value);
    return value;
  }

  /** Call `emit` with the bindings of every solution of a body, in the order written. */
  solve(body, env, emit) {
    const step = (index, bindings) => {
      this.tick();
      if (index === body.length) return emit(bindings);
      const literal = body[index];
      switch (literal.l) {
        case 'some': {
          for (const scoped of this.elements(literal, this.term(literal.domain, bindings), bindings)) step(index + 1, scoped);
          return undefined;
        }
        case 'every': {
          // A domain that is undefined or is not a collection fails the literal; an empty one holds.
          const domain = this.term(literal.domain, bindings);
          if (!isCollection(domain)) return undefined;
          for (const scoped of this.elements(literal, domain, bindings)) {
            let found = false;
            this.solve(literal.body, scoped, () => {
              found = true;
            });
            if (!found) return undefined;
          }
          return step(index + 1, bindings);
        }
        case 'not':
          return this.holds(literal.expr, bindings) ? undefined : step(index + 1, bindings);
        case 'assign': {
          const value = this.term(literal.term, bindings);
          if (value === UNDEFINED) return undefined;
          return step(index + 1, this.extended(bindings, literal.name.value, value));
        }
        default:
          return this.holds(literal.expr, bindings) ? step(index + 1, bindings) : undefined;
      }
    };
    step(0, env);
  }

  extended(env, name, value) {
    if (name === '_') return env;
    const next = Object.create(null);
    Object.assign(next, env);
    next[name] = value;
    return next;
  }

  /** The bindings of each element of a domain. One that is undefined or is not a collection has no elements. */
  *elements(literal, domain, env) {
    if (!isCollection(domain)) return;
    const [first, second] = literal.names;
    const pairs = Array.isArray(domain)
      ? domain.map((value, index) => [index, value])
      : domain instanceof RegoSet
        ? domain.values().map((value) => [value, value])
        : Object.keys(domain).sort().map((key) => [key, domain[key]]);
    for (const [key, value] of pairs) {
      this.tick();
      yield second ? this.extended(this.extended(env, first.value, key), second.value, value) : this.extended(env, first.value, value);
    }
  }

  holds(expr, env) {
    this.tick();
    if (expr.e === 'term') {
      const value = this.term(expr.term, env);
      return value !== UNDEFINED && value !== false;
    }
    const left = this.term(expr.left, env);
    const right = this.term(expr.right, env);
    if (left === UNDEFINED || right === UNDEFINED) return false;
    if (expr.e === 'in') {
      if (Array.isArray(right)) return right.some((item) => equal(item, left));
      if (right instanceof RegoSet) return right.has(left);
      if (isObject(right)) return Object.values(right).some((item) => equal(item, left));
      return false;
    }
    if (expr.op === '==') return equal(left, right);
    if (expr.op === '!=') return !equal(left, right);
    let order;
    if (typeof left === 'number' && typeof right === 'number') order = left - right;
    else if (typeof left === 'string' && typeof right === 'string') order = compareStrings(left, right);
    else throw this.fail(`${expr.op} compares two numbers or two strings, and got a ${typeName(left)} and a ${typeName(right)}`);
    if (expr.op === '<') return order < 0;
    if (expr.op === '<=') return order <= 0;
    if (expr.op === '>') return order > 0;
    return order >= 0;
  }

  term(term, env) {
    this.tick();
    switch (term.t) {
      case 'value':
        return term.value;
      case 'var':
        if (term.name in env) return env[term.name];
        if (term.name === 'input') return this.input;
        return this.rule(term.name);
      case 'ref':
        return this.reference(term, env);
      case 'call': {
        const args = [];
        for (const arg of term.args) {
          const value = this.term(arg, env);
          if (value === UNDEFINED) return UNDEFINED;
          args.push(value);
        }
        try {
          return BUILTINS[term.name].run(...args);
        } catch (error) {
          if (error instanceof BuiltinError) throw this.fail(error.message);
          throw error;
        }
      }
      case 'array': {
        const items = [];
        for (const item of term.items) {
          const value = this.term(item, env);
          if (value === UNDEFINED) return UNDEFINED;
          items.push(value);
        }
        return items;
      }
      case 'set': {
        const set = new RegoSet();
        for (const item of term.items) {
          const value = this.term(item, env);
          if (value === UNDEFINED) return UNDEFINED;
          set.add(value);
        }
        return set;
      }
      case 'object': {
        const object = Object.create(null);
        for (const [keyTerm, valueTerm] of term.entries) {
          const key = this.term(keyTerm, env);
          const value = this.term(valueTerm, env);
          if (key === UNDEFINED || value === UNDEFINED) return UNDEFINED;
          this.put(object, key, value);
        }
        return object;
      }
      case 'comprehension':
        return this.comprehension(term, env);
      default:
        throw this.fail(`unknown term ${term.t}`);
    }
  }

  put(object, key, value) {
    if (typeof key !== 'string') throw this.fail(`an object key must be a string in this evaluator, and got a ${typeName(key)}`);
    if (key in object && !equal(object[key], value)) throw this.fail(`the object key ${JSON.stringify(key)} has two different values`);
    object[key] = value;
  }

  comprehension(term, env) {
    if (term.shape === 'array') {
      const items = [];
      this.solve(term.body, env, (scoped) => {
        const value = this.term(term.head, scoped);
        if (value !== UNDEFINED) items.push(value);
      });
      return items;
    }
    if (term.shape === 'set') {
      const set = new RegoSet();
      this.solve(term.body, env, (scoped) => {
        const value = this.term(term.head, scoped);
        if (value !== UNDEFINED) set.add(value);
      });
      return set;
    }
    const object = Object.create(null);
    this.solve(term.body, env, (scoped) => {
      const key = this.term(term.key, scoped);
      const value = this.term(term.value, scoped);
      if (key !== UNDEFINED && value !== UNDEFINED) this.put(object, key, value);
    });
    return object;
  }

  reference(term, env) {
    let value = this.term(term.base, env);
    for (const keyTerm of term.path) {
      if (value === UNDEFINED) return UNDEFINED;
      const key = this.term(keyTerm, env);
      if (key === UNDEFINED) return UNDEFINED;
      if (Array.isArray(value)) value = Number.isInteger(key) && key >= 0 && key < value.length ? value[key] : UNDEFINED;
      else if (value instanceof RegoSet) value = value.has(key) ? key : UNDEFINED;
      else if (isObject(value)) value = typeof key === 'string' && Object.hasOwn(value, key) ? value[key] : UNDEFINED;
      else return UNDEFINED;
    }
    return value;
  }
}

/** Turn a value back into JSON, with a set as a sorted array, for the caller. */
function plain(value) {
  if (value instanceof RegoSet) return value.values().map(plain);
  if (Array.isArray(value)) return value.map(plain);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, plain(value[key])]));
  return value;
}

/**
 * Evaluate a parsed policy against an input document. Throws `RegoError` of
 * kind `evaluation`. Returns `{ minimum, deny }`: `minimum` as a plain value, or
 * undefined when the rule has none; `deny` as a sorted array of plain values.
 */
export function evaluateRego(program, input) {
  const evaluator = new Evaluator(program, input);
  try {
    const minimum = evaluator.rule('minimum');
    const deny = program.rules.has('deny') ? plain(evaluator.rule('deny')) : [];
    return { minimum: minimum === UNDEFINED ? undefined : plain(minimum), deny };
  } catch (error) {
    if (error instanceof RangeError) throw new RegoError('evaluation', 'the evaluation nests too deeply');
    throw error;
  }
}
