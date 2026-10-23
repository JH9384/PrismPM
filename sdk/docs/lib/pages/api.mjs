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

export function verify({ spec, page }) {
  const holo = spec.text('types/holo.d.ts');
  const parts = [paragraph(`Source: ${code(spec.name)} ${spec.module.FORMAT_REVISION}, ${code('types/holo.d.ts')}.`)];
  parts.push(heading(2, 'Example'));
  parts.push(status(page.status));
  parts.push(heading(2, 'What a reader declares'));
  parts.push(fence('ts', [declaration(holo, 'FormatRevision'), declaration(holo, 'RevisionSupport'), declaration(holo, 'FormatRevisionIdentifiers')].join('\n\n')));
  return { parts, sources: [spec.source()] };
}

export function instantiate({ spec, page }) {
  const m = spec.module;
  const holo = spec.text('types/holo.d.ts');
  const parts = [paragraph(`Source: ${code(spec.name)} ${m.FORMAT_REVISION}, ${code('types/holo.d.ts')}, ${code(m.CORE_WASM.WORLD)}.`)];
  parts.push(heading(2, 'Example'));
  parts.push(status(page.status));
  parts.push(heading(2, 'What an instance exports'));
  parts.push(fence('ts', [declaration(holo, 'CoreWasmContract'), declaration(holo, 'CoreWasmExports')].join('\n\n')));
  parts.push(fence('wit', spec.text(m.CORE_WASM.WORLD).replace(/^\/\/.*\n/gm, '').trim()));
  return { parts, sources: [spec.source()] };
}

export function asTool({ runtime, page }) {
  const parts = [runtimeSource(runtime)];
  parts.push(heading(2, 'Example'));
  parts.push(status(page.status));
  return { parts, sources: [runtime.source()] };
}

export function apiErrors({ runtime, page }) {
  const parts = [runtimeSource(runtime)];
  parts.push(...signature(declaration(runtime.types, 'PrismCodeError')));
  parts.push(heading(2, 'Codes'));
  parts.push(table(['Code', 'Raised in'], runtime.errorCodes.map((e) => [code(e.code), e.files.map((f) => code(`src/${f}`)).join(', ')])));
  parts.push(heading(2, 'Example'));
  parts.push(status(page.status));
  return { parts, sources: [runtime.source()] };
}

export function specPackage({ spec, examples }) {
  const m = spec.module;
  const index = spec.text('index.d.ts');
  const parts = [paragraph(`Source: ${code(spec.name)} ${spec.version}, format revision ${m.FORMAT_REVISION}, ${code('index.d.ts')}.`)];
  parts.push(heading(2, 'Install'));
  parts.push(fence('bash', `npm install ${spec.name}`));
  parts.push(...example(examples['spec-constants']));
  parts.push(heading(2, 'Exports'));
  parts.push(
    table(
      ['Export', 'Kind', 'Declaration'],
      exportsOf(index).map((e) => [code(e.name), e.kind, code(e.line)]),
    ),
  );
  parts.push(heading(2, 'Schemas'));
  parts.push(table(['Document', 'File'], Object.entries(m.SCHEMAS).map(([k, v]) => [code(k), code(v)])));
  parts.push(table(['Section', 'File'], Object.entries(m.HOLO_SCHEMAS).map(([k, v]) => [code(k), code(v)])));
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
