import { serial } from './serial.js';
import { isInSection, moveBelowDivider } from './section.js';
import { heuristicName, suggestGroupName } from './namer.js';

const CLICK_MATCH_WINDOW_MS = 3_000;
const LATE_CLICK_GRACE_MS = 300;
const LOAD_WAIT_MS = 5_000;

const modifierClicks = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getTab = (tabId) => chrome.tabs.get(tabId).catch(() => null);

export function recordModifierClick(sourceTabId) {
  modifierClicks.set(sourceTabId, Date.now());
}

async function consumeModifierClick(sourceTabId) {
  for (const delay of [0, LATE_CLICK_GRACE_MS]) {
    await sleep(delay);
    const clickedAt = modifierClicks.get(sourceTabId);
    if (clickedAt && Date.now() - clickedAt < CLICK_MATCH_WINDOW_MS) {
      modifierClicks.delete(sourceTabId);
      return true;
    }
  }
  return false;
}

export async function handleNavigationTarget({ sourceTabId, tabId }) {
  const { groupAllLinks } = await chrome.storage.local.get('groupAllLinks');
  if (!groupAllLinks && !(await consumeModifierClick(sourceTabId))) return;

  const created = await serial(() => groupWithSource(sourceTabId, tabId));
  if (created) await nameWhenLoaded(created);
}

async function groupWithSource(sourceTabId, tabId) {
  const [source, target] = await Promise.all([getTab(sourceTabId), getTab(tabId)]);
  if (!source || !target || source.windowId !== target.windowId) return null;

  let groupId;
  if (await isInSection(sourceTabId)) {
    await moveBelowDivider(tabId);
    return null;
  } else if (source.groupId !== -1) {
    if (target.groupId !== source.groupId) await chrome.tabs.group({ groupId: source.groupId, tabIds: [tabId] });
    return null;
  } else {
    groupId = await chrome.tabs.group({ tabIds: [sourceTabId, tabId] });
  }

  const tabIds = [sourceTabId, tabId];
  const provisionalTitle = heuristicName(await summarize(tabIds));
  await chrome.tabGroups.update(groupId, { title: provisionalTitle });
  return { groupId, tabIds, provisionalTitle };
}

async function nameWhenLoaded({ groupId, tabIds, provisionalTitle }) {
  await waitForLoad(tabIds);
  const name = await suggestGroupName(await summarize(tabIds));
  await serial(async () => {
    const group = await chrome.tabGroups.get(groupId).catch(() => null);
    const userRenamedMeanwhile = group?.title !== provisionalTitle;
    if (group && !userRenamedMeanwhile) await chrome.tabGroups.update(groupId, { title: name });
  });
}

async function summarize(tabIds) {
  const tabs = (await Promise.all(tabIds.map(getTab))).filter(Boolean);
  return tabs.map((tab) => ({ title: tab.title, url: tab.pendingUrl || tab.url }));
}

async function waitForLoad(tabIds) {
  const deadline = Date.now() + LOAD_WAIT_MS;
  while (Date.now() < deadline) {
    const tabs = (await Promise.all(tabIds.map(getTab))).filter(Boolean);
    if (tabs.every((tab) => tab.status === 'complete')) return;
    await sleep(200);
  }
}
