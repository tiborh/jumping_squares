/*
 * SPDX-FileCopyrightText: 2025 tiborh
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
  var stepBtn = document.getElementById('step-btn');

  var playerColorVar = ['', '--p1', '--p2', '--p3', '--p4'];

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
    var pad = 16; // matches #board-wrap padding budget
    var availW = boardWrap.clientWidth - pad;
    var availH = boardWrap.clientHeight - pad;
    // Keep cells square: constrain by aspect ratio of the grid.
    var cellSize = Math.floor(Math.min(availW / state.cols, availH / state.rows));
    if (cellSize < 1) cellSize = 1;
    boardEl.style.width = (cellSize * state.cols) + 'px';
    boardEl.style.height = (cellSize * state.rows) + 'px';
  }

  // --- rendering -----------------------------------------------------------
  function pipMarkup(value) {
    if (value <= 0) return '';
    if (value > 6) {
      // Defensive fallback for unexpectedly large stacks.
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
      el.innerHTML = pipMarkup(cell.value);
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

    // Turn indicator.
    var color = getComputedStyle(document.documentElement)
      .getPropertyValue(playerColorVar[state.current]) || '#fff';
    turnDot.style.background = color.trim();
    turnLabel.textContent = 'Player ' + state.current;

    var counts = G.ownershipCounts(state);
    var parts = [];
    for (var p = 1; p <= state.players; p++) parts.push('P' + p + ': ' + counts[p]);
    statusEl.textContent = parts.join('   ');

    if (state.winner !== G.EMPTY) {
      winnerMsg.textContent = 'Player ' + state.winner + ' wins!';
      overlay.classList.add('show');
    } else {
      overlay.classList.remove('show');
    }
  }

  // --- input ---------------------------------------------------------------
  var busy = false; // true while a cascade animation is playing (locks input)
  var playToken = 0; // bumped by newGame() to invalidate in-flight animations

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

  function startStepMode(r, c) {
    if (!G.placeDot(state, state.current, r, c)) return;
    if (!G.hasOverflow(state)) {
      // No propagation: behave like a normal placement.
      G.finalizeAfterCascade(state);
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
    if (state.winner !== G.EMPTY || !G.hasOverflow(state)) {
      // Cascade finished on this step.
      G.finalizeAfterCascade(state);
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
    if (!G.hasOverflow(state)) return null;
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
    render(); // show the placement immediately

    // No propagation: just finalise the turn (matches "only the click action").
    if (!G.hasOverflow(state)) {
      G.finalizeAfterCascade(state);
      render();
      return;
    }

    busy = true;
    var myToken = playToken;
    function stepOnce() {
      // Abort if a new game started while this animation was pending.
      if (myToken !== playToken) return;
      // Stop if a winner emerged mid-cascade or the board stabilised.
      if (state.winner === G.EMPTY && G.hasOverflow(state)) {
        G.stepOverflowsOnce(state);
        render();
        // Re-check: another generation pending?
        if (state.winner === G.EMPTY && G.hasOverflow(state)) {
          scheduleNext();
          return;
        }
      }
      // Cascade complete.
      G.finalizeAfterCascade(state);
      render();
      busy = false;
    }
    function scheduleNext() {
      if (myToken !== playToken) return;
      if (delayMs > 0) setTimeout(stepOnce, delayMs);
      else stepOnce(); // 0 ms: resolve immediately, no visible pause
    }
    // Kick off the first generation after the initial delay.
    scheduleNext();
  }

  // --- new game ------------------------------------------------------------
  function newGame() {
    playToken++;   // invalidate any in-flight cascade animation
    busy = false;  // unlock input
    stepping.active = false; // cancel any manual step-through in progress
    state = G.createGame({ rows: ROWS, cols: COLS, players: PLAYERS });
    buildGrid();
    sizeBoard();
    render();
  }

  document.getElementById('new-game').addEventListener('click', newGame);
  document.getElementById('play-again').addEventListener('click', newGame);
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
  var settingsBtn = document.getElementById('settings-btn');
  var settingsClose = document.getElementById('settings-close');
  var delayRange = document.getElementById('delay-range');
  var delayValue = document.getElementById('delay-value');

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

  function openSettings() {
    settingsOverlay.classList.add('show');
  }
  function closeSettings() {
    settingsOverlay.classList.remove('show');
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
    // finish it instantly so the board can't get stuck waiting for > clicks.
    if (wasStepping && !settings.stepMode) {
      while (state.winner === G.EMPTY && G.hasOverflow(state)) {
        G.stepOverflowsOnce(state);
      }
      G.finalizeAfterCascade(state);
      stepping.active = false;
      busy = false;
      render();
    }
  });

  // Initialise readout from the default slider position.
  sliderIndexToSetting(parseInt(delayRange.value, 10));
  updateDelayReadout();

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
  if (buildTagEl) buildTagEl.textContent = BUILD;

  buildGrid();
  sizeBoard();
  render();
})();
