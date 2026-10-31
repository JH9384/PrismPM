import { prism } from 'prism-code';

const container = await prism.containers.run('./Calculator.holo', '1\tadd\t20\t22', {
  policy: { minimum: 'P0' },
});

const { image, state } = await container.inspect();
console.log(state.status, state.exitCode, image.digest);
console.log(JSON.stringify(container.text()));

await container.remove();
