# Tabkeep

Chrome extension that adds an Arc-style pinned section, a recent-tab switcher, and AI tab
auto-grouping on top of Chrome's native tab bar, with no custom UI.

## Work tracking

- This project has no issue tracker. Take scope and acceptance criteria from the human's request.
- Do not create issues or add issue IDs to commits, branches, or PRs.

## Git workflow

- Make every task change in a clean, isolated worktree rather than the primary checkout.
- Use one task per worktree. Keep commits scoped, with imperative messages.
- After verification, commit the task, integrate it into `main`, remove the worktree and branch,
  and push `main` to `origin`.
- After pushing, reload the extension in the human's Chrome so the change is live. It is installed
  unpacked from the primary checkout (ID `oldnhmcppohabfajfbnbaghoilpmcgeh`, profile `Default`),
  so no install step is needed; if it is missing, ask before loading it. Reload headlessly by
  opening `reload.html`, which calls `chrome.runtime.reload()` and closes with the old extension:
  `osascript -e 'tell application "Google Chrome" to tell front window to make new tab with
  properties {URL:"chrome-extension://oldnhmcppohabfajfbnbaghoilpmcgeh/reload.html"}'`.
  Confirm with the `version` in the profile's `Secure Preferences` for that ID. Fall back to
  the computer-use skill on `chrome://extensions` only if this fails.
- The repository is public. Never commit credentials, tokens, or personal data.

## Test-driven development

- Add or update tests in `test/` first.
- Run `npm test` and confirm the new tests fail for the expected reason.
- Implement the change, then rerun `npm test` and fix until everything passes.
- `npm test` drives Chrome for Testing headlessly with the extension loaded, one file at a time.

## Gotchas

- Hidden tabs keep their old size and get no `resize` events, so the divider cannot measure the
  sidebar itself. `src/content/sidebar-width.js` reports `outerWidth − innerWidth` from the
  visible page and `src/divider.js` retitles the divider, scaling `innerWidth` by the tab's zoom.
  Headless tests simulate a sidebar by shrinking the viewport with `page.setViewport`.

- Chrome inserts tabs opened from a pinned tab (`window.open`, `rel=noopener` links) inside the
  pinned group and misreports `openerTabId`, so `handleCreated` moves every new tab out of the
  section except the divider and tabs Tabkeep itself resurrects (`selfCreatedTabs`).
- Chrome allows at most four `suggested_key` commands; a fifth makes the extension fail to load.
  Page-level key catching for `Cmd+…` chords was dropped because Chrome's menu takes them first.
- Headless Chrome never delivers shortcuts to `chrome.commands`; tests call `self.runCommand`
  through `extension.command(name, tabId)`.

## Documentation maintenance

- Update `AGENTS.md` whenever implementation changes project-wide architecture, workflows,
  conventions, or durable gotchas.
- Keep `README.md` synchronized with user-visible behaviour and shortcuts; never leave known
  contradictions undocumented.
