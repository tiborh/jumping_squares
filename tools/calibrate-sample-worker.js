/*
 * SPDX-FileCopyrightText: 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Jumping Squares — calibration SAMPLE WORKER (Node, dependency-free).
 *
 * Times ONE worst-case Shark `bestMove` on an N x N board at a given search
 * depth and prints the elapsed milliseconds (a single number) to stdout. It is
 * meant to be spawned as a short-lived CHILD PROCESS so the parent can impose a
 * hard timeout: Node is single-threaded, so a synchronous deep search cannot be
 * interrupted in-process — killing the child is the only reliable cap. This is
 * the bounded primitive behind both `tools/calibrate.js` and the in-browser
 * calibration's conceptual model (the browser runs the same measurement inline,
 * but only at cheap sizes where it cannot hang).
 *
 * To approximate the WORST case (the engine's slowest positions are dense,
 * contested mid-game boards), it fills the board with deterministic legal moves
 * to a configurable fraction before timing the single search.
 *
 * Usage: node tools/calibrate-sample-worker.js <N> <depth> [fillPercent] [seed]
 * Output: "<ms>\n" on success; "WIN"/"NOMOVE" if sampling degenerated; non-zero
 * exit on error.
 */
'use strict';

var path = require('path');
var G = require(path.join(__dirname, '..', 'js', 'game.js'));
var A = require(path.join(__dirname, '..', 'js', 'agents.js'));

var N = parseInt(process.argv[2], 10) || 8;
var DEPTH = parseInt(process.argv[3], 10) || A.STRONGEST_SHARK_DEPTH;
var FILL = (process.argv[4] !== undefined) ? parseInt(process.argv[4], 10) : 50;
var SEED = parseInt(process.argv[5], 10) || 12345;

function makeRng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
var rng = makeRng(SEED);

var state = G.createGame({ rows: N, cols: N, players: 2 });
var target = Math.round((FILL / 100) * N * N);
for (var placed = 0; placed < target && state.winner === G.EMPTY; placed++) {
  var me = state.current, legal = [];
  for (var r = 0; r < N; r++) {
    for (var c = 0; c < N; c++) {
      if (G.canPlay(state, me, r, c)) legal.push([r, c]);
    }
  }
  if (!legal.length) break;
  var pick = legal[Math.floor(rng() * legal.length)];
  G.applyMove(state, me, pick[0], pick[1]);
}

if (state.winner !== G.EMPTY) { process.stdout.write('WIN\n'); process.exit(0); }

var t0 = process.hrtime.bigint();
var mv = A.bestMove(G, state, { depth: DEPTH, rng: rng });
var t1 = process.hrtime.bigint();
if (!mv) { process.stdout.write('NOMOVE\n'); process.exit(0); }

process.stdout.write((Number(t1 - t0) / 1e6).toFixed(2) + '\n');
