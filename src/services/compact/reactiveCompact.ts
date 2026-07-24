export function shouldReactiveCompact(): boolean {
  return false
}

export async function maybeReactiveCompact(): Promise<unknown> {
  return undefined
}

export function isReactiveOnlyMode(): boolean {
  return false
}

export function isReactiveCompactEnabled(): boolean {
  return false
}

export function isWithheldPromptTooLong(..._args: any[]): boolean {
  return false
}

export function isWithheldMediaSizeError(..._args: any[]): boolean {
  return false
}

export async function reactiveCompactOnPromptTooLong(..._args: any[]): Promise<any> {
  return { ok: true, result: {} }
}

export async function tryReactiveCompact(..._args: any[]): Promise<any> {
  return { messages: [], didCompact: false }
}
