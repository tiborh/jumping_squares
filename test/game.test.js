/*
 * SPDX-FileCopyrightText: 2025 - 2026 tiborh
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
var A = require('../js/agents.js');

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

console.log('stepped cascade: matches instant result');
(function () {
  // Build a scenario that cascades widely, then resolve it two ways from
  // identical starting states: (a) instant via applyMove, (b) stepped via
  // placeDot + stepOverflowsOnce loop + finalizeAfterCascade. Final board,
  // owners, current player and winner must be identical.
  function scenario() {
    var s = G.createGame({ rows: 4, cols: 4, players: 2 });
    // Preload a contested, near-critical board.
    for (var p = 1; p <= s.players; p++) s.turnsTaken[p] = 1;
    setCell(s, 1, 1, 1, 4); // interior at capacity (cap 4)
    setCell(s, 1, 2, 1, 4);
    setCell(s, 2, 1, 2, 3);
    setCell(s, 2, 2, 2, 4);
    setCell(s, 0, 0, 2, 2); // a p2 corner elsewhere so nobody is wiped out
    s.current = 1;
    return s;
  }

  // (a) instant
  var a = scenario();
  G.applyMove(a, 1, 1, 1);

  // (b) stepped
  var b = scenario();
  var placed = G.placeDot(b, 1, 1, 1);
  ok(placed, 'stepped: placeDot accepted the move');
  var steps = 0;
  while (G.hasOverflow(b) && b.winner === G.EMPTY) {
    var changed = G.stepOverflowsOnce(b);
    ok(changed, 'stepped: each generation with overflow reports a change');
    steps++;
    if (steps > 1000) { ok(false, 'stepped: runaway (no convergence)'); break; }
  }
  G.finalizeAfterCascade(b);

  ok(steps >= 1, 'stepped: took at least one generation for a cascading move');

  // Compare final states.
  var sameCells = true;
  for (var i = 0; i < a.cells.length; i++) {
    if (a.cells[i].owner !== b.cells[i].owner ||
        a.cells[i].value !== b.cells[i].value) { sameCells = false; break; }
  }
  ok(sameCells, 'stepped final board equals instant final board');
  eq(b.current, a.current, 'stepped current player equals instant');
  eq(b.winner, a.winner, 'stepped winner equals instant');
})();

console.log('stepped cascade: no-overflow move takes zero steps');
(function () {
  var s = G.createGame({ rows: 5, cols: 5, players: 2 });
  s.turnsTaken[1] = 1; s.turnsTaken[2] = 1;
  s.current = 1;
  G.placeDot(s, 1, 2, 2);                 // single dot on interior, cap 4
  ok(!G.hasOverflow(s), 'no overflow pending after a simple placement');
  eq(G.stepOverflowsOnce(s), false, 'stepOverflowsOnce is a no-op when stable');
  G.finalizeAfterCascade(s);
  eq(s.current, 2, 'turn advances after a no-overflow stepped move');
})();

console.log('stepped generation is simultaneous / deterministic');
(function () {
  // Two cells over capacity in the same generation must both spread from the
  // pre-generation snapshot into a shared neighbour (order-independent).
  // 3x3: edges (0,1) and (1,0) both neighbour the corner (0,0) and centre (1,1).
  var s = G.createGame({ rows: 3, cols: 3, players: 2 });
  s.turnsTaken[1] = 1; s.turnsTaken[2] = 1;
  setCell(s, 0, 1, 1, 4); // edge, cap 3 -> over by 1 (value 4)
  setCell(s, 1, 0, 1, 4); // edge, cap 3 -> over by 1 (value 4)
  // Shared neighbours start empty: (0,0) corner and (1,1) centre.
  var changed = G.stepOverflowsOnce(s);
  ok(changed, 'a generation occurred');
  // Each edge (cap 3, value 4) sends 1 to each of its 3 neighbours, keeps 1.
  eq(cell(s, 0, 1).value, 1, 'first edge keeps remainder (4-3=1)');
  eq(cell(s, 1, 0).value, 1, 'second edge keeps remainder (4-3=1)');
  // (0,0) is a neighbour of BOTH edges -> receives 1 from each = 2.
  eq(cell(s, 0, 0).value, 2, 'shared corner received one from each edge (=2)');
  // (1,1) is a neighbour of BOTH edges -> receives 1 from each = 2.
  eq(cell(s, 1, 1).value, 2, 'shared centre received one from each edge (=2)');
})();

console.log('regression: cascade terminates when one player owns the board');
(function () {
  // Reproduces the infinite-loop bugs (both the animated/stepped path AND the
  // instant path). Fill the whole board to capacity (stable) owned by p1, then
  // tip one cell over. The board is monochromatic and stays perpetually over
  // capacity, so any loop keyed only on hasOverflow never ends. The physical
  // terminal condition is soleOwner (one player holds every cell).

  // Case A: p2 HAS moved (contested) -> also a formal win.
  (function () {
    var s = G.createGame({ rows: 3, cols: 3, players: 2 });
    s.turnsTaken[1] = 1; s.turnsTaken[2] = 1;
    var r, c;
    for (r = 0; r < 3; r++)
      for (c = 0; c < 3; c++)
        setCell(s, r, c, 1, G.capacity(s, r, c));
    s.current = 1;
    setCell(s, 1, 1, 1, G.capacity(s, 1, 1) + 1);
    var steps = 0;
    while (G.soleOwner(s) === G.EMPTY && G.hasOverflow(s)) {
      G.stepOverflowsOnce(s);
      if (++steps > 10000) break;
    }
    G.finalizeAfterCascade(s);
    ok(steps <= 10000, 'A: stepped cascade terminates');
    eq(G.soleOwner(s), 1, 'A: p1 solely owns the board');
    eq(s.winner, 1, 'A: p1 declared winner (both players had moved)');
  })();

  // Case B: p2 NEVER moved. soleOwner is p1 (terminal for the CASCADE), but
  // checkWinner stays EMPTY due to the turn-gate. The instant applyMove path
  // must still TERMINATE (this was the hang). It should not declare a winner.
  (function () {
    var s = G.createGame({ rows: 3, cols: 3, players: 2 });
    s.turnsTaken[1] = 1; // only p1 has moved
    var r, c;
    for (r = 0; r < 3; r++)
      for (c = 0; c < 3; c++)
        setCell(s, r, c, 1, G.capacity(s, r, c));
    s.current = 1;
    // Instant path: place one more on centre. Must return (not hang).
    var ok2 = G.applyMove(s, 1, 1, 1);
    ok(ok2, 'B: instant applyMove returned (did not hang)');
    eq(G.soleOwner(s), 1, 'B: p1 physically owns the whole board');
    eq(s.winner, G.EMPTY,
       'B: no win declared while p2 has not taken a turn (turn-gate holds)');
  })();
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

console.log('loadState: validates and rehydrates untrusted state');
(function () {
  // Round-trip: a cloned snapshot of a real game must load back identically.
  var s = G.createGame({ rows: 5, cols: 5 });
  G.applyMove(s, 1, 2, 2);
  G.applyMove(s, 2, 0, 0);
  var snap = G.cloneState(s);
  // Simulate a storage round-trip through JSON (what persistence actually does).
  var fromJson = JSON.parse(JSON.stringify(snap));
  var loaded = G.loadState(fromJson);
  ok(loaded !== null, 'valid state loads (non-null)');
  eq(loaded, snap, 'loaded state equals the original snapshot');

  // Independence: mutating the loaded state must not touch the input object.
  loaded.cells[0].value = 99;
  ok(fromJson.cells[0].value !== 99, 'loadState returns an independent copy');
})();

console.log('backup file: board section round-trips through loadState');
(function () {
  // Mirrors the Save/Load (backup) feature's board data path: the UI wraps the
  // live cloneState inside a self-describing backup envelope, serialises it to a
  // file, and on import pulls `board.state` back out and runs it through the
  // engine's STRICT loadState (no mid-cascade / overflow positions). This test
  // exercises exactly that boundary with the engine (the UI glue is DOM-bound).
  var s = G.createGame({ rows: 5, cols: 5, players: 2 });
  G.applyMove(s, 1, 0, 0);   // p1 corner
  G.applyMove(s, 2, 4, 4);   // p2 opposite corner
  G.applyMove(s, 1, 2, 2);   // p1 interior

  // Build the same wrapper shape the UI's buildBackupObject() produces.
  var wrapper = {
    format: 'jumping_squares/backup',
    formatVersion: 1,
    engineVersion: G.VERSION,
    savedAt: new Date().toISOString(),
    board: {
      format: 'jumping_squares/save',
      formatVersion: 1,
      state: G.cloneState(s),
    },
  };

  // Serialise + parse (a real file round-trip) then validate the board section.
  var parsed = JSON.parse(JSON.stringify(wrapper));
  ok(parsed.format === 'jumping_squares/backup' && parsed.formatVersion === 1,
     'wrapper carries the backup format + version');
  var loaded = G.loadState(parsed.board.state);
  ok(loaded !== null, 'board section loads back (strict validation passes)');
  eq(loaded, G.cloneState(s), 'imported board equals the exported live state');

  // Strict guarantee the feature relies on: a contested board carrying an
  // over-capacity (mid/pre-cascade) cell is rejected, so such a crafted file
  // can never be imported and shown as a settled position. (loadState enforces
  // several coupled invariants; this asserts the net contract — rejection —
  // which is all the import path depends on. The settled-state check is
  // exercised directly in the dedicated loadState test below.)
  var bad = G.cloneState(s);
  var i00 = G.idx(bad, 0, 0);
  bad.cells[i00] = { owner: 1, value: 3 }; // corner capacity is 2 -> overflow
  ok(G.loadState(bad) === null,
     'an over-capacity contested board is rejected (strict import)');
})();

console.log('loadState: rejects malformed / out-of-range input');
(function () {
  ok(G.loadState(null) === null, 'null -> null');
  ok(G.loadState(undefined) === null, 'undefined -> null');
  ok(G.loadState(42) === null, 'non-object -> null');
  ok(G.loadState('{}') === null, 'string -> null');
  ok(G.loadState([]) === null, 'array (no rows/cols) -> null');

  function base() {
    // A minimal valid 2x2 state with one owned corner.
    return {
      rows: 2, cols: 2, players: 2, current: 2, moveCount: 1, winner: 0,
      turnsTaken: [0, 1, 0],
      cells: [
        { owner: 1, value: 1 }, { owner: 0, value: 0 },
        { owner: 0, value: 0 }, { owner: 0, value: 0 },
      ],
    };
  }
  ok(G.loadState(base()) !== null, 'sanity: base() is valid');

  var b;
  b = base(); b.moveCount = 2; b.current = 1; b.turnsTaken = [0, 2, 0];
  ok(G.loadState(b) === null, 'point total must match moveCount');
  b = base(); b.rows = 1;                       ok(G.loadState(b) === null, 'rows < 2 rejected');
  b = base(); b.cols = 1.5;                      ok(G.loadState(b) === null, 'non-integer cols rejected');
  b = base(); b.players = 1;                     ok(G.loadState(b) === null, 'players < 2 rejected');
  b = base(); b.cells = b.cells.slice(0, 3);     ok(G.loadState(b) === null, 'wrong cell count rejected');
  b = base(); b.current = 0;                     ok(G.loadState(b) === null, 'current < 1 rejected');
  b = base(); b.current = 3;                     ok(G.loadState(b) === null, 'current > players rejected');
  b = base(); b.winner = 3;                      ok(G.loadState(b) === null, 'winner > players rejected');
  b = base(); b.winner = -1;                     ok(G.loadState(b) === null, 'negative winner rejected');
  b = base(); b.moveCount = -1;                  ok(G.loadState(b) === null, 'negative moveCount rejected');
  b = base(); b.cells[0].owner = 3;              ok(G.loadState(b) === null, 'cell owner > players rejected');
  b = base(); b.cells[0].value = -1;             ok(G.loadState(b) === null, 'negative cell value rejected');
  b = base(); b.cells[0] = { owner: 0, value: 2 }; ok(G.loadState(b) === null, 'empty cell with value rejected');
  b = base(); b.cells[0] = { owner: 1, value: 0 }; ok(G.loadState(b) === null, 'owned cell with value 0 rejected');
  b = base(); b.cells[0] = null;                 ok(G.loadState(b) === null, 'null cell entry rejected');
  b = base(); b.cells[0].value = 1000000000;     ok(G.loadState(b) === null, 'huge cell value rejected');

  // Upper bounds: a huge players/rows/cols must be REJECTED (null), not throw a
  // RangeError at array allocation (which the caller would not catch).
  b = base(); b.players = 4294967295;
  var threwPlayers = false, resPlayers;
  try { resPlayers = G.loadState(b); } catch (e) { threwPlayers = true; }
  ok(!threwPlayers, 'huge players does not throw (bounded before allocation)');
  ok(resPlayers === null, 'huge players rejected');
  b = base(); b.rows = 100000; b.cells = []; // cell count would mismatch anyway
  var threwRows = false;
  try { G.loadState(b); } catch (e) { threwRows = true; }
  ok(!threwRows, 'huge rows does not throw');
  ok(G.loadState((function () { var x = base(); x.cols = 2000000; return x; })()) === null,
     'huge cols rejected');

  // Winner invariant: a nonzero winner that does NOT own the whole board is
  // rejected (a range check alone would wrongly accept it).
  b = base(); b.winner = 1; // base has empty cells, so p1 does not own all
  ok(G.loadState(b) === null, 'winner set but board not fully owned -> rejected');
  // A legitimately finished board (winner owns every cell) is accepted.
  var finOk = {
    rows: 2, cols: 2, players: 2, current: 2, moveCount: 4, winner: 2,
    turnsTaken: [0, 2, 2],
    cells: [
      { owner: 2, value: 1 }, { owner: 2, value: 1 },
      { owner: 2, value: 1 }, { owner: 2, value: 1 },
    ],
  };
  ok(G.loadState(finOk) !== null, 'winner owning the whole board -> accepted');

  // Terminal state where current != winner is rejected:
  var finWrongCurrent = {
    rows: 2, cols: 2, players: 2, current: 2, moveCount: 9, winner: 1,
    turnsTaken: [0, 5, 4],
    cells: [
      { owner: 1, value: 6 }, { owner: 1, value: 1 },
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
    ],
  };
  ok(G.loadState(finWrongCurrent) === null,
     'terminal save with current mismatched from winner is rejected');

  // Terminal state where winner != last mover is rejected:
  var finWrongMover = {
    rows: 2, cols: 2, players: 2, current: 2, moveCount: 9, winner: 2,
    turnsTaken: [0, 4, 5],
    cells: [
      { owner: 2, value: 6 }, { owner: 2, value: 1 },
      { owner: 2, value: 1 }, { owner: 2, value: 1 },
    ],
  };
  ok(G.loadState(finWrongMover) === null,
     'terminal save where winner did not make the last move is rejected');
})();

console.log('loadState: rejects unsettled (over-capacity) states, keeps sole-owner terminal');
(function () {
  // A contested board with an OVER-CAPACITY cell is not a settled end-state;
  // persistence only ever stores settled boards, so loadState must reject it
  // (otherwise it would be adopted as a playable board whose cascade never
  // resumes). Corner (0,0) cap 2 at value 3 is over capacity.
  var unsettled = {
    rows: 2, cols: 2, players: 2, current: 2, moveCount: 5, winner: 0,
    turnsTaken: [0, 3, 2],
    cells: [
      { owner: 1, value: 3 }, { owner: 2, value: 1 },  // (0,0) over cap -> unstable
      { owner: 0, value: 0 }, { owner: 2, value: 1 },
    ],
  };
  ok(G.hasOverflow(unsettled), 'setup: the crafted board really is over capacity');
  ok(G.loadState(unsettled) === null,
     'over-capacity contested board rejected (settled-state contract)');

  // The ONE legitimate perpetual-overflow case: a single player owns the whole
  // board (soleOwner != EMPTY). Such a board can stay over capacity forever and
  // is a valid terminal; it must still load. Fill a 2x2 with p1, one over cap.
  var soleOverflow = {
    rows: 2, cols: 2, players: 2, current: 1, moveCount: 9, winner: 1,
    turnsTaken: [0, 5, 4],
    cells: [
      { owner: 1, value: 6 }, { owner: 1, value: 1 },  // (0,0) cap 2, over capacity
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
    ],
  };
  ok(G.hasOverflow(soleOverflow) && G.soleOwner(soleOverflow) === 1,
     'setup: board is over capacity AND solely owned by p1');
  ok(G.loadState(soleOverflow) !== null,
     'sole-owner perpetual-overflow terminal is accepted');

  // A board physically owned by one player but with winner EMPTY (turn-gate not
  // met) is UNREACHABLE in real play and would be permanently stuck if restored
  // (the other player has no legal move and no winner is declared). Reject it.
  // All cells p1, current 1, winner 0, p2 never moved.
  var stuck = {
    rows: 2, cols: 2, players: 2, current: 1, moveCount: 4, winner: 0,
    turnsTaken: [0, 4, 0], // p2 never took a turn
    cells: [
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
    ],
  };
  ok(G.soleOwner(stuck) === 1 && G.checkWinner(stuck) === G.EMPTY,
     'setup: board solely owned by p1 but no winner (turn-gate unmet)');
  ok(G.loadState(stuck) === null,
     'physically-terminal, no-winner board rejected (would be permanently stuck)');

  // Ongoing game where current player has no legal moves (e.g. 3-player game:
  // p1 and p2 own all cells, 0 neutral cells, current is p3). p3 cannot move,
  // so restoring would leave the game permanently stuck.
  var noLegalMove = {
    rows: 2, cols: 2, players: 3, current: 3, moveCount: 5, winner: 0,
    turnsTaken: [0, 2, 2, 1],
    cells: [
      { owner: 1, value: 2 }, { owner: 1, value: 1 },
      { owner: 2, value: 1 }, { owner: 2, value: 1 },
    ],
  };
  ok(G.loadState(noLegalMove) === null,
     'ongoing state with no legal move for current player is rejected');

  // Ongoing state where current does not match completed moveCount is rejected:
  var badCurrent = {
    rows: 2, cols: 2, players: 2, current: 2, moveCount: 0, winner: 0,
    cells: [
      { owner: 0, value: 0 }, { owner: 0, value: 0 },
      { owner: 0, value: 0 }, { owner: 0, value: 0 },
    ],
  };
  ok(G.loadState(badCurrent) === null,
     'ongoing save with current mismatched from moveCount is rejected');

  // Ongoing save with moveCount: 0 but owned cells is rejected (reconstructed turns would exceed moveCount):
  var move0Owned = {
    rows: 2, cols: 2, players: 2, current: 1, moveCount: 0, winner: 0,
    cells: [
      { owner: 1, value: 1 }, { owner: 0, value: 0 },
      { owner: 0, value: 0 }, { owner: 0, value: 0 },
    ],
  };
  ok(G.loadState(move0Owned) === null,
     'ongoing save with moveCount: 0 but owned cells is rejected');
})();

console.log('loadState: reconstructs turnsTaken when missing/malformed');
(function () {
  // No turnsTaken present: every player that owns a cell is treated as moved.
  var obj = {
    rows: 2, cols: 2, players: 2, current: 1, moveCount: 2, winner: 0,
    cells: [
      { owner: 1, value: 1 }, { owner: 2, value: 1 },
      { owner: 0, value: 0 }, { owner: 0, value: 0 },
    ],
  };
  var loaded = G.loadState(obj);
  ok(loaded !== null, 'loads without a turnsTaken field');
  eq(loaded.turnsTaken.length, 3, 'turnsTaken has length players+1');
  ok(loaded.turnsTaken[1] >= 1 && loaded.turnsTaken[2] >= 1,
     'both owners marked as having moved');

  // TurnsTaken provides 0 for a player that owns cells -> contradictory, falls
  // back to conservative reconstruction so the turn-gate remains valid.
  var unfaithfulTurns = {
    rows: 2, cols: 2, players: 2, current: 2, moveCount: 3, winner: 0,
    turnsTaken: [0, 0, 2], // p1 owns cells but turnsTaken[1] is 0!
    cells: [
      { owner: 1, value: 1 }, { owner: 2, value: 2 },
      { owner: 0, value: 0 }, { owner: 0, value: 0 },
    ],
  };
  var lut = G.loadState(unfaithfulTurns);
  ok(lut !== null, 'inconsistent turnsTaken repaired (loads successfully)');
  ok(lut.turnsTaken[1] >= 1, 'player owning cells reconstructed with at least 1 turn');

  // A finished save whose turnsTaken is malformed is now REJECTED: after
  // reconstruction, player 2 (who owns nothing) has 0 turns, so the engine's
  // turn-gate (checkWinner) would NOT declare winner 1. loadState requires the
  // stored winner to equal checkWinner(candidate), so an unfaithful finished
  // state cannot be restored as bogusly "finished".
  var finBad = {
    rows: 2, cols: 2, players: 2, current: 1, moveCount: 9, winner: 1,
    turnsTaken: 'bogus', // malformed -> reconstructed -> p2 has 0 turns
    cells: [
      { owner: 1, value: 6 }, { owner: 1, value: 1 },
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
    ],
  };
  ok(G.loadState(finBad) === null,
     'finished state with malformed turnsTaken is rejected (turn-gate not provable)');

  // A finished save whose turnsTaken sum mismatches moveCount is rejected:
  var finMismatch = {
    rows: 2, cols: 2, players: 2, current: 1, moveCount: 9, winner: 1,
    turnsTaken: [0, 1, 1], // sum is 2 != moveCount 9
    cells: [
      { owner: 1, value: 6 }, { owner: 1, value: 1 },
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
    ],
  };
  ok(G.loadState(finMismatch) === null,
     'finished save with turnsTaken sum mismatching moveCount is rejected');

  // A finished save with a FAITHFUL turnsTaken (every player moved) is accepted.
  var finGood = {
    rows: 2, cols: 2, players: 2, current: 1, moveCount: 9, winner: 1,
    turnsTaken: [0, 5, 4], // both players took turns
    cells: [
      { owner: 1, value: 6 }, { owner: 1, value: 1 },
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
    ],
  };
  var lg = G.loadState(finGood);
  ok(lg !== null, 'finished state with faithful turnsTaken is accepted');
  eq(lg.winner, 1, 'accepted finished state keeps winner 1');

  // Turn-gate directly: all cells p1, winner 1, but turnsTaken [0,0,0] -> reject
  // (player 2 never moved, so the engine would not have declared a winner).
  var noGate = {
    rows: 2, cols: 2, players: 2, current: 1, moveCount: 4, winner: 1,
    turnsTaken: [0, 0, 0],
    cells: [
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
    ],
  };
  ok(G.loadState(noGate) === null,
     'winner set but turn-gate unmet (turnsTaken all zero) is rejected');
})();

console.log('starting player');
(function () {
  // Default: player 1 opens.
  var def = G.createGame({ rows: 5, cols: 5, players: 2 });
  ok(def.current === 1, 'default starting player is 1');

  // Explicit valid starting player is honoured.
  var p2 = G.createGame({ rows: 5, cols: 5, players: 2, startingPlayer: 2 });
  ok(p2.current === 2, 'startingPlayer: 2 opens with player 2');

  // Out-of-range / invalid values fall back to 1 (never produce a bad current).
  var tooHigh = G.createGame({ rows: 5, cols: 5, players: 2, startingPlayer: 3 });
  ok(tooHigh.current === 1, 'startingPlayer out of range (3) falls back to 1');
  var zero = G.createGame({ rows: 5, cols: 5, players: 2, startingPlayer: 0 });
  ok(zero.current === 1, 'startingPlayer 0 falls back to 1');
  var frac = G.createGame({ rows: 5, cols: 5, players: 2, startingPlayer: 1.5 });
  ok(frac.current === 1, 'non-integer startingPlayer falls back to 1');
  var str = G.createGame({ rows: 5, cols: 5, players: 2, startingPlayer: '2' });
  ok(str.current === 1, 'non-number startingPlayer falls back to 1');

  // Works for more players too (future-proofing the engine option).
  var p3 = G.createGame({ rows: 5, cols: 5, players: 3, startingPlayer: 3 });
  ok(p3.current === 3, 'startingPlayer: 3 valid with players: 3');

  // --- save/validate round-trip for a non-player-1 opener (regression) -----
  // A game opened by player 2 must survive cloneState -> loadState. This is the
  // exact path the UI auto-save uses; before loadState knew about the opener it
  // rejected these as soon as they were saved, discarding the board on reload.

  // Fresh player-2 board (0 moves): the auto-save right after New Game.
  var fresh2 = G.createGame({ rows: 5, cols: 5, players: 2, startingPlayer: 2 });
  ok(G.loadState(G.cloneState(fresh2)) !== null,
     'fresh player-2-opening board round-trips through loadState');

  // After player 2 opens and player 1 replies: current should be back to 2.
  var mid2 = G.createGame({ rows: 5, cols: 5, players: 2, startingPlayer: 2 });
  G.applyMove(mid2, 2, 0, 0); // p2 opens a corner
  G.applyMove(mid2, 1, 4, 4); // p1 replies in another corner
  ok(mid2.current === 2, 'after p2 then p1, it is p2 to move again');
  var reloaded2 = G.loadState(G.cloneState(mid2));
  ok(reloaded2 !== null, 'in-progress player-2-opening game round-trips');
  ok(reloaded2 && reloaded2.startingPlayer === 2,
     'restored state preserves startingPlayer = 2');
  ok(reloaded2 && reloaded2.current === 2,
     'restored state preserves current = 2');

  // A save that CLAIMS the wrong opener is rejected: here 1 move was made and
  // current is 1, which is only consistent with opener 2 (moverOf(1)=1), not
  // opener 1 (which would expect current 2 after one move).
  var oneMove = G.cloneState(mid2);
  oneMove.moveCount = 1;
  oneMove.turnsTaken = [0, 0, 1]; // only p2 has moved
  // Rebuild cells to match a single p2 dot so point-total == moveCount.
  oneMove.cells = oneMove.cells.map(function () { return { owner: 0, value: 0 }; });
  oneMove.cells[0] = { owner: 2, value: 1 };
  oneMove.current = 1;          // p1 to move after p2's single opener
  oneMove.winner = 0;
  oneMove.startingPlayer = 2;   // consistent -> accepted
  ok(G.loadState(oneMove) !== null,
     'one-move p2-opening save (current=1) accepted with startingPlayer=2');
  var wrongOpener = G.cloneState(oneMove);
  wrongOpener.startingPlayer = 1; // inconsistent: opener 1 would expect current=2
  ok(G.loadState(wrongOpener) === null,
     'same board claiming startingPlayer=1 is rejected (turn-order mismatch)');

  // Legacy save WITHOUT startingPlayer is treated as player-1-opened.
  var legacy = G.cloneState(G.createGame({ rows: 5, cols: 5, players: 2 }));
  delete legacy.startingPlayer;
  var legacyLoaded = G.loadState(legacy);
  ok(legacyLoaded !== null && legacyLoaded.startingPlayer === 1,
     'legacy save without startingPlayer defaults to opener 1');

  // Out-of-range startingPlayer in a save is rejected.
  var badSP = G.cloneState(fresh2);
  badSP.startingPlayer = 3; // only 2 players
  ok(G.loadState(badSP) === null, 'save with out-of-range startingPlayer rejected');

  // --- TERMINAL (finished) non-player-1 opener ------------------------------
  // A finished board that was OPENED BY PLAYER 2 must validate against the
  // opener-relative turn-order too. With startingPlayer=2 and moveCount=4 the
  // moves go p2,p1,p2,p1, so the last (winning) move was player 1:
  //   moverOf(3) = ((2-1+3) % 2) + 1 = 1  → winner must be 1, current == winner.
  var finP2 = {
    rows: 2, cols: 2, players: 2,
    startingPlayer: 2, current: 1, moveCount: 4, winner: 1,
    turnsTaken: [0, 2, 2], // p1 and p2 each took 2 turns
    cells: [
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
      { owner: 1, value: 1 }, { owner: 1, value: 1 },
    ],
  };
  ok(G.loadState(finP2) !== null,
     'finished board opened by player 2 (winner 1) round-trips');

  // The SAME finished board claiming opener 1 is rejected: with opener 1 the
  // last mover of 4 moves is player 2 (moverOf(3)=2), so winner 1 is inconsistent.
  var finP2WrongOpener = JSON.parse(JSON.stringify(finP2));
  finP2WrongOpener.startingPlayer = 1;
  ok(G.loadState(finP2WrongOpener) === null,
     'finished p2-opening board claiming opener 1 is rejected');

  // A finished p2-opening save with a turnsTaken that doesn't match the opener
  // distribution is rejected (turn-gate can't be proven).
  var finP2BadTurns = JSON.parse(JSON.stringify(finP2));
  finP2BadTurns.turnsTaken = [0, 3, 1]; // sum 4 but wrong split for p2,p1,p2,p1
  ok(G.loadState(finP2BadTurns) === null,
     'finished p2-opening board with mismatched turnsTaken is rejected');
})();

console.log('tutor difficulty (easy / medium) — 1-cell-radius reactive play');
(function () {
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function set(s, r, c, o, v) { s.cells[r * s.cols + c].owner = o; s.cells[r * s.cols + c].value = v; }
  function fin(s) { var m = 0; for (var i = 0; i < s.cells.length; i++) m += s.cells[i].value; s.moveCount = m; s.turnsTaken = [0, 0, 0]; s.current = 1; return s; }
  function dist(mk, level, N) {
    var p = {};
    for (var seed = 1; seed <= N; seed++) {
      var mv = A.makeTutor(G, { rng: makeRng(seed), level: level }).chooseMove(mk());
      var k = mv ? (mv.r + ',' + mv.c) : 'null';
      p[k] = (p[k] || 0) + 1;
    }
    return p;
  }

  // Level API: default easy; explicit medium; unknown -> easy.
  ok(A.makeTutor(G).level === 'easy', 'Tutor defaults to level "easy"');
  ok(A.makeTutor(G, { level: 'medium' }).level === 'medium', 'Tutor honours level "medium"');
  ok(A.makeTutor(G, { level: 'nonsense' }).level === 'easy', 'Tutor falls back to "easy" for an unknown level');

  // --- Case A: edge-adjacent race -> Medium reinforces its own cell ---------
  // Tutor edge (0,1)=2, enemy orthogonally adjacent (0,2)=2 (level). A far Tutor
  // corner exists so Easy would spread elsewhere; Medium should reinforce (0,1).
  function raceBoard() {
    var s = G.createGame({ rows: 5, cols: 5, players: 2 });
    set(s, 0, 1, 1, 2); set(s, 0, 2, 2, 2); set(s, 4, 4, 1, 1);
    return fin(s);
  }
  var medRace = dist(raceBoard, 'medium', 100);
  ok(Object.keys(medRace).length === 1 && medRace['0,1'] === 100,
     'Case A: Medium always reinforces the edge cell under a level race ((0,1))');
  var easyRace = dist(raceBoard, 'easy', 100);
  ok(!(easyRace['0,1'] === 100),
     'Case A: Easy does not reliably reinforce (plays positionally elsewhere)');

  // Case A edge case: a race that is ALREADY LOST locally must NOT trigger a
  // futile reinforce. Tutor edge (0,1)=1, enemy (0,2)=3 (edge-critical): raising
  // (0,1) to 2 is pointless — the enemy erupts next turn and captures it. Medium
  // should NOT spend its move on (0,1); it should play elsewhere.
  function lostRaceBoard() {
    var s = G.createGame({ rows: 5, cols: 5, players: 2 });
    set(s, 0, 1, 1, 1); set(s, 0, 2, 2, 3); set(s, 4, 4, 1, 1);
    return fin(s);
  }
  var medLost = dist(lostRaceBoard, 'medium', 100);
  ok(!medLost['0,1'],
     'Case A: Medium does not reinforce a cell against a critical/far-ahead enemy');

  // --- Case B: diagonal (vertex) approach -> Medium takes an in-between cell -
  // Tutor corner (0,0)=1; enemy diagonal (1,1)=1. The in-between edge cells are
  // (0,1) and (1,0); Medium must occupy one of them. Easy spreads to far corners.
  function diagBoard() {
    var s = G.createGame({ rows: 5, cols: 5, players: 2 });
    set(s, 0, 0, 1, 1); set(s, 1, 1, 2, 1);
    return fin(s);
  }
  var medDiag = dist(diagBoard, 'medium', 100);
  var diagOnlyInBetween = Object.keys(medDiag).every(function (k) { return k === '0,1' || k === '1,0'; });
  ok(diagOnlyInBetween && (medDiag['0,1'] || 0) + (medDiag['1,0'] || 0) === 100,
     'Case B: Medium always occupies an in-between edge cell ((0,1)/(1,0))');
  var easyDiag = dist(diagBoard, 'easy', 100);
  ok(!(((easyDiag['0,1'] || 0) + (easyDiag['1,0'] || 0)) === 100),
     'Case B: Easy does not (it builds elsewhere, letting the approach develop)');

  // --- Eruption capture takes priority -------------------------------------
  // Tutor corner (0,0)=2 (critical); enemy (0,1)=1. Playing (0,0) erupts and
  // captures (0,1). Medium must take it.
  function captureBoard() {
    var s = G.createGame({ rows: 5, cols: 5, players: 2 });
    set(s, 0, 0, 1, 2); set(s, 0, 1, 2, 1); set(s, 4, 4, 1, 1);
    return fin(s);
  }
  var medCap = dist(captureBoard, 'medium', 100);
  ok(medCap['0,0'] === 100, 'Eruption-capture: Medium always plays the capturing eruption ((0,0))');

  // Both levels always return a legal move on a normal position.
  var normal = G.createGame({ rows: 5, cols: 5, players: 2 });
  G.applyMove(normal, 1, 0, 0);
  var mvE = A.makeTutor(G).chooseMove(normal);
  var mvM = A.makeTutor(G, { level: 'medium' }).chooseMove(normal);
  ok(mvE && G.canPlay(normal, normal.current, mvE.r, mvE.c), 'Easy Tutor returns a legal move');
  ok(mvM && G.canPlay(normal, normal.current, mvM.r, mvM.c), 'Medium Tutor returns a legal move');
})();

console.log('random difficulty (easy / medium)');
(function () {
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Level API: default easy; explicit medium; unknown -> easy.
  ok(A.makeRandom(G).level === 'easy', 'Random defaults to level "easy"');
  ok(A.makeRandom(G, { level: 'medium' }).level === 'medium',
     'Random honours level "medium"');
  ok(A.makeRandom(G, { level: 'nonsense' }).level === 'easy',
     'Random falls back to "easy" for an unknown level');

  function oppCanCapture(state, me, opp) {
    var n = G.ownershipCounts(state)[me];
    var oppView = G.cloneState(state);
    oppView.current = opp;
    for (var r = 0; r < oppView.rows; r++) {
      for (var c = 0; c < oppView.cols; c++) {
        if (!G.canPlay(oppView, opp, r, c)) continue;
        var cl = G.cloneState(oppView);
        G.applyMove(cl, opp, r, c);
        if (n - G.ownershipCounts(cl)[me] > 0) return true;
      }
    }
    return false;
  }

  // --- When NOT threatened, NEITHER level strikes (both play random) --------
  // 3x3: P1 (to move) has a critical corner (0,0) next to a P2 cell at (0,1);
  // playing (0,0) would erupt and capture it. But the opponent has NO immediate
  // capture against P1, so under option-1 behaviour BOTH levels just play
  // random here (Easy never reacts; Medium only hits back when threatened).
  function craftMedium() {
    var s = G.createGame({ rows: 3, cols: 3, players: 2 });
    s.cells[0].owner = 1; s.cells[0].value = 2; // (0,0) P1 critical eruptor
    s.cells[1].owner = 2; s.cells[1].value = 1; // (0,1) P2 capturable
    s.moveCount = 3; s.current = 1; s.turnsTaken = [0, 2, 1];
    return s;
  }
  var cm = craftMedium();
  ok(oppCanCapture(cm, 1, 2) === false,
     'fixture: opponent cannot capture P1 immediately (nobody threatened)');
  (function () {
    var cl = G.cloneState(craftMedium());
    var before = G.ownershipCounts(cl)[2];
    G.applyMove(cl, 1, 0, 0);
    ok(before - G.ownershipCounts(cl)[2] === 1,
       'fixture: playing (0,0) captures one opponent cell');
  })();
  var easyStruck = 0, medStruck = 0, N = 100;
  for (var seed = 1; seed <= N; seed++) {
    var e = A.makeRandom(G, { rng: makeRng(seed), level: 'easy' }).chooseMove(craftMedium());
    var m = A.makeRandom(G, { rng: makeRng(seed), level: 'medium' }).chooseMove(craftMedium());
    if (e.r === 0 && e.c === 0) easyStruck++;
    if (m.r === 0 && m.c === 0) medStruck++;
  }
  ok(medStruck < N,
     'Medium does NOT strike when unthreatened (plays random) (' + medStruck + '/' + N + ')');
  ok(easyStruck < N,
     'Easy does NOT strike when unthreatened (plays random) (' + easyStruck + '/' + N + ')');

  // --- When threatened: MEDIUM hits back; EASY stays pure random ------------
  // Mutual-critical adjacency: P1 corner (0,0) critical AND the adjacent P2
  // edge cell (0,1) critical (so the opponent could erupt-capture P1 next
  // move). Medium must erupt (0,0) first to capture (hit back); Easy, being
  // pure random, does NOT react — it only lands on (0,0) by chance.
  function craftThreat() {
    var s = G.createGame({ rows: 3, cols: 3, players: 2 });
    s.cells[0].owner = 1; s.cells[0].value = 2; // (0,0) P1 critical corner
    s.cells[1].owner = 2; s.cells[1].value = 3; // (0,1) P2 critical edge (cap 3) -> can erupt
    s.moveCount = 5; s.current = 1; s.turnsTaken = [0, 2, 3];
    return s;
  }
  var ct = craftThreat();
  ok(oppCanCapture(ct, 1, 2) === true,
     'fixture: opponent CAN capture P1 immediately (Medium should hit back)');
  var medHitBack = 0, easyReacted = 0;
  for (var seed2 = 1; seed2 <= N; seed2++) {
    var mm = A.makeRandom(G, { rng: makeRng(seed2), level: 'medium' }).chooseMove(craftThreat());
    var eeR = A.makeRandom(G, { rng: makeRng(seed2), level: 'easy' }).chooseMove(craftThreat());
    if (mm.r === 0 && mm.c === 0) medHitBack++;
    if (eeR.r === 0 && eeR.c === 0) easyReacted++;
  }
  ok(medHitBack === N, 'Medium always hits back when threatened (' + medHitBack + '/' + N + ')');
  ok(easyReacted < N, 'Easy (pure random) does not reliably react (' + easyReacted + '/' + N + ')');

  // Both levels return legal moves on a normal position.
  var normal = G.createGame({ rows: 5, cols: 5, players: 2 });
  G.applyMove(normal, 1, 0, 0);
  var rvE = A.makeRandom(G).chooseMove(normal);
  var rvM = A.makeRandom(G, { level: 'medium' }).chooseMove(normal);
  ok(rvE && G.canPlay(normal, normal.current, rvE.r, rvE.c),
     'Easy Random returns a legal move');
  ok(rvM && G.canPlay(normal, normal.current, rvM.r, rvM.c),
     'Medium Random returns a legal move');
})();

console.log('bestMove helper (strongest-move entry point)');
(function () {
  // The engine-side "strongest move" helper used by the UI Hint and future
  // AI-move computation. Contract: pure (does not mutate the passed state),
  // returns a LEGAL move for the player to move, uses the deepest Shark depth
  // by default, and forwards opts.rng/opts.depth.
  ok(typeof A.bestMove === 'function', 'agents exports bestMove()');
  ok(A.STRONGEST_SHARK_DEPTH === 4,
     'STRONGEST_SHARK_DEPTH is 4 (Shark Hard)  (got ' + A.STRONGEST_SHARK_DEPTH + ')');

  // Deterministic RNG so ties resolve reproducibly in the test.
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  var s = G.createGame({ rows: 5, cols: 5, players: 2 });
  G.applyMove(s, 1, 0, 0); // now player 2 to move
  var snapshotBefore = JSON.stringify(s);
  var mv = A.bestMove(G, s, { rng: makeRng(1) });
  ok(mv && typeof mv.r === 'number' && typeof mv.c === 'number',
     'bestMove returns an {r,c} move');
  ok(mv && G.canPlay(s, s.current, mv.r, mv.c),
     'bestMove returns a LEGAL move for the player to move');
  eq(JSON.stringify(s), snapshotBefore,
     'bestMove does not mutate the passed state');

  // Default depth equals the strongest Shark: bestMove() should agree with a
  // Shark built at STRONGEST_SHARK_DEPTH when driven by the same RNG seed.
  var viaShark = A.makeShark(G, { depth: A.STRONGEST_SHARK_DEPTH, rng: makeRng(7) })
    .chooseMove(s);
  var viaBest = A.bestMove(G, s, { rng: makeRng(7) });
  eq(viaBest, viaShark,
     'bestMove matches a Shark at STRONGEST_SHARK_DEPTH with the same RNG');

  // No legal move -> null (a full board owned by the mover has no empty/own
  // playable cell for the opponent; use a terminal-ish board where current has
  // nothing to play). Simplest: a decided board has no moves for the loser.
  var full = G.createGame({ rows: 5, cols: 5, players: 2 });
  for (var i = 0; i < full.cells.length; i++) { full.cells[i].owner = 1; full.cells[i].value = 1; }
  full.current = 2; // player 2 owns nothing and no cell is empty -> no legal move
  ok(A.bestMove(G, full) === null, 'bestMove returns null when there is no legal move');
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

console.log('changelog wiring');
(function () {
  var cl = G.CHANGELOG;
  ok(Array.isArray(cl) && cl.length > 0, 'engine exports a non-empty CHANGELOG');

  // Every entry is well-formed: a version that is a pure decimal build number,
  // a non-empty text, and (if present) a boolean experimental flag. Requiring a
  // strict /^\d+$/ version means a typo like "19oops" is rejected here rather
  // than being silently coerced to 19 by parseInt in the checks below.
  var DECIMAL = /^\d+$/;
  var wellFormed = cl.every(function (e) {
    return e && typeof e.v === 'string' && DECIMAL.test(e.v) &&
           typeof e.text === 'string' && e.text.length > 0 &&
           (e.experimental === undefined || typeof e.experimental === 'boolean');
  });
  ok(wellFormed, 'every CHANGELOG entry has a decimal v, non-empty text, optional boolean experimental');

  // Entries are authored newest-first (non-increasing numeric version), so the
  // panel shows the most recent changes at the top.
  var nums = cl.map(function (e) { return parseInt(e.v, 10); });
  var ordered = nums.every(function (n, i) { return i === 0 || nums[i - 1] >= n; });
  ok(ordered, 'CHANGELOG entries are ordered newest-first (found: ' + nums.join(', ') + ')');

  // Drift guard: the newest entry must not claim a version beyond the current
  // engine VERSION (catches an entry added without bumping VERSION, or a typo).
  var current = parseInt(G.VERSION, 10);
  ok(nums[0] <= current,
     'newest CHANGELOG version (' + nums[0] + ') does not exceed VERSION (' + current + ')');

  // Storage cap: the panel never displays more than WHATSNEW_MAX entries
  // inline (it shows 5, then "Show more" expands to the full stored set), so
  // the engine must not SHIP more than that — older entries live only in
  // CHANGELOG.md. This guards the "don't store what can never be displayed"
  // rule against an accidental un-trimmed array.
  ok(typeof G.WHATSNEW_MAX === 'number' && G.WHATSNEW_MAX > 0,
     'engine exports a positive WHATSNEW_MAX');
  ok(cl.length <= G.WHATSNEW_MAX,
     'CHANGELOG length (' + cl.length + ') is within the storage cap WHATSNEW_MAX (' +
     G.WHATSNEW_MAX + ')');
})();

console.log('persistence reset: storageKeysToClear (prefix sweep)');
(function () {
  var PREFIX = 'jumping_squares:';
  var SAVE = PREFIX + 'save';
  var PREFS = PREFIX + 'prefs';

  // A realistic snapshot: our two keys, a (hypothetical) FUTURE namespaced key,
  // another same-origin app's key, and a bare key. Only our-prefixed keys may
  // ever be swept.
  var snapshot = [PREFS, SAVE, PREFIX + 'stats', 'other_app:prefs', 'theme'];

  // Reset "everything" (prefs group, keeping the board save) must clear prefs
  // AND the future `:stats` key — this is the auto-cleanable guarantee — while
  // sparing the board save and every foreign/bare key.
  var keepBoard = G.storageKeysToClear(snapshot, PREFIX, [SAVE]).sort();
  eq(keepBoard, [PREFIX + 'stats', PREFS].sort(),
     'sweep (keep board) clears prefs + future namespaced keys, spares the save and foreign keys');

  // A FUTURE namespaced key is cleared with no code change — this is the
  // auto-cleanable guarantee the sweep exists to provide.
  ok(keepBoard.indexOf(PREFIX + 'stats') !== -1,
     'a future jumping_squares:* key is swept automatically');
  ok(keepBoard.indexOf('other_app:prefs') === -1,
     'another app\u2019s same-origin key is never touched');
  ok(keepBoard.indexOf('theme') === -1, 'a bare (un-namespaced) key is never touched');

  // No `keep` -> sweep ALL app keys (used by a full reset / "both groups").
  var all = G.storageKeysToClear(snapshot, PREFIX).sort();
  eq(all, [PREFIX + 'stats', PREFS, SAVE].sort(),
     'sweep with no keep removes every namespaced key (both groups)');

  // Keeping prefs instead (board-only group) spares prefs and stats.
  var keepPrefs = G.storageKeysToClear(snapshot, PREFIX, [PREFS]).sort();
  eq(keepPrefs, [PREFIX + 'stats', SAVE].sort(),
     'sweep (keep prefs) targets the board save (plus any non-prefs namespaced keys)');

  // Defensive: bad inputs return [] rather than throwing (reset must never
  // crash the app, even with a hostile/odd storage snapshot).
  eq(G.storageKeysToClear(null, PREFIX), [], 'non-array keys -> []');
  eq(G.storageKeysToClear(snapshot, ''), [], 'empty prefix -> [] (never sweep everything)');
  eq(G.storageKeysToClear([PREFS, 42, null, PREFIX + 'x'], PREFIX).sort(),
     [PREFIX + 'x', PREFS].sort(),
     'non-string entries in the snapshot are ignored');
})();

console.log('help content: README <-> embedded HELP (drift + shape)');
(function () {
  var H = G.HELP;
  ok(Array.isArray(H) && H.length > 0, 'engine exports a non-empty HELP array');

  // Every block is well-formed: a known type with the fields that type needs.
  var VALID_TYPES = { heading: 1, paragraph: 1, list: 1 };
  var shapeOk = H.every(function (b) {
    if (!b || !VALID_TYPES[b.type]) return false;
    if (b.type === 'heading') {
      return (b.level === 2 || b.level === 3) &&
             typeof b.text === 'string' && b.text.length > 0;
    }
    if (b.type === 'paragraph') {
      return typeof b.text === 'string' && b.text.length > 0;
    }
    // list: items with string text and children that are {text}.
    return Array.isArray(b.items) && b.items.length > 0 &&
      b.items.every(function (it) {
        return it && typeof it.text === 'string' && it.text.length > 0 &&
          Array.isArray(it.children) &&
          it.children.every(function (c) {
            return c && typeof c.text === 'string' && c.text.length > 0;
          });
      });
  });
  ok(shapeOk, 'every HELP block is a well-formed heading/paragraph/list');

  // The help must actually carry the game's essentials (guards against an empty
  // or truncated regeneration): a Rules heading and the win condition.
  var headings = H.filter(function (b) { return b.type === 'heading'; })
                  .map(function (b) { return b.text; });
  ok(headings.indexOf('Rules') !== -1, 'HELP includes a "Rules" heading');
  var allText = JSON.stringify(H);
  ok(/win/i.test(allText) && /capacity/i.test(allText),
     'HELP mentions the win condition and capacity (core rules present)');

  // DRIFT GUARD: re-extract+parse the README via the SAME code tools/gen-help.js
  // uses, and compare to the embedded copy. If someone edits the README HELP
  // block but forgets to run the generator, this fails (CI-enforced) — the
  // mirror-with-a-drift-test contract, identical to the CHANGELOG approach.
  var gen = require('../tools/gen-help.js');
  var fromReadme = gen.blocksFromReadme();
  eq(G.HELP, fromReadme,
     'embedded HELP matches a fresh extraction from README (run tools/gen-help.js if this fails)');
})();

console.log('backup validators: schema (shape) + rules (semantic)');
(function () {
  var schemaV = require('../tools/validate-schema.js');
  var rulesV = require('../tools/validate-rules.js');

  // Build a backup wrapper exactly as the app's buildBackupObject() does, so a
  // freshly-exported file is proven to pass BOTH validators (drift guard: if
  // the export shape, the schema, or the engine rules ever diverge, this fails).
  var s = G.createGame({ rows: 5, cols: 5, players: 2 });
  G.applyMove(s, 1, 0, 0);
  G.applyMove(s, 2, 4, 4);
  G.applyMove(s, 1, 2, 2);
  function wrap(obj) {
    obj.format = 'jumping_squares/backup';
    obj.formatVersion = 1;
    obj.engineVersion = G.VERSION;
    obj.savedAt = new Date().toISOString();
    return obj;
  }
  var boardSection = {
    format: 'jumping_squares/save', formatVersion: 1, state: G.cloneState(s),
  };
  var prefsSection = {
    v: 9, playerNames: { 1: 'Alice', 2: 'Bob' }, autoSave: true,
    startingPlayer: 1, hintLightDelay: 10000,
  };
  // Round-trip through JSON, like a real file.
  var full = JSON.parse(JSON.stringify(wrap({ board: boardSection, prefs: prefsSection })));
  var boardOnly = JSON.parse(JSON.stringify(wrap({ board: boardSection })));
  var prefsOnly = JSON.parse(JSON.stringify(wrap({ prefs: prefsSection })));

  // The bundled schema must be valid JSON and loadable.
  var schema = schemaV.loadSchema();
  ok(schema && schema.format === undefined && schema.$id,
     'schema loads and carries an $id');

  // A freshly-exported file passes shape AND rules, in every section combo.
  ok(schemaV.validate(full, schema).valid, 'full backup passes the schema');
  ok(rulesV.validate(full).valid, 'full backup passes game-rule validation');
  ok(schemaV.validate(boardOnly, schema).valid, 'board-only passes the schema');
  ok(rulesV.validate(boardOnly).valid, 'board-only passes game-rule validation');
  ok(schemaV.validate(prefsOnly, schema).valid, 'prefs-only passes the schema');
  ok(rulesV.validate(prefsOnly).valid, 'prefs-only passes game-rule validation');

  // Broken SHAPE: wrong format tag -> schema fails (and names the const rule).
  var badFormat = JSON.parse(JSON.stringify(full)); badFormat.format = 'nope';
  var r1 = schemaV.validate(badFormat, schema);
  ok(!r1.valid && r1.errors.some(function (e) { return e.rule === 'const'; }),
     'wrong format tag fails the schema (const rule)');

  // Broken SHAPE: a cell value of the wrong type -> schema fails (type rule).
  var badType = JSON.parse(JSON.stringify(full)); badType.board.state.cells[0].value = 'x';
  var r2 = schemaV.validate(badType, schema);
  ok(!r2.valid && r2.errors.some(function (e) { return e.rule === 'type'; }),
     'a non-integer cell value fails the schema (type rule)');

  // Broken SHAPE cross-field: cells length != rows*cols -> schema fails.
  var badLen = JSON.parse(JSON.stringify(full)); badLen.board.state.cells.pop();
  var r3 = schemaV.validate(badLen, schema);
  ok(!r3.valid && r3.errors.some(function (e) { return e.rule === 'cellsLength'; }),
     'cells length != rows*cols fails the schema (cellsLength rule)');

  // SHAPE ok but RULES invalid: an over-capacity corner on a contested board.
  // Schema passes (it's structurally fine); the semantic validator rejects it.
  var badRules = JSON.parse(JSON.stringify(full));
  badRules.board.state.cells[0] = { owner: 1, value: 3 }; // corner cap 2 -> overflow
  ok(schemaV.validate(badRules, schema).valid,
     'an over-capacity board still passes the SHAPE schema');
  ok(!rulesV.validate(badRules).valid,
     'an over-capacity board FAILS game-rule validation (loadState)');

  // A file with no sections at all: rules validator reports nothing to check.
  var empty = JSON.parse(JSON.stringify(wrap({})));
  ok(!rulesV.validate(empty).valid,
     'a backup with no board/prefs section fails the rules validator');

  // --- combined runner (tools/validate-backup.js) ------------------------
  var backupV = require('../tools/validate-backup.js');

  // Passing file: ok, with both stages valid and the expected result shape.
  var cr1 = backupV.validate(full);
  ok(cr1.ok === true, 'combined runner: a valid full backup is ok');
  ok(cr1.schema && cr1.schema.valid === true, 'combined: schema stage valid');
  ok(cr1.rules && cr1.rules.valid === true, 'combined: rules stage valid');
  ok(Array.isArray(cr1.rules.checked) && cr1.rules.checked.indexOf('board') !== -1,
     'combined: rules.checked lists the board section');

  // Shape failure short-circuits: rules is null (not run on a broken shape).
  var crShape = backupV.validate(badType);
  ok(crShape.ok === false && crShape.schema.valid === false,
     'combined: a shape-broken file is not ok and fails the schema stage');
  ok(crShape.rules === null,
     'combined: rules stage is skipped (null) when the shape is invalid');

  // Shape OK but rules invalid: both stages ran; schema valid, rules invalid.
  var crRules = backupV.validate(badRules);
  ok(crRules.ok === false && crRules.schema.valid === true &&
     crRules.rules && crRules.rules.valid === false,
     'combined: an over-capacity board passes shape but fails rules (not ok)');

  // --- schema tightenings (schemaVersion 2) ------------------------------
  var schema2 = schemaV.loadSchema();
  ok(schema2.schemaVersion === 2, 'schema metadata is schemaVersion 2');

  // turnsTaken items must be non-negative integers (shape). Length is NOT
  // constrained in the schema on purpose: the engine reconstructs it for an
  // ongoing game, so a length rule would make the schema stricter than the
  // engine (reject a board the rules accept).
  var badTurns = JSON.parse(JSON.stringify(full));
  badTurns.board.state.turnsTaken = [0, 'x', 1];
  var rT = schemaV.validate(badTurns, schema2);
  ok(!rT.valid && rT.errors.some(function (e) {
    return e.rule === 'type' && /turnsTaken/.test(e.path);
  }), 'a non-integer turnsTaken entry fails the schema (type)');
  // A short turnsTaken array is tolerated by the schema (length left to the
  // engine), so it does NOT fail here.
  var shortTurns = JSON.parse(JSON.stringify(full));
  shortTurns.board.state.turnsTaken = [0, 1];
  ok(schemaV.validate(shortTurns, schema2).valid,
     'a short turnsTaken array still passes the schema (length is engine-checked)');

  // prefs.score.wins must be an object (structural), not an array.
  var badScore = JSON.parse(JSON.stringify(full));
  badScore.prefs = { score: { wins: [1, 2] } };
  var rS = schemaV.validate(badScore, schema2);
  ok(!rS.valid && rS.errors.some(function (e) {
    return e.rule === 'type' && e.path === '/prefs/score/wins';
  }), 'prefs.score.wins as an array fails the schema (nested type)');

  // Contract check: a prefs VALUE outside the known set (e.g. an unknown Tutor
  // level) is deliberately NOT rejected by the schema - the app ignores it, so
  // the schema stays lenient on prefs values to keep "passes schema => the app
  // tolerates it" honest.
  var oddPrefs = JSON.parse(JSON.stringify(full));
  oddPrefs.prefs = { tutorLevel: { 1: 'legendary' } };
  ok(schemaV.validate(oddPrefs, schema2).valid,
     'an unknown prefs value is tolerated by the schema (prefs are advisory)');
})();

console.log('backup validators: CLI (exit codes, --json, stdin)');
(function () {
  // Exercise the actual command-line paths of the three scripts (not just the
  // exported validate()), so regressions in exit status, --json output, the
  // human short-circuit, and stdin input are caught. Uses Node's built-in
  // child_process (zero dependency), writing fixtures to a temp file.
  var cp = require('child_process');
  var fs = require('fs');
  var os = require('os');
  var path = require('path');

  var root = path.join(__dirname, '..');
  function tool(name) { return path.join(root, 'tools', name); }

  // Build fixtures the way the app exports them.
  var s = G.createGame({ rows: 5, cols: 5, players: 2 });
  G.applyMove(s, 1, 0, 0); G.applyMove(s, 2, 4, 4); G.applyMove(s, 1, 2, 2);
  function wrap(obj) {
    obj.format = 'jumping_squares/backup'; obj.formatVersion = 1;
    obj.engineVersion = G.VERSION; obj.savedAt = new Date().toISOString();
    return obj;
  }
  var boardSection = { format: 'jumping_squares/save', formatVersion: 1, state: G.cloneState(s) };
  var okObj = wrap({ board: boardSection });
  var badShapeObj = JSON.parse(JSON.stringify(okObj)); badShapeObj.board.state.cells[0].value = 'x';
  var badRulesObj = JSON.parse(JSON.stringify(okObj)); badRulesObj.board.state.cells[0] = { owner: 1, value: 3 };

  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsq-cli-'));
  var okFile = path.join(dir, 'ok.json');
  var badShapeFile = path.join(dir, 'badshape.json');
  var badRulesFile = path.join(dir, 'badrules.json');
  fs.writeFileSync(okFile, JSON.stringify(okObj));
  fs.writeFileSync(badShapeFile, JSON.stringify(badShapeObj));
  fs.writeFileSync(badRulesFile, JSON.stringify(badRulesObj));

  function run(script, args, input) {
    return cp.spawnSync('node', [tool(script)].concat(args), {
      input: input, encoding: 'utf8',
    });
  }

  try {
    // Combined runner: valid file -> exit 0, human PASS.
    var r1 = run('validate-backup.js', [okFile]);
    ok(r1.status === 0, 'validate-backup CLI: valid file exits 0');
    ok(/^PASS/.test(r1.stdout), 'validate-backup CLI: valid file prints PASS');

    // Combined runner: shape-broken -> exit 1, FAIL (shape).
    var r2 = run('validate-backup.js', [badShapeFile]);
    ok(r2.status === 1, 'validate-backup CLI: shape-broken file exits 1');
    ok(/FAIL \(shape\)/.test(r2.stdout),
       'validate-backup CLI: shape-broken prints FAIL (shape)');

    // Combined runner: shape OK but rules-broken -> exit 1, PASS(shape) FAIL(rules).
    var r3 = run('validate-backup.js', [badRulesFile]);
    ok(r3.status === 1, 'validate-backup CLI: rules-broken file exits 1');
    ok(/PASS \(shape\), FAIL \(rules\)/.test(r3.stdout),
       'validate-backup CLI: rules-broken prints PASS (shape), FAIL (rules)');

    // --json combined: on shape failure, rules is null and ok is false.
    var r4 = run('validate-backup.js', ['--json', badShapeFile]);
    var j4 = JSON.parse(r4.stdout);
    ok(r4.status === 1 && j4.ok === false && j4.schema.ok === false && j4.rules === null,
       'validate-backup CLI --json: shape failure -> ok=false, rules=null');

    // --json combined: valid file -> ok=true, both stages ok.
    var r5 = run('validate-backup.js', ['--json', okFile]);
    var j5 = JSON.parse(r5.stdout);
    ok(r5.status === 0 && j5.ok === true && j5.schema.ok === true && j5.rules.ok === true,
       'validate-backup CLI --json: valid -> ok=true, both stages ok');

    // Schema CLI alone: exit 0 on valid, 1 on shape-broken.
    ok(run('validate-schema.js', [okFile]).status === 0,
       'validate-schema CLI: valid file exits 0');
    ok(run('validate-schema.js', [badShapeFile]).status === 1,
       'validate-schema CLI: shape-broken file exits 1');

    // Rules CLI alone: a shape-broken file is still JSON the engine rejects -> 1.
    ok(run('validate-rules.js', [badRulesFile]).status === 1,
       'validate-rules CLI: rules-broken file exits 1');

    // stdin path (no file arg): pipe the valid file in -> exit 0.
    var r6 = run('validate-backup.js', [], fs.readFileSync(okFile, 'utf8'));
    ok(r6.status === 0 && /\(stdin\)/.test(r6.stdout),
       'validate-backup CLI: reads from stdin and exits 0');

    // Not-JSON input -> non-zero exit, no crash.
    var r7 = run('validate-schema.js', [], '{ not json ');
    ok(r7.status === 1, 'validate-schema CLI: non-JSON stdin exits 1');
  } finally {
    // Clean up the temp fixtures.
    try {
      fs.unlinkSync(okFile); fs.unlinkSync(badShapeFile); fs.unlinkSync(badRulesFile);
      fs.rmdirSync(dir);
    } catch (e) { /* best-effort cleanup */ }
  }
})();

// ---------------------------------------------------------------------------
console.log('calibration helper (js/calibrate.js)');
(function () {
  var C = require('../js/calibrate.js');

  // --- shape / constants --------------------------------------------------
  ok(typeof C.projectTable === 'function', 'calibrate exports projectTable()');
  ok(C.MIN_SIZE === 2 && C.MAX_SIZE === 12 && C.STANDARD_SIZE === 5,
     'size bounds: MIN 2, MAX 12, STANDARD 5');
  eq(C.tableSizes(), [6, 7, 8, 9, 10, 11, 12],
     'tableSizes() is the sizes above the standard 5x5');

  // --- max-wait slider: 9 stops, rightmost 60 s, round-trips --------------
  ok(C.MAXWAIT_STOPS_MS.length === 9, 'max-wait slider has 9 stops');
  ok(C.MAXWAIT_STOPS_MS[8] === 60000, 'rightmost max-wait stop is 60 s');
  // Ascending stops.
  var ascending = C.MAXWAIT_STOPS_MS.every(function (v, i) {
    return i === 0 || C.MAXWAIT_STOPS_MS[i - 1] < v;
  });
  ok(ascending, 'max-wait stops are strictly ascending');
  // index <-> ms round-trips at every stop.
  var rt = C.MAXWAIT_STOPS_MS.every(function (ms, i) {
    return C.maxWaitIndexToMs(i) === ms && C.maxWaitMsToIndex(ms) === i;
  });
  ok(rt, 'maxWait index<->ms round-trips at every stop');
  // msToIndex snaps UP to the next stop (never a looser cap than requested).
  ok(C.maxWaitMsToIndex(1500) === 2 && C.maxWaitIndexToMs(2) === 2000,
     'maxWaitMsToIndex snaps up to the next stop (1500ms -> 2000ms)');
  // Out-of-range indices clamp.
  ok(C.maxWaitIndexToMs(-5) === 500 && C.maxWaitIndexToMs(99) === 60000,
     'maxWaitIndexToMs clamps out-of-range indices');

  // --- power-law fit -------------------------------------------------------
  var fit = C.fitPowerLaw({ 64: 2800, 100: 9000 });
  ok(fit && isFinite(fit.a) && isFinite(fit.b),
     'fitPowerLaw returns finite {a,b} for two points');
  // Fit reproduces its own anchors (within rounding).
  ok(Math.abs(fit.a * Math.pow(64, fit.b) - 2800) < 1 &&
     Math.abs(fit.a * Math.pow(100, fit.b) - 9000) < 1,
     'fitPowerLaw reproduces its anchor points');
  ok(C.fitPowerLaw({ 64: 2800 }) === null,
     'fitPowerLaw needs >=2 points (one point -> null)');

  // --- projection monotonicity --------------------------------------------
  // Using the built-in fallback model (no device samples), every row's
  // estimate must be non-decreasing in board size (bigger board, >= time).
  var table = C.projectTable({});
  var sizes = C.tableSizes();
  var allMonotone = table.every(function (t) {
    var prev = -Infinity, monotone = true;
    sizes.forEach(function (s) {
      if (t.cells[s] < prev) monotone = false;
      prev = t.cells[s];
    });
    return monotone;
  });
  ok(allMonotone, 'projected times are monotonic non-decreasing in board size');

  // Shark Hard must be the most expensive row at the largest size.
  var byLabel = {};
  table.forEach(function (t) { byLabel[t.row.label] = t; });
  var hard12 = byLabel['Shark — Hard'].cells[12];
  var othersAll = table.every(function (t) {
    return t.row.label === 'Shark — Hard' || t.cells[12] <= hard12;
  });
  ok(othersAll, 'Shark — Hard is the slowest row at 12x12');

  // Random/Tutor are near-instant everywhere (well under 1 s even at 12x12).
  var fastRows = ['Random — Easy', 'Tutor — Easy'].every(function (lbl) {
    return byLabel[lbl].cells[12] < 1000;
  });
  ok(fastRows, 'Random/Tutor estimates stay well under 1 s at 12x12');

  // --- red-threshold correctness ------------------------------------------
  ok(C.isOverThreshold(3000, 2000) === true, 'isOverThreshold: 3s over a 2s cap');
  ok(C.isOverThreshold(2000, 2000) === false, 'isOverThreshold: exactly at cap is NOT over');
  ok(C.isOverThreshold(1000, 2000) === false, 'isOverThreshold: under cap is not over');

  // largestSafeSize is monotone and consistent with the threshold: the size it
  // returns is within the cap, and the next size up (if any) is over.
  var row = byLabel['Shark — Hard'].row;
  [1000, 3000, 5000, 10000, 60000].forEach(function (cap) {
    var safe = C.largestSafeSize(row, {}, cap);
    if (safe >= C.STANDARD_SIZE + 1) {
      ok(!C.isOverThreshold(C.estimateMs(row, safe, {}), cap),
         'largestSafeSize(' + cap + 'ms): returned size ' + safe + ' is within cap');
      if (safe < C.MAX_SIZE) {
        ok(C.isOverThreshold(C.estimateMs(row, safe + 1, {}), cap),
           'largestSafeSize(' + cap + 'ms): size ' + (safe + 1) + ' is over cap');
      }
    }
  });

  // --- device samples OVERRIDE the fallback -------------------------------
  // A fabricated slow sample set must push the projection UP vs the fallback.
  var slow = { shark: { 4: { 36: 2000, 64: 8000 } }, flatMs: 1 };
  var fastDefault = C.estimateMs(row, 12, {});
  var slowDevice = C.estimateMs(row, 12, slow);
  ok(slowDevice > fastDefault,
     'device samples reproject: a slower device yields a larger 12x12 estimate');

  // --- measureCheapSizes with an injected runner --------------------------
  // Inject a deterministic fake runner (no real search) to verify the sampler
  // shape without timing anything.
  var calls = [];
  var samples = C.measureCheapSizes(function (size, depth) {
    calls.push([size, depth]);
    return size * size * depth; // arbitrary deterministic ms
  }, { sampleSizes: [6, 8], depths: [2, 4], at: 'T', device: 'D' });
  ok(samples.at === 'T' && samples.device === 'D',
     'measureCheapSizes carries the at/device metadata');
  ok(samples.shark[4] && samples.shark[4][64] === 64 * 4,
     'measureCheapSizes records samples keyed by cell count');
  ok(calls.length === 4, 'measureCheapSizes called runOne for each size x depth');
  // A runner that returns null (timeout) drops that point rather than throwing.
  var sparse = C.measureCheapSizes(function () { return null; },
    { sampleSizes: [6, 8], depths: [4] });
  ok(!sparse.shark[4] || Object.keys(sparse.shark[4]).length === 0,
     'measureCheapSizes drops null (timed-out) samples');
})();

// ---------------------------------------------------------------------------
console.log('calibration CLI / helper agreement (drift guard)');
(function () {
  var cp = require('child_process');
  var path = require('path');
  var C = require('../js/calibrate.js');

  // The CLI must produce the SAME numbers as the shared helper for the same
  // inputs, so the two can never drift (same pattern as the backup-validator
  // drift test). Run the CLI with --no-measure (fallback model, deterministic,
  // instant) + --json and compare against projectTable({}) directly.
  var res = cp.spawnSync(process.execPath,
    [path.join(__dirname, '..', 'tools', 'calibrate.js'),
     '--no-measure', '--json', '--max-wait', '3'],
    { encoding: 'utf8' });
  ok(res.status === 0, 'calibrate CLI --no-measure --json exits 0');

  var parsed = null;
  try { parsed = JSON.parse(res.stdout); } catch (e) { /* leave null */ }
  ok(parsed && Array.isArray(parsed.rows), 'calibrate CLI emits JSON rows');

  if (parsed) {
    var helper = C.projectTable({}, C.tableSizes());
    // Same number of rows, same labels, same per-size ms (fallback model).
    var sameRows = parsed.rows.length === helper.length;
    ok(sameRows, 'CLI row count matches the helper');

    var allAgree = parsed.rows.every(function (cliRow, i) {
      var hRow = helper[i];
      if (!hRow || cliRow.label !== hRow.row.label) return false;
      return C.tableSizes().every(function (s) {
        // JSON numbers are exact copies of the helper's doubles.
        return cliRow.cells[s] && cliRow.cells[s].ms === hRow.cells[s];
      });
    });
    ok(allAgree, 'CLI per-size estimates equal the helper (no drift)');

    // The CLI's "over" flag must match isOverThreshold at the same max-wait.
    var overAgree = parsed.rows.every(function (cliRow, i) {
      return C.tableSizes().every(function (s) {
        var want = C.isOverThreshold(helper[i].cells[s], 3000);
        return cliRow.cells[s].over === want;
      });
    });
    ok(overAgree, 'CLI over-threshold flags match the helper at a 3 s cap');
  }

  // A bad --size is rejected with exit 1 (bounds come from the helper).
  var bad = cp.spawnSync(process.execPath,
    [path.join(__dirname, '..', 'tools', 'calibrate.js'), '--no-measure', '--size', '99'],
    { encoding: 'utf8' });
  ok(bad.status === 1, 'calibrate CLI rejects an out-of-range --size with exit 1');
})();

// ---------------------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
