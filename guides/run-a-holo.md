---
title: Run a holo
description: One run of a holo is a container, with a state, an exit code and its output, kept until you remove it.
available_in: "0.6"
---
A holo is an image. Each run of it is a container: an object with a state, a start and finish time, an exit code and the output the program returned. It works the way `docker run` works, so what you know about containers applies here.

## Run one

`prism.containers.run(image, input)` returns the container after it exits. The image is a path, a URL, bytes, a `Blob`, or a holo you already opened with `load`. The input is a string or bytes:

```js
import { prism } from 'prism-code';

const container = await prism.containers.run('./Calculator.holo', '1\tadd\t20\t22', {
  policy: { minimum: 'P0' },
});

const { image, state } = await container.inspect();
console.log(state.status, state.exitCode, image.digest);
console.log(JSON.stringify(container.text()));

await container.remove();
```

```text
exited 0 blake3:8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba
"1\tok\t42"
```

A run is checked first, as in [Run and gate](/docs/guides/run-and-gate). This example names a policy that accepts the sample holo, because no holo carries a signed statement yet and the default policy requires P2.

The command line does the same. Standard output holds the program's output and nothing else, and the process exits with the container's code:

```bash
prism-code run Calculator.holo "$REQUEST" --policy policy.json
```

```text
1	ok	42
container 3f9c7a…e1 exited 0
```

`--input` is the same as the second argument. Without an input, `prism-code run` serves the holo's view on a port, as it always has. A served holo is not a container yet.

## The states

A container is `created`, `running` or `exited`.

```text
created --start--> running --returned or threw--> exited --start--> running
   |                                                 ^
   +------------- check refused the holo ------------+
```

- **`created`.** The image is open and its digest is known. Nothing has run. An image that cannot be opened makes no container, and `create` and `run` reject with the typed error.
- **`running`.** The check passed and the program has the input.
- **`exited`.** The run is over and `exitCode` is set. A holo that `check` refuses goes straight here, with `startedAt` null, which says the program never ran.

The two-step form separates the first two:

```ts
const container = await prism.containers.create("./Calculator.holo", request, { policy });
await container.start();
```

`start` resolves when the container has exited, and a failed run is an exit code, never a rejection. Starting an exited container runs it again from the same input. A second `start` while it runs joins that run.

## Inspect it

`container.inspect()` reports the state, the exit code and the digest of the image it ran:

```json
{
  "schema": "prism/container/1",
  "id": "3f9c7a…e1",
  "image": { "name": "Calculator", "kind": "holo", "digest": "blake3:8408e089…" },
  "created": "2026-10-30T09:14:02.118Z",
  "rm": false,
  "state": {
    "status": "exited",
    "exitCode": 0,
    "error": null,
    "startedAt": "2026-10-30T09:14:02.131Z",
    "finishedAt": "2026-10-30T09:14:02.133Z"
  },
  "verdict": { "schema": "prism/verdict/1", "level": "P0", "passed": true },
  "output": { "encoding": "utf-8", "data": "1\tok\t42" }
}
```

`verdict` is the whole verdict of the check, shortened here. `output.encoding` is `hex` when the bytes are not text. From the command line, a container's id or a unique prefix of it works where a holo path does:

```bash
prism-code inspect 3f9c7a --format state.exitCode
```

## Remove it

A container is kept until you remove it. In the SDK it lives in memory, so a long-running program removes what it runs. The command line keeps one JSON file per container in `$PRISM_HOME/containers`, by default `~/.prism/containers`, readable only by you. A record holds the output and never the input.

`--rm`, and the SDK's `rm: true`, remove the container when it exits, whatever its exit code:

```bash
prism-code run Calculator.holo "$REQUEST" --policy policy.json --rm
```

```ts
const container = await prism.containers.run("./Calculator.holo", request, { policy, rm: true });
container.exitCode; // 0
container.text();   // "1\tok\t42"
```

The object you hold keeps `status`, `exitCode`, `error` and `output`. `inspect()` rejects with `container.missing`, because the container is gone, as `docker inspect` does.

To remove one yourself, call `container.remove()` or `prism.containers.remove(id)`, or run:

```bash
prism-code rm 3f9c7a
```

A running container cannot be removed.

## Exit codes

A container exits 0 on success. Otherwise the code follows the typed error that ended the run, and `container.error` is that error. `prism-code` exits with the same codes, from the same table.

| Exit | Error | Meaning |
| --- | --- | --- |
| 0 | none | The guest returned its output. |
| 1 | `VerificationError`, with a verdict | The holo failed check, for an archive, document, provenance or policy reason. |
| 2 | `VerificationError`, no verdict | Check could not reach a verdict: an unreadable policy, a closure, an unknown format revision. |
| 2 | `PrismCodeError` | The artifact was refused, or dispatch refused the request: a bad archive, a request over the guest allocation. |
| 2 | `CapabilityDeniedError` | The world exceeds the granted capabilities, or the runtime denied an import or a resource. |
| 3 | `SigningError` | A signature could not be produced. |
| 10 | `ProofMismatchError` | A proof check failed: the statement is absent, malformed, or about another holo. |
| 11 | `WorldMismatchError` | The guest does not have the interface of its declared world, or the world is not the one pinned. |
| 12 | `DeterminismViolationError` | A replay produced output that differs from the recorded history. |
| 13 | `ReplayError` | A replay could not be carried out, or the replay statement failed. |
| 1 | `SignatureInvalidError` | An attestation did not verify: its signature. |
| 1 | `IdentityMismatchError` | An attestation did not verify: its signer. |
| 1 | `TransparencyError` | An attestation did not verify: its log entry or timestamp. |
| 1 | `SubjectMismatchError` | An attestation did not verify: its subject. |
| 1 | `AttestationNotFoundError` | An attestation did not verify: there is none. |
| 1 | `TrustRootError` | An attestation did not verify: the trusted root is unusable. |
| 1 | `PolicyDeniedError`, with a verdict | A policy rule denied the holo. |
| 2 | `PolicyParseError`, no verdict | A policy did not parse. |
| 2 | `PolicyEvaluationError`, no verdict | A policy could not be evaluated. |
| 2 | `RegistryError` | The registry or store failed. |
| 2 | `RegistryAuthError` | The registry refused the credentials. |
| 2 | `ReferrersUnsupportedError` | No referrers API or tag. |
| 2 | `ManifestNotFoundError` | The reference names nothing. |
| 1 | `DigestMismatchError` | Bytes differ from their digest. |
| 1 | `PullVerificationError` | A pulled holo failed verification. |
| 1 | `ReferenceInvalidError` | Not a registry or store reference. |
| 2 | `ProviderNotFoundError` | No provider on the PATH. |
| 2 | `ProviderReplyError` | A provider broke the protocol. |
| 2 | `ProviderFailedError` | A provider failed. |
| 2 | `ExportMismatchError` | A browser export differs from its release. |
| 1 | `MiddlewareError` | A middleware threw something untyped. |
| 1 | `PrismError` | Any other typed error. |
| 70 | anything else | Dispatch threw something untyped: a guest trap, or a bug in the runtime. |

The table is `EXIT_CODES` in `prism-code`, and `exitCodeFor(error)` reads it. A response the program returns is exit 0 even when it says the request was bad: the protocol's error is the program's output, not a failed run.

`check` reports a verdict and not an error, so it keeps its own three codes: 0 passed, 1 failed, 2 no verdict. `prism-code` also exits 64 for wrong arguments and 69 when Docker is missing.

## Next steps

- [Run and gate](/docs/guides/run-and-gate)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [TypeScript SDK](/docs/sdks/typescript)
