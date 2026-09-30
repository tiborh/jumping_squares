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
    // clientWidth/clientHeight already exclude #board-wrap's padding (content
    // box), including the extra bottom strip that keeps the board clear of the
    // fixed build tag. `pad` is just a small extra safety margin on top of that.
    var pad = 16;
    var availW = boardWrap.clientWidth - pad;
    var availH = boardWrap.clientHeight - pad;
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
  var paused = false;          // true while the Settings dialog is open
  var resumeAnimation = null;  // callback to resume a paused animated cascade
  var animTimer = null;        // pending setTimeout id for the next generation

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
    if (cascadeSettled()) {
      // Cascade finished (stable) or the game is decided — stop here.
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
    render(); // show the placement immediately

    // No propagation (or instantly decided): just finalise the turn.
    if (cascadeSettled()) {
      G.finalizeAfterCascade(state);
      render();
      return;
    }

    busy = true;
    animToken = playToken;
    animDelayMs = delayMs;
    animSchedule(); // kick off; module-scoped so open/close can pause/resume
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
    G.finalizeAfterCascade(state);
    render();
    busy = false;
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
        // Defer focus until after the overlay is shown/laid out.
        setTimeout(function () { if (target && target.focus) target.focus(); }, 0);
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
        G.finalizeAfterCascade(state);
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
        G.finalizeAfterCascade(state);
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
  // Escape closes it (desktop convenience).
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && aboutOverlay.classList.contains('show')) {
      closeAbout();
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

  buildGrid();
  sizeBoard();
  render();
})();
