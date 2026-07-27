# UI/UX Design: Composer @ and / Redesign

## Interaction Flow

### Typing `@` (empty query)
```
> @
  Agents
  * general-purpose    General-purpose agent for tasks and research
  * Explore            Search codebases and explore files
  Files
  + src/               Source directory
  + package.json       Project manifest
  + README.md          Project documentation
  Skills
  ⚡ skill:review       Code review skill
  ⚡ skill:test-gen     Test generation skill
  MCP Servers
  ◇ github:            GitHub MCP server
```

### Typing `@src` (filtered)
```
> @src
  Files
  + src/main.tsx        Entry point
  + src/hooks/          React hooks
  + src/utils/          Utility functions
```

### Typing `/` (empty query)
```
> /
  Recent
  /commit               Commit staged changes
  /review               Review code changes
  Commands
  /clear                Clear terminal
  /config               Configuration settings
  /help                 Show help
  Skills & Workflows
  /review-diff [workflow] Review git changes
  /write-tests          Write tests for current file
```

## Visual Specs (Terminal)

### Group Headers
- Rendered as dim gray text with padding-left: 1
- No icon, no selection highlight
- Text is the group label (e.g., "Agents", "Files", "Commands")
- Uses `color="gray"` and `dimColor`
- Separated from items by visual spacing (inherent in row layout)

### Suggestion Items
- **Format**: `<icon> <displayText> – <description>`
- **Icon**: Single Unicode character:
  - `*` for agents and teammates (cyan/suggestion color when selected)
  - `+` for files and directories
  - `◇` for MCP resources
  - `⚡` for skills
- **displayText**: Bold/colored when selected, dim when not
- **Description**: Dimmed, truncated with ellipsis to fit terminal width
- **Separator**: en-dash `–` between text and description (3 chars wide)

### Selection State
- Selected row: text color = "suggestion" (theme color, usually cyan/blue)
- Unselected rows: dimColor = true
- Group headers: always dim gray, never highlighted

### Layout Constraints
- Max 8 visible items in overlay mode, 8 in footer mode
- Description truncated to remaining terminal width
- File paths use middle-truncation for long paths
- MCP resources truncated to 30 chars
- Minimum 1 item visible

## Keyboard Behavior

| Key | Behavior |
|---|---|
| `@` or `/` typed | Menu appears with first group's first item selected |
| `↓` / `↑` | Move selection to next/prev selectable item (skip group headers) |
| `Tab` | Accept selected suggestion, insert into input, add trailing space |
| `Enter` | If menu open and item selected: accept and keep focus (don't submit yet) |
| `Esc` | Dismiss menu without inserting |
| Typing more chars | Filter results, preserve selection if same item exists |
| Backspace past trigger | Dismiss menu |
| `→` at end / ghost text | Accept ghost text inline completion (mid-input) |
| Click outside | Dismiss menu (N/A in terminal) |

## Ghost Text (Mid-Input)

When `/command` is typed mid-input (e.g., "please /comm"), show inline ghost text:
- Gray suffix showing the completed command name
- Right arrow or Tab accepts it
- This is for quick command insertion, not for file @ mentions

## Color Tokens
- Selected item text: `suggestion` (theme-defined, typically cyan)
- Unselected item text: default with `dimColor`
- Group header: `gray` with `dimColor`
- Separator: follows description color (dim)
- Icons: same color as item text

## Responsive Behavior
- At narrow terminal widths (< 60 cols): hide descriptions, show only icon + text
- At wide terminals (> 120 cols): show full descriptions up to 80 chars
- Minimum width for menu: 20 cols (fallback to just displayText)

## Accessibility
- All items keyboard-navigable
- Selection wraps around (last → first, first → last)
- Visual distinction between selected/unselected (color + brightness)
- Icons supplement text labels, not replace them (redundant coding)
