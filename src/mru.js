import { loadState, saveState } from './state.js';

const DIRECT_SWITCH_IDLE_MS = 1_200;
const OVERLAY_SESSION_MAX_MS = 30_000;
const SWITCHER_LIMIT = 12;

let session = null;

export async function touchTab(windowId, tabId) {
  const state = await loadState();
  const order = await orderFor(windowId);
  state.mru[windowId] = [tabId, ...order.filter((id) => id !== tabId)];
  await saveState();
}

export async function forgetTab(tabId) {
  const state = await loadState();
  for (const windowId of Object.keys(state.mru)) {
    state.mru[windowId] = state.mru[windowId].filter((id) => id !== tabId);
  }
  await saveState();
}

export async function replaceTab(addedTabId, removedTabId) {
  const state = await loadState();
  for (const windowId of Object.keys(state.mru)) {
    state.mru[windowId] = state.mru[windowId].map((id) => (id === removedTabId ? addedTabId : id));
  }
  await saveState();
}

export async function mostRecentTabId(windowId) {
  return (await orderFor(windowId))[0];
}

export async function activateMostRecent(windowId) {
  const [tab] = await liveTabs(windowId);
  if (tab) await chrome.tabs.update(tab.id, { active: true });
}

async function orderFor(windowId) {
  const state = await loadState();
  state.mru[windowId] ??= await seedFromLastAccessed(windowId);
  return state.mru[windowId];
}

async function seedFromLastAccessed(windowId) {
  const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
  return tabs
    .filter((tab) => !tab.url?.startsWith(chrome.runtime.getURL('')) && !tab.discarded)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .map((tab) => tab.id);
}

async function liveTabs(windowId) {
  const tabs = new Map((await chrome.tabs.query({ windowId })).map((tab) => [tab.id, tab]));
  return (await orderFor(windowId)).map((id) => tabs.get(id)).filter(Boolean);
}

const summarize = (tab) => ({ id: tab.id, title: tab.title || tab.url, url: tab.url, favIconUrl: tab.favIconUrl });

export async function stepSwitcher(direction) {
  const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (!window) return;
  const now = Date.now();
  const expired =
    !session ||
    session.windowId !== window.id ||
    now - session.steppedAt > (session.overlay ? OVERLAY_SESSION_MAX_MS : DIRECT_SWITCH_IDLE_MS);
  if (expired) {
    const tabs = (await liveTabs(window.id)).slice(0, SWITCHER_LIMIT);
    if (tabs.length < 2) return;
    session = { windowId: window.id, items: tabs.map(summarize), selected: 0, overlay: false };
  }
  session.steppedAt = now;
  const count = session.items.length;
  session.selected = (session.selected + (direction === 'older' ? 1 : -1) + count) % count;

  const [active] = await chrome.tabs.query({ active: true, windowId: window.id });
  session.overlay = await chrome.tabs
    .sendMessage(active.id, { type: 'switcher-show', items: session.items, selected: session.selected }, { frameId: 0 })
    .then(Boolean, () => false);
  if (!session.overlay) await chrome.tabs.update(session.items[session.selected].id, { active: true });
}

export async function commitSwitcher(tabId) {
  session = null;
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
}

export function cancelSwitcher() {
  session = null;
}
