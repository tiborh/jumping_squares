<!--
  SPDX-FileCopyrightText: 2026 tiborh
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Repo conventions — regenerate & bump before you commit

This project has **no build step** (the game is played by opening `index.html`
directly). Opening it from `file://` loads the `<script>` files that
`index.html` references, but the browser **cannot read `README.md` as runtime
data** (a `fetch()` of a local file is blocked under `file://`). Because of
that, some human-authored content is **embedded in `js/game.js`** and kept
honest by **tests** rather than read from the doc at load time. The embedded
copies come in two flavours — know which is which:

- **Generated mirror (regenerate it):** the in-app **Help** block is produced
  from the README by `tools/gen-help.js`. Editing the README source means
  re-running the generator and committing the result; a drift test enforces it.
- **Hand-maintained excerpt (no generator):** the `CHANGELOG` array in
  `js/game.js` is a short, player-facing *What's new* list you edit by hand;
  `CHANGELOG.md` is the fuller history. No script regenerates these — a test
  only enforces their shape/cap/ordering.

When you edit a *generated* source you MUST regenerate and commit, or CI fails.

Keep this list current: when a new generated mirror or helper script is added,
add it here so future work doesn't forget the regeneration step.

## Before you commit — mandatory steps

### 1. In-app Help — if you edit the README "How to play" HELP block

The Help dialog text is the single source of truth in `README.md` between the
`HELP:BEGIN` / `HELP:END` markers, mirrored into `js/game.js` as the exported
`HELP`. After editing anything between those markers:

```bash
node tools/gen-help.js          # rewrite the HELP block in js/game.js
node tools/gen-help.js --check  # verify (non-zero exit if out of date)
```

Commit the regenerated `js/game.js`. A test in `test/game.test.js` re-extracts
from the README and **fails if the embedded copy has drifted**. The expanded
"More about playing" section is deliberately **outside** the markers, so it is
*not* picked up into the dialog — edit it freely without regenerating.

Note: regenerating the HELP block **changes `js/game.js`, a browser-loaded
file**, so a HELP edit is a *browser-visible* change — do step 2 (version bump)
as well. Only README edits that leave `js/game.js` untouched are docs-only.

### 2. Browser-visible change — bump the version and all cache-busting tags

If the change touches anything the browser loads (`index.html`, `js/*.js`, CSS,
gameplay, UI), bump the version so caches don't serve stale files:

1. Bump `VERSION` in `js/game.js` by one (e.g. `'41'` → `'42'`).
2. Update **all three** `?v=` query strings in `index.html` to the same number
   — `js/game.js`, `js/agents.js`, **and** `js/ui.js`.

The `version wiring` test fails if the `?v=` strings don't all match `VERSION`.
(It checks the *value* of every `?v=` tag it finds against `VERSION`; it does
**not** assert that all three script tags are present, so don't rely on it to
catch a *missing* tag — update all three by hand.) Docs-only changes (README
prose, comments, this file) skip this — but see the note in step 1: a README
edit that regenerates `js/game.js` is **not** docs-only.

### 3. CHANGELOG / "What's new"

For a player-facing change, add a `CHANGELOG` entry at the top of the array in
`js/game.js` (newest-first) and a matching section in `CHANGELOG.md`. The array
is capped at `WHATSNEW_MAX` (12) entries — when you add one at the top, drop the
oldest to stay within the cap (it lives on in `CHANGELOG.md`). A test enforces
the cap, the newest-first ordering, and that the newest entry's version does not
exceed `VERSION`.

## Always-run gate

Run the test harness before every commit; it must pass:

```bash
node test/game.test.js   # expect "... passed, 0 failed", exit 0
```

It bundles the drift/version/changelog guards above, so a green run confirms the
mirrors are in sync. See `CONTRIBUTING.md` for the full push checklist and
`README.md` for the rationale behind each mirror.
