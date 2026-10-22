import test from 'node:test';
import {verifyGeneratedLinkage} from './checks.mjs';

test('OC-10 generated linkage protocol component only', {timeout: 3500000}, verifyGeneratedLinkage);
