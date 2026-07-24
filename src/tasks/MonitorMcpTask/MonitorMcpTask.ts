import type { AppState } from 'src/state/AppState.js'

export type MonitorMcpTaskState = {
  type: 'monitor_mcp'
  id: string
  status: 'running' | 'pending' | 'completed' | 'failed' | string
  description: string
  startTime?: number
  isBackgrounded?: boolean
  [key: string]: any
}

type SetAppState = (updater: (prev: AppState) => AppState) => void

export function killMonitorMcp(
  _taskId: string,
  _setAppState: SetAppState,
): void {}

export function killMonitorMcpTasksForAgent(
  _agentId: string,
  _getAppState: () => AppState,
  _setAppState: SetAppState,
): void {}
