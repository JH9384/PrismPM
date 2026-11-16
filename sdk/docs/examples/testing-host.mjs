import { createMockHost } from '@prism-code/testing';

// Nothing is granted unless the capability file says so, exactly as in load().
const host = createMockHost({
  start: '2026-03-01T09:00:00Z',
  seed: 'payments',
  capabilities: {
    schema: 'prism/capabilities/1',
    sets: { default: { 'allow-outbound-hosts': ['https://rates.example.com'], 'allow-variables': ['region'] } },
  },
  variables: { region: 'eu' },
  fetch: { 'https://rates.example.com/usd': '1.08' },
});

// Sleeping takes no real time: until() moves the clock to each timer the work is waiting on.
const rate = await host.clock.until(async () => {
  await host.clock.sleep(60_000);
  return (await host.fetch('https://rates.example.com/usd')).text();
});
console.log(rate, 'at', host.clock.date().toISOString());
console.log(host.variable('region'), host.random.uuid());

// A call the grant does not allow is the same error the runtime raises.
try {
  host.kv('sessions');
} catch (error) {
  console.log(error.name, error.check);
}
console.log(host.calls.map((call) => `${call.kind} ${call.resource}`));
