export function classifyRendererShellState(state) {
  const bodyText = state.bodyText ?? state.bodySample ?? ''
  const loadedAssetUrl = /\/assets\/.*\.(?:js|css)(?:$|[?#])/.test(state.url ?? '')
  const renderedAssetText =
    !state.hasShell &&
    (
      loadedAssetUrl ||
      /^\s*(?:function|import|export|\.|:root|body\s*\{)/.test(bodyText) ||
      bodyText.includes('className:"desktop-shell"') ||
      bodyText.includes('.desktop-shell{')
    )

  if (renderedAssetText) {
    return { ok: false, reason: 'asset-text-rendered' }
  }

  if (state.hasRoot && state.hasShell && state.rootChildCount > 0) {
    return { ok: true, reason: 'desktop-shell-rendered' }
  }

  return { ok: false, reason: 'desktop-shell-missing' }
}

export function collectElectronStartupDiagnostics({ BrowserWindow, app: electronApp }, phase) {
  const windows = BrowserWindow.getAllWindows()
  return {
    phase,
    isReady: electronApp.isReady(),
    isPackaged: electronApp.isPackaged,
    windowCount: windows.length,
    windows: windows.map(window => ({
      title: window.getTitle(),
      isDestroyed: window.isDestroyed(),
      isVisible: window.isVisible(),
      isMinimized: window.isMinimized(),
      url: window.webContents.isDestroyed() ? '' : window.webContents.getURL(),
      webContentsDestroyed: window.webContents.isDestroyed(),
    })),
  }
}
