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
    // Difficulty level: 'easy' (default) or 'medium'. Both are the "chaos"
    // family — positionally blind, clearly distinct from Tutor (heuristic on
    // EVERY move):
    //   Easy   : PURE random — any legal move, uniformly. The gentle beginner.
    //   Medium : random MOST of the time, but when the opponent could capture
    //            one of my cells on their very next move AND I have a capturing
    //            reply, strike first ("hit back"), taking the capture that
    //            removes the most opponent cells (ties random). Otherwise random.
    // Why not an "always strike to conquer" level: agent-vs-agent testing showed
    // greedily grabbing every capture is actually WEAKER than only hitting back
    // when threatened (~45% vs ~55%) — this game is swingy, so firing cascades
    // early tends to hand the opponent a bigger counter. Reactive hit-back, by
    // contrast, beats pure random decisively (~85%). So the two levels are
    // pure-random (Easy) and reactive-hit-back (Medium); the conquer idea was
    // dropped as counterproductive. (The ranking metric among hits barely moved
    // the needle in testing, so the simple "cells captured" tiebreak is used.)
    // Unknown level values fall back to easy.
    var level = (opts.level === 'medium') ? 'medium' : 'easy';
    return {
      name: 'Random',
      level: level,
      chooseMove: function (state) {
        return chooseRandomMove(G, state, level, rng);
      },
    };
  }

  // How many opponent cells a candidate move captures at the SETTLED end state
  // (net): oppCount(before) - oppCount(after). 0 if the move captures nothing.
  // Resolved via the engine's instant applyMove on a clone.
  function captureCount(G, state, player, r, c) {
    var opp = (player % state.players) + 1;
    var before = G.ownershipCounts(state)[opp];
    var clone = G.cloneState(state);
    if (!G.applyMove(clone, player, r, c)) return 0;
    return Math.max(0, before - G.ownershipCounts(clone)[opp]);
  }

  // Candidate capturing moves for `me`, each tagged with its capture count.
  function capturingMoves(G, state, me, moves) {
    var out = [];
    for (var k = 0; k < moves.length; k++) {
      var n = captureCount(G, state, me, moves[k].r, moves[k].c);
      if (n > 0) out.push({ move: moves[k], captures: n });
    }
    return out;
  }

  // Pick the capturing move that takes the most opponent cells; ties random.
  function bestHit(hits, rng) {
    return argmax(hits, function (h) { return h.captures; }, rng).move;
  }

  // Does the opponent have an immediate capturing reply against `me` from this
  // position? The "immediate danger" trigger for Medium's reactive hit-back
  // (Easy never probes — it plays pure random).
  function opponentCanCaptureNow(G, state, me, opp) {
    var myNow = G.ownershipCounts(state)[me];
    // Build an opponent-to-move view: legalMoves()/canPlay() gate on `current`,
    // so enumerate AND simulate against a clone whose current is the opponent.
    var oppView = G.cloneState(state);
    oppView.current = opp;
    var oppMoves = legalMoves(G, oppView, opp);
    for (var k = 0; k < oppMoves.length; k++) {
      var cl = G.cloneState(oppView);
      if (!G.applyMove(cl, opp, oppMoves[k].r, oppMoves[k].c)) continue;
      if (myNow - G.ownershipCounts(cl)[me] > 0) return true;
    }
    return false;
  }

  function chooseRandomMove(G, state, level, rng) {
    var me = state.current;
    var opp = (me % state.players) + 1;
    var moves = legalMoves(G, state, me);
    if (!moves.length) return null;

    // Medium: reactive hit-back. Only when the opponent could capture one of my
    // cells on their very next move do we look for a capturing reply and strike
    // the one that takes the most opponent cells. Not threatened -> play random.
    if (level === 'medium' && opponentCanCaptureNow(G, state, me, opp)) {
      var hits = capturingMoves(G, state, me, moves);
      if (hits.length) return bestHit(hits, rng);
    }

    // Easy (always) and Medium-when-unthreatened: chaos.
    return pickRandom(moves, rng);
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

  // --- Tutor-Medium reactive helpers (1-cell-radius local play) ------------
  //
  // Medium is Easy PLUS awareness of the single-cell neighbourhood (edge- AND
  // vertex-sharing) around its own pieces: it contests local "arms races" that
  // a human sets up to out-build a Tutor corner/edge (the fortress exploit).
  // It reasons ONLY within radius 1 — that is Tutor's defining characteristic
  // (and its limit vs Shark). See docs/strategy-notes.md.

  // The 8 surrounding cells (orthogonal + diagonal) of (r,c), in bounds.
  function radius1(G, state, r, c) {
    var out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < state.rows && cc >= 0 && cc < state.cols) {
          out.push({ r: rr, c: cc, diag: (dr !== 0 && dc !== 0) });
        }
      }
    }
    return out;
  }

  // Would placing one dot at (r,c) for `me` capture >=1 opponent cell AND do so
  // by ERUPTING (the placed cell goes over capacity and cascades)? Medium only
  // values an immediate capture when it comes from an eruption (its 1-radius
  // "win the race at the moment of blast" idea), not a passive flip.
  function captureByEruption(G, state, me, opp, r, c) {
    var cap = G.capacity(state, r, c);
    var i = r * state.cols + c;
    if (state.cells[i].value + 1 <= cap) return 0; // placing wouldn't erupt
    var before = G.ownershipCounts(state)[opp];
    var clone = G.cloneState(state);
    if (!G.applyMove(clone, me, r, c)) return 0;
    return Math.max(0, before - G.ownershipCounts(clone)[opp]);
  }

  // Index helper.
  function at(state, r, c) { return state.cells[r * state.cols + c]; }

  // The v37 Tutor-Medium "winning term": how many of `me`'s cells could the
  // opponent capture on their single best reply from `state` (place + resolve
  // the cascade)? Evaluated on an opponent-to-move clone (canPlay/applyMove gate
  // on `current`). This is a reactive, one-move-ahead "don't leave a cell
  // hanging" measure — dissection showed it is what made v37 Medium beat Easy
  // ~85% (it stops blundering capturable cells, especially in the saturated
  // late game). Reused here so Medium keeps that strength.
  function opponentBestImmediateCapture(G, state, me, opp) {
    var view = G.cloneState(state);
    view.current = opp;
    var oppMoves = legalMoves(G, view, opp);
    var myNow = G.ownershipCounts(state)[me];
    var worst = 0;
    for (var k = 0; k < oppMoves.length; k++) {
      var cl = G.cloneState(view);
      if (!G.applyMove(cl, opp, oppMoves[k].r, oppMoves[k].c)) continue;
      var lost = myNow - G.ownershipCounts(cl)[me];
      if (lost > worst) worst = lost;
    }
    return worst;
  }

  function makeTutor(G, opts) {
    opts = opts || {};
    var rng = opts.rng || defaultRng;
    // Difficulty level: 'easy' (the original 1-ply positional heuristic, a
    // gentle first opponent) or 'medium' (Easy PLUS 1-cell-radius reactive
    // play: it watches the cells touching its own pieces and contests local
    // arms races, so the "approach a corner and out-build it" fortress that
    // beats Easy no longer works). Unknown values fall back to easy.
    var level = (opts.level === 'medium') ? 'medium' : 'easy';

    // Weights (hand-set; the agent-vs-agent harness is the knob for tuning).
    var W = {
      win: 100000,
      ownDelta: 10,     // per net cell gained vs before the move
      capture: 6,       // per opponent cell captured this move
      lowCapacity: 4,   // bonus for the PLACED cell having low capacity (corner>edge)
      ownCritical: 2,   // per own critical cell after the move
      adjEnemyCritical: 12, // penalty for the placed cell sitting next to enemy-critical
      oppCapture: 14,   // (Medium) penalty per own cell the opponent could
                        //  capture on their immediate reply — the v37 term.
    };

    // Easy's positional one-ply evaluation. For MEDIUM it also subtracts the
    // v37 capture-avoidance term, so the positional/fallback scoring already
    // prefers moves that don't hand the opponent an immediate capture.
    function evaluateAfter(before, after, me, placedIdx) {
      if (after.winner === me) return W.win;
      if (after.winner !== G.EMPTY && after.winner !== me) return -W.win;

      var opp = (me % after.players) + 1;
      var cb = G.ownershipCounts(before);
      var ca = G.ownershipCounts(after);

      var score = 0;
      score += W.ownDelta * (ca[me] - cb[me]);
      score += W.capture * Math.max(0, cb[opp] - ca[opp]);

      var pr = Math.floor(placedIdx / after.cols);
      var pc = placedIdx % after.cols;
      var cap = G.capacity(after, pr, pc);
      score += W.lowCapacity * (4 - cap);

      for (var i = 0; i < after.cells.length; i++) {
        if (after.cells[i].owner === me && isCritical(G, after, i)) {
          score += W.ownCritical;
        }
      }

      var nbrs = G.neighbours(before, pr, pc);
      for (var n = 0; n < nbrs.length; n++) {
        var j = nbrs[n];
        if (before.cells[j].owner === opp && isCritical(G, before, j)) {
          score -= W.adjEnemyCritical;
        }
      }

      // v37 capture-avoidance (Medium only): penalise leaving cells capturable
      // on the opponent's immediate reply.
      if (level === 'medium' && after.winner === G.EMPTY) {
        score -= W.oppCapture * opponentBestImmediateCapture(G, after, me, opp);
      }
      return score;
    }

    function easyMove(state, me) {
      var moves = legalMoves(G, state, me);
      if (!moves.length) return null;
      return argmax(moves, function (m) {
        var clone = G.cloneState(state);
        var placedIdx = m.r * state.cols + m.c;
        G.applyMove(clone, me, m.r, m.c);
        return evaluateAfter(state, clone, me, placedIdx);
      }, rng);
    }

    // Medium's 1-cell-radius reactive move, or null if there is nothing local
    // to contest (then Medium falls back to easyMove). Priority order:
    //   1. An eruption-capture available in the neighbourhood -> take the best.
    //   2. Edge-adjacent enemy race -> reinforce my approached cell to stay >=.
    //   3. Vertex-only (diagonal) enemy near my cell -> occupy the favourable
    //      in-between edge cell to extend influence (per the rules below).
    function mediumReactiveMove(state, me, opp) {
      var cols = state.cols, rows = state.rows;

      // --- 1. Eruption-capture: play my own neighbourhood cell whose placement
      //        erupts and captures the most opponent cells. (Only eruption
      //        captures count — Medium's "capture at the moment of blast".)
      var bestCap = null, bestCapN = 0;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (!G.canPlay(state, me, r, c)) continue;
          var n = captureByEruption(G, state, me, opp, r, c);
          if (n > bestCapN) { bestCapN = n; bestCap = { r: r, c: c }; }
        }
      }
      if (bestCap) return bestCap;

      // Collect my cells and the enemy pieces touching them (radius 1).
      var myCells = [];
      for (var i = 0; i < state.cells.length; i++) {
        if (state.cells[i].owner === me) {
          myCells.push({ r: Math.floor(i / cols), c: i % cols });
        }
      }

      // --- 2. Edge-adjacent race: an enemy cell orthogonally next to one of my
      //        cells that I can still win by matching. "Match 2–2, 3–3…" means
      //        only a WINNABLE race qualifies: the enemy must be level with, or
      //        exactly one ahead of, my cell (a one-point catch-up) AND not
      //        already critical. A critical or far-ahead enemy can erupt and
      //        capture my cell next turn regardless, so reinforcing is wasted
      //        (and the v37-primary safety gate would reject it anyway). Among
      //        qualifying races, prefer the tightest (smallest gap).
      var reinforce = null, reinforceGap = Infinity;
      for (var a = 0; a < myCells.length; a++) {
        var mr = myCells[a].r, mc = myCells[a].c;
        var myCell = at(state, mr, mc);
        var myCap = G.capacity(state, mr, mc);
        if (myCell.value >= myCap) continue;         // already critical: nothing to add
        if (!G.canPlay(state, me, mr, mc)) continue;
        var orth = G.neighbours(state, mr, mc);
        for (var o = 0; o < orth.length; o++) {
          var ej = orth[o];
          var ec = state.cells[ej];
          if (ec.owner !== opp) continue;
          var ejr = Math.floor(ej / cols), ejc = ej % cols;
          if (ec.value === G.capacity(state, ejr, ejc)) continue; // enemy critical: race already lost
          var gap = ec.value - myCell.value;         // >=0 level, 1 one-ahead
          if (gap === 0 || gap === 1) {               // winnable one-point race
            if (gap < reinforceGap) { reinforceGap = gap; reinforce = { r: mr, c: mc }; }
          }
        }
      }
      if (reinforce) return reinforce;

      // --- 3. Vertex-only (diagonal) enemy near my cell: occupy the favourable
      //        in-between EDGE cell. For my cell M and a diagonal enemy E, the
      //        two cells orthogonally adjacent to BOTH are the candidates. Pick
      //        per the agreed rule:
      //          - never choose a candidate that is edge-adjacent to an enemy
      //            edge piece (unfavourable: hands the opponent escalation);
      //          - prefer the side that EXTENDS influence: the side whose
      //            nearest own edge piece is MORE than two blanks away, and
      //            which is open (no opponent within 3 along that line, all
      //            blank). The tight-gap side (own piece within 2 blanks) is
      //            already defended, so expand the other way.
      //        If neither candidate qualifies, return null (ignore — fall back).
      for (var b = 0; b < myCells.length; b++) {
        var cr = myCells[b].r, cc = myCells[b].c;
        var diagNbrs = radius1(G, state, cr, cc);
        for (var d = 0; d < diagNbrs.length; d++) {
          if (!diagNbrs[d].diag) continue;
          var er = diagNbrs[d].r, ecidx = diagNbrs[d].c;
          if (at(state, er, ecidx).owner !== opp) continue;
          // candidate in-between cells = orthogonal neighbours of M that are
          // also orthogonal neighbours of E.
          var mOrth = G.neighbours(state, cr, cc);
          var cand = [];
          for (var k = 0; k < mOrth.length; k++) {
            var cr2 = Math.floor(mOrth[k] / cols), cc2 = mOrth[k] % cols;
            var isNbrOfE = (Math.abs(cr2 - er) + Math.abs(cc2 - ecidx)) === 1;
            if (isNbrOfE && state.cells[mOrth[k]].owner === G.EMPTY &&
                G.canPlay(state, me, cr2, cc2)) {
              cand.push({ r: cr2, c: cc2 });
            }
          }
          var pick = chooseInfluenceCell(state, me, opp, cand, er, ecidx);
          if (pick) return pick;
        }
      }

      return null; // nothing local to contest
    }

    // From candidate in-between edge cells, choose the one that extends
    // influence and is not unfavourably placed next to an enemy edge piece.
    // (trigR,trigC) is the DIAGONAL enemy piece we're responding to — it is
    // orthogonally adjacent to the in-between cells BY CONSTRUCTION, so it must
    // not count toward the "adjacent to another enemy" rejection.
    function chooseInfluenceCell(state, me, opp, cand, trigR, trigC) {
      var cols = state.cols;
      var ok = [];
      for (var i = 0; i < cand.length; i++) {
        var r = cand[i].r, c = cand[i].c;
        // Reject if edge-adjacent to a DIFFERENT enemy piece (not the trigger):
        // that would be an unfavourable spot the opponent could escalate against.
        var orth = G.neighbours(state, r, c);
        var adjEnemy = false;
        for (var o = 0; o < orth.length; o++) {
          var jr = Math.floor(orth[o] / cols), jc = orth[o] % cols;
          if (state.cells[orth[o]].owner === opp &&
              !(jr === trigR && jc === trigC)) { adjEnemy = true; break; }
        }
        if (adjEnemy) continue;

        // The candidate sits on a board edge; scan the TWO opposite directions
        // ALONG that edge. The agreed rule: if one direction has our own edge
        // piece close (within two blanks) that side is already defended, so we
        // only want to place here when the OTHER direction is open space to
        // extend into (no opponent within 3, all blank). A corner's in-between
        // cell always has the corner close on one side, so this is the common
        // "extend influence down the open edge" case.
        var dirs = edgeScanDirs(state, r, c);
        var qualifies = false;
        for (var dI = 0; dI < dirs.length; dI++) {
          var here = scanLine(state, me, opp, r, c, dirs[dI]);
          if (!here.ownWithin2) continue;        // need own piece close THIS way
          // opposite direction along the same edge must be open space
          var opp2 = [-dirs[dI][0], -dirs[dI][1]];
          var other = scanLine(state, me, opp, r, c, opp2);
          if (other.openWithin3) { qualifies = true; break; }
        }
        if (qualifies) ok.push(cand[i]);
      }
      return ok.length ? pickRandom(ok, rng) : null;
    }

    // Which direction(s) to scan along the board edge from an edge cell. For a
    // top/bottom-row cell scan left/right; for a left/right-column cell scan
    // up/down. (A corner sits on two edges; both are scanned.)
    function edgeScanDirs(state, r, c) {
      var dirs = [];
      if (r === 0 || r === state.rows - 1) { dirs.push([0, -1]); dirs.push([0, 1]); }
      if (c === 0 || c === state.cols - 1) { dirs.push([-1, 0]); dirs.push([1, 0]); }
      return dirs;
    }

    // Scan up to 3 cells along (dr,dc) from (r,c):
    //   ownWithin2  : an own piece appears within two blank cells (distance <=3);
    //   openWithin3 : the first up-to-3 cells are all empty (no opponent, and no
    //                 own piece either — genuinely open space to expand into).
    function scanLine(state, me, opp, r, c, dir) {
      var ownWithin2 = false, openWithin3 = true;
      for (var step = 1; step <= 3; step++) {
        var rr = r + dir[0] * step, cc = c + dir[1] * step;
        if (rr < 0 || rr >= state.rows || cc < 0 || cc >= state.cols) break;
        var cell = at(state, rr, cc);
        if (cell.owner === me) ownWithin2 = true;
        if (cell.owner !== G.EMPTY) openWithin3 = false;
      }
      return { ownWithin2: ownWithin2, openWithin3: openWithin3 };
    }

    return {
      name: 'Tutor',
      level: level,
      chooseMove: function (state) {
        var me = state.current;
        var opp = (me % state.players) + 1;
        var moves = legalMoves(G, state, me);
        if (!moves.length) return null;

        if (level !== 'medium') return easyMove(state, me);

        // Medium precedence (chosen empirically — see docs/strategy-notes.md):
        // the v37 "don't leave a cell capturable" strength is DOMINANT, and the
        // v39 anti-fortress contesting is SECONDARY. Concretely: take the local
        // anti-fortress move ONLY when it is itself SAFE (doesn't hand the
        // opponent an immediate capture) or outright winning; otherwise defer to
        // the capture-avoidance-weighted positional move (easyMove, whose
        // evaluation includes the v37 oppCapture penalty for Medium). Testing
        // showed this keeps BOTH the ~90% edge over Easy / ~70% over Easy-Shark
        // AND the fortress fix, whereas making the reactive move strictly
        // override lost the strength (dropped to ~48% vs Easy).
        var reactive = mediumReactiveMove(state, me, opp);
        if (reactive) {
          var cl = G.cloneState(state);
          if (G.applyMove(cl, me, reactive.r, reactive.c) &&
              (cl.winner === me ||
               opponentBestImmediateCapture(G, cl, me, opp) === 0)) {
            return reactive;
          }
        }
        return easyMove(state, me);
      },
    };
  }

  // ---- Shark agent (minimax + alpha-beta, machine-style) ------------------
  //
  // The strong, "machine-style" opponent: it SEARCHES several plies deep over
  // the real cascade resolution (cloneState + applyMove) and picks the move
  // leading to the best evaluated position, so it finds the counter-intuitive,
  // cascade-dependent moves a human can't compute (see docs/strategy-notes.md).
  // Search DEPTH is the difficulty knob.
  //
  // The game is 2-player, deterministic, perfect-information, so plain minimax
  // with alpha-beta pruning applies. The evaluation is from the maximising
  // (root) player's perspective and encodes the documented heuristic: terminal
  // win/loss dominate; otherwise own-cell advantage, capture safety (penalise
  // own cells adjacent to an enemy critical cell), and own critical/chain bonus.

  function makeShark(G, opts) {
    opts = opts || {};
    var rng = opts.rng || defaultRng;
    var maxDepth = (typeof opts.depth === 'number' && opts.depth >= 1)
      ? Math.floor(opts.depth) : 3;

    var WIN = 1000000;

    // Static evaluation of a (non-root-move) board from `me`'s perspective.
    function evaluate(state, me, opp) {
      var w = state.winner;
      if (w === me) return WIN;
      if (w !== G.EMPTY && w !== me) return -WIN;
      // Non-terminal, or terminal-by-sole-owner without a declared winner.
      var sole = G.soleOwner(state);
      if (sole === me) return WIN - 1;
      if (sole !== G.EMPTY && sole !== me) return -(WIN - 1);

      var score = 0;
      var counts = G.ownershipCounts(state);
      score += 10 * (counts[me] - counts[opp]); // material advantage

      for (var i = 0; i < state.cells.length; i++) {
        var cell = state.cells[i];
        if (cell.owner === G.EMPTY) continue;
        var r = Math.floor(i / state.cols);
        var c = i % state.cols;
        var cap = G.capacity(state, r, c);
        var critical = (cell.value === cap);
        if (cell.owner === me) {
          if (critical) {
            score += 2; // loaded, ready to erupt
            // Capture-safety: a critical cell next to an enemy critical cell is
            // vulnerable to being taken by the opponent's eruption first.
            var nbrs = G.neighbours(state, r, c);
            for (var n = 0; n < nbrs.length; n++) {
              var j = nbrs[n];
              var jr = Math.floor(j / state.cols), jc = j % state.cols;
              if (state.cells[j].owner === opp &&
                  state.cells[j].value === G.capacity(state, jr, jc)) {
                score -= 5;
              }
            }
          }
        } else { // opponent cell
          if (critical) score -= 2;
        }
      }
      return score;
    }

    // Negamax-style alpha-beta. Returns the best score for the player to move
    // (state.current) at this node, from `root`'s perspective is handled by the
    // sign convention: we always evaluate for state.current and negate on
    // recursion. `root` is the maximising player at the top.
    function search(state, depth, alpha, beta, root) {
      var toMove = state.current;
      var opp = (toMove % state.players) + 1;

      if (state.winner !== G.EMPTY || G.soleOwner(state) !== G.EMPTY ||
          depth === 0) {
        // Evaluate from the side-to-move's perspective (negamax convention).
        return evaluate(state, toMove, opp);
      }

      var moves = orderedMoves(G, state, toMove);
      if (!moves.length) return evaluate(state, toMove, opp);

      var best = -Infinity;
      for (var k = 0; k < moves.length; k++) {
        var child = G.cloneState(state);
        G.applyMove(child, toMove, moves[k].r, moves[k].c);
        var val;
        if (child.current === toMove || child.winner === toMove) {
          // Turn did NOT pass to the opponent (a win ends the game, or — not
          // possible here but defensive — the same player moves again): don't
          // negate, same perspective.
          val = search(child, depth - 1, alpha, beta, root);
        } else {
          val = -search(child, depth - 1, -beta, -alpha, root);
        }
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break; // beta cut-off
      }
      return best;
    }

    // Move ordering to help alpha-beta: capturing moves and low-capacity cells
    // (corners/edges) first — the usually-strong moves, so cut-offs happen
    // sooner. Cheap heuristic ordering, not a full evaluation.
    function orderedMoves(G, state, player) {
      var moves = legalMoves(G, state, player);
      var opp = (player % state.players) + 1;
      function rank(m) {
        var r = m.r, c = m.c;
        var cap = G.capacity(state, r, c);
        var sc = (4 - cap) * 2; // corner (cap2)->+4, edge->+2, interior->0
        // Bonus if placing here would reach capacity (erupt) and a neighbour is
        // an opponent cell (likely capture).
        var i = r * state.cols + c;
        if (state.cells[i].value + 1 > cap) {
          var nbrs = G.neighbours(state, r, c);
          for (var n = 0; n < nbrs.length; n++) {
            if (state.cells[nbrs[n]].owner === opp) { sc += 5; break; }
          }
        }
        return sc;
      }
      moves.sort(function (a, b) { return rank(b) - rank(a); });
      return moves;
    }

    return {
      name: 'Shark',
      depth: maxDepth,
      chooseMove: function (state) {
        var me = state.current;
        var moves = orderedMoves(G, state, me);
        if (!moves.length) return null;
        // Root: pick the move with the best searched value; ties broken randomly.
        var scored = moves.map(function (m) {
          var child = G.cloneState(state);
          G.applyMove(child, me, m.r, m.c);
          var val;
          if (child.winner === me) {
            val = WIN;
          } else if (child.current === me) {
            val = search(child, maxDepth - 1, -Infinity, Infinity, me);
          } else {
            val = -search(child, maxDepth - 1, -Infinity, Infinity, me);
          }
          return { move: m, val: val };
        });
        return argmax(scored, function (s) { return s.val; }, rng).move;
      },
    };
  }

  return {
    legalMoves: legalMoves,
    makeRandom: makeRandom,
    makeTutor: makeTutor,
    makeShark: makeShark,
  };
});
