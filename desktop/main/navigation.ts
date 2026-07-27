export type NavigationAction =
  | { type: 'allow' }
  | { type: 'external'; url: string }
  | { type: 'block' }

export function normalizeRendererEntryUrl(targetUrl: string): string | undefined {
  if (containsControlCharacters(targetUrl)) return undefined

  try {
    const parsed = new URL(targetUrl)
    if (isRendererResourceDocument(parsed)) return undefined
    if (parsed.username || parsed.password) return undefined
    if (parsed.protocol === 'file:') {
      return isHtmlEntryDocument(parsed) ? parsed.href : undefined
    }
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      isLocalRendererHost(parsed.hostname)
    ) {
      return parsed.href
    }
  } catch {
    return undefined
  }

  return undefined
}

export function navigationActionForUrl(
  targetUrl: string,
  rendererUrl: string,
): NavigationAction {
  if (containsControlCharacters(targetUrl)) return { type: 'block' }

  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return { type: 'block' }
  }

  if (parsed.username || parsed.password) return { type: 'block' }

  const normalizedRendererUrl = normalizeRendererEntryUrl(rendererUrl)
  if (normalizedRendererUrl && parsed.href === normalizedRendererUrl) return { type: 'allow' }

  if (normalizedRendererUrl) {
    const rendererParsed = new URL(normalizedRendererUrl)
    if (parsed.origin === rendererParsed.origin && isRendererResourceDocument(parsed)) {
      return { type: 'block' }
    }
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return { type: 'external', url: parsed.href }
  }

  return { type: 'block' }
}

function isRendererResourceDocument(url: URL): boolean {
  return /\.(?:js|mjs|cjs|css|map|json|wasm)(?:$|[?#])/.test(url.pathname)
}

function isHtmlEntryDocument(url: URL): boolean {
  return /\.html(?:$|[?#])/.test(url.pathname)
}

function isLocalRendererHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}
