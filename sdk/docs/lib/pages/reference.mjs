/**
 * Reference pages built from the spec package, the runtime source and the
 * CLI description: holo format, attestations, manifest, lockfile, errors.
 */
import { HEADER, defRows, tableRows } from '../schema.mjs';
import { code, fence, heading, paragraph, status, table } from '../markdown.mjs';
import { declaration } from '../dts.mjs';

function kindName(spec, codeValue) {
  const entry = Object.entries(spec.module.SECTION_KIND).find(([, v]) => v === codeValue);
  if (!entry) throw new Error(`no section kind named for code ${codeValue}`);
  return entry[0];
}

/** The pinned trust a verifier checks log entries and timestamps against. Found by path: attestation schemas are not in the generated registry. */
const TRUSTED_ROOT_SCHEMA = 'schemas/attestation/trusted-root.schema.json';

function schemaSource(spec, rel) {
  const schema = spec.json(rel);
  return paragraph(`Schema: ${code(schema.$id)}, file ${code(rel)}.`);
}

export function holoFormat({ spec }) {
  const m = spec.module;
  if (m.BODY_OFFSET !== m.HEADER_LENGTH + m.SECTION_COUNT * m.TABLE_ENTRY_LENGTH) {
    throw new Error('BODY_OFFSET does not equal header plus table');
  }
  const archive = spec.json(m.HOLO_SCHEMAS.ARCHIVE);
  const revision = m.FORMAT_REVISIONS[m.FORMAT_REVISION];
  const parts = [];

  parts.push(paragraph(`Source: ${code(spec.name)} ${m.FORMAT_REVISION}, ${code(m.HOLO_SCHEMAS.ARCHIVE)}, ${code('index.mjs')}.`));

  parts.push(heading(2, 'Layout'));
  parts.push(paragraph('All integers are little-endian. Offsets count from the first byte of the file.'));
  parts.push(
    table(
      ['Offset', 'Size', 'Field', 'Value'],
      [
        [0, 4, 'magic', code(m.MAGIC)],
        [4, 2, 'physical version', m.PHYSICAL_VERSION],
        [6, 2, 'flags', m.FLAGS],
        [8, 2, 'section count', m.SECTION_COUNT],
        [m.HEADER_LENGTH, m.SECTION_COUNT * m.TABLE_ENTRY_LENGTH, 'section table', `${m.SECTION_COUNT} rows of u64 kind, u64 offset, u64 length`],
        [m.BODY_OFFSET, 'variable', 'section bodies', 'contiguous, in table order'],
        [`end - ${m.FOOTER_LENGTH}`, m.FOOTER_LENGTH, 'footer', 'BLAKE3 of every earlier byte'],
      ],
    ),
  );

  parts.push(heading(2, 'Section table'));
  const extensions = revision.extensions;
  let extensionIndex = 0;
  const rows = m.SECTION_ORDER.map((kind, row) => {
    const item = archive.properties.sections.prefixItems[row];
    const length = item.properties.length;
    const constraint = length.const !== undefined ? `${length.const} bytes` : length.minimum ? `at least ${length.minimum} bytes` : 'variable';
    let content;
    if (kind === m.SECTION_KIND.APP_MANIFEST) content = `application manifest, ${code(m.APP_MANIFEST.URI)}`;
    else if (kind === m.SECTION_KIND.METADATA) content = `source manifest, version ${revision.sourceManifestVersion}`;
    else if (kind === m.SECTION_KIND.EXTENSION) content = `extension ${code(extensions[extensionIndex++])}`;
    else content = `content blob: a ${m.LABEL_LENGTH}-byte ${code(m.LABEL_PREFIX)} label, then the content`;
    return [row, kind, kindName(spec, kind), constraint, content];
  });
  parts.push(table(['Row', 'Kind', 'Name', 'Length', 'Content'], rows));
  parts.push(
    paragraph(
      `The four content blobs are the ${m.APP_MANIFEST.LABELS.join(', ')} and model document, sorted by label. Each label is ${code(m.LABEL_PREFIX)} and 64 lowercase hex characters: the BLAKE3 of the content.`,
    ),
  );

  parts.push(heading(2, 'Application manifest'));
  parts.push(schemaSource(spec, m.HOLO_SCHEMAS.APP_MANIFEST));
  parts.push(
    table(
      ['Offset', 'Size', 'Field'],
      [
        [0, m.APP_MANIFEST.PREFIX_LENGTH, `prefix: the URI, NUL, u32 ${m.APP_MANIFEST.LABELS.length}`],
        ...m.APP_MANIFEST.LABELS.map((label, i) => [m.APP_MANIFEST.PREFIX_LENGTH + i * m.LABEL_LENGTH, m.LABEL_LENGTH, `${label} label`]),
        [m.APP_MANIFEST.PREFIX_LENGTH + m.APP_MANIFEST.LABELS.length * m.LABEL_LENGTH, m.APP_MANIFEST.SUFFIX_LENGTH, 'constant suffix'],
      ],
    ),
  );
  parts.push(paragraph(`The manifest is ${m.APP_MANIFEST.LENGTH} bytes. Decoded, it has these members.`));
  parts.push(table(HEADER, tableRows(spec.json(m.HOLO_SCHEMAS.APP_MANIFEST))));

  parts.push(heading(2, 'Source manifest'));
  parts.push(schemaSource(spec, m.HOLO_SCHEMAS.SOURCE_MANIFEST));
  parts.push(table(HEADER, tableRows(spec.json(m.HOLO_SCHEMAS.SOURCE_MANIFEST))));

  parts.push(heading(2, 'Extensions'));
  parts.push(paragraph('An extension body is a u16 little-endian name length, the name, then the JSON payload.'));
  parts.push(heading(3, 'Application directory'));
  parts.push(paragraph(`Name: ${code(m.EXTENSION.APPLICATION_DIRECTORY)}.`));
  parts.push(schemaSource(spec, m.HOLO_SCHEMAS.APPLICATION_DIRECTORY));
  parts.push(table(HEADER, tableRows(spec.json(m.HOLO_SCHEMAS.APPLICATION_DIRECTORY))));
  parts.push(heading(3, 'Model provenance'));
  parts.push(paragraph(`Name: ${code(m.EXTENSION.PRISMPM_MODEL)}.`));
  parts.push(schemaSource(spec, m.SCHEMAS[revision.provenanceSchema]));
  parts.push(table(HEADER, tableRows(spec.json(m.SCHEMAS[revision.provenanceSchema]))));

  parts.push(heading(2, 'Capability set'));
  parts.push(paragraph(`URI: ${code(m.CAPABILITY_SET.URI)}. The blob of an application that requests nothing, as hex:`));
  parts.push(fence('text', m.CAPABILITY_SET.EMPTY_HEX));

  parts.push(heading(2, 'Model documents'));
  parts.push(paragraph('A holo carries one model document. Its `schema` member names one of these.'));
  parts.push(table(['Schema', 'File'], revision.modelDocumentSchemas.map((s) => [code(s), code(m.SCHEMAS[s])])));

  parts.push(heading(2, 'Portable view'));
  parts.push(paragraph(`The view blob is a ${code(m.HOLOVIEW.MAGIC)} bundle, version ${m.HOLOVIEW.VERSION}, big-endian, with entry ${code(m.HOLOVIEW.ENTRY)}.`));
  parts.push(
    table(
      ['Limit', 'Value'],
      [
        ['files', m.HOLOVIEW.MAX_FILES],
        ['path bytes', m.HOLOVIEW.MAX_PATH_BYTES],
        ['file bytes', m.HOLOVIEW.MAX_FILE_BYTES],
        ['total bytes', m.HOLOVIEW.MAX_TOTAL_BYTES],
      ],
    ),
  );

  parts.push(heading(2, 'World'));
  parts.push(paragraph(`The guest implements ${code(m.CORE_WASM.CONTRACT)} and exports ${m.CORE_WASM.EXPORTS.map(code).join(', ')}. The world file is ${code(m.CORE_WASM.WORLD)}.`));
  parts.push(fence('wit', spec.text(m.CORE_WASM.WORLD).replace(/^\/\/.*\n/gm, '').trim()));

  parts.push(heading(2, 'Digest footer'));
  parts.push(paragraph(`The last ${m.FOOTER_LENGTH} bytes are the BLAKE3 of every earlier byte. Read the footer, hash the rest of the file, and compare.`));

  parts.push(heading(2, 'Format revisions'));
  parts.push(paragraph('A revision is a date. A file does not carry its revision, so a reader recognizes it by these identifiers.'));
  for (const [date, ids] of Object.entries(m.FORMAT_REVISIONS)) {
    parts.push(heading(3, date));
    parts.push(
      table(
        ['Identifier', 'Value'],
        Object.entries(ids).map(([k, v]) => [code(k), Array.isArray(v) ? v.map(code).join(', ') : code(v)]),
      ),
    );
  }
  parts.push(paragraph(`${code(spec.name)} exports ${code('FORMAT_REVISION')}, the revision it describes: ${code(m.FORMAT_REVISION)}.`));

  return { parts, sources: [spec.source()] };
}

export function attestations({ spec, page }) {
  const m = spec.module;
  const statement = spec.json(m.ATTESTATION.STATEMENT_SCHEMA);
  const envelope = spec.json(m.ATTESTATION.ENVELOPE_SCHEMA);
  const registry = spec.json('predicates/registry.json');
  const parts = [];

  parts.push(paragraph(`Source: ${code(spec.name)} ${m.FORMAT_REVISION}, ${code(m.ATTESTATION.STATEMENT_SCHEMA)}, ${code(m.ATTESTATION.ENVELOPE_SCHEMA)}, ${code('predicates/registry.json')}.`));

  parts.push(heading(2, 'Statement'));
  parts.push(paragraph(`Every attestation is one statement of type ${code(m.ATTESTATION.STATEMENT_TYPE)}.`));
  parts.push(schemaSource(spec, m.ATTESTATION.STATEMENT_SCHEMA));
  parts.push(table(HEADER, tableRows(statement)));
  for (const name of Object.keys(statement.$defs)) {
    parts.push(heading(3, name));
    parts.push(table(HEADER, defRows(statement, name)));
  }

  parts.push(heading(2, 'Envelope'));
  parts.push(paragraph(`The bundle wraps each statement in an envelope whose payload type is ${code(m.ATTESTATION.DSSE_PAYLOAD_TYPE)}.`));
  parts.push(schemaSource(spec, m.ATTESTATION.ENVELOPE_SCHEMA));
  parts.push(table(HEADER, tableRows(envelope)));

  const bundle = spec.json(m.ATTESTATION_BUNDLE.SCHEMA);
  const trustedRoot = spec.json(TRUSTED_ROOT_SCHEMA);
  parts.push(heading(2, 'Transparency log entries and signed timestamps'));
  parts.push(
    paragraph(
      'A keyless signature is checkable only at the time it was made, so a bundle carries two independent witnesses of that time: log entries with an inclusion proof, and signed timestamps. Both sit in the verification material of the bundle. A verifier checks them offline against a trusted root that it pins; the bundle never supplies its own.',
    ),
  );
  parts.push(schemaSource(spec, m.ATTESTATION_BUNDLE.SCHEMA));
  parts.push(heading(3, 'TransparencyLogEntry'));
  parts.push(table(HEADER, defRows(bundle, 'TransparencyLogEntry')));
  parts.push(heading(3, 'Trusted root'));
  parts.push(schemaSource(spec, TRUSTED_ROOT_SCHEMA));
  parts.push(table(HEADER, tableRows(trustedRoot)));
  for (const name of ['TransparencyLog', 'Authority', 'ValidFor']) {
    parts.push(heading(4, name));
    parts.push(table(HEADER, defRows(trustedRoot, name)));
  }

  const provenance = spec.json(m.PROVENANCE.SCHEMA);
  parts.push(heading(2, 'Build provenance'));
  parts.push(
    paragraph(
      `Every holo that ${code('prismpm build')} produces carries one statement of predicate type ${code(m.PROVENANCE.PREDICATE_TYPE)} and build type ${code(m.PROVENANCE.BUILD_TYPE)}. Its subjects are the four content blobs. Its resolved dependencies are the lock. It is written unsigned: the envelope holds one empty signature, which no verifier accepts, until ${code('prism attest')} signs it.`,
    ),
  );
  parts.push(
    paragraph(
      `Mode ${code(m.PROVENANCE.MODES.MIN)} is the default and holds nothing that varies between machines or runs. Mode ${code(m.PROVENANCE.MODES.MAX)} is opt-in with ${code(`${m.PROVENANCE.FLAGS.MODE}=${m.PROVENANCE.MODES.MAX}`)} because it records the build arguments, the platform, an invocation id and timestamps. ${code(m.PROVENANCE.FLAGS.DISABLE)} turns the statement off and is unsafe: a holo built with it cannot reach assurance level P1.`,
    ),
  );
  parts.push(schemaSource(spec, m.PROVENANCE.SCHEMA));
  for (const name of ['MinPredicate', 'MaxPredicate', 'ResourceDescriptor', 'Builder', 'Spec']) {
    parts.push(heading(3, name));
    parts.push(table(HEADER, defRows(provenance, name)));
  }

  parts.push(heading(2, 'Predicate types'));
  parts.push(
    table(
      ['Type', 'Status', 'Schema'],
      registry.predicates.map((p) => [code(p.predicateType), p.status, p.schema ? code(p.schema) : 'none']),
    ),
  );

  parts.push(heading(2, 'Example statement'));
  parts.push(status(page.status));

  return { parts, sources: [spec.source()] };
}

/** The manifest schema. Found by path: it describes prism.toml, not a document with a `schema` member. */
const MANIFEST_SCHEMA = 'schemas/manifest/manifest-v1.schema.json';

export function manifest({ spec, page }) {
  const schema = spec.json(MANIFEST_SCHEMA);
  const [fileForm, inlineForm] = schema.$defs.capabilities.oneOf;
  const parts = [];
  parts.push(paragraph(`Source: ${code(spec.name)} ${spec.module.FORMAT_REVISION}, ${code(MANIFEST_SCHEMA)}.`));
  if (page.status) parts.push(status(page.status));
  parts.push(schemaSource(spec, MANIFEST_SCHEMA));
  parts.push(
    paragraph(
      `${code('prism.toml')} is TOML. The tables below are the manifest after the overlay for the build target, ${code('prism.browser.toml')} or ${code('prism.node.toml')}, is merged in: a table merges key by key, and any other value, arrays included, replaces the one it overrides. An overlay may not set ${code('manifest_version')}.`,
    ),
  );
  parts.push(heading(2, 'Top level'));
  parts.push(table(HEADER, tableRows({ ...schema, properties: { manifest_version: schema.properties.manifest_version } })));
  parts.push(heading(2, code('[application]')));
  parts.push(table(HEADER, defRows(schema, 'application')));
  parts.push(heading(2, code('[model]')));
  parts.push(table(HEADER, defRows(schema, 'model')));
  parts.push(paragraph(`Every path is relative to the project, uses forward slashes and has no ${code('..')} segment.`));
  parts.push(heading(2, code('[capabilities]')));
  parts.push(paragraph(`Without this table the holo is granted nothing. It takes one of two forms: a capability file and the set of it to apply, or the members of one ${code('prism/capabilities/1')} set written inline, which become its ${code('default')} set.`));
  parts.push(heading(3, 'A capability file'));
  parts.push(table(HEADER, tableRows(fileForm)));
  parts.push(heading(3, 'Inline'));
  parts.push(table(HEADER, tableRows({ ...inlineForm, properties: Object.fromEntries(Object.entries(inlineForm.properties).map(([k, v]) => [k, schema.$defs[v.$ref.replace('#/$defs/', '')]])) })));
  parts.push(heading(2, 'Provider services'));
  parts.push(
    paragraph(
      `Any other table under ${code('[capabilities]')} declares a capability that a provider provisions, beside either form above. Its name matches ${code('^[a-z][a-z0-9_]*$')}, and ${code('file')} and ${code('set')} are reserved. A declaration grants nothing: the set must allow the provider's type, and must allow each variable before it is produced.`,
    ),
  );
  parts.push(
    fence(
      'toml',
      ['[capabilities]', 'allow-providers = ["kv"]', 'allow-variables = ["rates_url", "rates_store"]', '', '[capabilities.rates]', 'provider = { type = "kv", options = { store = "rates", set = ["base=EUR"] } }'].join('\n'),
    ),
  );
  parts.push(table(HEADER, defRows(schema, 'provider')));
  parts.push(
    paragraph(
      `An option key matches ${code(schema.$defs.provider.properties.options.propertyNames.pattern)}. A value is a string, an integer, a boolean or an array of those. A string may hold no control character and may not be ${code('env(NAME)')}, because every process on the machine can read a command line. A provider reads its secrets from its own environment.`,
    ),
  );
  parts.push(heading(3, 'The wire protocol'));
  parts.push(
    paragraph(
      `${code('prism-code providers up')} finds ${code('prism-provider-<type>')} on the PATH the way a plugin is found, and runs it in the project directory with the caller's environment and stdin closed. ${code('down')} takes the same arguments and releases what ${code('up')} provisioned. ${code('up')} must be safe to run again.`,
    ),
  );
  parts.push(fence('text', ['prism-provider-<type> --project-name <application> up   [--<option>=<value> ...] <name>', 'prism-provider-<type> --project-name <application> down [--<option>=<value> ...] <name>'].join('\n')));
  parts.push(
    paragraph(
      `Each option is one argument, sorted by option. An array repeats the flag. A provider replies on stdout with one JSON object per line, with exactly the members ${code('type')} and ${code('message')}. Exit 0 with no ${code('error')} message is success. Any other exit fails the call, and so does any other line. ${code('PRISM_PROVIDER_MESSAGES')} lists the accepted types. stderr is passed through and never parsed.`,
    ),
  );
  parts.push(
    table(
      ['Type', 'Meaning'],
      [
        [code('info'), 'Progress, printed on stderr.'],
        [code('debug'), `Detail, given to the ${code('onMessage')} option of the API.`],
        [code('error'), 'Why it failed. The call fails with this text, even on exit 0.'],
        [code('setenv'), `${code('VAR=value')}, split at the first ${code('=')}. ${code('VAR')} matches ${code('^[A-Z][A-Z0-9_]*$')}. It becomes ${code('<NAME>_<VAR>')}, and the variable ${code('<name>_<var>')} must be allowed.`],
      ],
    ),
  );
  parts.push(
    table(
      ['Failure', 'Error', 'Check'],
      [
        ['The set does not allow the type', code('CapabilityDeniedError'), code('capabilities.providers')],
        ['Not on the PATH', code('ProviderNotFoundError'), code('provider.not-found')],
        ['A line that breaks the protocol', code('ProviderReplyError'), code('provider.reply')],
        ['Two sources for one variable', code('ProviderReplyError'), code('provider.collision')],
        [`A non-zero exit or an ${code('error')} message`, code('ProviderFailedError'), code('provider.failed')],
        ['Would not start', code('ProviderFailedError'), code('provider.spawn')],
        ['Ran out of time', code('ProviderFailedError'), code('provider.timeout')],
      ],
    ),
  );
  parts.push(paragraph(`A variable the set does not allow is withheld and reported by name. Today nothing inside a holo can read the result: the guest world imports nothing, and ${code('prism-code run')} does not read this manifest.`));
  parts.push(heading(2, code('[variables]')));
  parts.push(
    paragraph(
      `Each key is a variable name matching ${code(schema.properties.variables.propertyNames.pattern)}. Its value is a string, ${code('env(NAME)')} to read the environment at run time, or a table ${code('{ value, secret }')}. A secret takes its value from ${code('env(NAME)')}, or from the variable's name in upper case when it has no ${code('value')}. A secret written as a literal is an error, and so is any string shaped like a credential.`,
    ),
  );
  parts.push(
    fence(
      'toml',
      ['[variables]', 'log_level = "info"', 'region = "env(REGION)"', 'exchange_api_key = { secret = true }', 'signing_key = { value = "env(SIGNING_KEY)", secret = true }'].join('\n'),
    ),
  );
  return { parts, sources: [spec.source()] };
}

export function lockfile({ spec }) {
  const m = spec.module;
  const parts = [];
  const lockSchemas = Object.entries(m.SCHEMAS).filter(([k]) => k.startsWith('prismpm/sdk-lock/'));
  parts.push(paragraph(`Source: ${code(spec.name)} ${m.FORMAT_REVISION}, ${lockSchemas.map(([, f]) => code(f)).join(', ')}.`));
  parts.push(paragraph(`The lockfile is a JSON document whose ${code('schema')} member names its version.`));
  for (const [id, file] of lockSchemas.reverse()) {
    const schema = spec.json(file);
    parts.push(heading(2, code(id)));
    parts.push(paragraph(`Schema: ${code(schema.$id)}, file ${code(file)}.`));
    parts.push(table(HEADER, tableRows(schema)));
  }
  return { parts, sources: [spec.source()] };
}

export function errors({ spec, runtime, cli, page }) {
  const parts = [];
  parts.push(paragraph(`Source: ${code(runtime.name)} ${runtime.version} source and type declarations, ${code('sdk/docs/cli.json')} ${cli.revision}.`));

  parts.push(heading(2, 'Runtime errors'));
  parts.push(status(page.status));
  parts.push(fence('ts', [declaration(runtime.types, 'PrismError'), declaration(runtime.types, 'PrismCodeError')].join('\n\n')));
  parts.push(paragraph('The typed errors, their codes and the verdict checks that map to them are on the error types page.'));
  parts.push(table(['Code', 'Raised in'], runtime.errorCodes.map((e) => [code(e.code), e.files.map((f) => code(`src/${f}`)).join(', ')])));

  parts.push(heading(2, 'CLI exit codes'));
  parts.push(table(['Code', 'Name', 'Meaning'], cli.exitCodes.map((e) => [e.code, e.name, e.meaning])));

  return { parts, sources: [runtime.source(), `sdk/docs/cli.json ${cli.revision}`, spec.source()] };
}
