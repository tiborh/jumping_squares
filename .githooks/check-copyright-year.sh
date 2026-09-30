#!/bin/sh
# SPDX-FileCopyrightText: 2025 - 2026 tiborh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Verify (do not modify) SPDX copyright years.
#
# Checks that every given file which carries an
#     SPDX-FileCopyrightText: <year>[ - <year>] tiborh
# header includes the CURRENT year as the (single or range-end) year. Prints
# each stale file and exits non-zero if any are stale; exits 0 otherwise.
#
# Usage:
#   .githooks/check-copyright-year.sh [file ...]
#   # with no args, checks all tracked files that contain the header
#
# This is the enforceable safety net behind the local pre-commit hook (which
# can be bypassed with --no-verify and doesn't cover web-UI edits). CI runs it
# over the files changed in a push / pull request.

set -eu

YEAR=$(date +%Y)
MARKER='SPDX-FileCopyrightText:'

# Collect the file list: explicit args, or all tracked files if none given.
if [ "$#" -gt 0 ]; then
  files=$*
else
  files=$(git ls-files)
fi

stale=0

for f in $files; do
  [ -f "$f" ] || continue
  grep -q "$MARKER" "$f" 2>/dev/null || continue

  # For each header line, check whether the current year is present as the
  # newest year. awk exits 0 if all header lines are current, 1 if any stale.
  awk -v year="$YEAR" '
    /SPDX-FileCopyrightText:[ \t]*[0-9]{4}/ {
      idx = index($0, "SPDX-FileCopyrightText:")
      rest = substr($0, idx + length("SPDX-FileCopyrightText:"))
      # skip leading blanks
      while (substr(rest,1,1) == " " || substr(rest,1,1) == "\t") rest = substr(rest,2)
      # newest year is the range-end if present, else the single year
      if (match(rest, /^[0-9]{4}[ \t]*-[ \t]*[0-9]{4}/)) {
        span = substr(rest, 1, RLENGTH)
        # extract the trailing 4-digit year of the span
        if (match(span, /[0-9]{4}[ \t]*$/)) newest = substr(span, RSTART, 4)
      } else if (match(rest, /^[0-9]{4}/)) {
        newest = substr(rest, 1, 4)
      } else {
        next
      }
      if (newest != year) { bad = 1 }
    }
    END { exit (bad ? 1 : 0) }
  ' "$f" || {
    echo "stale copyright year (missing $YEAR): $f"
    stale=1
  }
done

if [ "$stale" -ne 0 ]; then
  echo ""
  echo "One or more files have an out-of-date SPDX copyright year."
  echo "Fix locally by staging the file and committing with the pre-commit"
  echo "hook enabled (git config core.hooksPath .githooks), or run:"
  echo "  .githooks/fix-copyright-year.sh <file ...>"
  exit 1
fi

exit 0
