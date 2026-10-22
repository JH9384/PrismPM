// Private typed DOM adapter. Display and dispatch never grant effects or roles.
import {bytesCopy} from './identity.mjs';
import {decodePresentation, encodeIntent, validateIntent, presentationRequiresSecret,
  intentRequiresSecret, progressFits, PresentationError,
  PRESENTATION_MAXIMUM} from './presentation-wire.mjs';
import {decodeSemanticPresentation, semanticCatalogueFits, semanticMainNode,
  captureDesignCatalogue} from './semantic-presentation-wire.mjs';
import {semanticStyle} from './semantic-presentation-style.mjs';

const roots = new WeakMap(), presentations = new WeakMap(), progressTokens = new WeakMap(), encoder = new TextEncoder();
let semanticSequence = 0;
const fail = code => { throw new PresentationError(code); };
const errorText = 'Unable to submit this request.';
const exact = (value, keys) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('options');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length
    || keys.some(key => !fields[key] || !('value' in fields[key]))) fail('options');
  return Object.fromEntries(keys.map(key => [key, fields[key].value]));
};
function catalogue(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail('labels');
  const fields = Object.getOwnPropertyDescriptors(value), length = fields.length?.value;
  if (!Number.isInteger(length) || length < 1 || length > 256
    || Reflect.ownKeys(fields).length !== length + 1) fail('labels');
  let previous = '';
  return Object.freeze(Array.from({length}, (_, index) => {
    if (!fields[index] || !('value' in fields[index])) fail('labels');
    const {id, text} = exact(fields[index].value, ['id', 'text']);
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)
      || id <= previous || typeof text !== 'string' || text.length > 4096 || !text.isWellFormed()
      || !text.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(text)
      || encoder.encode(text).length > 4096) fail('labels');
    previous = id;
    return text;
  }));
}
const same = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);

// SDK-private correlation only. Neither object authorizes an application action.
export function progressPresentation(view, token, bytes) {
  if (arguments.length !== 3) fail('options');
  const owner = presentations.get(view), entry = progressTokens.get(token);
  if (!owner || !entry || entry.owner !== owner) fail('binding');
  entry.receive(bytes);
}

export function openPresentation(options) {
  if (arguments.length !== 1) fail('options');
  return open(options, false);
}

// Private envelope entry. The original DK-23 Presentation/Intent wire and API
// stay unchanged; only this entry admits source-owned semantic annotations.
export function openSemanticPresentation(options) {
  if (arguments.length !== 1) fail('options');
  return open(options, true);
}

function open(options, semantic) {
  let root, labels, designs, dispatch, secretDispatch, maximum, requestMaximum;
  try {
    const keys = ['root', 'labels', 'dispatch', 'maximum', 'requestMaximum'];
    if (semantic) keys.push('designs');
    const hasSecretSink = Object.hasOwn(options, 'secretDispatch');
    if (hasSecretSink) keys.push('secretDispatch');
    ({root, labels, designs, dispatch, secretDispatch, maximum, requestMaximum} = exact(options, keys));
    labels = catalogue(labels);
    if (semantic) designs = captureDesignCatalogue(designs);
    for (const bound of [maximum, requestMaximum]) {
      if (!Number.isInteger(bound) || bound < 1 || bound > PRESENTATION_MAXIMUM) fail('limit');
    }
    if (typeof dispatch !== 'function') fail('options');
    if (hasSecretSink && typeof secretDispatch !== 'function') fail('options');
    if (typeof HTMLElement === 'undefined' || !(root instanceof HTMLElement)
      || !root.isConnected || root.closest('form') || roots.has(root)) fail('root');
  } catch (error) {
    if (error instanceof PresentationError) throw error;
    fail('options');
  }
  const document = root.ownerDocument;
  let scope;
  if (semantic) {
    do { scope = 'prismpm-semantic-' + ++semanticSequence; }
    while (document.querySelector(`[id^="${scope}-"],[data-semantic-presentation="${scope}"]`));
  }
  let closed = false, frame, captured, nodes = new Map(), forms = new Map();
  let actionNodes = new Map(), active = null, diagnostic, status, context = {};
  const ownership = {};
  roots.set(root, ownership);
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const report = () => { if (!closed && diagnostic) diagnostic.textContent = errorText; };
  const reportOwned = record => { if (record.context === context) report(); };
  const clearSecrets = () => {
    for (const record of nodes.values()) if (record.tag === 10) record.control.value = '';
  };
  const revoke = record => {
    if (!record) return;
    progressTokens.delete(record.token); record.live = false; record.frame = undefined;
  };
  const stop = clear => {
    closed = true; revoke(active); active = null;
    clearSecrets();
    root.removeEventListener('submit', onSubmit);
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('input', onEdit);
    root.removeEventListener('change', onEdit);
    if (roots.get(root) === ownership) {
      if (clear) {
        roots.delete(root); root.replaceChildren(); root.removeAttribute('aria-busy');
        if (semantic) root.removeAttribute('data-semantic-presentation');
      }
    }
  };
  function onEdit(event) {
    for (const record of nodes.values()) {
      if (record.control === event.target && [5, 6, 7, 11].includes(record.tag)) record.edited = true;
    }
  }
  // Deliberately outside the raw request capture scope. Retained handlers own
  // only one correlation record and the nonsecret accepted presentation.
  function beginDispatch(selected) {
    const record = {token: Object.freeze({}), live: true, frame: selected, context, painting: false};
    active = record;
    progressTokens.set(record.token, {owner: ownership, receive(value) {
      if (closed || active !== record || !record.live) fail('binding');
      if (record.painting) { revoke(record); fail('binding'); }
      try { record.painting = true; paint(value, record, true); }
      catch (error) { revoke(record); throw error; }
      finally { record.painting = false; }
    }});
    return record;
  }
  // This synchronous scope owns only the transient capture. Promise handlers
  // receive no intent, field value or encoded request from the adapter.
  function invoke(selected, action) {
    const fields = action[5].map(id => {
      const record = nodes.get(id), control = record.control;
      let value = control.value;
      if (record.tag === 7 || record.tag === 11) value = value === '' ? 0 : Number(value);
      else if (record.tag !== 10 && !record.edited && value === record.nativeDefault) value = record.defaultValue;
      return [id, value];
    });
    const intent = [1, selected[1], action[2], fields];
    validateIntent(selected, intent);
    const secret = intentRequiresSecret(selected, intent);
    if (secret && !secretDispatch) fail('binding');
    const bytes = encodeIntent(intent, requestMaximum), record = beginDispatch(selected);
    diagnostic.textContent = '';
    if (secret) clearSecrets();
    try { return {record, returned: (secret ? secretDispatch : dispatch)(bytes, record.token)}; }
    catch { revoke(record); reportOwned(record); if (active === record) active = null; return null; }
  }
  function send(actionNode) {
    if (closed || !frame || active !== null) return;
    const attemptedContext = context;
    try {
      const selected = frame, action = selected[6][actionNode - 1]?.[1];
      if (!action || action[0] !== 8) fail('binding');
      // Capture and serialize before entering the private dispatcher, including
      // a synchronous reentrant call. This is not authorization or a phase.
      const invocation = invoke(selected, action);
      if (!invocation) return;
      const {record, returned} = invocation;
      Promise.resolve(returned).then(value => {
        if (closed || active !== record) return;
        if (!record.live || frame !== record.frame) fail('stale');
        // Retire the channel as soon as its sole result is observed, before
        // rendering can trigger native focus listeners or queued reactions.
        revoke(record);
        paint(value, record, false);
      }, () => { revoke(record); throw new PresentationError('binding'); })
        .catch(() => { revoke(record); reportOwned(record); })
        .finally(() => { revoke(record); record.context = undefined; if (active === record) active = null; });
    } catch { if (context === attemptedContext) report(); }
  }
  function onSubmit(event) {
    event.preventDefault();
    if (closed || !frame) return;
    const formId = forms.get(event.target);
    if (!formId) return;
    const submitter = event.submitter;
    const id = submitter ? actionNodes.get(submitter)
      : [...nodes].find(([, record]) => record.tag === 8 && record.parent === formId
        && frame[6][record.id - 1][1][4])?.[0];
    if (!id || nodes.get(id)?.parent !== formId) { report(); return; }
    send(id);
  }
  function onKey(event) {
    if (closed || !frame || event.key !== 'Enter' || event.isComposing
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const record = [...nodes.values()].find(value => [5, 10].includes(value.tag) && value.control === event.target);
    if (!record) return;
    // Native implicit submission picks the first button, not the modeled
    // default. Keep native form submission while selecting the declared one.
    event.preventDefault();
    const selected = [...nodes.values()].find(value => value.tag === 8
      && value.parent === record.parent && frame[6][value.id - 1][1][4]);
    if (selected && !selected.control.disabled) nodes.get(record.parent).element.requestSubmit(selected.control);
  }
  function render(value) {
    if (arguments.length !== 1) fail('options');
    return paint(value, null, false);
  }
  function paint(value, record, progress) {
    if (closed) fail('closed');
    let bytes;
    try { bytes = bytesCopy(value, maximum); } catch { fail('bytes'); }
    if (!progress && captured && same(bytes, captured)) { if (!record) { context = {}; revoke(active); } return; }
    const envelope = semantic ? decodeSemanticPresentation(bytes, maximum) : undefined;
    const next = semantic ? envelope[1] : decodePresentation(bytes, maximum);
    if (semantic && !semanticCatalogueFits(envelope, labels.length, designs.length)) fail('labels');
    const annotations = new Map(envelope?.[5].map(annotation => [annotation[0], annotation]) ?? []);
    if (frame && next[1] <= frame[1]) fail('stale');
    if (!secretDispatch && presentationRequiresSecret(next)) fail('binding');
    const label = index => {
      if (index >= labels.length) fail('labels');
      return labels[index];
    };
    // Resolve every label before touching even a retained control.
    if (next[3]) label(next[3] - 1);
    for (const [, content] of next[6]) {
      if (content[0] === 3) label(content[2]);
      else if (content[0] !== 4) label(content[1]);
      if (content[0] === 7) for (const option of content[5]) label(option[1]);
      if (content[0] === 9) for (const column of content[2]) label(column);
    }
    if (progress && (!record.live || active !== record || frame !== record.frame || !progressFits(frame, next))) fail('binding');
    // Rejected external renders leave the original invocation intact. A valid
    // external context revokes its outcome, but cannot claim it has settled.
    if (!record) revoke(active);
    const focused = [...nodes.values()].find(record => record.control === document.activeElement
      || record.element === document.activeElement);
    let selection;
    if (focused && [5, 6, 10].includes(focused.tag)) {
      selection = [focused.control.selectionStart, focused.control.selectionEnd, focused.control.selectionDirection];
    }
    const fragment = document.createDocumentFragment(), nextNodes = new Map(), nextForms = new Map();
    const nextActions = new Map();
    try {
      // The connected atomic region survives accepted revisions. Initial
      // text is inserted only after its live-region semantics are mounted.
      if (!status) {
        status = element('p');
        status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true');
        status.dataset.presentationStatus = '';
      }
      // Clear even detached/replaced controls retained by other DOM references.
      // A ready same-context revision may retain only its live password value.
      for (const record of nodes.values()) if (record.tag === 10) {
        const replacement = next[6][record.id - 1];
        if (frame[2] !== 0 || next[2] !== 0 || !replacement || replacement[0] !== record.parent
          || replacement[1][0] !== 10 || !same(replacement[1], record.secretShape)
          || (semantic && !same(annotations.get(record.id) ?? [], record.annotation ?? []))) record.control.value = '';
      }
      if (semantic) {
        const style = element('style', semanticStyle(scope, designs[envelope[2]], envelope[3]));
        style.dataset.presentationStyle = ''; fragment.append(style);
        if (envelope[4]) {
          const skip = element('a', label(envelope[4] - 1));
          skip.href = `#${scope}-node-${semanticMainNode(envelope)}`;
          skip.dataset.presentationSkip = ''; fragment.append(skip);
        }
      }
      const statusPosition = document.createComment('presentation status');
      fragment.append(statusPosition);
      for (let index = 0; index < next[6].length; index++) {
        const id = index + 1, [parent, content] = next[6][index], tag = content[0];
        const previous = nodes.get(id), retained = previous?.tag === tag ? previous : undefined;
        let record;
        if (tag === 10) {
          record = retained ?? {element: element('label'), control: element('input')};
          const control = record.control;
          record.preservedDraft = Boolean(retained && frame[2] === 0 && next[2] === 0
            && record.parent === parent && same(content, record.secretShape)
            && (!semantic || same(annotations.get(id) ?? [], record.annotation ?? [])));
          if (!record.preservedDraft) control.value = '';
          control.type = 'password'; control.autocomplete = 'off'; control.spellcheck = false;
          control.disabled = !content[2]; control.required = content[3]; control.maxLength = content[4];
          record.secretShape = content; record.draftEpoch = content[5];
          record.element.replaceChildren(element('span', label(content[1])), control);
        } else if ([5, 6, 7, 11].includes(tag)) {
          record = retained ?? {element: element('label'), control: element(tag === 5 ? 'input' : tag === 6 ? 'textarea' : 'select')};
          const control = record.control, defaultValue = tag === 7 || tag === 11 ? content[4] : content[5];
          const preserve = retained && record.defaultValue === defaultValue && record.draftEpoch === content[6]
            && (!semantic || (annotations.get(id)?.[1] ?? 0) === (record.annotation?.[1] ?? 0));
          record.preservedDraft = Boolean(preserve);
          const current = control.value;
          if (tag === 5) control.type = 'text';
          control.autocomplete = 'off'; control.disabled = !content[2]; control.required = content[3];
          if (tag === 7 || tag === 11) {
            const options = [element('option', '')]; options[0].value = '';
            for (const [optionId, title] of content[5]) {
              const option = element('option', tag === 11 ? title : label(title)); option.value = String(optionId); options.push(option);
            }
            control.replaceChildren(...options);
            control.value = preserve && (current === '' || content[5].some(option => String(option[0]) === current))
              ? current : defaultValue ? String(defaultValue) : '';
          } else {
            control.maxLength = content[4]; control.spellcheck = false;
            if (!preserve) control.value = defaultValue;
          }
          if (!preserve) { record.edited = false; record.nativeDefault = control.value; }
          record.defaultValue = defaultValue; record.draftEpoch = content[6];
          record.element.replaceChildren(element('span', label(content[1])), control);
        } else if (tag === 8) {
          record = retained ?? {element: element('span'), control: element('button')};
          record.control.type = 'submit'; record.control.disabled = !content[3];
          record.control.textContent = label(content[1]); record.element.replaceChildren(record.control);
          nextActions.set(record.control, id);
        } else {
          const tags = ['section', 'nav', 'form', 'h' + content[1], 'p'];
          record = {element: element(tag === 9 ? 'table' : tags[tag])};
          if (tag <= 2) record.element.setAttribute('aria-label', label(content[1]));
          if (tag === 2) { record.element.noValidate = true; nextForms.set(record.element, id); }
          if (tag === 3) record.element.textContent = label(content[2]);
          if (tag === 4) record.element.textContent = content[1];
          if (tag === 9) {
            const head = element('thead'), row = element('tr'), body = element('tbody');
            for (const column of content[2]) { const cell = element('th', label(column)); cell.scope = 'col'; row.append(cell); }
            head.append(row);
            for (const values of content[3]) { const row = element('tr'); for (const value of values) row.append(element('td', value)); body.append(row); }
            record.element.append(element('caption', label(content[1])), head, body);
          }
        }
        Object.assign(record, {id, tag, parent}); record.element.tabIndex = -1;
        if (semantic) {
          const annotation = annotations.get(id) ?? [id, 0, 0, 0, 0, 0];
          const [, purpose, helper, error, landmark, layout] = annotation;
          record.annotation = annotations.get(id) ?? [];
          record.element.id = `${scope}-node-${id}`;
          if (landmark) record.element.setAttribute('role', ['', 'main', 'banner', 'complementary', 'contentinfo'][landmark]);
          if (layout) record.element.dataset.presentationLayout = String(layout);
          if ([5, 6, 7, 10, 11].includes(tag)) {
            const control = record.control, caption = record.element.firstChild;
            caption.id = `${scope}-label-${id}`;
            control.setAttribute('aria-labelledby', caption.id);
            control.removeAttribute('inputmode');
            control.autocomplete = ['off', 'off', 'name', 'organization', 'email', 'username',
              'current-password', 'new-password', 'one-time-code'][purpose];
            // type=email trims input and would alter DK-23 byte semantics.
            if (purpose === 4) control.inputMode = 'email';
            const descriptions = [];
            for (const [name, index] of [['helper', helper], ['error', error]]) if (index) {
              const description = element('span', label(index - 1));
              description.id = `${scope}-${name}-${id}`;
              description.dataset[name === 'error' ? 'presentationError' : 'presentationHelper'] = '';
              record.element.append(description); descriptions.push(description.id);
            }
            if (descriptions.length) control.setAttribute('aria-describedby', descriptions.join(' '));
            else control.removeAttribute('aria-describedby');
            if (error) {
              control.setAttribute('aria-invalid', 'true');
              control.setAttribute('aria-errormessage', `${scope}-error-${id}`);
            } else {
              control.removeAttribute('aria-invalid'); control.removeAttribute('aria-errormessage');
            }
          }
        }
        record.element.dataset.presentationNode = String(id); nextNodes.set(id, record);
        (parent ? nextNodes.get(parent).element : fragment).append(record.element);
      }
      diagnostic = element('p'); diagnostic.setAttribute('role', 'alert');
      diagnostic.dataset.presentationDiagnostic = ''; fragment.append(diagnostic);
      if (semantic) root.dataset.semanticPresentation = scope;
      if (status.parentNode === root) {
        for (const child of [...root.childNodes]) if (child !== status) child.remove();
        let afterStatus = false;
        for (const child of [...fragment.childNodes]) {
          if (child === statusPosition) { afterStatus = true; continue; }
          if (afterStatus) root.append(child); else root.insertBefore(child, status);
        }
      } else {
        root.replaceChildren(fragment); statusPosition.replaceWith(status);
      }
      root.setAttribute('aria-busy', String(next[2] === 1));
      status.setAttribute('aria-live', ['off', 'polite', 'assertive'][next[4]]);
      const message = next[3] ? label(next[3] - 1) : '';
      if (status.textContent !== message) status.textContent = message;
      frame = next; captured = bytes; nodes = nextNodes; forms = nextForms; actionNodes = nextActions; context = {};
      if (record && record.live) { record.frame = next; record.context = context; }
      const surviving = focused && nodes.get(focused.id);
      const chosen = next[5] ? nodes.get(next[5]) : surviving?.tag === focused?.tag ? surviving : undefined;
      if (chosen) {
        const target = chosen.control && !chosen.control.disabled ? chosen.control : chosen.element;
        target.focus({preventScroll: true});
        if (!next[5] && chosen === focused && chosen.preservedDraft && selection) chosen.control.setSelectionRange(...selection);
      }
      if (next[2] === 3) stop(false);
    } catch (error) { stop(true); throw error instanceof PresentationError ? error : new PresentationError('dom'); }
  }
  root.addEventListener('submit', onSubmit);
  root.addEventListener('keydown', onKey);
  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);
  const view = Object.freeze({render, close() { if (arguments.length) fail('options'); stop(true); }});
  presentations.set(view, ownership); return view;
}
