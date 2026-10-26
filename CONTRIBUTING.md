# Contributing to PrismPM

`SPEC.md` is normative and `AGENTS.md` holds the rules every change follows, whether a human or an agent makes it. This file covers how to ask for work and how shipped work is recorded.

## Requesting features (humans and agents)

Feature requests feed a closed loop. You file a request, others vote on it, maintainers ship it, and you are notified on the issue when it ships. Every 6 hours the UOR website syncs open and shipped requests (issues labelled `kind/feature` or `enhancement`, excluding `tracking`, ranked by 👍) and publishes them at `/docs/requests.md` and `/docs/requests.json`.

1. **Search first.** Read `/docs/requests.md`, or fetch `/docs/requests.json` if you are an agent, and search the [open requests](https://github.com/UOR-Foundation/PrismPM/issues?q=is%3Aissue+is%3Aopen+label%3Akind%2Ffeature).
2. **Vote, don't duplicate.** If a request already covers your need, add a 👍 reaction to the issue, not a "+1" comment. Requests are ranked by 👍. A comment is useful only if it adds a use case or a sharper acceptance test.
3. **File with the form:** <https://github.com/UOR-Foundation/PrismPM/issues/new?template=feature_request.yml>. It asks who is submitting (Human or AI agent), the component, the problem, the proposed API or behavior, an **acceptance test**, and optionally your current workaround.
4. **Fill in the acceptance test.** Give a snippet that should pass once the feature ships: a test, a command with its expected output, or an assertion. Requests without one stay `triage/needs-information`, and the intake bot asks for one. Once you edit one in, the label comes off.
5. **Agents without a browser** file with `gh` and the same section headings. The intake workflow parses them the way it parses the form:

   ~~~bash
   gh issue create --repo UOR-Foundation/PrismPM \
     --label kind/feature,agent-submitted \
     --title "[feature] <one line>" \
     --body "$(cat <<'EOF'
   ### Submitted by

   AI agent

   ### Component

   cli

   ### Problem

   What is hard today, and why.

   ### Proposed API or behavior

   ```text
   prism-code <verb> <args>
   ```

   ### Acceptance test

   ```text
   $ prism-code <verb> <args>
   <expected output>
   ```

   ### Current workaround

   _No response_

   ### Searched existing requests

   - [x] I searched /docs/requests.md and the open issues, and no existing request covers this.
   EOF
   )"
   ~~~

   `Component` is one of `cli`, `engine`, `holo-format`, `verify`, `runtime-js`, `runtime-rust`, `runtime-py`, `spec`, `docs` or `site`. It maps to the `area/*` label of the same name.

What happens next:

- `.github/workflows/feature-intake.yml` runs on every open and edit. It adds `agent-submitted` when "Submitted by" is AI agent, adds the `area/*` label for the component, and adds or removes `triage/needs-information` depending on whether the acceptance test is filled in.
- When the request ships, the issue is closed as completed. `.github/workflows/feature-shipped.yml` then comments "Shipped in <release>. Docs update within 6 hours at /docs/." That notifies you and every subscriber, and the website moves the request to shipped on its next sync.

A change to a public API, CLI verb, `.holo` format revision or predicate also needs a design proposal (`kind/api-change`). Maintainers will ask for one at triage.

## Shipping a feature: name the request it closes

A feature's pull request must say **`Closes #N`** for each request it ships, so that merging it closes the issue as completed and starts the notification above. If it ships part of a request, say `Refs #N` and leave the issue open.

When a release is marked `shipped` in `docs/site/release-status.json`, every `###` feature under that release in `docs/site/changelog.md` must end with one line per request it shipped:

```markdown
Closes [#249](https://github.com/UOR-Foundation/PrismPM/issues/249).
```

`node sdk/docs/generate.mjs verify` (the `docs generate` workflow on every pull request) rejects a shipped release whose features name no request. The rule is `changelogProblems` in `sdk/docs/lib/site.mjs`. The published `changelog.md` on the `docs-site` branch therefore names every request it shipped. Use the full link, not a bare `#N`: the docs vocabulary lint rejects bare issue numbers in prose, and the site is read off GitHub.
