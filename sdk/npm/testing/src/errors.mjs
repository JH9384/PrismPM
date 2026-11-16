import { PrismError } from './runtime.mjs';

/** Base of the errors this package throws. */
export class TestingError extends PrismError {}
TestingError.code = 'testing_failed';

/**
 * A call the test did not expect: a dispatch past the end of a script or with a request the script
 * did not list, or a host call no stub answers. `details` holds `index`, `expected` and `received`.
 */
export class UnexpectedCallError extends TestingError {}
UnexpectedCallError.code = 'unexpected_call';

/** `assertComplete()` found calls the script listed that never happened. `details.remaining` lists them. */
export class ScriptIncompleteError extends TestingError {}
ScriptIncompleteError.code = 'script_incomplete';

/** The test set something up wrongly: a malformed script, a negative delay, a clock that cannot settle. */
export class TestSetupError extends TestingError {}
TestSetupError.code = 'test_setup';
