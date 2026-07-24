export type NdjsonParser = {
  push(chunk: string | Buffer): void
  flush(): void
}

export function createNdjsonParser(
  onMessage: (message: unknown) => void,
  onMalformedLine?: (line: string, error: unknown) => void,
): NdjsonParser {
  let buffer = ''

  function parseLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      onMessage(JSON.parse(trimmed) as unknown)
    } catch (error) {
      onMalformedLine?.(line, error)
    }
  }

  return {
    push(chunk) {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        parseLine(line)
      }
    },
    flush() {
      const pending = buffer
      buffer = ''
      parseLine(pending)
    },
  }
}
