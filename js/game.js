/*
 * SPDX-FileCopyrightText: 2025 tiborh
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
  var VERSION = '5';

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

      // Early termination: if the whole contested board is one colour, stop.
      if (checkWinner(state) !== EMPTY) {
        break;
      }
    }
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
    createGame: createGame,
    idx: idx,
    inBounds: inBounds,
    neighbours: neighbours,
    capacity: capacity,
    canPlay: canPlay,
    ownershipCounts: ownershipCounts,
    checkWinner: checkWinner,
    applyMove: applyMove,
    cloneState: cloneState,
  };
});
