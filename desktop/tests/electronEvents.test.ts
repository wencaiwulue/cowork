import { describe, expect, it, vi } from 'vitest'
import { safeSendDesktopEvent } from '../main/electronEvents'

describe('safeSendDesktopEvent', () => {
  it('sends desktop events to live windows', () => {
    const send = vi.fn()
    const window = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send,
      },
    }

    expect(safeSendDesktopEvent(window as never, { type: 'test-event' })).toBe(true)
    expect(send).toHaveBeenCalledWith('desktop:event', { type: 'test-event' })
  })

  it('drops events after the BrowserWindow is destroyed', () => {
    const send = vi.fn()
    const window = {
      isDestroyed: () => true,
      webContents: {
        isDestroyed: () => false,
        send,
      },
    }

    expect(safeSendDesktopEvent(window as never, { type: 'test-event' })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('drops events when Electron throws object-destroyed during send', () => {
    const send = vi.fn(() => {
      throw new Error('Object has been destroyed')
    })
    const window = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send,
      },
    }

    expect(safeSendDesktopEvent(window as never, { type: 'test-event' })).toBe(false)
    expect(send).toHaveBeenCalledOnce()
  })

  it('drops events when Electron throws object-destroyed while reading webContents', () => {
    const window = {
      isDestroyed: () => false,
      get webContents() {
        throw new TypeError('Object has been destroyed')
      },
    }

    expect(safeSendDesktopEvent(window as never, { type: 'test-event' })).toBe(false)
  })
})
