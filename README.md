# Jumping Squares

[![CI](https://github.com/tiborh/jumping_squares/actions/workflows/ci.yml/badge.svg)](https://github.com/tiborh/jumping_squares/actions/workflows/ci.yml)
[![CodeQL](https://github.com/tiborh/jumping_squares/actions/workflows/codeql.yml/badge.svg)](https://github.com/tiborh/jumping_squares/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/tiborh/jumping_squares/badge)](https://securityscorecards.dev/viewer/?uri=github.com/tiborh/jumping_squares)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue.svg)](LICENSE)

**▶ Play it now: https://tiborh.github.io/jumping_squares/**

A browser-based clone of the classic **KJumpingCube** tactical board game.
Pure JavaScript, no build step, no dependencies — just open the HTML file.

Iteration 1: a playable **5×5, two-human-player** game with a responsive
board that fills the screen (works on desktop and mobile).

> **Navigating this README:** it's a long document. On GitHub, use the
> **outline menu** (the ☰ icon at the top-left of the rendered file) for an
> always-up-to-date table of contents generated from the headings.

## How to play

Open `index.html` in any modern browser (double-click it, or serve the folder).

Rules:

- The board is a grid of cells. Each cell has a **capacity** equal to how many
  orthogonal neighbours it has:
  - corner cells → **2**
  - edge cells → **3**
  - interior cells → **4**
- On your turn, click a cell that is **empty** or **already yours** to add one
  point (shown as dice-like pips). You **cannot** add to your opponent's cell.
- When a cell's points **exceed its capacity**, it **overflows ("jumps")**:
  it sends one point to each neighbour and drops by capacity+1. Neighbours it
  spreads into become **your** colour — capturing the opponent's cells.
- Overflows can **chain-react** across the board in a cascade.
- You **win** by owning the **entire** board — no opponent cells **and** no
  empty/neutral cells left. (A win is only declared once every player has taken
  at least one turn, so an opening cascade can't end the game prematurely.)

Use **New Game** (top right) to restart. On a phone, the board auto-sizes to
fill the viewport and re-fits on rotation.

**Propagation speed (Settings).** Click **⚙ Settings** to control how a cascade
resolves, via a slider:

- **Instant** — the whole cascade resolves immediately.
- **100–1000 ms** — the cascade animates one "generation" at a time, pausing
  that long between steps so you can watch the wave spread and capture cells.
  The default is **500 ms** (a readable middle speed, good for learning).
- **› Step** (far end) — manual mode: after a move that propagates, a **`>`**
  button appears and you advance the cascade one step at a time. The next step
  is previewed as a **shadow** on the cells it will change, so you can see where
  the wave is about to go before committing it.

Opening **Settings** while a cascade is animating **pauses** it (the board
freezes); it resumes when you close the dialog. Changing the speed mid-cascade
applies from that point on.

## Project structure

```
index.html          # UI shell + responsive board styling (open this to play)
js/game.js          # Pure game logic (no DOM) — rules, overflow, win check
js/ui.js            # DOM renderer + input wiring
test/game.test.js   # Node rule-verification harness (no dependencies)
```

The game logic in `js/game.js` is intentionally **DOM-free** and dual-exported
(browser global `window.JumpingSquares` and Node `module.exports`), so the exact
same rules code powers both the playable UI and the automated tests.

## Running the tests

Requires Node.js.

```
node test/game.test.js
```

Exit code is `0` when all assertions pass, `1` otherwise (CI-friendly).
The suite covers capacities, legal-move rules, single overflow, capture,
chain-reaction cascades, win detection, state-snapshot independence,
stepped-cascade equivalence (the stepped path matches the instant result), and
version-tag consistency (see below).

## Development setup: copyright-year hook

Source files carry an [SPDX](https://spdx.dev/) copyright header
(`SPDX-FileCopyrightText: <year> tiborh`). To keep the year current
automatically, the repo ships a git hook that, on each commit, updates the
year of any **staged** file whose header is out of date — rewriting a single
year into a `START - CURRENT` range (preserving the original start year) and
re-staging the file. Enable it once per clone:

```
git config core.hooksPath .githooks
```

The hook logic lives in `.githooks/`:

- `pre-commit` — runs on commit; delegates the rewrite to the fixer.
- `fix-copyright-year.sh <file …>` — rewrites years in place (single source of
  the logic; also runnable by hand).
- `check-copyright-year.sh [file …]` — verifies (without modifying) that
  headers include the current year; exits non-zero if any are stale.

You can bypass the hook in an emergency with `git commit --no-verify`. The
**Copyright year** CI workflow is the enforceable safety net: it runs
`check-copyright-year.sh` over the files changed in a pull request (and the
whole tree on pushes to `main`), so a bypassed hook or a web-UI edit that
leaves a stale year fails CI rather than slipping through.

## Versioning & cache-busting

Browsers aggressively cache JavaScript, so a plain reload can keep running an
old `js/*.js` even after the HTML is re-fetched. (During development this
caused a fixed rule bug to appear "unfixed" on reload.) Two mechanisms guard
against that:

- **Single source of truth** — the build version lives in one place,
  `VERSION` at the top of `js/game.js`, and is exported by the engine. The UI
  reads it (`js/ui.js`) and shows it as a build tag: the browser **tab title**
  becomes `Jumping Squares (vN)` and the console logs `Jumping Squares build vN
  loaded`. If you don't see the expected version, you're on a cached build.
- **Cache-busting query strings** — the `<script>` tags in `index.html` load
  `js/game.js?v=N` and `js/ui.js?v=N`. The browser only re-downloads a script
  when its URL literally changes, so these must be edited by hand to match
  `VERSION`.

When shipping a browser-visible change:

1. Bump `VERSION` in `js/game.js`.
2. Update both `?v=N` strings in `index.html` to the same number.
3. Run `node test/game.test.js` — the **"version wiring"** test fails if the
   `?v=` strings don't match the engine `VERSION`, catching drift automatically.
4. In the browser, confirm the tab title shows the expected `Jumping Squares (vN)`.
   If not, hard-reload (**Ctrl+Shift+R**, or **Cmd+Shift+R** on macOS).

## Extending it (future iterations)

The architecture keeps rules and rendering separate to make extensions easy:

- **Board size / player count** — `createGame({ rows, cols, players })` already
  supports these; the UI currently hard-codes 5×5 / 2 players in `js/ui.js`.
  A size/player picker is a small UI addition.
- **More players** — add `--p3`, `--p4` colour variables in `index.html` and the
  matching `.p3` / `.p4` classes; the logic is already player-count agnostic.
- **AI opponent** — `cloneState()` enables lookahead/search without mutating the
  live game.
- **Animations** *(implemented)* — the engine exposes incremental cascade
  stepping (`placeDot`, `hasOverflow`, `stepOverflowsOnce`,
  `finalizeAfterCascade`) so the UI can resolve a cascade one generation at a
  time; this powers the settable propagation speed and the manual **› Step**
  mode. `applyMove` still resolves instantly in one call.
- **Undo / replay** — snapshot with `cloneState()` before each move.

## Roadmap / to-do

Status of the project and planned work. Done items reflect the current build.

**Done (Iteration 1 + fixes):**

- [x] Pure, DOM-free game engine shared by browser and tests
- [x] Responsive board that fills the viewport (desktop + mobile)
- [x] Two human players, click/tap to add a point
- [x] Overflow / capture / chain-reaction cascades
- [x] Point conservation on overflow (overflowing cell keeps its remainder)
- [x] Correct win rule for this variant: win only by owning the **entire**
      board (no opponent cells **and** no neutral cells)
- [x] Fair opening: no win can be declared before every player has moved
- [x] Settable **propagation speed** (Settings): instant, 100–1000 ms animated
      cascades (default 500 ms), and a manual **› Step** mode with a `>` button
      and a shadow preview of the next step
- [x] Versioning: single-source `VERSION`, cache-busting `?v=`, on-page build
      tag, and a test that fails on version drift
- [x] Node test harness (72 assertions, no dependencies)
- [x] Documented history, related games, and references

**Planned / ideas (not yet implemented):**

- [ ] Board-size and player-count picker in the UI (engine already supports it)
- [ ] Support for 3–4 players (add `--p3`/`--p4` colours + classes)
- [x] Animated cascades — settable speed + manual step mode (see Done above)
- [ ] AI opponent using `cloneState()` for lookahead (minimax / MCTS)
- [ ] Undo / replay via per-move snapshots
- [ ] Optional sound and haptic feedback on mobile
- [ ] Icon buttons for Settings / New Game to save top-bar space on narrow
      screens (portrait phones get crowded once more controls are added)
- [ ] Visual identity distinct from KJumpingCube (theme, pip style, layout)
- [x] Deploy as a GitHub Pages site
      (live at https://tiborh.github.io/jumping_squares/)
- [ ] Score/history panel and simple match statistics

### Future game modes / rule sets (design notes)

The long-term vision is **one board, many selectable rule sets** — configurable
options that turn the same grid into different games. Captured here as design
notes before implementation; nothing below is built yet.

**1. Starting conditions (how the board begins).** Selectable option:

- **Start with 1** — every square begins with one point (the classic
  KJumpingCube convention).
- **Start empty (0)** — the current default; squares begin neutral and empty.
- **Initial-occupation phase** — when starting empty, an opening phase where
  players take turns claiming squares one-by-one before normal play begins.
  This is arguably the truest meaning of "starting from zero".
- **Random allotment (Risk-like)** — instead of manual claiming, each player is
  randomly allotted an initial set of squares/points, then normal play begins.

**2. Point-adding mode (what a click does).** Selectable option:

- **Adder mode (default)** — one click adds one point. Simple and
  deterministic. This is "Jumping Squares".
- **Die mode ("Jumping Dice")** — a click *rolls a die* for that square; the
  rolled value is added (or set). Sub-rules to decide:
  - *Zero result*: the click may roll a 0 — the square stays unoccupied. This
    needs clear feedback that the click registered (e.g. the rolled value
    flashes up somewhere easy to notice, then fades) so a "nothing happened"
    click isn't mistaken for an unregistered tap.
  - *Occupation rule*: (a) a click occupies only on a non-zero result, versus
    (b) a click occupies regardless of the numeric result — and this can be
    tied to the chosen starting value.
  - *Overflow threshold ("splitting point")*: still position-dependent
    (2 / 3 / 4 for corner / edge / interior), matching neighbour count.

**3. Presentation follows mode.** The look adapts to the active rules:

- In **die mode**, a square's dot layout mirrors the pips on a real die
  (dice-face arrangement), reinforcing the casting metaphor.
- In **adder mode**, the current pip rendering applies.

**4. Distribution speed (settable).** *(Implemented — see "Propagation speed"
under How to play.)* How fast an overflow/cascade resolves:

- **Instantaneous** — resolve the whole cascade immediately.
- **Slow / stepped** — animate the cascade one generation at a time (100–1000
  ms, default 500 ms), or switch to fully manual **› Step** mode. Better for
  learning the rules and for clearer visual feedback. Built on the engine's
  per-step overflow stepping (`stepOverflowsOnce`); a rendering/timing concern
  layered over the pure rules.

### Dev / prod deployment (future plan)

Right now there is a single deployment: `main` auto-publishes to GitHub Pages
(the "prod" site people play). Local desktop testing (just opening
`index.html`) covers the fast iteration loop, but it **cannot reproduce the
mobile look and feel** — touch behaviour, real device viewports, portrait vs
landscape on an actual phone/tablet. For UX work (menus, sliders, animation),
a live URL reachable from a physical device is needed.

The intended workflow, when this becomes worthwhile:

- **Local (desktop) — fast loop.** Open `index.html` directly for logic and
  layout checks during development. No deploy, instant feedback.
- **Per-branch preview — mobile loop.** Add automatic **preview deployments**
  (e.g. Cloudflare Pages or Netlify, both free for public repos) that publish a
  unique URL for every branch / pull request. That gives a stable **prod** URL
  from `main` plus a throwaway **dev/preview** URL per change, openable on a
  phone or tablet — without disturbing the live game.

GitHub Pages alone serves only one source per repo, so it does not do per-PR
previews well; hence pairing it (prod) with a preview host (dev) rather than
trying to force two Pages sites from one repo. Not built yet — captured here so
the path is clear when UX features start affecting playability.

Contributions and suggestions are welcome — see the license terms below.

## History of the game

This project is a clone; the notes below trace what can be established from
public sources. Where the record is thin, that is stated rather than guessed.

- **KJumpingCube** was written by **Matthias Kiefer** and first released as
  part of the KDE games collection in the late 1990s — the project's `README`
  carries a copyright of **1998–1999** and is dated **5 April 1999** [1]. It is
  free software under the **GNU GPL v2 (or later)** [1].
- It is described by KDE as *"a simple dice-driven tactical game"*: a grid of
  squares holding points, where players click a vacant or owned square to add a
  point, cells overflow to their neighbours when they exceed capacity, and the
  winner is *"the player who ends up owning all the squares on the board"* [2][3].
- The game was later substantially reworked within KDE. The current
  **KJumpingCube Handbook** is credited to **Ian Wadham**, **Eugene Trounev**
  and Matthias Kiefer, with documentation copyright **2012–2013 (Ian Wadham)**
  and **1999–2000 (Matthias Kiefer)** [4]; Wadham's rewrite introduced a
  stronger, configurable AI opponent. Development continues on KDE's
  infrastructure (historically `kdegames`, now `invent.kde.org`) [5].
- The mechanic has been reimplemented many times as a teaching/AI exercise. A
  well-known example is the University of California, Berkeley **CS 61B**
  "Jump61" project, which specifies essentially the same rules (an *N×N* board,
  neutral/coloured squares with spots, overflow to orthogonal neighbours, win by
  owning the whole board) and explicitly names KJumpingCube as its basis [6].

### On deeper origins — research notes (what was searched, found, and not)

The "spreading/overflow on a grid" mechanic clearly predates KJumpingCube as a
*family*, but pinning a single, citable **origin** is unresolved. In the spirit
of mapping a labyrinth — recording the paths that lead nowhere and the ones not
yet walked — here is the state of the search.

**Promising leads (same mechanic, plausibly older, not yet pinned):**

- **"Atoms" / "Chain Reaction" / "Critical Mass"** — a widely reimplemented
  game with rules essentially identical to KJumpingCube: add a blob to an empty
  or owned cell; at *critical mass* (= neighbour count) a cell explodes, sending
  one to each orthogonal neighbour and capturing them; explosions cascade [7].
  This is almost certainly the broader family KJumpingCube belongs to.
- An **Amiga-era "Atoms"** is referenced as the basis for later homebrew ports
  (e.g. "Atoms:DS ... based on a game on Amiga") [8], which would place a
  version in the **late 1980s / early 1990s** — i.e. *before* KJumpingCube
  (1998). This is the strongest candidate for an earlier ancestor, but I could
  not confirm an exact **title, author, or release year** from a primary source.
- A **retrocomputing Q&A** describes a two-player 1980s board game about
  stacking pieces that explode into neighbours [9] — likely the same lineage —
  but the page returned HTTP 403 to automated fetching, so its specific naming
  could not be verified here.

**Similar name, but NOT confirmed related (false paths):**

- **Sid Sackson's "Chain Reaction"** — a pure abstract strategy game by the
  noted designer (related to his 1981 game *Focus*) [10]. Shares the *name* only;
  its mechanic does not appear to be the critical-mass overflow game. Treated as
  **unrelated** absent evidence otherwise.
- **"Critical Mass" (1985, Durell Software)** — a ZX Spectrum/C64/Amstrad game;
  the title matches one of the aliases above, but this is an action game, not
  the grid-overflow game. Almost certainly a **name collision**.
- **"Chain reaction game" US patents** (e.g. US 7,144,322) — unrelated
  gambling/arcade mechanics that merely share the phrase. **Not related.**
- Off-topic near-misses from keyword drift: *Q\*bert* (project codename
  "Cubes"), *Atari Video Cube*, *Rubik's Cube*, *Cube Quest*. None related.

**Dead ends / limits encountered:**

- No manufacturer, box, or manual with a datable "first edition" of the
  Atoms/Chain-Reaction game surfaced through general web search.
- The most concrete-looking primary lead (the retrocomputing StackExchange
  answer) was **not machine-readable** (403), and could not be quoted.
- General search terms collide heavily with unrelated "cube"/"critical mass"/
  "chain reaction" titles, which crowds out the signal.

**Directions future research could take (not yet explored):**

- Search **Amiga/Acorn/RISC OS software archives** (e.g. Aminet, retro
  disk-mag catalogues) for a dated "Atoms" release and its author.
- Check **KDE mailing-list / early `kdegames` history (1998–99)** for any note
  by Matthias Kiefer citing an inspiration.
- Look for **academic AI course materials pre-1998** using "critical mass" grid
  games, which sometimes cite an origin.
- Manually open the blocked retrocomputing thread [9] in a browser to recover
  the specific title/platform the answerers identified.

Until one of those yields a primary source, the honest conclusion is: **the
mechanic is an older, multiply-reinvented "Atoms/Chain-Reaction" family game;
KJumpingCube (1998) is a well-documented KDE implementation of it, but a
specific named, dated predecessor remains unconfirmed.**

## Related games

If you enjoy Jumping Squares, these share the same **critical-mass / chain-reaction**
core (add to an empty or owned cell; a cell at critical mass = neighbour count
explodes one orb to each orthogonal neighbour, capturing them; explosions
cascade). They are the same *family*, differing mainly in board size, presentation
and AI:

- **Chain Reaction** — the most common modern name for the mechanic; many mobile,
  web and desktop versions exist. Popular board size is 9×6 [7]. A good rules
  reference is the Brilliant wiki [7].
- **Atoms** — an older name for the same game, with homebrew ports across many
  platforms (Nintendo DS, Sega Master System, itch.io, etc.), several tracing
  back to an **Amiga original** [8].
- **Critical Mass** — another alias used for the same overflow game (distinct
  from the unrelated 1985 Durell action game of that name — see the false-paths
  notes above).
- **CodinGame "Chain Reaction"** — a bot-programming version of the exact
  mechanic, handy if you want to pit AIs against each other rather than play by
  hand [see ref 3 in the search notes].
- **KJumpingCube** — the KDE game that inspired this clone; the closest direct
  relative in look and rules [1][2].
- **Jump61 (UC Berkeley CS 61B)** — an academic implementation of the same rules,
  useful as a second rules reference and for AI ideas [6].

Adjacent-but-different (listed to disambiguate, *not* the same mechanic):

- **Sid Sackson's "Chain Reaction"** — a well-regarded abstract strategy game
  that shares only the name [10].
- **Filler / Nurikabe / Go** — territory/flood games sometimes mentioned
  alongside this one; they involve capturing area but not the critical-mass
  overflow rule, so they play very differently.

## References

1. KDE — *kjumpingcube* source repository, `README` (Matthias Kiefer;
   copyright 1998–1999; GPL v2+; dated 5 Apr 1999).
   https://github.com/KDE/kjumpingcube — canonical:
   https://invent.kde.org/games/kjumpingcube
2. KDE Applications — *KJumpingCube*. https://apps.kde.org/kjumpingcube/
3. *The KJumpingCube Handbook* — Chapter 3, "Game Rules, Strategies and Tips".
   https://docs.kde.org/stable_kf6/en/kjumpingcube/kjumpingcube/rules_and_tips.html
4. *The KJumpingCube Handbook* (Ian Wadham, Eugene Trounev, Matthias Kiefer;
   doc. copyright 2012–2013 and 1999–2000).
   https://docs.kde.org/stable_kf6/en/kjumpingcube/kjumpingcube/
5. *The KJumpingCube Handbook* — Chapter 2, "How to Play" (overflow/cascade
   description).
   https://docs.kde.org/stable_kf6/en/kjumpingcube/kjumpingcube/howto.html
6. UC Berkeley CS 61B — Project "Jump61" (a KJumpingCube-based assignment).
   https://inst.eecs.berkeley.edu/~cs61b/fa21/materials/proj/proj2/
7. *Chain Reaction game* — Brilliant Math & Science Wiki (rules: critical mass =
   neighbour count; explode and capture; cascade).
   https://brilliant.org/wiki/chain-reaction-game/
8. *Atoms:DS* — GameBrew wiki ("based on a game on Amiga"), evidence of an
   Amiga-era predecessor. https://www.gamebrew.org/wiki/Atoms_DS
9. Retrocomputing Stack Exchange — "Two-player game from the 1980s about
   stacking pieces on a board" (identifies the mechanic; page blocked automated
   access, HTTP 403, at retrieval time).
   https://retrocomputing.stackexchange.com/q/6199
10. BoardGameGeek — *Chain Reaction* by Sid Sackson (same name, different
    abstract game; treated as unrelated).
    https://boardgamegeek.com/wiki/page/thing:3619

*Sources retrieved 2025; KDE material is published by the KDE community.
Same-named entries in refs 10 (and the 1985 Durell "Critical Mass") are noted
as name collisions, not confirmed ancestors.*

## License

Copyright © 2025 tiborh.

This program is free software: you can redistribute it and/or modify it under
the terms of the **GNU Affero General Public License** as published by the Free
Software Foundation, either **version 3** of the License, or (at your option)
any later version (**AGPL-3.0-or-later**). The full text is in the
[`LICENSE`](LICENSE) file.

The intent is simply to **keep free software free**: you are welcome to use,
study, modify and share this game, and — because it is AGPL — anyone who builds
on it (including running a modified version as a network/web service) must make
their corresponding source available under the same terms. This is a
share-alike obligation, not a restriction on commercial use: as with all free
software, commercial use is permitted, provided the source stays open.

Every source file carries an
[SPDX](https://spdx.dev/) header (`SPDX-License-Identifier: AGPL-3.0-or-later`)
identifying its licence and copyright.

## Attribution & originality

This is an **independent, from-scratch implementation** inspired by the
**KJumpingCube** family of games. Important points for anyone reusing it:

- **No KDE code, artwork, names, logos or trademarks are used.** The
  implementation was written from the game's *rules* (which, as game mechanics,
  are not subject to copyright), not from KDE's source.
- Because it contains none of KDE's GPL-licensed code, this project is **not a
  derivative work of KJumpingCube** and is free to carry its own licence
  (AGPL-3.0-or-later, chosen here).
- "Jumping Squares" is used as a descriptive name for the mechanic (squares on
  a grid that fill up and jump to their neighbours); it is deliberately **not**
  "KJumpingCube" (KDE's product name). See the *History*
  and *Related games* sections above for full context and sources.

This section reflects a good-faith understanding of software copyright (game
*rules* are not copyrightable; only specific *code/expression* is) and is not
legal advice.

