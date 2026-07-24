import { describe, expect, it } from 'vitest'

describe('desktop smoke diagnostics', () => {
  it('includes the caller phase when collecting Electron startup diagnostics', async () => {
    const { collectElectronStartupDiagnostics } = await import('../scripts/smokeDiagnostics.mjs')
    const diagnostics = collectElectronStartupDiagnostics({
      app: {
        isReady: () => true,
        isPackaged: false,
      },
      BrowserWindow: {
        getAllWindows: () => [{
          getTitle: () => 'Claude Code Desktop',
          isDestroyed: () => false,
          isVisible: () => true,
          isMinimized: () => false,
          webContents: {
            isDestroyed: () => false,
            getURL: () => 'app://desktop/index.html',
          },
        }],
      },
    }, 'initial window')

    expect(diagnostics).toEqual({
      phase: 'initial window',
      isReady: true,
      isPackaged: false,
      windowCount: 1,
      windows: [{
        title: 'Claude Code Desktop',
        isDestroyed: false,
        isVisible: true,
        isMinimized: false,
        url: 'app://desktop/index.html',
        webContentsDestroyed: false,
      }],
    })
  })

  it('detects renderer asset text rendered as the page body', async () => {
    const { classifyRendererShellState } = await import('../scripts/smokeDiagnostics.mjs')

    expect(classifyRendererShellState({
      url: 'file:///repo/desktop/dist/renderer/assets/index-abc123.js',
      hasRoot: false,
      hasShell: false,
      rootChildCount: 0,
      bodyText: 'function App(){return jsx("main",{className:"desktop-shell"})}',
    })).toEqual({
      ok: false,
      reason: 'asset-text-rendered',
    })

    expect(classifyRendererShellState({
      url: 'file:///repo/desktop/dist/renderer/index.html',
      hasRoot: true,
      hasShell: true,
      rootChildCount: 1,
      bodyText: 'Claude Code Desktop',
    })).toEqual({
      ok: true,
      reason: 'desktop-shell-rendered',
    })
  })
})
