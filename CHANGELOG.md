# Changelog

## [1.5.1](https://github.com/zhang-stephen/pi-annotate-anything/compare/pi-annotate-anything-v1.5.0...pi-annotate-anything-v1.5.1) (2026-10-22)


### Documentation

* **readme:** document the command line, completion, and alignment features ([9590e3f](https://github.com/zhang-stephen/pi-annotate-anything/commit/9590e3fd222b1729078bf5d9f96e3a7e605c3fba))

## [1.5.0](https://github.com/zhang-stephen/pi-annotate-anything/compare/pi-annotate-anything-v1.4.0...pi-annotate-anything-v1.5.0) (2026-10-22)


### Features

* **viewer:** add command mode to the viewer reducer ([07b68e5](https://github.com/zhang-stephen/pi-annotate-anything/commit/07b68e5ce727e64eadd7fa27eded352cce14862a))
* **viewer:** add pure command line parser and command table ([4ba55fd](https://github.com/zhang-stephen/pi-annotate-anything/commit/4ba55fdbe54f27170a7ac927431de9f709ac61f6))
* **viewer:** complete command names through the unified panel ([4ac9cb8](https://github.com/zhang-stephen/pi-annotate-anything/commit/4ac9cb87e23e5ccd1acc230272b8c58d4f6b70ea))
* **viewer:** enclose the completion drawer behind tab ([e8da61a](https://github.com/zhang-stephen/pi-annotate-anything/commit/e8da61a05ff5edc7687444c26f520d23b6112bda))
* **viewer:** exit cmdline on backspace at empty; ignore one trailing bang ([aebc48e](https://github.com/zhang-stephen/pi-annotate-anything/commit/aebc48ef13a0db3d94ebf57806af8b4b734c80cc))
* **viewer:** exit search on backspace at the empty query ([6e75d4e](https://github.com/zhang-stephen/pi-annotate-anything/commit/6e75d4e505f36d985504b66997fc5a178b1465ea))
* **viewer:** label the completion drawer with a divider row ([f48f223](https://github.com/zhang-stephen/pi-annotate-anything/commit/f48f2230f0c4fa0016029647c1a0f8f7d3d9b59f))
* **viewer:** move the completion count beside the label ([5f2a387](https://github.com/zhang-stephen/pi-annotate-anything/commit/5f2a3872bfb5a72c80489d44f16de65bf6c43e34))
* **viewer:** preserve goal column across short lines ([bbf1150](https://github.com/zhang-stephen/pi-annotate-anything/commit/bbf115043b54d71eb1862b0d257ac6b1dae4300f))
* **viewer:** render command mode badge and prompt ([ad9e468](https://github.com/zhang-stephen/pi-annotate-anything/commit/ad9e468edf23f8a9866ce5b52a3c75daad4f8a02))
* **viewer:** show pending keys in the cmdline row ([974a33d](https://github.com/zhang-stephen/pi-annotate-anything/commit/974a33dc52dd33944cfbae13783cfdf909595a77))
* **viewer:** wire command mode painting and noh highlight suppression ([6244566](https://github.com/zhang-stephen/pi-annotate-anything/commit/62445661d12b09aafceb258ce49e7755b9e0bf5f))


### Bug Fixes

* **viewer:** end command mode on every execution path ([a6f2133](https://github.com/zhang-stephen/pi-annotate-anything/commit/a6f2133f9239a17729ddeff169e0273d83da0700))
* **viewer:** finish curswant coverage for 0, dollar, and page motions ([095ac08](https://github.com/zhang-stephen/pi-annotate-anything/commit/095ac081e291362397183ea137d24eeb824a99a9))
* **viewer:** skip the empty fill segment on zero-width dividers ([6555d87](https://github.com/zhang-stephen/pi-annotate-anything/commit/6555d87074c451a5afa15d6f2d82192b79883a5b))

## [1.4.0](https://github.com/zhang-stephen/pi-annotate-anything/compare/pi-annotate-anything-v1.3.0...pi-annotate-anything-v1.4.0) (2026-10-20)


### Features

* **core:** async workspace file index with SWR cache ([3e0e58d](https://github.com/zhang-stephen/pi-annotate-anything/commit/3e0e58d7697bb77c662e70b533fb3e562c8c72b1))
* **tui:** fuzzy path completion with workspace index ([25dc33a](https://github.com/zhang-stephen/pi-annotate-anything/commit/25dc33a45016c7f12581f5869ae4c8668605b9ee))
* **tui:** slash queries fuzzy-match the index subtree under dirPart ([2decf91](https://github.com/zhang-stephen/pi-annotate-anything/commit/2decf91e18e4acd0fa17c41c1bf2d4a291c58232))


### Bug Fixes

* **ci:** skip workflow runs on release-please PR branches ([973272f](https://github.com/zhang-stephen/pi-annotate-anything/commit/973272f675fb2fbda242bf66352ed6edcd0e9f5f))
* **core:** fd ignore handling, stderr drain, and defensive entries copy ([2627ba2](https://github.com/zhang-stephen/pi-annotate-anything/commit/2627ba2012ddf86efcb11011dbccbcae47cbb927))
* **core:** harden findMatches/jumpTarget against degenerate inputs ([86a063e](https://github.com/zhang-stephen/pi-annotate-anything/commit/86a063ed10efd072cd70b22a57d0cc543d067810))
* **tui:** apply the dotfile rule to the subtree remainder, not the full path ([45fff30](https://github.com/zhang-stephen/pi-annotate-anything/commit/45fff306ac7399a426eb64a5fdb293f830112b9a))
* **viewer:** correct stale count-consumer comment after arrow parity ([ac7906b](https://github.com/zhang-stephen/pi-annotate-anything/commit/ac7906b9ae345ce578ea2b41df5df03ef2eab03c))
* **viewer:** vim parity for counts on arrows and digits during pending g ([a459b72](https://github.com/zhang-stephen/pi-annotate-anything/commit/a459b720a5fbd9b11df242f3b6fe1681431dd7db))

## [1.3.0](https://github.com/zhang-stephen/pi-annotate-anything/compare/pi-annotate-anything-v1.2.0...pi-annotate-anything-v1.3.0) (2026-10-18)


### Features

* **annotate:** add filesystem path completion helper ([9f8a301](https://github.com/zhang-stephen/pi-annotate-anything/commit/9f8a301c3c69703ec2c284d35d5311c481fd3ef1))
* **annotate:** wire path completion into /annotate command ([1efc8e1](https://github.com/zhang-stephen/pi-annotate-anything/commit/1efc8e10d0815c05926635dbdb8378e0804b7eaf))
* **viewer:** add pure search primitives module ([69b8ca8](https://github.com/zhang-stephen/pi-annotate-anything/commit/69b8ca8730f722cc7180dfe953ff04618cbe9926))
* **viewer:** add search mode, count prefix, and transient messages ([f2dfaf4](https://github.com/zhang-stephen/pi-annotate-anything/commit/f2dfaf4cc95fea4571e2e2c96033a5b182f537ff))
* **viewer:** highlight search matches and wire the search UI ([7b488b8](https://github.com/zhang-stephen/pi-annotate-anything/commit/7b488b8dffd745d0ae05d0c2eba7d86e80732fb3))
* **viewer:** pad framed rows inside the vertical borders ([6bfea39](https://github.com/zhang-stephen/pi-annotate-anything/commit/6bfea395408117060f1040c8e5983881595a3afa))
* **viewer:** render search segment, cmdline input, and messages ([0469273](https://github.com/zhang-stephen/pi-annotate-anything/commit/046927316d62f4355a2a5faaa4f0484fb32a11ef))
* **viewer:** report a zero-match submit as a transient message ([9afd540](https://github.com/zhang-stephen/pi-annotate-anything/commit/9afd540196dd8f79209e238acf6b2d6979525afa))
* **viewer:** vim-style / search with smartcase, incremental jump, and persistent highlight ([3202bbe](https://github.com/zhang-stephen/pi-annotate-anything/commit/3202bbe2d127923e03495c149f339fd375eb044c))


### Bug Fixes

* **annotate:** complete paths against session cwd, not process cwd ([e0e0067](https://github.com/zhang-stephen/pi-annotate-anything/commit/e0e00670489ff38206710a7649c4eee07b322e3d))
* **viewer:** show the compile error on the cmdline input row ([e0ee5fe](https://github.com/zhang-stephen/pi-annotate-anything/commit/e0ee5fe0085dad041712fa88c454390fa1696394))
* **viewer:** style search matches with the theme searchMatch tokens ([e80ad67](https://github.com/zhang-stephen/pi-annotate-anything/commit/e80ad67126fad3e19af18e8429bc7ba00b03ccc5))
* **viewer:** two-level search match styling per the theme convention ([b144e28](https://github.com/zhang-stephen/pi-annotate-anything/commit/b144e280bd2dc1ac29fd1f1bea38b3fbad2d65c7))
* **viewer:** viewport-only incremental match mapping; doc amendments ([765eb02](https://github.com/zhang-stephen/pi-annotate-anything/commit/765eb0286cf8e24adddf60485e573c3e068e6cd1))

## [1.2.0](https://github.com/zhang-stephen/pi-annotate-anything/compare/pi-annotate-anything-v1.1.1...pi-annotate-anything-v1.2.0) (2026-10-18)


### Features

* **status-line:** add statusline/cmdline renderers and multi-row panel footers ([366d5c7](https://github.com/zhang-stephen/pi-annotate-anything/commit/366d5c7cb658ed66e26324284a73bd72e93d4256))
* **viewer-state:** horizontal cursor-follow scrolling with scrollLeft ([139a10a](https://github.com/zhang-stephen/pi-annotate-anything/commit/139a10a5477fbb48e25db55bf4d3446ce7cfb7b7))
* **viewer:** render horizontally scrolled content window with overflow indicators ([8d5aae4](https://github.com/zhang-stephen/pi-annotate-anything/commit/8d5aae4d124b784129db733d3f068cec6f4eedf5))
* **viewer:** wire statusline/cmdline rows into annotate card ([fed1a7f](https://github.com/zhang-stephen/pi-annotate-anything/commit/fed1a7f7a88d88f7c36022b35cc7acbfa3f7a93d))


### Bug Fixes

* **status-line:** drop the forced gap when the row cannot fit it ([8c4cc0a](https://github.com/zhang-stephen/pi-annotate-anything/commit/8c4cc0a568d85def0796f380534b0e3f4f8aabcb))
* **viewer-state:** follow cursor on anchor swap and clamp scrollLeft on every reduce ([b0bf299](https://github.com/zhang-stephen/pi-annotate-anything/commit/b0bf299b1f8e37be1415bb467fca7bb5c6492f99))
* **viewer:** keep cursor visible over scroll indicators; robustness fixes ([0c31f96](https://github.com/zhang-stephen/pi-annotate-anything/commit/0c31f96cc93bf9bdb0592ad57cffaeb1a8c62789))
* **viewer:** remove overflow indicators and fix wide-char splice alignment ([796d646](https://github.com/zhang-stephen/pi-annotate-anything/commit/796d646259125529ef6e4506dc631accd39fc8ee))
* **viewer:** treat kitty key-repeat sequences as presses so held arrow keys scroll ([610cc3b](https://github.com/zhang-stephen/pi-annotate-anything/commit/610cc3b887ad83ae7009c9020d017c5d5e0d975b))

## [1.1.1](https://github.com/zhang-stephen/pi-annotate-anything/compare/pi-annotate-anything-v1.1.0...pi-annotate-anything-v1.1.1) (2026-10-17)


### Bug Fixes

* **composer:** coexist with other extensions' editors (predecessor-preserving, lazy install) ([b3805e3](https://github.com/zhang-stephen/pi-annotate-anything/commit/b3805e3307bf670483e31a45bb08cea132f87e5e))

## [1.1.0](https://github.com/zhang-stephen/pi-annotate-anything/compare/pi-annotate-anything-v1.0.0...pi-annotate-anything-v1.1.0) (2026-10-17)


### Features

* **card:** Tab-cycling stack targeting state machine ([187dff4](https://github.com/zhang-stephen/pi-annotate-anything/commit/187dff4ec7467f9c5a0750d1f53e0d148ba48a47))
* **card:** target emphasis, start-line gutter counts, stacked preview indicator ([2c155f1](https://github.com/zhang-stephen/pi-annotate-anything/commit/2c155f1e44a066e0f91b18f6fe2dda8510a6c5e3))


### Bug Fixes

* **card:** emphasis precedence - target must not nest non-target dim ([f3b6304](https://github.com/zhang-stephen/pi-annotate-anything/commit/f3b63049cb0d9f27d3fd357077a0c3ccd19d02bc))

## 1.0.0 (2026-10-17)


### Features

* **card:** add chrome rendering helpers ([9c2d08e](https://github.com/zhang-stephen/pi-annotate-anything/commit/9c2d08e203b2d4a75bbdddfa757bb4373811716b))
* **card:** add comment edit/delete logic ([a766401](https://github.com/zhang-stephen/pi-annotate-anything/commit/a766401e4f4bd1777f0dc3c72c194f1de4e380ca))
* **card:** chrome integration - border, title, footer, floating comment box ([7ce88a5](https://github.com/zhang-stephen/pi-annotate-anything/commit/7ce88a57e181b749bfc94af120f81b1a614b138b))
* **card:** gutter NF icon + per-line pending count ([96c505b](https://github.com/zhang-stephen/pi-annotate-anything/commit/96c505b89a667da5ae473ff798bec36152a888d3))
* **card:** hover comment preview with p toggle ([9c7eeda](https://github.com/zhang-stephen/pi-annotate-anything/commit/9c7eedac5d320dc5aade3729b4a4c20bb3f83438))
* **comment:** add comment input state machine ([150eeaf](https://github.com/zhang-stephen/pi-annotate-anything/commit/150eeafaa56f04da4cf6360a027ed349072ddadc))
* **editor:** add pill recoloring composer editor ([d945755](https://github.com/zhang-stephen/pi-annotate-anything/commit/d94575523dbc30c82cf76dd66b57667855db3687))
* **file:** add file loading with guards and range extraction ([9b54dcc](https://github.com/zhang-stephen/pi-annotate-anything/commit/9b54dcc3343ceb11bbb30f3e538ccd8ead105e98))
* **message:** add payload and token label formatting ([0d4ce75](https://github.com/zhang-stephen/pi-annotate-anything/commit/0d4ce75046e151ab7511e61a0472de1855dac0cf))
* **selection:** add selection model ([b66d195](https://github.com/zhang-stephen/pi-annotate-anything/commit/b66d195444a7b90cf68f6ac8526262b3536b4532))
* **store:** add annotation draft store ([6d03250](https://github.com/zhang-stephen/pi-annotate-anything/commit/6d0325044c28d150d7b3b9abf0c60f44d98e434f))
* **transform:** add token expansion on input ([7f14273](https://github.com/zhang-stephen/pi-annotate-anything/commit/7f142738f5e21de0d580345a600c7a62659d3e36))
* **viewer:** add annotate card component ([9f88a0b](https://github.com/zhang-stephen/pi-annotate-anything/commit/9f88a0b1ee24ce8fb54e4b44a6c412956b23bc76))
* **viewer:** add vim-style viewer state machine ([aef5936](https://github.com/zhang-stephen/pi-annotate-anything/commit/aef5936250b6ef04af4b213935534fe17199783d))
* wire annotate extension entry point ([f17c78b](https://github.com/zhang-stephen/pi-annotate-anything/commit/f17c78b2d160dd0953cb54db3df3137a0f4effb6))


### Bug Fixes

* apply final review findings ([3d61669](https://github.com/zhang-stephen/pi-annotate-anything/commit/3d61669ec77d3b18f8dac6c517861feb94cf6352))
* **card:** normalize kitty CSI-u newline keys in comment mode ([56ee9be](https://github.com/zhang-stephen/pi-annotate-anything/commit/56ee9be2d04bd8ff08d49297c8db56b5b3f441d3))
* **card:** spacer cell between pending icon and count ([bddf0a4](https://github.com/zhang-stephen/pi-annotate-anything/commit/bddf0a484afe747a556229ab8feb8678cc0ee563))
* **ci:** use glob for test files; Node 22/24 --test rejects bare directory args ([83c3840](https://github.com/zhang-stephen/pi-annotate-anything/commit/83c3840c828aeddb00b29108c2bf9ca91084a0da))
* **viewer:** normalize kitty-protocol escape sequences ([c51c0bd](https://github.com/zhang-stephen/pi-annotate-anything/commit/c51c0bddf0a680151f22bfd0353030a7d6eefa0d))
