#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * validate-backup.js - convenience runner that checks a Jumping Squares backup
 * file with BOTH validators in the recommended order:
 *   1. SHAPE   (tools/validate-schema.js) - fields, types, ranges vs the schema
 *   2. RULES   (tools/validate-rules.js)  - game-rule validity via the engine
 *
 * A file that passes both is well-formed AND its board is loadable by the app.
 * This script just orchestrates the two existing validators (it adds no new
 * checks of its own) so a player can run one command instead of two. The two
 * underlying scripts remain usable individually.
 *
 * Human output stops at the first failing stage (shape errors must be fixed
 * before the rules check is meaningful). --json always reports BOTH stages so a
 * caller's script sees the full picture.
 *
 * Zero dependencies - it only requires the two sibling validator modules.
 *
 * Usage:
 *   node tools/validate-backup.js <file.json>        # run shape, then rules
 *   node tools/validate-backup.js --json <file>      # machine-readable JSON
 *   node tools/validate-backup.js --help
 *   cat file.json | node tools/validate-backup.js    # read from stdin
 *
 * Exit code: 0 only if BOTH stages pass, 1 otherwise.
 *
 * It also exports { validate } for the test harness.
 */
'use strict';

var fs = require('fs');
var schemaV = require('./validate-schema.js');
var rulesV = require('./validate-rules.js');

// Run both validators on a PARSED object. Returns:
//   { ok, schema: {valid, errors}, rules: {valid, checked, errors} | null }
// `rules` is null when the schema stage failed (we don't run the semantic check
// on a structurally-broken file - its errors would be noise).
function validate(data) {
  var schema = schemaV.validate(data);
  if (!schema.valid) {
    return { ok: false, schema: schema, rules: null };
  }
  var rules = rulesV.validate(data);
  return { ok: schema.valid && rules.valid, schema: schema, rules: rules };
}

module.exports = { validate: validate };

// --- CLI -----------------------------------------------------------------

function readInput(file) {
  if (file) return fs.readFileSync(file, 'utf8');
  return fs.readFileSync(0, 'utf8');
}

function printHelp() {
  process.stdout.write(
    'Usage: node tools/validate-backup.js [--json] [<file.json>]\n\n' +
    'Check a Jumping Squares backup file with BOTH validators, in order:\n' +
    '  1. shape  (schema)  - fields, types, ranges\n' +
    '  2. rules  (engine)  - game-rule validity (would the app load the board?)\n\n' +
    'This is a convenience wrapper around tools/validate-schema.js and\n' +
    'tools/validate-rules.js; run those directly if you want just one stage.\n\n' +
    'Options:\n' +
    '  --json     Machine-readable JSON (reports BOTH stages).\n' +
    '  --help     Show this help.\n\n' +
    'Reads from <file.json>, or from stdin if no file is given.\n' +
    'Exit code 0 = both stages pass, 1 = otherwise.\n\n' +
    'Examples:\n' +
    '  node tools/validate-backup.js my-board.json\n' +
    '  node tools/validate-backup.js --json my-backup.json | jq .ok\n' +
    '  cat my-backup.json | node tools/validate-backup.js\n');
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

  var result = validate(data);
  var label = file || '(stdin)';

  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: result.ok,
      file: label,
      schema: { ok: result.schema.valid, errors: result.schema.errors },
      rules: result.rules
        ? { ok: result.rules.valid, checked: result.rules.checked, errors: result.rules.errors }
        : null,
    }, null, 2) + '\n');
    return result.ok ? 0 : 1;
  }

  if (!result.schema.valid) {
    process.stdout.write('FAIL (shape): ' + label + ' did not pass the schema; ' +
      'fix these before the game-rule check is meaningful:\n');
    for (var j = 0; j < result.schema.errors.length; j++) {
      var er = result.schema.errors[j];
      process.stdout.write('  - ' + (er.path || '(root)') + ': ' + er.message +
        '  [rule: ' + er.rule + ']\n');
    }
    return 1;
  }
  // shape passed; report rules
  if (!result.rules.valid) {
    process.stdout.write('PASS (shape), FAIL (rules): ' + label +
      ' is well-formed but not game-rule valid:\n');
    for (var k = 0; k < result.rules.errors.length; k++) {
      var rr = result.rules.errors[k];
      process.stdout.write('  - [' + rr.section + '] ' + rr.message + '\n');
    }
    return 1;
  }
  process.stdout.write('PASS: ' + label +
    ' is well-formed (shape) AND game-rule valid' +
    (result.rules.checked.length ? ' (' + result.rules.checked.join(', ') + ').' : '.') +
    '\n');
  return 0;
}

function emitError(asJson, file, msg) {
  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: false, file: file || '(stdin)',
      schema: { ok: false, errors: [{ path: '(file)', rule: 'input', message: msg }] },
      rules: null,
    }, null, 2) + '\n');
  } else {
    process.stderr.write('FAIL: ' + msg + '\n');
  }
  return 1;
}

if (require.main === module) {
  process.exit(runCli(process.argv.slice(2)));
}
