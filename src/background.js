import { serial } from './serial.js';
import {
  handleActivated,
  handleCreated,
  handleRemoved,
  handleReplaced,
  noteDiscarded,
  noteLoadProgress,
  prepareAllWindows,
  prepareWindow,
  refresh,
  resetActiveTabToHome,
} from './section.js';
import { forgetTab, replaceTab } from './mru.js';

chrome.runtime.onInstalled.addListener(() => prepareAllWindows());
chrome.runtime.onStartup.addListener(() => prepareAllWindows());
chrome.windows.onCreated.addListener((window) => prepareWindow(window.id));

chrome.tabs.onCreated.addListener((tab) => serial(() => handleCreated(tab)));
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const removedAt = Date.now();
  serial(() => handleRemoved(tabId, removeInfo, removedAt));
});
chrome.tabs.onReplaced.addListener((added, removed) =>
  serial(async () => {
    await handleReplaced(added, removed);
    await replaceTab(added, removed);
  }),
);
chrome.tabs.onMoved.addListener((_, { windowId }) => serial(() => refresh(windowId)));
chrome.tabs.onAttached.addListener((_, { newWindowId }) => serial(() => refresh(newWindowId)));
chrome.tabs.onDetached.addListener((tabId, { oldWindowId }) =>
  serial(async () => {
    await forgetTab(tabId);
    await refresh(oldWindowId);
  }),
);
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  noteLoadProgress(tabId, change);
  const changedAt = Date.now();
  if ('discarded' in change) serial(() => noteDiscarded(tabId, change.discarded, changedAt));
  if ('pinned' in change || 'groupId' in change) serial(() => refresh(tab.windowId));
});
chrome.tabs.onActivated.addListener((activeInfo) => {
  const activatedAt = Date.now();
  serial(() => handleActivated(activeInfo, activatedAt));
});

chrome.tabGroups.onUpdated.addListener((group) => serial(() => refresh(group.windowId)));
chrome.tabGroups.onMoved.addListener((group) => serial(() => refresh(group.windowId)));

const commands = {
  'reset-to-home': resetActiveTabToHome,
};
chrome.commands.onCommand.addListener((command) => commands[command] && serial(commands[command]));

