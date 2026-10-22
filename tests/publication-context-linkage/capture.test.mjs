import test from 'node:test';
import {verifyCapturedFactory} from './capture-owner.mjs';

test('conditional actual capture factory (not complete OC-10 or SDK acceptance)',
  {timeout:2800000}, async t => {await verifyCapturedFactory(t);});
