/*
 * SPDX-FileCopyrightText: 2025 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Jumping Squares — rule verification harness (Node, no dependencies).
 *
 * Run with:  node test/game.test.js
 *
 * These tests exercise the pure logic module (js/game.js): capacities,
 * legal-move rules, overflow, chain reactions, capture, and win detection.
 */
'use strict';

var G = require('../js/game.js');

var passed = 0;
var failed = 0;

function ok(cond, name) {
  if (cond) {
    passed++;
    console.log('  ok  - ' + name);
  } else {
    failed++;
    console.log('  FAIL- ' + name);
  }
}

function eq(actual, expected, name) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  ok(a === e, name + '  (got ' + a + ', want ' + e + ')');
}

// Helpers to read/set a cell by (r,c).
function cell(state, r, c) {
  return state.cells[G.idx(state, r, c)];
}
function setCell(state, r, c, owner, value) {
  var cl = cell(state, r, c);
  cl.owner = owner;
  cl.value = value;
}

// ---------------------------------------------------------------------------
console.log('capacities');
(function () {
  var s = G.createGame({ rows: 5, cols: 5 });
  eq(G.capacity(s, 0, 0), 2, 'corner capacity is 2');
  eq(G.capacity(s, 0, 2), 3, 'top edge capacity is 3');
  eq(G.capacity(s, 2, 2), 4, 'interior capacity is 4');
  eq(G.capacity(s, 4, 4), 2, 'other corner capacity is 2');
})();

console.log('legal moves');
(function () {
  var s = G.createGame({ rows: 5, cols: 5 });
  ok(G.canPlay(s, 1, 0, 0), 'p1 may play empty cell');
  ok(!G.canPlay(s, 2, 0, 0), 'not p2 turn -> cannot play');

  // Give a cell to p2, then p1 must not be able to add to it.
  setCell(s, 1, 1, 2, 1);
  ok(!G.canPlay(s, 1, 1, 1), 'p1 cannot add to opponent-owned cell');
  ok(!G.canPlay(s, 1, -1, 0), 'out of bounds is illegal');
})();

console.log('basic placement + turn switch');
(function () {
  var s = G.createGame({ rows: 5, cols: 5 });
  var moved = G.applyMove(s, 1, 2, 2);
  ok(moved, 'move applied');
  eq(cell(s, 2, 2).owner, 1, 'cell now owned by p1');
  eq(cell(s, 2, 2).value, 1, 'cell value is 1');
  eq(s.current, 2, 'turn advanced to p2');
  eq(s.moveCount, 1, 'moveCount incremented');
})();

console.log('single overflow (interior cell, capacity 4)');
(function () {
  var s = G.createGame({ rows: 5, cols: 5 });
  // Pre-load interior (2,2) to its capacity 4, owned by p1.
  setCell(s, 2, 2, 1, 4);
  s.current = 1;
  // p1 adds one -> value 5 > capacity 4 -> overflow (sends 4, keeps 1).
  G.applyMove(s, 1, 2, 2);
  eq(cell(s, 2, 2).value, 1, 'overflowed interior cell keeps the remainder (5-4=1)');
  eq(cell(s, 2, 2).owner, 1, 'cell still owned by p1 (nonzero remainder)');
  eq(cell(s, 1, 2).value, 1, 'north neighbour got a point');
  eq(cell(s, 3, 2).value, 1, 'south neighbour got a point');
  eq(cell(s, 2, 1).value, 1, 'west neighbour got a point');
  eq(cell(s, 2, 3).value, 1, 'east neighbour got a point');
  eq(cell(s, 1, 2).owner, 1, 'neighbours owned by p1');
})();

console.log('point conservation on overflow');
(function () {
  // Corner (cap 2) at value 3: sends 1 to each of 2 neighbours, keeps 1.
  var s = G.createGame({ rows: 5, cols: 5 });
  setCell(s, 0, 0, 1, 2);
  s.current = 1;
  var before = 0, i;
  for (i = 0; i < s.cells.length; i++) before += s.cells[i].value;
  before += 1; // the point we are about to add
  G.applyMove(s, 1, 0, 0);
  eq(cell(s, 0, 0).value, 1, 'corner keeps 1 dot after jumping (3 -> 1)');
  eq(cell(s, 0, 0).owner, 1, 'corner still owned after keeping a dot');
  eq(cell(s, 0, 1).value, 1, 'east neighbour received a dot');
  eq(cell(s, 1, 0).value, 1, 'south neighbour received a dot');
  var after = 0;
  for (i = 0; i < s.cells.length; i++) after += s.cells[i].value;
  eq(after, before, 'total dots conserved across a corner overflow');
})();

console.log('capture: overflow flips opponent cells');
(function () {
  var s = G.createGame({ rows: 5, cols: 5 });
  // p2 owns a neighbour cell; p1 overflow should capture it.
  setCell(s, 2, 2, 1, 4);       // p1 loaded to capacity
  setCell(s, 1, 2, 2, 2);       // p2 owns north neighbour
  s.current = 1;
  G.applyMove(s, 1, 2, 2);
  eq(cell(s, 1, 2).owner, 1, 'opponent neighbour captured by p1');
  eq(cell(s, 1, 2).value, 3, 'captured neighbour value increased by 1');
})();

console.log('chain reaction cascade');
(function () {
  var s = G.createGame({ rows: 3, cols: 3 });
  // Center (1,1) cap 4. Its four edge neighbours have cap 3.
  // Load center to 4 and each orthogonal neighbour to 3, all p1.
  setCell(s, 1, 1, 1, 4);
  setCell(s, 0, 1, 1, 3);
  setCell(s, 2, 1, 1, 3);
  setCell(s, 1, 0, 1, 3);
  setCell(s, 1, 2, 1, 3);
  s.current = 1;
  // Mark both players as having taken a turn (these preloaded points stand in
  // for a sequence of real moves). Elimination is only allowed once every
  // player has moved, so we set turnsTaken for all players.
  for (var p = 1; p <= s.players; p++) s.turnsTaken[p] = 1;
  // Adding to center triggers center overflow, which pushes each neighbour
  // to 4 (> cap 3), cascading them to overflow into the corners.
  G.applyMove(s, 1, 1, 1);
  // After the dust settles the whole 3x3 should be p1 (win).
  var counts = G.ownershipCounts(s);
  ok(counts[2] === 0, 'no p2 cells remain after cascade');
  ok(counts[1] >= 1, 'p1 owns cells after cascade');
  eq(s.winner, 1, 'p1 declared winner via cascade');
})();

console.log('win detection needs every player to have moved');
(function () {
  var s = G.createGame({ rows: 5, cols: 5 });
  // First move by p1 alone must NOT be a win: p2 hasn't taken a turn yet.
  G.applyMove(s, 1, 0, 0);
  eq(s.winner, G.EMPTY, 'no premature win after first move');
  eq(s.current, 2, 'turn passes to p2 so they can place their opening dot');
})();

console.log('regression: p1 opening cascade must not win before p2 moves');
(function () {
  // Reproduces the screenshot bug: p1 makes moves that cascade and cover the
  // board in p1's colour while p2 has never moved. The game must NOT end;
  // it must pass the turn to p2 so they can place a dot on a neutral square.
  var s = G.createGame({ rows: 5, cols: 5 });
  // Preload a p1 position that will cascade widely, but only p1 has moved.
  setCell(s, 0, 0, 1, 2); // corner at capacity
  s.turnsTaken[1] = 1;    // p1 has moved; p2 has NOT
  s.current = 1;
  G.applyMove(s, 1, 0, 0); // triggers overflow; board may be all p1/neutral
  var counts = G.ownershipCounts(s);
  ok(counts[2] === 0, 'p2 owns nothing yet (never moved) — setup sanity');
  eq(s.winner, G.EMPTY, 'no win declared while p2 has not taken a turn');
  eq(s.current, 2, 'turn handed to p2 to place their first dot');
  // And p2 can legally play on a neutral square.
  var neutral = -1;
  for (var i = 0; i < s.cells.length; i++) {
    if (s.cells[i].owner === G.EMPTY) { neutral = i; break; }
  }
  ok(neutral !== -1, 'a neutral square exists for p2 to play');
  var nr = Math.floor(neutral / s.cols), nc = neutral % s.cols;
  ok(G.canPlay(s, 2, nr, nc), 'p2 may place a dot on an unoccupied square');
})();

console.log('regression: no win while neutral squares remain');
(function () {
  // The reported bug: p1 was declared winner while unoccupied squares existed.
  // Rule 10 ("owner of all the cubes") means a win needs the WHOLE board owned
  // by one player: no opponent cells AND no neutral cells.
  var s = G.createGame({ rows: 3, cols: 3 });
  // Both players have moved; p1 owns one cell, p2 owns none, rest are neutral.
  s.turnsTaken[1] = 1;
  s.turnsTaken[2] = 1;
  setCell(s, 0, 0, 1, 1); // p1 owns a single corner
  // 8 cells are still neutral, p2 owns nothing.
  var counts = G.ownershipCounts(s);
  ok(counts[2] === 0, 'setup: p2 owns nothing');
  ok(counts[G.EMPTY] > 0, 'setup: neutral squares remain');
  eq(G.checkWinner(s), G.EMPTY,
     'NO win while neutral squares remain (even though p2 has 0 cells)');
})();

console.log('win only when one player owns the entire board');
(function () {
  var s = G.createGame({ rows: 2, cols: 2 });
  s.turnsTaken[1] = 1;
  s.turnsTaken[2] = 1;
  // Fill every one of the 4 cells with p1 -> full board, no neutral cells.
  setCell(s, 0, 0, 1, 1);
  setCell(s, 0, 1, 1, 1);
  setCell(s, 1, 0, 1, 1);
  setCell(s, 1, 1, 1, 1);
  var counts = G.ownershipCounts(s);
  eq(counts[G.EMPTY], 0, 'no neutral cells left');
  eq(G.checkWinner(s), 1, 'p1 wins only when owning the entire board');
})();

console.log('full-capture win on 2x2');
(function () {
  var s = G.createGame({ rows: 2, cols: 2 }); // every cell is a corner, cap 2
  // p1 (0,0)->1 ; p2 (1,1)->1 ; contested now.
  G.applyMove(s, 1, 0, 0);
  G.applyMove(s, 2, 1, 1);
  ok(s.winner === G.EMPTY, 'still ongoing while both own cells');
  // p1 loads (0,0) to overflow and spread; keep playing p1's cell.
  // (0,0) neighbours are (0,1) and (1,0).
  G.applyMove(s, 1, 0, 0); // value 2, cap 2, no overflow yet
  // p2 moves somewhere it still owns
  G.applyMove(s, 2, 1, 1); // value 2
  G.applyMove(s, 1, 0, 0); // value 3 > cap 2 -> overflow to (0,1),(1,0)
  // Now check invariant: winner set iff exactly one owner remains.
  var counts = G.ownershipCounts(s);
  var owners = [1, 2].filter(function (p) { return counts[p] > 0; });
  eq(s.winner, owners.length === 1 ? owners[0] : G.EMPTY,
     'winner flag consistent with ownership');
})();

console.log('clone independence');
(function () {
  var s = G.createGame({ rows: 3, cols: 3 });
  G.applyMove(s, 1, 1, 1);
  var snap = G.cloneState(s);
  G.applyMove(s, 2, 0, 0);
  ok(snap.moveCount === 1, 'snapshot not mutated by later moves');
  ok(snap.cells[G.idx(s, 0, 0)].owner === G.EMPTY,
     'snapshot cell state preserved');
})();

console.log('version wiring');
(function () {
  var fs = require('fs');
  var path = require('path');
  ok(typeof G.VERSION === 'string' && G.VERSION.length > 0,
     'engine exports a non-empty VERSION');

  // The cache-busting "?v=N" strings in index.html must match the engine
  // VERSION, otherwise reloads may serve stale JS (the exact bug we hit).
  var html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'), 'utf8');
  var matches = html.match(/\.js\?v=([^"'\s>]+)/g) || [];
  ok(matches.length >= 1, 'index.html has cache-busting ?v= query strings');
  var allMatch = matches.every(function (m) {
    return m.indexOf('?v=' + G.VERSION) !== -1;
  });
  ok(allMatch,
     'all ?v= strings match engine VERSION ' + G.VERSION +
     ' (found: ' + matches.join(', ') + ')');
})();

// ---------------------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
