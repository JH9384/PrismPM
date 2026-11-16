// WCAG contrast admission for the private design catalogue, stated exactly as
// stdlib Foundation.View.Browser.V1.Design states it: a 256-entry linearized
// sRGB table at scale 10^7, luminance at scale 10^11, and the conservative rule
// den*(high+O-E) >= num*(low+O+E), where E bounds the table's rounding error.
// Agreement is checked by scripts/hologram-design.mjs and the DK-38 corpus.
export const SCALE = 10_000_000;
export const ERROR = 5000;
export const OFFSET = 5_000_000_000;
export const linear = value => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const TABLE = Object.freeze(Array.from({length: 256}, (_, value) => Math.round(linear(value) * SCALE)));
export const luminance = color =>
  2126 * TABLE[Math.floor(color / 65536)] + 7152 * TABLE[Math.floor(color / 256) % 256] + 722 * TABLE[color % 256];
export function contrastAtLeast(foreground, background, numerator, denominator) {
  const a = luminance(foreground), b = luminance(background);
  const high = Math.max(a, b), low = Math.min(a, b);
  return BigInt(denominator) * BigInt(high + OFFSET - ERROR) >= BigInt(numerator) * BigInt(low + OFFSET + ERROR);
}

// Token positions, identical to DesignTokens and the catalogue wire.
export const FIELDS = Object.freeze(['surface', 'text', 'border', 'accent', 'accentText', 'danger', 'focus',
  'fontFamily', 'textPermille', 'lineHeightPermille', 'spacePermille', 'radiusPermille', 'contentWidthRem',
  'sidebarWidthRem', 'collapseWidthRem', 'targetPixels',
  'card', 'muted', 'mutedText', 'hover', 'input', 'brand', 'brandText', 'success', 'warning']);
// Text pairs need 4.5:1 and focus indicators 3:1 (WCAG 1.4.3, 1.4.11).
export const PAIRS = Object.freeze([
  ['text', 'surface', 9, 2], ['text', 'card', 9, 2], ['text', 'muted', 9, 2],
  ['mutedText', 'surface', 9, 2], ['mutedText', 'card', 9, 2], ['mutedText', 'muted', 9, 2],
  ['accentText', 'accent', 9, 2], ['danger', 'surface', 9, 2], ['danger', 'card', 9, 2],
  ['brandText', 'surface', 9, 2], ['brandText', 'card', 9, 2],
  ['success', 'card', 9, 2], ['warning', 'card', 9, 2],
  ['focus', 'surface', 3, 1], ['focus', 'card', 3, 1]]);
const at = name => FIELDS.indexOf(name);
export const tokensContrastValid = tokens => PAIRS.every(([foreground, background, numerator, denominator]) =>
  contrastAtLeast(tokens[at(foreground)], tokens[at(background)], numerator, denominator));
