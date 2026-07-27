export type ComposerKeyLike = {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  keyCode?: number
  which?: number
}

export function shouldSubmitComposerKey(event: ComposerKeyLike): boolean {
  const composingKeyCode = event.keyCode === 229 || event.which === 229
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composingKeyCode
}
