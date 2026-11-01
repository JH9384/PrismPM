---
title: Use with agents
description: Give an agent a holo as a tool, serve it over MCP, or let an agent write the model.
available_in: "1.0-beta"
---
This guide covers three ways agents and holos meet. An agent can call a holo as a tool, an agent can reach it as a Model Context Protocol server, and an agent can write the model that becomes a holo. In every case the holo is checked before the first call.

## As a tool with the Vercel AI SDK

`asTool(holo)` returns a tool shaped for the Vercel AI SDK: an `inputSchema` taken from the holo's world and an `execute` that dispatches to a checked instance. The agent sees a typed tool. It cannot see or change the capability set:

```ts
import { generateText } from "ai";
import { load, asTool } from "prism-code";

const holo = await load("calculator@sha256:3f9c…");

const result = await generateText({
  model: languageModel,
  tools: { calculator: asTool(holo) },
  prompt: "What is 2 plus 3?",
});
```

```text
tool call    calculator  {"op": "add", "a": 2, "b": 3}
tool result  5
```

`asTool` runs `holo.verify()` before the first `execute` and throws `VerificationError` when the verdict is not a pass. Every call is recorded in the instance history, so an agent session replays like any other run. An input outside the schema is rejected before it reaches the instance.

## As an MCP server

`@prism-code/mcp` exposes a holo as a Model Context Protocol server. Each export in the world becomes one tool. Start it on standard input and output:

```bash
npx @prism-code/mcp calculator@sha256:3f9c…
```

```text
Checked calculator@sha256:3f9c…  Level: P3
MCP server on stdio.  Tools: calculate
```

Point any MCP client at it. For a client that reads a JSON configuration:

```json
{
  "mcpServers": {
    "calculator": {
      "command": "npx",
      "args": ["@prism-code/mcp", "calculator@sha256:3f9c…"]
    }
  }
}
```

The server refuses to start when the check fails, and it grants the instance exactly the capability set from the holo. The agent gets the tool description from the world, so it never guesses at the input shape.

## Let an agent write the model

This is what `build` does when you give it examples and intent instead of model files. `build` opens a Model Context Protocol session with an agent, hands it the examples, the intent and the types, and asks for model files. The compiler compiles them, the provers try every intent sentence, and each unproved sentence goes back to the agent with a counterexample. The loop ends when every sentence is a theorem or the agent runs out of attempts. `prism build --max-iterations <n>` sets how many attempts it gets.

Agents are good at this loop because the report is precise. It names the sentence, gives one input that breaks it, and says nothing else. The agent fixes the model, not the sentence, because the sentence is yours.

The result is the same holo a person would produce. `model/` is written to disk, committed, and pinned by digest in the lockfile. `check` does not know or care who wrote the model. The proof is what it reads.

To review what the agent wrote, read `model/` and run `inspect`. To stop an agent from touching the model, write it yourself and point the `[model]` table of `prism.toml` at it, as [Write the model](/docs/guides/write-the-model) describes.

## Next steps

- [Write from examples](/docs/guides/write-from-examples)
- [Audit a holo](/docs/guides/audit)
- [Use a holo as a tool](/docs/api/as-tool)
