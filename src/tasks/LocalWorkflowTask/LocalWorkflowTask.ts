import type { AppState } from 'src/state/AppState.js'

export type LocalWorkflowTaskState = {
  type: 'local_workflow'
  id: string
  status: 'running' | 'pending' | 'completed' | 'failed' | string
  description: string
  summary?: string
  startTime?: number
  isBackgrounded?: boolean
  [key: string]: any
}

type SetAppState = (updater: (prev: AppState) => AppState) => void

export function killWorkflowTask(
  _taskId: string,
  _setAppState: SetAppState,
): void {}

export function skipWorkflowAgent(
  _taskId: string,
  _agentId: string,
  _setAppState: SetAppState,
): void {}

export function retryWorkflowAgent(
  _taskId: string,
  _agentId: string,
  _setAppState: SetAppState,
): void {}
