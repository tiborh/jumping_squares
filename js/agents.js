/*
 * SPDX-FileCopyrightText: 2025 - 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Jumping Squares — AI agents (SPIKE / experimental, not wired into the UI).
 *
 * Dependency-free and DOM-free, like js/game.js, and dual-exported (browser
 * global `window.JumpingSquaresAgents` + Node `module.exports`). It takes the
 * engine module as an argument so it never hard-codes a load path:
 *
 *     var A = JumpingSquaresAgents;              // (browser global)
 *     var agent = A.makeTutor(JumpingSquares);   // pass the engine in
 *     var move  = agent.chooseMove(state);       // -> { r, c } or null
 *
 * An "agent" is just: { name, chooseMove(state) -> {r,c}|null }. It plays as
 * `state.current` (whoever is to move). This is step 1 + 2 of the AI roadmap
 * item: a legal-move generator plus a Random baseline and a 1-ply, human-style
 * "Tutor" heuristic agent. The deep-search "Shark" (minimax) is a later step.
 *
 * Determinism: agents may use a seedable RNG so agent-vs-agent runs are
 * reproducible; pass a function returning [0,1) as `rng`, else Math.random.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JumpingSquaresAgents = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- legal-move generator ------------------------------------------------

  /**
   * All moves the given player may legally make in `state`. Defaults to the
   * player to move (state.current). Returns an array of { r, c }.
   */
  function legalMoves(G, state, player) {
    if (player === undefined) player = state.current;
    var out = [];
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        if (G.canPlay(state, player, r, c)) out.push({ r: r, c: c });
      }
    }
    return out;
  }

  // ---- small helpers -------------------------------------------------------

  function defaultRng() { return Math.random(); }

  function pickRandom(arr, rng) {
    return arr[Math.floor((rng || defaultRng)() * arr.length)];
  }

  // Pick the max-scoring entry; ties broken randomly so repeated games vary and
  // an agent isn't trivially predictable.
  function argmax(items, scoreOf, rng) {
    var best = [];
    var bestScore = -Infinity;
    for (var i = 0; i < items.length; i++) {
      var s = scoreOf(items[i]);
      if (s > bestScore) { bestScore = s; best = [items[i]]; }
      else if (s === bestScore) { best.push(items[i]); }
    }
    return best.length === 1 ? best[0] : pickRandom(best, rng);
  }

  // ---- Random agent (baseline) --------------------------------------------

  function makeRandom(G, opts) {
    opts = opts || {};
    var rng = opts.rng || defaultRng;
    return {
      name: 'Random',
      chooseMove: function (state) {
        var moves = legalMoves(G, state);
        return moves.length ? pickRandom(moves, rng) : null;
      },
    };
  }

  // ---- Tutor agent (1-ply, human-style heuristic) -------------------------
  //
  // Scores each legal move by looking exactly ONE move ahead (place + resolve
  // the cascade on a clone) and evaluating the resulting board from the mover's
  // point of view, using the documented human tips (see docs/strategy-notes.md):
  //   - winning immediately is best;
  //   - prefer capturing opponent cells (ownership swing);
  //   - prefer low-capacity cells (corners, then edges) — fewer steps to erupt;
  //   - avoid placing a cell ADJACENT to an enemy "critical" cell (one short of
  //     erupting), i.e. don't hand the opponent an easy capture;
  //   - mild bonus for making one of your own cells critical (loaded, ready).
  // Deliberately shallow (1-ply) so it plays "understandably" and is beatable —
  // suitable for teaching. It does NOT deep-search cascades (that's Shark).

  // Is cell index i one short of erupting (critical) for its owner?
  function isCritical(G, state, i) {
    var r = Math.floor(i / state.cols);
    var c = i % state.cols;
    return state.cells[i].value === G.capacity(state, r, c);
  }

  function makeTutor(G, opts) {
    opts = opts || {};
    var rng = opts.rng || defaultRng;
    // Weights (hand-set for the spike; the agent-vs-agent harness is the knob
    // for tuning these later).
    var W = {
      win: 100000,
      ownDelta: 10,     // per net cell gained vs before the move
      capture: 6,       // per opponent cell captured this move
      lowCapacity: 4,   // bonus for the PLACED cell having low capacity (corner>edge)
      ownCritical: 2,   // per own critical cell after the move
      adjEnemyCritical: 12, // penalty for the placed cell sitting next to enemy-critical
    };

    function evaluateAfter(before, after, me, placedIdx) {
      // Win short-circuit.
      if (after.winner === me) return W.win;
      if (after.winner !== G.EMPTY && after.winner !== me) return -W.win;

      var opp = (me % after.players) + 1; // 2-player assumption for the spike
      var cb = G.ownershipCounts(before);
      var ca = G.ownershipCounts(after);

      var score = 0;
      // Net own-cell swing (captures + new cell), and opponent cells removed.
      score += W.ownDelta * (ca[me] - cb[me]);
      score += W.capture * Math.max(0, cb[opp] - ca[opp]);

      // Placed-cell position: corners (cap 2) beat edges (cap 3) beat interior.
      var pr = Math.floor(placedIdx / after.cols);
      var pc = placedIdx % after.cols;
      var cap = G.capacity(after, pr, pc);
      score += W.lowCapacity * (4 - cap); // corner +8, edge +4, interior 0 (x weight)

      // Reward own critical cells (loaded, ready to erupt next turn).
      for (var i = 0; i < after.cells.length; i++) {
        if (after.cells[i].owner === me && isCritical(G, after, i)) {
          score += W.ownCritical;
        }
      }

      // Penalise the placed cell being adjacent to an enemy critical cell (they
      // could erupt and capture it). Evaluated on the BEFORE board (the threat
      // that existed when we chose to place there).
      var nbrs = G.neighbours(before, pr, pc);
      for (var n = 0; n < nbrs.length; n++) {
        var j = nbrs[n];
        if (before.cells[j].owner === opp && isCritical(G, before, j)) {
          score -= W.adjEnemyCritical;
        }
      }
      return score;
    }

    return {
      name: 'Tutor',
      chooseMove: function (state) {
        var me = state.current;
        var moves = legalMoves(G, state, me);
        if (!moves.length) return null;
        return argmax(moves, function (m) {
          var clone = G.cloneState(state);
          var placedIdx = m.r * state.cols + m.c;
          G.applyMove(clone, me, m.r, m.c);
          return evaluateAfter(state, clone, me, placedIdx);
        }, rng);
      },
    };
  }

  return {
    legalMoves: legalMoves,
    makeRandom: makeRandom,
    makeTutor: makeTutor,
  };
});
