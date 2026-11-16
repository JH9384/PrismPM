/**
 * The release entries of CHANGELOG.md held to STABILITY.md section 2, the
 * pre-1.0 rule: a minor bump may break you, a patch bump never does, and every
 * entry uses the four headers below, in this order.
 *
 * Two checks, both on the file alone:
 *   - headers: an entry newer than LEGACY_THROUGH uses only the four headers,
 *     once each and in order, and always has Breaking Changes (empty says None.);
 *   - bump: below 1.0 an entry with breaking changes is a minor bump over the
 *     entry before it, and an entry without any is a patch bump.
 *
 * Entries up to and including LEGACY_THROUGH (the root CHANGELOG.md only) were
 * written before the rule and keep the headers they were published with. Only
 * 0.1.0 does: 0.2.0 to 0.4.0 use the four headers. The per-package changelogs
 * under sdk/npm/ have no legacy entries.
 */

export const HEADERS = ['Features Added', 'Breaking Changes', 'Bugs Fixed', 'Other Changes'];
export const LEGACY_THROUGH = '0.1.0';

/**
 * `## [1.2.3] - 2026-01-02`, as written by hand, and
 * `## [1.2.3](https://…) (2026-01-02)`, as release-please writes it.
 */
const ENTRY = /^## \[(Unreleased|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\](?:\([^)]*\))?(?:(?: - | \()(\d{4}-\d{2}-\d{2})\)?)?\s*$/;

/** @returns {number[]} major, minor, patch; a pre-release suffix is ignored. */
export function parseVersion(version) {
  return version.split('-')[0].split('.').map(Number);
}

function newerThan(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/**
 * @returns {{ version: string, date: string|null, line: number, sections: { name: string, line: number, empty: boolean }[] }[]}
 *   the release entries, in the order written (newest first).
 */
export function parseChangelog(text) {
  const entries = [];
  let entry = null;
  let section = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (/^## /.test(raw)) {
      const match = ENTRY.exec(raw);
      entry = match ? { version: match[1], date: match[2] ?? null, line, sections: [] } : null;
      section = null;
      if (entry) entries.push(entry);
      return;
    }
    if (!entry) return;
    const heading = /^### (.+?)\s*$/.exec(raw);
    if (heading) {
      section = { name: heading[1], line, empty: true };
      entry.sections.push(section);
    } else if (section && raw.trim() && !/^none\.?$/i.test(raw.trim())) {
      section.empty = false;
    }
  });
  return entries;
}

/** @returns {{ line: number, message: string }[]} */
export function releaseEntryProblems(text, legacyThrough = LEGACY_THROUGH) {
  const problems = [];
  const entries = parseChangelog(text);
  entries.forEach((entry, index) => {
    const released = entry.version !== 'Unreleased';
    if (released && !entry.date) problems.push({ line: entry.line, message: `${entry.version} has no date: write ## [${entry.version}] - YYYY-MM-DD` });
    if (released && !newerThan(entry.version, legacyThrough)) return;

    for (const section of entry.sections) {
      if (HEADERS.includes(section.name)) continue;
      const hint = /breaking/i.test(section.name) ? ': rename it to ### Breaking Changes and move it after ### Features Added' : '';
      problems.push({ line: section.line, message: `${entry.version}: ### ${section.name} is not one of ${HEADERS.map((h) => `### ${h}`).join(', ')}${hint}` });
    }
    const known = entry.sections.filter((s) => HEADERS.includes(s.name));
    known.forEach((section, i) => {
      if (known.findIndex((s) => s.name === section.name) !== i) problems.push({ line: section.line, message: `${entry.version}: ### ${section.name} appears twice` });
      else if (i > 0 && HEADERS.indexOf(section.name) < HEADERS.indexOf(known[i - 1].name)) problems.push({ line: section.line, message: `${entry.version}: ### ${section.name} is out of order, the order is ${HEADERS.join(', ')}` });
    });
    const breaking = entry.sections.find((s) => s.name === 'Breaking Changes');
    if (released && !breaking) problems.push({ line: entry.line, message: `${entry.version} has no ### Breaking Changes: write None. when it breaks nothing` });
    if (!released || !breaking) return;

    const previous = entries.slice(index + 1).find((e) => e.version !== 'Unreleased');
    if (!previous) return;
    const [major, minor, patch] = parseVersion(entry.version);
    const [pMajor, pMinor, pPatch] = parseVersion(previous.version);
    if (major !== 0 || pMajor !== 0) return;
    const minorBump = minor === pMinor + 1 && patch === 0;
    const patchBump = minor === pMinor && patch === pPatch + 1;
    if (!breaking.empty && !minorBump) problems.push({ line: breaking.line, message: `${entry.version} lists breaking changes, so before 1.0 it must be a minor bump over ${previous.version}` });
    if (breaking.empty && !patchBump) problems.push({ line: entry.line, message: `${entry.version} breaks nothing, so before 1.0 it must be a patch bump over ${previous.version}` });
  });
  return problems;
}

/** The first released entry of a changelog as line numbers, or null when it has none. */
function newestEntryLines(lines) {
  const start = lines.findIndex((line) => {
    const match = ENTRY.exec(line);
    return match && match[1] !== 'Unreleased';
  });
  if (start === -1) return null;
  const next = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return { start, end: next === -1 ? lines.length : next };
}

/**
 * What release-please writes, as the four headers. It opens a breaking entry with
 * `### ⚠ BREAKING CHANGES` and writes nothing when there are none, so this renames
 * and moves that section, or adds `### Breaking Changes` with `None.`. It touches
 * only the newest released entry, changes no bullet, and returns an entry that
 * already has the shape byte for byte. Two sections with one name become one.
 */
export function normalizeNewestEntry(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const range = newestEntryLines(lines);
  if (!range) return text;

  const preamble = [];
  const sections = [];
  let current = preamble;
  let repeated = false;
  for (const line of lines.slice(range.start + 1, range.end)) {
    const heading = /^### (.+?)\s*$/.exec(line);
    if (!heading) {
      current.push(line);
      continue;
    }
    const name = /breaking/i.test(heading[1]) ? 'Breaking Changes' : heading[1];
    const existing = sections.find((s) => s.name === name);
    repeated ||= Boolean(existing);
    const section = existing ?? { name, written: heading[1], body: [] };
    if (existing) section.body.push('');
    else sections.push(section);
    current = section.body;
  }
  const known = sections.filter((s) => HEADERS.includes(s.name));
  const ordered = known.every((s, i) => i === 0 || HEADERS.indexOf(s.name) > HEADERS.indexOf(known[i - 1].name));
  const hasBreaking = sections.some((s) => s.name === 'Breaking Changes');
  if (ordered && hasBreaking && !repeated && sections.every((s) => s.name === s.written)) return text;

  if (!hasBreaking) sections.push({ name: 'Breaking Changes', written: 'Breaking Changes', body: ['None.'] });
  const rank = (s) => (HEADERS.includes(s.name) ? HEADERS.indexOf(s.name) : HEADERS.length);
  const rebuilt = [...sections].sort((a, b) => rank(a) - rank(b)).flatMap((s) => {
    const body = s.body.join('\n').trim().replace(/\n{3,}/g, '\n\n');
    return [`### ${s.name}`, '', ...(body ? [...body.split('\n'), ''] : [])];
  });
  const head = preamble.join('\n').trim();
  const entry = [lines[range.start], '', ...(head ? [...head.split('\n'), ''] : []), ...rebuilt];
  return [...lines.slice(0, range.start), ...entry, ...lines.slice(range.end)].join(eol);
}

/**
 * Moves what `## [Unreleased]` holds into the newest released entry, and removes the
 * section. release-please inserts its entry above `## [Unreleased]` and leaves that
 * section alone, so hand-written notes would otherwise stay there, unreleased, after they
 * shipped. Call this only on a changelog whose newest entry was just written.
 */
export function foldUnreleased(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => ENTRY.exec(line)?.[1] === 'Unreleased');
  const range = newestEntryLines(lines);
  if (start === -1 || !range) return text;
  const next = lines.findIndex((line, index) => index > start && /^## /.test(line));
  const end = next === -1 ? lines.length : next;

  const sections = [{ name: 'Other Changes', body: [] }];
  for (const line of lines.slice(start + 1, end)) {
    const heading = /^### (.+?)\s*$/.exec(line);
    if (heading) sections.push({ name: heading[1], body: [] });
    else sections.at(-1).body.push(line);
  }
  const notes = sections.flatMap(({ name, body }) => {
    const note = body.join('\n').trim();
    return !note || /^none\.?$/i.test(note) ? [] : [`### ${name}`, '', ...note.split('\n'), ''];
  });
  const folded = [];
  lines.forEach((line, index) => {
    if (index === range.end) folded.push(...notes);
    if (index < start || index >= end) folded.push(line);
  });
  if (range.end === lines.length) folded.push(...notes);
  return folded.join(eol);
}

/** A changelog whose newest entry release-please just wrote, as it should be committed. */
export function finishReleaseEntry(text) {
  return normalizeNewestEntry(foldUnreleased(text));
}

/**
 * The entry for one version, its heading included, as the GitHub Release body.
 * @returns {string|null} null when the changelog has no entry for that version.
 */
export function entryFor(text, version) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => ENTRY.exec(line)?.[1] === version);
  if (start === -1) return null;
  const next = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return `${lines.slice(start, next === -1 ? lines.length : next).join('\n').trim()}\n`;
}
