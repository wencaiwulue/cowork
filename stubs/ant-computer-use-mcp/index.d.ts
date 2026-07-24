import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'

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
export type ComputerUseSessionContext = Record<string, unknown>
export type CuCallToolResult = CallToolResult & {
  telemetry?: Record<string, unknown>
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
export type ComputerExecutor = Record<string, unknown>
export type DisplayGeometry = Record<string, unknown>
export type FrontmostApp = Record<string, unknown>
export type InstalledApp = Record<string, unknown>
export type ResolvePrepareCaptureResult = Record<string, unknown>
export type RunningApp = Record<string, unknown>
export type ScreenshotResult = Record<string, unknown>

export const DEFAULT_GRANT_FLAGS: Record<string, unknown>
export const API_RESIZE_PARAMS: Record<string, unknown>
export function buildComputerUseTools(...args: unknown[]): Tool[]
export function createComputerUseMcpServer(...args: unknown[]): Server
export function bindSessionContext(
  ...args: unknown[]
): (name: string, args: unknown) => Promise<CuCallToolResult>
export function targetImageSize(
  width: number,
  height: number,
  params?: Record<string, unknown>,
): [number, number]
