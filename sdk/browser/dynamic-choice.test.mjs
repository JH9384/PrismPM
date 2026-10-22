import test from 'node:test';
import {verifyDynamicChoice} from '../../tests/browser-dynamic-choice/checks.mjs';

test('DK-31 generated dynamic choice names and actual browser selections', {timeout: 3500000},
  verifyDynamicChoice);
