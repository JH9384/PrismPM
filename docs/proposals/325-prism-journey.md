# Proposal 325: the guided journey, six answers to a verified app

| | |
| --- | --- |
| Issue | [#325](https://github.com/UOR-Foundation/PrismPM/issues/325) |
| Status | Proposed, Experimental |
| Depends on | #281 (`init` and its template), #280 (`prism.toml`), the text application profile, `setup` (#539) |
| Beside | [325-authoring-front-door.md](325-authoring-front-door.md) |
| Used by | agents, through `prism-code mcp` |

## Summary

An agent asks the user six short questions and Prism builds an app whose stated properties are proved by Lean and whose behaviour the guest replays as acceptance vectors. Prism writes the model; no one writes LexLean or a proof.

```
npx prism-code@latest setup
```

`setup` already readies the machine and the agents. This adds one verb, `prism-code mcp`, a stdio MCP server that owns the whole guided journey, and `setup` adds it to every agent it configures, as `prism` beside the remote `lexlean` server.

## How it sits beside the authoring front door

Both serve #325. In the [authoring front door](325-authoring-front-door.md), an agent writes the model and the toolchain, the kernel and the examples decide; it reaches any app the language can express, at the cost of builds an agent's mistakes spend. Here, the app is narrower (one decision over a line of fields) and Prism writes the model itself from checked answers, so every model it builds checks, every property has one fixed proof form, and a mistake in the spec is caught in under a second, before any build. An agent picks the guided path when the app fits it and the front door otherwise; the shipped `prism` skill says so.

## Motivation

Building one app today means learning LexLean notation, axiom sets, glossary titles, the text profile's vector rules and the SDK image, before the first proof. The prism-chess build measured that cost: three twelve-minute verify runs, seven check cycles on language rules, and a manual axiom workaround. None of that is the user's intent. The user knows what the app should decide and what must never happen. Prism should ask for exactly that and do the rest.

### Goals

1. One command to a server every agent on the machine can call.
2. Six questions, each checked as it is answered, with any problem returned as one question the user can answer.
3. Every stated property proved by Lean, with no proof written by hand.
4. A built holo whose acceptance vectors pass in the guest.
5. No dependency added to `prism-code`.

### Non-goals

- Apps beyond decisions over a request line. The text application profile is the only one shipped; a richer session waits for richer profiles.
- Teaching LexLean. The model is generated and readable; `SPEC.md` is the human view.
- Replacing the authoring front door or `lexlean`. They stay the path for everything else.

## Proposal

### In `setup`

`setup` plans and applies everything it does, and `journey/register.mjs` plans one more row per agent it finds, with the same step kinds: the server `prism`, run as this Node and this package's `mcp` verb, or as `npx -y prism-code@<version> mcp` when setup itself runs from the npx cache.

| Agent | Where `prism` goes |
| --- | --- |
| Claude Code | `claude mcp add --scope user prism -- ...` when `claude` is on the PATH, else `mcpServers.prism` in `~/.claude.json` |
| Codex | `[mcp_servers.prism]` in `config.toml`, with `tool_timeout_sec = 900` |
| Cursor | `mcpServers.prism` in `~/.cursor/mcp.json` |
| VS Code | `servers.prism` in the user `mcp.json` |
| Claude Desktop | `mcpServers.prism` in `claude_desktop_config.json`: it takes no remote server, but it takes a local one |

A file `lexlean` also changes is written once with both entries and backed up once. An entry setup wrote is replaced when the command moved; any other `prism` entry is left alone. The server finds Docker as every delegated verb does (`host.mjs`): the program `setup` recorded, WSL included, and the per-image cache volume at `/tmp`.

### The server

`prism-code mcp` speaks MCP over stdio (protocol versions 2025-06-18, 2025-03-26 and 2024-11-05). The greeting reaches the user three ways, so at least one works in every agent: the server's `instructions`, the `prism` prompt, and the guided path of the `prism` skill `setup` installs.

| Tool | Does |
| --- | --- |
| `prism_start` | greets, and returns the next question |
| `prism_answer` | records an answer, checks it, and returns the next question or the issue; `step` revises an earlier answer |
| `prism_spec` | reads the spec, or replaces it as `prism/spec/1` JSON, checked exactly as answers are |
| `prism_prove` | writes the model and asks Lean to prove every property |
| `prism_build` | proves, then builds the holo and replays its vectors through the guest |
| `prism_try` | answers one request, from the built guest when there is one |
| `prism_status` | the session, the proofs, the build and any job |

Proving takes minutes, and Codex waits 60 seconds for a tool by default. `prism_prove` and `prism_build` therefore run as jobs: a call waits up to `wait` seconds, returns `running` with the latest lines, and the next call picks the job up. Progress also goes out as `notifications/progress` when the client asks for it.

### The session

| Step | Question | Format |
| --- | --- | --- |
| purpose | What should this app decide? | one sentence; `Name: sentence` names the app |
| fields | What goes into one request? | `role: clerk\|manager, amount: number at least 1, limit: number` |
| outcomes | What can the answer be? | `approved, refused` |
| rules | What are the rules, in order? | `when <condition> [and <condition>] then <answer>`, then `otherwise <answer>` |
| properties | What must never or always happen? | `never when <condition> then <answer>` |
| examples | Real requests and their answers | `<request> -> <answer>` |
| review | Is this right? | `yes`, or what to change |

The agent rewrites plain language into the format and says what it wrote. The spec is rebuilt from the raw answers every time, so changing the fields asks the rules again when they name a field that is gone. Each answer is checked against an evaluator with the model's exact semantics:

- A property the rules break returns the request that breaks it and the rule that decided it. The search tries every choice and every number on an edge of a comparison or a bound, which covers every ordering of the numbers involved.
- An example the rules contradict returns the rule that decides it, or why it does not decode.
- A rule an earlier rule always shadows is noted.

### From spec to model

| Spec | LexLean |
| --- | --- |
| a choice field | a `Nat` code behind one named constant per choice, and a parser over the choice words |
| the request | bytes, never decoded as text: `fieldEnd` finds each space, and one decoder per field reads the field at its position and hands the values on |
| a number field | `Nat`, read one byte at a time with `recursive_argument: fuel` (at most 18 digits, no sign, no leading zero), and its bounds |
| an answer | a `Nat` code behind a named constant, and its word in `encodeAnswer` |
| a rule | a `Bool` definition of `=?`, `<?`, `<=?` and `not` over the request |
| the rules | `judge`: an `if` chain, first match wins, then `otherwise` |
| a property | in the proofs module, a `breaks` test and a theorem `(breaks request) = false`, by `linear_arithmetic` |
| an example | an acceptance vector |

Every condition is a `Nat` comparison, which `linear_arithmetic` reflects into propositions before it splits the `if` chain and calls `omega`. That is why one fixed proof form proves every property. A property is stated together with the field bounds, so it holds for exactly the requests that decode. `Int64` comparisons were tried first: `<=?` is `Nat` only, and `less_than` is not among the bridges `linear_arithmetic` rewrites, so `omega` never sees it. The guest itself follows what the production export accepts, which the builds below found one refusal at a time:

- The exporter's LCNF parser stops at 64 levels of nesting (`PP5004`, `TooLarge`). `parse_decimal` into `UInt64` then `to_nat` compiles to code deeper than that, and so do several `UInt8` to `Nat` conversions in one expression, because the compiler unrolls each bit by bit. Every byte is therefore converted once, in `byteAt`, as prism-chess converts its board.
- The guest is generated without allocation (`PP4102`), so a list cannot be an intermediate value. Fields are found by position, not split into a list.
- The request is never decoded as UTF-8 text, and the answer is a byte literal. Every field is ASCII, so a byte that is not ASCII already makes its field fail, and the answer is `invalid` either way.

The theorems live in `<App>Proofs.lex.tex`, which imports the app module and is not an entrypoint. `lexlean verify --all` proves them about the very definitions the guest is built from, and the build never compiles them. In the app module they made the build's Lean stage exceed its fixed 600 seconds: it compiles with two threads (`moreLeanArgs = ["-j2"]`), and the same build without them passed that stage.

Every definition carries its expected axiom set. When `lexlean verify` observes another set (`LLV7005`), the server writes the observed set and proves again, up to eight rounds, without asking: it is bookkeeping, not intent. `\title{}` is always the glossary phrase `Text application model`, so `LLL1004` cannot occur, and one acceptance vector is exactly the guest allocation bound long, as `PP2009` requires.

### Files

```
prism/
  spec.json      the spec as data
  session.json   where the conversation is, what was proved and built
  SPEC.md        the spec in prose, each property marked proved, failing or tested only
  src/<App>.lex.tex         the model the guest is built from
  src/<App>Proofs.lex.tex   the theorems about it
  prism.toml, prismpm.toml, prismpm.lock, standards.lock, lexlean.toml, lexlean.lock, the Lean workspace, language/
```

A hand edit of either model file is noticed by digest, and the server refuses to overwrite it unless asked with `overwrite: true`.

## What was run

On Windows 11 with Docker Engine 29.1.3 inside WSL Ubuntu and the SDK image `prismpm-sdk-candidate@sha256:cd3b47d7...`:

| Step | Result | Time |
| --- | --- | --- |
| `lexlean check` and `prismpm check` of the PaymentApproval spec | pass | about 25 s |
| `lexlean verify` with both properties | both proved after one axiom correction | about 3.5 min |
| `prismpm verify` with the theorems in the app module | `PP5007: application-lean timed out` | 11 min |
| `prismpm verify` with no theorem, `UInt64` parsing | Lean stage passed; `PP5004` LCNF parse | 4 min |
| `prismpm verify` with bytes converted in several places | `PP5004` LCNF parse, `TooLarge` | under 2 min |
| `prismpm verify` with one conversion in `byteAt`, fields as a list | `PP4102` list as an intermediate value | 3 min |
| `prismpm verify` with positional decoders | holo written, 18.8 KB | 3 min |
| `prism-code vectors` on that holo | 28 of 28 pass in the guest | seconds |
| prism-chess, the same image, as a control | holo written | 23 min |
| Payment approval, six answers through `prism-code mcp` | 2 of 2 properties proved, 27 of 27 vectors | prove 70 s, build 12 min |
| Ticket price (3 fields, 4 rules, 3 properties), the same way | 3 of 3 proved, 37 of 37 vectors, 7 of 7 tries agree | build 16 min |
| A real Claude Code session in a folder `setup` prepared | `/prism` reached the server and greeted | |

`node --test test/journey.test.mjs` covers parsing, the evaluator, the rendered model, the vectors, the session, the project files, the job guard and the MCP protocol in process and over stdio; `test/setup.test.mjs` covers `prism` beside `lexlean` in every agent's file, and that a second run changes nothing.

## Unresolved questions

1. Whether the proofs module should be part of the holo's proof evidence. Today the holo carries the build's Lean evidence for the app module, and the theorems are attested by `lexlean verify` beside it.
2. Whether the journey should also proxy the lexlean-mcp tools for agents that write LexLean directly. The gateway speaks loopback HTTP only and needs provisioning, so it is not wired in.
3. The default SDK image. No SDK release exists; a new app is pinned to the candidate that built prism-chess unless the session names another.
4. Richer apps: lists, state across requests, arithmetic in rules. Each needs a proof form that stays automatic.
5. Build time. The cache volume `setup` creates is used, but a first build still takes ten minutes or more.
