import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

export const EXTENSION_PATH = path.resolve(import.meta.dirname, '..');
const SESSION_HELPER_PATH = path.resolve(import.meta.dirname, 'session-helper');

export function startSite() {
  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://x');
    const name = pathname.slice(1) || 'home';
    response.setHeader('content-type', 'text/html');
    response.end(`<!doctype html><title>${name}</title>
      <a id="link" href="/${name}-child">child</a>
      <a id="blank" target="_blank" href="/${name}-blank">blank</a>`);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ origin, url: (name) => `${origin}/${name}`, close: () => server.close() });
    });
  });
}

export async function launch({ userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabkeep-')), args = [] } = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [EXTENSION_PATH, SESSION_HELPER_PATH],
    userDataDir,
    args,
  });
  const extension = new ExtensionDriver(browser);
  await extension.attach();
  await extension.waitFor(async () => (await extension.tabs()).some((tab) => tab.isDivider));
  return { browser, extension, userDataDir };
}

class ExtensionDriver {
  constructor(browser) {
    this.browser = browser;
  }

  async attach() {
    const stale = this.target;
    this.target = await this.browser.waitForTarget(
      (candidate) =>
        candidate !== stale && candidate.type() === 'service_worker' && candidate.url().endsWith('/src/background.js'),
    );
    this.worker = await this.target.worker();
  }

  async restoreLastClosed() {
    const target = await this.browser.waitForTarget((candidate) => candidate.url().endsWith('/helper.js'));
    const helper = await target.worker();
    await helper.evaluate(() => self.restoreLastClosed());
  }

  async run(fn, ...args) {
    try {
      return await this.worker.evaluate(fn, ...args);
    } catch (error) {
      if (!/Target closed|Session closed|detached/.test(error.message)) throw error;
      await this.attach();
      return this.worker.evaluate(fn, ...args);
    }
  }

  tabs(windowId) {
    return this.run(async (windowId) => {
      const query = windowId ? { windowId } : { lastFocusedWindow: true };
      const tabs = await chrome.tabs.query(query);
      const groups = new Map((await chrome.tabGroups.query({})).map((group) => [group.id, group]));
      return tabs.map((tab) => ({
        id: tab.id,
        index: tab.index,
        url: tab.pendingUrl || tab.url,
        pinned: tab.pinned,
        active: tab.active,
        discarded: tab.discarded,
        groupId: tab.groupId,
        groupTitle: groups.get(tab.groupId)?.title,
        groupColor: groups.get(tab.groupId)?.color,
        isDivider: new URL(tab.pendingUrl || tab.url || 'about:blank').pathname === '/divider.html',
      }));
    }, windowId);
  }

  async layout(windowId) {
    const tabs = await this.tabs(windowId);
    return tabs.map((tab) => (tab.isDivider ? '---' : `${tab.pinned ? '📌' : ''}${tab.groupTitle ? `[${tab.groupTitle}]` : ''}${new URL(tab.url).pathname}`));
  }

  async open(url, { pinned = false } = {}) {
    const id = await this.run(async (url, pinned) => (await chrome.tabs.create({ url, pinned, active: false })).id, url, pinned);
    await this.waitFor(async () => (await this.tabs()).find((tab) => tab.id === id)?.url === url);
    return id;
  }

  async pageFor(tabId) {
    const { url } = (await this.tabs()).find((tab) => tab.id === tabId);
    await this.run((tabId) => chrome.tabs.update(tabId, { active: true }), tabId);
    const pages = await this.browser.pages();
    const page = pages.find((candidate) => candidate.url() === url);
    await page.bringToFront();
    return page;
  }

  async dividerIndex() {
    return (await this.tabs()).find((tab) => tab.isDivider).index;
  }

  async moveAboveDivider(tabId) {
    const index = await this.dividerIndex();
    await this.run((tabId, index) => chrome.tabs.move(tabId, { index }), tabId, index);
    await this.settle();
  }

  async group(tabIds, title) {
    const groupId = await this.run(
      async (tabIds, title) => {
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, { title, color: 'purple' });
        return groupId;
      },
      tabIds,
      title,
    );
    await this.settle();
    return groupId;
  }

  async moveGroup(groupId, index) {
    await this.run((groupId, index) => chrome.tabGroups.move(groupId, { index }), groupId, index);
    await this.settle();
  }

  async close(tabIds) {
    await this.run((tabIds) => chrome.tabs.remove(tabIds), tabIds);
    await this.settle();
  }

  async command(name, tabId) {
    if (tabId !== undefined) await this.run((tabId) => chrome.tabs.update(tabId, { active: true }), tabId);
    await this.run((name) => self.runCommand(name), name);
    await this.settle();
  }

  settle(ms = 600) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async waitFor(condition, { timeout = 8_000, message = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      last = await condition().catch((error) => error);
      if (last && !(last instanceof Error)) return last;
      await this.settle(100);
    }
    throw new Error(`Timed out waiting for ${message}${last instanceof Error ? `: ${last.message}` : ''}`);
  }
}
