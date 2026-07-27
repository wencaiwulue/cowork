# Dark Theme for Desktop App

## Summary
Add a dark color theme to the Claude Code Desktop renderer, toggleable via Settings, with automatic system preference detection.

## Problem / Motivation
The app currently has only a light warm-cream theme. Users working in low-light environments or with system dark mode enabled experience a bright, inconsistent UI.

## Proposed Solution

### Color tokens (dark values override in `[data-theme="dark"]` scope on `<body>`)
- Background surfaces: deep warm charcoal palette matching the brand's warm tone
  - `--bg: #1a1816` (deepest, page background)
  - `--surface: #23211f` (panels, cards)
  - `--surface-2: #2d2a27` (hover, elevated surfaces)
  - `--surface-3: #3a3632` (stronger borders/dividers)
- Text: `--text: #e8e4df`, `--muted: #9a9388`
- Hairlines: `--hairline: #3a3632`
- Accent: keep warm coral `--accent: #d4805a`, `--accent-strong: #e08a64` (slightly brighter for dark contrast)
- Status colors: blue `#5b76d9`, green `#4caf6a`, red `#d46266` adjusted for dark backgrounds
- Shadows: deeper/darker
- Scrollbar: dark variants

### Toggle mechanism
- Persist preference in localStorage key `claude-desktop-theme`: `"light" | "dark" | "system"` (default `"system"`)
- Watch `prefers-color-scheme` media query when set to `"system"`
- Apply `data-theme="dark"` attribute on `<body>`
- Add a theme selector in Settings > Runtime (radio: System / Light / Dark)

### Implementation approach
- All colors already use CSS custom properties; dark theme is a pure CSS override block + ~30 lines of JS for the toggle and system detection.
- No component-level changes needed — existing `var(--token)` references automatically resolve to dark values.
- The existing CSS has hardcoded colors (e.g. `#fff`, `#f4f6ff`, `rgba(...)`) that will be inspected and replaced with CSS variables in a follow-up; for v1, the major surfaces/text/accent are covered via the root token overrides.

## Affected Files
- `desktop/renderer/src/styles.css` — add `[data-theme="dark"]` block overriding all tokens
- `desktop/renderer/src/App.tsx` — add theme state, localStorage persistence, system media query listener, settings UI selector

## Interface / API Changes
- New setting stored in localStorage only (no IPC/backend changes needed in v1).
- Settings panel: new "Theme" radio group in Runtime settings section.

## Testing Plan
- `npx tsc --noEmit` passes
- `npx vite build --config desktop/vite.config.ts` builds
- Manual: toggle System → Light → Dark in Settings; colors update instantly
- Manual: system preference change reflected when in "System" mode
- Manual: composer, rail, chat messages, activity panel all legible in dark

## Risks & Alternatives
- Risk: hardcoded `#fff`/`#000` colors scattered in CSS will not adapt. Mitigation: follow-up pass to replace remaining hardcoded colors with variables; for v1 the main surfaces are token-based.
- Alternative: separate dark CSS file (more bundle size, harder to maintain). Chosen approach: same-file `[data-theme]` override block.

## Open Questions
None — resolved.
