const RULE = '─';
// Mirrors where Chrome's vertical tab strip starts a title (sidebar edge to title text) and the font
// it draws it in; neither is exposed to extensions.
const TITLE_INSET = 38;
const TAB_TITLE_FONT = '12px system-ui';

const ruleWidth = (() => {
  const context = new OffscreenCanvas(0, 0).getContext('2d');
  context.font = TAB_TITLE_FONT;
  return context.measureText(RULE).width;
})();

const { windowId } = await chrome.tabs.getCurrent();

async function fitRule({ outerWidth, innerWidth }, tabId) {
  const contentWidth = innerWidth * (await chrome.tabs.getZoom(tabId));
  const sidebarWidth = outerWidth - contentWidth;
  document.title = RULE.repeat(Math.max(1, Math.round((sidebarWidth - 2 * TITLE_INSET) / ruleWidth)));
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'sidebar-width' && sender.tab?.windowId === windowId) fitRule(message, sender.tab.id);
});
