// SPDX-FileCopyrightText: 2026 tiborh
// SPDX-License-Identifier: AGPL-3.0-or-later

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function prepareHints(page, mode = 'real', opponent = 'human') {
  await page.addInitScript(({ mode, opponent }) => {
    localStorage.clear();
    localStorage.setItem('jumping_squares:prefs', JSON.stringify({
      v: 11, boardSize: 5, pendingBoardSize: 5, autoSave: true,
      playerType: { 1: 'human', 2: opponent },
      sharkDepth: { 1: 2, 2: 2 },
      hintLightDelay: 0,
    }));
    window.searchWorkers = [];
    window.searchRequests = [];
    const NativeWorker = window.Worker;
    if (mode === 'missing') {
      window.Worker = undefined;
    } else if (mode === 'real') {
      window.Worker = class extends NativeWorker {
        postMessage(message) {
          window.searchRequests.push(message);
          super.postMessage(message);
        }
      };
    } else {
      window.Worker = class {
        constructor() {
          if (mode === 'construct-failure') throw new Error('Worker blocked');
          window.searchWorkers.push(this);
        }
        postMessage(message) {
          if (mode === 'post-failure') throw new Error('Cannot post');
          this.request = message;
          window.searchRequests.push(message);
        }
        terminate() {
          this.terminated = true;
        }
      };
    }
  }, { mode, opponent });
}

async function forbidMainThreadSearch(page) {
  await page.evaluate(() => {
    window.mainThreadSearches = 0;
    window.JumpingSquaresAgents.bestMove = function () {
      window.mainThreadSearches++;
      throw new Error('Hint search ran on the main thread');
    };
  });
}

async function reply(page, workerIndex, move = { r: 0, c: 0 }) {
  await page.evaluate(({ workerIndex, move }) => {
    const worker = window.searchWorkers[workerIndex];
    worker.onmessage({ data: { seq: worker.request.seq, ok: true, move } });
  }, { workerIndex, move });
}

for (const [name, url] of [
  ['served page', '/index.html'],
  ['local file', pathToFileURL(path.resolve(__dirname, '../../index.html')).href],
]) {
  test('a real worker returns an advisory hint on a ' + name, async ({ page }) => {
    await prepareHints(page);
    await page.goto(url);
    await forbidMainThreadSearch(page);
    const saveBefore = await page.evaluate(() => localStorage.getItem('jumping_squares:save'));
    await page.locator('#hint-btn').click();
    await expect(page.locator('#hint-live')).toHaveText(/Hint: play row \d+, column \d+\./);
    await expect(page.locator('#board .hint-flash')).toHaveCount(1);
    await expect(page.locator('#hint-btn')).toBeEnabled();
    await expect(page.locator('#board .pip')).toHaveCount(0);
    await expect(page.locator('#turn-label')).toHaveText('Player 1');
    expect(await page.evaluate(() => window.mainThreadSearches)).toBe(0);
    expect(await page.evaluate(() => window.searchRequests.map((r) => r.type))).toEqual(['hint']);
    expect(await page.evaluate(() => localStorage.getItem('jumping_squares:save'))).toBe(saveBefore);
  });
}

test('a slow hint shows its spinner while the main thread stays responsive', async ({ page }) => {
  await prepareHints(page, 'held');
  await page.goto('/index.html');
  await forbidMainThreadSearch(page);
  await page.locator('#hint-btn').click();
  await expect(page.locator('#hint-btn')).toBeDisabled();
  await expect(page.locator('#hint-btn')).toHaveClass(/thinking/);
  expect(await page.evaluate(() => new Promise((resolve) => setTimeout(() => resolve('responsive'), 0))))
    .toBe('responsive');
  await reply(page, 0);
  await expect(page.locator('#hint-live')).toHaveText('Hint: play row 1, column 1.');
  await expect(page.locator('#hint-btn')).not.toHaveClass(/thinking/);
  await expect(page.locator('#hint-btn')).toBeEnabled();
  expect(await page.evaluate(() => window.mainThreadSearches)).toBe(0);
});

test('a move cancels its hint without disrupting the next AI worker search', async ({ page }) => {
  await prepareHints(page, 'held', 'shark');
  await page.goto('/index.html');
  await page.locator('#hint-btn').click();
  await page.locator('#board .cell[data-r="0"][data-c="0"]').click();
  await expect.poll(() => page.evaluate(() => window.searchRequests.map((r) => r.type)))
    .toEqual(['hint', 'shark']);
  expect(await page.evaluate(() => window.searchWorkers[0].terminated)).toBe(true);
  await reply(page, 0);
  await expect(page.locator('#hint-live')).toHaveText('');
  await expect(page.locator('#board .hint-flash')).toHaveCount(0);
  await reply(page, 1, { r: 4, c: 4 });
  await expect(page.locator('#board .cell.p2 .pip')).toHaveCount(1);
  await expect(page.locator('#turn-label')).toHaveText('Player 1');
  const aiSeq = await page.evaluate(() => window.searchWorkers[1].request.seq);
  await page.locator('#hint-btn').click();
  await page.evaluate((seq) => {
    window.searchWorkers[1].onmessage({ data: { seq, ok: true, move: { r: 1, c: 1 } } });
  }, aiSeq);
  await expect(page.locator('#hint-live')).toHaveText('');
  await reply(page, 1, { r: 2, c: 2 });
  await expect(page.locator('#hint-live')).toHaveText('Hint: play row 3, column 3.');
});

for (const [name, open, close] of [
  ['Settings', '#settings-btn', '#settings-close'],
  ['Players', '#turn', '#players-close'],
  ['Help', '#help-btn', '#help-close'],
  ['About', '#build-tag', '#about-close'],
  ['New Game', '#newgame-btn', '#confirm-ok'],
]) {
  test(name + ' cancels an outstanding hint and discards late replies', async ({ page }) => {
    await prepareHints(page, 'held');
    await page.goto('/index.html');
    await page.locator('#hint-btn').click();
    await page.locator(open).click();
    expect(await page.evaluate(() => window.searchWorkers[0].terminated)).toBe(true);
    await reply(page, 0);
    await expect(page.locator('#hint-live')).toHaveText('');
    await expect(page.locator('#board .hint-flash')).toHaveCount(0);
    await page.locator(close).click();
    await expect(page.locator('#hint-btn')).toBeEnabled();
    await expect(page.locator('#hint-btn')).toHaveClass(/lit/);
    await page.locator('#hint-btn').click();
    await reply(page, 0);
    await expect(page.locator('#hint-live')).toHaveText('');
    await reply(page, 1);
    await expect(page.locator('#hint-live')).toHaveText('Hint: play row 1, column 1.');
  });
}

for (const mode of ['missing', 'construct-failure', 'post-failure', 'search-failure', 'worker-error']) {
  test(mode + ' reports unavailable hints without a blocking fallback', async ({ page }) => {
    const warnings = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await prepareHints(page, mode);
    await page.goto('/index.html');
    await forbidMainThreadSearch(page);
    await page.locator('#hint-btn').click();
    if (mode === 'search-failure') {
      await page.evaluate(() => {
        const worker = window.searchWorkers[0];
        worker.onmessage({ data: { seq: worker.request.seq, ok: false, error: 'Search failed' } });
      });
    } else if (mode === 'worker-error') {
      await page.evaluate(() => window.searchWorkers[0].onerror());
    }
    await expect(page.locator('#hint-live')).toHaveText(/Hints are unavailable/);
    await expect(page.locator('#hint-btn')).toBeEnabled();
    await expect(page.locator('#hint-btn')).not.toHaveClass(/thinking/);
    await expect(page.locator('#board .hint-flash')).toHaveCount(0);
    expect(await page.evaluate(() => window.mainThreadSearches)).toBe(0);
    expect(warnings.some((warning) => warning.includes('Hints are unavailable'))).toBe(true);
    await page.locator('#board .cell').first().click();
    await expect(page.locator('#board .pip')).toHaveCount(1);
  });
}
