import { toNotation } from '../../scripts/semantic-source.mjs';
// LexLean model authoring only. Deliberately hostile literal tests text-only projection.
const values = {
  spec: 'prismpm/workspace-view-labels/1',
  title: 'Workspace <img src=x onerror="globalThis.labelExecuted=true">',
  workspace: 'Workspace identifier', select: 'Select workspace', members: 'Members', messages: 'Messages',
  next: 'Next page', action: 'Action', body: 'Body (member identifier or message text)', submit: 'Submit command',
  refresh: 'Refresh authenticated history', close: 'Close workspace view', result: 'Workspace result',
  asOf: 'As-of head', total: 'Total', offset: 'Offset', owner: 'Owner', contributor: 'Contributor', reader: 'Reader',
  event: 'Event', author: 'Author', message: 'Message', principal: 'Principal', role: 'Role',
  ready: 'Ready', pending: 'Pending', replay: 'Refresh required', closed: 'Closed', rejected: 'Rejected',
  conflict: 'Conflict', unknown: 'Commit outcome unknown', unavailable: 'Unavailable', inputError: 'Input rejected',
  action0: 'Create workspace', action1: 'Grant contributor', action2: 'Grant reader', action3: 'Revoke member',
  action4: 'Post message', none: 'None',
};
export const literalLabels = JSON.stringify(Object.fromEntries(Object.keys(values).sort().map(key => [key, values[key]])));
export function source() {
  const declarations = [];
  const define = (name, body) => { declarations.push({kind: 'definition', name, parameters: [], result: {kind: 'bytes'}, body, axioms: []}); return {kind: 'call', function: {name}, arguments: []}; };
  const bytes = value => { const body = value.length <= 32 ? {kind: 'bytes', hex: value.toString('hex')}
    : {kind: 'primitive', operation: 'append', result: {kind: 'bytes'}, arguments:
      [bytes(value.subarray(0, Math.floor(value.length / 2))), bytes(value.subarray(Math.floor(value.length / 2)))]}; return define('labelPart' + declarations.length, body); };
  const body = bytes(Buffer.from(literalLabels));
  define('workspaceViewLabelsBytes', body);
  const model = {spec: 'lexlean/semantic-module/2', declarations};
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return toNotation('\\begin{lexlean}{Foundation.View.Workspace.V1.Labels}\n\\useglossary{lexlean.std.bool@1.2.0}\n\\importmodule{Foundation.View.Workspace.V1.Corpus}\n\\title{Boolean}\n\\begin{semanticmodule}\n\\semanticdata{'
    + JSON.stringify(canonical(model)) + '}\n\\end{semanticmodule}\n\\end{lexlean}\n');
}
