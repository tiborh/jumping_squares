/*
 * SPDX-FileCopyrightText: 2025 - 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Jumping Squares — pure game logic (no DOM dependencies).
 *
 * This module is deliberately free of any browser/DOM code so it can be:
 *   - imported by the browser UI (via a plain <script> tag), and
 *   - loaded by a Node test harness (via require) for automated rule checks.
 *
 * Rules implemented (KJumpingCube-style):
 *   - Rectangular grid of cells. Each cell has a "capacity" equal to the
 *     number of its orthogonal neighbours:
 *         corner cells  -> 2
 *         edge cells    -> 3
 *         interior cells-> 4
 *   - A player may add one point to a cell that is empty/neutral or already
 *     owned by them. They may NOT add to an opponent-owned cell.
 *   - When a cell's point count EXCEEDS its capacity (value > capacity), it
 *     "overflows": it sends one point to each orthogonal neighbour and its own
 *     value is reduced by (capacity + 1). Neighbours that receive a point
 *     become owned by the overflowing cell's owner (capture).
 *   - Overflows can cascade (chain reaction) until no cell exceeds capacity,
 *     OR until one player owns every non-empty cell (early win short-circuit).
 *   - A player wins when the opponent owns zero cells (after at least one
 *     point has been placed by each — i.e. once the board is contested).
 *
 * The state is intentionally plain data so it is easy to serialise, snapshot
 * (for undo), or feed to a future AI.
 */

(function (root, factory) {
  // UMD-ish dual export: CommonJS (Node) or global (browser).
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JumpingSquares = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Single source of truth for the build version. Bump this on every change
  // that ships to the browser. The UI reads it to show a build tag (tab title
  // + console log) so a running build is always identifiable. NOTE: the
  // cache-busting "?v=N" query strings on the <script> tags in index.html are
  // separate and must be edited by hand to match — the browser only re-fetches
  // a script when its URL literally changes.
  var VERSION = '33';

  // Curated "What's new" list, surfaced in the About > What's new panel.
  //
  // This is a hand-picked, PLAYER-FACING excerpt — only changes that affect how
  // someone uses the game/interface, newest first. It is intentionally NOT one
  // entry per build: internal-only bumps (CI, refactors, cache-busting) are
  // omitted. The fuller, condensed history with background/lessons lives in
  // CHANGELOG.md (linked from the panel).
  //
  // Entry shape:
  //   { v: '18', text: 'What changed, in one player-facing line.' }
  //   { v: '19', text: '...', experimental: true }  // early-test / not-yet-complete
  //
  // STORAGE CAP: keep at most WHATSNEW_MAX (12) entries here — the panel can
  // never display more than that inline (it shows 5, then "Show more" expands
  // to the full stored set, capped at 12), so there is no reason to ship older
  // entries in the JS. When adding a new entry at the top, drop the oldest to
  // stay within the cap. The COMPLETE history (including entries trimmed from
  // here) lives in CHANGELOG.md, reachable via the panel's "See full changelog"
  // link. A test enforces this cap and the newest-version/ordering invariants.
  var WHATSNEW_MAX = 12;
  var CHANGELOG = [
    { v: '33', text: 'Turn-taking: after a game ends, New Game / Play Again now lets the OTHER player open the next game (it alternates across completed games and is remembered). Resetting the win tally can also reset who starts \u2014 there\u2019s a checkbox for it in the reset dialog.' },
    { v: '32', text: 'The \u201CWhat\u2019s new\u201D list now shows the 5 most recent entries; \u201CShow more\u201D expands the rest, and \u201CSee full changelog\u201D opens the complete history.' },
    { v: '31', text: 'Really fix the stray \u201Cafter-flash\u201D: the leftover pulse was an intermittent timing race, now removed by only redrawing squares that actually changed and ending each flash on the animation itself rather than a guessed timer.' },
    { v: '30', text: 'Fixes to the new placement flash: no more stray \u201Cafter-flash\u201D on some squares once a cascade settles. Also, the propagation delay now paces AI-vs-AI play, so two computer players no longer race by \u2014 raise the delay to watch them think.' },
    { v: '29', text: 'Placing a dot now flashes the square and its dots, and the pulse follows the cascade as it spreads \u2014 easier to see what just changed. New players start against the Tutor AI (Player 2). When both players are Shark, each has its own difficulty. Settings: \u201CPropagation speed\u201D is now \u201CPropagation delay\u201D (clearer that higher = slower).' },
    { v: '28', text: 'New AI opponent \u2014 Shark: it searches moves ahead and plays strongly, exploiting cascades. Pick it per player under Settings \u2192 Players, and set its difficulty (Easy / Medium / Hard).' },
    { v: '27', text: 'Play against the computer: under Settings \u2192 Players, set either player to Random or Tutor (a simple human-style AI). AI moves use your propagation speed. A stronger AI is planned.', experimental: true },
    { v: '26', text: 'Top-bar tidy-up: the win tally is now a button (click to reset to 0 : 0, with confirmation), and the tile-count readout starts a New Game (also with confirmation). Renaming a player no longer resets the tally. Confirmations use an in-app dialog.' },
    { v: '25', text: 'Auto-save: your game is kept in this browser and restored after a reload or reopened tab. Turn it off (and clear saved data) under Settings \u2192 Persistence.' },
    { v: '24', text: 'Win tally: the score (wins per player) is kept for the current name pair; renaming a player resets it.' },
    { v: '22', text: 'Rename a player by clicking their name on their turn; names are remembered in this browser.' },
    { v: '21', text: 'About now has a "What\u2019s new" panel (this one) summarising recent, player-relevant changes.' },
  ];

  // Owner sentinel for an empty/neutral cell.
  var EMPTY = 0;

  /**
   * Create a fresh game state.
   * @param {Object} [opts]
   * @param {number} [opts.rows=5]
   * @param {number} [opts.cols=5]
   * @param {number} [opts.players=2]
   * @returns {Object} game state
   */
  function createGame(opts) {
    opts = opts || {};
    var rows = opts.rows || 5;
    var cols = opts.cols || 5;
    var players = opts.players || 2;

    if (rows < 2 || cols < 2) {
      throw new Error('Board must be at least 2x2');
    }
    if (players < 2) {
      throw new Error('Need at least 2 players');
    }

    // Which player moves first. Defaults to player 1. Lets the caller rotate
    // the opening move across games (the UI alternates it after a completed
    // game). Must be a valid player id (1..players); anything else falls back
    // to 1 so a bad value can never produce an out-of-range current player.
    var startingPlayer = opts.startingPlayer;
    if (typeof startingPlayer !== 'number' || !isFinite(startingPlayer) ||
        Math.floor(startingPlayer) !== startingPlayer ||
        startingPlayer < 1 || startingPlayer > players) {
      startingPlayer = 1;
    }

    var cells = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        cells.push({ owner: EMPTY, value: 0 });
      }
    }

    return {
      rows: rows,
      cols: cols,
      players: players,
      cells: cells,          // flat array, index = r * cols + c
      current: startingPlayer, // current player (1-based); first mover this game
      moveCount: 0,          // total points placed across the game
      // How many turns each player has taken (index 0 unused). A player only
      // becomes "in the game" once they have taken at least one turn, so no
      // player can be eliminated before they get to place their opening dot.
      turnsTaken: new Array(players + 1).fill(0),
      winner: EMPTY,         // 0 while ongoing, else winning player id
    };
  }

  // ---- index helpers -------------------------------------------------------

  function idx(state, r, c) {
    return r * state.cols + c;
  }

  function inBounds(state, r, c) {
    return r >= 0 && r < state.rows && c >= 0 && c < state.cols;
  }

  /** Orthogonal neighbour indices of a cell. */
  function neighbours(state, r, c) {
    var out = [];
    var deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var i = 0; i < deltas.length; i++) {
      var nr = r + deltas[i][0];
      var nc = c + deltas[i][1];
      if (inBounds(state, nr, nc)) {
        out.push(idx(state, nr, nc));
      }
    }
    return out;
  }

  /** Capacity of a cell = number of orthogonal neighbours (2, 3, or 4). */
  function capacity(state, r, c) {
    return neighbours(state, r, c).length;
  }

  // ---- queries -------------------------------------------------------------

  /** Can the given player legally add a point to (r, c)? */
  function canPlay(state, player, r, c) {
    if (state.winner !== EMPTY) return false;
    if (player !== state.current) return false;
    if (!inBounds(state, r, c)) return false;
    var cell = state.cells[idx(state, r, c)];
    return cell.owner === EMPTY || cell.owner === player;
  }

  /**
   * Count of cells by owner. Returns an array indexed by owner id, where
   * index 0 (EMPTY) is the number of neutral cells and 1..players are the
   * cells owned by each player.
   */
  function ownershipCounts(state) {
    var counts = new Array(state.players + 1).fill(0);
    for (var i = 0; i < state.cells.length; i++) {
      counts[state.cells[i].owner]++;
    }
    return counts;
  }

  /**
   * Check whether the game has been won and return the winner id (or EMPTY).
   *
   * Per the KJumpingCube rules, "the winner is the player who ends up owning
   * all the cubes". A win therefore requires a single player to own EVERY
   * square on the board — there must be no opponent-owned cells AND no neutral
   * cells left. While any neutral square remains, the other player can still
   * move onto it, so the game is not over even if they currently own nothing.
   *
   * The turnsTaken gate is also kept: a winner is only declared once every
   * player has taken at least one turn, so an opening cascade cannot end the
   * game before another player has had the chance to place their first dot.
   */
  function checkWinner(state) {
    for (var p = 1; p <= state.players; p++) {
      if (state.turnsTaken[p] === 0) return EMPTY; // someone hasn't played yet
    }
    var counts = ownershipCounts(state);
    if (counts[EMPTY] > 0) return EMPTY; // neutral squares remain -> not over
    var owners = [];
    for (var q = 1; q <= state.players; q++) {
      if (counts[q] > 0) owners.push(q);
    }
    return owners.length === 1 ? owners[0] : EMPTY;
  }

  /**
   * True when a single player owns EVERY cell (no neutral cells, no other
   * owners). This is the physical terminal condition for a cascade: once one
   * player holds the whole board, further overflows only shuffle points within
   * that player's own territory forever and can never change ownership. It is
   * independent of checkWinner's turn-gate (which governs *declaring* a winner)
   * — a cascade must stop here even if, say, an opponent never took a turn,
   * otherwise resolution never terminates.
   * @returns {number} the sole owner id, or EMPTY if the board is not yet
   *                   owned by exactly one player.
   */
  function soleOwner(state) {
    var counts = ownershipCounts(state);
    if (counts[EMPTY] > 0) return EMPTY;
    var owner = EMPTY;
    for (var p = 1; p <= state.players; p++) {
      if (counts[p] > 0) {
        if (owner !== EMPTY) return EMPTY; // more than one owner
        owner = p;
      }
    }
    return owner;
  }

  // ---- mutation ------------------------------------------------------------

  /**
   * Resolve all overflows via a queue-based cascade. Mutates state.cells.
   * Short-circuits if a single owner takes the whole (non-empty) board mid-cascade.
   * @param {Object} state
   * @param {Array<number>} seed - indices to check first
   * @param {Object} [events] - optional collector: { steps: [...] } for animation/testing
   */
  function resolveOverflows(state, seed, events) {
    var queue = seed.slice();

    while (queue.length > 0) {
      var i = queue.shift();
      var r = Math.floor(i / state.cols);
      var c = i % state.cols;
      var cell = state.cells[i];
      var cap = capacity(state, r, c);

      if (cell.value <= cap) continue;

      // Overflow: send one point to each neighbour and subtract exactly that
      // many from this cell. Since capacity == neighbour count, this conserves
      // the total number of points on the board (nothing is destroyed): e.g. a
      // corner (cap 2) at value 3 gives 1 to each of its 2 neighbours and keeps
      // 1 for itself (3 -> 1). The cell only empties when it drops to 0.
      var owner = cell.owner;
      var nbrs = neighbours(state, r, c);
      cell.value -= nbrs.length;
      if (cell.value === 0) cell.owner = EMPTY;

      for (var n = 0; n < nbrs.length; n++) {
        var ncell = state.cells[nbrs[n]];
        ncell.value += 1;
        ncell.owner = owner; // capture
        queue.push(nbrs[n]);
      }

      if (events) {
        events.steps.push({
          from: i,
          to: nbrs.slice(),
          owner: owner,
        });
      }

      // Early termination: once one player physically owns the whole board,
      // further overflows only shuffle points within their own territory and
      // never terminate. Stop here (checkWinner's turn-gate still governs
      // whether a WIN is *declared* afterwards).
      if (soleOwner(state) !== EMPTY) {
        break;
      }
    }
  }

  // ---- incremental (stepped) cascade --------------------------------------
  //
  // The functions above resolve a whole cascade at once (used for the instant
  // path and by the existing tests). For animated / manual step-by-step play
  // the UI needs to advance the cascade one "generation" at a time, rendering
  // the intermediate board between generations. A generation = every cell that
  // is currently over capacity overflows once, simultaneously. Visually this
  // is a wave spreading outward — the phenomenon we want players to be able to
  // watch (how one placement can flip a board).

  /** Indices of all cells currently over capacity (value > neighbour count). */
  function cellsOverCapacity(state) {
    var out = [];
    for (var i = 0; i < state.cells.length; i++) {
      var r = Math.floor(i / state.cols);
      var c = i % state.cols;
      if (state.cells[i].value > capacity(state, r, c)) out.push(i);
    }
    return out;
  }

  /** True if any cell is over capacity (i.e. the cascade is not yet stable). */
  function hasOverflow(state) {
    return cellsOverCapacity(state).length > 0;
  }

  /**
   * Perform exactly ONE generation of overflows: every cell that is currently
   * over capacity overflows once, simultaneously. Mutates state.cells.
   *
   * "Simultaneously" matters: we read the set of overflowing cells first, then
   * apply all their spreads against a snapshot of the pre-generation values, so
   * that two neighbours overflowing in the same generation both contribute to a
   * shared neighbour (order-independent, deterministic).
   *
   * @param {Object} state
   * @param {Object} [events] - optional collector: { steps: [...] }, one entry
   *                            per overflowing cell in this generation.
   * @returns {boolean} true if this generation changed anything (a step
   *                    happened); false if the board was already stable.
   */
  function stepOverflowsOnce(state, events) {
    var over = cellsOverCapacity(state);
    if (over.length === 0) return false;

    // Snapshot current values AND owners so the generation resolves against a
    // fixed pre-generation state (true simultaneity, order-independent).
    var baseValue = state.cells.map(function (cl) { return cl.value; });
    var baseOwner = state.cells.map(function (cl) { return cl.owner; });

    // Deltas applied to values; owner captures applied as we go.
    var delta = new Array(state.cells.length).fill(0);

    for (var k = 0; k < over.length; k++) {
      var i = over[k];
      var r = Math.floor(i / state.cols);
      var c = i % state.cols;
      var nbrs = neighbours(state, r, c);
      var owner = baseOwner[i]; // read from snapshot, not the mutating state

      // This cell sends one point to each neighbour (based on its snapshot).
      delta[i] -= nbrs.length;
      for (var n = 0; n < nbrs.length; n++) {
        var j = nbrs[n];
        delta[j] += 1;
        state.cells[j].owner = owner; // capture (last writer in a generation
                                      // wins; ties are rare and cosmetic)
      }

      if (events) {
        events.steps.push({ from: i, to: nbrs.slice(), owner: owner });
      }
    }

    // Commit deltas; recompute owners for emptied cells.
    for (var m = 0; m < state.cells.length; m++) {
      if (delta[m] !== 0) {
        state.cells[m].value = baseValue[m] + delta[m];
        if (state.cells[m].value === 0) state.cells[m].owner = EMPTY;
      }
    }
    return true;
  }

  /**
   * Apply a move: player adds one point to (r, c), then resolve cascades.
   * @param {Object} state
   * @param {number} player
   * @param {number} r
   * @param {number} c
   * @param {Object} [events] - optional cascade event collector
   * @returns {boolean} true if the move was legal and applied
   */
  function applyMove(state, player, r, c, events) {
    if (!canPlay(state, player, r, c)) return false;

    var i = idx(state, r, c);
    var cell = state.cells[i];
    cell.value += 1;
    cell.owner = player;
    state.moveCount += 1;
    state.turnsTaken[player] += 1;

    resolveOverflows(state, [i], events);

    var w = checkWinner(state);
    if (w !== EMPTY) {
      state.winner = w;
    } else {
      // Advance to next player.
      state.current = (state.current % state.players) + 1;
    }
    return true;
  }

  // ---- stepped-move helpers (for animated / manual cascade playback) -------
  //
  // The instant path (applyMove) places a dot and resolves the whole cascade in
  // one call. For animation/manual stepping the UI needs to (1) place the dot,
  // (2) advance the cascade one generation at a time via stepOverflowsOnce,
  // rendering between generations, then (3) finalise the turn. These two
  // helpers provide steps (1) and (3); the middle is driven by the UI.

  /**
   * Place a single dot for `player` at (r, c) and update move bookkeeping, but
   * do NOT resolve any resulting overflow. Use with stepOverflowsOnce +
   * finalizeAfterCascade to drive a stepped cascade.
   * @returns {boolean} true if placed (legal move); false if illegal.
   */
  function placeDot(state, player, r, c) {
    if (!canPlay(state, player, r, c)) return false;
    var i = idx(state, r, c);
    state.cells[i].value += 1;
    state.cells[i].owner = player;
    state.moveCount += 1;
    state.turnsTaken[player] += 1;
    return true;
  }

  /**
   * Finalise a turn after a (possibly stepped) cascade has fully resolved:
   * set the winner if the board is decided, otherwise advance to the next
   * player. Mirrors the tail of applyMove. Safe to call when there was no
   * overflow at all.
   */
  function finalizeAfterCascade(state) {
    var w = checkWinner(state);
    if (w !== EMPTY) {
      state.winner = w;
    } else {
      state.current = (state.current % state.players) + 1;
    }
  }

  // ---- validation / rehydration ------------------------------------------
  //
  // loadState() turns an UNTRUSTED plain object (from localStorage, an imported
  // file, or a future format-migration step) into a known-good game state, or
  // returns null if it cannot. It is deliberately strict and side-effect-free:
  // it never mutates its input and never throws for bad data — callers treat a
  // null return as "discard this, start fresh". This single primitive is the
  // one gate used by (1) restore-on-boot, (2) file import (later phase), and
  // (3) schema migration (validate AFTER converting), so correctness here is
  // load-bearing for all persistence.

  function isPlainInt(n) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
  }

  /**
   * Validate and normalise an arbitrary object into a clean game state.
   *
   * Checks performed:
   *   - rows/cols are integers >= 2; players is an integer >= 2.
   *   - cells is an array of exactly rows*cols entries, each { owner, value }
   *     with owner an integer in 0..players and value a non-negative integer.
   *   - current is an integer in 1..players.
   *   - winner is an integer in 0..players (0 = ongoing).
   *   - moveCount is a non-negative integer.
   *   - turnsTaken is an array of length players+1 of non-negative integers
   *     (index 0 unused), reconstructed defensively if missing/malformed.
   *   - An owned cell (owner != EMPTY) must have value >= 1, and an empty cell
   *     (owner == EMPTY) must have value 0 — the engine's own invariant.
   *
   * @param {*} obj - untrusted candidate state
   * @returns {Object|null} a fresh, independent clean state, or null if invalid
   */
  function loadState(obj) {
    if (!obj || typeof obj !== 'object') return null;

    var rows = obj.rows, cols = obj.cols, players = obj.players;
    // Lower AND upper bounds. The upper caps matter for safety, not just
    // sanity: without them a crafted value like players=4294967295 passes the
    // integer check and then throws RangeError at `new Array(players + 1)`
    // below — an exception the caller (boardStore.load) does not catch, so one
    // malformed stored value would abort boot instead of being discarded. The
    // caps are far above any real game (the UI is 5x5/2) yet well under array
    // limits, so legitimate saves are unaffected.
    var MAX_DIM = 1000;      // per-axis cell count ceiling
    var MAX_PLAYERS = 100;   // player-count ceiling
    var MAX_VALUE = 1000;    // per-cell dot count ceiling
    if (!isPlainInt(rows) || rows < 2 || rows > MAX_DIM) return null;
    if (!isPlainInt(cols) || cols < 2 || cols > MAX_DIM) return null;
    if (!isPlainInt(players) || players < 2 || players > MAX_PLAYERS) return null;

    if (!Array.isArray(obj.cells)) return null;
    if (obj.cells.length !== rows * cols) return null;

    if (!isPlainInt(obj.current) || obj.current < 1 || obj.current > players) {
      return null;
    }
    var winner = obj.winner;
    if (!isPlainInt(winner) || winner < 0 || winner > players) return null;
    if (!isPlainInt(obj.moveCount) || obj.moveCount < 0) return null;

    // Turn order invariant:
    // - For an ongoing state (winner == 0), current must match completed moveCount
    //   (moves alternate strictly starting from player 1).
    // - For a terminal state (winner != 0), the winning move was made by the winner,
    //   so moveCount must be >= 1, current must equal winner, and winner must match
    //   the player who made the last move.
    if (winner === EMPTY) {
      if (obj.current !== (obj.moveCount % players) + 1) return null;
    } else {
      if (obj.moveCount < 1) return null;
      if (obj.current !== winner) return null;
      if (winner !== ((obj.moveCount - 1) % players) + 1) return null;
    }

    // Rebuild cells, enforcing per-cell invariants.
    var cells = new Array(obj.cells.length);
    var pointTotal = 0;
    for (var i = 0; i < obj.cells.length; i++) {
      var src = obj.cells[i];
      if (!src || typeof src !== 'object') return null;
      var owner = src.owner, value = src.value;
      if (!isPlainInt(owner) || owner < 0 || owner > players) return null;
      if (!isPlainInt(value) || value < 0 || value > MAX_VALUE) return null;
      // Invariant coupling owner and value: empty <=> value 0.
      if (owner === EMPTY && value !== 0) return null;
      if (owner !== EMPTY && value < 1) return null;
      pointTotal += value;
      cells[i] = { owner: owner, value: value };
    }
    if (pointTotal !== obj.moveCount) return null;

    // turnsTaken: accept a well-formed array of length players+1. For malformed
    // or missing values, finished states are rejected because their turn-gate
    // cannot be proven; ongoing states reconstruct deterministic turn counts
    // from moveCount and the strict player order below.
    //
    // NOTE: this is built BEFORE the winner is validated, because the winner
    // check below depends on turnsTaken (the engine's win rule includes a
    // turn-gate: every player must have taken a turn).
    var turnsTaken;
    if (Array.isArray(obj.turnsTaken) && obj.turnsTaken.length === players + 1) {
      turnsTaken = new Array(players + 1).fill(0);
      var okTurns = true;
      var sumTurns = 0;
      for (var t = 0; t < obj.turnsTaken.length; t++) {
        var tv = obj.turnsTaken[t];
        if (!isPlainInt(tv) || tv < 0) { okTurns = false; break; }
        turnsTaken[t] = tv;
        if (t >= 1) sumTurns += tv;
      }
      if (okTurns) {
        var expectedBase = Math.floor(obj.moveCount / players);
        var expectedRemainder = obj.moveCount % players;
        if (turnsTaken[0] !== 0) okTurns = false;
        for (var expectedP = 1; okTurns && expectedP <= players; expectedP++) {
          var expected = expectedBase +
            (expectedP <= expectedRemainder ? 1 : 0);
          if (turnsTaken[expectedP] !== expected) okTurns = false;
        }

        // Invariant: any player who owns cells MUST have taken at least one
        // turn (cells start neutral and only become owned when a player moves).
        // If obj.turnsTaken reports 0 turns for an active cell owner, it is
        // inconsistent and falls back to conservative reconstruction.
        var cellCounts = new Array(players + 1).fill(0);
        for (var cIdx = 0; cIdx < cells.length; cIdx++) cellCounts[cells[cIdx].owner]++;
        for (var pIdx = 1; pIdx <= players; pIdx++) {
          if (cellCounts[pIdx] > 0 && turnsTaken[pIdx] < 1) { okTurns = false; break; }
        }
      }
      if (!okTurns) turnsTaken = null;
    }

    // A finished save MUST have a faithful, verified turnsTaken array: without
    // it, the turn-gate cannot be proven (the loser owns no cells, so any
    // reconstruction is ambiguous/fabricated). Reject malformed finished saves.
    if (winner !== EMPTY && !turnsTaken) return null;

    if (!turnsTaken) {
      // For an ongoing game, reconstruct turnsTaken deterministically from
      // moveCount and player turn order (M moves alternate strictly among
      // players 1..players).
      turnsTaken = new Array(players + 1).fill(0);
      var baseTurns = Math.floor(obj.moveCount / players);
      var remTurns = obj.moveCount % players;
      for (var p = 1; p <= players; p++) {
        turnsTaken[p] = baseTurns + (p <= remTurns ? 1 : 0);
      }
      // Invariant: any player who owns cells MUST have taken at least one turn.
      // If moveCount was too low for an active cell owner (e.g. moveCount: 0
      // with owned cells), the state is physically impossible: reject it rather
      // than bumping turns and violating the sum(turnsTaken) === moveCount invariant.
      var ownerCounts = new Array(players + 1).fill(0);
      for (var k = 0; k < cells.length; k++) ownerCounts[cells[k].owner]++;
      for (var pIdx2 = 1; pIdx2 <= players; pIdx2++) {
        if (ownerCounts[pIdx2] > 0 && turnsTaken[pIdx2] < 1) {
          return null;
        }
      }
    }

    // Assemble the candidate and validate its WINNER against the engine's own
    // rule rather than re-implementing it here. checkWinner enforces BOTH the
    // physical condition (one player owns every cell, no neutral cells) AND the
    // turn-gate (every player has taken at least one turn). Requiring the stored
    // `winner` to equal checkWinner(candidate) rejects any inconsistent save:
    //   - winner set over a contested/empty board (physical condition fails);
    //   - winner set with all cells owned but a player never moved
    //     (turn-gate fails — e.g. turnsTaken [0,0,0]);
    //   - winner cleared (0) on a board the engine would have decided.
    // This also means a finished save whose turnsTaken was not faithfully
    // stored (so reconstruction can't prove every player moved) is rejected
    // rather than restored as a bogus "finished" game.
    var candidate = {
      rows: rows,
      cols: cols,
      players: players,
      current: obj.current,
      moveCount: obj.moveCount,
      turnsTaken: turnsTaken,
      winner: winner,
      cells: cells,
    };
    if (checkWinner(candidate) !== winner) return null;

    // Reject a physically-terminal board that is NOT a declared win. If one
    // player owns every cell (soleOwner != EMPTY) but winner is EMPTY — only
    // possible when the turn-gate was not met, e.g. an opponent never moved —
    // the position is unreachable in real play and, if restored, is permanently
    // stuck: the opponent has no legal move (no empty and no own cells) and no
    // winner is declared. The engine would never persist such an ongoing state,
    // so treat it as invalid. (A genuine terminal with winner set is handled by
    // the checkWinner equality above; a legitimate ongoing game always has
    // neutral cells or more than one owner, so soleOwner is EMPTY here.)
    if (winner === EMPTY && soleOwner(candidate) !== EMPTY) return null;

    // Ongoing game contract: the current player must have at least one legal
    // move. A player can move if at least one cell is neutral (EMPTY) or owned
    // by that player. If there are no neutral cells and the current player owns
    // no cells, they cannot play and the restored game would be permanently stuck.
    if (winner === EMPTY) {
      var hasMove = false;
      for (var m = 0; m < cells.length; m++) {
        if (cells[m].owner === EMPTY || cells[m].owner === candidate.current) {
          hasMove = true;
          break;
        }
      }
      if (!hasMove) return null;
    }

    // Settled-state contract. Persistence intentionally stores only SETTLED
    // boards (the end-state of a move); mid-cascade snapshots are out of scope
    // by design. So reject any candidate that still has a cell over capacity —
    // UNLESS one player physically owns the whole board, which is the single
    // legitimate case where a board can stay perpetually over capacity (further
    // overflows only shuffle points within one owner's territory). Without this
    // check, a crafted save with an overloaded cell on a contested board would
    // be adopted and rendered as a settled, playable position whose pending
    // cascade never resumes.
    if (hasOverflow(candidate) && soleOwner(candidate) === EMPTY) return null;

    return candidate;
  }

  /** Deep-ish clone for snapshots (undo, AI lookahead). */
  function cloneState(state) {
    return {
      rows: state.rows,
      cols: state.cols,
      players: state.players,
      current: state.current,
      moveCount: state.moveCount,
      turnsTaken: state.turnsTaken.slice(),
      winner: state.winner,
      cells: state.cells.map(function (c) {
        return { owner: c.owner, value: c.value };
      }),
    };
  }

  return {
    EMPTY: EMPTY,
    VERSION: VERSION,
    CHANGELOG: CHANGELOG,
    WHATSNEW_MAX: WHATSNEW_MAX,
    createGame: createGame,
    idx: idx,
    inBounds: inBounds,
    neighbours: neighbours,
    capacity: capacity,
    canPlay: canPlay,
    ownershipCounts: ownershipCounts,
    checkWinner: checkWinner,
    soleOwner: soleOwner,
    applyMove: applyMove,
    cellsOverCapacity: cellsOverCapacity,
    hasOverflow: hasOverflow,
    stepOverflowsOnce: stepOverflowsOnce,
    placeDot: placeDot,
    finalizeAfterCascade: finalizeAfterCascade,
    loadState: loadState,
    cloneState: cloneState,
  };
});
