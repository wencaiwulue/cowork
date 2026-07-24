export function projectSnipMessages<T>(messages: T): T {
  return messages
}

export function projectSnippedView<T>(messages: T[]): T[] {
  return messages
}

export function isSnipMarkerMessage(_message: unknown): boolean {
  return false
}

export function isSnipBoundaryMessage(_message: unknown): boolean {
  return false
}
