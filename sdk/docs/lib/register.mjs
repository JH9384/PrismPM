/** Loaded with `node --import` before an example runs; see resolve-hook.mjs. */
import { register } from 'node:module';

const map = JSON.parse(process.env.PRISM_DOCS_MODULE_MAP ?? '{}');
register('./resolve-hook.mjs', import.meta.url, { data: { map } });
