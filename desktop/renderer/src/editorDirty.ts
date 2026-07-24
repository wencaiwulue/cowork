export type EditorDirtyInput = {
  activeFile?: string
  fileContents: string
  savedFileContents: string
  modelValue?: string
}

export function editorHasUnsavedChanges(input: EditorDirtyInput): boolean {
  if (!input.activeFile) return false
  return (input.modelValue ?? input.fileContents) !== input.savedFileContents
}

export function currentEditorContents(
  input: Pick<EditorDirtyInput, 'fileContents' | 'modelValue'>,
): string {
  return input.modelValue ?? input.fileContents
}

export function shouldSyncSavedEditorModel(input: {
  activeFile?: string
  modelPath?: string
  modelValue?: string
  savedContents: string
}): boolean {
  return Boolean(
    input.activeFile &&
    input.modelPath === input.activeFile &&
    input.modelValue !== undefined &&
    input.modelValue !== input.savedContents,
  )
}

export function shouldApplyLoadedEditorContents(input: EditorDirtyInput & {
  loadedFile?: string
  modelPath?: string
}): boolean {
  if (!input.activeFile || input.loadedFile !== input.activeFile) return true
  if (input.modelPath && input.modelPath !== input.activeFile) return true
  return !editorHasUnsavedChanges(input)
}
