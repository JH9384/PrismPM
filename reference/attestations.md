---
title: Attestations reference
description: The statement and envelope a holo's attestations use, the predicate types and their status.
available_in: "0.5"
---

Source: `@prism-code/spec` 2026-10-23, `schemas/attestation/statement.schema.json`, `schemas/attestation/dsse-envelope.schema.json`, `predicates/registry.json`.

## Statement

Every attestation is one statement of type `https://in-toto.io/Statement/v1`.

Schema: `https://schemas.uor.foundation/prism/attestation/statement/1`, file `schemas/attestation/statement.schema.json`.

| Field                | Type               | Required | Constraint                            |
| -------------------- | ------------------ | -------- | ------------------------------------- |
| `_type`              | string             | yes      | = `"https://in-toto.io/Statement/v1"` |
| `subject`            | array              | yes      | at least 1 item; unique items         |
| `subject[]`          | one of 2 forms     | yes      |                                       |
| `subject[] (form 1)` | BlobSubject        | yes      | see BlobSubject                       |
| `subject[] (form 2)` | OciManifestSubject | yes      | see OciManifestSubject                |
| `predicateType`      | string             | yes      | format uri; at least 1 character      |
| `predicate`          | object             | yes      |                                       |

### PrismDigestSet

| Field    | Type   | Required | Constraint               |
| -------- | ------ | -------- | ------------------------ |
| `blake3` | string | yes      | matches `^[0-9a-f]{64}$` |
| `sha256` | string | yes      | matches `^[0-9a-f]{64}$` |

### BlobSubject

| Field    | Type           | Required | Constraint                                 |
| -------- | -------------- | -------- | ------------------------------------------ |
| `name`   | string         | yes      | at least 1 character; not `"oci-manifest"` |
| `digest` | PrismDigestSet | yes      | see PrismDigestSet                         |

### OciManifestSubject

| Field           | Type   | Required | Constraint               |
| --------------- | ------ | -------- | ------------------------ |
| `name`          | string | yes      | = `"oci-manifest"`       |
| `digest`        | object | yes      | no other members         |
| `digest.sha256` | string | yes      | matches `^[0-9a-f]{64}$` |

## Envelope

The bundle wraps each statement in an envelope whose payload type is `application/vnd.in-toto+json`.

Schema: `https://schemas.uor.foundation/prism/attestation/dsse-envelope/1`, file `schemas/attestation/dsse-envelope.schema.json`.

| Field                | Type   | Required | Constraint                         |
| -------------------- | ------ | -------- | ---------------------------------- |
| `payload`            | string | yes      | matches `^[A-Za-z0-9+/_-]*={0,2}$` |
| `payloadType`        | string | yes      | = `"application/vnd.in-toto+json"` |
| `signatures`         | array  | yes      | at least 1 item                    |
| `signatures[]`       | object | yes      | no other members                   |
| `signatures[].keyid` | string | no       |                                    |
| `signatures[].sig`   | string | yes      | matches `^[A-Za-z0-9+/_-]*={0,2}$` |

## Transparency log entries and signed timestamps

A keyless signature is checkable only at the time it was made, so a bundle carries two independent witnesses of that time: log entries with an inclusion proof, and signed timestamps. Both sit in the verification material of the bundle. A verifier checks them offline against a trusted root that it pins; the bundle never supplies its own.

Schema: `https://schemas.uor.foundation/prism/attestation/sigstore-bundle/1`, file `schemas/attestation/sigstore-bundle.schema.json`.

### TransparencyLogEntry

| Field                                   | Type        | Required | Constraint           |
| --------------------------------------- | ----------- | -------- | -------------------- |
| `logIndex`                              | Int64String | yes      | see Int64String      |
| `logId`                                 | object      | yes      | no other members     |
| `logId.keyId`                           | Base64      | yes      | see Base64           |
| `kindVersion`                           | object      | yes      | no other members     |
| `kindVersion.kind`                      | string      | yes      | at least 1 character |
| `kindVersion.version`                   | string      | yes      | at least 1 character |
| `integratedTime`                        | Int64String | no       | see Int64String      |
| `inclusionPromise`                      | object      | no       | no other members     |
| `inclusionPromise.signedEntryTimestamp` | Base64      | yes      | see Base64           |
| `inclusionProof`                        | object      | no       | no other members     |
| `inclusionProof.logIndex`               | Int64String | yes      | see Int64String      |
| `inclusionProof.rootHash`               | Base64      | yes      | see Base64           |
| `inclusionProof.treeSize`               | Int64String | yes      | see Int64String      |
| `inclusionProof.hashes`                 | array       | yes      |                      |
| `inclusionProof.hashes[]`               | Base64      | yes      | see Base64           |
| `inclusionProof.checkpoint`             | object      | yes      | no other members     |
| `inclusionProof.checkpoint.envelope`    | string      | yes      | at least 1 character |
| `canonicalizedBody`                     | Base64      | yes      | see Base64           |

### Trusted root

Schema: `https://schemas.uor.foundation/prism/attestation/trusted-root/1`, file `schemas/attestation/trusted-root.schema.json`.

| Field                      | Type            | Required | Constraint                                                                 |
| -------------------------- | --------------- | -------- | -------------------------------------------------------------------------- |
| `mediaType`                | string          | yes      | matches `^application/vnd\.dev\.sigstore\.trustedroot\+json;version=0\.1$` |
| `tlogs`                    | array           | yes      |                                                                            |
| `tlogs[]`                  | TransparencyLog | yes      | see TransparencyLog                                                        |
| `certificateAuthorities`   | array           | yes      |                                                                            |
| `certificateAuthorities[]` | Authority       | yes      | see Authority                                                              |
| `timestampAuthorities`     | array           | yes      |                                                                            |
| `timestampAuthorities[]`   | Authority       | yes      | see Authority                                                              |
| `ctlogs`                   | array           | no       |                                                                            |

#### TransparencyLog

| Field                  | Type     | Required | Constraint                                                                        |
| ---------------------- | -------- | -------- | --------------------------------------------------------------------------------- |
| `baseUrl`              | string   | yes      | at least 1 character                                                              |
| `hashAlgorithm`        | string   | yes      | = `"SHA2_256"`                                                                    |
| `publicKey`            | object   | yes      |                                                                                   |
| `publicKey.rawBytes`   | Base64   | yes      | see Base64                                                                        |
| `publicKey.keyDetails` | string   | yes      | one of `"PKIX_ED25519"`, `"PKIX_ECDSA_P256_SHA_256"`, `"PKIX_ECDSA_P384_SHA_384"` |
| `publicKey.validFor`   | ValidFor | yes      | see ValidFor                                                                      |
| `logId`                | object   | yes      |                                                                                   |
| `logId.keyId`          | Base64   | yes      | see Base64                                                                        |

#### Authority

| Field                               | Type     | Required | Constraint      |
| ----------------------------------- | -------- | -------- | --------------- |
| `uri`                               | string   | no       |                 |
| `subject`                           | object   | no       |                 |
| `certChain`                         | object   | yes      |                 |
| `certChain.certificates`            | array    | yes      | at least 1 item |
| `certChain.certificates[]`          | object   | yes      |                 |
| `certChain.certificates[].rawBytes` | Base64   | yes      | see Base64      |
| `validFor`                          | ValidFor | yes      | see ValidFor    |

#### ValidFor

| Field   | Type   | Required | Constraint                                                                    |
| ------- | ------ | -------- | ----------------------------------------------------------------------------- |
| `start` | string | yes      | matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$` |
| `end`   | string | no       | matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$` |

## Build provenance

Every holo that `prismpm build` produces carries one statement of predicate type `https://slsa.dev/provenance/v1` and build type `https://uor.foundation/prism/holo-build/v1`. Its subjects are the four content blobs. Its resolved dependencies are the lock. It is written unsigned: the envelope holds one empty signature, which no verifier accepts, until `prism attest` signs it.

Mode `min` is the default and holds nothing that varies between machines or runs. Mode `max` is opt-in with `--provenance=max` because it records the build arguments, the platform, an invocation id and timestamps. `--no-provenance` turns the statement off and is unsafe: a holo built with it cannot reach assurance level P1.

Schema: `https://schemas.uor.foundation/prism/attestation/provenance/1`, file `schemas/attestation/provenance-v1.schema.json`.

### MinPredicate

| Field                                      | Type           | Required | Constraint                                       |
| ------------------------------------------ | -------------- | -------- | ------------------------------------------------ |
| `buildDefinition`                          | object         | yes      | no other members                                 |
| `buildDefinition.buildType`                | string         | yes      | = `"https://uor.foundation/prism/holo-build/v1"` |
| `buildDefinition.externalParameters`       | object         | yes      | no other members                                 |
| `buildDefinition.externalParameters.model` | PrismDigestSet | yes      | see PrismDigestSet                               |
| `buildDefinition.externalParameters.spec`  | Spec           | no       | see Spec                                         |
| `buildDefinition.internalParameters`       | object         | yes      |                                                  |
| `buildDefinition.resolvedDependencies`     | Dependencies   | yes      | see Dependencies                                 |
| `runDetails`                               | object         | yes      | no other members                                 |
| `runDetails.builder`                       | Builder        | yes      | see Builder                                      |

### MaxPredicate

| Field                                            | Type           | Required | Constraint                                       |
| ------------------------------------------------ | -------------- | -------- | ------------------------------------------------ |
| `buildDefinition`                                | object         | yes      | no other members                                 |
| `buildDefinition.buildType`                      | string         | yes      | = `"https://uor.foundation/prism/holo-build/v1"` |
| `buildDefinition.externalParameters`             | object         | yes      | no other members                                 |
| `buildDefinition.externalParameters.arguments`   | array          | yes      |                                                  |
| `buildDefinition.externalParameters.arguments[]` | string         | yes      |                                                  |
| `buildDefinition.externalParameters.model`       | PrismDigestSet | yes      | see PrismDigestSet                               |
| `buildDefinition.externalParameters.spec`        | Spec           | no       | see Spec                                         |
| `buildDefinition.internalParameters`             | object         | yes      | no other members                                 |
| `buildDefinition.internalParameters.platform`    | string         | yes      | matches `^[a-z0-9]+/[a-z0-9]+(/[a-z0-9]+)?$`     |
| `buildDefinition.resolvedDependencies`           | Dependencies   | yes      | see Dependencies                                 |
| `runDetails`                                     | object         | yes      | no other members                                 |
| `runDetails.builder`                             | Builder        | yes      | see Builder                                      |
| `runDetails.metadata`                            | object         | yes      | no other members                                 |
| `runDetails.metadata.invocationId`               | string         | yes      | at least 1 character                             |
| `runDetails.metadata.startedOn`                  | Timestamp      | yes      | see Timestamp                                    |
| `runDetails.metadata.finishedOn`                 | Timestamp      | yes      | see Timestamp                                    |

### ResourceDescriptor

| Field           | Type   | Required | Constraint                       |
| --------------- | ------ | -------- | -------------------------------- |
| `name`          | string | yes      | at least 1 character             |
| `uri`           | string | yes      | format uri; at least 1 character |
| `digest`        | object | no       | no other members                 |
| `digest.blake3` | Hex64  | no       | see Hex64                        |
| `digest.sha256` | Hex64  | no       | see Hex64                        |
| `mediaType`     | string | no       | at least 1 character             |

### Builder

| Field             | Type   | Required | Constraint           |
| ----------------- | ------ | -------- | -------------------- |
| `id`              | string | yes      | at least 1 character |
| `version`         | object | no       | no other members     |
| `version.prismpm` | string | yes      | at least 1 character |

### Spec

| Field    | Type   | Required | Constraint                               |
| -------- | ------ | -------- | ---------------------------------------- |
| `basis`  | string | yes      | one of `"model-sources"`, `"prism-toml"` |
| `blake3` | Hex64  | yes      | see Hex64                                |

## Predicate types

| Type                                     | Status       | Schema                             |
| ---------------------------------------- | ------------ | ---------------------------------- |
| `https://uor.foundation/prism/proof/v1`  | experimental | `predicates/proof-v1.schema.json`  |
| `https://uor.foundation/prism/replay/v1` | experimental | `predicates/replay-v1.schema.json` |

## Example statement

Status: no holo carries a signed statement yet. Every predicate type in the registry is a placeholder, so no statement is captured on this page.

## Next steps

- [Holo format](/docs/reference/holo-format)
- [Errors reference](/docs/reference/errors)
- [Spec package](/docs/api/spec-package)

Generated from @prism-code/spec 2026-10-23 at e84124f0fed01510843772ae11d8a3068cef47ea.
