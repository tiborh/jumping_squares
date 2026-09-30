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
#   .githooks/check-copyright-year.sh [file ...]      # check the given files
#   .githooks/check-copyright-year.sh                 # check all tracked files
#
# Filename-safe: explicit arguments are consumed with "$@" (boundaries intact),
# and the no-argument case enumerates tracked files NUL-delimited via
# `git ls-files -z | xargs -0`, so paths with spaces/newlines/globs are handled
# correctly. This matters because a silently-skipped file would let a stale
# header pass the "safety net".
#
# This is the enforceable safety net behind the local pre-commit hook (which
# can be bypassed with --no-verify and doesn't cover web-UI edits). CI runs it
# over the files changed in a push / pull request.

set -eu

YEAR=$(date -u +%Y)   # UTC so dev machines and CI agree around New Year
MARKER='SPDX-FileCopyrightText:'

# With no arguments, check every tracked file, NUL-safe. Guard against an empty
# file list so we never recurse with zero args (which some xargs run once).
if [ "$#" -eq 0 ]; then
  if [ -z "$(git ls-files)" ]; then
    exit 0
  fi
  git ls-files -z | xargs -0 "$0"
  exit $?
fi

stale=0

for f in "$@"; do
  # Guard option-like filenames (e.g. "-n"): normalise to "./name" so grep/awk
  # treat it as a path, not a flag.
  case "$f" in
    /*|./*) p="$f" ;;
    *)      p="./$f" ;;
  esac

  [ -f "$p" ] || continue
  grep -q "$MARKER" -- "$p" 2>/dev/null || continue

  # awk exits 0 if every header line already shows the current year, 1 if any
  # header line is stale.
  awk -v year="$YEAR" '
    /SPDX-FileCopyrightText:[ \t]*[0-9]{4}/ {
      idx = index($0, "SPDX-FileCopyrightText:")
      head = substr($0, 1, idx - 1)
      rest = substr($0, idx + length("SPDX-FileCopyrightText:"))
      while (substr(rest,1,1) == " " || substr(rest,1,1) == "\t") rest = substr(rest,2)
      # Only a genuine header: comment-leader-only prefix, and the holder tail.
      if (head !~ /^[ \t]*([#*/<!-]+[ \t]*)*$/) next
      if (match(rest, /^[0-9]{4}[ \t]*-[ \t]*[0-9]{4}/)) {
        span_len = RLENGTH
        span = substr(rest, 1, span_len)
        if (match(span, /[0-9]{4}[ \t]*$/)) newest = substr(span, RSTART, 4)
      } else if (match(rest, /^[0-9]{4}/)) {
        span_len = 4
        newest = substr(rest, 1, 4)
      } else {
        next
      }
      holder = substr(rest, span_len + 1)
      if (holder !~ /^[ \t]+tiborh[ \t]*(-->[ \t]*)?\r?$/) next
      if (newest != year) { bad = 1 }
    }
    END { exit (bad ? 1 : 0) }
  ' "$p" || {
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
