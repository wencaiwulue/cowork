import type { SystemTheme } from './systemTheme.js'

export function subscribeToSystemThemeChanges(
  _querier: unknown,
  _callback: (theme: SystemTheme) => void,
): () => void {
  return () => {}
}
export const watchSystemTheme = subscribeToSystemThemeChanges
