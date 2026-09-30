<!--
  SPDX-FileCopyrightText: 2025 - 2026 tiborh
  SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Changelog

A curated, condensed history of **Jumping Squares** — what changed, and the
*why* / lessons behind it. This is not a raw commit log (anyone can read the
[commits](https://github.com/tiborh/jumping_squares/commits/main) for the fine
detail); it sums the commits up, keeps the parts that matter, and records
background that would be too wordy for a commit message — including things that
were tried and reverted, so future work doesn't re-walk the same dead ends.

The in-app **About → What's new** panel shows a short, player-facing excerpt of
the most recent, user-relevant entries. This file is the fuller version.

Versions are the engine build number (`VERSION` in `js/game.js`), which is also
the cache-busting `?v=` tag and the on-page build tag. Not every build gets a
line here — internal-only bumps (CI, refactors, cache-busting) are folded into
the nearest user-facing entry.

## Conventions

- **Player-facing** entries describe what changed for someone *using* the game.
- **Internal** notes are kept brief and grouped, for dev context only.
- **Experimental** marks something shipped for early testing that may be
  incomplete or not yet functional.

---

## v21 — "What's new" panel

Player-facing:

- **About → What's new** now opens a short list of the most recent,
  player-relevant changes, with a link to this fuller changelog. It is reached
  by choice from About and never pushed at you — once you know where it is, you
  can check it when curious.

Background:

- The list is a curated, hand-picked excerpt (a `CHANGELOG` array exported by
  the engine, next to `VERSION`), deliberately **not** one entry per build:
  internal-only bumps are omitted, and each entry is a single player-facing
  line. Entries can be flagged **experimental** for early-test features that
  aren't complete yet. A test guards against the newest entry drifting past the
  current `VERSION` (and now rejects malformed version strings outright, so a
  typo like `19oops` can't slip through `parseInt`). This file stays the fuller
  version, with the background and lessons that are too wordy for the in-app
  panel or a commit message.
- Accessibility refinements from review: keyboard focus indicators are a
  visible ring (not a color-only shift); while What's new is open the whole
  About overlay behind it is made `inert`/`aria-hidden` (removing its
  `aria-modal` too, so there's only one active modal for assistive tech); and
  focus moves into the sub-dialog **synchronously** before About goes inert, so
  no control is ever focused inside an inert subtree even briefly. All restored
  (with focus) on close.

## v18 — About dialog accessibility & tap-target fix

Player-facing:

- The **About** dialog (and the Settings dialog) now manage keyboard focus:
  opening moves focus into the dialog, Tab is trapped inside it, and closing
  restores focus to what you were on. Better for keyboard and screen-reader use.
- The discreet build tag in the bottom-left corner no longer overlaps the board
  on short/narrow viewports, so it can't accidentally swallow a tap meant for a
  board cell.

Background / lessons:

- The first attempt at the tap-target fix assumed `clientHeight`/`clientWidth`
  *exclude* padding. They don't — they **include** padding. A flat 16px
  subtraction therefore under-counted the asymmetric `#board-wrap` padding
  (8px top / 28px bottom) and flex-centering split the overflow, so the board
  could still reach the corner. The correct fix reads the wrap's **actual
  computed padding** and subtracts it, so the reserved bottom strip is always
  honoured. (Caught in code review; worth remembering: box-model getters and
  padding.)

## v16 — "About" panel behind the build tag

Player-facing:

- The small build-version tag in the bottom-left corner is now **clickable**
  and opens an **About** panel: a one-line description, the exact build, a link
  to the source repository, and the licence.

Background:

- Deliberately understated — no button styling, only a faint hover hint — so
  it's *discoverable* without being advertised. The intent is that curious
  users find it; it never gets in the way. (v16/v17 were the shipping build and
  an internal follow-up; folded together here.)

## v15 — Settable propagation speed + manual step mode

Player-facing:

- **Settings (⚙)** lets you choose how a cascade resolves, via a slider:
  **Instant**, **100–1000 ms** animated (default 500 ms), or **› Step** — a
  fully manual mode where a **`>`** button advances the cascade one generation
  at a time, previewing the next step as a shadow on the cells it will change.
- Opening Settings mid-cascade **pauses** it; closing resumes. Changing the
  speed mid-cascade applies from that point on.
- Overloaded cells (about to split) show a large numeral instead of pips — a
  clearer "unstable" signal that also avoids cramming 5+ pips into a square.

Background / lessons:

- Built in increments (engine stepping first, then the slider UI, then wiring).
  Two sharp lessons came out of it:
  - A board fully owned by one colour can stay perpetually over capacity, so
    "keep stepping while any cell overflows" **never terminates**. The fix: a
    cascade is *settled* when the board is stable **or** one player owns every
    cell (`soleOwner`). This is separate from the win-declaration turn-gate.
  - Leaving step mode mid-cascade must **not** resolve the rest instantly — that
    produced a jarring background "instant win". Instead the remainder is handed
    to the animated driver at the chosen speed.

## v6–v9 — Engine groundwork for animation (internal)

Internal:

- The engine gained incremental cascade stepping (`placeDot`, `hasOverflow`,
  `stepOverflowsOnce`, `finalizeAfterCascade`) so the UI can resolve a cascade
  one generation at a time. A non-functional Settings shell was added first for
  UX testing before the logic existed behind it.

## v5 — Iteration 1: the playable game

Player-facing:

- A playable **5×5, two-human-player** game: click/tap an empty or owned cell to
  add a point; cells overflow to their neighbours at capacity, capturing them;
  overflows chain-react. Win by owning the **entire** board.
- Responsive board that fills the viewport on desktop and mobile, re-fitting on
  rotation.
- A fair-opening rule: no win is declared before every player has taken a turn,
  so an opening cascade can't end the game prematurely.

Background:

- The rules engine (`js/game.js`) is intentionally **DOM-free** and dual-exported
  (browser global + Node `module.exports`), so the exact same code powers both
  the playable UI and the automated test harness. Versioning/cache-busting was
  introduced here too, after a fixed rule bug kept appearing "unfixed" on reload
  because the browser served a cached script — hence the single-source `VERSION`,
  the `?v=` tags, the on-page build tag, and a test that fails on version drift.
