---
title: From the command line
description: Replay a holo's examples and read what it says about itself with the prism-code command.
available_in: "0.2.0"
---
This example uses the `prism-code` command on the sample holo, with no code of your own. The output below was captured by running these commands. It comes from the command in the source tree, so a published release can print less.

Install the package and move to the directory that holds the sample holo:

```bash
npm install prism-code
cd node_modules/prism-code/fixtures
```

```bash
prism-code vectors Calculator.holo
prism-code inspect Calculator.holo
```

```text
22 of 22 vectors passed (holo, Calculator, identities verified)
Name:      Calculator
Revision:  2026-10-23
Format:    HOLO physical version 4, flags 0
Size:      24801 B
Digest:    sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7
           blake3:4efe02106778d44a469cc0fc8f6998167af7c9075a3ac605c150098c0f5243bb
Footer:    8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba (BLAKE3 of the body)

Sections:
  INDEX  KIND  ROLE                   OFFSET  LENGTH  SHA256                                                            BLAKE3
  0      15    app-manifest           202     356     0088c507ec48bb78288d898327902037749c6bb9527546633c6a1adbc3ba8a6f  4ed201e5a4b5f463686bcbc8d70c1512632183d54cc417778a71e9ef00a40583
  1      8     source-manifest        558     610     c0eef33218ad4ea17f44578ef23df78f2fb9bf822fb5a67dc77cdacc18c73354  1a6f896424c025ae9191ea0f1d856f2bfe1dae2375915c9843a36fc302d81d60
  2      14    application-directory  1168    1078    91459889465d92201587bcac265b322f00bf12d9390110c2472b19c8e4d2dad4  24030fddeb439ceafaa6d0010f85e72368c6c224fec6fafff55562e2f9dd28b8
  3      14    model-provenance       2246    2194    6679fab5c55ac4b06bb541f214f45c62d2c8014c2a0ebc294f97c6a1551875a6  2b3f340117ac82d8cb25a2de78c06bb239e32322603ce084e577540f271243bd
  4      16    guest                  4440    10569   cb9f6b72ff08caab873b53a035e557515d96d3445d4efb695643ee51f690a16e  ab47b9093b47dd455700bb5d79676e2056baae82fc8e12d2363edb9fabca9416
  5      16    view                   15009   3641    d81782cfc45587a74b89a3904caa9bcc8fbfc9a0bc6cb98445bef6c8a5a13f74  54a53265a5e6d1bf5510609cdb12feca468e7f04b1e1a60d63a2fab7ff6bd24e
  6      16    capability-set         18650   175     c85722a1f3f28f6a326e2af9734960401879b60fa3876633028a8118c6f34411  650500808dbf458a84ab6db39ae83dc81cfd118e3de08fe472eb97a8202ef924
  7      16    model-document         18825   5944    8b1726138e5d0062b9d4c218d0c0c389616926755ba232a3445471ceb8196e4c  c0f2c6ea414da1a3176e7a7cba6dc8376bca383e9c3fe159b3b9e2dd30ccce15

Content:
  INDEX  ROLE            LENGTH  SHA256                                                            LABEL
  4      guest           10498   dcf53677c7c80636f8fc2247676b8f747d1549ce4af742c8505eb0f0ae334c03  blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380
  5      view            3570    c232ee20ca0115cd9c53b17687dde96292028700e6b626319960331ec6591906  blake3:9860e7054e3f3a8e6ab79c26bcda06bc65778ebdda211160ea66871142b7c808
  6      capability-set  104     888ef9fab26cf92f0a20a1d0fdf7e5dd494f7eb7ec23dfb26a039a7233cb4a02  blake3:cf46eb3028b50fde0444a1a648f5ce7cba94013f541c86537df54adf5d203e1c
  7      model-document  5873    074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6  blake3:e76544838a98c46341ed8807f72897ec68de5a8a9bf28721738a76761c9df90e

Manifest:
  URI:             https://hologram.foundation/realization/app-manifest
  Capability set:  blake3:cf46eb3028b50fde0444a1a648f5ce7cba94013f541c86537df54adf5d203e1c
  Guest:           blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380
  View:            blake3:9860e7054e3f3a8e6ab79c26bcda06bc65778ebdda211160ea66871142b7c808
  Entry:           holo_run
  Contract:        hologram:guest/core-wasm@1
  View entry:      index.html
  Surface:         portable

Model:
  Schema:       prismpm/model-document/1
  Name:         Calculator
  Crate:        prism-calculator 0.1.0
  Description:  A Lean-verified, Prism-generated checked i64 calculator.
  Profile:      none
  Function:     calculate
  Vectors:      22
  Limits:       request 52 B, response 27 B, guest allocation 65536 B
  Digest:       sha256:074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6
                blake3:e76544838a98c46341ed8807f72897ec68de5a8a9bf28721738a76761c9df90e

Provenance:
  Schema:       prismpm/model-provenance/1
  Application:  blake3:4ed201e5a4b5f463686bcbc8d70c1512632183d54cc417778a71e9ef00a40583
  Model ID:     074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6
  Compiler:     49561889f77c9c3571da51e8e53233da9df5ab8f46d16165159425ba2e82dc44
  Stdlib:       35a9c91b1b50f2b61d4e1b4a4abddc833b2185837d6d1511dfff246574692234
  LexLean:      0b53334e5846a1f5e5d9bb3bf6959c085daa4d08

World:
  Contract:        hologram:guest/core-wasm@1
  WIT:             hologram:guest@1.0.0 world core-wasm, worlds/core-wasm.wit
  WIT digest:      sha256:a566c87a359cadf98f652747f1b3574aa307ff5f652a190c6d99c350db9cf369
                   blake3:0774a8ecbfa945a427712ee7d7ad406195b2d07492ceae15cca0067276c9ced8
  Imports:         none
  Exports:         holo_alloc, holo_run, memory
  Guest:           conforms to the world
  Purity:          pure: no clock, random, socket or filesystem import
  Capability set:  blake3:cf46eb3028b50fde0444a1a648f5ce7cba94013f541c86537df54adf5d203e1c (requests nothing)

Attestations:
  none

Verification:
  Footer:            ok
  Labels:            ok
  Cross-references:  ok
```

`vectors` replays every example the holo carries and exits 1 if one fails. `inspect` reads the holo without running it, so it is safe on a file you do not yet trust.

## Next steps

- [Inspect a holo](/examples/inspect-a-holo)
- [CLI reference](/reference/cli)
- [The holo](/concepts/holo)
