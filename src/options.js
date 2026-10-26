const input = document.getElementById('groupAllLinks');
input.checked = (await chrome.storage.local.get('groupAllLinks')).groupAllLinks ?? false;
input.addEventListener('change', () => chrome.storage.local.set({ groupAllLinks: input.checked }));
