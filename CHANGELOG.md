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

## v35 — Follow-up: fresh Player-2 board also saves on first load

Player-facing:

- Completes the v34 fix. A **freshly started** Player-2-opening game is now also
  saved correctly the first time: an edge case on the boot/New-Game path could
  still write an inconsistent save that was discarded on the next reload.

Background:

- The boot fallback (no save to restore) previously patched only
  `state.current = prefs.getStartingPlayer()` on the module's initial state,
  leaving `startingPlayer` at 1. With a persisted opener of 2 that produced a
  `current: 2, startingPlayer: 1` state whose auto-save `loadState()` (correctly)
  rejects — so the next reload discarded it. Both boot fallbacks now **rebuild
  via `createGame({ startingPlayer })`**, setting `current` and `startingPlayer`
  consistently.
- Added terminal (finished) **Player-2-opening** save/validate tests — the v34
  round-trip tests covered only ongoing games — including opener-mismatch and
  bad-`turnsTaken` rejections.
- Restored the `## v33` changelog heading (orphaned again when the v34 section
  was inserted) and will anchor future changelog edits above the previous
  heading to stop this recurring.

## v34 — Fix: save/restore a Player-2-opened game; review follow-ups

Player-facing:

- **Fixed:** a game **opened by Player 2** (which now happens via turn-taking
  alternation, v33) is saved and restored correctly. Previously the save
  validator assumed Player 1 always opened, so a Player-2-opening board failed
  validation on reload and was discarded — silently losing the game (and the
  alternation). Terminal Player-2-opening boards were rejected for the same
  reason. Older saves (always Player-1-opened) are unaffected.

Background:

- Root cause: `loadState()`'s turn-order invariant and `turnsTaken`
  reconstruction were hardcoded to "player 1 opened". The game state now carries
  `startingPlayer` (set by `createGame`, preserved by `cloneState`), and the
  validator computes the expected mover as
  `moverOf(m) = ((startingPlayer - 1 + m) % players) + 1`, applying it to the
  ongoing/terminal `current` checks and the per-player turn distribution. Saves
  **without** `startingPlayer` default to opener 1, so legacy saves validate
  exactly as before; an out-of-range or inconsistent opener is rejected. New
  tests cover fresh/in-progress Player-2 round-trips, a wrong-opener rejection,
  and the legacy default.
- Addressed automated-review follow-ups from the v29–v33 PRs:
  - Removed an unused `anyShark()` helper (`js/ui.js`) and an unused `opp`
    local in the Shark root search (`js/agents.js`) — both flagged by CodeQL
    `js/unused-local-variable`.
  - Restored five `##` version headings in this changelog (v25, v29–v32) that
    were accidentally dropped as each release edited the top of the file,
    leaving their bodies orphaned under the newest heading.
  - The PR-workflow steering file now states that commits must be **signed**
    (the ruleset requires verified signatures; signing is configured globally
    per `CONTRIBUTING.md`).

## v33 — Turn-taking: alternate who opens the next game

Player-facing:

- After a game **ends**, choosing **New Game** / **Play Again** now gives the
  **first move to the other player** — turn-taking alternates across completed
  games so the same player doesn't always open. The choice is **remembered**
  across reloads.
- Starting a New Game **mid-play** (abandoning an unfinished game) does **not**
  flip the opener — only a completed game alternates it.
- Resetting the win tally offers a checkbox, **"Also reset who starts first"**
  (checked by default), so a fresh series can start with Player 1 again — or you
  can uncheck it to keep the current alternation.
- Applies the same way when a seat is an AI: if the opponent now opens and it's
  an AI, it simply makes the first move.

Background:

- The engine's `createGame({ … startingPlayer })` gains an optional first-mover
  (validated to `1..players`, default 1), so the opening player is a clean
  engine input rather than something the UI patches afterwards — also useful for
  the future board-size / player-count picker. A test covers the default,
  explicit value, out-of-range/invalid fallback, and 3-player case.
- The UI persists `startingPlayer` in prefs (schema **v6**, migrating older
  records to the default 1). It rotates **once** per completed game, inside a
  single `recordWinOnce()` guard shared by the two win-observation sites
  (finalize + render safety net), so the flip happens exactly once regardless of
  resolution mode. New Game / boot read the persisted value; the generic confirm
  dialog grew an optional checkbox used by the tally reset.

## v32 — "What's new" panel: progressive disclosure (5 → more → full)

Player-facing:

- The **About → What's new** panel now reveals its entries progressively:
  - It opens showing the **5 most recent** entries.
  - A **"Show N more"** link expands the rest of the recent list.
  - A **"See full changelog"** link at the end opens the complete history
    (`CHANGELOG.md`), which keeps everything — including entries trimmed from
    the in-app list.

Background:

- The in-app list is a **capped excerpt**: the engine `CHANGELOG` array now
  stores at most `WHATSNEW_MAX` (**12**) entries. There is no reason to ship
  entries the panel can never show inline, so the oldest were trimmed from
  `js/game.js` (they remain in this file). A test asserts
  `CHANGELOG.length <= WHATSNEW_MAX`, so the array can't silently grow past the
  cap again.
- `renderWhatsNew()` renders 5 entries collapsed and re-renders on demand: the
  "Show more" button sets an expanded flag and rebuilds the list (revealing up
  to the stored 12); the panel always reopens collapsed. The full-changelog
  link is appended once the inline list is fully expanded (or when nothing was
  hidden), keeping a single clear "next step" at the bottom.

## v31 — The after-flash was a timing race (really fixed now)

Player-facing:

- The stray **"after-flash"** that still showed up *sometimes* (not every time,
  with no obvious pattern) is gone. The intermittency was the tell: it was a
  timing race, not a logic error.

Background:

- v30 cleared flash classes on unchanged cells and stopped double-rendering the
  final generation, which removed the *deterministic* after-flash. But a second,
  **non-deterministic** path remained:
  - `render()` rebuilt **every** cell's `innerHTML` on **every** render, so a
    cell that had just flashed received brand-new `.pip` nodes on the next
    render.
  - The flash classes were removed by a `setTimeout` tuned to exactly match the
    CSS animation duration (420 ms). Whether that timer fired *before* or
    *after* the animation's final frame — and before or after the next render's
    `innerHTML` rebuild — depended on frame scheduling and timer drift. When it
    lost the race, the lingering `flash-dot` class re-ran the pip animation on
    the freshly-created nodes: a stray pulse, appearing only on some turns.
- Two changes close the race for good:
  1. **Only rebuild a cell's `innerHTML` when its value actually changed.**
     Unchanged cells keep their existing DOM, so there are no new nodes for a
     stale class to re-animate. (Owner-only changes just restyle via the
     `p1`/`p2` class; the pip/numeral markup is value-derived, so it needn't be
     rebuilt.)
  2. **End each flash on the real `animationend` event**, not a duration-guessing
     timer (a longer timer remains only as a fallback for detached/backgrounded
     cases). The browser now tells us exactly when the animation finished.
- Also: `buildGrid()` resets the previous-render snapshot, so the first render
  after a New Game paints without flashing leftover diffs.

## v30 — Flash fixes: no after-flash; AI-vs-AI respects the delay

Player-facing:

- Fixed a **stray "after-flash"**: after a propagation chain settled, some
  squares would briefly pulse a second time. The flash now ends cleanly with the
  cascade.
- The **propagation delay** now also **paces AI-vs-AI** play. Previously two
  computer players raced through non-cascading moves with only a tiny think-gap
  between them, so the delay slider seemed to do nothing in AI-vs-AI; now raising
  the delay slows their move cadence to a watchable pace.

Background:

- Root cause of the after-flash: the dot pulse is a CSS animation on the `.pip`
  nodes, but every `render()` rebuilds a cell's `innerHTML` (new `.pip` nodes).
  A `flash-dot` class left on the cell from an earlier generation would re-run
  the animation on those freshly-created pips once the cascade had settled. Two
  changes fix it: (1) every render now explicitly **clears** the flash classes
  on cells that did *not* change this generation (so no class survives into the
  next `innerHTML` rebuild), with a per-cell cleanup timer that is cancelled
  before re-use; and (2) the animated driver no longer **double-renders** the
  final generation (it previously rendered the settling step and then again
  after finalising the turn, in the same tick — the second render saw "no
  change" and would otherwise have cleared the last step's legitimate flash).
- AI pacing: `maybeTriggerAI()` now waits `max(AI_THINK_MS, settings.delayMs)`
  before the next AI move (base think-time keeps even "Instant" watchable; in
  manual **› Step** mode there is no timed pacing, so the base think-time is
  used). A move that *does* cascade already animated at the chosen delay; this
  only adds the same pacing to plain, non-cascading placements.

## v29 — Placement flash, Tutor-by-default, per-Shark difficulty, delay wording

Player-facing:

- **Placement / propagation flash.** Placing a dot now briefly pulses the
  **square** and its **dots**, and the pulse **follows the cascade** as it
  spreads from cell to cell — so what just changed is easy to see. On an
  **overloaded** cell (the one showing a big number, about to split) only the
  square pulses, not the dots: the numeral is signal enough. The effect honours
  `prefers-reduced-motion` (the colour/state still changes; the animation is
  skipped).
- **Tutor by default for new players.** A brand-new user (no saved game and no
  stored preferences) now starts with **Player 2 set to the Tutor AI**, so
  there's an opponent to play against straight away. Returning users keep
  whatever they had set.
- **Per-player Shark difficulty.** When **both** players are Shark, each now has
  its **own** difficulty selector (so you can pit, say, Easy against Hard). With
  a single Shark it reads as one "Shark difficulty" control as before.
- **"Propagation delay".** The Settings slider is renamed from *Propagation
  speed* to **Propagation delay** — clearer that a **higher** number means a
  **longer** pause between cascade steps (slower, easier to follow).

Background:

- The flash is driven in `render()` by diffing each cell against a snapshot of
  the previous render (`prevRender`); changed cells get transient `flash-cell`
  (a pulsing ring on a `::before`) and, unless overloaded, `flash-dot` (the pips
  flare). The animation is re-triggered on consecutive generations by removing
  the classes and forcing a reflow before re-adding. It is suppressed in manual
  **› Step** mode, where the shadow preview already guides the eye.
- Shark difficulty moved from a single prefs value to a **per-seat** map;
  `prefs` schema bumped to **v5**, migrating a pre-v5 single depth onto both
  seats. `agentFor()` is now seat-aware and caches Shark instances by
  seat+depth, so changing one seat's difficulty never disturbs the other.
- The Tutor default is just the seat-2 default in the in-memory `prefs` record;
  any stored `playerType` still overrides it on load, so the change only affects
  users with no prefs yet.

## v25 — Auto-save & restore (board persistence, Phase 1)

Player-facing:

- Your current game is now **saved in this browser** and **restored
  automatically** after a reload or a reopened tab, so an accidental refresh or
  tab close no longer loses the board. It restores seamlessly — straight back
  to the position you left, with no prompt.
- A new **Persistence** section in **⚙ Settings** gives you control:
  - **Auto-save game** — an on/off switch (**on by default**). Turning it off
    stops saving new moves; any game already saved stays and will still restore
    next time. A short note appears in that case so the behaviour isn't a
    surprise.
  - **Remove saved data** — clears the saved game. It's enabled only when there
    is saved data that isn't being continuously overwritten by an active
    auto-save (i.e. when auto-save is off and a save exists).
- Nothing leaves your browser — there is no server; the save lives in
  `localStorage`, like the player names and win tally.
- The end-of-game controls were reworked into layers: a restored **finished**
  game shows the board and a single **New Game** button (the winner is read
  from the all-one-colour board and the name shown top-left) rather than the
  full win dialog; a **live** win still shows the prominent **Play Again**
  dialog. The top-bar New Game is hidden while the end-game bar is shown so
  there's exactly one call-to-action.

Background:

- The board is saved under its **own** `localStorage` key
  (`jumping_squares:save`), separate from the cosmetic prefs
  (`jumping_squares:prefs`) — the board changes every move while prefs rarely
  do, so separating them avoids rewriting the prefs blob per move and lets
  "remove saved data" clear the board independently of names/score. The
  auto-save **toggle** itself is a preference, stored in the prefs key, so the
  choice survives even when no board is saved.
- Saves use a small self-describing wrapper (`format`, `formatVersion`,
  `engineVersion`, `savedAt`, `state`) with a `migrate()` seam, so a future
  schema change can convert old saves forward (validate *after* converting).
- A new engine primitive, `loadState()`, is the single strict, side-effect-free
  validator that turns an untrusted object into a clean state or `null`. It is
  deliberately generous about size (ready for a future board-size picker); the
  **UI** separately rejects, *before* rehydration, any save that doesn't match
  the fixed 5×5 / 2-player board it can render (so an oversized or many-player
  save can't trigger a huge allocation). It also enforces the game's own
  invariants on load: owner/value coupling, the winner rule *including* the
  turn-gate (via `checkWinner`), a **settled-state-only** contract (reject
  boards still mid-cascade, except the legitimate sole-owner perpetual-overflow
  terminal), and rejection of physically-terminal-but-undeclared boards that
  would otherwise restore permanently stuck.
- Scope note: mid-cascade snapshots are intentionally **not** persisted — only
  the settled end-state of a move. The deterministic engine can reproduce a
  cascade from a seed, so a future "save with trace" (move history / replay)
  is a cleaner home for capturing cascades than per-frame dumps.
- Corrupt or incompatible saves are discarded defensively: the offending value
  is logged to the console **sanitised** (length-capped, control characters
  stripped) and removed, then the game boots fresh.

---

## v24 — Win tally (per name pair)

Player-facing:

- The game now keeps a **win tally** for the current pair of players: how many
  rounds each has won. It shows inline next to the tile counts, e.g.
  `Alice: 10, Bob: 9   (1 - 0)`, and prominently in the end-of-round dialog.
- A win is counted the instant the engine decides the round (when the last
  square is claimed) — in instant, timed, and manual **› Step** modes alike.
- The tally **accumulates across rounds** (New Game / Play Again keeps the
  score; it only resets the board).
- **Renaming a player resets the tally to 0:0.** Pressing **Enter** (or clicking
  away) to commit a rename clears the score — the deliberate, button-less way to
  start a fresh series. Pressing **Esc** cancels and keeps the score. The score
  is remembered in this browser and restored as long as the pair is retained.

Background:

- Builds directly on the v22 preferences store. `PREFS_VERSION` is bumped to 2
  (adding `score: { pair, wins }`); v1 records (names only) migrate forward
  rather than being dropped. Only one pair is tracked at this stage — the active
  one — matching the agreed simple scope. A win is recorded exactly once per
  round via a single guard on the moment `state.winner` is set (which happens on
  the same `finalizeAfterCascade` path in every mode), and the guard is cleared
  on New Game. No draw handling: this variant can't end in a draw (a round ends
  only when one player owns the whole board); weighted/draw scoring is left for
  later when richer rule-sets arrive.

## v22 — Editable, remembered player names

Player-facing:

- Click a player's **name** (the turn label at the top) **on their turn** to
  rename them inline; Enter or clicking away saves, Escape cancels. Clearing the
  name restores the default ("Player 1" / "Player 2"). The chosen names also
  appear in the status counts and the winner message.
- Names are **remembered in this browser** across reloads and restarts.

Background:

- First use of client-side persistence: a tiny, namespaced `localStorage`
  preferences store (`jumping_squares:prefs`). Namespacing matters because
  GitHub Pages serves every project of the account from the *same* origin, so an
  un-prefixed key could collide. Kept deliberately simple by design — **no
  expiry logic**; the browser/user manages lifetime and clearing — and fully
  feature-detected: private mode or disabled storage just falls back to
  in-memory defaults and never breaks the game. Names are sanitised (text-only,
  whitespace-collapsed, length-capped at 24) and always rendered via
  `textContent`, never `innerHTML`. A `v` field in the stored record allows
  future migration. The module is structured so other settings (e.g. the
  propagation speed) can be persisted the same way later.

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
