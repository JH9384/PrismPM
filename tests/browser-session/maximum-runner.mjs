// One actual maximum per supervised process; only numeric/hash evidence exits.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeWasm} from './checks.mjs';
import {sha} from './compile.mjs';
const args = process.argv.slice(2); assert.equal(args.length, 3);
const [wasm, request, response] = args.map(path => readFileSync(path));
const observed = executeWasm(wasm, [{id: 'actual declared maximum', request, response}]);
console.log(JSON.stringify({...observed, request: sha(request), response: sha(response)}));
