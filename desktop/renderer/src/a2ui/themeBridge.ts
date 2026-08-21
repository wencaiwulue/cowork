/**
 * themeBridge.ts — sync Desktop CSS tokens → A2UI CSS variables.
 *
 * Design doc §8: override only *base* variables; leave derived ones
 * (color-mix(), computeColorVariant() families, spacing calc()) alone so
 * their expressions keep working.
 *
 * Color-scheme class: A2UI uses `a2ui-dark` / `a2ui-light` classes
 * (selector `:where(.a2ui-dark)` / `:where(.a2ui-light)`) to force
 * color-scheme:dark / color-scheme:light. Without one of these the
 * default is `color-scheme: light dark` (OS preference), which breaks
 * `light-dark()` resolution when the app is in a forced dark/light mode
 * that differs from the OS. Our app signals theme via
 * `document.documentElement.dataset.theme === 'dark'`.
 */

/**
 * Override --a2ui-* CSS variables on `container` to match Desktop tokens.
 * Called once after mount and again whenever the app theme changes.
 */
export function applyA2uiTheme(container: HTMLElement): void {
  const s = container.style

  // --- Base color variables (safe to override; derived variants auto-update) ---
  s.setProperty('--a2ui-color-background', 'var(--surface)')
  s.setProperty('--a2ui-color-on-background', 'var(--text)')
  s.setProperty('--a2ui-color-surface', 'var(--surface)')
  s.setProperty('--a2ui-color-on-surface', 'var(--text)')
  s.setProperty('--a2ui-color-primary', 'var(--accent)')
  // Explicit hover so it tracks accent-strong rather than the generic variant
  s.setProperty('--a2ui-color-primary-hover', 'var(--accent-strong)')
  s.setProperty('--a2ui-color-secondary', 'var(--surface-2)')
  s.setProperty('--a2ui-color-on-secondary', 'var(--text)')
  s.setProperty('--a2ui-color-border', 'var(--hairline)')

  // --- Shape ---
  s.setProperty('--a2ui-border-radius', 'var(--radius-sm)')

  // --- Typography (individual px overrides per design-doc font-size decision) ---
  // Using Desktop's fixed px tokens rather than setting --a2ui-font-size +
  // --a2ui-font-scale because the scale would produce fractional px values that
  // don't match the surrounding chat type ramp (see doc §8 font-size decision).
  s.setProperty('--a2ui-font-size-xs', 'var(--text-xs)')   // 10px
  s.setProperty('--a2ui-font-size-s',  'var(--text-sm)')   // 12px
  s.setProperty('--a2ui-font-size-m',  'var(--text-base)') // 13px
  s.setProperty('--a2ui-font-size-l',  'var(--text-lg)')   // 15px
  s.setProperty('--a2ui-font-size-xl', 'var(--text-xl)')   // 18px

  // --- Component-level text variables ---
  s.setProperty('--a2ui-text-caption-color', 'var(--muted)')
  s.setProperty('--a2ui-text-color-text',    'var(--text)')
}

/**
 * Apply (or refresh) the `a2ui-dark` / `a2ui-light` class on `container`
 * to match the app's current forced theme.
 *
 * Must be called (1) after mount, and (2) whenever `document.documentElement`
 * `data-theme` attribute changes.
 */
export function applyA2uiThemeClass(container: HTMLElement): void {
  const isDark = document.documentElement.dataset.theme === 'dark'
  if (isDark) {
    container.classList.add('a2ui-dark')
    container.classList.remove('a2ui-light')
  } else {
    container.classList.add('a2ui-light')
    container.classList.remove('a2ui-dark')
  }
}

/**
 * Install a MutationObserver on `document.documentElement` that calls
 * `applyA2uiThemeClass(container)` whenever the `data-theme` attribute
 * changes.  Also applies theme variables and class immediately.
 *
 * Returns a disposer function — call it from React's `useEffect` cleanup.
 */
export function initThemeBridge(container: HTMLElement): () => void {
  applyA2uiTheme(container)
  applyA2uiThemeClass(container)

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.attributeName === 'data-theme') {
        applyA2uiThemeClass(container)
        break
      }
    }
  })

  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  return () => observer.disconnect()
}
