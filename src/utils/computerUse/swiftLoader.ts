export type ComputerUseAPI = {
  _drainMainRunLoop(): void
  apps: {
    prepareDisplay(
      allowlistBundleIds: string[],
      hostBundleId: string,
      displayId?: number,
    ): Promise<{ activated?: string; hidden: string[] }>
    previewHideSet(
      allowlistBundleIds: string[],
      displayId?: number,
    ): Promise<Array<{ bundleId: string; displayName: string }>>
    findWindowDisplays(
      bundleIds: string[],
    ): Promise<Array<{ bundleId: string; displayIds: number[] }>>
    appUnderPoint(
      x: number,
      y: number,
    ): Promise<{ bundleId: string; displayName: string } | null>
    listInstalled(): Promise<
      Array<{ bundleId: string; displayName: string; path?: string }>
    >
    iconDataUrl(path: string): Promise<string | null>
    listRunning(): Promise<Array<{ bundleId: string; displayName: string }>>
    open(bundleId: string): Promise<void>
    unhide(bundleIds: string[]): Promise<void>
  }
  display: {
    getSize(displayId?: number): {
      width: number
      height: number
      scaleFactor: number
      displayId?: number
    }
    listAll(): Promise<
      Array<{
        width: number
        height: number
        scaleFactor: number
        displayId?: number
      }>
    >
  }
  screenshot: {
    captureExcluding(
      allowedBundleIds: string[],
      quality: number,
      width: number,
      height: number,
      displayId?: number,
    ): Promise<{ base64: string; width: number; height: number }>
    captureRegion(
      allowedBundleIds: string[],
      x: number,
      y: number,
      w: number,
      h: number,
      width: number,
      height: number,
      quality: number,
      displayId?: number,
    ): Promise<{ base64: string; width: number; height: number }>
  }
  hotkey?: {
    register?(...args: any[]): Promise<void> | void
    unregister?(...args: any[]): Promise<void> | void
    registerEscape?(...args: any[]): Promise<void> | void
    notifyExpectedEscape?(...args: any[]): Promise<void> | void
  }
  tcc?: {
    hasAccessibilityPermission?(): Promise<boolean> | boolean
    hasScreenCapturePermission?(): Promise<boolean> | boolean
  }
  resolvePrepareCapture(
    allowedBundleIds: string[],
    hostBundleId: string,
    quality: number,
    width: number,
    height: number,
    displayId: number | undefined,
    autoResolve: boolean,
    doHide?: boolean,
  ): Promise<Record<string, unknown>>
}

let cached: ComputerUseAPI | undefined

/**
 * Package's js/index.js reads COMPUTER_USE_SWIFT_NODE_PATH (baked by
 * build-with-plugins.ts on darwin targets, unset otherwise — falls through to
 * the node_modules prebuilds/ path). We cache the loaded native module.
 *
 * The four @MainActor methods (captureExcluding, captureRegion,
 * apps.listInstalled, resolvePrepareCapture) dispatch to DispatchQueue.main
 * and will hang under libuv unless CFRunLoop is pumped — call sites wrap
 * these in drainRunLoop().
 */
export function requireComputerUseSwift(): ComputerUseAPI {
  if (process.platform !== 'darwin') {
    throw new Error('@ant/computer-use-swift is macOS-only')
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (cached ??= require('@ant/computer-use-swift') as ComputerUseAPI)
}
