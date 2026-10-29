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

const tabById = async (id) => (await extension.tabs()).find((tab) => tab.id === id);
const isPinned = async (id) => {
  const tab = await tabById(id);
  return tab.pinned || tab.index < (await extension.dividerIndex());
};

async function press(tabId, key) {
  const page = await extension.pageFor(tabId);
  await page.keyboard.down('Meta');
  await page.keyboard.press(key);
  await page.keyboard.up('Meta');
  await extension.settle();
}

async function pinnedGroup(name) {
  const a = await extension.open(site.url(`${name}-a`));
  const b = await extension.open(site.url(`${name}-b`));
  const groupId = await extension.group([a, b], name);
  await extension.moveGroup(groupId, await extension.dividerIndex());
  return [a, b];
}

test('a window.open from a pinned tab lands below the divider instead of joining the pinned group', async () => {
  const [, source] = await pinnedGroup('Release');
  const pinnedBefore = (await extension.layout()).slice(0, await extension.dividerIndex());
  const page = await extension.pageFor(source);

  for (const name of ['popup-one', 'popup-two', 'popup-three']) {
    await page.evaluate((name) => window.open(`/${name}`), name);
    await extension.settle(1_000);
  }

  assert.deepEqual((await extension.layout()).slice(0, await extension.dividerIndex()), pinnedBefore);
});

test('cmd+e on a tab below the divider pins it at the bottom of the pinned section', async () => {
  const id = await extension.open(site.url('to-pin'));
  await press(id, 'e');

  const tab = await tabById(id);
  assert.equal(tab.index, (await extension.dividerIndex()) - 1);
  assert.equal(tab.groupId, -1);
});

test('cmd+e on a tab in a pinned group unpins it to just below the divider', async () => {
  const [a] = await pinnedGroup('Unpin');
  await press(a, 'e');

  const tab = await tabById(a);
  assert.equal(tab.index, (await extension.dividerIndex()) + 1);
  assert.equal(tab.groupId, -1);
});

test('cmd+e on a native pinned tab unpins it to just below the divider', async () => {
  const id = await extension.open(site.url('native'), { pinned: true });
  await extension.settle();
  await press(id, 'e');

  const tab = await tabById(id);
  assert.equal(tab.pinned, false);
  assert.equal(tab.index, (await extension.dividerIndex()) + 1);
});

test('a tab unpinned with cmd+e closes for real', async () => {
  const id = await extension.open(site.url('unpin-then-close'));
  await extension.moveAboveDivider(id);
  await press(id, 'e');

  await extension.close([id]);
  await extension.settle(1_000);
  assert.equal((await extension.tabs()).some((tab) => tab.url === site.url('unpin-then-close')), false);
});

test('cmd+backspace closes a pinned tab without bringing it back', async () => {
  const [a] = await pinnedGroup('Remove');
  await press(a, 'Backspace');

  await extension.settle(1_000);
  assert.equal((await extension.tabs()).some((tab) => tab.url === site.url('Remove-a')), false);
  assert.equal((await extension.tabs()).some((tab) => tab.url === site.url('Remove-b')), true);
});

test('cmd+backspace closes a native pinned tab without bringing it back', async () => {
  const id = await extension.open(site.url('native-remove'), { pinned: true });
  await extension.settle();
  await press(id, 'Backspace');

  await extension.settle(1_000);
  assert.equal((await extension.tabs()).some((tab) => tab.url === site.url('native-remove')), false);
});

test('cmd+backspace leaves tabs below the divider open', async () => {
  const id = await extension.open(site.url('loose'));
  await press(id, 'Backspace');

  await extension.settle(1_000);
  assert.ok(await tabById(id));
});

test('cmd+backspace while typing in a pinned tab edits the text instead of closing the tab', async () => {
  const id = await extension.open(site.url('typing'));
  await extension.moveAboveDivider(id);
  const page = await extension.pageFor(id);
  await page.evaluate(() => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
  });
  await press(id, 'Backspace');

  await extension.settle(1_000);
  assert.ok(await tabById(id));
  assert.equal(await isPinned(id), true);
});
