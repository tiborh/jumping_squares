<!--
  SPDX-FileCopyrightText: 2025 - 2026 tiborh
  SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Strategy notes

Research notes on how **Jumping Squares** (and the wider *critical-mass /
chain-reaction* family it belongs to — see the README's *History* and *Related
games* sections) is played well, by people and by machines. This is **not** a
rulebook (the rules are in the README); it collects publicly documented
strategy, with sources, so future work — especially the planned **AI opponent**
— has a grounded starting point.

A standing caveat, stated up front because it shapes everything below: this is a
**deterministic, perfect-information game with no element of chance** [3][5], yet
it is famously *swingy*. The obvious heuristic — "whoever has the most orbs is
winning" — is **misleading**: a position that looks won for one player can flip
entirely on a single cascade [1]. Good play is about *cascade potential and
capture safety*, not material count.

## Human strategy (positional heuristics)

People cannot read deep chain reactions in their heads, so human strategy is a
set of **positional rules of thumb**. The most authoritative list is KDE's
**KJumpingCube Handbook**, "Strategies and Tips" [2]; the points below paraphrase
it (and the common community advice that agrees with it):

- **Take the corners first, then the edges.** Corner cells have capacity 2 and
  edge cells 3 (vs 4 for interior), so they reach overflow — and start
  capturing — in the fewest moves [2]. Low-capacity cells are the cheapest
  "engines".
- **Win the local arms race, or don't enter it.** If one of your cells sits
  next to an opponent's, stay *one ahead* by increasing before they do. If you
  are already *equal or behind* next to them, **stop adding** — you cannot win
  that exchange and you are only building a cell they will capture [2].
- **Increase-and-capture, but watch the counter-cascade.** Look for moves that
  overflow into and capture enemy cells, but check whether the opponent can
  reply with a *larger* chain reaction that captures more back [2].
- **Keep your distance in the opening.** Don't play right beside the opponent
  early; drop back a cell or two, or play on the **diagonal** from them —
  diagonal cells are not neighbours, so there is no immediate capture risk [2].
- **Guard your near-full chains; hunt theirs.** Long runs of cells that are one
  short of overflow are powerful but fragile. Protect your own from a triggering
  cascade; target the opponent's once they come within reach of your territory
  [2].

## Machine strategy (search + evaluation)

Machines play the *same* game toward the *same* optimum, but reach good moves a
different way: they **simulate cascades forward** and pick the move with the
best evaluated result — exactly the calculation humans can't do by hand.

- **Search.** The standard approach for this family is **minimax with
  alpha-beta pruning**, or **Monte-Carlo Tree Search (MCTS)**. The UC Berkeley
  CS 61B "Jump61" project is a well-known teaching implementation using minimax
  [4]; many public implementations and an ITB study use the same families [6].
- **Evaluation function.** Search needs a way to score a non-terminal board.
  Documented options range from the purely quantitative — **total orb count**
  vs **number of owned cells** [6] — to richer heuristics. The **Brilliant**
  wiki gives a representative expert heuristic [1], in essence:
  - won board `+10000`, lost board `-10000`;
  - call a cell **critical** when it is one orb short of exploding;
  - **penalise** your orbs adjacent to an *enemy* critical cell (they are
    capturable), scaled by that cell's capacity (corners most dangerous);
  - **reward** orbs with no adjacent enemy-critical cell — extra for edge/corner
    placement and for your own critical cells;
  - `+1` per owned orb; and a bonus for **contiguous blocks of your own critical
    cells** (chains that can cascade together).

Notice that this evaluation is essentially the **human tips turned into
numbers**: corner/edge value, capture safety, and chain potential.

## Is the winning strategy different for a machine vs a human?

**In principle, no; in practice, very.** Because the game is deterministic with
perfect information [3][5], there is a single game-theoretic optimum both would
ideally follow. The difference is *how each reaches good moves*:

| | Human | Machine |
|---|---|---|
| Primary tool | Positional **heuristics** (corners→edges, arms-race discipline, chain safety) | **Forward search** (minimax / MCTS) over an evaluation function |
| Strength | Fast, robust pattern judgement | Deep, exact cascade calculation |
| Weakness | Can't simulate multi-step cascades mentally | Only as good as its evaluation + search depth |
| Typical move style | Conservative, positional (reduce swinginess) | Will play **counter-intuitive, cascade-dependent** moves that look wrong until the chain resolves (exploit swinginess) |

So the heuristics humans *use as rules* are the same knowledge a machine
*encodes in its evaluation function* and then verifies by search. A strong
engine's edge is depth of cascade lookahead; a human's tools are the
rules-of-thumb that approximate it. KJumpingCube reflects this unity in one
engine: its computer player has **adjustable skill levels** and can even hand a
human **hints** from the same evaluation it would use to play [2][3].

## The three machine players are *styles*, not a strict strength ladder

The shipped AI offers three agents, each a different *way of choosing a move*
rather than three rungs of a single strength scale:

| Agent | Style | How it chooses |
|---|---|---|
| **Random** | Chaos / sparring dummy | Any legal move, uniformly. |
| **Tutor** | Positional **heuristic** (human-style) | Scores each move by a one-ply evaluation of the resulting board. **Easy** uses the documented positional tips (corners→edges, mild chain/capture terms). **Medium** adds a bounded *one-opponent-reply lookahead* — it defends cells under local threat and refuses to hand over an immediate capturing cascade. |
| **Shark** | **Forward search** (machine-style) | Minimax + alpha-beta to a configurable depth (**Easy 2 / Medium 3 / Hard 4**) over the real cascade resolution. Finds counter-intuitive, cascade-dependent lines a human can't compute by eye. |

Because these are different *tools*, their strengths **overlap rather than form
a clean line** — and that is by design, not a defect.

**Documented overlap: Tutor-Medium is stronger than Shark-Easy.** In
agent-vs-agent testing (`test/agents.harness.js`, first move alternated, wins
tallied by agent):

| Matchup | Result (≈, N=300, 3 seeds) |
|---|---|
| Tutor-Medium vs Shark-Easy (depth 2) | **Tutor-Medium ~68–71%** |
| Tutor-Medium vs Shark-Medium (depth 3) | Shark ~60% |
| Shark-Easy vs Tutor-Easy | Shark ~70–90% |

So the rough ordering is **Tutor-Easy < Shark-Easy < Tutor-Medium <
Shark-Medium ≤ Shark-Hard** — i.e. **Tutor-Medium slots *above* the weakest
Shark**, not below it. Why: Shark-Easy only looks two plies ahead with a static
evaluation that lacks Tutor-Medium's explicit *"don't expose a capturable
cluster"* rule, so at shallow depth it walks into exactly the giveaway Medium is
built to avoid; Shark needs depth 3 before its search reliably punishes Medium.

This is **intended and left as-is**: the three agents are offered as distinct
playing *styles* (random, heuristic, deep search), so a player can experience
different kinds of opposition — not as a single monotonic difficulty dial.
Someone climbing in difficulty might reasonably go Tutor-Easy → Shark-Easy →
Tutor-Medium → Shark-Medium → Shark-Hard, but the heuristic and search families
are not meant to interleave perfectly.

## Relevance to this project's AI (future work)

The engine is already shaped for this (see the README *Extending it* section):

- `cloneState()` gives a cheap, independent snapshot to explore candidate lines
  without mutating the live game — the substrate for minimax/MCTS lookahead.
- `applyMove()` (and the stepped `placeDot` / `stepOverflowsOnce` /
  `finalizeAfterCascade`) deterministically resolves a move, so simulated
  play-outs reproduce real cascades exactly.
- A first evaluation function could start from the simplest documented options
  (**owned-cell count** or **orb count** [6]) and grow toward the Brilliant
  capture-safety / chain heuristic [1]. Given the swinginess caveat, lean on
  **search depth** over material-only scoring.

## Shark performance, difficulty, and device calibration (future work)

The shipped **Shark** agent (minimax + alpha-beta) exposes **search depth** as
its difficulty: **Easy = 2, Medium = 3, Hard = 4**. Cost grows roughly as
`branching_factor ^ depth`, and the branching factor is about the board area
(≈ number of legal moves), so per-move time scales roughly `area ^ depth`.

Measured per-move time (mid-game positions, one development machine — see the
device caveat below):

| Board | depth 2 | depth 3 | depth 4 |
|------:|--------:|--------:|--------:|
| 5×5   | ~7 ms   | ~20 ms  | ~90 ms  |
| 7×7   | ~12 ms  | ~110 ms | ~680 ms |
| 9×9   | ~40 ms  | ~450 ms | ~3.8 s  |
| 10×10 | ~70 ms  | ~1.1 s  | ~8 s    |
| 12×12 | ~190 ms | ~2.6 s  | ~33 s   |

Reading: on the **current fixed 5×5** every depth is fast, so difficulty maps
straight to depth with no downside. But for the planned **board-size picker**
(up to ~12×12): depth 2 stays snappy everywhere; depth 3 is comfortable to
~8×8; depth 4 is only comfortable to ~6–7×7 and becomes unusable on big boards.

**Device caveat — why a calibration utility is needed.** This search is
single-threaded, CPU-bound JavaScript (no GPU, no workers), so per-move time is
strongly **device-dependent** — easily 5–10× between a fast desktop and a
budget phone. Any hard-coded "this setting takes ~X ms" hint would therefore be
wrong on most devices. When the board-size picker lands, the robust approach is:

- **One-time (cached) in-browser calibration.** Run a tiny fixed Shark search on
  a known position (a few hundred ms) to measure *this device's* actual speed
  (nodes/sec), store it in prefs (feature-detected/wrapped like the rest of the
  storage code), and allow re-running it (hardware and thermal throttling vary).
- **Scaled estimates.** From the measured speed and the `~area ^ depth` cost
  model, show a per-device, per-(size, depth) estimate next to the difficulty
  control, recomputed when size or difficulty changes.
- **Guardrail / time budget.** If the estimate exceeds a threshold (say
  ~1–2 s/move), warn or soft-cap the depth. The cleaner long-term form is
  **iterative deepening with a per-move time budget**: search depth 1, 2, 3 …
  until the budget is hit and return the best move found so far. Difficulty then
  becomes a *time* target that is inherently device-adaptive and cannot lag,
  regardless of board size — and the calibration feeds a realistic default
  budget.

None of this is needed for the fixed 5×5 build; it is captured here so the
board-size picker and Shark difficulty can be made to play well together on any
device.

## References

1. *Chain Reaction game* — Brilliant Math & Science Wiki. Rules plus an
   explicit expert **heuristic evaluation** (critical cells, capture-safety,
   chain blocks); notes that "most orbs" is a misleading heuristic.
   <https://brilliant.org/wiki/chain-reaction-game/>
2. *The KJumpingCube Handbook* — "Game Rules, Strategies and Tips". The primary
   human-strategy source for this clone's direct ancestor (corners→edges, the
   arms-race rule, opening distance, guarding chains).
   <https://docs.kde.org/stable_kf6/en/kjumpingcube/kjumpingcube/rules_and_tips.html>
3. *The KJumpingCube Handbook* — rules note that it is a pure-strategy game with
   no chance, with configurable computer players, skill levels, and hints.
   <https://docs.kde.org/stable_kf6/en/kjumpingcube/kjumpingcube/>
4. UC Berkeley **CS 61B** — Project "Jump61", a KJumpingCube-based assignment
   specifying a minimax AI; a good second rules/AI reference.
   <https://inst.eecs.berkeley.edu/~cs61b/fa21/materials/proj/proj2/>
5. *The KJumpingCube Handbook* — "How to Play" (overflow/cascade description).
   <https://docs.kde.org/stable_kf6/en/kjumpingcube/kjumpingcube/howto.html>
6. Example academic/implementation treatments using **minimax / alpha-beta**
   and comparing quantitative evaluations (**orb count** vs **owned cells**),
   e.g. an ITB *Strategi Algoritma* paper on a minimax Chain Reaction agent, and
   numerous open-source minimax/MCTS implementations of the mechanic.

*Sources retrieved 2026. KDE material is published by the KDE community; the
Brilliant wiki page notes it is an archived (no longer maintained) resource but
remains a useful strategy reference.*
