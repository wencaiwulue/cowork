# PRD: Composer @ and / Redesign

## Background
The CLI composer's `@` and `/` triggers have functional bugs and poor UX compared to ChatGPT Desktop:
1. **Bug**: Typing `@` with any team member present shows only teammates and returns early, blocking file/agent/skill/MCP suggestions entirely
2. **Missing categories**: CLI `@` menu lacks Skills and MCP server suggestions that exist in desktop
3. **No grouping**: `/` dumps 100+ commands in a flat list; `@` mixes files and agents without visual separation
4. **Inconsistent trigger detection**: Multiple scattered regexes with different behavior across contexts
5. **Desktop parity gap**: Desktop has a polished grouped menu with icons, descriptions, and categories that CLI lacks

## User Stories

### US-1: Unified @ Menu (Grouped)
**As a user**, when I type `@`, I see a categorized dropdown menu showing:
- Teammates (if in swarm mode) — send message
- Agents (subagent types) — spawn agent
- Files (from workspace index) — attach file context
- Skills (custom commands) — @skill:name syntax
- MCP Resources — attach MCP resource

**Acceptance Criteria:**
- [ ] Typing `@` shows ALL categories simultaneously, not just teammates
- [ ] Typing `@foo` filters across ALL categories
- [ ] Items are visually grouped with section headers
- [ ] Each item shows icon + label + description
- [ ] Up/down arrows navigate across groups, skipping headers
- [ ] Tab/Enter selects highlighted item and inserts proper syntax
- [ ] ESC dismisses menu

### US-2: Unified / Menu (Grouped Commands)
**As a user**, when I type `/`, I see categorized commands:
- Recent (most frequently used skills/commands)
- Commands (built-in local/local-jsx commands)
- Skills & Workflows (user/project prompt commands)

**Acceptance Criteria:**
- [ ] Typing `/` shows grouped commands (not flat 100+ list)
- [ ] Typing `/com` filters across groups
- [ ] Recently used skills appear first
- [ ] Command argument hints still work after selection
- [ ] Selecting a command completes it and adds trailing space

### US-3: Consistent Trigger Detection
**As a user**, `@` and `/` trigger reliably regardless of cursor position or surrounding text.

**Acceptance Criteria:**
- [ ] Triggers fire at start of input OR after whitespace
- [ ] `/path/to/file` does NOT trigger command menu (requires leading whitespace or BOL)
- [ ] Quoted paths `@"file with spaces"` work for file selection
- [ ] Mid-input `/command` (e.g., "fix this /commit") shows ghost text completion
- [ ] Mid-input `@file` shows file suggestions
- [ ] Cursor movement doesn't dismiss the menu incorrectly

### US-4: Keyboard Navigation
**As a power user**, I can navigate and select entirely with keyboard.

**Acceptance Criteria:**
- [ ] ↑/↓ move selection (skipping group headers)
- [ ] Tab accepts current selection / completes common prefix
- [ ] Enter accepts and submits if no menu, or selects if menu open
- [ ] ESC dismisses menu
- [ ] Arrow keys don't dismiss when menu is active

### US-5: Parity with Desktop
The CLI behavior should match desktop where technically feasible (terminal constraints apply).

**Acceptance Criteria:**
- [ ] Same group ordering: @ → Agents, Teams, Files, Skills, MCP
- [ ] Same filter logic (case-insensitive substring match)
- [ ] Same insertion behavior (replaces trigger token, adds trailing space)

## Non-Goals (Out of Scope)
- Mouse/click support (terminal limitation)
- Icons beyond ASCII/Unicode characters (terminal limitation)
- Changing the underlying command execution or attachment parsing
- Slash command argument autocomplete (existing system preserved)
- Slack #channel suggestions (separate feature, kept as-is)

## MVP Scope
All of US-1 through US-5. This is a focused redesign of the suggestion system.
