// SPDX-FileCopyrightText: 2026 tiborh
// SPDX-License-Identifier: AGPL-3.0-or-later

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('jumping_squares:prefs', JSON.stringify({
      v: 11, playerType: { 1: 'human', 2: 'human' },
    }));
  });
  await page.goto('/index.html');
});

for (const [name, parent, trigger, child, parentTrigger] of [
  ['Save/Load', '#settings-overlay', '#backup-open', '#backup-overlay', '#settings-btn'],
  ['Reset', '#settings-overlay', '#reset-firstuse', '#reset-overlay', '#settings-btn'],
  ['Board size', '#settings-overlay', '#boardsize-open', '#boardsize-overlay', '#settings-btn'],
  ["What's new", '#about-overlay', '#whatsnew-open', '#whatsnew-overlay', '#build-tag'],
]) {
  test('Escape closes only ' + name + ' and restores its parent focus', async ({ page }) => {
    await page.locator(parentTrigger).click();
    await page.locator(trigger).click();
    await expect(page.locator(child)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(child)).not.toBeVisible();
    await expect(page.locator(parent)).toBeVisible();
    await expect(page.locator(trigger)).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.locator(parent).evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator(parent)).not.toBeVisible();
    await expect(page.locator(parentTrigger)).toBeFocused();
  });
}

test('Escape unwinds import confirmation, Save/Load, and Settings one at a time', async ({ page }) => {
  await page.locator('#settings-btn').click();
  await page.locator('#backup-open').click();
  await page.locator('#backup-group-board').uncheck();
  await page.locator('#backup-file').setInputFiles({
    name: 'settings.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      format: 'jumping_squares/backup', formatVersion: 1,
      prefs: { v: 11, playerNames: { 1: 'Imported' } },
    })),
  });
  await expect(page.locator('#confirm-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-overlay')).not.toBeVisible();
  await expect(page.locator('#backup-overlay')).toBeVisible();
  await expect(page.locator('#settings-overlay')).toBeVisible();
  expect(await page.locator('#backup-overlay').evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#backup-overlay')).not.toBeVisible();
  await expect(page.locator('#settings-overlay')).toBeVisible();
  await expect(page.locator('#backup-open')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-overlay')).not.toBeVisible();
  await expect(page.locator('#settings-btn')).toBeFocused();
  await expect(page.locator('#turn-label')).toHaveText('Player 1');
});

test('Escape in a player name field still reverts the edit and closes Players', async ({ page }) => {
  await page.locator('#turn').click();
  await page.locator('#p1-name').fill('Uncommitted name');
  await page.keyboard.press('Escape');
  await expect(page.locator('#players-overlay')).not.toBeVisible();
  await expect(page.locator('#turn')).toBeFocused();
  await expect(page.locator('#turn-label')).toHaveText('Player 1');
  await page.locator('#turn').click();
  await expect(page.locator('#p1-name')).not.toHaveValue('Uncommitted name');
});

test('the winner dialog stays open on Escape and Play Again returns focus to the board', async ({ page }) => {
  await page.locator('#settings-btn').click();
  await page.locator('#boardsize-open').click();
  await page.locator('#boardsize-range').fill('2');
  await page.locator('#boardsize-range').dispatchEvent('input');
  await page.keyboard.press('Escape');
  await page.locator('#delay-range').fill('0');
  await page.locator('#delay-range').dispatchEvent('input');
  await page.keyboard.press('Escape');
  await page.locator('#newgame-btn').click();
  await page.locator('#confirm-ok').press('Enter');
  for (let move = 0; move < 9; move++) {
    const coordinate = move % 2;
    await page.locator('#board .cell[data-r="' + coordinate + '"][data-c="' + coordinate + '"]')
      .press('Enter');
  }
  await expect(page.locator('#winner-overlay')).toBeVisible();
  await expect(page.locator('#play-again')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#winner-overlay')).toBeVisible();
  await expect(page.locator('#play-again')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#winner-overlay')).not.toBeVisible();
  await expect(page.locator('#board [tabindex="0"]')).toBeFocused();
});
