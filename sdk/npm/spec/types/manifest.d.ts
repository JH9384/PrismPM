/**
 * The `prism.toml` manifest, `prism/manifest/1` (issue #280).
 * Design: docs/proposals/280-prism-toml.md.
 * Schema: `schemas/manifest/manifest-v1.schema.json`.
 *
 * This is the manifest as a TOML reader returns it, after the overlay for the
 * build target (`prism.browser.toml` or `prism.node.toml`) is merged in.
 */

/** A path inside the project: relative, forward slashes, no `..` segment. */
export type ManifestPath = string;

export interface ManifestApplication {
  /** `^[a-z][a-z0-9-]{0,62}$`. */
  name: string;
  /** Semantic Versioning 2.0.0. */
  version: string;
  description?: string;
  authors?: string[];
}

export interface ManifestModel {
  source?: ManifestPath;
  /** The command that builds the model. */
  build?: string;
  watch?: ManifestPath[];
}

/** A capability file the manifest names, and the set of it to apply. */
export interface ManifestCapabilityFile {
  file: ManifestPath;
  set?: string;
}

/** The members of one `prism/capabilities/1` set, written inline. */
export interface ManifestInlineCapabilities {
  'allow-outbound-hosts'?: string[];
  'deny-outbound-hosts'?: string[];
  'allow-key-value-stores'?: string[];
  'deny-key-value-stores'?: string[];
  'allow-variables'?: string[];
  'deny-variables'?: string[];
}

/**
 * A variable: a literal, `env(NAME)`, or a table. A secret takes its value
 * from `env(NAME)`, or from the variable's name in upper case when it has no
 * value; a literal secret is an error.
 */
export type ManifestVariable = string | { value?: `env(${string})`; secret: true } | { value: string; secret?: false };

export interface Manifest {
  /** Absent means 1. */
  manifest_version?: 1;
  application: ManifestApplication;
  model?: ManifestModel;
  /** Absent means nothing is granted. */
  capabilities?: ManifestCapabilityFile | ManifestInlineCapabilities;
  /** Variable names match `^[a-z][a-z0-9_]*$`. */
  variables?: Record<string, ManifestVariable>;
}
