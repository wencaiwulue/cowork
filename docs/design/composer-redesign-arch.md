# Architecture Design: Composer @ and / Redesign

## Module Boundaries

### New Module: `src/utils/suggestions/composerTrigger.ts`
**Responsibility**: Unified trigger detection for `@` and `/` symbols.
- Pure functions, no React dependencies, no side effects
- Export: `detectComposerTrigger(input, cursor)` → `ComposerTrigger | undefined`
- Export: `applyComposerSuggestion(input, cursor, trigger, value)` → `{input, cursor}`
- Single source of truth replacing: `HAS_AT_SYMBOL_RE`, `DM_MEMBER_RE`, `/(^|\s)@([\w-]*)$/`, `findMidInputSlashCommand` regex fragments

**Data contract**:
```ts
type ComposerTrigger = {
  kind: '@' | '/'
  query: string       // text after trigger symbol (filter string)
  start: number       // position of trigger symbol
  end: number         // end of token (may extend past cursor for path chars)
  token: string       // full token including symbol
}
```

### New Module: `src/utils/suggestions/groupedSuggestions.ts`
**Responsibility**: Generate categorized suggestion groups for `@` and `/` triggers.
- Pure functions, take data (commands, agents, resources, etc.), return grouped items
- Export: `generateAtSuggestions(query, agents, mcpResources, teammates, skills, showOnEmpty)` → `GroupedSuggestionsResult`
- Export: `generateSlashSuggestions(query, commands)` → `GroupedSuggestionsResult`

**Data contract**:
```ts
type SuggestionGroup = { id: string; label: string; items: SuggestionItem[]; priority: number }
type GroupedSuggestionsResult = { groups: SuggestionGroup[]; allItems: SuggestionItem[] }
```

Group ordering (priority 0 = first):
- @ trigger: Teammates(0) → Agents(1) → Files(2) → MCP Resources(3) → Skills(4)
- / trigger: Recent(0) → Commands(1) → Skills & Workflows(2) → Other(3)

**Item IDs use prefixes for icon routing**:
- `teammate-<name>` → @ icon
- `agent-<type>` → * icon
- `file-<path>` → + icon
- `mcp-resource-<server>__<uri>` → ◇ icon
- `skill-<source>-<name>` → ⚡ icon

### Modified Module: `src/components/PromptInput/PromptInputFooterSuggestions.tsx`
**Changes**:
- Add optional `groupLabel?: string` field to `SuggestionItem`
- When `groupLabel` is set, render as a dim section header row (not selectable)
- Update icon detection for new prefixes (teammate-, skill-)
- Export both named and default export
- Clean rewrite from compiled React Compiler output to readable TSX

### Modified Module: `src/hooks/useTypeahead.tsx`
**Changes**:
- Add import for new modules
- Insert unified trigger detection AT THE START of `updateSuggestions`, before all old regex-based checks
- When composer trigger detected:
  - For `@`: call `generateAtSuggestions` with gathered data, flatten groups with headers, set suggestions
  - For `/` (at position 0): call `generateSlashSuggestions`, flatten groups, set suggestions
  - Return early (old code paths don't run for these triggers)
- Add `firstSelectableIndex()` helper to skip group headers
- Add `findNextSelectable(current, direction)` for up/down navigation
- Update `getPreservedSelection()` to skip group headers
- Update Tab handler default index from `0` to `firstSelectableIndex(suggestions)`
- **Keep existing code paths intact** for: shell completion, directory completion, /resume custom-title, Slack #channel, bash mode, mid-input slash ghost text. These are NOT replaced.

## Data Flow

```
User types "@" or "/"
       ↓
useTypeahead.updateSuggestions()
       ↓
detectComposerTrigger(input, cursor) → trigger?
       ↓ Yes
kind === '@'? → generateAtSuggestions(query, agents, mcpResources, teammates, skills)
kind === '/'? → generateSlashSuggestions(query, commands)
       ↓
flattenGroups(groups) → flat SuggestionItem[] with __group__ headers interspersed
       ↓
setSuggestionsState({ suggestions: flat, selectedSuggestion: firstSelectableIndex(flat) })
       ↓
PromptInputFooterSuggestions renders:
  - Group header rows (dim, non-selectable)
  - Item rows (icon + label + description)
       ↓
User navigates ↑↓ (findNextSelectable skips headers)
       ↓
User presses Tab/Enter → applyComposerSuggestion replaces token
```

## Key Design Decisions

1. **New code path runs FIRST, returns early**: The new unified trigger handling is inserted at the top of `updateSuggestions` and returns before reaching the old scattered regex checks. This avoids conflicts. Old code paths remain untouched for non-composer scenarios (bash mode, /add-dir, /resume, Slack #, etc.)

2. **Group headers as special SuggestionItems**: Rather than redesigning the data flow, group headers are inserted as items with `groupLabel` set and IDs starting with `__group__`. Navigation and selection code filters these out. This minimizes changes to the rendering pipeline.

3. **Skills derived from commands**: Instead of accessing state.skills (which doesn't exist), skills are derived from the existing `commands` array by filtering for `type === 'prompt'`. The same commands already power slash command suggestions.

4. **File suggestions reuse existing infrastructure**: `generateFileSuggestions` from `fileSuggestions.ts` (Rust/nucleo index) is called directly, preserving the fast fuzzy file search.

5. **displayText convention**: @ trigger items have plain displayText (no @ prefix); the prefix is added during insertion by `applyComposerSuggestion`. / trigger items include the `/` prefix (matching existing `applyCommandSuggestion` convention).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Old code paths conflict with new trigger detection | New code returns early; runs only when composer trigger is detected |
| Group headers break keyboard nav | findNextSelectable + firstSelectableIndex skip __group__ items |
| File index not ready on first @ | generateFileSuggestions already handles this gracefully (returns []) |
| Large command lists cause lag | Groups limited to 6-8 items each, total capped at 20 |
| TypeScript errors in refactored file | Compile check after each change; existing code paths untouched |
