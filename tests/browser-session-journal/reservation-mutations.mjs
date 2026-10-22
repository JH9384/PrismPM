// Actual authored-source mutations. Only generated execution can kill them.
import assert from 'node:assert/strict';
export const reservationModule = 'Foundation.Browser.Application.V1.SessionJournalReservation';
export const reservationMutations = [
  ...Array.from({length: 10}, (_, index) => ({id: 'reservation-kind-' + (index + 1),
    probe: 'ReservationKind' + (index + 1) + 'Exhausted'})),
  {id: 'reservation-predecessor', probe: 'ReservationUnsafePredecessorCouldSettle'},
  {id: 'reservation-successor', probe: 'ReservationKind1Exhausted'},
  {id: 'reservation-fixed-four', probe: 'ReservationFullCapacity'},
  {id: 'reservation-retained', probe: 'ReservationRetainedCapacity'},
  {id: 'reservation-checkpoint-cost', probe: 'ReservationRetainedCapacity'},
  {id: 'reservation-continue-slot', probe: 'ReservationFullCapacity'},
  {id: 'reservation-final-close', probe: 'ReservationRetainedCapacity'},
  {id: 'reservation-remaining-step', probe: 'ReservationFullCapacity'},
  // Empty retained segment + three continuations exposes a severed right seed.
  // FullCapacity starts retained=1, for which this defect is observationally equal.
  {id: 'reservation-split-state', probe: 'ReservationCost45'},
  {id: 'reservation-split-right', probe: 'ReservationFullCapacity'},
  {id: 'reservation-split-fuel', probe: 'ReservationFullCapacity'},
];

const variable = name => ({kind: 'var', name});
const natural = value => ({kind: 'nat', value: String(value)});
const append = () => ({kind: 'call', function: {module: 'Foundation.Browser.Application.V1.SessionJournal',
  name: 'appendSessionJournal'}, arguments: ['state', 'record', 'envelope'].map(variable)});
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function mutateReservationSource(sources, id) {
  const mutation = reservationMutations.find(row => row.id === id); assert.ok(mutation);
  const before = sources.get(reservationModule); assert.ok(before);
  const text = before.toString('utf8'), match = /\\semanticdata\{(.*)\}/.exec(text);
  const model = JSON.parse(match[1]), declaration = name => {
    const value = model.declarations.find(row => row.name === name); assert.ok(value); return value;
  };
  if (id.startsWith('reservation-kind-')) {
    const kind = Number(id.slice('reservation-kind-'.length));
    const value = declaration('appendReservedSessionJournal');
    value.body = {kind: 'match', scrutinee: {kind: 'beq', left: {kind: 'project', value: variable('record'), field: 'kind'},
      right: natural(kind)}, branches: [{constructor: {name: 'Bool.false'}, binders: [], body: value.body},
      {constructor: {name: 'Bool.true'}, binders: [], body: append()}]};
  } else if (id === 'reservation-predecessor') {
    declaration('appendReservedSessionJournal').body = {kind: 'call', function: {name: 'acceptReservedSessionJournal'}, arguments: [append()]};
  } else if (id === 'reservation-successor') {
    declaration('acceptReservedSessionJournal').body = variable('value');
  } else if (id === 'reservation-fixed-four') {
    const value = declaration('sessionJournalRequiredOrdinals');
    value.body.branches.find(row => row.constructor.name === 'Bool.true').body = {
      kind: 'constructor', constructor: {name: 'Result.ok'}, arguments: [natural(4)],
      type_arguments: [value.result.ok, value.result.error]};
  } else if (id === 'reservation-continue-slot') {
    const value = declaration('reserveSessionJournalContinuationStep').body;
    assert.equal(value.scrutinee.left.right.value, '2'); value.scrutinee.left.right.value = '1';
  } else if (id === 'reservation-checkpoint-cost') {
    const value = declaration('reserveSessionJournalOrdinary').body.branches.find(row => row.constructor.name === 'Nat.succ').body;
    const branch = value.branches.find(row => row.constructor.name === 'Bool.false').body;
    assert.equal(branch.arguments[0].value, '2'); branch.arguments[0].value = '1';
    const step = declaration('reserveSessionJournalContinuationStep').body.branches.find(row => row.constructor.name === 'Bool.false').body;
    const cost = step.fields.find(row => row.field === 'ordinals').value;
    assert.equal(cost.value, '2'); cost.value = '1';
  } else if (id === 'reservation-split-fuel') {
    const value = declaration('reserveSessionJournalContinuations').body.scrutinee;
    assert.equal(value.function.name, 'reserveSessionJournalContinuationsTree');
    assert.equal(value.arguments[0].kind, 'add'); value.arguments[0] = natural(0);
  } else if (id === 'reservation-split-state' || id === 'reservation-split-right') {
    let changed = 0;
    function walk(value) {
      if (!value || typeof value !== 'object') return;
      if (value.kind === 'call' && value.function.name === 'reserveSessionJournalContinuationsTree'
        && value.arguments[2]?.value?.name === 'left') {
        if (id === 'reservation-split-state') value.arguments[2] = variable('retained');
        else {
          const type = declaration('reserveSessionJournalContinuationsTree').result;
          const replacement = {kind: 'constructor', constructor: {name: 'Result.ok'},
            type_arguments: [type.ok, type.error], arguments: [{kind: 'record', type: {name: 'SessionJournalReservation'},
              fields: [{field: 'ordinals', value: natural(0)}, {field: 'retained', value: value.arguments[2]}]}]};
          Object.keys(value).forEach(key => delete value[key]); Object.assign(value, replacement);
        }
        changed++; return;
      }
      Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(walk) : walk(child));
    }
    walk(declaration('reserveSessionJournalContinuationsTree').body); assert.equal(changed, 1);
  } else {
    let changed = 0;
    function walk(value) {
      if (!value || typeof value !== 'object') return;
      if (id === 'reservation-retained' && value.kind === 'project' && value.field === 'retained' && value.value?.name === 'state') {
        Object.keys(value).forEach(key => delete value[key]); Object.assign(value, natural(0)); changed++; return;
      }
      if (id === 'reservation-remaining-step' && value.kind === 'primitive' && value.operation === 'subtract') {
        value.arguments[1] = {kind: 'add', left: value.arguments[1], right: natural(1)}; changed++; return;
      }
      if (id === 'reservation-final-close' && value.kind === 'call'
        && ['reserveSessionJournalOrdinary', 'reserveSessionJournalContinuations'].includes(value.function.name)) {
        const index = value.function.name === 'reserveSessionJournalOrdinary' ? 0 : 3;
        const argument = value.arguments[index]; assert.equal(argument.kind, 'nat');
        argument.value = String(Number(argument.value) - 1); changed++;
      }
      Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(walk) : walk(child));
    }
    walk(declaration('sessionJournalRequiredOrdinals').body);
    assert.equal(changed, id === 'reservation-retained' || id === 'reservation-final-close' ? 4 : 1);
  }
  sources.set(reservationModule, Buffer.from(text.replace(match[0], '\\semanticdata{' + JSON.stringify(canonical(model)) + '}')));
  assert.notDeepEqual(sources.get(reservationModule), before);
  return mutation;
}
