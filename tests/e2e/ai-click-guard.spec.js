// SPDX-FileCopyrightText: 2026 tiborh
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// REGRESSION: a human click must not STEAL an AI seat's move. The bug (fixed):
// onCellClick only gated on busy/winner/legality, so during an AI's turn — and
// even while an AI-vs-AI match was PAUSED — a click on a legal cell placed the
// move for the AI.
//
// The policy is unit-tested (AGENTS.isAIType in test/game.test.js); this e2e
// test pins the real click behaviour in the browser.

const { test, expect } = require('@playwright/test');

const PREFS_KEY = 'jumping_squares:prefs';

// Seed an AI-vs-AI match (both seats Shark) at the default 5x5 and open fresh.
async function seedAIvsAI(page) {
  await page.addInitScript((prefsKey) => {
    try {
      localStorage.clear();
      localStorage.setItem(prefsKey, JSON.stringify({
        v: 11,
        boardSize: 5,
        pendingBoardSize: 5,
        autoSave: false, // keep storage noise-free for this test
        playerType: { 1: 'shark', 2: 'shark' },
        sharkDepth: { 1: 2, 2: 2 }, // shallow = fast, keeps the test snappy
      }));
    } catch (e) {}
  }, PREFS_KEY);
  await page.goto('/index.html');
}

test.describe('AI seat is protected from human clicks', () => {
  test('clicking during a paused AI-vs-AI match does not place a move', async ({ page }) => {
    await seedAIvsAI(page);

    // The AI-vs-AI pause/play control shares the bottom-right slot; it is shown
    // only during an ongoing AI-vs-AI match. Pause so no AI move is scheduled.
    const pauseBtn = page.locator('#aipause-btn');
    await expect(pauseBtn).toBeVisible();
    await pauseBtn.click(); // -> paused/held

    // Read the live move count straight from the engine state (exposed for the
    // worker; here a convenient, exact source of truth).
    const movesBefore = await page.evaluate(() => {
      // state isn't global, but the board DOM reflects it: count placed pips.
      return document.querySelectorAll('#board .pip, #board .count').length;
    });

    // Try to steal a move: click several legal-looking empty cells.
    for (const sel of ['[data-r="2"][data-c="2"]', '[data-r="0"][data-c="0"]', '[data-r="4"][data-c="4"]']) {
      const cell = page.locator('#board .cell' + sel);
      await expect(cell).toHaveAttribute('aria-disabled', 'true');
      // Bypass Playwright's aria-disabled gate so the app's own click guard
      // still receives a real pointer event and remains the thing under test.
      await cell.click({ force: true });
    }
    // Give any (erroneous) move a chance to render.
    await page.waitForTimeout(300);

    const movesAfter = await page.evaluate(() => {
      return document.querySelectorAll('#board .pip, #board .count').length;
    });

    expect(movesAfter, 'human clicks must not place moves on AI seats while paused')
      .toBe(movesBefore);
  });

  test('the pause control only appears for an AI-vs-AI match', async ({ page }) => {
    // Sanity anchor for the test above: with a human seat, the slot is the Hint
    // bulb, not the pause control.
    await page.addInitScript((prefsKey) => {
      try {
        localStorage.clear();
        localStorage.setItem(prefsKey, JSON.stringify({
          v: 11, boardSize: 5, pendingBoardSize: 5, autoSave: false,
          playerType: { 1: 'human', 2: 'shark' },
        }));
      } catch (e) {}
    }, PREFS_KEY);
    await page.goto('/index.html');
    await expect(page.locator('#aipause-btn')).toBeHidden();
  });
});
