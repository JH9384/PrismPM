---
title: Keep images locally
description: Built and pulled images are kept once by digest, named by tags, and collected when nothing holds them.
available_in: "0.6"
---
Every image you build or pull lands in a local image store, the way `docker images` lists what Docker keeps. Each image is kept once, under the BLAKE3 digest its own footer names. A tag such as `calculator:1` is only a name that points at a digest, so two tags can name one image and retagging never copies bytes.

## Where it lives

`Prism.fromEnv()` keeps the store in `$PRISM_IMAGES`, or `$PRISM_HOME/images` when that is unset, which is `~/.prism/images` by default. It sits beside the container records in `$PRISM_HOME/containers`. A client made with `createPrism()` keeps it in memory unless you pass `imageStore`.

```text
~/.prism/images/index.json            prism/image-store/1: images by digest, tags by name
~/.prism/images/blobs/blake3/<hex>    each image, exactly as it was built or pulled
```

The store hashes an image's bytes again every time it reads them. If a file was changed on disk, the read fails with `image.corrupt` and the store does not serve the bytes.

## List, tag and remove

```js
import { Prism } from 'prism-code/node';

const prism = Prism.fromEnv();
await prism.images.pull('ghcr.io/acme/calculator:1.0');   // verified, then kept as ghcr.io/acme/calculator:1.0
await prism.images.tag('ghcr.io/acme/calculator:1.0', 'calculator:stable');
for (const image of await prism.images.list()) console.log(image.tags, image.digest, image.size);
await prism.images.push('ghcr.io/acme/calculator:1.0');   // with no source, the stored image goes
await prism.images.remove('calculator:stable');           // one of two tags: the tag goes, the image stays
```

You can name an image by a tag, by its `blake3:` digest, or by an id prefix of four or more characters.

## What may be removed

`remove` and `prune` look up each case in the store model's decision table (`src/image-store-rules.json`). They have no rules of their own in code. What holds an image is a container record that references it:

- If you remove one of an image's tags, only that tag goes. The image stays.
- An image that a container references is not deleted unless you pass `force`. While a container that references it is running, it is not deleted even with `force`.
- If you remove by digest an image that has more than one tag, the call is refused unless you pass `force`.

## From the command line

The CLI uses the same store. `prism-code pull` keeps each image it verified, and `prism-code push <reference>` with no holo sends the stored image of that name. `prism-code images` alone lists the store, and `prism-code tag` and `prism-code rmi` are Docker's spellings of `images tag` and `images rm`:

```bash
prism-code images ls                      # REPOSITORY, TAG, IMAGE ID, CREATED, SIZE
prism-code images tag calc:1 ghcr.io/acme/calc:1
prism-code push ghcr.io/acme/calc:1
prism-code images rm calc:1               # --force removes an image a stopped container references
prism-code images prune --all
```

## Garbage collection

`prism.images.prune()` removes untagged images that no container references, as `docker image prune` does. `prune({ all: true })` also removes tagged images that no container references. `prism.system.prune()` first removes exited containers, then does the same for images, so an image a container still references survives. A created container can therefore always start. `prism.system.df()` reports each image's size and whether a container holds it. Images that no container holds are reclaimable.

## Next steps

- [Run a holo](/docs/guides/run-a-holo)
- [Verify and inspect](/docs/guides/verify-and-inspect)
