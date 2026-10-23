import type { Server } from 'node:http';
import type { Application, LoadOptions } from './index.js';

/** Open a `.holo` file or a closure directory. */
export function fromFile(source: string | URL, options?: LoadOptions): Promise<Application>;
/** Read a closure directory into a file map. */
export function readClosureDirectory(directory: string): Promise<Map<string, Uint8Array>>;
/** Serve `app.view` as static files and answer `POST /_hologram/intent` with `app.dispatch`. */
export function serve(app: Application, options?: { port?: number; host?: string }): Promise<{ server: Server; url: string; close(): Promise<void> }>;
