#!/bin/sh
# SPDX-FileCopyrightText: 2025 - 2026 tiborh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Fix (rewrite in place) SPDX copyright years to include the current year.
#
# For each given file carrying an
#     SPDX-FileCopyrightText: <year>[ - <year>] tiborh
# header, rewrites the year span to "<start> - <current>" (or a single year
# when start == current), preserving the comment prefix, the original start
# year, and the holder tail. Files with no header, or already current, are
# left untouched.
#
# Prints the paths it changed, NUL-delimited (so callers can re-stage them
# safely with `xargs -0 git add --`, preserving odd filenames). Exits 0 always
# (a missing/already-current header is not an error here).
#
# Usage:
#   .githooks/fix-copyright-year.sh <file ...>
#
# This is the single source of the rewrite logic: the pre-commit hook calls it
# for staged files, and it can be run by hand for a manual fix.

set -eu

YEAR=$(date +%Y)
MARKER='SPDX-FileCopyrightText:'

for f in "$@"; do
  [ -f "$f" ] || continue
  grep -q "$MARKER" "$f" 2>/dev/null || continue

  tmp="$f.spdxtmp.$$"
  awk -v year="$YEAR" '
    {
      line = $0
      if (line ~ /SPDX-FileCopyrightText:[ \t]*[0-9]{4}/) {
        idx = index(line, "SPDX-FileCopyrightText:")
        head = substr(line, 1, idx + length("SPDX-FileCopyrightText:") - 1)
        rest = substr(line, idx + length("SPDX-FileCopyrightText:"))
        lead = ""
        while (substr(rest, 1, 1) == " " || substr(rest, 1, 1) == "\t") {
          lead = lead substr(rest, 1, 1)
          rest = substr(rest, 2)
        }
        if (match(rest, /^[0-9]{4}/)) {
          start = substr(rest, 1, 4)
          if (match(rest, /^[0-9]{4}[ \t]*-[ \t]*[0-9]{4}/)) {
            span_len = RLENGTH
          } else {
            span_len = 4
          }
          holder = substr(rest, span_len + 1)
          if (start == year) { newspan = start } else { newspan = start " - " year }
          newline = head lead newspan holder
          if (newline != line) { line = newline; changed = 1 }
        }
      }
      print line
    }
    END { if (changed) exit 10; else exit 0 }
  ' "$f" > "$tmp" 2>/dev/null && rc=0 || rc=$?

  if [ "$rc" -eq 10 ]; then
    [ -x "$f" ] && chmod +x "$tmp"
    mv "$tmp" "$f"
    printf '%s\0' "$f"
  else
    rm -f "$tmp"
    if [ "$rc" -ne 0 ]; then
      echo "fix-copyright-year: awk failed on $f (rc=$rc)" >&2
    fi
  fi
done

exit 0
