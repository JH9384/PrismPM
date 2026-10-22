import test from 'node:test';
import {verifyOwner} from './full-checks.mjs';
test('complete private separate-frame source and browser component, not authenticated journal admission', {timeout: 3500000}, async t => {
  const {build, evidence} = await verifyOwner();
  t.diagnostic('Retained private recovery-frame component ' + build.work);
  t.diagnostic(JSON.stringify({results: evidence.results, maxima: evidence.actualMaxima.length,
    browserJourneys: evidence.browser.journeys.length, sourceDefects: evidence.sourceDefects.length,
    hostDefects: evidence.browser.hostDefects.length}));
});
