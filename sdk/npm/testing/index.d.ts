/** @prism-code/testing: test a Prism application without a network or a clock. Experimental. */
import type { PrismError } from 'prism-code';

export const HISTORY_SCHEMA: 'prism/history/1';
export { parseHistory, historyJson } from 'prism-code';

export type Bytes = Uint8Array;
export interface HistoryEvent {
  request: string;
  response?: string;
  error?: string;
}
export interface History {
  schema: 'prism/history/1';
  application: string | null;
  recordedFrom?: { guest: { blake3: string; sha256: string }; model: { blake3: string; sha256: string } };
  events: HistoryEvent[];
}

/** Base of the errors this package throws. */
export class TestingError extends PrismError {}
/** `unexpected_call`: a dispatch or host call the test did not expect. `details` holds `index`, `expected`, `received`. */
export class UnexpectedCallError extends TestingError {
  static readonly code: 'unexpected_call';
}
/** `script_incomplete`: `assertComplete()` found listed calls that never happened. */
export class ScriptIncompleteError extends TestingError {
  static readonly code: 'script_incomplete';
}
/** `test_setup`: a malformed script, a negative delay, or work that nothing can wake. */
export class TestSetupError extends TestingError {
  static readonly code: 'test_setup';
}

export const DEFAULT_START: number;

export interface Clock {
  now(): number;
  date(): Date;
  pending(): number;
  setTimeout(callback: () => unknown, ms?: number): number;
  clearTimeout(id: number): void;
  sleep(ms: number): Promise<void>;
  advance(ms: number): Promise<number>;
  next(): Promise<boolean>;
  runAll(options?: { limit?: number }): Promise<number>;
  until<T>(work: Promise<T> | (() => Promise<T>)): Promise<T>;
}
export function createClock(options?: { start?: number | string | Date }): Clock;

export interface Random {
  next(): number;
  int(max: number): number;
  bytes(length: number): Uint8Array;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  uuid(): string;
}
export function createRandom(options?: { seed?: number | string }): Random;

export interface MockResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
  text(): string;
}
export type FetchStub = string | Uint8Array | { status?: number; headers?: Record<string, string>; body?: string | Uint8Array } | ((url: string, init: unknown) => unknown);

export interface MockHostOptions {
  start?: number | string | Date;
  seed?: number | string;
  capabilities?: string | Uint8Array | object | null;
  capabilitySet?: string;
  variables?: Record<string, string>;
  stores?: Record<string, Record<string, string>>;
  fetch?: Record<string, FetchStub>;
}
export interface HostCall {
  kind: 'fetch' | 'kv' | 'variable';
  resource: string;
  at: number;
}
export interface MockHost {
  clock: Clock;
  random: Random;
  /** The grant in force, as `app.capabilities` reports it. */
  capabilities: { set: string | null; allows(kind: string, resource: string): boolean; assert(kind: string, resource: string): void };
  calls: HostCall[];
  fetch(url: string, init?: unknown): Promise<MockResponse>;
  kv(store: string): { get(key: string): string | null; set(key: string, value: unknown): void; delete(key: string): boolean; keys(): string[] };
  variable(name: string): string | undefined;
  load(source: Uint8Array | string | URL, options?: object): Promise<any>;
}
export function createMockHost(options?: MockHostOptions): MockHost;

export type ScriptEntry =
  | { request: string | Uint8Array | ((request: Uint8Array) => boolean); response: string | Uint8Array | ((request: Uint8Array) => string | Uint8Array | Promise<string | Uint8Array>) }
  | { request: string | Uint8Array | ((request: Uint8Array) => boolean); error: string | Error };
export interface ScriptedDispatch {
  (request: Uint8Array | string): Promise<Uint8Array>;
  assertComplete(): void;
  remaining(): number;
  calls: Array<{ request: Uint8Array }>;
}
export function scriptedDispatch(script: ScriptEntry[] | History): ScriptedDispatch;
export function historyScript(history: History): ScriptEntry[];

export function readHistory(path: string): Promise<History>;
export function writeHistory(path: string, history: History): Promise<void>;
export function recordHistory(app: { dispatch(request: Uint8Array): Promise<Uint8Array> }, run: (dispatch: (request: Uint8Array | ArrayBuffer) => Promise<Uint8Array>) => unknown): Promise<History>;
export function assertReplays(app: object, histories: History | History[], options?: { throw?: boolean }): Promise<{ events: number; divergenceCount: number; statement: object | null; histories: object[] }>;

export interface ReferenceArchive {
  name: string;
  path: string;
  historyPath: string;
  bytes(): Promise<Uint8Array>;
  history(): Promise<History>;
  load(options?: object): Promise<any>;
}
export function referenceArchive(name: string, options?: { directory?: string }): Promise<ReferenceArchive>;
export function referenceArchives(options?: { directory?: string }): Promise<string[]>;

export { load, inspect, formatInspection, canonicalJson, experimental_verify, historyBytes, historyDigest, acceptanceHistory, experimental_recorder, experimental_replay, REPLAY_PREDICATE_TYPE, DeterminismViolationError, ReplayError, PrismError, blake3Hex, resolveArchive } from 'prism-code';
export { fromFile } from 'prism-code/node';
export function runCli(args: string[], options?: { env?: Record<string, string>; input?: string }): { code: number | null; out: string; err: string };
