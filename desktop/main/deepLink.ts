export type DesktopDeepLink = {
  sessionId?: string
  cwd?: string
}

const MAX_CWD_LENGTH = 4096
const MAX_SESSION_ID_LENGTH = 200

export function parseDesktopDeepLink(url: string): DesktopDeepLink {
  try {
    const parsed = new URL(url)
    if (
      (parsed.protocol !== 'claude:' && parsed.protocol !== 'claude-dev:') ||
      parsed.hostname !== 'resume'
    ) {
      return {}
    }
    const sessionId = parsed.searchParams.get('session') ?? undefined
    const cwd = parsed.searchParams.get('cwd') ?? undefined
    return {
      sessionId: isSafeSessionId(sessionId) ? sessionId : undefined,
      cwd: isSafeCwd(cwd) ? cwd : undefined,
    }
  } catch {
    return {}
  }
}

function isSafeSessionId(value: string | undefined): value is string {
  return Boolean(
    value &&
      value.length <= MAX_SESSION_ID_LENGTH &&
      !containsControlCharacters(value),
  )
}

function isSafeCwd(value: string | undefined): value is string {
  return Boolean(
    value &&
      value.length <= MAX_CWD_LENGTH &&
      isAbsoluteLocalPath(value) &&
      !containsControlCharacters(value),
  )
}

function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[/\\]/.test(value)
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}
