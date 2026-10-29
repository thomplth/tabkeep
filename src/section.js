import { loadState, saveState } from './state.js';
import { serial } from './serial.js';
import { activateMostRecent, forgetTab, mostRecentTabId, touchTab } from './mru.js';

const DIVIDER_BASE_URL = chrome.runtime.getURL('divider.html');
const SETTLE_QUIET_MS = 1_000;
const SETTLE_MAX_MS = 15_000;
const LOAD_WAIT_MS = 10_000;
const LAYOUT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const CLOSE_ACTIVATION_WINDOW_MS = 1_000;

const expectedRemovals = new Set();
const selfCreatedTabs = new Set();
const lastRemovalAt = new Map();
const asleepTabs = new Set();
const pendingDiscards = new Map();
const wokenAt = new Map();
chrome.tabs.query({ discarded: true }).then((tabs) => tabs.forEach((tab) => asleepTabs.add(tab.id)));
const replacedGroups = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const urlOf = (tab) => tab.pendingUrl || tab.url || '';
export const isDivider = (tab) => urlOf(tab).split('#')[0] === DIVIDER_BASE_URL;
const layoutIdOf = (divider) => new URL(urlOf(divider)).hash.slice(1);

export async function prepareAllWindows() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  await Promise.all(windows.map((window) => prepareWindow(window.id)));
}

// Chrome restores a window's tabs and groups over several hundred milliseconds; inserting or
// removing tabs mid-restore makes Chrome drop tabs from restored groups.
export async function prepareWindow(windowId) {
  if (await waitForWindowToSettle(windowId)) await serial(() => ensureDivider(windowId));
}

async function waitForWindowToSettle(windowId) {
  const deadline = Date.now() + SETTLE_MAX_MS;
  let lastCount = -1;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    const window = await chrome.windows.get(windowId, { populate: true }).catch(() => null);
    if (window?.type !== 'normal') return false;
    if (window.tabs.length !== lastCount) {
      lastCount = window.tabs.length;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= SETTLE_QUIET_MS) {
      return true;
    }
    await sleep(200);
  }
  return true;
}

async function ensureDivider(windowId) {
  const tabs = await chrome.tabs.query({ windowId }).catch(() => null);
  if (!tabs) return;
  const [keep, ...extras] = tabs.filter(isDivider).sort((a, b) => b.index - a.index);
  for (const extra of extras) {
    expectedRemovals.add(extra.id);
    await chrome.tabs.remove(extra.id);
  }
  let divider = keep ?? (await createDivider(windowId, tabs));
  if (!layoutIdOf(divider)) {
    divider = await chrome.tabs.update(divider.id, { url: `${DIVIDER_BASE_URL}#${crypto.randomUUID()}` });
  }

  const state = await loadState();
  if (!state.readyWindows[windowId]) {
    await seedHomes(windowId, divider);
    state.readyWindows[windowId] = true;
    await saveState();
  }
  await refresh(windowId);
}

async function createDivider(windowId, tabs) {
  const match = await matchSavedLayout(tabs);
  const index = match
    ? Math.min(match.layout.homes.length, tabs.length)
    : tabs.filter((tab) => tab.pinned).length;
  const layoutId = match?.layoutId ?? crypto.randomUUID();
  return chrome.tabs.create({ windowId, index, url: `${DIVIDER_BASE_URL}#${layoutId}`, active: false });
}

async function matchSavedLayout(tabs) {
  const allTabs = await chrome.tabs.query({});
  const claimed = new Set(allTabs.filter(isDivider).map(layoutIdOf));
  let best = null;
  for (const [layoutId, layout] of Object.entries(await loadLayouts())) {
    if (claimed.has(layoutId)) continue;
    const score = layout.homes.filter((home, index) => tabs[index] && urlOf(tabs[index]) === home).length;
    if (score > 0 && (!best || score > best.score || (score === best.score && layout.savedAt > best.layout.savedAt))) {
      best = { layoutId, layout, score };
    }
  }
  return best;
}

async function seedHomes(windowId, divider) {
  const layout = (await loadLayouts())[layoutIdOf(divider)];
  if (!layout) return;
  const { index: dividerIndex } = await chrome.tabs.get(divider.id);
  const sectionTabs = (await chrome.tabs.query({ windowId })).filter((tab) => tab.index < dividerIndex);

  const unclaimed = [...layout.homes];
  const homes = new Map();
  for (const tab of sectionTabs) {
    const exact = unclaimed.indexOf(urlOf(tab));
    if (exact === -1) continue;
    homes.set(tab.id, unclaimed[exact]);
    unclaimed[exact] = null;
  }
  const remaining = unclaimed.filter(Boolean);
  for (const tab of sectionTabs) {
    if (!homes.has(tab.id) && remaining.length > 0) homes.set(tab.id, remaining.shift());
  }

  const state = await loadState();
  for (const [tabId, home] of homes) state.homes[tabId] = home;
  await saveState();
}

async function loadLayouts() {
  return (await chrome.storage.local.get('layouts')).layouts ?? {};
}

async function saveLayout(layoutId, homes) {
  const layouts = await loadLayouts();
  const now = Date.now();
  for (const [id, layout] of Object.entries(layouts)) {
    if (now - layout.savedAt > LAYOUT_RETENTION_MS) delete layouts[id];
  }
  layouts[layoutId] = { homes, savedAt: now };
  await chrome.storage.local.set({ layouts });
}

export async function refresh(windowId) {
  const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
  const divider = tabs.find(isDivider);
  if (!divider) return;
  if (divider.pinned) return chrome.tabs.update(divider.id, { pinned: false });
  if (divider.groupId !== -1) return chrome.tabs.ungroup(divider.id);

  const groups = new Map((await chrome.tabGroups.query({ windowId })).map((group) => [group.id, group]));
  const state = await loadState();
  const ready = state.readyWindows[windowId];
  const sectionHomes = [];

  for (const tab of tabs) {
    const group = groups.get(tab.groupId);
    const inSection = tab.index < divider.index;
    state.known[tab.id] = {
      windowId,
      index: tab.index,
      url: urlOf(tab),
      pinned: tab.pinned,
      groupId: tab.groupId,
      group: group && { title: group.title, color: group.color, collapsed: group.collapsed },
      inSection,
      isDivider: tab.id === divider.id,
    };
    if (!ready) continue;
    if (!inSection) {
      delete state.homes[tab.id];
      continue;
    }
    state.homes[tab.id] ||= urlOf(tab) || undefined;
    sectionHomes.push(state.homes[tab.id] ?? '');
  }

  await saveState();
  if (ready) await saveLayout(layoutIdOf(divider), sectionHomes);
}

export async function isInSection(tabId) {
  return (await loadState()).known[tabId]?.inSection ?? false;
}

// Chrome inserts tabs opened from a pinned tab next to it, often inside its group, and reports the
// most recently opened tab rather than the pinned tab as their opener.
export async function handleCreated(tab) {
  const state = await loadState();
  const ownTab = selfCreatedTabs.delete(tab.id) || isDivider(tab);
  if (state.readyWindows[tab.windowId] && !ownTab) await moveBelowDivider(tab.id);
  await refresh(tab.windowId);
}

const dividerIndexIn = async (windowId) => (await chrome.tabs.query({ windowId })).find(isDivider)?.index;

export async function moveBelowDivider(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.pinned) return;
  if (!(tab.index < (await dividerIndexIn(tab.windowId)))) return;

  if (tab.groupId !== -1) await chrome.tabs.ungroup(tabId);
  const { index } = await chrome.tabs.get(tabId);
  const divider = await dividerIndexIn(tab.windowId);
  await chrome.tabs.move(tabId, { index: index < divider ? divider : divider + 1 });
}

async function moveAboveDivider(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.groupId !== -1) await chrome.tabs.ungroup(tabId);
  await chrome.tabs.move(tabId, { index: await dividerIndexIn(tab.windowId) });
}

async function sectionTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || isDivider(tab)) return null;
  const dividerIndex = await dividerIndexIn(tab.windowId);
  if (dividerIndex === undefined) return null;
  return { tab, inSection: tab.pinned || tab.index < dividerIndex };
}

export async function togglePinned(tabId) {
  const found = await sectionTab(tabId);
  if (!found) return;
  const { tab, inSection } = found;
  if (!inSection) return moveAboveDivider(tabId);
  if (tab.pinned) await chrome.tabs.update(tabId, { pinned: false });
  await moveBelowDivider(tabId);
}

export async function removePinned(tabId) {
  const found = await sectionTab(tabId);
  if (!found?.inSection) return;
  if (found.tab.active) {
    await forgetTab(tabId);
    await activateMostRecent(found.tab.windowId);
  }
  expectedRemovals.add(tabId);
  await chrome.tabs.remove(tabId);
}

export async function handleRemoved(tabId, { windowId, isWindowClosing }, removedAt) {
  lastRemovalAt.set(windowId, removedAt);
  const state = await loadState();
  const info = state.known[tabId];
  const home = state.homes[tabId];
  const wasActive = (await mostRecentTabId(windowId)) === tabId;
  delete state.known[tabId];
  delete state.homes[tabId];
  await saveState();
  await forgetTab(tabId);

  if (isWindowClosing) delete state.readyWindows[windowId];
  if (expectedRemovals.delete(tabId) || isWindowClosing || !info) return;
  if (info.isDivider) {
    await chrome.tabs.create({ windowId, index: info.index, url: info.url, active: false });
  } else if (info.inSection && home) {
    await resurrect(info, home);
    if (wasActive) await activateMostRecent(windowId);
  }
  await closeWindowIfOnlyDividerLeft(windowId);
  await refresh(windowId);
}

async function resurrect(info, home) {
  const tab = await chrome.tabs.create({
    windowId: info.windowId,
    index: info.index,
    url: home,
    active: false,
    pinned: info.pinned,
  });
  selfCreatedTabs.add(tab.id);
  discardWhenLoaded(tab.id, { waitForTitle: true });
  const state = await loadState();
  state.homes[tab.id] = home;
  await saveState();

  if (info.groupId !== -1) await rejoinGroup(tab.id, info);
}

// A discarded tab keeps the title and favicon it had at discard time, so a fresh tab is discarded
// only once its page has both finished loading and reported a title; either can arrive first.
// Polled tab snapshots are no substitute: a fresh tab briefly reports status "complete" for its
// initial empty document.
function discardWhenLoaded(tabId, { waitForTitle = false } = {}) {
  clearTimeout(pendingDiscards.get(tabId)?.timer);
  pendingDiscards.set(tabId, {
    timer: setTimeout(() => discardPending(tabId), LOAD_WAIT_MS),
    loaded: false,
    titled: !waitForTitle,
  });
}

export function noteLoadProgress(tabId, change) {
  const pending = pendingDiscards.get(tabId);
  if (!pending) return;
  if (change.status === 'complete') pending.loaded = true;
  if ('title' in change) pending.titled = true;
  if (pending.loaded && pending.titled) discardPending(tabId);
}

async function discardPending(tabId) {
  clearTimeout(pendingDiscards.get(tabId)?.timer);
  pendingDiscards.delete(tabId);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && !tab.active && !tab.discarded && tab.url && !tab.pendingUrl) {
    await chrome.tabs.discard(tabId).catch(() => {});
  }
}

async function rejoinGroup(tabId, info) {
  for (const candidate of [info.groupId, replacedGroups.get(info.groupId)]) {
    if (candidate !== undefined && (await chrome.tabGroups.get(candidate).catch(() => null))) {
      await chrome.tabs.group({ groupId: candidate, tabIds: [tabId] });
      return;
    }
  }
  const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: info.windowId } });
  await chrome.tabGroups.update(groupId, info.group ?? {});
  replacedGroups.set(info.groupId, groupId);
}

async function closeWindowIfOnlyDividerLeft(windowId) {
  const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
  if (tabs.length === 1 && isDivider(tabs[0])) {
    expectedRemovals.add(tabs[0].id);
    await chrome.tabs.remove(tabs[0].id);
  }
}

export async function handleReplaced(addedTabId, removedTabId) {
  const state = await loadState();
  for (const map of [state.known, state.homes]) {
    if (removedTabId in map) map[addedTabId] = map[removedTabId];
    delete map[removedTabId];
  }
  await saveState();
}

export function noteDiscarded(tabId, discarded, changedAt) {
  if (discarded) {
    asleepTabs.add(tabId);
  } else if (asleepTabs.delete(tabId)) {
    wokenAt.set(tabId, changedAt);
  }
}

export async function handleActivated({ tabId, windowId }, activatedAt) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const closedJustNow = activatedAt - (lastRemovalAt.get(windowId) ?? 0) < CLOSE_ACTIVATION_WINDOW_MS;
  // Chrome briefly focuses the next row when a tab closes, which starts reloading a sleeping pinned
  // tab there even though focus has already been redirected to the most recent tab. Chrome reports
  // that reload before it reports the close, hence the recent-wake window.
  const wasAsleep = asleepTabs.has(tabId) || activatedAt - (wokenAt.get(tabId) ?? 0) < CLOSE_ACTIVATION_WINDOW_MS;
  if (!tab.active && closedJustNow && wasAsleep) {
    if (tab.status === 'complete') await discardPending(tabId);
    else discardWhenLoaded(tabId);
    return;
  }
  if (!tab.active) return;
  if (!isDivider(tab)) return touchTab(windowId, tabId);
  // When that next row is the divider, stepping to its neighbour would wake the pinned tab that was
  // just revived in the closed tab's slot.
  if (closedJustNow) return activateMostRecent(windowId);

  const tabs = await chrome.tabs.query({ windowId });
  const previousId = await mostRecentTabId(windowId);
  const previous = tabs.find((candidate) => candidate.id === previousId);
  const movingDown = !previous || previous.index < tab.index;
  const next = movingDown ? (tabs[tab.index + 1] ?? tabs[tab.index - 1]) : (tabs[tab.index - 1] ?? tabs[tab.index + 1]);
  if (next) await chrome.tabs.update(next.id, { active: true });
}

export async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

export async function resetActiveTabToHome() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const home = tab && (await loadState()).homes[tab.id];
  if (home) await chrome.tabs.update(tab.id, { url: home });
}
