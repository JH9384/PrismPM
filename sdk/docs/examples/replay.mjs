import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const history = await app.history();
const result = await app.experimental_replay(history);

console.log(result.events, 'events,', result.divergenceCount, 'divergences');
console.log(result.statement.predicateType);
console.log(result.statement.predicate.histories);
