import { describe, expect, it } from 'vitest'
import {
  currentEditorContents,
  editorHasUnsavedChanges,
  shouldApplyLoadedEditorContents,
  shouldSyncSavedEditorModel,
} from '../renderer/src/editorDirty.ts'

describe('editor dirty state', () => {
  it('uses the Monaco model value when React state is stale', () => {
    expect(editorHasUnsavedChanges({
      activeFile: 'src/app.txt',
      fileContents: 'saved contents',
      savedFileContents: 'saved contents',
      modelValue: 'dirty contents',
    })).toBe(true)
  })

  it('falls back to React editor state before Monaco is ready', () => {
    expect(editorHasUnsavedChanges({
      activeFile: 'src/app.txt',
      fileContents: 'dirty contents',
      savedFileContents: 'saved contents',
    })).toBe(true)
  })

  it('does not mark the editor dirty without an active file', () => {
    expect(editorHasUnsavedChanges({
      fileContents: 'dirty contents',
      savedFileContents: 'saved contents',
      modelValue: 'dirty contents',
    })).toBe(false)
  })

  it('uses the live Monaco model contents when saving before React state catches up', () => {
    expect(currentEditorContents({
      fileContents: 'stale contents',
      modelValue: 'latest contents',
    })).toBe('latest contents')
  })

  it('syncs the active Monaco model after save when it still contains stale contents', () => {
    expect(shouldSyncSavedEditorModel({
      activeFile: 'src/app.txt',
      modelPath: 'src/app.txt',
      modelValue: '',
      savedContents: 'latest contents',
    })).toBe(true)
  })

  it('does not sync a Monaco model for another file after save', () => {
    expect(shouldSyncSavedEditorModel({
      activeFile: 'src/app.txt',
      modelPath: 'src/other.txt',
      modelValue: '',
      savedContents: 'latest contents',
    })).toBe(false)
  })

  it('does not apply async loaded contents over unsaved edits in the same Monaco model', () => {
    expect(shouldApplyLoadedEditorContents({
      activeFile: 'src/app.txt',
      loadedFile: 'src/app.txt',
      fileContents: 'edited contents',
      savedFileContents: '',
      modelPath: 'src/app.txt',
      modelValue: 'edited contents',
    })).toBe(false)
  })

  it('applies async loaded contents when the active editor is still clean', () => {
    expect(shouldApplyLoadedEditorContents({
      activeFile: 'src/app.txt',
      loadedFile: 'src/app.txt',
      fileContents: '',
      savedFileContents: '',
      modelPath: 'src/app.txt',
      modelValue: '',
    })).toBe(true)
  })
})
