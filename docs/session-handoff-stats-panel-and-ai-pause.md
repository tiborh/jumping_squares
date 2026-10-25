<!--
  SPDX-FileCopyrightText: 2026 tiborh
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Session handoff — stats panel + AI pause (feature branch)

A resume note for continuing this work in a future session. Captures *where
things stand*, *what is left*, and *the gotchas* so the next session doesn't
re-derive context.

## TL;DR

- **Plan B (off-main-thread AI search) is now IMPLEMENTED** on branch
  `feat/ai-web-worker` at engine `VERSION = '55'`. The Shark search runs in a
  self-contained Blob-URL Web Worker; AI-vs-AI pause can now abort a search
  mid-think. Feasibility was proven first with a throwaway spike (Firefox +
  Chromium under `file://`) before implementing.
- The earlier stats-panel + AI-pause work (v48–v54) is on its own branch
  `feat/stats-panel-and-ai-pause` (PR #63). **Plan B was built on top of the
  v54 state**; when merging, sequence matters — see "Branch state" below.
- `main` is at an older VERSION and contains none of this.
- Remaining before merge: **browser validation** of the pause UX (the Node
  harness can't drive `file://` DOM), now including the new mid-think abort and
  the "thinking" cue.

## What shipped on this branch (features v48 → v54)

Three sequential, interdependent features plus review-fix bumps:

- **v48 — Board stats panel.** Pure DOM-free `boardStats(state)` engine helper
  in `js/game.js` (exported, unit-tested in `test/game.test.js`), rendered by a
  reflowing per-player panel (`#stats-panel` in `index.html`, `renderStats()` in
  `js/ui.js`): above the board in portrait, beside it in landscape (via
  `#board-area` wrapper + `@media (orientation:…)`). Toggled from Settings
  (`statsPanel` pref, schema **v11**, default off). Computation is gated twice:
  skipped when the panel is off, and skipped unless the board is **settled**
  (uses `cascadeSettled()`, not `hasOverflow`, so a winning final move still
  refreshes). Metrics: squares, dots, density, saturation % (**capped at 1**),
  near-overflow, corners/edges/interior, neutral-left. Replaced the top-bar
  tile-count readout with a permanent **New Game** button (`#newgame-btn`).
- **v49 — AI-vs-AI pause/play.** `#aipause-btn` shares the Hint button's
  bottom-right slot (mutually exclusive via `syncHintButton` →
  `syncAiPauseButton`): Hint bulb on human turns, pause/play during an AI-vs-AI
  match, nothing at game over. `aiPaused` flag; `maybeTriggerAI()` declines to
  schedule the next move while paused (an in-progress cascade finishes first).
- **v50 — Plan A pause feedback.** Immediate glyph flip + halt when clicked
  **between moves**; distinct amber "pausing…" state while a move/cascade is
  still finishing; clean on/off toggle.
- **v51–v54 — Copilot review fixes** (cache-busting bumps; see CHANGELOG.md
  "Review fixes (v51–v54)"): settled-stats gate, import/reset panel-sync +
  resize, removed the non-functional "thinking" pulse, saturation cap + test,
  clear `aiPaused` when a seat switches to Human, board refit on stats-table
  width change, live-region clears (New Game + control-unavailable), README/
  CHANGELOG/PR accuracy.

Status checks: `node test/game.test.js` → **301 passed, 0 failed**;
`node tools/gen-help.js --check` in sync; all PR #63 CI checks green.

## The KNOWN LIMITATION (reason for the hold)

The Shark minimax search (`js/agents.js`, `makeShark`/`search`) is
**synchronous on the main thread**. So:
- `busy` only becomes true *after* `chooseMove()` returns (when
  `playMoveAnimated` starts a cascade).
- A pause click during a multi-second search is **queued by the browser** and
  can't be processed until the search returns → pressing pause right after a
  move on a big board (e.g. 9×9 Shark-Hard) looks like it does nothing until the
  next piece lands. (The press *is* registered; only the feedback/effect are
  delayed by one in-flight search.)
- Plan A made the **between-moves** case instant and the **still-finishing**
  case clearly acknowledged, but **cannot** interrupt a search already running.

## NEXT TASK — Plan B (Web Worker AI search)

On the README roadmap ("Off-main-thread AI search (Web Worker)"). Goal: run the
Shark search in a **Web Worker** so the main thread stays responsive during a
long think, which:
1. lets the pause control repaint instantly and show a real "thinking" spinner;
2. lets pause **abort an in-flight search** (true mid-think interruption);
3. is the honest foundation for any later "prepare next move in parallel" idea
   (which is itself **deferred/speculative** — minimax is reactive, so
   precomputing means searching a ply deeper = more work, not less).

Scope notes: serialise board state to the worker, run `AGENTS.bestMove` / the
Shark search there, handle cancellation (Pause / New Game invalidating an
in-flight search via the `playToken` pattern), and the `file://` worker-loading
caveat (classic worker script; no build step, same constraints as the rest).
When reintroducing the "thinking" pulse, drive it from a real **searching**
phase and gate it on the calibration threshold (the removed `isSlowAiSeat`
logic: `CALIB.estimateMs({agent:'Shark',depth}, COLS, samples)` +
`isOverThreshold` vs `getCalibMaxWaitMs`).

## OUTSTANDING (not code) — needs the user / a browser

- **Browser validation** of the pause UX (the Node harness can't drive
  `file://` DOM). Specifically on 9×9 Shark-Hard: (a) pause clicked *between*
  moves flips to ▶ immediately and halts play; (b) pause clicked *during* a move
  shows amber "pausing…" the moment the move lands; (c) control vanishes at game
  over; (d) switching a paused seat to Human doesn't strand play.

## Branch / sync state (as of this handoff)

- `feat/stats-panel-and-ai-pause` @ `4a95794` (local == origin), VERSION 54,
  8 commits ahead of `main`.
- The branch is **behind `main`** by four Dependabot CI merges landed this
  session: #58 (scorecard 2.5.0), #62 (upload-artifact 7.0.2), #64 (codeql-action
  4.38.3 unified + Dependabot group), #65 (setup-node 7.1.0). Syncing `main` →
  this branch is **optional** (those are CI-action bumps, no behaviour change);
  do it only if you want the branch's own CI to run against the newer actions.
  The features will inherit them automatically when #63 eventually merges.
- Only open PR: **#63**. Dependabot PRs #58–#62, #64, #65 all resolved
  (#59/#60/#61 closed as superseded by #64).

## Gotchas / conventions to remember (from .kiro/steering)

- **No build step.** Browser-visible change (`index.html`, `js/*.js`) ⇒ bump
  `VERSION` in `js/game.js` **and** all four `?v=` in `index.html`; a test
  (`version wiring`) enforces the match.
- **HELP** is mirrored from the README `HELP:BEGIN/END` block into `js/game.js`
  by `tools/gen-help.js`; editing inside the markers ⇒ regenerate (drift test
  enforces). Roadmap/prose edits outside the markers don't need it.
- **CHANGELOG**: array in `js/game.js` capped at `WHATSNEW_MAX` (12), newest
  first, newest ≤ VERSION; fuller history in `CHANGELOG.md`.
- **git workflow**: PRs into protected `main`; signed commits (SSH); keep the
  copyright-year hook (no `--no-verify`); merge only on explicit user go-ahead
  with `gh pr merge --squash --delete-branch --admin` after checks are green.
- **Copilot review**: disposition each finding with evidence, fix real ones,
  then **stop** (don't loop on stale re-surfaces).

## Key files

- `js/game.js` — `boardStats()`, VERSION, CHANGELOG, HELP.
- `js/ui.js` — `renderStats`, `syncAiPauseButton`, `maybeTriggerAI`, `aiPaused`,
  `sizeBoard`, prefs (`statsPanel`), import/reset paths.
- `js/agents.js` — `makeShark`/`search` (the synchronous search to move to a
  worker for Plan B).
- `js/calibrate.js` — shared cost model (`estimateMs`, `isOverThreshold`) for
  the slow-mover threshold.
- `index.html` — `#stats-panel`/`#board-area`, `#aipause-btn` + CSS, `?v=` tags.
- `test/game.test.js` — boardStats tests (incl. saturation cap).
