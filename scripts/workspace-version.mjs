// The release version has one source: the workspace version in Cargo.toml,
// which release-please bumps. Release refs, image labels and crate names read it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function workspaceVersion(root = fileURLToPath(new URL('..', import.meta.url))) {
  const manifest = readFileSync(join(root, 'Cargo.toml'), 'utf8');
  const section = manifest.slice(manifest.indexOf('[workspace.package]'));
  const version = section.match(/^version = "([^"]*)"$/m)?.[1];
  assert.match(version ?? '', semver, 'workspace version');
  return version;
}
