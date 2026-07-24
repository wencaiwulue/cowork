import type { App } from 'electron'

export type SmokeEventApp = App & {
  __claudeDesktopSmokeEvents?: unknown[]
  __claudeDesktopSmokeIpcCalls?: Record<string, number>
  __claudeDesktopSmokeIpcArgs?: Record<string, unknown[]>
}

export function recordSmokeDesktopEvent(
  app: SmokeEventApp,
  event: unknown,
  enabled: boolean,
): void {
  if (!enabled) return
  app.__claudeDesktopSmokeEvents ??= []
  app.__claudeDesktopSmokeEvents = [...app.__claudeDesktopSmokeEvents, event].slice(-500)
}

export function recordSmokeIpcCall(
  app: SmokeEventApp,
  channel: string,
  args: unknown[],
  enabled: boolean,
): void {
  if (!enabled) return
  app.__claudeDesktopSmokeIpcCalls ??= {}
  app.__claudeDesktopSmokeIpcCalls[channel] =
    (app.__claudeDesktopSmokeIpcCalls[channel] ?? 0) + 1
  app.__claudeDesktopSmokeIpcArgs ??= {}
  app.__claudeDesktopSmokeIpcArgs[channel] = [
    ...(app.__claudeDesktopSmokeIpcArgs[channel] ?? []),
    args.map(summarizeSmokeIpcArg),
  ].slice(-25)
}

function summarizeSmokeIpcArg(arg: unknown): unknown {
  if (typeof arg === 'string') {
    return arg.length > 220 ? `${arg.slice(0, 220)}...` : arg
  }
  if (arg === null || typeof arg !== 'object') return arg
  if (Array.isArray(arg)) return arg.slice(0, 8).map(summarizeSmokeIpcArg)
  const summary: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(arg).slice(0, 12)) {
    summary[key] = summarizeSmokeIpcArg(value)
  }
  return summary
}
