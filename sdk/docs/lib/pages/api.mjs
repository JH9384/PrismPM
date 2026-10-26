/**
 * API pages. The ones whose example runs today, `load`, `dispatch`,
 * `acceptance` and the spec constants, show the executed script and its
 * captured output. The others are emitted from the type declarations with
 * one status line where the example cannot run yet.
 */
import { declaration, exportsOf, member } from '../dts.mjs';
import { code, fence, heading, paragraph, status, table } from '../markdown.mjs';

function signature(...blocks) {
  return [heading(2, 'Signature'), fence('ts', blocks.join('\n\n'))];
}

function example(run) {
  return [heading(2, 'Example'), fence('js', run.source), fence('text', run.output)];
}

function runtimeSource(runtime) {
  return paragraph(`Source: ${code(runtime.name)} ${runtime.version}, ${code('types/index.d.ts')}.`);
}

export function apiIndex({ runtime, examples }) {
  const parts = [runtimeSource(runtime)];
  parts.push(heading(2, 'Install'));
  parts.push(fence('bash', `npm install ${runtime.name}`));
  parts.push(...example(examples['three-calls']));
  parts.push(heading(2, 'Exports'));
  parts.push(
    table(
      ['Export', 'Kind', 'Declaration'],
      exportsOf(runtime.types).map((e) => [code(e.name), e.kind, code(e.line)]),
    ),
  );
  return { parts, sources: [runtime.source(), runtime.fixtureSource()] };
}

export function load({ runtime, examples }) {
  const parts = [runtimeSource(runtime)];
  parts.push(...signature(declaration(runtime.types, 'load'), declaration(runtime.types, 'LoadOptions')));
  parts.push(heading(2, 'Returns'));
  parts.push(fence('ts', declaration(runtime.types, 'Application')));
  parts.push(...example(examples.load));
  return { parts, sources: [runtime.source(), runtime.fixtureSource()] };
}

export function dispatch({ runtime, examples }) {
  const parts = [runtimeSource(runtime)];
  parts.push(...signature(member(runtime.types, 'Application', 'dispatch'), declaration(runtime.types, 'Limits')));
  parts.push(...example(examples.dispatch));
  return { parts, sources: [runtime.source(), runtime.fixtureSource()] };
}

export function historyAndReplay({ runtime, examples, page }) {
  const parts = [runtimeSource(runtime)];
  parts.push(status(page.status));
  parts.push(
    ...signature(
      member(runtime.types, 'Application', 'acceptance'),
      declaration(runtime.types, 'AcceptanceResult'),
      declaration(runtime.types, 'AcceptanceFailure'),
      declaration(runtime.types, 'Vector'),
    ),
  );
  parts.push(...example(examples.acceptance));
  return { parts, sources: [runtime.source(), runtime.fixtureSource()] };
}

export function inspect({ runtime, spec, page }) {
  const holo = spec.text('types/holo.d.ts');
  const parts = [paragraph(`Source: ${code(runtime.name)} ${runtime.version}, ${code('types/index.d.ts')}; ${code(spec.name)} ${spec.module.FORMAT_REVISION}, ${code('types/holo.d.ts')}.`)];
  parts.push(heading(2, 'Example'));
  parts.push(status(page.status));
  parts.push(...signature(declaration(runtime.types, 'ArchiveIdentities'), declaration(runtime.types, 'ParsedArchive')));
  parts.push(heading(2, 'What a reader decodes'));
  parts.push(fence('ts', [declaration(holo, 'SectionTableEntry'), declaration(holo, 'AppManifestLabels'), declaration(holo, 'ExtensionName'), declaration(holo, 'ContentBlobRole')].join('\n\n')));
  return { parts, sources: [runtime.source(), spec.source()] };
}

export function verify({ runtime, examples, page }) {
  const parts = [runtimeSource(runtime)];
  parts.push(status(page.status));
  parts.push(
    ...signature(
      declaration(runtime.types, 'experimental_verify'),
      member(runtime.types, 'Application', 'experimental_verify'),
      declaration(runtime.types, 'VerifyOptions'),
      declaration(runtime.types, 'experimental_createClient'),
    ),
  );
  parts.push(heading(2, 'Returns'));
  parts.push(fence('ts', [declaration(runtime.types, 'Verdict'), declaration(runtime.types, 'VerdictReason')].join('\n\n')));
  parts.push(...example(examples.verify));
  return { parts, sources: [runtime.source(), runtime.fixtureSource()] };
}

export function instantiate({ spec, page }) {
  const m = spec.module;
  const holo = spec.text('types/holo.d.ts');
  const parts = [paragraph(`Source: ${code(spec.name)} ${m.FORMAT_REVISION}, ${code('types/holo.d.ts')}, ${code(m.CORE_WASM.WORLD)}.`)];
  parts.push(heading(2, 'Example'));
  parts.push(status(page.status));
  parts.push(heading(2, 'What an instance exports'));
  parts.push(fence('ts', [declaration(holo, 'CoreWasmContract'), declaration(holo, 'CoreWasmExports'), declaration(holo, 'World')].join('\n\n')));
  parts.push(fence('wit', spec.text(m.CORE_WASM.WORLD).replace(/^\/\/.*\n/gm, '').trim()));
  return { parts, sources: [spec.source()] };
}

export function asTool({ runtime, page }) {
  const parts = [runtimeSource(runtime)];
  parts.push(heading(2, 'Example'));
  parts.push(status(page.status));
  return { parts, sources: [runtime.source()] };
}

/** Each error class and the verdict checks that map to it. The code of a class is read from its declaration. */
const CLASSES = [
  ['VerificationError', '`holo.*`, `provenance.*`, `policy.*`, and no verdict reached'],
  ['ProofMismatchError', '`proof.*`'],
  ['CapabilityDeniedError', '`world.capabilities`'],
  ['WorldMismatchError', '`world.contract`, `world.hash`'],
  ['DeterminismViolationError', '`replay.divergence`'],
  ['ReplayError', 'every other `replay.*`'],
];

export function apiErrors({ runtime, page }) {
  const parts = [runtimeSource(runtime)];
  parts.push(status(page.status));
  parts.push(...signature(declaration(runtime.types, 'PrismError'), declaration(runtime.types, 'PrismCodeError'), ...CLASSES.map(([name]) => declaration(runtime.types, name))));
  parts.push(heading(2, 'Classes'));
  parts.push(
    table(
      ['Class', 'Code', 'Verdict checks'],
      CLASSES.map(([name, checks]) => [code(name), code(/code: '([a-z_]+)'/.exec(declaration(runtime.types, name))[1]), checks]),
    ),
  );
  parts.push(heading(2, 'Codes of load and archive failures'));
  parts.push(table(['Code', 'Raised in'], runtime.errorCodes.map((e) => [code(e.code), e.files.map((f) => code(`src/${f}`)).join(', ')])));
  return { parts, sources: [runtime.source()] };
}

/** A generated region: the tables inside are rebuilt from the spec's files on every generation. */
function region(name, ...parts) {
  return [paragraph(`<!-- generated:${name}:begin -->`), ...parts, paragraph(`<!-- generated:${name}:end -->`)];
}

export function specPackage({ spec, examples }) {
  const m = spec.module;
  const found = spec.registry;
  // The hand-written constants and the generated entry point, one export table.
  const declarations = `${spec.text('constants.d.ts')}\n${spec.text('index.d.ts')}`;
  const parts = [paragraph(`Source: ${code(spec.name)} ${spec.version}, format revision ${m.FORMAT_REVISION}, ${code('constants.d.ts')}, ${code('index.d.ts')}.`)];
  parts.push(heading(2, 'Install'));
  parts.push(fence('bash', `npm install ${spec.name}`));
  parts.push(...example(examples['spec-constants']));
  parts.push(heading(2, 'Exports'));
  parts.push(
    table(
      ['Export', 'Kind', 'Declaration'],
      exportsOf(declarations).map((e) => [code(e.name), e.kind, code(e.line)]),
    ),
  );
  parts.push(heading(2, 'Schemas'));
  parts.push(paragraph('The package finds its schemas by reading its folders, so a new schema appears here, in the exports above and in the types without anyone editing a list.'));
  parts.push(table(['Document', 'File'], Object.entries(m.SCHEMAS).map(([k, v]) => [code(k), code(v)])));
  parts.push(table(['Section', 'File'], Object.entries(m.HOLO_SCHEMAS).map(([k, v]) => [code(k), code(v)])));
  parts.push(heading(3, 'Every schema'));
  parts.push(...region('schemas', table(['Schema', 'Title', 'File'], found.schemas.map((s) => [code(s.id), s.title, code(s.path)]))));
  parts.push(heading(2, 'Predicates'));
  parts.push(
    ...region(
      'predicates',
      table(
        ['Predicate type', 'Status', 'Schema'],
        found.predicates.map((p) => [code(p.predicateType), p.status, p.schema ? code(spec.json(p.schema).$id) : 'none']),
      ),
    ),
  );
  parts.push(heading(2, 'World'));
  parts.push(paragraph(`${code(m.CORE_WASM.WORLD)} declares ${code(m.CORE_WASM.CONTRACT)}.`));
  return { parts, sources: [spec.source()] };
}

export function missingPackage({ page, spec }) {
  const parts = [paragraph(`Source: none at ${code(spec.name)} ${spec.module.FORMAT_REVISION}.`)];
  parts.push(heading(2, 'Example'));
  parts.push(status(page.status));
  return { parts, sources: [spec.source()] };
}
