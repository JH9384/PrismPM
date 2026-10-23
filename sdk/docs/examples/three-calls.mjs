import { load } from 'prism-code';

const app = await load('./Calculator.holo');
console.log(app.name, app.identities.verified);

const response = await app.dispatch(new TextEncoder().encode('1\tadd\t20\t22'));
console.log(JSON.stringify(new TextDecoder().decode(response)));

const result = await app.acceptance();
console.log(result.passed, 'of', result.total, 'examples replayed');
