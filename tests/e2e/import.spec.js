// SPDX-FileCopyrightText: 2026 tiborh
// SPDX-License-Identifier: AGPL-3.0-or-later

const { test, expect } = require('@playwright/test');

const PREFS_KEY = 'jumping_squares:prefs';
const SAVE_KEY = 'jumping_squares:save';

async function seedGame(page, size) {
  await page.goto('/index.html');
  const state = await page.evaluate(({ size, prefsKey, saveKey }) => {
    const G = window.JumpingSquares;
    const state = G.createGame({ rows: size, cols: size });
    G.applyMove(state, 1, 0, 0);
    G.applyMove(state, 2, size - 1, size - 1);
    G.applyMove(state, 1, 0, 1);
    localStorage.clear();
    localStorage.setItem(prefsKey, JSON.stringify({
      v: 11, boardSize: size, pendingBoardSize: size, autoSave: true,
      playerType: { 1: 'human', 2: 'human' },
    }));
    localStorage.setItem(saveKey, JSON.stringify({
      format: 'jumping_squares/save', formatVersion: 1,
      engineVersion: G.VERSION, savedAt: new Date().toISOString(), state,
    }));
    return state;
  }, { size, prefsKey: PREFS_KEY, saveKey: SAVE_KEY });
  await page.reload();
  return state;
}

async function importBackup(page, backup, includeBoard = false) {
  await page.locator('#settings-btn').click();
  await page.locator('#backup-open').click();
  await page.locator('#backup-group-board').setChecked(includeBoard);
  await page.locator('#backup-file').setInputFiles({
    name: 'backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#backup-status')).toContainText('Loaded');
  await page.locator('#backup-close').click();
  await page.locator('#settings-close').click();
}

test.describe('settings-only imports preserve the active board', () => {
  const cases = [
    { name: 'larger imported size', activeSize: 5, boardSize: 7, nextSize: 7 },
    { name: 'smaller imported size', activeSize: 7, boardSize: 5, nextSize: 5 },
    { name: 'legacy settings without a size', activeSize: 7, nextSize: 5 },
    { name: 'distinct pending size', activeSize: 5, boardSize: 7, pendingBoardSize: 9, nextSize: 9 },
    { name: 'auto-save disabled', activeSize: 5, boardSize: 7, nextSize: 7, autoSave: false },
  ];

  for (const entry of cases) {
    test(entry.name, async ({ page }) => {
      const state = await seedGame(page, entry.activeSize);
      const savedBefore = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
      await importBackup(page, {
        format: 'jumping_squares/backup', formatVersion: 1,
        prefs: {
          v: 11, boardSize: entry.boardSize, pendingBoardSize: entry.pendingBoardSize,
          autoSave: entry.autoSave !== false, hintLightDelay: 0,
          playerType: { 1: 'human', 2: 'human' },
        },
      });

      await expect(page.locator('#board .cell')).toHaveCount(entry.activeSize ** 2);
      const prefs = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), PREFS_KEY);
      expect(prefs.boardSize).toBe(entry.activeSize);
      expect(prefs.pendingBoardSize).toBe(entry.nextSize);
      expect(prefs.hintLightDelay).toBe(0);
      expect(prefs.autoSave).toBe(entry.autoSave !== false);
      expect(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBe(savedBefore);

      await page.reload();
      await expect(page.locator('#board .cell')).toHaveCount(entry.activeSize ** 2);
      await expect(page.locator('#board .cell.p1')).toHaveCount(2);
      await expect(page.locator('#board .cell.p2')).toHaveCount(1);
      await expect(page.locator('#board .pip')).toHaveCount(state.moveCount);
      await expect(page.locator('#turn-label')).toHaveText('Player 2');

      await page.locator('#newgame-btn').click();
      await page.locator('#confirm-ok').click();
      await expect(page.locator('#board .cell')).toHaveCount(entry.nextSize ** 2);
      await expect(page.locator('#board .pip')).toHaveCount(0);
      const nextPrefs = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), PREFS_KEY);
      expect(nextPrefs.boardSize).toBe(entry.nextSize);
    });
  }
});

test('a full import adopts its board size immediately and restores after reload', async ({ page }) => {
  const importedState = await seedGame(page, 7);
  await seedGame(page, 5);
  await importBackup(page, {
    format: 'jumping_squares/backup', formatVersion: 1,
    board: { format: 'jumping_squares/save', formatVersion: 1, state: importedState },
    prefs: {
      v: 11, boardSize: 7, pendingBoardSize: 9, autoSave: true,
      playerType: { 1: 'human', 2: 'human' },
    },
  }, true);

  await expect(page.locator('#board .cell')).toHaveCount(49);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY);
  expect(saved.state).toEqual(importedState);
  await page.reload();
  await expect(page.locator('#board .cell')).toHaveCount(49);
  await expect(page.locator('#board .pip')).toHaveCount(importedState.moveCount);
  await page.locator('#newgame-btn').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#board .cell')).toHaveCount(81);
});
