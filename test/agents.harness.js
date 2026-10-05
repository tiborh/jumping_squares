/*
 * SPDX-FileCopyrightText: 2025 - 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Jumping Squares — agent-vs-agent harness (SPIKE, Node, no dependencies).
 *
 * Runs AI agents against each other headlessly (no DOM) and reports win rates.
 * This is the local testing substrate for the AI work: draw up agents, play
 * them against each other, read the stats.
 *
 *   node test/agents.harness.js            # default matchups, default N
 *   node test/agents.harness.js 500        # N games per matchup
 *   node test/agents.harness.js 500 42     # N games, RNG seed 42
 *
 * It is deliberately NOT part of the pass/fail suite (test/game.test.js) — it
 * prints statistics rather than asserting. A later step can add CI-style
 * win-rate assertions once the agents stabilise.
 */
'use strict';

var G = require('../js/game.js');
var A = require('../js/agents.js');

// --- tiny seedable RNG (mulberry32) so runs are reproducible with a seed -----
function makeRng(seed) {
  var s = (seed >>> 0) || 0x9e3779b9;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Play ONE game. agentFor is { 1: agentP1, 2: agentP2 }. Returns the winner id
 * (1 or 2) or 0 for a draw/aborted (move cap hit — shouldn't happen in normal
 * play, it's just a safety net against a pathological loop).
 */
function playGame(agentFor, opts) {
  opts = opts || {};
  var rows = opts.rows || 5, cols = opts.cols || 5;
  var maxMoves = opts.maxMoves || 5000;
  var state = G.createGame({ rows: rows, cols: cols, players: 2 });
  var moves = 0;
  while (state.winner === G.EMPTY && moves < maxMoves) {
    var agent = agentFor[state.current];
    var mv = agent.chooseMove(state);
    if (!mv) break; // no legal move (shouldn't occur before a winner here)
    var ok = G.applyMove(state, state.current, mv.r, mv.c);
    if (!ok) {
      throw new Error('agent ' + agent.name + ' returned an illegal move ' +
        JSON.stringify(mv) + ' for player ' + state.current);
    }
    moves++;
  }
  return state.winner; // 0 if aborted
}

/**
 * Play N games of A vs B, ALTERNATING who moves first (first-move advantage is
 * real), and tally wins by agent (not by seat). Returns {aWins,bWins,draws,n}.
 */
function matchup(makeA, makeB, n, baseRng, opts) {
  var aWins = 0, bWins = 0, draws = 0;
  for (var i = 0; i < n; i++) {
    // Fresh agents per game so any internal state can't leak between games;
    // give each its own RNG stream derived from the base for reproducibility.
    var rngA = makeRng((baseRng() * 4294967296) >>> 0);
    var rngB = makeRng((baseRng() * 4294967296) >>> 0);
    var a = makeA(rngA), b = makeB(rngB);
    var aIsP1 = (i % 2 === 0); // alternate the starting seat
    var agentFor = aIsP1 ? { 1: a, 2: b } : { 1: b, 2: a };
    var winnerSeat = playGame(agentFor, opts);
    if (winnerSeat === 0) { draws++; continue; }
    var aSeat = aIsP1 ? 1 : 2;
    if (winnerSeat === aSeat) aWins++; else bWins++;
  }
  return { aWins: aWins, bWins: bWins, draws: draws, n: n };
}

function pct(x, n) { return (100 * x / n).toFixed(1) + '%'; }

function report(label, nameA, nameB, res) {
  console.log('  ' + label);
  console.log('    ' + nameA + ': ' + res.aWins + ' (' + pct(res.aWins, res.n) + ')   ' +
    nameB + ': ' + res.bWins + ' (' + pct(res.bWins, res.n) + ')   ' +
    'draws/aborted: ' + res.draws + '   [n=' + res.n + ', first move alternated]');
}

// --- main --------------------------------------------------------------------
(function main() {
  var N = parseInt(process.argv[2], 10) || 200;
  var SEED = parseInt(process.argv[3], 10) || 12345;
  var SHARK_DEPTH = parseInt(process.argv[4], 10) || 3;
  var base = makeRng(SEED);

  var mkRandom = function (rng) { return A.makeRandom(G, { rng: rng }); };
  var mkTutor = function (rng) { return A.makeTutor(G, { rng: rng }); };
  var mkTutorMed = function (rng) { return A.makeTutor(G, { rng: rng, level: 'medium' }); };
  var mkShark = function (rng) { return A.makeShark(G, { rng: rng, depth: SHARK_DEPTH }); };

  console.log('Jumping Squares — agent-vs-agent (5x5, 2 players), N=' + N +
    ', seed=' + SEED + ', sharkDepth=' + SHARK_DEPTH);
  console.log('');

  console.log('Sanity: Random vs Random (expect roughly balanced; any skew is');
  console.log('first-move advantage, which we alternate away):');
  report('Random vs Random', 'Random-A', 'Random-B',
    matchup(mkRandom, mkRandom, N, base));
  console.log('');

  console.log('Tutor vs Random (expect Tutor to win clearly):');
  report('Tutor vs Random', 'Tutor', 'Random',
    matchup(mkTutor, mkRandom, N, base));
  console.log('');

  console.log('Tutor vs Tutor (self-play; expect roughly balanced):');
  report('Tutor vs Tutor', 'Tutor-A', 'Tutor-B',
    matchup(mkTutor, mkTutor, N, base));
  console.log('');

  console.log('Tutor-Medium vs Random (expect Medium to win clearly):');
  report('Tutor-Medium vs Random', 'Tutor-Med', 'Random',
    matchup(mkTutorMed, mkRandom, N, base));
  console.log('');

  console.log('Tutor-Medium vs Tutor-Easy (expect Medium to beat Easy \u2014 the');
  console.log('whole point of the new level: it defends and avoids giving cascades):');
  report('Tutor-Medium vs Tutor-Easy', 'Tutor-Med', 'Tutor-Easy',
    matchup(mkTutorMed, mkTutor, N, base));
  console.log('');

  // Shark searches depth-first, so it is much slower than the 1-ply agents;
  // use fewer games for its matchups to keep the harness snappy.
  var SN = Math.max(20, Math.round(N / 4));

  console.log('Shark vs Random (expect Shark to dominate), N=' + SN + ':');
  report('Shark vs Random', 'Shark', 'Random',
    matchup(mkShark, mkRandom, SN, base));
  console.log('');

  console.log('Shark vs Tutor (expect Shark to beat the 1-ply heuristic), N=' + SN + ':');
  report('Shark vs Tutor', 'Shark', 'Tutor',
    matchup(mkShark, mkTutor, SN, base));
  console.log('');

  console.log('Shark vs Tutor-Medium (gap should be SMALLER than vs Easy), N=' + SN + ':');
  report('Shark vs Tutor-Medium', 'Shark', 'Tutor-Med',
    matchup(mkShark, mkTutorMed, SN, base));
  console.log('');

  console.log('Shark vs Shark (self-play; expect roughly balanced), N=' + SN + ':');
  report('Shark vs Shark', 'Shark-A', 'Shark-B',
    matchup(mkShark, mkShark, SN, base));
})();
