import { scriptedDispatch } from '@prism-code/testing';

const dispatch = scriptedDispatch([
  { request: 'add 1 2', response: 'ok 3' },
  { request: 'add 2 2', error: 'core.trap' },
]);

console.log(new TextDecoder().decode(await dispatch('add 1 2')));

// A request the script does not list next is an UnexpectedCallError, not a silent wrong answer.
try {
  await dispatch('add 9 9');
} catch (error) {
  console.log(error.name, error.code, error.message);
}

// One listed call has not happened, so the test is not finished.
try {
  dispatch.assertComplete();
} catch (error) {
  console.log(error.name, error.code, error.details);
}
