// SPDX-FileCopyrightText: 2026 tiborh
// SPDX-License-Identifier: AGPL-3.0-or-later

const { test, expect } = require('@playwright/test');

const PREFS_KEY = 'jumping_squares:prefs';
const SAVE_KEY = 'jumping_squares:save';

function cell(page, r, c) {
  return page.locator('#board .cell[data-r="' + r + '"][data-c="' + c + '"]');
}

async function savedState(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)).state, SAVE_KEY);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((prefsKey) => {
    if (!localStorage.getItem(prefsKey)) {
      localStorage.setItem(prefsKey, JSON.stringify({
        v: 11, autoSave: true, playerType: { 1: 'human', 2: 'human' },
      }));
    }
  }, PREFS_KEY);
  await page.goto('/index.html');
});

test('the grid has one Tab stop, bounded arrow navigation, and visible keyboard focus', async ({ page }) => {
  await expect(page.locator('#board [tabindex="0"]')).toHaveCount(1);
  await page.locator('#settings-btn').focus();
  await page.keyboard.press('Tab');
  await expect(cell(page, 0, 0)).toBeFocused();
  expect(await cell(page, 0, 0).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await expect(cell(page, 0, 0)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 1, 1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(cell(page, 1, 4)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(cell(page, 1, 0)).toBeFocused();
  await page.keyboard.press('Control+End');
  await expect(cell(page, 4, 4)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 4, 4)).toBeFocused();
  await page.keyboard.press('Control+Home');
  await expect(cell(page, 0, 0)).toBeFocused();
  await cell(page, 2, 3).click();
  await expect(page.locator('#board [tabindex="0"]')).toHaveCount(1);
  await expect(cell(page, 2, 3)).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('Tab');
  await expect(page.locator('#build-tag')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cell(page, 2, 3)).toBeFocused();
});

test('Enter and Space place legal moves without playing opponent cells or repeated keys', async ({ page }) => {
  await cell(page, 0, 0).press('Enter');
  await expect(cell(page, 0, 0)).toBeFocused();
  await expect(cell(page, 0, 0)).toHaveAttribute('aria-disabled', 'true');
  await cell(page, 0, 0).press('Space');
  expect((await savedState(page)).moveCount).toBe(1);
  await cell(page, 0, 1).dispatchEvent('keydown', { key: 'Enter', repeat: true });
  expect((await savedState(page)).moveCount).toBe(1);
  await cell(page, 0, 1).press('Space');
  await expect(cell(page, 0, 1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  expect((await savedState(page)).moveCount).toBe(3);
  await expect(cell(page, 0, 0)).toHaveAttribute('aria-label',
    'Row 1, column 1: Player 1, 2 points, capacity 2.');
  await expect(cell(page, 0, 1)).toHaveAttribute('aria-label',
    'Row 1, column 2: Player 2, 1 point, capacity 3.');
});

test('accessible rows, coordinates, owners and values reflect the live board and names', async ({ page }) => {
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '5');
  await expect(page.getByRole('grid')).toHaveAttribute('aria-colcount', '5');
  await expect(page.getByRole('row')).toHaveCount(5);
  await expect(page.getByRole('gridcell')).toHaveCount(25);
  const first = await cell(page, 0, 0).boundingBox();
  const lastColumn = await cell(page, 0, 4).boundingBox();
  const lastRow = await cell(page, 4, 0).boundingBox();
  expect(first.width).toBeCloseTo(first.height, 1);
  expect(lastColumn.x).toBeGreaterThan(first.x);
  expect(lastColumn.y).toBeCloseTo(first.y, 1);
  expect(lastRow.x).toBeCloseTo(first.x, 1);
  expect(lastRow.y).toBeGreaterThan(first.y);
  await expect(cell(page, 0, 0)).toHaveAttribute('aria-label',
    'Row 1, column 1: empty, 0 points, capacity 2.');
  await expect(cell(page, 2, 2)).toHaveAttribute('aria-label',
    'Row 3, column 3: empty, 0 points, capacity 4.');
  await expect(cell(page, 2, 2)).toHaveAttribute('aria-colindex', '3');
  await expect(page.getByRole('row').nth(2)).toHaveAttribute('aria-rowindex', '3');
  await cell(page, 0, 0).press('Enter');
  await page.locator('#turn').click();
  await page.locator('#p1-name').fill('Alice');
  await page.locator('#p1-name').press('Enter');
  await page.keyboard.press('Escape');
  await expect(cell(page, 0, 0)).toHaveAttribute('aria-label',
    'Row 1, column 1: Alice, 1 point, capacity 2.');
});

test('keyboard moves are locked during a manually stepped cascade', async ({ page }) => {
  await page.locator('#settings-btn').click();
  await page.locator('#delay-range').fill('11');
  await page.locator('#delay-range').dispatchEvent('input');
  await page.keyboard.press('Escape');
  await cell(page, 0, 0).press('Enter');
  await cell(page, 4, 4).press('Enter');
  await cell(page, 0, 0).press('Enter');
  await cell(page, 4, 4).press('Enter');
  await cell(page, 0, 0).press('Enter');
  await expect(page.locator('#step-btn')).toBeVisible();
  await expect(page.locator('#board [aria-disabled="false"]')).toHaveCount(0);
  await cell(page, 1, 1).press('Enter');
  await expect(cell(page, 1, 1).locator('.pip')).toHaveCount(0);
  expect((await savedState(page)).moveCount).toBe(4);
  await page.locator('#step-btn').press('Enter');
  expect((await savedState(page)).moveCount).toBe(5);
  await expect(page.locator('#board [aria-disabled="false"]')).not.toHaveCount(0);
});

test('keyboard activation cannot play a paused AI seat', async ({ page }) => {
  await page.locator('#turn').click();
  await page.locator('#p1-type').selectOption('shark');
  await page.locator('#p2-type').selectOption('shark');
  await page.locator('#players-close').click();
  await page.locator('#aipause-btn').click();
  const before = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  await expect(page.locator('#board [aria-disabled="false"]')).toHaveCount(0);
  await cell(page, 0, 0).press('Enter');
  await cell(page, 2, 2).press('Space');
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBe(before);
});

test('an open dialog disables board activation and closing it restores input', async ({ page }) => {
  await page.locator('#newgame-btn').click();
  await expect(page.locator('#board [aria-disabled="false"]')).toHaveCount(0);
  await cell(page, 0, 0).dispatchEvent('keydown', { key: 'Enter' });
  await expect(page.locator('#board .pip')).toHaveCount(0);
  await expect(page.locator('#confirm-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#board [aria-disabled="false"]')).toHaveCount(25);
  await cell(page, 0, 0).press('Enter');
  await expect(page.locator('#board .pip')).toHaveCount(1);
});

for (const trigger of ['#help-btn', '#build-tag', '#newgame-btn']) {
  test(trigger + ' holds a scheduled AI move until the dialog closes', async ({ page }) => {
    await page.clock.install();
    await page.locator('#turn').click();
    await page.locator('#p1-type').selectOption('random');
    await page.locator('#players-close').click();
    await page.locator(trigger).click();
    await page.clock.runFor(1000);
    await expect(page.locator('#board .pip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.clock.runFor(1000);
    await expect(page.locator('#board .pip')).toHaveCount(1);
    await expect(page.locator('#turn-label')).toHaveText('Player 2');
    expect((await savedState(page)).moveCount).toBe(1);
  });
}

test('nested dialogs abort an AI search and restart it only after the last dialog closes', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(() => {
    window.dialogWorkers = [];
    window.Worker = class {
      constructor() { window.dialogWorkers.push(this); }
      postMessage(message) { this.request = message; }
      terminate() { this.terminated = true; }
    };
  });
  await page.locator('#turn').click();
  await page.locator('#p1-type').selectOption('shark');
  await page.locator('#players-close').click();
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.dialogWorkers.length)).toBe(1);
  await page.locator('#build-tag').click();
  await page.locator('#whatsnew-open').click();
  expect(await page.evaluate(() => window.dialogWorkers[0].terminated)).toBe(true);
  await page.evaluate(() => {
    const worker = window.dialogWorkers[0];
    worker.onmessage({ data: { seq: worker.request.seq, ok: true, move: { r: 0, c: 0 } } });
  });
  await expect(page.locator('#board .pip')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#about-overlay')).toBeVisible();
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.dialogWorkers.length)).toBe(1);
  await page.keyboard.press('Escape');
  await page.clock.runFor(1000);
  expect(await page.evaluate(() => window.dialogWorkers.length)).toBe(2);
  await page.evaluate(() => {
    const stale = window.dialogWorkers[0];
    stale.onmessage({ data: { seq: stale.request.seq, ok: true, move: { r: 0, c: 0 } } });
  });
  await expect(page.locator('#board .pip')).toHaveCount(0);
  await page.evaluate(() => {
    const worker = window.dialogWorkers[1];
    worker.onmessage({ data: { seq: worker.request.seq, ok: true, move: { r: 1, c: 1 } } });
  });
  await expect(cell(page, 1, 1).locator('.pip')).toHaveCount(1);
  expect((await savedState(page)).moveCount).toBe(1);
});

test('a resized New Game rebuilds coordinates and its single Tab stop', async ({ page }) => {
  await cell(page, 4, 4).focus();
  await page.locator('#settings-btn').click();
  await page.locator('#boardsize-open').click();
  await page.locator('#boardsize-range').fill('7');
  await page.locator('#boardsize-range').dispatchEvent('input');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('#newgame-btn').click();
  await page.locator('#confirm-ok').press('Enter');
  await expect(page.getByRole('row')).toHaveCount(7);
  await expect(page.getByRole('gridcell')).toHaveCount(49);
  await expect(page.locator('#board')).toHaveAttribute('aria-rowcount', '7');
  await expect(page.locator('#board [tabindex="0"]')).toHaveCount(1);
  await expect(cell(page, 0, 0)).toHaveAttribute('tabindex', '0');
  await cell(page, 0, 0).focus();
  await page.keyboard.press('Control+End');
  await expect(cell(page, 6, 6)).toBeFocused();
});

test('a restored non-default board remains playable with keyboard controls', async ({ page }) => {
  await page.evaluate(({ prefsKey, saveKey }) => {
    const G = window.JumpingSquares;
    const state = G.createGame({ rows: 7, cols: 7 });
    G.applyMove(state, 1, 0, 0);
    G.applyMove(state, 2, 6, 6);
    G.applyMove(state, 1, 0, 1);
    const prefs = JSON.parse(localStorage.getItem(prefsKey));
    prefs.boardSize = prefs.pendingBoardSize = 7;
    localStorage.setItem(prefsKey, JSON.stringify(prefs));
    localStorage.setItem(saveKey, JSON.stringify({
      format: 'jumping_squares/save', formatVersion: 1, state,
    }));
  }, { prefsKey: PREFS_KEY, saveKey: SAVE_KEY });
  await page.reload();
  await expect(page.locator('#board [tabindex="0"]')).toHaveCount(1);
  await cell(page, 0, 0).focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Space');
  expect((await savedState(page)).moveCount).toBe(4);
  await expect(cell(page, 6, 6)).toHaveAttribute('aria-label',
    'Row 7, column 7: Player 2, 2 points, capacity 2.');
});

test('finished boards reject keyboard moves and New Game restores board focus', async ({ page }) => {
  const finished = await page.evaluate(({ prefsKey, saveKey }) => {
    const G = window.JumpingSquares;
    const state = G.createGame({ rows: 2, cols: 2 });
    for (let i = 0; i < 20 && !state.winner; i++) {
      const coordinate = state.current === 1 ? 0 : 1;
      G.applyMove(state, state.current, coordinate, coordinate);
    }
    const prefs = JSON.parse(localStorage.getItem(prefsKey));
    prefs.boardSize = prefs.pendingBoardSize = 2;
    localStorage.setItem(prefsKey, JSON.stringify(prefs));
    localStorage.setItem(saveKey, JSON.stringify({
      format: 'jumping_squares/save', formatVersion: 1, state,
    }));
    return state;
  }, { prefsKey: PREFS_KEY, saveKey: SAVE_KEY });
  expect(finished.winner).not.toBe(0);
  await page.reload();
  await expect(page.locator('#board [aria-disabled="false"]')).toHaveCount(0);
  await cell(page, 0, 0).press('Enter');
  await cell(page, 1, 1).press('Space');
  expect(await savedState(page)).toEqual(finished);
  await page.locator('#endgame-new').press('Enter');
  await expect(cell(page, 0, 0)).toBeFocused();
  await expect(page.locator('#board [aria-disabled="false"]')).toHaveCount(4);
});
