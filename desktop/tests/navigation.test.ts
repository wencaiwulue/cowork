import { describe, expect, it } from 'vitest'
import { navigationActionForUrl, normalizeRendererEntryUrl } from '../main/navigation'

describe('desktop navigation policy', () => {
  const rendererUrl = 'file:///app/desktop/dist/renderer/index.html'

  it('allows the packaged renderer index', () => {
    expect(navigationActionForUrl(rendererUrl, rendererUrl)).toEqual({ type: 'allow' })
  })

  it('rejects packaged renderer entry URLs that are not HTML documents', () => {
    expect(normalizeRendererEntryUrl('file:///app/desktop/dist/renderer/main.js')).toBeUndefined()
    expect(normalizeRendererEntryUrl('file:///app/desktop/dist/renderer/styles.css')).toBeUndefined()
    expect(normalizeRendererEntryUrl('file:///app/desktop/dist/renderer/assets/index-abc123.css')).toBeUndefined()
  })

  it('allows a normalized local dev renderer entry', () => {
    expect(normalizeRendererEntryUrl('http://127.0.0.1:5174')).toBe('http://127.0.0.1:5174/')
    expect(
      navigationActionForUrl('http://127.0.0.1:5174/', 'http://127.0.0.1:5174'),
    ).toEqual({ type: 'allow' })
  })

  it('opens http and https top-level navigations outside the desktop window', () => {
    expect(navigationActionForUrl('https://example.com/desktop', rendererUrl)).toEqual({
      type: 'external',
      url: 'https://example.com/desktop',
    })
    expect(navigationActionForUrl('http://127.0.0.1:3000', rendererUrl)).toEqual({
      type: 'external',
      url: 'http://127.0.0.1:3000/',
    })
  })

  it('normalizes allowed external URLs before opening them', () => {
    expect(navigationActionForUrl(' https://example.com/desktop ', rendererUrl)).toEqual({
      type: 'external',
      url: 'https://example.com/desktop',
    })
  })

  it('blocks packaged asset files from replacing the app shell', () => {
    expect(
      navigationActionForUrl('file:///app/desktop/dist/renderer/assets/index.js', rendererUrl),
    ).toEqual({ type: 'block' })
    expect(
      navigationActionForUrl('file:///app/desktop/dist/renderer/assets/index.css', rendererUrl),
    ).toEqual({ type: 'block' })
  })

  it('blocks dev server asset files from replacing the app shell', () => {
    expect(
      navigationActionForUrl(
        'http://127.0.0.1:5174/assets/index-abc123.js',
        'http://127.0.0.1:5174',
      ),
    ).toEqual({ type: 'block' })
    expect(
      navigationActionForUrl(
        'http://127.0.0.1:5174/assets/index-abc123.css',
        'http://127.0.0.1:5174',
      ),
    ).toEqual({ type: 'block' })
  })

  it('rejects renderer entry URLs that point at generated assets', () => {
    expect(normalizeRendererEntryUrl('file:///app/desktop/dist/renderer/assets/index.js')).toBeUndefined()
    expect(normalizeRendererEntryUrl('http://127.0.0.1:5174/assets/index.css')).toBeUndefined()
    expect(normalizeRendererEntryUrl('http://127.0.0.1:5174/index.js')).toBeUndefined()
    expect(normalizeRendererEntryUrl('http://127.0.0.1:5174/style.css')).toBeUndefined()
  })

  it('blocks malformed navigation targets', () => {
    expect(navigationActionForUrl('not a url', rendererUrl)).toEqual({ type: 'block' })
  })

  it('blocks control characters and credentialed external URLs', () => {
    expect(navigationActionForUrl('https://example.com\n@evil.example', rendererUrl)).toEqual({ type: 'block' })
    expect(navigationActionForUrl('https://user:pass@example.com/path', rendererUrl)).toEqual({ type: 'block' })
    expect(navigationActionForUrl('https://user@example.com/path', rendererUrl)).toEqual({ type: 'block' })
  })
})
