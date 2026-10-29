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

test('a target=_blank link from a pinned tab lands below the divider instead of joining the pinned group', async () => {
  const [, source] = await pinnedGroup('Blank');
  const pinnedBefore = (await extension.layout()).slice(0, await extension.dividerIndex());
  const page = await extension.pageFor(source);

  await page.click('#blank');
  await extension.waitFor(async () => (await extension.tabs()).some((tab) => tab.url === site.url('Blank-b-blank')));
  await extension.settle(1_000);

  assert.deepEqual((await extension.layout()).slice(0, await extension.dividerIndex()), pinnedBefore);
});

test('the pin shortcut on a tab below the divider pins it at the bottom of the pinned section', async () => {
  const id = await extension.open(site.url('to-pin'));
  await extension.command('toggle-pinned', id);

  const tab = await tabById(id);
  assert.equal(tab.index, (await extension.dividerIndex()) - 1);
  assert.equal(tab.groupId, -1);
});

test('the pin shortcut on a tab in a pinned group unpins it to just below the divider', async () => {
  const [a] = await pinnedGroup('Unpin');
  await extension.command('toggle-pinned', a);

  const tab = await tabById(a);
  assert.equal(tab.index, (await extension.dividerIndex()) + 1);
  assert.equal(tab.groupId, -1);
});

test('the pin shortcut on a native pinned tab unpins it to just below the divider', async () => {
  const id = await extension.open(site.url('native'), { pinned: true });
  await extension.settle();
  await extension.command('toggle-pinned', id);

  const tab = await tabById(id);
  assert.equal(tab.pinned, false);
  assert.equal(tab.index, (await extension.dividerIndex()) + 1);
});

test('a tab unpinned with the pin shortcut closes for real', async () => {
  const id = await extension.open(site.url('unpin-then-close'));
  await extension.moveAboveDivider(id);
  await extension.command('toggle-pinned', id);

  await extension.close([id]);
  await extension.settle(1_000);
  assert.equal((await extension.tabs()).some((tab) => tab.url === site.url('unpin-then-close')), false);
});

test('the remove shortcut closes a pinned tab without bringing it back', async () => {
  const [a] = await pinnedGroup('Remove');
  await extension.command('remove-pinned', a);

  await extension.settle(1_000);
  assert.equal((await extension.tabs()).some((tab) => tab.url === site.url('Remove-a')), false);
  assert.equal((await extension.tabs()).some((tab) => tab.url === site.url('Remove-b')), true);
});

test('the remove shortcut closes a native pinned tab without bringing it back', async () => {
  const id = await extension.open(site.url('native-remove'), { pinned: true });
  await extension.settle();
  await extension.command('remove-pinned', id);

  await extension.settle(1_000);
  assert.equal((await extension.tabs()).some((tab) => tab.url === site.url('native-remove')), false);
});

test('the remove shortcut leaves tabs below the divider open', async () => {
  const id = await extension.open(site.url('loose'));
  await extension.command('remove-pinned', id);

  await extension.settle(1_000);
  assert.ok(await tabById(id));
});
