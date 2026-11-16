import { assertReplays, recordHistory, referenceArchive, scriptedDispatch } from '@prism-code/testing';

// Calculator and its committed history ship with prism-code.
const calculator = await referenceArchive('Calculator');
const app = await calculator.load();

// Record what a test does against the app, then replay it against the same build.
const [first] = app.vectors;
const history = await recordHistory(app, async (dispatch) => {
  await dispatch(first.request);
});
console.log(history.schema, history.events.length, 'event');
console.log((await assertReplays(app, history)).divergenceCount, 'divergences');

// The committed history also drives a scripted dispatch, so code that calls dispatch runs without the guest.
const scripted = scriptedDispatch(await calculator.history());
console.log(scripted.remaining(), 'scripted calls');
