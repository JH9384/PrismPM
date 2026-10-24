// The stdlib modules title themselves from the `prism.arch` lexicon, which the
// native-library project configuration declares at `language/prism.arch`. A
// scratch project that copies that configuration must carry the same files, so
// they are frozen inputs of every harness that does.
import {readdirSync} from 'node:fs';
import {join} from 'node:path';

const directory = 'language/prism.arch';

export function lexiconInputPaths(repository) {
  return [directory + '/lexicon.toml',
    ...readdirSync(join(repository, directory, 'entries')).sort().map(name => directory + '/entries/' + name)];
}
