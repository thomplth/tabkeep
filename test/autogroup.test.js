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

async function clickLink(tabId, selector, { modifier } = {}) {
  const page = await extension.pageFor(tabId);
  if (modifier) await page.keyboard.down(modifier);
  await page.click(selector);
  if (modifier) await page.keyboard.up(modifier);
}

const findTab = async (url) => (await extension.tabs()).find((tab) => tab.url === url);
const waitForTab = (url) => extension.waitFor(() => findTab(url), { message: url });

test('cmd+clicking a link in a loose tab groups both tabs and names the group', async () => {
  const source = await extension.open(site.url('research'));
  await clickLink(source, '#link', { modifier: 'Meta' });
  const child = await waitForTab(site.url('research-child'));

  const grouped = await extension.waitFor(async () => {
    const tabs = await extension.tabs();
    const [a, b] = [tabs.find((tab) => tab.id === source), tabs.find((tab) => tab.id === child.id)];
    return a.groupId !== -1 && a.groupId === b.groupId && a.groupTitle && a;
  });
  assert.ok(grouped.groupTitle.length > 0);
});

test('cmd+clicking a link inside a group adds the new tab to that group', async () => {
  const source = await extension.open(site.url('engine'));
  const groupId = await extension.group([source], 'Engine');
  await clickLink(source, '#link', { modifier: 'Meta' });

  const child = await extension.waitFor(async () => {
    const tab = await findTab(site.url('engine-child'));
    return tab?.groupId === groupId && tab;
  });
  assert.equal(child.groupTitle, 'Engine');
});

test('cmd+clicking a link in a pinned tab opens it as a loose tab below the divider', async () => {
  const source = await extension.open(site.url('kanban'));
  const groupId = await extension.group([source], 'Ask');
  await extension.moveGroup(groupId, await extension.dividerIndex());
  const pinnedBefore = (await extension.layout()).slice(0, await extension.dividerIndex());

  await clickLink(source, '#link', { modifier: 'Meta' });
  await waitForTab(site.url('kanban-child'));
  await extension.settle(1_500);

  const child = await findTab(site.url('kanban-child'));
  assert.equal(child.groupId, -1);
  assert.ok(child.index > (await extension.dividerIndex()));
  assert.deepEqual((await extension.layout()).slice(0, await extension.dividerIndex()), pinnedBefore);
});

test('a plain click on a target=_blank link is left ungrouped by default', async () => {
  const source = await extension.open(site.url('reading'));
  await clickLink(source, '#blank');
  await waitForTab(site.url('reading-blank'));
  await extension.settle(1_500);

  assert.equal((await findTab(site.url('reading-blank'))).groupId, -1);
  assert.equal((await findTab(site.url('reading'))).groupId, -1);
});

test('the group-all-links option also groups plain target=_blank clicks', async () => {
  await extension.run(() => chrome.storage.local.set({ groupAllLinks: true }));
  const source = await extension.open(site.url('papers'));
  await clickLink(source, '#blank');

  await extension.waitFor(async () => {
    const [a, b] = [await findTab(site.url('papers')), await findTab(site.url('papers-blank'))];
    return b && a.groupId !== -1 && a.groupId === b.groupId;
  });
  await extension.run(() => chrome.storage.local.remove('groupAllLinks'));
});
