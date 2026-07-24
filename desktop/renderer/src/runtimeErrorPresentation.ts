export type RuntimeErrorPresentation = {
  error: string
  terminalOutput?: string
  terminalStatus?: { kind: 'error'; text: string }
}

export function runtimeErrorPresentation(message: string): RuntimeErrorPresentation {
  return { error: message }
}
