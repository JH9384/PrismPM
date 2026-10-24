---
title: Attestations reference
description: The statement and envelope a holo's attestations use, the predicate types and their status.
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

| Field                | Type   | Required | Constraint                                               |
| -------------------- | ------ | -------- | -------------------------------------------------------- |
| `payload`            | string | yes      | matches `^[A-Za-z0-9+/_-]*={0,2}$`                       |
| `payloadType`        | string | yes      | = `"application/vnd.in-toto+json"`                       |
| `signatures`         | array  | yes      | at least 1 item                                          |
| `signatures[]`       | object | yes      | no other members                                         |
| `signatures[].keyid` | string | no       |                                                          |
| `signatures[].sig`   | string | yes      | matches `^[A-Za-z0-9+/_-]*={0,2}$`; at least 1 character |

## Predicate types

| Type                                     | Status      | Schema |
| ---------------------------------------- | ----------- | ------ |
| `https://uor.foundation/prism/proof/v1`  | placeholder | none   |
| `https://uor.foundation/prism/replay/v1` | placeholder | none   |

## Example statement

Status: no holo carries a signed statement yet. Every predicate type in the registry is a placeholder, so no statement is captured on this page.

## Next steps

- [Holo format](/docs/reference/holo-format)
- [Errors reference](/docs/reference/errors)
- [Spec package](/docs/api/spec-package)

Generated from @prism-code/spec 2026-10-23 at b26744c4969782a347f5bfc4d82f883deb325bf2.
