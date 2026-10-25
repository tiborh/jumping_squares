// SPDX-FileCopyrightText: 2026 tiborh
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browser smoke tests: the page loads cleanly and a basic human move works.
// These catch gross breakage (a script error on boot, a dead board) that the
// headless Node harness can't see because it never runs the DOM/UI layer.

const { test, expect } = require('@playwright/test');

test.describe('smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Fail the test on any uncaught page error or console error — the strongest
    // signal that a browser-only regression slipped in (e.g. a bad worker body,
    // a ReferenceError in ui.js).
    page.on('pageerror', (err) => { throw err; });
    page.on('console', (msg) => {
      if (msg.type() === 'error') throw new Error('console.error: ' + msg.text());
    });
    // Start from a clean slate so one test's saved game can't leak into another.
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  });

  test('page loads and the board renders 25 cells (default 5x5)', async ({ page }) => {
    await page.goto('/index.html');
    const board = page.locator('#board');
    await expect(board).toBeVisible();
    await expect(board.locator('.cell')).toHaveCount(25);
  });

  test('a human click places a move (a pip appears)', async ({ page }) => {
    await page.goto('/index.html');
    const firstCell = page.locator('#board .cell[data-r="0"][data-c="0"]');
    await firstCell.click();
    // A placed dot renders at least one pip inside the clicked cell.
    await expect(firstCell.locator('.pip')).toHaveCount(1);
  });
});
