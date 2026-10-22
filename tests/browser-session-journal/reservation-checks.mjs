import assert from 'node:assert/strict';

export function verifyReservationNativeInventory(output, rows) {
  assert.equal(output, rows.map(row => 'PASS ' + row.id + '\n').join('')
    + 'PASS ' + rows.length + ' journal reservation vectors twice\n',
  'complete exact reservation native inventory');
}
