import {readdirSync} from 'node:fs';
import {join} from 'node:path';

// The stdlib modules title themselves from the `prism.arch` lexicon, which the
// native-library project configuration declares at `language/prism.arch`.
// Every conformance project built from that configuration carries the same
// lexicon files beside its modules, so they are inputs of its construction.
export function lexiconPaths(repository) {
  const entries = readdirSync(join(repository, 'language/prism.arch/entries')).sort();
  return ['language/prism.arch/lexicon.toml', ...entries.map(name => 'language/prism.arch/entries/' + name)];
}
