import * as React from 'react'
import { memo } from 'react'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { Box, Text } from '../../ink.js'
import { truncatePathMiddle, truncateToWidth } from '../../utils/format.js'
import type { Theme } from '../../utils/theme.js'

export type SuggestionItem = {
  id: string
  displayText: string
  tag?: string
  description?: string
  metadata?: unknown
  color?: keyof Theme
  /** If set, renders as a non-selectable group header row */
  groupLabel?: string
}

export type SuggestionType =
  | 'command'
  | 'file'
  | 'composer-at'
  | 'directory'
  | 'agent'
  | 'shell'
  | 'custom-title'
  | 'slack-channel'
  | 'none'

export const OVERLAY_MAX_ITEMS = 8

/**
 * Get icon character for unified suggestion types.
 * Icons: + for files/dirs, ◇ for MCP resources, * for agents/teammates, ⚡ for skills
 */
function getIcon(itemId: string): string {
  if (itemId.startsWith('file-') || itemId.startsWith('dir-')) return '+'
  if (itemId.startsWith('mcp-resource-')) return '◇'
  if (itemId.startsWith('agent-') || itemId.startsWith('teammate-')) return '*'
  if (itemId.startsWith('skill-')) return '⚡'
  if (itemId.startsWith('dm-')) return '@'
  return '+'
}

/**
 * Check if an item uses the unified (icon + path/description) rendering
 * versus the legacy command rendering (padded columns + tag).
 */
function isUnifiedSuggestion(itemId: string): boolean {
  return (
    itemId.startsWith('file-') ||
    itemId.startsWith('mcp-resource-') ||
    itemId.startsWith('agent-') ||
    itemId.startsWith('teammate-') ||
    itemId.startsWith('skill-') ||
    itemId.startsWith('dir-') ||
    itemId.startsWith('dm-')
  )
}

type RowProps = {
  item: SuggestionItem
  maxColumnWidth?: number
  isSelected: boolean
}

const SuggestionItemRow = memo(function SuggestionItemRow({
  item,
  maxColumnWidth,
  isSelected,
}: RowProps) {
  const { columns } = useTerminalSize()

  // Group header row — dim, non-selectable
  if (item.groupLabel) {
    return (
      <Box paddingLeft={1}>
        <Text color="gray" dimColor wrap="truncate">
          {item.groupLabel}
        </Text>
      </Box>
    )
  }

  const unified = isUnifiedSuggestion(item.id)

  if (unified) {
    const icon = getIcon(item.id)
    const textColor = isSelected ? ('suggestion' as const) : (item.color ?? undefined)
    const dim = !isSelected && !item.color

    let displayText = item.displayText
    if (item.id.startsWith('file-') || item.id.startsWith('dir-')) {
      const descReserve = item.description ? Math.min(20, stringWidth(item.description)) : 0
      const maxPath = columns - 2 - 4 - (item.description ? 3 : 0) - descReserve
      displayText = truncatePathMiddle(item.displayText, Math.max(20, maxPath))
    } else if (item.id.startsWith('mcp-resource-')) {
      displayText = truncateToWidth(item.displayText, 30)
    }

    let line: string
    if (item.description) {
      const avail = columns - 2 - stringWidth(displayText) - 3 - 4
      const truncatedDesc = truncateToWidth(
        item.description.replace(/\s+/g, ' '),
        Math.max(0, avail),
      )
      line = `${icon} ${displayText} – ${truncatedDesc}`
    } else {
      line = `${icon} ${displayText}`
    }

    return (
      <Text color={textColor} dimColor={dim} wrap="truncate">
        {line}
      </Text>
    )
  }

  // Legacy command/custom-title rendering with aligned columns
  const maxNameWidth = Math.floor(columns * 0.4)
  const width = Math.min(maxColumnWidth ?? stringWidth(item.displayText) + 5, maxNameWidth)
  const textColor = item.color || (isSelected ? ('suggestion' as const) : undefined)
  const dim = !isSelected

  let displayText = item.displayText
  if (stringWidth(displayText) > width - 2) {
    displayText = truncateToWidth(displayText, width - 2)
  }
  const padded = displayText + ' '.repeat(Math.max(0, width - stringWidth(displayText)))
  const tagText = item.tag ? `[${item.tag}] ` : ''
  const descWidth = Math.max(0, columns - width - stringWidth(tagText) - 4)

  const truncatedDesc = item.description
    ? truncateToWidth(item.description.replace(/\s+/g, ' '), descWidth)
    : ''

  return (
    <Text wrap="truncate">
      <Text color={textColor} dimColor={dim}>
        {padded}
      </Text>
      {tagText ? <Text dimColor>{tagText}</Text> : null}
      {truncatedDesc ? (
        <Text color={isSelected ? 'suggestion' : undefined} dimColor={dim}>
          {truncatedDesc}
        </Text>
      ) : null}
    </Text>
  )
})

type Props = {
  suggestions: SuggestionItem[]
  selectedSuggestion: number
  maxColumnWidth?: number
  overlay?: boolean
}

export function PromptInputFooterSuggestions({
  suggestions,
  selectedSuggestion,
  maxColumnWidth: maxColProp,
  overlay,
}: Props) {
  const { rows } = useTerminalSize()
  const maxVisible = overlay
    ? OVERLAY_MAX_ITEMS
    : Math.min(8, Math.max(1, rows - 3))

  if (suggestions.length === 0) return null

  const maxColumnWidth =
    maxColProp ?? Math.max(...suggestions.map(s => stringWidth(s.displayText))) + 5

  // Scroll window to keep selected item visible
  const start = Math.max(
    0,
    Math.min(selectedSuggestion - Math.floor(maxVisible / 2), suggestions.length - maxVisible),
  )
  const end = Math.min(start + maxVisible, suggestions.length)
  const visible = suggestions.slice(start, end)

  return (
    <Box flexDirection="column" justifyContent={overlay ? undefined : 'flex-end'}>
      {visible.map(item => (
        <SuggestionItemRow
          key={item.id}
          item={item}
          maxColumnWidth={maxColumnWidth}
          isSelected={!item.groupLabel && item.id === suggestions[selectedSuggestion]?.id}
        />
      ))}
    </Box>
  )
}

export default memo(PromptInputFooterSuggestions)
