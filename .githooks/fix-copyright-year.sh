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
# year, the holder tail, and every other byte — including the file's original
# end-of-file state (a file with no trailing newline keeps none).
#
# The rewrite itself is the shared spdx-year.awk (single source, also used by
# the pre-commit hook on staged content). The year is taken in UTC so a
# developer machine and CI agree around New Year.
#
# Prints the paths it changed, NUL-delimited (so callers can re-stage them
# safely with `xargs -0 git add --`). Exits 0 always.
#
# Usage:
#   .githooks/fix-copyright-year.sh <file ...>

set -eu

YEAR=$(date -u +%Y)   # UTC so dev machines and CI agree around New Year
MARKER='SPDX-FileCopyrightText:'
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AWK_FILE="$SCRIPT_DIR/spdx-year.awk"

# True if file "$1" ends with a newline byte (empty file counts as "no").
ends_with_newline() {
  [ -s "$1" ] || return 1
  [ "$(tail -c 1 -- "$1" | od -An -tx1 | tr -d ' \n')" = "0a" ]
}

for f in "$@"; do
  # Guard filenames that look like options (e.g. "-n"): normalise to "./name".
  case "$f" in
    /*|./*) p="$f" ;;
    *)      p="./$f" ;;
  esac

  [ -f "$p" ] || continue
  grep -q "$MARKER" -- "$p" 2>/dev/null || continue

  tmp="$p.spdxtmp.$$"
  # awk exits 10 if it changed a header line, 0 if not. On any OTHER exit code
  # (a real awk error) do NOT trust the partial output: discard it, leave file.
  rc=0
  awk -v year="$YEAR" -f "$AWK_FILE" -- "$p" > "$tmp" 2>/dev/null || rc=$?

  if [ "$rc" -eq 10 ]; then
    # Preserve original EOF: if the source lacked a trailing newline, strip the
    # one awk's print added so only the header line changed.
    if ! ends_with_newline "$p" && ends_with_newline "$tmp"; then
      awk 'NR>1{printf "%s", prev "\n"} {prev=$0} END{printf "%s", prev}' "$tmp" > "$tmp.trim"
      mv "$tmp.trim" "$tmp"
    fi
    # Write the new content BACK INTO the original file (rather than mv'ing the
    # temp over it), so the file's existing permissions and ownership are fully
    # preserved — a private 0600 file stays 0600 instead of taking the temp's
    # umask-derived mode.
    cat "$tmp" > "$p"
    rm -f "$tmp"
    printf '%s\0' "$f"   # original path, so callers re-stage the same name
  else
    rm -f "$tmp"
    if [ "$rc" -ne 0 ]; then
      echo "fix-copyright-year: awk failed on $f (rc=$rc); left unchanged" >&2
    fi
  fi
done

exit 0
