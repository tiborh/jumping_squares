<!--
  SPDX-FileCopyrightText: 2025 tiborh
  SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Security Policy

## About this project

Jumping Squares is a **static, client-side browser game**. It has:

- **no backend / server** — it is plain HTML, CSS and JavaScript served as
  static files (GitHub Pages);
- **no runtime dependencies** — nothing is fetched or bundled from npm or a CDN;
- **no user accounts, authentication, or data collection** — it stores no
  personal data and makes no network requests during play.

As a result the practical attack surface is small. The areas that are still
security-relevant, and that reports are most useful for, are:

- **client-side code issues** in `index.html` / `js/*.js` (e.g. a DOM-based XSS
  vector, if any were ever introduced);
- **supply-chain / CI integrity** — the GitHub Actions and workflows used to
  test, scan and deploy the site (see `.github/workflows/`);
- **integrity of the deployed build** on GitHub Pages.

## Supported versions

This project ships as a single continuously-deployed build, identified by an
incrementing `VERSION` in `js/game.js` (shown in the page's build tag and tab
title). There are no long-lived release branches.

| Version                        | Supported          |
| ------------------------------ | ------------------ |
| Latest `main` (deployed build) | :white_check_mark: |
| Any older build                | :x:                |

Only the current build published from `main` to
<https://tiborh.github.io/jumping_squares/> is supported. Fixes are applied to
`main` and redeployed; there is no back-porting.

## Reporting a vulnerability

Please report vulnerabilities **privately** — do not open a public issue for a
security problem.

- Preferred: use GitHub's **private vulnerability reporting** for this
  repository — go to the **Security** tab → **Report a vulnerability** (this
  opens a private advisory visible only to the maintainer). Direct link:
  <https://github.com/tiborh/jumping_squares/security/advisories/new>

Please include, where possible:

- affected file(s) and the build `VERSION` you observed;
- a description of the issue and its impact;
- steps to reproduce (a minimal example or a short sequence of moves/actions);
- any suggested fix.

### What to expect

This is a small, volunteer-maintained free-software project, so responses are
best-effort rather than bound by a formal SLA. As a guideline:

- **Acknowledgement:** typically within about a week.
- **Assessment:** the report will be triaged and you'll be told whether it is
  accepted, needs more information, or is declined (with reasoning).
- **Fix & disclosure:** accepted issues are fixed on `main` and redeployed;
  the advisory is then published. Coordinated disclosure is appreciated —
  please allow a reasonable window before disclosing publicly.
- **Credit:** if you'd like, you'll be credited in the advisory / release
  notes.

## Scope notes

- Reports about the **game rules** (e.g. an unexpected cascade outcome) are
  welcome, but they are **gameplay bugs**, not security issues — please open a
  normal issue for those.
- Because the game runs entirely in your browser with no server or stored data,
  classic web-app categories such as authentication bypass, injection into a
  database, or server-side RCE do not apply.
