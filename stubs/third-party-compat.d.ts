declare module 'highlight.js' {
  export type getLanguage = any
}

declare module '@anthropic-ai/mcpb' {
  export type McpbManifest = any
  export type McpbManifestAny = any
  export type McpbUserConfigurationOption = any
}

declare module 'vscode-jsonrpc/node.js' {
  export const ErrorCodes: any
  export const Trace: any
  export type MessageConnection = any
  export const StreamMessageReader: any
  export const StreamMessageWriter: any
  export function createMessageConnection(...args: any[]): any
  export class ResponseError<T = any> extends Error {
    constructor(code: number, message: string, data?: T)
    code: number
    data?: T
  }
}
