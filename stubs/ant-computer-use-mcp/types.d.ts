export type CoordinateMode = 'api' | 'screen' | 'pixels'
export type CuSubGates = Record<string, boolean>
export type ScreenshotDims = {
  width: number
  height: number
  displayWidth?: number
  displayHeight?: number
  displayId?: number
  originX?: number
  originY?: number
}
export type CuPermissionRequest = {
  tccState?: { accessibility?: boolean; screenRecording?: boolean }
  apps?: Array<{ name?: string; displayName?: string; bundleId?: string }>
}
export type CuPermissionResponse = {
  granted: string[]
  denied: string[]
  flags: Record<string, unknown>
}
export type Logger = {
  silly?(message: string, ...args: unknown[]): void
  debug?(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}
export type ComputerUseHostAdapter = Record<string, unknown>
export const DEFAULT_GRANT_FLAGS: Record<string, unknown>
