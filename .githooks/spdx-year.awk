# SPDX-FileCopyrightText: 2025 - 2026 tiborh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Single source of the SPDX copyright-year rewrite.
#
# Reads text on input and writes it back unchanged except that any
#     SPDX-FileCopyrightText: <year>[ - <year>] <holder>
# header line has its year span updated to include the current year (passed in
# as -v year=YYYY), preserving the comment prefix, the original start year, and
# the holder tail. A single year is kept when start == current.
#
# Exit status: 10 if anything was rewritten, 0 if no change was needed. Callers
# (fix-copyright-year.sh and the pre-commit hook) rely on this so the same
# behaviour drives both file rewrites and staged-index rewrites.
#
# NOTE: this transforms only the matched line's bytes; all other bytes —
# including the file's exact trailing newline(s) — pass through untouched.
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
      # Only rewrite a GENUINE header: the year span must be followed by
      # whitespace and the copyright holder ("tiborh"). This prevents rewriting
      # prose or code that merely mentions the marker with a nearby number
      # (e.g. documentation or this very rule) — only real headers change.
      if (holder ~ /^[ \t]+tiborh([ \t].*)?$/) {
        if (start == year) { newspan = start } else { newspan = start " - " year }
        newline = head lead newspan holder
        if (newline != line) { line = newline; changed = 1 }
      }
    }
  }
  print line
}
END { if (changed) exit 10; else exit 0 }
