import { load } from 'prism-code';

const app = await load('./Calculator.holo');

console.log(app.name);
console.log(app.identities.verified);
console.log(app.limits);
