<!--
  SPDX-FileCopyrightText: 2026 tiborh
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Git workflow — pull requests are the default

`main` is a **protected branch** (branch ruleset: changes via PR, required
status checks must pass). The owner's account *can* bypass the ruleset, but a
direct push to `main` should be the rare exception, not the norm.

## Default way of working

For any change (code, docs, config):

1. **Never commit or push to `main` directly.** Create a short-lived feature
   branch off the latest `main`, e.g. `feat/<topic>`, `fix/<topic>`,
   `docs/<topic>`, `chore/<topic>`.
2. Commit the work on that branch (ask before committing per the usual rule;
   keep the copyright-year hook enabled — do not use `--no-verify`). Commits
   **must be signed** — the protected `main` ruleset requires verified
   signatures, and `CONTRIBUTING.md` documents that `commit.gpgsign true` is set
   globally so signing happens automatically. If a push is declined with
   *"Commits must have verified signatures"*, the commit is unsigned: re-sign
   with `git commit --amend --no-edit -S` (or fix signing config per
   `CONTRIBUTING.md`) and push again.
3. Push the branch with upstream tracking: `git push -u origin <branch>`.
4. Open a pull request targeting `main` with `gh pr create` (concise title
   < 70 chars; body: summary, what was tested, anything blocked). Report the PR
   URL back to the user.
5. **Let the required status checks run and pass** (CI, CodeQL, etc.). Do not
   bypass the ruleset or merge for the user unless they explicitly ask.
6. **Check the automated code reviews before merging.** Beyond the required
   status checks, PRs get an advisory **Copilot code review** (and may surface
   other review output). Read every finding and disposition each on its merits:
   **fix the ones that are real issues**, and for a demonstrable false positive
   or a finding that contradicts an earlier one, record *why* — ideally with a
   concrete check (a repro, a byte-level test) — rather than looping. Push any
   fix and let Copilot **re-review**; merge only when it's clean (no unaddressed
   actionable findings) **and** all required checks pass. The review is
   *advisory* — the real merge gate is the required checks plus the branch
   ruleset — but genuine findings get fixed first.

## Merging a PR

Merge **only when the user explicitly authorizes it**, and only after step 6
(reviews addressed) and all required checks pass. Use:

```
gh pr merge <N> --squash --delete-branch --admin
```

`--admin` bypasses **only** the human-review gate of the branch ruleset; every
required status check must still pass. After merging, sync local `main`
(`git checkout main && git pull --ff-only`) and confirm no PR is left open.

## Only push to `main` directly when

The user **explicitly** asks for a direct push to `main` in that request.
Otherwise, always use the branch + PR flow above. When in doubt, ask.

## Reminders carried over from the general rules

- Pushing a new branch uses `git push -u` to set tracking.
- Prefer staging specific files over `git add .`.
- Flag any file that may contain secrets before committing.
- Destructive git operations (force push, `reset --hard`, `clean -f`,
  `branch -D`) require explicit confirmation.
