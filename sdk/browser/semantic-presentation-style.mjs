// Fixed SDK-owned CSS. Callers supply only captured, source-bounded numbers.
// This adapter is not a CSS/HTML extension point or a contrast certification.
import {captureDesignCatalogue} from './semantic-presentation-wire.mjs';
import {PresentationError} from './presentation-wire.mjs';
const color = value => '#' + value.toString(16).padStart(6, '0');
const rem = value => String(value / 1000) + 'rem';

export function semanticStyle(scope, pair, appearance) {
  if (typeof scope !== 'string' || !/^prismpm-semantic-[1-9][0-9]{0,15}$/.test(scope)
    || !Number.isInteger(appearance) || appearance < 0 || appearance > 2) throw new PresentationError('design');
  pair = captureDesignCatalogue([pair])[0];
  const root = `[data-semantic-presentation="${scope}"]`;
  const theme = tokens => `${root}{
--sp-surface:${color(tokens[0])};--sp-text:${color(tokens[1])};
--sp-border:${color(tokens[2])};--sp-accent:${color(tokens[3])};
--sp-accent-text:${color(tokens[4])};--sp-danger:${color(tokens[5])};--sp-focus:${color(tokens[6])};
--sp-space:${rem(tokens[10])};--sp-radius:${rem(tokens[11])};--sp-sidebar:${tokens[13]}rem;
--sp-target:${tokens[15]}px;font-family:${['system-ui,sans-serif', 'ui-serif,serif', 'ui-monospace,monospace'][tokens[7]]};
font-size:${rem(tokens[8])};line-height:${tokens[9] / 1000};max-width:${tokens[12]}rem;
}
@media(max-width:${tokens[14]}rem){${root} [data-presentation-layout]{grid-template-columns:minmax(0,1fr)}}`;
  const base = `${root}{position:relative;margin-inline:auto;padding:var(--sp-space);min-width:0;
background:var(--sp-surface);color:var(--sp-text);overflow-wrap:anywhere;color-scheme:light dark}
${root} *,${root} *::before,${root} *::after{box-sizing:border-box;min-width:0}
${root} :is(input,textarea,select,button,a){font:inherit;min-height:var(--sp-target);min-width:var(--sp-target)}
${root} :is(input,textarea,select){width:100%;padding:.5em;border:1px solid var(--sp-border);
border-radius:var(--sp-radius);background:var(--sp-surface);color:var(--sp-text)}
${root} :is(button,a){padding:.5em .75em;border-radius:var(--sp-radius)}
${root} button{border:1px solid var(--sp-border);background:var(--sp-accent);color:var(--sp-accent-text)}
${root} button:disabled{background:var(--sp-surface);color:var(--sp-text);border-style:dashed}
${root} a{display:inline-flex;align-items:center;color:var(--sp-accent)}
${root} :focus-visible{outline:3px solid var(--sp-focus);outline-offset:2px}
${root} label{display:grid;gap:.25em}
${root} [data-presentation-error]{color:var(--sp-danger)}
${root} [data-presentation-layout]{display:grid;gap:var(--sp-space);align-content:start}
${root} [data-presentation-layout="1"]{grid-template-columns:minmax(0,1fr)}
${root} [data-presentation-layout="2"]{grid-template-columns:minmax(0,var(--sp-sidebar)) minmax(0,1fr)}
${root} [data-presentation-layout="3"]{grid-template-columns:repeat(2,minmax(0,1fr))}
${root} [data-presentation-layout="4"]{grid-template-columns:repeat(3,minmax(0,1fr))}
${root} [data-presentation-layout="5"]{grid-template-columns:repeat(4,minmax(0,1fr))}
${root} table{border-collapse:collapse;max-width:100%}
${root} :is(th,td){padding:.5em;border:1px solid var(--sp-border);text-align:start;vertical-align:top}
@media(forced-colors:active){${root}{background:Canvas;color:CanvasText}
${root} :is(input,textarea,select,button,a){forced-color-adjust:auto}
${root} :is(input,textarea,select){background:Field;color:FieldText;border-color:FieldText}
${root} button{background:Canvas;color:CanvasText;border-color:CanvasText}
${root} button:disabled{background:Canvas}
${root} :is(input,textarea,select,button):disabled{color:GrayText;border-color:GrayText}
${root} a{color:LinkText}
${root} a:visited{color:VisitedText}
${root} :is(th,td){border-color:CanvasText}
${root} [data-presentation-error]{color:CanvasText}
${root} :focus-visible{outline-color:Highlight}}
`;
  if (appearance === 1) return base + theme(pair[0]) + `${root}{color-scheme:light}`;
  if (appearance === 2) return base + theme(pair[1]) + `${root}{color-scheme:dark}`;
  return base + theme(pair[0]) + `@media(prefers-color-scheme:dark){${theme(pair[1])}}`;
}
