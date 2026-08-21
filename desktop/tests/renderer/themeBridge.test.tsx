/**
 * Runtime tests for themeBridge.ts.
 *
 * Validates CSS variable injection (applyA2uiTheme) and theme class management
 * (applyA2uiThemeClass / initThemeBridge).  Design doc §6.2.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  applyA2uiTheme,
  applyA2uiThemeClass,
  initThemeBridge,
} from '../../renderer/src/a2ui/themeBridge'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(): HTMLDivElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

function cleanup(el: HTMLElement) {
  el.remove()
}

// ---------------------------------------------------------------------------
// applyA2uiTheme — CSS variable injection
// ---------------------------------------------------------------------------

describe('applyA2uiTheme', () => {
  let container: HTMLDivElement
  beforeEach(() => { container = makeContainer() })
  afterEach(() => cleanup(container))

  it('sets --a2ui-color-background to var(--surface)', () => {
    applyA2uiTheme(container)
    expect(container.style.getPropertyValue('--a2ui-color-background')).toBe('var(--surface)')
  })

  it('sets --a2ui-color-primary to var(--accent)', () => {
    applyA2uiTheme(container)
    expect(container.style.getPropertyValue('--a2ui-color-primary')).toBe('var(--accent)')
  })

  it('sets --a2ui-border-radius to var(--radius-sm)', () => {
    applyA2uiTheme(container)
    expect(container.style.getPropertyValue('--a2ui-border-radius')).toBe('var(--radius-sm)')
  })

  it('sets all five font-size variables', () => {
    applyA2uiTheme(container)
    expect(container.style.getPropertyValue('--a2ui-font-size-xs')).toBe('var(--text-xs)')
    expect(container.style.getPropertyValue('--a2ui-font-size-s')).toBe('var(--text-sm)')
    expect(container.style.getPropertyValue('--a2ui-font-size-m')).toBe('var(--text-base)')
    expect(container.style.getPropertyValue('--a2ui-font-size-l')).toBe('var(--text-lg)')
    expect(container.style.getPropertyValue('--a2ui-font-size-xl')).toBe('var(--text-xl)')
  })

  it('sets --a2ui-color-border to var(--hairline)', () => {
    applyA2uiTheme(container)
    expect(container.style.getPropertyValue('--a2ui-color-border')).toBe('var(--hairline)')
  })

  it('sets --a2ui-text-caption-color to var(--muted)', () => {
    applyA2uiTheme(container)
    expect(container.style.getPropertyValue('--a2ui-text-caption-color')).toBe('var(--muted)')
  })

  it('sets --a2ui-color-on-surface to var(--text)', () => {
    applyA2uiTheme(container)
    expect(container.style.getPropertyValue('--a2ui-color-on-surface')).toBe('var(--text)')
  })
})

// ---------------------------------------------------------------------------
// applyA2uiThemeClass — class management
// ---------------------------------------------------------------------------

describe('applyA2uiThemeClass', () => {
  let container: HTMLDivElement
  beforeEach(() => {
    container = makeContainer()
    // Ensure no theme attribute initially
    delete document.documentElement.dataset.theme
  })
  afterEach(() => {
    cleanup(container)
    delete document.documentElement.dataset.theme
  })

  it('adds a2ui-light and removes a2ui-dark when theme is not dark', () => {
    applyA2uiThemeClass(container)
    expect(container.classList.contains('a2ui-light')).toBe(true)
    expect(container.classList.contains('a2ui-dark')).toBe(false)
  })

  it('adds a2ui-dark and removes a2ui-light when data-theme="dark"', () => {
    document.documentElement.dataset.theme = 'dark'
    applyA2uiThemeClass(container)
    expect(container.classList.contains('a2ui-dark')).toBe(true)
    expect(container.classList.contains('a2ui-light')).toBe(false)
  })

  it('toggles from light to dark when attribute changes', () => {
    applyA2uiThemeClass(container) // starts light
    expect(container.classList.contains('a2ui-light')).toBe(true)

    document.documentElement.dataset.theme = 'dark'
    applyA2uiThemeClass(container)
    expect(container.classList.contains('a2ui-dark')).toBe(true)
    expect(container.classList.contains('a2ui-light')).toBe(false)
  })

  it('toggles from dark back to light', () => {
    document.documentElement.dataset.theme = 'dark'
    applyA2uiThemeClass(container)
    expect(container.classList.contains('a2ui-dark')).toBe(true)

    delete document.documentElement.dataset.theme
    applyA2uiThemeClass(container)
    expect(container.classList.contains('a2ui-light')).toBe(true)
    expect(container.classList.contains('a2ui-dark')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// initThemeBridge — MutationObserver integration
// ---------------------------------------------------------------------------

describe('initThemeBridge', () => {
  let container: HTMLDivElement
  let dispose: (() => void) | undefined

  beforeEach(() => {
    container = makeContainer()
    delete document.documentElement.dataset.theme
    dispose = undefined
  })
  afterEach(() => {
    dispose?.()
    cleanup(container)
    delete document.documentElement.dataset.theme
  })

  it('applies theme variables and class immediately on init (light)', () => {
    dispose = initThemeBridge(container)
    // Variables applied
    expect(container.style.getPropertyValue('--a2ui-color-primary')).toBe('var(--accent)')
    // Class applied
    expect(container.classList.contains('a2ui-light')).toBe(true)
  })

  it('applies dark class immediately when data-theme="dark" at init', () => {
    document.documentElement.dataset.theme = 'dark'
    dispose = initThemeBridge(container)
    expect(container.classList.contains('a2ui-dark')).toBe(true)
    expect(container.classList.contains('a2ui-light')).toBe(false)
  })

  it('tracks data-theme attribute changes via MutationObserver (light → dark)', async () => {
    dispose = initThemeBridge(container)
    expect(container.classList.contains('a2ui-light')).toBe(true)

    // Change attribute — MutationObserver fires asynchronously
    document.documentElement.dataset.theme = 'dark'

    // Yield to allow MutationObserver microtask/macrotask to fire
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(container.classList.contains('a2ui-dark')).toBe(true)
    expect(container.classList.contains('a2ui-light')).toBe(false)
  })

  it('tracks data-theme attribute changes via MutationObserver (dark → light)', async () => {
    document.documentElement.dataset.theme = 'dark'
    dispose = initThemeBridge(container)
    expect(container.classList.contains('a2ui-dark')).toBe(true)

    delete document.documentElement.dataset.theme

    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(container.classList.contains('a2ui-light')).toBe(true)
    expect(container.classList.contains('a2ui-dark')).toBe(false)
  })

  it('returned disposer stops MutationObserver from firing', async () => {
    dispose = initThemeBridge(container)
    dispose() // disconnect immediately
    dispose = undefined // don't call again in afterEach

    document.documentElement.dataset.theme = 'dark'
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    // Observer was disconnected, so class should still be 'a2ui-light'
    expect(container.classList.contains('a2ui-light')).toBe(true)
    expect(container.classList.contains('a2ui-dark')).toBe(false)
  })
})
