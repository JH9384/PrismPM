# create-prism-code

Scaffold a Prism SDK project (issue [#281](https://github.com/UOR-Foundation/PrismPM/issues/281)).

```
npm create prism-code calculator
npm create prism-code calculator -- --sdk-image ghcr.io/uor-foundation/prismpm-sdk@sha256:<digest>
```

This is `npx prism-code init` under the name `npm create` looks for; both write the same files:
`prism.toml`, a language-1.2 text-application model with its lexicon and Lean workspace, and
`lexlean.lock`. With `--sdk-image` it also copies the image's `standards.lock` and writes
`prismpm.lock` with `prismpm update --toolchain` in that image (needs Docker).

No PrismPM SDK release exists yet, so there is no default image. Options are those of
`prism-code init --help`.

`create-prism` on npm is an unrelated package; this one is `create-prism-code`.
