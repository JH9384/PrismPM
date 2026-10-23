# Browser-resident system

`Production.BrowserSystem.SystemModel` contains one selected generated application.
Its closed profile requires a browser session, DOM, WebAssembly, no persistent
storage, and no external application services. Unsupported requirements fail.
A text/3 application may add, second, one `cli` component whose
`command-line-program` artifact is its generated static program set.

`validateManifest` checks profile constants, ownership presence, the closed
component graph (one `browser` component, at most one `cli` component, one
artifact each, one target), distinct identities, mandatory control names, and
exact model/manifest bindings of the selected application. Source proof does
not authenticate ownership or authorize publication.

Release verification separately binds the selected application proof, its full
acceptance evidence, the generated artifact closure, and the locked SPDX oracle.
This containing-system profile does not claim organizational service completeness.
