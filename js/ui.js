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
  var statusEl = document.getElementById('status');
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
  var PREFS_KEY = 'jumping_squares:prefs';
  var PREFS_VERSION = 2; // v2 adds `score`; v1 (names only) migrates forward

  var prefs = (function () {
    // In-memory cache / fallback. `score` tracks the win tally for the active
    // name pair: which seat (1/2) has won how many rounds. `pair` records the
    // names those wins belong to (bookkeeping + future multi-pair support).
    var mem = {
      v: PREFS_VERSION,
      playerNames: {},
      score: { pair: { 1: '', 2: '' }, wins: { 1: 0, 2: 0 } },
      // Auto-save the board between sessions. ON by default (the whole point is
      // guarding against accidental reloads / tab closure). Persisted here in
      // the PREFS record — independent of the board save itself — so turning it
      // off is remembered even when there is no saved board. See the Persistence
      // section in Settings.
      autoSave: true,
    };

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

        // autoSave: a boolean preference. Present from the build that introduced
        // persistence; absent in older (v1/v2 names+score) records, which keep
        // the default (true). Only adopt an explicit boolean, so garbage falls
        // back to the default rather than being coerced.
        if (typeof parsed.autoSave === 'boolean') {
          mem.autoSave = parsed.autoSave;
        }

        // Score: understood only at THIS schema version. We deliberately read it
        // only when parsed.v === PREFS_VERSION, not ">=": a record written by a
        // newer build (parsed.v > PREFS_VERSION) may have a different score
        // shape, so this older code must not reinterpret it under v2 assumptions
        // — it keeps the stable names and starts the score fresh instead. Older
        // records (v1) have no score and likewise start fresh.
        var haveScore = false;
        if (parsed.v === PREFS_VERSION && parsed.score &&
            typeof parsed.score === 'object') {
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
      // Reset the tally to 0:0 and stamp the pair it now belongs to. Called on
      // any rename COMMIT (the documented, button-less way to reset the score).
      resetScore: function (name1, name2) {
        mem.score.pair = { 1: name1 || '', 2: name2 || '' };
        mem.score.wins = { 1: 0, 2: 0 };
        persist();
      },
      // --- auto-save preference ---
      getAutoSave: function () { return mem.autoSave !== false; },
      setAutoSave: function (on) {
        mem.autoSave = !!on;
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
  var SAVE_KEY = 'jumping_squares:save';
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

      /** True iff a (parseable, present) save exists under our key. */
      has: function () {
        if (!canStore) return false;
        try {
          return window.localStorage.getItem(SAVE_KEY) !== null;
        } catch (e) {
          return false;
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
       */
      load: function () {
        if (!canStore) return null;
        var raw;
        try {
          raw = window.localStorage.getItem(SAVE_KEY);
        } catch (e) {
          return null;
        }
        if (raw === null) return null; // nothing saved: not an error

        var discard = function (reason, offending) {
          // Log the (sanitised) offending content so a real corruption can be
          // investigated, then remove it so it can't wedge every future boot.
          try {
            console.warn('Jumping Squares: discarding unusable saved game (' +
              reason + '): ' + sanitizeForLog(offending));
          } catch (e2) { /* ignore logging failures */ }
          try { window.localStorage.removeItem(SAVE_KEY); } catch (e3) {}
          return null;
        };

        var wrapper;
        try {
          wrapper = JSON.parse(raw);
        } catch (e) {
          return discard('invalid JSON', raw);
        }
        if (!wrapper || typeof wrapper !== 'object' ||
            wrapper.format !== SAVE_FORMAT) {
          return discard('unrecognised format', raw);
        }

        wrapper = migrate(wrapper); // N3 seam (identity for now)

        var clean = G.loadState(wrapper.state);
        if (clean === null) {
          return discard('failed validation', raw);
        }
        return clean;
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

  // The name to display for player n: custom (stored) name if set, else default.
  function playerName(n) {
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
      if (cell.value > cap) el.classList.add('overloaded');
      el.innerHTML = pipMarkup(cell.value, cap);
    }

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
    if (state.winner !== G.EMPTY && !winRecorded) {
      winRecorded = true;
      prefs.addWin(state.winner);
    }

    var counts = G.ownershipCounts(state);
    var parts = [];
    for (var p = 1; p <= state.players; p++) {
      parts.push(playerName(p) + ': ' + counts[p]);
    }
    // Append the running tally, e.g. "Alice: 10, Bob: 9   (1 - 0)".
    statusEl.textContent = parts.join(', ') + '   ' + scoreLabel();

    if (state.winner !== G.EMPTY) {
      // Layer 2: the standalone New button is always shown when the game is
      // over (both live wins and restored finished games).
      endgameBar.classList.add('show');
      // Layer 3: the "X wins!" modal is shown only for a LIVE win, never when a
      // finished game is merely restored from storage (suppressWinnerModal).
      if (suppressWinnerModal) {
        overlay.classList.remove('show');
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
        overlay.classList.add('show');
      }
    } else {
      endgameBar.classList.remove('show');
      endgameBar.classList.remove('sole-cta');
      overlay.classList.remove('show');
    }
  }

  // --- rename current player (click the turn label on your turn) -----------
  // Renaming is allowed only during a live turn: not while a cascade is
  // animating/stepping (busy) and not after a win. The name is cosmetic and
  // persisted via prefs; renaming never consumes a turn or changes game state.
  var renaming = false; // true while the inline editor is open

  function canRenameNow() {
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
        // Any rename COMMIT resets the win tally to 0:0 for the (new) pair —
        // the documented, button-less way to reset the score. This fires on
        // Enter/blur regardless of whether the value actually changed; Esc
        // (cancel) takes the other branch and leaves the score intact.
        prefs.resetScore(playerName(1), playerName(2));
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

  // Finalise a turn (set winner or advance player) AND persist the now-settled
  // board. Used in place of a bare G.finalizeAfterCascade(state) at every site
  // where a move resolves (instant / timed / manual step, and the mid-cascade
  // mode switches), so auto-save fires exactly once per completed turn.
  function finalizeTurn() {
    G.finalizeAfterCascade(state);
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
      render();
      if (!cascadeSettled()) {
        animSchedule();
        return;
      }
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

  // --- new game ------------------------------------------------------------
  function newGame() {
    playToken++;   // invalidate any in-flight cascade animation
    if (animTimer !== null) { clearTimeout(animTimer); animTimer = null; }
    resumeAnimation = null; // drop any parked (paused) animation
    busy = false;  // unlock input
    stepping.active = false; // cancel any manual step-through in progress
    winRecorded = false;     // the next game's win hasn't been tallied yet
    suppressWinnerModal = false; // a live win in the new game shows its dialog
    state = G.createGame({ rows: ROWS, cols: COLS, players: PLAYERS });
    buildGrid();
    sizeBoard();
    render();
    // Overwrite any saved game with this fresh board (when auto-save is on), so
    // the previous (possibly finished) game is not resurrected on next reload.
    autoSaveIfOn();
  }

  document.getElementById('new-game').addEventListener('click', newGame);
  document.getElementById('play-again').addEventListener('click', newGame);
  endgameNew.addEventListener('click', newGame);
  stepBtn.addEventListener('click', commitOneStep);

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

  // --- accessible dialog focus management ----------------------------------
  // Shared by the Settings and About dialogs. When a modal opens we (1) remember
  // what had focus, (2) move focus into the dialog, and (3) trap Tab within it
  // so keyboard/screen-reader users can't wander behind the overlay. On close
  // we restore focus to the element that opened the dialog.
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

    function onKeydown(e) {
      if (e.key !== 'Tab') return;
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

    return {
      onOpen: function () {
        lastFocused = document.activeElement;
        var pref = preferredFocusId && document.getElementById(preferredFocusId);
        var items = focusables(cardEl);
        var target = pref || items[0] || cardEl;
        // Focus synchronously. The overlay's `.show` class is added by the
        // caller before onOpen(), so the card is already displayed and
        // focusable. Doing this synchronously matters for nested dialogs: the
        // caller can then make the layer behind inert *after* focus has already
        // moved into this dialog, with no transient "focused element inside an
        // inert subtree" window.
        if (target && target.focus) target.focus();
        overlayEl.addEventListener('keydown', onKeydown);
      },
      onClose: function () {
        overlayEl.removeEventListener('keydown', onKeydown);
        if (lastFocused && lastFocused.focus) lastFocused.focus();
        lastFocused = null;
      },
    };
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
    if (e.key === 'Escape' && settingsOverlay.classList.contains('show')) {
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

  // Reflect the current persistence state in the panel. Two derived states:
  //   - note shown  : auto-save OFF *and* a saved game exists (the only case a
  //                   silent restore-next-time could surprise the user);
  //   - remove enabled: exactly the same condition — there is removable data
  //                   that isn't being continuously rewritten by an active
  //                   auto-save. With auto-save ON, removing is pointless (the
  //                   next move rewrites it), so the button is disabled.
  function syncPersistenceUI() {
    var on = prefs.getAutoSave();
    var hasSave = boardStore.has();
    if (autoSaveToggle) autoSaveToggle.checked = on;
    var orphanSave = (!on && hasSave);
    if (persistenceNote) persistenceNote.hidden = !orphanSave;
    if (removeSaveBtn) removeSaveBtn.disabled = !orphanSave;
  }

  if (autoSaveToggle) {
    autoSaveToggle.addEventListener('change', function () {
      prefs.setAutoSave(this.checked);
      // Turning auto-save ON should immediately capture the current board (so a
      // reload right after enabling restores this game, not nothing). Turning
      // it OFF leaves any existing save intact (it will still restore; the note
      // explains that).
      if (this.checked) autoSaveIfOn();
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

  // Render the curated entries once (newest first, as authored in the engine).
  // Built with DOM APIs (not innerHTML) so entry text is inserted as plain text
  // and can't be interpreted as markup.
  function renderWhatsNew() {
    var entries = (G.CHANGELOG || []);
    whatsnewList.innerHTML = '';
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
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
      whatsnewList.appendChild(li);
    }
  }
  renderWhatsNew();

  function openWhatsNew() {
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
    var restored = boardStore.load();
    if (!restored) return;
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
