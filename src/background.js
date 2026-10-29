import { serial } from './serial.js';
import {
  activeTabId,
  handleActivated,
  handleCreated,
  handleRemoved,
  handleReplaced,
  noteDiscarded,
  noteLoadProgress,
  prepareAllWindows,
  prepareWindow,
  refresh,
  removePinned,
  resetActiveTabToHome,
  togglePinned,
} from './section.js';
import { cancelSwitcher, commitSwitcher, forgetTab, replaceTab, stepSwitcher } from './mru.js';
import { handleNavigationTarget, recordModifierClick } from './autogroup.js';

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
  'mru-older': () => stepSwitcher('older'),
  'mru-newer': () => stepSwitcher('newer'),
  'reset-to-home': resetActiveTabToHome,
  'toggle-pinned': async () => togglePinned(await activeTabId()),
  'remove-pinned': async () => removePinned(await activeTabId()),
};
chrome.commands.onCommand.addListener((command) => commands[command] && serial(commands[command]));

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'modifier-click' && sender.tab) recordModifierClick(sender.tab.id);
  if (message?.type === 'switcher-step') serial(() => stepSwitcher(message.direction));
  if (message?.type === 'switcher-commit') serial(() => commitSwitcher(message.tabId));
  if (message?.type === 'switcher-cancel') cancelSwitcher();
  if (message?.type === 'toggle-pinned' && sender.tab) serial(() => togglePinned(sender.tab.id));
  if (message?.type === 'remove-pinned' && sender.tab) serial(() => removePinned(sender.tab.id));
});
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => handleNavigationTarget(details));
