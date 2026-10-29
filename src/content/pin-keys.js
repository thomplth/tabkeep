(() => {
  const send = (message) => {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // Content scripts orphaned by an extension reload throw synchronously here.
    }
  };

  const isEditing = (event) =>
    event.composedPath().some((node) => node instanceof HTMLElement && (node.isContentEditable || node.matches('input, textarea, select')));

  addEventListener(
    'keydown',
    (event) => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      let type;
      if (event.code === 'KeyE') type = 'toggle-pinned';
      else if ((event.key === 'Backspace' || event.key === 'Delete') && !isEditing(event)) type = 'remove-pinned';
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
      send({ type });
    },
    true,
  );
})();
