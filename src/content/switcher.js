(() => {
  let modifierHeld = false;
  let overlay = null;

  const send = (message) => {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // Content scripts orphaned by an extension reload throw synchronously here.
    }
  };

  function trackModifiers(event) {
    modifierHeld = event.altKey || event.metaKey || event.ctrlKey;
    if (overlay && !modifierHeld) commit();
  }

  function commit(tabId = overlay?.items[overlay.selected].id) {
    close();
    if (tabId !== undefined) send({ type: 'switcher-commit', tabId });
  }

  function cancel() {
    close();
    send({ type: 'switcher-cancel' });
  }

  function close() {
    overlay?.host.remove();
    overlay = null;
  }

  addEventListener(
    'keydown',
    (event) => {
      trackModifiers(event);
      if (event.metaKey && event.code === 'Backquote') {
        event.preventDefault();
        event.stopImmediatePropagation();
        send({ type: 'switcher-step', direction: event.shiftKey ? 'newer' : 'older' });
        return;
      }
      if (!overlay) return;
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (event.key === 'Escape') cancel();
      else if (event.key === 'Enter') commit();
      else if (step) render(overlay.items, (overlay.selected + step + overlay.items.length) % overlay.items.length);
      else return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  addEventListener('keyup', trackModifiers, true);
  addEventListener('blur', () => {
    modifierHeld = false;
    if (overlay) cancel();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'switcher-show') return;
    sendResponse(true);
    if (!modifierHeld) commit(message.items[message.selected].id);
    else render(message.items, message.selected);
  });

  const STYLE = `
    :host { all: initial; }
    .backdrop { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; }
    .panel {
      --bg: rgba(250, 250, 250, 0.92); --fg: #1d1d1f; --muted: #6e6e73; --selected: rgba(0, 0, 0, 0.08);
      width: min(440px, calc(100vw - 32px)); max-height: min(560px, calc(100vh - 32px)); overflow: auto;
      padding: 6px; border-radius: 14px; background: var(--bg); color: var(--fg);
      font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 0.5px rgba(0, 0, 0, 0.2);
      backdrop-filter: blur(24px) saturate(1.6);
    }
    @media (prefers-color-scheme: dark) {
      .panel { --bg: rgba(40, 40, 42, 0.92); --fg: #f5f5f7; --muted: #a1a1a6; --selected: rgba(255, 255, 255, 0.12); }
    }
    .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: default; }
    .row[aria-selected="true"] { background: var(--selected); }
    .icon { flex: none; width: 16px; height: 16px; border-radius: 3px; display: grid; place-items: center;
      font-size: 10px; font-weight: 600; color: var(--muted); background: var(--selected); overflow: hidden; }
    .icon img { width: 16px; height: 16px; }
    .text { min-width: 0; }
    .title, .host { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .host { color: var(--muted); font-size: 11px; }
  `;

  function render(items, selected) {
    if (!overlay) {
      const host = document.createElement('tabkeep-switcher');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>${STYLE}</style><div class="backdrop"><div class="panel" role="listbox"></div></div>`;
      root.querySelector('.backdrop').addEventListener('mousedown', (event) => {
        const row = event.target.closest('.row');
        event.preventDefault();
        if (row) commit(Number(row.dataset.id));
        else cancel();
      });
      document.documentElement.append(host);
      overlay = { host, root };
    }
    overlay.items = items;
    overlay.selected = selected;

    const panel = overlay.root.querySelector('.panel');
    panel.replaceChildren(...items.map((item, index) => row(item, index === selected)));
    panel.children[selected]?.scrollIntoView({ block: 'nearest' });
  }

  function row(item, isSelected) {
    const element = document.createElement('div');
    element.className = 'row';
    element.dataset.id = item.id;
    element.setAttribute('role', 'option');
    element.setAttribute('aria-selected', String(isSelected));

    const icon = document.createElement('span');
    icon.className = 'icon';
    const host = hostOf(item.url);
    icon.textContent = (host[0] ?? '•').toUpperCase();
    if (item.favIconUrl) {
      const image = new Image();
      image.addEventListener('load', () => icon.replaceChildren(image));
      image.src = item.favIconUrl;
    }

    const text = document.createElement('span');
    text.className = 'text';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title;
    const subtitle = document.createElement('div');
    subtitle.className = 'host';
    subtitle.textContent = host;
    text.append(title, subtitle);

    element.append(icon, text);
    return element;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }
})();
