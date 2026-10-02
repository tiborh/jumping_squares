<!--
  SPDX-FileCopyrightText: 2025 - 2026 tiborh
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Dev notes: Kiro CLI large-payload `validationError`

A recorded lesson from building this repo with the Kiro CLI agent, so
future work (and future AI sessions) can recognise and route around it.

## Symptom

A tool call fails mid-stream with a `validationError` whose payload is
`{"message":"Improperly formed request."}` (exception-type `validationError`).
The turn aborts before the file is written or the command runs.

It looks intermittent but is **deterministic**: it fires whenever the
outbound request payload carries a large (~5 KB) block of content.

## Cause (maintainer assessment; under investigation)

Tracked as Kiro issue [#11750](https://github.com/kirodotdev/Kiro/issues/11750).
A maintainer confirmed the mechanism: tools send file content / command text
as a direct tool input to the backend with **no client-side size limit**. They
assessed that the backend *might* reject large payloads by size and/or specific
content patterns, and the issue is still **under investigation** (so the exact
trigger below is a hypothesis, not established fact).

- **Not tool-specific.** Reproduced with *both* the write tool *and* a shell
  heredoc (`cat <<'EOF' > file`). The trigger is the payload content,
  not the tool carrying it.
- **Not** network resets, session corruption, context bloat, or client
  version. It hits on the *first* tool call of a fresh session, and survived
  client restarts and an update (2.26.1 -> 2.27.0).
- **Suspected content triggers** (maintainer-plausible): markdown
  link-reference definitions (`[homepage]: https://...`), bracketed
  placeholders (`[INSERT CONTACT METHOD]`), non-ASCII typographic characters,
  and raw size.

## How to recognise it

A write of a *big* file (LICENSE, Code of Conduct, long Markdown, generated
config) fails with "Improperly formed request" while small writes and small
shell / read / grep calls keep working.

## Workaround (proven)

Never put the large text in the model/tool request. Bring content in via a
command whose own payload is small and ASCII-only:

1. **Fetch straight to disk** over the local machine's network, so the big
   text never enters the agent request:
   ```
   curl -fsSL <raw-url> -o TARGET
   ```
2. Then make only **small, ASCII-only edits** in separate calls: `sed` to
   strip/replace lines, `printf`/heredoc for a tiny header, `cat` to join.

If there is no canonical URL, build the file from **many small chunks**
(each small and plain-ASCII). A chunk that fails also bisects the offending
content. (This very file was written that way.)

Also: keep raw multi-line error dumps *out* of the conversation; a one-line
"failed with validationError" is enough and avoids bloating later requests.

## Status

Accepted and tracked (issue #11750; labels `os: linux`,
`theme:unexpected-error`, `cli`). **Not** a duplicate of
[#11191](https://github.com/kirodotdev/Kiro/issues/11191), which is an AWS
Bedrock account/entitlement "Operation not allowed" problem — different
platform, error, trigger, and scope; it only shares the generic AWS
`ValidationException` family in the message text.

## Follow-up: when is this fixed, and what then?

This is an upstream client/service bug, so there is nothing to fix in this
repo - only a workaround to retire once the client is fixed. Because an AI
session cannot schedule itself, the follow-up is **on-demand**:

- **Check status any time** by running:
  ```
  ./docs/check-kiro-11750.sh
  ```
  It queries issue #11750 via `gh` and prints whether it is still open, or -
  if it has closed - the retire-the-workaround checklist.

- **Retirement criteria** (do these once #11750 is CLOSED):
  1. Re-test: have the agent write a large (~5 KB) Markdown file containing
     link-reference definitions, bracket placeholders, and non-ASCII
     characters, via the normal write tool.
  2. If it succeeds, the fix is live: simplify any `curl`-to-disk / chunked
     workarounds that were only there to dodge this bug.
  3. Mark this document resolved, update the knowledge-base entry
     `kiro-large-payload-validationError-bug`, and consider deleting
     `docs/check-kiro-11750.sh`.

A future AI session that recalls this bug (via the knowledge base) should run
the checker before assuming the workaround is still necessary.
