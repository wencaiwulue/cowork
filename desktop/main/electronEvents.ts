import type { BrowserWindow } from 'electron'

export function safeSendDesktopEvent(
  window: BrowserWindow | null | undefined,
  event: unknown,
): boolean {
  if (!window) return false
  try {
    if (window.isDestroyed?.()) return false
    const webContents = window.webContents
    if (!webContents || webContents.isDestroyed?.()) return false
    webContents.send('desktop:event', event)
    return true
  } catch (cause) {
    if (isDestroyedObjectError(cause)) return false
    throw cause
  }
}

function isDestroyedObjectError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.toLowerCase().includes('object has been destroyed')
}
