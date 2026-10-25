# Contributing / Push Guide

A repeatable, numbered checklist for shipping a change to
`tiborh/jumping_squares`. This matches the repository's protections:
**signed commits**, **PR-only `main`**, **required status checks**, and
**admin-bypass merge** for the solo maintainer.

> One-time setup (already done on the main dev machine) is at the bottom under
> [First-time setup](#first-time-setup). If you're on a new machine, do that
> first.

---

## A. Before you start — is this a browser-visible change?

If your change touches anything the browser loads (`index.html`, `js/*.js`,
CSS, gameplay, UI), you **must bump the version** so caches don't serve stale
files. If it's docs-only (`README`, this file, comments), skip to section B.

1. Edit `VERSION` in `js/game.js` — bump it by one (e.g. `'6'` → `'7'`).
2. Edit **all three** `?v=` query strings in `index.html` to the same number:
   ```html
   <script src="js/game.js?v=7"></script>
   <script src="js/agents.js?v=7"></script>
   <script src="js/ui.js?v=7"></script>
   ```
   (The `version wiring` test fails if any present `?v=` value doesn't match
   `VERSION`; it does not check that all three tags exist, so update them all by
   hand.)

### Also, depending on what you touched

These mandatory steps live in full in
[`.kiro/steering/repo-conventions.md`](.kiro/steering/repo-conventions.md); the
short version:

- **Edited the README `HELP:BEGIN…HELP:END` block?** Regenerate the in-app Help
  mirror and commit the result (a drift test fails otherwise):
  ```bash
  node tools/gen-help.js          # rewrite the HELP block in js/game.js
  node tools/gen-help.js --check  # verify (non-zero exit if out of date)
  ```
  Note: regenerating changes `js/game.js` (a browser-loaded file), so a HELP
  edit is **browser-visible** — do the version bump above too.
- **Player-facing change?** Add a newest-first entry to the `CHANGELOG` array in
  `js/game.js` (drop the oldest to stay within the 12-entry cap) and a matching
  `## vN` section in `CHANGELOG.md`. A test enforces the cap/order and that the
  newest entry's version doesn't exceed `VERSION`.
- **Touched the Save/Load backup format, its schema, or validators?** Keep
  `schema/jumping-squares-backup.v1.json` and `tools/validate-schema.js` /
  `tools/validate-rules.js` / `tools/validate-backup.js` in step with the app's
  `buildBackupObject()` / `loadState()`; a drift test ("backup validators")
  guards this. The schema is versioned by filename — add `…-backup.v2.json`
  rather than breaking v1.

---

## B. Test locally

3. Run the test harness — it must pass before committing:
   ```bash
   node test/game.test.js
   ```
   Expect `... passed, 0 failed` and exit code 0. This also checks that the
   `?v=` strings match `VERSION`.

   This is the **always-run gate**: dependency-free, fast, and the only test
   required before every commit. The game itself has no build step and no
   runtime dependencies.

   **Optional browser (e2e) tests.** A Playwright suite covers the browser-only
   paths the Node harness can't reach (localStorage restore across reload, the
   Web Worker AI search, and that a human click can't steal an AI seat's move).
   It is **not** part of the always-run gate — run it when you touch those areas
   or before a release:
   ```bash
   npm ci                                   # once, installs @playwright/test
   npx playwright install firefox chromium  # once, downloads the browsers
   npm run test:e2e                         # drives a served copy of the game
   ```
   These are dev/CI-only dependencies (`node_modules/` is gitignored; the
   shipped game stays zero-dependency). A separate CI workflow (`e2e.yml`) runs
   them on PRs in Firefox and Chromium.

4. (Browser-visible changes) Open `index.html` locally and confirm the tab
   title shows the expected `Jumping Squares (vN)`.

---

## C. Commit on a branch (never directly to `main`)

5. Create a short-lived branch (name it for the change):
   ```bash
   git checkout -b my-change-name
   ```

6. Stage and commit. Commits are **signed automatically**
   (`commit.gpgsign true` is set globally). Write a clear message:
   ```bash
   git add -A
   git commit -m "short summary

   Optional longer body explaining what and why."
   ```

7. Push the branch and open a pull request:
   ```bash
   git push -u origin my-change-name
   gh pr create --fill
   ```
   Note the PR number that `gh` prints (referred to below as `<N>`).

---

## D. Verify the PR

8. Confirm the commit signature is accepted and checks pass:
   ```bash
   gh pr checks <N>
   ```
   Wait until every check is `pass` (CI on Node 18/20/22, CodeQL, Dependency
   Review). CodeQL can take ~1 minute.

9. (Optional) Confirm the signature is verified by GitHub:
   ```bash
   gh api repos/tiborh/jumping_squares/pulls/<N>/commits \
     --jq '.[].commit.verification | {verified, reason}'
   ```
   Expect `{"verified": true, "reason": "valid"}`.

---

## E. Merge and sync

10. Squash-merge with admin bypass (required because `main` is protected and
    auto-merge is off), and delete the branch:
    ```bash
    gh pr merge <N> --squash --delete-branch --admin
    ```

11. Sync your local `main`:
    ```bash
    git checkout main && git pull
    ```

12. (Browser-visible changes) After the GitHub Pages build finishes (~1 min),
    hard-reload the live site and confirm the version:
    - <https://tiborh.github.io/jumping_squares/>
    - Hard reload: **Ctrl+Shift+R** (macOS: **Cmd+Shift+R**).
    - The tab title should read `Jumping Squares (vN)`; the on-page build tag
      (bottom-left) should match.

---

## Quick reference (browser-visible change)

```bash
# A. bump VERSION in js/game.js and all three ?v= in index.html
# B. test
node test/game.test.js
# C. branch + commit + PR
git checkout -b my-change-name
git add -A && git commit -m "summary"
git push -u origin my-change-name
gh pr create --fill
# D. verify
gh pr checks <N>
# E. merge + sync
gh pr merge <N> --squash --delete-branch --admin
git checkout main && git pull
```

---

## Troubleshooting

- **`push declined … Commits must have verified signatures`** — your commit is
  unsigned. Ensure signing is configured (see First-time setup), then re-sign:
  `git commit --amend --no-edit -S` and push again.
- **`refusing to allow an OAuth App to create or update workflow … without 'workflow' scope`**
  — your `gh` token lacks the `workflow` scope (needed when a PR edits files in
  `.github/workflows/`). Fix once:
  `gh auth refresh -h github.com -s workflow`.
- **`Cannot update this protected ref`** on merge — the ruleset has no bypass
  actor. Add **Repository admin** to the ruleset's bypass list
  (Settings → Rules → the ruleset → Bypass list), then retry with `--admin`.
- **`version wiring` test fails** — the `?v=` strings in `index.html` don't
  match `VERSION` in `js/game.js`. Make them equal.
- **Live site still shows the old version** — you're seeing a cached build.
  Confirm `VERSION` + `?v=` were bumped and merged, wait for the Pages build,
  then hard-reload.

---

## First-time setup

Only needed once per machine.

- **SSH commit signing** (uses your existing SSH key):
  ```bash
  git config --global gpg.format ssh
  git config --global user.signingkey ~/.ssh/id_rsa.pub
  git config --global commit.gpgsign true
  ```
- **Register the key as a *signing* key on GitHub** (separate from auth):
  ```bash
  gh auth refresh -h github.com -s admin:ssh_signing_key
  gh ssh-key add ~/.ssh/id_rsa.pub --type signing --title "signing key"
  ```
- **Allow the `workflow` scope** (for merging PRs that touch workflows):
  ```bash
  gh auth refresh -h github.com -s workflow
  ```
- **(Optional) local signature verification** so `git log --show-signature`
  works locally (cosmetic; GitHub verifies independently):
  ```bash
  mkdir -p ~/.config/git
  echo "$(git config user.email) $(cat ~/.ssh/id_rsa.pub)" \
    > ~/.config/git/allowed_signers
  git config --global gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers
  ```
