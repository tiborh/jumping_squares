<!--
  SPDX-FileCopyrightText: 2026 tiborh
  SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Small-board solver notes

Exhaustive game-tree analysis of **Jumping Squares** on the smallest boards:
are they *solved* (a forced result under perfect play), and if so, who wins?

These results were produced by brute-forcing the full game tree with the
**actual engine** (`js/game.js`) — `createGame`, `applyMove`, `cloneState` —
not by hand analysis, so they reflect the project's real variant: **start-empty**
boards with the **turn-gate** in `checkWinner` that forbids declaring a win
before every player has taken at least one turn (so an opening cascade cannot
end the game prematurely). Two players throughout.

## Results

| Board | Status | Forced winner under optimal play |
| ----- | ------ | -------------------------------- |
| 2×2   | **Solved** | **Second** player |
| 3×3   | **Solved** | **First** player |
| 4×4   | Not yet solved | — (see *Approaching 4×4* below) |

The forced winner **flips with board parity** between 2×2 and 3×3 — there is no
simple "it's always good (or bad) to move first" rule; it depends on the board.
(On both boards every result is symmetric in the obvious way: whichever side is
designated the forced winner wins regardless of which seat, P1 or P2, opens.)

### 2×2 — second player wins

On 2×2 every cell is a corner with 2 neighbours, so capacity is 2 everywhere and
a cell overflows at 3 points.

- **Forced-win solve** (both sides optimal): with P1 opening the forced winner
  is **P2**; with P2 opening it is **P1**. The *second mover* has the forced win.
- **The starter is not doomed by the rules alone, only by a competent
  opponent.** Enumerating *every* line of play (optimal or not) gives
  **692 vs 424** leaf wins — the starter *can* win if the second player misplays,
  but can never **force** a win against perfect defence.

### 3×3 — first player wins

- **Full game-tree solve** (both sides optimal): the **first mover** has a forced
  win (with P1 opening → P1 wins; with P2 opening → P2 wins). The reachable state
  space is small: ~**94,689** distinct memoized states, max search depth **24**.
- **Adversarial replay confirmation.** To rule out any artefact of cycle
  handling (repeated states were treated as drawish during the solve), the
  winning side then followed a winning strategy while the **losing** side was
  allowed to try **every** move at **every** one of its turns. The starter won
  down **all 11,175,907 terminal lines**, with **zero** opponent wins and
  **zero** non-terminating / cyclic lines. The game genuinely terminates in a
  starter win on every branch.

## Method (what was run)

For each board and each opening seat:

1. **`solve(state)`** — minimax over legal moves (a move exists for every cell
   that is empty or owned by the side to move, while `state.winner === 0`).
   Memoize on a serialized key of `(cell owners+values, current player,
   turnsTaken)`. States revisited **on the current search path** are treated as
   drawish (`0`) to break cycles; genuinely repeated states are memoized.
2. **Adversarial replay** (used for 3×3) — a stronger verification than the solve
   alone: fix the forced winner, have them always pick a move that preserves the
   win, and let the opponent branch over **all** legal moves. Assert that (a) no
   line lets the loser win, (b) no line fails to terminate within a generous
   move bound, and (c) `cycleHits == 0`. This confirms the solve's verdict
   constructively rather than trusting the cycle heuristic.

Both scripts were throwaway (`/tmp`), run with
`node --stack-size=65500 …` because the recursion is deep. They are not kept in
the repo; the snippets below in *Approaching 4×4* are enough to reconstruct them.

## Approaching 4×4 (when the time comes)

4×4 is **not** solved yet and the exhaustive adversarial replay used for 3×3 will
**not** scale — the state space and the number of distinct terminal lines both
blow up (3×3 already had ~11.2M terminal lines under a *constrained* winner;
4×4's branching factor starts at 16 and the reachable-state count grows by orders
of magnitude). Plan it as a project, not a one-off script:

1. **Keep the engine as ground truth.** Reuse `createGame` / `applyMove` /
   `cloneState` so the solver always matches the shipped rules (turn-gate,
   point-conservation, early-termination on sole ownership). Do **not**
   re-implement the rules in the solver.

2. **Make the state key canonical and compact.** The current key
   (`owner:value` per cell + `current` + `turnsTaken`) is correct but verbose.
   For 4×4:
   - Encode each cell compactly (owner in 2 bits, value in a few bits) into a
     **lossless, reversible** fixed-width integer / `BigInt` / typed-array key —
     one where distinct positions always map to distinct keys. **Do not use a
     truncated or short hash as the sole transposition key:** a hash collision
     would merge two different positions and can silently turn an *exact*
     forced-winner verdict into a false one. If you hash for speed, keep the
     canonical state (or a full-width key) alongside and compare it on a hash
     hit to reject collisions. (The small-board solver sidestepped this by
     keying on the full serialized state; the only change for 4×4 is making that
     key *compact*, not making it *lossy*.)
   - **Exploit board symmetry.** The square board's symmetry group (D4: 4
     rotations × 2 reflections = **8**) plus the **2-colour swap** means up to
     **16×** fewer distinct states. Canonicalize each state to the
     lexicographically smallest of its symmetric images before memoizing. This
     is the single biggest win and is essential at 4×4.
   - Collapse `turnsTaken` to the only bit that matters for the turn-gate:
     "has every player moved yet?" (a boolean), not exact counts — the gate only
     cares whether the game is allowed to end.

3. **Bound and iterate rather than go fully exhaustive first.**
   - Start with **iterative deepening** (depth-limited minimax) to get *partial*
     verdicts and a feel for tree size before committing to a full solve.
   - Add **alpha-beta pruning** with good move ordering (try likely-strong moves
     first so cut-offs happen sooner). Shark already uses exactly such a
     heuristic, but it is **not reusable as-is**: the ordering lives in a
     *private* nested `orderedMoves` inside `makeShark` (`js/agents.js`), and the
     exported `bestMove` returns only a single chosen move — neither exposes the
     ordered move list. So treat **extracting/exporting a shared ordering
     helper** (e.g. `orderMoves(G, state, player)`) as an explicit prerequisite;
     reuse it in both Shark and the solver so the two cannot drift. Until then
     the solver would have to duplicate the heuristic (capturing moves and
     low-capacity corner/edge cells first).
   - Use a **transposition table** keyed on the canonical state, storing the
     resolved result (win/loss/draw) and, if depth-limited, a bound + depth.

4. **Handle non-termination explicitly.** On larger boards, cascades + the
   turn-gate make true cycles plausible (a position that can repeat forever with
   neither side forced to break it). Decide the semantics **before** running:
   - Treat a repeat-on-path as a **draw** (as the small-board solver did), or
   - Impose a **move-count / repetition cap** and classify a capped line as a
     draw. Record which rule was used — the "deterministic winner?" answer is
     only meaningful relative to it.

5. **Parallelize if needed.** Independent opening moves (modulo symmetry) are
   embarrassingly parallel — fan the first ply out across workers / child
   processes (the repo already spawns `tools/calibrate-sample-worker.js`, a
   usable pattern) and union their transposition results. Persist the
   transposition table to disk so a long solve can resume.

6. **Verify the verdict, don't just trust the search.** As with 3×3, once a
   forced winner is claimed, run a **constructive replay**: winner follows the
   solved strategy, loser branches over all moves (here, over a *sampled* or
   *symmetry-reduced* set if full is still too large), asserting the loser never
   wins and no line exceeds the repetition cap. A verdict without a constructive
   check is weaker evidence.

### Minimal solver skeleton to resume from

```js
const JS = require('./js/game.js');
const { createGame, applyMove, cloneState } = JS;

function moves(s) {
  if (s.winner !== 0) return [];
  const out = [];
  for (let r = 0; r < s.rows; r++)
    for (let c = 0; c < s.cols; c++) {
      const cell = s.cells[r * s.cols + c];
      if (cell.owner === 0 || cell.owner === s.current) out.push([r, c]);
    }
  return out;
}

// TODO for 4x4: replace with a canonical, symmetry-reduced, compact — and
// LOSSLESS — key. Distinct positions must map to distinct keys; a bare/short
// hash risks collisions that merge positions and corrupt the exact result.
function key(s) {
  return s.cells.map(x => x.owner + ':' + x.value).join('|') +
         '#' + s.current + '#' + s.turnsTaken.join(',');
}

const memo = new Map();
const onPath = new Set();

function solve(state /*, depth, alpha, beta */) {
  if (state.winner !== 0) return state.winner;
  const k = key(state);
  if (memo.has(k)) return memo.get(k);
  if (onPath.has(k)) return 0;        // cycle -> draw (decide this policy first)
  onPath.add(k);
  const me = state.current;
  let canWin = false, sawDraw = false, oppWin = null;
  for (const [r, c] of moves(state)) {  // TODO: order strong moves first
    const s2 = cloneState(state);
    if (!applyMove(s2, me, r, c)) continue;
    const w = solve(s2);
    if (w === me) { canWin = true; break; }
    if (w === 0) sawDraw = true; else oppWin = w;
  }
  onPath.delete(k);
  const out = canWin ? me : (sawDraw ? 0 : (oppWin === null ? 0 : oppWin));
  memo.set(k, out);
  return out;
}
```

Run deep recursion with `node --stack-size=65500 solver.js` (or convert the
recursion to an explicit stack for very large runs).

## Caveats

- All results are for the **engine's current variant** (start-empty, turn-gate,
  2 players). A different starting condition (e.g. "start with 1", an
  occupation phase) or a different player count would need re-solving.
- "Deterministic winner" always means **under perfect play**. On every solved
  board here the *starter can still win if the opponent misplays* — the forced
  result only binds against optimal defence.
- These notes are analysis, not a code change; no engine behaviour was modified.
