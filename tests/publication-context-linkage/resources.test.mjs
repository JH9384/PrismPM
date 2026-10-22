import test from 'node:test';
import {verifyGeneratedLinkageResources} from './checks.mjs';

// Resource regression only. The registered owner still requires every vector,
// maximum, mutation and actual captured-release boundary.
test('OC-10 generated maximum-frame resource diagnostics only',
  {timeout: 3500000}, verifyGeneratedLinkageResources);
