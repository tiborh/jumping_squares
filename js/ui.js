/*
 * SPDX-FileCopyrightText: 2025 - 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Jumping Squares — browser UI / renderer.
 *
 * Responsibilities (kept separate from game rules in js/game.js):
 *   - Build the grid DOM.
 *   - Size the board to fill the available viewport as a square that fits.
 *   - Translate clicks/taps into moves via JumpingSquares.applyMove.
 *   - Render cell ownership (colour) and value (dice-like pips).
 *
 * Future extensions (AI, board-size picker, animations) can hook in here
 * without touching the rules module.
 */
(function () {
  'use strict';

  var G = window.JumpingSquares;
  // AI agents module (optional): present when js/agents.js is loaded. Guarded so
  // the UI still works (all-human) if the script is missing.
  var AGENTS = window.JumpingSquaresAgents || null;
  // AI think-time calibration helper (optional): present when js/calibrate.js
  // is loaded. Guarded so the UI degrades gracefully (board-size panel simply
  // shows no estimates) if the script is missing.
  var CALIB = window.JumpingSquaresCalibrate || null;

  // --- configuration (Iteration 1: fixed 5x5, two human players) ----------
  var ROWS = 5;
  var COLS = 5;
  var PLAYERS = 2;

  var state = G.createGame({ rows: ROWS, cols: COLS, players: PLAYERS });

  // --- DOM refs ------------------------------------------------------------
  var boardEl = document.getElementById('board');
  var boardWrap = document.getElementById('board-wrap');
  var boardArea = document.getElementById('board-area');
  var turnDot = document.getElementById('turn-dot');
  var turnLabel = document.getElementById('turn-label');
  var turnRegion = document.getElementById('turn');
  var newGameBtn = document.getElementById('newgame-btn');
  var statsPanelEl = document.getElementById('stats-panel');
  var statsHeadEl = document.getElementById('stats-head');
  var statsBodyEl = document.getElementById('stats-body');
  var tallyBtn = document.getElementById('tally-btn');
  var overlay = document.getElementById('winner-overlay');
  var winnerMsg = document.getElementById('winner-msg');
  var winnerScoreEl = document.getElementById('winner-score');
  var endgameBar = document.getElementById('endgame-bar');
  var endgameNew = document.getElementById('endgame-new');
  var stepBtn = document.getElementById('step-btn');
  var hintBtn = document.getElementById('hint-btn');
  var hintLive = document.getElementById('hint-live');
  var aiPauseBtn = document.getElementById('aipause-btn');
  var aiPauseLive = document.getElementById('aipause-live');

  var playerColorVar = ['', '--p1', '--p2', '--p3', '--p4'];

  // --- preferences (localStorage-backed) -----------------------------------
  // A tiny, namespaced, best-effort preferences store. Namespaced because
  // GitHub Pages serves every project of this account from the SAME origin
  // (tiborh.github.io), so an un-prefixed key could collide with another app.
  //
  // Deliberately simple (per the agreed scope): plain localStorage, NO expiry
  // logic — the user/browser manages lifetime and clearing. All access is
  // feature-detected and wrapped so private mode or disabled storage simply
  // falls back to in-memory defaults and never breaks the game. A `v` field
  // lets future changes migrate or discard old data.
  // --- storage namespace registry ------------------------------------------
  // EVERY localStorage key this app writes MUST begin with this prefix. Two
  // reasons: (1) GitHub Pages serves all of this account's projects from the
  // same origin, so a bare key could collide with another app; (2) the Reset
  // feature (Settings → Persistence) clears persistence by SWEEPING every key
  // under this prefix rather than deleting a hard-coded list. That makes any
  // future namespaced key automatically "cleanable" — add a new
  // `jumping_squares:<thing>` key anywhere and Reset will remove it with no
  // extra wiring. The ONLY thing that keeps a key out of the sweep is choosing
  // a different prefix, so: always use STORAGE_PREFIX for new persistence.
  var STORAGE_PREFIX = 'jumping_squares:';

  // Remove every localStorage key under STORAGE_PREFIX, optionally except the
  // keys listed in `keep` (used so the two Reset groups — prefs vs. board save —
  // can be cleared independently). Best-effort and self-contained: feature-
  // detected, swallows errors, and snapshots the key list first (removing while
  // iterating a live `localStorage` is unsafe). Returns the number removed.
  function sweepStorage(keep) {
    var removed = 0;
    try {
      if (typeof window === 'undefined' || !window.localStorage) return 0;
      var ls = window.localStorage;
      // Snapshot the key names first (removing while iterating a live Storage
      // is unsafe), then let the engine's PURE, unit-tested helper decide which
      // to clear. Keeping that decision in game.js means the "future keys are
      // swept automatically" rule has a single, verified source of truth.
      var allKeys = [];
      for (var i = 0; i < ls.length; i++) {
        var key = ls.key(i);
        if (key) allKeys.push(key);
      }
      var doomed = (G && G.storageKeysToClear)
        ? G.storageKeysToClear(allKeys, STORAGE_PREFIX, keep)
        : allKeys.filter(function (k) {
            // Fallback (engine helper somehow unavailable): mirror its contract
            // exactly — sweep our-prefixed keys but SPARE any in `keep`, so a
            // mixed/stale load can never clear the board save when the caller
            // asked to keep it (fail closed, same as the pure helper).
            if (k.indexOf(STORAGE_PREFIX) !== 0) return false;
            return !(keep && keep.indexOf(k) !== -1);
          });
      for (var j = 0; j < doomed.length; j++) {
        try { ls.removeItem(doomed[j]); removed++; } catch (e) { /* skip */ }
      }
    } catch (e) { /* storage blocked: nothing to sweep */ }
    return removed;
  }

  var PREFS_KEY = STORAGE_PREFIX + 'prefs';
  var PREFS_VERSION = 11; // v11: `statsPanel` (board-metrics scoreboard toggle); v10: board-size + AI-time calibration (`boardSize`, `pendingBoardSize`, `calibMaxWaitMs`, `calibration`); v9: `hintLightDelay`; v8: per-seat `randomLevel`; v7: per-seat `tutorLevel`; v6: `startingPlayer`; v5: per-seat sharkDepth; v4 adds `playerType`; v3 adds `autoSave`; v2 adds `score`; v1 names only

  var prefs = (function () {
    // In-memory cache / fallback. `score` tracks the win tally for the active
    // name pair: which seat (1/2) has won how many rounds. `pair` records the
    // names those wins belong to (bookkeeping + future multi-pair support).
    //
    // Built via a FACTORY (not a literal) so the exact same first-use defaults
    // can be re-created by clearAll() when the user resets to first-use state —
    // guaranteeing the live in-memory prefs match a brand-new install, not just
    // the on-disk key being gone.
    function makeDefaults() {
      return {
        v: PREFS_VERSION,
        playerNames: {},
        score: { pair: { 1: '', 2: '' }, wins: { 1: 0, 2: 0 } },
        // Auto-save the board between sessions. ON by default (the whole point is
        // guarding against accidental reloads / tab closure). Persisted here in
        // the PREFS record — independent of the board save itself — so turning it
        // off is remembered even when there is no saved board. See the Persistence
        // section in Settings.
        autoSave: true,
        // Who controls each player: 'human' (default), 'random', 'tutor', or
        // 'shark'. Persisted so the chosen match-up survives reloads. Player 2
        // defaults to the Tutor AI so a brand-new user (no saved game, no stored
        // prefs) immediately has an opponent to play against — easier onboarding
        // than two human seats on a single device. Any stored playerType in prefs
        // overrides this default on load.
        playerType: { 1: 'human', 2: 'tutor' },
        // Shark search depth (difficulty), PER SEAT: 2=Easy, 3=Medium (default),
        // 4=Hard. Per-seat so when BOTH players are Shark each can have its own
        // difficulty. NOTE: per-move time is CPU-DEPENDENT and grows ~ area^depth.
        // On the current fixed 5x5 board all depths are fast (<~100 ms). When
        // larger boards arrive (board-size picker), higher depths get expensive
        // and the UI should surface a time hint — ideally from a one-time
        // in-browser calibration rather than hard-coded (machine-specific) numbers.
        sharkDepth: { 1: 3, 2: 3 },
        // Tutor difficulty PER SEAT: 'easy' (the original gentle 1-ply heuristic,
        // the default so a first opponent stays beatable/learnable) or 'medium'
        // (adds a defensive opponent-reply lookahead — a step toward Shark).
        tutorLevel: { 1: 'easy', 2: 'easy' },
        // Random difficulty PER SEAT: 'easy' (default — pure random) or 'medium'
        // (mostly random, but hits back when the opponent could capture one of
        // its cells next move). Still positionally blind — the "chaos" family.
        randomLevel: { 1: 'easy', 2: 'easy' },
        // Which player makes the FIRST move of the NEXT game. The game alternates
        // this after each COMPLETED game (so the player who went second last game
        // opens the next one). Persisted so the alternation survives reloads.
        // Defaults to 1; reset to 1 when the user resets the series (tally),
        // unless they opt to keep it via the reset dialog's checkbox.
        startingPlayer: 1,
        // How long the bottom-right Hint bulb waits — idle, with the player not
        // having moved — before it "lights up" to suggest a hint might help. The
        // button is clickable the whole time; this only controls the visual
        // nudge. Encoded as milliseconds with two sentinels:
        //   0   -> "always on" (light immediately whenever a hint is available)
        //  -1   -> "never" (stay dim; the user must know to click it)
        //  else -> an idle delay in ms (5000..30000 in the Settings slider).
        // Default 10000 ms (10 s): long enough to encourage trying Help/own
        // thinking first, short enough to offer help before frustration.
        hintLightDelay: 10000,
        // --- Board size + AI think-time calibration (schema v10) ------------
        // ACTIVE square board size (rows === cols) — the size of the live /
        // auto-saved board. Default STANDARD (5). This is what restoreSavedGame
        // matches against, so it only ever changes when a New Game actually
        // opens a board of a new size (committed from pendingBoardSize below).
        // Clamped to the engine's supported 2..12.
        boardSize: 5,
        // PENDING board size — the slider's chosen size, applied on the NEXT
        // New Game (and only then copied into boardSize). Kept separate so that
        // changing the slider and then RELOADING (without pressing New Game)
        // does NOT discard the in-progress game: restore uses the ACTIVE size.
        pendingBoardSize: 5,
        // The user's "max acceptable wait" for the strongest AI, in ms — the
        // threshold that paints over-limit cells RED in the estimate table.
        // One of the discrete slider stops (0.5..60 s); default 5 s.
        calibMaxWaitMs: 5000,
        // The last self-calibration result: the on-device Shark time samples
        // (used to project the estimate table) plus metadata so the user knows
        // when/where it was taken. null until the user runs Calibrate. Shape:
        //   { shark:{ <depth>:{ <cells>:ms } }, flatMs, at:<ISO>, device:<str> }
        // The estimates are APPROXIMATE and device/load dependent (documented);
        // re-calibrate when the hardware or system load changes.
        calibration: null,
        // Stats panel (schema v11): a reflowing board-metrics scoreboard shown
        // beside/above the board, toggled from Settings. OFF by default so the
        // first-use look is unchanged. When OFF the per-turn metric COMPUTATION
        // is skipped entirely (not just hidden) — a deliberate escape hatch in
        // case the extra per-move work is ever noticeable on a slow device.
        statsPanel: false,
      };
    }
    var mem = makeDefaults();

    function storageAvailable() {
      // Probe under our OWN namespace so we never touch another same-origin
      // project's keys. Restore any pre-existing value (defensive — our probe
      // key shouldn't collide with anything, but don't assume).
      var probe = PREFS_KEY + ':__probe__';
      try {
        var prev = window.localStorage.getItem(probe); // null if absent
        window.localStorage.setItem(probe, '1');
        if (prev === null) window.localStorage.removeItem(probe);
        else window.localStorage.setItem(probe, prev);
        return true;
      } catch (e) {
        return false;
      }
    }
    var canStore = storageAvailable();

    function toCount(x) { // coerce stored value to a safe non-negative integer
      var n = (typeof x === 'number') ? x : parseInt(x, 10);
      return (isFinite(n) && n > 0) ? Math.floor(n) : 0;
    }

    function load() {
      if (!canStore) return;
      try {
        var raw = window.localStorage.getItem(PREFS_KEY);
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        adopt(parsed);
      } catch (e) { /* corrupt/blocked: keep defaults */ }
    }

    // Validate + migrate a PARSED prefs object into `mem`, field by field (the
    // same per-field, defensive adoption used for a stored record). Extracted so
    // it is shared by load() (reading localStorage) and importRecord() (adopting
    // a prefs section from a backup file). Unknown/garbage fields are ignored
    // and keep their current value, so a partial or foreign object can never
    // corrupt the in-memory record.
    function adopt(parsed) {
      if (!parsed || typeof parsed !== 'object') return;
      try {
        // Names: a stable field present since v1 — migrate forward unchanged.
        if (parsed.playerNames && typeof parsed.playerNames === 'object') {
          mem.playerNames = parsed.playerNames;
        }

        // autoSave: introduced in schema v3; absent in older (v1/v2) records,
        // which keep the default (true). Only adopt an explicit boolean, so
        // garbage falls back to the default rather than being coerced.
        if (typeof parsed.autoSave === 'boolean') {
          mem.autoSave = parsed.autoSave;
        }

        // playerType: introduced in schema v4; absent in older records (keep
        // the default, all 'human'). Only adopt known values per seat.
        if (parsed.playerType && typeof parsed.playerType === 'object') {
          var valid = { human: 1, random: 1, tutor: 1, shark: 1 };
          [1, 2].forEach(function (n) {
            var t = parsed.playerType[n];
            if (typeof t === 'string' && valid[t]) mem.playerType[n] = t;
          });
        }

        // sharkDepth: per-seat since v5. Accept the current object form
        // ({1:d,2:d}) and MIGRATE the pre-v5 single-number form (one depth for
        // whichever Shark was playing) by applying it to BOTH seats. In either
        // case only an integer in the supported range (2..4) is adopted per
        // seat; anything else keeps that seat's default.
        var validDepth = function (d) {
          return typeof d === 'number' && isFinite(d) &&
                 Math.floor(d) === d && d >= 2 && d <= 4;
        };
        var sd = parsed.sharkDepth;
        if (sd && typeof sd === 'object') {
          [1, 2].forEach(function (n) {
            if (validDepth(sd[n])) mem.sharkDepth[n] = sd[n];
          });
        } else if (validDepth(sd)) {
          // pre-v5 single value: apply to both seats.
          mem.sharkDepth[1] = sd;
          mem.sharkDepth[2] = sd;
        }

        // startingPlayer: introduced in schema v6; absent in older records
        // (keep the default, 1). Only adopt a valid 2-player seat (1 or 2);
        // anything else falls back to the default so a bad value can't open a
        // game out of range.
        var sp = parsed.startingPlayer;
        if (sp === 1 || sp === 2) {
          mem.startingPlayer = sp;
        }

        // tutorLevel: per-seat since v7; absent in older records (keep the
        // default, 'easy'). Only adopt known values per seat.
        if (parsed.tutorLevel && typeof parsed.tutorLevel === 'object') {
          [1, 2].forEach(function (n) {
            var lv = parsed.tutorLevel[n];
            if (lv === 'easy' || lv === 'medium') mem.tutorLevel[n] = lv;
          });
        }

        // randomLevel: per-seat since v8; absent in older records (keep the
        // default, 'easy'). Only adopt known values per seat.
        if (parsed.randomLevel && typeof parsed.randomLevel === 'object') {
          [1, 2].forEach(function (n) {
            var rlv = parsed.randomLevel[n];
            if (rlv === 'easy' || rlv === 'medium') mem.randomLevel[n] = rlv;
          });
        }

        // hintLightDelay: introduced in schema v9; absent in older records
        // (keep the default, 10000). Accept the two sentinels (0 = always on,
        // -1 = never) and any finite non-negative millisecond value; anything
        // else (NaN, non-number, negative other than -1) keeps the default so a
        // bad value can't wedge the bulb in a weird state.
        var hld = parsed.hintLightDelay;
        if (hld === 0 || hld === -1 ||
            (typeof hld === 'number' && isFinite(hld) && hld > 0)) {
          mem.hintLightDelay = hld;
        }

        // Board size: schema v10; absent in older records (keep default 5).
        // Only adopt an integer in the engine's supported 2..12 range so a bad
        // value can never create an out-of-range board.
        var bs = parsed.boardSize;
        if (typeof bs === 'number' && isFinite(bs) &&
            Math.floor(bs) === bs && bs >= 2 && bs <= 12) {
          mem.boardSize = bs;
        }
        // Pending (slider) size — same validation. Defaults to the active size
        // when absent (older records / first use), so the slider opens on the
        // current board's size.
        var pbs = parsed.pendingBoardSize;
        if (typeof pbs === 'number' && isFinite(pbs) &&
            Math.floor(pbs) === pbs && pbs >= 2 && pbs <= 12) {
          mem.pendingBoardSize = pbs;
        } else {
          mem.pendingBoardSize = mem.boardSize;
        }

        // Calibration max-wait threshold (ms): schema v10. Accept any finite
        // positive number (the panel snaps it to a slider stop); anything else
        // keeps the default so a bad value can't disable the red-threshold.
        var mw = parsed.calibMaxWaitMs;
        if (typeof mw === 'number' && isFinite(mw) && mw > 0) {
          mem.calibMaxWaitMs = mw;
        }

        // Saved calibration samples: schema v10. A lightweight shape check only
        // (it is consumed defensively by the projection helper, which ignores
        // non-numeric points). Must be an object with a `shark` sub-object; else
        // keep null (treated as "not yet calibrated"). Never throws on garbage.
        var cal = parsed.calibration;
        if (cal && typeof cal === 'object' && cal.shark && typeof cal.shark === 'object') {
          mem.calibration = cal;
        }

        // Stats panel toggle: schema v11. A plain boolean; only a strict `true`
        // enables it (any other/garbage value leaves the OFF default), so a
        // corrupt record can never silently turn the computation on.
        if (parsed.statsPanel === true) {
          mem.statsPanel = true;
        }

        // Score: introduced in schema v2 and retained in v3. We read it when
        // parsed.v is 2 or 3 (up to PREFS_VERSION). A record written by a newer
        // build (parsed.v > PREFS_VERSION) may have a different score shape,
        // so we start the score fresh while keeping stable names and preferences.
        // Older records (v1) have no score and likewise start fresh.
        var haveScore = false;
        if (typeof parsed.v === 'number' && parsed.v >= 2 && parsed.v <= PREFS_VERSION &&
            parsed.score && typeof parsed.score === 'object') {
          var p = parsed.score.pair, w = parsed.score.wins;
          if (p && typeof p === 'object') {
            mem.score.pair[1] = (typeof p[1] === 'string') ? p[1] : '';
            mem.score.pair[2] = (typeof p[2] === 'string') ? p[2] : '';
          }
          if (w && typeof w === 'object') {
            mem.score.wins[1] = toCount(w[1]);
            mem.score.wins[2] = toCount(w[2]);
          }
          haveScore = true;
        }

        // When there was no score to adopt (v1 migration, or an unknown future
        // schema), stamp the pair from the names we did load so the stored pair
        // reflects reality rather than empty strings. Wins stay 0:0.
        if (!haveScore) {
          var nm = mem.playerNames || {};
          mem.score.pair[1] = (typeof nm[1] === 'string' && nm[1]) ? nm[1] : '';
          mem.score.pair[2] = (typeof nm[2] === 'string' && nm[2]) ? nm[2] : '';
        }
      } catch (e) { /* corrupt/blocked: keep defaults */ }
    }

    function persist() {
      if (!canStore) return;
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(mem));
      } catch (e) { /* quota/blocked: stay in-memory only */ }
    }

    load();

    return {
      getPlayerName: function (n) {
        var v = mem.playerNames[n];
        return (typeof v === 'string') ? v : '';
      },
      setPlayerName: function (n, name) {
        if (name) mem.playerNames[n] = name;
        else delete mem.playerNames[n];
        persist();
      },
      // --- score ---
      getWins: function (n) { return mem.score.wins[n] || 0; },
      // Record one win for seat n. Persisted immediately so a win survives even
      // if the tab is closed right after the game ends.
      addWin: function (n) {
        mem.score.wins[n] = (mem.score.wins[n] || 0) + 1;
        persist();
      },
      // Reset the tally to 0:0 and stamp the pair it now belongs to. Called
      // when the user clicks the tally pill and confirms the reset (renaming a
      // player no longer touches the score — the two actions are decoupled).
      // `resetStarter` (default true) also resets who opens the next game back
      // to player 1 — a fresh series conventionally starts with player 1; the
      // reset dialog offers a checkbox to keep the current alternation instead.
      resetScore: function (name1, name2, resetStarter) {
        mem.score.pair = { 1: name1 || '', 2: name2 || '' };
        mem.score.wins = { 1: 0, 2: 0 };
        if (resetStarter !== false) mem.startingPlayer = 1;
        persist();
      },
      // --- starting player (first mover of the NEXT game) ---
      getStartingPlayer: function () {
        return (mem.startingPlayer === 2) ? 2 : 1;
      },
      setStartingPlayer: function (n) {
        mem.startingPlayer = (n === 2) ? 2 : 1;
        persist();
      },
      // Rotate the opening move to the OTHER player (2-player flip). Called once
      // after a game completes, so the next game opens with the player who went
      // second this time. Returns the new starting player.
      rotateStartingPlayer: function () {
        mem.startingPlayer = (mem.startingPlayer === 2) ? 1 : 2;
        persist();
        return mem.startingPlayer;
      },
      // --- auto-save preference ---
      getAutoSave: function () { return mem.autoSave !== false; },
      setAutoSave: function (on) {
        mem.autoSave = !!on;
        persist();
      },
      // --- player types (human / random / tutor / shark) ---
      getPlayerType: function (n) {
        var t = mem.playerType[n];
        return (t === 'random' || t === 'tutor' || t === 'shark') ? t : 'human';
      },
      setPlayerType: function (n, t) {
        mem.playerType[n] = (t === 'random' || t === 'tutor' || t === 'shark')
          ? t : 'human';
        persist();
      },
      // --- Tutor difficulty (easy / medium), per seat ---
      getTutorLevel: function (n) {
        return (mem.tutorLevel[n] === 'medium') ? 'medium' : 'easy';
      },
      setTutorLevel: function (n, lv) {
        mem.tutorLevel[n] = (lv === 'medium') ? 'medium' : 'easy';
        persist();
      },
      // --- Random difficulty (easy / medium), per seat ---
      getRandomLevel: function (n) {
        return (mem.randomLevel[n] === 'medium') ? 'medium' : 'easy';
      },
      setRandomLevel: function (n, lv) {
        mem.randomLevel[n] = (lv === 'medium') ? 'medium' : 'easy';
        persist();
      },
      // --- Hint bulb light-up delay (ms, or 0 = always on, -1 = never) ---
      getHintLightDelay: function () {
        var d = mem.hintLightDelay;
        if (d === 0 || d === -1) return d;
        return (typeof d === 'number' && isFinite(d) && d > 0) ? d : 10000;
      },
      setHintLightDelay: function (d) {
        if (d === 0 || d === -1 ||
            (typeof d === 'number' && isFinite(d) && d > 0)) {
          mem.hintLightDelay = d;
        } else {
          mem.hintLightDelay = 10000;
        }
        persist();
      },
      // --- Board size + AI think-time calibration (schema v10) ---
      // The chosen square board size (applies on next New Game). Clamped to the
      // engine's supported 2..12 on read so a corrupt stored value is safe.
      getBoardSize: function () {
        var n = mem.boardSize;
        return (typeof n === 'number' && isFinite(n) &&
                Math.floor(n) === n && n >= 2 && n <= 12) ? n : 5;
      },
      setBoardSize: function (n) {
        n = parseInt(n, 10);
        mem.boardSize = (isFinite(n) && n >= 2 && n <= 12) ? n : 5;
        persist();
      },
      // Pending (slider) size — the choice that takes effect on the NEXT New
      // Game. Written by the slider; read to populate the slider and the table
      // highlight. Does NOT change the live/saved board until commitBoardSize().
      getPendingBoardSize: function () {
        var n = mem.pendingBoardSize;
        return (typeof n === 'number' && isFinite(n) &&
                Math.floor(n) === n && n >= 2 && n <= 12) ? n : this.getBoardSize();
      },
      setPendingBoardSize: function (n) {
        n = parseInt(n, 10);
        mem.pendingBoardSize = (isFinite(n) && n >= 2 && n <= 12) ? n : 5;
        persist();
      },
      // Promote the pending size to the ACTIVE size. Called by New Game, the
      // one moment the board actually changes dimensions. Returns the committed
      // size for convenience.
      commitBoardSize: function () {
        mem.boardSize = this.getPendingBoardSize();
        persist();
        return mem.boardSize;
      },
      // The user's max-acceptable-wait threshold (ms) for the red cells.
      getCalibMaxWaitMs: function () {
        var d = mem.calibMaxWaitMs;
        return (typeof d === 'number' && isFinite(d) && d > 0) ? d : 5000;
      },
      setCalibMaxWaitMs: function (ms) {
        ms = parseFloat(ms);
        mem.calibMaxWaitMs = (isFinite(ms) && ms > 0) ? ms : 5000;
        persist();
      },
      // The saved on-device calibration samples (or null if never run).
      getCalibration: function () {
        return (mem.calibration && typeof mem.calibration === 'object' &&
                mem.calibration.shark) ? mem.calibration : null;
      },
      setCalibration: function (cal) {
        mem.calibration = (cal && typeof cal === 'object' && cal.shark) ? cal : null;
        persist();
      },
      getSharkDepth: function (n) {
        var d = mem.sharkDepth[n];
        return (d === 2 || d === 3 || d === 4) ? d : 3;
      },
      setSharkDepth: function (n, d) {
        d = parseInt(d, 10);
        mem.sharkDepth[n] = (d === 2 || d === 3 || d === 4) ? d : 3;
        persist();
      },
      // --- stats panel (schema v11) ---
      // Whether the board-metrics scoreboard is shown. When false the UI skips
      // the per-turn metric computation entirely (see renderStats), so a
      // disabled panel costs nothing.
      getStatsPanel: function () { return mem.statsPanel === true; },
      setStatsPanel: function (on) {
        mem.statsPanel = !!on;
        persist();
      },
      // --- reset to first-use state ---
      // Erase stored preferences and reset the in-memory cache to the exact
      // first-use defaults. Used by the Reset feature (Settings → Persistence).
      // Rather than deleting only PREFS_KEY, it SWEEPS keys under STORAGE_PREFIX
      // (minus `keep`), so any future namespaced prefs key is cleared
      // automatically — no per-key wiring. `keep` defaults to [SAVE_KEY] so the
      // board save (the Reset dialog's "current game" group) is spared unless
      // the caller explicitly opts to clear everything (keep = []).
      // Returns the number of storage keys removed (0 if storage is blocked).
      clearAll: function (keep) {
        var toKeep = (keep === undefined) ? [SAVE_KEY] : keep;
        var removed = sweepStorage(toKeep);
        mem = makeDefaults(); // live state now matches a brand-new install
        return removed;
      },
      // --- backup export / import (Save / Load to file) ---
      // exportAll() returns a deep, plain-object COPY of the current prefs
      // record (safe to serialise into a backup file; never a live reference).
      exportAll: function () {
        return JSON.parse(JSON.stringify(mem));
      },
      // importRecord(parsed) REPLACES the whole prefs record from a parsed
      // backup section: reset to first-use defaults, then adopt the parsed
      // object through the SAME per-field validation/migration as a stored
      // record (so a partial, older, or garbage object can't corrupt state),
      // then persist. "Replace" per the agreed semantics: anything the file
      // omits reverts to its default rather than keeping the old value — the
      // caller only invokes this when the file's prefs section is present.
      importRecord: function (parsed) {
        mem = makeDefaults();
        adopt(parsed);
        persist();
      },
    };
  })();

  // --- board persistence (localStorage-backed, separate key) ---------------
  // The saved GAME BOARD lives under its OWN key, distinct from the cosmetic
  // prefs above. Rationale (agreed design): the board is larger and rewritten
  // on every move, while prefs change rarely — separating them avoids
  // rewriting the whole prefs blob per move and lets "remove saved data" clear
  // the board independently of names/score.
  //
  // On-disk shape is a small self-describing wrapper so a saved game is
  // recognisable and future-proof:
  //   { format:'jumping_squares/save', formatVersion:1, engineVersion:'25',
  //     savedAt:'<ISO>', state:{ ...engine cloneState... } }
  // engineVersion is recorded so a later format change can migrate old saves
  // (validate AFTER converting). All reads go through the engine's loadState()
  // validator, so corrupt/edited/hostile data can never become a live state.
  var SAVE_KEY = STORAGE_PREFIX + 'save';
  var SAVE_FORMAT = 'jumping_squares/save';
  var SAVE_FORMAT_VERSION = 1;

  var boardStore = (function () {
    function storageAvailable() {
      var probe = SAVE_KEY + ':__probe__';
      try {
        var prev = window.localStorage.getItem(probe);
        window.localStorage.setItem(probe, '1');
        if (prev === null) window.localStorage.removeItem(probe);
        else window.localStorage.setItem(probe, prev);
        return true;
      } catch (e) {
        return false;
      }
    }
    var canStore = storageAvailable();

    // Make an untrusted string safe to print to the console: cap length and
    // strip control chars (incl. CR/LF/ESC) so a crafted saved value can't
    // forge extra console lines or inject terminal escape sequences.
    function sanitizeForLog(s) {
      if (typeof s !== 'string') s = String(s);
      if (s.length > 500) s = s.slice(0, 500) + '…(truncated)';
      return s.replace(/[\u0000-\u001F\u007F]+/g, ' ');
    }

    // (Seam for N3) Convert an older on-disk record forward to the current
    // formatVersion. No older versions exist yet, so this is identity; when the
    // schema changes, branch on wrapper.formatVersion here and the result is
    // then re-validated by loadState below (validate-after-convert).
    function migrate(wrapper) {
      return wrapper;
    }

    return {
      canStore: canStore,

      /**
       * True iff a valid, restorable save exists under our key.
       * If present data is corrupt or unparseable, it is discarded (sanitised-
       * logged and removed) so bad data does not linger, and false is returned.
       *
       * @param {function(rows,cols,players):boolean} [accept] optional predicate
       *   checked against the raw saved dimensions; return false to reject a save
       *   this UI cannot render.
       */
      has: function (accept) {
        if (!canStore) return false;
        var raw;
        try {
          raw = window.localStorage.getItem(SAVE_KEY);
        } catch (e) {
          return false;
        }
        if (raw === null) return false;

        var discard = function (reason) {
          try {
            console.warn('Jumping Squares: discarding unusable saved game (' +
              reason + '): ' + sanitizeForLog(raw));
          } catch (e2) { /* ignore logging failures */ }
          try { window.localStorage.removeItem(SAVE_KEY); } catch (e3) {}
          return false;
        };

        try {
          var wrapper = JSON.parse(raw);
          if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper) ||
              wrapper.format !== SAVE_FORMAT) {
            return discard('unrecognised format');
          }

          var fv = wrapper.formatVersion;
          if (typeof fv !== 'number' || !isFinite(fv) || Math.floor(fv) !== fv ||
              fv < 1 || fv > SAVE_FORMAT_VERSION) {
            return discard('unsupported formatVersion');
          }

          wrapper = migrate(wrapper);

          if (!wrapper.state || typeof wrapper.state !== 'object' || Array.isArray(wrapper.state)) {
            return discard('malformed state');
          }

          if (typeof accept === 'function') {
            var ws = wrapper.state;
            if (!accept(ws.rows, ws.cols, ws.players)) {
              return discard('dimensions not accepted');
            }
          }

          if (G.loadState(wrapper.state) === null) {
            return discard('failed validation');
          }
          return true;
        } catch (e) {
          return discard('malformed save');
        }
      },

      /**
       * Persist a game state (an engine cloneState object) under the save key.
       * Best-effort: storage errors (quota/blocked) are swallowed so gameplay
       * never breaks.
       */
      save: function (stateObj) {
        if (!canStore) return;
        try {
          var wrapper = {
            format: SAVE_FORMAT,
            formatVersion: SAVE_FORMAT_VERSION,
            engineVersion: G.VERSION,
            savedAt: new Date().toISOString(),
            state: stateObj,
          };
          window.localStorage.setItem(SAVE_KEY, JSON.stringify(wrapper));
        } catch (e) { /* quota/blocked: stay in-memory only */ }
      },

      /**
       * Load and VALIDATE a saved game. Returns a clean engine state (via
       * G.loadState) on success, or null if there is nothing to load / the data
       * is unusable. A present-but-corrupt save is DISCARDED (removed) and its
       * sanitised content is logged to the console for later analysis, then null
       * is returned so the caller boots fresh.
       *
       * @param {function(rows,cols,players):boolean} [accept] optional predicate
       *   checked against the raw saved dimensions BEFORE rehydration; return
       *   false to discard a save this caller cannot use (avoids allocating a
       *   huge, validator-allowed-but-unrenderable board).
       */
      load: function (accept) {
        if (!canStore) return null;
        var raw;
        try {
          raw = window.localStorage.getItem(SAVE_KEY);
        } catch (e) {
          return null;
        }
        if (raw === null) return null; // nothing saved: not an error

        var discard = function (reason) {
          // Log the (sanitised) offending content so a real corruption can be
          // investigated, then remove it so it can't wedge every future boot.
          try {
            console.warn('Jumping Squares: discarding unusable saved game (' +
              reason + '): ' + sanitizeForLog(raw));
          } catch (e2) { /* ignore logging failures */ }
          try { window.localStorage.removeItem(SAVE_KEY); } catch (e3) {}
          return null;
        };

        try {
          var wrapper = JSON.parse(raw);
          if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper) ||
              wrapper.format !== SAVE_FORMAT) {
            return discard('unrecognised format');
          }

          // Validate the envelope's formatVersion BEFORE migrating. It must be a
          // positive integer no newer than this build understands. A missing /
          // malformed version, or one from a FUTURE build, must not slip past
          // migrate() (which only knows how to convert versions up to the
          // current one) into loadState under today's assumptions. Older versions
          // (< current) are allowed through so migrate() can convert them when
          // such versions eventually exist.
          var fv = wrapper.formatVersion;
          if (typeof fv !== 'number' || !isFinite(fv) || Math.floor(fv) !== fv ||
              fv < 1 || fv > SAVE_FORMAT_VERSION) {
            return discard('unsupported formatVersion');
          }

          wrapper = migrate(wrapper); // N3 seam (identity for now)

          if (!wrapper.state || typeof wrapper.state !== 'object' || Array.isArray(wrapper.state)) {
            return discard('malformed state');
          }

          // Cheap dimension gate BEFORE rehydration. loadState() is strict but it
          // also ITERATES/ALLOCATES one object per cell, so a validator-allowed
          // but huge save (e.g. 1000x1000 = 1,000,000 cells) would cost a large
          // parse+allocation pass before any later UI check could reject it. If
          // the caller supplied an `accept(rows, cols, players)` predicate, peek
          // at the raw wrapper.state's declared dimensions (shallow reads, no
          // iteration) and bail out early when they are not acceptable — so an
          // oversized/incompatible save is discarded without ever rehydrating it.
          if (typeof accept === 'function') {
            var ws = wrapper.state;
            if (!accept(ws.rows, ws.cols, ws.players)) {
              return discard('dimensions not accepted');
            }
          }

          var clean = G.loadState(wrapper.state);
          if (clean === null) {
            return discard('failed validation');
          }
          return clean;
        } catch (e) {
          return discard('malformed save');
        }
      },

      /** Remove any saved game (used by "remove saved data" / reset). */
      remove: function () {
        if (!canStore) return;
        try { window.localStorage.removeItem(SAVE_KEY); } catch (e) {}
      },
    };
  })();

  // Default display name when the player has no stored/custom name.
  function defaultPlayerName(n) { return 'Player ' + n; }

  // Sanitize a user-entered name: strip control chars/newlines, collapse
  // internal whitespace, trim, and cap length. Returns '' for empty input
  // (callers treat '' as "use the default"). Names are always rendered via
  // textContent (never innerHTML), so this is about tidiness/limits, not markup
  // safety — but keeping it text-only is a defence-in-depth habit.
  var MAX_NAME_LEN = 24;
  function sanitizeName(raw) {
    if (typeof raw !== 'string') return '';
    var s = raw.replace(/[\u0000-\u001F\u007F]+/g, ' '); // control chars -> space
    s = s.replace(/\s+/g, ' ').trim();                   // collapse + trim
    if (s.length > MAX_NAME_LEN) s = s.slice(0, MAX_NAME_LEN).trim();
    return s;
  }

  // The name to display for player n: for an AI-controlled seat, the agent's
  // label (e.g. "Random (AI)"); otherwise the custom (stored) name or default.
  function playerName(n) {
    var type = prefs.getPlayerType(n);
    if (type === 'random') return 'Random (AI)';
    if (type === 'tutor') return 'Tutor (AI)';
    if (type === 'shark') return 'Shark (AI)';
    var custom = sanitizeName(prefs.getPlayerName(n));
    return custom || defaultPlayerName(n);
  }

  // Running win tally for the active pair, as "(winsA - winsB)".
  function scoreLabel() {
    return '(' + prefs.getWins(1) + ' - ' + prefs.getWins(2) + ')';
  }

  // --- build the grid once -------------------------------------------------
  var cellEls = [];
  function buildGrid() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = 'repeat(' + state.cols + ', 1fr)';
    boardEl.style.gridTemplateRows = 'repeat(' + state.rows + ', 1fr)';
    cellEls = [];
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        var el = document.createElement('div');
        el.className = 'cell';
        el.setAttribute('role', 'gridcell');
        el.dataset.r = r;
        el.dataset.c = c;
        el.addEventListener('click', onCellClick);
        boardEl.appendChild(el);
        cellEls.push(el);
      }
    }
    // The grid DOM is brand new, so there is no meaningful "previous render" to
    // diff against. Clear the snapshot so the FIRST render after a (re)build
    // paints without flashing every cell (e.g. on New Game).
    prevRender = null;
  }

  // --- responsive sizing: largest square that fits the board area ----------
  function sizeBoard() {
    // Measure the board's OWN flex cell (#board-area), not the whole wrap: when
    // the stats panel is shown it is a flex sibling that takes part of the wrap,
    // so the board must fit the REMAINING space (board-area). Fall back to the
    // wrap if board-area is missing (defensive).
    //
    // clientWidth/clientHeight INCLUDE padding, so subtract the element's actual
    // computed padding to get the true content area. The extra bottom padding
    // (a tag-safe strip) is therefore fully honoured: the board can never be
    // sized under the fixed, interactive build tag, even on short/narrow
    // viewports. A small extra margin keeps the board off the very edges.
    var measureEl = boardArea || boardWrap;
    var cs = getComputedStyle(measureEl);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var margin = 8; // small breathing room beyond the padding
    var availW = measureEl.clientWidth - padX - margin;
    var availH = measureEl.clientHeight - padY - margin;
    if (availW < 1) availW = 1;
    if (availH < 1) availH = 1;
    // Keep cells square: constrain by aspect ratio of the grid.
    var cellSize = Math.floor(Math.min(availW / state.cols, availH / state.rows));
    if (cellSize < 1) cellSize = 1;
    boardEl.style.width = (cellSize * state.cols) + 'px';
    boardEl.style.height = (cellSize * state.rows) + 'px';
    // Expose the cell size so the overloaded numeral can scale with the board.
    boardEl.style.setProperty('--cell-size', cellSize + 'px');
  }

  // --- rendering -----------------------------------------------------------
  // Stable cells (value <= capacity) show dice-like pips. Overloaded cells
  // (value > capacity) show a large Arabic numeral instead — a clear, ephemeral
  // "this is unstable and about to split" signal that also sidesteps trying to
  // arrange 5+ pips in a small square. This is position-dependent via capacity:
  // corner overflows at 3+, edge at 4+, interior at 5+.
  function pipMarkup(value, cap) {
    if (value <= 0) return '';
    if (value > cap) {
      // Overloaded: big number filling the square.
      return '<span class="count">' + value + '</span>';
    }
    var dots = '';
    for (var i = 0; i < value; i++) dots += '<span class="pip"></span>';
    return '<div class="pips">' + dots + '</div>';
  }

  // --- accessible dialog focus management ----------------------------------
  // Shared by Winner, Settings, About, and What's New dialogs. Maintains a
  // stack of open dialogs so nested dialogs (e.g. What's new inside About)
  // trap focus strictly within the topmost active dialog without conflicting.
  var activeDialogs = [];

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || activeDialogs.length === 0) return;
    var current = activeDialogs[activeDialogs.length - 1];
    current.onTab(e);
  });

  function focusables(container) {
    var sel = 'a[href], button:not([disabled]), input:not([disabled]), ' +
              'select:not([disabled]), textarea:not([disabled]), ' +
              '[tabindex]:not([tabindex="-1"])';
    return Array.prototype.filter.call(
      container.querySelectorAll(sel),
      function (el) {
        // Skip hidden/zero-size nodes (e.g. a hidden step button).
        return el.offsetWidth > 0 || el.offsetHeight > 0 ||
               el === document.activeElement;
      }
    );
  }

  // Build an open/close pair that manages focus for a given overlay + card.
  // `preferredFocusId` is focused first on open (falls back to first focusable).
  function makeDialogFocusManager(overlayEl, cardEl, preferredFocusId) {
    var lastFocused = null;

    function onTab(e) {
      var items = focusables(cardEl);
      if (items.length === 0) { e.preventDefault(); return; }
      var first = items[0];
      var last = items[items.length - 1];
      var active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !cardEl.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !cardEl.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    var manager = {
      onTab: onTab,
      onOpen: function () {
        lastFocused = document.activeElement;
        var pref = preferredFocusId && document.getElementById(preferredFocusId);
        var items = focusables(cardEl);
        var target = pref || items[0] || cardEl;
        if (target && target.focus) target.focus();
        activeDialogs.push(manager);
      },
      onClose: function () {
        var idx = activeDialogs.indexOf(manager);
        if (idx !== -1) activeDialogs.splice(idx, 1);
        if (lastFocused && document.body && document.body.contains(lastFocused) && lastFocused.focus) {
          lastFocused.focus();
        } else if (cellEls && cellEls[0] && cellEls[0].focus) {
          cellEls[0].focus();
        }
        lastFocused = null;
      },
    };
    return manager;
  }

  var winnerFocus = makeDialogFocusManager(overlay, overlay, 'play-again');

  // --- placement / propagation flash --------------------------------------
  // prevRender holds the previous render's per-cell {value, owner} so render()
  // can detect which cells changed and pulse them. null until the first render
  // completes (so the initial board paint doesn't flash every cell).
  var prevRender = null;

  function snapshotRender() {
    var snap = new Array(state.cells.length);
    for (var i = 0; i < state.cells.length; i++) {
      snap[i] = { value: state.cells[i].value, owner: state.cells[i].owner };
    }
    prevRender = snap;
  }

  // Pulse a cell to signal a just-changed value/owner. The square always pulses
  // (flash-cell); the dots pulse too (flash-dot) UNLESS the cell is overloaded
  // (its big numeral is signal enough — no dot-flash on overflow, per the UX
  // request). Re-triggering: remove the classes and force a reflow before
  // re-adding, so a cell that changes on consecutive cascade generations pulses
  // again each time rather than the CSS animation being a no-op.
  //
  // Cleanup is driven by the real `animationend` event (plus a slightly-longer
  // timer as a belt-and-braces fallback for cases where animationend may not
  // fire — e.g. the element is detached, or the tab was backgrounded). Both the
  // listener and the timer are stashed on the element so a re-flash cancels the
  // previous ones cleanly. Earlier versions removed the classes on a bare
  // setTimeout tuned to the CSS duration; that produced an INTERMITTENT stray
  // "after-flash" because the timer and the animation's final frame raced, and
  // whichever landed first was non-deterministic. animationend removes the race.
  function cancelFlashCleanup(el) {
    if (el._flashTimer) { clearTimeout(el._flashTimer); el._flashTimer = null; }
    if (el._flashEnd) {
      el.removeEventListener('animationend', el._flashEnd);
      el._flashEnd = null;
    }
  }

  function flashCell(el, overloaded) {
    cancelFlashCleanup(el);
    el.classList.remove('flash-cell', 'flash-dot');
    // Force reflow so removing + re-adding restarts the CSS animation.
    void el.offsetWidth;
    el.classList.add('flash-cell');
    if (!overloaded) el.classList.add('flash-dot');

    var finish = function () {
      cancelFlashCleanup(el);
      el.classList.remove('flash-cell', 'flash-dot');
    };
    el._flashEnd = finish;
    el.addEventListener('animationend', finish);
    // Fallback: a bit longer than the CSS duration so it only fires if
    // animationend somehow didn't. Not tuned to EXACTLY match the animation
    // (that's precisely what caused the race before).
    el._flashTimer = window.setTimeout(finish, FLASH_MS + 120);
  }

  // Immediately remove any flash state from a cell (and cancel its pending
  // cleanup). Called for every cell that did NOT change on a given render.
  function clearFlash(el) {
    cancelFlashCleanup(el);
    el.classList.remove('flash-cell', 'flash-dot');
  }

  var FLASH_MS = 420; // the CSS flash animation duration

  // --- board-stats panel ---------------------------------------------------
  // Metric rows shown in the panel, in display order. `key` indexes into the
  // engine's boardStats() result; `fmt` turns a per-player number into a string.
  var STAT_ROWS = [
    { key: 'squares',   label: 'Squares',    fmt: function (v) { return String(v); } },
    { key: 'dots',      label: 'Dots',       fmt: function (v) { return String(v); } },
    { key: 'density',   label: 'Density',    fmt: function (v) { return v.toFixed(2); } },
    { key: 'saturation',label: 'Saturation', fmt: function (v) { return Math.round(v * 100) + '%'; } },
    { key: 'critical',  label: 'Near overflow', fmt: function (v) { return String(v); } },
    { key: 'corners',   label: 'Corners',    fmt: function (v) { return String(v); } },
    { key: 'edges',     label: 'Edges',      fmt: function (v) { return String(v); } },
    { key: 'interior',  label: 'Interior',   fmt: function (v) { return String(v); } },
  ];

  // Render (or clear) the Board-stats panel. The COMPUTATION is gated twice:
  //   1. If the panel is disabled in prefs, show nothing and compute nothing —
  //      the deliberate escape hatch so a disabled panel costs zero per-turn
  //      work (and the <aside> is `hidden`, taking no layout space).
  //   2. If a cascade is in progress (busy / paused / manual stepping), the
  //      board is NOT settled; we leave the previous numbers in place rather
  //      than compute/flicker mid-cascade (the user asked for settled-only).
  // Otherwise it calls the pure engine helper once and fills a per-player table.
  function renderStats() {
    if (!statsPanelEl) return;
    var enabled = prefs.getStatsPanel();
    statsPanelEl.hidden = !enabled;
    if (!enabled) return;                 // gate 1: no compute when disabled

    var settled = !busy && !stepping.active && !G.hasOverflow(state);
    if (!settled) return;                 // gate 2: no mid-cascade refresh

    var st = G.boardStats(state);         // single O(cells) pass, settled board

    // Build via DOM APIs with textContent (never innerHTML) so player names —
    // user-entered — are rendered as text, matching the file's convention.
    // Header: a blank corner cell, then one column per player (coloured dot +
    // name). Rebuilt each call so a rename / player-count change is reflected.
    statsHeadEl.textContent = '';
    var htr = document.createElement('tr');
    htr.appendChild(document.createElement('th')); // blank corner
    for (var p = 1; p <= st.players; p++) {
      var th = document.createElement('th');
      th.setAttribute('scope', 'col');
      var dot = document.createElement('span');
      dot.className = 'stat-dot';
      var cv = getComputedStyle(document.documentElement)
        .getPropertyValue(playerColorVar[p]) || '#fff';
      dot.style.background = cv.trim();
      th.appendChild(dot);
      th.appendChild(document.createTextNode(playerName(p)));
      htr.appendChild(th);
    }
    statsHeadEl.appendChild(htr);

    // One row per metric, then a board-level "Neutral left" progress figure.
    statsBodyEl.textContent = '';
    for (var r = 0; r < STAT_ROWS.length; r++) {
      var row = STAT_ROWS[r];
      var tr = document.createElement('tr');
      var rh = document.createElement('th');
      rh.setAttribute('scope', 'row');
      rh.textContent = row.label;
      tr.appendChild(rh);
      for (var q = 1; q <= st.players; q++) {
        var td = document.createElement('td');
        td.textContent = row.fmt(st[row.key][q]);
        tr.appendChild(td);
      }
      statsBodyEl.appendChild(tr);
    }
    var ntr = document.createElement('tr');
    var nh = document.createElement('th');
    nh.setAttribute('scope', 'row');
    nh.textContent = 'Neutral left';
    ntr.appendChild(nh);
    var ntd = document.createElement('td');
    ntd.setAttribute('colspan', String(st.players));
    ntd.textContent = String(st.neutral);
    ntr.appendChild(ntd);
    statsBodyEl.appendChild(ntr);
  }

  function render() {
    // Compute the shadow preview for the next generation (step mode only).
    var shadow = stepping.active ? nextStepShadow() : null;

    for (var i = 0; i < state.cells.length; i++) {
      var cell = state.cells[i];
      var el = cellEls[i];
      el.classList.remove('p1', 'p2', 'p3', 'p4', 'playable',
                          'shadow-next', 'shadow-p1', 'shadow-p2');
      if (cell.owner !== G.EMPTY) el.classList.add('p' + cell.owner);
      // Mark cells the current player can click (helps on touch screens).
      // Not while a manual cascade is being stepped.
      if (!stepping.active && state.winner === G.EMPTY &&
          (cell.owner === G.EMPTY || cell.owner === state.current)) {
        el.classList.add('playable');
      }
      // Shadow preview: cells the next step will change.
      if (shadow && shadow.hasOwnProperty(i)) {
        el.classList.add('shadow-next', 'shadow-p' + shadow[i]);
      }
      var cr = Math.floor(i / state.cols);
      var cc = i % state.cols;
      var cap = G.capacity(state, cr, cc);
      el.classList.remove('overloaded');
      var overloaded = cell.value > cap;
      if (overloaded) el.classList.add('overloaded');

      // Did this cell's VALUE/OWNER change since the previous render? Computed
      // BEFORE touching innerHTML so we can (a) decide the flash and (b) skip
      // the innerHTML rebuild entirely for unchanged cells.
      var prev = prevRender ? prevRender[i] : null;
      var changed = prevRender &&
        (!prev || prev.value !== cell.value || prev.owner !== cell.owner);

      // Rebuild the pip/numeral markup ONLY when the value changed (or on the
      // very first render, when prevRender is null). This is the crux of the
      // intermittent "after-flash" fix: previously EVERY render rebuilt EVERY
      // cell's innerHTML, so a cell that had just flashed got brand-new .pip
      // nodes on the next render; if its flash-dot class hadn't been stripped
      // yet (a timing race against the cleanup), the CSS animation re-ran on
      // those fresh nodes and showed a stray pulse after the cascade settled.
      // By leaving unchanged cells' DOM untouched, there are simply no new
      // nodes to re-animate — the race can't occur.
      var valueChanged = !prev || prev.value !== cell.value;
      if (valueChanged) {
        el.innerHTML = pipMarkup(cell.value, cap);
      }

      // Placement / propagation flash. A cell whose value or owner changed
      // pulses so a placed dot — and the wave of changes during a cascade — is
      // easy to spot. Two layers:
      //   - the SQUARE pulses a ring (always, on any change);
      //   - the new DOTS pulse too, EXCEPT on an overloaded cell, whose large
      //     numeral is signal enough (per the UX request, no dot-flash there).
      // Suppressed during manual step mode, where the shadow preview already
      // directs the eye and an extra flash would be noisy. Cells that did NOT
      // change get their flash state explicitly cleared, so nothing lingers.
      if (changed && !stepping.active) {
        flashCell(el, overloaded);
      } else {
        clearFlash(el);
      }
    }

    // Snapshot this render's cell values/owners for next-render change
    // detection (used by the placement/propagation flash above).
    snapshotRender();

    // Step button: visible while a manual cascade is in progress; enabled only
    // when another generation remains.
    if (stepBtn) {
      if (stepping.active) {
        stepBtn.hidden = false;
        stepBtn.disabled = !G.hasOverflow(state);
      } else {
        stepBtn.hidden = true;
      }
    }

    // Turn indicator. When the game is finished, the top-left shows the WINNER
    // (name + colour) instead of "whose turn" — this is the only textual cue
    // that identifies the winner on a restored finished board (which shows no
    // modal). During play it shows the current player as usual.
    var indicatorSeat = (state.winner !== G.EMPTY) ? state.winner : state.current;
    var color = getComputedStyle(document.documentElement)
      .getPropertyValue(playerColorVar[indicatorSeat]) || '#fff';
    turnDot.style.background = color.trim();
    turnLabel.textContent = (state.winner !== G.EMPTY)
      ? (playerName(state.winner) + ' wins')
      : playerName(state.current);
    updateTurnRegionAffordance();

    // Record the win exactly once, the moment the engine declares a winner.
    // This sits here because state.winner is set via finalizeAfterCascade in
    // every mode (instant, timed, and manual step), so a single guard covers
    // all paths. newGame() clears winRecorded for the next round.
    recordWinOnce();

    // The per-player tile counts (and richer board metrics) now live in the
    // optional Board-stats panel, rendered by renderStats() — which computes
    // nothing when the panel is disabled. The top bar keeps only the running
    // tally and the permanent New Game button.
    renderStats();
    tallyBtn.textContent = scoreLabel();

    if (state.winner !== G.EMPTY) {
      // Layer 2: the standalone New button is always shown when the game is
      // over (both live wins and restored finished games).
      endgameBar.classList.add('show');
      // Layer 3: the "X wins!" modal is shown only for a LIVE win, never when a
      // finished game is merely restored from storage (suppressWinnerModal).
      if (suppressWinnerModal) {
        if (overlay.classList.contains('show')) {
          overlay.classList.remove('show');
          winnerFocus.onClose();
        }
        // The standalone New Game is now the ONLY call-to-action on screen, so
        // promote it to the prominent blue style (via .sole-cta).
        endgameBar.classList.add('sole-cta');
      } else {
        // A live win: the modal's "Play Again" is the prominent primary action,
        // so the standalone New Game behind it stays the quiet (grey) secondary.
        endgameBar.classList.remove('sole-cta');
        winnerMsg.textContent = playerName(state.winner) + ' wins!';
        // Prominent running tally in the end-of-round dialog.
        winnerScoreEl.textContent =
          playerName(1) + '  ' + prefs.getWins(1) + ' - ' +
          prefs.getWins(2) + '  ' + playerName(2);
        if (!overlay.classList.contains('show')) {
          overlay.classList.add('show');
          if (endgameNew) {
            endgameNew.tabIndex = -1;
            endgameNew.setAttribute('aria-hidden', 'true');
          }
          winnerFocus.onOpen();
        }
      }
    } else {
      endgameBar.classList.remove('show');
      endgameBar.classList.remove('sole-cta');
      if (overlay.classList.contains('show')) {
        overlay.classList.remove('show');
        if (endgameNew) {
          endgameNew.tabIndex = 0;
          endgameNew.removeAttribute('aria-hidden');
        }
        winnerFocus.onClose();
      }
    }

    // After reflecting the current state, if it's an AI player's turn (and
    // nothing is in progress), schedule its move. This single hook covers every
    // path that ends a turn (all of them re-render), and it is a safe no-op
    // when busy/stepping/paused or when the current player is human. maybeTrig-
    // gerAI is defined later in this IIFE (hoisted) and is runtime-only here.
    maybeTriggerAI();

    // Reflect whether a Hint is available in the current state (human live turn,
    // nothing in progress). Defined later in this IIFE; runtime-only here.
    syncHintButton();
  }

  // --- turn region → Players panel -----------------------------------------
  // The top-left turn region (coloured dot + player name) is a single clickable
  // zone that opens the Players panel (where names and Human/AI type are set).
  // This replaces the old inline top-bar rename: there is no in-place editor
  // anymore — renaming (of human seats) happens in the panel, which can also
  // swap a seat to/from an AI mid-game. The panel opens ANY time (it pauses play
  // like Settings), so the region is always active during normal use.
  //
  // The resting look of the top bar is unchanged; the affordance is a square
  // OUTLINE drawn around the whole dot+name zone on hover/focus (see the
  // #turn.region-active CSS), not the former username underline.

  function canOpenPlayers() {
    // Openable whenever the Players panel isn't already the active dialog. We
    // don't gate on turn/cascade: the panel pauses play while open (like
    // Settings), and swapping a seat to/from AI mid-game is a supported use.
    return !playersOverlay.classList.contains('show');
  }

  // Reflect the region's clickability (pointer cursor + button semantics). The
  // region is active essentially always; kept as a function so a future gate
  // (e.g. hiding it in some mode) is a one-line change.
  function updateTurnRegionAffordance() {
    if (!turnRegion) return;
    if (canOpenPlayers()) {
      turnRegion.classList.add('region-active');
      turnRegion.title = 'Players — edit names and who controls each player';
      turnRegion.setAttribute('role', 'button');
      turnRegion.setAttribute('tabindex', '0');
      turnRegion.setAttribute('aria-haspopup', 'dialog');
    } else {
      turnRegion.classList.remove('region-active');
      turnRegion.removeAttribute('title');
      turnRegion.removeAttribute('role');
      turnRegion.removeAttribute('tabindex');
      turnRegion.removeAttribute('aria-haspopup');
    }
  }

  if (turnRegion) {
    turnRegion.addEventListener('click', function () {
      if (canOpenPlayers()) openPlayers();
    });
    turnRegion.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (canOpenPlayers()) openPlayers();
      }
    });
  }

  // `renaming` was the inline-editor flag; the editor is gone, but a few places
  // still read it as "is a name being edited in the top bar right now" — always
  // false now. Kept as a const so those reads stay valid without special-casing.
  var renaming = false;

  // --- input ---------------------------------------------------------------
  var busy = false; // true while a cascade animation is playing (locks input)
  var playToken = 0; // bumped by newGame() to invalidate in-flight animations
  var paused = false;          // true while the Settings dialog is open
  var resumeAnimation = null;  // callback to resume a paused animated cascade
  var animTimer = null;        // pending setTimeout id for the next generation
  var winRecorded = false;     // true once this game's win has been tallied
  // When a FINISHED game is restored from storage on boot, we show the board +
  // the standalone New button, but NOT the "X wins!" modal (per the layered
  // end-game design). This flag suppresses the modal for exactly that case; it
  // is cleared the moment a live move/new game happens so a genuine win still
  // shows the dialog.
  var suppressWinnerModal = false;

  // Persist the current board when auto-save is on. Called at every point a
  // turn is FINALISED (a move fully resolved, incl. a win) and whenever a fresh
  // board is created (New Game / Play Again) so the save always reflects the
  // latest settled position. No-op when auto-save is off (the toggle only stops
  // WRITING; any existing save is left intact and still restores next boot).
  function autoSaveIfOn() {
    if (prefs.getAutoSave()) {
      boardStore.save(G.cloneState(state));
    }
  }

  // Record this game's win EXACTLY ONCE (guarded by winRecorded). Besides the
  // tally, it rotates the persisted starting player so the NEXT game opens with
  // the player who went second this game (turn-taking alternates only after a
  // COMPLETED game — this is the single place a completion is observed). Called
  // from both finalizeTurn() (primary) and render() (safety net); the flag makes
  // the second caller a no-op. newGame() clears winRecorded for the next round.
  function recordWinOnce() {
    if (state.winner === G.EMPTY || winRecorded) return;
    winRecorded = true;
    prefs.addWin(state.winner);
    prefs.rotateStartingPlayer();
  }

  // Finalise a turn (set winner or advance player) AND persist the now-settled
  // board. Used in place of a bare G.finalizeAfterCascade(state) at every site
  // where a move resolves (instant / timed / manual step, and the mid-cascade
  // mode switches), so auto-save fires exactly once per completed turn.
  // When a turn produces a winner, the win tally is recorded immediately so
  // both the terminal board and the updated score are persisted together.
  function finalizeTurn() {
    G.finalizeAfterCascade(state);
    recordWinOnce();
    autoSaveIfOn();
  }

  function onCellClick(e) {
    if (busy || state.winner !== G.EMPTY) return;
    var r = parseInt(this.dataset.r, 10);
    var c = parseInt(this.dataset.c, 10);
    if (!G.canPlay(state, state.current, r, c)) return;

    // A move supersedes any pending/visible hint for the previous position.
    cancelPendingHint();

    // Small tactile feedback.
    this.classList.add('bump');
    var self = this;
    setTimeout(function () { self.classList.remove('bump'); }, 90);

    // Step mode: place the dot, then let the player advance the cascade one
    // generation at a time with the > button (with a shadow preview).
    if (settings.stepMode) {
      startStepMode(r, c);
      return;
    }

    playMoveAnimated(r, c, settings.delayMs);
  }

  // --- manual step mode ("> Step" slider endpoint) -------------------------
  // stepping.active is true while a placed move is being resolved by hand.
  // While active: input on the board is locked, the > button is shown, and the
  // next generation is previewed as a shadow on the cells it will change.
  var stepping = { active: false };

  // A cascade is "settled" when the board is stable OR one player physically
  // owns every cell. The sole-owner check is essential: a fully one-colour
  // board can remain perpetually over capacity, so hasOverflow alone would
  // never become false (the infinite-loop bug). This is independent of the
  // win-declaration turn-gate — resolution must stop even if the game isn't
  // formally "won" yet (e.g. an opponent hasn't moved).
  function cascadeSettled() {
    return G.soleOwner(state) !== G.EMPTY || !G.hasOverflow(state);
  }

  function startStepMode(r, c) {
    if (!G.placeDot(state, state.current, r, c)) return;
    if (cascadeSettled()) {
      // No propagation (or instantly decided): behave like a normal placement.
      finalizeTurn();
      render();
      return;
    }
    stepping.active = true;
    busy = true; // lock board input; only the > button advances now
    render();    // shows the placement + first shadow preview + active > button
  }

  function commitOneStep() {
    if (!stepping.active) return;
    G.stepOverflowsOnce(state);
    if (cascadeSettled()) {
      // Cascade finished (stable) or the game is decided — stop here.
      finalizeTurn();
      stepping.active = false;
      busy = false;
    }
    render();
  }

  /**
   * Indices that the NEXT generation will change, with the incoming owner.
   * Computed by cloning the state and stepping once, then diffing. Used to
   * draw the shadow preview. Returns { idx: owner, ... } or null if none.
   */
  function nextStepShadow() {
    if (cascadeSettled()) return null; // decided or stable: no next step
    var clone = G.cloneState(state);
    G.stepOverflowsOnce(clone);
    var changed = {};
    for (var i = 0; i < state.cells.length; i++) {
      if (clone.cells[i].value !== state.cells[i].value ||
          clone.cells[i].owner !== state.cells[i].owner) {
        changed[i] = clone.cells[i].owner;
      }
    }
    return changed;
  }

  /**
   * Place a dot and play out any cascade one generation at a time, pausing
   * `delayMs` between generations so the spread is visible. Input is locked
   * (busy) until the cascade fully resolves and the turn is finalised.
   * delayMs === 0 resolves back-to-back (effectively instant) via the same
   * code path, so behaviour is consistent across the slider range.
   */
  function playMoveAnimated(r, c, delayMs) {
    if (!G.placeDot(state, state.current, r, c)) return;

    // No propagation (or instantly decided): finalise and render the turn.
    if (cascadeSettled()) {
      finalizeTurn();
      render();
      return;
    }

    // A cascade will animate: lock input FIRST so the single render below
    // already reflects the busy state (no one-frame "still editable" flash on
    // the rename affordance), then show the placement and kick off the driver.
    busy = true;
    render();
    animToken = playToken;
    animDelayMs = delayMs;
    animSchedule(); // module-scoped so open/close can pause/resume
  }

  // Module-scoped animation driver (so the Settings dialog can pause/resume it).
  var animToken = 0;
  var animDelayMs = 0;

  function animStep() {
    animTimer = null;
    if (animToken !== playToken) return; // new game cancelled this animation
    if (!cascadeSettled()) {
      G.stepOverflowsOnce(state);
      if (!cascadeSettled()) {
        // More generations to come: render THIS step (flashing its changes) and
        // schedule the next.
        render();
        animSchedule();
        return;
      }
      // This step SETTLED the cascade. Do NOT render here: fall through to the
      // single post-finalize render below. Rendering twice in the same tick
      // (once here, once after finalize) would make the second render see "no
      // change vs the just-taken snapshot" and clear this final step's flash —
      // a spurious loss of the last pulse. One render keeps the last step's
      // flash intact AND reflects the finalized turn.
    }
    // Cascade complete or one player owns the whole board.
    finalizeTurn();
    busy = false;      // clear BEFORE the final render so the rename affordance
    render();          // (role/tabindex) is restored for keyboard users
  }

  function animSchedule() {
    if (animToken !== playToken) return;
    if (paused) {
      // Settings dialog open: park until closeSettings() resumes us.
      resumeAnimation = animSchedule;
      return;
    }
    if (animDelayMs > 0) animTimer = setTimeout(animStep, animDelayMs);
    else animStep(); // 0 ms: resolve immediately, no visible pause
  }

  // --- AI players ----------------------------------------------------------
  // A player can be controlled by an agent (Random / Tutor). On that player's
  // turn the UI asks the agent for a move and plays it through the SAME path a
  // human click uses (startStepMode / playMoveAnimated), so cascades animate at
  // the chosen propagation speed and all the existing bookkeeping applies.
  //
  // maybeTriggerAI() is scheduled (deferred) after every finalised turn, after
  // New Game, and after boot-restore. It is heavily gated so it never fires
  // mid-cascade, while the Settings dialog is paused, or out of turn — and it
  // chains naturally for AI-vs-AI (each AI move finalises, which schedules the
  // next). `aiTimer` + `playToken` let New Game cancel a pending AI move.
  var aiAgents = {};        // cache: type -> agent instance
  var aiTimer = null;       // pending "AI is about to move" timeout
  var AI_THINK_MS = 350;    // small pause so AI (esp. AI-vs-AI) is watchable
  // User-driven pause of an AI-vs-AI match, toggled by the bottom-right control
  // (which shares the Hint button's slot — see syncHintButton / the aipause
  // handlers). When true, maybeTriggerAI() declines to schedule the next AI
  // move. It does NOT freeze an in-progress cascade (that runs to completion
  // via the animation driver); the hold applies to the move AFTER it. Distinct
  // from `paused` (the Settings dialog freeze), whose semantics must not change.
  //
  // LIMITATION (documented, by design for now): an AI's move computation
  // (agent.chooseMove) is SYNCHRONOUS on the main thread, so a Pause press can
  // only take effect BETWEEN moves — it cannot interrupt a move that is already
  // mid-search. On fast agents this is invisible; on a slow (red-table) Shark
  // move on a big board, Pause lands once the current think returns. True mid-
  // think interruption would require moving the search into a Web Worker — the
  // intended future step this control is already shaped for.
  var aiPaused = false;

  // Resolve the agent instance for a seat. `seat` is the player number (1/2),
  // needed because Shark difficulty (depth) is now PER SEAT: when both players
  // are Shark they can run at different difficulties. The cache is keyed by
  // seat+depth for sharks so each seat's difficulty gets its own instance and
  // changing one doesn't rebuild the other.
  function agentFor(type, seat) {
    if (type !== 'random' && type !== 'tutor' && type !== 'shark') return null;
    if (!AGENTS) return null;
    if (type === 'shark') {
      // makeShark may be absent in an older cached agents.js — guard it.
      if (!AGENTS.makeShark) return null;
      var depth = prefs.getSharkDepth(seat);
      var key = 'shark@' + seat + '@' + depth;
      if (!aiAgents[key]) aiAgents[key] = AGENTS.makeShark(G, { depth: depth });
      return aiAgents[key];
    }
    if (type === 'tutor') {
      // Per-seat Tutor difficulty (easy / medium), keyed by seat+level so
      // changing one seat's level never disturbs the other. `level` is passed
      // to makeTutor; an older cached agents.js ignores it (plays easy).
      var level = prefs.getTutorLevel(seat);
      var tkey = 'tutor@' + seat + '@' + level;
      if (!aiAgents[tkey]) aiAgents[tkey] = AGENTS.makeTutor(G, { level: level });
      return aiAgents[tkey];
    }
    if (type === 'random') {
      // Per-seat Random difficulty (easy / medium), keyed by seat+level.
      var rlevel = prefs.getRandomLevel(seat);
      var rkey = 'random@' + seat + '@' + rlevel;
      if (!aiAgents[rkey]) aiAgents[rkey] = AGENTS.makeRandom(G, { level: rlevel });
      return aiAgents[rkey];
    }
    if (!aiAgents[type]) {
      aiAgents[type] = AGENTS.makeRandom(G);
    }
    return aiAgents[type];
  }

  // Is the player currently to move an AI? (false if agents module absent.)
  function isAITurn() {
    if (state.winner !== G.EMPTY) return false;
    return agentFor(prefs.getPlayerType(state.current), state.current) !== null;
  }

  function cancelPendingAI() {
    if (aiTimer !== null) { clearTimeout(aiTimer); aiTimer = null; }
  }

  // If it's an AI's turn and nothing is in progress, schedule the AI's move.
  function maybeTriggerAI() {
    cancelPendingAI();
    // aiPaused: the user pressed Pause on the AI-vs-AI control. We decline to
    // schedule the NEXT move (an in-progress cascade is NOT frozen — it runs to
    // completion via the animation driver; only the move AFTER it is held).
    if (busy || stepping.active || paused || aiPaused) return; // let the current action finish
    if (!isAITurn()) return;
    var tokenAtSchedule = playToken;
    // Pace between AI moves. A move that cascades already animates at the chosen
    // propagation delay, but a move with NO cascade (a plain placement) has no
    // such pause — so an AI-vs-AI match of mostly-non-cascading moves would race
    // by with only the small think-time between turns, making the delay slider
    // feel like it does nothing. Honour the slider by waiting at least the
    // chosen propagation delay before the next AI move (bounded below by the
    // base think-time so even "Instant" stays watchable). In manual > Step mode
    // (delayMs === null) there is no timed pacing, so use the base think-time.
    var pace = AI_THINK_MS;
    if (!settings.stepMode && typeof settings.delayMs === 'number') {
      pace = Math.max(AI_THINK_MS, settings.delayMs);
    }
    aiTimer = setTimeout(function () {
      aiTimer = null;
      if (playToken !== tokenAtSchedule) return; // New Game cancelled us
      if (busy || stepping.active || paused || aiPaused || !isAITurn()) return;
      var agent = agentFor(prefs.getPlayerType(state.current), state.current);
      if (!agent) return;
      var mv = agent.chooseMove(state);
      if (!mv) return; // no legal move (shouldn't happen before a winner)
      if (settings.stepMode) startStepMode(mv.r, mv.c);
      else playMoveAnimated(mv.r, mv.c, settings.delayMs);
    }, pace);
  }

  // --- hint ----------------------------------------------------------------
  // The bottom-right Hint button flashes the strongest move for the player to
  // move, computed by the strongest machine player (the Shark search agent at
  // its deepest difficulty) via the engine-side AGENTS.bestMove helper — the
  // same "best move" entry point intended for future AI-move computation on
  // variable board sizes. The hint never alters game state; it only highlights
  // a cell. It is purely advisory, so it stays available for whatever delay/
  // player settings are in effect, gated only by "is a hint meaningful now".
  //
  // Appearance / "light up": the button rests DIM (a quiet grey outline bulb)
  // and is clickable the whole time. It only visually LIGHTS UP (warm, glowing)
  // after the player has been idle — not moved — for the configured delay, so
  // we nudge them toward Help / their own thinking first and offer the hint
  // only when it might actually help. The delay is a persisted preference
  // (prefs.hintLightDelay) set from a Settings slider:
  //   0  -> always on (light the moment a hint becomes available)
  //  -1  -> never (stay dim; the button still works if clicked)
  //  ms  -> idle delay (5000..30000 in the slider) before lighting.
  // The idle timer is (re)armed whenever the hint becomes available or the turn
  // changes, and cancelled on a move / New Game / dialog, so "idle" means "this
  // turn, untouched".
  //
  // Thinking indicator: the Shark search is synchronous and can briefly block
  // the main thread. We show a spinner only if the computation is still running
  // after HINT_THINK_MS, so a fast board (the current 5x5 resolves in well under
  // that) never flickers a spinner, while a slow/large future board surfaces one
  // automatically. To let the spinner actually paint before the blocking search
  // runs, the compute is deferred one frame behind the "thinking" class.
  var HINT_THINK_MS = 400;  // show the spinner only if a hint takes this long
  var hintBusy = false;     // true while a hint is being computed/flashed
  var hintThinkTimer = null;
  var hintToken = 0;        // bumped to cancel an in-flight hint (New Game/move)
  var hintLightTimer = null; // pending idle "light up" timer
  var hintWasVisible = false; // was the button shown on the previous sync?
  var lastHintedEl = null;    // the cell currently showing a hint flash (if any)

  // Is a hint meaningful right now? Only on a HUMAN player's live turn, with the
  // agents module present (so a strongest move can be computed), and with no
  // cascade/step/dialog in progress. Mirrors the gates used elsewhere so the
  // button never offers a hint the UI can't currently act on.
  function hintAvailable() {
    if (!AGENTS || !AGENTS.bestMove) return false;
    if (state.winner !== G.EMPTY) return false;
    if (busy || stepping.active || paused || renaming) return false;
    if (hintBusy) return false;
    return prefs.getPlayerType(state.current) === 'human';
  }

  // Cancel any pending idle light-up timer and (optionally) extinguish the bulb.
  function cancelHintLight(extinguish) {
    if (hintLightTimer !== null) { clearTimeout(hintLightTimer); hintLightTimer = null; }
    if (extinguish && hintBtn) {
      hintBtn.classList.remove('lit', 'just-lit');
    }
  }

  // Turn the bulb on now (lit), with a one-shot pulse that is cleaned up so it
  // doesn't re-run on later renders.
  function lightHintBulb() {
    if (!hintBtn) return;
    if (hintBtn.classList.contains('lit')) return; // already on
    hintBtn.classList.add('lit', 'just-lit');
    window.setTimeout(function () {
      if (hintBtn) hintBtn.classList.remove('just-lit');
    }, 650);
  }

  // (Re)arm the idle light-up according to the saved delay preference:
  //   -1 -> never: leave dim, no timer.
  //    0 -> always on: light immediately.
  //   ms -> light after `ms` of continued idleness (no move / turn change).
  // Called from syncHintButton when the button is (or becomes) available.
  function armHintLight() {
    cancelHintLight(true); // start from dim; clear any stale timer
    var delay = prefs.getHintLightDelay();
    if (delay === -1) return;         // never auto-light
    if (delay === 0) { lightHintBulb(); return; } // always on
    hintLightTimer = window.setTimeout(function () {
      hintLightTimer = null;
      // Re-check availability at fire time: the turn may have changed while we
      // waited (a move resets this anyway, but be defensive).
      if (hintAvailable()) lightHintBulb();
    }, delay);
  }

  // Show/hide the Hint button to match the current state, and manage the idle
  // light-up. Called from render(). While a hint is computing we keep the
  // button visible-but-disabled (the thinking state owns its appearance), so a
  // mid-compute render doesn't hide the spinner out from under the user.
  function syncHintButton() {
    if (!hintBtn) return;
    // The Hint bulb and the AI-vs-AI pause/play control SHARE the bottom-right
    // corner slot. They are mutually exclusive: whenever we finish deciding the
    // bulb's visibility we (re)decide the pause control's, so exactly one (or
    // neither, at game over) occupies the slot. syncAiPauseButton() is the
    // single place that shows/hides + updates the pause control.
    if (hintBusy) { hintBtn.hidden = false; syncAiPauseButton(); return; }

    var available = hintAvailable();
    hintBtn.hidden = !available;
    hintBtn.disabled = false;

    if (!available) {
      // Not applicable now: cancel the timer and reset to dim for next time.
      cancelHintLight(true);
      hintBtn.classList.remove('appearing');
      hintWasVisible = false;
      syncAiPauseButton();
      return;
    }

    // Available. If it JUST became visible (turn start / new availability),
    // play the gentle appear animation and (re)arm the idle light-up from
    // scratch. render() runs on every turn change and move resolution, so this
    // naturally restarts the idle clock each turn — "idle" = untouched turn.
    if (!hintWasVisible) {
      hintBtn.classList.remove('appearing');
      void hintBtn.offsetWidth; // restart the appear animation
      hintBtn.classList.add('appearing');
    }
    hintWasVisible = true;
    armHintLight();
    syncAiPauseButton();
  }

  // --- AI-vs-AI pause/play control -----------------------------------------
  // Is the given seat's AI a "slow thinker" on the CURRENT board size — i.e.
  // over the user's calibration max-wait threshold? Uses the SAME shared cost
  // model (js/calibrate.js) as the Board-size table, so "slow" means exactly
  // "would be red in that table". Returns false if calibration is unavailable
  // or the seat is not a Shark (Random/Tutor are near-instant at every size).
  function isSlowAiSeat(seat) {
    if (!CALIB || typeof CALIB.estimateMs !== 'function') return false;
    var type = prefs.getPlayerType(seat);
    if (type !== 'shark') return false; // only Shark climbs into the red
    var depth = prefs.getSharkDepth(seat); // 2/3/4 => Easy/Medium/Hard
    // Build the matching calibrate row for a Shark at this depth.
    var row = { agent: 'Shark', difficulty: 'x', depth: depth };
    var samples = prefs.getCalibration() || {};
    var ms = CALIB.estimateMs(row, COLS, samples); // COLS === ROWS (square board)
    return CALIB.isOverThreshold(ms, prefs.getCalibMaxWaitMs());
  }

  // True when BOTH seats are AI (an AI-vs-AI match) and the game is ongoing —
  // the only situation the pause/play control applies to.
  function isAIvsAIMatch() {
    if (!AGENTS || state.winner !== G.EMPTY) return false;
    return agentFor(prefs.getPlayerType(1), 1) !== null &&
           agentFor(prefs.getPlayerType(2), 2) !== null;
  }

  // Show/hide + update the pause/play control. Called from syncHintButton (so
  // the slot is decided in one place). The control is shown ONLY during an
  // ongoing AI-vs-AI match (when the Hint bulb is hidden anyway); hidden on a
  // human turn (bulb takes the slot) and at game over (slot empty).
  var aiPauseWasVisible = false;
  function syncAiPauseButton() {
    if (!aiPauseBtn) return;
    var show = isAIvsAIMatch();
    aiPauseBtn.hidden = !show;
    if (!show) {
      aiPauseBtn.classList.remove('appearing', 'thinking', 'is-playing', 'pausing');
      aiPauseWasVisible = false;
      return;
    }

    // Three visual states so the press is ALWAYS acknowledged as soon as the
    // main thread is free to repaint:
    //   running  (!aiPaused)            -> Pause glyph (⏸), "Pause…"
    //   pausing  (aiPaused && busy)     -> Play glyph (▶) + .pausing cue; the
    //                                      press registered, but a move/cascade
    //                                      is still finishing before the hold
    //                                      takes full effect
    //   held     (aiPaused && !busy)    -> Play glyph (▶), resume on click
    // The Play glyph shows for BOTH paused sub-states (pausing/held) so the
    // instant the thread frees after a blocking search the user sees ▶, not a
    // stale ⏸. The .pausing class adds a distinct "not settled yet" look.
    var paused2 = aiPaused;              // either pausing or held
    var pausing = aiPaused && busy;      // acknowledged, still finishing
    var held = aiPaused && !busy;        // fully held, ready to resume
    aiPauseBtn.classList.toggle('is-playing', paused2);
    aiPauseBtn.classList.toggle('pausing', pausing);
    aiPauseBtn.title = held ? 'Play: resume the AI match'
                     : pausing ? 'Pausing after this move…'
                     : 'Pause: hold the next AI move';
    aiPauseBtn.setAttribute('aria-label', held
      ? 'Resume the AI match'
      : pausing ? 'Pausing the AI match after the current move'
      : 'Pause the AI match (hold the next move)');

    // Subtle "thinking" pulse only for a slow (red-table) current mover that is
    // actively computing/animating — so a long think on a big board doesn't
    // look frozen. Never while paused (the pausing/held cue owns the look then).
    var thinking = !paused2 && busy && isSlowAiSeat(state.current);
    aiPauseBtn.classList.toggle('thinking', thinking);

    if (!aiPauseWasVisible) {
      aiPauseBtn.classList.remove('appearing');
      void aiPauseBtn.offsetWidth; // restart appear animation
      aiPauseBtn.classList.add('appearing');
    }
    aiPauseWasVisible = true;
  }

  // Flash the suggested cell a few times (the CSS .hint-flash runs the pulse
  // for a fixed number of cycles). Reuses the same restart-the-animation trick
  // as the placement flash so repeated hints on the same cell re-trigger.
  var HINT_FLASH_MS = 480 * 3 + 120; // 3 cycles of the 480ms keyframe + margin

  function clearHintFlash(el) {
    if (!el) return;
    if (el._hintTimer) { clearTimeout(el._hintTimer); el._hintTimer = null; }
    if (el._hintEnd) {
      el.removeEventListener('animationend', el._hintEnd);
      el._hintEnd = null;
    }
    el.classList.remove('hint-flash');
    if (lastHintedEl === el) lastHintedEl = null;
  }

  function flashHint(el) {
    if (!el) return;
    clearHintFlash(el);
    void el.offsetWidth; // reflow so re-adding restarts the animation
    el.classList.add('hint-flash');
    lastHintedEl = el;   // remember so cancellation (move/New Game) can clear it
    var finish = function () { clearHintFlash(el); };
    el._hintEnd = finish;
    el.addEventListener('animationend', finish);
    // Fallback timer (reduced-motion disables the animation, so animationend
    // never fires): clear the steady highlight after the same window.
    el._hintTimer = window.setTimeout(finish, HINT_FLASH_MS);
  }

  // Announce the suggested cell to screen readers via the polite live region.
  // The flash is purely visual, so without this a screen-reader user could
  // activate the Hint button but never learn which cell it suggested. Uses
  // 1-based row/column so it reads naturally ("row 1, column 1" is the top-left
  // corner). Re-set to '' first so an identical repeat hint still re-announces.
  function announceHint(r, c) {
    if (!hintLive) return;
    hintLive.textContent = '';
    hintLive.textContent =
      'Hint: play row ' + (r + 1) + ', column ' + (c + 1) + '.';
  }
  function announceHintNone() {
    if (!hintLive) return;
    hintLive.textContent = '';
    hintLive.textContent = 'No hint available.';
  }

  function cancelPendingHint() {
    hintToken++;                 // invalidate any in-flight compute
    if (hintThinkTimer !== null) { clearTimeout(hintThinkTimer); hintThinkTimer = null; }
    if (hintBtn) hintBtn.classList.remove('thinking');
    hintBusy = false;
    // A move / New Game / dialog supersedes any VISIBLE suggestion: clear the
    // flash (and its fallback timer) off the previously hinted cell so a gold
    // ring can't keep pulsing over a board that has already changed.
    if (lastHintedEl) clearHintFlash(lastHintedEl);
    if (hintLive) hintLive.textContent = ''; // drop any stale SR announcement
    // ...and end this turn's idleness: stop the idle timer and extinguish the
    // bulb so the next turn starts dim and the clock restarts.
    cancelHintLight(true);
    hintWasVisible = false;
  }

  function requestHint() {
    if (!hintAvailable()) return;
    hintBusy = true;
    var token = ++hintToken;
    if (hintBtn) hintBtn.disabled = true;
    // The user explicitly asked: light the bulb now (if not already) and stop
    // the idle timer — the hint is self-evidently wanted at this point.
    cancelHintLight(false);
    lightHintBulb();

    // Arm the spinner: only paints if the compute below hasn't finished within
    // HINT_THINK_MS (fast boards never show it).
    hintThinkTimer = window.setTimeout(function () {
      hintThinkTimer = null;
      if (token === hintToken && hintBtn) hintBtn.classList.add('thinking');
    }, HINT_THINK_MS);

    // Defer the (synchronous, possibly slow) search so the "thinking" class —
    // if armed — can paint first, and the click handler returns promptly.
    window.setTimeout(function () {
      if (token !== hintToken) return; // cancelled (New Game / move happened)
      var mv = null;
      try {
        mv = AGENTS.bestMove(G, state);
      } catch (e) {
        mv = null; // never let a hint failure break the game
      }
      if (token !== hintToken) return; // cancelled while computing
      // Tear down the thinking state regardless of outcome.
      if (hintThinkTimer !== null) { clearTimeout(hintThinkTimer); hintThinkTimer = null; }
      if (hintBtn) hintBtn.classList.remove('thinking');
      hintBusy = false;
      if (mv) {
        var el = cellEls[mv.r * state.cols + mv.c];
        flashHint(el);
        announceHint(mv.r, mv.c);
      } else {
        announceHintNone();
      }
      // Re-evaluate the button (it may have become unavailable, e.g. the turn
      // changed — though a hint doesn't consume a turn, so normally it stays).
      syncHintButton();
    }, 0);
  }

  if (hintBtn) {
    hintBtn.addEventListener('click', requestHint);
  }

  // Pause/play the AI-vs-AI match. One button, two actions depending on state:
  //  - currently running (not held) -> PAUSE: set aiPaused and cancel any
  //    pending next-move timer. A cascade in progress is left to finish; only
  //    the move after it is held. (Sync cannot interrupt a mid-search move —
  //    see the aiPaused declaration note.)
  //  - held (aiPaused && !busy, showing Play) -> PLAY: clear aiPaused and ask
  //    maybeTriggerAI() to schedule the next move again.
  // The toggle is driven by the aiPaused INTENT (not the busy sub-state), so
  // pressing the control while it is still "pausing" (▶ shown, cascade/move
  // finishing) cancels the pause and resumes — a clean on/off toggle. We call
  // syncAiPauseButton() synchronously FIRST so the glyph flips the instant the
  // handler runs (important responsiveness: the heavier render() may do more
  // work), then render() to reflect any scheduling/finalisation.
  if (aiPauseBtn) {
    aiPauseBtn.addEventListener('click', function () {
      if (!isAIvsAIMatch()) return; // defensive: button shouldn't be visible
      if (aiPaused) {
        // Resume (from either the held or the still-pausing sub-state).
        aiPaused = false;
        if (aiPauseLive) aiPauseLive.textContent = 'AI match resumed';
        syncAiPauseButton();
        maybeTriggerAI();
      } else {
        aiPaused = true;
        cancelPendingAI(); // drop any scheduled-but-unfired next move so, in
                           // the between-moves window, the next search never
                           // even starts (immediate effect + immediate glyph).
        if (aiPauseLive) {
          aiPauseLive.textContent = busy
            ? 'Pausing after this move'  // a move/cascade is still finishing
            : 'AI match paused';          // held right away (between moves)
        }
        syncAiPauseButton(); // flip the glyph now, before the heavier render()
      }
      render();
    });
  }

  // --- new game ------------------------------------------------------------
  function newGame() {
    playToken++;   // invalidate any in-flight cascade animation
    aiPaused = false;        // a fresh match is not paused
    if (animTimer !== null) { clearTimeout(animTimer); animTimer = null; }
    resumeAnimation = null; // drop any parked (paused) animation
    cancelPendingHint();     // drop any in-flight/visible hint for the old board
    busy = false;  // unlock input
    stepping.active = false; // cancel any manual step-through in progress
    winRecorded = false;     // the next game's win hasn't been tallied yet
    suppressWinnerModal = false; // a live win in the new game shows its dialog
    var wasWinnerOpen = overlay && overlay.classList.contains('show');
    var fromEndgame = document.activeElement === endgameNew ||
                      (endgameBar && endgameBar.contains(document.activeElement));
    if (wasWinnerOpen) {
      overlay.classList.remove('show');
      if (endgameNew) {
        endgameNew.tabIndex = 0;
        endgameNew.removeAttribute('aria-hidden');
      }
    }
    // Open the new board with the persisted starting player. After a COMPLETED
    // game, recordWinOnce() has already rotated this to the player who went
    // second, so the opponent now opens. A New Game started mid-play (no winner)
    // leaves startingPlayer unchanged, so the same player opens as last time.
    //
    // The board SIZE is also taken from prefs here (set in the Board-size
    // panel), so a size change applies on the next New Game — never mid-game.
    // commitBoardSize() promotes the pending (slider) choice to the ACTIVE
    // size; a mere slider change without New Game leaves the active size (and
    // thus the restorable save) untouched. Update ROWS/COLS so dimension-
    // dependent helpers (fitsDimensions, rendering) agree with the live board.
    var chosen = prefs.commitBoardSize();
    ROWS = chosen;
    COLS = chosen;
    state = G.createGame({
      rows: ROWS, cols: COLS, players: PLAYERS,
      startingPlayer: prefs.getStartingPlayer(),
    });
    buildGrid();
    sizeBoard();
    render();
    // Overwrite any saved game with this fresh board (when auto-save is on), so
    // the previous (possibly finished) game is not resurrected on next reload.
    autoSaveIfOn();
    if (wasWinnerOpen && winnerFocus) {
      winnerFocus.onClose();
    } else if (fromEndgame) {
      // The standalone endgame button is now hidden by render(); move focus to
      // the first board cell so keyboard focus is not stranded on the hidden
      // endgame button (focusing the board is a natural place to start the new
      // game; the permanent top-bar New Game button remains available too).
      if (cellEls && cellEls[0] && cellEls[0].focus) {
        cellEls[0].focus();
      }
    }
  }

  document.getElementById('play-again').addEventListener('click', newGame);
  endgameNew.addEventListener('click', newGame);
  stepBtn.addEventListener('click', commitOneStep);

  // --- new game (permanent top-bar button) ---------------------------------
  // A dedicated, always-present New Game button. It asks for confirmation first
  // so a stray tap doesn't abandon a game mid-play. (It replaces the former
  // tile-count readout, which doubled as New Game; the counts now live in the
  // Board-stats panel.) The end-game bar still provides its own New Game button
  // once a game is over.
  if (newGameBtn) {
    newGameBtn.addEventListener('click', function () {
      confirmDialog('Start a new game? The current board will be cleared.',
        newGame);
    });
  }

  // --- win tally reset (click the tally pill) ------------------------------
  // The win tally is its own pushable control. Resetting it is now a deliberate,
  // separate action from renaming a player (rename is purely cosmetic). Clicking
  // asks for confirmation first, since the series score is otherwise sticky
  // across rounds. On confirm, the tally goes to 0:0, stamped with the current
  // pair of names.
  if (tallyBtn) {
    tallyBtn.addEventListener('click', function () {
      var msg = 'Reset the win tally to 0 : 0 for ' +
        playerName(1) + ' and ' + playerName(2) + '?';
      // Offer to also reset who opens the next game back to Player 1 (checked by
      // default — a fresh series conventionally starts with Player 1). Unchecking
      // keeps the current turn-taking alternation.
      confirmDialog(msg, function (alsoResetStarter) {
        prefs.resetScore(playerName(1), playerName(2), alsoResetStarter);
        render();
      }, {
        checkbox: {
          label: 'Also reset who starts first (back to ' + playerName(1) + ')',
          checked: true,
        },
      });
    });
  }

  // --- settings ------------------------------------------------------------
  // Increment 1: menu shell + propagation-speed slider. The value is stored in
  // `settings` but not yet wired to cascade playback (that arrives in later
  // increments). Slider index maps: 0..10 -> 0..1000 ms (100 ms steps);
  // index 11 -> STEP mode (manual, advance each cascade step with a button).
  var STEP_INDEX = 11;
  var settings = {
    // delayMs: null means STEP mode; otherwise 0..1000 (ms between cascade steps)
    delayMs: 500, // default: a readable middle speed (matches slider index 5)
    stepMode: false,
  };

  var settingsOverlay = document.getElementById('settings-overlay');
  var settingsCard = document.getElementById('settings-card');
  var settingsBtn = document.getElementById('settings-btn');
  var settingsClose = document.getElementById('settings-close');
  var delayRange = document.getElementById('delay-range');
  var delayValue = document.getElementById('delay-value');

  var settingsFocus = null; // focus manager, created after helper is defined

  function sliderIndexToSetting(index) {
    if (index >= STEP_INDEX) {
      settings.stepMode = true;
      settings.delayMs = null;
    } else {
      settings.stepMode = false;
      settings.delayMs = index * 100; // 0,100,...,1000
    }
  }

  function delayLabel() {
    if (settings.stepMode) return '\u203A Step';   // '›'
    if (settings.delayMs === 0) return 'Instant';
    return settings.delayMs + ' ms';
  }

  function updateDelayReadout() {
    delayValue.textContent = delayLabel();
  }

  settingsFocus = makeDialogFocusManager(settingsOverlay, settingsCard, 'settings-close');

  function openSettings() {
    // Pause any in-flight animated cascade so it doesn't resolve in the
    // background while the dialog is open.
    paused = true;
    if (animTimer !== null) {
      // A generation was waiting on the timer: cancel it and arrange to resume
      // the same driver when the dialog closes.
      clearTimeout(animTimer);
      animTimer = null;
      if (busy) resumeAnimation = animSchedule;
    }
    settingsOverlay.classList.add('show');
    syncPersistenceUI(); // save-state may have changed since last opened
    syncStatsPanelUI();  // reflect the stored stats-panel toggle
    syncHintDelayUI();   // reflect the stored hint light-up delay
    updateBoardsizeReadout(); // refresh the "Board size" summary value
    cancelPendingHint(); // a hint can't apply while the dialog pauses play
    syncHintButton();    // hide the Hint button while Settings is open (paused)
    settingsFocus.onOpen();
  }
  function closeSettings() {
    settingsOverlay.classList.remove('show');
    settingsFocus.onClose();
    paused = false;
    syncHintButton();    // restore the Hint button now that play resumes
    // Resume a paused animated cascade, if one was in progress.
    if (resumeAnimation) {
      var fn = resumeAnimation;
      resumeAnimation = null;
      fn();
    } else {
      // Nothing mid-cascade: if it's an AI's turn (e.g. the player just set a
      // seat to AI, or closed Settings on an AI turn), get it moving now that
      // we're unpaused.
      maybeTriggerAI();
    }
  }

  settingsBtn.addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);
  // Click on the dimmed backdrop (outside the card) closes the menu.
  settingsOverlay.addEventListener('click', function (e) {
    if (e.target === settingsOverlay) closeSettings();
  });
  // Escape closes it (desktop convenience).
  document.addEventListener('keydown', function (e) {
    // Ignore Escape while the reset dialog (layered above Settings) is open —
    // that dialog's own handler dismisses the topmost layer first, so Settings
    // must not also close underneath it and strand focus restoration.
    if (e.key === 'Escape' && settingsOverlay.classList.contains('show') &&
        !(resetOverlay && resetOverlay.classList.contains('show'))) {
      closeSettings();
    }
  });

  delayRange.addEventListener('input', function () {
    var wasStepping = stepping.active;
    sliderIndexToSetting(parseInt(this.value, 10));
    updateDelayReadout();
    // If the player leaves step mode while a manual cascade is mid-resolution,
    // hand the in-progress cascade to the ANIMATED driver at the newly chosen
    // speed — do NOT resolve it instantly (that caused a background "instant
    // win"). Because the Settings dialog is open, `paused` is true, so the
    // driver parks itself and only runs once the dialog is closed.
    if (wasStepping && !settings.stepMode) {
      stepping.active = false; // no longer manual stepping
      if (cascadeSettled()) {
        // Nothing left to resolve: just finalise.
        finalizeTurn();
        busy = false;
        render();
      } else {
        // Continue as an animated cascade at the new delay. busy stays true.
        animToken = playToken;
        animDelayMs = settings.delayMs;
        animSchedule(); // parks while paused; resumes on closeSettings()
        render();       // refresh (step button hides now that stepping ended)
      }
    } else if (!wasStepping && settings.stepMode && busy) {
      // Switched INTO step mode while an animated cascade was in progress:
      // convert it to manual stepping. Cancel the pending timer/parked resume
      // and hand control to the > button.
      if (animTimer !== null) { clearTimeout(animTimer); animTimer = null; }
      resumeAnimation = null;
      if (cascadeSettled()) {
        finalizeTurn();
        busy = false;
      } else {
        stepping.active = true; // > button now drives it
      }
      render();
    } else if (busy && !stepping.active && !settings.stepMode) {
      // Timed -> timed change while an animated cascade is in progress: apply
      // the new delay to the remaining generations. (The pending timer, if any,
      // was cancelled by openSettings; the resume via animSchedule() will use
      // this updated animDelayMs.)
      animDelayMs = settings.delayMs;
    }
  });

  // Initialise readout from the default slider position.
  sliderIndexToSetting(parseInt(delayRange.value, 10));
  updateDelayReadout();

  // --- board-stats panel toggle --------------------------------------------
  // A simple on/off switch in Settings. When toggled we persist the choice,
  // then re-render: renderStats() shows/hides the <aside> and (only when ON and
  // the board is settled) computes the metrics. Showing/hiding the panel
  // changes the board's available space, so we re-size the board too.
  var statsPanelToggle = document.getElementById('statspanel-toggle');
  function syncStatsPanelUI() {
    if (statsPanelToggle) statsPanelToggle.checked = prefs.getStatsPanel();
  }
  if (statsPanelToggle) {
    statsPanelToggle.addEventListener('change', function () {
      prefs.setStatsPanel(this.checked);
      renderStats();   // show/hide + (if enabling) compute now
      sizeBoard();     // board area changed — refit the square board
    });
  }

  // --- hint light-up delay slider ------------------------------------------
  // Maps an 8-stop slider to the persisted hintLightDelay preference:
  //   index 0        -> 0      ("Always" — light the bulb immediately)
  //   index 1..6     -> 5000..30000 ms (5 s steps)
  //   index 7        -> -1     ("Off" — never auto-light)
  // The slider is the ONLY writer of the pref; the hint light-up logic reads it
  // via prefs.getHintLightDelay() and re-arms on the next render.
  var hintDelayRange = document.getElementById('hint-delay-range');
  var hintDelayValue = document.getElementById('hint-delay-value');
  var HINT_DELAY_OFF_INDEX = 7;

  function hintSliderIndexToDelay(index) {
    if (index <= 0) return 0;                 // Always on
    if (index >= HINT_DELAY_OFF_INDEX) return -1; // Off / never
    return index * 5000;                      // 1->5s, 2->10s, ... 6->30s
  }

  function hintDelayToSliderIndex(delay) {
    if (delay === 0) return 0;
    if (delay === -1) return HINT_DELAY_OFF_INDEX;
    // Clamp a stored ms value to the nearest 5 s stop in [1..6].
    var idx = Math.round(delay / 5000);
    if (idx < 1) idx = 1;
    if (idx > 6) idx = 6;
    return idx;
  }

  function hintDelayLabel(delay) {
    if (delay === 0) return 'Always';
    if (delay === -1) return 'Off';
    return (delay / 1000) + ' s';
  }

  function updateHintDelayReadout() {
    if (hintDelayValue) {
      hintDelayValue.textContent = hintDelayLabel(prefs.getHintLightDelay());
    }
  }

  // Reflect the stored hint-delay preference in the slider + readout. Called on
  // load, when Settings opens, and after a prefs reset so the control never
  // shows a stale value.
  function syncHintDelayUI() {
    if (!hintDelayRange) return;
    hintDelayRange.value = String(hintDelayToSliderIndex(prefs.getHintLightDelay()));
    updateHintDelayReadout();
  }

  if (hintDelayRange) {
    hintDelayRange.addEventListener('input', function () {
      var delay = hintSliderIndexToDelay(parseInt(this.value, 10));
      prefs.setHintLightDelay(delay);
      updateHintDelayReadout();
      // Re-arm the bulb immediately so the change is felt without closing
      // Settings — but the dialog pauses play, so the bulb is hidden right now;
      // syncHintButton() on the next render (after close) applies the new delay.
      // Still, update the readout live for feedback.
    });
    // Reflect the stored preference in the control on load.
    hintDelayRange.value = String(hintDelayToSliderIndex(prefs.getHintLightDelay()));
    updateHintDelayReadout();
  }
  // --- Board-size & AI-timing panel ----------------------------------------
  // Opened from Settings. Lets the player pick a square board (2..12) and
  // CALIBRATE estimated AI think times on this device (via the shared,
  // DOM-free js/calibrate.js helper — the SAME model the tools/calibrate.js CLI
  // uses, so the two cannot drift). The estimate table paints cells red when
  // they exceed the user's "max acceptable wait". A size change applies on the
  // next New Game (never mid-game). The whole feature degrades gracefully if
  // either the agents module or the calibrate helper is missing.
  var boardsizeOverlay = document.getElementById('boardsize-overlay');
  var boardsizeCard = document.getElementById('boardsize-card');
  var boardsizeOpenBtn = document.getElementById('boardsize-open');
  var boardsizeCloseBtn = document.getElementById('boardsize-close');
  var boardsizeRange = document.getElementById('boardsize-range');
  var boardsizeValue = document.getElementById('boardsize-value');
  var boardsizeCurrent = document.getElementById('boardsize-current');
  var maxwaitRange = document.getElementById('maxwait-range');
  var maxwaitValue = document.getElementById('maxwait-value');
  var calibrateRunBtn = document.getElementById('calibrate-run');
  var calibrateStatus = document.getElementById('calibrate-status');
  var calibTableHead = document.getElementById('calib-table-head');
  var calibTableBody = document.getElementById('calib-table-body');

  function sizeLabel(n) { return n + ' × ' + n; }

  function fmtEstMs(ms) {
    if (!isFinite(ms)) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
  }

  // Build the position the engine finds slowest (a dense, contested mid-game
  // board) by playing deterministic legal moves to ~50% fill, mirroring the
  // bounded CLI worker so the in-browser and CLI numbers measure the same case.
  function buildWorstCasePosition(size) {
    var seed = 12345 >>> 0;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var st = G.createGame({ rows: size, cols: size, players: 2 });
    var target = Math.round(0.5 * size * size);
    for (var placed = 0; placed < target && st.winner === G.EMPTY; placed++) {
      var me = st.current, legal = [];
      for (var r = 0; r < size; r++) {
        for (var c = 0; c < size; c++) {
          if (G.canPlay(st, me, r, c)) legal.push([r, c]);
        }
      }
      if (!legal.length) break;
      var pick = legal[Math.floor(rnd() * legal.length)];
      G.applyMove(st, me, pick[0], pick[1]);
    }
    return (st.winner === G.EMPTY) ? st : null;
  }

  // Inject-able runner: time ONE worst-case Shark move at (size, depth). Returns
  // ms, or null if a position couldn't be built OR the size exceeds the browser
  // sampling ceiling. The browser runs this SYNCHRONOUSLY (no worker/timeout can
  // interrupt a running search here), so it is bounded BY CONSTRUCTION: it only
  // ever runs genuinely cheap sizes. Larger sizes are extrapolated, and the
  // tools/calibrate.js CLI (child process + hard timeout) is the place to
  // measure big boards. BROWSER_SAMPLE_MAX is the ceiling.
  var BROWSER_SAMPLE_MAX = 8; // 8x8 depth-4 is a couple of seconds even on slow devices
  function runOneInline(size, depth) {
    if (!AGENTS || !AGENTS.bestMove) return null;
    if (size > BROWSER_SAMPLE_MAX) return null; // refuse to block the tab
    var st = buildWorstCasePosition(size);
    if (!st) return null;
    var t0 = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    AGENTS.bestMove(G, st, { depth: depth });
    var t1 = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    return t1 - t0;
  }

  // Render the estimate table from the saved (or fallback) calibration samples,
  // colouring any cell over the max-wait threshold red and outlining the
  // currently-selected size column.
  function renderCalibTable() {
    if (!CALIB || !calibTableHead || !calibTableBody) return;
    var samples = prefs.getCalibration() || {};
    var sizes = CALIB.tableSizes();
    var maxWaitMs = prefs.getCalibMaxWaitMs();
    var selSize = prefs.getPendingBoardSize();

    // Header: short label column, then one compact column per size.
    // Size headers drop the spaces around "×" to save width ("10×10").
    var headHtml = '<th scope="col">AI</th>';
    sizes.forEach(function (s) {
      var cls = (s === selSize) ? ' class="sel-size"' : '';
      headHtml += '<th scope="col"' + cls + '>' + s + '\u00D7' + s + '</th>';
    });
    calibTableHead.innerHTML = headHtml;

    // Compact the row label so it fits the narrow first column without
    // truncation: "Shark — Hard" -> "Shark·Hard", abbreviating "Medium".
    function compactLabel(label) {
      return label.replace(/\s+\u2014\s+/, '\u00B7').replace('Medium', 'Med');
    }

    var table = CALIB.projectTable(samples, sizes);
    var waitLabel = (maxWaitMs < 1000) ? (maxWaitMs + ' ms') : ((maxWaitMs / 1000) + ' s');
    var bodyHtml = '';
    table.forEach(function (t) {
      bodyHtml += '<tr><th scope="row" title="' + t.row.label + '">' +
                  compactLabel(t.row.label) + '</th>';
      sizes.forEach(function (s) {
        var ms = t.cells[s];
        var over = CALIB.isOverThreshold(ms, maxWaitMs);
        var cls = [];
        if (over) cls.push('over');
        if (s === selSize) cls.push('sel-size');
        var text = fmtEstMs(ms);
        var attrs = (cls.length ? ' class="' + cls.join(' ') + '"' : '');
        if (over) {
          // Don't rely on colour alone (accessibility): a visible warning glyph
          // plus a spoken label and tooltip convey "over your max wait".
          var label = t.row.label + ' on ' + s + '\u00D7' + s + ': ~' + text +
                      ', over your ' + waitLabel + ' limit';
          attrs += ' title="over your ' + waitLabel + ' limit"' +
                   ' aria-label="' + label + '"';
          text += ' \u26A0'; // warning sign, visible regardless of colour
        }
        bodyHtml += '<td' + attrs + '>' + text + '</td>';
      });
      bodyHtml += '</tr>';
    });
    calibTableBody.innerHTML = bodyHtml;
  }

  function updateBoardsizeReadout() {
    var pending = prefs.getPendingBoardSize();
    var active = prefs.getBoardSize();
    // The panel slider readout reflects the PENDING choice being previewed.
    if (boardsizeValue) boardsizeValue.textContent = sizeLabel(pending);
    // The Settings summary shows the ACTIVE size (what's on the board now); if
    // a different size is pending, note that it applies on the next New Game.
    if (boardsizeCurrent) {
      boardsizeCurrent.textContent = (pending !== active)
        ? (sizeLabel(active) + ' (→ ' + sizeLabel(pending) + ' next game)')
        : sizeLabel(active);
    }
  }

  function updateMaxwaitReadout() {
    if (!maxwaitValue || !CALIB) return;
    var ms = prefs.getCalibMaxWaitMs();
    maxwaitValue.textContent = (ms < 1000) ? (ms + ' ms') : ((ms / 1000) + ' s');
  }

  // Reflect stored prefs in the panel controls + table. Called on open and
  // after a prefs reset so nothing shows a stale value.
  function syncBoardsizeUI() {
    if (boardsizeRange) boardsizeRange.value = String(prefs.getPendingBoardSize());
    if (maxwaitRange && CALIB) {
      maxwaitRange.value = String(CALIB.maxWaitMsToIndex(prefs.getCalibMaxWaitMs()));
    }
    updateBoardsizeReadout();
    updateMaxwaitReadout();
    // Pre-run calibration-duration hint on the button.
    if (calibrateRunBtn && CALIB && !calibrateRunBtn.disabled) {
      var est = Math.ceil(CALIB.estimateCalibrationMs() / 1000);
      calibrateRunBtn.textContent = 'Calibrate now (~' + est + ' s)';
    }
    // Show when the last calibration was taken.
    if (calibrateStatus) {
      var cal = prefs.getCalibration();
      calibrateStatus.textContent = (cal && cal.at)
        ? ('Last calibrated ' + new Date(cal.at).toLocaleString())
        : 'Not yet calibrated — showing generic estimates.';
    }
    renderCalibTable();
  }

  // Nested focus manager so Tab stays trapped within THIS overlay while it is
  // layered above the open Settings dialog (otherwise settingsFocus.onTab
  // intercepts Tab and bounces focus back to Settings). Pushed on open, popped
  // on close — the same pattern as the Players/backup/reset panels.
  var boardsizeFocus = (boardsizeOverlay && boardsizeCard)
    ? makeDialogFocusManager(boardsizeOverlay, boardsizeCard, 'boardsize-close')
    : null;

  function openBoardsize() {
    if (!boardsizeOverlay) return;
    syncBoardsizeUI();
    boardsizeOverlay.classList.add('show');
    if (boardsizeFocus) boardsizeFocus.onOpen(); // moves focus in + traps Tab
    else if (boardsizeCloseBtn) boardsizeCloseBtn.focus();
  }
  function closeBoardsize() {
    if (!boardsizeOverlay) return;
    boardsizeOverlay.classList.remove('show');
    updateBoardsizeReadout(); // refresh the Settings summary value
    if (boardsizeFocus) boardsizeFocus.onClose(); // pops + restores focus
    else if (boardsizeOpenBtn) boardsizeOpenBtn.focus();
  }

  if (boardsizeOpenBtn) boardsizeOpenBtn.addEventListener('click', openBoardsize);
  if (boardsizeCloseBtn) boardsizeCloseBtn.addEventListener('click', closeBoardsize);
  if (boardsizeOverlay) {
    boardsizeOverlay.addEventListener('click', function (e) {
      if (e.target === boardsizeOverlay) closeBoardsize();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && boardsizeOverlay &&
        boardsizeOverlay.classList.contains('show')) {
      // Close only the board-size panel (topmost); leave Settings open beneath.
      e.stopPropagation();
      closeBoardsize();
    }
  }, true);

  if (boardsizeRange) {
    boardsizeRange.addEventListener('input', function () {
      prefs.setPendingBoardSize(parseInt(this.value, 10));
      updateBoardsizeReadout();
      renderCalibTable(); // re-outline the selected size column
    });
  }

  if (maxwaitRange && CALIB) {
    maxwaitRange.addEventListener('input', function () {
      prefs.setCalibMaxWaitMs(CALIB.maxWaitIndexToMs(parseInt(this.value, 10)));
      updateMaxwaitReadout();
      renderCalibTable(); // re-evaluate red cells against the new threshold
    });
  }

  if (calibrateRunBtn && CALIB && AGENTS) {
    calibrateRunBtn.addEventListener('click', function () {
      calibrateRunBtn.disabled = true;
      calibrateRunBtn.textContent = 'Calibrating…';
      if (calibrateStatus) calibrateStatus.textContent = 'Measuring on your device…';
      // Defer to the next frame so the "Calibrating…" state paints before the
      // (synchronous, few-second) measurement blocks the main thread.
      var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
      raf(function () {
        var device = (typeof navigator !== 'undefined' && navigator.userAgent)
          ? navigator.userAgent : 'unknown';
        var samples;
        try {
          samples = CALIB.measureCheapSizes(runOneInline,
            { at: new Date().toISOString(), device: device,
              sampleSizes: [6, BROWSER_SAMPLE_MAX] });
        } catch (err) {
          samples = null;
        }
        if (samples && samples.shark && Object.keys(samples.shark).length) {
          prefs.setCalibration(samples);
        }
        calibrateRunBtn.disabled = false;
        syncBoardsizeUI();
      });
    });
  } else if (calibrateRunBtn) {
    // No agents/helper available: calibration can't run.
    calibrateRunBtn.disabled = true;
    if (calibrateStatus) calibrateStatus.textContent = 'Calibration unavailable.';
  }

  // --- persistence controls (Settings > Persistence) -----------------------
  var autoSaveToggle = document.getElementById('autosave-toggle');
  var removeSaveBtn = document.getElementById('remove-save');
  var persistenceNote = document.getElementById('persistence-note');

  // Dimension gate: this UI only adopts/recognises saves matching its fixed size.
  function fitsDimensions(r, c, p) {
    return r === ROWS && c === COLS && p === PLAYERS;
  }

  // Reflect the current persistence state in the panel. Two derived states:
  //   - note shown  : auto-save OFF *and* a valid saved game exists (the only case a
  //                   silent restore-next-time could surprise the user);
  //   - remove enabled: exactly the same condition — there is removable data
  //                   that isn't being continuously rewritten by an active
  //                   auto-save. With auto-save ON, removing is pointless (the
  //                   next move rewrites it), so the button is disabled.
  function syncPersistenceUI() {
    var on = prefs.getAutoSave();
    var hasSave = boardStore.has(fitsDimensions);
    if (autoSaveToggle) autoSaveToggle.checked = on;
    var orphanSave = (!on && hasSave);
    if (persistenceNote) persistenceNote.hidden = !orphanSave;
    if (removeSaveBtn) removeSaveBtn.disabled = !orphanSave;
  }

  if (autoSaveToggle) {
    autoSaveToggle.addEventListener('change', function () {
      prefs.setAutoSave(this.checked);
      // Turning auto-save ON should immediately capture the current board (so a
      // reload right after enabling restores this game, not nothing) — BUT only
      // when no turn is in progress. If a cascade is mid-resolution (animated/
      // paused `busy`, or manual `stepping.active`), the current state contains
      // overloaded cells; persisting it would restore an unstable board as if
      // settled (the cascade never resumes after reload). In that case we skip
      // the immediate save and let the eventual finalizeTurn() persist the
      // settled end-state instead. Turning OFF leaves any existing save intact.
      if (this.checked && !busy && !stepping.active) autoSaveIfOn();
      syncPersistenceUI();
    });
  }

  if (removeSaveBtn) {
    removeSaveBtn.addEventListener('click', function () {
      boardStore.remove();
      syncPersistenceUI();
    });
  }

  // Keep the panel honest every time Settings opens (the save state can change
  // between openings as the game is played).
  syncPersistenceUI();

  // --- player type selects (Human / Random / Tutor) ------------------------
  var p1TypeSel = document.getElementById('p1-type');
  var p2TypeSel = document.getElementById('p2-type');
  var nameInputs = {
    1: document.getElementById('p1-name'),
    2: document.getElementById('p2-name'),
  };

  // Reflect the stored player types in the selects. If the agents module is
  // missing (script not loaded), fall back to Human and disable the selects so
  // the UI can't offer AI it can't run.
  // Per-seat Shark difficulty controls. Each row is shown only when that seat
  // is a Shark, so: one Shark -> one row; both Sharks -> two rows (each with its
  // own difficulty). References gathered per seat for symmetric handling.
  var sharkRows = {
    1: {
      row: document.getElementById('shark-level-row-1'),
      sel: document.getElementById('shark-level-1'),
      label: document.getElementById('shark-level-label-1'),
    },
    2: {
      row: document.getElementById('shark-level-row-2'),
      sel: document.getElementById('shark-level-2'),
      label: document.getElementById('shark-level-label-2'),
    },
  };

  function isShark(n) { return prefs.getPlayerType(n) === 'shark'; }

  // Show a difficulty row for each seat that is a Shark (and only when the
  // agents module can actually provide Shark). When BOTH seats are Shark, the
  // label names the player so the two rows are distinguishable; with a single
  // Shark the generic "Shark difficulty" reads cleanest.
  function syncSharkLevelUI() {
    var canShark = !!AGENTS && !!AGENTS.makeShark;
    var both = isShark(1) && isShark(2);
    [1, 2].forEach(function (n) {
      var r = sharkRows[n];
      if (!r.row) return;
      var show = canShark && isShark(n);
      r.row.hidden = !show;
      if (r.sel) r.sel.value = String(prefs.getSharkDepth(n));
      if (r.label) {
        // When BOTH seats are Shark, playerName() returns the same literal
        // "Shark (AI)" for each, so name the SEAT ("Player N") to keep the two
        // difficulty rows distinguishable; with a single Shark the generic
        // "Shark difficulty" reads cleanest.
        r.label.textContent = both
          ? ('Player ' + n + ' difficulty')
          : 'Shark difficulty';
      }
    });
  }

  // Per-seat Tutor difficulty controls, mirroring the Shark rows: a row per seat
  // shown only when that seat is a Tutor; with both seats Tutor the label names
  // the player so the two rows are distinguishable.
  var tutorRows = {
    1: {
      row: document.getElementById('tutor-level-row-1'),
      sel: document.getElementById('tutor-level-1'),
      label: document.getElementById('tutor-level-label-1'),
    },
    2: {
      row: document.getElementById('tutor-level-row-2'),
      sel: document.getElementById('tutor-level-2'),
      label: document.getElementById('tutor-level-label-2'),
    },
  };

  function isTutor(n) { return prefs.getPlayerType(n) === 'tutor'; }

  function syncTutorLevelUI() {
    var canTutor = !!AGENTS && !!AGENTS.makeTutor;
    var both = isTutor(1) && isTutor(2);
    [1, 2].forEach(function (n) {
      var r = tutorRows[n];
      if (!r.row) return;
      var show = canTutor && isTutor(n);
      r.row.hidden = !show;
      if (r.sel) r.sel.value = prefs.getTutorLevel(n);
      if (r.label) {
        // Both seats Tutor -> playerName() is "Tutor (AI)" for each, so name the
        // SEAT ("Player N") so the two rows are distinguishable.
        r.label.textContent = both
          ? ('Player ' + n + ' difficulty')
          : 'Tutor difficulty';
      }
    });
  }

  // Per-seat Random difficulty controls, mirroring the Tutor/Shark rows.
  var randomRows = {
    1: {
      row: document.getElementById('random-level-row-1'),
      sel: document.getElementById('random-level-1'),
      label: document.getElementById('random-level-label-1'),
    },
    2: {
      row: document.getElementById('random-level-row-2'),
      sel: document.getElementById('random-level-2'),
      label: document.getElementById('random-level-label-2'),
    },
  };

  function isRandom(n) { return prefs.getPlayerType(n) === 'random'; }

  function syncRandomLevelUI() {
    var canRandom = !!AGENTS && !!AGENTS.makeRandom;
    var both = isRandom(1) && isRandom(2);
    [1, 2].forEach(function (n) {
      var r = randomRows[n];
      if (!r.row) return;
      var show = canRandom && isRandom(n);
      r.row.hidden = !show;
      if (r.sel) r.sel.value = prefs.getRandomLevel(n);
      if (r.label) {
        // Both seats Random -> name the SEAT so the two rows are distinguishable.
        r.label.textContent = both
          ? ('Player ' + n + ' difficulty')
          : 'Random difficulty';
      }
    });
  }

  function syncPlayerTypeUI() {
    var sels = { 1: p1TypeSel, 2: p2TypeSel };
    [1, 2].forEach(function (n) {
      var sel = sels[n];
      if (!sel) return;
      if (!AGENTS) { sel.value = 'human'; sel.disabled = true; return; }
      sel.value = prefs.getPlayerType(n);
    });
    syncNameInputs();
    syncSharkLevelUI();
    syncTutorLevelUI();
    syncRandomLevelUI();
  }

  // Reflect the per-seat name inputs in the Players panel. A HUMAN seat shows
  // its stored custom name (empty if none, with the default as placeholder) and
  // is editable. An AI seat shows the agent name (e.g. "Tutor (AI)") and is
  // DISABLED — machine players aren't renamed. Skips the input currently being
  // edited so typing isn't clobbered by a concurrent sync.
  function syncNameInputs() {
    [1, 2].forEach(function (n) {
      var input = nameInputs[n];
      if (!input) return;
      if (document.activeElement === input) return; // don't fight the typist
      input.maxLength = MAX_NAME_LEN;
      if (prefs.getPlayerType(n) === 'human') {
        input.disabled = false;
        input.value = sanitizeName(prefs.getPlayerName(n));
        input.placeholder = defaultPlayerName(n);
      } else {
        input.disabled = true;
        input.value = playerName(n);     // the agent label
        input.placeholder = '';
      }
    });
  }

  // Persist a human seat's edited name. Empty -> clear (revert to the default).
  // Purely cosmetic: never touches the win tally (that's its own control).
  function commitNameInput(n) {
    var input = nameInputs[n];
    if (!input || input.disabled) return;
    var clean = sanitizeName(input.value);
    var def = defaultPlayerName(n);
    prefs.setPlayerName(n, (clean && clean !== def) ? clean : '');
    // Reflect the SANITISED/stored value back into the field, so what's shown
    // matches what was saved (e.g. trimmed whitespace, length cap, or a cleared
    // name reverting to blank) without waiting for the panel to be reopened.
    // Skipped if focus already moved elsewhere via syncNameInputs's own guard.
    if (document.activeElement !== input) {
      input.value = (clean && clean !== def) ? clean : '';
    }
    render(); // refresh the top-bar label / status counts to the new name
  }

  [1, 2].forEach(function (n) {
    var input = nameInputs[n];
    if (!input) return;
    // Commit on blur and on Enter; Escape reverts to the stored value.
    input.addEventListener('blur', function () { commitNameInput(n); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        // Revert the field to the stored name, then CLOSE the panel — Escape in
        // the dialog should dismiss it (the field-level revert is the first
        // effect, the close the second). We stop propagation (so the document
        // Escape handler doesn't also fire) and close here directly, because
        // otherwise stopPropagation would swallow the only path that closes it.
        input.value = sanitizeName(prefs.getPlayerName(n));
        input.blur(); // commits the (unchanged) value via the blur handler
        closePlayers();
      }
      e.stopPropagation(); // don't let keys bubble to global handlers
    });
  });

  function onPlayerTypeChange(n, sel) {
    prefs.setPlayerType(n, sel.value);
    syncNameInputs(); // enable/disable + relabel this seat's name field
    syncSharkLevelUI(); // show/hide the Shark difficulty row as needed
    syncTutorLevelUI(); // show/hide the Tutor difficulty row as needed
    syncRandomLevelUI(); // show/hide the Random difficulty row as needed
    // Re-render so the turn label (which shows the agent name for an AI seat)
    // and the rename affordance update; render() also re-evaluates whether the
    // CURRENT player is now an AI and, if so, schedules its move.
    render();
  }

  if (p1TypeSel) {
    p1TypeSel.addEventListener('change', function () { onPlayerTypeChange(1, this); });
  }
  if (p2TypeSel) {
    p2TypeSel.addEventListener('change', function () { onPlayerTypeChange(2, this); });
  }
  [1, 2].forEach(function (n) {
    var sel = sharkRows[n].sel;
    if (!sel) return;
    sel.addEventListener('change', function () {
      prefs.setSharkDepth(n, this.value);
      // agentFor() keys its Shark cache by seat+depth, so this seat's next Shark
      // move (this game or next) uses the new difficulty automatically, without
      // disturbing the other seat's Shark. Re-render in case this Shark is to
      // move now (it will be re-fetched at the new depth).
      render();
    });
  });
  [1, 2].forEach(function (n) {
    var sel = tutorRows[n].sel;
    if (!sel) return;
    sel.addEventListener('change', function () {
      prefs.setTutorLevel(n, this.value);
      // agentFor() keys its Tutor cache by seat+level, so this seat's next Tutor
      // move uses the new level automatically, without disturbing the other
      // seat's Tutor. Re-render in case this Tutor is to move now.
      render();
    });
  });
  [1, 2].forEach(function (n) {
    var sel = randomRows[n].sel;
    if (!sel) return;
    sel.addEventListener('change', function () {
      prefs.setRandomLevel(n, this.value);
      // agentFor() keys its Random cache by seat+level, so this seat's next
      // Random move uses the new level automatically. Re-render in case this
      // Random is to move now.
      render();
    });
  });
  syncPlayerTypeUI();

  // --- players panel (opened from the top-left turn region) ----------------
  // Hosts the per-seat name + Human/AI type + difficulty controls that used to
  // live in Settings. Like Settings, opening it PAUSES any in-flight animated
  // cascade (so the board doesn't resolve behind the dialog) and resumes on
  // close. Openable any time — including to swap a seat to/from an AI mid-game.
  var playersOverlay = document.getElementById('players-overlay');
  var playersCard = document.getElementById('players-card');
  var playersClose = document.getElementById('players-close');
  var playersFocus = makeDialogFocusManager(playersOverlay, playersCard, null);

  function openPlayers() {
    // Pause any in-flight animated cascade (mirrors openSettings) so it doesn't
    // resolve in the background while the dialog is open.
    paused = true;
    if (animTimer !== null) {
      clearTimeout(animTimer);
      animTimer = null;
      if (busy) resumeAnimation = animSchedule;
    }
    cancelPendingHint(); // a hint can't apply while the dialog pauses play
    playersOverlay.classList.add('show');
    syncPlayerTypeUI();   // reflect current names / types / difficulty rows
    syncHintButton();     // hide the Hint button while the panel is open (paused)
    updateTurnRegionAffordance(); // region is now "open" — drop its button role
    playersFocus.onOpen();
  }
  function closePlayers() {
    // Commit any name the user left focused (defensive — blur usually fires).
    [1, 2].forEach(function (n) {
      var input = nameInputs[n];
      if (input && document.activeElement === input) commitNameInput(n);
    });
    playersOverlay.classList.remove('show');
    paused = false;
    // Restore the #turn region's focusability BEFORE onClose() tries to return
    // focus to it. onClose() focuses the element that was active when the panel
    // opened — the #turn region — but opening removed its tabindex (and the
    // affordance only re-adds it once the overlay is no longer shown, which is
    // now true). Restoring first means focus actually lands back on the trigger
    // rather than silently failing on a non-focusable div.
    updateTurnRegionAffordance(); // region clickable + focusable again
    playersFocus.onClose();
    // Resume a paused animated cascade, if one was in progress.
    if (resumeAnimation) {
      var fn = resumeAnimation;
      resumeAnimation = null;
      fn();
    } else {
      // Nothing mid-cascade: if closing left an AI to move (e.g. the player just
      // set the current seat to an AI), get it moving now that we're unpaused.
      maybeTriggerAI();
      syncHintButton(); // restore the Hint button (dim; re-arms its idle timer)
    }
  }

  if (playersClose) playersClose.addEventListener('click', closePlayers);
  playersOverlay.addEventListener('click', function (e) {
    if (e.target === playersOverlay) closePlayers(); // backdrop click closes
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && playersOverlay.classList.contains('show')) {
      closePlayers();
    }
  });

  // --- confirm dialog ------------------------------------------------------
  // A small in-app yes/no modal, used instead of window.confirm (which prefixes
  // its text with the page origin — "file…" when opened locally). Reuses the
  // shared dialog focus manager (focus trap + restore).
  //
  //   confirmDialog(message, onConfirm, options?)
  //
  // Shows the overlay with the given message; OK runs onConfirm and closes;
  // Cancel / Escape / backdrop click just closes. An optional `options.checkbox`
  // ({ label, checked }) reveals a checkbox below the message; its boolean state
  // is passed to onConfirm(checked) on OK (false when no checkbox is used).
  var confirmOverlay = document.getElementById('confirm-overlay');
  var confirmCard = document.getElementById('confirm-card');
  var confirmMessage = document.getElementById('confirm-message');
  var confirmOk = document.getElementById('confirm-ok');
  var confirmCancel = document.getElementById('confirm-cancel');
  var confirmOptionRow = document.getElementById('confirm-option-row');
  var confirmOption = document.getElementById('confirm-option');
  var confirmOptionLabel = document.getElementById('confirm-option-label');
  var confirmFocus = makeDialogFocusManager(confirmOverlay, confirmCard, 'confirm-cancel');
  var pendingConfirm = null; // the onConfirm callback for the open dialog
  var confirmHasCheckbox = false; // whether the open dialog shows the checkbox

  function openConfirm(message, onConfirm, options) {
    confirmMessage.textContent = message;
    pendingConfirm = (typeof onConfirm === 'function') ? onConfirm : null;

    var cb = options && options.checkbox;
    confirmHasCheckbox = !!cb;
    if (cb) {
      confirmOptionLabel.textContent = cb.label || '';
      confirmOption.checked = (cb.checked !== false); // default checked
      confirmOptionRow.hidden = false;
    } else {
      confirmOptionRow.hidden = true;
      confirmOption.checked = false;
    }

    confirmOverlay.classList.add('show');
    confirmFocus.onOpen(); // focuses Cancel by default (safe default for a reset)
  }
  function closeConfirm() {
    confirmOverlay.classList.remove('show');
    confirmFocus.onClose();
    pendingConfirm = null;
    confirmHasCheckbox = false;
  }
  function confirmDialog(message, onConfirm, options) {
    openConfirm(message, onConfirm, options);
  }

  confirmOk.addEventListener('click', function () {
    var fn = pendingConfirm;
    var checked = confirmHasCheckbox && confirmOption.checked;
    closeConfirm();      // close first so focus is restored before the action
    if (fn) fn(checked);
  });
  confirmCancel.addEventListener('click', closeConfirm);
  confirmOverlay.addEventListener('click', function (e) {
    if (e.target === confirmOverlay) closeConfirm(); // backdrop click = cancel
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && confirmOverlay.classList.contains('show')) {
      closeConfirm();
    }
  });

  // --- reset-to-first-use dialog -------------------------------------------
  // A multi-checkbox dialog (opened from Settings → Persistence) that erases
  // the two persistence stores — "Names, scores & settings" (the whole prefs
  // record, cleared via prefs.clearAll()'s prefix sweep) and "Current game"
  // (the board save) — each independently selectable, both checked by default.
  // A third "Reload" option refreshes the page so no stale state lingers in
  // memory; it is only meaningful when something is actually cleared, so it is
  // enabled (and auto-checked) only while group 1 or group 2 is selected.
  var resetOverlay = document.getElementById('reset-overlay');
  var resetCard = document.getElementById('reset-card');
  var resetOpenBtn = document.getElementById('reset-firstuse');
  var resetOk = document.getElementById('reset-ok');
  var resetCancel = document.getElementById('reset-cancel');
  var resetGroupPrefs = document.getElementById('reset-group-prefs');
  var resetGroupBoard = document.getElementById('reset-group-board');
  var resetGroupReload = document.getElementById('reset-group-reload');
  var resetFocus = makeDialogFocusManager(resetOverlay, resetCard, 'reset-cancel');

  // The user's explicit preference for the Reload option, remembered across
  // enable/disable transitions so toggling a data group never silently
  // overrides a deliberate choice. Defaults to true (reload is the recommended
  // way to reach a clean first-use appearance). Updated only by a real user
  // toggle (the change handler below), not by the programmatic disable logic.
  var reloadPref = true;

  // Keep the Reload checkbox honest: enabled only when at least one of the two
  // data groups is selected (reloading clears nothing by itself). While
  // disabled it shows unchecked; when it becomes enabled again it is restored
  // to the user's remembered preference (not force-checked). OK is disabled
  // when nothing at all is selected.
  function syncResetDialog() {
    var anyData = resetGroupPrefs.checked || resetGroupBoard.checked;
    resetGroupReload.disabled = !anyData;
    resetGroupReload.checked = anyData && reloadPref;
    if (resetOk) resetOk.disabled = !anyData;
  }

  function openReset() {
    // Fresh defaults each time: all three groups checked.
    reloadPref = true; // reset the remembered Reload preference to the default
    resetGroupPrefs.checked = true;
    resetGroupBoard.checked = true;
    resetGroupReload.checked = true;
    syncResetDialog();
    resetOverlay.classList.add('show');
    // onOpen() moves focus into the reset dialog FIRST (synchronously), so the
    // trigger (inside Settings) is never focused within an inert subtree.
    resetFocus.onOpen(); // focuses Cancel (safe default for a destructive action)
    // Reset is opened from the Settings panel, which stays visually behind it.
    // Make the Settings OVERLAY inert so assistive tech doesn't see two active
    // modal dialogs (it carries role="dialog" aria-modal="true"), mirroring the
    // About ⇄ What's new nesting. Removed again in closeReset().
    settingsOverlay.setAttribute('inert', '');
    settingsOverlay.setAttribute('aria-hidden', 'true');
  }
  function closeReset() {
    resetOverlay.classList.remove('show');
    // Re-enable the Settings layer BEFORE restoring focus — focus can't land on
    // an element inside an inert subtree, and onClose() restores focus to the
    // Reset trigger, which lives inside the Settings card.
    settingsOverlay.removeAttribute('inert');
    settingsOverlay.removeAttribute('aria-hidden');
    resetFocus.onClose();
  }

  if (resetOpenBtn) {
    resetOpenBtn.addEventListener('click', openReset);
  }
  resetGroupPrefs.addEventListener('change', syncResetDialog);
  resetGroupBoard.addEventListener('change', syncResetDialog);
  // Remember the user's explicit Reload choice so it survives later toggles of
  // the data checkboxes (which disable/enable Reload). Only fires on a real
  // user interaction, never on the programmatic checked= in syncResetDialog.
  resetGroupReload.addEventListener('change', function () {
    if (!resetGroupReload.disabled) reloadPref = resetGroupReload.checked;
  });

  resetOk.addEventListener('click', function () {
    var doPrefs = resetGroupPrefs.checked;
    var doBoard = resetGroupBoard.checked;
    var doReload = resetGroupReload.checked && !resetGroupReload.disabled;
    if (!doPrefs && !doBoard) { closeReset(); return; } // nothing selected

    // Clear by NAMESPACE SWEEP so the "future keys are cleaned automatically"
    // guarantee holds for every selection, not just "both groups":
    //   - both groups  -> sweep the whole namespace (keep nothing)
    //   - prefs only   -> sweep everything EXCEPT the board save
    //   - board only   -> sweep everything EXCEPT the prefs record
    // Any future jumping_squares:* key is therefore removed whenever at least
    // one group is selected (it is only spared by the OTHER group's keep).
    if (doPrefs && doBoard) {
      prefs.clearAll([]);        // sweep all; reset in-memory prefs to defaults
      boardStore.remove();       // belt-and-braces (clearAll already took :save)
    } else if (doPrefs) {
      prefs.clearAll();          // keeps the board save (default keep = [:save])
    } else { // board only
      sweepStorage([PREFS_KEY]); // clear :save (and any non-prefs future key)
    }

    if (doReload) {
      // A plain reload is enough: we are NOT changing code, only clearing data,
      // so there is no need to cache-bust the scripts. The reload simply drops
      // all in-memory state so the app presents its true first-use appearance.
      closeReset();
      window.location.reload();
      return;
    }

    // No reload: bring the LIVE page into line with what was cleared, so the
    // on-screen state matches first-use even though nothing was refreshed.
    if (doBoard) {
      // The saved board is gone; reinitialise the live game too, otherwise
      // render() would redraw the old (possibly finished) board. newGame()
      // rebuilds the grid, clears any end-of-game modal, cancels any in-flight
      // cascade, and re-renders. It ALSO calls autoSaveIfOn(), which (with
      // auto-save on) would immediately write a NEW jumping_squares:save for
      // the fresh board — resurrecting a "current game" the user just asked to
      // erase. So we remove the save again afterwards: the net result is a
      // fresh empty board on screen and NO persisted save, i.e. true first-use.
      // (Normal gameplay from here still auto-saves on the next move as usual.)
      newGame();
      boardStore.remove();
    }
    if (doPrefs) {
      // Preferences reset in place: resync the Players/difficulty controls and
      // the turn label so they show defaults rather than stale values.
      syncPlayerTypeUI();
      // The hint light-up delay IS persisted, so clearAll() reset it to the
      // default (10 s); reflect that in its slider/readout.
      syncHintDelayUI();
      // Board size, max-wait and calibration are persisted too; clearAll()
      // reset them to defaults (5×5, 5 s, no calibration). Reflect that in the
      // Settings summary and (if open) the board-size panel.
      syncBoardsizeUI();
      // The propagation delay is an in-memory session setting (not persisted),
      // so clearing storage doesn't touch it; a reload would reset it to the
      // default on its own. For an in-place reset, drive the change THROUGH the
      // slider's own input handler (set the value, then dispatch 'input') so
      // its cascade-transition logic runs — e.g. if Reset was opened while a
      // manual/timed cascade is paused mid-resolution, the handler converts or
      // reschedules it rather than being left with stale pacing or a stranded
      // Step control. Setting settings.* directly would bypass that.
      if (delayRange && delayRange.value !== '5') {
        delayRange.value = 5; // index 5 -> 500 ms (default)
        delayRange.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // Already at default: nothing for the input handler to transition, but
        // keep the readout honest.
        sliderIndexToSetting(5);
        updateDelayReadout();
      }
      render();
    }
    closeReset();
    syncPersistenceUI();
  });
  resetCancel.addEventListener('click', closeReset);
  resetOverlay.addEventListener('click', function (e) {
    if (e.target === resetOverlay) closeReset(); // backdrop click = cancel
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && resetOverlay.classList.contains('show')) {
      closeReset();
    }
  });

  // --- Save / Load to file (backup / restore) ------------------------------
  // A file-based backup: export the selected sections to a JSON file and import
  // one back. Two optional, independently-selectable sections (both default on):
  //   - board : the current game (engine cloneState), shareable / puzzle-making;
  //   - prefs : the whole preferences record (names, tally, player setup, …).
  // The unified wrapper is self-describing so a file is recognisable and future
  // -proof; a board-only export also gets a filename marker. Import REPLACES
  // only the sections present in the file (the board via the engine's STRICT
  // loadState — no mid-cascade / overflow positions — and prefs via the same
  // per-field validation as a stored record); everything else is kept.
  var BACKUP_FORMAT = 'jumping_squares/backup';
  var BACKUP_FORMAT_VERSION = 1;

  var backupOverlay = document.getElementById('backup-overlay');
  var backupCard = document.getElementById('backup-card');
  var backupOpenBtn = document.getElementById('backup-open');
  var backupCloseBtn = document.getElementById('backup-close');
  var backupGroupBoard = document.getElementById('backup-group-board');
  var backupGroupPrefs = document.getElementById('backup-group-prefs');
  var backupExportBtn = document.getElementById('backup-export');
  var backupImportBtn = document.getElementById('backup-import');
  var backupStatus = document.getElementById('backup-status');
  var backupFile = document.getElementById('backup-file');
  var backupFocus = makeDialogFocusManager(backupOverlay, backupCard, 'backup-close');

  // Show a status/result line in the panel (polite). `isError` switches to the
  // muted-red styling for a rejected load.
  function setBackupStatus(msg, isError) {
    if (!backupStatus) return;
    backupStatus.textContent = msg || '';
    backupStatus.hidden = !msg;
    backupStatus.classList.toggle('error', !!isError);
  }

  // At least one section must be selected for Export/Import to make sense;
  // reflect that by disabling the actions when nothing is checked.
  function syncBackupActions() {
    var any = (backupGroupBoard && backupGroupBoard.checked) ||
              (backupGroupPrefs && backupGroupPrefs.checked);
    if (backupExportBtn) backupExportBtn.disabled = !any;
    if (backupImportBtn) backupImportBtn.disabled = !any;
  }

  // Build the backup wrapper for the currently-selected sections. The board
  // section stores the LIVE game (cloneState) so "save" captures what's on
  // screen; the prefs section is a deep copy of the preferences record.
  function buildBackupObject(includeBoard, includePrefs) {
    var wrapper = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      engineVersion: G.VERSION,
      savedAt: new Date().toISOString(),
    };
    if (includeBoard) {
      // Reuse the board-save envelope shape for the board section, so the two
      // formats stay recognisably related and a future migrator can share code.
      wrapper.board = {
        format: SAVE_FORMAT,
        formatVersion: SAVE_FORMAT_VERSION,
        state: G.cloneState(state),
      };
    }
    if (includePrefs) {
      wrapper.prefs = prefs.exportAll();
    }
    return wrapper;
  }

  // Two-digit zero-pad for the filename timestamp.
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Download filename reflecting which sections are included: a board-only
  // export gets a "-board" marker (it's the shareable/puzzle file); a prefs-only
  // export gets "-settings"; a full backup gets neither marker.
  function backupFilename(includeBoard, includePrefs) {
    var d = new Date();
    var stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
                '-' + pad2(d.getHours()) + pad2(d.getMinutes());
    var marker = '';
    if (includeBoard && !includePrefs) marker = '-board';
    else if (includePrefs && !includeBoard) marker = '-settings';
    return 'jumping-squares' + marker + '-' + stamp + '.json';
  }

  // Trigger a client-side download of `text` as `filename`. Best-effort: uses a
  // Blob + object URL + a transient <a download>. No network involved.
  function downloadTextFile(filename, text) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke on the next tick so the click has consumed the URL.
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  function exportBackup() {
    var includeBoard = !!(backupGroupBoard && backupGroupBoard.checked);
    var includePrefs = !!(backupGroupPrefs && backupGroupPrefs.checked);
    if (!includeBoard && !includePrefs) {
      setBackupStatus('Select at least one section to save.', true);
      return;
    }
    // Refuse a BOARD export while a cascade is unsettled (an animated cascade is
    // paused mid-flight behind the dialog, or a manual step is in progress). The
    // live state then has over-capacity cells, so the exported board would fail
    // the strict loadState on import — and in a full backup the prefs section
    // would be lost too (validation aborts before anything is applied). Mirrors
    // the auto-save guard, which likewise refuses to persist an unsettled board.
    // (A prefs-only export is always fine — it doesn't touch the board.)
    if (includeBoard && (busy || stepping.active)) {
      setBackupStatus(
        'Can\u2019t save the game board while a cascade is still resolving. ' +
        'Let it finish (or finish stepping), then try again — or untick ' +
        '\u201CGame board\u201D to save just your settings.', true);
      return;
    }
    var obj = buildBackupObject(includeBoard, includePrefs);
    var json = JSON.stringify(obj, null, 2);
    var name = backupFilename(includeBoard, includePrefs);
    if (downloadTextFile(name, json)) {
      var parts = [];
      if (includeBoard) parts.push('game board');
      if (includePrefs) parts.push('settings & scores');
      setBackupStatus('Saved ' + parts.join(' + ') + ' to ' + name + '.', false);
    } else {
      setBackupStatus('Could not start the download in this browser.', true);
    }
  }

  // Validate a parsed backup wrapper against the SELECTED sections. Returns
  // { board, prefs, error }: board is a CLEAN engine state (via loadState) when
  // a board section was requested and present; prefs is the raw prefs object to
  // hand to prefs.importRecord(). On any problem, `error` is a user-facing
  // message and board/prefs are null. "Requested but absent/invalid" is an
  // error so the user isn't silently given nothing.
  function validateBackupObject(parsed, wantBoard, wantPrefs) {
    var out = { board: null, prefs: null, error: null };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      out.error = 'That file is not a Jumping Squares backup.';
      return out;
    }
    if (parsed.format !== BACKUP_FORMAT) {
      out.error = 'Unrecognised file format (not a Jumping Squares backup).';
      return out;
    }
    var fv = parsed.formatVersion;
    if (typeof fv !== 'number' || !isFinite(fv) || Math.floor(fv) !== fv ||
        fv < 1 || fv > BACKUP_FORMAT_VERSION) {
      out.error = 'This backup was made by a newer version and can\u2019t be read.';
      return out;
    }

    var haveBoard = parsed.board && typeof parsed.board === 'object';
    var havePrefs = parsed.prefs && typeof parsed.prefs === 'object';
    if (!haveBoard && !havePrefs) {
      out.error = 'The file contains no board or settings to load.';
      return out;
    }

    if (wantBoard) {
      if (!haveBoard) {
        out.error = 'This file has no game board to load (untick Game board, ' +
          'or choose a file that has one).';
        return out;
      }
      var rawState = parsed.board.state;
      // Which dimensions must the board match? Normally the CURRENT board, but
      // when this same file ALSO carries a prefs section whose boardSize will be
      // applied on import, the board should be judged against THAT size (a full
      // backup made on a 10x10 board carries both a 10x10 board and boardSize:10;
      // gating it against the current 5x5 would wrongly reject it). So peek at
      // the incoming boardSize when a prefs section is being imported too.
      var expectR = ROWS, expectC = COLS;
      if (wantPrefs && havePrefs && parsed.prefs && typeof parsed.prefs === 'object') {
        var bs = parsed.prefs.boardSize;
        if (typeof bs === 'number' && isFinite(bs) &&
            Math.floor(bs) === bs && bs >= 2 && bs <= 12) {
          expectR = bs; expectC = bs;
        }
      }
      // Dimension gate first (cheap), then STRICT validation + rehydration.
      if (!rawState || typeof rawState !== 'object' ||
          rawState.rows !== expectR || rawState.cols !== expectC ||
          rawState.players !== PLAYERS) {
        out.error = 'The saved board doesn\u2019t fit this game (expected ' +
          expectR + '\u00d7' + expectC + ', ' + PLAYERS + ' players).';
        return out;
      }
      var clean = G.loadState(rawState);
      if (clean === null) {
        out.error = 'The saved board failed validation (corrupt, mid-cascade, ' +
          'or an impossible position) and was not loaded.';
        return out;
      }
      out.board = clean;
    }

    if (wantPrefs) {
      if (!havePrefs) {
        out.error = 'This file has no settings to load (untick Settings & ' +
          'scores, or choose a file that has them).';
        return out;
      }
      out.prefs = parsed.prefs;
    }
    return out;
  }

  // Apply a validated import: REPLACE the selected sections, keep the rest.
  function applyImport(validated) {
    var changed = [];
    if (validated.prefs) {
      prefs.importRecord(validated.prefs);
      changed.push('settings & scores');
    }
    if (validated.board) {
      // Replace the live game with the imported, validated state, and persist
      // it (when auto-save is on) so a reload keeps the loaded board. Cancel any
      // in-flight cascade/AI/hint for the old board first (as New Game does).
      playToken++;
      if (animTimer !== null) { clearTimeout(animTimer); animTimer = null; }
      resumeAnimation = null;
      cancelPendingHint();
      busy = false;
      stepping.active = false;
      winRecorded = (validated.board.winner !== G.EMPTY); // a finished import is already tallied-equivalent
      suppressWinnerModal = (validated.board.winner !== G.EMPTY); // show board, not the live-win modal
      state = validated.board;
      // Keep the module dimensions in step with the imported board, so
      // fitsDimensions / rendering / a later auto-save all agree with its size
      // (an imported board may be a different size than the one on screen).
      ROWS = state.rows;
      COLS = state.cols;
      buildGrid();
      sizeBoard();
      autoSaveIfOn();
      changed.push('game board');
    }
    // Reflect everything that changed: Players/difficulty rows, hint delay,
    // persistence state, board-size summary/panel, and the board/turn label.
    syncPlayerTypeUI();
    syncHintDelayUI();
    syncBoardsizeUI();
    syncPersistenceUI();
    render();
    return changed;
  }

  // Read + parse + validate + confirm + apply an imported file.
  function handleImportFile(file) {
    var wantBoard = !!(backupGroupBoard && backupGroupBoard.checked);
    var wantPrefs = !!(backupGroupPrefs && backupGroupPrefs.checked);
    if (!wantBoard && !wantPrefs) {
      setBackupStatus('Select at least one section to load.', true);
      return;
    }
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () {
      setBackupStatus('Could not read that file.', true);
    };
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (e) {
        setBackupStatus('That file isn\u2019t valid JSON.', true);
        return;
      }
      var v = validateBackupObject(parsed, wantBoard, wantPrefs);
      if (v.error) { setBackupStatus(v.error, true); return; }

      // Confirm — importing REPLACES the selected sections (the current game
      // and/or your settings). Describe exactly what will be replaced.
      var repl = [];
      if (v.board) repl.push('the current game board');
      if (v.prefs) repl.push('your settings & scores');
      confirmDialog(
        'Load this file? It will replace ' + repl.join(' and ') +
        '. This cannot be undone.',
        function () {
          var changed = applyImport(v);
          setBackupStatus('Loaded ' + changed.join(' + ') + '.', false);
        });
    };
    reader.readAsText(file);
  }

  function openBackup() {
    setBackupStatus('', false);
    syncBackupActions();
    backupOverlay.classList.add('show');
    // onOpen() moves focus into this dialog FIRST, then inert the Settings
    // layer beneath it (same nested-dialog pattern as Reset) so assistive tech
    // doesn't see two active modal dialogs.
    backupFocus.onOpen();
    settingsOverlay.setAttribute('inert', '');
    settingsOverlay.setAttribute('aria-hidden', 'true');
  }
  function closeBackup() {
    backupOverlay.classList.remove('show');
    settingsOverlay.removeAttribute('inert');
    settingsOverlay.removeAttribute('aria-hidden');
    backupFocus.onClose();
  }

  if (backupOpenBtn) backupOpenBtn.addEventListener('click', openBackup);
  if (backupCloseBtn) backupCloseBtn.addEventListener('click', closeBackup);
  if (backupGroupBoard) backupGroupBoard.addEventListener('change', syncBackupActions);
  if (backupGroupPrefs) backupGroupPrefs.addEventListener('change', syncBackupActions);
  if (backupExportBtn) backupExportBtn.addEventListener('click', exportBackup);
  if (backupImportBtn) {
    backupImportBtn.addEventListener('click', function () {
      if (backupFile) { backupFile.value = ''; backupFile.click(); }
    });
  }
  if (backupFile) {
    backupFile.addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (f) handleImportFile(f);
    });
  }
  backupOverlay.addEventListener('click', function (e) {
    if (e.target === backupOverlay) closeBackup(); // backdrop click = close
  });
  document.addEventListener('keydown', function (e) {
    // Only close Backup on Escape when it is the topmost dialog AND the confirm
    // dialog (which layers above it for the import confirmation) isn't open.
    if (e.key === 'Escape' && backupOverlay.classList.contains('show') &&
        !(confirmOverlay && confirmOverlay.classList.contains('show'))) {
      closeBackup();
    }
  });

  // --- help dialog ---------------------------------------------------------
  // A single scrollable page of the concise "How to play" content. The text is
  // the engine's HELP data, which is mirrored from the README (see
  // tools/gen-help.js + the drift test). Rendered to the DOM with text nodes
  // only (no innerHTML), so nothing in the content can be interpreted as markup.
  var helpOverlay = document.getElementById('help-overlay');
  var helpCard = document.getElementById('help-card');
  var helpBtn = document.getElementById('help-btn');
  var helpClose = document.getElementById('help-close');
  var helpBody = document.getElementById('help-body');
  var helpFocus = makeDialogFocusManager(helpOverlay, helpCard, 'help-close');
  var helpRendered = false; // build once, lazily, on first open

  // Append `raw` to `parent`, interpreting the small inline markdown subset the
  // help uses: **bold**, *italic*, `code`. Everything is inserted as text
  // nodes / element text content — never as HTML. Unmatched markers are left as
  // literal characters, so plain text always renders safely.
  function appendInline(parent, raw) {
    // Tokenize on the three inline markers. The regex captures a run of code,
    // bold or italic; anything else falls through as plain text.
    var re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    var last = 0;
    var m;
    while ((m = re.exec(raw)) !== null) {
      if (m.index > last) {
        parent.appendChild(document.createTextNode(raw.slice(last, m.index)));
      }
      var tok = m[0];
      var el;
      if (tok.charAt(0) === '`') {
        el = document.createElement('code');
        el.textContent = tok.slice(1, -1);
      } else if (tok.slice(0, 2) === '**') {
        el = document.createElement('strong');
        el.textContent = tok.slice(2, -2);
      } else {
        el = document.createElement('em');
        el.textContent = tok.slice(1, -1);
      }
      parent.appendChild(el);
      last = m.index + tok.length;
    }
    if (last < raw.length) {
      parent.appendChild(document.createTextNode(raw.slice(last)));
    }
  }

  // Build a <ul> from a list block's items (each item may have children, which
  // render as a single nested <ul> — the parser allows one level of nesting).
  function buildList(items) {
    var ul = document.createElement('ul');
    items.forEach(function (item) {
      var li = document.createElement('li');
      appendInline(li, item.text);
      if (item.children && item.children.length) {
        var sub = document.createElement('ul');
        item.children.forEach(function (child) {
          var cli = document.createElement('li');
          appendInline(cli, child.text);
          sub.appendChild(cli);
        });
        li.appendChild(sub);
      }
      ul.appendChild(li);
    });
    return ul;
  }

  // Render the HELP block list into #help-body. Headings become <h3> (the
  // dialog's own <h2> is the title); paragraphs <p>; lists <ul>.
  function renderHelp() {
    var blocks = (G.HELP || []);
    helpBody.replaceChildren(); // DOM-only clear (keeps the no-innerHTML invariant)
    blocks.forEach(function (b) {
      if (b.type === 'heading') {
        var h = document.createElement('h3');
        appendInline(h, b.text);
        helpBody.appendChild(h);
      } else if (b.type === 'paragraph') {
        var p = document.createElement('p');
        appendInline(p, b.text);
        helpBody.appendChild(p);
      } else if (b.type === 'list') {
        helpBody.appendChild(buildList(b.items || []));
      }
    });
  }

  function openHelp() {
    if (!helpRendered) { renderHelp(); helpRendered = true; }
    helpBody.scrollTop = 0; // always start at the top
    helpOverlay.classList.add('show');
    helpFocus.onOpen();
  }
  function closeHelp() {
    helpOverlay.classList.remove('show');
    helpFocus.onClose();
  }

  if (helpBtn) helpBtn.addEventListener('click', openHelp);
  helpClose.addEventListener('click', closeHelp);
  helpOverlay.addEventListener('click', function (e) {
    if (e.target === helpOverlay) closeHelp(); // backdrop click = close
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && helpOverlay.classList.contains('show')) {
      closeHelp();
    }
  });

  // --- about dialog --------------------------------------------------------
  // Reached only via the discreet build tag (bottom-left). Shows what the game
  // is, the exact build, a link to the source, and the licence.
  var aboutOverlay = document.getElementById('about-overlay');
  var aboutCard = document.getElementById('about-card');
  var aboutClose = document.getElementById('about-close');
  var aboutFocus = makeDialogFocusManager(aboutOverlay, aboutCard, 'about-close');

  function openAbout() {
    aboutOverlay.classList.add('show');
    aboutFocus.onOpen();
  }
  function closeAbout() {
    aboutOverlay.classList.remove('show');
    aboutFocus.onClose();
  }

  aboutClose.addEventListener('click', closeAbout);
  // Click on the dimmed backdrop (outside the card) closes it.
  aboutOverlay.addEventListener('click', function (e) {
    if (e.target === aboutOverlay) closeAbout();
  });
  // Escape closes it (desktop convenience) — but only when the What's new
  // sub-dialog (layered above About) isn't open; that one handles Escape first.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && aboutOverlay.classList.contains('show') &&
        !whatsnewOverlay.classList.contains('show')) {
      closeAbout();
    }
  });

  // --- what's new (sub-dialog of About) ------------------------------------
  // A short, curated list of recent player-facing changes, sourced from the
  // engine's CHANGELOG. Reached by choice from About; never pushed at the user.
  var whatsnewOverlay = document.getElementById('whatsnew-overlay');
  var whatsnewCard = document.getElementById('whatsnew-card');
  var whatsnewOpen = document.getElementById('whatsnew-open');
  var whatsnewClose = document.getElementById('whatsnew-close');
  var whatsnewList = document.getElementById('whatsnew-list');
  var whatsnewFocus = makeDialogFocusManager(whatsnewOverlay, whatsnewCard, 'whatsnew-close');

  // Render the curated entries (newest first, as authored in the engine). Built
  // with DOM APIs (not innerHTML) so entry text is inserted as plain text and
  // can't be interpreted as markup.
  //
  // Progressive disclosure, three tiers:
  //   1. Collapsed: show the WHATSNEW_COLLAPSED (5) most recent entries, with a
  //      "Show more" button when more are stored.
  //   2. Expanded: "Show more" reveals the rest of the STORED entries (the
  //      engine caps storage at G.WHATSNEW_MAX = 12, so this is at most 12).
  //   3. Full history: a "See full changelog" link always sits at the end,
  //      because the stored list is a capped excerpt — entries older than the
  //      cap live only in CHANGELOG.md.
  var WHATSNEW_COLLAPSED = 5;
  var CHANGELOG_URL =
    'https://github.com/tiborh/jumping_squares/blob/main/CHANGELOG.md';
  var whatsnewExpanded = false; // reset to collapsed each time the panel opens

  function makeEntryLi(entry) {
    var li = document.createElement('li');
    var meta = document.createElement('div');
    meta.className = 'wn-meta';
    var ver = document.createElement('span');
    ver.textContent = 'v' + entry.v;
    meta.appendChild(ver);
    if (entry.experimental) {
      var pill = document.createElement('span');
      pill.className = 'wn-experimental';
      pill.textContent = 'experimental';
      meta.appendChild(pill);
    }
    var text = document.createElement('div');
    text.textContent = entry.text;
    li.appendChild(meta);
    li.appendChild(text);
    return li;
  }

  function renderWhatsNew() {
    var entries = (G.CHANGELOG || []);
    whatsnewList.innerHTML = '';

    var visibleCount = whatsnewExpanded
      ? entries.length
      : Math.min(entries.length, WHATSNEW_COLLAPSED);

    for (var i = 0; i < visibleCount; i++) {
      whatsnewList.appendChild(makeEntryLi(entries[i]));
    }

    // Tier 2 control: "Show more" — only when collapsed AND there are more
    // stored entries to reveal. Activating it expands and re-renders.
    if (!whatsnewExpanded && entries.length > WHATSNEW_COLLAPSED) {
      var moreLi = document.createElement('li');
      moreLi.className = 'wn-action';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wn-showmore';
      var hidden = entries.length - WHATSNEW_COLLAPSED;
      btn.textContent = 'Show ' + hidden + ' more \u25BE'; // ▾
      btn.addEventListener('click', function () {
        whatsnewExpanded = true;
        renderWhatsNew();
        // Keep keyboard focus sensible: move it to the full-changelog link that
        // now sits where the button was.
        var full = whatsnewList.querySelector('.wn-more a');
        if (full && full.focus) full.focus();
      });
      moreLi.appendChild(btn);
      whatsnewList.appendChild(moreLi);
    }

    // Tier 3: the full-changelog link. Always present (the stored list is a
    // capped excerpt), but shown at the END only once there's nothing more to
    // expand inline — i.e. when collapsed-and-nothing-hidden, or expanded. That
    // keeps a single clear "next step" at the bottom: Show more first, then See
    // full changelog.
    if (whatsnewExpanded || entries.length <= WHATSNEW_COLLAPSED) {
      var moreHistoryLi = document.createElement('li');
      moreHistoryLi.className = 'wn-more';
      var link = document.createElement('a');
      link.href = CHANGELOG_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'See full changelog \u2197'; // ↗
      moreHistoryLi.appendChild(link);
      whatsnewList.appendChild(moreHistoryLi);
    }
  }
  renderWhatsNew();

  function openWhatsNew() {
    // Always start collapsed (5 entries) each time the panel is opened, so a
    // prior "Show more" doesn't persist across openings.
    whatsnewExpanded = false;
    renderWhatsNew();
    whatsnewOverlay.classList.add('show');
    // onOpen() runs first and moves focus into the What's new dialog
    // synchronously; only then do we make the About layer inert. This ordering
    // means the trigger (inside About) never sits focused inside an inert
    // subtree, even transiently.
    whatsnewFocus.onOpen();
    // The About layer stays visually behind this sub-dialog, but must not be a
    // second active modal for assistive tech. Inert the whole About OVERLAY
    // (the element that carries role="dialog" aria-modal="true"), so its modal
    // semantics are removed too — not just the card contents. The What's new
    // overlay is a sibling, so it is unaffected.
    aboutOverlay.setAttribute('inert', '');
    aboutOverlay.setAttribute('aria-hidden', 'true');
  }
  function closeWhatsNew() {
    whatsnewOverlay.classList.remove('show');
    // Re-enable the About layer BEFORE restoring focus — focus can't land on an
    // element inside an inert subtree, and onClose() restores focus to the
    // What's new trigger, which lives inside the About card.
    aboutOverlay.removeAttribute('inert');
    aboutOverlay.removeAttribute('aria-hidden');
    whatsnewFocus.onClose(); // restores focus to the What's new trigger in About
  }

  whatsnewOpen.addEventListener('click', openWhatsNew);
  whatsnewClose.addEventListener('click', closeWhatsNew);
  whatsnewOverlay.addEventListener('click', function (e) {
    if (e.target === whatsnewOverlay) closeWhatsNew();
  });
  // Escape closes the What's new sub-dialog first (it's on top of About).
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && whatsnewOverlay.classList.contains('show')) {
      closeWhatsNew();
    }
  });

  // Resize handling (orientation changes, window resize).
  window.addEventListener('resize', sizeBoard);
  window.addEventListener('orientationchange', function () {
    setTimeout(sizeBoard, 100);
  });

  // --- boot ----------------------------------------------------------------
  // Visible build marker, sourced from the engine (js/game.js VERSION). If the
  // tab title / console don't show the expected version, the browser is serving
  // a cached copy — do a hard reload (Ctrl+Shift+R) or bump the "?v=" strings.
  var BUILD = 'v' + G.VERSION;
  console.log('Jumping Squares build ' + BUILD + ' loaded');
  document.title = 'Jumping Squares (' + BUILD + ')';
  var buildTagEl = document.getElementById('build-tag');
  if (buildTagEl) {
    buildTagEl.textContent = BUILD;
    // The tag doubles as a discreet "About" trigger (see index.html styling).
    buildTagEl.addEventListener('click', openAbout);
  }
  var aboutVersionEl = document.getElementById('about-version');
  if (aboutVersionEl) aboutVersionEl.textContent = 'Build ' + BUILD;

  // Seamless restore: if a valid saved game exists, adopt it as the live state
  // BEFORE the grid is built, so the player resumes exactly where they left off
  // after a reload / reopened tab. This happens regardless of the auto-save
  // toggle — "off" only stops WRITING new saves; an existing, valid save is
  // still honoured (and the Persistence panel shows a note explaining it).
  // Corrupt saves are discarded inside boardStore.load() (logged + removed), so
  // a null return simply means "boot the fresh game created above".
  (function restoreSavedGame() {
    // Adopt the persisted board SIZE first, so the fresh board and the
    // dimension gate (fitsDimensions) both match the user's chosen size. A
    // saved game is only restored when it matches that size; a size change
    // therefore starts fresh at the new size (never resurrects a differently-
    // sized board).
    var chosen = prefs.getBoardSize();
    ROWS = chosen;
    COLS = chosen;
    // Pass a predicate so an engine-valid but UI-incompatible save is rejected
    // BEFORE rehydration (no large allocation for, e.g., a 1000x1000 board).
    // This UI is fixed at ROWS x COLS / PLAYERS; the engine validator stays
    // generous for a future board-size picker.
    var restored = boardStore.load(fitsDimensions);
    if (!restored) {
      // No save to resume: open the fresh board with the PERSISTED starting
      // player (turn-taking alternates across completed games and is remembered
      // across reloads). Rebuild via createGame so BOTH `current` and
      // `startingPlayer` are set consistently — patching only `current` would
      // leave startingPlayer at 1, and a later auto-save (current=2,
      // startingPlayer=1) would then be rejected by loadState on the next
      // reload, discarding the game.
      state = G.createGame({
        rows: ROWS, cols: COLS, players: PLAYERS,
        startingPlayer: prefs.getStartingPlayer(),
      });
      return;
    }
    // Defence-in-depth: the pre-load predicate above already rejects mismatched
    // dimensions before rehydration, but re-check the rehydrated state too in
    // case the two ever diverge. Normally unreachable.
    if (restored.rows !== ROWS || restored.cols !== COLS ||
        restored.players !== PLAYERS) {
      boardStore.remove();
      state = G.createGame({
        rows: ROWS, cols: COLS, players: PLAYERS,
        startingPlayer: prefs.getStartingPlayer(),
      });
      return;
    }
    state = restored;
    if (state.winner !== G.EMPTY) {
      // A FINISHED game was restored: show the board + standalone New button but
      // NOT the "X wins!" modal (per the layered end-game design). Also mark the
      // win as already recorded so render()'s one-shot tally guard does not
      // double-count a win that was tallied when the game actually ended.
      suppressWinnerModal = true;
      winRecorded = true;
    }
  })();

  buildGrid();
  renderStats(); // set the stats-panel visibility BEFORE sizing the board
  sizeBoard();
  render();
})();
