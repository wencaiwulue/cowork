# Mini Design Doc: Hover Message Actions

- **Date**: 2026-07-27
- **Type**: Small Change
- **Severity**: Low

---

## 1. Root Cause

Desktop chat messages currently render metadata in `desktop/renderer/src/App.tsx` inside `.message-label`, so timestamps are always visible. The copy action is already hidden until hover/focus through `.message-copy-button` CSS in `desktop/renderer/src/styles.css`, but there is no shared hover-only metadata/action row and no user-message edit affordance.

**Evidence**:
```tsx
<span className="message-role">{messageRoleLabel(message.role)}</span>
{typeof message.timestamp === 'number' && (
  <time className="message-time" ...>{formatTime(message.timestamp)}</time>
)}
<button className="tool-button icon-only message-copy-button" ...>
```

---

## 2. Fix

Move timestamp and message actions into a dedicated `.message-actions` container that is hidden by default and shown on `.message:hover` or `.message:focus-within`. Keep copy behavior unchanged. Add an edit button only for non-empty user messages; clicking it loads that message text into the composer as a draft, focuses the composer, places the cursor at the end, auto-resizes the composer, and leaves transcript history untouched.

---

## 3. Files Changed

| File | Change |
|---|---|
| `desktop/renderer/src/App.tsx` | Add draft edit handler and render hover-only message action row |
| `desktop/renderer/src/styles.css` | Add hover/focus visibility and compact action row styling |
| `desktop/tests/mainNavigationWiring.test.ts` | Add source-level regression coverage for action row and edit behavior |

---

## 4. Test

- [ ] Renderer wiring test: timestamp is inside `.message-actions`, not always-visible label content
- [ ] Renderer wiring test: copy action remains wired to `copyText(copyTarget, messageText(message))`
- [ ] Renderer wiring test: edit button is gated to user messages and non-empty text
- [ ] Renderer wiring test: edit handler sets composer input, resets history state, focuses composer, moves cursor, and calls `autoResizeComposer()`
- [ ] `bun run desktop:test -- desktop/tests/mainNavigationWiring.test.ts`
- [ ] `bun run desktop:check`
