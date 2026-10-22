import test from 'node:test';
import {verifySignedContext} from './checks.mjs';
test('complete private SignedContext component', {timeout: 3500000}, verifySignedContext);
