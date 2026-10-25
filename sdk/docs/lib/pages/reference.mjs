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

export function manifest({ spec, page }) {
  const parts = [];
  parts.push(paragraph(`Source: ${code(spec.name)} ${spec.module.FORMAT_REVISION}.`));
  parts.push(heading(2, 'Fields'));
  parts.push(status(page.status));
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
