#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2025 - 2026 tiborh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Follow-up checker for the Kiro CLI large-payload validationError bug.
# See docs/kiro-large-payload-bug.md. Reports whether upstream issue
# kirodotdev/Kiro#11750 is still open; if it has closed, prints the
# retire-the-workaround checklist. Run on demand: requires gh (authenticated).

set -eu
REPO="kirodotdev/Kiro"
ISSUE=11750

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found; cannot check issue #${ISSUE}. See docs/kiro-large-payload-bug.md" >&2
  exit 2
fi

state="$(gh issue view "$ISSUE" --repo "$REPO" --json state --jq .state 2>/dev/null || echo UNKNOWN)"

echo "Kiro large-payload validationError bug tracker: ${REPO}#${ISSUE}"
echo "Current state: ${state}"

case "$state" in
  OPEN)
    echo
    echo "Still OPEN - keep using the workaround (curl-to-disk + small ASCII edits)."
    echo "See docs/kiro-large-payload-bug.md."
    ;;
  CLOSED)
    echo
    echo "CLOSED upstream - time to verify and retire the workaround:"
    echo "  1. Re-test: have the agent write a large (~5KB) Markdown file"
    echo "     (link-refs + bracket placeholders + non-ASCII) via the write tool."
    echo "  2. If it now succeeds, the client-side fix is live."
    echo "  3. Simplify any curl-to-disk/chunked workarounds that are no longer needed."
    echo "  4. Update docs/kiro-large-payload-bug.md (mark resolved) and the"
    echo "     knowledge-base entry; consider removing this script."
    ;;
  *)
    echo "Could not determine state (network/auth?). Try: gh issue view $ISSUE --repo $REPO" >&2
    exit 1
    ;;
esac
