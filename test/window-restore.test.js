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

test('reopening a closed window restores its pinned groups intact and keeps their pinned URLs', async () => {
  const windowId = await extension.run(async (url) => (await chrome.windows.create({ url })).id, site.url('loose'));
  await extension.waitFor(async () => (await extension.tabs(windowId)).some((tab) => tab.isDivider));
  const open = (url) => extension.run(async (windowId, url) => (await chrome.tabs.create({ windowId, url, active: false })).id, windowId, url);
  const ask = [await open(site.url('ask-1')), await open(site.url('ask-2')), await open(site.url('ask-3'))];
  const groupId = await extension.group(ask, 'Ask');
  const dividerIndex = (await extension.tabs(windowId)).find((tab) => tab.isDivider).index;
  await extension.moveGroup(groupId, dividerIndex);
  await extension.run((id, url) => chrome.tabs.update(id, { url }), ask[1], site.url('ask-2-wandered'));
  await extension.settle(1_000);
  const before = await extension.layout(windowId);

  await extension.run((windowId) => chrome.windows.remove(windowId), windowId);
  await extension.settle(1_000);
  await extension.restoreLastClosed();

  const restoredWindowId = await extension.waitFor(async () => {
    const windows = await extension.run(() => chrome.windows.getAll({ populate: true }));
    return windows.find((window) => window.tabs.some((tab) => tab.url.endsWith('/loose')))?.id;
  }, { message: 'restored window' });
  await extension.settle(3_000);
  assert.deepEqual(await extension.layout(restoredWindowId), before);

  const wandered = (await extension.tabs(restoredWindowId)).find((tab) => tab.url.endsWith('ask-2-wandered'));
  await extension.close([wandered.id]);
  await extension.waitFor(async () => {
    const layout = await extension.layout(restoredWindowId);
    return JSON.stringify(layout) === JSON.stringify(before.map((entry) => entry.replace('ask-2-wandered', 'ask-2')));
  }, { message: 'pinned tab revived with its pinned URL' });
});
