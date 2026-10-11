#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * validate-schema.js - check a Jumping Squares backup file against the bundled
 * versioned JSON Schema (schema/jumping-squares-backup.v1.json).
 *
 * This is the SHAPE (structural) validator: field presence, types, ranges,
 * enums, array item shapes. It does NOT check game-rule validity (point
 * conservation, turn-gate, winner rule, no-mid-cascade) - that is a separate,
 * non-schema concern handled by tools/validate-rules.js. The two are kept
 * apart on purpose: this one is driven entirely by the schema; that one runs
 * the board through the game engine.
 *
 * Zero dependencies by design (matches the rest of this repo - no build step,
 * nothing to install). It implements only the small subset of JSON Schema the
 * bundled schema uses: type, const, enum, required, properties, items,
 * minimum/maximum, minItems, additionalProperties. The schema file is still
 * standard JSON Schema, so power users may also run it through a full validator
 * (e.g. ajv) independently.
 *
 * Usage:
 *   node tools/validate-schema.js <file.json>     # human-readable report
 *   node tools/validate-schema.js --json <file>   # machine-readable JSON
 *   node tools/validate-schema.js --help
 *   cat file.json | node tools/validate-schema.js  # read from stdin
 *
 * Exit code: 0 if the file conforms to the schema, 1 otherwise (CI/script
 * friendly). On failure, each error names the JSON path, the rule, and the
 * schema location that rejected it.
 *
 * It also exports { loadSchema, validate } for the test harness.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var SCHEMA_PATH = path.join(
  __dirname, '..', 'schema', 'jumping-squares-backup.v1.json');

// --- tiny JSON Schema checker (subset) -----------------------------------

function isInteger(x) {
  return typeof x === 'number' && isFinite(x) && Math.floor(x) === x;
}

function typeName(x) {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'array';
  return typeof x; // 'object' | 'number' | 'string' | 'boolean' | 'undefined'
}

// Does `value` match the schema's declared `type`? JSON Schema distinguishes
// integer from number; we only use integer/string/boolean/object/array here.
function matchesType(value, type) {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'integer': return isInteger(value);
    case 'number': return typeof value === 'number' && isFinite(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true; // unknown/absent type: don't constrain
  }
}

// Validate `data` against `schema`, accumulating errors. `instPath` and
// `schemaPath` are JSON-Pointer-ish strings for messages. Errors are pushed as
// { path, schemaPath, rule, message }.
function check(data, schema, instPath, schemaPath, errors) {
  if (!schema || typeof schema !== 'object') return;

  // type
  if (schema.type !== undefined && !matchesType(data, schema.type)) {
    errors.push({
      path: instPath || '(root)',
      schemaPath: schemaPath + '/type',
      rule: 'type',
      message: 'expected ' + schema.type + ', got ' + typeName(data),
    });
    return; // further keyword checks assume the right type; stop here
  }

  // const
  if (schema.const !== undefined && data !== schema.const) {
    errors.push({
      path: instPath || '(root)',
      schemaPath: schemaPath + '/const',
      rule: 'const',
      message: 'must equal ' + JSON.stringify(schema.const) +
               ', got ' + JSON.stringify(data),
    });
  }

  // enum
  if (Array.isArray(schema.enum) && schema.enum.indexOf(data) === -1) {
    errors.push({
      path: instPath || '(root)',
      schemaPath: schemaPath + '/enum',
      rule: 'enum',
      message: 'must be one of ' + JSON.stringify(schema.enum) +
               ', got ' + JSON.stringify(data),
    });
  }

  // numeric bounds
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({
        path: instPath || '(root)', schemaPath: schemaPath + '/minimum',
        rule: 'minimum', message: 'must be >= ' + schema.minimum + ', got ' + data,
      });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({
        path: instPath || '(root)', schemaPath: schemaPath + '/maximum',
        rule: 'maximum', message: 'must be <= ' + schema.maximum + ', got ' + data,
      });
    }
  }

  // object: required + properties + additionalProperties
  if (matchesType(data, 'object')) {
    if (Array.isArray(schema.required)) {
      for (var r = 0; r < schema.required.length; r++) {
        var key = schema.required[r];
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
          errors.push({
            path: (instPath || '') + '/' + key,
            schemaPath: schemaPath + '/required',
            rule: 'required',
            message: 'missing required property "' + key + '"',
          });
        }
      }
    }
    var props = schema.properties || {};
    var allowAdditional = (schema.additionalProperties !== false);
    for (var k in data) {
      if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
      if (Object.prototype.hasOwnProperty.call(props, k)) {
        check(data[k], props[k], (instPath || '') + '/' + k,
              schemaPath + '/properties/' + k, errors);
      } else if (!allowAdditional) {
        errors.push({
          path: (instPath || '') + '/' + k,
          schemaPath: schemaPath + '/additionalProperties',
          rule: 'additionalProperties',
          message: 'unexpected property "' + k + '"',
        });
      }
    }
  }

  // array: minItems + items
  if (matchesType(data, 'array')) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({
        path: instPath || '(root)', schemaPath: schemaPath + '/minItems',
        rule: 'minItems',
        message: 'must have >= ' + schema.minItems + ' items, got ' + data.length,
      });
    }
    if (schema.items) {
      for (var i = 0; i < data.length; i++) {
        check(data[i], schema.items, (instPath || '') + '/' + i,
              schemaPath + '/items', errors);
      }
    }
  }
}

// One STRUCTURAL cross-field rule the pure schema can't express: the cells
// array length must equal rows*cols. It is still shape (not game-rule), so it
// lives here, clearly labelled, rather than in the semantic validator.
function checkCellsLength(data, errors) {
  var st = data && data.board && data.board.state;
  if (!st || typeof st !== 'object') return;
  if (!isInteger(st.rows) || !isInteger(st.cols) || !Array.isArray(st.cells)) return;
  var expected = st.rows * st.cols;
  if (st.cells.length !== expected) {
    errors.push({
      path: '/board/state/cells',
      schemaPath: '#/properties/board/properties/state (cells length = rows*cols)',
      rule: 'cellsLength',
      message: 'cells length (' + st.cells.length + ') must equal rows*cols (' +
               expected + ')',
    });
  }
}

// --- public API ----------------------------------------------------------

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

// Validate a parsed object against the bundled schema. Returns
// { valid, errors: [...] }.
function validate(data, schema) {
  schema = schema || loadSchema();
  var errors = [];
  check(data, schema, '', '#', errors);
  checkCellsLength(data, errors);
  return { valid: errors.length === 0, errors: errors };
}

module.exports = { loadSchema: loadSchema, validate: validate, SCHEMA_PATH: SCHEMA_PATH };

// --- CLI -----------------------------------------------------------------

function readInput(file) {
  if (file) return fs.readFileSync(file, 'utf8');
  return fs.readFileSync(0, 'utf8'); // stdin (fd 0)
}

function printHelp() {
  process.stdout.write(
    'Usage: node tools/validate-schema.js [--json] [<file.json>]\n\n' +
    'Check a Jumping Squares backup file against the bundled JSON Schema\n' +
    '(' + path.relative(path.join(__dirname, '..'), SCHEMA_PATH) + ').\n\n' +
    'This checks the file SHAPE only (fields, types, ranges). Game-rule\n' +
    'validity (point conservation, turn-gate, winner, no mid-cascade) is a\n' +
    'separate check: tools/validate-rules.js.\n\n' +
    'Options:\n' +
    '  --json     Machine-readable JSON result on stdout.\n' +
    '  --help     Show this help.\n\n' +
    'Reads from <file.json>, or from stdin if no file is given.\n' +
    'Exit code 0 = conforms, 1 = does not (or an error occurred).\n\n' +
    'Examples:\n' +
    '  node tools/validate-schema.js my-board.json\n' +
    '  node tools/validate-schema.js --json my-backup.json | jq .ok\n' +
    '  cat my-backup.json | node tools/validate-schema.js\n\n' +
    'Tip: to check BOTH shape and game-rule validity in one go, use\n' +
    'tools/validate-backup.js.\n');
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
  try {
    raw = readInput(file);
  } catch (e) {
    return emitError(asJson, file, 'could not read input: ' + e.message);
  }

  var data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return emitError(asJson, file, 'not valid JSON: ' + e.message);
  }

  var schema;
  try {
    schema = loadSchema();
  } catch (e) {
    return emitError(asJson, file, 'could not load schema: ' + e.message);
  }

  var result = validate(data, schema);
  var schemaRel = path.relative(path.join(__dirname, '..'), SCHEMA_PATH);

  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: result.valid,
      stage: 'schema',
      schema: schemaRel,
      file: file || '(stdin)',
      errors: result.errors,
    }, null, 2) + '\n');
  } else {
    if (result.valid) {
      process.stdout.write('PASS (schema): ' + (file || '(stdin)') +
        ' conforms to ' + schemaRel + '.\n' +
        'Note: shape is valid. Run tools/validate-rules.js for game-rule ' +
        'validity (whether the app would load it).\n');
    } else {
      process.stdout.write('FAIL (schema): ' + (file || '(stdin)') +
        ' does not conform to ' + schemaRel + '.\n');
      for (var j = 0; j < result.errors.length; j++) {
        var er = result.errors[j];
        process.stdout.write('  - ' + (er.path || '(root)') + ': ' +
          er.message + '  [rule: ' + er.rule + '; schema: ' + er.schemaPath + ']\n');
      }
    }
  }
  return result.valid ? 0 : 1;
}

function emitError(asJson, file, msg) {
  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: false, stage: 'schema', file: file || '(stdin)',
      errors: [{ path: '(file)', rule: 'input', message: msg }],
    }, null, 2) + '\n');
  } else {
    process.stderr.write('FAIL (schema): ' + msg + '\n');
  }
  return 1;
}

if (require.main === module) {
  process.exit(runCli(process.argv.slice(2)));
}
