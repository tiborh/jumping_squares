<!--
  SPDX-FileCopyrightText: 2026 tiborh
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Session handoff — stats panel + AI pause (feature branch)

> **ARCHIVED (historical).** The work this note tracked has shipped: the stats
> panel + AI pause/play and Plan B (off-main-thread Web Worker AI search) merged
> to `main` in v55 (PR #63), tagged `v55`, with the optional Playwright e2e
> suite in PR #68. Both feature branches referenced below are merged and
> deleted. This file is kept only as a record of how that work was planned and
> staged; it is **not** a live to-do and should not be used to "resume" anything.

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

## The former KNOWN LIMITATION — now RESOLVED by Plan B (v55)

Up to v54 the Shark minimax search (`js/agents.js`, `makeShark`/`search`) ran
**synchronously on the main thread**, so a pause click during a multi-second
search was queued by the browser and couldn't take effect until the search
returned. **v55 fixes this**: the Shark search now runs in a Web Worker (see
below), so pause interrupts a think immediately. The paragraphs that follow are
kept only as the historical reason the branch was held — they no longer describe
current behaviour.

(Historical.) The synchronous limitation was: `busy` only became true *after*
`chooseMove()` returned; a pause click during a long search was queued and
couldn't be processed until it returned; Plan A made the between-moves case
instant but couldn't interrupt a running search.

## Plan B — Web Worker AI search (DONE in v55)

Implemented. The Shark search runs in a **self-contained Blob-URL Web Worker**
(inlines each module's own `__factorySource`; no `importScripts`/`fetch`, so it
works under `file://`), verified in Firefox + Chromium with a synchronous
fallback. Pause now **aborts an in-flight search** via `worker.terminate()`
(true mid-think interruption); the "thinking" cue returns, driven by a real
searching phase and gated on the calibration threshold (`isSlowAiSeat` →
`CALIB.estimateMs` + `isOverThreshold` vs `getCalibMaxWaitMs`). A drift test
("AI Web Worker source integrity") keeps the inlined worker source faithful.

Two pre-existing bugs were fixed alongside (each behind a pure, Node-tested
helper): valid non-current-size saves were deleted on boot (now
`G.classifySave` keeps them), and a human click could steal an AI seat's move
(now gated via `AGENTS.isAIType`). See PR #67 for the optional Playwright e2e
suite covering these browser-only paths.

## OUTSTANDING — none blocking

- **Browser validation: DONE.** Pause/resume responsiveness, mid-think abort,
  the click-guard, and non-5×5 restore across reload were all confirmed in a
  browser. The Playwright e2e suite (PR #67) now guards the restore and
  click-guard paths automatically.

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
