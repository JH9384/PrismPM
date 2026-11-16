# Private semantic presentation prerequisite

Private component; no public application or complete accessibility conformance
is implied. DK-23 bytes and constraints are unchanged.

`Semantics.lex.tex` binds one DK-23 Presentation to sorted node annotations,
a source-bound design index, appearance preference and one-based skip-link label.
All annotations share the base revision and lifecycle. A changed equal-revision
envelope rejects even when its base frame is unchanged. Progress, replacement,
close and private secret routing bind the entire envelope.

Input purposes are closed: none, plain text, name, organization, email, username,
current password, new password and one-time code. Nonsecret purposes apply only
to Input; password/code purposes require SecretInput. Help/error labels apply
only to fields. Zero means absent; nonzero references the independently bound
label catalogue. Error presentation is not identity verification.

Main, Banner, Complementary and ContentInfo apply only to Section nodes.
Main/Banner/ContentInfo cannot have a landmark, navigation or form ancestor.
Complementary may additionally descend from Main. Main is unique; Banner and
ContentInfo occur at most once. Except an empty Closed frame, every frame has
one Main and a skip label. The private adapter derives the local fragment target
from Main; no frame supplies a DOM identifier or URL.

Layouts are none, stack, sidebar and two/three/four columns. They apply only to
Section, Navigation or Form. They never reorder the underlying reading/focus
sequence or remove an enabled action. The private adapter collapses multi-column
layouts according to source-owned responsive tokens and preserves content reflow.

`Design.lex.tex` defines 1–16 immutable light/dark pairs. Each theme has 25
tokens: seven original opaque 24-bit sRGB colors (surface, text, border, accent,
accent text, danger, focus), a system/serif/monospace/Hologram font family, text
size (1000–4000 thousandths of rem), line-height (1000–3000 thousandths), spacing
and radius (0–4000 thousandths of rem), content width (16–120 rem), sidebar width
(8–40 rem), collapse width (20–100 rem), minimum target size (24–96 CSS px), then
nine appended colors (card, muted, muted text, hover, input, brand, brand text,
success, warning). Appending keeps every original wire position. The Hologram
family is Geist, Archivo for display and Geist Mono, with system fallbacks.
These are engineering bounds, not claims of standards-prescribed design values.
No raw CSS, remote font, image, URL or arbitrary property name is admitted.

`designTokensValid` remains a shape predicate. Admission
(`designCatalogueAdmitted`) also requires WCAG contrast: text, muted text,
accent text, danger, brand text, success and warning reach 4.5:1 on their
grounds and focus reaches 3:1 on surface and card. Luminance uses a 256-entry
linearized sRGB table at scale 10^7, so the integer rule
`den*(high+O-E) >= num*(low+O+E)` with E = 5000 bounds the table's rounding and
never overstates contrast. `scripts/hologram-design.mjs` re-derives the table
from the WCAG formula, and `sdk/browser/design-contrast.mjs` states the same
rule for the decoder. `HologramDesign.lex.tex`, generated from the brand kit's
tokens, proves its catalogue admitted by kernel evaluation with no axioms.
Contrast of these pairs is necessary, not sufficient: reflow, other pairs and
usability still require the complete rendered assessments.

The whole canonical envelope, including its nested Presentation, remains at most
64 MiB. Node/action/field/table/depth maxima and the generated-Wasm 1-GiB ceiling
remain unchanged. Decoders share the 20,000-value budget across the nested frame
and metadata before allocation; no field is clamped or silently omitted.

Source-bound catalogue means independently admitted bootstrap input, not a
frame approving its own labels, tokens or authority. Record constructors and
private adapter options are not authentication. These prerequisites grant no
mailbox fact, account, organization role, host effect or release acceptance.
The source checks every inherited caption, heading, choice, table header and
status reference as well as the semantic help, error and skip references.

`DesignWire.designCatalogueBytes` serializes an admitted typed catalogue;
`decodeDesignCatalogue` independently rejects malformed or out-of-bound output.
The catalogue is separate from each frame and is captured immutably at open.
The adapter uses native autocomplete tokens, text+email input mode (not native
email trimming), local helper/error ID references and native fragment navigation.
Changing secret annotations clears retained secret input before the new context.

Pinned standards references and the imported axe engine are recorded in
`model/browser-semantic-presentation-oracles.json`. They guide this component's
semantics; the recorded automated assessment scope explicitly excludes complete
standard or product acceptance. Production journeys still require full-page,
complete-process and assisted/manual assessments where automated tests cannot
establish the requirement.
