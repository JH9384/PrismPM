import type { Application, LoadOptions } from './index.js';

/** Fetch a `.holo` (URL ending in `.holo`) or a closure directory URL. */
export function load(source: string | URL, options?: LoadOptions): Promise<Application>;
/** Place a closure's `index.html` in an iframe; the page's own wasm does the work. */
export function mount(container: Element, closureUrl: string | URL, options?: { title?: string }): HTMLIFrameElement;
