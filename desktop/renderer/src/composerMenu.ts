export type ComposerTrigger = {
  kind: '@' | '/'
  query: string
  start: number
  end: number
}

export type ComposerMenuInsertion = {
  input: string
  cursor: number
  value: string
}

export function composerTrigger(
  input: string,
  cursor: number,
): ComposerTrigger | undefined {
  const boundedCursor = Math.max(0, Math.min(cursor, input.length))
  const before = input.slice(0, boundedCursor)
  const match = /(?:^|\s)([@/])([^\s@/]*)$/.exec(before)
  if (!match || match.index === undefined) return undefined
  const triggerChar = match[1] as '@' | '/'
  const leadingSpace = match[0].startsWith(' ') ? 1 : 0
  const start = match.index + leadingSpace
  const query = match[2] ?? ''
  return {
    kind: triggerChar,
    query,
    start,
    end: boundedCursor,
  }
}

export function applyComposerMenuValue(
  insertion: ComposerMenuInsertion,
): { input: string; cursor: number } {
  const trigger =
    composerTrigger(insertion.input, insertion.cursor) ??
    composerTrigger(insertion.input, insertion.input.length)
  if (!trigger) {
    return insertion
  }
  const suffix = insertion.input.slice(trigger.end).replace(/^\s+/, '')
  const nextInput = `${insertion.input.slice(0, trigger.start)}${insertion.value} ${suffix}`
  return {
    input: nextInput,
    cursor: trigger.start + insertion.value.length + 1,
  }
}
