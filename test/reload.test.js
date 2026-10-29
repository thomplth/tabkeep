import { after, before, test } from 'node:test';
import { launch } from './harness.js';

let browser;
let extension;

before(async () => {
  ({ browser, extension } = await launch());
});

after(async () => {
  await browser?.close();
});

test('opening reload.html unloads the extension, which takes the page down with it', async () => {
  const reloadUrl = await extension.run(() => chrome.runtime.getURL('reload.html'));
  await extension.run((url) => chrome.tabs.create({ url }), reloadUrl);
  await browser.waitForTarget((target) => target.url() === reloadUrl);

  await extension.waitFor(async () => !browser.targets().some((target) => target.url() === reloadUrl), {
    message: 'reload page to close',
  });
});
