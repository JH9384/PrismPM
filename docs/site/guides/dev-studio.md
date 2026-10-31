---
title: Develop with the studio
description: Watch the model, rebuild and re-check on every save, and read the verdict in a local studio that works offline.
available_in: "0.6"
---
This guide shows you how `dev` keeps a verdict next to your editor: what it watches, what each tab shows, and what to do when a save does not build.

## Start it

Run `dev` in a project directory. It builds once, then rebuilds on every save:

```bash
npx prism-code dev
```

```text
Watching src/**/*.lex.tex, model/**/*.lex.tex, language/**/*.toml, prism.toml, prismpm.toml, lexlean.toml
Studio at http://localhost:4100  tabs: Check, Replay
Building with --update: prismpm.lock follows the model, so commit it with your source
Building
Built Calculator in <seconds>s  Level: P0  FAILED, policy default requires P2
Changed src/Calculator.lex.tex; rebuilding
Built Calculator in <seconds>s  Level: P0  FAILED, policy default requires P2  edit to verdict <seconds>s
```

The default policy asks for level `P2`, so a holo with no signed statements fails it. That verdict is correct. Pass a policy of your own to judge by something else.

Stop it with Ctrl-C.

## The port

The studio's port is **4100**. Pass `--port <n>` to use another one. If the port is in use, `dev` stops and says so, because a studio that moves by itself is one you cannot bookmark.

The studio listens on the loopback address only and answers only requests addressed to `localhost` or `127.0.0.1`. Nothing else on your network can read it, and it has no endpoint that changes anything.

## What it watches

The `[model]` table of `prism.toml` decides. `watch` lists the patterns, `source` watches one directory, and without either `dev` watches the defaults in the output above:

```toml
[model]
source = "model"
build = "prism build"
watch = ["model/**/*.lex.tex", "intent.md", "examples/*.json"]
```

`*` stops at a slash and `**` does not. `prism.toml` and a capability file it names are always watched. `.git`, `.prism`, `.lake`, `.lexlean`, `node_modules` and `target` are never watched, so a build does not trigger itself.

A change means changed bytes. Saving a file without changing it rebuilds nothing. Several saves during one build become one more build, which sees all of them.

## The build

`dev` runs the first of these it finds:

1. `--build <command>`, in a shell.
2. `build` in the `[model]` table of `prism.toml`, in a shell. `prism build` means the next item.
3. `prism-code build --update`, in the SDK image `prismpm.lock` names. This needs Docker.

The default build uses `--update` because a plain build refuses a lock whose model pin is stale, which every edit makes it. So `prismpm.lock` follows your model as you save. Commit it with your source.

A build command from `prism.toml` runs on your machine with your permissions, as an npm script does. Read the manifest of a project you did not write before you run `dev` in it.

`dev` judges the holo the build reports. A custom command that prints no build result must write a `.holo` during the run, or name its file with `--holo <path>`. A build that exits 0 and names no holo gets no verdict, rather than a verdict on an older file.

## The Check tab

The Check tab shows the verdict `check` prints for the same holo:

- **The verdict.** `PASSED` or `FAILED`, the level, the policy and the digest.
- **Each reason.** The check id, its diagnostic, the level it withholds and a sentence.
- **In this page.** The page fetches the holo and judges it again with `@prism-code/verify`, and says whether the two verdicts agree.
- **Last cycle.** The files that changed, the time from your edit to the verdict, and the build and check times.

Pass `--policy <file>` to judge by a policy file, or the name of a shipped policy, as for `check`. An edit to a policy file re-checks the same holo without a build.

When a build fails, the tab shows `BUILD FAILED` and the end of its output. The last verdict stays below it, labeled as describing source that has since changed. While a build runs, a line at the top says that what follows describes the last finished build.

## The Replay tab

The Replay tab shows whether the build still reproduces its recorded histories. Until `prism replay` ships in the runtime, it says `Replay unavailable` and shows nothing else.

## Working offline

The studio needs no network. Its page, styles, scripts and verifier ship in the package, and it loads no fonts or scripts from anywhere else. Every response carries a content security policy that lets the page reach only its own origin, so a request to any other address fails in the browser.

The build is separate. `prism-code build` needs the SDK image on your machine, and it fetches any input it does not have.

## Next steps

- [Write the model](/docs/guides/write-the-model)
- [Verify and inspect](/docs/guides/verify-and-inspect)
- [Run and gate](/docs/guides/run-and-gate)
