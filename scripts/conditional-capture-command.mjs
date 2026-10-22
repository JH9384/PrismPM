// Test-only exact ELF execution. Reuse the qualified per-command supervisor;
// neither this result nor the conditional capture is installed SDK acceptance.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {executeOwnedSdkCommand} from './sdk-command-owner.mjs';

assert.equal(process.argv.length, 5);
const [executable, work, seconds] = process.argv.slice(2);
assert.equal(executable, join(work, 'current-test-elf'));
assert.match(work, /^\/workspace\/conditional-capture$/);
assert.match(seconds, /^[0-9]+$/);
const timeout = Number(seconds) * 1000;
assert(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2400000);
let result;
try {
  result = await executeOwnedSdkCommand(executable,
    ['--exact', 'oci::publication_context::capture_tests::actual_source_free_capture_constructs_complete_conditional_context', '--nocapture'],
    {profile:'qualification', environment:process.env, timeout, limit:32*1024*1024,
      aggregate:true, interruptions:true});
} catch (error) {
  result = error.result;
  if (!result) throw error;
}
for (const stream of ['stdout', 'stderr'])
  writeFileSync(join(work, stream), result[stream], {flag:'wx', mode:0o600});
writeFileSync(join(work, 'command-result.json'), JSON.stringify({
  status:result.status, signal:result.signal, timedOut:result.timedOut,
  overflow:result.overflow, aborted:result.aborted, orphaned:result.orphaned,
  close_observed:result.close_observed, retirement:result.retirement
})+'\n', {flag:'wx', mode:0o600});
