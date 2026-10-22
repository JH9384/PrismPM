# Private primary component profile

`PrimaryWire` defines Holo/1 with the authoritative physical-v4 archive format:
one primary Core-Wasm v1 layer, `holo_run`, no View or children, and the exact
empty native capability set. The manifest has two references and 258 bytes.

Seven contiguous sections contain the manifest, source metadata, upstream
application directory, component provenance, and three strictly sorted content
blobs. The blobs hold capabilities, generated guest bytes, and the captured
source/component closure. The component extension is
`https://uor.foundation/extension/prismpm-component/v1`.

Generated code owns framing, reference presence, ordering and canonical profile
validation. Adapters must independently verify content/footer hashes, canonical
directory and metadata, the exact generated package/source/verification closure,
and binary execution through pinned `hologram-live`. Structural acceptance alone
does not establish any of these facts. A source receipt supplied with arbitrary
replacement bytes is not provenance.

HO-15 is private component-format and binary interoperability evidence. It does
not accept a Browser application, UI, service, SDK release or deployment; the
public Browser runtime stays fail-closed. The portable and Browser View profiles,
their transport bounds and their acceptance obligations remain unchanged.
