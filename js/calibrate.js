/*
 * SPDX-FileCopyrightText: 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Jumping Squares — AI think-time CALIBRATION helper (DOM-free, dependency-free).
 *
 * Dual-exported like js/game.js and js/agents.js (browser global
 * `window.JumpingSquaresCalibrate` + Node `module.exports`). It is the SINGLE
 * SOURCE OF TRUTH for the board-size feature's "how long will the AI think?"
 * estimates, shared by BOTH the in-app Settings panel and the `tools/calibrate.js`
 * CLI so the two can never drift (the same pattern as the engine's shared
 * `bestMove` / `storageKeysToClear` helpers, guarded by a drift test).
 *
 * WHY A MODEL (and why it is APPROXIMATE):
 *   Running the strongest AI (Shark "Hard", depth 4) directly on a large board
 *   can take MANY SECONDS to over a MINUTE per move — measuring every size that
 *   way would itself hang (that is the whole problem this feature addresses).
 *   So calibration MEASURES a couple of CHEAP sizes ON THIS DEVICE and
 *   EXTRAPOLATES the expensive ones with a growth curve. Device/CPU-load
 *   dependent and deliberately CONSERVATIVE (it rounds UP), so the table is a
 *   GUIDE, not a guarantee. Re-calibrate if the device or system load changes.
 *
 * Shape of a "samples" object (produced by measureCheapSizes, consumed by
 * projectTable):
 *   {
 *     device: <free-form string, optional>,
 *     at:     <ISO timestamp, optional>,
 *     // per Shark depth, measured worst-case ms at a few cheap sizes:
 *     shark: { <depth>: { <cells>: <ms>, ... }, ... },
 *     // flat near-instant cost (ms) for the positional AIs:
 *     flatMs: <number>
 *   }
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JumpingSquaresCalibrate = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Board sizes the feature offers. The standard game is 5x5; the picker adds
  // 6x6..12x12 (square only, per the agreed design). 2x2..4x4 are trivially
  // fast and always available, so the TABLE focuses on sizes ABOVE 5x5 where
  // think time actually matters — but the slider/selector allow 2..12.
  var MIN_SIZE = 2;
  var MAX_SIZE = 12;
  var STANDARD_SIZE = 5;

  // Sizes shown in the estimate table (above the standard board).
  function tableSizes() {
    var out = [];
    for (var n = STANDARD_SIZE + 1; n <= MAX_SIZE; n++) out.push(n);
    return out;
  }

  // Max-wait slider: 9 discrete stops, rightmost = 60 s (nobody waits longer).
  // Milliseconds, ascending; the slider index maps straight into this array.
  var MAXWAIT_STOPS_MS = [500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 60000];
  var DEFAULT_MAXWAIT_MS = 5000; // index 4 — a sensible middle default.

  function maxWaitIndexToMs(index) {
    var i = parseInt(index, 10);
    if (!isFinite(i) || i < 0) i = 0;
    if (i >= MAXWAIT_STOPS_MS.length) i = MAXWAIT_STOPS_MS.length - 1;
    return MAXWAIT_STOPS_MS[i];
  }

  function maxWaitMsToIndex(ms) {
    // Snap to the nearest stop at or above `ms` (so the chosen cap is never
    // looser than asked); fall back to the closest if above the top stop.
    var n = (typeof ms === 'number' && isFinite(ms)) ? ms : DEFAULT_MAXWAIT_MS;
    for (var i = 0; i < MAXWAIT_STOPS_MS.length; i++) {
      if (MAXWAIT_STOPS_MS[i] >= n) return i;
    }
    return MAXWAIT_STOPS_MS.length - 1;
  }

  // The machine players shown in the table. Random/Tutor are positionally
  // cheap (near-instant at any size); only Shark's cost scales with the board.
  // Each row is { agent, label, difficulty, depth? }. `depth` is set only for
  // Shark (its difficulty IS the search depth: 2=Easy, 3=Medium, 4=Hard).
  function tableRows() {
    return [
      { agent: 'Random', label: 'Random — Easy',  difficulty: 'easy'   },
      { agent: 'Random', label: 'Random — Medium', difficulty: 'medium' },
      { agent: 'Tutor',  label: 'Tutor — Easy',   difficulty: 'easy'   },
      { agent: 'Tutor',  label: 'Tutor — Medium',  difficulty: 'medium' },
      { agent: 'Shark',  label: 'Shark — Easy',   difficulty: 'easy',   depth: 2 },
      { agent: 'Shark',  label: 'Shark — Medium',  difficulty: 'medium', depth: 3 },
      { agent: 'Shark',  label: 'Shark — Hard',   difficulty: 'hard',   depth: 4 },
    ];
  }

  // ---- the cost model -----------------------------------------------------
  //
  // Shark is minimax + alpha-beta: cost grows ~ branching^depth, and branching
  // scales with the number of cells. Empirically (and conservatively) we model
  // one Shark move at a given depth as a POWER LAW in the cell count:
  //
  //     ms(cells) = a * cells ^ b
  //
  // where (a, b) are fitted PER DEPTH from the device's measured cheap-size
  // samples (two points -> exact power-law fit; more -> least-squares in log
  // space). This captures the super-linear blow-up far better than a linear
  // guess while needing only cheap measurements.
  //
  // CONSERVATIVE_FACTOR inflates the projection so the estimate errs on the
  // side of "slower than reality" — better to warn (red) than to lull the user
  // into picking a size that then stalls.
  var CONSERVATIVE_FACTOR = 1.25;

  // Fallback coefficients (used only if a depth has no device samples at all),
  // FITTED from the project's reference measurements for Shark "Hard" (depth 4,
  // worst-case per move): 8x8 ~ 2800 ms and 10x10 ~ 9000 ms give the power law
  // ms = 0.0527 * cells^2.616 (which projects 12x12 ~ 23 s, matching the >=20 s
  // timeout seen in practice). Depths 3 and 2 are derived from the same
  // exponent scaled down by the typical per-ply work ratio after alpha-beta
  // pruning on these boards (~6x per ply). They are a LAST RESORT only — real
  // on-device calibration always overrides them, and these are the pre-first-
  // calibration display + the up-front duration guess. The reference machine is
  // a developer desktop; a slower device will exceed these, which is why the
  // model is deliberately conservative and the result is documented as
  // approximate.
  var FALLBACK = {
    2: { a: 0.001464, b: 2.6163 },
    3: { a: 0.008781, b: 2.6163 },
    4: { a: 0.052688, b: 2.6163 },
  };

  // Fit (a, b) for ms = a * cells^b from a {cells: ms} map. Returns null if
  // there are fewer than 2 usable, positive points.
  function fitPowerLaw(pointMap) {
    var xs = [], ys = [];
    Object.keys(pointMap || {}).forEach(function (k) {
      var cells = parseFloat(k), ms = pointMap[k];
      if (isFinite(cells) && cells > 0 && isFinite(ms) && ms > 0) {
        xs.push(Math.log(cells));
        ys.push(Math.log(ms));
      }
    });
    if (xs.length < 2) return null;
    // Least-squares line in log-log space: ln(ms) = ln(a) + b*ln(cells).
    var n = xs.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) {
      sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i];
    }
    var denom = (n * sxx - sx * sx);
    if (denom === 0) return null;
    var b = (n * sxy - sx * sy) / denom;
    var lnA = (sy - b * sx) / n;
    return { a: Math.exp(lnA), b: b };
  }

  // Estimated worst-case ms for one move of `row` on an N x N board, given the
  // device `samples`. Random/Tutor use the flat near-instant cost; Shark uses
  // the fitted (or fallback) power law times the conservative factor.
  function estimateMs(row, size, samples) {
    samples = samples || {};
    var cells = size * size;
    if (row.agent !== 'Shark') {
      var flat = (typeof samples.flatMs === 'number' && samples.flatMs > 0)
        ? samples.flatMs : 1; // ~instant; 1 ms floor so it is never 0
      // Positional cost is ~linear in cells; keep it tiny and honest.
      return flat * (cells / (STANDARD_SIZE * STANDARD_SIZE));
    }
    var depth = row.depth;
    var fit = null;
    if (samples.shark && samples.shark[depth]) {
      fit = fitPowerLaw(samples.shark[depth]);
    }
    if (!fit) fit = FALLBACK[depth] || FALLBACK[4];
    return CONSERVATIVE_FACTOR * fit.a * Math.pow(cells, fit.b);
  }

  // Build the full estimate table: an array of { row, cells:{size:ms,...} }.
  // `sizes` defaults to the above-standard table sizes.
  function projectTable(samples, sizes) {
    sizes = sizes || tableSizes();
    return tableRows().map(function (row) {
      var cells = {};
      sizes.forEach(function (size) {
        cells[size] = estimateMs(row, size, samples);
      });
      return { row: row, cells: cells };
    });
  }

  // Is this estimated time over the user's max-wait threshold? (The UI paints
  // such cells RED.) Strictly greater-than, so a time exactly at the cap is OK.
  function isOverThreshold(ms, maxWaitMs) {
    return isFinite(ms) && isFinite(maxWaitMs) && ms > maxWaitMs;
  }

  // Largest board size whose estimate stays within maxWaitMs for a given row.
  // Returns 0 if even the smallest table size is over (shouldn't happen for the
  // positional AIs). Scans contiguous sizes from STANDARD_SIZE+1 upward.
  function largestSafeSize(row, samples, maxWaitMs, sizes) {
    sizes = sizes || tableSizes();
    var best = 0;
    for (var i = 0; i < sizes.length; i++) {
      if (!isOverThreshold(estimateMs(row, sizes[i], samples), maxWaitMs)) {
        best = sizes[i];
      } else {
        break; // monotonic: once over, larger sizes stay over
      }
    }
    return best;
  }

  // ---- device sampling (bounded; runner injected) -------------------------
  //
  // measureCheapSizes MEASURES Shark at CHEAP sizes on the current device so
  // projectTable can extrapolate. It is DOM-free and side-effect-free: the
  // caller injects `runOne(size, depth) -> ms|null`, which actually times one
  // worst-case bestMove with ITS OWN hard timeout (the browser runs it inline;
  // the CLI/bounded sampler runs it in a child process). A null return means
  // "did not finish in time" and that point is simply skipped.
  //
  // We sample depth 4 (the strongest, and the only one that can get slow) at
  // two cheap sizes by default (6x6 and 8x8), plus optionally depth 3, and
  // derive depths 2/3 from the same curve shape when not measured. Keeping the
  // sample set small is what makes calibration take SECONDS, not an hour.
  var DEFAULT_SAMPLE_SIZES = [6, 8];

  function measureCheapSizes(runOne, opts) {
    opts = opts || {};
    var sizes = opts.sampleSizes || DEFAULT_SAMPLE_SIZES;
    var depths = opts.depths || [2, 3, 4];
    var samples = { shark: {}, flatMs: 1, at: opts.at, device: opts.device };
    depths.forEach(function (depth) {
      var map = {};
      sizes.forEach(function (size) {
        var ms = runOne(size, depth);
        if (typeof ms === 'number' && isFinite(ms) && ms > 0) {
          map[size * size] = ms;
        }
      });
      if (Object.keys(map).length) samples.shark[depth] = map;
    });
    return samples;
  }

  // Rough up-front estimate (ms) of how long a calibration RUN will take, so
  // the UI can warn the user before they start. It is the sum of the cheap
  // sample measurements (each capped by the caller's per-run timeout). We use
  // the FALLBACK model for the pre-run guess since we have no device data yet.
  function estimateCalibrationMs(opts) {
    opts = opts || {};
    var sizes = opts.sampleSizes || DEFAULT_SAMPLE_SIZES;
    var depths = opts.depths || [2, 3, 4];
    var total = 0;
    depths.forEach(function (depth) {
      var fit = FALLBACK[depth] || FALLBACK[4];
      sizes.forEach(function (size) {
        total += fit.a * Math.pow(size * size, fit.b);
      });
    });
    return total;
  }

  return {
    MIN_SIZE: MIN_SIZE,
    MAX_SIZE: MAX_SIZE,
    STANDARD_SIZE: STANDARD_SIZE,
    MAXWAIT_STOPS_MS: MAXWAIT_STOPS_MS,
    DEFAULT_MAXWAIT_MS: DEFAULT_MAXWAIT_MS,
    CONSERVATIVE_FACTOR: CONSERVATIVE_FACTOR,
    tableSizes: tableSizes,
    tableRows: tableRows,
    maxWaitIndexToMs: maxWaitIndexToMs,
    maxWaitMsToIndex: maxWaitMsToIndex,
    fitPowerLaw: fitPowerLaw,
    estimateMs: estimateMs,
    projectTable: projectTable,
    isOverThreshold: isOverThreshold,
    largestSafeSize: largestSafeSize,
    measureCheapSizes: measureCheapSizes,
    estimateCalibrationMs: estimateCalibrationMs,
  };
});
