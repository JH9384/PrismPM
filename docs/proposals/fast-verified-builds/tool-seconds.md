# Tool seconds of one `prismpm verify`

Chess move referee, 2026-11-05, SDK `prismpm-sdk-candidate@sha256:cd3b47d7…`, Windows 11 with Docker in WSL Ubuntu, 12 CPUs, 16 GB, `/tmp` on a volume.
`sample-tools.sh` sampled `ps -eo comm=` once a second while `prismpm --project . verify` ran; the run took 679 s with the sampler and under load, against 284 s clean, so read the shares and not the seconds.

## Seconds by the dominant tool of each second

| Tool | Seconds |
| --- | --- |
| `rustc` | 243 |
| `(prismpm alone)` | 137 |
| `lean` | 104 |
| `lake` | 95 |
| `leanchecker` | 48 |
| `cargo` | 33 |
| `node` | 12 |
| `prismpm-hologra` | 1 |

## Phases (start to end, seconds)

| From | To | Length | Dominant tool |
| --- | --- | --- | --- |
| 0 | 10 | 11 | `(prismpm alone)` |
| 11 | 34 | 24 | `lean` |
| 36 | 44 | 9 | `lake` |
| 45 | 66 | 22 | `lean` |
| 67 | 68 | 2 | `lake` |
| 69 | 76 | 8 | `lean` |
| 78 | 87 | 10 | `lean` |
| 88 | 97 | 10 | `lake` |
| 98 | 102 | 5 | `(prismpm alone)` |
| 103 | 160 | 58 | `lake` |
| 161 | 165 | 5 | `(prismpm alone)` |
| 166 | 171 | 6 | `rustc` |
| 172 | 174 | 3 | `(prismpm alone)` |
| 175 | 179 | 5 | `rustc` |
| 180 | 183 | 4 | `(prismpm alone)` |
| 184 | 193 | 10 | `rustc` |
| 194 | 198 | 5 | `(prismpm alone)` |
| 200 | 201 | 2 | `rustc` |
| 202 | 210 | 9 | `(prismpm alone)` |
| 211 | 261 | 51 | `rustc` |
| 262 | 284 | 23 | `(prismpm alone)` |
| 285 | 286 | 2 | `leanchecker` |
| 287 | 290 | 4 | `lean` |
| 292 | 312 | 21 | `lean` |
| 314 | 359 | 46 | `leanchecker` |
| 360 | 362 | 3 | `lean` |
| 365 | 375 | 11 | `(prismpm alone)` |
| 382 | 400 | 19 | `cargo` |
| 401 | 410 | 10 | `rustc` |
| 412 | 465 | 54 | `rustc` |
| 467 | 475 | 9 | `(prismpm alone)` |
| 476 | 484 | 9 | `cargo` |
| 485 | 530 | 46 | `rustc` |
| 532 | 542 | 11 | `node` |
| 543 | 562 | 20 | `(prismpm alone)` |
| 563 | 573 | 11 | `rustc` |
| 574 | 577 | 4 | `(prismpm alone)` |
| 578 | 581 | 4 | `rustc` |
| 582 | 584 | 3 | `(prismpm alone)` |
| 586 | 593 | 8 | `rustc` |
| 594 | 597 | 4 | `(prismpm alone)` |
| 598 | 608 | 11 | `lean` |
| 610 | 614 | 5 | `lake` |
| 615 | 617 | 3 | `(prismpm alone)` |
| 618 | 624 | 7 | `lake` |
| 625 | 626 | 2 | `(prismpm alone)` |
| 628 | 631 | 4 | `rustc` |
| 633 | 634 | 2 | `(prismpm alone)` |
| 635 | 638 | 4 | `rustc` |
| 640 | 647 | 8 | `rustc` |
| 648 | 649 | 2 | `(prismpm alone)` |
| 650 | 651 | 2 | `rustc` |
| 652 | 653 | 2 | `(prismpm alone)` |
| 655 | 672 | 18 | `rustc` |
| 673 | 678 | 6 | `(prismpm alone)` |

## Seconds in which each command had a live process

| Command | Seconds |
| --- | --- |
| `timeout` | 386 |
| `cargo` | 252 |
| `rustc` | 220 |
| `lake` | 184 |
| `lean` | 93 |
| `leanchecker` | 33 |
| `cc` | 33 |
| `collect2` | 31 |
| `rust-lld` | 31 |
| `prod-export` | 19 |
| `node` | 12 |
| `prismpm-hologra` | 12 |
| `clang` | 11 |
| `chrome-headless` | 8 |
| `ld.lld` | 4 |
| `build-script-bu` | 1 |
| `exe` | 1 |
