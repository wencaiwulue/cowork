export type ComputerUseAPI = {
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
declare const api: ComputerUseAPI
export default api
