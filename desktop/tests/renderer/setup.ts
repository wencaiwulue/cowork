/**
 * Jest-dom matchers for vitest (e.g. toBeInTheDocument, toHaveTextContent, etc.)
 */
import '@testing-library/jest-dom/vitest'

// ---------------------------------------------------------------------------
// jsdom polyfills required by @a2ui/web_core/v0_9/basic_catalog/styles/default.js
//
// A2UI calls `injectBasicCatalogStyles()` inside a React useEffect.  That
// function does:
//   1. `new CSSStyleSheet()`  — constructable stylesheets
//   2. `sheet.replaceSync(css)` — synchronously set sheet text
//   3. `document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]`
//
// jsdom (as of v25/v30) does not implement constructable stylesheets:
//   - `new CSSStyleSheet()` succeeds but produces an empty object with no
//     `replaceSync` method.
//   - `document.adoptedStyleSheets` is an empty array-like but not writable.
//
// The polyfills below make those three operations no-op safely so components
// can render without throwing.  They do not attempt to implement the CSS
// cascade — we only need the DOM tree to be correct for assertions.
// ---------------------------------------------------------------------------

if (typeof CSSStyleSheet !== 'undefined') {
  if (!CSSStyleSheet.prototype.replaceSync) {
    // jsdom's CSSStyleSheet lacks replaceSync; add a no-op stub.
    Object.defineProperty(CSSStyleSheet.prototype, 'replaceSync', {
      value: function (_css: string) {
        // no-op: jsdom doesn't process adoptedStyleSheets anyway
      },
      writable: true,
      configurable: true,
    })
  }
  if (!CSSStyleSheet.prototype.replace) {
    Object.defineProperty(CSSStyleSheet.prototype, 'replace', {
      value: function (_css: string) {
        return Promise.resolve(this)
      },
      writable: true,
      configurable: true,
    })
  }
}

// Make document.adoptedStyleSheets writable (it's a getter-only in jsdom).
// We install a simple array that accepts push/spread assignment.
try {
  const _adoptedSheets: CSSStyleSheet[] = []
  Object.defineProperty(document, 'adoptedStyleSheets', {
    get() {
      return _adoptedSheets
    },
    set(sheets: CSSStyleSheet[]) {
      _adoptedSheets.length = 0
      for (const s of sheets) _adoptedSheets.push(s)
    },
    configurable: true,
  })
} catch {
  // If jsdom already has it writable, the defineProperty may fail — that's fine.
}
