import { loadState, saveState } from './state.js';

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
