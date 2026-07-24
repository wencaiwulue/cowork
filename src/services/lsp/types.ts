export type LspServerState = 'starting' | 'running' | 'stopped' | 'failed' | string

export type ScopedLspServerConfig = {
  scope?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  [key: string]: any
}

export type LspServerConfig = ScopedLspServerConfig
