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

## Documentation maintenance

- Update `AGENTS.md` whenever implementation changes project-wide architecture, workflows,
  conventions, or durable gotchas.
- Keep `README.md` synchronized with user-visible behaviour and shortcuts; never leave known
  contradictions undocumented.
