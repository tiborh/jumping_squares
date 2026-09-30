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
    prefix = substr(line, 1, idx - 1)   # everything BEFORE the marker
    rest = substr(line, idx + length("SPDX-FileCopyrightText:"))
    lead = ""
    while (substr(rest, 1, 1) == " " || substr(rest, 1, 1) == "\t") {
      lead = lead substr(rest, 1, 1)
      rest = substr(rest, 2)
    }
    # The marker must start the line after only a recognised COMMENT LEADER:
    # optional indent, then optionally one of  #  //  /*  *  <!--  (each maybe
    # followed by whitespace). A pure-whitespace prefix is also allowed (e.g.
    # an indented line inside an HTML <!-- ... --> block). Crucially this does
    # NOT accept a bare "-", so a YAML/Markdown list item like
    #   - SPDX-FileCopyrightText: 2025 tiborh
    # is treated as data, not a header, and left untouched.
    head_ok = (prefix ~ /^[ \t]*(#|\/\/|\/\*|\*|<!--)?[ \t]*$/)
    if (head_ok && match(rest, /^[0-9]{4}/)) {
      start = substr(rest, 1, 4)
      if (match(rest, /^[0-9]{4}[ \t]*-[ \t]*[0-9]{4}/)) {
        span_len = RLENGTH
      } else {
        span_len = 4
      }
      holder = substr(rest, span_len + 1)
      # The year span must be followed by whitespace and EXACTLY the holder
      # "tiborh" to end of line (allowing trailing whitespace, a comment closer
      # like " -->", and/or a CRLF carriage return). With the comment-leader
      # check above, only genuine header lines are rewritten — never prose,
      # fixtures, or code that merely embeds the marker with a nearby number.
      if (holder ~ /^[ \t]+tiborh[ \t]*(-->[ \t]*)?\r?$/) {
        if (start == year) { newspan = start } else { newspan = start " - " year }
        newline = head lead newspan holder
        if (newline != line) { line = newline; changed = 1 }
      }
    }
  }
  print line
}
END { if (changed) exit 10; else exit 0 }
