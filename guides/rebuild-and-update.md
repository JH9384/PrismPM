---
title: Rebuild and update
description: Reproduce a pinned build, confirm its digest, and move a pin forward on purpose.
available_in: "0.5"
---
This guide is for the developer who maintains a holo after its first release. You rebuild from a pinned checkout, confirm the same bytes come out, and update the pins when you choose to.

## Rebuild from a pinned checkout

Check out the commit you want, then confirm the lockfile still matches the project before you build:

```bash
prism lock --check
prism build --no-cache
```

`lock --check` writes nothing and fails naming any pin that differs. `--no-cache` makes the build run in full rather than reuse an earlier result. Compare the digest it prints with the one you released. The same digest means you have the same bytes, so anything you learned about the released holo holds for this one.

If the digests differ, read the two holos side by side with `prism inspect`, and start with their provenance.

## Refresh the lockfile

Write or refresh the lockfile after you add an input, without building:

```bash
prism lock
```

Pins that still resolve stay as they are, and the SDK image does not move. It exits 2 when there is no lockfile or its SDK cannot be resolved.

## Update on purpose

See what an update would change without writing anything:

```bash
prism update --dry-run
```

Then choose how far to go. With no flag, `update` refreshes the toolchain pins. With `--toolchain`, it also pins a new SDK image:

```bash
prism update
prism update --toolchain <ref>
```

Either command prints the old and new digest of every pin that moved. Add `--standards-lock <digest>` to `--toolchain` when the new image should select a standards lock other than the project's.

## Confirm nothing changed

An update can change behaviour, so check before you release. Rebuild, check the holo, and replay your histories against the new build:

```bash
prism build
prism check
prism replay examples/
```

A replay that diverges names the first call that differs. Commit `prismpm.lock` with the change, so the update shows in review as a diff of digests.

## Next steps

- [Reproducible builds](/docs/concepts/reproducible-builds)
- [Lockfile reference](/docs/reference/lockfile)
- [Verify and inspect](/docs/guides/verify-and-inspect)
