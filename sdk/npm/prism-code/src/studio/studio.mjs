/**
 * The studio page: no framework and nothing fetched from outside this origin.
 * The tabs' content comes from tabs.mjs. Text from the state only ever reaches
 * the page as a text node, so a build log or a reason cannot become markup.
 *
 * The page also judges the holo itself with `@prism-code/verify`, the same file
 * the command line vendors, and reports whether the two verdicts agree.
 */
import { HEADLINES, REPLAY_HEADLINES, agreement, checkTab, replayTab } from './tabs.mjs';
import { verify } from './verify.mjs';

const element = (tag, attributes = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
};

const seconds = (ms) => (ms === null || ms === undefined ? null : `${(ms / 1000).toFixed(2)} s`);

function facts(rows) {
  const list = element('dl');
  for (const [name, value] of rows) {
    if (value === null || value === undefined) continue;
    list.append(element('dt', {}, name), element('dd', {}, value));
  }
  return list;
}

function reasonList(reasons) {
  return element('ul', {}, ...reasons.map((reason) => {
    const tags = [reason.code, reason.title, reason.withholds ? `withholds ${reason.withholds}` : 'policy rule'].filter(Boolean).join(', ');
    return element('li', { class: 'reason' }, element('code', {}, reason.check), ' ', element('span', { class: 'tags' }, tags), element('p', {}, reason.message));
  }));
}

function verdictCard(verdict, title, className) {
  return element('div', { class: `card ${className}` },
    element('p', { class: 'headline' }, element('strong', {}, title), element('span', { class: 'detail', 'data-testid': 'level' }, `${verdict.level} ${verdict.levelName ?? ''}`.trim())),
    facts([
      ['Policy', `${verdict.policy} requires ${verdict.minimum} or above`],
      ['Digest', element('code', { 'data-testid': 'digest' }, verdict.digest)],
      ['Holo', element('code', {}, verdict.holo)],
    ]));
}

let judged = { key: null, node: null };

/** Judge the bytes in this page, once per archive and policy, and say whether the verdict matches. */
function browserCheck(state) {
  const { result } = state;
  // A policy edit keeps the digest and can change the verdict, so the policy is part of what was judged.
  const key = JSON.stringify([result.verdict.holo, result.policy]);
  if (judged.key === key) return judged.node;
  const node = element('p', { 'data-testid': 'browser-check' }, 'Judging this holo again in the page.');
  judged = { key, node };
  fetch('/holo')
    .then((response) => {
      if (!response.ok) throw new Error(`the holo answered ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => verify(new Uint8Array(bytes), result.policy))
    .then((verdict) => {
      const same = agreement(result.verdict, verdict);
      node.className = same ? 'agree' : 'disagree';
      node.dataset.agrees = String(same);
      node.textContent = same ? 'This page judged the same bytes and reached the same verdict, with no network.' : `This page reached a different verdict: ${verdict.level}, ${verdict.passed ? 'passed' : 'failed'}. Rely on neither until they agree.`;
    })
    .catch((error) => {
      node.className = 'disagree';
      node.dataset.agrees = 'false';
      node.textContent = `This page could not judge the holo: ${error.message}`;
    });
  return node;
}

function renderCheck(state) {
  const view = checkTab(state);
  const parts = [];
  if (view.busy) parts.push(element('p', { class: 'busy', role: 'status' }, view.busy === 'building' ? 'Rebuilding. What follows describes the last finished build.' : 'Checking. What follows describes the last finished check.'));
  if (view.verdict) {
    parts.push(verdictCard(view.verdict, HEADLINES[view.status], view.status));
    parts.push(element('div', { class: 'card' }, element('h2', {}, 'In this page'), browserCheck(state)));
    parts.push(element('div', { class: 'card' }, element('h2', {}, 'Reasons'), view.verdict.reasons.length > 0 ? reasonList(view.verdict.reasons) : element('p', {}, 'None. Every check passed.')));
    if (view.verdict.limits.length > 0) parts.push(element('div', { class: 'card' }, element('h2', {}, 'What this check trusts the signer for'), element('ul', { class: 'plain' }, ...view.verdict.limits.map((limit) => element('li', {}, limit)))));
  } else {
    const body = [element('p', { class: 'headline' }, element('strong', {}, HEADLINES[view.status]))];
    if (view.problem) body.push(element('p', {}, element('code', {}, view.problem.check), ' ', view.problem.message));
    if (view.log) body.push(element('pre', {}, view.log));
    parts.push(element('div', { class: `card ${view.status}` }, ...body));
    if (view.previous) {
      parts.push(element('h2', {}, 'The last verdict, on source that has since changed'));
      parts.push(verdictCard(view.previous, HEADLINES[view.previous.passed ? 'passed' : 'failed'], 'stale'));
    }
  }
  if (view.timing) {
    parts.push(element('div', { class: 'card' }, element('h2', {}, 'Last cycle'), facts([
      ['Changed', view.timing.files.length > 0 ? view.timing.files.join(', ') : null],
      ['Edit to verdict', seconds(view.timing.editToVerdictMs)],
      ['Build', seconds(view.timing.buildMs)],
      ['Check', seconds(view.timing.checkMs)],
    ])));
  }
  document.getElementById('panel-check').replaceChildren(...parts);
}

function renderReplay(state) {
  const view = replayTab(state);
  const body = [element('p', { class: 'headline' }, element('strong', { 'data-testid': 'replay-state' }, REPLAY_HEADLINES[view.state] ?? view.state))];
  if (view.reason) body.push(element('p', {}, view.reason));
  if (view.events !== null) body.push(facts([['Events', String(view.events)], ['Divergences', String(view.divergences)]]));
  if (view.histories.length > 0) body.push(element('ul', { class: 'plain' }, ...view.histories.map((history) => element('li', {}, element('code', {}, history.name), ` ${history.events} events, ${history.divergences} divergences`))));
  document.getElementById('panel-replay').replaceChildren(element('div', { class: `card ${view.state}` }, ...body));
}

function render(state) {
  document.getElementById('project').textContent = state.project ? `${state.project.name}, build: ${state.project.build}` : '';
  renderCheck(state);
  renderReplay(state);
}

function selectTab(name) {
  for (const tab of ['check', 'replay']) {
    const selected = tab === name;
    const button = document.getElementById(`tab-${tab}`);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    document.getElementById(`panel-${tab}`).hidden = !selected;
  }
}

for (const name of ['check', 'replay']) document.getElementById(`tab-${name}`).addEventListener('click', () => selectTab(name));
document.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const next = document.getElementById('tab-check').getAttribute('aria-selected') === 'true' ? 'replay' : 'check';
  selectTab(next);
  document.getElementById(`tab-${next}`).focus();
});

const link = document.getElementById('link');
const stream = new EventSource('/api/events');
stream.onopen = () => {
  link.textContent = 'Live';
};
stream.onerror = () => {
  link.textContent = 'prism-code dev has stopped; reconnecting';
};
stream.onmessage = (event) => render(JSON.parse(event.data));
