import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const request = new TextEncoder().encode('1\tadd\t20\t22');
const response = await app.dispatch(request);

console.log(JSON.stringify(new TextDecoder().decode(response)));
