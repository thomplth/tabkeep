# Tabkeep

Arc-style pinned tabs and AI tab grouping on top of Chrome's native (vertical) tab bar. No custom UI.

## Install

1. Open `chrome://extensions`, enable Developer mode, **Load unpacked**, pick this folder.
2. After pulling changes, press the reload icon on the extension's card.

## Pinned section

A divider tab (`────────`) splits the tab bar. Everything above it is pinned:

- Drag a tab or a whole group above the divider to pin it; drag it below to unpin.
- Closing a pinned tab brings it straight back, asleep, at the same position with the URL it had
  when it was pinned. Closing a whole pinned group recreates the group.
- Native pinned tabs (the compact icon row) behave the same way.
- Links opened from a pinned tab land below the divider, never inside the pinned group.
- `Alt+Shift+R` sends the current pinned tab back to its pinned URL.
- Closing the active pinned tab takes you to your most recently used tab, not its neighbour.
- To delete a pinned tab for good, drag it below the divider first, then close it.
- Each window's pinned section is saved under an ID stored in its divider's URL, so it survives
  Chrome restarts and reopening a closed window.

## Auto-grouping

Cmd+click (or middle-click) a link:

- from a loose tab: both tabs become a new group;
- from a grouped tab: the new tab joins that group;
- from a pinned tab: the new tab gets its own group below the divider.

The group is named immediately after the site, then renamed by Chrome's built-in on-device model
(Gemini Nano) when it is available. Nothing is sent to any paid API. Renaming a group yourself
before the model answers wins.

## Recent-tab switcher

`Option+W` switches to the previously used tab; hold `Option` and keep pressing `W` to go further
back, with a switcher list on screen. Release to switch, `Esc` to cancel. Add `Shift` to go the
other way. The order skips the divider and pinned tabs that were closed (until you visit them
again).

Chrome does not let extensions bind ``Cmd+` ``. Two ways to get it:

- **In web pages only:** turn off macOS *System Settings → Keyboard → Keyboard Shortcuts →
  Keyboard → Move focus to next window*. Tabkeep then catches ``Cmd+` `` inside pages itself.
- **Everywhere (recommended):** a [Karabiner-Elements](https://karabiner-elements.pqrs.org)
  rule that turns ``Cmd+` `` into `Option+W` in Chrome:

```json
{
  "description": "Chrome: Cmd+` → Tabkeep recent-tab switcher",
  "manipulators": [
    {
      "type": "basic",
      "from": { "key_code": "grave_accent_and_tilde", "modifiers": { "mandatory": ["command"], "optional": ["shift"] } },
      "to": [{ "key_code": "w", "modifiers": ["option"] }],
      "conditions": [{ "type": "frontmost_application_if", "bundle_identifiers": ["^com\\.google\\.Chrome$"] }]
    }
  ]
}
```

## Tests

`npm test` drives Chrome for Testing headlessly with the extension loaded.
