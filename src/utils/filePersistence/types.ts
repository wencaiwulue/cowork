export const DEFAULT_UPLOAD_CONCURRENCY = 4
export const FILE_COUNT_LIMIT = 1000
export const OUTPUTS_SUBDIR = 'outputs'

export type TurnStartTime = number

export type PersistedFile = {
  filename: string
  file_id: string
  path?: string
  fileId?: string
  sizeBytes?: number
}

export type FailedPersistence = {
  filename: string
  path?: string
  error: string
}

export type FilesPersistedEventData = {
  files: PersistedFile[]
  failed: FailedPersistence[]
  durationMs?: number
}

export type FilePersistenceOutput = Record<string, unknown>
export type FilePersistenceState = Record<string, unknown>
