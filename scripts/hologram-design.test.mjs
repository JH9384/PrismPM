// The Lean catalogue source, the generator and the browser decoder state one contrast rule.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {check, contrastAtLeast, FIELDS, linear, SCALE, TABLE, tokensContrastValid} from './hologram-design.mjs';
import {captureDesignCatalogue} from '../sdk/browser/semantic-presentation-wire.mjs';

const source = readFileSync(new URL('../stdlib/src/Foundation/View/Browser/V1/HologramDesign.lex.tex', import.meta.url), 'utf8');
function committedTheme(name) {
  const body = new RegExp(`${name} := \\(record Foundation\\.View\\.Browser\\.V1\\.Design::DesignTokens \\{([^}]*)\\}`).exec(source)[1];
  const values = Object.fromEntries(body.split(', ').map(item => item.split(' := ')));
  return FIELDS.map(field => field === 'fontFamily' ? 3 : Number(values[field]));
}

test('the committed luminance table and Hologram catalogue match the WCAG formula', () => {
  const result = check();
  assert.equal(result.table, 256);
  for (const [value, entry] of TABLE.entries()) assert.ok(Math.abs(entry - linear(value) * SCALE) <= 0.5, `entry ${value}`);
});

test('the browser decoder admits exactly the catalogue the Lean theorem proves', () => {
  const light = committedTheme('light'), dark = committedTheme('dark');
  assert.equal(light.length, 25);
  assert.deepEqual(captureDesignCatalogue([[light, dark]])[0], [light, dark]);
  const failing = [...light]; failing[FIELDS.indexOf('mutedText')] = light[FIELDS.indexOf('muted')];
  assert.equal(tokensContrastValid(failing), false);
  assert.throws(() => captureDesignCatalogue([[failing, dark]]), {code: 'design'});
});

test('the conservative rule never admits a pair below the exact WCAG ratio', () => {
  const exact = (a, b) => {
    const lum = color => [16, 8, 0].map(shift => linear((color >> shift) & 255))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  let checked = 0;
  for (let seed = 1; checked < 4000; seed = (seed * 1103515245 + 12345) % 2147483648) {
    const a = seed % 16777216, b = (seed * 7919) % 16777216;
    if (contrastAtLeast(a, b, 9, 2)) assert.ok(exact(a, b) >= 4.5, `${a.toString(16)} on ${b.toString(16)}`);
    if (contrastAtLeast(a, b, 3, 1)) assert.ok(exact(a, b) >= 3, `${a.toString(16)} on ${b.toString(16)}`);
    checked++;
  }
});
