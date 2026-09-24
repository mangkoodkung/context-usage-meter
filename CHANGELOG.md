# Changelog

## 0.3.0 — 2026-09-24

### Added

- Safe Context Size controls that update SillyTavern's actual Chat Completion context value.
- First-run setup assistant with Flash 90k, Pro 200k, custom, and keep-current choices.
- Confirmation dialog for custom Context Size values above 200,000 tokens.
- Automatic SillyTavern Context Unlock when the selected value exceeds the current slider limit.
- Basic meter styles: slim bar, capsule, and segmented blocks.
- Advanced meter styles: clean ring, numeric badge, Floating Orb, Context Familiar, Magic Constellation, Edge Bookmark, and Ambient Aura.
- Advanced meter scale control from 50–120% for every Advanced style except Ambient Aura.
- Twelve Context Familiar characters with usage-dependent moods.
- Draggable floating meters with edge snapping, idle fading, and a position reset control.
- Expanded preset themes and reusable custom color sets.
- Responsive floating-detail panel and mobile-safe setup dialogs.

### Changed

- Warnings now follow the user's 50–80% threshold and the real outgoing prompt.
- Warning notifications appear once per threshold crossing and remain visible until dismissed.
- The ring meter now uses a thinner, quieter visual treatment.
- Desktop meter numbers can be hidden consistently with the compact interaction.
- Settings UI has been reorganized into responsive cards with clearer grouping.

### Removed or paused

- Removed the fixed 30k warning because it did not represent the actual outgoing prompt limit reliably.
- Removed the warning test box from Settings.
- Paused Summarize controls while recap quality is being improved.

### Validation

- JavaScript syntax and whitespace checks pass.
- Desktop and mobile layouts were exercised in the local SillyTavern instance.
- Advanced scaling was verified at 50% and 85%; Ambient Aura remains at 100%.
- The setup dialog, high-context confirmation, persistent setup state, and drawer behavior were verified locally.

## 0.2.0

- Initial public meter, warning, theme, and recap implementation.
