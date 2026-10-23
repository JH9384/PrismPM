import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const result = await app.acceptance();

console.log(result);
