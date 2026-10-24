import { load } from 'prism-code';

const app = await load('./Calculator.holo');

const verdict = await app.experimental_verify({ minimum: 'P0' });
console.log({ level: verdict.level, passed: verdict.passed });

try {
  await app.experimental_verify({ throw: true });
} catch (error) {
  console.log(error.name, error.code, error.check);
}
