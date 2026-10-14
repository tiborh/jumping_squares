# Jumping Squares

[![CI](https://github.com/tiborh/jumping_squares/actions/workflows/ci.yml/badge.svg)](https://github.com/tiborh/jumping_squares/actions/workflows/ci.yml)
[![CodeQL](https://github.com/tiborh/jumping_squares/actions/workflows/codeql.yml/badge.svg)](https://github.com/tiborh/jumping_squares/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/tiborh/jumping_squares/badge)](https://securityscorecards.dev/viewer/?uri=github.com/tiborh/jumping_squares)
[![OpenSSF Baseline](https://www.bestpractices.dev/projects/15171/baseline)](https://www.bestpractices.dev/projects/15171)
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

<!-- HELP:BEGIN
     The content between these markers is the SINGLE SOURCE OF TRUTH for the
     in-app Help dialog (the ? icon in the top bar). A Node script,
     tools/gen-help.js, extracts exactly this block, parses it into a small
     structured form, and mirrors it into js/game.js as the exported HELP data
     (the same mirror-with-a-drift-test pattern used for CHANGELOG). After
     editing anything between the markers, run `node tools/gen-help.js` and
     commit the regenerated js/game.js; a test fails if the two drift apart.
     Keep this block to the formatting the parser understands: `##`/`###`
     headings, paragraphs, `-` bullet lists (one level of nesting via two-space
     indent), and inline **bold**, *italic* and `code`. -->

### Goal

Add a point to an empty or your own cell; when a cell fills past its capacity
it **jumps**, sending a point to each neighbour and capturing them. Own the
**entire** board to win.

### Rules

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
  empty/neutral cells left. A win is only declared once every player has taken
  at least one turn, so an opening cascade can't end the game prematurely.

### Controls

- **Add a point** — click an empty or your own cell on your turn.
- **New Game** — click the tile-count readout in the top bar (it asks you to
  confirm).
- **Players** — click the **top-left area** (the coloured dot and player name)
  to open the **Players** panel. There you can **rename** each human player and
  choose **who controls** each one (Human or an AI), any time — even mid-game.
  Renaming is purely cosmetic; AI players can't be renamed.
- **Reset the win tally** — click the score tally (it asks you to confirm).
- **Hint** — click the **lightbulb** in the bottom-right to flash a strong move
  for the current player (worked out by the strongest computer player). It's
  advisory only — it never takes your turn. The bulb rests dim and *lights up*
  on its own once you've paused without moving; set that delay (or turn it off)
  under **Settings → Hint light-up**.
- **Pause / Play an AI match** — when **both** players are computers, the
  bottom-right corner (where the Hint bulb sits on your turn) becomes a
  **pause/play** button instead. Press **pause** to hold the match before the
  next move — any cascade already running finishes first — and **play** to
  resume. It's handy for pausing a slow thinker on a big board; fast players
  move too quickly to interrupt mid-think.
- **Settings** — click the **⚙** icon in the top bar to set the propagation
  delay (how fast cascades animate), the Hint light-up delay, and manage saved
  data.
- **Help** — click the **?** icon in the top bar to reopen this page.
<!-- HELP:END -->

For more detail on all of the above, see **More about playing** below.

## More about playing

The essentials are in **How to play** above; this section expands on the parts
that have extra options or subtlety.

**Want to play well?** See [`docs/strategy-notes.md`](docs/strategy-notes.md)
for documented tactics (take corners then edges, win the local "arms race",
guard your near-full chains) and how machine play differs from human play —
with sources.

**Restarting.** To restart, **click the tile-count readout** (e.g. `Player 1:
10, Player 2: 9`) in the top bar — it's a button (tooltip: *New Game*) and asks
you to confirm before clearing the board. When a round ends, the end-of-round
screen also offers a **New Game** button. On a phone, the board auto-sizes to
fill the viewport and re-fits on rotation.

**Turn-taking across games.** After a game **ends**, the next game (via New Game
or Play Again) gives the **first move to the other player** — the opener
alternates across completed games so the same side doesn't always start. The
choice is remembered in your browser. Starting a New Game **mid-play**
(abandoning an unfinished game) does *not* flip the opener. Resetting the win
tally (below) can also reset the opener to Player 1 — a checkbox in the reset
dialog, on by default.

**Player names & score.** Click the **top-left area** (the coloured dot and
player name) to open the **Players** panel, then edit a player's **name** there:
type a name and press **Enter** or **click away** to save, or **Esc** to revert.
Only **human** players can be renamed — an AI seat shows its agent name.
Renaming is **purely cosmetic** — it has no effect on the score. A **win tally**
for the current pair is shown next to the tile counts (e.g.
`Alice: 10, Bob: 9   (1 - 0)`) and prominently in the end-of-round dialog; it
accumulates across rounds (New Game keeps the score). Both the names and the
tally are **remembered in your browser** (see *Persistence* below). To start a
fresh series, **click the tally** (it's a button): you'll be asked to
**confirm**, and on confirm the score resets to **0 : 0**.

**Propagation delay (Settings).** Click **⚙ Settings** to control how a cascade
resolves, via a slider:

- **Instant** — the whole cascade resolves immediately.
- **100–1000 ms** — the cascade animates one "generation" at a time, pausing
  that long between steps so you can watch the wave spread and capture cells.
  The default is **500 ms** (a readable middle speed, good for learning).
- **› Step** (far end) — manual mode: after a move that propagates, a **`>`**
  button appears and you advance the cascade one step at a time. The next step
  is previewed as a **shadow** on the cells it will change, so you can see where
  the wave is about to go before committing it.

The slider is labelled **delay** (not speed) because a *higher* number means a
*longer* pause between steps — i.e. slower, easier to follow.

Opening **Settings** while a cascade is animating **pauses** it (the board
freezes); it resumes when you close the dialog. Changing the delay mid-cascade
applies from that point on.

**Hint (the lightbulb, bottom-right).** Press the **lightbulb** in the
bottom-right corner to **flash a strong move** for the player to move: the
suggested square pulses a few times (a gold ring). The move is worked out by the
**strongest computer player** (the Shark search at its deepest setting), so it's
the best move the built-in AI can find — independent of who you're actually
playing. It is **advisory only**: it highlights a cell but never places a dot or
takes your turn. The bulb appears only on a **human player's turn** (not during
a cascade, a manual step, or after a win). It **rests dim** and **lights up** on
its own once you've paused **without moving** for a while — nudging you to think
(or check **Help**) first, and offering the hint only when it might help. Set
that idle delay — **Always on**, **5–30 s**, or **Off** — under **Settings →
Hint light-up** (default **10 s**). On a large/slow board the search may take a
moment, so a brief *thinking* spinner can show on the bulb; on the current 5×5
it's effectively instant.

**Players — play against the computer.** Open the **Players** panel (click the
**top-left area** — the coloured dot and player name), then set either player
(or both) to an AI. Each AI has its own **difficulty** (set per player; when
both seats are the same AI, the two difficulty rows are labelled by seat):

- **Random** — mostly chaotic, a gentle sparring partner.
  - *Easy* — plays any legal move, uniformly.
  - *Medium* — mostly random, but **hits back**: when you're about to capture
    one of its cells next move, it strikes first instead.
- **Tutor** — a human-style strategy (take corners then edges, win the local
  arms race, guard your chains); good for *learning* the game.
  - *Easy* — the gentle, purely positional version (the default). A good first
    opponent to learn to beat.
  - *Medium* — stronger: it avoids leaving a cell you could capture next turn,
    and **watches the squares next to its own pieces** to contest local races
    (matching an adjacent build-up, and claiming the edge cell between its piece
    and a diagonal intruder) — so you can't quietly surround and out-build it.
- **Shark** — searches several moves ahead and plays strongly, exploiting
  cascades that are hard to read by eye. Its **difficulty** (Easy / Medium /
  Hard) sets how far it looks ahead.

The three AIs are distinct *styles* (chaos / heuristic / search) rather than a
single strength ladder — their strengths overlap (e.g. Tutor-Medium can beat
Easy Shark). See [`docs/strategy-notes.md`](docs/strategy-notes.md) for the
measured match-ups and how each AI "thinks".

AI moves use the chosen **propagation delay**, so you can watch their cascades;
two AIs play each other automatically. You can open the **Players** panel at any
time mid-game to change who controls a player (it pauses play while open). See
[`docs/strategy-notes.md`](docs/strategy-notes.md) for how the Tutor's
heuristics and the Shark's search relate to human vs. machine play.

**Board size & AI timing (Settings).** Click **⚙ Settings → Board size** to open
the **Board size & AI timing** panel. A slider picks any **square** board from
**2×2 up to 12×12** (5×5 is the classic default). The size takes effect on your
next **New Game** — it is never changed under an in-progress board.

Bigger boards make the **strongest AI** (Shark on *Hard*) think *much* longer —
and *how* long depends on your device. So the panel can **calibrate** that for
you:

- Press **Calibrate now**. It measures the AI on *your* machine (a few seconds —
  the button shows an estimate) and fills an **estimate table**: every AI and
  difficulty down the side, board sizes above 5×5 across the top, each cell the
  estimated **worst-case think time per move**.
- Set a **max acceptable wait** with the second slider (**0.5 s … 60 s**). Any
  estimate **longer** than that wait is shown in **red**, so you can see at a
  glance which size / AI combinations will feel sluggish before you commit to
  them.
- There is deliberately **no hard limit** — the table is a **guide**, and you
  choose. Random and Tutor stay near-instant at every size; only Shark (and
  mostly its *Hard* depth) climbs into the red on large boards.

**The estimates are approximate — and that is by design.** Calibration
*measures* a couple of cheap sizes on your device and **extrapolates** the
expensive ones with a conservative growth curve (it rounds **up**, so it tends
to warn rather than lull). The numbers therefore depend on your **device and how
busy it is** — a result saved on a fast desktop will understate a phone, and
even the same machine varies under load. The result is **saved** so you don't
re-calibrate every session, but the **Calibrate** button stays available: re-run
it **when your hardware changes, when you move to a different device, or if moves
feel slower than the table claims**.

**From the command line.** `tools/calibrate.js` prints the same table in a
terminal (handy for comparing machines or scripting). With no arguments it shows
every AI for sizes above 5×5; `--size N` restricts to one board, `--max-wait S`
flags over-limit times and reports the largest safe size per AI, `--json` emits
machine-readable output, and `--no-measure` skips measuring to show the generic
fallback model instantly. It shares the exact same cost model
(`js/calibrate.js`) as the in-app panel — a test asserts the two never drift.

```
node tools/calibrate.js                 # full table, measured on this machine
node tools/calibrate.js --max-wait 3     # mark/flag anything slower than 3 s
node tools/calibrate.js --size 10 --json # just 10×10, machine-readable
```

## Project structure

```
index.html          # UI shell + responsive board styling (open this to play)
js/game.js          # Pure game logic (no DOM) — rules, overflow, win check
js/agents.js        # AI opponents (Random / Tutor / Shark), DOM-free
js/calibrate.js     # AI think-time cost model + projection (DOM-free, shared)
js/ui.js            # DOM renderer + input wiring
test/game.test.js   # Node rule-verification harness (no dependencies)
test/agents.harness.js  # Agent-vs-agent win-rate harness (stats, not pass/fail)
tools/gen-help.js   # Regenerates the in-app Help from the README (no deps)
tools/calibrate.js  # CLI: estimated AI think times per board size (shares js/calibrate.js)
tools/calibrate-sample-worker.js  # Bounded single-move timer (child-process primitive)
tools/validate-schema.js  # Backup-file SHAPE validator (JSON Schema; no deps)
tools/validate-rules.js   # Backup-file GAME-RULE validator (engine; no deps)
tools/validate-backup.js  # Runs both validators in order (convenience; no deps)
schema/jumping-squares-backup.v1.json  # Versioned backup-file JSON Schema
```

The game logic in `js/game.js` is intentionally **DOM-free** and dual-exported
(browser global `window.JumpingSquares` and Node `module.exports`), so the exact
same rules code powers both the playable UI and the automated tests.

### In-app Help (sourced from this README)

The **?** icon in the top bar opens a concise *How to play* dialog. Its text is
**not** written twice: it is the block between the `HELP:BEGIN` / `HELP:END`
markers in the *How to play* section above — the single source of truth. A small
Node script mirrors that block into `js/game.js` as structured data the browser
renders (the same mirror-with-a-drift-test pattern used for the changelog, and
for the same reason: there is no build step and `file://` can't fetch the
README at runtime).

After editing anything between the `HELP` markers, regenerate and commit:

```
node tools/gen-help.js          # rewrite the HELP block in js/game.js
node tools/gen-help.js --check  # CI-style: non-zero exit if out of date
node tools/gen-help.js --print  # print the parsed blocks (debugging)
```

A test (`node test/game.test.js`) re-extracts from the README and **fails if the
embedded copy has drifted**, so a forgotten regeneration can't ship. The
expanded material under *More about playing* is deliberately **outside** the
markers, so it does not bloat the in-app dialog.

## Running the tests

Requires Node.js.

```
node test/game.test.js
```

Exit code is `0` when all assertions pass, `1` otherwise (CI-friendly).
The suite covers capacities, legal-move rules, single overflow, capture,
chain-reaction cascades, win detection, state-snapshot independence,
stepped-cascade equivalence (the stepped path matches the instant result),
save validation and rehydration (`loadState`: bounds, cell/owner invariants,
the winner + turn-gate rule, settled-state and point-conservation checks,
including non-player-1 openers), the configurable **starting player**, the
**AI difficulty levels** (Random and Tutor Easy/Medium behaviours), the
**persistence-reset key sweep** (`storageKeysToClear`: future-key auto-clear,
sparing foreign/un-namespaced keys, per-group clearing), and
version-tag consistency (see below). Agent *strength* is measured separately by
`test/agents.harness.js` (win-rate stats, not pass/fail).

## Persistence

Game and preference data are saved **locally in your browser** so they survive
reloads and reopened tabs:

- **Board state (auto-save)** — your current board is automatically saved on
  every completed turn and on New Game / Play Again, restoring seamlessly when
  you reload or return to the tab. Controlled via the **Auto-save game** toggle
  under **Settings → Persistence** (enabled by default). When auto-save is
  turned off, writing stops but any existing save remains until removed via the
  **Remove saved data** button.
- **Player names** — the custom names you set by clicking the turn indicator.
- **Win tally** — the running score for the current name pair.

**Reset to first-use state.** Under **Settings → Persistence**, the **Reset to
first-use state…** button opens a dialog that restores the game to how it was
before you ever used it. You choose exactly what to erase — each item is listed
with what it clears, and all are selected by default:

| Option | What it erases |
| --- | --- |
| **Names, scores & settings** | Player names, the win tally, who starts next, the auto-save preference, and all Players/difficulty settings (the whole `…:prefs` record). |
| **Current game** | The saved board — tile layout and counts — that is restored on reload (the `…:save` record). |
| **Reload the page afterwards** | Refreshes the app so nothing lingers in memory, giving the true first-use appearance. Enabled only while at least one of the two data options above is selected (reloading alone clears nothing). |

The reset is immediate and **cannot be undone**. If you don't reload, the live
page is still updated in place to match. (Reset does **not** change any code, so
a plain reload is enough — no cache-busting is involved; see *Versioning* below
for when `?v=` matters.)

**Save / Load to file.** Under **Settings → Persistence**, the **Save / Load to
file…** button opens a panel to **export** the selected data to a JSON file and
**import** one back. It is **file-based** — nothing is uploaded anywhere; it is
just a download/upload on your device — so you can **share a board** with
someone, **make puzzles**, or keep a **full backup**. Two sections are
selectable (both on by default):

| Section | What it saves |
| --- | --- |
| **Game board** | The current board — tile layout, counts, and whose turn it is. The shareable / puzzle-making piece. |
| **Settings & scores** | The whole preferences record — player names, the win tally, who starts next, who controls each player and their difficulty, and your preferences. |

The download **filename reflects the contents**: a board-only file is
`jumping-squares-board-<timestamp>.json`, settings-only is `…-settings-…`, and a
full backup is `jumping-squares-<timestamp>.json`. **Loading replaces only the
sections present in the file** and keeps everything else; the board is run
through the same **strict** validation as any save (`loadState`), so a corrupt,
wrong-size, or **mid-cascade** board is refused rather than loaded. Importing
asks for confirmation first (it replaces the current game and/or your settings).
A later **"load with trace"** mode (replaying a cascade from a saved start
state) is noted in the roadmap but not built yet.

**Validating a backup file (for hand-edits / your own scripts).** Because the
files are plain JSON, you can edit one by hand or generate it from your own
script — handy for building puzzles. Two **zero-dependency** Node validators let
you check a file *before* loading it in the game, and they deliberately check
two different things:

```
node tools/validate-schema.js  mybackup.json   # SHAPE: fields, types, ranges
node tools/validate-rules.js   mybackup.json   # GAME RULES: is the board legal?
node tools/validate-backup.js  mybackup.json   # BOTH, in order (convenience)
```

- **`tools/validate-schema.js`** checks the file **shape** against a **versioned
  JSON Schema**, [`schema/jumping-squares-backup.v1.json`](schema/jumping-squares-backup.v1.json)
  — field presence, types, ranges, the fixed `format` tags, cell object shape,
  and that `cells` length equals `rows*cols`. On failure it names the exact
  path, the rule, and the schema location that rejected it. (The schema is
  standard JSON Schema, so you can also run it through a full validator such as
  `ajv` yourself.)
- **`tools/validate-rules.js`** is **separate on purpose** — it checks
  **game-rule (semantic) validity**, which a schema *cannot* express: point
  conservation, the turn-gate, the winner rule, no mid-cascade/overflow board,
  and that the player to move has a legal move. It runs the board through the
  **same engine `loadState`** the game uses, so a file that passes it is
  **engine-valid**.

Run shape first, then rules; a file passing both is well-formed **and**
engine-valid. Or run **`tools/validate-backup.js`**, a convenience wrapper that
runs both in that order and reports a combined result (it adds no checks of its
own — the two scripts stay usable individually). All three print a
human-readable report by default, accept **`--json`** for script-friendly
output, read from a file argument or **stdin**, and exit `0`
(valid) / `1` (invalid). The schema is **versioned by filename**
(`…-backup.v1.json`); a future wrapper change adds `…v2.json` rather than
breaking files made against v1.

How it works and its boundaries:

- Stored via the browser's **`localStorage`** under two namespaced keys:
  `jumping_squares:save` for the board state and `jumping_squares:prefs` for
  preferences and scores (namespaced because GitHub Pages serves every project
  of the account from the same origin). There is **no server** and nothing is
  sent anywhere — data never leaves your browser.
- **Reset clears by namespace, not by a fixed list.** Every key this app writes
  begins with the `jumping_squares:` prefix, and Reset **sweeps every key under
  that prefix** (the two options above simply decide whether the board save is
  spared). This is deliberate: any *future* persisted setting added under the
  same prefix is cleaned up by Reset **automatically**, with no extra wiring —
  so "Reset to first-use state" stays complete as the game grows. The
  key-selection logic is a pure, unit-tested engine helper
  (`storageKeysToClear`), shared as the single source of truth between the sweep
  and its tests.
- **No expiry logic by design** — the browser (and you) manage its lifetime;
  clearing site data removes it. It's **per browser / profile**, so a different
  browser, device, or a private window starts fresh.
- **Best-effort and non-essential** — access is feature-detected and wrapped,
  so if storage is unavailable (e.g. private mode) the game falls back to
  in-memory defaults and plays normally; nothing breaks.
- Both the board envelope and preferences record carry schema **versions**
  (`formatVersion` and `v`) with migration seams.
- Untrusted board saves pass strict validation (`loadState`) before rehydration,
  enforcing board dimensions, cell invariants, turn-gate consistency, and settled
  state; corrupt or incompatible saves are discarded and sanitised-logged.
  Entered names are sanitised (text-only, length-capped) and only ever rendered
  as text.

Implementation note: this lives in a tiny preferences module in `js/ui.js`,
written so other settings (e.g. the propagation delay) can be persisted the
same way later.

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

- `spdx-year.awk` — the single source of the year-rewrite (used directly by
  both the hook, on staged content, and the fixer, on working-tree files).
- `pre-commit` — runs on commit; rewrites the **staged** content of each header
  file via `spdx-year.awk` and updates the index, then refreshes the working
  tree via the fixer.
- `fix-copyright-year.sh <file …>` — rewrites years in place in the working
  tree (wraps `spdx-year.awk`; also runnable by hand).
- `check-copyright-year.sh [file …]` — verifies (without modifying) that
  headers include the current year; exits non-zero if any are stale.

You can bypass the hook in an emergency with `git commit --no-verify`. The
**Copyright year** CI workflow is the enforceable safety net: it runs
`check-copyright-year.sh` over the files changed in a pull request (against the
merge base) and the files changed by each push to `main`, so a bypassed hook or
a web-UI edit that leaves a stale year fails CI rather than slipping through.
(It checks only *changed* files, not the whole tree, so a new year doesn't turn
`main` red for untouched headers — each header is refreshed when its file is
next edited.)

## Working with the automated code review

Pull requests get an automated **Copilot code review**. It's a useful extra set
of eyes, but a couple of lessons from using it are worth recording:

- **Keep the review effort on *Lite* for this repo.** On *Balanced* it will mine
  the edge-case tail of small shell/text tooling almost without end (filename
  quoting, line endings, EOF bytes, permissions, …), re-reviewing on every push.
  *Lite* gives the same high-value findings with far less noise. (Set it in the
  PR's **Reviewers → Copilot** control.)
- **Disposition findings with evidence, then stop.** Treat each finding on its
  merits: fix the real ones (several genuinely good catches have improved this
  codebase), but when a finding is a demonstrable false positive or contradicts
  an earlier one, record *why* — ideally with a concrete check (a byte-level
  test, a repro) — and move on rather than looping. The review is **advisory**:
  the merge gate is the required status checks plus the branch ruleset, not the
  review verdict.

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
  `js/game.js?v=N`, `js/agents.js?v=N` and `js/ui.js?v=N`. The browser only
  re-downloads a script when its URL literally changes, so these must be edited
  by hand to match
  `VERSION`.

When shipping a browser-visible change:

1. Bump `VERSION` in `js/game.js`.
2. Update all three `?v=N` strings in `index.html` to the same number
   (`js/game.js`, `js/agents.js`, `js/ui.js`).
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
  time; this powers the settable propagation delay and the manual **› Step**
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
- [x] Settable **propagation delay** (Settings): instant, 100–1000 ms animated
      cascades (default 500 ms), and a manual **› Step** mode with a `>` button
      and a shadow preview of the next step
- [x] Editable **player names** (click the turn indicator on your turn),
      remembered in the browser via a namespaced `localStorage` prefs module
- [x] **Win tally** per name pair, shown in the status line and the
      end-of-round dialog; accumulates across rounds; reset it by clicking the
      tally (with confirmation) — renaming a player is purely cosmetic
- [x] **Turn-taking across games**: after a completed game the opener
      alternates to the other player (remembered in the browser); the tally
      reset can also reset the opener (checkbox, on by default)
- [x] **Placement / propagation flash**: a placed dot pulses its square and
      dots, and the pulse follows the cascade (honours `prefers-reduced-motion`)
- [x] **Auto-save & restore** (board persistence, Phase 1): the current game is
      saved to `localStorage` and restored seamlessly on reload / reopened tab;
      a **Settings → Persistence** panel toggles auto-save and clears saved
      data; an engine-side `loadState` validator guards untrusted saves
- [x] **Reset to first-use state** (Settings → Persistence): a dialog to erase
      names/scores/settings and/or the saved game, with an optional reload.
      Clears by **namespace sweep** (every `jumping_squares:` key), so any
      future persisted setting is reset automatically; the key-selection engine
      helper (`storageKeysToClear`) is pure and unit-tested
- [x] **In-app Help** (the **?** icon in the top bar): a concise *How to play*
      dialog whose text is sourced from this README's `HELP` block — mirrored
      into `js/game.js` by `tools/gen-help.js` and guarded by a drift test (the
      same pattern as the changelog). The top-bar Settings control became a
      matching **⚙** glyph icon (sized to the turn dot) to make room
- [x] **Hint button** (the lightbulb, bottom-right): flashes a strong move for
      the current human player, computed by the strongest AI (Shark at its
      deepest depth) via a shared, DOM-free `bestMove` engine helper. Advisory
      only; rests dim and *lights up* after a settable idle delay (**Settings →
      Hint light-up**: Always / 5–30 s / Off)
- [x] **Players panel** (click the top-left dot + name): the per-seat Human/AI
      type, difficulty, and player **renaming** (both seats, human-only) moved
      out of Settings into their own panel, decluttering the Settings menu
- [x] Versioning: single-source `VERSION`, cache-busting `?v=`, on-page build
      tag, and a test that fails on version drift
- [x] Node test harness (no dependencies; 230+ assertions and growing)
- [x] Documented history, related games, and references

**Planned / ideas (not yet implemented):**

- [x] **Board-size picker in the UI** *(done)* — a **Board size & AI timing**
      panel (Settings → Board size): any square board **2×2 … 12×12**, applied on
      New Game. Because the strongest AI slows down on big boards (and timing is
      device-dependent), it ships with a **per-device calibration** that measures
      cheap sizes and extrapolates the rest (conservatively), an estimate table
      with a user-set **max-wait** red threshold, and a sharing CLI
      (`tools/calibrate.js`). See *Board size & AI timing* above and
      [`docs/strategy-notes.md`](docs/strategy-notes.md) (*Shark performance,
      difficulty, and device calibration*).
- [ ] **Player-count picker in the UI** (engine already supports it; needs the
      3–4-player colours/classes below).
- [ ] Support for 3–4 players (add `--p3`/`--p4` colours + classes)
- [x] Animated cascades — settable delay + manual step mode (see Done above)
- [x] AI opponent using `cloneState()` for lookahead — **Random**, **Tutor**,
      and **Shark**, each **per-player and per-difficulty**: Random (Easy pure /
      Medium reactive-hit-back), Tutor (Easy positional / Medium adds
      1-cell-radius race-contesting), Shark (minimax + alpha-beta, Easy/Medium/
      Hard depth). Selectable per player in the **Players** panel (click the
      top-left dot + name). See
      [`docs/strategy-notes.md`](docs/strategy-notes.md) and
      `test/agents.harness.js` (agent-vs-agent runner).
- [ ] Undo / replay via per-move snapshots
- [x] **Persistence Phase 2 — Save / Load to file** *(done)*: a **Save / Load to
      file** panel under **Settings → Persistence** exports the selected data to
      a JSON file and imports it back. Two selectable sections (both on by
      default) — **Game board** (the shareable / puzzle-making position) and
      **Settings & scores** (the whole prefs record) — in one self-describing
      wrapper; the download filename marks a board-only or settings-only file.
      Loading **replaces only the sections present** and keeps the rest; the
      board passes the engine's strict `loadState` (no mid-cascade positions).
      Useful for sharing boards, making puzzles, bug reports, and full backups.
      Still **deferred**: a **"load with trace"** mode that replays a cascade
      from a saved start state (the engine is deterministic), rather than
      storing mid-cascade frames — saving the settings in the file lets a
      reporter force **› Step** mode to walk the cascade.
- [ ] Optional sound and haptic feedback on mobile
- [ ] **Off-main-thread AI search (Web Worker)** — run the Shark (minimax)
      search in a **Web Worker** so a long think on a big board no longer blocks
      the main thread. This keeps the UI responsive during a multi-second move
      (board, buttons, spinners all live) and, crucially, lets the **AI-vs-AI
      pause** *interrupt a move mid-think* rather than only taking effect
      between moves (today the search is synchronous, so a Pause press can't be
      processed until the current search returns — see the pause control's
      documented limitation). It is also the honest foundation for any later
      "prepare the next move in parallel" idea (though note that is a separate,
      speculative optimisation: minimax is reactive, so precomputing the next
      move means searching a ply deeper — more work, not less). Scope: serialise
      the board to the worker, run `AGENTS.bestMove`/the Shark search there,
      handle cancellation (Pause / New Game invalidating an in-flight search)
      and the `file://` worker-loading caveat (a classic worker script, same
      no-build-step constraints as the rest).
- [ ] Icon buttons for the **Step** control to save top-bar space on narrow
      screens (Settings and Help are already glyph icons; portrait phones still
      get crowded once more controls are added)
- [ ] Visual identity distinct from KJumpingCube (theme, pip style, layout)
- [x] Deploy as a GitHub Pages site
      (live at https://tiborh.github.io/jumping_squares/)
- [x] Basic **win tally** per name pair (see Done above)
- [ ] Richer **score/history panel** and match statistics (beyond the single
      active pair — e.g. multiple pairings, per-game history, longer-term stats)

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

**4. Distribution timing (settable).** *(Implemented as **Propagation delay** —
see How to play.)* How quickly an overflow/cascade resolves:

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

