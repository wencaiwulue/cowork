export type StdioServerInfo = Record<string, any> & { type?: 'stdio' }
export type SSEServerInfo = Record<string, any> & { type?: 'sse' }
export type HTTPServerInfo = Record<string, any> & { type?: 'http' }
export type ClaudeAIServerInfo = Record<string, any> & { type?: 'claudeai' }
export type AgentMcpServerInfo = Record<string, any> & { type?: 'agent' }

export type ServerInfo =
  | StdioServerInfo
  | SSEServerInfo
  | HTTPServerInfo
  | ClaudeAIServerInfo
  | AgentMcpServerInfo
  | Record<string, any>

export type MCPViewState = Record<string, any>
