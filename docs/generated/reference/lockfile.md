---
title: Lockfile reference
description: Every field of the lockfile, from the schema the spec package publishes.
---

Source: `@prism-code/spec` 2026-10-23, `schemas/documents/sdk-lock-v1.schema.json`, `schemas/documents/sdk-lock-v2.schema.json`.

The lockfile is a JSON document whose `schema` member names its version.

## `prismpm/sdk-lock/2`

Schema: `https://schemas.uor.foundation/prismpm/sdk-lock/2`, file `schemas/documents/sdk-lock-v2.schema.json`.

| Field                             | Type   | Required | Constraint                                                                                                                                                       |
| --------------------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platforms`                       | array  | yes      | exactly 2 items; unique items                                                                                                                                    |
| `platforms[]`                     | object | yes      | no other members                                                                                                                                                 |
| `platforms[].inventory`           | array  | yes      | 1 to 8192 items; unique items                                                                                                                                    |
| `platforms[].inventory[]`         | object | yes      | no other members                                                                                                                                                 |
| `platforms[].inventory[].digest`  | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].inventory[].id`      | string | yes      | 1 to 128 characters                                                                                                                                              |
| `platforms[].inventory[].kind`    | string | yes      | one of `"binary"`, `"crate"`, `"image"`, `"adapter"`, `"oracle"`, `"schema"`, `"workflow"`, `"base-image"`, `"dependency-lock"`, `"trust-root"`, `"test-corpus"` |
| `platforms[].inventory[].version` | string | yes      | 1 to 128 characters                                                                                                                                              |
| `platforms[].inventory_digest`    | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].manifest_digest`     | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `platforms[].platform`            | string | yes      | one of `"linux/amd64"`, `"linux/arm64"`                                                                                                                          |
| `platforms[].inventory_document`  | string | yes      | 1 to 8388608 characters                                                                                                                                          |
| `schema`                          | string | yes      | = `"prismpm/sdk-lock/2"`                                                                                                                                         |
| `sdk_image`                       | string | yes      | matches `^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$`                                                                                        |
| `sdk_index`                       | string | yes      | 1 to 1048576 characters                                                                                                                                          |
| `sdk_version`                     | string | yes      | = `"0.3.0"`                                                                                                                                                      |
| `standards_lock`                  | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |

## `prismpm/sdk-lock/1`

Schema: `https://schemas.uor.foundation/prismpm/sdk-lock/1`, file `schemas/documents/sdk-lock-v1.schema.json`.

| Field                 | Type   | Required | Constraint                                                                                                                                                       |
| --------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory`           | array  | yes      | 1 to 8192 items; unique items                                                                                                                                    |
| `inventory[]`         | object | yes      | no other members                                                                                                                                                 |
| `inventory[].digest`  | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |
| `inventory[].id`      | string | yes      | 1 to 128 characters                                                                                                                                              |
| `inventory[].kind`    | string | yes      | one of `"binary"`, `"crate"`, `"image"`, `"adapter"`, `"oracle"`, `"schema"`, `"workflow"`, `"base-image"`, `"dependency-lock"`, `"trust-root"`, `"test-corpus"` |
| `inventory[].version` | string | yes      | 1 to 128 characters                                                                                                                                              |
| `sdk_image`           | string | yes      | matches `^[a-z0-9.-]+(?::[0-9]{1,5})?/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$`                                                                                        |
| `sdk_version`         | string | yes      | = `"0.3.0"`                                                                                                                                                      |
| `schema`              | string | yes      | = `"prismpm/sdk-lock/1"`                                                                                                                                         |
| `standards_lock`      | string | yes      | matches `^sha256:[0-9a-f]{64}$`                                                                                                                                  |

## Next steps

- [Manifest reference](/docs/reference/manifest)
- [Holo format](/docs/reference/holo-format)
- [CLI reference](/docs/reference/cli)

Generated from @prism-code/spec 2026-10-23 at 06f5ae679a67c4bff53be3dd927653270e15ea30.
