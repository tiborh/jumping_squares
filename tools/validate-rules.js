#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * validate-rules.js - check the GAME-RULE (semantic) validity of a Jumping
 * Squares backup file. This is deliberately SEPARATE from the schema validator
 * (tools/validate-schema.js): schema validity is about file shape; game-rule
 * validity is about whether the board is a legitimate, reachable, settled
 * position the app would actually load. Those invariants (point conservation,
 * the turn-gate, the winner rule, no mid-cascade overflow, a legal move for the
 * player to move, turn-order consistency with the opener) are NOT expressible
 * in JSON Schema - they are computed by the game engine. So this validator runs
 * the file's board section through the engine's own loadState(), the single
 * source of truth the app itself uses on import.
 *
 * Recommended order: run validate-schema.js FIRST (shape), then this (rules).
 * A file that passes both will load in the app.
 *
 * Zero dependencies - it only requires the engine module (../js/game.js), the
 * same DOM-free rules code the browser and tests use.
 *
 * Usage:
 *   node tools/validate-rules.js <file.json>      # human-readable report
 *   node tools/validate-rules.js --json <file>    # machine-readable JSON
 *   node tools/validate-rules.js --help
 *   cat file.json | node tools/validate-rules.js  # read from stdin
 *
 * Exit code: 0 if every present section is game-rule valid, 1 otherwise.
 *
 * It also exports { validate } for the test harness.
 */
'use strict';

var fs = require('fs');
var G = require('../js/game.js');

var SCHEMA_REL = 'schema/jumping-squares-backup.v1.json';

// Validate the semantic (game-rule) layer of a PARSED backup object. Returns
// { valid, checked: [...section names...], errors: [...] }. Only sections that
// are PRESENT are checked; a file with neither board nor prefs is an error
// (nothing to validate). The board check defers entirely to the engine's
// loadState (so this never duplicates - or drifts from - the rules). The prefs
// section is adopted leniently by the app (unknown/garbage fields are ignored),
// so here it is only sanity-checked as an object; its detailed field handling
// is intentionally forgiving and not a hard failure.
function validate(data) {
  var errors = [];
  var checked = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push({
      section: '(root)', rule: 'type',
      message: 'top-level value is not an object',
    });
    return { valid: false, checked: checked, errors: errors };
  }

  var haveBoard = data.board && typeof data.board === 'object' && !Array.isArray(data.board);
  var havePrefs = data.prefs && typeof data.prefs === 'object' && !Array.isArray(data.prefs);

  if (!haveBoard && !havePrefs) {
    errors.push({
      section: '(root)', rule: 'empty',
      message: 'no board or prefs section to validate (is this a backup file? ' +
               'check shape with validate-schema.js first)',
    });
    return { valid: false, checked: checked, errors: errors };
  }

  if (haveBoard) {
    checked.push('board');
    var state = data.board.state;
    if (!state || typeof state !== 'object') {
      errors.push({
        section: 'board', rule: 'missingState',
        message: 'board section has no "state" object (check shape first)',
      });
    } else {
      // THE semantic check: the engine's own strict validator. If it returns
      // null, the board is not a legitimate, settled, reachable position.
      var clean = G.loadState(state);
      if (clean === null) {
        errors.push({
          section: 'board', rule: 'loadState',
          message: 'board failed the engine\u2019s game-rule validation ' +
            '(loadState). Common causes: cell count \u2260 rows\u00d7cols; a cell ' +
            'over capacity (mid-cascade - not allowed); the point total ' +
            '\u2260 moveCount; the winner/turn-gate rule not satisfied; or the ' +
            'player to move has no legal move.',
        });
      }
    }
  }

  if (havePrefs) {
    checked.push('prefs');
    // Prefs are adopted leniently in-app (field-by-field, unknown ignored), so
    // there is no hard "invalid prefs" short of "not an object" (handled above).
    // Surface only INFORMATIONAL notes for obviously-off values, never failing.
    var p = data.prefs;
    if (p.v !== undefined && !(typeof p.v === 'number' && p.v >= 1)) {
      errors.push({
        section: 'prefs', rule: 'info', severity: 'info',
        message: 'note: prefs.v is not a positive integer; the app will still ' +
          'adopt known fields and ignore the rest.',
      });
    }
  }

  // "info" notes don't fail the file; only real errors do.
  var hard = errors.filter(function (e) { return e.severity !== 'info'; });
  return { valid: hard.length === 0, checked: checked, errors: errors };
}

module.exports = { validate: validate };

// --- CLI -----------------------------------------------------------------

function readInput(file) {
  if (file) return fs.readFileSync(file, 'utf8');
  return fs.readFileSync(0, 'utf8');
}

function printHelp() {
  process.stdout.write(
    'Usage: node tools/validate-rules.js [--json] [<file.json>]\n\n' +
    'Check the GAME-RULE (semantic) validity of a Jumping Squares backup file:\n' +
    'whether its board is a legitimate, settled position the app would load.\n' +
    'This runs the board through the game engine\u2019s loadState - it is NOT a\n' +
    'schema check. For file SHAPE, run tools/validate-schema.js first\n' +
    '(' + SCHEMA_REL + ').\n\n' +
    'Options:\n' +
    '  --json     Machine-readable JSON result on stdout.\n' +
    '  --help     Show this help.\n\n' +
    'Reads from <file.json>, or from stdin if no file is given.\n' +
    'Exit code 0 = game-rule valid, 1 = not (or an error occurred).\n\n' +
    'Examples:\n' +
    '  node tools/validate-rules.js my-board.json\n' +
    '  node tools/validate-rules.js --json my-backup.json | jq .ok\n' +
    '  cat my-backup.json | node tools/validate-rules.js\n\n' +
    'Tip: to check BOTH shape and game-rule validity in one go, use\n' +
    'tools/validate-backup.js.\n');
}

function emit(asJson, file, result) {
  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: result.valid,
      stage: 'rules',
      file: file || '(stdin)',
      checked: result.checked,
      errors: result.errors,
    }, null, 2) + '\n');
    return result.valid ? 0 : 1;
  }
  if (result.valid) {
    process.stdout.write('PASS (rules): ' + (file || '(stdin)') +
      ' is game-rule valid' +
      (result.checked.length ? ' (' + result.checked.join(', ') + ').' : '.') +
      '\n');
    // Surface any informational notes even on success.
    for (var n = 0; n < result.errors.length; n++) {
      process.stdout.write('  - ' + result.errors[n].message + '\n');
    }
  } else {
    process.stdout.write('FAIL (rules): ' + (file || '(stdin)') +
      ' is not game-rule valid.\n');
    for (var j = 0; j < result.errors.length; j++) {
      var er = result.errors[j];
      process.stdout.write('  - [' + er.section + '] ' + er.message + '\n');
    }
  }
  return result.valid ? 0 : 1;
}

function emitError(asJson, file, msg) {
  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: false, stage: 'rules', file: file || '(stdin)',
      checked: [], errors: [{ section: '(file)', rule: 'input', message: msg }],
    }, null, 2) + '\n');
  } else {
    process.stderr.write('FAIL (rules): ' + msg + '\n');
  }
  return 1;
}

function runCli(argv) {
  var asJson = false;
  var file = null;
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--help' || a === '-h') { printHelp(); return 0; }
    else if (a === '--json') asJson = true;
    else if (a.charAt(0) === '-') {
      process.stderr.write('Unknown option: ' + a + '\n');
      return 1;
    } else { file = a; }
  }

  var raw;
  try { raw = readInput(file); }
  catch (e) { return emitError(asJson, file, 'could not read input: ' + e.message); }

  var data;
  try { data = JSON.parse(raw); }
  catch (e) { return emitError(asJson, file, 'not valid JSON: ' + e.message); }

  return emit(asJson, file, validate(data));
}

if (require.main === module) {
  process.exit(runCli(process.argv.slice(2)));
}
