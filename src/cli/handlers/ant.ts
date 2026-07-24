function antOnly(): never {
  throw new Error('This command is only available in Anthropic internal builds.')
}

export async function logHandler(_logId?: string | number): Promise<never> {
  return antOnly()
}

export async function errorHandler(_number?: number): Promise<never> {
  return antOnly()
}

export async function exportHandler(
  _source: string,
  _outputFile: string,
): Promise<never> {
  return antOnly()
}

export async function taskCreateHandler(
  _subject: string,
  _opts: unknown,
): Promise<never> {
  return antOnly()
}

export async function taskListHandler(_opts: unknown): Promise<never> {
  return antOnly()
}

export async function taskGetHandler(
  _id: string,
  _opts: unknown,
): Promise<never> {
  return antOnly()
}

export async function taskUpdateHandler(
  _id: string,
  _opts: unknown,
): Promise<never> {
  return antOnly()
}

export async function taskDirHandler(_opts: unknown): Promise<never> {
  return antOnly()
}

export async function completionHandler(
  _shell: string,
  _opts: unknown,
  _program: unknown,
): Promise<never> {
  return antOnly()
}
