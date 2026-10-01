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
  var VERSION = '23';

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
  // Keep it short (the panel shows the most recent handful). The newest entry's
  // version must not exceed VERSION — a test guards against drift.
  var CHANGELOG = [
    { v: '23', text: 'Win tally: the score (wins per player) is kept for the current name pair; renaming a player resets it.' },
    { v: '22', text: 'Rename a player by clicking their name on their turn; names are remembered in this browser.' },
    { v: '21', text: 'About now has a "What\u2019s new" panel (this one) summarising recent, player-relevant changes.' },
    { v: '18', text: 'About/Settings dialogs handle keyboard focus; the corner build tag no longer overlaps the board.' },
    { v: '16', text: 'Click the small build tag (bottom-left corner) to open the About panel: description, source link, licence.' },
    { v: '15', text: 'Settings (\u2699): choose how a cascade spreads \u2014 Instant, timed (100\u20131000 ms), or manual \u203A Step with a preview.' },
    { v: '5',  text: 'Iteration 1: playable 5\u00d75 two-player game \u2014 overflow, capture, chain reactions; win by owning the whole board.' },
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
      current: 1,            // current player (1-based)
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
    cloneState: cloneState,
  };
});
