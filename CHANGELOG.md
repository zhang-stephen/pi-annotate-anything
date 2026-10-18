# Changelog

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
