const SESSION_KEY = 'tabkeep';

let cache;

export async function loadState() {
  cache ??= (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] ?? {
    known: {},
    homes: {},
    mru: {},
    readyWindows: {},
  };
  return cache;
}

export function saveState() {
  return chrome.storage.session.set({ [SESSION_KEY]: cache });
}
