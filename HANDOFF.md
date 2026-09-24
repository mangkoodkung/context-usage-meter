# Context Usage Meter — Handoff

Last updated: 2026-09-24  
Release prepared: **v0.3.0**  
Repository: `https://github.com/mangkoodkung/context-usage-meter`

## Current product state

The extension is a Chat Completion context monitor for SillyTavern. It reads the real outgoing prompt, visualizes context pressure, warns at a configurable threshold, and can write the user's chosen Context Size back to SillyTavern's real Chat Completion settings.

Summarize is intentionally paused. Its old implementation remains behind `RECAP_ENABLED = false` for possible future work, but no functional recap buttons are exposed.

## Implemented features

- Real outgoing-prompt token measurement through `CHAT_COMPLETION_PROMPT_READY`.
- Warning threshold limited to 50–80%, with one persistent dismissible warning per crossing.
- Danger state when the prompt enters the reserved reply area.
- Automatic Context Size and Response Reserve tracking from SillyTavern.
- Safe Context Size editor that updates `oai_settings.openai_max_context` and SillyTavern's paired controls.
- First-run setup assistant: Flash 90k, Pro 200k, custom, or keep current.
- Confirmation for values above 200,000 and automatic Context Unlock when needed.
- Basic styles: bar, capsule, blocks.
- Advanced styles: ring, badge, orb, familiar, constellation, bookmark, aura.
- Advanced scale from 50–120%, excluding Aura; default is 85%.
- Floating drag, edge snap, saved position, idle fade, and reset.
- Twelve Familiar characters and five Orb icons.
- Built-in themes, custom colors, and saved color sets.
- Responsive details and setup dialogs on desktop and mobile.

## Important implementation notes

- `index.js` owns settings, token measurement, SillyTavern synchronization, warning state, meter rendering, dragging, and dialogs.
- `settings.html` contains only the extension settings UI.
- `style.css` contains both chat meter styles and settings/dialog styling.
- The live Chat Completion source of truth is imported dynamically from `../../../openai.js` as `oai_settings`.
- Context Size writes update `#openai_max_context`, `#openai_max_context_counter`, and `oai_settings.openai_max_context`.
- Values above the current slider maximum enable `#oai_max_context_unlocked`; the extension's supported range is 512–2,000,000.
- Advanced scaling is stored as `advancedScale` and applied through `--cum-advanced-scale` on `#cum-alt-content`.
- Ambient Aura explicitly uses scale `1` and hides the Advanced size control.
- Floating UI nodes are moved under `document.body` so their detail panel is not clipped by the send form on mobile.

## Local development workflow

Do not push immediately after a code change. Copy and test the changed files first in:

```text
C:\Users\POPUKO-\ST\SillyTavern\data\default-user\extensions\context-usage-meter
```

Files normally copied:

- `index.js`
- `settings.html`
- `style.css`
- `manifest.json` when the release version changes

After copying, compare SHA-256 hashes between the workspace and local extension, reload `http://127.0.0.1:8000`, and inspect both desktop and mobile behavior.

## Validation checklist

1. Run `node --check index.js`.
2. Run `git diff --check`.
3. Confirm IDs in `settings.html` are unique and CSS braces are balanced.
4. Load the local SillyTavern instance and check the browser console for extension errors.
5. Verify the current Context Size shown by the extension matches SillyTavern.
6. Verify values above 200,000 show confirmation before being applied.
7. Verify the setup dialog appears only for users without `setupVersion: 1`.
8. Test at least one inline meter, one floating meter, and Ambient Aura.
9. Test the Advanced size slider and confirm Aura is unaffected.
10. Check desktop and a narrow mobile viewport.

## Known limitations and future work

- Chat Completion is the supported API mode; other completion modes are not guaranteed.
- Flash 90k and Pro 200k are community presets, not declarations of each model's technical maximum.
- Provider/model changes inside SillyTavern may clamp Context Size according to their own limits.
- Summarize requires a quality redesign before `RECAP_ENABLED` should be turned back on.
- Automated unit tests are not present; verification currently combines static checks with the local SillyTavern UI.

## Release documentation

- User-facing overview and installation: `README.md`
- Release history: `CHANGELOG.md`
- Extension metadata/version: `manifest.json`
