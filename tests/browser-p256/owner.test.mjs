import test from 'node:test';
import {verifyP256} from './checks.mjs';

test('complete generated P-256 public-key validation owner', {timeout: 3_500_000}, verifyP256);
