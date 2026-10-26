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

const tabAt = async (index) => (await extension.tabs()).find((tab) => tab.index === index);

test('a divider tab is created right after the native pinned tabs', async () => {
  const tabs = await extension.tabs();
  const divider = tabs.find((tab) => tab.isDivider);
  assert.equal(divider.index, tabs.filter((tab) => tab.pinned).length);
  assert.equal(tabs.filter((tab) => tab.isDivider).length, 1);
});

test('closing a tab dragged above the divider brings it back asleep at the same spot with its pinned URL', async () => {
  const id = await extension.open(site.url('docs'));
  await extension.moveAboveDivider(id);
  const { index } = (await extension.tabs()).find((tab) => tab.id === id);

  await extension.run((id, url) => chrome.tabs.update(id, { url }), id, site.url('docs-wandered'));
  await extension.waitFor(async () => (await extension.tabs()).find((tab) => tab.id === id).url.endsWith('wandered'));
  await extension.close([id]);

  const revived = await extension.waitFor(async () => {
    const tab = await tabAt(index);
    return tab && tab.id !== id && !tab.isDivider && tab;
  });
  assert.equal(revived.url, site.url('docs'));
  const asleep = await extension.waitFor(async () => {
    const tab = (await extension.tabs()).find((candidate) => candidate.id === revived.id);
    return tab?.discarded && tab;
  }, { message: 'revived tab to fall asleep' });
  assert.equal(asleep.discarded, true);
  assert.equal(revived.index < (await extension.dividerIndex()), true);
});

test('closing a native pinned tab brings it back pinned in the compact row', async () => {
  const id = await extension.open(site.url('mail'), { pinned: true });
  await extension.settle();
  const { index } = (await extension.tabs()).find((tab) => tab.id === id);
  await extension.close([id]);

  const revived = await extension.waitFor(async () => {
    const tab = await tabAt(index);
    return tab?.pinned && tab.id !== id && tab;
  });
  assert.equal(revived.url, site.url('mail'));
});

test('a group dragged above the divider keeps each closed tab in the group at its position', async () => {
  const a = await extension.open(site.url('dns'));
  const b = await extension.open(site.url('deploys'));
  const c = await extension.open(site.url('analytics'));
  const groupId = await extension.group([a, b, c], 'Ask');
  await extension.moveGroup(groupId, await extension.dividerIndex());
  const before = await extension.layout();

  await extension.close([b]);
  await extension.waitFor(async () => JSON.stringify(await extension.layout()) === JSON.stringify(before), {
    message: `layout ${JSON.stringify(before)}`,
  });
});

test('closing every tab of a pinned group recreates the group with its title, color and order', async () => {
  const a = await extension.open(site.url('syllabus'));
  const b = await extension.open(site.url('notes'));
  const groupId = await extension.group([a, b], 'Curricula');
  await extension.moveGroup(groupId, await extension.dividerIndex());
  const before = await extension.layout();

  await extension.close([a, b]);
  await extension.waitFor(async () => JSON.stringify(await extension.layout()) === JSON.stringify(before), {
    message: `layout ${JSON.stringify(before)}`,
  });
  const revived = (await extension.tabs()).filter((tab) => tab.groupTitle === 'Curricula');
  assert.equal(revived.length, 2);
  assert.equal(revived[0].groupColor, 'purple');
});

test('a group dragged back below the divider closes for real', async () => {
  const a = await extension.open(site.url('scratch'));
  const groupId = await extension.group([a], 'Scratch');
  await extension.moveGroup(groupId, await extension.dividerIndex());
  const tabs = await extension.tabs();
  await extension.moveGroup(groupId, tabs.length - 1);
  assert.equal((await extension.tabs()).find((tab) => tab.id === a).index > (await extension.dividerIndex()), true);

  await extension.close([a]);
  await extension.settle(1_000);
  assert.equal((await extension.tabs()).some((tab) => tab.url === site.url('scratch')), false);
});

test('a tab outside the pinned section closes normally', async () => {
  const id = await extension.open(site.url('ephemeral'));
  await extension.close([id]);
  await extension.settle(1_000);
  assert.equal((await extension.tabs()).some((tab) => tab.url === site.url('ephemeral')), false);
});

test('the divider comes back when closed', async () => {
  const divider = (await extension.tabs()).find((tab) => tab.isDivider);
  await extension.close([divider.id]);
  const replacement = await extension.waitFor(async () => (await extension.tabs()).find((tab) => tab.isDivider));
  assert.equal(replacement.index, divider.index);
});

test('activating the divider skips to the neighbouring tab', async () => {
  const divider = (await extension.tabs()).find((tab) => tab.isDivider);
  await extension.run((id) => chrome.tabs.update(id, { active: true }), divider.id);
  const active = await extension.waitFor(async () => {
    const tab = (await extension.tabs()).find((candidate) => candidate.active);
    return !tab.isDivider && tab;
  });
  assert.equal(Math.abs(active.index - divider.index), 1);
});

test('closing a window does not resurrect its pinned tabs anywhere', async () => {
  const windowId = await extension.run(async (url) => (await chrome.windows.create({ url })).id, site.url('other-window'));
  await extension.waitFor(async () => (await extension.tabs(windowId)).some((tab) => tab.isDivider));
  const [tab] = (await extension.tabs(windowId)).filter((candidate) => !candidate.isDivider);
  const dividerIndex = (await extension.tabs(windowId)).find((candidate) => candidate.isDivider).index;
  await extension.run((id, index) => chrome.tabs.move(id, { index }), tab.id, dividerIndex);
  await extension.settle();
  const countBefore = await extension.run(async () => (await chrome.tabs.query({})).length);

  await extension.run((windowId) => chrome.windows.remove(windowId), windowId);
  await extension.settle(1_000);
  const countAfter = await extension.run(async () => (await chrome.tabs.query({})).length);
  assert.equal(countAfter, countBefore - 2);
});

test('closing the active pinned tab switches to the most recently used tab, not a neighbour', async () => {
  const recent = await extension.open(site.url('recent'));
  const pinned = await extension.open(site.url('cmd-w-pinned'));
  await extension.moveAboveDivider(pinned);
  await extension.run((id) => chrome.tabs.update(id, { active: true }), recent);
  await extension.settle();
  await extension.run((id) => chrome.tabs.update(id, { active: true }), pinned);
  await extension.settle();

  await extension.close([pinned]);
  const active = await extension.waitFor(async () => {
    const tab = (await extension.tabs()).find((candidate) => candidate.active);
    return tab?.id === recent && tab;
  }, { message: 'most recent tab to become active' });
  assert.equal(active.url, site.url('recent'));
  const revived = (await extension.tabs()).find((tab) => tab.url === site.url('cmd-w-pinned'));
  assert.equal(revived.active, false);
});

test('closing the active pinned tab leaves a sleeping pinned neighbour asleep', async () => {
  const recent = await extension.open(site.url('neighbour-recent'));
  const closing = await extension.open(site.url('neighbour-closing'));
  const sleeper = await extension.open(site.url('neighbour-sleeper'));
  await extension.moveAboveDivider(closing);
  await extension.moveAboveDivider(sleeper);
  await extension.run((id) => chrome.tabs.update(id, { active: true }), recent);
  await extension.settle();
  await extension.run((id) => chrome.tabs.discard(id), sleeper);
  await extension.run((id) => chrome.tabs.update(id, { active: true }), closing);
  await extension.settle();

  await extension.close([closing]);
  await extension.settle(2_000);
  const tabs = await extension.tabs();
  assert.equal(tabs.find((tab) => tab.active).id, recent);
  assert.equal(tabs.find((tab) => tab.id === sleeper).discarded, true);
});
