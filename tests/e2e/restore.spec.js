// SPDX-FileCopyrightText: 2026 tiborh
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// REGRESSION: a valid saved game of a non-default board size must survive a
// page reload. The bug (fixed): boot-time persistence UI ran the dimension
// check before the UI adopted the persisted board size, and the save loader
// DELETED any save whose size didn't match the (stale) default — so a 7x7
// game was wiped on reload and the board reset to 5x5.
//
// The pure decision is unit-tested (classifySave in test/game.test.js); this
// e2e test pins the END-TO-END browser behaviour across a real reload with
// real localStorage, which the Node harness cannot exercise.

const { test, expect } = require('@playwright/test');

const PREFS_KEY = 'jumping_squares:prefs';
const SAVE_KEY = 'jumping_squares:save';

test.describe('saved-game restore across reload', () => {
  test('a 7x7 in-progress game is restored (not reset to 5x5)', async ({ page }) => {
    const discardWarnings = [];
    page.on('console', (msg) => {
      if (msg.text().includes('discarding unusable saved game')) {
        discardWarnings.push(msg.text());
      }
    });

    // First load. (Storage is cleared explicitly AFTER navigating, not via
    // addInitScript — an init script re-runs on reload() and would wipe the
    // save we seed below, which is exactly the thing under test.)
    await page.goto('/index.html');
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

    // Build a valid 7x7 in-progress state via the loaded engine, then seed both
    // the prefs (active boardSize 7) and the save wrapper exactly as the app
    // writes them.
    await page.evaluate(({ prefsKey, saveKey }) => {
      const G = window.JumpingSquares;
      const s = G.createGame({ rows: 7, cols: 7, players: 2 });
      G.applyMove(s, 1, 0, 0);
      G.applyMove(s, 2, 6, 6);
      G.applyMove(s, 1, 0, 1);
      const state = G.cloneState(s);

      localStorage.setItem(prefsKey, JSON.stringify({
        v: 11,
        boardSize: 7,
        pendingBoardSize: 7,
        autoSave: true,
        playerType: { 1: 'human', 2: 'human' },
      }));
      localStorage.setItem(saveKey, JSON.stringify({
        format: 'jumping_squares/save',
        formatVersion: 1,
        engineVersion: G.VERSION,
        savedAt: new Date().toISOString(),
        state: state,
      }));
    }, { prefsKey: PREFS_KEY, saveKey: SAVE_KEY });

    // Reload: the app should adopt boardSize 7 and RESTORE the 7x7 save.
    await page.reload();

    // 7x7 board = 49 cells (would be 25 if it had reset / discarded the save).
    await expect(page.locator('#board .cell')).toHaveCount(49);

    // The save must NOT have been discarded.
    expect(discardWarnings, 'no "discarding" warning should fire').toHaveLength(0);

    // And it must still be present in storage after the reload (non-destructive).
    const stillThere = await page.evaluate((k) => localStorage.getItem(k) !== null, SAVE_KEY);
    expect(stillThere, 'the save survives in localStorage').toBe(true);

    // The restored position carries the three seeded moves (moveCount 3).
    const moveCount = await page.evaluate((k) => {
      return JSON.parse(localStorage.getItem(k)).state.moveCount;
    }, SAVE_KEY);
    expect(moveCount).toBe(3);
  });

  test('a save for a DIFFERENT size than the current board is kept, not deleted', async ({ page }) => {
    // Active size 5, but a valid 7x7 save exists (e.g. user switched size via a
    // fresh New Game without resuming). The 7x7 save must be KEPT (so switching
    // back could resume it) — never wiped just because it doesn't fit now.
    await page.goto('/index.html');
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

    await page.evaluate(({ prefsKey, saveKey }) => {
      const G = window.JumpingSquares;
      const s = G.createGame({ rows: 7, cols: 7, players: 2 });
      G.applyMove(s, 1, 0, 0);
      G.applyMove(s, 2, 6, 6);
      localStorage.setItem(prefsKey, JSON.stringify({
        v: 11, boardSize: 5, pendingBoardSize: 5, autoSave: true,
        playerType: { 1: 'human', 2: 'human' },
      }));
      localStorage.setItem(saveKey, JSON.stringify({
        format: 'jumping_squares/save', formatVersion: 1, engineVersion: G.VERSION,
        savedAt: new Date().toISOString(), state: G.cloneState(s),
      }));
    }, { prefsKey: PREFS_KEY, saveKey: SAVE_KEY });

    await page.reload();

    // Active board is 5x5 (25 cells) — the mismatched save was NOT adopted...
    await expect(page.locator('#board .cell')).toHaveCount(25);
    // ...but it was ALSO not deleted (the whole point of the fix).
    const stillThere = await page.evaluate((k) => localStorage.getItem(k) !== null, SAVE_KEY);
    expect(stillThere, 'a size-mismatched save is kept, not discarded').toBe(true);
  });
});
