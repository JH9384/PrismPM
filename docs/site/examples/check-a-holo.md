---
title: Check a holo
description: Judge a holo against a policy from code, and handle the error when it falls short.
available_in: "0.5"
---
This example checks the sample holo twice: once with a policy that accepts anything, and once asking for an error when the default policy rejects it. The output below was captured by running the code.

The call is experimental, so its name carries the `experimental_` prefix. Pin the exact version if you use it.

{{example:verify}}

The sample holo carries no statements, so it reaches P0 and the default policy rejects it. The first call accepts P0 and reports that it passed. The second raises a typed error whose code and check say what fell short.

## Next steps

- [Proof and assurance](/docs/concepts/proof-and-assurance)
- [Check a holo from the API](/docs/api/verify)
- [Errors reference](/docs/reference/errors)
