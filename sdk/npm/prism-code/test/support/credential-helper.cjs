// A `docker-credential-<name>` for the tests, with its credentials in the file FAKE_HELPER_STATE. On Windows it runs as a
// preload of a copy of node.exe, because a helper must be an executable there, so its verb is the last part of the last argument.
// FAKE_HELPER_MODE: `noisy-store` refuses, prints what it was given and records that it ran, `stuck-erase` says it erased and did not.
const { readFileSync, writeFileSync } = require('node:fs');
const { basename } = require('node:path');

const verb = basename(process.argv.at(-1));
const file = process.env.FAKE_HELPER_STATE;
const mode = process.env.FAKE_HELPER_MODE ?? '';
const input = readFileSync(0, 'utf8').trim();
let state = {};
try {
  state = JSON.parse(readFileSync(file, 'utf8'));
} catch {}

if (verb === 'get') {
  if (!state[input]) process.exit(1);
  process.stdout.write(JSON.stringify(state[input]));
} else if (verb === 'store') {
  if (mode === 'noisy-store') {
    process.stdout.write(`refused ${input}\n`);
    process.stderr.write(`refused ${input}\n`);
    writeFileSync(file, JSON.stringify({ refused: true }));
    process.exit(1);
  }
  const { ServerURL, Username, Secret } = JSON.parse(input);
  state[ServerURL] = { Username, Secret };
  writeFileSync(file, JSON.stringify(state));
} else if (verb === 'erase') {
  if (mode !== 'stuck-erase') {
    delete state[input];
    writeFileSync(file, JSON.stringify(state));
  }
} else {
  process.exit(2);
}
process.exit(0);
