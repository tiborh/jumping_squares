// SPDX-FileCopyrightText: 2026 tiborh
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Playwright config for the OPTIONAL browser (e2e) tests. These cover the
// browser-only paths the Node harness (node test/game.test.js) cannot reach:
// localStorage restore across reload, the Web Worker AI search, and input
// gating. They are NOT part of the always-run gate — the fast, zero-dependency
// gate is still `node test/game.test.js`.
//
// The GAME has no build step; for e2e we serve the static files over http so
// Playwright can drive a real browser (the shipped game is still opened via
// file://). A static server is used instead of file:// because headless
// Chromium blocks file:// navigation for automation; the app behaves the same.

const { defineConfig, devices } = require('@playwright/test');

const PORT = 8123;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  // CI is single-worker + retries for stability; local runs are faster.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:' + PORT,
    headless: true,
    actionTimeout: 10000,
    trace: 'retain-on-failure',
  },
  // Serve the repo root statically. python3 is available on the CI image and on
  // the dev machine; this keeps the project itself dependency-free (no server
  // package). reuseExistingServer lets a dev leave a server running locally.
  webServer: {
    command: 'python3 -m http.server ' + PORT,
    port: PORT,
    timeout: 60000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'chromium', use: { ...devices['Desktop Chromium'] } },
  ],
});
