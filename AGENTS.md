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
- `Cmd+E` and `Cmd+Backspace` are caught by `src/content/pin-keys.js` because Chrome reserves them
  for its own commands; the matching `chrome.commands` ship unbound.

## Documentation maintenance

- Update `AGENTS.md` whenever implementation changes project-wide architecture, workflows,
  conventions, or durable gotchas.
- Keep `README.md` synchronized with user-visible behaviour and shortcuts; never leave known
  contradictions undocumented.
