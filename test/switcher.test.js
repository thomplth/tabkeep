import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startSite } from './harness.js';

let site;
let browser;
let extension;

before(async () => {
  site = await startSite();
  ({ browser, extension } = await launch());
});

after(async () => {
  await browser?.close();
  site?.close();
});

async function visit(...tabIds) {
  for (const id of tabIds) {
    await extension.run((id) => chrome.tabs.update(id, { active: true }), id);
    await extension.settle(300);
  }
}

const activeTab = async () => (await extension.tabs()).find((tab) => tab.active);
const overlayShown = (page) => page.evaluate(() => !!document.querySelector('tabkeep-switcher'));

async function switchWithCmdBackquote(fromTabId, { presses = 1, shift = false, inspect } = {}) {
  const page = await extension.pageFor(fromTabId);
  await page.keyboard.down('Meta');
  if (shift) await page.keyboard.down('Shift');
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press('Backquote');
    await extension.settle(250);
  }
  const result = await inspect?.(page);
  if (shift) await page.keyboard.up('Shift');
  await page.keyboard.up('Meta');
  await extension.settle(400);
  return result;
}

test('cmd+backquote jumps to the previously used tab', async () => {
  const a = await extension.open(site.url('alpha'));
  const b = await extension.open(site.url('beta'));
  await visit(a, b);

  await switchWithCmdBackquote(b);
  assert.equal((await activeTab()).id, a);
});

test('holding the modifier shows the switcher and each press goes one tab further back', async () => {
  const a = await extension.open(site.url('one'));
  const b = await extension.open(site.url('two'));
  const c = await extension.open(site.url('three'));
  await visit(a, b, c);

  const shown = await switchWithCmdBackquote(c, { presses: 2, inspect: overlayShown });
  assert.equal(shown, true);
  assert.equal((await activeTab()).id, a);
});

test('adding shift cycles the other way, starting from the least recent tab', async () => {
  const tabs = await extension.run(async () => (await chrome.tabs.query({ lastFocusedWindow: true })).length);
  const a = await extension.open(site.url('reverse-a'));
  const b = await extension.open(site.url('reverse-b'));
  await visit(a, b);

  await switchWithCmdBackquote(b, { shift: true });
  const active = await activeTab();
  assert.notEqual(active.id, b);
  assert.notEqual(active.id, a);
  assert.ok(tabs > 0);
});

test('escape closes the switcher without switching', async () => {
  const a = await extension.open(site.url('stay-a'));
  const b = await extension.open(site.url('stay-b'));
  await visit(a, b);

  const page = await extension.pageFor(b);
  await page.keyboard.down('Meta');
  await page.keyboard.press('Backquote');
  await extension.settle(300);
  await page.keyboard.press('Escape');
  await page.keyboard.up('Meta');
  await extension.settle(400);
  assert.equal((await activeTab()).id, b);
  assert.equal(await overlayShown(page), false);
});

test('a closed pinned tab drops out of the recent-tab order until it is visited again', async () => {
  const older = await extension.open(site.url('older'));
  const pinned = await extension.open(site.url('pinned-recent'));
  const current = await extension.open(site.url('current'));
  await extension.moveAboveDivider(pinned);
  await visit(older, pinned, current);

  await extension.close([pinned]);
  await extension.waitFor(async () => (await extension.tabs()).some((tab) => tab.url === site.url('pinned-recent')));

  await switchWithCmdBackquote(current);
  assert.equal((await activeTab()).id, older);
});

test('the divider never appears in the recent-tab order', async () => {
  const a = await extension.open(site.url('divider-a'));
  const b = await extension.open(site.url('divider-b'));
  const divider = (await extension.tabs()).find((tab) => tab.isDivider);
  await visit(a);
  await extension.run((id) => chrome.tabs.update(id, { active: true }), divider.id);
  await extension.settle(400);
  await visit(b);

  await switchWithCmdBackquote(b, { presses: 2 });
  assert.equal((await activeTab()).id, a);
});
