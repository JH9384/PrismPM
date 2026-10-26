/**
 * A capability file, `prism/capabilities/1` (issue #279).
 * Design: docs/proposals/279-capability-sets.md.
 * Schema: `schemas/capabilities/capabilities-v1.schema.json`.
 *
 * Deny by default: a resource is granted only when an `allow-` entry of its
 * kind matches it and no `deny-` entry of its kind does. The runtime applies
 * the set named `default` unless the caller names another.
 */

/** The three resource kinds a set can grant. */
export type CapabilityKind = 'outbound-hosts' | 'key-value-stores' | 'variables';

/**
 * `scheme://host[:port]`, lower case. `scheme`, `host` and `port` may be `*`;
 * `host` may start with `*.` to match every subdomain. With no port, only the
 * scheme's default port matches.
 */
export type OutboundHostEntry = string;
/** A key-value store label, or `*`. */
export type KeyValueStoreEntry = string;
/** A variable name, or `*`. */
export type VariableEntry = string;

/** One set. A missing member is an empty list. */
export interface CapabilitySet {
  'allow-outbound-hosts'?: OutboundHostEntry[];
  'deny-outbound-hosts'?: OutboundHostEntry[];
  'allow-key-value-stores'?: KeyValueStoreEntry[];
  'deny-key-value-stores'?: KeyValueStoreEntry[];
  'allow-variables'?: VariableEntry[];
  'deny-variables'?: VariableEntry[];
}

export interface Capabilities {
  schema: 'prism/capabilities/1';
  /** Named sets, `^[a-z][a-z0-9-]*$`; `default` is required. */
  sets: { default: CapabilitySet; [name: string]: CapabilitySet };
}
