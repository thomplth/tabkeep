(() => {
  let reported;

  function report() {
    if (document.hidden || innerWidth === reported?.innerWidth && outerWidth === reported?.outerWidth) return;
    reported = { outerWidth, innerWidth };
    try {
      chrome.runtime.sendMessage({ type: 'sidebar-width', ...reported }).catch(() => {});
    } catch {
      // Content scripts orphaned by an extension reload throw synchronously here.
    }
  }

  addEventListener('resize', report);
  document.addEventListener('visibilitychange', report);
  report();
})();
