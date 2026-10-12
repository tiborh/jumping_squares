/*
 * SPDX-FileCopyrightText: 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Jumping Squares — AI think-time CALIBRATION CLI (Node, dependency-free).
 *
 * The command-line companion to the in-app Board-size calibration. It shares
 * the SAME cost model (js/calibrate.js) and the SAME bounded sampler
 * (tools/calibrate-sample-worker.js) as the browser panel, so the numbers can
 * never drift — a drift test in test/game.test.js asserts the CLI and the
 * helper agree.
 *
 * Like the in-app calibration it is FAST + APPROXIMATE: it MEASURES a couple of
 * cheap board sizes on THIS machine (each in a child process with a hard
 * timeout, so it cannot hang) and EXTRAPOLATES the larger ones with a
 * conservative growth curve. Results are device- and load-dependent.
 *
 * Usage:
 *   node tools/calibrate.js                 # full table: every AI, sizes >5x5
 *   node tools/calibrate.js --size 10       # one board size, every AI
 *   node tools/calibrate.js --max-wait 3    # per AI, the largest size <= 3 s
 *   node tools/calibrate.js --max-wait 3 --size 10   # just flag 10x10 vs 3 s
 *   node tools/calibrate.js --json          # machine-readable output
 *   node tools/calibrate.js --no-measure    # skip measuring; use the fallback
 *                                           # model only (instant, least exact)
 *   node tools/calibrate.js --help
 *
 * Exit code: 0 on success; 1 on a usage error.
 */
'use strict';

var path = require('path');
var cp = require('child_process');
var C = require(path.join(__dirname, '..', 'js', 'calibrate.js'));

var WORKER = path.join(__dirname, 'calibrate-sample-worker.js');
var SAMPLE_TIMEOUT_MS = 20000; // hard cap per measured sample

// ---- arg parsing --------------------------------------------------------
function parseArgs(argv) {
  var opts = { size: null, maxWaitS: null, json: false, measure: true, help: false,
               minMeasure: null, maxMeasure: null, step: null };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-measure') opts.measure = false;
    else if (a === '--size') opts.size = parseInt(argv[++i], 10);
    else if (a.indexOf('--size=') === 0) opts.size = parseInt(a.slice(7), 10);
    else if (a === '--max-wait') opts.maxWaitS = parseFloat(argv[++i]);
    else if (a.indexOf('--max-wait=') === 0) opts.maxWaitS = parseFloat(a.slice(11));
    else if (a === '--min-measure') opts.minMeasure = parseInt(argv[++i], 10);
    else if (a.indexOf('--min-measure=') === 0) opts.minMeasure = parseInt(a.slice(14), 10);
    else if (a === '--max-measure') opts.maxMeasure = parseInt(argv[++i], 10);
    else if (a.indexOf('--max-measure=') === 0) opts.maxMeasure = parseInt(a.slice(14), 10);
    // --step is the canonical name; --stepping is accepted as an alias.
    else if (a === '--step' || a === '--stepping') opts.step = parseInt(argv[++i], 10);
    else if (a.indexOf('--step=') === 0) opts.step = parseInt(a.slice(7), 10);
    else if (a.indexOf('--stepping=') === 0) opts.step = parseInt(a.slice(11), 10);
    else { opts._error = 'unknown argument: ' + a; }
  }
  return opts;
}

function usage() {
  return [
    'Usage: node tools/calibrate.js [--size N] [--max-wait S] [--json]',
    '                               [--no-measure] [--help]',
    '                               [--min-measure N] [--max-measure N] [--step K]',
    '',
    '  (no args)     full table: estimated worst-case think time per AI for',
    '                board sizes above the standard 5x5 (6x6..12x12).',
    '  --size N      restrict the table to the N x N board.',
    '  --max-wait S  treat S seconds as the acceptable wait: mark over-limit',
    '                times, and (table mode) report the largest safe size per AI.',
    '  --json        machine-readable output.',
    '  --no-measure  skip on-device measuring; use the built-in fallback model',
    '                (instant, least accurate).',
    '',
    'Which sizes are actually MEASURED on this machine (the anchors the rest are',
    'extrapolated from) \u2014 for experimenting with the cost curve:',
    '  --min-measure N  smallest board to measure (default 6).',
    '  --max-measure N  largest board to measure (default 8). Larger anchors give',
    '                   a better fit but each measured size costs real think time',
    '                   (bounded by a ' + (SAMPLE_TIMEOUT_MS / 1000) + ' s per-move timeout).',
    '  --step K         step between measured sizes (default 2). "--stepping" is',
    '                   accepted as an alias.',
    '  e.g.  --min-measure 8 --max-measure 10 --step 1   measures 8,9,10',
    '',
    'FAST + APPROXIMATE: measures a few sizes on THIS machine and extrapolates',
    'larger ones (conservatively). Device/CPU-load dependent.',
  ].join('\n');
}

// ---- bounded on-device sampler ------------------------------------------
// Returns a runOne(size, depth) -> ms|null that times one worst-case move in a
// child process, killed after SAMPLE_TIMEOUT_MS (null => did not finish).
function makeRunOne(verbose) {
  return function runOne(size, depth) {
    if (verbose) process.stderr.write('  measuring ' + size + 'x' + size +
                                      ' depth ' + depth + ' ... ');
    var res = cp.spawnSync(process.execPath,
      [WORKER, String(size), String(depth)],
      { timeout: SAMPLE_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (res.error && res.error.code === 'ETIMEDOUT') {
      if (verbose) process.stderr.write('timed out\n');
      return null;
    }
    if (res.status !== 0) { if (verbose) process.stderr.write('error\n'); return null; }
    var out = (res.stdout || '').trim();
    var ms = parseFloat(out);
    if (!isFinite(ms)) { if (verbose) process.stderr.write(out + '\n'); return null; }
    if (verbose) process.stderr.write(ms.toFixed(0) + ' ms\n');
    return ms;
  };
}

function fmtMs(ms) {
  if (!isFinite(ms)) return '  n/a';
  if (ms < 1000) return Math.round(ms) + ' ms';
  return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
}

// ---- main ---------------------------------------------------------------
function main() {
  var opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(usage()); return 0; }
  if (opts._error) { console.error(opts._error + '\n\n' + usage()); return 1; }

  if (opts.size !== null &&
      (!isFinite(opts.size) || opts.size < C.MIN_SIZE || opts.size > C.MAX_SIZE)) {
    console.error('--size must be ' + C.MIN_SIZE + '..' + C.MAX_SIZE);
    return 1;
  }
  if (opts.maxWaitS !== null && (!isFinite(opts.maxWaitS) || opts.maxWaitS <= 0)) {
    console.error('--max-wait must be a positive number of seconds');
    return 1;
  }

  // Build the list of sizes to MEASURE (the anchors) from the range flags.
  // Defaults preserve the previous behaviour (measure 6 and 8). The sampler
  // only measures Shark (the only AI whose cost scales), so these sizes are
  // the ones that get real think-time spent on them.
  var measureSizes = null; // null => helper default [6, 8]
  if (opts.minMeasure !== null || opts.maxMeasure !== null || opts.step !== null) {
    var lo = (opts.minMeasure !== null) ? opts.minMeasure : 6;
    var hi = (opts.maxMeasure !== null) ? opts.maxMeasure : 8;
    var step = (opts.step !== null) ? opts.step : 2;
    if (!isFinite(lo) || !isFinite(hi) || lo < C.MIN_SIZE || hi > C.MAX_SIZE || lo > hi) {
      console.error('--min-measure/--max-measure must be ' + C.MIN_SIZE + '..' +
                    C.MAX_SIZE + ' with min <= max');
      return 1;
    }
    if (!isFinite(step) || step < 1) {
      console.error('--step must be a positive integer');
      return 1;
    }
    measureSizes = [];
    for (var ms2 = lo; ms2 <= hi; ms2 += step) measureSizes.push(ms2);
    // At least two distinct anchors are needed to fit the growth curve; with a
    // single measured size the projection falls back to the generic exponent.
    if (measureSizes.length < 2 && !opts.json) {
      process.stderr.write('Note: only ' + measureSizes.length +
        ' size measured — need >=2 to fit the curve; larger boards use the ' +
        'generic exponent anchored to that point.\n');
    }
  }

  var maxWaitMs = (opts.maxWaitS !== null) ? opts.maxWaitS * 1000 : null;
  var sizes = (opts.size !== null) ? [opts.size] : C.tableSizes();

  // Measure (unless suppressed) to make the estimates device-specific.
  var samples = {};
  if (opts.measure) {
    if (!opts.json) {
      var sampleArg = measureSizes || [6, 8];
      var est = C.estimateCalibrationMs({ sampleSizes: sampleArg });
      process.stderr.write('Calibrating on this machine (~' +
        Math.ceil(est / 1000) + ' s; measuring ' +
        sampleArg.map(function (s) { return s + 'x' + s; }).join(', ') +
        ', extrapolating the rest)\n');
    }
    samples = C.measureCheapSizes(makeRunOne(!opts.json),
      { at: new Date().toISOString(),
        sampleSizes: measureSizes || undefined });
  }

  var table = C.projectTable(samples, sizes);

  if (opts.json) {
    var jsonRows = table.map(function (t) {
      var row = { agent: t.row.agent, label: t.row.label,
                  difficulty: t.row.difficulty, cells: {} };
      sizes.forEach(function (s) {
        row.cells[s] = { ms: t.cells[s],
          over: (maxWaitMs !== null) ? C.isOverThreshold(t.cells[s], maxWaitMs) : null };
      });
      if (maxWaitMs !== null && opts.size === null) {
        row.largestSafeSize = C.largestSafeSize(t.row, samples, maxWaitMs);
      }
      return row;
    });
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      measured: opts.measure,
      maxWaitMs: maxWaitMs,
      sizes: sizes,
      rows: jsonRows,
    }, null, 2));
    return 0;
  }

  // Human-readable table.
  var header = ['AI / difficulty'.padEnd(18)]
    .concat(sizes.map(function (s) { return (s + 'x' + s).padStart(8); }));
  if (maxWaitMs !== null && opts.size === null) header.push('  max safe');
  console.log(header.join(''));
  console.log('-'.repeat(header.join('').length));

  table.forEach(function (t) {
    var cols = [t.row.label.padEnd(18)];
    sizes.forEach(function (s) {
      var ms = t.cells[s];
      var cell = fmtMs(ms).padStart(8);
      if (maxWaitMs !== null && C.isOverThreshold(ms, maxWaitMs)) cell = cell + '*';
      else if (maxWaitMs !== null) cell = cell + ' ';
      cols.push(cell.padStart(8));
    });
    if (maxWaitMs !== null && opts.size === null) {
      var safe = C.largestSafeSize(t.row, samples, maxWaitMs);
      cols.push('   ' + (safe ? (safe + 'x' + safe) : '— '));
    }
    console.log(cols.join(''));
  });

  if (maxWaitMs !== null) {
    console.log('');
    console.log('(* = estimated worst-case move exceeds ' + opts.maxWaitS +
                ' s; "max safe" = largest board within that wait)');
  }
  console.log('');
  console.log('Estimates are APPROXIMATE and device-dependent (conservative, ' +
              'rounded up). Re-run if your hardware or system load changes.');
  return 0;
}

process.exit(main());
