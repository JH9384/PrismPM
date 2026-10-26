/**
 * The vocabulary the docs may not use, from the docs style guide's
 * "Banned anywhere in the docs" list. Each entry is a name and a
 * case-insensitive pattern. The lint applies them to prose: text outside
 * fenced code blocks and inline code spans, with two exceptions, the
 * predicate type URIs and the site hostname, both identifiers.
 */

export const BANNED = [
  { name: 'UOR', pattern: /\buor\b/i },
  { name: 'foundation', pattern: /\bfoundation\b/i },
  { name: 'kappa', pattern: /\bkappas?\b/i },
  { name: 'κ', pattern: /κ/ },
  { name: 'Atlas', pattern: /\batlas\b/i },
  { name: 'Hologram', pattern: /\bhologram(?:-live)?\b/i },
  { name: 'HOLOVIEW', pattern: /\bholoview\b/i },
  { name: 'PrismPM', pattern: /\bprismpm\b/i },
  { name: 'Prism library', pattern: /\bprism library\b/i },
  { name: 'module portal', pattern: /\bmodule portal\b/i },
  { name: 'register', pattern: /\bregisters?\b/i },
  { name: 'claim', pattern: /\bclaims?\b/i },
  { name: 'oracle', pattern: /\boracles?\b/i },
  { name: 'qualify', pattern: /\bqualif(?:y|ies|ied|ying|ication|ications)\b/i },
  { name: 'custody', pattern: /\bcustody\b/i },
  { name: 'genesis', pattern: /\bgenesis\b/i },
  { name: 'profile number', pattern: /\b(?:text|numeric|browser|library)\/[0-9]+\b/i },
  { name: 'issue number', pattern: /(?:^|[\s(])#[0-9]+\b/ },
  { name: 'milestone name', pattern: /\bM[0-9]\s+v[0-9]/ },
  { name: 'person', pattern: /\b(?:afflom|humuhumu33|ilya|paveliev)\b/i },
];

/** Style rules that apply to every line, code included. */
export const STYLE = [
  { name: 'em dash', pattern: /—/ },
  { name: 'emoji', pattern: /\p{Extended_Pictographic}/u },
];

/** Identifiers that contain a banned word and are allowed as written. */
export const ALLOWED = [
  /https:\/\/uor\.foundation\/prism\/[a-z][a-z0-9-]*\/v[0-9]+/g,
  /universal-coordinate-foundation\.lovable\.app/g,
  // The changelog's closing reference to the feature request it shipped.
  /Closes \[#[0-9]+\]\(https:\/\/github\.com\/UOR-Foundation\/PrismPM\/issues\/[0-9]+\)/g,
];
