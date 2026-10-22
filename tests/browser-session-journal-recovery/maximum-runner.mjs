// Isolate each actual maximum; retain only hashes and numeric observations.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {executeWasm} from './runtime.mjs';
const args = process.argv.slice(2); assert.equal(args.length, 4);
const [wasm, request, response] = args.slice(0, 3).map(path => readFileSync(path));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(wasm), args[3], 'actual generated maximum Wasm identity');
console.log(JSON.stringify({...executeWasm(wasm, [{id: 'actual recovery maximum', request, response}]),
  wasm: digest(wasm), request: digest(request), response: digest(response)}));
