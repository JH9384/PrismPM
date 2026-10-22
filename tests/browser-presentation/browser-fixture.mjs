// Acceptance-only browser journeys. Never shipped as a presentation service.
import {openPresentation, progressPresentation} from './presentation-dom.mjs';
import {encodeWire, decodePresentation, decodeIntent, intentRequiresSecret, progressFits, PresentationError, PRESENTATION_MAXIMUM} from './presentation-wire.mjs';
import {maximumShape} from './maximum-fixtures.mjs';

const check = (condition, message) => { if (!condition) throw Error(message); };
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return {promise, resolve, reject}; };
const clone = value => structuredClone(value);
const labels = [
  '\uFEFFBrand <img src=x onerror="globalThis.presentationInjected=1">', 'Caption', 'Choice',
  'First', 'Form', 'Heading', 'Input', 'Multiline', 'Navigation', 'Option A', 'Option B',
  'Second', 'Status', 'Column',
].map((text, index) => ({id: 'label' + String(index).padStart(2, '0'), text}));

function expectedFrame(revision = 1) {
  return [1, revision, 0, 13, 1, 6, [
    [0, [0, 0]], [1, [1, 8]], [1, [3, 2, 5]],
    [1, [4, '\uFEFFdynamic <script>globalThis.presentationInjected=2</script> 😀']],
    [1, [2, 4]], [5, [5, 6, true, true, 64, 'initial', 0]],
    [5, [6, 7, true, false, 128, '\uFEFFfirst\r\nsecond', 0]],
    [5, [7, 2, true, true, 10, [[10, 9], [20, 10]], 0]],
    [5, [8, 3, 101, true, false, [6]]],
    [5, [8, 11, 202, true, true, [6, 7, 8]]],
    [1, [9, 1, [13], [['<svg onload="globalThis.presentationInjected=3">'], ['\uFEFFtable 😀']]]],
  ]];
}

export async function runFixture(input) {
  check(input && ((Array.isArray(input.wire) && Array.isArray(input.fixture) && Array.isArray(input.labels))
    || input.adapterOnly === true), 'actual source fixture/catalogue and codec or explicit component-only mode');
  const cases = [], calls = [], views = [], roots = [], intents = [];
  let module, fixtureModule, labelsModule, secretModule, routeModule, sinkModule, progressModule, sourceLabels = labels, maxMemory = 0;
  if (input.wire) {
    module = await WebAssembly.compile(new Uint8Array(input.wire));
    check(WebAssembly.Module.imports(module).length === 0, 'actual codec is import-free');
    fixtureModule = await WebAssembly.compile(new Uint8Array(input.fixture));
    check(WebAssembly.Module.imports(fixtureModule).length === 0, 'actual source fixture is import-free');
    labelsModule = await WebAssembly.compile(new Uint8Array(input.labels));
    check(WebAssembly.Module.imports(labelsModule).length === 0, 'actual source catalogue is import-free');
    for (const role of ['secret', 'route', 'sink', 'progress']) check(Array.isArray(input[role]), 'actual generated fixture root ' + role);
    [secretModule, routeModule, sinkModule, progressModule] = await Promise.all(['secret', 'route', 'sink', 'progress'].map(async role => {
      const value = await WebAssembly.compile(new Uint8Array(input[role]));
      check(WebAssembly.Module.imports(value).length === 0, 'actual secret root is import-free'); return value;
    }));
  }
  function execute(module, bytes, role) {
    const {exports: {memory, holo_alloc, holo_run}} = new WebAssembly.Instance(module, {});
    const pointer = holo_alloc(bytes.length) >>> 0;
    new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes);
    const result = BigInt.asUintN(64, holo_run(pointer, bytes.length));
    const at = Number(result >> 32n), length = Number(result & 0xffffffffn);
    check(length <= PRESENTATION_MAXIMUM && at + length <= memory.buffer.byteLength, 'bounded actual codec output');
    const output = new Uint8Array(memory.buffer, at, length).slice();
    calls.push({role, request: hex(bytes), response: hex(output)});
    maxMemory = Math.max(maxMemory, memory.buffer.byteLength);
    return output;
  }
  if (labelsModule) {
    const actual = execute(labelsModule, new Uint8Array(), 'labels');
    sourceLabels = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(actual));
    check(JSON.stringify(sourceLabels) === JSON.stringify(labels), 'complete catalogue equals genuine source-produced labels');
  }
  function frame(revision = 1, state = 0, focus = 6) {
    const expected = expectedFrame(revision);
    expected[2] = state; expected[5] = focus;
    if (state !== 0) for (const [, content] of expected[6]) {
      if ([5, 6, 7, 10].includes(content[0])) content[2] = false;
      if (content[0] === 8) content[3] = false;
    }
    if (!fixtureModule) return expected;
    const actual = execute(fixtureModule, encodeWire([1, revision, state, focus]), 'fixture');
    check(equal(actual, encodeWire(expected)), 'complete baseline presentation equals actual modeled fixture output');
    return clone(decodePresentation(actual));
  }
  function checked(bytes, accepted = true) {
    if (!module) return bytes;
    const output = execute(module, bytes, 'wire');
    check(equal(bytes, output) === accepted, 'actual generated frame/intent acceptance');
    return bytes;
  }
  const bytes = value => checked(encodeWire(value));
  const paint = (view, value) => view.render(bytes(value));
  function secretFrame(revision = 1, state = 0, epoch = 0) {
    const expected = expectedFrame(revision); expected[2] = state; expected[5] = 0;
    expected[6][5][1] = [10, 6, state === 0, true, 64, epoch];
    expected[6][8][1][5] = [];
    if (state !== 0) for (const [, content] of expected[6]) {
      if ([5, 6, 7, 10].includes(content[0])) content[2] = false;
      if (content[0] === 8) content[3] = false;
    }
    if (!secretModule) return expected;
    const actual = execute(secretModule, encodeWire([1, revision, state, epoch]), 'secret');
    check(equal(actual, encodeWire(expected)), 'complete secret presentation equals actual modeled fixture');
    return clone(decodePresentation(actual));
  }
  function secretRoute(raw, expected = true) {
    const intent = decodeIntent(checked(raw));
    check(intentRequiresSecret(secretFrame(), intent) === expected, 'exact private modeled secret route');
    if (routeModule) check(equal(execute(routeModule, raw, 'route'), Uint8Array.of(expected ? 245 : 244)), 'actual modeled secret classification');
    return intent;
  }
  function secretSink(raw) {
    secretRoute(raw);
    const expected = encodeWire(secretFrame(2, 0, 1));
    if (!sinkModule) return expected;
    const actual = execute(sinkModule, raw, 'sink');
    check(equal(actual, expected), 'actual modeled ephemeral sink returns only nonsecret presentation'); return checked(actual);
  }
  function failure(operation, code) {
    let error;
    try { operation(); } catch (value) { error = value; }
    check(error instanceof PresentationError && (code === undefined || error.code === code),
      'expected presentation refusal ' + code + ', observed ' + error?.code);
    check(Object.keys(error).sort().join(',') === 'code,name' && error.cause === undefined, 'closed diagnostic has no raw error payload');
  }
  function open(dispatch = raw => {
    const intent = decodeIntent(checked(raw)); intents.push(intent);
    const next = frame(intent[1] + 1); next[5] = 0; return bytes(next);
  }, options = {}) {
    const root = document.createElement('main'); document.body.append(root); roots.push(root);
    const listeners = new Map(), add = root.addEventListener.bind(root), remove = root.removeEventListener.bind(root);
    root.addEventListener = (type, listener, ...rest) => { listeners.set(type, listener); add(type, listener, ...rest); };
    root.removeEventListener = (type, listener, ...rest) => { if (listeners.get(type) === listener) listeners.delete(type); remove(type, listener, ...rest); };
    const view = openPresentation({root, labels: sourceLabels, dispatch, maximum: PRESENTATION_MAXIMUM,
      requestMaximum: PRESENTATION_MAXIMUM, ...options}); views.push(view);
    return {root, view, listeners, input: () => root.querySelector('input'), form: () => root.querySelector('form'),
      textarea: () => root.querySelector('textarea'), select: () => root.querySelector('select'),
      buttons: () => [...root.querySelectorAll('button')], alert: () => root.querySelector('[role=alert]')?.textContent};
  }
  const edit = (control, value) => { control.value = value; control.dispatchEvent(new Event('input', {bubbles: true})); };
  const phase = (value, state) => {
    value[2] = state; value[5] = 0;
    for (const [, content] of value[6]) {
      if ([5, 6, 7, 10].includes(content[0])) content[2] = false;
      if (content[0] === 8) content[3] = false;
    }
    return value;
  };
  try {
    const first = open(); paint(first.view, frame());
    check(Object.isFrozen(first.view) && Object.keys(first.view).sort().join(',') === 'close,render', 'closed presentation API');
    check(first.root.querySelector('section').getAttribute('aria-label') === labels[0].text, 'catalogue preserves BOM and hostile text');
    check(first.root.querySelector('h2').textContent === 'Heading', 'generated semantic heading');
    check(first.root.querySelector('nav').getAttribute('aria-label') === 'Navigation', 'generated semantic navigation');
    check(first.root.querySelector('caption').textContent === 'Caption'
      && first.root.querySelector('th').scope === 'col', 'semantic table caption and column');
    check(first.root.textContent.includes('\uFEFFdynamic <script>') && first.root.textContent.includes('\uFEFFtable 😀'), 'dynamic Unicode is exact text');
    check(!first.root.querySelector('img,svg,script,a,[style],[href],[src],[id]')
      && globalThis.presentationInjected === undefined, 'text-only closed DOM has no executable sink');
    check(first.input().labels[0].textContent === 'Input' && first.select().labels[0].textContent.includes('Choice'), 'native associated labels');
    check(document.activeElement === first.input() && first.root.querySelector('[role=status]').getAttribute('aria-live') === 'polite', 'generated focus/live');
    cases.push('semantic-safe-text-catalogue-focus-live');

    {
      const announcements = open(), writes = [];
      const textDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      try {
        Object.defineProperty(Node.prototype, 'textContent', {...textDescriptor, set(value) {
          writes.push({node: this, value, connected: this.isConnected, role: this.getAttribute?.('role')});
          textDescriptor.set.call(this, value);
        }});
        paint(announcements.view, frame(1, 0, 0));
      } finally { Object.defineProperty(Node.prototype, 'textContent', textDescriptor); }
      const status = announcements.root.querySelector('[data-presentation-status]');
      check(writes.some(row => row.node === status && row.value === 'Status' && row.connected && row.role === 'status'),
        'status region must be connected with its role before message insertion');
      check(status.getAttribute('aria-atomic') === 'true', 'status region explicitly announces the complete message');
      const observer = new MutationObserver(() => {});
      observer.observe(announcements.root, {subtree: true, childList: true, characterData: true});
      const unchanged = frame(2, 0, 0);
      paint(announcements.view, unchanged);
      const retained = observer.takeRecords();
      check(announcements.root.querySelector('[data-presentation-status]') === status
        && !retained.some(row => [...row.removedNodes].includes(status)), 'status region stays connected across revisions');
      check(!retained.some(row => row.target === status || status.contains(row.target)),
        'unchanged status text has no duplicate mutation');
      paint(announcements.view, unchanged);
      check(observer.takeRecords().length === 0, 'identical frame has no announcement mutation');
      const external = document.createElement('button'); external.textContent = 'Outside';
      document.body.append(external); external.focus();
      for (const [revision, phaseValue, statusLabel, mode] of [[3, 1, 4, 1], [4, 2, 12, 2], [5, 0, 13, 1], [6, 3, 0, 0]]) {
        const next = frame(revision, phaseValue, 0); next[3] = statusLabel; next[4] = mode;
        paint(announcements.view, next);
        const records = observer.takeRecords();
        check(announcements.root.querySelector('[data-presentation-status]') === status
          && !records.some(row => [...row.removedNodes].includes(status)), 'lifecycle never disconnects status region');
        check(status.textContent === (statusLabel ? labels[statusLabel - 1].text : '')
          && status.getAttribute('aria-live') === ['off', 'polite', 'assertive'][mode], 'status reflects exact modeled text and live mode');
        check(document.activeElement === external, 'status updates never acquire focus');
      }
      observer.disconnect(); external.remove();
      cases.push('connected-atomic-status-lifecycle-and-idempotence');
    }

    const before = first.root.innerHTML, originalControl = first.input();
    for (const mutate of [
      value => { value[6][0][1][1] = 255; },
      value => { value[3] = 256; },
      value => { value[6][7][1][5][0][1] = 255; },
      value => { value[6][10][1][2][0] = 255; },
    ]) {
      const invalid = frame(2); mutate(invalid); failure(() => first.view.render(bytes(invalid)), 'labels');
      check(first.root.innerHTML === before && first.input() === originalControl, 'catalogue failure precedes all DOM mutation');
    }
    for (const mutate of [
      value => { value[6][5][1][0] = 10; },
      value => { value[6][0][0] = 1; },
      value => { value[6][9][1][5] = [7, 6]; },
      value => { value[2] = 1; },
    ]) {
      const invalid = frame(2); mutate(invalid);
      failure(() => first.view.render(checked(encodeWire(invalid), false)));
      check(first.root.innerHTML === before && first.input() === originalControl, 'shape/lifecycle rejection precedes mutation');
    }
    const altered = frame(); altered[6][3][1][1] = 'changed equal revision';
    failure(() => first.view.render(bytes(altered)), 'stale');
    failure(() => first.view.render(bytes(frame(0))), 'stale');
    first.view.render(bytes(frame()));
    check(first.input() === originalControl && first.root.innerHTML === before, 'byte-identical repeat is idempotent');
    cases.push('full-validation-stale-and-secret-rejection-before-mutation');

    edit(first.input(), 'retained 😀'); first.input().focus(); first.input().setSelectionRange(1, 4);
    const next = frame(2); next[5] = 0; paint(first.view, next);
    check(first.input() === originalControl && first.input().value === 'retained 😀', 'keyed edits survive unchanged generated defaults');
    check(document.activeElement === originalControl && originalControl.selectionStart === 1 && originalControl.selectionEnd === 4, 'keyed focus and selection survive');
    next[1] = 3; next[6][5][1][5] = 'source reset'; paint(first.view, next);
    check(first.input().value === 'source reset', 'changed generated default resets edits');
    check(document.activeElement === originalControl && originalControl.selectionStart === 'source reset'.length
      && originalControl.selectionEnd === 'source reset'.length, 'same-kind reset retains focus without restoring stale draft selection');
    const pending = phase(frame(4), 1); pending[4] = 2; paint(first.view, pending);
    check(first.root.getAttribute('aria-busy') === 'true'
      && [...first.root.querySelectorAll('input,textarea,select,button')].every(node => node.disabled), 'pending controls are natively disabled');
    check(first.root.querySelector('[role=status]').getAttribute('aria-live') === 'assertive', 'assertive live mode');
    const pendingSubmits = intents.length;
    first.form().dispatchEvent(new SubmitEvent('submit', {bubbles: true, cancelable: true,
      submitter: first.buttons()[1]})); await tick();
    check(intents.length === pendingSubmits && first.alert() === 'Unable to submit this request.',
      'programmatic submit cannot bypass modeled pending phase');
    paint(first.view, phase(frame(5), 2));
    check(first.root.getAttribute('aria-busy') === 'false', 'replay-required is not fabricated pending');
    paint(first.view, phase(frame(6), 3)); failure(() => first.view.render(bytes(frame(7))), 'closed');
    const kinds = open(); paint(kinds.view, frame());
    const newKind = frame(2); newKind[5] = 0; newKind[6][5][1][0] = 6; paint(kinds.view, newKind);
    const changedControl = kinds.root.querySelector('[data-presentation-node="6"] textarea');
    check(document.activeElement !== changedControl, 'changed control kind cannot inherit implicit focus');
    newKind[1] = 3; newKind[5] = 6; paint(kinds.view, newKind);
    check(document.activeElement === changedControl, 'explicit modeled focus can select a changed control kind');
    cases.push('keyed-edit-focus-reset-and-modeled-lifecycle');

    const emptyDraft = (revision, epoch) => {
      const value = frame(revision); value[5] = 0;
      for (const [, content] of value[6]) {
        if ([5, 6, 7].includes(content[0])) content[6] = epoch;
        if ([5, 6].includes(content[0])) content[5] = '';
      }
      return value;
    };
    const sent = [], reset = open(raw => { sent.push(decodeIntent(checked(raw))); return bytes(emptyDraft(2, 1)); });
    paint(reset.view, emptyDraft(1, 0)); edit(reset.input(), 'sent message'); edit(reset.textarea(), 'sent body');
    reset.buttons()[1].click(); await tick();
    check(sent.length === 1 && reset.input().value === '' && reset.textarea().value === '', 'modeled draft epoch clears sent fields to the identical empty default');
    edit(reset.input(), 'organization A draft'); edit(reset.textarea(), 'A notes'); edit(reset.select(), '20');
    paint(reset.view, emptyDraft(3, 1));
    check(reset.input().value === 'organization A draft' && reset.textarea().value === 'A notes'
      && reset.select().value === '20', 'ordinary revisions retain the same draft epoch');
    paint(reset.view, emptyDraft(4, 2));
    check(reset.input().value === '' && reset.textarea().value === '' && reset.select().value === '10', 'new organization epoch resets unchanged defaults and selection');
    const oldReply = deferred(), context = open(raw => { checked(raw); return oldReply.promise; });
    paint(context.view, emptyDraft(1, 0)); edit(context.input(), 'old organization'); context.buttons()[0].click();
    paint(context.view, emptyDraft(2, 1)); edit(context.input(), 'new organization draft');
    oldReply.resolve(bytes(emptyDraft(3, 0))); await tick();
    check(context.input().value === 'new organization draft', 'higher-revision result from stale draft context cannot overwrite current draft');
    cases.push('source-owned-draft-reset-context-and-stale-response');

    const exactDefaults = [], defaults = open(raw => {
      exactDefaults.push(decodeIntent(checked(raw))); return bytes(frame(exactDefaults.length + 1));
    });
    const original = frame(); original[6][5][1][5] = '\uFEFFone\r\ntwo\nthree'; paint(defaults.view, original);
    defaults.buttons()[1].click(); await tick();
    check(exactDefaults[0][3][0][1] === '\uFEFFone\r\ntwo\nthree'
      && exactDefaults[0][3][1][1] === '\uFEFFfirst\r\nsecond', 'untouched defaults retain exact LF/CRLF/BOM bytes');
    edit(defaults.input(), 'edited\nline'); edit(defaults.textarea(), '\uFEFFedited\r\nline');
    const actualInput = defaults.input().value, actualMultiline = defaults.textarea().value;
    defaults.buttons()[1].click(); await tick();
    check(exactDefaults[1][3][0][1] === actualInput && exactDefaults[1][3][1][1] === actualMultiline, 'edited intent uses actual browser text without invented normalization');
    cases.push('exact-default-bytes-and-native-edited-values');

    let submits = 0;
    const bounded = open(raw => { submits++; checked(raw); return bytes(frame(2)); }); paint(bounded.view, frame());
    for (const value of ['', 'é'.repeat(33), '\ud800']) {
      edit(bounded.input(), value); bounded.buttons()[0].click(); await tick();
      check(submits === 0 && bounded.alert() === 'Unable to submit this request.', 'required/UTF8 byte/surrogate rejection prevents dispatch');
    }
    const small = open(() => { throw Error('must not dispatch'); }, {requestMaximum: 1}); paint(small.view, frame());
    small.buttons()[0].click(); await tick(); check(small.alert() === 'Unable to submit this request.', 'exact primary request maximum enforced');
    const selected = [], choices = open(raw => { const intent = decodeIntent(checked(raw)); selected.push(intent); return bytes(frame(intent[1] + 1)); });
    paint(choices.view, frame()); edit(choices.select(), '20'); const preserved = frame(2); preserved[5] = 0; paint(choices.view, preserved);
    check(choices.select().value === '20', 'keyed selection survives same generated default');
    choices.buttons()[1].click(); await tick();
    check(JSON.stringify(selected[0][3].map(field => field[0])) === '[6,7,8]' && selected[0][3][2][1] === 20, 'intent captures exact modeled field order and chosen identifier');
    const changed = frame(4); changed[6][7][1][4] = 20; paint(choices.view, changed);
    check(choices.select().value === '20', 'generated selection is applied');
    edit(choices.select(), ''); choices.buttons()[1].click(); await tick(); check(selected.length === 1, 'required no-selection rejects');
    cases.push('required-utf8-request-bounds-and-choice-bindings');

    const waiting = deferred(); let asynchronous = 0, asyncView;
    asyncView = open(raw => { checked(raw); asynchronous++; asyncView.buttons()[0].click(); return waiting.promise; });
    paint(asyncView.view, frame()); asyncView.buttons()[0].click(); asyncView.buttons()[0].click();
    check(asynchronous === 1, 'synchronous reentrant and pending duplicate submissions are serialized');
    paint(asyncView.view, frame(3)); const afterNew = asyncView.root.innerHTML;
    waiting.resolve(bytes(frame(2))); await tick();
    check(asyncView.root.querySelector('section') && asyncView.input().value === 'initial'
      && asyncView.root.innerHTML.replace('Unable to submit this request.', '') === afterNew, 'late older result cannot replace newer manually rendered frame');
    check(asyncView.alert() === '' && asyncView.root.innerHTML === afterNew,
      'stale async result cannot write a diagnostic into the newer context');
    const throws = open(() => { throw Error('private secret that must not appear'); }); paint(throws.view, frame());
    throws.buttons()[0].click(); await tick(); check(throws.alert() === 'Unable to submit this request.'
      && !throws.root.textContent.includes('private secret'), 'dispatcher errors never echo details');
    cases.push('serialized-reentrancy-stale-results-and-private-diagnostics');

    const late = deferred(); let closedCalls = 0;
    const closing = open(raw => { checked(raw); closedCalls++; return late.promise; }); paint(closing.view, frame());
    const heldButton = closing.buttons()[0]; heldButton.click(); closing.view.close();
    check(closing.listeners.size === 0, 'terminal close removes each actual native listener');
    const replacement = openPresentation({root: closing.root, labels, dispatch: () => { throw Error('not used'); },
      maximum: PRESENTATION_MAXIMUM, requestMaximum: PRESENTATION_MAXIMUM}); views.push(replacement);
    paint(replacement, frame(9)); const reopened = closing.root.innerHTML;
    closing.view.close(); late.resolve(bytes(frame(2))); heldButton.click(); await tick();
    check(closing.root.innerHTML === reopened && closedCalls === 1, 'closed view and late result cannot disturb a new owner of the root');
    failure(() => closing.view.render(bytes(frame(10))), 'closed');
    cases.push('terminal-close-listeners-late-result-and-root-ownership');

    for (const boundary of ['initial-status-mount', 'retained-child-removal']) {
      const item = open(); let invoked = 0, restore;
      if (boundary === 'initial-status-mount') {
        const original = CharacterData.prototype.replaceWith;
        CharacterData.prototype.replaceWith = function(...args) {
          if (this.nodeType === Node.COMMENT_NODE && this.data === 'presentation status') {
            invoked++; throw Error('synthetic status mount failure');
          }
          return original.apply(this, args);
        };
        restore = () => { CharacterData.prototype.replaceWith = original; };
      } else {
        paint(item.view, frame(1, 0, 0));
        const child = [...item.root.children].find(node => !node.hasAttribute('data-presentation-status'));
        const original = child.remove;
        child.remove = () => { invoked++; throw Error('synthetic retained child removal failure'); };
        restore = () => { child.remove = original; };
      }
      try { failure(() => paint(item.view, frame(2, 0, 0)), 'dom'); }
      finally { restore(); }
      check(invoked === 1 && item.root.childElementCount === 0 && item.listeners.size === 0,
        boundary + ' terminates ownership, clears partial content and removes listeners');
      failure(() => paint(item.view, frame(3, 0, 0)), 'closed');
    }
    cases.push('status-mount-and-retained-removal-failure-are-terminal');

    const brands = open(); const protectedBytes = bytes(frame());
    for (const name of ['buffer', 'byteLength', 'byteOffset', 'length']) Object.defineProperty(protectedBytes, name, {get() { throw Error('shadow getter evaluated'); }});
    brands.view.render(protectedBytes);
    const detached = bytes(frame(2)); structuredClone(detached.buffer, {transfer: [detached.buffer]});
    const brandsBefore = brands.root.innerHTML; failure(() => brands.view.render(detached), 'bytes');
    // Some browser builds hide the global constructor but still expose genuine
    // shared Wasm memory. That native brand must be rejected in every engine.
    const sharedBuffers = [new WebAssembly.Memory({initial: 1, maximum: 1, shared: true}).buffer];
    check(Object.prototype.toString.call(sharedBuffers[0]) === '[object SharedArrayBuffer]',
      'genuine shared Wasm memory is required');
    if (typeof SharedArrayBuffer === 'function') sharedBuffers.push(new SharedArrayBuffer(8));
    for (const backing of sharedBuffers) {
      const shared = new Uint8Array(backing, 0, 8); Object.defineProperty(shared, 'buffer', {value: new ArrayBuffer(8)});
      failure(() => brands.view.render(shared), 'bytes');
    }
    failure(() => brands.view.render({}), 'bytes'); failure(() => brands.view.render(bytes(frame(2)), true), 'options');
    check(brands.root.innerHTML === brandsBefore, 'native byte-brand failures do not mutate DOM');
    cases.push('native-byte-brands-detached-shared-and-closed-arity');

    let invoked = 0; const hostile = Object.defineProperty({}, 'labels', {get() { invoked++; return labels; }});
    failure(() => openPresentation(hostile)); check(invoked === 0, 'option accessors never execute');
    for (const bad of [[...labels].reverse(), [{id: 'same', text: 'a'}, {id: 'same', text: 'b'}],
      [{id: 'valid', text: '\ud800'}], [{id: 'valid', text: 'é'.repeat(2049)}], [{id: 'valid', text: 'line\nbreak'}]]) {
      failure(() => openPresentation({root: brands.root, labels: bad, dispatch() {}, maximum: 1000, requestMaximum: 1000}));
      check(brands.root.innerHTML === brandsBefore, 'bad catalogue rejected without DOM mutation');
    }
    const accessorLabel = Object.defineProperty({id: 'valid'}, 'text', {get() { invoked++; return 'x'; }});
    failure(() => openPresentation({root: brands.root, labels: [accessorLabel], dispatch() {}, maximum: 1000, requestMaximum: 1000}));
    check(invoked === 0, 'catalogue accessors never execute');
    const capturedLabels = clone(sourceLabels), catalogueView = open(undefined, {labels: capturedLabels});
    capturedLabels[0].text = 'mutated caller catalogue'; capturedLabels.reverse();
    paint(catalogueView.view, frame());
    check(catalogueView.root.querySelector('section').getAttribute('aria-label') === sourceLabels[0].text,
      'complete source catalogue is captured before caller mutation');
    cases.push('closed-options-and-immutable-catalogue-capture');

    const maximal = [1, 1, 0, 0, 0, 0, []], structure = maximal[6];
    for (let id = 1; id <= 16; id++) structure.push([id - 1, [0, 0]]);
    structure.push([0, [2, 4]]);
    for (let id = 18; id <= 33; id++) structure.push([17, [5, 6, true, false, 1, 'x', 0]]);
    structure.push([17, [7, 2, true, false, 1, Array.from({length: 256}, (_, index) => [index + 1, 9]), 0]]);
    for (let id = 1; id <= 64; id++) structure.push([17, [8, 3, id, true, id === 1, Array.from({length: 16}, (_, index) => index + 18)]]);
    structure.push([0, [9, 1, Array(16).fill(13), Array.from({length: 256}, () => Array(16).fill('x'))]]);
    while (structure.length < 256) structure.push([0, [4, 'x']]);
    const allBounds = open(); paint(allBounds.view, maximal);
    check(allBounds.root.querySelectorAll('[data-presentation-node]').length === 256
      && allBounds.buttons().length === 64 && allBounds.select().options.length === 257
      && allBounds.root.querySelectorAll('tbody td').length === 4096
      && allBounds.root.querySelectorAll('th').length === 16, 'combined node/depth/action/binding/choice/table maxima are actually rendered');
    const allBoundsBefore = allBounds.root.innerHTML;
    for (const mutate of [
      value => { value[6].push([0, [4, 'overflow']]); },
      value => { value[6][16][0] = 16; },
      value => { value[6][33][1][5].push([257, 9]); },
      value => { value[6][255] = [17, [8, 3, 65, true, false, []]]; },
    ]) {
      const invalid = clone(maximal); invalid[1] = 2; mutate(invalid);
      failure(() => allBounds.view.render(checked(encodeWire(invalid), false)));
      check(allBounds.root.innerHTML === allBoundsBefore, 'combined-bound rejection is atomic');
    }
    cases.push('combined-structural-maxima-and-overruns');

    let progress;
    progress = open((raw, token) => {
      checked(raw); progressPresentation(progress.view, token, bytes(frame(2, 1, 0)));
      progressPresentation(progress.view, token, bytes(frame(3, 1, 0)));
      return bytes(frame(4, 0, 0));
    });
    paint(progress.view, frame()); progress.buttons()[0].click(); await tick();
    check(progress.root.getAttribute('aria-busy') === 'false' && progress.alert() === ''
      && !progress.buttons()[0].disabled, 'legitimate Pending progress must preserve its final dispatch correlation');
    cases.push('private-dispatch-pending-progress-and-final-correlation');

    const transitions = [
      [1, 0, 2, 1], [2, 1, 3, 1], [1, 0, 2, 0], [2, 1, 3, 2],
      [2, 1, 3, 3], [2, 2, 3, 1], [2, 3, 3, 1], [1, 0, 1, 1],
      [2, 1, 1, 1], [4294967294, 0, 4294967295, 1], [4294967295, 1, 0, 1],
      [1, 0, 2, 4], [1, 4, 2, 1], [1, 0, 4294967296, 1], [2, 1, 2, 1], [0, 0, 4294967295, 1],
    ];
    for (let code = 0; code < transitions.length; code++) {
      const [beforeRevision, beforePhase, afterRevision, afterPhase] = transitions[code];
      const before = phase(expectedFrame(beforeRevision), beforePhase), after = phase(expectedFrame(afterRevision), afterPhase);
      // The typed fixture also exercises invalid Nat fields which cannot enter
      // the public closed wire. Host parsing refuses those before correlation.
      const accepted = [0, 1, 9, 15].includes(code);
      if ([11, 12, 13].includes(code)) failure(() => progressFits(before, after));
      else check(progressFits(before, after) === accepted, 'exact progress phase/revision predicate ' + code);
      if (progressModule) check(equal(execute(progressModule, Uint8Array.of(code), 'progress'),
        Uint8Array.of(accepted ? 245 : 244)), 'actual source progress predicate ' + code);
    }
    cases.push('source-progress-phase-revision-and-uint32-boundaries');

    const leftWait = deferred(), rightWait = deferred(), nextLeftWait = deferred(); let leftToken, rightToken, leftCalls = 0, rightCalls = 0;
    const left = open((raw, token) => {
      checked(raw); leftCalls++; leftToken = token;
      if (leftCalls === 1) { right.buttons()[0].click(); return leftWait.promise; }
      return nextLeftWait.promise;
    });
    const right = open((raw, token) => { checked(raw); rightCalls++; rightToken = token; return rightWait.promise; });
    paint(left.view, frame()); paint(right.view, frame());
    left.buttons()[0].click();
    check(Object.isFrozen(leftToken) && Reflect.ownKeys(leftToken).length === 0
      && leftToken !== rightToken, 'per-dispatch token is opaque and distinct');
    for (const [view, token] of [[left.view, {}], [{}, leftToken], [left.view, rightToken], [right.view, leftToken]]) {
      failure(() => progressPresentation(view, token, {}), 'binding');
    }
    failure(() => progressPresentation(left.view, leftToken), 'options');
    failure(() => progressPresentation(left.view, leftToken, {}, true), 'options');
    progressPresentation(left.view, leftToken, bytes(frame(2, 1, 0)));
    progressPresentation(right.view, rightToken, bytes(frame(2, 1, 0)));
    leftWait.resolve(bytes(frame(3, 0, 0))); rightWait.resolve(bytes(frame(3, 0, 0))); await tick();
    check(leftCalls === 1 && rightCalls === 1 && left.alert() === '' && right.alert() === ''
      && !left.buttons()[0].disabled && !right.buttons()[0].disabled, 'foreign pair cannot revoke either rightful invocation');
    failure(() => progressPresentation(left.view, leftToken, {}), 'binding');
    failure(() => progressPresentation(right.view, rightToken, {}), 'binding');
    const previousLeftToken = leftToken;
    left.buttons()[0].click();
    failure(() => progressPresentation(left.view, previousLeftToken, {}), 'binding');
    progressPresentation(left.view, leftToken, bytes(frame(4, 1, 0)));
    nextLeftWait.resolve(bytes(frame(5, 0, 0))); await tick();
    check(leftCalls === 2 && left.alert() === '' && !left.buttons()[0].disabled,
      'previous token cannot revoke the next invocation of its own adapter');
    cases.push('opaque-token-brands-foreign-pairs-and-terminal-revocation');

    for (const fault of ['ready', 'unknown', 'closed', 'equal', 'older', 'labels', 'structure', 'bytes']) {
      const held = deferred(); let token;
      const item = open((raw, next) => { checked(raw); token = next; return held.promise; });
      paint(item.view, frame()); item.buttons()[0].click();
      progressPresentation(item.view, token, bytes(frame(2, 1, 0)));
      const before = item.root.innerHTML;
      let proposed = frame(3, 1, 0), code = 'binding', raw;
      if (fault === 'ready') proposed = frame(3, 0, 0);
      if (fault === 'unknown') proposed = frame(3, 2, 0);
      if (fault === 'closed') proposed = frame(3, 3, 0);
      if (fault === 'equal' || fault === 'older') { proposed = frame(fault === 'equal' ? 2 : 1, 1, 0); code = 'stale'; }
      if (fault === 'labels') { proposed[6][2][1][2] = 255; code = 'labels'; }
      if (fault === 'structure') proposed[6][0][1].push(0);
      if (fault === 'bytes') { raw = {}; code = 'bytes'; }
      else raw = fault === 'structure' ? encodeWire(proposed) : bytes(proposed);
      failure(() => progressPresentation(item.view, token, raw), fault === 'structure' ? undefined : code);
      check(item.root.innerHTML === before, 'failed progress preflight preserves the complete last-good DOM: ' + fault);
      failure(() => progressPresentation(item.view, token, {}), 'binding');
      held.resolve(bytes(frame(4, 0, 0))); await tick();
      check(item.root.getAttribute('aria-busy') === 'true' && item.buttons()[0].disabled
        && item.alert() === 'Unable to submit this request.', 'failed progress revokes its final result: ' + fault);
    }
    cases.push('invalid-live-progress-atomic-preflight-and-own-result-revocation');

    const unchangedWait = deferred(); let unchangedToken;
    const unchanged = open((raw, token) => { checked(raw); unchangedToken = token; return unchangedWait.promise; });
    paint(unchanged.view, frame()); unchanged.buttons()[0].click();
    const invalidExternal = frame(2); invalidExternal[6][2][1][2] = 255;
    failure(() => paint(unchanged.view, invalidExternal), 'labels');
    progressPresentation(unchanged.view, unchangedToken, bytes(frame(2, 1, 0)));
    unchangedWait.resolve(bytes(frame(3, 0, 0))); await tick();
    check(unchanged.alert() === '' && !unchanged.buttons()[0].disabled, 'failed external preflight leaves rightful progress live');
    for (const external of ['identical', 'new-ready', 'unknown', 'closed']) {
      const held = deferred(); let token, count = 0;
      const item = open((raw, next) => {
        checked(raw); token = next; count++;
        return count === 1 ? held.promise : bytes(frame(5, 0, 0));
      });
      paint(item.view, frame()); item.buttons()[0].click();
      const next = external === 'identical' ? frame() : frame(3, external === 'unknown' ? 2 : external === 'closed' ? 3 : 0, 0);
      paint(item.view, next); const before = item.root.innerHTML;
      failure(() => progressPresentation(item.view, token, {}), 'binding');
      item.buttons()[0].click(); check(count === 1, 'external render does not release pending single-flight');
      held.resolve(bytes(frame(4, 0, 0))); await tick();
      check(item.root.innerHTML === before,
        'external context cannot be reset by a late result: ' + external);
      if (external === 'identical' || external === 'new-ready') {
        item.buttons()[0].click(); await tick();
        check(count === 2 && item.alert() === '', 'single-flight releases only after original settlement');
      }
    }
    cases.push('external-context-identical-refresh-and-terminal-phase-correlation');

    for (const mode of ['fulfill', 'reject', 'throw']) {
      const held = deferred(); let item, replacement;
      item = open(raw => {
        checked(raw); paint(item.view, frame(3, 0, 0)); replacement = item.root.innerHTML;
        if (mode === 'throw') throw Error('synthetic old context failure');
        return held.promise;
      });
      paint(item.view, frame()); item.buttons()[0].click();
      if (mode === 'fulfill') held.resolve(bytes(frame(4, 0, 0)));
      if (mode === 'reject') held.reject(Error('synthetic old context failure'));
      await tick();
      check(item.root.innerHTML === replacement && item.alert() === '',
        'old fulfillment/rejection/synchronous throw cannot mutate a replacement diagnostic: ' + mode);
    }
    for (const mode of ['reject', 'throw']) {
      let item;
      item = open((raw, token) => {
        checked(raw); progressPresentation(item.view, token, bytes(frame(2, 1, 0)));
        if (mode === 'throw') throw Error('synthetic current context failure');
        return Promise.reject(Error('synthetic current context failure'));
      });
      paint(item.view, frame()); item.buttons()[0].click(); await tick();
      check(item.root.getAttribute('aria-busy') === 'true' && item.alert() === 'Unable to submit this request.',
        'failure diagnostic remains owned by the same accepted progress context: ' + mode);
    }
    cases.push('diagnostics-belong-only-to-the-correlated-render-context');

    let retiredToken, focusRetired = 0, retired;
    retired = open((raw, token) => {
      checked(raw); retiredToken = token;
      progressPresentation(retired.view, token, bytes(frame(2, 1, 0)));
      retired.root.addEventListener('focus', () => {
        failure(() => progressPresentation(retired.view, token, {}), 'binding'); focusRetired++;
      }, {capture: true, once: true});
      return bytes(frame(3, 0, 6));
    });
    paint(retired.view, frame()); retired.buttons()[0].click(); await tick();
    check(focusRetired === 1 && retired.alert() === '', 'sole final result retires progress before native focus reentrance');
    failure(() => progressPresentation(retired.view, retiredToken, {}), 'binding');
    for (const mode of ['throw', 'reject', 'close']) {
      let token; const held = deferred();
      const item = open((raw, next) => {
        checked(raw); token = next;
        if (mode === 'throw') throw Error('private detail');
        if (mode === 'reject') return Promise.reject(Error('private detail'));
        return held.promise;
      });
      paint(item.view, frame()); item.buttons()[0].click();
      if (mode === 'close') {
        progressPresentation(item.view, token, bytes(frame(2, 1, 0)));
        item.view.close(); held.resolve(bytes(frame(3)));
      }
      await tick(); failure(() => progressPresentation(item.view, token, {}), 'binding');
      check(mode === 'close' ? item.root.childElementCount === 0 : item.alert() === 'Unable to submit this request.', 'failure/close revokes only its dispatched channel');
    }
    const rejection = deferred(); let rejectedToken, reactionError, reactionCalls = 0;
    const rejectedProgress = open((raw, token) => { checked(raw); rejectedToken = token; return rejection.promise; });
    paint(rejectedProgress.view, frame()); rejectedProgress.buttons()[0].click();
    const observedRejection = rejection.promise.catch(() => {
      reactionCalls++;
      try { failure(() => progressPresentation(rejectedProgress.view, rejectedToken, {}), 'binding'); }
      catch (error) { reactionError = error; }
    });
    rejection.reject(Error('synthetic failure')); await observedRejection; await tick();
    check(reactionCalls === 1 && !reactionError && rejectedProgress.alert() === 'Unable to submit this request.',
      'first rejection observation retires progress before a separately registered reaction');
    cases.push('progress-final-throw-reject-close-and-native-focus-retirement');

    const reentrantWait = deferred(); let reentrantToken, reentrantCount = 0;
    const reentrant = open((raw, token) => { checked(raw); reentrantToken = token; reentrantCount++; return reentrantWait.promise; });
    paint(reentrant.view, frame()); reentrant.buttons()[0].click();
    reentrant.buttons()[0].click(); check(reentrantCount === 1, 'progress invocation remains single-flight');
    let focusReentry = 0;
    reentrant.root.addEventListener('focus', () => {
      failure(() => progressPresentation(reentrant.view, reentrantToken, bytes(frame(3, 1, 0))), 'binding'); focusReentry++;
    }, {capture: true, once: true});
    const focusedProgress = frame(2, 1, 3);
    progressPresentation(reentrant.view, reentrantToken, bytes(focusedProgress));
    check(focusReentry === 1, 'actual native focus exercises same-token progress reentrance');
    failure(() => progressPresentation(reentrant.view, reentrantToken, {}), 'binding');
    reentrantWait.resolve(bytes(frame(4, 0, 0))); await tick();
    check(reentrant.buttons()[0].disabled && reentrant.alert() === 'Unable to submit this request.', 'reentrant invalid progress cannot regain a final outcome');
    const brokenWait = deferred(); let brokenToken;
    const broken = open((raw, token) => { checked(raw); brokenToken = token; return brokenWait.promise; });
    paint(broken.view, frame()); broken.buttons()[0].click();
    const append = broken.root.append;
    broken.root.append = function(...args) {
      broken.root.append = append; throw Error('synthetic native DOM failure');
    };
    failure(() => progressPresentation(broken.view, brokenToken, bytes(frame(2, 1, 0))), 'dom');
    check(broken.root.childElementCount === 0 && broken.listeners.size === 0, 'internal progress DOM failure terminates and clears instead of promising rollback');
    failure(() => progressPresentation(broken.view, brokenToken, {}), 'binding');
    brokenWait.resolve(bytes(frame(3))); await tick();
    check(broken.root.childElementCount === 0, 'internal render failure cannot be reopened by late dispatch');
    cases.push('progress-reentrance-and-terminal-internal-dom-failure');


    const withoutSink = open(); paint(withoutSink.view, frame());
    const prior = withoutSink.root.innerHTML;
    for (const state of [0, 1, 2, 3]) {
      failure(() => paint(withoutSink.view, secretFrame(2, state)), 'binding');
      check(withoutSink.root.innerHTML === prior, 'missing secret sink refuses complete frame before DOM mutation');
    }
    let accessedSecretSink = 0;
    const accessorSink = {root: document.createElement('main'), labels, dispatch() {}, maximum: 1000, requestMaximum: 1000};
    Object.defineProperty(accessorSink, 'secretDispatch', {get() { accessedSecretSink++; return () => {}; }});
    failure(() => openPresentation(accessorSink), 'options');
    check(accessedSecretSink === 0, 'secret sink accessors never execute');
    for (const secretDispatch of [undefined, null, {}, true]) failure(() => open(undefined, {secretDispatch}), 'options');
    cases.push('secret-sink-admission-and-closed-options');

    let ordinaryCalls = 0, secretCalls = 0, secrets;
    secrets = open(() => { ordinaryCalls++; throw Error('secret escaped ordinary dispatch'); }, {secretDispatch(raw) {
      secretCalls++;
      check(secrets.input().value === '', 'secret controls clear synchronously before the private sink');
      const intent = secretRoute(raw); check(intent[3][0][1] === '😀'.repeat(16), 'exact maximum UTF8 secret capture');
      secrets.buttons()[1].click();
      return secretSink(raw);
    }});
    paint(secrets.view, secretFrame()); const password = secrets.input();
    check(password.type === 'password' && password.labels[0].textContent === 'Input'
      && password.required && password.autocomplete === 'off' && password.spellcheck === false
      && !password.hasAttribute('value') && password.value === '', 'labeled native password has no modeled default');
    for (const invalid of ['', '😀'.repeat(16) + 'x', '\ud800']) {
      edit(password, invalid); secrets.buttons()[1].click(); await tick();
      check(secretCalls === 0 && ordinaryCalls === 0, 'invalid secret never reaches any sink');
    }
    edit(password, '😀'.repeat(16));
    check(!secrets.root.innerHTML.includes('😀'.repeat(16)) && !secrets.root.textContent.includes('😀'.repeat(16)), 'secret input is never rendered as content or a value attribute');
    secrets.buttons()[1].click(); await tick();
    check(secretCalls === 1 && ordinaryCalls === 0 && secrets.input().value === '', 'source-owned secret route is serialized and sink response never restores secret');
    const ordinary = open(raw => {
      ordinaryCalls++; secretRoute(raw, false); return bytes(secretFrame(2));
    }, {secretDispatch() { throw Error('ordinary action was sent to secret sink'); }});
    paint(ordinary.view, secretFrame()); edit(ordinary.input(), 'unused secret'); ordinary.buttons()[0].click(); await tick();
    check(ordinaryCalls === 1, 'only source-bound secret-bearing actions use the private sink');
    cases.push('secret-source-classification-capture-clearing-and-nonsecret-output');

    const lifecycle = open(undefined, {secretDispatch: secretSink}); paint(lifecycle.view, secretFrame());
    const heldPassword = lifecycle.input(); edit(heldPassword, 'unsubmitted draft');
    paint(lifecycle.view, secretFrame(2)); check(heldPassword.value === 'unsubmitted draft', 'same ready epoch retains only live unsubmitted draft');
    paint(lifecycle.view, secretFrame(3, 0, 1)); check(heldPassword.value === '', 'new secret draft epoch clears old context');
    for (const state of [1, 2]) {
      edit(heldPassword, 'phase secret'); paint(lifecycle.view, secretFrame(4 + state * 2, state, 1));
      check(heldPassword.value === '', 'modeled non-ready lifecycle clears held secret');
      paint(lifecycle.view, secretFrame(5 + state * 2, 0, 1)); check(lifecycle.input().value === '', 'ready return never resurrects prior secret');
    }
    edit(heldPassword, 'closed secret'); lifecycle.view.close();
    check(heldPassword.value === '' && lifecycle.listeners.size === 0, 'explicit close clears held detached password and listeners');
    for (const change of ['remove', 'kind', 'maximum', 'label', 'closed']) {
      const item = open(undefined, {secretDispatch: secretSink}); paint(item.view, secretFrame());
      const held = item.input(); edit(held, 'discarded context');
      const next = change === 'closed' ? secretFrame(2, 3) : secretFrame(2);
      if (change === 'remove') { next[6][5][1] = [4, 'removed']; next[6][9][1][5] = [7, 8]; }
      if (change === 'kind') next[6][5][1] = [5, 6, true, true, 64, '', 0];
      if (change === 'maximum') next[6][5][1][4] = 63;
      if (change === 'label') next[6][5][1][1] = 5;
      paint(item.view, next); check(held.value === '', 'secret replacement or policy change clears previous control');
    }
    cases.push('secret-epoch-lifecycle-policy-removal-and-close-clearing');

    for (const rejected of [false, true]) {
      let item;
      item = open(() => { throw Error('ordinary dispatch forbidden'); }, {secretDispatch(raw) {
        secretRoute(raw); check(item.input().value === '', 'secret cleared before failing sink');
        if (rejected) return Promise.reject(Error('synthetic secret error payload'));
        throw Error('synthetic secret error payload');
      }});
      paint(item.view, secretFrame()); edit(item.input(), 'synthetic'); item.buttons()[1].click(); await tick();
      check(item.input().value === '' && item.alert() === 'Unable to submit this request.'
        && !item.root.textContent.includes('synthetic secret error'), 'sink failure neither restores nor echoes secret');
    }
    const delayedSecret = deferred(); let lateSecretCalls = 0;
    const secretClosing = open(() => { throw Error('ordinary dispatch forbidden'); }, {secretDispatch(raw) {
      secretRoute(raw); lateSecretCalls++; return delayedSecret.promise;
    }});
    paint(secretClosing.view, secretFrame()); const latePassword = secretClosing.input();
    edit(latePassword, 'synthetic'); secretClosing.buttons()[1].click(); secretClosing.view.close();
    delayedSecret.resolve(bytes(secretFrame(2, 0, 1))); await tick();
    check(lateSecretCalls === 1 && latePassword.value === '' && secretClosing.root.childElementCount === 0, 'closed secret sink completion cannot restore content or authority');
    cases.push('secret-sink-failure-and-late-completion-no-echo');

    let privateProgress, ephemeralCalls = 0;
    privateProgress = open(() => { throw Error('secret reached ordinary dispatch'); }, {secretDispatch(raw, token) {
      ephemeralCalls++; secretRoute(raw); check(privateProgress.input().value === '', 'private progress starts after secret clearing');
      // Only the source-produced nonsecret result survives this synchronous
      // sink. The token and retained completion closure contain no raw intent.
      const sanitized = secretSink(raw);
      check(equal(sanitized, bytes(secretFrame(2, 0, 1))), 'source sink produces the complete nonsecret result');
      progressPresentation(privateProgress.view, token, bytes(secretFrame(2, 1, 1)));
      return bytes(secretFrame(3, 0, 1));
    }});
    paint(privateProgress.view, secretFrame()); edit(privateProgress.input(), 'synthetic');
    privateProgress.buttons()[1].click(); await tick();
    check(ephemeralCalls === 1 && privateProgress.input().value === '' && privateProgress.alert() === ''
      && !privateProgress.root.textContent.includes('synthetic'), 'ephemeral secret progress retains only nonsecret presentation');
    cases.push('ephemeral-secret-progress-with-nonsecret-final-result');

    const keyboardCalls = [], keyboard = open(raw => {
      const intent = decodeIntent(checked(raw)); keyboardCalls.push(intent);
      const next = frame(intent[1] + 1); next[5] = 0; return bytes(next);
    }); paint(keyboard.view, frame());
    keyboard.root.dataset.keyboardPresentation = '';
    const secretKeyboardCalls = [], secretKeyboard = open(() => { throw Error('keyboard secret escaped ordinary dispatch'); },
      {secretDispatch(raw) { secretKeyboardCalls.push(secretRoute(raw)); return secretSink(raw); }});
    paint(secretKeyboard.view, secretFrame()); secretKeyboard.root.dataset.keyboardSecret = '';
    globalThis.__presentationJourney = {
      count: () => keyboardCalls.length,
      secretCount: () => secretKeyboardCalls.length,
      finish() {
        check(keyboardCalls.length === 2 && keyboardCalls[0][2] === 202 && keyboardCalls[1][2] === 101,
          'actual keyboard uses declared default and explicitly selected button');
        cases.push('actual-native-keyboard-default-and-button-submission');
        check(secretKeyboardCalls.length === 1 && secretKeyboardCalls[0][2] === 202
          && secretKeyboardCalls[0][3][0][1] === 'synthetic keyboard secret'
          && secretKeyboard.input().value === '', 'actual password Enter uses source-bound private sink and clears');
        cases.push('actual-native-password-keyboard-secret-submission');
        for (const view of views) view.close(); for (const root of roots) root.remove();
        return {cases, calls, maxMemory, modelChecked: Boolean(module && fixtureModule && labelsModule), keyboard: keyboardCalls};
      },
    };
    return {cases, modelChecked: Boolean(module && fixtureModule && labelsModule)};
  } catch (error) {
    for (const view of views) view.close(); for (const root of roots) root.remove();
    throw error;
  }
}

export async function runMaximumFixture(input) {
  check(Array.isArray(input?.wire), 'maximum acceptance requires actual generated codec');
  const module = await WebAssembly.compile(new Uint8Array(input.wire));
  check(WebAssembly.Module.imports(module).length === 0, 'actual maximum codec is import-free');
  const {exports: {memory, holo_alloc, holo_run}} = new WebAssembly.Instance(module, {});
  const shape = maximumShape(input.id);
  const textLength = PRESENTATION_MAXIMUM - encodeWire(shape.frame).length - 4;
  const text = 'x'.repeat(textLength); shape.setText(text);
  const request = encodeWire(shape.frame);
  check(request.length === PRESENTATION_MAXIMUM, 'whole-frame maximum includes canonical CBOR framing');
  const pointer = holo_alloc(request.length) >>> 0;
  new Uint8Array(memory.buffer, pointer, request.length).set(request);
  const packed = BigInt.asUintN(64, holo_run(pointer, request.length));
  const at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
  check(length === request.length && at + length <= memory.buffer.byteLength, 'actual generated maximum result is bounded');
  const response = new Uint8Array(memory.buffer, at, length);
  check(equal(request, response), 'actual generated maximum round-trip preserves all bytes');
  const digest = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const requestDigest = await digest(request), responseDigest = await digest(response);
  const root = document.createElement('main'); document.body.append(root);
  const view = openPresentation({root, labels, dispatch() { throw Error('maximum display never dispatches'); },
    maximum: PRESENTATION_MAXIMUM, requestMaximum: PRESENTATION_MAXIMUM});
  try {
    view.render(request);
    const content = root.querySelector(shape.selector);
    check(content.textContent === text && content.textContent.length === textLength, 'actual DOM preserves full admitted maximum text');
    view.render(request); check(root.querySelector(shape.selector) === content, 'maximum identical repeat is idempotent');
    let rejected = false;
    try { view.render(new Uint8Array(PRESENTATION_MAXIMUM + 1)); }
    catch (error) { rejected = error instanceof PresentationError && error.code === 'bytes'; }
    check(rejected && root.querySelector(shape.selector) === content, 'over-budget bytes reject before changing maximum DOM');
    return {schema: 'prismpm/private-presentation-maximum/1', id: input.id, frame_length: request.length,
      text_length: textLength, request_sha256: requestDigest, response_sha256: responseDigest,
      maximum_memory: memory.buffer.byteLength, modelChecked: true};
  } finally { view.close(); root.remove(); }
}

export async function runSecretMaximumFixture(input) {
  const modules = {};
  for (const role of ['wire', 'maxsecret', 'maxroute', 'maxsink']) {
    check(Array.isArray(input[role]), 'actual maximum secret artifact ' + role);
    modules[role] = await WebAssembly.compile(new Uint8Array(input[role]));
    check(WebAssembly.Module.imports(modules[role]).length === 0, 'secret maximum artifacts are import-free');
  }
  const observations = []; let maximum = 0;
  function execute(role, request) {
    const {exports: {memory, holo_alloc, holo_run}} = new WebAssembly.Instance(modules[role], {});
    const at = holo_alloc(request.length) >>> 0; new Uint8Array(memory.buffer, at, request.length).set(request);
    const result = BigInt.asUintN(64, holo_run(at, request.length));
    const pointer = Number(result >> 32n), length = Number(result & 0xffffffffn);
    check(length <= PRESENTATION_MAXIMUM && pointer + length <= memory.buffer.byteLength, 'secret maximum generated output bounds');
    const output = new Uint8Array(memory.buffer, pointer, length).slice();
    maximum = Math.max(maximum, memory.buffer.byteLength); return output;
  }
  const frame = execute('maxsecret', encodeWire([1, 1, 0, 0]));
  const decoded = decodePresentation(frame);
  check(decoded[6][5][1][0] === 10 && decoded[6][5][1][4] === PRESENTATION_MAXIMUM, 'actual source supplies full secret limit');
  const empty = [1, 1, 202, [[6, ''], [7, ''], [8, 10]]];
  const textLength = PRESENTATION_MAXIMUM - encodeWire(empty).length - 4;
  const text = 'x'.repeat(textLength), root = document.createElement('main'); document.body.append(root);
  let calls = 0, view;
  const digest = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  view = openPresentation({root, labels, maximum: PRESENTATION_MAXIMUM, requestMaximum: PRESENTATION_MAXIMUM,
    dispatch() { throw Error('maximum secret escaped ordinary dispatch'); }, secretDispatch(raw) {
      calls++; check(raw.length === PRESENTATION_MAXIMUM && root.querySelector('input').value === '', 'maximum framed secret is captured and cleared before sink');
      const echoed = execute('wire', raw); check(equal(echoed, raw), 'actual maximum framed secret codec preserves all bytes');
      const route = execute('maxroute', raw); check(equal(route, Uint8Array.of(245)), 'actual maximum secret route accepts exact binding');
      const result = execute('maxsink', raw);
      observations.push(Promise.all([digest(raw), digest(echoed), digest(route), digest(result)]));
      return result;
    }});
  try {
    view.render(frame); root.querySelector('input').value = text; root.querySelector('textarea').value = '';
    root.querySelectorAll('button')[1].click(); await tick();
    check(calls === 1 && root.querySelector('input').value === '', 'actual maximum private sink returns nonsecret view');
    check(!root.textContent.includes('x'.repeat(1000)) && !root.querySelector('input').hasAttribute('value'), 'maximum secret has no DOM echo');
    const [request, wire, route, sink] = await observations[0];
    // A fresh view keeps the same source-owned revision and policy. Overruns
    // must fail before either private or ordinary dispatch, not be truncated.
    view.close(); let overCalls = 0;
    view = openPresentation({root, labels, maximum: PRESENTATION_MAXIMUM, requestMaximum: PRESENTATION_MAXIMUM,
      dispatch() { overCalls++; }, secretDispatch() { overCalls++; }});
    view.render(frame); const held = root.querySelector('input'); root.querySelector('textarea').value = '';
    for (const value of [text + 'x', 'x'.repeat(PRESENTATION_MAXIMUM + 1)]) {
      held.value = value; root.querySelectorAll('button')[1].click(); await tick();
      check(overCalls === 0 && root.querySelector('[role=alert]').textContent === 'Unable to submit this request.', 'secret frame/field overrun never reaches a sink');
    }
    view.close(); check(held.value === '', 'oversize rejected draft clears on close');
    return {schema: 'prismpm/private-secret-maximum/1', request, wire, route, sink,
      frame_length: PRESENTATION_MAXIMUM, text_length: textLength, maximum_memory: maximum, modelChecked: true};
  } finally { view.close(); root.remove(); }
}

export async function runProgressMaximumFixture(input) {
  const modules = {}, calls = []; let maximum = 0;
  for (const role of ['wire', 'fixture', 'labels', 'maxprogress']) {
    check(Array.isArray(input[role]), 'actual maximum progress artifact ' + role);
    modules[role] = await WebAssembly.compile(new Uint8Array(input[role]));
    check(WebAssembly.Module.imports(modules[role]).length === 0, 'maximum progress artifacts are import-free');
  }
  function execute(role, request, capture = false) {
    const {exports: {memory, holo_alloc, holo_run}} = new WebAssembly.Instance(modules[role], {});
    const at = holo_alloc(request.length) >>> 0; new Uint8Array(memory.buffer, at, request.length).set(request);
    const result = BigInt.asUintN(64, holo_run(at, request.length));
    const pointer = Number(result >> 32n), length = Number(result & 0xffffffffn);
    check(length <= PRESENTATION_MAXIMUM && pointer + length <= memory.buffer.byteLength, 'maximum progress generated result is bounded');
    const output = new Uint8Array(memory.buffer, pointer, length).slice();
    maximum = Math.max(maximum, memory.buffer.byteLength);
    if (capture) calls.push({role, request: hex(request), response: hex(output)});
    return output;
  }
  const catalogueBytes = execute('labels', new Uint8Array(), true);
  const sourceLabels = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(catalogueBytes));
  check(JSON.stringify(sourceLabels) === JSON.stringify(labels), 'maximum progress source catalogue is exact');
  const initial = execute('fixture', encodeWire([1, 1, 0, 0]), true);
  const final = execute('fixture', encodeWire([1, 4, 0, 0]), true);
  const shape = maximumShape('FrameNodesMaximumLast'); shape.frame[2] = 1;
  const textLength = PRESENTATION_MAXIMUM - encodeWire(shape.frame).length - 4;
  const text = 'x'.repeat(textLength); shape.setText(text);
  const digest = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const pending = [], frames = [], predicates = [];
  for (const revision of [2, 3]) {
    shape.frame[1] = revision; const request = encodeWire(shape.frame);
    check(request.length === PRESENTATION_MAXIMUM, 'each progress frame occupies the complete 64 MiB ABI');
    const response = execute('wire', request);
    check(equal(request, response), 'actual generated progress frame preserves every byte');
    frames.push({id: 'ProgressFrame' + revision, request: await digest(request), response: await digest(response)});
    const predicate = execute('maxprogress', request);
    check(equal(predicate, Uint8Array.of(revision === 3 ? 245 : 244)), 'actual compiled dual-maximum progress predicate');
    predicates.push({id: 'ProgressPair' + revision, request: await digest(request), response: await digest(predicate)});
    pending.push(request);
  }
  const over = new Uint8Array(PRESENTATION_MAXIMUM + 1); over.set(pending[1]);
  const root = document.createElement('main'); document.body.append(root); let view;
  const cases = [];
  try {
    for (const failOver of [false, true]) {
      const held = deferred(); let token, submissions = 0;
      view = openPresentation({root, labels: sourceLabels, maximum: PRESENTATION_MAXIMUM, requestMaximum: PRESENTATION_MAXIMUM,
        dispatch(raw, next) {
          submissions++; token = next;
          check(equal(execute('wire', raw, true), raw), 'maximum progress begins with a genuine modeled intent');
          return held.promise;
        }});
      view.render(initial); root.querySelector('button').click();
      check(submissions === 1, 'one maximum progress invocation');
      progressPresentation(view, token, pending[0]);
      let content = root.querySelector(shape.selector);
      check(root.querySelectorAll('[data-presentation-node]').length === 256 && content.textContent === text,
        'first full pending presentation is retained before the next is decoded');
      if (!failOver) {
        progressPresentation(view, token, pending[1]);
        check(root.querySelector(shape.selector).textContent === text && root.getAttribute('aria-busy') === 'true',
          'two full maximum presentations preserve complete content and current Pending correlation');
        held.resolve(final); await tick();
        check(root.getAttribute('aria-busy') === 'false' && root.querySelector('[role=alert]').textContent === ''
          && !root.querySelector('button').disabled, 'maximum progress permits its sole correlated final result');
        cases.push('dual-maximum-progress-and-final');
      } else {
        const before = await digest(new TextEncoder().encode(root.innerHTML)); let error;
        try { progressPresentation(view, token, over); } catch (value) { error = value; }
        check(error instanceof PresentationError && error.code === 'bytes', 'one-over progress refuses the unchanged input cap');
        check(root.querySelector(shape.selector) === content
          && await digest(new TextEncoder().encode(root.innerHTML)) === before, 'one-over progress preserves the complete prior maximum DOM');
        error = undefined;
        try { progressPresentation(view, token, pending[1]); } catch (value) { error = value; }
        check(error instanceof PresentationError && error.code === 'binding', 'one-over revokes that live progress token');
        held.resolve(final); await tick();
        content = root.querySelector(shape.selector);
        check(content.textContent === text && root.getAttribute('aria-busy') === 'true'
          && root.querySelector('[role=alert]').textContent === 'Unable to submit this request.', 'revoked maximum result cannot replace its prior pending frame');
        cases.push('maximum-plus-one-revokes-final');
      }
      view.close();
    }
    return {schema: 'prismpm/private-progress-maximum/1', frames, predicates, over: await digest(over), calls, cases,
      frame_length: PRESENTATION_MAXIMUM, text_length: textLength, maximum_memory: maximum, modelChecked: true};
  } finally { view?.close(); root.remove(); }
}
