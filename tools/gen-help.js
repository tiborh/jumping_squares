#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2026 tiborh
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * gen-help.js — regenerate the in-app Help data from the README.
 *
 * The in-app Help dialog's text is sourced from a single place: the block in
 * README.md between the `HELP:BEGIN` and `HELP:END` markers (inside "How to
 * play"). This mirrors the CHANGELOG pattern: the human-readable doc is the
 * source of truth, and a small structured copy is embedded in js/game.js so the
 * browser can render it with no build step and no network (works under file://).
 * A test (test/game.test.js) re-extracts from the README and fails if the two
 * drift apart.
 *
 *   Usage:
 *     node tools/gen-help.js            # rewrite js/game.js HELP block in place
 *     node tools/gen-help.js --check    # exit non-zero if regeneration is needed
 *     node tools/gen-help.js --print    # print the parsed blocks as JSON
 *
 * This module also EXPORTS its pure functions (extractHelpSource, parseHelp,
 * serializeHelp) so the test can reuse the exact same extraction/parse logic as
 * the single source of truth — no duplicated parser to drift.
 *
 * The parser understands a deliberately small Markdown subset (keep the README
 * block within it):
 *   - `##` / `###` headings
 *   - paragraphs (one or more lines, blank-line separated)
 *   - `-` bullet lists, with ONE level of nesting via a two-space indent
 *   - inline markers kept verbatim in the text: **bold**, *italic*, `code`
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var README_PATH = path.join(ROOT, 'README.md');
var GAME_PATH = path.join(ROOT, 'js', 'game.js');

var BEGIN = 'HELP:BEGIN';
var END = 'HELP:END';

// Markers delimiting the generated block inside js/game.js. Everything between
// them is overwritten by this script; edit the README, not the generated block.
var GEN_BEGIN = '/* HELP:GENERATED:BEGIN - do not edit; run tools/gen-help.js */';
var GEN_END = '/* HELP:GENERATED:END */';

/**
 * Pull the raw help block out of the README (the lines strictly between the
 * HELP:BEGIN and HELP:END markers). Throws if the markers are missing.
 * @param {string} readmeText
 * @returns {string} the raw markdown between the markers
 */
function extractHelpSource(readmeText) {
  var lines = readmeText.split(/\r?\n/);
  var start = -1;
  var end = -1;
  for (var i = 0; i < lines.length; i++) {
    if (start === -1 && lines[i].indexOf(BEGIN) !== -1) { start = i; continue; }
    if (start !== -1 && lines[i].indexOf(END) !== -1) { end = i; break; }
  }
  if (start === -1 || end === -1) {
    throw new Error('README.md: HELP:BEGIN / HELP:END markers not found');
  }
  // Skip any remaining lines of the opening comment: the BEGIN marker opens an
  // HTML comment (<!-- HELP:BEGIN ...), so content starts after its closing -->.
  var body = lines.slice(start + 1, end);
  var out = [];
  var inOpeningComment = true;
  for (var j = 0; j < body.length; j++) {
    var line = body[j];
    if (inOpeningComment) {
      // The opening comment (started on the BEGIN line) ends at the first `-->`.
      var close = line.indexOf('-->');
      if (close !== -1) {
        inOpeningComment = false;
        var rest = line.slice(close + 3);
        if (rest.trim() !== '') out.push(rest);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n').trim() + '\n';
}

/**
 * Parse the restricted Markdown subset into a structured block list.
 * @param {string} src
 * @returns {Array<Object>} blocks
 */
function parseHelp(src) {
  var lines = src.split(/\r?\n/);
  var blocks = [];
  var i = 0;

  function flushParagraph(buf) {
    if (buf.length) {
      blocks.push({ type: 'paragraph', text: buf.join(' ').trim() });
    }
  }

  var paraBuf = [];
  while (i < lines.length) {
    var raw = lines[i];
    var line = raw.replace(/\s+$/, '');

    // Blank line: paragraph boundary.
    if (line.trim() === '') {
      flushParagraph(paraBuf);
      paraBuf = [];
      i++;
      continue;
    }

    // Heading (## or ###).
    var h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) {
      flushParagraph(paraBuf);
      paraBuf = [];
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    // Bullet list: a run of lines starting with "- " (top level) or "  - "
    // (one level of nesting). Continuation lines (indented, no bullet) fold
    // into the current item's text.
    if (/^\s*-\s+/.test(line)) {
      flushParagraph(paraBuf);
      paraBuf = [];
      var items = [];
      while (i < lines.length) {
        var l = lines[i].replace(/\s+$/, '');
        if (l.trim() === '') { break; } // blank ends the list
        var top = /^-\s+(.*)$/.exec(l);
        var nested = /^\s{2}-\s+(.*)$/.exec(l);
        if (top) {
          items.push({ text: top[1].trim(), children: [] });
          i++;
        } else if (nested) {
          if (!items.length) {
            throw new Error('nested bullet before any top-level bullet: ' + l);
          }
          items[items.length - 1].children.push({ text: nested[1].trim() });
          i++;
        } else if (/^\s+\S/.test(l) && items.length) {
          // Continuation of the previous (top or nested) item.
          var cont = l.trim();
          var last = items[items.length - 1];
          if (last.children.length) {
            var lc = last.children[last.children.length - 1];
            lc.text = (lc.text + ' ' + cont).trim();
          } else {
            last.text = (last.text + ' ' + cont).trim();
          }
          i++;
        } else {
          break; // not part of the list
        }
      }
      blocks.push({ type: 'list', items: items });
      continue;
    }

    // Otherwise: part of a paragraph (fold wrapped lines together).
    paraBuf.push(line.trim());
    i++;
  }
  flushParagraph(paraBuf);
  return blocks;
}

/**
 * Serialize the blocks to the exact JS literal embedded in js/game.js. Stable,
 * deterministic formatting so the drift test is a plain string compare.
 * @param {Array<Object>} blocks
 * @returns {string}
 */
function serializeHelp(blocks) {
  // JSON with 2-space indent is deterministic and easy to diff; wrap as a JS
  // array literal assigned to HELP. Escape </script> defensively (not needed in
  // a module, but harmless and future-proof if ever inlined).
  var json = JSON.stringify(blocks, null, 2).replace(/<\/script>/gi, '<\\/script>');
  return json;
}

/** Build the full generated block (between GEN markers) for js/game.js. */
function buildGeneratedBlock(blocks) {
  var json = serializeHelp(blocks);
  // Indent to sit nicely inside the module (2 spaces).
  var indented = json.split('\n').map(function (l, idx) {
    return idx === 0 ? l : '  ' + l;
  }).join('\n');
  return GEN_BEGIN + '\n  var HELP = ' + indented + ';\n  ' + GEN_END;
}

/** Read README, extract+parse, return the blocks. */
function blocksFromReadme() {
  var readme = fs.readFileSync(README_PATH, 'utf8');
  return parseHelp(extractHelpSource(readme));
}

/** Replace the generated block inside js/game.js source text. */
function injectIntoGame(gameText, blocks) {
  var startIdx = gameText.indexOf(GEN_BEGIN);
  var endIdx = gameText.indexOf(GEN_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('js/game.js: HELP:GENERATED markers not found');
  }
  var before = gameText.slice(0, startIdx);
  var after = gameText.slice(endIdx + GEN_END.length);
  return before + buildGeneratedBlock(blocks) + after;
}

function main() {
  var args = process.argv.slice(2);
  var blocks = blocksFromReadme();

  if (args.indexOf('--print') !== -1) {
    process.stdout.write(JSON.stringify(blocks, null, 2) + '\n');
    return;
  }

  var gameText = fs.readFileSync(GAME_PATH, 'utf8');
  var updated = injectIntoGame(gameText, blocks);

  if (args.indexOf('--check') !== -1) {
    if (updated !== gameText) {
      process.stderr.write(
        'js/game.js HELP block is OUT OF DATE — run: node tools/gen-help.js\n');
      process.exit(1);
    }
    process.stdout.write('HELP block is up to date.\n');
    return;
  }

  if (updated === gameText) {
    process.stdout.write('HELP block already up to date (no change).\n');
  } else {
    fs.writeFileSync(GAME_PATH, updated);
    process.stdout.write('Regenerated HELP block in js/game.js.\n');
  }
}

// Export the pure helpers for the test (single source of truth for parsing).
module.exports = {
  extractHelpSource: extractHelpSource,
  parseHelp: parseHelp,
  serializeHelp: serializeHelp,
  blocksFromReadme: blocksFromReadme,
  GEN_BEGIN: GEN_BEGIN,
  GEN_END: GEN_END,
};

if (require.main === module) {
  main();
}
