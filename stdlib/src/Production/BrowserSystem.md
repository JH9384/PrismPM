# Browser-resident system

`Production.BrowserSystem.SystemModel` contains one selected generated application
and may add a command-line binary: further components, artifacts and targets.
Its closed profile requires a browser session, DOM, WebAssembly, no persistent
storage, and no external application services. Unsupported requirements fail.

`validateManifest` checks profile constants, ownership presence, graph
references, distinct identities, mandatory control names, and exact model/manifest
bindings. The first component, artifact and target are the browser application
the manifest binds. Each further entry is checked in full: a component is a
`browser` or `cli` component whose artifact has the matching role
(`selected-application` or `release-binary`), every artifact is referenced by a
component, and a target is `github-pages-browser` at `github-pages-artifact@v4`
or `release-binary` at `github-release-asset@v1`. Source proof does not
authenticate ownership or authorize publication.

Release verification separately binds the selected application proof, its full
acceptance evidence, the generated artifact closure, and the locked SPDX oracle.
This containing-system profile does not claim organizational service completeness.
