import { test } from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { EXTENSION_PATH, launch, startSite } from './harness.js';

test('a pinned tab keeps its pinned URL across a browser restart', async () => {
  const site = await startSite();
  const { browser, extension, userDataDir } = await launch();
  const extensionId = new URL(extension.target.url()).host;
  const id = await extension.open(site.url('home-page'));
  await extension.moveAboveDivider(id);
  await extension.run((id, url) => chrome.tabs.update(id, { url }), id, site.url('wandered'));
  await extension.settle(1_500);
  await browser.close();

  const restarted = await puppeteer.launch({
    headless: true,
    pipe: true,
    userDataDir,
    enableExtensions: [EXTENSION_PATH],
    ignoreDefaultArgs: ['about:blank'],
    args: ['--restore-last-session'],
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const driver = await restarted.newPage();
    await driver.goto(`chrome-extension://${extensionId}/options.html`);
    const urls = () => driver.evaluate(async () => (await chrome.tabs.query({})).map((tab) => tab.pendingUrl || tab.url));

    const wandered = await driver.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url.endsWith('/wandered')));
    await driver.evaluate((id) => chrome.tabs.remove(id), wandered.id);
    const deadline = Date.now() + 8_000;
    let after = await urls();
    while (after[0] !== site.url('home-page') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      after = await urls();
    }
    assert.equal(after[0], site.url('home-page'));
    assert.match(after[1], /divider\.html#/);
  } finally {
    await restarted.close();
    site.close();
  }
});
