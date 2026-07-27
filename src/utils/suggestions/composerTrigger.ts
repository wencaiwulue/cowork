/**
 * Unified composer trigger detection for @ and / symbols.
 *
 * Single source of truth replacing the scattered regexes previously in useTypeahead:
 *   - HAS_AT_SYMBOL_RE for @ file detection
 *   - /(^|\s)@([\w-]*)$/ for teammate/agent detection
 *   - findMidInputSlashCommand for / detection
 *
 * Design doc: docs/design/composer-redesign-arch.md
 */

export type ComposerTriggerKind = '@' | '/'

export type ComposerTrigger = {
  kind: ComposerTriggerKind
  /** The text the user typed after the trigger symbol (filter/search query) */
  query: string
  /** Start position of the trigger symbol in the input */
  start: number
  /** End position of the full trigger token (may extend past cursor) */
  end: number
  /** The full trigger token including the symbol */
  token: string
}

/**
 * Unicode-aware character class for tokens following @ or /.
 * \p{L} = letters (CJK, Latin, Cyrillic, etc.)
 * \p{N} = numbers
 * \p{M} = combining marks (NFD accents)
 * Also includes path characters: _ - . / \ ( ) [ ] ~ :
 */
const TOKEN_CONTINUE_RE = /^[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*/u

/**
 * Detect an @ or / trigger at or before the cursor.
 *
 * Trigger fires when:
 * - `@` or `/` appears at start of input OR after whitespace
 * - Cursor is at or immediately after the trigger + its query text
 *
 * Supports quoted form: @"path with spaces"
 *
 * Returns undefined if no trigger is active.
 */
export function detectComposerTrigger(
  input: string,
  cursor: number,
): ComposerTrigger | undefined {
  const boundedCursor = Math.max(0, Math.min(cursor, input.length))
  const before = input.slice(0, boundedCursor)

  // Check for quoted @ first: @"..." pattern
  const quotedMatch = before.match(/(?:^|\s)(@")([^"]*)$/)
  if (quotedMatch && quotedMatch.index !== undefined) {
    const leadingSpace = quotedMatch[0].startsWith(' ') ? 1 : 0
    const start = quotedMatch.index + leadingSpace
    const query = quotedMatch[2] ?? ''

    // Extend past cursor to closing quote if present
    const after = input.slice(boundedCursor)
    const closeMatch = after.match(/^[^"]*"?/)
    const tokenEnd = closeMatch ? boundedCursor + closeMatch[0].length : input.length

    return {
      kind: '@',
      query,
      start,
      end: tokenEnd,
      token: input.slice(start, tokenEnd),
    }
  }

  // Unquoted trigger: @ or / followed by token characters
  const match = before.match(/(?:^|\s)([@/])([\p{L}\p{N}\p{M}_\-./\\()[\]~:]*)$/u)
  if (!match || match.index === undefined) return undefined

  const symbol = match[1] as ComposerTriggerKind
  const leadingSpace = match[0].startsWith(' ') ? 1 : 0
  const start = match.index + leadingSpace
  const query = match[2] ?? ''

  // Extend token past cursor while continuation characters exist
  const after = input.slice(boundedCursor)
  const continuation = after.match(TOKEN_CONTINUE_RE)
  const tokenEnd = continuation
    ? boundedCursor + continuation[0].length
    : boundedCursor

  return {
    kind: symbol,
    query,
    start,
    end: tokenEnd,
    token: input.slice(start, tokenEnd),
  }
}

/**
 * Apply a selected suggestion value to the input, replacing the trigger token.
 *
 * - For @ triggers: prepends @ to the value (and quotes if value contains spaces)
 * - For / triggers: value already includes / prefix
 * - Always adds a trailing space after insertion
 * - Collapses extra whitespace after the replaced token
 */
export function applyComposerSuggestion(
  input: string,
  _cursor: number,
  trigger: ComposerTrigger,
  value: string,
): { input: string; cursor: number } {
  const before = input.slice(0, trigger.start)
  const after = input.slice(trigger.end).replace(/^\s+/, '')

  let displayValue = value
  if (trigger.kind === '@') {
    if (value.includes(' ') && !value.startsWith('@')) {
      displayValue = `@"${value}"`
    } else if (!value.startsWith('@')) {
      displayValue = `@${value}`
    }
  }

  const replacement = `${displayValue} `
  const newInput = `${before}${replacement}${after}`

  return {
    input: newInput,
    cursor: before.length + replacement.length,
  }
}
