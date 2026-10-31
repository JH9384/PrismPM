---
title: From the command line
description: Replay a holo's examples and read what it says about itself with the prism-code command.
available_in: "0.2.0"
---
This example uses the `prism-code` command on the sample holo, with no code of your own. The output below was captured by running these commands. It comes from the command in the source tree, so a published release can print less.

Install the package and move to the directory that holds the sample holo:

```bash
npm install prism-code
cd node_modules/prism-code/fixtures
```

{{example:command-line}}

`vectors` replays every example the holo carries and exits 1 if one fails. `inspect` reads the holo without running it, so it is safe on a file you do not yet trust.

## Next steps

- [Inspect a holo](/docs/examples/inspect-a-holo)
- [CLI reference](/docs/reference/cli)
- [The holo](/docs/concepts/holo)
