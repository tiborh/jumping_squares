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

  // --- configuration (Iteration 1: fixed 5x5, two human players) ----------
  var ROWS = 5;
  var COLS = 5;
  var PLAYERS = 2;

  var state = G.createGame({ rows: ROWS, cols: COLS, players: PLAYERS });

  // --- DOM refs ------------------------------------------------------------
  var boardEl = document.getElementById('board');
  var boardWrap = document.getElementById('board-wrap');
  var turnDot = document.getElementById('turn-dot');
  var turnLabel = document.getElementById('turn-label');
  var statusCountsEl = document.getElementById('status-counts');
  var tallyBtn = document.getElementById('tally-btn');
  var overlay = document.getElementById('winner-overlay');
  var winnerMsg = document.getElementById('winner-msg');
  var winnerScoreEl = document.getElementById('winner-score');
  var endgameBar = document.getElementById('endgame-bar');
  var endgameNew = document.getElementById('endgame-new');
  var stepBtn = document.getElementById('step-btn');

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
  var PREFS_VERSION = 8; // v8: per-seat `randomLevel`; v7: per-seat `tutorLevel`; v6: `startingPlayer`; v5: per-seat sharkDepth; v4 adds `playerType`; v3 adds `autoSave`; v2 adds `score`; v1 names only

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
      // --- Shark difficulty (search depth), per seat ---
      getSharkDepth: function (n) {
        var d = mem.sharkDepth[n];
        return (d === 2 || d === 3 || d === 4) ? d : 3;
      },
      setSharkDepth: function (n, d) {
        d = parseInt(d, 10);
        mem.sharkDepth[n] = (d === 2 || d === 3 || d === 4) ? d : 3;
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

  // --- responsive sizing: largest square that fits the wrap ----------------
  function sizeBoard() {
    // clientWidth/clientHeight INCLUDE padding, so subtract the wrap's actual
    // computed padding to get the true content area. The extra bottom padding
    // (a tag-safe strip) is therefore fully honoured: the board can never be
    // sized under the fixed, interactive build tag, even on short/narrow
    // viewports. A small extra margin keeps the board off the very edges.
    var cs = getComputedStyle(boardWrap);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    var margin = 8; // small breathing room beyond the padding
    var availW = boardWrap.clientWidth - padX - margin;
    var availH = boardWrap.clientHeight - padY - margin;
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
    // While the inline rename editor is open, leave the label (input) alone.
    if (!renaming) {
      turnLabel.textContent = (state.winner !== G.EMPTY)
        ? (playerName(state.winner) + ' wins')
        : playerName(state.current);
      updateTurnLabelAffordance();
    }

    // Record the win exactly once, the moment the engine declares a winner.
    // This sits here because state.winner is set via finalizeAfterCascade in
    // every mode (instant, timed, and manual step), so a single guard covers
    // all paths. newGame() clears winRecorded for the next round.
    recordWinOnce();

    var counts = G.ownershipCounts(state);
    var parts = [];
    for (var p = 1; p <= state.players; p++) {
      parts.push(playerName(p) + ': ' + counts[p]);
    }
    // Tile counts render into a pushable button that doubles as the New Game
    // control (clicking it asks "New game?" with confirmation). It is disabled
    // once the game is over — then the end-game bar's New Game button is the
    // sole restart path, so there's exactly one New-Game affordance per state.
    // The running tally is a separate button (resets the score, with confirm).
    statusCountsEl.textContent = parts.join(', ');
    statusCountsEl.disabled = (state.winner !== G.EMPTY);
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
  }

  // --- rename current player (click the turn label on your turn) -----------
  // Renaming is allowed only during a live turn: not while a cascade is
  // animating/stepping (busy) and not after a win. The name is cosmetic and
  // persisted via prefs; renaming never consumes a turn or changes game state.
  var renaming = false; // true while the inline editor is open

  function canRenameNow() {
    // AI-controlled seats aren't renamed (their label is the agent name).
    if (prefs.getPlayerType(state.current) !== 'human') return false;
    return !renaming && !busy && !stepping.active && state.winner === G.EMPTY;
  }

  // Reflect clickability on the label (pointer cursor + title) when live.
  function updateTurnLabelAffordance() {
    if (canRenameNow()) {
      turnLabel.classList.add('editable');
      turnLabel.title = 'Click to rename ' + playerName(state.current);
      turnLabel.setAttribute('role', 'button');
      turnLabel.setAttribute('tabindex', '0');
    } else {
      turnLabel.classList.remove('editable');
      turnLabel.removeAttribute('title');
      turnLabel.removeAttribute('role');
      turnLabel.removeAttribute('tabindex');
    }
  }

  function beginRename() {
    if (!canRenameNow()) return;
    renaming = true;
    var n = state.current;
    var current = playerName(n);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'turn-name-input';
    input.maxLength = MAX_NAME_LEN;
    input.value = current;
    input.setAttribute('aria-label', 'Rename player ' + n);

    // Swap the label for the input.
    turnLabel.textContent = '';
    turnLabel.appendChild(input);
    // Drop the button-like semantics while the input is mounted (renaming is
    // now true, so this removes .editable + role/tabindex/title). Avoids
    // exposing a button that contains a textbox to assistive tech.
    updateTurnLabelAffordance();
    input.focus();
    input.select();

    var done = false;
    function commit(save) {
      if (done) return;
      done = true;
      renaming = false;
      if (save) {
        // Empty -> clear custom name (revert to default). Sanitised either way.
        var clean = sanitizeName(input.value);
        var def = defaultPlayerName(n);
        prefs.setPlayerName(n, (clean && clean !== def) ? clean : '');
        // Renaming is now PURELY cosmetic: it has no side effect on the win
        // tally. The tally is reset only via its own control (click the tally
        // pill in the status line, which asks for confirmation). This keeps
        // "change a name" and "start a fresh series" as separate, deliberate
        // actions.
      }
      render(); // rebuilds the label text (and affordance) from current state
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
      // Don't let keys bubble to any global handlers while editing.
      e.stopPropagation();
    });
    input.addEventListener('blur', function () { commit(true); });
    // Clicks inside the input shouldn't retrigger the label handler.
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  turnLabel.addEventListener('click', beginRename);
  turnLabel.addEventListener('keydown', function (e) {
    // Keyboard activation of the label-as-button (Enter/Space) when not editing.
    if (!renaming && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      beginRename();
    }
  });

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
    if (busy || stepping.active || paused) return; // let the current action finish
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
      if (busy || stepping.active || paused || !isAITurn()) return;
      var agent = agentFor(prefs.getPlayerType(state.current), state.current);
      if (!agent) return;
      var mv = agent.chooseMove(state);
      if (!mv) return; // no legal move (shouldn't happen before a winner)
      if (settings.stepMode) startStepMode(mv.r, mv.c);
      else playMoveAnimated(mv.r, mv.c, settings.delayMs);
    }, pace);
  }

  // --- new game ------------------------------------------------------------
  function newGame() {
    playToken++;   // invalidate any in-flight cascade animation
    if (animTimer !== null) { clearTimeout(animTimer); animTimer = null; }
    resumeAnimation = null; // drop any parked (paused) animation
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
      // the first board cell so keyboard focus is not stranded on a hidden
      // element (the top-bar New Game button no longer exists).
      if (cellEls && cellEls[0] && cellEls[0].focus) {
        cellEls[0].focus();
      }
    }
  }

  document.getElementById('play-again').addEventListener('click', newGame);
  endgameNew.addEventListener('click', newGame);
  stepBtn.addEventListener('click', commitOneStep);

  // --- new game (click the tile-count pill) --------------------------------
  // The tile-count readout doubles as the New Game control during play. It asks
  // for confirmation first so a stray tap doesn't abandon a game mid-play. It is
  // disabled once the game is over (render() sets .disabled), since the end-game
  // bar then provides the New Game button.
  if (statusCountsEl) {
    statusCountsEl.addEventListener('click', function () {
      if (statusCountsEl.disabled) return;
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
    syncPlayerTypeUI();  // reflect current player types
    settingsFocus.onOpen();
  }
  function closeSettings() {
    settingsOverlay.classList.remove('show');
    settingsFocus.onClose();
    paused = false;
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
    syncSharkLevelUI();
    syncTutorLevelUI();
    syncRandomLevelUI();
  }

  function onPlayerTypeChange(n, sel) {
    prefs.setPlayerType(n, sel.value);
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

  // Keep the Reload checkbox honest: enabled only when at least one of the two
  // data groups is selected (reloading clears nothing by itself). When it gets
  // disabled it is also unchecked; when it becomes enabled again it re-checks
  // (the default), and OK is disabled when nothing at all is selected.
  function syncResetDialog() {
    var anyData = resetGroupPrefs.checked || resetGroupBoard.checked;
    resetGroupReload.disabled = !anyData;
    if (!anyData) resetGroupReload.checked = false;
    else if (!resetGroupReload.checked) resetGroupReload.checked = true;
    if (resetOk) resetOk.disabled = !anyData;
  }

  function openReset() {
    // Fresh defaults each time: all three groups checked.
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
      // rebuilds the grid, re-renders, clears any end-of-game modal, and (if
      // auto-save is on) persists the fresh board.
      newGame();
    }
    if (doPrefs) {
      // Preferences reset in place: resync the Players/difficulty controls and
      // the turn label so they show defaults rather than stale values.
      syncPlayerTypeUI();
      // The propagation delay is an in-memory session setting (not persisted),
      // so clearing storage doesn't touch it; a reload would reset it to the
      // default on its own. For an in-place reset (no reload) do the same by
      // hand so the live slider also reads first-use (default 500 ms).
      settings.delayMs = 500;
      settings.stepMode = false;
      if (delayRange) { delayRange.value = 5; } // index 5 -> 500 ms
      updateDelayReadout();
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
  sizeBoard();
  render();
})();
