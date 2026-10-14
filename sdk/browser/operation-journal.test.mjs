import test from 'node:test';
import {withCompilerOwner} from '../../tests/browser-view/serial-compiler-owner.mjs';
import {verifyOperationJournal} from '../../tests/browser-operation-journal/checks.mjs';

test('DK-24 generated durable operation journal and authenticated terminal-receipt recovery',
  {timeout: 3500000}, async t => withCompilerOwner(t, 'operation-journal', (compiler, retain) => verifyOperationJournal(t, compiler, retain)));
