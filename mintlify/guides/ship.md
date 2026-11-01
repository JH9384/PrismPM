---
title: Ship a holo
description: Push and pull holos through any registry, publish to GitHub Pages, and export for Docker.
available_in: "1.0-beta"
---

<Note>This page describes Prism 1.0-beta.1, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>

This guide moves a built holo from your machine to wherever it runs. Every path carries the attestations with the holo, so `check` gives the same verdict on the other side.

## Push to a registry

`push` sends the holo to any OCI-compatible registry. The attestations go with it as referrers, so tools that already read sha256 digests discover them:

```bash
prism push calculator ghcr.io/you/calculator
```

```text
Pushing calculator@sha256:3f9c… to ghcr.io/you/calculator
  holo           24.8 KB   sha256:3f9c…
  attestations   provenance, proof, replay   as referrers
Pushed ghcr.io/you/calculator@sha256:3f9c…
```

Pass `--store <dir>` to push to a local directory store instead, for offline use. `pull --store <dir>` reads the same store.

## Pull from a registry

`pull` fetches a holo and its attestations by name or digest. Pull by digest when you want the exact bytes a lockfile pins:

```bash
prism pull ghcr.io/you/calculator@sha256:3f9c…
```

```text
Pulling ghcr.io/you/calculator@sha256:3f9c…
  holo           24.8 KB   digest matches
  attestations   provenance, proof, replay
Pulled calculator@sha256:3f9c…
```

A pulled holo whose digest does not match the reference is discarded. Run `check` after every pull, or pass `--check` to `pull`. It costs nothing and it is the whole point.

## Deploy to GitHub Pages

`deploy` publishes the holo to a GitHub repository and serves it from GitHub Pages. The attestations are served alongside, so a browser can verify the holo with `@prism-code/verify` before loading it:

```bash
prism deploy
```

```text
Publishing calculator@sha256:3f9c… to github.com/you/calculator
  holo           24.8 KB
  attestations   provenance, proof, replay
  pages          https://you.github.io/calculator/
Done.
```

The page serves the holo, the six-file browser export, and the attestation bundle. Nothing on the page is built by the page. It is the same holo you checked.

## Export for the browser

`export` writes the six-file browser export, or a tarball of the same files. Use it when you host the files yourself:

```bash
prism export --out dist
```

```text
Exporting calculator@sha256:3f9c… to dist/
  index.html  app.js  app.css  calculator.js  calculator_bg.wasm  provenance.json
Exported 6 files
```

`provenance.json` names the digest of every other file, so a browser can confirm each one before it runs. Serve `dist/` from any static host. A cache cannot serve a stale file as a fresh one without the digest check failing.

## Export for Docker

`export --oci` writes a runnable OCI image. Docker serves the holo, and the instance inside still passes through `check` on start:

```bash
prism export --oci calculator:1.0
```

```text
Exporting calculator@sha256:3f9c… as OCI image calculator:1.0
  layer  holo + attestations   24.8 KB
  layer  runtime               1.9 MB
Exported calculator:1.0 (sha256:d04a…)
```

Run it the way you run anything else:

```bash
docker run -p 8080:8080 calculator:1.0
```

```text
Check: PASS  Level: P3
Serving calculator@sha256:3f9c… on :8080
```

The holo digest `3f9c…` is unchanged inside the OCI image. The OCI digest `d04a…` covers the runtime layer as well. Pin whichever one your deployment reads.

## Next steps

- [Use with agents](/guides/agents)
- [Audit a holo](/guides/audit)
- [CLI reference](/reference/cli)
