function reportBackgroundOpen(event, opensNewTab) {
  if (!opensNewTab) return;
  const link = event.composedPath().find((node) => node instanceof HTMLAnchorElement && node.href);
  if (!link) return;
  try {
    chrome.runtime.sendMessage({ type: 'modifier-click', href: link.href }).catch(() => {});
  } catch {
    // Content scripts orphaned by an extension reload throw synchronously here.
  }
}

addEventListener('click', (event) => reportBackgroundOpen(event, event.metaKey || event.ctrlKey), true);
addEventListener('auxclick', (event) => reportBackgroundOpen(event, event.button === 1), true);
