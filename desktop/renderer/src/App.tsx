import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent as ReactChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import { Terminal } from '@xterm/xterm'
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import {
  Bot,
  Braces,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  FileText,
  Folder,
  GitCompare,
  Globe,
  MoreHorizontal,
  PanelRight,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Square,
  TerminalSquare,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  createPermissionResponse,
  normalizePermissionRequest,
  type NormalizedPermissionRequest,
} from '../../main/permission'
import type {
  ClaudeDesktopConfig,
  AgentDiagnostics,
  AgentInfo,
  AgentLaunchInput,
  AgentListResult,
  AgentSaveInput,
  AgentSource,
  CustomCommandInfo,
  DesktopProxySettings,
  DesktopMessage,
  DesktopSession,
  DesktopSessionLayoutPatch,
  InstalledSkillInfo,
  McpServerInfo,
  McpServerInput,
  ProjectScheduledTaskInfo,
  ProjectScheduledTaskInput,
  RuntimeEvent,
  ScheduledTaskInfo,
  ScheduledTaskInput,
  TeamCreateInput,
  TeamDeleteInput,
  TeamInfo,
  TeamMemberInfo,
  TeamMessageInput,
  TeamShutdownInput,
  TerminalSessionInfo,
  WorkspaceEntry,
} from '../../main/ipc'
import { shouldSubmitComposerKey } from './composerKeys'
import {
  applyComposerMenuValue,
  composerTrigger,
  type ComposerTrigger,
} from './composerMenu'
import {
  currentEditorContents,
  editorHasUnsavedChanges,
  shouldApplyLoadedEditorContents,
  shouldSyncSavedEditorModel,
} from './editorDirty'
import { runtimeErrorPresentation } from './runtimeErrorPresentation'

globalThis.MonacoEnvironment = {
  getWorker() {
    return new Worker(
      new URL(
        'monaco-editor/esm/vs/editor/editor.worker.js',
        import.meta.url,
      ),
      { type: 'module' },
    )
  },
}

type PaneId = DesktopSession['layout']['activePane']
type PrimaryNavView = NonNullable<DesktopSession['layout']['primaryView']>
type DiffLine = { kind: 'add' | 'remove' | 'context' | 'meta'; text: string }
type DiffFile = { path: string; lines: DiffLine[]; additions: number; deletions: number }
type MarkdownBlock =
  | { type: 'code'; language?: string; text: string }
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; text: string }
const MIN_WORKSPACE_RATIO = 0.3
const MAX_WORKSPACE_RATIO = 0.75
const KEYBOARD_RESIZE_STEP = 0.05
const SESSION_RAIL_COLLAPSED_KEY = 'claudeDesktop.sessionRailCollapsed'
const PRIMARY_NAV_SHORTCUTS: Record<string, PrimaryNavView> = {
  '1': 'chat',
  '2': 'agents',
  '3': 'teams',
  '4': 'tasks',
  '5': 'mcp',
  '6': 'skills',
  '7': 'settings',
}
const WORKSPACE_PANE_SHORTCUTS: Record<string, PaneId> = {
  '1': 'files',
  '2': 'diff',
  '3': 'editor',
  '4': 'terminal',
  '5': 'preview',
}

function readPersistedSessionRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SESSION_RAIL_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

function derivePrimaryNavView(
  layout?: DesktopSession['layout'],
): PrimaryNavView {
  if (
    layout?.primaryView === 'chat' ||
    layout?.primaryView === 'agents' ||
    layout?.primaryView === 'teams' ||
    layout?.primaryView === 'tasks' ||
    layout?.primaryView === 'mcp' ||
    layout?.primaryView === 'skills' ||
    layout?.primaryView === 'settings'
  ) {
    return layout.primaryView
  }
  if (layout?.primaryView === 'teammates') return 'teams'
  if (layout?.activePane === 'settings') return 'settings'
  if (layout?.activePane === 'tasks') return 'tasks'
  if (layout?.activePane === 'teams') return 'teams'
  if (layout?.activePane === 'agents') return 'agents'
  if (layout?.activePane === 'mcp') return 'mcp'
  if (layout?.activePane === 'skills') return 'skills'
  return 'chat'
}

function primaryViewForPane(pane: PaneId): PrimaryNavView {
  if (pane === 'settings') return 'settings'
  if (pane === 'tasks') return 'tasks'
  if (pane === 'teams') return 'teams'
  if (pane === 'agents') return 'agents'
  if (pane === 'mcp') return 'mcp'
  if (pane === 'skills') return 'skills'
  return 'chat'
}

type McpDraft = {
  editingName?: string
  scope: 'user' | 'project'
  name: string
  mode: 'stdio' | 'remote'
  command: string
  args: string
  type: 'streamable-http' | 'sse'
  url: string
}
type SkillDraft = {
  editingName?: string
  scope: 'user' | 'project'
  name: string
  contents: string
}
type TaskDraft = {
  id?: string
  name: string
  schedule: string
  prompt: string
  enabled: boolean
}
type ProjectTaskDraft = {
  id?: string
  cron: string
  prompt: string
  recurring: boolean
}
type PluginDraft = {
  plugin: string
  scope: 'user' | 'project' | 'local'
}
type McpHealthOutputState = {
  ok: boolean
  text: string
}
type PluginOutputState = {
  ok: boolean
  text: string
}
type AgentDraft = {
  source: 'user' | 'project'
  agentType: string
  whenToUse: string
  prompt: string
  model: string
  permissionMode: string
  tools: string
  disallowedTools: string
  skills: string
  requiredMcpServers: string
  memory: string
  background: boolean
  isolation: '' | 'worktree' | 'remote'
}
type AgentLaunchDraft = {
  description: string
  prompt: string
  agentType: string
  model: string
  permissionMode: string
  runInBackground: boolean
  isolation: '' | 'worktree' | 'remote'
  name: string
  teamName: string
  mode: string
}
type TeamDraft = {
  teamName: string
  description: string
  agentType: string
  teammateAgentType: string
  teammateName: string
  teammateMode: string
  teammatePrompt: string
  to: string
  message: string
  shutdownReason: string
}
type ChatTarget = {
  type: 'session' | 'team' | 'agent'
  teamName: string
  agentType: string
}
type ParsedMention = {
  kind: 'agent' | 'team' | 'file' | 'skill' | 'mcp'
  value: string
  label: string
  raw: string
  index: number
}
type ComposerMenuItem = {
  id: string
  label: string
  detail: string
  value?: string
  action?: () => void
  disabled?: boolean
  disabledReason?: string
  group?: string
  icon?: IconName
}
type ComposerMenuDivider = { divider: true; label: string }
type ComposerMenuEntry = ComposerMenuItem | ComposerMenuDivider
type CommandPaletteItem = {
  id: string
  label: string
  detail: string
  icon: IconName
  disabled?: boolean
  disabledReason?: string
  run: () => void
}
type DesktopLifecycleAction =
  | 'new-custom-agent'
  | 'new-team'
  | 'new-global-task'
  | 'new-project-task'
  | 'add-mcp-server'
  | 'new-user-skill'
  | 'new-project-skill'
type DesktopSettingsAction =
  | 'general'
  | 'proxy'
  | 'mcp'
  | 'mcp-check'
  | 'skills'
  | 'install-user-skill'
  | 'install-project-skill'
  | 'plugins'
  | 'list-plugins'
  | 'install-plugin'
  | 'refresh'
  | 'diagnostics'
type DesktopTasksAction =
  | 'project'
  | 'global'
  | 'new-project'
  | 'new-global'
  | 'refresh'
type DesktopAgentsAction =
  | 'overview'
  | 'available'
  | 'run'
  | 'custom'
  | 'running'
  | 'new-custom'
  | 'refresh'
type DesktopTeamsAction =
  | 'management'
  | 'new'
  | 'refresh'
type DesktopMcpAction =
  | 'servers'
  | 'add-server'
  | 'check-health'
type DesktopSkillsAction =
  | 'list'
  | 'new-user'
  | 'new-project'
  | 'install-user'
  | 'install-project'
type DesktopPluginsAction =
  | 'settings'
  | 'list'
  | 'install'
  | 'refresh'
type DesktopNavigationEvent =
  | { type: 'primary-nav'; view: 'chat' | 'agents' | 'teams' | 'tasks' | 'mcp' | 'skills' | 'settings' }
  | { type: 'workspace-pane'; pane: 'files' | 'diff' | 'editor' | 'terminal' | 'preview' }
  | { type: 'clear-desktop-transcript-view' }
  | { type: 'lifecycle-action'; action: DesktopLifecycleAction }
  | { type: 'settings-action'; action: DesktopSettingsAction }
  | { type: 'tasks-action'; action: DesktopTasksAction }
  | { type: 'agents-action'; action: DesktopAgentsAction }
  | { type: 'teams-action'; action: DesktopTeamsAction }
  | { type: 'mcp-action'; action: DesktopMcpAction }
  | { type: 'skills-action'; action: DesktopSkillsAction }
  | { type: 'plugins-action'; action: DesktopPluginsAction }
type SessionCreateMenuState = {
  x: number
  y: number
}
type RuntimeTodoItem = {
  id: string
  content: string
  status: string
  priority?: string
}
type SessionMenuState = {
  sessionId: string
  x: number
  y: number
}
type EditorStatus = {
  kind: 'info' | 'success' | 'error'
  text: string
}
type TerminalStatus = {
  kind: 'info' | 'success' | 'error'
  text: string
}
type PreviewStatus = {
  kind: 'info' | 'success' | 'error'
  text: string
}
type DiffStatus = {
  kind: 'info' | 'success' | 'error'
  text: string
}
type PaneStatus = {
  kind: 'info' | 'success' | 'error'
  text: string
}

type RpcMessage = {
  id: string
  sessionId: string
  timestamp: number
  direction: 'incoming' | 'outgoing'
  type: string
  subtype?: string
  raw: unknown
  parsed?: {
    messageType?: string
    toolName?: string
    isToolUse?: boolean
    isToolResult?: boolean
    content?: string
    thinking?: string
  }
}


type ScheduledTaskStatusTarget = 'tasks' | 'settings'
type SessionStatus = {
  kind: 'info' | 'success' | 'error'
  text: string
}
type ConfirmRequest = {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}
type AgentCatalogSourceFilter = 'active' | AgentSource
type IconName =
  | 'bot'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'check'
  | 'clipboard'
  | 'code'
  | 'diff'
  | 'file'
  | 'folder'
  | 'globe'
  | 'more'
  | 'open'
  | 'panel'
  | 'pause'
  | 'edit'
  | 'pencil'
  | 'play'
  | 'plus'
  | 'refresh'
  | 'save'
  | 'search'
  | 'send'
  | 'settings'
  | 'square'
  | 'terminal'
  | 'trash'
  | 'users'
  | 'x'
type SettingsNavItem = {
  sectionId: string
  label: string
  aliases: string[]
  icon: IconName
  pane: Extract<PaneId, 'settings' | 'tasks' | 'mcp' | 'skills'>
}
type SettingsNavGroup = {
  label: string
  items: SettingsNavItem[]
}

const iconComponents: Record<IconName, LucideIcon> = {
  bot: Bot,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  check: Check,
  clipboard: Clipboard,
  code: Braces,
  diff: GitCompare,
  file: FileText,
  folder: Folder,
  globe: Globe,
  more: MoreHorizontal,
  open: ExternalLink,
  panel: PanelRight,
  pause: Pause,
  edit: Pencil,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  refresh: RefreshCw,
  save: Save,
  search: Search,
  send: Send,
  settings: Settings,
  square: Square,
  terminal: TerminalSquare,
  trash: Trash2,
  users: Users,
  x: X,
}
const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: 'General',
    items: [
      {
        sectionId: 'settings-runtime',
        label: 'Runtime',
        aliases: ['Permissions', 'Diagnostics', 'Home'],
        icon: 'settings',
        pane: 'settings',
      },
      {
        sectionId: 'settings-proxy',
        label: 'Configuration',
        aliases: ['Proxy', 'Environment'],
        icon: 'panel',
        pane: 'settings',
      },
    ],
  },
  {
    label: 'Extensions',
    items: [
      {
        sectionId: 'settings-plugins',
        label: 'Plugins',
        aliases: [],
        icon: 'code',
        pane: 'settings',
      },
    ],
  },
]

const agentSourceFilters: Array<{ value: AgentCatalogSourceFilter; label: string }> = [
  { value: 'active', label: 'active agents' },
  { value: 'built-in', label: 'built-in' },
  { value: 'user', label: 'user' },
  { value: 'project', label: 'project' },
  { value: 'local', label: 'local' },
  { value: 'managed', label: 'managed' },
  { value: 'flag', label: 'flag' },
  { value: 'plugin', label: 'plugin' },
]

function emptyAgentDraft(): AgentDraft {
  return {
    source: 'project',
    agentType: '',
    whenToUse: '',
    prompt: '',
    model: '',
    permissionMode: '',
    tools: '',
    disallowedTools: '',
    skills: '',
    requiredMcpServers: '',
    memory: '',
    background: false,
    isolation: '',
  }
}

function allowedIsolation(
  isolation: '' | 'worktree' | 'remote' | undefined,
  canUseRemoteIsolation: boolean,
): '' | 'worktree' | 'remote' {
  if (isolation === 'remote') return canUseRemoteIsolation ? 'remote' : ''
  return isolation === 'worktree' ? 'worktree' : ''
}

function agentDraftFromAgent(
  agent: AgentInfo,
  canUseRemoteIsolation: boolean,
): AgentDraft {
  return {
    source: agent.source === 'user' ? 'user' : 'project',
    agentType: agent.agentType,
    whenToUse: agent.whenToUse,
    prompt: agent.prompt ?? '',
    model: agent.model ?? '',
    permissionMode: agent.permissionMode ?? '',
    tools: agent.tools?.join(', ') ?? '',
    disallowedTools: agent.disallowedTools?.join(', ') ?? '',
    skills: agent.skills?.join(', ') ?? '',
    requiredMcpServers: agent.requiredMcpServers?.join(', ') ?? '',
    memory: agent.memory ?? '',
    background: Boolean(agent.background),
    isolation: allowedIsolation(agent.isolation, canUseRemoteIsolation),
  }
}

function agentInputFromDraft(
  draft: AgentDraft,
  canUseRemoteIsolation: boolean,
): AgentSaveInput {
  return {
    source: draft.source,
    agentType: draft.agentType.trim(),
    whenToUse: draft.whenToUse.trim(),
    prompt: draft.prompt.trim(),
    model: draft.model.trim() || undefined,
    permissionMode: draft.permissionMode.trim() || undefined,
    tools: csvList(draft.tools),
    disallowedTools: csvList(draft.disallowedTools),
    skills: csvList(draft.skills),
    requiredMcpServers: csvList(draft.requiredMcpServers),
    memory: draft.memory.trim() || undefined,
    background: draft.background || undefined,
    isolation: allowedIsolation(draft.isolation, canUseRemoteIsolation) || undefined,
  }
}

function emptyAgentLaunchDraft(): AgentLaunchDraft {
  return {
    description: '',
    prompt: '',
    agentType: '',
    model: '',
    permissionMode: '',
    runInBackground: true,
    isolation: '',
    name: '',
    teamName: '',
    mode: '',
  }
}

function agentLaunchInputFromDraft(
  draft: AgentLaunchDraft,
  canUseRemoteIsolation: boolean,
): AgentLaunchInput {
  return {
    description: draft.description.trim(),
    prompt: draft.prompt.trim(),
    agentType: draft.agentType.trim(),
    model: draft.model.trim() || undefined,
    runInBackground: draft.runInBackground,
    isolation: allowedIsolation(draft.isolation, canUseRemoteIsolation) || undefined,
    name: draft.name.trim() || undefined,
    teamName: draft.teamName.trim() || undefined,
    mode: draft.mode.trim() || undefined,
  }
}

function emptyTeamDraft(): TeamDraft {
  return {
    teamName: '',
    description: '',
    agentType: '',
    teammateAgentType: '',
    teammateName: '',
    teammateMode: '',
    teammatePrompt: '',
    to: '',
    message: '',
    shutdownReason: '',
  }
}

function teamCreateInputFromDraft(draft: TeamDraft): TeamCreateInput {
  return {
    teamName: draft.teamName.trim(),
    description: draft.description.trim() || undefined,
    agentType: draft.agentType.trim() || undefined,
  }
}

function teamTeammateLaunchInputFromDraft(draft: TeamDraft): AgentLaunchInput {
  const teammateName = draft.teammateName.trim()
  return {
    description: `Spawn teammate ${teammateName} in ${draft.teamName.trim()}`,
    prompt: draft.teammatePrompt.trim(),
    agentType: draft.teammateAgentType.trim(),
    runInBackground: true,
    name: teammateName,
    teamName: draft.teamName.trim(),
    mode: draft.teammateMode.trim() || undefined,
  }
}

function teamMessageInputFromDraft(draft: TeamDraft): TeamMessageInput {
  return {
    teamName: draft.teamName.trim(),
    to: draft.to.trim(),
    message: draft.message.trim(),
  }
}

function teamShutdownInputFromDraft(draft: TeamDraft): TeamShutdownInput {
  return {
    teamName: draft.teamName.trim(),
    to: draft.to.trim(),
    reason: draft.shutdownReason.trim() || undefined,
  }
}

function teamDeleteInputFromDraft(draft: TeamDraft): TeamDeleteInput {
  return {
    teamName: draft.teamName.trim(),
  }
}

function csvList(value: string): string[] | undefined {
  const items = value.split(',').map(item => item.trim()).filter(Boolean)
  return items.length ? items : undefined
}

function agentToolsSummary(agent: AgentInfo): string {
  const allowed = agent.tools?.length
    ? `Allowed: ${agent.tools.join(', ')}`
    : 'Allowed: runtime default'
  const disallowed = agent.disallowedTools?.length
    ? `Disallowed: ${agent.disallowedTools.join(', ')}`
    : 'Disallowed: none'
  return `${allowed} · ${disallowed}`
}

function Icon({ name }: { name: IconName }) {
  const Component = iconComponents[name]
  return (
    <Component
      className="glyph"
      data-icon={name}
      aria-hidden="true"
      strokeWidth={1.9}
    />
  )
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts)
}

function messageClass(message: DesktopMessage): string {
  return [
    'message',
    `message-${message.role}`,
    message.streaming ? 'message-streaming' : '',
  ].filter(Boolean).join(' ')
}

function messageRoleLabel(role: DesktopMessage['role']): string {
  switch (role) {
    case 'user':
      return 'You'
    case 'assistant':
      return 'Claude'
    case 'thinking':
      return 'Thinking'
    case 'tool':
      return 'Tool'
    case 'system':
      return 'System'
  }
}

function messageStatusLabel(message: DesktopMessage): string | undefined {
  if (message.role !== 'assistant' && message.role !== 'thinking') return undefined
  if (message.streaming) return 'Streaming'
  return message.role === 'thinking' ? 'Complete' : undefined
}

function messageText(message: DesktopMessage): string {
  return message.text || rawSummary(message.raw)
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  const flushList = () => {
    if (!list.length) return
    blocks.push({ type: 'list', items: list })
    list = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const fence = line.match(/^```([\w.+-]*)\s*$/)
    if (fence) {
      flushParagraph()
      flushList()
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      blocks.push({
        type: 'code',
        language: fence[1] || undefined,
        text: code.join('\n'),
      })
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'heading',
        level: heading[1]!.length <= 2 ? 2 : 3,
        text: heading[2]!.trim(),
      })
      continue
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      list.push(bullet[1]!.trim())
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  flushParagraph()
  flushList()
  return blocks
}

function handleInlineMarkdownLinkClick(
  event: ReactMouseEvent<HTMLAnchorElement>,
  url: string,
  onOpenExternalLink?: (url: string) => void,
): void {
  event.preventDefault()
  onOpenExternalLink?.(url)
}

function renderInlineMarkdown(text: string, onOpenExternalLink?: (url: string) => void) {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`]+`)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    if (match[1]) {
      nodes.push(<code key={`code-${match.index}`}>{match[1].slice(1, -1)}</code>)
    } else if (match[3] && match[4]) {
      nodes.push(
        <a
          key={`link-${match.index}`}
          href={match[4]}
          target="_blank"
          rel="noreferrer"
          onClick={event => handleInlineMarkdownLinkClick(event, match[4], onOpenExternalLink)}
        >
          {match[3]}
        </a>,
      )
    }
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function MessageContent({
  message,
  onCopyCode,
  codeCopied,
  onOpenExternalLink,
}: {
  message: DesktopMessage
  onCopyCode?: (text: string) => void
  codeCopied?: boolean
  onOpenExternalLink?: (url: string) => void
}) {
  const text = messageText(message)
  if (!text) return <pre className="message-plain" />
  if (message.role !== 'assistant' && message.role !== 'thinking') {
    return <pre className="message-plain">{text}</pre>
  }

  const blocks = parseMarkdownBlocks(text)
  return (
    <div className="message-markdown">
      {blocks.length ? blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <pre key={`code-${index}`} className="message-code-block">
              {onCopyCode && (
                <button
                  className="tool-button icon-only message-copy-button code-copy-button"
                  type="button"
                  onClick={() => onCopyCode(block.text)}
                  title={codeCopied ? 'Copied' : 'Copy code'}
                  aria-label={codeCopied ? 'Copied code' : 'Copy code'}
                  data-tooltip={codeCopied ? 'Copied' : 'Copy code'}
                >
                  <Icon name={codeCopied ? 'check' : 'clipboard'} />
                </button>
              )}
              <code>{block.text}</code>
            </pre>
          )
        }
        if (block.type === 'heading') {
          const Heading = block.level === 2 ? 'h2' : 'h3'
          return <Heading key={`heading-${index}`}>{renderInlineMarkdown(block.text, onOpenExternalLink)}</Heading>
        }
        if (block.type === 'list') {
          return (
            <ul key={`list-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item, onOpenExternalLink)}</li>
              ))}
            </ul>
          )
        }
        return <p key={`paragraph-${index}`}>{renderInlineMarkdown(block.text, onOpenExternalLink)}</p>
      }) : <p>{text}</p>}
    </div>
  )
}

function sessionActivityLabel(session?: DesktopSession): string {
  if (!session) return 'idle'
  if (session.activity === 'waiting_permission') return 'waiting for permission'
  if (session.activity === 'cancelling') return 'cancelling'
  if (session.activity !== 'idle') return session.activity
  return session.status
}

function conversationStatusText(session?: DesktopSession): string | undefined {
  if (!session) return undefined
  switch (session.activity) {
    case 'starting':
      return 'Starting Claude Code runtime...'
    case 'sending':
      return 'Sending prompt to Claude...'
    case 'streaming':
      return 'Claude is streaming a response.'
    case 'waiting_permission':
      return 'Claude is waiting for a permission decision.'
    case 'cancelling':
      return 'Cancelling the current turn...'
    case 'idle':
      return undefined
  }
}

function isTurnBusy(session?: DesktopSession): boolean {
  return Boolean(session && session.activity !== 'idle')
}

function canCancelTurn(session?: DesktopSession): boolean {
  return Boolean(
    session &&
    (session.activity === 'sending' ||
      session.activity === 'streaming' ||
      session.activity === 'waiting_permission'),
  )
}

function flattenTree(
  entries: WorkspaceEntry[],
  expandedPaths: Set<string>,
  depth = 0,
): Array<WorkspaceEntry & { depth: number }> {
  return entries.flatMap(entry => {
    const row = { ...entry, depth }
    if (entry.type !== 'directory' || !expandedPaths.has(entry.path)) {
      return [row]
    }
    return [row, ...flattenTree(entry.children ?? [], expandedPaths, depth + 1)]
  })
}

function countWorkspaceFiles(entries: WorkspaceEntry[]): number {
  return entries.reduce((count, entry) => {
    if (entry.type === 'file') return count + 1
    return count + countWorkspaceFiles(entry.children ?? [])
  }, 0)
}

function rawSummary(raw: unknown): string {
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeMenuFilter(value: string): string {
  return value.trim().toLowerCase()
}

function scopedResourceKey(scope: string, name: string): string {
  return `${scope}:${name}`
}

function latestRuntimeTodos(
  events: NonNullable<DesktopSession['toolUses']> = [],
): RuntimeTodoItem[] {
  for (const event of [...events].reverse()) {
    if (!/todo/i.test(event.toolName)) continue
    const input = event.input
    if (!isRecord(input) || !Array.isArray(input.todos)) continue
    return input.todos
      .filter(isRecord)
      .map((todo, index) => ({
        id: stringField(todo.id) ?? `todo-${index}`,
        content: stringField(todo.content) ?? stringField(todo.text) ?? `Todo ${index + 1}`,
        status: stringField(todo.status) ?? 'pending',
        priority: stringField(todo.priority),
      }))
  }
  return []
}

function streamedToolPayload(raw: unknown): { name?: string; input?: unknown } | undefined {
  if (!isRecord(raw)) return undefined
  const event = isRecord(raw.event) ? raw.event : raw
  const block = isRecord(event.content_block) ? event.content_block : undefined
  if (!block) return undefined
  return {
    name: stringField(block.name),
    input: block.input,
  }
}

function latestRuntimeTodosFromMessages(messages: DesktopMessage[] = []): RuntimeTodoItem[] {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'tool') continue
    const payload = streamedToolPayload(message.raw)
    if (!payload?.name || !/todo/i.test(payload.name)) continue
    const input = payload.input
    if (!isRecord(input) || !Array.isArray(input.todos)) continue
    return input.todos
      .filter(isRecord)
      .map((todo, index) => ({
        id: stringField(todo.id) ?? `todo-${index}`,
        content: stringField(todo.content) ?? stringField(todo.text) ?? `Todo ${index + 1}`,
        status: stringField(todo.status) ?? 'pending',
        priority: stringField(todo.priority),
      }))
  }
  return []
}

function toolEventSummary(event: NonNullable<DesktopSession['toolUses']>[number]): string {
  const status = event.status === 'started'
    ? 'running'
    : event.status === 'completed'
      ? 'done'
      : 'failed'
  return `${event.toolName} · ${status}${event.summary ? ` · ${event.summary}` : ''}`
}

function permissionInputRows(input: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(input).map(([key, value]) => [key, rawSummary(value)])
}

function renderPermissionInput(input: Record<string, unknown>): ReactNode {
  const rows = permissionInputRows(input)
  if (!rows.length) {
    return (
      <div className="permission-empty">
        <Icon name="check" />
        <strong>No tool input</strong>
        <span>This permission request did not include structured arguments.</span>
      </div>
    )
  }
  return (
    <dl className="permission-input-grid">
      {rows.map(([key, value]) => (
        <div key={key} className="permission-input-row">
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//.test(url)
}

function isProxyUrl(url: string): boolean {
  return /^(socks5|socks4|http|https):\/\//.test(url.trim())
}

function canSaveProxySettings(proxy: DesktopProxySettings): boolean {
  return !proxy.enabled || isProxyUrl(proxy.url)
}

function isValidCronExpression(expression: string): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ] as const
  return parts.every((part, index) =>
    part.split(',').every(item => isValidCronPart(item, ranges[index][0], ranges[index][1])),
  )
}

function isValidCronPart(part: string, min: number, max: number): boolean {
  const star = part.match(/^\*(?:\/(\d+))?$/)
  if (star) return !star[1] || Number.parseInt(star[1], 10) > 0
  const range = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
  if (range) {
    const start = Number.parseInt(range[1]!, 10)
    const end = Number.parseInt(range[2]!, 10)
    const step = range[3] ? Number.parseInt(range[3], 10) : 1
    return start >= min && end <= max && start <= end && step > 0
  }
  if (/^\d+$/.test(part)) {
    const value = Number.parseInt(part, 10)
    return value >= min && value <= max
  }
  return false
}


function extractRpcMessageInfo(raw: unknown): RpcMessage['parsed'] {
  if (!raw || typeof raw !== 'object') return undefined
  const msg = raw as Record<string, unknown>
  const result: NonNullable<RpcMessage['parsed']> = {}
  
  const type = typeof msg.type === 'string' ? msg.type : undefined
  result.messageType = type
  const subtype = typeof msg.subtype === 'string' ? msg.subtype : undefined
  if (subtype) result.content = subtype

  // Stream events: content_block_start/stop/delta, message_start/stop/delta
  if (type === 'stream_event') {
    const event = msg.event as Record<string, unknown> | undefined
    const eventType = typeof event?.type === 'string' ? event.type : undefined
    const contentBlock = event?.content_block as Record<string, unknown> | undefined
    const delta = event?.delta as Record<string, unknown> | undefined

    if (eventType === 'content_block_start') {
      const blockType = contentBlock?.type
      if (blockType === 'tool_use' || blockType === 'server_tool_use' || blockType === 'mcp_tool_use') {
        result.isToolUse = true
        result.toolName = typeof contentBlock.name === 'string' ? contentBlock.name : 'unknown_tool'
        result.content = `Starting tool: ${result.toolName}`
      } else if (blockType === 'text') {
        result.content = 'Text block started'
      } else if (blockType === 'thinking') {
        result.thinking = ''
        result.content = '[thinking started]'
      }
    } else if (eventType === 'content_block_delta') {
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        result.content = delta.text
      } else if (delta?.type === 'input_json_delta') {
        result.isToolUse = true
        result.content = '...'
      } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        result.thinking = delta.thinking
        result.content = '[thinking]'
      }
    } else if (eventType === 'content_block_stop') {
      const index = typeof event.index === 'number' ? event.index : undefined
      result.content = `Block stopped (index: ${index ?? '?'})`
    } else if (eventType === 'message_delta') {
      const stopReason = delta?.stop_reason
      if (stopReason) result.content = `Message stop reason: ${stopReason}`
    } else if (eventType === 'message_stop') {
      result.content = 'Message complete'
    }
  }
  
  // System/init messages
  if (type === 'system' || type === 'system_init') {
    result.content = typeof msg.message === 'string' ? msg.message : JSON.stringify(msg.message)
  }

  // Permission requests
  if (type === 'permission_request') {
    const request = msg.request as Record<string, unknown> | undefined
    const toolName = typeof request?.tool_name === 'string' ? request.tool_name : undefined
    result.isToolUse = !!toolName
    result.toolName = toolName
    result.content = `Permission: ${request?.description ?? toolName ?? JSON.stringify(request)}`
  }

  // Agent task updates
  if (type === 'agent_task_update') {
    const update = msg.update as Record<string, unknown> | undefined
    const taskStatus = typeof update?.status === 'string' ? update.status : undefined
    const taskId = typeof update?.id === 'string' ? update.id : 'unknown'
    const agentType = typeof update?.agentType === 'string' ? update.agentType : undefined
    result.content = `Agent task ${taskId.slice(0,8)} ${taskStatus ?? 'update'}${agentType ? ` (${agentType})` : ''}`
    if (update?.lastToolName) {
      result.isToolUse = true
      result.toolName = update.lastToolName as string
    }
  }

  // Tool result
  if (type === 'tool_result') {
    result.isToolUse = true
    result.content = typeof msg.result === 'string' ? msg.result.slice(0, 200) : 'tool result received'
  }
  
  // Extract assistant/tool/user message content
  if (type === 'assistant' || type === 'user' || type === 'tool') {
    const message = msg.message as Record<string, unknown> | undefined
    if (message?.content) {
      if (typeof message.content === 'string') {
        result.content = message.content
      } else if (Array.isArray(message.content)) {
        result.content = message.content
          .map((c: Record<string, unknown>) => {
            if (c.type === 'text' && typeof c.text === 'string') return c.text
            if (c.type === 'thinking' && typeof c.thinking === 'string') {
              result.thinking = (result.thinking ?? '') + c.thinking
              return `[thinking]`
            }
            if (c.type === 'tool_use') {
              result.isToolUse = true
              result.toolName = typeof c.name === 'string' ? c.name : result.toolName
              return `[tool: ${c.name ?? 'unknown'}]`
            }
            if (c.type === 'tool_result') {
              result.isToolUse = true
              return `[tool result]`
            }
            return ''
          })
          .filter(Boolean)
          .join('\n')
      }
    }
    if (typeof msg.result === 'string') {
      result.content = msg.result
    }
  }

  // Outgoing user send
  if (type === 'outgoing:user-send') {
    result.content = typeof msg.text === 'string' ? msg.text : JSON.stringify(msg)
  }

  // Runtime stderr output
  if (type === 'runtime:stderr') {
    result.content = typeof msg.text === 'string' ? msg.text.trim() : JSON.stringify(msg)
  }

  // Final result
  if (type === 'result') {
    result.content = typeof msg.result === 'string' ? msg.result.slice(0, 500) : JSON.stringify(msg.result).slice(0, 500)
  }
  
  return result
}


function recordOutgoingRpcMessage(
  sessionId: string | undefined,
  type: string,
  raw: unknown,
  parsed?: RpcMessage['parsed'],
): void {
  if (!sessionId) return
  const msgEvent = new CustomEvent('rpc-outgoing', { detail: { sessionId, type, raw, parsed } })
  window.dispatchEvent(msgEvent)
}

function emptyMcpDraft(): McpDraft {
  return {
    scope: 'user',
    name: '',
    mode: 'stdio',
    command: '',
    args: '',
    type: 'streamable-http',
    url: '',
  }
}

function mcpDraftFromServer(server: McpServerInfo, scope: 'user' | 'project'): McpDraft {
  const isRemote = Boolean(server.url || server.type === 'streamable-http' || server.type === 'sse')
  return {
    editingName: server.name,
    scope,
    name: server.name,
    mode: isRemote ? 'remote' : 'stdio',
    command: server.command ?? '',
    args: server.args?.join(' ') ?? '',
    type: server.type === 'sse' ? 'sse' : 'streamable-http',
    url: server.url ?? '',
  }
}

function mcpInputFromDraft(draft: McpDraft): McpServerInput {
  if (draft.mode === 'stdio') {
    return {
      name: draft.name.trim(),
      mode: 'stdio',
      command: draft.command.trim(),
      args: draft.args.split(/\s+/).map(item => item.trim()).filter(Boolean),
    }
  }
  return {
    name: draft.name.trim(),
    mode: 'remote',
    type: draft.type,
    url: draft.url.trim() || undefined,
  }
}

function canSaveMcpDraft(draft: McpDraft, hasActiveSession: boolean): boolean {
  if (!isUserProjectScope(draft.scope)) return false
  if (!isMcpMode(draft.mode)) return false
  if (draft.mode === 'remote' && !isMcpRemoteType(draft.type)) return false
  if (draft.scope === 'project' && !hasActiveSession) return false
  if (!draft.name.trim()) return false
  if (draft.mode === 'stdio') return Boolean(draft.command.trim())
  if (draft.mode === 'remote') return isHttpUrl(draft.url.trim())
  return false
}

function emptySkillDraft(scope: 'user' | 'project' = 'user'): SkillDraft {
  return {
    scope,
    name: '',
    contents: '---\ndescription: \n---\n\n',
  }
}

function skillDraftFromDetail(
  detail: InstalledSkillInfo,
  scope: 'user' | 'project',
): SkillDraft {
  return {
    editingName: detail.name,
    scope,
    name: detail.name,
    contents: detail.contents ?? '',
  }
}

function canSaveSkillDraft(
  draft: SkillDraft | undefined,
  hasActiveSession: boolean,
): boolean {
  return Boolean(
    draft &&
    isUserProjectScope(draft.scope) &&
    draft.name.trim() &&
    draft.contents.trim() &&
    (draft.scope !== 'project' || hasActiveSession),
  )
}

function emptyTaskDraft(): TaskDraft {
  return {
    name: '',
    schedule: '',
    prompt: '',
    enabled: true,
  }
}

function taskDraftFromTask(task: ScheduledTaskInfo): TaskDraft {
  return {
    id: task.id,
    name: task.name ?? '',
    schedule: task.schedule ?? '',
    prompt: task.prompt,
    enabled: task.enabled,
  }
}

function taskInputFromDraft(draft: TaskDraft): ScheduledTaskInput {
  return {
    id: draft.id,
    name: draft.name.trim() || undefined,
    schedule: draft.schedule.trim() || undefined,
    prompt: draft.prompt.trim(),
    enabled: draft.enabled,
  }
}

function findSavedScheduledTask(
  input: ScheduledTaskInput,
  tasks: ScheduledTaskInfo[],
): ScheduledTaskInfo | undefined {
  const taskId = input.id?.trim()
  if (taskId) return tasks.find(task => task.id.trim() === taskId)
  const savedName = input.name?.trim() ?? ''
  const savedSchedule = input.schedule?.trim() ?? ''
  const savedPrompt = input.prompt.trim()
  return [...tasks].reverse().find(task =>
    (task.name?.trim() ?? '') === savedName &&
    (task.schedule?.trim() ?? '') === savedSchedule &&
    task.prompt.trim() === savedPrompt &&
    task.enabled === input.enabled
  )
}

function canSaveTaskDraft(draft: TaskDraft): boolean {
  return Boolean(draft.prompt.trim() && isValidCronExpression(draft.schedule))
}

function emptyProjectTaskDraft(): ProjectTaskDraft {
  return {
    cron: '',
    prompt: '',
    recurring: true,
  }
}

function projectTaskDraftFromTask(task: ProjectScheduledTaskInfo): ProjectTaskDraft {
  return {
    id: task.id,
    cron: task.cron,
    prompt: task.prompt,
    recurring: Boolean(task.recurring),
  }
}

function projectTaskInputFromDraft(draft: ProjectTaskDraft): ProjectScheduledTaskInput {
  return {
    id: draft.id,
    cron: draft.cron.trim(),
    prompt: draft.prompt.trim(),
    recurring: draft.recurring,
  }
}

function findSavedProjectScheduledTask(
  input: ProjectScheduledTaskInput,
  tasks: ProjectScheduledTaskInfo[],
): ProjectScheduledTaskInfo | undefined {
  const taskId = input.id?.trim()
  if (taskId) return tasks.find(task => task.id.trim() === taskId)
  const savedCron = input.cron.trim()
  const savedPrompt = input.prompt.trim()
  return [...tasks].reverse().find(task =>
    task.cron.trim() === savedCron &&
    task.prompt.trim() === savedPrompt &&
    Boolean(task.recurring) === input.recurring
  )
}

function canSaveProjectTaskDraft(
  draft: ProjectTaskDraft,
  hasActiveSession: boolean,
): boolean {
  return Boolean(
    hasActiveSession &&
    draft.prompt.trim() &&
    isValidCronExpression(draft.cron),
  )
}

function formatDateTime(ts?: number): string {
  if (!ts) return 'No future run'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts)
}

function emptyPluginDraft(): PluginDraft {
  return {
    plugin: '',
    scope: 'user',
  }
}

function isPluginScope(scope: string): scope is PluginDraft['scope'] {
  return scope === 'user' || scope === 'project' || scope === 'local'
}

function installedPluginIdentity(plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): string {
  const pluginId = plugin.id.trim()
  const pluginScope = plugin.scope === 'project'
    ? 'project'
    : plugin.scope === 'local'
      ? 'local'
      : 'user'
  const pluginLocation = (plugin.installPath ?? plugin.version ?? pluginId).trim()
  return JSON.stringify([pluginScope, pluginLocation, pluginId])
}

function isUserProjectScope(scope: string): scope is 'user' | 'project' {
  return scope === 'user' || scope === 'project'
}

function isMcpMode(mode: string): mode is McpDraft['mode'] {
  return mode === 'stdio' || mode === 'remote'
}

function isMcpRemoteType(type: string): type is McpDraft['type'] {
  return type === 'streamable-http' || type === 'sse'
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function terminalSize(host: HTMLElement): { columns: number; rows: number } {
  const bounds = host.getBoundingClientRect()
  return {
    columns: clampInteger((bounds.width - 16) / 7, 20, 400),
    rows: clampInteger((bounds.height - 16) / 15, 5, 120),
  }
}

function languageForPath(path?: string): string {
  if (!path) return 'plaintext'
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
      return 'markdown'
    case 'py':
      return 'python'
    case 'go':
      return 'go'
    case 'rs':
      return 'rust'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell'
    default:
      return 'plaintext'
  }
}

function parseGitDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let current: DiffFile | undefined
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      current = {
        path: match?.[2] ?? line.replace(/^diff --git /, ''),
        lines: [{ kind: 'meta', text: line }],
        additions: 0,
        deletions: 0,
      }
      files.push(current)
      continue
    }
    if (!current) continue
    const kind: DiffLine['kind'] =
      line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')
        ? 'meta'
        : line.startsWith('+')
          ? 'add'
          : line.startsWith('-')
            ? 'remove'
            : 'context'
    if (kind === 'add') current.additions += 1
    if (kind === 'remove') current.deletions += 1
    current.lines.push({ kind, text: line })
  }
  return files
}

export function App() {
  const [sessions, setSessions] = useState<DesktopSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>()
  const [globalPane, setGlobalPane] = useState<PaneId>('files')
  const [primaryNavView, setPrimaryNavView] = useState<PrimaryNavView>('chat')
  const [sessionsCollapsed, setSessionsCollapsed] = useState(
    readPersistedSessionRailCollapsed,
  )
  const [input, setInput] = useState('')
  const [tree, setTree] = useState<WorkspaceEntry[]>([])
  const [activeFile, setActiveFile] = useState<string>()
  const [fileContents, setFileContents] = useState('')
  const [savedFileContents, setSavedFileContents] = useState('')
  const [filesStatus, setFilesStatus] = useState<PaneStatus>()
  const [editorStatus, setEditorStatus] = useState<EditorStatus>()
  const [gitStatus, setGitStatus] = useState('')
  const [gitDiff, setGitDiff] = useState('')
  const [diffStatus, setDiffStatus] = useState<DiffStatus>()
  const [workspaceRefreshWarning, setWorkspaceRefreshWarning] = useState<string>()
  const [workspaceRefreshStatus, setWorkspaceRefreshStatus] = useState<SessionStatus>()
  const [selectedDiffPath, setSelectedDiffPath] = useState<string>()
  const [terminalId, setTerminalId] = useState<string>()
  const [terminalInfo, setTerminalInfo] = useState<TerminalSessionInfo>()
  const [terminalOutput, setTerminalOutput] = useState('')
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus>()
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>()
  const [conversationNotice, setConversationNotice] = useState<SessionStatus>()
  const [previewUrl, setPreviewUrl] = useState('')
  const [committedPreviewUrl, setCommittedPreviewUrl] = useState('')
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>()
  const [settingsStatus, setSettingsStatus] = useState<PaneStatus>()
  const [tasksStatus, setTasksStatus] = useState<PaneStatus>()
  const [settingsSearch, setSettingsSearch] = useState('')
  const [settingsActiveSection, setSettingsActiveSection] = useState('settings-runtime')
  const [tasksActiveSection, setTasksActiveSection] = useState('tasks-project-tasks')
  const [agentsActiveSection, setAgentsActiveSection] = useState('agents-catalog')
  const [teamsActiveSection, setTeamsActiveSection] = useState('agents-teams')
  const [agentsStatus, setAgentsStatus] = useState<PaneStatus>()
  const [teamsStatus, setTeamsStatus] = useState<PaneStatus>()
  const [mcpStatus, setMcpStatus] = useState<PaneStatus>()
  const [mcpActiveSection, setMcpActiveSection] = useState('mcp-servers')
  const [skillsStatus, setSkillsStatus] = useState<PaneStatus>()
  const [skillsActiveSection, setSkillsActiveSection] = useState('skills-installed')
  const [mcpSearch, setMcpSearch] = useState('')
  const [skillsSearch, setSkillsSearch] = useState('')
  const [rpcMessages, setRpcMessages] = useState<RpcMessage[]>([])
  const [rpcMessageFilter, setRpcMessageFilter] = useState<'all' | 'tool' | 'message' | 'system'>('all')
  const [selectedRpcMessage, setSelectedRpcMessage] = useState<RpcMessage>()
  const [rpcAutoScroll, setRpcAutoScroll] = useState(true)
  const rpcTimelineRef = useRef<HTMLDivElement>(null)
  const rpcMessageIdRef = useRef(0)

  function copySelectedRpcJson(): void {
    if (!selectedRpcMessage) return
    void navigator.clipboard.writeText(JSON.stringify(selectedRpcMessage.raw, null, 2))
  }

  function exportAllRpcMessages(): void {
    const data = JSON.stringify(rpcMessages, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rpc-activity-${new Date().toISOString().slice(0,19)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const [desktopConfig, setDesktopConfig] = useState<ClaudeDesktopConfig>()
  const desktopConfigRef = useRef<ClaudeDesktopConfig | undefined>(undefined)
  const [projectTasks, setProjectTasks] = useState<ProjectScheduledTaskInfo[]>([])
  const [projectMcpServers, setProjectMcpServers] = useState<McpServerInfo[]>([])
  const [selectedMcpDetail, setSelectedMcpDetail] = useState<McpServerInfo>()
  const [selectedMcpDetailScope, setSelectedMcpDetailScope] = useState<'user' | 'project'>()
  const [projectSkills, setProjectSkills] = useState<InstalledSkillInfo[]>([])
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<InstalledSkillInfo>()
  const [selectedSkillDetailScope, setSelectedSkillDetailScope] = useState<'user' | 'project'>()
  const [skillDraft, setSkillDraft] = useState<SkillDraft>()
  const [customCommands, setCustomCommands] = useState<CustomCommandInfo[]>([])
  const [mcpHealthOutput, setMcpHealthOutput] = useState<McpHealthOutputState | null>(null)
  const [pluginOutput, setPluginOutput] = useState<PluginOutputState | null>(null)
  const [agentList, setAgentList] = useState<AgentListResult>({
    activeAgents: [],
    allAgents: [],
  })
  const [agentCatalogQuery, setAgentCatalogQuery] = useState('')
  const [agentCatalogSource, setAgentCatalogSource] =
    useState<AgentCatalogSourceFilter>('active')
  const [selectedAgentType, setSelectedAgentType] = useState<string>()
  const [selectedAgentSource, setSelectedAgentSource] = useState<AgentSource>()
  const [agentDiagnostics, setAgentDiagnostics] = useState<AgentDiagnostics>()
  const [teams, setTeams] = useState<TeamInfo[]>([])
  const [proxyDraft, setProxyDraft] = useState<DesktopProxySettings>({
    enabled: false,
    url: '',
  })
  const [mcpDraft, setMcpDraft] = useState<McpDraft>(() => emptyMcpDraft())
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(() => emptyTaskDraft())
  const [projectTaskDraft, setProjectTaskDraft] = useState<ProjectTaskDraft>(() =>
    emptyProjectTaskDraft(),
  )
  const [pluginDraft, setPluginDraft] = useState<PluginDraft>(() => emptyPluginDraft())
  const [selectedPluginIdentity, setSelectedPluginIdentity] = useState<string | undefined>()
  const [agentDraft, setAgentDraft] = useState<AgentDraft>(() => emptyAgentDraft())
  const [agentLaunchDraft, setAgentLaunchDraft] = useState<AgentLaunchDraft>(() =>
    emptyAgentLaunchDraft(),
  )
  const [agentTaskPrompt, setAgentTaskPrompt] = useState('')
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(() => emptyTeamDraft())
  const [chatTarget, setChatTarget] = useState<ChatTarget>({
    type: 'session',
    teamName: '',
    agentType: '',
  })
  const [composerCursor, setComposerCursor] = useState(0)
  const [composerMenuActiveIndex, setComposerMenuActiveIndex] = useState(0)
  const [sessionCreateMenu, setSessionCreateMenu] = useState<SessionCreateMenuState>()
  const [sessionCreateMenuActiveIndex, setSessionCreateMenuActiveIndex] = useState(0)
  const sessionCreateMenuItemIds = [
    'session-create-menu-item-quick',
    'session-create-menu-item-choose-project',
  ]
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState>()
  const [sessionMenuActiveIndex, setSessionMenuActiveIndex] = useState(0)
  const sessionActionMenuItemIds = [
    'session-menu-item-focus',
    'session-menu-item-open-folder',
    'session-menu-item-close',
  ]
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useState(0)
  const [commandPaletteStatus, setCommandPaletteStatus] = useState<PaneStatus>()
  const [pendingDesktopNavigation, setPendingDesktopNavigation] =
    useState<DesktopNavigationEvent>()
  const [loadingLabel, setLoadingLabel] = useState<string>()
  const [error, setError] = useState<string>()
  const [copiedTarget, setCopiedTarget] = useState<string>()
  const [permissionQueue, setPermissionQueue] = useState<
    Array<NormalizedPermissionRequest & { error?: string }>
  >([])
  const [respondingPermissionId, setRespondingPermissionId] = useState<string>()
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest>()

  function startNewTeamDraft(): void {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before creating teams.' })
      return
    }
    const session = activeSession
    setTeamDraft(emptyTeamDraft())
    setChatTarget({
      type: 'session',
      teamName: '',
      agentType: '',
    })
    void updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })
    setTeamsStatus({ kind: 'info', text: 'Ready to create a new team.' })
  }

  const workspaceRef = useRef<HTMLElement>(null)
  const messageListRef = useRef<HTMLElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const teamMessageTextareaRef = useRef<HTMLTextAreaElement>(null)
  const commandPaletteRef = useRef<HTMLElement>(null)
  const commandPaletteInputRef = useRef<HTMLInputElement>(null)
  const commandPaletteReturnFocusRef = useRef<HTMLElement | null>(null)
  const monacoHostRef = useRef<HTMLDivElement>(null)
  const monacoRef = useRef<typeof Monaco>()
  const monacoEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor>()
  const monacoModelRef = useRef<Monaco.editor.ITextModel>()
  const monacoPathRef = useRef<string>()
  const activeFileRef = useRef<string>()
  const fileContentsRef = useRef('')
  const savedFileContentsRef = useRef('')
  const fileSaveActionPendingRef = useRef(false)
  const xtermHostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal>()
  const terminalIdRef = useRef<string>()
  const terminalActionPendingRef = useRef(false)
  const previewActionPendingRef = useRef(false)
  const externalLinkActionPendingRef = useRef(false)
  const proxyActionPendingRef = useRef(false)
  const settingsRefreshActionPendingRef = useRef(false)
  const diagnosticsExportActionPendingRef = useRef(false)
  const workspaceRefreshActionPendingRef = useRef<Set<string>>(new Set())
  const sessionCreateActionPendingRef = useRef(false)
  const sessionCloseActionPendingRef = useRef<Set<string>>(new Set())
  const sessionOpenFolderActionPendingRef = useRef<Set<string>>(new Set())
  const sessionFocusInFlightRef = useRef(false)
  const sessionFocusTargetRef = useRef<string>()
  const desiredActiveSessionIdRef = useRef<string>()
  const queuedSessionFocusIdRef = useRef<string>()
  const sendActionPendingRef = useRef(false)
  const cancelActionPendingRef = useRef(false)
  const permissionActionPendingRef = useRef(false)
  const agentRefreshActionPendingRef = useRef(false)
  const agentDiagnosticActionPendingRef = useRef<Set<string>>(new Set())
  const agentEditorActionPendingRef = useRef<Set<string>>(new Set())
  const agentTaskActionPendingRef = useRef<Set<string>>(new Set())
  const agentLaunchActionPendingRef = useRef<Set<string>>(new Set())
  const teamActionPendingRef = useRef<Set<string>>(new Set())
  const pluginActionPendingRef = useRef<Set<string>>(new Set())
  const skillActionPendingRef = useRef<Set<string>>(new Set())
  const mcpActionPendingRef = useRef<Set<string>>(new Set())
  const scheduledTaskActionPendingRef = useRef<Set<string>>(new Set())
  const terminalSizeRef = useRef<{ terminalId?: string; columns: number; rows: number }>()
  const activeSessionIdRef = useRef<string>()
  const sessionsRef = useRef<DesktopSession[]>([])
  const appCloseActionPendingRef = useRef(false)
  const confirmResolverRef = useRef<((confirmed: boolean) => void)>()
  const copyStatusTimerRef = useRef<ReturnType<typeof window.setTimeout>>()
  const hasUnsavedChangesRef = useRef(false)
  const discardEditorChangesActionPendingRef = useRef(false)
  const allowWindowUnloadRef = useRef(false)
  const confirmReturnFocusRef = useRef<HTMLElement | null>(null)
  const confirmModalRef = useRef<HTMLElement>(null)
  const confirmCancelButtonRef = useRef<HTMLButtonElement>(null)
  const permissionAllowButtonRef = useRef<HTMLButtonElement>(null)
  const permissionReturnFocusRef = useRef<HTMLElement | null>(null)
  const permissionModalRef = useRef<HTMLElement>(null)
  const permissionDenyButtonRef = useRef<HTMLButtonElement>(null)
  const pendingPaneSectionRef = useRef<{ pane: PaneId; sectionId: string }>()
  const composerMenuActiveIndexRef = useRef(0)
  const activeSession = sessions.find(session => session.id === activeSessionId)
  const activePane = activeSession?.layout.activePane ?? globalPane
  const liveConversationStatus = conversationStatusText(activeSession)
  const conversationStatus = liveConversationStatus ?? conversationNotice?.text
  const conversationStatusKind = liveConversationStatus
    ? activeSession?.activity ?? 'idle'
    : conversationNotice?.kind ?? activeSession?.activity ?? 'idle'
  const turnBusy = isTurnBusy(activeSession)
  const canQueueRuntimePrompt = Boolean(activeSession && !turnBusy)
  const cancelAvailable = canCancelTurn(activeSession)
  const previewUrlValid = isHttpUrl(previewUrl)
  const committedPreviewUrlValid = isHttpUrl(committedPreviewUrl)
  const canUseRemoteIsolation =
    desktopConfig?.runtimeCapabilities.remoteIsolation === true
  const canSaveProxy = canSaveProxySettings(proxyDraft)
  const pendingPermission = permissionQueue[0]
  const permissionResponding = Boolean(
    pendingPermission && respondingPermissionId === pendingPermission.requestId,
  )
  const messageScrollSignature = activeSession?.messages
    .map(message => `${message.id}:${message.role}:${message.text.length}`)
    .join('|')
  const liveEditorHasUnsavedChanges = editorHasUnsavedChanges({
    activeFile,
    fileContents,
    savedFileContents,
    modelValue: monacoPathRef.current === activeFile
      ? monacoModelRef.current?.getValue()
      : undefined,
  })
  const hasUnsavedChanges = hasUnsavedChangesRef.current || liveEditorHasUnsavedChanges
  activeFileRef.current = activeFile
  fileContentsRef.current = fileContents
  savedFileContentsRef.current = savedFileContents
  const workspaceRatio = activeSession?.layout.workspaceRatio ?? 0.5
  const expandedPaths = useMemo(
    () => new Set(activeSession?.layout.expandedPaths ?? []),
    [activeSession?.layout.expandedPaths],
  )
  const visibleAgents = useMemo(() => {
    const query = agentCatalogQuery.trim().toLowerCase()
    const sourceAgents = agentCatalogSource === 'active'
      ? agentList.activeAgents
      : agentList.allAgents.filter(agent => agent.source === agentCatalogSource)
    if (!query) return sourceAgents
    return sourceAgents.filter(agent =>
      agent.agentType.toLowerCase().includes(query) ||
      agent.whenToUse.toLowerCase().includes(query),
    )
  }, [agentCatalogQuery, agentCatalogSource, agentList.activeAgents, agentList.allAgents])
  const selectedAgent = useMemo(() => {
    if (!selectedAgentType) return undefined
    const matchesSelectedAgent = (agent: AgentInfo): boolean =>
      agent.agentType.trim() === selectedAgentType &&
      (!selectedAgentSource || agent.source === selectedAgentSource)
    return agentList.allAgents.find(matchesSelectedAgent) ??
      agentList.activeAgents.find(matchesSelectedAgent) ??
      agentList.allAgents.find(agent => agent.agentType.trim() === selectedAgentType) ??
      agentList.activeAgents.find(agent => agent.agentType.trim() === selectedAgentType)
  }, [agentList.activeAgents, agentList.allAgents, selectedAgentSource, selectedAgentType])
  const selectedAgentReadOnly = Boolean(selectedAgent && !selectedAgent.editable)
  const canEditSelectedAgent = Boolean(
    selectedAgent &&
    (selectedAgent.source === 'user' || activeSession),
  )
  const canDeleteSelectedAgent = Boolean(
    selectedAgent &&
    selectedAgent.editable &&
    (selectedAgent.source === 'user' || activeSession),
  )
  const canDeleteAgentDraft = Boolean(
    (agentDraft.source === 'user' || activeSession) &&
    selectedAgent?.editable &&
    selectedAgent.agentType === agentDraft.agentType &&
    selectedAgent.source === agentDraft.source,
  )

  function setActivePaneError(pane: PaneId, message: string): void {
    switch (pane) {
      case 'files':
        setFilesStatus({ kind: 'error', text: message })
        break
      case 'diff':
        setDiffStatus({ kind: 'error', text: message })
        break
      case 'editor':
        setEditorStatus({ kind: 'error', text: message })
        break
      case 'terminal':
        setTerminalStatus({ kind: 'error', text: message })
        break
      case 'preview':
        setPreviewStatus({ kind: 'error', text: message })
        break
      case 'agents':
        setAgentsStatus({ kind: 'error', text: message })
        break
      case 'teams':
        setTeamsStatus({ kind: 'error', text: message })
        break
      case 'tasks':
        setTasksStatus({ kind: 'error', text: message })
        break
      case 'settings':
        setSettingsStatus({ kind: 'error', text: message })
        break
    }
  }

  async function runAction<T>(label: string, action: () => Promise<T>): Promise<T | undefined> {
    setError(undefined)
    setLoadingLabel(label)
    const errorTarget = activePane
    try {
      return await action()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      setActivePaneError(errorTarget, message)
      return undefined
    } finally {
      setLoadingLabel(undefined)
    }
  }

  async function copyText(target: string, text: string): Promise<void> {
    try {
      await window.claudeDesktop.clipboard.writeText(text)
      setError(undefined)
      setCopiedTarget(target)
      if (copyStatusTimerRef.current) {
        window.clearTimeout(copyStatusTimerRef.current)
      }
      copyStatusTimerRef.current = window.setTimeout(() => {
        setCopiedTarget(current => current === target ? undefined : current)
      }, 1600)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function handleAppCloseRequest(): Promise<void> {
    if (appCloseActionPendingRef.current) return
    appCloseActionPendingRef.current = true
    try {
      if (hasUnsavedChangesRef.current) {
        const dirtyPath = monacoPathRef.current ?? 'the current file'
        const confirmed = await requestConfirmation({
          title: 'Close window?',
          message: `The editor has unsaved changes in ${dirtyPath}. Closing will lose them.`,
          confirmLabel: 'Close window',
          cancelLabel: 'Keep editing',
          tone: 'danger',
        })
        if (!confirmed) return
      }
      allowWindowUnloadRef.current = true
      await window.claudeDesktop.app.closeWindow()
    } catch (cause) {
      allowWindowUnloadRef.current = false
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      appCloseActionPendingRef.current = false
    }
  }

  function mergeSession(session: DesktopSession): void {
    setSessions(prev => {
      const next = prev.filter(item => item.id !== session.id)
      const sorted = [session, ...next].sort((a, b) => b.updatedAt - a.updatedAt)
      sessionsRef.current = sorted
      return sorted
    })
  }

  function applyLocalLayout(sessionId: string, patch: DesktopSessionLayoutPatch): void {
    setSessions(prev => {
      const next = prev.map(session => session.id === sessionId ? {
        ...session,
        layout: { ...session.layout, ...patch },
      } : session)
      sessionsRef.current = next
      return next
    })
  }

  async function updateSessionLayout(
    sessionId: string,
    patch: DesktopSessionLayoutPatch,
    applyLocal = true,
  ): Promise<void> {
    if (applyLocal) applyLocalLayout(sessionId, patch)
    const saved = await window.claudeDesktop.sessions.updateLayout(
      sessionId,
      patch,
    )
    mergeSession(saved)
  }

  async function updateLayout(patch: DesktopSessionLayoutPatch): Promise<void> {
    if (!activeSession) return
    await updateSessionLayout(activeSession.id, patch)
  }

  function requestConfirmation(request: ConfirmRequest): Promise<boolean> {
    confirmResolverRef.current?.(false)
    captureReturnFocus(confirmReturnFocusRef)
    return new Promise(resolve => {
      confirmResolverRef.current = resolve
      setConfirmRequest(request)
    })
  }

  function settleConfirmation(confirmed: boolean): void {
    if (loadingLabel) return
    if (!confirmResolverRef.current) return
    confirmResolverRef.current(confirmed)
    confirmResolverRef.current = undefined
    setConfirmRequest(undefined)
    restoreFocus(confirmReturnFocusRef)
  }

  function resolveConfirmationModal(confirmed: boolean): void {
    settleConfirmation(confirmed)
  }

  function restoreFocus(ref: MutableRefObject<HTMLElement | null>): void {
    const element = ref.current
    ref.current = null
    requestAnimationFrame(() => {
      if (!canRestoreFocus(element)) return
      element.focus()
    })
  }

  function captureReturnFocus(
    ref: MutableRefObject<HTMLElement | null>,
    excludedRoot?: HTMLElement | null,
  ): void {
    const element = document.activeElement
    if (!(element instanceof HTMLElement)) return
    if (element === document.body || element === document.documentElement) return
    if (excludedRoot?.contains(element)) return
    ref.current = element
  }

  function canRestoreFocus(element: HTMLElement | null): element is HTMLElement {
    if (!element || !document.contains(element)) return false
    if (
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      return !element.disabled
    }
    return true
  }

  function shouldKeepExistingFocus(element: Element | null): boolean {
    if (!(element instanceof HTMLElement)) return false
    if (element === document.body || element === document.documentElement) return false
    if (element === composerTextareaRef.current) return false
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement ||
      element.isContentEditable
    ) {
      return true
    }
    return Boolean(
      monacoHostRef.current?.contains(element) ||
        xtermHostRef.current?.contains(element) ||
        commandPaletteRef.current?.contains(element) ||
        confirmModalRef.current?.contains(element) ||
        permissionModalRef.current?.contains(element),
    )
  }

  function focusComposer(): void {
    if (
      primaryNavView !== 'chat' ||
      !activeSession ||
      turnBusy ||
      loadingLabel ||
      confirmRequest ||
      pendingPermission
    ) return
    const textarea = composerTextareaRef.current
    if (!textarea || textarea.disabled) return
    if (shouldKeepExistingFocus(document.activeElement)) return
    requestAnimationFrame(() => {
      if (!textarea.disabled && document.contains(textarea)) {
        textarea.focus()
      }
    })
  }

  function trapModalFocus(event: KeyboardEvent, modal: HTMLElement | null): void {
    if (event.key !== 'Tab' || !modal) return
    const focusable = [...modal.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )].filter(element => element.offsetParent !== null || element === document.activeElement)
    if (!focusable.length) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (!active || active === first || !modal.contains(active))) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  async function clearStaleSelectedAgentSelection(
    nextAgents: AgentListResult,
    session: DesktopSession,
  ): Promise<void> {
    const selectedAgentType = session.layout.selectedAgentType?.trim()
    if (!selectedAgentType) return
    const selectedAgentSource = session.layout.selectedAgentSource
    const fallbackAgent =
      nextAgents.allAgents.find(agent =>
        agent.agentType.trim() === selectedAgentType &&
        agent.source !== selectedAgentSource
      ) ??
      nextAgents.activeAgents.find(agent =>
        agent.agentType.trim() === selectedAgentType &&
        agent.source !== selectedAgentSource
      )
    const selectedAgent = selectedAgentSource
      ? nextAgents.allAgents.find(agent =>
        agent.agentType.trim() === selectedAgentType &&
        agent.source === selectedAgentSource
      ) ??
        nextAgents.activeAgents.find(agent =>
          agent.agentType.trim() === selectedAgentType &&
          agent.source === selectedAgentSource
        )
      : fallbackAgent
    const selectedAgentExists =
      nextAgents.allAgents.some(agent => agent.agentType.trim() === selectedAgentType) ||
      nextAgents.activeAgents.some(agent => agent.agentType.trim() === selectedAgentType)
    if (!selectedAgent && fallbackAgent) {
      setSelectedAgentType(fallbackAgent.agentType)
      setSelectedAgentSource(fallbackAgent.source)
      setAgentLaunchDraft(prev =>
        prev.agentType.trim() === selectedAgentType
          ? {
            ...prev,
            agentType: fallbackAgent.agentType,
            description: prev.description || fallbackAgent.whenToUse.slice(0, 80),
            isolation: allowedIsolation(fallbackAgent.isolation, canUseRemoteIsolation),
          }
          : prev
      )
      setChatTarget(prev =>
        prev.type === 'agent' && prev.agentType.trim() === selectedAgentType
          ? { ...prev, agentType: fallbackAgent.agentType }
          : prev
      )
      await updateSessionLayout(session.id, {
        selectedAgentType: fallbackAgent.agentType,
        selectedAgentSource: fallbackAgent.source,
      })
      return
    }
    if (selectedAgentExists) return
    setSelectedAgentType(undefined)
    setSelectedAgentSource(undefined)
    setAgentLaunchDraft(prev =>
      prev.agentType.trim() === selectedAgentType ? emptyAgentLaunchDraft() : prev
    )
    setChatTarget(prev =>
      prev.type === 'agent' && prev.agentType.trim() === selectedAgentType
        ? { type: 'session', teamName: '', agentType: '' }
        : prev
    )
    await updateSessionLayout(session.id, {
      selectedAgentType: undefined,
      selectedAgentSource: undefined,
    })
  }

  async function clearStaleSelectedTeamSelection(
    nextTeams: TeamInfo[],
    session: DesktopSession,
  ): Promise<void> {
    const selectedTeamName = session.layout.selectedTeamName?.trim()
    const selectedTeamRecipient = session.layout.selectedTeamRecipient?.trim()
    if (!selectedTeamName) return
    const selectedTeam = nextTeams.find(team => team.name.trim() === selectedTeamName)
    if (selectedTeam) {
      const selectedTeamRecipientIsCurrent =
        !selectedTeamRecipient ||
        selectedTeamRecipient === '*' ||
        selectedTeam.members.some(member => member.name.trim() === selectedTeamRecipient)
      if (selectedTeamRecipientIsCurrent) return
      setTeamDraft(prev =>
        prev.teamName.trim() === selectedTeamName &&
          prev.to.trim() === selectedTeamRecipient
          ? { ...prev, to: '*' }
          : prev
      )
      await updateSessionLayout(session.id, { selectedTeamRecipient: '*' })
      return
    }
    setTeamDraft(prev =>
      prev.teamName.trim() === selectedTeamName &&
        (!selectedTeamRecipient || prev.to.trim() === selectedTeamRecipient)
        ? emptyTeamDraft()
        : prev
    )
    const fallbackAgentType = session.layout.selectedAgentType?.trim()
    const fallbackChatTarget: ChatTarget = fallbackAgentType
      ? { type: 'agent', teamName: '', agentType: fallbackAgentType }
      : { type: 'session', teamName: '', agentType: '' }
    setChatTarget(prev =>
      prev.type === 'team' && prev.teamName.trim() === selectedTeamName
        ? fallbackChatTarget
        : prev
    )
    await updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })
  }

  async function refreshActiveWorkspace(): Promise<void> {
    if (!activeSession) {
      setConversationNotice({ kind: 'error', text: 'Select a session before refreshing the workspace.' })
      return
    }
    if (loadingLabel) return
    const session = activeSession
    await runAction('Refreshing workspace', () => refreshWorkspace(session, { showStatus: true }))
  }

  function handleRefreshWorkspaceClick(): void {
    if (loadingLabel) return
    void refreshActiveWorkspace()
  }

  async function refreshWorkspace(
    session = activeSession,
    options: { showStatus?: boolean } = {},
  ): Promise<number | undefined> {
    if (!session) return undefined
    if (workspaceRefreshActionPendingRef.current.has(session.id)) return undefined
    workspaceRefreshActionPendingRef.current.add(session.id)
    setDiffStatus({ kind: 'info', text: 'Refreshing git changes...' })
    setWorkspaceRefreshWarning(undefined)
    setWorkspaceRefreshStatus(undefined)
    try {
      const [
        nextTree,
        nextStatus,
        nextDiff,
      ] = await Promise.all([
        window.claudeDesktop.workspace.tree(session.cwd),
        window.claudeDesktop.git.status(session.cwd),
        window.claudeDesktop.git.diff(session.cwd),
      ])
      const optional = await Promise.allSettled([
        window.claudeDesktop.workspaceTasks.list(session.cwd),
        window.claudeDesktop.workspaceMcp.list(session.cwd),
        window.claudeDesktop.workspaceSkills.list(session.cwd),
        window.claudeDesktop.agents.list(session.cwd),
        window.claudeDesktop.teams.list(session.cwd),
        window.claudeDesktop.commands.list(session.cwd),
      ] as const)
      if (activeSessionIdRef.current !== session.id) return undefined
      setTree(nextTree)
      const gitStatusFailed = nextStatus.includes('fatal:') || nextStatus.includes('Command failed')
      const gitDiffFailed = nextDiff.includes('fatal:') || nextDiff.includes('Command failed')
      setGitStatus(gitStatusFailed ? '' : nextStatus)
      setGitDiff(gitDiffFailed ? '' : nextDiff)
      const nextFileCount = countWorkspaceFiles(nextTree)
      const nextDiffFiles = parseGitDiff(gitDiffFailed ? '' : nextDiff)
      if (gitStatusFailed && gitDiffFailed) {
        setDiffStatus({
          kind: 'info',
          text: 'Not a git repository.',
        })
      } else {
        setDiffStatus({
          kind: 'success',
          text: (gitDiffFailed ? '' : nextDiff).trim()
            ? `Updated git changes: ${nextDiffFiles.length} file${nextDiffFiles.length === 1 ? '' : 's'} changed.`
            : 'Checked git changes: workspace is clean.',
        })
      }
      const [tasks, mcp, skills, agents, teams, commands] = optional
      const failures = [
        { label: 'project tasks', result: tasks },
        { label: 'project MCP', result: mcp },
        { label: 'project skills', result: skills },
        { label: 'agents', result: agents },
        { label: 'teams', result: teams },
        { label: 'slash commands', result: commands },
      ].flatMap(item =>
        item.result.status === 'rejected' ? [item.label] : [],
      )
      if (agents.status === 'fulfilled' && agents.value.failedFiles?.length) {
        failures.push('agents')
      }
      if (tasks.status === 'fulfilled') setProjectTasks(tasks.value)
      if (mcp.status === 'fulfilled') setProjectMcpServers(mcp.value)
      if (skills.status === 'fulfilled') setProjectSkills(skills.value)
      if (agents.status === 'fulfilled') {
        setAgentList(agents.value)
        await clearStaleSelectedAgentSelection(agents.value, session)
      }
      if (teams.status === 'fulfilled') {
        setTeams(teams.value)
        await clearStaleSelectedTeamSelection(teams.value, session)
      }
      if (commands.status === 'fulfilled') setCustomCommands(commands.value)
      if (failures.length) {
        setWorkspaceRefreshWarning(
          `Workspace partially refreshed. Could not update ${failures.join(', ')}.`,
        )
      } else if (options.showStatus) {
        setWorkspaceRefreshStatus({ kind: 'success', text: 'Workspace refreshed.' })
      }
      return nextFileCount
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (activeSessionIdRef.current === session.id) {
        setDiffStatus({ kind: 'error', text: message })
      }
      throw cause
    } finally {
      workspaceRefreshActionPendingRef.current.delete(session.id)
    }
  }

  async function refreshDesktopConfig(options: { showStatus?: boolean } = {}): Promise<void> {
    const config = await window.claudeDesktop.config.get()
    desktopConfigRef.current = config
    setDesktopConfig(config)
    setProxyDraft(config.proxy)
    if (options.showStatus) {
      setSettingsStatus({ kind: 'success', text: 'Refreshed configuration.' })
    }
  }

  async function refreshSettingsConfig(): Promise<void> {
    if (loadingLabel) return
    if (settingsRefreshActionPendingRef.current) return
    const session = activeSession
    settingsRefreshActionPendingRef.current = true
    try {
      await runAction('Refreshing config', async () => {
        await refreshDesktopConfig({ showStatus: !session })
        if (session) {
          await refreshWorkspace(session)
          if (activeSessionIdRef.current !== session.id) return
          setSettingsStatus({ kind: 'success', text: 'Refreshed configuration and workspace settings.' })
        }
      })
    } finally {
      settingsRefreshActionPendingRef.current = false
    }
  }

  async function exportDiagnostics(): Promise<void> {
    if (loadingLabel) return
    if (diagnosticsExportActionPendingRef.current) return
    diagnosticsExportActionPendingRef.current = true
    try {
      await runAction('Exporting diagnostics', async () => {
        const result = await window.claudeDesktop.app.exportDiagnostics()
        if (!result) {
          setSettingsStatus({ kind: 'info', text: 'Diagnostic export cancelled.' })
          return
        }
        setSettingsStatus({
          kind: 'success',
          text: `Exported diagnostics to ${result.path} (${result.bytes.toLocaleString()} bytes).`,
        })
      })
    } finally {
      diagnosticsExportActionPendingRef.current = false
    }
  }

  useEffect(() => {
    if (canUseRemoteIsolation) return
    setAgentDraft(prev =>
      prev.isolation === 'remote' ? { ...prev, isolation: '' } : prev,
    )
    setAgentLaunchDraft(prev =>
      prev.isolation === 'remote' ? { ...prev, isolation: '' } : prev,
    )
  }, [canUseRemoteIsolation])

  useEffect(() => {
    if (!confirmRequest) return
    confirmCancelButtonRef.current?.focus()
    function onKeyDown(event: KeyboardEvent): void {
      trapModalFocus(event, confirmModalRef.current)
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (loadingLabel) return
        settleConfirmation(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmRequest, loadingLabel])

  useEffect(() => {
    if (!pendingPermission) return
    captureReturnFocus(permissionReturnFocusRef, permissionModalRef.current)
    permissionAllowButtonRef.current?.focus()
    function onKeyDown(event: KeyboardEvent): void {
      trapModalFocus(event, permissionModalRef.current)
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (loadingLabel || permissionResponding) return
        void respondToPermission('deny')
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        if (loadingLabel || permissionResponding) return
        void respondToPermission('allow')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingPermission?.requestId, loadingLabel, permissionResponding])

  useEffect(() => {
    if (!commandPaletteOpen) {
      restoreFocus(commandPaletteReturnFocusRef)
      return
    }
    captureReturnFocus(commandPaletteReturnFocusRef, commandPaletteRef.current)
    function onKeyDown(event: KeyboardEvent): void {
      trapModalFocus(event, commandPaletteRef.current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandPaletteOpen])

  useEffect(() => {
    return () => {
      if (copyStatusTimerRef.current) {
        window.clearTimeout(copyStatusTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SESSION_RAIL_COLLAPSED_KEY,
        sessionsCollapsed ? 'true' : 'false',
      )
    } catch {
      // Layout preference persistence is best effort.
    }
  }, [sessionsCollapsed])

  useEffect(() => {
    if (!conversationNotice) return
    const delay = conversationNotice.kind === 'error' ? 8000 : conversationNotice.kind === 'info' ? 5000 : 3000
    const timer = window.setTimeout(() => {
      setConversationNotice(undefined)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [conversationNotice])

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent): string | undefined {
      if (!hasUnsavedChanges || allowWindowUnloadRef.current) return undefined
      event.preventDefault()
      event.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsavedChanges])

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges
    void window.claudeDesktop.app.setUnsavedChanges(hasUnsavedChanges).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
    if ('__claudeDesktopSmokeEvents' in window) {
      window.__claudeDesktopSmokeHasUnsavedChanges = hasUnsavedChanges
    }
  }, [hasUnsavedChanges])

  useEffect(() => {
    focusComposer()
  }, [
    activeSession?.id,
    primaryNavView,
    turnBusy,
    loadingLabel,
    confirmRequest,
    pendingPermission?.requestId,
  ])

  useEffect(() => {
    if (!sessionMenu && !sessionCreateMenu) return
    function closeMenu(): void {
      setSessionMenu(undefined)
      setSessionCreateMenu(undefined)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        closeMenu()
        return
      }
      const itemCount = sessionCreateMenu ? 2 : sessionMenu ? 3 : 0
      if (!itemCount) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (sessionCreateMenu) {
          setSessionCreateMenuActiveIndex(index => (index + 1) % itemCount)
        } else {
          setSessionMenuActiveIndex(index => (index + 1) % itemCount)
        }
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (sessionCreateMenu) {
          setSessionCreateMenuActiveIndex(index => (index - 1 + itemCount) % itemCount)
        } else {
          setSessionMenuActiveIndex(index => (index - 1 + itemCount) % itemCount)
        }
        return
      }
      if (event.key === 'Home') {
        event.preventDefault()
        if (sessionCreateMenu) {
          setSessionCreateMenuActiveIndex(0)
        } else {
          setSessionMenuActiveIndex(0)
        }
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        if (sessionCreateMenu) {
          setSessionCreateMenuActiveIndex(itemCount - 1)
        } else {
          setSessionMenuActiveIndex(itemCount - 1)
        }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (sessionCreateMenu) {
          runSessionCreateMenuAction(sessionCreateMenuActiveIndex)
        } else if (sessionMenu) {
          runSessionMenuAction(sessionMenuActiveIndex)
        }
      }
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    loadingLabel,
    sessionCreateMenu,
    sessionCreateMenuActiveIndex,
    sessionMenu,
    sessionMenuActiveIndex,
  ])

  useEffect(() => {
    const list = messageListRef.current
    if (!list) return
    list.scrollTop = list.scrollHeight
  }, [
    activeSession?.id,
    messageScrollSignature,
  ])

  useEffect(() => {
    if (!activeSession || !desktopConfig) return
    const selectedGlobalTaskId = activeSession.layout.selectedGlobalTaskId?.trim()
    if (!selectedGlobalTaskId) return
    const restoredTask = desktopConfig.scheduledTasks.find(task => task.id.trim() === selectedGlobalTaskId)
    if (restoredTask) {
      setTaskDraft({ ...taskDraftFromTask(restoredTask), id: selectedGlobalTaskId })
    } else {
      setTaskDraft(emptyTaskDraft())
      void updateSessionLayout(activeSession.id, { selectedGlobalTaskId: undefined })
    }
  }, [
    activeSession?.id,
    activeSession?.layout.selectedGlobalTaskId,
    desktopConfig?.scheduledTasks,
  ])

  useEffect(() => {
    if (!activeSession) return
    const selectedAgentTaskId = activeSession.layout.selectedAgentTaskId?.trim()
    if (!selectedAgentTaskId) return
    const restoredTaskExists = activeSession.agentTasks?.some(task => task.id.trim() === selectedAgentTaskId)
    if (restoredTaskExists) return
    void updateSessionLayout(activeSession.id, { selectedAgentTaskId: undefined })
  }, [
    activeSession?.id,
    activeSession?.layout.selectedAgentTaskId,
    activeSession?.agentTasks,
  ])

  useEffect(() => {
    if (!activeSession) return
    const selectedProjectTaskId = activeSession.layout.selectedProjectTaskId?.trim()
    if (!selectedProjectTaskId) return
    const restoredTask = projectTasks.find(task => task.id.trim() === selectedProjectTaskId)
    if (restoredTask) {
      setProjectTaskDraft({ ...projectTaskDraftFromTask(restoredTask), id: selectedProjectTaskId })
    } else {
      setProjectTaskDraft(emptyProjectTaskDraft())
      void updateSessionLayout(activeSession.id, { selectedProjectTaskId: undefined })
    }
  }, [
    activeSession?.id,
    activeSession?.layout.selectedProjectTaskId,
    projectTasks,
  ])

  async function restoreSelectedSettingsDetails(): Promise<void> {
    if (!activeSession) return
    const session = activeSession
    const {
      selectedMcpName,
      selectedMcpSourcePath,
      selectedMcpScope,
      selectedSkillName,
      selectedSkillPath,
      selectedSkillScope,
    } = session.layout
    const restoredMcpName = selectedMcpName?.trim()
    const restoredMcpScope = selectedMcpScope === 'user' || selectedMcpScope === 'project'
      ? selectedMcpScope
      : undefined
    const restoredSkillName = selectedSkillName?.trim()
    const restoredSkillScope = selectedSkillScope === 'user' || selectedSkillScope === 'project'
      ? selectedSkillScope
      : undefined
    const hasIncompleteRestoredMcpIdentity = Boolean(
      (restoredMcpName && !selectedMcpSourcePath) ||
      (!restoredMcpName && selectedMcpSourcePath),
    )
    const hasIncompleteRestoredSkillIdentity = Boolean(
      (restoredSkillName && !selectedSkillPath) ||
      (!restoredSkillName && selectedSkillPath),
    )

    const selectedMcpDetailMatchesRestored = Boolean(
      restoredMcpName &&
      selectedMcpSourcePath &&
      selectedMcpDetail?.name.trim() === restoredMcpName &&
      selectedMcpDetail.sourcePath === selectedMcpSourcePath &&
      (!restoredMcpScope || selectedMcpDetailScope === restoredMcpScope),
    )

    if (hasIncompleteRestoredMcpIdentity) {
      setSelectedMcpDetail(undefined)
      setSelectedMcpDetailScope(undefined)
      await updateSessionLayout(session.id, {
        selectedMcpName: undefined,
        selectedMcpSourcePath: undefined,
        selectedMcpScope: undefined,
      })
    } else if (restoredMcpName && selectedMcpSourcePath) {
      const userMcp = desktopConfig?.mcpServers.find(server =>
        server.name.trim() === restoredMcpName &&
        server.sourcePath === selectedMcpSourcePath,
      )
      const projectMcp = projectMcpServers.find(server =>
        server.name.trim() === restoredMcpName &&
        server.sourcePath === selectedMcpSourcePath,
      )
      const detailScope = restoredMcpScope ?? (userMcp ? 'user' : projectMcp ? 'project' : undefined)
      if (!userMcp && !projectMcp) {
        setSelectedMcpDetail(undefined)
        setSelectedMcpDetailScope(undefined)
        await updateSessionLayout(session.id, {
          selectedMcpName: undefined,
          selectedMcpSourcePath: undefined,
          selectedMcpScope: undefined,
        })
      } else if (!selectedMcpDetailMatchesRestored) {
        try {
          const detail = restoredMcpScope === 'user' && userMcp
            ? await window.claudeDesktop.mcp.read(restoredMcpName)
            : restoredMcpScope === 'project' && projectMcp
              ? await window.claudeDesktop.workspaceMcp.read(session.cwd, restoredMcpName)
              : userMcp
                ? await window.claudeDesktop.mcp.read(restoredMcpName)
                : projectMcp
                  ? await window.claudeDesktop.workspaceMcp.read(session.cwd, restoredMcpName)
                  : undefined
          if (detail && detailScope && activeSessionIdRef.current === session.id) {
            setSelectedMcpDetail(detail)
            setSelectedMcpDetailScope(detailScope)
          }
        } catch (cause) {
          if (activeSessionIdRef.current === session.id) {
            setSettingsStatus({
              kind: 'error',
              text: cause instanceof Error ? cause.message : String(cause),
            })
          }
        }
      }
    }

    const selectedSkillDetailMatchesRestored = Boolean(
      restoredSkillName &&
      selectedSkillPath &&
      selectedSkillDetail?.name.trim() === restoredSkillName &&
      selectedSkillDetail.path === selectedSkillPath &&
      (!restoredSkillScope || selectedSkillDetailScope === restoredSkillScope),
    )

    if (hasIncompleteRestoredSkillIdentity) {
      setSelectedSkillDetail(undefined)
      setSelectedSkillDetailScope(undefined)
      await updateSessionLayout(session.id, {
        selectedSkillName: undefined,
        selectedSkillPath: undefined,
        selectedSkillScope: undefined,
      })
    } else if (restoredSkillName && selectedSkillPath) {
      const userSkill = desktopConfig?.skills.find(skill =>
        skill.name.trim() === restoredSkillName &&
        skill.path === selectedSkillPath,
      )
      const projectSkill = projectSkills.find(skill =>
        skill.name.trim() === restoredSkillName &&
        skill.path === selectedSkillPath,
      )
      const detailScope = restoredSkillScope ?? (userSkill ? 'user' : projectSkill ? 'project' : undefined)
      if (!userSkill && !projectSkill) {
        setSelectedSkillDetail(undefined)
        setSelectedSkillDetailScope(undefined)
        await updateSessionLayout(session.id, {
          selectedSkillName: undefined,
          selectedSkillPath: undefined,
          selectedSkillScope: undefined,
        })
      } else if (!selectedSkillDetailMatchesRestored) {
        try {
          const detail = restoredSkillScope === 'user' && userSkill
            ? await window.claudeDesktop.skills.read(restoredSkillName)
            : restoredSkillScope === 'project' && projectSkill
              ? await window.claudeDesktop.workspaceSkills.read(session.cwd, restoredSkillName)
              : userSkill
                ? await window.claudeDesktop.skills.read(restoredSkillName)
                : projectSkill
                  ? await window.claudeDesktop.workspaceSkills.read(session.cwd, restoredSkillName)
                  : undefined
          if (detail && detailScope && activeSessionIdRef.current === session.id) {
            setSelectedSkillDetail(detail)
            setSelectedSkillDetailScope(detailScope)
          }
        } catch (cause) {
          if (activeSessionIdRef.current === session.id) {
            setSettingsStatus({
              kind: 'error',
              text: cause instanceof Error ? cause.message : String(cause),
            })
          }
        }
      }
    }
  }

  useEffect(() => {
    void restoreSelectedSettingsDetails()
  }, [
    activeSession?.id,
    activeSession?.layout.selectedMcpName,
    activeSession?.layout.selectedMcpSourcePath,
    activeSession?.layout.selectedMcpScope,
    activeSession?.layout.selectedSkillName,
    activeSession?.layout.selectedSkillPath,
    activeSession?.layout.selectedSkillScope,
    desktopConfig?.mcpServers,
    desktopConfig?.skills,
    projectMcpServers,
    projectSkills,
    selectedMcpDetail?.name,
    selectedMcpDetail?.sourcePath,
    selectedMcpDetailScope,
    selectedSkillDetail?.name,
    selectedSkillDetail?.path,
    selectedSkillDetailScope,
  ])

  useEffect(() => {
    void runAction('Loading sessions', async () => {
      const loaded = await window.claudeDesktop.sessions.list()
      sessionsRef.current = loaded
      setSessions(loaded)
      setActiveSessionId(loaded[0]?.id)
      await refreshDesktopConfig()
    })

    return window.claudeDesktop.onEvent((event: RuntimeEvent) => {
      if (event.type === 'app-close-request') {
        void handleAppCloseRequest()
      }
      if (event.type === 'command-palette') {
        setCommandPaletteOpen(true)
      }
      if (event.type === 'clear-desktop-transcript-view') {
        void clearDesktopTranscriptView()
      }
      if (event.type === 'lifecycle-action') {
        runDesktopLifecycleAction(event.action)
      }
      if (event.type === 'settings-action') {
        runDesktopSettingsAction(event.action)
      }
      if (event.type === 'tasks-action') {
        runDesktopTasksAction(event.action)
      }
      if (event.type === 'agents-action') {
        runDesktopAgentsAction(event.action)
      }
      if (event.type === 'teams-action') {
        runDesktopTeamsAction(event.action)
      }
      if (event.type === 'mcp-action') {
        runDesktopMcpAction(event.action)
      }
      if (event.type === 'skills-action') {
        runDesktopSkillsAction(event.action)
      }
      if (event.type === 'plugins-action') {
        runDesktopPluginsAction(event.action)
      }
      if (event.type === 'primary-nav') {
        setPendingDesktopNavigation(event)
      }
      if (event.type === 'workspace-pane') {
        setPendingDesktopNavigation(event)
      }
      if (event.type === 'session-updated') {
        const isNewSession = !sessionsRef.current.some(
          session => session.id === event.session.id,
        )
        mergeSession(event.session)
        setActiveSessionId(current => isNewSession ? event.session.id : current ?? event.session.id)
      }
      if (event.type === 'session-focused') {
        if (
          sessionFocusInFlightRef.current &&
          desiredActiveSessionIdRef.current &&
          event.sessionId !== desiredActiveSessionIdRef.current
        ) {
          return
        }
        activeSessionIdRef.current = event.sessionId
        setActiveSessionId(event.sessionId)
      }
      if (event.type === 'session-closed') {
        const nextSessions = sessionsRef.current.filter(
          session => session.id !== event.sessionId,
        )
        sessionsRef.current = nextSessions
        setSessions(nextSessions)
        setPermissionQueue(prev =>
          prev.filter(request => request.sessionId !== event.sessionId),
        )
        setRespondingPermissionId(undefined)
        setActiveSessionId(current =>
          current === event.sessionId ? nextSessions[0]?.id : current,
        )
      }
      if (event.type === 'runtime-message') {
        // Capture all incoming RPC messages
        const msgRaw = event.message as Record<string, unknown>
        const msgType = typeof msgRaw?.type === 'string' ? msgRaw.type : 'unknown'
        const msgSubtype = typeof msgRaw?.subtype === 'string' ? msgRaw.subtype : undefined
        rpcMessageIdRef.current += 1
        const rpcMessage: RpcMessage = {
          id: `rpc-${rpcMessageIdRef.current}-${Date.now().toString(36)}`,
          sessionId: event.sessionId,
          timestamp: Date.now(),
          direction: 'incoming',
          type: msgType,
          subtype: msgSubtype,
          raw: event.message,
          parsed: extractRpcMessageInfo(event.message),
        }
        setRpcMessages(prev => {
          const next = [...prev, rpcMessage]
          // Keep last 1000 messages per session to avoid memory bloat
          if (next.length > 2000) return next.slice(-1500)
          return next
        })

        const request = normalizePermissionRequest({
          sessionId: event.sessionId,
          message: event.message,
        })
        if (request) {
          setPermissionQueue(prev =>
            prev.some(item => item.requestId === request.requestId)
              ? prev
              : [...prev, request],
          )
        }
      }
      if (event.type === 'runtime-error') {
        const presentation = runtimeErrorPresentation(event.message)
        setError(presentation.error)
      }
      if (event.type === 'terminal-data') {
        setTerminalOutput(prev => `${prev}${event.data}`)
        xtermRef.current?.write(event.data)
      }
      if (event.type === 'terminal-state') {
        setTerminalInfo(event.terminal)
        setTerminalStatus({
          kind: 'success',
          text: `Shell running: ${event.terminal.mode === 'pty' ? 'PTY' : 'fallback'} ${event.terminal.columns}x${event.terminal.rows}`,
        })
      }
      if (event.type === 'terminal-exit') {
        const exitMessage = `\n[terminal exited ${event.code ?? event.signal ?? 'unknown'}]\n`
        setTerminalOutput(prev => `${prev}${exitMessage}`)
        xtermRef.current?.write(exitMessage)
        if (event.terminalId === terminalIdRef.current) {
          setTerminalStatus({
            kind: 'info',
            text: `Shell exited (${event.code ?? event.signal ?? 'unknown'}). Start shell to restart.`,
          })
          setTerminalId(undefined)
          terminalIdRef.current = undefined
          setTerminalInfo(undefined)
          if (activeSessionIdRef.current) {
            void window.claudeDesktop.sessions.updateLayout(
              activeSessionIdRef.current,
              { terminalId: undefined },
            )
          }
        }
      }
      if (event.type === 'preview-url') {
        setPreviewUrl(event.url)
        setCommittedPreviewUrl(event.url)
      }
      if (event.type === 'desktop-error') {
        setError(event.message)
      }
    })
  }, [])

  useEffect(() => {
    if (!activeSession) {
      activeSessionIdRef.current = undefined
      setTree([])
      setActiveFile(undefined)
      setFileContents('')
      setSavedFileContents('')
      setFilesStatus(undefined)
      setEditorStatus(undefined)
      setDiffStatus(undefined)
      setTasksStatus(undefined)
      setWorkspaceRefreshWarning(undefined)
      setWorkspaceRefreshStatus(undefined)
      setConversationNotice(undefined)
      setPreviewStatus(undefined)
      setProjectTasks([])
      setProjectMcpServers([])
      setSelectedMcpDetail(undefined)
      setSelectedMcpDetailScope(undefined)
      setProjectSkills([])
      setSelectedSkillDetail(undefined)
      setSelectedSkillDetailScope(undefined)
      setSkillDraft(prev =>
        prev?.scope === 'project' ? undefined : prev,
      )
      setCustomCommands([])
      setMcpDraft(prev =>
        prev.scope === 'project' ? emptyMcpDraft() : prev,
      )
      setPluginDraft(prev =>
        prev.scope === 'project' || prev.scope === 'local'
          ? emptyPluginDraft()
          : prev,
      )
      setSelectedPluginIdentity(undefined)
      setProjectTaskDraft(emptyProjectTaskDraft())
      setAgentList({ activeAgents: [], allAgents: [] })
      setSelectedAgentType(undefined)
      setSelectedAgentSource(undefined)
      setAgentDraft(prev =>
        prev.source === 'project' ? emptyAgentDraft() : prev,
      )
      setAgentLaunchDraft(emptyAgentLaunchDraft())
      setAgentTaskPrompt('')
      setTeams([])
      setTeamDraft(emptyTeamDraft())
      setChatTarget({
        type: 'session',
        teamName: '',
        agentType: '',
      })
      setAgentDiagnostics(undefined)
      setAgentsStatus(undefined)
      setTeamsStatus(undefined)
      setMcpHealthOutput(null)
      setPluginOutput(null)
      setAgentsActiveSection('agents-catalog')
      setTeamsActiveSection('agents-teams')
      pendingPaneSectionRef.current = undefined
      return
    }
    activeSessionIdRef.current = activeSession.id
    setPrimaryNavView(derivePrimaryNavView(activeSession.layout))
    const restoredSettingsSection = activeSession.layout.settingsActiveSection ?? 'settings-runtime'
    const restoredTasksSection = activeSession.layout.tasksActiveSection ?? 'tasks-project-tasks'
    const restoredAgentsSection = activeSession.layout.agentsActiveSection ?? 'agents-catalog'
    const restoredTeamsSection = activeSession.layout.teamsActiveSection ?? 'agents-teams'
    const restoredMcpSection = activeSession.layout.mcpActiveSection ?? 'mcp-servers'
    const restoredSkillsSection = activeSession.layout.skillsActiveSection ?? 'skills-installed'
    setSettingsActiveSection(restoredSettingsSection)
    setTasksActiveSection(restoredTasksSection)
    setAgentsActiveSection(restoredAgentsSection)
    setTeamsActiveSection(restoredTeamsSection)
    setMcpActiveSection(restoredMcpSection)
    setSkillsActiveSection(restoredSkillsSection)
    setSelectedAgentType(activeSession.layout.selectedAgentType)
    setSelectedAgentSource(activeSession.layout.selectedAgentSource as AgentSource | undefined)
    if (
      activeSession.layout.activePane === 'settings' ||
      activeSession.layout.activePane === 'tasks' ||
      activeSession.layout.activePane === 'agents' ||
      activeSession.layout.activePane === 'teams' ||
      activeSession.layout.activePane === 'mcp' ||
      activeSession.layout.activePane === 'skills'
    ) {
      pendingPaneSectionRef.current = {
        pane: activeSession.layout.activePane,
        sectionId:
          activeSession.layout.activePane === 'tasks'
            ? restoredTasksSection
            : activeSession.layout.activePane === 'agents'
              ? restoredAgentsSection
              : activeSession.layout.activePane === 'teams'
                ? restoredTeamsSection
                : activeSession.layout.activePane === 'mcp'
                  ? (activeSession.layout.mcpActiveSection ?? 'mcp-servers')
                  : activeSession.layout.activePane === 'skills'
                    ? (activeSession.layout.skillsActiveSection ?? 'skills-installed')
              : restoredSettingsSection,
      }
    } else {
      pendingPaneSectionRef.current = undefined
    }
    setConversationNotice(undefined)
    setActiveFile(activeSession.layout.activeFile)
    setFilesStatus(undefined)
    setDiffStatus(undefined)
    setWorkspaceRefreshWarning(undefined)
    setWorkspaceRefreshStatus(undefined)
    setEditorStatus(undefined)
    setAgentsStatus(undefined)
    setTeamsStatus(undefined)
    setTasksStatus(undefined)
    setMcpStatus(undefined)
    setSkillsStatus(undefined)
    setProjectTasks([])
    setProjectMcpServers([])
    setSelectedMcpDetail(undefined)
    setSelectedMcpDetailScope(undefined)
    setProjectSkills([])
    setSelectedSkillDetail(undefined)
    setSelectedSkillDetailScope(undefined)
    setSkillDraft(prev =>
      prev?.scope === 'project' ? undefined : prev,
    )
    setCustomCommands([])
    setMcpDraft(prev =>
      prev.scope === 'project' ? emptyMcpDraft() : prev,
    )
    const restoredPluginIdentity = activeSession.layout.selectedPluginIdentity
    const restoredPlugin = restoredPluginIdentity
      ? desktopConfig?.plugins.find(plugin => installedPluginIdentity(plugin) === restoredPluginIdentity)
      : undefined
    setPluginDraft(restoredPlugin ? {
      plugin: restoredPlugin.id.trim(),
      scope: restoredPlugin.scope === 'project'
        ? 'project'
        : restoredPlugin.scope === 'local'
          ? 'local'
          : 'user',
    } : prev =>
      prev.scope === 'project' || prev.scope === 'local'
        ? emptyPluginDraft()
        : prev,
    )
    setSelectedPluginIdentity(restoredPlugin ? restoredPluginIdentity : undefined)
    setProjectTaskDraft(emptyProjectTaskDraft())
    const selectedGlobalTaskId = activeSession.layout.selectedGlobalTaskId?.trim()
    const restoredGlobalTask = selectedGlobalTaskId
      ? desktopConfig?.scheduledTasks.find(task => task.id.trim() === selectedGlobalTaskId)
      : undefined
    setTaskDraft(restoredGlobalTask ? { ...taskDraftFromTask(restoredGlobalTask), id: selectedGlobalTaskId } : emptyTaskDraft())
    setMcpHealthOutput(null)
    setPluginOutput(null)
    setAgentList({ activeAgents: [], allAgents: [] })
    setAgentDraft(prev =>
      prev.source === 'project' ? emptyAgentDraft() : prev,
    )
    setAgentLaunchDraft({
      ...emptyAgentLaunchDraft(),
      agentType: activeSession.layout.selectedAgentType ?? '',
    })
    setAgentTaskPrompt('')
    const restoredTeamRecipient = activeSession.layout.selectedTeamRecipient ?? (activeSession.layout.selectedTeamName ? '*' : '')
    setTeams([])
    setTeamDraft({
      ...emptyTeamDraft(),
      teamName: activeSession.layout.selectedTeamName ?? '',
      to: restoredTeamRecipient,
    })
    setChatTarget({
      type: activeSession.layout.selectedTeamName
        ? 'team'
        : activeSession.layout.selectedAgentType
          ? 'agent'
          : 'session',
      teamName: activeSession.layout.selectedTeamName ?? '',
      agentType: activeSession.layout.selectedTeamName ? '' : activeSession.layout.selectedAgentType ?? '',
    })
    setAgentDiagnostics(undefined)
    setPreviewUrl(activeSession.layout.previewUrl ?? '')
    setCommittedPreviewUrl(activeSession.layout.previewUrl ?? '')
    setPreviewStatus(
      activeSession.layout.previewUrl
        ? { kind: 'success', text: `Previewing ${activeSession.layout.previewUrl}` }
        : undefined,
    )
    setTerminalId(activeSession.layout.terminalId)
    terminalIdRef.current = activeSession.layout.terminalId
    setTerminalInfo(undefined)
    setTerminalOutput('')
    setTerminalStatus(
      activeSession.layout.terminalId
        ? { kind: 'info', text: 'Restoring shell state...' }
        : undefined,
    )
    void runAction('Refreshing workspace', async () => {
      await refreshWorkspace(activeSession)
      if (activeSessionIdRef.current !== activeSession.id) return
      if (activeSession.layout.activeFile) {
        let contents: string
        try {
          contents = await window.claudeDesktop.workspace.readFile(
            activeSession.cwd,
            activeSession.layout.activeFile,
          )
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          setEditorStatus({ kind: 'error', text: message })
          setActiveFile(undefined)
          setFileContents('')
          setSavedFileContents('')
          await updateSessionLayout(activeSession.id, { activeFile: undefined })
          throw cause
        }
        if (activeSessionIdRef.current !== activeSession.id) return
        const shouldApplyContents = shouldApplyLoadedEditorContents({
          activeFile: activeSession.layout.activeFile,
          loadedFile: activeSession.layout.activeFile,
          fileContents: fileContentsRef.current,
          savedFileContents: savedFileContentsRef.current,
          modelPath: monacoPathRef.current,
          modelValue: monacoModelRef.current?.getValue(),
        })
        if (shouldApplyContents) {
          fileContentsRef.current = contents
          setFileContents(contents)
        }
        savedFileContentsRef.current = contents
        setSavedFileContents(contents)
        setEditorStatus({ kind: 'success', text: `Opened ${activeSession.layout.activeFile}` })
      } else {
        setFileContents('')
        setSavedFileContents('')
      }
    })
  }, [activeSession?.id])

  useEffect(() => {
    if (activePane !== 'terminal' || !xtermHostRef.current) return
    if (!xtermRef.current) {
      xtermRef.current = new Terminal({
        cursorBlink: true,
        fontFamily: 'SFMono-Regular, SF Mono, Consolas, Liberation Mono, monospace',
        fontSize: 12,
        theme: {
          background: '#151515',
          foreground: '#f0eee8',
        },
      })
      xtermRef.current.onData(data => {
        if (terminalIdRef.current) {
          void window.claudeDesktop.terminal.write(terminalIdRef.current, data)
        }
      })
    }
    if (!xtermHostRef.current.childElementCount) {
      xtermRef.current.open(xtermHostRef.current)
      xtermRef.current.write(terminalOutput)
    }
  }, [activePane, terminalId, terminalOutput])

  useEffect(() => {
    if (activePane !== 'terminal' || !xtermHostRef.current || !xtermRef.current) return
    const syncSize = () => {
      if (!xtermHostRef.current || !xtermRef.current) return
      const nextSize = terminalSize(xtermHostRef.current)
      const previousSize = terminalSizeRef.current
      const currentTerminalId = terminalIdRef.current
      if (
        previousSize?.terminalId === currentTerminalId &&
        previousSize?.columns === nextSize.columns &&
        previousSize.rows === nextSize.rows
      ) {
        return
      }
      terminalSizeRef.current = { terminalId: currentTerminalId, ...nextSize }
      xtermRef.current.resize(nextSize.columns, nextSize.rows)
      if (currentTerminalId) {
        void window.claudeDesktop.terminal.resize(
          currentTerminalId,
          nextSize.columns,
          nextSize.rows,
        )
      }
    }
    syncSize()
    const observer = new ResizeObserver(syncSize)
    observer.observe(xtermHostRef.current)
    return () => observer.disconnect()
  }, [activePane, terminalId, workspaceRatio])

  const flatTree = useMemo(
    () => flattenTree(tree, expandedPaths),
    [tree, expandedPaths],
  )
  const runtimeTodos = useMemo(
    () => latestRuntimeTodos(activeSession?.toolUses).length
      ? latestRuntimeTodos(activeSession?.toolUses)
      : latestRuntimeTodosFromMessages(activeSession?.messages),
    [activeSession?.messages, activeSession?.toolUses],
  )
  const recentToolEvents = useMemo(
    () => [...(activeSession?.toolUses ?? [])].slice(-6).reverse(),
    [activeSession?.toolUses],
  )
  const recentToolMessages = useMemo(
    () => [...(activeSession?.messages ?? [])]
      .filter(message => message.role === 'tool')
      .slice(-6)
      .reverse(),
    [activeSession?.messages],
  )
  const runningAgentTasks = useMemo(
    () => (activeSession?.agentTasks ?? [])
      .filter(task => task.status === 'running')
      .slice(-4)
      .reverse(),
    [activeSession?.agentTasks],
  )
  const currentComposerTrigger = useMemo(
    () => composerTrigger(input, composerCursor) ?? composerTrigger(input, input.length),
    [composerCursor, input],
  )
  const parsedMentions = useMemo<ParsedMention[]>(() => {
    if (!input.trim() || !activeSession) return []
    const mentions: ParsedMention[] = []
    // Match @agent, @team, @skill:name, @mcp:name, @filepath
    const mentionRegex = /@(skill:[\w-]+|mcp:[\w-]+|[^\s@]+)/g
    let match
    while ((match = mentionRegex.exec(input)) !== null) {
      const raw = match[0]
      const val = match[1] ?? ''
      if (val.startsWith('skill:')) {
        const name = val.slice(6)
        const skill = [
          ...(desktopConfig?.skills ?? []),
          ...projectSkills,
        ].find(s => s.name === name)
        if (skill) mentions.push({ kind: 'skill', value: name, label: `skill:${name}`, raw, index: match.index })
      } else if (val.startsWith('mcp:')) {
        const name = val.slice(4)
        const server = [
          ...(desktopConfig?.mcpServers ?? []),
          ...projectMcpServers,
        ].find(s => s.name === name)
        if (server) mentions.push({ kind: 'mcp', value: name, label: `mcp:${name}`, raw, index: match.index })
      } else {
        // Check agents first
        const agent = agentList.allAgents.find(a => a.agentType === val)
        if (agent) {
          mentions.push({ kind: 'agent', value: agent.agentType, label: agent.agentType, raw, index: match.index })
          continue
        }
        // Check teams
        const team = teams.find(t => t.name === val)
        if (team) {
          mentions.push({ kind: 'team', value: team.name, label: team.name, raw, index: match.index })
          continue
        }
        // Check files - match full path or suffix
        if (val.includes('/') || val.includes('.')) {
          const file = flatTree.find(e => e.type === 'file' && (e.path === val || e.path.endsWith('/' + val)))
          if (file) {
            mentions.push({ kind: 'file', value: file.path, label: file.path.split('/').pop() ?? file.path, raw, index: match.index })
          } else if (val.includes('.')) {
            // Has dot extension - likely a file reference even if not found in tree
            mentions.push({ kind: 'file', value: val, label: val.split('/').pop() ?? val, raw, index: match.index })
          }
        }
      }
    }
    return mentions
  }, [input, activeSession, agentList.allAgents, teams, flatTree, desktopConfig?.skills, desktopConfig?.mcpServers, projectSkills, projectMcpServers])
  // Sync chatTarget with live @mentions in input
  useEffect(() => {
    const agentMention = parsedMentions.find(m => m.kind === 'agent')
    const teamMention = parsedMentions.find(m => m.kind === 'team')
    setChatTarget(prev => {
      if (agentMention && prev.type !== 'agent') {
        return { type: 'agent' as const, teamName: '', agentType: agentMention.value }
      }
      if (teamMention && prev.type !== 'team') {
        return { type: 'team' as const, teamName: teamMention.value, agentType: '' }
      }
      if (!agentMention && !teamMention && prev.type !== 'session') {
        return { type: 'session' as const, teamName: '', agentType: '' }
      }
      return prev
    })
  }, [parsedMentions])
  const composerMenuItems = useMemo<ComposerMenuEntry[]>(() => {
    if (!currentComposerTrigger) return []
    const query = normalizeMenuFilter(currentComposerTrigger.query)
    const matches = (value: string): boolean =>
      !query || value.toLowerCase().includes(query)
    const sessionRequiredReason = 'Start or select a session first.'
    const loadingReason = loadingLabel
      ? `Wait for ${loadingLabel.toLowerCase()} to finish.`
      : undefined
    const workspaceActionDisabled = !activeSession || Boolean(loadingLabel)
    const workspaceActionDisabledReason = !activeSession ? sessionRequiredReason : loadingReason
    function withComposerMenuAvailability(items: ComposerMenuItem[]): ComposerMenuItem[] {
      if (!loadingReason) return items
      return items.map(item => ({
        ...item,
        disabled: true,
        disabledReason: item.disabledReason ?? loadingReason,
      }))
    }
    if (currentComposerTrigger.kind === '@') {
      const items: ComposerMenuEntry[] = []
      if (!activeSession) return items
      
      // Agents group
      const agentItems = agentList.allAgents
        .filter(agent => matches(agent.agentType))
        .slice(0, 6)
        .map(agent => ({
          id: `agent:${agent.source}:${agent.agentType}`,
          label: `@${agent.agentType}`,
          detail: `Agent · ${agent.source}`,
          value: `@${agent.agentType}`,
          group: 'Agents',
          icon: 'bot' as IconName,
        }))
      if (agentItems.length) items.push({ divider: true, label: 'Agents' }, ...agentItems)
      
      // Teams group
      const teamItems = teams
        .filter(team => matches(team.name))
        .slice(0, 4)
        .map(team => ({
          id: `team:${team.name}`,
          label: `@${team.name}`,
          detail: `${team.members.length} teammate${team.members.length === 1 ? '' : 's'}`,
          value: `@${team.name}`,
          group: 'Teams',
          icon: 'users' as IconName,
        }))
      if (teamItems.length) items.push({ divider: true, label: 'Teams' }, ...teamItems)
      
      // Files group
      const fileItems = flatTree
        .filter(entry => entry.type === 'file' && matches(entry.path))
        .slice(0, 6)
        .map(entry => ({
          id: `file:${entry.path}`,
          label: entry.path.split('/').pop() ?? entry.path,
          detail: entry.path,
          value: `@${entry.path}`,
          group: 'Files',
          icon: 'file' as IconName,
        }))
      if (fileItems.length) items.push({ divider: true, label: 'Files' }, ...fileItems)
      
      // Skills group
      const skillItems = [
        ...(desktopConfig?.skills ?? []).map(skill => ({ ...skill, scope: 'user' })),
        ...projectSkills.map(skill => ({ ...skill, scope: 'project' })),
      ]
        .filter(skill => matches(skill.name) || matches(skill.description ?? '') || matches(skill.path))
        .slice(0, 4)
        .map(skill => ({
          id: `skill:${scopedResourceKey(skill.scope, skill.name)}`,
          label: `@skill:${skill.name}`,
          detail: `Skill · ${skill.scope}`,
          value: `@skill:${skill.name}`,
          group: 'Skills',
          icon: 'bot' as IconName,
        }))
      if (skillItems.length) items.push({ divider: true, label: 'Skills' }, ...skillItems)
      
      // MCP group
      const mcpItems = [
        ...(desktopConfig?.mcpServers ?? []).map(server => ({ ...server, scope: 'user' })),
        ...projectMcpServers.map(server => ({ ...server, scope: 'project' })),
      ]
        .filter(server =>
          matches(server.name) ||
          matches(server.command ?? '') ||
          matches(server.url ?? ''),
        )
        .slice(0, 4)
        .map(server => ({
          id: `mcp:${scopedResourceKey(server.scope, server.name)}`,
          label: `@mcp:${server.name}`,
          detail: `MCP · ${server.scope}${server.enabled === false ? ' · disabled' : ''}${server.approvalStatus && server.approvalStatus !== 'approved' ? ` · ${server.approvalStatus}` : ''}`,
          value: `@mcp:${server.name}`,
          group: 'MCP Servers',
          icon: 'terminal' as IconName,
        }))
      if (mcpItems.length) items.push({ divider: true, label: 'MCP Servers' }, ...mcpItems)
      
      return withComposerMenuAvailability(items.slice(0, 25))
    }
    const customCommandItems: ComposerMenuItem[] = activeSession
      ? customCommands
        .filter(command =>
          matches(command.name) ||
          matches(command.description ?? '') ||
          matches(command.path),
        )
        .slice(0, 8)
        .map(command => ({
          id: `custom-command:${customCommandOptionId(command)}`,
          label: `/${command.name}`,
          detail: customCommandDetail(command),
          value: `/${command.name}`,
        }))
      : []
    const slashActions: ComposerMenuEntry[] = [
      { divider: true, label: 'Prompt' },
      {
        id: 'action:review-diff',
        label: 'review-diff',
        detail: 'Review current git changes and suggest improvements',
        icon: 'diff',
        disabled: workspaceActionDisabled,
        disabledReason: workspaceActionDisabledReason,
        value: '/review-diff',
      },
      {
        id: 'action:explain-file',
        label: 'explain-file',
        detail: activeFile ? `Explain ${activeFile}` : 'Open a file first',
        icon: 'file',
        disabled: workspaceActionDisabled,
        disabledReason: workspaceActionDisabledReason,
        value: '/explain-file',
      },
      {
        id: 'action:run-tests',
        label: 'run-tests',
        detail: 'Run the project test suite',
        icon: 'play',
        disabled: workspaceActionDisabled,
        disabledReason: workspaceActionDisabledReason,
        value: '/run-tests',
      },
      {
        id: 'action:fix-bugs',
        label: 'fix-bugs',
        detail: 'Find and fix bugs in the current codebase',
        icon: 'check',
        disabled: workspaceActionDisabled,
        disabledReason: workspaceActionDisabledReason,
        value: '/fix-bugs',
      },
      {
        id: 'action:refactor',
        label: 'refactor',
        detail: 'Refactor selected code for clarity and performance',
        icon: 'code',
        disabled: workspaceActionDisabled,
        disabledReason: workspaceActionDisabledReason,
        value: '/refactor',
      },
      { divider: true, label: 'Navigation' },
      {
        id: 'action:open-terminal',
        label: 'terminal',
        detail: 'Switch to terminal pane',
        icon: 'terminal',
        disabled: workspaceActionDisabled,
        disabledReason: workspaceActionDisabledReason,
        action: () => void setPane('terminal'),
      },
      {
        id: 'action:open-files',
        label: 'files',
        detail: 'Switch to files pane',
        icon: 'folder',
        action: () => void setPane('files'),
      },
      {
        id: 'action:refresh-workspace',
        label: 'refresh',
        detail: 'Reload files and git diff',
        icon: 'refresh',
        disabled: !activeSession || Boolean(loadingLabel),
        disabledReason: !activeSession ? sessionRequiredReason : loadingReason,
        action: () => {
          if (activeSession) {
            void runAction('Refreshing workspace', () =>
              refreshWorkspace(activeSession, { showStatus: true }),
            )
          }
        },
      },
      { divider: true, label: 'Create' },
      {
        id: 'action:new-custom-agent',
        label: 'new-agent',
        detail: 'Create a new custom agent',
        icon: 'bot',
        action: () => {
          void openPaneSection('agents', 'agents-editor', 'agents')
          startNewAgentDraft()
        },
      },
      {
        id: 'action:new-team',
        label: 'new-team',
        detail: 'Create a new agent team',
        icon: 'users',
        disabled: workspaceActionDisabled,
        disabledReason: workspaceActionDisabledReason,
        action: () => {
          void openPaneSection('teams', 'agents-teams', 'teams')
          startNewTeamDraft()
        },
      },
      {
        id: 'action:new-global-task',
        label: 'new-global-task',
        detail: 'Create a global scheduled task',
        icon: 'play',
        action: () => {
          void openPaneSection('tasks', 'tasks-global-tasks', 'tasks')
          startNewScheduledTaskDraft()
        },
      },
      {
        id: 'action:add-mcp',
        label: 'add-mcp',
        detail: 'Add a new MCP server',
        icon: 'terminal',
        action: () => {
          openPaneSection('mcp', 'mcp-servers', 'mcp')
          startNewMcpDraft()
        },
      },
      {
        id: 'action:new-user-skill',
        label: 'new-skill',
        detail: 'Create a new skill',
        icon: 'bot',
        action: () => {
          openPaneSection('skills', 'skills-create', 'skills')
          startNewUserSkillDraft()
        },
      },
      { divider: true, label: 'Settings' },
      {
        id: 'action:list-plugins',
        label: 'plugins',
        detail: 'Open plugin management',
        icon: 'code',
        action: () => {
          openPaneSection('settings', 'settings-plugins', 'settings')
          void listAvailablePlugins()
        },
      },
      {
        id: 'action:refresh-settings',
        label: 'reload-config',
        detail: 'Reload all configuration',
        icon: 'refresh',
        action: () => {
          openPaneSection('settings', 'settings-runtime', 'settings')
          void refreshSettingsConfig()
        },
      },
      {
        id: 'action:export-diagnostics',
        label: 'diagnostics',
        detail: 'Export diagnostic information',
        icon: 'clipboard',
        action: () => {
          openPaneSection('settings', 'settings-runtime', 'settings')
          void handleDiagnosticsExportClick()
        },
      },
    ]
    return withComposerMenuAvailability([
      ...customCommandItems.map(item => ({ ...item, group: 'Custom Commands', icon: 'code' as IconName })),
      ...slashActions.filter(item =>
        'divider' in item || matches(item.label) || matches(item.detail),
      ),
    ].slice(0, 25))
  }, [
    activeFile,
    activeSession,
    agentList.allAgents,
    currentComposerTrigger,
    customCommands,
    desktopConfig?.mcpServers,
    desktopConfig?.skills,
    flatTree,
    loadingLabel,
    projectMcpServers,
    projectSkills,
    teams,
  ])
  const pluginScopeNeedsSession =
    (pluginDraft.scope === 'project' || pluginDraft.scope === 'local') &&
    !activeSession
  const pluginDraftSessionBlocked = pluginScopeNeedsSession
  const canRunPluginCommand = !pluginScopeNeedsSession
  const canInstallPlugin = Boolean(pluginDraft.plugin.trim() && canRunPluginCommand)

  function stageSlashCommand(commandName: string): void {
    const nextCursor = commandName.length + 2
    openPrimaryView('chat')
    setInput(`/${commandName} `)
    setComposerCursor(nextCursor)
    window.setTimeout(() => {
      const textarea = composerTextareaRef.current
      textarea?.focus()
      textarea?.setSelectionRange(nextCursor, nextCursor)
    }, 0)
  }

  function customCommandOptionId(command: CustomCommandInfo): string {
    return `${command.kind ?? 'command'}:${command.scope}:${command.name}`
  }

  function customCommandDetail(command: CustomCommandInfo): string {
    if (command.description) return command.description
    return command.kind === 'workflow'
      ? `Workflow · ${command.scope}`
      : `Custom command · ${command.scope}`
  }

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const sessionRequired = !activeSession
    const sessionRequiredReason = 'Start or select a session first.'
    const loadingReason = loadingLabel
      ? `Wait for ${loadingLabel.toLowerCase()} to finish.`
      : undefined
    const items: CommandPaletteItem[] = [
      ...customCommands.map(command => ({
        id: `slash-command:${customCommandOptionId(command)}`,
        label: `/${command.name}`,
        detail: customCommandDetail(command),
        icon: 'terminal' as const,
        disabled: sessionRequired,
        disabledReason: sessionRequired ? sessionRequiredReason : undefined,
        run: () => stageSlashCommand(command.name),
      })),
      {
        id: 'primary:chat',
        label: 'Chat',
        detail: 'Open the conversation',
        icon: 'panel',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => selectPrimaryNavView('chat'),
      },
      {
        id: 'primary:agents',
        label: 'Agents',
        detail: 'Manage agent catalog, launches, and running tasks',
        icon: 'bot',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => selectPrimaryNavView('agents'),
      },
      {
        id: 'primary:teams',
        label: 'Teams',
        detail: 'Manage local teams and teammates',
        icon: 'users',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => selectPrimaryNavView('teams'),
      },
      {
        id: 'primary:tasks',
        label: 'Tasks',
        detail: 'Manage scheduled task lifecycles',
        icon: 'clipboard',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => selectPrimaryNavView('tasks'),
      },
      {
        id: 'primary:mcp',
        label: 'MCP Servers',
        detail: 'Manage Model Context Protocol servers',
        icon: 'terminal',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => selectPrimaryNavView('mcp'),
      },
      {
        id: 'primary:skills',
        label: 'Skills',
        detail: 'Manage installed skills and create new ones',
        icon: 'bot',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => selectPrimaryNavView('skills'),
      },
      {
        id: 'primary:settings',
        label: 'Settings',
        detail: 'Open grouped desktop settings',
        icon: 'settings',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => selectPrimaryNavView('settings'),
      },
      {
        id: 'settings:general',
        label: 'General settings',
        detail: 'Open runtime paths, local configuration, and diagnostics',
        icon: 'settings',
        run: () => openPaneSection('settings', 'settings-runtime', 'settings'),
      },
      {
        id: 'settings:proxy',
        label: 'Proxy settings',
        detail: 'Configure Claude Code runtime proxy',
        icon: 'panel',
        run: () => openPaneSection('settings', 'settings-proxy', 'settings'),
      },
      {
        id: 'settings:mcp',
        label: 'MCP settings',
        detail: 'Manage user and project MCP servers',
        icon: 'settings',
        run: () => openPaneSection('mcp', 'mcp-servers', 'mcp'),
      },
      {
        id: 'settings:mcp:add',
        label: 'Add MCP server',
        detail: 'Open the MCP form with a clean draft',
        icon: 'plus',
        run: () => {
          openPaneSection('mcp', 'mcp-servers', 'mcp')
          startNewMcpDraft()
        },
      },
      {
        id: 'settings:mcp:check',
        label: 'Check MCP health',
        detail: 'Run the selected workspace MCP health check',
        icon: 'refresh',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => {
          openPaneSection('mcp', 'mcp-servers', 'mcp')
          void checkMcpHealth()
        },
      },
      {
        id: 'settings:skills',
        label: 'Skills settings',
        detail: 'Manage installed user and project skills',
        icon: 'code',
        run: () => openPaneSection('skills', 'skills-installed', 'skills'),
      },
      {
        id: 'settings:skills:new-user',
        label: 'New user skill',
        detail: 'Create or edit a user-scope SKILL.md directly',
        icon: 'plus',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => {
          openPaneSection('skills', 'skills-installed', 'skills')
          startNewUserSkillDraft()
        },
      },
      {
        id: 'settings:skills:new-project',
        label: 'New project skill',
        detail: 'Create or edit a project-scope SKILL.md directly',
        icon: 'plus',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => {
          openPaneSection('skills', 'skills-installed', 'skills')
          startNewProjectSkillDraft()
        },
      },
      {
        id: 'settings:skills:install-user',
        label: 'Install user skill',
        detail: 'Choose a local skill folder for the user scope',
        icon: 'plus',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => {
          openPaneSection('skills', 'skills-installed', 'skills')
          void installLocalSkill()
        },
      },
      {
        id: 'settings:skills:install-project',
        label: 'Install project skill',
        detail: 'Choose a local skill folder for the active workspace',
        icon: 'plus',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => {
          openPaneSection('skills', 'skills-installed', 'skills')
          void installProjectSkill()
        },
      },
      {
        id: 'settings:plugins',
        label: 'Plugin settings',
        detail: 'List and install user, project, or local plugins',
        icon: 'code',
        run: () => openPaneSection('settings', 'settings-plugins', 'settings'),
      },
      {
        id: 'settings:plugins:list',
        label: 'List plugins',
        detail: 'List available plugins for the selected scope',
        icon: 'refresh',
        disabled: !!loadingLabel || !canRunPluginCommand,
        disabledReason: !canRunPluginCommand
          ? 'Select a session for project or local plugin scope.'
          : loadingReason,
        run: () => {
          openPaneSection('settings', 'settings-plugins', 'settings')
          void listAvailablePlugins()
        },
      },
      {
        id: 'settings:plugins:install',
        label: 'Install plugin',
        detail: 'Install the plugin package in the Settings form',
        icon: 'plus',
        disabled: !!loadingLabel || !canInstallPlugin,
        disabledReason: !canInstallPlugin
          ? pluginScopeNeedsSession
            ? 'Select a session for project or local plugin scope.'
            : 'Enter a plugin package before installing.'
          : loadingReason,
        run: () => {
          openPaneSection('settings', 'settings-plugins', 'settings')
          void installPlugin()
        },
      },
      {
        id: 'settings:diagnostics',
        label: 'Export diagnostics',
        detail: 'Write a redacted local support bundle',
        icon: 'clipboard',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => {
          openPaneSection('settings', 'settings-runtime', 'settings')
          void exportDiagnostics()
        },
      },
      {
        id: 'settings:refresh',
        label: 'Refresh settings',
        detail: 'Reload Claude Code configuration',
        icon: 'refresh',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => {
          openPaneSection('settings', 'settings-runtime', 'settings')
          void refreshSettingsConfig()
        },
      },
      {
        id: 'agents:available',
        label: 'Available agents',
        detail: 'Browse and select configured agents',
        icon: 'bot',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => openPaneSection('agents', 'agents-catalog', 'agents'),
      },
      {
        id: 'agents:run',
        label: 'Run agent',
        detail: 'Prepare and launch an agent task',
        icon: 'play',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => openPaneSection('agents', 'agents-launch', 'agents'),
      },
      {
        id: 'agents:custom',
        label: 'Custom agents',
        detail: 'Create or edit user and project agents',
        icon: 'settings',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => openPaneSection('agents', 'agents-editor', 'agents'),
      },
      {
        id: 'agents:new',
        label: 'New custom agent',
        detail: 'Open the agent editor with a clean draft',
        icon: 'plus',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => {
          void openPaneSection('agents', 'agents-editor', 'agents')
          startNewAgentDraft()
        },
      },
      {
        id: 'agents:running',
        label: 'Running agent tasks',
        detail: 'Inspect, resume, or stop active agent work',
        icon: 'clipboard',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => openPaneSection('agents', 'agents-tasks', 'agents'),
      },
      {
        id: 'teams:management',
        label: 'Team management',
        detail: 'Create teams, message teammates, and manage shutdown',
        icon: 'users',
        disabled: sessionRequired,
        disabledReason: sessionRequired ? sessionRequiredReason : undefined,
        run: () => openPaneSection('teams', 'agents-teams', 'teams'),
      },
      {
        id: 'teams:new',
        label: 'New team',
        detail: 'Open team management with a clean draft',
        icon: 'plus',
        disabled: sessionRequired,
        disabledReason: sessionRequired ? sessionRequiredReason : undefined,
        run: () => {
          void openPaneSection('teams', 'agents-teams', 'teams')
          startNewTeamDraft()
        },
      },
      {
        id: 'tasks:project',
        label: 'Project scheduled tasks',
        detail: 'Manage workspace task lifecycles',
        icon: 'folder',
        disabled: sessionRequired,
        disabledReason: sessionRequired ? sessionRequiredReason : undefined,
        run: () => openPaneSection('tasks', 'tasks-project-tasks', 'tasks'),
      },
      {
        id: 'tasks:new-project',
        label: 'New project scheduled task',
        detail: 'Open project task scheduling with a clean draft',
        icon: 'plus',
        disabled: sessionRequired,
        disabledReason: sessionRequired ? sessionRequiredReason : undefined,
        run: () => {
          void openPaneSection('tasks', 'tasks-project-tasks', 'tasks')
          startNewProjectScheduledTaskDraft()
        },
      },
      {
        id: 'tasks:global',
        label: 'Global scheduled tasks',
        detail: 'Manage user-level scheduled tasks',
        icon: 'clipboard',
        run: () => openPaneSection('tasks', 'tasks-global-tasks', 'tasks'),
      },
      {
        id: 'tasks:new-global',
        label: 'New global scheduled task',
        detail: 'Open global scheduling with a clean draft',
        icon: 'plus',
        run: () => {
          void openPaneSection('tasks', 'tasks-global-tasks', 'tasks')
          startNewScheduledTaskDraft()
        },
      },
      {
        id: 'pane:files',
        label: 'Files',
        detail: 'Open workspace file tree',
        icon: 'folder',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => selectWorkspacePane('files'),
      },
      {
        id: 'pane:diff',
        label: 'Diff',
        detail: 'Open git status and diff',
        icon: 'diff',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => selectWorkspacePane('diff'),
      },
      {
        id: 'pane:editor',
        label: 'Editor',
        detail: activeFile ? `Open editor for ${activeFile}` : 'Open file editor',
        icon: 'code',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => selectWorkspacePane('editor'),
      },
      {
        id: 'pane:terminal',
        label: 'Terminal',
        detail: 'Open project terminal',
        icon: 'terminal',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => selectWorkspacePane('terminal'),
      },
      {
        id: 'pane:preview',
        label: 'Preview',
        detail: 'Open embedded browser preview',
        icon: 'globe',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => selectWorkspacePane('preview'),
      },
      {
        id: 'session:new-quick',
        label: 'Quick desktop workspace',
        detail: 'Start a local desktop workspace session',
        icon: 'plus',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => void createDefaultSession(),
      },
      {
        id: 'session:new-folder',
        label: 'Choose project folder',
        detail: 'Start a session from a selected directory',
        icon: 'folder',
        disabled: !!loadingLabel,
        disabledReason: loadingReason,
        run: () => void createSession(),
      },
      {
        id: 'session:clear-desktop-view',
        label: 'Clear desktop transcript view',
        detail: 'Clear local desktop messages without deleting Claude transcript storage',
        icon: 'trash',
        disabled: sessionRequired || !!loadingLabel,
        disabledReason: sessionRequired ? sessionRequiredReason : loadingReason,
        run: () => void clearDesktopTranscriptView(),
      },
      {
        id: 'workspace:refresh',
        label: 'Refresh workspace',
        detail: 'Reload files, git status, agents, teams, skills, and MCP',
        icon: 'refresh',
        disabled: !activeSession || !!loadingLabel,
        disabledReason: !activeSession ? sessionRequiredReason : loadingReason,
        run: () => {
          if (activeSession) {
            void runAction('Refreshing workspace', () =>
              refreshWorkspace(activeSession, { showStatus: true }),
            )
          }
        },
      },
    ]
    return items.map(item => {
      const blocksDuringLoading =
        item.id.startsWith('slash-command:') ||
        item.id.startsWith('primary:') ||
        item.id.startsWith('pane:') ||
        item.id.startsWith('settings:') ||
        item.id.startsWith('agents:') ||
        item.id.startsWith('teams:') ||
        item.id.startsWith('tasks:')
      if (!loadingReason || !blocksDuringLoading) return item
      return {
        ...item,
        disabled: true,
        disabledReason: item.disabledReason ?? loadingReason,
      }
    })
  }, [
    activeFile,
    activeSession,
    canInstallPlugin,
    canRunPluginCommand,
    customCommands,
    loadingLabel,
    pluginScopeNeedsSession,
  ])
  const commandPaletteItemsForQuery = useMemo(() => {
    const query = commandPaletteQuery.trim().toLowerCase()
    const matches = (value: string): boolean => value.toLowerCase().includes(query)
    return commandPaletteItems
      .filter(item =>
        !query ||
        matches(item.label) ||
        matches(item.detail) ||
        matches(item.id.replace(':', ' ')),
      )
      .slice(0, 12)
  }, [commandPaletteItems, commandPaletteQuery])
  const workspaceFileCount = useMemo(() => countWorkspaceFiles(tree), [tree])
  const diffFiles = useMemo(() => parseGitDiff(gitDiff), [gitDiff])
  const selectedDiff =
    diffFiles.find(file => file.path === selectedDiffPath) ?? diffFiles[0]
  const canSaveMcp = canSaveMcpDraft(mcpDraft, Boolean(activeSession))
  const skillDraftSessionBlocked = skillDraft?.scope === 'project' && !activeSession
  const canSaveSkill = canSaveSkillDraft(skillDraft, Boolean(activeSession))
  const canSaveTask = canSaveTaskDraft(taskDraft)
  const canSaveProjectTask = canSaveProjectTaskDraft(
    projectTaskDraft,
    Boolean(activeSession),
  )
  const taskScheduleInvalid =
    Boolean(taskDraft.prompt.trim() || taskDraft.schedule.trim()) &&
    !isValidCronExpression(taskDraft.schedule)
  const projectTaskCronInvalid =
    Boolean(projectTaskDraft.prompt.trim() || projectTaskDraft.cron.trim()) &&
    !isValidCronExpression(projectTaskDraft.cron)
  const mcpDraftSessionBlocked = mcpDraft.scope === 'project' && !activeSession
  const mcpProjectNeedsSession = mcpDraftSessionBlocked
  const agentLaunchDraftSessionBlocked = !activeSession
  const agentTaskPromptSessionBlocked = !activeSession
  const teamDraftSessionBlocked = !activeSession
  const canLaunchAgentTask = Boolean(
    activeSession &&
    !turnBusy &&
    agentLaunchDraft.agentType.trim() &&
    agentLaunchDraft.description.trim() &&
    agentLaunchDraft.prompt.trim(),
  )
  const agentLaunchTaskInvalid =
    Boolean(agentLaunchDraft.description.trim() || agentLaunchDraft.prompt.trim()) &&
    !agentLaunchDraft.agentType.trim()

  useEffect(() => {
    composerMenuActiveIndexRef.current = 0
    setComposerMenuActiveIndex(0)
  }, [currentComposerTrigger?.kind, currentComposerTrigger?.query])

  useEffect(() => {
    if (composerMenuItems.length === 0) {
      composerMenuActiveIndexRef.current = 0
      if (composerMenuActiveIndex !== 0) setComposerMenuActiveIndex(0)
      return
    }
    if (composerMenuActiveIndex >= composerMenuItems.length) {
      const nextIndex = composerMenuItems.length - 1
      composerMenuActiveIndexRef.current = nextIndex
      setComposerMenuActiveIndex(nextIndex)
      return
    }
    const activeItem = composerMenuItems[composerMenuActiveIndex]
    const firstEnabledIndex = composerMenuItems.findIndex(item => !('divider' in item) && !item.disabled)
    if (firstEnabledIndex >= 0 && activeItem?.disabled) {
      composerMenuActiveIndexRef.current = firstEnabledIndex
      setComposerMenuActiveIndex(firstEnabledIndex)
      return
    }
    composerMenuActiveIndexRef.current = composerMenuActiveIndex
  }, [composerMenuActiveIndex, composerMenuItems])

  useEffect(() => {
    setCommandPaletteActiveIndex(0)
  }, [commandPaletteQuery])

  useEffect(() => {
    if (!commandPaletteOpen) return
    requestAnimationFrame(() => commandPaletteInputRef.current?.focus())
  }, [commandPaletteOpen])

  useEffect(() => {
    if (commandPaletteItemsForQuery.length === 0) {
      if (commandPaletteActiveIndex !== 0) setCommandPaletteActiveIndex(0)
      return
    }
    const firstEnabledCommandIndex = commandPaletteItemsForQuery.findIndex(item => !item.disabled)
    if (commandPaletteActiveIndex >= commandPaletteItemsForQuery.length) {
      setCommandPaletteActiveIndex(
        firstEnabledCommandIndex >= 0
          ? firstEnabledCommandIndex
          : commandPaletteItemsForQuery.length - 1,
      )
      return
    }
    const activeCommand = commandPaletteItemsForQuery[commandPaletteActiveIndex]
    if (firstEnabledCommandIndex >= 0 && activeCommand?.disabled) {
      setCommandPaletteActiveIndex(firstEnabledCommandIndex)
    }
  }, [commandPaletteActiveIndex, commandPaletteItemsForQuery])

  useEffect(() => {
    if (!selectedDiffPath && diffFiles[0]) {
      setSelectedDiffPath(diffFiles[0].path)
    }
    if (selectedDiffPath && !diffFiles.some(file => file.path === selectedDiffPath)) {
      setSelectedDiffPath(diffFiles[0]?.path)
    }
  }, [diffFiles, selectedDiffPath])

  useEffect(() => {
    if (activePane !== 'editor' || !monacoHostRef.current) return
    if (!activeFile) {
      monacoEditorRef.current?.setModel(null)
      monacoModelRef.current?.dispose()
      monacoModelRef.current = undefined
      monacoPathRef.current = undefined
      return
    }
    let disposed = false
    void (async () => {
      await import('monaco-editor/min/vs/editor/editor.main.css')
      const monacoApi = monacoRef.current ??
        await import('monaco-editor/esm/vs/editor/editor.api.js')
      if (disposed || !monacoHostRef.current) return
      monacoRef.current = monacoApi

    if (!monacoEditorRef.current) {
      monacoEditorRef.current = monacoApi.editor.create(monacoHostRef.current, {
        automaticLayout: true,
        fontFamily: 'SFMono-Regular, SF Mono, Consolas, Liberation Mono, monospace',
        fontSize: 13,
        minimap: { enabled: false },
        readOnly: !!loadingLabel,
        scrollBeyondLastLine: false,
        theme: 'vs',
        wordWrap: 'on',
      })
      monacoEditorRef.current.onDidChangeModelContent(() => {
        const value = monacoEditorRef.current?.getValue() ?? ''
        fileContentsRef.current = value
        setFileContents(value)
      })
      if ('__claudeDesktopSmokeEvents' in window) {
        window.__claudeDesktopSmokeEditor = {
          setValue(value: string) {
            if (!monacoEditorRef.current) return false
            monacoEditorRef.current.setValue(value)
            fileContentsRef.current = value
            setFileContents(value)
            return true
          },
          getValue() {
            return monacoEditorRef.current?.getValue() ?? ''
          },
        }
      }
    }
    monacoEditorRef.current.updateOptions({ readOnly: !!loadingLabel })

    if (monacoPathRef.current !== activeFile) {
      monacoModelRef.current?.dispose()
      monacoModelRef.current = monacoApi.editor.createModel(
        fileContents,
        languageForPath(activeFile),
      )
      monacoEditorRef.current.setModel(monacoModelRef.current)
      monacoPathRef.current = activeFile
    } else if (
      monacoModelRef.current &&
      monacoModelRef.current.getValue() !== fileContents
    ) {
      monacoModelRef.current.setValue(fileContents)
    }
    monacoEditorRef.current.layout()
    })()
    return () => {
      disposed = true
    }
  }, [activePane, activeFile, fileContents, workspaceRatio, loadingLabel])

  function highlightSessionCreateMenuItem(index: number): void {
    if (loadingLabel) return
    setSessionCreateMenuActiveIndex(index)
  }

  function handleSessionCreateMenuItemMouseEnter(index: number): void {
    highlightSessionCreateMenuItem(index)
  }

  function highlightSessionMenuItem(index: number): void {
    if (loadingLabel) return
    setSessionMenuActiveIndex(index)
  }

  function handleSessionMenuItemMouseEnter(index: number): void {
    highlightSessionMenuItem(index)
  }

  function toggleSessionsCollapsed(): void {
    if (loadingLabel) return
    setSessionsCollapsed(value => !value)
  }

  function handleSessionsCollapseClick(): void {
    toggleSessionsCollapsed()
  }

  async function createSession(): Promise<void> {
    if (loadingLabel) return
    if (sessionCreateActionPendingRef.current) return
    sessionCreateActionPendingRef.current = true
    try {
      await runAction('Creating session', async () => {
        setSessionStatus({ kind: 'info', text: 'Choose a project folder to start a session.' })
        const session = await window.claudeDesktop.sessions.create()
        if (session) {
          mergeSession(session)
          setActiveSessionId(session.id)
          setSessionStatus({ kind: 'success', text: `Started session for ${session.cwd}` })
        } else {
          setSessionStatus({
            kind: 'info',
            text: activeSessionIdRef.current
              ? 'New session cancelled.'
              : 'Choose a project folder to start a session, or use Quick session to continue without selecting a folder.',
          })
        }
      })
    } finally {
      sessionCreateActionPendingRef.current = false
    }
  }

  async function createDefaultSession(): Promise<void> {
    if (loadingLabel) return
    if (sessionCreateActionPendingRef.current) return
    sessionCreateActionPendingRef.current = true
    try {
      await runAction('Creating session', async () => {
        setSessionStatus({ kind: 'info', text: 'Starting a session in the Claude desktop workspace.' })
        const session = await window.claudeDesktop.sessions.create({ defaultCwd: true })
        if (session) {
          mergeSession(session)
          setActiveSessionId(session.id)
          setSessionStatus({ kind: 'success', text: `Started session for ${session.cwd}` })
        }
      })
    } finally {
      sessionCreateActionPendingRef.current = false
    }
  }

  function handleQuickSessionClick(): void {
    if (loadingLabel) return
    void createDefaultSession()
  }

  function handleChooseFolderSessionClick(): void {
    if (loadingLabel) return
    void createSession()
  }

  function openSessionCreateMenu(event: ReactMouseEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    if (loadingLabel) return
    const rect = event.currentTarget.getBoundingClientRect()
    setSessionCreateMenuActiveIndex(0)
    setSessionCreateMenu({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 6),
    })
    setSessionMenu(undefined)
  }

  function handleSessionCreateButtonClick(event: ReactMouseEvent<HTMLElement>): void {
    openSessionCreateMenu(event)
  }

  function runSessionCreateMenuAction(index: number): void {
    if (loadingLabel) return
    setSessionCreateMenu(undefined)
    if (index === 0) {
      void createDefaultSession()
      return
    }
    void createSession()
  }

  function handleSessionCreateMenuItemClick(index: number): void {
    runSessionCreateMenuAction(index)
  }

  function updateComposerSelection(element: HTMLTextAreaElement): void {
    setComposerCursor(element.selectionStart ?? element.value.length)
  }

  function slashPrompt(command: string): string {
    switch (command) {
      case '/review-diff':
        return 'Please review the current uncommitted git changes. Focus on: correctness issues, potential regressions, missing edge cases, and missing tests. Provide specific actionable feedback.'
      case '/explain-file':
        return activeFile
          ? `Please explain the file @${activeFile} in detail. Cover: main purpose, key functions/classes, data flow, and any potentially tricky or risky parts.`
          : 'Please explain the file I will reference. I will open or mention a file next.'
      case '/run-tests':
        return 'Please run the relevant tests for this project, identify any failures, and fix only the issues that are clearly related to recent changes. Summarize what was tested and what passed/failed.'
      case '/fix-bugs':
        return 'Please analyze the codebase for bugs. Look for: logic errors, edge cases not handled, null/undefined issues, race conditions, and resource leaks. Fix confirmed bugs and explain each fix.'
      case '/refactor':
        return 'Please refactor the selected or referenced code to improve clarity, reduce duplication, and follow best practices. Do not change behavior unless fixing a clear bug. Explain the refactoring decisions.'
      case '/terminal':
        return ''
      case '/files':
        return ''
      case '/refresh':
        return ''
      case '/new-agent':
        return ''
      case '/new-team':
        return ''
      case '/new-global-task':
        return ''
      case '/add-mcp':
        return ''
      case '/new-skill':
        return ''
      case '/plugins':
        return ''
      case '/reload-config':
        return ''
      case '/diagnostics':
        return ''
      default:
        return command.startsWith('/') ? command.slice(1) + ': ' : command
    }
  }

  function enabledComposerMenuIndex(
    start: number,
    direction: 1 | -1,
  ): number {
    const items = composerMenuItems
    if (!items.length) return 0
    for (let offset = 0; offset < items.length; offset += 1) {
      const index = (start + direction * offset + items.length) % items.length
      const entry = items[index]
      if (entry && 'divider' in entry) continue
      if (entry && !entry.disabled) return index
    }
    return Math.max(0, Math.min(start, items.length - 1))
  }

  function chooseComposerMenuItem(item: ComposerMenuItem): void {
    const trigger = currentComposerTrigger
    if (!trigger) return
    if (item.disabled || loadingLabel) return
    
    // Action items: execute directly without inserting text
    if (item.action) {
      setInput(value => value.slice(0, trigger.start) + value.slice(trigger.end))
      setComposerCursor(trigger.start)
      item.action()
      window.requestAnimationFrame(() => composerTextareaRef.current?.focus())
      return
    }
    
    // Slash commands
    if (trigger.kind === '/') {
      const promptText = item.value?.startsWith('/') ? slashPrompt(item.value) : item.value
      if (promptText) {
        // Insert the generated prompt and auto-send
        const result = applyComposerMenuValue({ input, cursor: composerCursor, value: promptText })
        setInput(result.input)
        setComposerCursor(result.cursor)
        // Auto-send after slash command prompt is inserted
        window.requestAnimationFrame(() => {
          const textarea = composerTextareaRef.current
          if (textarea) {
            textarea.blur()
          }
          // Trigger send after state update
          setTimeout(() => {
            void sendMessage()
          }, 50)
        })
      } else {
        // Empty value means navigation action, clear the /
        setInput(value => value.slice(0, trigger.start) + value.slice(trigger.end))
        setComposerCursor(trigger.start)
        window.requestAnimationFrame(() => composerTextareaRef.current?.focus())
      }
      return
    }
    
    // @ mentions: insert @mention value with trailing space
    const value = item.value ?? ''
    const result = applyComposerMenuValue({ input, cursor: composerCursor, value })
    setInput(result.input)
    setComposerCursor(result.cursor)
    window.requestAnimationFrame(() => {
      const textarea = composerTextareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(result.cursor, result.cursor)
    })
  }

  function handleComposerMenuItemMouseDown(event: ReactMouseEvent<HTMLButtonElement>, item: ComposerMenuItem): void {
    event.preventDefault()
    chooseComposerMenuItem(item)
  }

  function handleComposerInputChange(event: ReactChangeEvent<HTMLTextAreaElement>): void {
    if (loadingLabel) return
    setInput(event.target.value)
    updateComposerSelection(event.target)
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (currentComposerTrigger && composerMenuItems.length && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault()
      let selected = composerMenuItems[composerMenuActiveIndexRef.current] ?? composerMenuItems[0]!
      if (selected && 'divider' in selected) {
        const nextIdx = enabledComposerMenuIndex(composerMenuActiveIndexRef.current + 1, 1)
        selected = composerMenuItems[nextIdx] as ComposerMenuItem
      }
      if (selected && !('divider' in selected)) {
        chooseComposerMenuItem(selected)
      }
      return
    }
    if (currentComposerTrigger && event.key === 'Escape') {
      event.preventDefault()
      const textarea = composerTextareaRef.current
      if (textarea) {
        const end = textarea.value.length
        textarea.setSelectionRange(end, end)
        setComposerCursor(end)
      }
      return
    }
    if (currentComposerTrigger && composerMenuItems.length && event.key === 'ArrowDown') {
      event.preventDefault()
      setComposerMenuActiveIndex(index => {
        const nextIndex = enabledComposerMenuIndex(index + 1, 1)
        composerMenuActiveIndexRef.current = nextIndex
        return nextIndex
      })
      return
    }
    if (currentComposerTrigger && composerMenuItems.length && event.key === 'ArrowUp') {
      event.preventDefault()
      setComposerMenuActiveIndex(index => {
        const nextIndex = enabledComposerMenuIndex(index - 1, -1)
        composerMenuActiveIndexRef.current = nextIndex
        return nextIndex
      })
      return
    }
    if (currentComposerTrigger && composerMenuItems.length && event.key === 'Home') {
      event.preventDefault()
      const nextIndex = enabledComposerMenuIndex(0, 1)
      composerMenuActiveIndexRef.current = nextIndex
      setComposerMenuActiveIndex(nextIndex)
      return
    }
    if (currentComposerTrigger && composerMenuItems.length && event.key === 'End') {
      event.preventDefault()
      const nextIndex = enabledComposerMenuIndex(composerMenuItems.length - 1, -1)
      composerMenuActiveIndexRef.current = nextIndex
      setComposerMenuActiveIndex(nextIndex)
      return
    }
    if (currentComposerTrigger && event.key === 'Escape') {
      event.preventDefault()
      const nextCursor = currentComposerTrigger.start
      setInput(value => value.slice(0, currentComposerTrigger.start) + value.slice(currentComposerTrigger.end))
      setComposerCursor(nextCursor)
      return
    }
    if (shouldSubmitComposerKey(event)) {
      event.preventDefault()
      void sendMessage()
    }
  }

  async function confirmDiscardUnsavedChanges(): Promise<boolean> {
    const editorValue = monacoModelRef.current?.getValue()
    const dirty = hasUnsavedChangesRef.current ||
      editorHasUnsavedChanges({
        activeFile: activeFileRef.current,
        fileContents: fileContentsRef.current,
        savedFileContents: savedFileContentsRef.current,
        modelValue: editorValue,
      }) ||
      hasUnsavedChanges
    if (!dirty) return true
    if (discardEditorChangesActionPendingRef.current) return false
    discardEditorChangesActionPendingRef.current = true
    try {
      return await requestConfirmation({
        title: 'Discard unsaved changes?',
        message: `The editor has unsaved changes in ${activeFileRef.current ?? activeFile}. Switching away will lose them.`,
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      })
    } finally {
      discardEditorChangesActionPendingRef.current = false
    }
  }

  function discardEditorChanges(): void {
    const savedContents = savedFileContentsRef.current
    fileContentsRef.current = savedContents
    setFileContents(savedContents)
    if (monacoModelRef.current && monacoModelRef.current.getValue() !== savedContents) {
      monacoModelRef.current.setValue(savedContents)
    }
    hasUnsavedChangesRef.current = false
    void window.claudeDesktop.app.setUnsavedChanges(false).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
    if ('__claudeDesktopSmokeEvents' in window) {
      window.__claudeDesktopSmokeHasUnsavedChanges = false
    }
  }

  async function focusSession(sessionId: string): Promise<void> {
    if (loadingLabel) return
    if (sessionId === activeSessionIdRef.current && !sessionFocusInFlightRef.current) return
    desiredActiveSessionIdRef.current = sessionId
    if (sessionFocusInFlightRef.current) {
      if (sessionId === sessionFocusTargetRef.current) return
      queuedSessionFocusIdRef.current = sessionId
      setError(undefined)
      setSessionStatus(undefined)
      setActiveSessionId(sessionId)
      activeSessionIdRef.current = sessionId
      return
    }
    sessionFocusInFlightRef.current = true
    try {
      let nextSessionId: string | undefined = sessionId
      while (nextSessionId) {
        const targetSessionId = nextSessionId
        sessionFocusTargetRef.current = targetSessionId
        queuedSessionFocusIdRef.current = undefined
        if (!(await confirmDiscardUnsavedChanges())) {
          queuedSessionFocusIdRef.current = undefined
          return
        }
        setError(undefined)
        setSessionStatus(undefined)
        setActiveSessionId(targetSessionId)
        activeSessionIdRef.current = targetSessionId
        try {
          await window.claudeDesktop.sessions.focus(targetSessionId)
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          setError(message)
          const loaded = await window.claudeDesktop.sessions.list()
          sessionsRef.current = loaded
          setSessions(loaded)
          setActiveSessionId(loaded[0]?.id)
          activeSessionIdRef.current = loaded[0]?.id
          desiredActiveSessionIdRef.current = loaded[0]?.id
        }
        nextSessionId = queuedSessionFocusIdRef.current
      }
    } finally {
      sessionFocusInFlightRef.current = false
      sessionFocusTargetRef.current = undefined
      const queuedSessionId = queuedSessionFocusIdRef.current
      queuedSessionFocusIdRef.current = undefined
      if (queuedSessionId && queuedSessionId !== activeSessionIdRef.current) {
        void focusSession(queuedSessionId)
      } else {
        desiredActiveSessionIdRef.current = activeSessionIdRef.current
      }
    }
  }

  function handleSessionRowClick(sessionId: string): void {
    if (loadingLabel) return
    void focusSession(sessionId)
  }

  useEffect(() => {
    window.__claudeDesktopSmokeFocusSession = focusSession
    window.__claudeDesktopSmokeSessionFocusInFlight = () => sessionFocusInFlightRef.current
    window.__claudeDesktopSmokeDiscardEditorChanges = discardEditorChanges
    return () => {
      delete window.__claudeDesktopSmokeFocusSession
      delete window.__claudeDesktopSmokeSessionFocusInFlight
      delete window.__claudeDesktopSmokeDiscardEditorChanges
    }
  })

  function handleComposerSendClick(): void {
    if (loadingLabel) return
    void sendMessage()
  }

  function handleComposerTargetTypeChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (loadingLabel) return
    setChatTarget(prev => ({
      ...prev,
      type: event.target.value === 'team'
        ? 'team'
        : event.target.value === 'agent'
          ? 'agent'
          : 'session',
    }))
  }

  function handleComposerTargetTeamChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (loadingLabel) return
    setChatTarget(prev => ({
      ...prev,
      teamName: event.target.value,
    }))
  }

  function handleComposerTargetAgentChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (loadingLabel) return
    setChatTarget(prev => ({
      ...prev,
      agentType: event.target.value,
    }))
  }

  function handlePreviewUrlChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (!activeSession) {
      setPreviewStatus({ kind: 'error', text: 'Select a session before editing the preview URL.' })
      return
    }
    if (loadingLabel) return
    const nextUrl = event.target.value
    setPreviewUrl(nextUrl)
    setPreviewStatus(
      !nextUrl
        ? undefined
        : isHttpUrl(nextUrl)
          ? nextUrl === committedPreviewUrl
            ? { kind: 'success', text: `Previewing ${nextUrl}` }
            : { kind: 'info', text: 'Press Open to update the embedded preview.' }
          : { kind: 'error', text: 'URL must start with http:// or https://' },
    )
  }


  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function resolveChatTargetFromInput(text: string): { target: ChatTarget; cleanText: string; contextMentions: ParsedMention[] } {
    let target = chatTarget
    let cleanText = text
    const contextMentions: ParsedMention[] = []

    // Use parsed mentions from current input
    const mentions = parsedMentions

    for (const mention of mentions) {
      const pattern = new RegExp(escapeRegex(mention.raw) + '(?=\\s|$)')
      switch (mention.kind) {
        case 'agent':
          if (target.type === 'session') {
            target = { type: 'agent', teamName: '', agentType: mention.value }
          }
          cleanText = cleanText.replace(pattern, '').replace(/\s+/g, ' ').trim()
          break
        case 'team':
          if (target.type === 'session') {
            target = { type: 'team', teamName: mention.value, agentType: '' }
          }
          cleanText = cleanText.replace(pattern, '').replace(/\s+/g, ' ').trim()
          break
        case 'file':
          contextMentions.push(mention)
          cleanText = cleanText.replace(pattern, '').replace(/\s+/g, ' ').trim()
          break
        case 'skill':
          contextMentions.push(mention)
          cleanText = cleanText.replace(pattern, '').replace(/\s+/g, ' ').trim()
          break
        case 'mcp':
          contextMentions.push(mention)
          cleanText = cleanText.replace(pattern, '').replace(/\s+/g, ' ').trim()
          break
      }
    }

    return { target, cleanText, contextMentions }
  }


  async function sendMessage(): Promise<void> {
    if (!activeSession) {
      setConversationNotice({ kind: 'error', text: 'Select a session before sending a message.' })
      return
    }
    if (turnBusy) {
      setConversationNotice({
        kind: 'info',
        text: 'Wait for the current Claude turn to finish before sending another message.',
      })
      return
    }
    if (input.trim().length === 0) {
      setConversationNotice({ kind: 'error', text: 'Enter a message before sending.' })
      return
    }
    if (sendActionPendingRef.current) return
    if (chatTarget.type === 'team' && !chatTarget.teamName.trim()) {
      setConversationNotice({
        kind: 'error',
        text: 'Choose a team before sending this chat message.',
      })
      return
    }
    if (chatTarget.type === 'agent' && !chatTarget.agentType.trim()) {
      setConversationNotice({
        kind: 'error',
        text: 'Choose an agent before sending this chat message.',
      })
      return
    }
    const session = activeSession
    sendActionPendingRef.current = true
    const rawText = input.trim()
    const { target: resolvedTarget, cleanText, contextMentions } = resolveChatTargetFromInput(rawText)
    // Build enriched text with context mentions
    let text = cleanText
    if (contextMentions.length > 0) {
      const contextParts: string[] = []
      for (const cm of contextMentions) {
        if (cm.kind === 'file') {
          contextParts.push(`[Referenced file: ${cm.value}]`)
        } else if (cm.kind === 'skill') {
          contextParts.push(`[Using skill: ${cm.value}]`)
        } else if (cm.kind === 'mcp') {
          contextParts.push(`[Using MCP server: ${cm.value}]`)
        }
      }
      if (contextParts.length > 0) {
        text = contextParts.join('\n') + (text ? '\n\n' + text : '')
      }
    }
    setInput('')
    setComposerCursor(0)
    setConversationNotice(undefined)
    
    // Validate resolved target
    if (resolvedTarget.type === 'team' && !resolvedTarget.teamName.trim()) {
      setConversationNotice({ kind: 'error', text: 'Team not found.' })
      sendActionPendingRef.current = false
      return
    }
    if (resolvedTarget.type === 'agent' && !resolvedTarget.agentType.trim()) {
      setConversationNotice({ kind: 'error', text: 'Agent not found.' })
      sendActionPendingRef.current = false
      return
    }
    try {
      await runAction('Sending message', async () => {
        if (resolvedTarget.type === 'team') {
          recordOutgoingRpcMessage(session.id, 'team:send', { teamName: resolvedTarget.teamName, message: text })
          await window.claudeDesktop.teams.send(session.id, {
            teamName: resolvedTarget.teamName,
            to: '*',
            message: text,
          })
          if (activeSessionIdRef.current !== session.id) return
          setConversationNotice({
            kind: 'success',
            text: `Sent message to team ${resolvedTarget.teamName}.`,
          })
          // Reset target back to session after team send
          setChatTarget({ type: 'session', teamName: '', agentType: '' })
          return
        }
        if (resolvedTarget.type === 'agent') {
          recordOutgoingRpcMessage(session.id, 'agent:launch', { agentType: resolvedTarget.agentType, prompt: text })
          await window.claudeDesktop.sessions.launchAgentTask(session.id, {
            agentType: resolvedTarget.agentType,
            description: `Chat with ${resolvedTarget.agentType}`,
            prompt: text,
            runInBackground: false,
          })
          if (activeSessionIdRef.current !== session.id) return
          setConversationNotice({
            kind: 'success',
            text: `Sent message to agent ${resolvedTarget.agentType}.`,
          })
          // Reset target back to session after agent send
          setChatTarget({ type: 'session', teamName: '', agentType: '' })
          return
        }
        recordOutgoingRpcMessage(session.id, 'user:send', { text })
        await window.claudeDesktop.sessions.send(session.id, text)
      })
    } finally {
      sendActionPendingRef.current = false
    }
  }

  async function cancelSession(): Promise<void> {
    if (!activeSession) {
      setConversationNotice({ kind: 'error', text: 'Select a session before cancelling a turn.' })
      return
    }
    if (permissionResponding) {
      setConversationNotice({ kind: 'info', text: 'Wait for the permission response to finish before cancelling the turn.' })
      return
    }
    if (!cancelAvailable) {
      setConversationNotice({ kind: 'info', text: 'No active Claude turn is available to cancel.' })
      return
    }
    if (cancelActionPendingRef.current) return
    const session = activeSession
    cancelActionPendingRef.current = true
    const sessionId = session.id
    try {
      await runAction('Cancelling turn', async () => {
        await window.claudeDesktop.sessions.cancel(sessionId)
        if (activeSessionIdRef.current !== session.id) return
        setPermissionQueue(prev =>
          prev.filter(request => request.sessionId !== sessionId),
        )
        setRespondingPermissionId(undefined)
        setConversationNotice({ kind: 'info', text: 'Turn cancelled.' })
      })
    } finally {
      cancelActionPendingRef.current = false
    }
  }

  function handleCancelTurnClick(): void {
    if (loadingLabel) return
    void cancelSession()
  }

  async function clearDesktopTranscriptView(): Promise<void> {
    if (!activeSession) {
      setConversationNotice({ kind: 'error', text: 'Select a session before clearing the desktop transcript view.' })
      return
    }
    if (loadingLabel) return
    const session = activeSession
    if (!(await requestConfirmation({
      title: 'Clear desktop transcript view?',
      message: 'Clear the local desktop message list, tool activity, and task timeline for this session. Claude transcript storage and files on disk are not deleted.',
      confirmLabel: 'Clear view',
      cancelLabel: 'Cancel',
      tone: 'danger',
    }))) return
    await runAction('Clearing desktop transcript view', async () => {
      const cleared = await window.claudeDesktop.sessions.clearDesktopView(session.id)
      if (activeSessionIdRef.current !== session.id) return
      mergeSession(cleared)
      setPermissionQueue(prev =>
        prev.filter(request => request.sessionId !== session.id),
      )
      setConversationNotice({ kind: 'success', text: 'Cleared the desktop transcript view.' })
    })
  }

  function handleClearDesktopTranscriptViewClick(): void {
    if (loadingLabel) return
    void clearDesktopTranscriptView()
  }

  async function closeSession(): Promise<void> {
    if (!activeSession) {
      setConversationNotice({ kind: 'error', text: 'Select a session before closing it.' })
      return
    }
    await closeSessionById(activeSession.id)
  }

  function handleCloseSessionClick(): void {
    if (loadingLabel) return
    void closeSession()
  }

  async function closeSessionById(sessionId: string): Promise<void> {
    if (sessionCloseActionPendingRef.current.has(sessionId)) return
    sessionCloseActionPendingRef.current.add(sessionId)
    try {
      if (!(await confirmDiscardUnsavedChanges())) return
      const session = sessions.find(item => item.id === sessionId)
      if (!(await requestConfirmation({
        title: 'Close session?',
        message: `Remove ${session?.title ?? 'this desktop session'} from the sidebar. Claude transcript storage and files on disk are not deleted.`,
        confirmLabel: 'Close session',
        cancelLabel: 'Cancel',
        tone: 'danger',
      }))) return
      await runAction('Closing session', () =>
        window.claudeDesktop.sessions.close(sessionId),
      )
    } finally {
      sessionCloseActionPendingRef.current.delete(sessionId)
    }
  }

  function openSessionMenu(
    event: ReactMouseEvent<HTMLElement>,
    sessionId: string,
  ): void {
    event.preventDefault()
    event.stopPropagation()
    if (loadingLabel) return
    setSessionMenuActiveIndex(0)
    setSessionMenu({
      sessionId,
      x: event.clientX,
      y: event.clientY,
    })
  }

  function openSessionMenuForRow(event: ReactMouseEvent, sessionId: string): void {
    openSessionMenu(event, sessionId)
  }

  function runSessionMenuAction(index: number): void {
    if (!sessionMenu) return
    if (loadingLabel) return
    const sessionId = sessionMenu.sessionId
    if (index === 0) {
      setSessionMenu(undefined)
      void focusSession(sessionId)
      return
    }
    if (index === 1) {
      void openSessionFolder(sessionId)
      return
    }
    setSessionMenu(undefined)
    void closeSessionById(sessionId)
  }

  function handleSessionMenuItemClick(index: number): void {
    runSessionMenuAction(index)
  }

  async function openSessionFolder(sessionId: string): Promise<void> {
    if (sessionOpenFolderActionPendingRef.current.has(sessionId)) return
    const session = sessions.find(item => item.id === sessionId)
    if (!session) {
      setSessionMenu(undefined)
      setSessionStatus({ kind: 'error', text: 'Session is no longer available.' })
      return
    }
    sessionOpenFolderActionPendingRef.current.add(sessionId)
    setSessionMenu(undefined)
    try {
      await runAction('Opening session folder', () =>
        window.claudeDesktop.workspace.openFolder(session.cwd),
      )
    } finally {
      sessionOpenFolderActionPendingRef.current.delete(sessionId)
    }
  }

  async function openFile(path: string): Promise<void> {
    if (!activeSession) {
      setEditorStatus({ kind: 'error', text: 'Select a session before opening files.' })
      return
    }
    if (loadingLabel) return
    const session = activeSession
    if (path !== activeFile && !(await confirmDiscardUnsavedChanges())) return
    await runAction('Opening file', async () => {
      setEditorStatus({ kind: 'info', text: `Opening ${path}...` })
      let contents: string
      try {
        contents = await window.claudeDesktop.workspace.readFile(
          session.cwd,
          path,
        )
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        if (activeSessionIdRef.current !== session.id) return
        setPrimaryNavView('chat')
        setEditorStatus({ kind: 'error', text: message })
        setActiveFile(undefined)
        setFileContents('')
        setSavedFileContents('')
        await updateSessionLayout(session.id, {
          activeFile: undefined,
          activePane: 'editor',
          primaryView: 'chat',
        })
        throw cause
      }
      if (activeSessionIdRef.current !== session.id) return
      setActiveFile(path)
      setPrimaryNavView('chat')
      setFileContents(contents)
      setSavedFileContents(contents)
      setEditorStatus({ kind: 'success', text: `Opened ${path}` })
      await updateSessionLayout(session.id, { activeFile: path, activePane: 'editor', primaryView: 'chat' })
    })
  }

  async function saveFile(): Promise<void> {
    if (!activeSession) {
      setEditorStatus({ kind: 'error', text: 'Select a session before saving files.' })
      return
    }
    if (!activeFile) {
      setEditorStatus({ kind: 'error', text: 'Open a file before saving.' })
      return
    }
    if (fileSaveActionPendingRef.current) return
    const session = activeSession
    const filePath = activeFile
    const contents = currentEditorContents({
      fileContents: fileContentsRef.current,
      modelValue: monacoModelRef.current?.getValue(),
    })
    fileSaveActionPendingRef.current = true
    try {
      await runAction('Saving file', async () => {
        setEditorStatus({ kind: 'info', text: `Saving ${filePath}...` })
        try {
          await window.claudeDesktop.workspace.saveFile(
            session.cwd,
            filePath,
            contents,
          )
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          if (activeSessionIdRef.current !== session.id) return
          setEditorStatus({ kind: 'error', text: message })
          throw cause
        }
        if (activeSessionIdRef.current !== session.id) return
        fileContentsRef.current = contents
        setFileContents(contents)
        if (shouldSyncSavedEditorModel({
          activeFile: filePath,
          modelPath: monacoPathRef.current,
          modelValue: monacoModelRef.current?.getValue(),
          savedContents: contents,
        })) {
          monacoModelRef.current?.setValue(contents)
        }
        setSavedFileContents(contents)
        hasUnsavedChangesRef.current = false
        void window.claudeDesktop.app.setUnsavedChanges(false).catch(cause => {
          setError(cause instanceof Error ? cause.message : String(cause))
        })
        if ('__claudeDesktopSmokeEvents' in window) {
          window.__claudeDesktopSmokeHasUnsavedChanges = false
        }
        setEditorStatus({ kind: 'success', text: `Saved ${filePath}` })
        await refreshWorkspace(session)
        if (activeSessionIdRef.current !== session.id) return
        if (shouldSyncSavedEditorModel({
          activeFile: filePath,
          modelPath: monacoPathRef.current,
          modelValue: monacoModelRef.current?.getValue(),
          savedContents: contents,
        })) {
          monacoModelRef.current?.setValue(contents)
        }
        fileContentsRef.current = contents
        setFileContents(contents)
        setSavedFileContents(contents)
        hasUnsavedChangesRef.current = false
        void window.claudeDesktop.app.setUnsavedChanges(false).catch(cause => {
          setError(cause instanceof Error ? cause.message : String(cause))
        })
        if ('__claudeDesktopSmokeEvents' in window) {
          window.__claudeDesktopSmokeHasUnsavedChanges = false
        }
      })
    } finally {
      fileSaveActionPendingRef.current = false
    }
  }

  function handleSaveFileClick(): void {
    if (loadingLabel) return
    void saveFile()
  }

  async function startTerminal(): Promise<void> {
    if (!activeSession) {
      setTerminalStatus({ kind: 'error', text: 'Select a session before using the terminal.' })
      return
    }
    if (terminalActionPendingRef.current || terminalIdRef.current) return
    const session = activeSession
    terminalActionPendingRef.current = true
    try {
      await runAction('Starting shell', async () => {
        setTerminalStatus({ kind: 'info', text: 'Starting shell...' })
        let info: TerminalSessionInfo
        try {
          info = await window.claudeDesktop.terminal.create(session.cwd)
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          if (activeSessionIdRef.current !== session.id) return
          setTerminalId(undefined)
          terminalIdRef.current = undefined
          setTerminalInfo(undefined)
          setTerminalStatus({ kind: 'error', text: message })
          throw cause
        }
        if (activeSessionIdRef.current !== session.id) return
        setTerminalInfo(info)
        setPrimaryNavView('chat')
        setTerminalId(info.id)
        terminalIdRef.current = info.id
        setTerminalStatus({
          kind: 'success',
          text: `Shell running: ${info.mode === 'pty' ? 'PTY' : 'fallback'} ${info.columns}x${info.rows}`,
        })
        setTerminalOutput('')
        xtermRef.current?.reset()
        await updateSessionLayout(session.id, {
          terminalId: info.id,
          activePane: 'terminal',
          primaryView: 'chat',
        })
      })
    } finally {
      terminalActionPendingRef.current = false
    }
  }

  function handleStartTerminalClick(): void {
    if (loadingLabel) return
    void startTerminal()
  }

  async function stopTerminal(): Promise<void> {
    if (!activeSession) {
      setTerminalStatus({ kind: 'error', text: 'Select a session before using the terminal.' })
      return
    }
    const session = activeSession
    const currentTerminalId = terminalIdRef.current
    if (!currentTerminalId || terminalActionPendingRef.current) return
    terminalActionPendingRef.current = true
    try {
      await runAction('Stopping shell', async () => {
        await window.claudeDesktop.terminal.kill(currentTerminalId)
        if (activeSessionIdRef.current !== session.id) return
        setTerminalId(undefined)
        terminalIdRef.current = undefined
        setTerminalInfo(undefined)
        setTerminalStatus({ kind: 'info', text: 'Shell stopped. Start shell to restart.' })
        await updateSessionLayout(session.id, { terminalId: undefined })
      })
    } finally {
      terminalActionPendingRef.current = false
    }
  }

  function handleStopTerminalClick(): void {
    if (loadingLabel) return
    void stopTerminal()
  }

  async function setPane(
    pane: PaneId,
    primaryView: PrimaryNavView = primaryViewForPane(pane),
    options: { settingsActiveSection?: string; tasksActiveSection?: string; agentsActiveSection?: string; teamsActiveSection?: string } = {},
  ): Promise<void> {
    if (loadingLabel) return
    const session = activeSession
    if (pane !== activePane && activePane === 'editor') {
      if (!(await confirmDiscardUnsavedChanges())) return
      discardEditorChanges()
    }
    setPrimaryNavView(primaryView)
    setGlobalPane(pane)
    if (!session) return
    const patch: DesktopSessionLayoutPatch = { activePane: pane, primaryView }
    if (options.settingsActiveSection !== undefined) {
      patch.settingsActiveSection = options.settingsActiveSection
    }
    if (options.tasksActiveSection !== undefined) {
      patch.tasksActiveSection = options.tasksActiveSection
    }
    if (options.agentsActiveSection !== undefined) {
      patch.agentsActiveSection = options.agentsActiveSection
    }
    if (options.teamsActiveSection !== undefined) {
      patch.teamsActiveSection = options.teamsActiveSection
    }
    await updateSessionLayout(session.id, patch)
  }

  function selectWorkspacePane(pane: PaneId): void {
    if (loadingLabel) return
    void setPane(pane)
  }

  function handleWorkspacePaneClick(pane: PaneId): () => void {
    return () => selectWorkspacePane(pane)
  }

  async function refreshFiles(): Promise<void> {
    if (!activeSession) {
      setFilesStatus({ kind: 'error', text: 'Select a session before refreshing files.' })
      return
    }
    if (workspaceRefreshActionPendingRef.current.has(activeSession.id)) return
    await runAction('Refreshing files', async () => {
      setFilesStatus({ kind: 'info', text: 'Refreshing files...' })
      const fileCount = await refreshWorkspace(activeSession)
      const nextFileCount = fileCount ?? countWorkspaceFiles(tree)
      setFilesStatus({
        kind: 'success',
        text: `Updated files: ${nextFileCount} file${nextFileCount === 1 ? '' : 's'}.`,
      })
    })
  }

  function handleRefreshFilesClick(): void {
    if (loadingLabel) return
    void refreshFiles()
  }

  function handleDiffFileClick(path: string): void {
    if (loadingLabel) return
    selectDiffFile(path)
  }

  function selectDiffFile(path: string): void {
    if (!activeSession) {
      setDiffStatus({ kind: 'error', text: 'Select a session before selecting diff files.' })
      return
    }
    if (loadingLabel) return
    setSelectedDiffPath(path)
  }

  async function refreshDiff(): Promise<void> {
    if (!activeSession) {
      setDiffStatus({ kind: 'error', text: 'Select a session before refreshing diff.' })
      return
    }
    if (workspaceRefreshActionPendingRef.current.has(activeSession.id)) return
    await runAction('Refreshing diff', () => refreshWorkspace(activeSession))
  }

  function handleRefreshDiffClick(): void {
    if (loadingLabel) return
    void refreshDiff()
  }

  function scrollPaneSection(sectionId: string): void {
    const section = document.getElementById(sectionId)
    if (!section) return
    const pane = section.closest<HTMLElement>('.settings-content, .settings-pane, .agents-pane, .teams-pane, .tasks-pane')
    if (!pane) {
      section.scrollIntoView({ block: 'start' })
      return
    }
    const paneTop = pane.getBoundingClientRect().top
    const sectionTop = section.getBoundingClientRect().top
    const stickyHeader = pane.classList.contains('settings-content')
      ? pane.querySelector<HTMLElement>('.settings-content-header')
      : pane.querySelector<HTMLElement>('.pane-toolbar')
    const stickyJumpbar = pane.querySelector<HTMLElement>('.pane-jumpbar')
    const stickyOffset =
      (stickyHeader?.getBoundingClientRect().height ?? 0) +
      (stickyJumpbar?.getBoundingClientRect().height ?? 0)
    pane.scrollTop += sectionTop - paneTop - stickyOffset - 8
  }

  function isPaneSectionVisible(sectionId: string): boolean {
    const section = document.getElementById(sectionId)
    const pane = section?.closest<HTMLElement>('.settings-content, .settings-pane, .agents-pane, .teams-pane, .tasks-pane')
    if (!section || !pane) return false
    const paneRect = pane.getBoundingClientRect()
    const heading = section.querySelector<HTMLElement>('h3')
    const targetRect = (heading ?? section).getBoundingClientRect()
    return targetRect.top >= paneRect.top && targetRect.bottom <= paneRect.bottom
  }

  function flushPendingPaneSection(pane: PaneId): void {
    const pending = pendingPaneSectionRef.current
    if (!pending || pending.pane !== pane) return
    window.requestAnimationFrame(() => {
      scrollPaneSection(pending.sectionId)
      pendingPaneSectionRef.current = undefined
    })
  }

  function openPaneSection(
    pane: PaneId,
    sectionId: string,
    primaryView: PrimaryNavView = primaryViewForPane(pane),
    options: { showStatus?: boolean } = {},
  ): void {
    if (loadingLabel) return
    const showStatus = options.showStatus !== false
    pendingPaneSectionRef.current = { pane, sectionId }
    if (pane === 'settings') {
      setSettingsActiveSection(sectionId)
    }
    if (pane === 'tasks') {
      setTasksActiveSection(sectionId)
    }
    if (pane === 'agents') {
      setAgentsActiveSection(sectionId)
    }
    if (pane === 'teams') {
      setTeamsActiveSection(sectionId)
    }
    if (pane === 'mcp') {
      setMcpActiveSection(sectionId)
    }
    if (pane === 'skills') {
      setSkillsActiveSection(sectionId)
    }
    if (pane === 'settings' && showStatus) {
      const label = sectionId === 'settings-plugins' ? 'Plugins' : 'Settings'
      setSettingsStatus({ kind: 'info', text: `Opened ${label} settings.` })
    }
    if (pane === 'agents' && showStatus) {
      const label = sectionId === 'agents-launch'
        ? 'agent runner'
        : sectionId === 'agents-editor'
          ? 'custom agents'
          : sectionId === 'agents-tasks'
            ? 'running agent tasks'
            : 'available agents'
      setAgentsStatus({ kind: 'info', text: `Opened ${label}.` })
    }
    if (pane === 'teams' && showStatus) {
      setTeamsStatus({ kind: 'info', text: 'Opened team management.' })
    }
    if (pane === 'tasks' && showStatus) {
      setTasksStatus({
        kind: 'info',
        text: sectionId === 'tasks-global-tasks'
          ? 'Opened global scheduled tasks.'
          : 'Opened project scheduled tasks.',
      })
    }
    if (pane === 'mcp' && showStatus) {
      setMcpStatus({ kind: 'info', text: 'Opened MCP server management.' })
    }
    if (pane === 'skills' && showStatus) {
      setSkillsStatus({ kind: 'info', text: 'Opened skills management.' })
    }
    void setPane(pane, primaryView, {
      settingsActiveSection: pane === 'settings' ? sectionId : undefined,
      tasksActiveSection: pane === 'tasks' ? sectionId : undefined,
      agentsActiveSection: pane === 'agents' ? sectionId : undefined,
      teamsActiveSection: pane === 'teams' ? sectionId : undefined,
      mcpActiveSection: pane === 'mcp' ? sectionId : undefined,
      skillsActiveSection: pane === 'skills' ? sectionId : undefined,
    })
    const startedAt = Date.now()
    const scrollUntilVisible = (): void => {
      scrollPaneSection(sectionId)
      if (isPaneSectionVisible(sectionId) || Date.now() - startedAt > 10_000) return
      window.setTimeout(scrollUntilVisible, 100)
    }
    window.setTimeout(scrollUntilVisible, 0)
  }

  function runDesktopPluginsAction(action: DesktopPluginsAction): void {
    switch (action) {
      case 'settings':
        openPaneSection('settings', 'settings-plugins', 'settings')
        break
      case 'list':
        openPaneSection('settings', 'settings-plugins', 'settings', { showStatus: false })
        void listAvailablePlugins()
        break
      case 'install':
        openPaneSection('settings', 'settings-plugins', 'settings', { showStatus: false })
        void installPlugin()
        break
      case 'refresh':
        openPaneSection('settings', 'settings-plugins', 'settings', { showStatus: false })
        void refreshSettingsConfig()
        break
    }
  }

  function runDesktopMcpAction(action: DesktopMcpAction): void {
    switch (action) {
      case 'servers':
        openPaneSection('mcp', 'mcp-servers', 'mcp')
        break
      case 'add-server':
        openPaneSection('mcp', 'mcp-servers', 'mcp')
        startNewMcpDraft()
        break
      case 'check-health':
        openPaneSection('mcp', 'mcp-servers', 'mcp', { showStatus: false })
        void checkMcpHealth()
        break
    }
  }

  function runDesktopSkillsAction(action: DesktopSkillsAction): void {
    switch (action) {
      case 'list':
        openPaneSection('skills', 'skills-installed', 'skills')
        break
      case 'new-user':
        openPaneSection('skills', 'skills-installed', 'skills')
        startNewUserSkillDraft()
        break
      case 'new-project':
        openPaneSection('skills', 'skills-installed', 'skills')
        startNewProjectSkillDraft()
        break
      case 'install-user':
        openPaneSection('skills', 'skills-installed', 'skills', { showStatus: false })
        void installLocalSkill()
        break
      case 'install-project':
        openPaneSection('skills', 'skills-installed', 'skills', { showStatus: false })
        void installProjectSkill()
        break
    }
  }

  function runDesktopAgentsAction(action: DesktopAgentsAction): void {
    switch (action) {
      case 'overview':
        openPaneSection('agents', 'agents-sources', 'agents')
        break
      case 'available':
        openPaneSection('agents', 'agents-catalog', 'agents')
        break
      case 'run':
        openPaneSection('agents', 'agents-launch', 'agents')
        break
      case 'custom':
        openPaneSection('agents', 'agents-editor', 'agents')
        break
      case 'running':
        openPaneSection('agents', 'agents-tasks', 'agents')
        break
      case 'new-custom':
        openPaneSection('agents', 'agents-editor', 'agents')
        startNewAgentDraft()
        break
      case 'refresh':
        openPaneSection('agents', agentsActiveSection, 'agents', { showStatus: false })
        void refreshAgents()
        break
    }
  }

  function runDesktopTeamsAction(action: DesktopTeamsAction): void {
    switch (action) {
      case 'management':
        openPaneSection('teams', 'agents-teams', 'teams')
        break
      case 'new':
        openPaneSection('teams', 'agents-teams', 'teams')
        startNewTeamDraft()
        break
      case 'refresh':
        openPaneSection('teams', teamsActiveSection, 'teams', { showStatus: false })
        void refreshAgents()
        break
    }
  }

  function runDesktopTasksAction(action: DesktopTasksAction): void {
    switch (action) {
      case 'project':
        openTasksSection('tasks-project-tasks')
        break
      case 'global':
        openTasksSection('tasks-global-tasks')
        break
      case 'new-project':
        openPaneSection('tasks', 'tasks-project-tasks', 'tasks')
        startNewProjectScheduledTaskDraft()
        break
      case 'new-global':
        openPaneSection('tasks', 'tasks-global-tasks', 'tasks')
        startNewScheduledTaskDraft()
        break
      case 'refresh':
        openPaneSection('tasks', effectiveTasksActiveSection(), 'tasks', { showStatus: false })
        void refreshSettingsConfig()
        break
    }
  }

  function runDesktopLifecycleAction(action: DesktopLifecycleAction): void {
    switch (action) {
      case 'new-custom-agent':
        openPaneSection('agents', 'agents-editor', 'agents')
        startNewAgentDraft()
        break
      case 'new-team':
        openPaneSection('teams', 'agents-teams', 'teams')
        startNewTeamDraft()
        break
      case 'new-global-task':
        openPaneSection('tasks', 'tasks-global-tasks', 'tasks')
        startNewScheduledTaskDraft()
        break
      case 'new-project-task':
        openPaneSection('tasks', 'tasks-project-tasks', 'tasks')
        startNewProjectScheduledTaskDraft()
        break
      case 'add-mcp-server':
        openPaneSection('mcp', 'mcp-servers', 'mcp')
        startNewMcpDraft()
        break
      case 'new-user-skill':
        openPaneSection('skills', 'skills-installed', 'skills')
        startNewUserSkillDraft()
        break
      case 'new-project-skill':
        openPaneSection('skills', 'skills-installed', 'skills')
        startNewProjectSkillDraft()
        break
    }
  }

  function runDesktopSettingsAction(action: DesktopSettingsAction): void {
    switch (action) {
      case 'general':
        openPaneSection('settings', 'settings-runtime', 'settings')
        break
      case 'proxy':
        openPaneSection('settings', 'settings-proxy', 'settings')
        break
      case 'mcp':
        openPaneSection('mcp', 'mcp-servers', 'mcp')
        break
      case 'mcp-check':
        openPaneSection('settings', 'settings-mcp', 'settings', { showStatus: false })
        void checkMcpHealth()
        break
      case 'skills':
        openPaneSection('skills', 'skills-installed', 'skills')
        break
      case 'install-user-skill':
        openPaneSection('settings', 'settings-skills', 'settings', { showStatus: false })
        void installLocalSkill()
        break
      case 'install-project-skill':
        openPaneSection('settings', 'settings-skills', 'settings', { showStatus: false })
        void installProjectSkill()
        break
      case 'plugins':
        openPaneSection('settings', 'settings-plugins', 'settings')
        break
      case 'list-plugins':
        openPaneSection('settings', 'settings-plugins', 'settings', { showStatus: false })
        void listAvailablePlugins()
        break
      case 'install-plugin':
        openPaneSection('settings', 'settings-plugins', 'settings', { showStatus: false })
        void installPlugin()
        break
      case 'refresh':
        openPaneSection('settings', 'settings-runtime', 'settings', { showStatus: false })
        void refreshSettingsConfig()
        break
      case 'diagnostics':
        openPaneSection('settings', 'settings-runtime', 'settings', { showStatus: false })
        void exportDiagnostics()
        break
    }
  }

  function openSettingsSection(sectionId: string): void {
    if (loadingLabel) return
    const session = activeSession
    setSettingsActiveSection(sectionId)
    if (session) void updateSessionLayout(session.id, { settingsActiveSection: sectionId })
    scrollPaneSection(sectionId)
  }

  function effectiveTasksActiveSection(): string {
    return activeSession ? tasksActiveSection : 'tasks-global-tasks'
  }

  function openTasksSection(sectionId: string): void {
    void openPaneSection('tasks', sectionId, 'tasks')
  }

  function openProjectTasksSection(): void {
    if (loadingLabel) return
    if (!activeSession) {
      setSettingsStatus({ kind: 'error', text: 'Select a project session before opening project scheduled tasks.' })
      return
    }
    openTasksSection('tasks-project-tasks')
  }

  function handleProjectTasksSectionClick(): void {
    if (loadingLabel) return
    openTasksSection('tasks-project-tasks')
  }

  function handleGlobalTasksSectionClick(): void {
    if (loadingLabel) return
    openTasksSection('tasks-global-tasks')
  }

  function handleSettingsProjectTasksClick(): void {
    if (loadingLabel) return
    openProjectTasksSection()
  }

  function handleSettingsGlobalTasksClick(): void {
    if (loadingLabel) return
    openTasksSection('tasks-global-tasks')
  }

  function openPrimaryView(view: PrimaryNavView): void {
    if (loadingLabel) return
    setPrimaryNavView(view)
    if (view === 'chat') {
      void setPane(
        activePane === 'settings' || activePane === 'agents' || activePane === 'teams' || activePane === 'tasks' || activePane === 'mcp' || activePane === 'skills' ? 'files' : activePane,
        'chat',
      )
      window.requestAnimationFrame(() => {
        const textarea = composerTextareaRef.current
        if (textarea && !textarea.disabled && document.contains(textarea)) {
          textarea.focus()
        }
      })
      return
    }
    if (view === 'agents') {
      setAgentsStatus(undefined)
      void openPaneSection('agents', 'agents-catalog', 'agents')
      return
    }
    if (view === 'teams') {
      setTeamsStatus({ kind: 'info', text: 'Opened team management.' })
      void openPaneSection('teams', 'agents-teams', 'teams')
      return
    }
    if (view === 'tasks') {
      const defaultTasksSection = activeSession ? 'tasks-project-tasks' : 'tasks-global-tasks'
      void openPaneSection('tasks', defaultTasksSection, 'tasks')
      return
    }
    if (view === 'mcp') {
      setMcpStatus(undefined)
      void openPaneSection('mcp', 'mcp-servers', 'mcp')
      return
    }
    if (view === 'skills') {
      setSkillsStatus(undefined)
      void openPaneSection('skills', 'skills-installed', 'skills')
      return
    }
    void openPaneSection('settings', 'settings-runtime', 'settings')
  }

  function selectPrimaryNavView(view: PrimaryNavView): void {
    if (loadingLabel) return
    openPrimaryView(view)
  }

  function handlePrimaryNavClick(view: PrimaryNavView): () => void {
    return () => selectPrimaryNavView(view)
  }

  useEffect(() => {
    if (!pendingDesktopNavigation) return
    const event = pendingDesktopNavigation
    setPendingDesktopNavigation(undefined)
    if (event.type === 'primary-nav') {
      selectPrimaryNavView(event.view)
      return
    }
    selectWorkspacePane(event.pane)
  }, [pendingDesktopNavigation])


  useEffect(() => {
    if (!rpcAutoScroll || !rpcTimelineRef.current) return
    const el = rpcTimelineRef.current
    el.scrollTop = el.scrollHeight
  }, [rpcMessages, rpcAutoScroll])

  useEffect(() => {
    function handleOutgoing(event: Event): void {
      const detail = (event as CustomEvent).detail as { sessionId: string; type: string; raw: unknown; parsed?: RpcMessage['parsed'] }
      rpcMessageIdRef.current += 1
      const rpcMessage: RpcMessage = {
        id: `rpc-out-${rpcMessageIdRef.current}-${Date.now().toString(36)}`,
        sessionId: detail.sessionId,
        timestamp: Date.now(),
        direction: 'outgoing',
        type: detail.type,
        raw: detail.raw,
        parsed: detail.parsed,
      }
      setRpcMessages(prev => {
        const next = [...prev, rpcMessage]
        if (next.length > 2000) return next.slice(-1500)
        return next
      })
    }
    window.addEventListener('rpc-outgoing', handleOutgoing as EventListener)
    return () => window.removeEventListener('rpc-outgoing', handleOutgoing as EventListener)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.repeat) return
      if (
        confirmRequest ||
        pendingPermission ||
        sessionMenu ||
        sessionCreateMenu ||
        currentComposerTrigger
      ) return
      if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
        event.preventDefault()
        setCommandPaletteOpen(true)
        return
      }
      if (commandPaletteOpen) return
      if (event.shiftKey) {
        const pane = WORKSPACE_PANE_SHORTCUTS[event.key]
        if (!pane) return
        event.preventDefault()
        if (loadingLabel) return
        selectWorkspacePane(pane)
        return
      }
      if (event.key === ',') {
        event.preventDefault()
        if (loadingLabel) return
        selectPrimaryNavView('settings')
        return
      }
      if (event.key.toLowerCase() === 'n' && !event.shiftKey) {
        event.preventDefault()
        if (loadingLabel) return
        void handleQuickSessionClick()
        return
      }
      if (event.key.toLowerCase() === 'n' && event.shiftKey) {
        event.preventDefault()
        if (loadingLabel) return
        void handleChooseFolderSessionClick()
        return
      }
      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        if (loadingLabel) return
        void closeSession()
        return
      }
      const view = PRIMARY_NAV_SHORTCUTS[event.key]
      if (!view) return
      event.preventDefault()
      if (loadingLabel) return
      selectPrimaryNavView(view)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activePane,
    activeSession,
    commandPaletteOpen,
    confirmRequest,
    currentComposerTrigger,
    loadingLabel,
    pendingPermission,
    sessionCreateMenu,
    sessionMenu,
  ])

  useEffect(() => {
    if (primaryNavView === 'chat') return
    if (confirmRequest || pendingPermission || commandPaletteOpen || sessionMenu || sessionCreateMenu || currentComposerTrigger) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      event.preventDefault()
      if (loadingLabel) return
      openPrimaryView('chat')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [primaryNavView, confirmRequest, pendingPermission, commandPaletteOpen, sessionMenu, sessionCreateMenu, currentComposerTrigger, loadingLabel])

  function handleCommandPaletteQueryChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setCommandPaletteQuery(event.target.value)
    setCommandPaletteStatus(undefined)
  }

  function closeCommandPalette(): void {
    setCommandPaletteOpen(false)
    setCommandPaletteQuery('')
    setCommandPaletteActiveIndex(0)
    setCommandPaletteStatus(undefined)
  }

  function enabledCommandIndex(
    start: number,
    direction: 1 | -1,
  ): number {
    const items = commandPaletteItemsForQuery
    if (!items.length) return 0
    for (let offset = 0; offset < items.length; offset += 1) {
      const index = (start + direction * offset + items.length) % items.length
      if (!items[index]?.disabled) return index
    }
    return Math.max(0, Math.min(start, items.length - 1))
  }

  function runCommandPaletteItem(item: CommandPaletteItem | undefined): void {
    if (!item) return
    if (loadingLabel) return
    if (item.disabled) {
      setCommandPaletteStatus({
        kind: 'info',
        text: `${item.label} is unavailable. ${item.disabledReason ?? item.detail}`,
      })
      return
    }
    closeCommandPalette()
    item.run()
  }

  function composerMenuOptionId(item: Pick<ComposerMenuItem, 'id'>): string {
    return `composer-menu-item-${optionIdSegment(item.id)}`
  }

  function commandPaletteOptionId(item: Pick<CommandPaletteItem, 'id'>): string {
    return `command-palette-item-${optionIdSegment(item.id)}`
  }

  function handleCommandPaletteKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
  ): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeCommandPalette()
      return
    }
    if (!commandPaletteItemsForQuery.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCommandPaletteActiveIndex(index => enabledCommandIndex(index + 1, 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCommandPaletteActiveIndex(index => enabledCommandIndex(index - 1, -1))
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setCommandPaletteActiveIndex(enabledCommandIndex(0, 1))
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setCommandPaletteActiveIndex(enabledCommandIndex(commandPaletteItemsForQuery.length - 1, -1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      runCommandPaletteItem(commandPaletteItemsForQuery[commandPaletteActiveIndex])
    }
  }

  function primaryNavState(view: PrimaryNavView): {
    className: string
    'aria-current'?: 'page'
    'aria-pressed': boolean
    'aria-disabled': boolean
    tabIndex: number
  } {
    const active = primaryNavView === view
    return {
      className: active ? 'active' : '',
      'aria-current': active ? 'page' : undefined,
      'aria-pressed': active,
      'aria-disabled': !!loadingLabel,
      tabIndex: loadingLabel ? -1 : 0,
    }
  }

  const visibleSettingsNavGroups = useMemo(() => {
    const query = settingsSearch.trim().toLowerCase()
    if (!query) return SETTINGS_NAV_GROUPS
    return SETTINGS_NAV_GROUPS
      .map(group => ({
        ...group,
        items: group.items.filter(item =>
          [item.label, ...item.aliases].some(label =>
            label.toLowerCase().includes(query),
          ),
        ),
      }))
      .filter(group => group.items.length > 0)
  }, [settingsSearch])
  const visibleSettingsNavItems = useMemo(
    () => visibleSettingsNavGroups.flatMap(group => group.items),
    [visibleSettingsNavGroups],
  )

  function settingsNavButtonState(sectionId: string): {
    className: string
    'aria-current'?: 'page'
    'aria-disabled': boolean
    tabIndex: number
  } {
    const active = sectionId.startsWith('tasks-')
      ? isSettingsNavItemActive({ pane: 'tasks', sectionId })
      : isSettingsNavItemActive({ pane: 'settings', sectionId })
    return {
      className: active ? 'active' : '',
      'aria-current': active ? 'page' : undefined,
      'aria-disabled': !!loadingLabel,
      tabIndex: loadingLabel ? -1 : 0,
    }
  }

  function isSettingsNavItemActive(item: Pick<SettingsNavItem, 'pane' | 'sectionId'>): boolean {
    return item.pane === 'tasks'
      ? primaryNavView === 'tasks' && tasksActiveSection === item.sectionId
      : primaryNavView === 'settings' && settingsActiveSection === item.sectionId
  }

  function settingsNavOptionId(item: Pick<SettingsNavItem, 'sectionId'>): string {
    return `settings-nav-option-${item.sectionId}`
  }

  const activeSettingsNavItem = visibleSettingsNavItems.find(item => isSettingsNavItemActive(item))

  function paneJumpbarButtonState(active: boolean): {
    className: string
    'aria-current'?: 'page'
    'aria-pressed': boolean
    'aria-disabled': boolean
    tabIndex: number
  } {
    return {
      className: active ? 'active' : '',
      'aria-current': active ? 'page' : undefined,
      'aria-pressed': active,
      'aria-disabled': !!loadingLabel,
      tabIndex: loadingLabel ? -1 : 0,
    }
  }

  function menuItemState(active: boolean, className = ''): {
    className: string
    'aria-selected': boolean
  } {
    return {
      className: [className, active ? 'active' : ''].filter(Boolean).join(' '),
      'aria-selected': active,
    }
  }

  function workspacePaneTabState(pane: PaneId): {
    className: string
    'aria-pressed': boolean
    'aria-disabled': boolean
    tabIndex: number
  } {
    return {
      className: activePane === pane ? 'active' : '',
      'aria-pressed': activePane === pane,
      'aria-disabled': !!loadingLabel,
      tabIndex: loadingLabel ? -1 : 0,
    }
  }

  function agentCatalogCardState(agent: AgentInfo): {
    className: string
    'aria-current'?: 'true'
  } {
    const active = isAgentCatalogItemActive(agent)
    return {
      className: active ? 'active' : '',
      'aria-current': active ? 'true' : undefined,
    }
  }

  function isAgentCatalogItemActive(agent: Pick<AgentInfo, 'agentType' | 'source'>): boolean {
    return selectedAgentType === agent.agentType.trim() && selectedAgentSource === agent.source
  }

  function agentCatalogOptionId(agent: Pick<AgentInfo, 'agentType' | 'source'>): string {
    const agentType = agent.agentType.trim()
    return `agent-catalog-option-${optionIdSegment(agent.source)}-${optionIdSegment(agentType)}`
  }

  const activeAgentCatalogItem = visibleAgents.find(agent => isAgentCatalogItemActive(agent))

  function handleAgentCatalogRowClick(agent: AgentInfo): void {
    if (loadingLabel) return
    void selectAgent(agent)
  }

  function handleAgentCatalogRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, agent: AgentInfo): void {
    if (loadingLabel) return
    handleOptionSelectKeyDown(event, () => void selectAgent(agent))
  }

  function handleAgentCatalogSelectClick(agent: AgentInfo): void {
    if (loadingLabel) return
    void selectAgent(agent)
  }

  function handleAgentCatalogDiagnoseClick(agent: AgentInfo): void {
    if (loadingLabel) return
    void selectAgent(agent).then(() => diagnoseAgentByType(agent.agentType))
  }

  function handleAgentCatalogQueryChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentCatalogQuery(event.target.value)
  }

  function handleAgentCatalogSourceChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (loadingLabel) return
    setAgentCatalogSource(event.target.value as AgentCatalogSourceFilter)
  }

  function handleAgentCatalogKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    if (event.key === 'Escape' && agentCatalogQuery) {
      event.preventDefault()
      setAgentCatalogQuery('')
      return
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visibleAgents.length) {
      event.preventDefault()
      const currentIndex = visibleAgents.findIndex(agent => isAgentCatalogItemActive(agent))
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = currentIndex >= 0
        ? (currentIndex + direction + visibleAgents.length) % visibleAgents.length
        : direction > 0
          ? 0
          : visibleAgents.length - 1
      void selectAgent(visibleAgents[nextIndex]!)
      return
    }
    if ((event.key === 'Home' || event.key === 'End') && visibleAgents.length) {
      event.preventDefault()
      const nextIndex = event.key === 'Home' ? 0 : visibleAgents.length - 1
      void selectAgent(visibleAgents[nextIndex]!)
      return
    }
    if (event.key === 'Enter' && (activeAgentCatalogItem || visibleAgents[0])) {
      event.preventDefault()
      void selectAgent(activeAgentCatalogItem ?? visibleAgents[0]!)
    }
  }

  function teamCardState(team: TeamInfo): {
    className: string
    'aria-current'?: 'true'
  } {
    const active = isTeamItemActive(team)
    return {
      className: active ? 'active' : '',
      'aria-current': active ? 'true' : undefined,
    }
  }

  function isTeamItemActive(team: Pick<TeamInfo, 'name'>): boolean {
    return teamDraft.teamName === team.name.trim()
  }

  function teamOptionId(team: Pick<TeamInfo, 'name'>): string {
    const teamName = team.name.trim()
    return `team-option-${optionIdSegment(teamName)}`
  }

  function activeTeamOptionId(): string | undefined {
    const activeTeam = teams.find(isTeamItemActive)
    return activeTeam ? teamOptionId(activeTeam) : undefined
  }

  function handleTeamRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, team: TeamInfo): void {
    if (loadingLabel) return
    handleOptionSelectKeyDown(event, () => selectTeam(team))
  }

  function handleOptionSelectKeyDown(event: ReactKeyboardEvent<HTMLElement>, select: () => void): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const listbox = event.currentTarget.closest('[role="listbox"]')
    if (!listbox) return
    const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))
      .filter(option => option.getAttribute('aria-disabled') !== 'true')
    if (!options.length) return
    const currentIndex = options.indexOf(event.currentTarget)
    const fallbackIndex = event.key === 'End' ? options.length - 1 : 0
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : currentIndex >= 0
          ? (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
          : fallbackIndex
    const nextOption = options[nextIndex]
    if (!nextOption || nextOption === event.currentTarget) return
    nextOption.focus()
    nextOption.click()
  }

  function isAgentTaskItemActive(task: Pick<AgentTaskInfo, 'id'>): boolean {
    return activeSession?.layout.selectedAgentTaskId?.trim() === task.id.trim()
  }

  function isProjectScheduledTaskItemActive(task: Pick<ProjectScheduledTaskInfo, 'id'>): boolean {
    return projectTaskDraft.id === task.id.trim()
  }

  function handleProjectScheduledTaskRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, task: ProjectScheduledTaskInfo): void {
    if (loadingLabel) return
    handleOptionSelectKeyDown(event, () => editProjectScheduledTask(task))
  }

  function projectScheduledTaskOptionId(task: Pick<ProjectScheduledTaskInfo, 'id'>): string {
    const taskId = task.id.trim()
    return `project-task-option-${optionIdSegment(taskId)}`
  }

  function activeProjectScheduledTaskOptionId(): string | undefined {
    const activeTask = projectTasks.find(isProjectScheduledTaskItemActive)
    return activeTask ? projectScheduledTaskOptionId(activeTask) : undefined
  }

  function isScheduledTaskItemActive(task: Pick<ScheduledTaskInfo, 'id'>): boolean {
    return taskDraft.id === task.id.trim()
  }

  function handleScheduledTaskRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, task: ScheduledTaskInfo): void {
    if (loadingLabel) return
    handleOptionSelectKeyDown(event, () => editScheduledTask(task))
  }

  function scheduledTaskOptionId(task: Pick<ScheduledTaskInfo, 'id'>): string {
    const taskId = task.id.trim()
    return `scheduled-task-option-${optionIdSegment(taskId)}`
  }

  function activeScheduledTaskOptionId(): string | undefined {
    const activeTask = desktopConfig?.scheduledTasks.find(isScheduledTaskItemActive)
    return activeTask ? scheduledTaskOptionId(activeTask) : undefined
  }

  function optionIdSegment(value: string): string {
    return encodeURIComponent(value)
  }

  function isMcpServerItemActive(server: McpServerInfo, scope: 'user' | 'project'): boolean {
    const serverName = server.name.trim()
    return (
      mcpDraft.scope === scope &&
      mcpDraft.editingName?.trim() === serverName
    ) || (
      selectedMcpDetailScope === scope &&
      selectedMcpDetail?.name.trim() === serverName &&
      selectedMcpDetail.sourcePath === server.sourcePath
    )
  }

  function mcpServerOptionId(server: Pick<McpServerInfo, 'name' | 'sourcePath'>, scope: 'user' | 'project'): string {
    const serverName = server.name.trim()
    return `mcp-server-option-${scope}-${optionIdSegment(server.sourcePath)}-${optionIdSegment(serverName)}`
  }

  function activeMcpServerOptionId(): string | undefined {
    const userServer = desktopConfig?.mcpServers.find(server => isMcpServerItemActive(server, 'user'))
    if (userServer) return mcpServerOptionId(userServer, 'user')
    const projectServer = projectMcpServers.find(server => isMcpServerItemActive(server, 'project'))
    return projectServer ? mcpServerOptionId(projectServer, 'project') : undefined
  }

  function handleMcpServerRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, server: McpServerInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    handleOptionSelectKeyDown(event, () => editMcpServer(server, scope))
  }

  function isSkillItemActive(skill: InstalledSkillInfo): boolean {
    const skillName = skill.name.trim()
    return selectedSkillDetail?.name.trim() === skillName && selectedSkillDetail.path === skill.path
  }

  function skillOptionId(skill: Pick<InstalledSkillInfo, 'name' | 'path'>, scope: 'user' | 'project'): string {
    const skillName = skill.name.trim()
    const skillPath = skill.path.trim()
    return `skill-option-${scope}-${optionIdSegment(skillPath)}-${optionIdSegment(skillName)}`
  }

  function activeSkillOptionId(): string | undefined {
    const userSkill = desktopConfig?.skills.find(isSkillItemActive)
    if (userSkill) return skillOptionId(userSkill, 'user')
    const projectSkill = projectSkills.find(isSkillItemActive)
    return projectSkill ? skillOptionId(projectSkill, 'project') : undefined
  }

  function handleSkillRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, skill: InstalledSkillInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    handleOptionSelectKeyDown(event, () => {
      if (scope === 'project') {
        void inspectProjectSkill(skill)
        return
      }
      void inspectUserSkill(skill)
    })
  }

  useEffect(() => {
    if (!selectedPluginIdentity) return
    if (!desktopConfig?.plugins) return
    const selectedPluginIdentityExists = desktopConfig?.plugins.some(plugin =>
      installedPluginIdentity(plugin) === selectedPluginIdentity,
    )
    if (selectedPluginIdentityExists) return
    const session = activeSession
    setSelectedPluginIdentity(undefined)
    setPluginDraft(emptyPluginDraft())
    if (session) void updateSessionLayout(session.id, { selectedPluginIdentity: undefined })
  }, [desktopConfig?.plugins, selectedPluginIdentity])

  function isPluginItemActive(plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): boolean {
    const pluginId = plugin.id.trim()
    const pluginScope = plugin.scope === 'project'
      ? 'project'
      : plugin.scope === 'local'
        ? 'local'
        : 'user'
    return (
      pluginDraft.plugin.trim() === pluginId &&
      pluginDraft.scope === pluginScope &&
      selectedPluginIdentity === installedPluginIdentity(plugin)
    )
  }

  function pluginOptionId(plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): string {
    const pluginId = plugin.id.trim()
    const pluginScope = plugin.scope === 'project'
      ? 'project'
      : plugin.scope === 'local'
        ? 'local'
        : 'user'
    return `plugin-option-${optionIdSegment(pluginScope)}-${optionIdSegment(plugin.installPath ?? plugin.version ?? pluginId)}-${optionIdSegment(pluginId)}`
  }

  function activePluginOptionId(): string | undefined {
    const activePlugin = desktopConfig?.plugins.find(isPluginItemActive)
    return activePlugin ? pluginOptionId(activePlugin) : undefined
  }

  function canSelectPlugin(plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): boolean {
    if (loadingLabel) return false
    return plugin.scope !== 'project' && plugin.scope !== 'local' || Boolean(activeSession)
  }

  function handlePluginRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): void {
    if (!canSelectPlugin(plugin)) return
    handleOptionSelectKeyDown(event, () => selectPlugin(plugin))
  }

  function handlePluginRowClick(plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): void {
    if (!canSelectPlugin(plugin)) return
    selectPlugin(plugin)
  }

  function handlePluginListClick(): void {
    if (loadingLabel) return
    void listAvailablePlugins()
  }

  function handlePluginInstallClick(): void {
    if (loadingLabel) return
    void installPlugin()
  }

  function handlePluginDraftPackageChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (pluginDraftSessionBlocked || loadingLabel) return
    const session = activeSession
    setSelectedPluginIdentity(undefined)
    if (session) void updateSessionLayout(session.id, { selectedPluginIdentity: undefined })
    setPluginDraft(prev => ({
      ...prev,
      plugin: event.target.value,
    }))
  }

  function handlePluginDraftScopeChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (loadingLabel) return
    const session = activeSession
    setSelectedPluginIdentity(undefined)
    if (session) void updateSessionLayout(session.id, { selectedPluginIdentity: undefined })
    setPluginDraft(prev => ({
      ...prev,
      scope: event.target.value === 'project'
        ? 'project'
        : event.target.value === 'local'
          ? 'local'
          : 'user',
    }))
  }

  function handlePluginUpdateClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number],
  ): void {
    event.stopPropagation()
    if (loadingLabel) return
    void updatePlugin(plugin)
  }

  function handlePluginToggleClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number],
    enabled: boolean,
  ): void {
    event.stopPropagation()
    if (loadingLabel) return
    void setPluginEnabled(plugin, enabled)
  }

  function handlePluginUninstallClick(
    event: ReactMouseEvent<HTMLButtonElement>,
    plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number],
  ): void {
    event.stopPropagation()
    if (loadingLabel) return
    void uninstallPlugin(plugin)
  }

  function selectPlugin(plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): void {
    if (!canSelectPlugin(plugin)) return
    const session = activeSession
    const pluginId = plugin.id.trim()
    if (!pluginId) {
      setSettingsStatus({ kind: 'error', text: 'Select an installed plugin before editing the install form.' })
      return
    }
    setPluginDraft({
      plugin: pluginId,
      scope: plugin.scope === 'project'
        ? 'project'
        : plugin.scope === 'local'
          ? 'local'
          : 'user',
    })
    const selectedPluginIdentity = installedPluginIdentity(plugin)
    setSelectedPluginIdentity(selectedPluginIdentity)
    if (session) void updateSessionLayout(session.id, { selectedPluginIdentity })
    setSettingsStatus({ kind: 'info', text: `Selected plugin ${pluginId}.` })
  }

  async function selectInstalledPluginAfterRefresh(
    pluginId: string,
    scope: PluginDraft['scope'],
    originSession?: Pick<DesktopSession, 'id'>,
  ): Promise<void> {
    if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== originSession?.id) return
    const installed = desktopConfigRef.current?.plugins.find(plugin => {
      const installedId = plugin.id.trim()
      const installedScope = plugin.scope === 'project'
        ? 'project'
        : plugin.scope === 'local'
          ? 'local'
          : 'user'
      return installedId === pluginId && installedScope === scope
    })
    const selectedPluginIdentity = installed ? installedPluginIdentity(installed) : undefined
    setSelectedPluginIdentity(selectedPluginIdentity)
    if (originSession) {
      await updateSessionLayout(originSession.id, { selectedPluginIdentity })
    }
  }

  function openSettingsNavItem(item: SettingsNavItem): void {
    if (item.pane === 'tasks') {
      openTasksSection(item.sectionId)
      return
    }
    openSettingsSection(item.sectionId)
  }

  function handleSettingsBackClick(): void {
    if (loadingLabel) return
    openPrimaryView('chat')
  }

  function handleSettingsNavItemClick(item: SettingsNavItem): void {
    if (loadingLabel) return
    openSettingsNavItem(item)
  }

  function handleSettingsSearchChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    const value = event.target.value
    setSettingsSearch(value)
  }

  useEffect(() => {
    if (!settingsSearch.trim()) return
    const first = visibleSettingsNavItems[0]
    if (!first) return
    const already = visibleSettingsNavItems.some(item => isSettingsNavItemActive(item))
    if (already) return
    openPaneSection(first.pane, first.sectionId, first.pane)
  }, [settingsSearch, visibleSettingsNavItems])

  function handleSettingsSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visibleSettingsNavItems.length) {
      event.preventDefault()
      const currentIndex = visibleSettingsNavItems.findIndex(item => isSettingsNavItemActive(item))
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = currentIndex >= 0
        ? (currentIndex + direction + visibleSettingsNavItems.length) % visibleSettingsNavItems.length
        : direction > 0
          ? 0
          : visibleSettingsNavItems.length - 1
      openSettingsNavItem(visibleSettingsNavItems[nextIndex]!)
      return
    }
    if ((event.key === 'Home' || event.key === 'End') && visibleSettingsNavItems.length) {
      event.preventDefault()
      const nextIndex = event.key === 'Home' ? 0 : visibleSettingsNavItems.length - 1
      openSettingsNavItem(visibleSettingsNavItems[nextIndex]!)
      return
    }
    if (event.key === 'Enter' && (activeSettingsNavItem || visibleSettingsNavItems[0])) {
      event.preventDefault()
      openSettingsNavItem(activeSettingsNavItem ?? visibleSettingsNavItems[0]!)
      return
    }
    if (event.key === 'Escape' && settingsSearch) {
      event.preventDefault()
      setSettingsSearch('')
    }
  }

  async function toggleDirectory(path: string): Promise<void> {
    if (!activeSession) {
      setFilesStatus({ kind: 'error', text: 'Select a session before expanding folders.' })
      return
    }
    if (loadingLabel) return
    const session = activeSession
    const next = new Set<string>(expandedPaths)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    await updateSessionLayout(session.id, { expandedPaths: [...next] })
  }

  function handleFileTreeEntryClick(entry: WorkspaceEntry): void {
    if (loadingLabel) return
    if (entry.type === 'directory') {
      void toggleDirectory(entry.path)
      return
    }
    void openFile(entry.path)
  }

  async function openPreview(): Promise<void> {
    if (previewActionPendingRef.current) return
    const session = activeSession
    const url = previewUrl
    if (!session) {
      setError('Start or select a session before opening a preview.')
      setPreviewStatus({ kind: 'error', text: 'Start or select a session before opening a preview.' })
      return
    }
    if (!isHttpUrl(url)) {
      setError('Preview URL must start with http:// or https://')
      setPreviewStatus({ kind: 'error', text: 'URL must start with http:// or https://' })
      return
    }
    previewActionPendingRef.current = true
    try {
      await runAction('Opening preview', async () => {
        setPreviewStatus({ kind: 'info', text: `Opening ${url}` })
        await window.claudeDesktop.preview.setUrl(url)
        if (activeSessionIdRef.current !== session.id) return
        setPrimaryNavView('chat')
        setCommittedPreviewUrl(url)
        await updateSessionLayout(session.id, { previewUrl: url, activePane: 'preview', primaryView: 'chat' })
        if (activeSessionIdRef.current !== session.id) return
        setPreviewStatus({ kind: 'success', text: `Previewing ${url}` })
      })
    } finally {
      previewActionPendingRef.current = false
    }
  }

  function handleOpenPreviewClick(): void {
    if (loadingLabel) return
    void openPreview()
  }

  async function openExternalPreview(): Promise<void> {
    if (previewActionPendingRef.current) return
    const session = activeSession
    const url = previewUrl
    if (!session) {
      setError('Start or select a session before opening a preview.')
      setPreviewStatus({ kind: 'error', text: 'Start or select a session before opening a preview.' })
      return
    }
    if (!isHttpUrl(url)) {
      setError('External URL must start with http:// or https://')
      setPreviewStatus({ kind: 'error', text: 'URL must start with http:// or https://' })
      return
    }
    previewActionPendingRef.current = true
    try {
      setError(undefined)
      setLoadingLabel('Opening browser')
      setPreviewStatus({ kind: 'info', text: `Opening ${url} in browser...` })
      await window.claudeDesktop.preview.openExternal(url)
      if (activeSessionIdRef.current !== session.id) return
      setPreviewStatus({ kind: 'success', text: `Opened ${url} in browser. Embedded preview unchanged.` })
    } catch (cause) {
      if (activeSessionIdRef.current !== session.id) return
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      setPreviewStatus({ kind: 'error', text: message })
    } finally {
      setLoadingLabel(undefined)
      previewActionPendingRef.current = false
    }
  }

  function handleOpenExternalPreviewClick(): void {
    if (loadingLabel) return
    void openExternalPreview()
  }

  async function openExternalLink(url: string): Promise<void> {
    if (externalLinkActionPendingRef.current) return
    const session = activeSession
    if (!session) {
      setError('Start or select a session before opening a link.')
      setConversationNotice({ kind: 'error', text: 'Start or select a session before opening a link.' })
      return
    }
    if (!isHttpUrl(url)) {
      setError('External URL must start with http:// or https://')
      setConversationNotice({ kind: 'error', text: 'URL must start with http:// or https://' })
      return
    }
    externalLinkActionPendingRef.current = true
    try {
      setError(undefined)
      setLoadingLabel('Opening browser')
      setConversationNotice({ kind: 'info', text: `Opening ${url} in browser...` })
      await window.claudeDesktop.preview.openExternal(url)
      if (activeSessionIdRef.current !== session.id) return
      setConversationNotice({ kind: 'success', text: `Opened ${url} in browser.` })
    } catch (cause) {
      if (activeSessionIdRef.current !== session.id) return
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      setConversationNotice({ kind: 'error', text: message })
    } finally {
      setLoadingLabel(undefined)
      externalLinkActionPendingRef.current = false
    }
  }

  async function saveProxySettings(): Promise<void> {
    if (loadingLabel) return
    if (proxyActionPendingRef.current) return
    if (!canSaveProxy) {
      setSettingsStatus({
        kind: 'error',
        text: 'Proxy URL must start with socks5://, socks4://, http://, or https://',
      })
      return
    }
    proxyActionPendingRef.current = true
    try {
      await runAction('Saving proxy settings', async () => {
        const saved = await window.claudeDesktop.config.updateProxy(proxyDraft)
        setProxyDraft(saved)
        await refreshDesktopConfig()
        setSettingsStatus({ kind: 'success', text: 'Saved proxy settings.' })
      })
    } finally {
      proxyActionPendingRef.current = false
    }
  }

  function handleSettingsRefreshClick(): void {
    if (loadingLabel) return
    void refreshSettingsConfig()
  }

  function handleDiagnosticsExportClick(): void {
    if (loadingLabel) return
    void exportDiagnostics()
  }

  function handleProxySaveClick(): void {
    if (loadingLabel) return
    void saveProxySettings()
  }

  function handleProxyEnabledChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setProxyDraft(prev => ({
      ...prev,
      enabled: event.target.checked,
    }))
  }

  function handleProxyUrlChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setProxyDraft(prev => ({
      ...prev,
      url: event.target.value,
    }))
  }

  async function runSkillAction(
    actionKey: string,
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (skillActionPendingRef.current.has(actionKey)) return
    skillActionPendingRef.current.add(actionKey)
    try {
      await runAction(label, action)
    } finally {
      skillActionPendingRef.current.delete(actionKey)
    }
  }

  async function installLocalSkill(): Promise<void> {
    if (loadingLabel) return
    const session = activeSession
    await runSkillAction('user:install-local-skill', 'Installing skill', async () => {
      const installed = await window.claudeDesktop.skills.installLocal()
      if (installed) {
        setSelectedSkillDetail(installed)
        setSelectedSkillDetailScope('user')
        if (session) await updateSessionLayout(session.id, {
          selectedSkillName: installed.name,
          selectedSkillPath: installed.path,
          selectedSkillScope: 'user',
        })
        await refreshDesktopConfig()
        setSettingsStatus({ kind: 'success', text: 'Installed user skill.' })
      } else {
        setSettingsStatus({ kind: 'info', text: 'Skill install cancelled.' })
      }
    })
  }

  async function installProjectSkill(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session to install a project skill.',
      })
      return
    }
    const session = activeSession
    await runSkillAction(`${session.id}:project:install-local-skill`, 'Installing project skill', async () => {
      const installed = await window.claudeDesktop.workspaceSkills.installLocal(session.cwd)
      if (activeSessionIdRef.current !== session.id) return
      if (installed) {
        setSelectedSkillDetail(installed)
        setSelectedSkillDetailScope('project')
        if (session) await updateSessionLayout(session.id, {
          selectedSkillName: installed.name,
          selectedSkillPath: installed.path,
          selectedSkillScope: 'project',
        })
        await refreshWorkspace(session)
        if (activeSessionIdRef.current !== session.id) return
        setSettingsStatus({ kind: 'success', text: 'Installed project skill.' })
      } else {
        setSettingsStatus({ kind: 'info', text: 'Project skill install cancelled.' })
      }
    })
  }

  async function inspectUserSkill(skill: InstalledSkillInfo): Promise<void> {
    if (loadingLabel) return
    const selectedSkillName = skill.name.trim()
    if (!selectedSkillName) {
      setSettingsStatus({ kind: 'error', text: 'Select a skill before inspecting.' })
      return
    }
    const session = activeSession
    await runSkillAction(`user:read:${selectedSkillName}`, 'Reading skill', async () => {
      const detail = await window.claudeDesktop.skills.read(selectedSkillName)
      setSelectedSkillDetail(detail)
      setSelectedSkillDetailScope('user')
      if (session) await updateSessionLayout(session.id, {
        selectedSkillName: detail.name,
        selectedSkillPath: detail.path,
        selectedSkillScope: 'user',
      })
      setSettingsStatus({ kind: 'info', text: `Inspecting user skill "${selectedSkillName}".` })
    })
  }

  async function inspectProjectSkill(skill: InstalledSkillInfo): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setSettingsStatus({ kind: 'error', text: 'Select a session before editing project skills.' })
      return
    }
    const selectedSkillName = skill.name.trim()
    if (!selectedSkillName) {
      setSettingsStatus({ kind: 'error', text: 'Select a project skill before inspecting.' })
      return
    }
    const session = activeSession
    await runSkillAction(`${session.id}:project:read:${selectedSkillName}`, 'Reading project skill', async () => {
      const detail = await window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)
      if (activeSessionIdRef.current !== session.id) return
      setSelectedSkillDetail(detail)
      setSelectedSkillDetailScope('project')
      if (session) await updateSessionLayout(session.id, {
        selectedSkillName: detail.name,
        selectedSkillPath: detail.path,
        selectedSkillScope: 'project',
      })
      setSettingsStatus({ kind: 'info', text: `Inspecting project skill "${selectedSkillName}".` })
    })
  }

  function startNewUserSkillDraft(): void {
    if (loadingLabel) return
    const session = activeSession
    setSkillDraft(emptySkillDraft('user'))
    setSelectedSkillDetail(undefined)
    setSelectedSkillDetailScope(undefined)
    if (session) void updateSessionLayout(session.id, {
      selectedSkillName: undefined,
      selectedSkillPath: undefined,
      selectedSkillScope: undefined,
    })
    setSettingsStatus({ kind: 'info', text: 'Creating a new user skill.' })
  }

  function startNewProjectSkillDraft(): void {
    if (loadingLabel) return
    if (!activeSession) {
      setSettingsStatus({ kind: 'error', text: 'Select a session before creating project skills.' })
      return
    }
    const session = activeSession
    setSkillDraft(emptySkillDraft('project'))
    setSelectedSkillDetail(undefined)
    setSelectedSkillDetailScope(undefined)
    if (session) void updateSessionLayout(session.id, {
      selectedSkillName: undefined,
      selectedSkillPath: undefined,
      selectedSkillScope: undefined,
    })
    setSettingsStatus({ kind: 'info', text: 'Creating a new project skill.' })
  }

  function editSkillDetail(
    detail: InstalledSkillInfo,
    scope: 'user' | 'project',
  ): void {
    if (loadingLabel) return
    if (scope === 'project' && !activeSession) {
      setSettingsStatus({ kind: 'error', text: 'Select a session before editing project skills.' })
      return
    }
    const selectedSkillName = detail.name.trim()
    if (!selectedSkillName) {
      setSettingsStatus({ kind: 'error', text: scope === 'project' ? 'Select a project skill before editing.' : 'Select a skill before editing.' })
      return
    }
    setSkillDraft({ ...skillDraftFromDetail(detail, scope), name: selectedSkillName, editingName: selectedSkillName })
    setSettingsStatus({ kind: 'info', text: `Editing ${scope} skill "${selectedSkillName}".` })
  }

  async function removeSkillDetail(
    detail: InstalledSkillInfo,
    scope: 'user' | 'project',
  ): Promise<void> {
    if (loadingLabel) return
    if (scope === 'project' && !activeSession) {
      setSettingsStatus({ kind: 'error', text: 'Select a session before editing project skills.' })
      return
    }
    if (scope === 'project') {
      await removeProjectSkill(detail)
    } else {
      await removeUserSkill(detail)
    }
  }

  function handleSelectedSkillDetailEditClick(): void {
    if (loadingLabel) return
    if (!selectedSkillDetail) {
      setSettingsStatus({ kind: 'error', text: 'Select a skill before editing.' })
      return
    }
    editSkillDetail(
      selectedSkillDetail,
      selectedSkillDetailScope === 'project' ? 'project' : 'user',
    )
  }

  function handleSelectedSkillDetailRemoveClick(): void {
    if (loadingLabel) return
    if (!selectedSkillDetail) {
      setSettingsStatus({ kind: 'error', text: 'Select a skill before removing.' })
      return
    }
    void removeSkillDetail(
      selectedSkillDetail,
      selectedSkillDetailScope === 'project' ? 'project' : 'user',
    )
  }

  async function editUserSkill(skill: InstalledSkillInfo): Promise<void> {
    if (loadingLabel) return
    const selectedSkillName = skill.name.trim()
    if (!selectedSkillName) {
      setSettingsStatus({ kind: 'error', text: 'Select a skill before editing.' })
      return
    }
    const session = activeSession
    await runSkillAction(`user:edit:${selectedSkillName}`, 'Reading skill', async () => {
      const detail = await window.claudeDesktop.skills.read(selectedSkillName)
      setSelectedSkillDetail(detail)
      setSelectedSkillDetailScope('user')
      editSkillDetail(detail, 'user')
      if (session) await updateSessionLayout(session.id, {
        selectedSkillName: detail.name,
        selectedSkillPath: detail.path,
        selectedSkillScope: 'user',
      })
    })
  }

  async function editProjectSkill(skill: InstalledSkillInfo): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setSettingsStatus({ kind: 'error', text: 'Select a session before editing project skills.' })
      return
    }
    const selectedSkillName = skill.name.trim()
    if (!selectedSkillName) {
      setSettingsStatus({ kind: 'error', text: 'Select a project skill before editing.' })
      return
    }
    const session = activeSession
    await runSkillAction(`${session.id}:project:edit:${selectedSkillName}`, 'Reading project skill', async () => {
      const detail = await window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)
      if (activeSessionIdRef.current !== session.id) return
      setSelectedSkillDetail(detail)
      setSelectedSkillDetailScope('project')
      editSkillDetail(detail, 'project')
      if (session) await updateSessionLayout(session.id, {
        selectedSkillName: detail.name,
        selectedSkillPath: detail.path,
        selectedSkillScope: 'project',
      })
    })
  }

  function cancelSkillDraft(): void {
    if (loadingLabel) return
    setSkillDraft(undefined)
    setSettingsStatus({ kind: 'info', text: 'Cancelled skill edit.' })
  }

  function handleUserSkillNewClick(): void {
    if (loadingLabel) return
    startNewUserSkillDraft()
  }

  function handleProjectSkillNewClick(): void {
    if (loadingLabel) return
    startNewProjectSkillDraft()
  }

  function handleUserSkillInstallClick(): void {
    if (loadingLabel) return
    void installLocalSkill()
  }

  function handleProjectSkillInstallClick(): void {
    if (loadingLabel) return
    void installProjectSkill()
  }

  function handleSkillDraftNameChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (skillDraftSessionBlocked || loadingLabel) return
    setSkillDraft(prev => prev ? {
      ...prev,
      name: event.target.value,
    } : prev)
  }

  function handleSkillDraftScopeChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (skillDraftSessionBlocked || loadingLabel) return
    setSkillDraft(prev => prev ? {
      ...prev,
      scope: event.target.value === 'project' ? 'project' : 'user',
    } : prev)
  }

  function handleSkillDraftContentsChange(event: ReactChangeEvent<HTMLTextAreaElement>): void {
    if (skillDraftSessionBlocked || loadingLabel) return
    setSkillDraft(prev => prev ? {
      ...prev,
      contents: event.target.value,
    } : prev)
  }

  function handleSkillSaveClick(): void {
    if (loadingLabel) return
    void saveSkillDraft()
  }

  function handleSkillCancelClick(): void {
    if (loadingLabel) return
    cancelSkillDraft()
  }

  function handleSkillRowClick(skill: InstalledSkillInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    if (scope === 'project') {
      void inspectProjectSkill(skill)
    } else {
      void inspectUserSkill(skill)
    }
  }

  function handleSkillInspectClick(skill: InstalledSkillInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    if (scope === 'project') {
      void inspectProjectSkill(skill)
    } else {
      void inspectUserSkill(skill)
    }
  }

  function handleSkillEditClick(skill: InstalledSkillInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    if (scope === 'project') {
      void editProjectSkill(skill)
    } else {
      void editUserSkill(skill)
    }
  }

  function handleSkillRemoveClick(skill: InstalledSkillInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    if (scope === 'project') {
      void removeProjectSkill(skill)
    } else {
      void removeUserSkill(skill)
    }
  }

  async function saveSkillDraft(): Promise<void> {
    if (loadingLabel) return
    if (!skillDraft) {
      setSettingsStatus({ kind: 'error', text: 'Start or select a skill draft before saving.' })
      return
    }
    const name = skillDraft.name.trim()
    const scope = skillDraft.scope as string
    if (!isUserProjectScope(scope)) {
      setSettingsStatus({ kind: 'error', text: 'Choose a valid skill scope before saving.' })
      return
    }
    const session = activeSession
    const editingSkillName = skillDraft.editingName?.trim()
    const actionKey = `${scope === 'project' ? session?.id : 'user'}:${scope}:save-skill:${editingSkillName ?? name}`
    await runSkillAction(actionKey, 'Saving skill', async () => {
      if (!canSaveSkill) {
        throw new Error('Skill name and contents are required.')
      }
      if (scope === 'project' && !session) {
        throw new Error('Select a session before editing project skills.')
      }
      const input = {
        name,
        contents: skillDraft.contents,
      }
      const detail = scope === 'project'
        ? await window.claudeDesktop.workspaceSkills.save(session.cwd, {
            name: input.name,
            contents: input.contents,
          })
        : await window.claudeDesktop.skills.save({
            name: input.name,
            contents: input.contents,
          })
      if (
        editingSkillName &&
        editingSkillName !== name
      ) {
        if (scope === 'project') {
          await window.claudeDesktop.workspaceSkills.remove(session.cwd, editingSkillName)
        } else {
          await window.claudeDesktop.skills.remove(editingSkillName)
        }
      }
      if (scope === 'project' && activeSessionIdRef.current !== session.id) return
      setSelectedSkillDetail(detail)
      setSelectedSkillDetailScope(scope)
      setSkillDraft(skillDraftFromDetail(detail, scope))
      if (session) await updateSessionLayout(session.id, {
        selectedSkillName: detail.name,
        selectedSkillPath: detail.path,
        selectedSkillScope: scope,
      })
      await refreshDesktopConfig()
      if (scope === 'project' && activeSessionIdRef.current !== session.id) return
      if (scope === 'project') {
        const skills = await window.claudeDesktop.workspaceSkills.list(session.cwd)
        if (activeSessionIdRef.current !== session.id) return
        setProjectSkills(skills)
        await refreshWorkspace(session)
        if (activeSessionIdRef.current !== session.id) return
      }
      setSettingsStatus({ kind: 'success', text: `Saved ${scope} skill "${detail.name}".` })
    })
  }

  async function removeUserSkill(skill: InstalledSkillInfo): Promise<void> {
    if (loadingLabel) return
    const session = activeSession
    const removedSkillName = skill.name.trim()
    if (!removedSkillName) {
      setSettingsStatus({ kind: 'error', text: 'Select a skill before removing.' })
      return
    }
    const actionKey = `user:remove:${removedSkillName}`
    if (skillActionPendingRef.current.has(actionKey)) return
    skillActionPendingRef.current.add(actionKey)
    try {
      if (!(await requestConfirmation({
        title: 'Remove user skill?',
        message: `Remove user skill "${removedSkillName}" from Claude Code settings.`,
        confirmLabel: 'Remove skill',
        cancelLabel: 'Cancel',
        tone: 'danger',
      }))) return
      skillActionPendingRef.current.delete(actionKey)
      await runSkillAction(actionKey, 'Removing skill', async () => {
        const skills = await window.claudeDesktop.skills.remove(removedSkillName)
        setDesktopConfig(prev => prev ? { ...prev, skills } : prev)
        if (skillDraft?.editingName?.trim() === removedSkillName && skillDraft.scope === 'user') {
          setSkillDraft(undefined)
        }
        if (selectedSkillDetailScope === 'user' && selectedSkillDetail?.name.trim() === removedSkillName && selectedSkillDetail.path === skill.path) {
          setSelectedSkillDetail(undefined)
          setSelectedSkillDetailScope(undefined)
          if (session) await updateSessionLayout(session.id, {
            selectedSkillName: undefined,
            selectedSkillPath: undefined,
            selectedSkillScope: undefined,
          })
        }
        await refreshDesktopConfig()
        setSettingsStatus({ kind: 'success', text: `Removed user skill "${removedSkillName}".` })
      })
    } finally {
      skillActionPendingRef.current.delete(actionKey)
    }
  }

  async function removeProjectSkill(skill: InstalledSkillInfo): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setSettingsStatus({ kind: 'error', text: 'Select a session before editing project skills.' })
      return
    }
    const removedSkillName = skill.name.trim()
    if (!removedSkillName) {
      setSettingsStatus({ kind: 'error', text: 'Select a project skill before removing.' })
      return
    }
    const session = activeSession
    const actionKey = `${session.id}:project:remove:${removedSkillName}`
    if (skillActionPendingRef.current.has(actionKey)) return
    skillActionPendingRef.current.add(actionKey)
    try {
      if (!(await requestConfirmation({
        title: 'Remove project skill?',
        message: `Remove project skill "${removedSkillName}" from this workspace.`,
        confirmLabel: 'Remove skill',
        cancelLabel: 'Cancel',
        tone: 'danger',
      }))) return
      skillActionPendingRef.current.delete(actionKey)
      await runSkillAction(actionKey, 'Removing project skill', async () => {
        const skills = await window.claudeDesktop.workspaceSkills.remove(
          session.cwd,
          removedSkillName,
        )
        if (activeSessionIdRef.current !== session.id) return
        setProjectSkills(skills)
        if (skillDraft?.editingName?.trim() === removedSkillName && skillDraft.scope === 'project') {
          setSkillDraft(undefined)
        }
        if (selectedSkillDetailScope === 'project' && selectedSkillDetail?.name.trim() === removedSkillName && selectedSkillDetail.path === skill.path) {
          setSelectedSkillDetail(undefined)
          setSelectedSkillDetailScope(undefined)
          if (session) await updateSessionLayout(session.id, {
            selectedSkillName: undefined,
            selectedSkillPath: undefined,
            selectedSkillScope: undefined,
          })
        }
        await refreshWorkspace(session)
        if (activeSessionIdRef.current !== session.id) return
        setSettingsStatus({ kind: 'success', text: `Removed project skill "${removedSkillName}".` })
      })
    } finally {
      skillActionPendingRef.current.delete(actionKey)
    }
  }

  async function saveMcpServer(): Promise<void> {
    if (loadingLabel) return
    const name = mcpDraft.name.trim()
    const scope = mcpDraft.scope as string
    if (!isUserProjectScope(scope)) {
      setSettingsStatus({ kind: 'error', text: 'Choose a valid MCP scope before saving.' })
      return
    }
    if (!isMcpMode(mcpDraft.mode)) {
      setSettingsStatus({ kind: 'error', text: 'Choose a valid MCP transport mode before saving.' })
      return
    }
    if (mcpDraft.mode === 'remote' && !isMcpRemoteType(mcpDraft.type)) {
      setSettingsStatus({ kind: 'error', text: 'Choose a valid MCP remote type before saving.' })
      return
    }
    if (mcpDraft.mode === 'remote' && !isHttpUrl(mcpDraft.url.trim())) {
      setSettingsStatus({ kind: 'error', text: 'Enter a valid MCP remote URL before saving.' })
      return
    }
    const session = activeSession
    const projectSession = scope === 'project' ? session : undefined
    if (scope === 'project' && !projectSession) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session before editing project MCP servers',
      })
      return
    }
    const editingMcpName = mcpDraft.editingName?.trim()
    const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:save:${editingMcpName ?? name}`
    if (mcpActionPendingRef.current.has(actionKey)) return
    mcpActionPendingRef.current.add(actionKey)
    await runAction('Saving MCP server', async () => {
      if (scope === 'project' && !projectSession) {
        throw new Error('Select a session before editing project MCP servers')
      }
      let savedMcpServers: McpServerInfo[]
      if (scope === 'project') {
        savedMcpServers = await window.claudeDesktop.workspaceMcp.addOrUpdate(
          projectSession.cwd,
          mcpInputFromDraft(mcpDraft),
        )
      } else {
        savedMcpServers = await window.claudeDesktop.mcp.addOrUpdate(mcpInputFromDraft(mcpDraft))
      }
      if (editingMcpName && editingMcpName !== name) {
        if (scope === 'project') {
          savedMcpServers = await window.claudeDesktop.workspaceMcp.remove(projectSession.cwd, editingMcpName)
        } else {
          savedMcpServers = await window.claudeDesktop.mcp.remove(editingMcpName)
        }
      }
      if (scope === 'project' && activeSessionIdRef.current !== projectSession.id) return
      const savedSelectedMcpDetail = savedMcpServers.find(server => server.name.trim() === name)
      if (savedSelectedMcpDetail) {
        setSelectedMcpDetail(savedSelectedMcpDetail)
        setSelectedMcpDetailScope(scope)
        if (session) await updateSessionLayout(session.id, {
          selectedMcpName: savedSelectedMcpDetail.name,
          selectedMcpSourcePath: savedSelectedMcpDetail.sourcePath,
          selectedMcpScope: scope,
        })
      }
      setMcpDraft(emptyMcpDraft())
      await refreshDesktopConfig()
      if (scope === 'project' && activeSessionIdRef.current !== projectSession.id) return
      if (scope === 'project') {
        await refreshWorkspace(projectSession)
        if (activeSessionIdRef.current !== projectSession.id) return
      } else {
        await refreshWorkspace(session)
      }
      setSettingsStatus({ kind: 'success', text: 'Saved MCP server.' })
    }).finally(() => {
      mcpActionPendingRef.current.delete(actionKey)
    })
  }

  async function removeMcpServer(name: string, scope: 'user' | 'project'): Promise<void> {
    if (loadingLabel) return
    const session = activeSession
    const projectSession = scope === 'project' ? session : undefined
    if (scope === 'project' && !projectSession) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session before editing project MCP servers',
      })
      return
    }
    const removedMcpName = name.trim()
    if (!removedMcpName) {
      setSettingsStatus({ kind: 'error', text: scope === 'project' ? 'Select a project MCP server before removing.' : 'Select an MCP server before removing.' })
      return
    }
    const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:remove:${removedMcpName}`
    if (mcpActionPendingRef.current.has(actionKey)) return
    mcpActionPendingRef.current.add(actionKey)
    try {
      if (!(await requestConfirmation({
        title: 'Remove MCP server?',
        message: `Remove ${scope} MCP server "${removedMcpName}" from the desktop configuration.`,
        confirmLabel: 'Remove MCP',
        cancelLabel: 'Cancel',
        tone: 'danger',
      }))) return
      await runAction('Removing MCP server', async () => {
        if (scope === 'project' && !projectSession) {
          throw new Error('Select a session before editing project MCP servers')
        }
        if (scope === 'project') {
          await window.claudeDesktop.workspaceMcp.remove(projectSession.cwd, removedMcpName)
        } else {
          await window.claudeDesktop.mcp.remove(removedMcpName)
        }
        if (scope === 'project' && activeSessionIdRef.current !== projectSession.id) return
        if (mcpDraft.editingName?.trim() === removedMcpName && mcpDraft.scope === scope) {
          setMcpDraft(emptyMcpDraft())
        }
        const selectedMcpDetailMatchesRemovedScope = Boolean(
          selectedMcpDetailScope === scope &&
          selectedMcpDetail?.name.trim() === removedMcpName &&
          (scope === 'project'
            ? projectMcpServers.some(server =>
                server.name.trim() === removedMcpName &&
                server.sourcePath === selectedMcpDetail.sourcePath
              )
            : desktopConfig?.mcpServers.some(server =>
                server.name.trim() === removedMcpName &&
                server.sourcePath === selectedMcpDetail.sourcePath
              )),
        )
        if (selectedMcpDetailMatchesRemovedScope) {
          setSelectedMcpDetail(undefined)
          setSelectedMcpDetailScope(undefined)
          if (session) await updateSessionLayout(session.id, {
            selectedMcpName: undefined,
            selectedMcpSourcePath: undefined,
            selectedMcpScope: undefined,
          })
        }
        await refreshDesktopConfig()
        if (scope === 'project' && activeSessionIdRef.current !== projectSession.id) return
        if (scope === 'project') {
          await refreshWorkspace(projectSession)
          if (activeSessionIdRef.current !== projectSession.id) return
        } else {
          await refreshWorkspace(session)
        }
        setSettingsStatus({ kind: 'success', text: `Removed ${scope} MCP server "${removedMcpName}".` })
      })
    } finally {
      mcpActionPendingRef.current.delete(actionKey)
    }
  }

  async function inspectUserMcp(server: McpServerInfo): Promise<void> {
    if (loadingLabel) return
    const selectedMcpName = server.name.trim()
    if (!selectedMcpName) {
      setSettingsStatus({ kind: 'error', text: 'Select an MCP server before inspecting.' })
      return
    }
    const actionKey = `user-mcp:${selectedMcpName}:read`
    if (mcpActionPendingRef.current.has(actionKey)) return
    mcpActionPendingRef.current.add(actionKey)
    const session = activeSession
    await runAction('Reading MCP server', async () => {
      const detail = await window.claudeDesktop.mcp.read(selectedMcpName)
      setSelectedMcpDetail(detail)
      setSelectedMcpDetailScope('user')
      if (session) await updateSessionLayout(session.id, {
        selectedMcpName: detail.name,
        selectedMcpSourcePath: detail.sourcePath,
        selectedMcpScope: 'user',
      })
      setSettingsStatus({ kind: 'info', text: `Inspecting user MCP server "${selectedMcpName}".` })
    }).finally(() => {
      mcpActionPendingRef.current.delete(actionKey)
    })
  }

  async function inspectProjectMcp(server: McpServerInfo): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session before editing project MCP servers',
      })
      return
    }
    const selectedMcpName = server.name.trim()
    if (!selectedMcpName) {
      setSettingsStatus({ kind: 'error', text: 'Select a project MCP server before inspecting.' })
      return
    }
    const session = activeSession
    const actionKey = `${session.cwd}:project-mcp:${selectedMcpName}:read`
    if (mcpActionPendingRef.current.has(actionKey)) return
    mcpActionPendingRef.current.add(actionKey)
    await runAction('Reading project MCP server', async () => {
      const detail = await window.claudeDesktop.workspaceMcp.read(session.cwd, selectedMcpName)
      if (activeSessionIdRef.current !== session.id) return
      setSelectedMcpDetail(detail)
      setSelectedMcpDetailScope('project')
      await updateSessionLayout(session.id, {
        selectedMcpName: detail.name,
        selectedMcpSourcePath: detail.sourcePath,
        selectedMcpScope: 'project',
      })
      setSettingsStatus({ kind: 'info', text: `Inspecting project MCP server "${selectedMcpName}".` })
    }).finally(() => {
      mcpActionPendingRef.current.delete(actionKey)
    })
  }

  async function setProjectMcpApproval(
    server: McpServerInfo,
    approved: boolean,
    scope: 'project' | 'user' = 'project',
  ): Promise<void> {
    if (loadingLabel) return
    const selectedMcpName = server.name.trim()
    if (!selectedMcpName) {
      setSettingsStatus({ kind: 'error', text: 'Select a project MCP server before updating approval.' })
      return
    }
    if (scope !== 'project') {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a project MCP server before updating approval.',
      })
      return
    }
    if (!activeSession) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session before editing project MCP servers',
      })
      return
    }
    if (approved && server.approvalStatus === 'approved') {
      setSettingsStatus({
        kind: 'info',
        text: `Project MCP server "${selectedMcpName}" is already approved.`,
      })
      return
    }
    if (!approved && server.approvalStatus === 'rejected') {
      setSettingsStatus({
        kind: 'info',
        text: `Project MCP server "${selectedMcpName}" is already rejected.`,
      })
      return
    }
    const session = activeSession
    const actionKey = `${session.cwd}:project-mcp:${selectedMcpName}:${approved ? 'approve' : 'reject'}`
    if (mcpActionPendingRef.current.has(actionKey)) return
    mcpActionPendingRef.current.add(actionKey)
    await runAction(`${approved ? 'Approving' : 'Rejecting'} project MCP server`, async () => {
      const servers = await window.claudeDesktop.workspaceMcp.setApproval(
        session.cwd,
        selectedMcpName,
        approved,
      )
      if (activeSessionIdRef.current !== session.id) return
      setProjectMcpServers(servers)
      const updatedSelectedMcpDetail = servers.find(server =>
        selectedMcpDetailScope === 'project' &&
        server.name.trim() === selectedMcpName &&
        server.sourcePath === selectedMcpDetail?.sourcePath
      )
      if (updatedSelectedMcpDetail) setSelectedMcpDetail(updatedSelectedMcpDetail)
      await refreshWorkspace(session)
      if (activeSessionIdRef.current !== session.id) return
      setSettingsStatus({
        kind: 'success',
        text: `${approved ? 'Approved' : 'Rejected'} project MCP server "${selectedMcpName}".`,
      })
    }).finally(() => {
      mcpActionPendingRef.current.delete(actionKey)
    })
  }

  async function setUserMcpEnabled(server: McpServerInfo, enabled: boolean): Promise<void> {
    if (loadingLabel) return
    const selectedMcpName = server.name.trim()
    if (!selectedMcpName) {
      setSettingsStatus({ kind: 'error', text: 'Select an MCP server before enabling or disabling.' })
      return
    }
    const actionKey = `user-mcp:${selectedMcpName}:${enabled ? 'enable' : 'disable'}`
    if (mcpActionPendingRef.current.has(actionKey)) return
    mcpActionPendingRef.current.add(actionKey)
    await runAction(`${enabled ? 'Enabling' : 'Disabling'} MCP server`, async () => {
      const servers = await window.claudeDesktop.mcp.setEnabled(
        selectedMcpName,
        enabled,
      )
      setDesktopConfig(prev => prev
        ? {
            ...prev,
            mcpServers: servers,
          }
        : prev)
      const updatedSelectedMcpDetail = servers.find(server =>
        selectedMcpDetailScope === 'user' &&
        server.name.trim() === selectedMcpName &&
        server.sourcePath === selectedMcpDetail?.sourcePath
      )
      if (updatedSelectedMcpDetail) setSelectedMcpDetail(updatedSelectedMcpDetail)
      await refreshDesktopConfig()
      await refreshWorkspace(activeSession)
      setSettingsStatus({
        kind: 'success',
        text: `${enabled ? 'Enabled' : 'Disabled'} user MCP server "${selectedMcpName}".`,
      })
    }).finally(() => {
      mcpActionPendingRef.current.delete(actionKey)
    })
  }

  function toggleUserMcpServer(server: McpServerInfo): void {
    if (loadingLabel) return
    void setUserMcpEnabled(server, server.enabled === false)
  }

  function approveProjectMcpServer(server: McpServerInfo): void {
    if (loadingLabel) return
    void setProjectMcpApproval(server, true)
  }

  function rejectProjectMcpServer(server: McpServerInfo): void {
    if (loadingLabel) return
    void setProjectMcpApproval(server, false)
  }

  function setSelectedMcpDetailApproval(approved: boolean): void {
    if (loadingLabel) return
    if (!selectedMcpDetail) {
      setSettingsStatus({ kind: 'error', text: 'Select a project MCP server before updating approval.' })
      return
    }
    void setProjectMcpApproval(
      selectedMcpDetail,
      approved,
      selectedMcpDetailScope === 'project' ? 'project' : 'user',
    )
  }

  function handleSelectedMcpDetailApprovalClick(approved: boolean): void {
    if (loadingLabel) return
    setSelectedMcpDetailApproval(approved)
  }

  function handleSelectedMcpDetailEditClick(): void {
    if (loadingLabel) return
    if (!selectedMcpDetail) {
      setSettingsStatus({ kind: 'error', text: 'Select an MCP server before editing.' })
      return
    }
    editMcpServer(
      selectedMcpDetail,
      selectedMcpDetailScope === 'project' ? 'project' : 'user',
    )
  }

  function handleSelectedMcpDetailRemoveClick(): void {
    if (loadingLabel) return
    if (!selectedMcpDetail) {
      setSettingsStatus({ kind: 'error', text: 'Select an MCP server before removing.' })
      return
    }
    void removeMcpServer(
      selectedMcpDetail.name,
      selectedMcpDetailScope === 'project' ? 'project' : 'user',
    )
  }

  function editMcpServer(server: McpServerInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    if (scope === 'project' && !activeSession) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session before editing project MCP servers',
      })
      return
    }
    const selectedMcpName = server.name.trim()
    if (!selectedMcpName) {
      setSettingsStatus({ kind: 'error', text: scope === 'project' ? 'Select a project MCP server before editing.' : 'Select an MCP server before editing.' })
      return
    }
    setMcpDraft({ ...mcpDraftFromServer(server, scope), name: selectedMcpName, editingName: selectedMcpName })
    setSettingsStatus({ kind: 'info', text: `Editing ${scope} MCP server "${selectedMcpName}".` })
  }

  function cancelMcpEdit(): void {
    if (loadingLabel) return
    setMcpDraft(emptyMcpDraft())
    setSettingsStatus({ kind: 'info', text: 'Cancelled MCP edit.' })
  }

  function handleMcpSaveClick(): void {
    if (loadingLabel) return
    void saveMcpServer()
  }

  function handleMcpHealthCheckClick(): void {
    if (loadingLabel) return
    void checkMcpHealth()
  }

  function handleMcpCancelEditClick(): void {
    if (loadingLabel) return
    cancelMcpEdit()
  }

  function handleMcpDraftNameChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (mcpDraftSessionBlocked || loadingLabel) return
    setMcpDraft(prev => ({
      ...prev,
      name: event.target.value,
    }))
  }

  function handleMcpDraftScopeChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (loadingLabel) return
    setMcpDraft(prev => ({
      ...prev,
      scope: event.target.value === 'project' ? 'project' : 'user',
    }))
  }

  function handleMcpDraftModeChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (mcpDraftSessionBlocked || loadingLabel) return
    setMcpDraft(prev => ({
      ...prev,
      mode: event.target.value === 'remote' ? 'remote' : 'stdio',
    }))
  }

  function handleMcpDraftCommandChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (mcpDraftSessionBlocked || loadingLabel) return
    setMcpDraft(prev => ({
      ...prev,
      command: event.target.value,
    }))
  }

  function handleMcpDraftArgsChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (mcpDraftSessionBlocked || loadingLabel) return
    setMcpDraft(prev => ({
      ...prev,
      args: event.target.value,
    }))
  }

  function handleMcpDraftRemoteTypeChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (mcpDraftSessionBlocked || loadingLabel) return
    setMcpDraft(prev => ({
      ...prev,
      type: event.target.value === 'sse' ? 'sse' : 'streamable-http',
    }))
  }

  function handleMcpDraftRemoteUrlChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (mcpDraftSessionBlocked || loadingLabel) return
    setMcpDraft(prev => ({
      ...prev,
      url: event.target.value,
    }))
  }

  function handleMcpRowClick(server: McpServerInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    editMcpServer(server, scope)
  }

  function handleMcpEditClick(server: McpServerInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    editMcpServer(server, scope)
  }

  function handleMcpInspectClick(server: McpServerInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    if (scope === 'project') {
      void inspectProjectMcp(server)
    } else {
      void inspectUserMcp(server)
    }
  }

  function handleMcpRemoveClick(server: McpServerInfo, scope: 'user' | 'project'): void {
    if (loadingLabel) return
    void removeMcpServer(server.name, scope)
  }

  function startNewMcpDraft(): void {
    if (loadingLabel) return
    const session = activeSession
    setMcpDraft(emptyMcpDraft())
    setSelectedMcpDetail(undefined)
    setSelectedMcpDetailScope(undefined)
    if (session) void updateSessionLayout(session.id, {
      selectedMcpName: undefined,
      selectedMcpSourcePath: undefined,
      selectedMcpScope: undefined,
    })
    setSettingsStatus({ kind: 'info', text: 'Ready to add a new MCP server.' })
  }

  async function checkMcpHealth(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session to check project MCP health.',
      })
      return
    }
    const session = activeSession
    const cwd = session.cwd
    const actionKey = `${cwd}:health-check`
    if (mcpActionPendingRef.current.has(actionKey)) return
    mcpActionPendingRef.current.add(actionKey)
    await runAction('Checking MCP', async () => {
      const result = await window.claudeDesktop.workspaceMcp.check(cwd)
      if (activeSessionIdRef.current !== session.id) return
      setMcpHealthOutput({
        ok: result.ok,
        text: result.output || result.error || '',
      })
      setSettingsStatus({
        kind: result.ok ? 'success' : 'error',
        text: result.ok ? 'MCP health check passed.' : 'MCP health check failed.',
      })
    }).finally(() => {
      mcpActionPendingRef.current.delete(actionKey)
    })
  }

  function pluginCommandCwd(
    scope = pluginDraft.scope,
    session = activeSession,
  ): string | undefined {
    if (scope === 'project' || scope === 'local') return session?.cwd
    return session?.cwd ?? desktopConfig?.claudeHome
  }

  async function runPluginAction(
    actionKey: string,
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (pluginActionPendingRef.current.has(actionKey)) return
    pluginActionPendingRef.current.add(actionKey)
    try {
      await runAction(label, action)
    } finally {
      pluginActionPendingRef.current.delete(actionKey)
    }
  }

  async function updatePlugin(plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): Promise<void> {
    const scope = plugin.scope === 'project'
      ? 'project'
      : plugin.scope === 'local'
        ? 'local'
        : 'user'
    if (!canSelectPlugin(plugin)) {
      if (scope === 'project' || scope === 'local') {
        if (!activeSession) {
          setSettingsStatus({
            kind: 'error',
            text: 'Select a session to update project or local plugins.',
          })
        }
      }
      return
    }
    const pluginId = plugin.id.trim()
    if (!pluginId) {
      setSettingsStatus({ kind: 'error', text: 'Select an installed plugin before updating it.' })
      return
    }
    const session = activeSession
    const cwd = pluginCommandCwd(scope, session)
    if (!cwd) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session to update project or local plugins.',
      })
      return
    }
    await runPluginAction(`${cwd}:${scope}:update:${pluginId}`, 'Updating plugin', async () => {
      const result = await window.claudeDesktop.plugins.update(cwd, {
        plugin: pluginId,
        scope,
      })
      if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return
      setPluginOutput({
        ok: result.ok,
        text: result.output || result.error || '',
      })
      if (result.ok) {
        await refreshDesktopConfig()
        if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return
        await selectInstalledPluginAfterRefresh(pluginId, scope, session)
      }
      const failureText =
        [result.error, result.output].filter(Boolean).join('\n') ||
        'Plugin command failed without error output.'
      setSettingsStatus({
        kind: result.ok ? 'success' : 'error',
        text: result.ok
          ? `Updated plugin ${pluginId}.`
          : `Plugin update failed: ${failureText}`,
      })
    })
  }

  async function setPluginEnabled(plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number], enabled: boolean): Promise<void> {
    const scope = plugin.scope === 'project'
      ? 'project'
      : plugin.scope === 'local'
        ? 'local'
        : 'user'
    if (!canSelectPlugin(plugin)) {
      if (scope === 'project' || scope === 'local') {
        if (!activeSession) {
          setSettingsStatus({
            kind: 'error',
            text: 'Select a session to enable or disable project or local plugins.',
          })
        }
      }
      return
    }
    const pluginId = plugin.id.trim()
    if (!pluginId) {
      setSettingsStatus({ kind: 'error', text: 'Select an installed plugin before changing its state.' })
      return
    }
    const session = activeSession
    const cwd = pluginCommandCwd(scope, session)
    if (!cwd) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session to enable or disable project or local plugins.',
      })
      return
    }
    const actionLabel = enabled ? 'Enabling plugin' : 'Disabling plugin'
    await runPluginAction(`${cwd}:${scope}:${enabled ? 'enable' : 'disable'}:${pluginId}`, actionLabel, async () => {
      const result = await window.claudeDesktop.plugins.setEnabled(cwd, {
        plugin: pluginId,
        scope,
        enabled,
      })
      if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return
      setPluginOutput({
        ok: result.ok,
        text: result.output || result.error || '',
      })
      if (result.ok) {
        await refreshDesktopConfig()
        if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return
        await selectInstalledPluginAfterRefresh(pluginId, scope, session)
      }
      const failureText =
        [result.error, result.output].filter(Boolean).join('\n') ||
        'Plugin command failed without error output.'
      setSettingsStatus({
        kind: result.ok ? 'success' : 'error',
        text: result.ok
          ? `${enabled ? 'Enabled' : 'Disabled'} plugin ${pluginId}.`
          : `Plugin ${enabled ? 'enable' : 'disable'} failed: ${failureText}`,
      })
    })
  }

  async function uninstallPlugin(plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): Promise<void> {
    const scope = plugin.scope === 'project'
      ? 'project'
      : plugin.scope === 'local'
        ? 'local'
        : 'user'
    if (!canSelectPlugin(plugin)) {
      if (scope === 'project' || scope === 'local') {
        if (!activeSession) {
          setSettingsStatus({
            kind: 'error',
            text: 'Select a session to remove project or local plugins.',
          })
        }
      }
      return
    }
    const pluginId = plugin.id.trim()
    if (!pluginId) {
      setSettingsStatus({ kind: 'error', text: 'Select an installed plugin before removing it.' })
      return
    }
    const session = activeSession
    const cwd = pluginCommandCwd(scope, session)
    if (!cwd) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session to remove project or local plugins.',
      })
      return
    }
    const confirmed = await requestConfirmation({
      title: 'Remove plugin?',
      message: `Remove ${pluginId} from ${scope} scope?`,
      confirmLabel: 'Remove plugin',
      cancelLabel: 'Keep plugin',
      tone: 'danger',
    })
    if (!confirmed) return
    const selectedIdentity = installedPluginIdentity(plugin)
    await runPluginAction(`${cwd}:${scope}:uninstall:${pluginId}`, 'Removing plugin', async () => {
      const result = await window.claudeDesktop.plugins.uninstall(cwd, {
        plugin: pluginId,
        scope,
      })
      if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return
      setPluginOutput({
        ok: result.ok,
        text: result.output || result.error || '',
      })
      if (result.ok) {
        setSelectedPluginIdentity(current =>
          current === selectedIdentity ? undefined : current,
        )
        if (session) await updateSessionLayout(session.id, { selectedPluginIdentity: undefined })
        await refreshDesktopConfig()
        if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return
      }
      const failureText =
        [result.error, result.output].filter(Boolean).join('\n') ||
        'Plugin command failed without error output.'
      setSettingsStatus({
        kind: result.ok ? 'success' : 'error',
        text: result.ok
          ? `Removed plugin ${pluginId}.`
          : `Plugin remove failed: ${failureText}`,
      })
    })
  }

  async function listAvailablePlugins(): Promise<void> {
    if (loadingLabel) return
    const scope = pluginDraft.scope as string
    if (!isPluginScope(scope)) {
      setSettingsStatus({
        kind: 'error',
        text: 'Choose a valid plugin scope before running plugin commands.',
      })
      return
    }
    const session = scope === 'project' || scope === 'local' ? activeSession : undefined
    const cwd = pluginCommandCwd(scope, session)
    if (!cwd) {
      setSettingsStatus({
        kind: 'error',
        text: 'Select a session to use project or local plugin scope.',
      })
      return
    }
    await runPluginAction(`${cwd}:${scope}:list`, 'Listing plugins', async () => {
      const result = await window.claudeDesktop.plugins.list(cwd)
      if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return
      setPluginOutput({
        ok: result.ok,
        text: result.output || result.error || '',
      })
      await refreshDesktopConfig()
      if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return
      setSettingsStatus({
        kind: result.ok ? 'success' : 'error',
        text: result.ok ? 'Listed available plugins.' : 'Plugin list failed.',
      })
    })
  }

  async function installPlugin(): Promise<void> {
    if (loadingLabel) return
    const scope = pluginDraft.scope as string
    if (!isPluginScope(scope)) {
      setSettingsStatus({
        kind: 'error',
        text: 'Choose a valid plugin scope before running plugin commands.',
      })
      return
    }
    const plugin = pluginDraft.plugin.trim()
    const session = activeSession
    const cwd = pluginCommandCwd(scope, session)
    if (!canInstallPlugin || !cwd) {
      setSettingsStatus({
        kind: 'error',
        text: pluginScopeNeedsSession
          ? 'Select a session to install project or local plugins.'
          : 'Enter a plugin package before installing.',
      })
      return
    }
    await runPluginAction(`${cwd}:${scope}:install:${plugin}`, 'Installing plugin', async () => {
      const result = await window.claudeDesktop.plugins.install(cwd, {
        plugin,
        scope,
      })
      if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return
      setPluginOutput({
        ok: result.ok,
        text: result.output || result.error || '',
      })
      if (result.ok) {
        setPluginDraft({
          plugin,
          scope,
        })
        await refreshDesktopConfig()
        if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return
        await selectInstalledPluginAfterRefresh(plugin, scope, session)
      }
      const failureText =
        [result.error, result.output].filter(Boolean).join('\n') ||
        'Plugin command failed without error output.'
      setSettingsStatus({
        kind: result.ok ? 'success' : 'error',
        text: result.ok
          ? `Installed plugin ${plugin}.`
          : `Plugin install failed: ${failureText}`,
      })
    })
  }

  async function refreshAgents(): Promise<void> {
    if (loadingLabel) return
    const session = activeSession
    const statusTarget = activePane === 'teams' ? 'teams' : 'agents'
    if (agentRefreshActionPendingRef.current) return
    if (statusTarget === 'teams' && !session) {
      setTeamsStatus({ kind: 'error', text: 'Select a session to refresh teams.' })
      return
    }
    const cwd = session?.cwd ?? ''
    agentRefreshActionPendingRef.current = true
    try {
      await runAction('Refreshing agents', async () => {
        const nextAgents = await window.claudeDesktop.agents.refresh(cwd)
        let nextTeams: TeamInfo[] | undefined
        if (session) {
          nextTeams = await window.claudeDesktop.teams.list(session.cwd)
        }
        if (session && activeSessionIdRef.current !== session.id) return
        setAgentList(nextAgents)
        if (session) {
          await clearStaleSelectedAgentSelection(nextAgents, session)
        }
        if (session) {
          setTeams(nextTeams ?? [])
          await clearStaleSelectedTeamSelection(nextTeams ?? [], session)
        }
        if (statusTarget === 'teams') {
          setTeamsStatus({ kind: 'success', text: 'Refreshed teams.' })
        } else {
          setAgentsStatus({ kind: 'success', text: session ? 'Refreshed agents and teams.' : 'Refreshed user agents.' })
        }
      })
    } finally {
      agentRefreshActionPendingRef.current = false
    }
  }

  function handleAgentsRefreshClick(): void {
    if (loadingLabel) return
    void refreshAgents()
  }

  function handleTeamsSectionClick(): void {
    if (loadingLabel) return
    openPaneSection('teams', 'agents-teams', 'teams')
  }

  function handleAgentsOverviewSectionClick(): void {
    if (loadingLabel) return
    openPaneSection('agents', 'agents-sources', 'agents')
  }

  function handleAgentsCatalogSectionClick(): void {
    if (loadingLabel) return
    openPaneSection('agents', 'agents-catalog', 'agents')
  }

  function handleAgentsLaunchSectionClick(): void {
    if (loadingLabel) return
    openPaneSection('agents', 'agents-launch', 'agents')
  }

  function handleAgentsEditorSectionClick(): void {
    if (loadingLabel) return
    openPaneSection('agents', 'agents-editor', 'agents')
  }

  function handleAgentsTasksSectionClick(): void {
    if (loadingLabel) return
    openPaneSection('agents', 'agents-tasks', 'agents')
  }

  function handleAgentLaunchAgentTypeChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (agentLaunchDraftSessionBlocked || loadingLabel) return
    setAgentLaunchDraft(prev => ({
      ...prev,
      agentType: event.target.value,
    }))
  }

  function handleAgentLaunchModelChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (agentLaunchDraftSessionBlocked || loadingLabel) return
    setAgentLaunchDraft(prev => ({
      ...prev,
      model: event.target.value,
    }))
  }

  function handleAgentLaunchPermissionModeChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (agentLaunchDraftSessionBlocked || loadingLabel) return
    setAgentLaunchDraft(prev => ({
      ...prev,
      permissionMode: event.target.value,
    }))
  }

  function handleAgentLaunchDescriptionChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (agentLaunchDraftSessionBlocked || loadingLabel) return
    setAgentLaunchDraft(prev => ({
      ...prev,
      description: event.target.value,
    }))
  }

  function handleAgentLaunchIsolationChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (agentLaunchDraftSessionBlocked || loadingLabel) return
    setAgentLaunchDraft(prev => ({
      ...prev,
      isolation: event.target.value === 'worktree' || event.target.value === 'remote'
        ? event.target.value
        : '',
    }))
  }

  function handleAgentLaunchPromptChange(event: ReactChangeEvent<HTMLTextAreaElement>): void {
    if (agentLaunchDraftSessionBlocked || loadingLabel) return
    setAgentLaunchDraft(prev => ({
      ...prev,
      prompt: event.target.value,
    }))
  }

  function handleAgentLaunchNameChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (agentLaunchDraftSessionBlocked || loadingLabel) return
    setAgentLaunchDraft(prev => ({
      ...prev,
      name: event.target.value,
    }))
  }

  function handleAgentLaunchTeamNameChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (agentLaunchDraftSessionBlocked || loadingLabel) return
    setAgentLaunchDraft(prev => ({
      ...prev,
      teamName: event.target.value,
    }))
  }

  function handleAgentLaunchModeChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (agentLaunchDraftSessionBlocked || loadingLabel) return
    setAgentLaunchDraft(prev => ({
      ...prev,
      mode: event.target.value,
    }))
  }

  function handleAgentLaunchRunInBackgroundChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (agentLaunchDraftSessionBlocked || loadingLabel) return
    setAgentLaunchDraft(prev => ({
      ...prev,
      runInBackground: event.target.checked,
    }))
  }

  function handleAgentEditorTypeChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      agentType: event.target.value,
    }))
  }

  function handleAgentEditorSourceChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      source: event.target.value === 'user' ? 'user' : 'project',
    }))
  }

  function handleAgentEditorWhenToUseChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      whenToUse: event.target.value,
    }))
  }

  function handleAgentEditorModelChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      model: event.target.value,
    }))
  }

  function handleAgentEditorPermissionModeChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      permissionMode: event.target.value,
    }))
  }

  function handleAgentEditorToolsChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      tools: event.target.value,
    }))
  }

  function handleAgentEditorDisallowedToolsChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      disallowedTools: event.target.value,
    }))
  }

  function handleAgentEditorSkillsChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      skills: event.target.value,
    }))
  }

  function handleAgentEditorMemoryChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      memory: event.target.value,
    }))
  }

  function handleAgentEditorRequiredMcpServersChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      requiredMcpServers: event.target.value,
    }))
  }

  function handleAgentEditorIsolationChange(event: ReactChangeEvent<HTMLSelectElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      isolation: event.target.value === 'worktree' || event.target.value === 'remote'
        ? event.target.value
        : '',
    }))
  }

  function handleAgentEditorPromptChange(event: ReactChangeEvent<HTMLTextAreaElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      prompt: event.target.value,
    }))
  }

  function handleAgentEditorBackgroundChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setAgentDraft(prev => ({
      ...prev,
      background: event.target.checked,
    }))
  }

  async function selectAgent(agent: AgentInfo): Promise<void> {
    if (loadingLabel) return
    const agentType = agent.agentType.trim()
    if (!agentType) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent before selecting.' })
      return
    }
    const session = activeSession
    setSelectedAgentType(agentType)
    setSelectedAgentSource(agent.source)
    if (session) await updateSessionLayout(session.id, {
      selectedAgentType: agentType,
      selectedAgentSource: agent.source,
    })
    setAgentDiagnostics(undefined)
    setAgentLaunchDraft(prev => ({
      ...prev,
      agentType,
      description: prev.description || agent.whenToUse.slice(0, 80),
      isolation: allowedIsolation(agent.isolation, canUseRemoteIsolation),
    }))
    if (agent.editable) {
      setAgentDraft(agentDraftFromAgent({ ...agent, agentType }, canUseRemoteIsolation))
    } else {
      setAgentDraft(emptyAgentDraft())
    }
    setAgentsStatus({ kind: 'info', text: `Selected agent ${agentType}.` })
  }

  async function diagnoseSelectedAgent(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setAgentsStatus({ kind: 'error', text: 'Select a session before diagnosing agents.' })
      return
    }
    if (!selectedAgentType) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent before diagnosing.' })
      return
    }
    await diagnoseAgentByType(selectedAgentType)
  }

  function handleAgentDiagnosticsMcpSettingsClick(): void {
    if (loadingLabel) return
    setMcpDraft(prev => ({
      ...prev,
      scope: 'project',
      name: agentDiagnostics?.missingMcpServers[0] ?? prev.name,
    }))
    void openPaneSection('mcp', 'mcp-servers', 'mcp')
  }

  function handleAgentDiagnosticsSkillsSettingsClick(): void {
    if (loadingLabel) return
    void openPaneSection('skills', 'skills-installed', 'skills')
  }

  function prepareSelectedAgentRun(): void {
    if (loadingLabel) return
    if (!activeSession) {
      setAgentsStatus({ kind: 'error', text: 'Select a session before running agents.' })
      return
    }
    if (!selectedAgent) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent before preparing a run.' })
      return
    }
    if (!selectedAgent.agentType.trim()) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent before preparing a run.' })
      return
    }
    setAgentLaunchDraft(prev => ({
      ...prev,
      agentType: selectedAgent.agentType,
      description: prev.description || selectedAgent.whenToUse.slice(0, 80),
      isolation: allowedIsolation(selectedAgent.isolation, canUseRemoteIsolation),
    }))
    setAgentsStatus({ kind: 'info', text: `Ready to run ${selectedAgent.agentType}.` })
    void openPaneSection('agents', 'agents-launch', 'agents', { showStatus: false })
  }

  function prepareSelectedAgentEdit(): void {
    if (loadingLabel) return
    if (!selectedAgent) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent before editing.' })
      return
    }
    if (!selectedAgent.agentType.trim()) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent before editing.' })
      return
    }
    if (!canEditSelectedAgent) {
      setAgentsStatus({ kind: 'error', text: 'Select a project session before editing this agent.' })
      return
    }
    setAgentDraft(agentDraftFromAgent(selectedAgent, canUseRemoteIsolation))
    setAgentsStatus({
      kind: 'info',
      text: selectedAgent.editable
        ? `Loaded ${selectedAgent.agentType} for editing.`
        : `Prepared project override for ${selectedAgent.agentType}.`,
    })
    void openPaneSection('agents', 'agents-editor', 'agents', { showStatus: false })
  }

  async function diagnoseAgentByType(agentType: string): Promise<void> {
    if (!activeSession) {
      setAgentsStatus({ kind: 'error', text: 'Select a session before diagnosing agents.' })
      return
    }
    if (!agentType.trim()) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent before diagnosing.' })
      return
    }
    const session = activeSession
    const actionKey = `${session.id}:${agentType}:diagnose`
    if (agentDiagnosticActionPendingRef.current.has(actionKey)) return
    agentDiagnosticActionPendingRef.current.add(actionKey)
    try {
      await runAction('Diagnosing agent', async () => {
        const diagnostics = await window.claudeDesktop.agents.diagnose(
          session.cwd,
          agentType,
        )
        if (activeSessionIdRef.current !== session.id) return
        setAgentDiagnostics(diagnostics)
        setAgentsStatus({
          kind: diagnostics.ok ? 'success' : 'info',
          text: diagnostics.ok
            ? `Agent ${agentType} is ready.`
            : `Agent ${agentType} needs setup.`,
        })
      })
    } finally {
      agentDiagnosticActionPendingRef.current.delete(actionKey)
    }
  }

  async function saveAgentDraft(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession && agentDraft.source === 'project') {
      setAgentsStatus({ kind: 'error', text: 'Select a session before managing project agents.' })
      return
    }
    const agentType = agentDraft.agentType.trim()
    if (!agentType) {
      setAgentsStatus({ kind: 'error', text: 'Choose an agent type before saving.' })
      return
    }
    if (!agentDraft.whenToUse.trim()) {
      setAgentsStatus({ kind: 'error', text: 'Enter when-to-use guidance before saving this agent.' })
      return
    }
    if (!agentDraft.prompt.trim()) {
      setAgentsStatus({ kind: 'error', text: 'Enter an agent system prompt before saving.' })
      return
    }
    const session = activeSession
    const cwd = session?.cwd ?? ''
    const actionKey = `${session?.id ?? 'user'}:${agentDraft.source}:${agentType}:save`
    await runAgentEditorAction(actionKey, 'Saving agent', async () => {
      const saved = await window.claudeDesktop.agents.save(
        cwd,
        agentInputFromDraft(agentDraft, canUseRemoteIsolation),
      )
      if (session && activeSessionIdRef.current !== session.id) return
      setSelectedAgentType(saved.agentType)
      setSelectedAgentSource(saved.source)
      if (session) await updateSessionLayout(session.id, {
        selectedAgentType: saved.agentType,
        selectedAgentSource: saved.source,
      })
      setAgentDraft(agentDraftFromAgent(saved, canUseRemoteIsolation))
      const nextAgents = await window.claudeDesktop.agents.refresh(cwd)
      if (session && activeSessionIdRef.current !== session.id) return
      setAgentList({
        ...nextAgents,
        allAgents: [
          saved,
          ...nextAgents.allAgents.filter(agent =>
            agent.agentType !== saved.agentType || agent.source !== saved.source,
          ),
        ],
      })
      setAgentsStatus({ kind: 'success', text: `Saved agent ${saved.agentType}.` })
    })
  }

  function startNewAgentDraft(): void {
    if (loadingLabel) return
    const session = activeSession
    setAgentDraft(emptyAgentDraft())
    setSelectedAgentType(undefined)
    setSelectedAgentSource(undefined)
    setChatTarget(prev =>
      prev.type === 'agent'
        ? { type: 'session', teamName: '', agentType: '' }
        : prev
    )
    if (session) void updateSessionLayout(session.id, {
      selectedAgentType: undefined,
      selectedAgentSource: undefined,
    })
    setAgentsStatus({ kind: 'info', text: 'Ready to create a new agent.' })
  }

  async function deleteSelectedAgent(agent: Pick<AgentInfo, 'agentType' | 'source'> = agentDraft): Promise<void> {
    if (loadingLabel) return
    if (!activeSession && agent.source === 'project') {
      setAgentsStatus({ kind: 'error', text: 'Select a session before managing project agents.' })
      return
    }
    if (!agentDraft.agentType) {
      if (!agent.agentType) {
        setAgentsStatus({ kind: 'error', text: 'Select an agent before deleting.' })
        return
      }
    }
    if (!agent.agentType.trim()) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent before deleting.' })
      return
    }
    const session = activeSession
    const cwd = session?.cwd ?? ''
    const deletedAgentType = agent.agentType
    const deletedAgentSource = agent.source
    const actionKey = `${session?.id ?? 'user'}:${deletedAgentSource}:${deletedAgentType.trim()}:delete`
    if (agentEditorActionPendingRef.current.has(actionKey)) return
    agentEditorActionPendingRef.current.add(actionKey)
    try {
      if (!(await requestConfirmation({
        title: 'Delete agent?',
        message: `Delete ${deletedAgentSource} agent "${deletedAgentType}" from this workspace configuration.`,
        confirmLabel: 'Delete agent',
        cancelLabel: 'Cancel',
        tone: 'danger',
      }))) return
      agentEditorActionPendingRef.current.delete(actionKey)
      await runAgentEditorAction(actionKey, 'Deleting agent', async () => {
        await window.claudeDesktop.agents.delete(
          cwd,
          deletedAgentType,
          deletedAgentSource,
        )
        if (session && activeSessionIdRef.current !== session.id) return
        setAgentDraft(emptyAgentDraft())
        const nextAgents = await window.claudeDesktop.agents.refresh(cwd)
        if (session && activeSessionIdRef.current !== session.id) return
        setAgentList(nextAgents)
        const fallbackAgent =
          nextAgents.allAgents.find(agent =>
            agent.agentType === deletedAgentType &&
            agent.source !== deletedAgentSource
          ) ??
          nextAgents.activeAgents.find(agent =>
            agent.agentType === deletedAgentType &&
            agent.source !== deletedAgentSource
          )
        setChatTarget(prev =>
          prev.type === 'agent' && prev.agentType.trim() === deletedAgentType
            ? fallbackAgent
              ? { ...prev, agentType: fallbackAgent.agentType }
              : { type: 'session', teamName: '', agentType: '' }
            : prev
        )
        if (fallbackAgent) {
          setSelectedAgentType(fallbackAgent.agentType)
          setSelectedAgentSource(fallbackAgent.source)
          if (session) await updateSessionLayout(session.id, {
            selectedAgentType: fallbackAgent.agentType,
            selectedAgentSource: fallbackAgent.source,
          })
        } else {
          setSelectedAgentType(undefined)
          setSelectedAgentSource(undefined)
          if (session) await updateSessionLayout(session.id, {
            selectedAgentType: undefined,
            selectedAgentSource: undefined,
          })
        }
        setAgentsStatus({ kind: 'success', text: `Deleted agent ${deletedAgentType}.` })
      })
    } finally {
      agentEditorActionPendingRef.current.delete(actionKey)
    }
  }

  function handleAgentEditorSaveClick(): void {
    if (loadingLabel) return
    void saveAgentDraft()
  }

  function handleAgentEditorNewClick(): void {
    if (loadingLabel) return
    startNewAgentDraft()
  }

  function handleAgentEditorDeleteClick(): void {
    if (loadingLabel) return
    void deleteSelectedAgent()
  }

  async function runAgentEditorAction(
    actionKey: string,
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (agentEditorActionPendingRef.current.has(actionKey)) return
    agentEditorActionPendingRef.current.add(actionKey)
    try {
      await runAction(label, action)
    } finally {
      agentEditorActionPendingRef.current.delete(actionKey)
    }
  }

  async function runAgentLaunchAction(
    actionKey: string,
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (agentLaunchActionPendingRef.current.has(actionKey)) return
    agentLaunchActionPendingRef.current.add(actionKey)
    try {
      await runAction(label, action)
    } finally {
      agentLaunchActionPendingRef.current.delete(actionKey)
    }
  }

  async function createAgentSession(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setAgentsStatus({ kind: 'error', text: 'Select a session before creating agent sessions.' })
      return
    }
    if (!agentLaunchDraft.agentType.trim()) {
      setAgentsStatus({ kind: 'error', text: 'Choose an agent type before creating an agent session.' })
      return
    }
    const session = activeSession
    const sessionId = session.id
    const cwd = session.cwd
    const agent = {
      agentType: agentLaunchDraft.agentType.trim(),
      model: agentLaunchDraft.model.trim() || undefined,
      permissionMode: agentLaunchDraft.permissionMode.trim() || undefined,
      isolation: allowedIsolation(
        agentLaunchDraft.isolation,
        canUseRemoteIsolation,
      ) || undefined,
    }
    await runAgentLaunchAction(`${sessionId}:${agent.agentType}:create-session`, 'Creating agent session', async () => {
      const createdSession = await window.claudeDesktop.sessions.create({
        cwd,
        agent,
      })
      if (createdSession) {
        if (activeSessionIdRef.current !== session.id) return
        mergeSession(createdSession)
        setActiveSessionId(createdSession.id)
        setAgentsStatus({ kind: 'success', text: `Created agent session for ${agent.agentType}.` })
      }
    })
  }

  async function createSelectedAgentSession(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setAgentsStatus({ kind: 'error', text: 'Select a session before creating agent sessions.' })
      return
    }
    if (!selectedAgent) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent before creating an agent session.' })
      return
    }
    if (!selectedAgent.agentType.trim()) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent before creating an agent session.' })
      return
    }
    const session = activeSession
    const sessionId = session.id
    const cwd = session.cwd
    const agent = {
      agentType: selectedAgent.agentType,
      model: selectedAgent.model || undefined,
      permissionMode: selectedAgent.permissionMode || undefined,
      isolation: allowedIsolation(
        selectedAgent.isolation,
        canUseRemoteIsolation,
      ) || undefined,
    }
    await runAgentLaunchAction(`${sessionId}:${agent.agentType}:selected-create-session`, 'Creating agent session', async () => {
      const createdSession = await window.claudeDesktop.sessions.create({
        cwd,
        agent,
      })
      if (createdSession) {
        if (activeSessionIdRef.current !== session.id) return
        mergeSession(createdSession)
        setActiveSessionId(createdSession.id)
        setAgentsStatus({ kind: 'success', text: `Created agent session for ${agent.agentType}.` })
      }
    })
  }

  function handleSelectedAgentDiagnoseClick(): void {
    if (loadingLabel) return
    void diagnoseSelectedAgent()
  }

  function handleSelectedAgentNewSessionClick(): void {
    if (loadingLabel) return
    void createSelectedAgentSession()
  }

  function handleSelectedAgentPrepareRunClick(): void {
    if (loadingLabel) return
    prepareSelectedAgentRun()
  }

  function handleSelectedAgentPrepareEditClick(): void {
    if (loadingLabel) return
    prepareSelectedAgentEdit()
  }

  function handleSelectedAgentDeleteClick(): void {
    if (loadingLabel || !selectedAgent) return
    void deleteSelectedAgent(selectedAgent)
  }

  function handleAgentLaunchCreateSessionClick(): void {
    if (loadingLabel) return
    void createAgentSession()
  }

  async function launchAgentTask(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setAgentsStatus({
        kind: 'error',
        text: 'Select a session before launching agent tasks.',
      })
      return
    }
    if (turnBusy) {
      setAgentsStatus({
        kind: 'info',
        text: 'Wait for the current Claude turn to finish before launching an agent task.',
      })
      return
    }
    if (!canLaunchAgentTask) {
      setAgentsStatus({
        kind: 'error',
        text: !agentLaunchDraft.agentType.trim()
          ? 'Choose an agent type before launching a task.'
          : 'Enter a task description and prompt before launching.',
      })
      return
    }
    const session = activeSession
    const sessionId = session.id
    const input = agentLaunchInputFromDraft(agentLaunchDraft, canUseRemoteIsolation)
    await runAgentLaunchAction(`${sessionId}:${input.agentType ?? 'fork'}:${input.description}:launch-task`, 'Launching agent task', async () => {
      await window.claudeDesktop.sessions.launchAgentTask(
        sessionId,
        input,
      )
      if (activeSessionIdRef.current !== session.id) return
      setAgentsStatus({ kind: 'success', text: `Launched agent task "${input.description}".` })
      setAgentLaunchDraft(emptyAgentLaunchDraft())
    })
  }

  function handleAgentLaunchTaskClick(): void {
    if (loadingLabel) return
    void launchAgentTask()
  }

  async function runAgentTaskAction(
    actionKey: string,
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (agentTaskActionPendingRef.current.has(actionKey)) return
    agentTaskActionPendingRef.current.add(actionKey)
    try {
      await runAction(label, action)
    } finally {
      agentTaskActionPendingRef.current.delete(actionKey)
    }
  }

  async function readAgentTaskOutput(taskId: string): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setAgentsStatus({ kind: 'error', text: 'Select a session before managing agent tasks.' })
      return
    }
    const selectedAgentTaskId = taskId.trim()
    if (!selectedAgentTaskId) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent task before reading output.' })
      return
    }
    const session = activeSession
    if (turnBusy) {
      setAgentsStatus({
        kind: 'info',
        text: 'Wait for the current Claude turn to finish before reading agent output.',
      })
      return
    }
    const sessionId = session.id
    await runAgentTaskAction(`${sessionId}:${selectedAgentTaskId}:read`, 'Reading agent task output', async () => {
      await window.claudeDesktop.sessions.readAgentTaskOutput(sessionId, {
        taskId: selectedAgentTaskId,
        block: false,
        timeoutMs: 0,
      })
      if (activeSessionIdRef.current !== session.id) return
      await updateSessionLayout(session.id, { selectedAgentTaskId })
      setAgentsStatus({ kind: 'success', text: `Requested output for task ${selectedAgentTaskId}.` })
    })
  }

  async function previewAgentTaskOutput(taskId: string): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setAgentsStatus({ kind: 'error', text: 'Select a session before managing agent tasks.' })
      return
    }
    const selectedAgentTaskId = taskId.trim()
    if (!selectedAgentTaskId) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent task before previewing output.' })
      return
    }
    const session = activeSession
    const sessionId = session.id
    await runAgentTaskAction(`${sessionId}:${selectedAgentTaskId}:preview`, 'Previewing agent output file', async () => {
      const result = await window.claudeDesktop.sessions.previewAgentTaskOutput(
        sessionId,
        { taskId: selectedAgentTaskId },
      )
      if (activeSessionIdRef.current !== session.id) return
      await updateSessionLayout(session.id, { selectedAgentTaskId })
      setSessions(prev => prev.map(session => {
        if (session.id !== sessionId) return session
        return {
          ...session,
          agentTasks: (session.agentTasks ?? []).map(task =>
            task.id.trim() === selectedAgentTaskId
              ? {
                  ...task,
                  outputPreview: result.truncated
                    ? `[truncated to last ${result.bytesRead.toLocaleString()} bytes]\n${result.contents}`
                    : result.contents,
                }
              : task,
          ),
        }
      }))
      setAgentsStatus({ kind: 'success', text: `Previewed output for task ${selectedAgentTaskId}.` })
    })
  }

  function handleAgentTaskReadOutputClick(taskId: string): void {
    if (loadingLabel) return
    void readAgentTaskOutput(taskId)
  }

  function handleAgentTaskPreviewOutputClick(taskId: string): void {
    if (loadingLabel) return
    void previewAgentTaskOutput(taskId)
  }

  async function stopAgentTask(taskId: string): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setAgentsStatus({ kind: 'error', text: 'Select a session before managing agent tasks.' })
      return
    }
    const selectedAgentTaskId = taskId.trim()
    if (!selectedAgentTaskId) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent task before stopping.' })
      return
    }
    const session = activeSession
    if (turnBusy) {
      setAgentsStatus({
        kind: 'info',
        text: 'Wait for the current Claude turn to finish before stopping an agent task.',
      })
      return
    }
    const sessionId = session.id
    await runAgentTaskAction(`${sessionId}:${selectedAgentTaskId}:stop`, 'Stopping agent task', async () => {
      await window.claudeDesktop.sessions.stopAgentTask(sessionId, { taskId: selectedAgentTaskId })
      if (activeSessionIdRef.current !== session.id) return
      await updateSessionLayout(session.id, { selectedAgentTaskId })
      setAgentsStatus({ kind: 'success', text: `Stopped agent task ${selectedAgentTaskId}.` })
    })
  }

  async function resumeAgentTask(taskId: string): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setAgentsStatus({ kind: 'error', text: 'Select a session before managing agent tasks.' })
      return
    }
    const selectedAgentTaskId = taskId.trim()
    if (!selectedAgentTaskId) {
      setAgentsStatus({ kind: 'error', text: 'Select an agent task before resuming.' })
      return
    }
    if (!agentTaskPrompt.trim()) {
      setAgentsStatus({ kind: 'error', text: 'Enter a follow-up prompt before resuming an agent task.' })
      return
    }
    const session = activeSession
    if (turnBusy) {
      setAgentsStatus({
        kind: 'info',
        text: 'Wait for the current Claude turn to finish before resuming an agent task.',
      })
      return
    }
    const sessionId = session.id
    await runAgentTaskAction(`${sessionId}:${selectedAgentTaskId}:resume`, 'Resuming agent task', async () => {
      await window.claudeDesktop.sessions.resumeAgentTask(sessionId, {
        taskId: selectedAgentTaskId,
        prompt: agentTaskPrompt.trim(),
      })
      if (activeSessionIdRef.current !== session.id) return
      await updateSessionLayout(session.id, { selectedAgentTaskId })
      setAgentTaskPrompt('')
      setAgentsStatus({ kind: 'success', text: `Resumed agent task ${selectedAgentTaskId}.` })
    })
  }

  function handleAgentTaskStopClick(taskId: string): void {
    if (loadingLabel) return
    void stopAgentTask(taskId)
  }

  function handleAgentTaskResumeClick(taskId: string): void {
    if (loadingLabel) return
    void resumeAgentTask(taskId)
  }

  function handleAgentTaskPromptChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (agentTaskPromptSessionBlocked || loadingLabel) return
    setAgentTaskPrompt(event.target.value)
  }

  async function runTeamAction(
    actionKey: string,
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (teamActionPendingRef.current.has(actionKey)) return
    teamActionPendingRef.current.add(actionKey)
    try {
      await runAction(label, action)
    } finally {
      teamActionPendingRef.current.delete(actionKey)
    }
  }

  async function createTeam(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    if (!teamDraft.teamName.trim()) {
      setTeamsStatus({ kind: 'error', text: 'Enter a team name before creating a team.' })
      return
    }
    const session = activeSession
    const sessionId = session.id
    const cwd = session.cwd
    const input = teamCreateInputFromDraft(teamDraft)
    await runTeamAction(`${sessionId}:${input.teamName}:create`, 'Creating team', async () => {
      await window.claudeDesktop.teams.create(
        sessionId,
        input,
      )
      if (activeSessionIdRef.current !== session.id) return
      const nextTeams = await window.claudeDesktop.teams.list(cwd)
      if (activeSessionIdRef.current !== session.id) return
      setTeams(nextTeams)
      setTeamDraft(prev => ({
        ...prev,
        teamName: input.teamName,
        description: input.description ?? prev.description,
        agentType: input.agentType ?? prev.agentType,
        to: '*',
      }))
      setChatTarget({
        type: 'team',
        teamName: input.teamName,
        agentType: '',
      })
      await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: '*' })
      setTeamsStatus({ kind: 'success', text: `Created team ${input.teamName}.` })
    })
  }

  async function sendTeamMessage(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    if (!teamDraft.teamName.trim() || !teamDraft.to.trim() || !teamDraft.message.trim()) {
      setTeamsStatus({ kind: 'error', text: 'Choose a team, recipient, and message before sending.' })
      return
    }
    const session = activeSession
    if (turnBusy) {
      setTeamsStatus({
        kind: 'info',
        text: 'Wait for the current Claude turn to finish before sending a team message.',
      })
      return
    }
    const sessionId = session.id
    const input = teamMessageInputFromDraft(teamDraft)
    await runTeamAction(`${sessionId}:${input.teamName}:${input.to}:send`, 'Sending team message', async () => {
      await window.claudeDesktop.teams.send(
        sessionId,
        input,
      )
      if (activeSessionIdRef.current !== session.id) return
      setTeamDraft(prev => ({
        ...prev,
        teamName: input.teamName,
        to: input.to,
        message: '',
      }))
      setChatTarget({
        type: 'team',
        teamName: input.teamName,
        agentType: '',
      })
      await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.to })
      setTeamsStatus({ kind: 'success', text: `Sent team message to ${input.to}.` })
    })
  }

  async function spawnTeamTeammate(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    if (!teamDraft.teamName.trim() || !teamDraft.teammateName.trim() || !teamDraft.teammatePrompt.trim()) {
      setTeamsStatus({ kind: 'error', text: 'Choose a team, teammate name, and prompt before spawning.' })
      return
    }
    const session = activeSession
    if (turnBusy) {
      setTeamsStatus({
        kind: 'info',
        text: 'Wait for the current Claude turn to finish before spawning a teammate.',
      })
      return
    }
    const sessionId = session.id
    const cwd = session.cwd
    const input = teamTeammateLaunchInputFromDraft(teamDraft)
    await runTeamAction(`${sessionId}:${input.teamName}:${input.name}:spawn`, 'Spawning teammate', async () => {
      await window.claudeDesktop.sessions.launchAgentTask(
        sessionId,
        input,
      )
      if (activeSessionIdRef.current !== session.id) return
      const nextTeams = await window.claudeDesktop.teams.list(cwd)
      if (activeSessionIdRef.current !== session.id) return
      setTeams(nextTeams)
      setTeamDraft(prev => ({
        ...prev,
        teamName: input.teamName,
        to: input.name,
        teammateName: '',
        teammatePrompt: '',
      }))
      setChatTarget({
        type: 'team',
        teamName: input.teamName,
        agentType: '',
      })
      await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.name })
      setTeamsStatus({ kind: 'success', text: `Spawned teammate ${input.name}.` })
    })
  }

  async function requestTeamShutdown(inputOverride?: TeamShutdownInput): Promise<void> {
    if (loadingLabel) return
    const rawInput = inputOverride ?? teamShutdownInputFromDraft(teamDraft)
    const input: TeamShutdownInput = {
      teamName: rawInput.teamName.trim(),
      to: rawInput.to.trim(),
      reason: rawInput.reason?.trim() || undefined,
    }
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    if (!input.teamName || !input.to) {
      setTeamsStatus({ kind: 'error', text: 'Choose a team and teammate before requesting shutdown.' })
      return
    }
    const session = activeSession
    if (turnBusy) {
      setTeamsStatus({
        kind: 'info',
        text: 'Wait for the current Claude turn to finish before requesting teammate shutdown.',
      })
      return
    }
    const sessionId = session.id
    await runTeamAction(`${sessionId}:${input.teamName}:${input.to}:shutdown`, 'Requesting teammate shutdown', async () => {
      await window.claudeDesktop.teams.shutdown(
        sessionId,
        input,
      )
      if (activeSessionIdRef.current !== session.id) return
      setTeamDraft(prev => ({
        ...prev,
        teamName: input.teamName,
        to: input.to,
        shutdownReason: '',
      }))
      setChatTarget({
        type: 'team',
        teamName: input.teamName,
        agentType: '',
      })
      await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.to })
      setTeamsStatus({ kind: 'success', text: `Requested shutdown for ${input.to}.` })
    })
  }

  async function requestTeamMemberShutdown(team: TeamInfo, member: TeamMemberInfo): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    const teamName = team.name.trim()
    const memberName = member.name.trim()
    if (!teamName || !memberName) {
      setTeamsStatus({ kind: 'error', text: 'Choose a team and teammate before requesting shutdown.' })
      return
    }
    return requestTeamShutdown({
      teamName,
      to: memberName,
      reason: teamDraft.shutdownReason.trim() || undefined,
    })
  }

  async function removeTeamMember(team: TeamInfo, member: TeamMemberInfo): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    const teamName = team.name.trim()
    const memberName = member.name.trim()
    if (!teamName || !memberName) {
      setTeamsStatus({ kind: 'error', text: 'Choose a team and teammate before removing.' })
      return
    }
    const session = activeSession
    const sessionId = session.id
    const cwd = session.cwd
    const actionKey = `${sessionId}:${teamName}:${memberName}:remove-member`
    if (teamActionPendingRef.current.has(actionKey)) return
    teamActionPendingRef.current.add(actionKey)
    try {
      if (!(await requestConfirmation({
        title: 'Remove teammate?',
        message: `Remove ${memberName} from local team ${teamName}. This does not stop a running agent; use Shutdown for that.`,
        confirmLabel: 'Remove teammate',
        cancelLabel: 'Cancel',
        tone: 'danger',
      }))) return
      teamActionPendingRef.current.delete(actionKey)
      await runTeamAction(actionKey, 'Removing teammate', async () => {
        await window.claudeDesktop.teams.removeMember(sessionId, {
          teamName,
          memberName,
        })
        if (activeSessionIdRef.current !== session.id) return
        const nextTeams = await window.claudeDesktop.teams.list(cwd)
        if (activeSessionIdRef.current !== session.id) return
        setTeams(nextTeams)
        setTeamDraft(prev => ({
          ...prev,
          teamName,
          to: prev.to.trim() === memberName ? '' : prev.to,
        }))
        const nextSelectedTeamRecipient =
          session.layout.selectedTeamRecipient?.trim() === memberName
            ? undefined
            : session.layout.selectedTeamRecipient
        setChatTarget({
          type: 'team',
          teamName,
          agentType: '',
        })
        await updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: nextSelectedTeamRecipient })
        setTeamsStatus({ kind: 'success', text: `Removed teammate ${memberName} from team ${teamName}.` })
      })
    } finally {
      teamActionPendingRef.current.delete(actionKey)
    }
  }

  function selectTeam(team: TeamInfo): void {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    const session = activeSession
    const teamName = team.name.trim()
    if (!teamName) {
      setTeamsStatus({ kind: 'error', text: 'Select a team before editing.' })
      return
    }
    setTeamDraft(prev => ({
      ...prev,
      teamName,
      description: team.description ?? prev.description,
      to: prev.to || '*',
    }))
    void updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: '*' })
    setChatTarget({
      type: 'team',
      teamName,
      agentType: '',
    })
    setTeamsStatus({ kind: 'info', text: `Selected team ${teamName}.` })
  }

  function selectTeamMember(team: TeamInfo, member: TeamMemberInfo): void {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    const session = activeSession
    const teamName = team.name.trim()
    const memberName = member.name.trim()
    if (!teamName || !memberName) {
      setTeamsStatus({ kind: 'error', text: 'Choose a team and teammate before selecting a recipient.' })
      return
    }
    setTeamDraft(prev => ({
      ...prev,
      teamName,
      to: memberName,
    }))
    void updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: memberName })
    setTeamsStatus({ kind: 'info', text: `Selected ${memberName} in team ${teamName}.` })
  }

  function prepareTeamMemberMessage(team: TeamInfo, member: TeamMemberInfo): void {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    const session = activeSession
    const teamName = team.name.trim()
    const memberName = member.name.trim()
    if (!teamName || !memberName) {
      setTeamsStatus({ kind: 'error', text: 'Choose a team and teammate before preparing a message.' })
      return
    }
    setTeamDraft(prev => ({
      ...prev,
      teamName,
      to: memberName,
    }))
    setChatTarget({
      type: 'team',
      teamName,
      agentType: '',
    })
    void updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: memberName })
    setTeamsStatus({ kind: 'info', text: `Ready to message ${memberName} in team ${teamName}.` })
    window.requestAnimationFrame(() => {
      teamMessageTextareaRef.current?.focus()
    })
  }

  function prepareTeamBroadcastMessage(team: TeamInfo): void {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    const session = activeSession
    const teamName = team.name.trim()
    if (!teamName) {
      setTeamsStatus({ kind: 'error', text: 'Select a team before preparing a broadcast.' })
      return
    }
    setTeamDraft(prev => ({
      ...prev,
      teamName,
      to: '*',
    }))
    setChatTarget({
      type: 'team',
      teamName,
      agentType: '',
    })
    void updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: '*' })
    setTeamsStatus({ kind: 'info', text: `Ready to message all teammates in team ${teamName}.` })
    window.requestAnimationFrame(() => {
      teamMessageTextareaRef.current?.focus()
    })
  }

  function handleTeamDraftTeamNameChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (teamDraftSessionBlocked || loadingLabel) return
    setTeamDraft(prev => ({
      ...prev,
      teamName: event.target.value,
    }))
  }

  function handleTeamDraftAgentTypeChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (teamDraftSessionBlocked || loadingLabel) return
    setTeamDraft(prev => ({
      ...prev,
      agentType: event.target.value,
    }))
  }

  function handleTeamDraftDescriptionChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (teamDraftSessionBlocked || loadingLabel) return
    setTeamDraft(prev => ({
      ...prev,
      description: event.target.value,
    }))
  }

  function handleTeamDraftTeammateAgentTypeChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (teamDraftSessionBlocked || loadingLabel) return
    setTeamDraft(prev => ({
      ...prev,
      teammateAgentType: event.target.value,
    }))
  }

  function handleTeamDraftTeammateNameChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (teamDraftSessionBlocked || loadingLabel) return
    setTeamDraft(prev => ({
      ...prev,
      teammateName: event.target.value,
    }))
  }

  function handleTeamDraftTeammateModeChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (teamDraftSessionBlocked || loadingLabel) return
    setTeamDraft(prev => ({
      ...prev,
      teammateMode: event.target.value,
    }))
  }

  function handleTeamDraftTeammatePromptChange(event: ReactChangeEvent<HTMLTextAreaElement>): void {
    if (teamDraftSessionBlocked || loadingLabel) return
    setTeamDraft(prev => ({
      ...prev,
      teammatePrompt: event.target.value,
    }))
  }

  function handleTeamDraftMessageRecipientChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (teamDraftSessionBlocked || loadingLabel) return
    setTeamDraft(prev => ({
      ...prev,
      to: event.target.value,
    }))
  }

  function handleTeamDraftShutdownReasonChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (teamDraftSessionBlocked || loadingLabel) return
    setTeamDraft(prev => ({
      ...prev,
      shutdownReason: event.target.value,
    }))
  }

  function handleTeamDraftMessageChange(event: ReactChangeEvent<HTMLTextAreaElement>): void {
    if (teamDraftSessionBlocked || loadingLabel) return
    setTeamDraft(prev => ({
      ...prev,
      message: event.target.value,
    }))
  }

  function handleTeamRowSelectClick(team: TeamInfo): void {
    if (loadingLabel) return
    selectTeam(team)
  }

  function handleTeamRowMessageAllClick(team: TeamInfo): void {
    if (loadingLabel) return
    prepareTeamBroadcastMessage(team)
  }

  function handleTeamRowDeleteClick(team: TeamInfo): void {
    if (loadingLabel) return
    void deleteTeam(team)
  }

  function handleTeamMemberSelectClick(team: TeamInfo, member: TeamMemberInfo): void {
    if (loadingLabel) return
    selectTeamMember(team, member)
  }

  function handleTeamMemberMessageClick(team: TeamInfo, member: TeamMemberInfo): void {
    if (loadingLabel) return
    prepareTeamMemberMessage(team, member)
  }

  function handleTeamMemberShutdownClick(team: TeamInfo, member: TeamMemberInfo): void {
    if (loadingLabel) return
    void requestTeamMemberShutdown(team, member)
  }

  function handleTeamMemberRemoveClick(team: TeamInfo, member: TeamMemberInfo): void {
    if (loadingLabel) return
    void removeTeamMember(team, member)
  }

  async function deleteTeam(team: Pick<TeamInfo, 'name'> = { name: teamDraft.teamName }): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setTeamsStatus({ kind: 'error', text: 'Select a session before managing teams.' })
      return
    }
    const deletedTeamName = team.name.trim()
    if (!deletedTeamName) {
      setTeamsStatus({ kind: 'error', text: 'Choose a team before deleting.' })
      return
    }
    const session = activeSession
    const sessionId = session.id
    const cwd = session.cwd
    const input = { teamName: deletedTeamName }
    const actionKey = `${sessionId}:${deletedTeamName}:delete`
    if (teamActionPendingRef.current.has(actionKey)) return
    teamActionPendingRef.current.add(actionKey)
    try {
      if (!(await requestConfirmation({
        title: 'Delete team?',
        message: 'Ask the runtime to clean up the current team and remove its desktop team state.',
        confirmLabel: 'Delete team',
        cancelLabel: 'Cancel',
        tone: 'danger',
      }))) return
      teamActionPendingRef.current.delete(actionKey)
      await runTeamAction(actionKey, 'Deleting team', async () => {
        await window.claudeDesktop.teams.delete(
          sessionId,
          input,
        )
        if (activeSessionIdRef.current !== session.id) return
        const nextTeams = await window.claudeDesktop.teams.list(cwd)
        if (activeSessionIdRef.current !== session.id) return
        setTeams(nextTeams)
        setTeamDraft(prev =>
          prev.teamName.trim() === deletedTeamName ? emptyTeamDraft() : prev
        )
        if (session.layout.selectedTeamName?.trim() === deletedTeamName) {
          const fallbackAgentType = session.layout.selectedAgentType?.trim()
          const fallbackChatTarget: ChatTarget = fallbackAgentType
            ? { type: 'agent', teamName: '', agentType: fallbackAgentType }
            : { type: 'session', teamName: '', agentType: '' }
          setChatTarget(prev =>
            prev.type === 'team' && prev.teamName.trim() === deletedTeamName
              ? fallbackChatTarget
              : prev
          )
          await updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })
        }
        setTeamsStatus({ kind: 'success', text: `Deleted team ${deletedTeamName || 'state'}.` })
      })
    } finally {
      teamActionPendingRef.current.delete(actionKey)
    }
  }

  function handleTeamFormCreateClick(): void {
    if (loadingLabel) return
    void createTeam()
  }

  function handleTeamFormSpawnTeammateClick(): void {
    if (loadingLabel) return
    void spawnTeamTeammate()
  }

  function handleTeamFormSendClick(): void {
    if (loadingLabel) return
    void sendTeamMessage()
  }

  function handleTeamFormShutdownClick(): void {
    if (loadingLabel) return
    void requestTeamShutdown()
  }

  function handleTeamFormDeleteClick(): void {
    if (loadingLabel) return
    void deleteTeam()
  }

  async function saveScheduledTask(): Promise<void> {
    if (loadingLabel) return
    if (!canSaveTask) {
      setScheduledTaskStatus({
        kind: 'error',
        text: 'Enter a valid 5-field cron schedule and prompt before saving.',
      })
      return
    }
    const input = taskInputFromDraft(taskDraft)
    const actionKey = `global:${input.id ?? 'new'}:${input.schedule ?? ''}:${input.prompt}:save`
    const statusTarget = currentScheduledTaskStatusTarget()
    const session = activeSession
    await runScheduledTaskAction(actionKey, 'Saving scheduled task', async () => {
      const tasks = await window.claudeDesktop.tasks.addOrUpdate(input)
      const savedTask = findSavedScheduledTask(input, tasks)
      setTaskDraft(savedTask ? { ...taskDraftFromTask(savedTask), id: savedTask.id } : emptyTaskDraft())
      if (session) await updateSessionLayout(session.id, { selectedGlobalTaskId: savedTask?.id })
      await refreshDesktopConfig()
      setScheduledTaskStatus({ kind: 'success', text: 'Saved scheduled task.' }, statusTarget)
    })
  }

  async function removeScheduledTask(taskId: string): Promise<void> {
    if (loadingLabel) return
    const removedTaskId = taskId.trim()
    if (!removedTaskId) {
      setScheduledTaskStatus({ kind: 'error', text: 'Select a scheduled task before removing.' })
      return
    }
    const actionKey = `global:${removedTaskId}:remove`
    if (scheduledTaskActionPendingRef.current.has(actionKey)) return
    scheduledTaskActionPendingRef.current.add(actionKey)
    try {
      const session = activeSession
      if (!(await requestConfirmation({
        title: 'Remove scheduled task?',
        message: `Remove scheduled task "${removedTaskId}" from global Claude Code settings.`,
        confirmLabel: 'Remove task',
        cancelLabel: 'Cancel',
        tone: 'danger',
      }))) return
      const statusTarget = currentScheduledTaskStatusTarget()
      scheduledTaskActionPendingRef.current.delete(actionKey)
      await runScheduledTaskAction(actionKey, 'Removing scheduled task', async () => {
        await window.claudeDesktop.tasks.remove(removedTaskId)
        if (taskDraft.id === removedTaskId) {
          setTaskDraft(emptyTaskDraft())
          if (session) await updateSessionLayout(session.id, { selectedGlobalTaskId: undefined })
        }
        await refreshDesktopConfig()
        setScheduledTaskStatus({ kind: 'success', text: `Removed scheduled task "${removedTaskId}".` }, statusTarget)
      })
    } finally {
      scheduledTaskActionPendingRef.current.delete(actionKey)
    }
  }

  async function toggleScheduledTaskEnabled(task: ScheduledTaskInfo): Promise<void> {
    if (loadingLabel) return
    const updatedGlobalTaskId = task.id.trim()
    if (!updatedGlobalTaskId) {
      setScheduledTaskStatus({ kind: 'error', text: 'Select a scheduled task before pausing or resuming.' })
      return
    }
    const nextEnabled = !task.enabled
    const label = task.name || updatedGlobalTaskId
    const actionLabel = nextEnabled ? 'Resuming scheduled task' : 'Pausing scheduled task'
    const statusTarget = currentScheduledTaskStatusTarget()
    const session = activeSession
    await runScheduledTaskAction(`global:${updatedGlobalTaskId}:${nextEnabled ? 'resume' : 'pause'}`, actionLabel, async () => {
      const tasks = nextEnabled
        ? await window.claudeDesktop.tasks.resume(updatedGlobalTaskId)
        : await window.claudeDesktop.tasks.pause(updatedGlobalTaskId)
      const updatedTask = tasks.find(nextTask => nextTask.id.trim() === updatedGlobalTaskId)
      if (updatedTask) {
        setTaskDraft({ ...taskDraftFromTask(updatedTask), id: updatedGlobalTaskId })
        if (session) await updateSessionLayout(session.id, { selectedGlobalTaskId: updatedGlobalTaskId })
      }
      await refreshDesktopConfig()
      setScheduledTaskStatus({
        kind: 'success',
        text: `${nextEnabled ? 'Resumed' : 'Paused'} scheduled task "${label}".`,
      }, statusTarget)
    })
  }

  function editScheduledTask(task: ScheduledTaskInfo): void {
    if (loadingLabel) return
    const session = activeSession
    const editedGlobalTaskId = task.id.trim()
    if (!editedGlobalTaskId) {
      setScheduledTaskStatus({ kind: 'error', text: 'Select a scheduled task before editing.' })
      return
    }
    setTaskDraft({ ...taskDraftFromTask(task), id: editedGlobalTaskId })
    if (session) void updateSessionLayout(session.id, { selectedGlobalTaskId: editedGlobalTaskId })
    setScheduledTaskStatus({ kind: 'info', text: `Editing scheduled task "${task.name || editedGlobalTaskId}".` })
  }

  function cancelScheduledTaskEdit(): void {
    if (loadingLabel) return
    const session = activeSession
    setTaskDraft(emptyTaskDraft())
    if (session) void updateSessionLayout(session.id, { selectedGlobalTaskId: undefined })
    setScheduledTaskStatus({ kind: 'info', text: 'Cancelled scheduled task edit.' })
  }

  function startNewScheduledTaskDraft(): void {
    if (loadingLabel) return
    const session = activeSession
    setTaskDraft(emptyTaskDraft())
    if (session) void updateSessionLayout(session.id, { selectedGlobalTaskId: undefined })
    setTasksStatus({ kind: 'info', text: 'Ready to create a new global scheduled task.' })
  }

  async function runScheduledTaskAction(
    actionKey: string,
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (scheduledTaskActionPendingRef.current.has(actionKey)) return
    scheduledTaskActionPendingRef.current.add(actionKey)
    try {
      await runAction(label, action)
    } finally {
      scheduledTaskActionPendingRef.current.delete(actionKey)
    }
  }

  function currentScheduledTaskStatusTarget(): ScheduledTaskStatusTarget {
    return primaryNavView === 'tasks' ? 'tasks' : 'settings'
  }

  function setScheduledTaskStatus(status: PaneStatus, target: ScheduledTaskStatusTarget = currentScheduledTaskStatusTarget()): void {
    if (target === 'tasks') {
      setTasksStatus(status)
    } else {
      setSettingsStatus(status)
    }
  }

  async function runScheduledTaskNow(task: ScheduledTaskInfo): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setScheduledTaskStatus({
        kind: 'error',
        text: 'Select a session before running scheduled tasks.',
      })
      return
    }
    const queuedTaskId = task.id.trim()
    if (!queuedTaskId) {
      setScheduledTaskStatus({ kind: 'error', text: 'Select a scheduled task before running.' })
      return
    }
    const queuedPrompt = task.prompt.trim()
    if (!queuedPrompt) {
      setScheduledTaskStatus({ kind: 'error', text: 'Select a scheduled task with a prompt before running.' })
      return
    }
    const session = activeSession
    if (turnBusy) {
      setScheduledTaskStatus({
        kind: 'info',
        text: 'Wait for the current Claude turn to finish before running a scheduled task.',
      })
      return
    }
    if (!task.enabled) {
      const label = task.name || queuedTaskId
      setScheduledTaskStatus({
        kind: 'error',
        text: `Resume scheduled task "${label}" before running it now.`,
      })
      return
    }
    const sessionId = session.id
    const label = task.name || queuedTaskId
    const statusTarget = currentScheduledTaskStatusTarget()
    await runScheduledTaskAction(`${sessionId}:global:${queuedTaskId}:run-now`, 'Running scheduled task', async () => {
      await window.claudeDesktop.sessions.send(sessionId, queuedPrompt)
      if (activeSessionIdRef.current !== session.id) return
      setTaskDraft({ ...taskDraftFromTask(task), id: queuedTaskId })
      await updateSessionLayout(session.id, { selectedGlobalTaskId: queuedTaskId })
      setScheduledTaskStatus({ kind: 'success', text: `Queued scheduled task "${label}".` }, statusTarget)
    })
  }

  function handleScheduledTaskSaveClick(): void {
    if (loadingLabel) return
    void saveScheduledTask()
  }

  function handleScheduledTaskCancelClick(): void {
    if (loadingLabel) return
    cancelScheduledTaskEdit()
  }

  function handleScheduledTaskRowClick(task: ScheduledTaskInfo): void {
    if (loadingLabel) return
    editScheduledTask(task)
  }

  function handleScheduledTaskEditClick(task: ScheduledTaskInfo): void {
    if (loadingLabel) return
    editScheduledTask(task)
  }

  function handleScheduledTaskToggleClick(task: ScheduledTaskInfo): void {
    if (loadingLabel) return
    void toggleScheduledTaskEnabled(task)
  }

  function handleScheduledTaskRunClick(task: ScheduledTaskInfo): void {
    if (loadingLabel) return
    void runScheduledTaskNow(task)
  }

  function handleScheduledTaskRemoveClick(task: ScheduledTaskInfo): void {
    if (loadingLabel) return
    void removeScheduledTask(task.id)
  }

  async function saveProjectScheduledTask(): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setScheduledTaskStatus({
        kind: 'error',
        text: 'Select a session before saving project scheduled tasks.',
      })
      return
    }
    const session = activeSession
    if (!canSaveProjectTask) {
      setScheduledTaskStatus({
        kind: 'error',
        text: 'Enter a valid 5-field cron schedule and prompt before saving.',
      })
      return
    }
    const sessionId = session.id
    const cwd = session.cwd
    const input = projectTaskInputFromDraft(projectTaskDraft)
    const actionKey = `${sessionId}:project:${input.id ?? 'new'}:${input.cron}:${input.prompt}:save`
    const statusTarget = currentScheduledTaskStatusTarget()
    await runScheduledTaskAction(actionKey, 'Saving project scheduled task', async () => {
      const tasks = await window.claudeDesktop.workspaceTasks.addOrUpdate(
        cwd,
        input,
      )
      if (activeSessionIdRef.current !== session.id) return
      const savedTask = findSavedProjectScheduledTask(input, tasks)
      setProjectTasks(tasks)
      setProjectTaskDraft(savedTask ? { ...projectTaskDraftFromTask(savedTask), id: savedTask.id } : emptyProjectTaskDraft())
      await updateSessionLayout(session.id, { selectedProjectTaskId: savedTask?.id })
      await refreshWorkspace(session)
      if (activeSessionIdRef.current !== session.id) return
      setScheduledTaskStatus({ kind: 'success', text: 'Saved project scheduled task.' }, statusTarget)
    })
  }

  async function removeProjectScheduledTask(taskId: string): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setScheduledTaskStatus({
        kind: 'error',
        text: 'Select a session before removing project scheduled tasks.',
      })
      return
    }
    const removedTaskId = taskId.trim()
    if (!removedTaskId) {
      setScheduledTaskStatus({ kind: 'error', text: 'Select a project scheduled task before removing.' })
      return
    }
    const session = activeSession
    const actionKey = `${session.id}:project:${removedTaskId}:remove`
    if (scheduledTaskActionPendingRef.current.has(actionKey)) return
    scheduledTaskActionPendingRef.current.add(actionKey)
    try {
      if (!(await requestConfirmation({
        title: 'Remove project scheduled task?',
        message: `Remove project scheduled task "${removedTaskId}" from this workspace.`,
        confirmLabel: 'Remove task',
        cancelLabel: 'Cancel',
        tone: 'danger',
      }))) return
      const statusTarget = currentScheduledTaskStatusTarget()
      scheduledTaskActionPendingRef.current.delete(actionKey)
      await runScheduledTaskAction(actionKey, 'Removing project scheduled task', async () => {
        const tasks = await window.claudeDesktop.workspaceTasks.remove(
          session.cwd,
          removedTaskId,
        )
        if (activeSessionIdRef.current !== session.id) return
        setProjectTasks(tasks)
        if (projectTaskDraft.id === removedTaskId) {
          setProjectTaskDraft(emptyProjectTaskDraft())
          await updateSessionLayout(session.id, { selectedProjectTaskId: undefined })
        }
        await refreshWorkspace(session)
        if (activeSessionIdRef.current !== session.id) return
        setScheduledTaskStatus({ kind: 'success', text: `Removed project scheduled task "${removedTaskId}".` }, statusTarget)
      })
    } finally {
      scheduledTaskActionPendingRef.current.delete(actionKey)
    }
  }

  async function toggleProjectScheduledTaskEnabled(task: ProjectScheduledTaskInfo): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setScheduledTaskStatus({
        kind: 'error',
        text: 'Select a session before updating project scheduled tasks.',
      })
      return
    }
    const updatedTaskId = task.id.trim()
    if (!updatedTaskId) {
      setScheduledTaskStatus({ kind: 'error', text: 'Select a project scheduled task before pausing or resuming.' })
      return
    }
    const session = activeSession
    const nextEnabled = !task.enabled
    const statusTarget = currentScheduledTaskStatusTarget()
    await runScheduledTaskAction(`${session.id}:project:${updatedTaskId}:${nextEnabled ? 'resume' : 'pause'}`, `${nextEnabled ? 'Resuming' : 'Pausing'} project scheduled task`, async () => {
      const tasks = nextEnabled
        ? await window.claudeDesktop.workspaceTasks.resume(session.cwd, updatedTaskId)
        : await window.claudeDesktop.workspaceTasks.pause(session.cwd, updatedTaskId)
      if (activeSessionIdRef.current !== session.id) return
      setProjectTasks(tasks)
      const updatedTask = tasks.find(nextTask => nextTask.id.trim() === updatedTaskId)
      if (updatedTask) {
        setProjectTaskDraft({ ...projectTaskDraftFromTask(updatedTask), id: updatedTaskId })
        await updateSessionLayout(session.id, { selectedProjectTaskId: updatedTaskId })
      }
      await refreshWorkspace(session)
      if (activeSessionIdRef.current !== session.id) return
      setScheduledTaskStatus({
        kind: 'success',
        text: `${nextEnabled ? 'Resumed' : 'Paused'} project scheduled task "${updatedTaskId}".`,
      }, statusTarget)
    })
  }

  function editProjectScheduledTask(task: ProjectScheduledTaskInfo): void {
    if (loadingLabel) return
    if (!activeSession) {
      setScheduledTaskStatus({
        kind: 'error',
        text: 'Select a session before editing project scheduled tasks.',
      })
      return
    }
    const session = activeSession
    const editedProjectTaskId = task.id.trim()
    if (!editedProjectTaskId) {
      setScheduledTaskStatus({ kind: 'error', text: 'Select a project scheduled task before editing.' })
      return
    }
    setProjectTaskDraft({ ...projectTaskDraftFromTask(task), id: editedProjectTaskId })
    void updateSessionLayout(session.id, { selectedProjectTaskId: editedProjectTaskId })
    setScheduledTaskStatus({ kind: 'info', text: `Editing project scheduled task "${editedProjectTaskId}".` })
  }

  function cancelProjectScheduledTaskEdit(): void {
    if (loadingLabel) return
    const session = activeSession
    setProjectTaskDraft(emptyProjectTaskDraft())
    if (session) void updateSessionLayout(session.id, { selectedProjectTaskId: undefined })
    setScheduledTaskStatus({ kind: 'info', text: 'Cancelled project scheduled task edit.' })
  }

  function startNewProjectScheduledTaskDraft(): void {
    if (loadingLabel) return
    if (!activeSession) {
      setTasksStatus({ kind: 'error', text: 'Select a session before creating project scheduled tasks.' })
      return
    }
    const session = activeSession
    setProjectTaskDraft(emptyProjectTaskDraft())
    void updateSessionLayout(session.id, { selectedProjectTaskId: undefined })
    setTasksStatus({ kind: 'info', text: 'Ready to create a new project scheduled task.' })
  }

  async function runProjectScheduledTaskNow(task: ProjectScheduledTaskInfo): Promise<void> {
    if (loadingLabel) return
    if (!activeSession) {
      setScheduledTaskStatus({
        kind: 'error',
        text: 'Select a session before running project scheduled tasks.',
      })
      return
    }
    const queuedProjectTaskId = task.id.trim()
    if (!queuedProjectTaskId) {
      setScheduledTaskStatus({ kind: 'error', text: 'Select a project scheduled task before running.' })
      return
    }
    const queuedProjectPrompt = task.prompt.trim()
    if (!queuedProjectPrompt) {
      setScheduledTaskStatus({ kind: 'error', text: 'Select a project scheduled task with a prompt before running.' })
      return
    }
    const session = activeSession
    if (turnBusy) {
      setScheduledTaskStatus({
        kind: 'info',
        text: 'Wait for the current Claude turn to finish before running a scheduled task.',
      })
      return
    }
    if (!task.enabled) {
      setScheduledTaskStatus({
        kind: 'error',
        text: `Resume project scheduled task "${queuedProjectTaskId}" before running it now.`,
      })
      return
    }
    const sessionId = session.id
    const statusTarget = currentScheduledTaskStatusTarget()
    await runScheduledTaskAction(`${sessionId}:project:${queuedProjectTaskId}:run-now`, 'Running scheduled task', async () => {
      await window.claudeDesktop.sessions.send(sessionId, queuedProjectPrompt)
      if (activeSessionIdRef.current !== session.id) return
      setProjectTaskDraft({ ...projectTaskDraftFromTask(task), id: queuedProjectTaskId })
      await updateSessionLayout(session.id, { selectedProjectTaskId: queuedProjectTaskId })
      setScheduledTaskStatus({ kind: 'success', text: `Queued project scheduled task "${queuedProjectTaskId}".` }, statusTarget)
    })
  }

  function handleProjectScheduledTaskSaveClick(): void {
    if (loadingLabel) return
    void saveProjectScheduledTask()
  }

  function handleProjectScheduledTaskCancelClick(): void {
    if (loadingLabel) return
    cancelProjectScheduledTaskEdit()
  }

  function handleProjectScheduledTaskRowClick(task: ProjectScheduledTaskInfo): void {
    if (loadingLabel) return
    editProjectScheduledTask(task)
  }

  function handleProjectScheduledTaskEditClick(task: ProjectScheduledTaskInfo): void {
    if (loadingLabel) return
    editProjectScheduledTask(task)
  }

  function handleProjectScheduledTaskToggleClick(task: ProjectScheduledTaskInfo): void {
    if (loadingLabel) return
    void toggleProjectScheduledTaskEnabled(task)
  }

  function handleProjectScheduledTaskRunClick(task: ProjectScheduledTaskInfo): void {
    if (loadingLabel) return
    void runProjectScheduledTaskNow(task)
  }

  function handleProjectScheduledTaskRemoveClick(task: ProjectScheduledTaskInfo): void {
    if (loadingLabel) return
    void removeProjectScheduledTask(task.id)
  }

  function handleProjectTaskCronChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setProjectTaskDraft(prev => ({
      ...prev,
      cron: event.target.value,
    }))
  }

  function handleProjectTaskRecurringChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setProjectTaskDraft(prev => ({
      ...prev,
      recurring: event.target.checked,
    }))
  }

  function handleProjectTaskPromptChange(event: ReactChangeEvent<HTMLTextAreaElement>): void {
    if (loadingLabel) return
    setProjectTaskDraft(prev => ({
      ...prev,
      prompt: event.target.value,
    }))
  }

  function handleScheduledTaskNameChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setTaskDraft(prev => ({
      ...prev,
      name: event.target.value,
    }))
  }

  function handleScheduledTaskScheduleChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setTaskDraft(prev => ({
      ...prev,
      schedule: event.target.value,
    }))
  }

  function handleScheduledTaskPromptChange(event: ReactChangeEvent<HTMLTextAreaElement>): void {
    if (loadingLabel) return
    setTaskDraft(prev => ({
      ...prev,
      prompt: event.target.value,
    }))
  }

  function handleScheduledTaskEnabledChange(event: ReactChangeEvent<HTMLInputElement>): void {
    if (loadingLabel) return
    setTaskDraft(prev => ({
      ...prev,
      enabled: event.target.checked,
    }))
  }

  function renderProjectScheduledTasksSection(sectionId: string): ReactNode {
    return (
      <section className="settings-section" id={sectionId}>
        <h3>Project Scheduled Tasks</h3>
        {activeSession ? (
          <>
            <div className="settings-form">
              <div className="form-row">
                <input
                  value={projectTaskDraft.cron}
                  onChange={handleProjectTaskCronChange}
                  placeholder="0 9 * * *"
                  aria-label="Project task cron schedule"
                  disabled={!!loadingLabel}
                />
                <label className="toggle-row compact">
                  <input
                    type="checkbox"
                    checked={projectTaskDraft.recurring}
                    aria-label="Project task recurring"
                    disabled={!!loadingLabel}
                    onChange={handleProjectTaskRecurringChange}
                  />
                  Recurring
                </label>
              </div>
              <textarea
                value={projectTaskDraft.prompt}
                onChange={handleProjectTaskPromptChange}
                placeholder="Prompt to run on this schedule"
                aria-label="Project task prompt"
                disabled={!!loadingLabel}
              />
              {projectTaskCronInvalid && (
                <div className="form-note">
                  Enter a valid 5-field cron schedule such as 0 9 * * *.
                </div>
              )}
              <div className="section-actions">
                <button className="tool-button" onClick={handleProjectScheduledTaskSaveClick} disabled={!canSaveProjectTask || !!loadingLabel}>
                  <Icon name="save" />{projectTaskDraft.id ? 'Update project task' : 'Add project task'}
                </button>
                {projectTaskDraft.id && (
                  <button className="tool-button" onClick={handleProjectScheduledTaskCancelClick} disabled={!!loadingLabel}>
                    <Icon name="x" />Cancel edit
                  </button>
                )}
              </div>
            </div>
            <div id="project-task-listbox" className="config-list" role="listbox" aria-label="Project scheduled tasks" aria-activedescendant={activeProjectScheduledTaskOptionId()}>
              {projectTasks.length ? projectTasks.map(task => {
                const taskId = task.id.trim()
                return (
                  <article
                    key={taskId}
                    id={projectScheduledTaskOptionId(task)}
                    role="option"
                    aria-selected={isProjectScheduledTaskItemActive(task)}
                    aria-disabled={!activeSession || !!loadingLabel}
                    tabIndex={!activeSession || loadingLabel ? -1 : 0}
                    onClick={() => handleProjectScheduledTaskRowClick(task)}
                    onKeyDown={event => handleProjectScheduledTaskRowKeyDown(event, task)}
                  >
                    <strong>{task.id}</strong>
                  <small>
                    {task.enabled ? 'enabled' : 'paused'} · {task.recurring ? 'recurring' : 'one-shot'} · {task.cron}
                    {task.enabled ? ` · next ${formatDateTime(task.nextRunAt)}` : ''}
                  </small>
                  <p>{task.prompt}</p>
                  <div className="section-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                    <button className="tool-button" onClick={() => handleProjectScheduledTaskEditClick(task)} disabled={!activeSession || !!loadingLabel}>
                      <Icon name="pencil" />Edit
                    </button>
                    <button className="tool-button" onClick={() => handleProjectScheduledTaskToggleClick(task)} disabled={!activeSession || !!loadingLabel}>
                      <Icon name={task.enabled ? 'pause' : 'play'} />{task.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button className="tool-button" onClick={() => handleProjectScheduledTaskRunClick(task)} disabled={!activeSession || !task.enabled || !canQueueRuntimePrompt || !!loadingLabel}>
                      <Icon name="play" />Run now
                    </button>
                    <button className="tool-button danger" onClick={() => handleProjectScheduledTaskRemoveClick(task)} disabled={!activeSession || !!loadingLabel}>
                      <Icon name="trash" />Remove
                    </button>
                  </div>
                  </article>
                )
              }) : (
                <div className="workarea-empty task-empty-state">
                  <Icon name="play" />
                  <strong>No project scheduled tasks</strong>
                  <span>Add a cron schedule and prompt to write this workspace's .claude/scheduled_tasks.json.</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="workarea-empty task-empty-state">
            <Icon name="folder" />
            <strong>Select a project session</strong>
            <span>Create or select a session to manage workspace-level Claude Code scheduled tasks.</span>
          </div>
        )}
      </section>
    )
  }

  function renderGlobalScheduledTasksSection(sectionId: string): ReactNode {
    return (
      <section className="settings-section" id={sectionId}>
        <h3>Global Scheduled Tasks</h3>
        <div className="settings-form">
          <div className="form-row">
            <input
              value={taskDraft.name}
              onChange={handleScheduledTaskNameChange}
              placeholder="task name"
              aria-label="Scheduled task name"
              disabled={!!loadingLabel}
            />
            <input
              value={taskDraft.schedule}
              onChange={handleScheduledTaskScheduleChange}
              placeholder="schedule"
              aria-label="Scheduled task schedule"
              disabled={!!loadingLabel}
            />
          </div>
          <textarea
            value={taskDraft.prompt}
            onChange={handleScheduledTaskPromptChange}
            placeholder="prompt"
            aria-label="Scheduled task prompt"
            disabled={!!loadingLabel}
          />
          {taskScheduleInvalid && (
            <div className="form-note">
              Enter a valid 5-field cron schedule such as 0 9 * * *.
            </div>
          )}
          <div className="section-actions">
            <label className="toggle-row compact">
              <input
                type="checkbox"
                checked={taskDraft.enabled}
                aria-label="Scheduled task enabled"
                disabled={!!loadingLabel}
                onChange={handleScheduledTaskEnabledChange}
              />
              Enabled
            </label>
            <button className="tool-button" onClick={handleScheduledTaskSaveClick} disabled={!canSaveTask || !!loadingLabel}>
              <Icon name="save" />{taskDraft.id ? 'Update task' : 'Add task'}
            </button>
            {taskDraft.id && (
              <button className="tool-button" onClick={handleScheduledTaskCancelClick} disabled={!!loadingLabel}>
                <Icon name="x" />Cancel edit
              </button>
            )}
          </div>
        </div>
        <div id="scheduled-task-listbox" className="config-list" role="listbox" aria-label="Global scheduled tasks" aria-activedescendant={activeScheduledTaskOptionId()}>
          {desktopConfig?.scheduledTasks.length ? desktopConfig.scheduledTasks.map(task => {
            const taskId = task.id.trim()
            return (
              <article
                key={taskId}
                id={scheduledTaskOptionId(task)}
                role="option"
                aria-selected={isScheduledTaskItemActive(task)}
                aria-disabled={!!loadingLabel}
                tabIndex={loadingLabel ? -1 : 0}
                onClick={() => handleScheduledTaskRowClick(task)}
                onKeyDown={event => handleScheduledTaskRowKeyDown(event, task)}
              >
                <strong>{task.name || task.id}</strong>
              <small>{task.enabled ? 'enabled' : 'disabled'} · {task.schedule || 'manual schedule'}</small>
              <p>{task.prompt}</p>
              <div className="section-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                <button className="tool-button" onClick={() => handleScheduledTaskEditClick(task)} disabled={!!loadingLabel}>
                  <Icon name="pencil" />Edit
                </button>
                <button className="tool-button" onClick={() => handleScheduledTaskToggleClick(task)} disabled={!!loadingLabel}>
                  <Icon name={task.enabled ? 'pause' : 'play'} />{task.enabled ? 'Pause' : 'Resume'}
                </button>
                <button className="tool-button" onClick={() => handleScheduledTaskRunClick(task)} disabled={!task.enabled || !canQueueRuntimePrompt || !!loadingLabel}>
                  <Icon name="play" />Run now
                </button>
                <button className="tool-button danger" onClick={() => handleScheduledTaskRemoveClick(task)} disabled={!!loadingLabel}>
                  <Icon name="trash" />Remove
                </button>
              </div>
              </article>
            )
          }) : (
            <div className="workarea-empty task-empty-state">
              <Icon name="play" />
              <strong>No global scheduled tasks</strong>
              <span>Add a task name, cron schedule, and prompt to create a global Claude Code schedule.</span>
            </div>
          )}
        </div>
      </section>
    )
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!activeSession) {
      setConversationNotice({ kind: 'error', text: 'Select a session before resizing the workspace.' })
      return
    }
    if (!!loadingLabel || !workspaceRef.current) return
    const sessionId = activeSession.id
    const bounds = workspaceRef.current.getBoundingClientRect()
    let latestRatio = workspaceRatio
    const onMove = (moveEvent: PointerEvent) => {
      const rightWidth = bounds.right - moveEvent.clientX
      const ratio = clampWorkspaceRatio(rightWidth / bounds.width)
      latestRatio = ratio
      applyLocalLayout(sessionId, { workspaceRatio: ratio })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      void updateSessionLayout(sessionId, { workspaceRatio: latestRatio }, false)
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function clampWorkspaceRatio(ratio: number): number {
    return Math.max(MIN_WORKSPACE_RATIO, Math.min(MAX_WORKSPACE_RATIO, ratio))
  }

  function resizeWorkspaceWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!activeSession) {
      setConversationNotice({ kind: 'error', text: 'Select a session before resizing the workspace.' })
      return
    }
    if (loadingLabel) return
    const sessionId = activeSession.id
    const keyRatios: Record<string, number> = {
      ArrowLeft: workspaceRatio + KEYBOARD_RESIZE_STEP,
      ArrowRight: workspaceRatio - KEYBOARD_RESIZE_STEP,
      Home: MIN_WORKSPACE_RATIO,
      End: MAX_WORKSPACE_RATIO,
    }
    const nextRatio = keyRatios[event.key]
    if (nextRatio === undefined) return
    event.preventDefault()
    void updateSessionLayout(sessionId, { workspaceRatio: clampWorkspaceRatio(nextRatio) })
  }

  async function respondToPermission(behavior: 'allow' | 'deny'): Promise<void> {
    if (
      !pendingPermission ||
      respondingPermissionId ||
      loadingLabel ||
      permissionActionPendingRef.current
    ) return
    const request = pendingPermission
    permissionActionPendingRef.current = true
    setRespondingPermissionId(request.requestId)
    try {
      await window.claudeDesktop.permissions.respond(
        request.sessionId,
        request.requestId,
        createPermissionResponse(request, behavior),
      )
      setPermissionQueue(prev =>
        prev.filter(item => item.requestId !== request.requestId),
      )
      restoreFocus(permissionReturnFocusRef)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setPermissionQueue(prev =>
        prev.map(item =>
          item.requestId === request.requestId ? { ...item, error: message } : item,
        ),
      )
    } finally {
      setRespondingPermissionId(current =>
        current === request.requestId ? undefined : current,
      )
      permissionActionPendingRef.current = false
    }
  }

  function handlePermissionCancelTurnClick(): void {
    if (loadingLabel || permissionResponding) return
    void cancelSession()
  }

  function handlePermissionResponseClick(behavior: 'allow' | 'deny'): void {
    if (loadingLabel || permissionResponding) return
    void respondToPermission(behavior)
  }

  return (
    <main className="desktop-shell">
      <aside className="session-rail" aria-label="Sessions">
        <div className="rail-header">
          <div>
            <div className="app-kicker">Claude Code</div>
            <h1>Desktop</h1>
          </div>
          <button
            className="icon-button primary"
            onClick={handleSessionCreateButtonClick}
            title="New session"
            aria-label="New session"
            aria-haspopup="menu"
            aria-controls="session-create-menu"
            aria-expanded={Boolean(sessionCreateMenu)}
            data-tooltip="New session"
            disabled={!!loadingLabel}
          >
            <Icon name="plus" />
          </button>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <button {...primaryNavState('chat')} onClick={handlePrimaryNavClick('chat')}>
            <Icon name="panel" />
            <span>Chat</span>
            <small className="nav-shortcut">⌘1</small>
          </button>
          <button {...primaryNavState('agents')} onClick={handlePrimaryNavClick('agents')}>
            <Icon name="bot" />
            <span>Agents</span>
            {rpcMessages.filter(m => m.direction === 'incoming' && m.parsed?.isToolUse).length > 0 && primaryNavView !== 'agents' && (
              <span className="nav-badge">{rpcMessages.filter(m => m.direction === 'incoming' && m.parsed?.isToolUse).length}</span>
            )}
            <small className="nav-shortcut">⌘2</small>
          </button>
          <button {...primaryNavState('teams')} onClick={handlePrimaryNavClick('teams')}>
            <Icon name="users" />
            <span>Teams</span>
            <small className="nav-shortcut">⌘3</small>
          </button>
          <button {...primaryNavState('tasks')} onClick={handlePrimaryNavClick('tasks')}>
            <Icon name="clipboard" />
            <span>Tasks</span>
            <small className="nav-shortcut">⌘4</small>
          </button>
          <button {...primaryNavState('mcp')} onClick={handlePrimaryNavClick('mcp')}>
            <Icon name="terminal" />
            <span>MCP</span>
            <small className="nav-shortcut">⌘5</small>
          </button>
          <button {...primaryNavState('skills')} onClick={handlePrimaryNavClick('skills')}>
            <Icon name="bot" />
            <span>Skills</span>
            <small className="nav-shortcut">⌘6</small>
          </button>
        </nav>
        <section className={`rail-sessions ${sessionsCollapsed ? 'collapsed' : ''}`}>
          <button
            className="rail-section-toggle"
            onClick={handleSessionsCollapseClick}
            aria-expanded={!sessionsCollapsed}
            aria-label={`Sessions, ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}, ${sessionsCollapsed ? 'collapsed' : 'expanded'}`}
            disabled={!!loadingLabel}
          >
            <span className="rail-section-label">
              <span>Sessions</span>
              <span className="rail-section-count">{sessions.length}</span>
            </span>
            <Icon name={sessionsCollapsed ? 'chevron-right' : 'chevron-down'} />
          </button>
          {!sessionsCollapsed && (
            <div className="session-list">
              {sessions.map(session => (
                <div
                  key={session.id}
                  className="session-row-shell"
                  onContextMenu={event => openSessionMenuForRow(event, session.id)}
                >
                  <button
                    className={`session-row ${session.id === activeSessionId ? 'active' : ''}`}
                    aria-current={session.id === activeSessionId ? 'true' : undefined}
                    onClick={() => handleSessionRowClick(session.id)}
                    disabled={!!loadingLabel}
                  >
                    <span className={`status-dot ${session.status} ${session.activity}`} />
                    <span className="session-copy">
                      <strong>{session.title}</strong>
                      <small>{sessionActivityLabel(session)} · {session.cwd}</small>
                    </span>
                    <span className="session-time">{formatTime(session.updatedAt)}</span>
                  </button>
                  <button
                    className="session-menu-button"
                    type="button"
                    title="Manage session"
                    aria-label={`Manage ${session.title}`}
                    aria-haspopup="menu"
                    aria-controls={sessionMenu?.sessionId === session.id ? 'session-action-menu' : undefined}
                    aria-expanded={sessionMenu?.sessionId === session.id}
                    data-tooltip="Manage session"
                    onClick={event => openSessionMenuForRow(event, session.id)}
                    disabled={!!loadingLabel}
                  >
                    <Icon name="more" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="rail-footer">
          <button {...primaryNavState('settings')} onClick={handlePrimaryNavClick('settings')}>
            <Icon name="settings" />
            <span>Settings</span>
            <small className="nav-shortcut">⌘7</small>
          </button>
        </div>
      </aside>

      {sessionCreateMenu && (
        <div
          id="session-create-menu"
          className="session-context-menu session-create-menu"
          style={{ left: sessionCreateMenu.x, top: sessionCreateMenu.y }}
          role="menu"
          aria-label="New session"
          aria-activedescendant={sessionCreateMenuItemIds[sessionCreateMenuActiveIndex]}
          onClick={event => event.stopPropagation()}
        >
          <button
            id={sessionCreateMenuItemIds[0]}
            role="menuitem"
            {...menuItemState(sessionCreateMenuActiveIndex === 0)}
            aria-disabled={!!loadingLabel}
            tabIndex={loadingLabel ? -1 : 0}
            onMouseEnter={() => handleSessionCreateMenuItemMouseEnter(0)}
            onClick={() => handleSessionCreateMenuItemClick(0)}
          >
            <Icon name="plus" />Quick desktop workspace
          </button>
          <button
            id={sessionCreateMenuItemIds[1]}
            role="menuitem"
            {...menuItemState(sessionCreateMenuActiveIndex === 1)}
            aria-disabled={!!loadingLabel}
            tabIndex={loadingLabel ? -1 : 0}
            onMouseEnter={() => handleSessionCreateMenuItemMouseEnter(1)}
            onClick={() => handleSessionCreateMenuItemClick(1)}
          >
            <Icon name="folder" />Choose project folder
          </button>
        </div>
      )}

      {sessionMenu && (
        <div
          id="session-action-menu"
          className="session-context-menu"
          style={{ left: sessionMenu.x, top: sessionMenu.y }}
          role="menu"
          aria-label="Session actions"
          aria-activedescendant={sessionActionMenuItemIds[sessionMenuActiveIndex]}
          onClick={event => event.stopPropagation()}
        >
          <button
            id={sessionActionMenuItemIds[0]}
            role="menuitem"
            {...menuItemState(sessionMenuActiveIndex === 0)}
            aria-disabled={!!loadingLabel}
            tabIndex={loadingLabel ? -1 : 0}
            onMouseEnter={() => handleSessionMenuItemMouseEnter(0)}
            onClick={() => handleSessionMenuItemClick(0)}
          >
            <Icon name="panel" />Focus session
          </button>
          <button
            id={sessionActionMenuItemIds[1]}
            role="menuitem"
            {...menuItemState(sessionMenuActiveIndex === 1)}
            aria-disabled={!!loadingLabel}
            tabIndex={loadingLabel ? -1 : 0}
            onMouseEnter={() => handleSessionMenuItemMouseEnter(1)}
            onClick={() => handleSessionMenuItemClick(1)}
          >
            <Icon name="folder" />Open folder
          </button>
          <button
            id={sessionActionMenuItemIds[2]}
            role="menuitem"
            {...menuItemState(sessionMenuActiveIndex === 2, 'danger')}
            aria-disabled={!!loadingLabel}
            tabIndex={loadingLabel ? -1 : 0}
            onMouseEnter={() => handleSessionMenuItemMouseEnter(2)}
            onClick={() => handleSessionMenuItemClick(2)}
          >
            <Icon name="trash" />Close session
          </button>
        </div>
      )}

      <section
        ref={workspaceRef}
        className={`workspace-layout primary-${primaryNavView}`}
        style={{
          gridTemplateColumns: `minmax(var(--chat-pane-min), ${1 - workspaceRatio}fr) 6px minmax(var(--workspace-pane-min), ${workspaceRatio}fr)`,
        }}
      >
        <section className="chat-pane">
          <section className="chat-header">
            <div>
              <div className="eyebrow">{loadingLabel ?? sessionActivityLabel(activeSession)}</div>
              <h2>{activeSession?.title ?? 'Start a Claude Code session'}</h2>
              <p>{activeSession?.cwd ?? 'Use a quick desktop workspace or choose a project folder for file, git, and terminal tools.'}</p>
              {activeSession?.lastError && <div className="inline-error">{activeSession.lastError}</div>}
              {error && <div className="inline-error">{error}</div>}
              {activeSession && workspaceRefreshWarning && (
                <div className="inline-status error" role="status">
                  {workspaceRefreshWarning}
                </div>
              )}
              {activeSession && !workspaceRefreshWarning && workspaceRefreshStatus && (
                <div className={`inline-status ${workspaceRefreshStatus.kind}`} role="status">
                  {workspaceRefreshStatus.text}
                </div>
              )}
              {sessionStatus && (
                <div className={`inline-status ${sessionStatus.kind}`} role="status">
                  {sessionStatus.text}
                </div>
              )}
            </div>
            {activeSession && (
              <div className="header-actions">
                <button className="icon-button" title="Refresh workspace" aria-label="Refresh workspace" data-tooltip="Refresh workspace" onClick={handleRefreshWorkspaceClick} disabled={!activeSession || !!loadingLabel}>
                  <Icon name="refresh" />
                </button>
                <button className="icon-button" title="Cancel turn" aria-label="Cancel turn" data-tooltip="Cancel turn" onClick={handleCancelTurnClick} disabled={!cancelAvailable || !!loadingLabel}>
                  <Icon name="square" />
                </button>
                <button className="icon-button" title="Clear desktop transcript view" aria-label="Clear desktop transcript view" data-tooltip="Clear desktop transcript view" onClick={handleClearDesktopTranscriptViewClick} disabled={!activeSession || !!loadingLabel}>
                  <Icon name="trash" />
                </button>
                <button className="icon-button" title="Close session" aria-label="Close session" data-tooltip="Close session" onClick={handleCloseSessionClick} disabled={!activeSession || !!loadingLabel}>
                  <Icon name="x" />
                </button>
              </div>
            )}
          </section>

          <section
            ref={messageListRef}
            className="message-list"
            aria-label="Conversation"
            aria-live="polite"
            aria-relevant="additions text"
            aria-busy={turnBusy}
          >
            {!activeSession && (
              <div className="empty-state">
                <Icon name="bot" />
                <p>Start a quick session or choose a project folder for file, git, and terminal tools.</p>
                <div className="empty-actions">
                  <button className="send-button" onClick={handleQuickSessionClick} disabled={!!loadingLabel}>
                    <Icon name="plus" />Quick session
                  </button>
                  <button className="tool-button" onClick={handleChooseFolderSessionClick} disabled={!!loadingLabel}>
                    <Icon name="folder" />Choose folder
                  </button>
                </div>
              </div>
            )}
            {activeSession && (
              <section className="conversation-activity" aria-label="Runtime activity and todos">
                <div className="activity-card">
                  <div className="activity-card-header">
                    <span>Tool activity</span>
                    <small>{recentToolEvents.length + recentToolMessages.length} recent</small>
                  </div>
                  {recentToolEvents.length || recentToolMessages.length ? (
                    <div className="activity-list">
                      {recentToolEvents.map(event => (
                        <div key={event.id} className={`activity-row ${event.status}`}>
                          <span>{toolEventSummary(event)}</span>
                          <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                        </div>
                      ))}
                      {recentToolMessages.map(message => (
                        <div key={message.id} className="activity-row started">
                          <span>{messageText(message)}</span>
                          <time>chat</time>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="workarea-empty activity-empty-state">
                      <Icon name="terminal" />
                      <strong>No tool activity</strong>
                      <span>Claude tool calls and runtime events will appear here as they stream.</span>
                    </div>
                  )}
                  {runningAgentTasks.length ? (
                    <div className="activity-list agent-runs">
                      {runningAgentTasks.map(task => (
                        <div key={task.id} className="activity-row started">
                          <span>{task.description || task.id}</span>
                          <time>{task.agentType ?? 'agent'}</time>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="activity-card todos-card">
                  <div className="activity-card-header">
                    <span>Todos</span>
                    <small>{runtimeTodos.length || 'none'}</small>
                  </div>
                  {runtimeTodos.length ? (
                    <div className="todo-list">
                      {runtimeTodos.map(todo => (
                        <div key={todo.id} className={`todo-row ${todo.status}`}>
                          <span className="todo-state">{todo.status}</span>
                          <span>{todo.content}</span>
                          {todo.priority && <small>{todo.priority}</small>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="workarea-empty activity-empty-state">
                      <Icon name="check" />
                      <strong>No todos yet</strong>
                      <span>TodoWrite items will appear here when Claude starts tracking work.</span>
                    </div>
                  )}
                </div>
              </section>
            )}
            {activeSession?.messages.map(message => {
              const copyTarget = `message:${message.id}`
              const codeCopyTarget = `code:${message.id}`
              const copied = copiedTarget === copyTarget
              return (
                <article key={message.id} className={messageClass(message)}>
                  <div className="message-label">
                    <span>{messageRoleLabel(message.role)}</span>
                    {messageStatusLabel(message) && (
                      <span className="message-stream-label">
                        {messageStatusLabel(message)}
                      </span>
                    )}
                    <button
                      className="tool-button icon-only message-copy-button"
                      type="button"
                      onClick={() => void copyText(copyTarget, messageText(message))}
                      title={copied ? 'Copied' : 'Copy message'}
                      aria-label={copied ? 'Copied message' : 'Copy message'}
                      data-tooltip={copied ? 'Copied' : 'Copy message'}
                    >
                      <Icon name={copied ? 'check' : 'clipboard'} />
                    </button>
                  </div>
                  <MessageContent
                    message={message}
                    onCopyCode={text => void copyText(codeCopyTarget, text)}
                    codeCopied={copiedTarget === codeCopyTarget}
                    onOpenExternalLink={url => void openExternalLink(url)}
                  />
                </article>
              )
            })}
            {conversationStatus && (
              <div className={`conversation-status ${conversationStatusKind}`} role="status">
                {liveConversationStatus && <span className="activity-pulse" />}
                <span>{conversationStatus}</span>
              </div>
            )}
          </section>

          <footer className="composer">
            <div className="composer-targets" aria-label="Chat target">
              <select
                value={chatTarget.type}
                aria-label="Send message to"
                disabled={!activeSession || !!loadingLabel}
                onChange={handleComposerTargetTypeChange}
              >
                <option value="session">Current session</option>
                <option value="team">Team</option>
                <option value="agent">Agent</option>
              </select>
              {chatTarget.type === 'team' && (
                <select
                  value={chatTarget.teamName}
                  aria-label="Target team"
                  disabled={!activeSession || !!loadingLabel}
                  onChange={handleComposerTargetTeamChange}
                >
                  <option value="">Choose team</option>
                  {teams.map(team => (
                    <option key={team.name} value={team.name}>{team.name}</option>
                  ))}
                </select>
              )}
              {chatTarget.type === 'agent' && (
                <select
                  value={chatTarget.agentType}
                  aria-label="Target agent"
                  disabled={!activeSession || !!loadingLabel}
                  onChange={handleComposerTargetAgentChange}
                >
                  <option value="">Choose agent</option>
                  {agentList.allAgents.map(agent => (
                    <option key={`${agent.source}-${agent.agentType}`} value={agent.agentType}>
                      {agent.agentType}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {parsedMentions.length > 0 && !currentComposerTrigger && (
              <div className="composer-mentions" aria-label="Detected mentions">
                {parsedMentions.map((m, i) => (
                  <span key={`${m.kind}-${m.value}-${i}`} className={`mention-chip mention-${m.kind}`}>
                    <Icon name={m.kind === 'agent' ? 'bot' : m.kind === 'team' ? 'users' : m.kind === 'file' ? 'file' : m.kind === 'skill' ? 'code' : 'terminal'} />
                    {m.label}
                  </span>
                ))}
                {(() => {
                  const agentMention = parsedMentions.find(m => m.kind === 'agent')
                  const teamMention = parsedMentions.find(m => m.kind === 'team')
                  if (agentMention) {
                    return <span className="mention-routing">→ Agent: {agentMention.value}</span>
                  }
                  if (teamMention) {
                    return <span className="mention-routing">→ Team: {teamMention.value}</span>
                  }
                  return null
                })()}
              </div>
            )}
            {currentComposerTrigger && (currentComposerTrigger.kind === '/' || activeSession) && (
              <div
                id="composer-menu-listbox"
                className="composer-menu"
                role="listbox"
                aria-label={currentComposerTrigger.kind === '@' ? 'Mention resources' : 'Composer actions'}
                aria-activedescendant={
                  composerMenuItems[composerMenuActiveIndex] && !('divider' in composerMenuItems[composerMenuActiveIndex]!)
                    ? composerMenuOptionId(composerMenuItems[composerMenuActiveIndex] as ComposerMenuItem)
                    : undefined
                }
              >
                <div className="composer-menu-header">
                  <span>{currentComposerTrigger.kind === '@' ? 'Mentions' : 'Commands'}</span>
                  <small>{currentComposerTrigger.kind}{currentComposerTrigger.query}</small>
                </div>
                {composerMenuItems.length ? composerMenuItems.map((item, index) => (
                  'divider' in item ? (
                    <div key={`divider-${item.label}-${index}`} className="composer-menu-divider">
                      <span>{item.label}</span>
                    </div>
                  ) : (
                  <button
                    key={item.id}
                    id={composerMenuOptionId(item)}
                    type="button"
                    role="option"
                    aria-selected={
                      !('divider' in item) && 
                      composerMenuItems[composerMenuActiveIndex] && 
                      !('divider' in composerMenuItems[composerMenuActiveIndex]!) &&
                      (composerMenuItems[composerMenuActiveIndex] as ComposerMenuItem).id === item.id ? 'true' : undefined
                    }
                    aria-disabled={item.disabled ? 'true' : undefined}
                    className={
                      !('divider' in item) && 
                      composerMenuItems[composerMenuActiveIndex] && 
                      !('divider' in composerMenuItems[composerMenuActiveIndex]!) &&
                      (composerMenuItems[composerMenuActiveIndex] as ComposerMenuItem).id === item.id ? 'active' : undefined
                    }
                    onMouseDown={event => handleComposerMenuItemMouseDown(event, item)}
                  >
                    {item.icon && <Icon name={item.icon} />}
                    <span>{item.label}</span>
                    <small>{item.disabled ? `${item.detail} · ${item.disabledReason ?? 'unavailable'}` : item.detail}</small>
                  </button>
                  )
                )) : (
                  <div className="composer-menu-empty">
                    <Icon name="search" />
                    <strong>No matches</strong>
                    <span>Try a shorter query or open the command palette.</span>
                  </div>
                )}
              </div>
            )}
            <textarea
              ref={composerTextareaRef}
              value={input}
              aria-controls={currentComposerTrigger ? 'composer-menu-listbox' : undefined}
              aria-expanded={Boolean(currentComposerTrigger && (currentComposerTrigger.kind === '/' || activeSession))}
              aria-activedescendant={
                composerMenuItems[composerMenuActiveIndex] && !('divider' in composerMenuItems[composerMenuActiveIndex]!)
                  ? composerMenuOptionId(composerMenuItems[composerMenuActiveIndex] as ComposerMenuItem)
                  : undefined
              }
              onChange={handleComposerInputChange}
              onClick={event => updateComposerSelection(event.currentTarget)}
              onKeyUp={event => updateComposerSelection(event.currentTarget)}
              onSelect={event => updateComposerSelection(event.currentTarget)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask Claude to inspect, edit, test, or explain this workspace"
              aria-label="Message Claude"
              disabled={!activeSession || !!loadingLabel}
            />
            <button className="send-button" onClick={handleComposerSendClick} disabled={!activeSession || turnBusy || !input.trim() || !!loadingLabel}>
              <Icon name="send" />
              Send
            </button>
          </footer>
        </section>

        <div
          className="resize-handle"
          onPointerDown={startResize}
          onKeyDown={resizeWorkspaceWithKeyboard}
          title="Resize workspace"
          aria-label="Resize workspace"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={Math.round(MIN_WORKSPACE_RATIO * 100)}
          aria-valuemax={Math.round(MAX_WORKSPACE_RATIO * 100)}
          aria-valuenow={Math.round(workspaceRatio * 100)}
          aria-valuetext={`Workspace ${Math.round(workspaceRatio * 100)} percent`}
          aria-disabled={!!loadingLabel}
          tabIndex={activeSession && !loadingLabel ? 0 : -1}
        />

        <section className="ide-pane">
          <nav className="pane-tabs" aria-label="Workspace panes">
            <button title="Files" aria-label="Files" data-tooltip="Files" {...workspacePaneTabState('files')} onClick={handleWorkspacePaneClick('files')}><Icon name="folder" /><span className="tab-label">Files</span></button>
            <button title="Diff" aria-label="Diff" data-tooltip="Diff" {...workspacePaneTabState('diff')} onClick={handleWorkspacePaneClick('diff')}><Icon name="diff" /><span className="tab-label">Diff</span></button>
            <button title="Editor" aria-label="Editor" data-tooltip="Editor" {...workspacePaneTabState('editor')} onClick={handleWorkspacePaneClick('editor')}><Icon name="code" /><span className="tab-label">Editor</span></button>
            <button title="Terminal" aria-label="Terminal" data-tooltip="Terminal" {...workspacePaneTabState('terminal')} onClick={handleWorkspacePaneClick('terminal')}><Icon name="terminal" /><span className="tab-label">Terminal</span></button>
            <button title="Preview" aria-label="Preview" data-tooltip="Preview" {...workspacePaneTabState('preview')} onClick={handleWorkspacePaneClick('preview')}><Icon name="globe" /><span className="tab-label">Preview</span></button>
          </nav>

          <section className="pane-body">
            {activePane === 'files' && (
              <div className="files-pane" aria-busy={!!loadingLabel}>
                <div className="pane-toolbar">
                  <span>
                    Files
                    {activeSession && ` · ${workspaceFileCount} file${workspaceFileCount === 1 ? '' : 's'}`}
                  </span>
                  <div className="pane-toolbar-actions">
                    {loadingLabel && <span className="pane-loading-status" role="status">{loadingLabel}</span>}
                    <button className="tool-button" onClick={handleRefreshFilesClick} disabled={!activeSession || !!loadingLabel}>
                      <Icon name="refresh" />Refresh
                    </button>
                  </div>
                </div>
                {filesStatus && (
                  <div className={`files-status ${filesStatus.kind}`} role="status">
                    {filesStatus.text}
                  </div>
                )}
                {!activeSession && (
                  <div className="form-note">
                    Select a project session before browsing files.
                  </div>
                )}
                <div className="file-tree">
                  {flatTree.length === 0 ? (
                    <div className="file-tree-empty workarea-empty">
                      <Icon name="folder" />
                      <strong>No files found</strong>
                      <span>Create or open files in this project to edit them here.</span>
                    </div>
                  ) : flatTree.map(entry => (
                    <button
                      key={entry.path}
                      className={`tree-row ${entry.type} ${entry.path === activeFile ? 'active' : ''}`}
                      style={{ paddingLeft: 12 + entry.depth * 16 }}
                      aria-current={entry.path === activeFile ? 'true' : undefined}
                      aria-expanded={entry.type === 'directory' ? expandedPaths.has(entry.path) : undefined}
                      onClick={() => handleFileTreeEntryClick(entry)}
                      disabled={!activeSession || !!loadingLabel}
                    >
                      {entry.type === 'directory' ? <Icon name="folder" /> : <Icon name="code" />}
                      <span>{entry.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activePane === 'diff' && (
              <div className="diff-pane" aria-busy={!!loadingLabel}>
                <div className="pane-toolbar">
                  <span>
                    Git changes
                    {diffFiles.length > 0 && ` · ${diffFiles.length} file${diffFiles.length === 1 ? '' : 's'}`}
                  </span>
                  <div className="pane-toolbar-actions">
                    {loadingLabel && <span className="pane-loading-status" role="status">{loadingLabel}</span>}
                    <button className="tool-button" onClick={handleRefreshDiffClick} disabled={!activeSession || !!loadingLabel}>
                      <Icon name="refresh" />Refresh
                    </button>
                  </div>
                </div>
                {diffStatus && (
                  <div className={`diff-inline-status ${diffStatus.kind}`} role="status">
                    {diffStatus.text}
                  </div>
                )}
                {!activeSession && (
                  <div className="form-note">
                    Select a project session before reviewing git changes.
                  </div>
                )}
                {gitStatus.trim() && (
                  <div className="diff-status">
                    <pre>{gitStatus}</pre>
                  </div>
                )}
                <div className="diff-workspace">
                  <div className="diff-file-list">
                    {diffFiles.length === 0 && (
                      <div className="diff-empty workarea-empty">
                        <Icon name="diff" />
                        <strong>No changed files</strong>
                        <span>Refresh after editing files to populate this list.</span>
                      </div>
                    )}
                    {diffFiles.map(file => (
                      <button
                        key={file.path}
                        className={file.path === selectedDiff?.path ? 'active' : ''}
                        onClick={() => handleDiffFileClick(file.path)}
                        disabled={!activeSession || !!loadingLabel}
                      >
                        <span>{file.path}</span>
                        <small>+{file.additions} -{file.deletions}</small>
                      </button>
                    ))}
                  </div>
                  <div className="diff-viewer" role="region" aria-label="Diff viewer">
                    {selectedDiff ? (
                      selectedDiff.lines.map((line, index) => (
                        <div key={`${selectedDiff.path}-${index}`} className={`diff-line ${line.kind}`}>
                          <span className="diff-marker">
                            {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
                          </span>
                          <code>{line.text}</code>
                        </div>
                      ))
                    ) : (
                      <div className="diff-placeholder workarea-empty">
                        <Icon name="diff" />
                        <strong>No unstaged changes</strong>
                        <span>Edit a file or refresh the workspace to review changes here.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activePane === 'editor' && (
              <div className="editor-pane">
                <div className="editor-toolbar">
                  <span>
                    {activeFile ?? 'Open a file from the Files pane'}
                    {hasUnsavedChanges ? ' · Unsaved' : ''}
                  </span>
                  <button className="icon-button" title="Save file" aria-label="Save file" data-tooltip="Save file" onClick={handleSaveFileClick} disabled={!activeSession || !activeFile || !!loadingLabel}>
                    <Icon name="save" />
                  </button>
                </div>
                {editorStatus && (
                  <div className={`editor-status ${editorStatus.kind}`} role="status">
                    {editorStatus.text}
                  </div>
                )}
                <div
                  className="monaco-host"
                  ref={monacoHostRef}
                  role="region"
                  aria-label={activeFile ? `Editor for ${activeFile}` : 'File editor'}
                >
                  {!activeFile && (
                    <div className="editor-placeholder">
                      <Icon name="code" />
                      <strong>Open a file</strong>
                      <span>Select a text file from Files to inspect or edit it here.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activePane === 'terminal' && (
              <div className="terminal-pane">
                <div className="terminal-toolbar">
                  <button className="tool-button" onClick={handleStartTerminalClick} disabled={!activeSession || !!terminalId || !!loadingLabel}>
                    <Icon name="play" />Start shell
                  </button>
                  <button className="tool-button" onClick={handleStopTerminalClick} disabled={!activeSession || !terminalId || !!loadingLabel}>
                    <Icon name="square" />Stop
                  </button>
                  {terminalInfo && (
                    <span className="terminal-mode">
                      {terminalInfo.mode === 'pty' ? 'PTY' : 'Shell fallback'} · {terminalInfo.columns}x{terminalInfo.rows} · {terminalInfo.shell}
                    </span>
                  )}
                </div>
                {terminalStatus && (
                  <div className={`terminal-status ${terminalStatus.kind}`} role="status">
                    {terminalStatus.text}
                  </div>
                )}
                {!activeSession && (
                  <div className="form-note">
                    Select a project session before starting a shell.
                  </div>
                )}
                <div className="xterm-host" ref={xtermHostRef} role="region" aria-label="Terminal output">
                  {!terminalId && (
                    <div className="terminal-placeholder">
                      <Icon name="terminal" />
                      <strong>Start a shell</strong>
                      <span>Commands run in the active project folder.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activePane === 'preview' && (
              <div className="preview-pane">
                <div className="preview-toolbar">
                  <Icon name="panel" />
                  <input
                    value={previewUrl}
                    onChange={handlePreviewUrlChange}
                    placeholder="https://localhost:3000"
                    aria-label="Preview URL"
                    disabled={!activeSession || !!loadingLabel}
                  />
                  <button className="tool-button" onClick={handleOpenPreviewClick} disabled={!activeSession || !previewUrlValid || !!loadingLabel}>
                    <Icon name="play" />Open
                  </button>
                  <button className="tool-button icon-only" onClick={handleOpenExternalPreviewClick} disabled={!activeSession || !previewUrlValid || !!loadingLabel} title="Open in browser" aria-label="Open in browser" data-tooltip="Open in browser"><Icon name="open" /></button>
                </div>
                {previewStatus && (
                  <div className={`preview-status ${previewStatus.kind}`} role="status">
                    {previewStatus.text}
                  </div>
                )}
                {!activeSession && (
                  <div className="form-note">
                    Select a project session before opening an embedded preview.
                  </div>
                )}
                <div className="preview-frame" role="region" aria-label="Preview pane">
                  {!committedPreviewUrlValid && (
                    <div className="preview-placeholder workarea-empty">
                      <Icon name="globe" />
                      <strong>Open a preview</strong>
                      <span>Enter an http:// or https:// URL to render it inside this pane.</span>
                    </div>
                  )}
                  <iframe title="Embedded preview" src={committedPreviewUrlValid ? committedPreviewUrl : 'about:blank'} />
                </div>
              </div>
            )}

            {(activePane === 'agents' || activePane === 'teams') && (
              <div
                className={activePane === 'teams' ? 'teams-pane' : 'agents-pane agents-management-pane'}
                role="region"
                aria-label={activePane === 'teams' ? 'Team management' : 'Agent management'}
                aria-busy={!!loadingLabel}
                ref={element => {
                  if (element) flushPendingPaneSection(activePane === 'teams' ? 'teams' : 'agents')
                }}
              >
                <div className="pane-toolbar">
                  <span>
                    {activePane === 'teams'
                      ? `Teams · ${teams.length} team${teams.length === 1 ? '' : 's'}`
                      : (
                        <>
                          Agents
                          {agentList.activeAgents.length > 0 && ` · ${agentList.activeAgents.length} active`}
                        </>
                      )}
                  </span>
                  <div className="pane-toolbar-actions">
                    {loadingLabel && <span className="pane-loading-status" role="status">{loadingLabel}</span>}
                    <button className="tool-button" onClick={handleAgentsRefreshClick} disabled={(activePane === 'teams' && !activeSession) || !!loadingLabel}>
                      <Icon name="refresh" />Refresh
                    </button>
                  </div>
                </div>
                <nav className="pane-jumpbar" aria-label={activePane === 'teams' ? 'Team sections' : 'Agent sections'}>
                  {activePane === 'teams' ? (
                    <button {...paneJumpbarButtonState(teamsActiveSection === 'agents-teams')} onClick={handleTeamsSectionClick}>Teams</button>
                  ) : (
                    <>
                      <button {...paneJumpbarButtonState(agentsActiveSection === 'agents-sources')} onClick={handleAgentsOverviewSectionClick}>Overview</button>
                      <button {...paneJumpbarButtonState(agentsActiveSection === 'agents-catalog')} onClick={handleAgentsCatalogSectionClick}>Available</button>
                      <button {...paneJumpbarButtonState(agentsActiveSection === 'agents-launch')} onClick={handleAgentsLaunchSectionClick}>Run</button>
                      <button {...paneJumpbarButtonState(agentsActiveSection === 'agents-editor')} onClick={handleAgentsEditorSectionClick}>Custom</button>
                      <button {...paneJumpbarButtonState(agentsActiveSection === 'agents-tasks')} onClick={handleAgentsTasksSectionClick}>Running</button>
                      <button {...paneJumpbarButtonState(agentsActiveSection === 'agents-activity')} onClick={handleAgentsActivitySectionClick}>Activity</button>
                    </>
                  )}
                </nav>
                {(activePane === 'teams' ? teamsStatus : agentsStatus) && (
                  <div className={`pane-status ${(activePane === 'teams' ? teamsStatus : agentsStatus)?.kind}`} role="status">
                    {(activePane === 'teams' ? teamsStatus : agentsStatus)?.text}
                  </div>
                )}

                {activePane !== 'teams' && (
                  <>
                    <section className="settings-section" id="agents-sources">
                      <h3>Agent management</h3>
                      <p className="section-copy">Choose an available agent, run it on a task, or save a user/project custom agent.</p>
                      <div className="settings-grid">
                        <div>
                          <small>Built-in</small>
                          <code>
                            {agentList.allAgents.filter(agent => agent.source === 'built-in').length} read-only
                          </code>
                        </div>
                        <div>
                          <small>User custom</small>
                          <code>
                            {agentList.allAgents.filter(agent => agent.source === 'user').length} editable
                          </code>
                        </div>
                        <div>
                          <small>Project custom</small>
                          <code>
                            {agentList.allAgents.filter(agent => agent.source === 'project').length} editable
                          </code>
                        </div>
                      </div>
                    </section>

                    <section className="settings-section" id="agents-catalog">
                      <h3>Available agents</h3>
                      <div className="settings-form compact">
                        <div className="form-row">
                          <input
                            value={agentCatalogQuery}
                            onChange={handleAgentCatalogQueryChange}
                            placeholder="search agents"
                            aria-label="Search agents"
                            disabled={!!loadingLabel}
                            role="combobox"
                            aria-expanded="true"
                            aria-controls="agent-catalog-listbox"
                            aria-activedescendant={activeAgentCatalogItem ? agentCatalogOptionId(activeAgentCatalogItem) : undefined}
                            onKeyDown={handleAgentCatalogKeyDown}
                          />
                          <select
                            value={agentCatalogSource}
                            aria-label="Agent catalog filter"
                            disabled={!!loadingLabel}
                            onChange={handleAgentCatalogSourceChange}
                          >
                            {agentSourceFilters.map(filter => (
                              <option key={filter.value} value={filter.value}>
                                {filter.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <small>
                          Showing {visibleAgents.length} of {
                            agentCatalogSource === 'active'
                              ? agentList.activeAgents.length
                              : agentList.allAgents.filter(agent => agent.source === agentCatalogSource).length
                          } agents
                        </small>
                      </div>
                      <div id="agent-catalog-listbox" className="config-list" role="listbox" aria-label="Available agents">
                        {visibleAgents.length ? visibleAgents.map(agent => {
                          const agentType = agent.agentType.trim()
                          return (
                            <article
                              key={`${agent.source}-${agentType}`}
                              id={agentCatalogOptionId(agent)}
                              role="option"
                              aria-selected={isAgentCatalogItemActive(agent)}
                              aria-disabled={!!loadingLabel}
                              {...agentCatalogCardState(agent)}
                              tabIndex={loadingLabel ? -1 : 0}
                              onClick={() => handleAgentCatalogRowClick(agent)}
                              onKeyDown={event => handleAgentCatalogRowKeyDown(event, agent)}
                            >
                              <strong>{agent.agentType}</strong>
                              <small>{agent.source}{agent.model ? ` · ${agent.model}` : ''}{agent.isolation ? ` · ${agent.isolation}` : ''}</small>
                              <p>{agent.whenToUse}</p>
                              <code>Tools: {agentToolsSummary(agent)}</code>
                              {agent.requiredMcpServers?.length ? <code>MCP: {agent.requiredMcpServers.join(', ')}</code> : null}
                              {agent.skills?.length ? <code>Skills: {agent.skills.join(', ')}</code> : null}
                              <div className="section-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                                <button className="tool-button" onClick={() => handleAgentCatalogSelectClick(agent)} disabled={!!loadingLabel}>
                                  <Icon name="panel" />Select
                                </button>
                                <button className="tool-button" onClick={() => handleAgentCatalogDiagnoseClick(agent)} disabled={!activeSession || !!loadingLabel}>
                                  <Icon name="refresh" />Diagnose
                                </button>
                              </div>
                            </article>
                          )
                        }) : (
                          <div className="workarea-empty settings-empty-state">
                            <Icon name="bot" />
                            {activeSession ? (
                              <>
                                <strong>No matching agents</strong>
                                <span>Adjust the search or source filter to find an available agent.</span>
                              </>
                            ) : (
                              <>
                                <strong>No agents loaded</strong>
                                <span>Refresh to load built-in and user agents.</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </section>

                    {selectedAgent && (
                      <section className="settings-section" id="agents-selected">
                        <h3>Selected agent</h3>
                        <div className="settings-grid">
                          <div>
                            <small>Type</small>
                            <code>{selectedAgent.agentType}</code>
                          </div>
                          <div>
                            <small>Source</small>
                            <code>{selectedAgent.source}{selectedAgent.editable ? ' · editable' : ' · read-only'}</code>
                          </div>
                          <div>
                            <small>Model</small>
                            <code>{selectedAgent.model ?? 'runtime default'}</code>
                          </div>
                          <div>
                            <small>Permission</small>
                            <code>{selectedAgent.permissionMode ?? 'runtime default'}</code>
                          </div>
                          <div>
                            <small>Isolation</small>
                            <code>{selectedAgent.isolation ?? 'none'}</code>
                          </div>
                          <div>
                            <small>Background</small>
                            <code>{selectedAgent.background ? 'enabled' : 'runtime default'}</code>
                          </div>
                        </div>
                        <p>{selectedAgent.whenToUse}</p>
                        <div className="mini-list">
                          <code>Tools: {agentToolsSummary(selectedAgent)}</code>
                          <code>MCP: {selectedAgent.requiredMcpServers?.join(', ') || 'none declared'}</code>
                          <code>Skills: {selectedAgent.skills?.join(', ') || 'none declared'}</code>
                          <code>Hooks: {selectedAgent.hasHooks ? 'declared' : 'none declared'}</code>
                          <code>Memory: {selectedAgent.memory ?? 'none declared'}</code>
                        </div>
                        {!activeSession && (
                          <div className="form-note">
                            Select a project session to diagnose, start sessions, or prepare agent tasks.
                          </div>
                        )}
                        <div className="section-actions selected-agent-actions">
                          <button className="tool-button" onClick={handleSelectedAgentDiagnoseClick} disabled={!activeSession || !!loadingLabel}>
                            <Icon name="refresh" />Diagnose
                          </button>
                          <button className="tool-button" onClick={handleSelectedAgentNewSessionClick} disabled={!activeSession || !!loadingLabel}>
                            <Icon name="plus" />New session
                          </button>
                          <button className="tool-button" onClick={handleSelectedAgentPrepareRunClick} disabled={!activeSession || !!loadingLabel}>
                            <Icon name="play" />Prepare task
                          </button>
                          <button className="tool-button" onClick={handleSelectedAgentPrepareEditClick} disabled={!canEditSelectedAgent || !!loadingLabel}>
                            <Icon name="pencil" />{selectedAgent.editable ? 'Edit' : 'Override'}
                          </button>
                          <button className="tool-button danger" onClick={handleSelectedAgentDeleteClick} disabled={!canDeleteSelectedAgent || !!loadingLabel}>
                            <Icon name="trash" />Delete
                          </button>
                        </div>
                      </section>
                    )}

                    <section className="settings-section" id="agents-launch">
                      <h3>Run agent</h3>
                      <div className="settings-form">
                        {agentLaunchDraftSessionBlocked && (
                          <div className="form-note">
                            Select a project session before running agents.
                          </div>
                        )}
                        <div className="form-row">
                          <input
                            value={agentLaunchDraft.agentType}
                            onChange={handleAgentLaunchAgentTypeChange}
                            placeholder="agent type"
                            aria-label="Launch agent type"
                            disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}
                          />
                          <input
                            value={agentLaunchDraft.model}
                            onChange={handleAgentLaunchModelChange}
                            placeholder="model override"
                            aria-label="Launch model override"
                            disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}
                          />
                          <input
                            value={agentLaunchDraft.permissionMode}
                            onChange={handleAgentLaunchPermissionModeChange}
                            placeholder="permission mode"
                            aria-label="Launch permission mode"
                            disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}
                          />
                        </div>
                        <div className="form-row">
                          <input
                            value={agentLaunchDraft.description}
                            onChange={handleAgentLaunchDescriptionChange}
                            placeholder="short task description"
                            aria-label="Launch task description"
                            disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}
                          />
                          <select
                            value={agentLaunchDraft.isolation}
                            aria-label="Launch isolation"
                            disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}
                            onChange={handleAgentLaunchIsolationChange}
                          >
                            <option value="">no isolation</option>
                            <option value="worktree">worktree</option>
                            {canUseRemoteIsolation && <option value="remote">remote</option>}
                          </select>
                        </div>
                        <textarea
                          value={agentLaunchDraft.prompt}
                          onChange={handleAgentLaunchPromptChange}
                          placeholder="task prompt for the selected agent"
                          aria-label="Launch task prompt"
                          disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}
                        />
                        {agentLaunchTaskInvalid && (
                          <div className="form-note">
                            Choose an agent type before launching a task.
                          </div>
                        )}
                        <div className="form-row">
                          <input
                            value={agentLaunchDraft.name}
                            onChange={handleAgentLaunchNameChange}
                            placeholder="teammate name"
                            aria-label="Launch teammate name"
                            disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}
                          />
                          <input
                            value={agentLaunchDraft.teamName}
                            onChange={handleAgentLaunchTeamNameChange}
                            placeholder="team name"
                            aria-label="Launch team name"
                            disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}
                          />
                          <input
                            value={agentLaunchDraft.mode}
                            onChange={handleAgentLaunchModeChange}
                            placeholder="teammate mode"
                            aria-label="Launch teammate mode"
                            disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}
                          />
                        </div>
                        <div className="section-actions">
                          <label className="toggle-row compact">
                            <input
                              type="checkbox"
                              checked={agentLaunchDraft.runInBackground}
                              aria-label="Run launch task in background"
                              disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}
                              onChange={handleAgentLaunchRunInBackgroundChange}
                            />
                            Background
                          </label>
                          <button className="tool-button" onClick={handleAgentLaunchCreateSessionClick} disabled={!activeSession || !agentLaunchDraft.agentType.trim() || !!loadingLabel}>
                            <Icon name="plus" />New agent session
                          </button>
                          <button className="send-button" onClick={handleAgentLaunchTaskClick} disabled={!canLaunchAgentTask || !!loadingLabel}>
                            <Icon name="send" />Launch task
                          </button>
                        </div>
                      </div>
                    </section>

                    {agentDiagnostics && (
                      <section className="settings-section">
                        <h3>Diagnostics</h3>
                        <p>{agentDiagnostics.ok ? 'Ready' : 'Needs setup'}</p>
                        <div className="config-list">
                          {agentDiagnostics.readiness.map(item => (
                            <article key={item.label}>
                              <strong>{item.label}</strong>
                              <small>{item.ok ? 'ready' : 'needs setup'}</small>
                              <p>{item.detail}</p>
                            </article>
                          ))}
                        </div>
                        {agentDiagnostics.missingMcpServers.length ? (
                          <div className="mini-list">
                            <code>Missing MCP: {agentDiagnostics.missingMcpServers.join(', ')}</code>
                            <button className="tool-button" onClick={handleAgentDiagnosticsMcpSettingsClick} disabled={!!loadingLabel}>
                              <Icon name="settings" />Open MCP settings
                            </button>
                          </div>
                        ) : null}
                        {agentDiagnostics.missingSkills.length ? (
                          <div className="mini-list">
                            <code>Missing skills: {agentDiagnostics.missingSkills.join(', ')}</code>
                            <button className="tool-button" onClick={handleAgentDiagnosticsSkillsSettingsClick} disabled={!!loadingLabel}>
                              <Icon name="settings" />Open Skills settings
                            </button>
                          </div>
                        ) : null}
                        {agentDiagnostics.warnings.length ? (
                          <div className="mini-list">
                            {agentDiagnostics.warnings.map(warning => (
                              <code key={warning}>{warning}</code>
                            ))}
                          </div>
                        ) : null}
                        <pre>{rawSummary(agentDiagnostics)}</pre>
                      </section>
                    )}

                    <section className="settings-section" id="agents-editor">
                      <h3>Custom agents</h3>
                      <div className="settings-form">
                        {selectedAgentReadOnly && (
                          <div className="form-note">
                            Selected agent is read-only. Use New or enter a project/user agent name to create an editable override.
                          </div>
                        )}
                        <div className="form-row">
                          <input
                            value={agentDraft.agentType}
                            onChange={handleAgentEditorTypeChange}
                            placeholder="agent type"
                            aria-label="Agent editor type"
                            disabled={!!loadingLabel}
                          />
                          <select
                            value={agentDraft.source}
                            aria-label="Agent editor source"
                            disabled={!!loadingLabel}
                            onChange={handleAgentEditorSourceChange}
                          >
                            <option value="project">project</option>
                            <option value="user">user</option>
                          </select>
                        </div>
                        <input
                          value={agentDraft.whenToUse}
                          onChange={handleAgentEditorWhenToUseChange}
                          placeholder="when to use this agent"
                          aria-label="When to use this agent"
                          disabled={!!loadingLabel}
                        />
                        <div className="form-row">
                          <input
                            value={agentDraft.model}
                            onChange={handleAgentEditorModelChange}
                            placeholder="model"
                            aria-label="Agent editor model"
                            disabled={!!loadingLabel}
                          />
                          <input
                            value={agentDraft.permissionMode}
                            onChange={handleAgentEditorPermissionModeChange}
                            placeholder="permission mode"
                            aria-label="Agent editor permission mode"
                            disabled={!!loadingLabel}
                          />
                        </div>
                        <div className="form-row">
                          <input
                            value={agentDraft.tools}
                            onChange={handleAgentEditorToolsChange}
                            placeholder="tools, comma-separated"
                            aria-label="Agent editor allowed tools"
                            disabled={!!loadingLabel}
                          />
                          <input
                            value={agentDraft.disallowedTools}
                            onChange={handleAgentEditorDisallowedToolsChange}
                            placeholder="disallowed tools, comma-separated"
                            aria-label="Agent editor disallowed tools"
                            disabled={!!loadingLabel}
                          />
                        </div>
                        <div className="form-row">
                          <input
                            value={agentDraft.skills}
                            onChange={handleAgentEditorSkillsChange}
                            placeholder="skills, comma-separated"
                            aria-label="Agent editor skills"
                            disabled={!!loadingLabel}
                          />
                          <input
                            value={agentDraft.memory}
                            onChange={handleAgentEditorMemoryChange}
                            placeholder="memory scope"
                            aria-label="Agent editor memory scope"
                            disabled={!!loadingLabel}
                          />
                        </div>
                        <div className="form-row">
                          <input
                            value={agentDraft.requiredMcpServers}
                            onChange={handleAgentEditorRequiredMcpServersChange}
                            placeholder="required MCP servers, comma-separated"
                            aria-label="Agent editor required MCP servers"
                            disabled={!!loadingLabel}
                          />
                          <select
                            value={agentDraft.isolation}
                            aria-label="Agent editor isolation"
                            disabled={!!loadingLabel}
                            onChange={handleAgentEditorIsolationChange}
                          >
                            <option value="">no isolation</option>
                            <option value="worktree">worktree</option>
                            {canUseRemoteIsolation && <option value="remote">remote</option>}
                          </select>
                        </div>
                        <textarea
                          value={agentDraft.prompt}
                          onChange={handleAgentEditorPromptChange}
                          placeholder="agent system prompt"
                          aria-label="Agent system prompt"
                          disabled={!!loadingLabel}
                        />
                        <div className="section-actions">
                          <label className="toggle-row compact">
                            <input
                              type="checkbox"
                              checked={agentDraft.background}
                              aria-label="Agent runs in background"
                              disabled={!!loadingLabel}
                              onChange={handleAgentEditorBackgroundChange}
                            />
                            Background
                          </label>
                          <button className="tool-button" onClick={handleAgentEditorSaveClick} disabled={(agentDraft.source === 'project' && !activeSession) || !agentDraft.agentType.trim() || !agentDraft.whenToUse.trim() || !agentDraft.prompt.trim() || !!loadingLabel}>
                            <Icon name="save" />Save agent
                          </button>
                          <button className="tool-button" onClick={handleAgentEditorNewClick} disabled={!!loadingLabel}>
                            <Icon name="plus" />New
                          </button>
                          <button className="tool-button danger" onClick={handleAgentEditorDeleteClick} disabled={!canDeleteAgentDraft || !!loadingLabel}>
                            <Icon name="trash" />Delete
                          </button>
                        </div>
                      </div>
                    </section>

                    <section className="settings-section" id="agents-tasks">
                      <h3>Running tasks</h3>
                      <div className="settings-form">
                        <input
                          value={agentTaskPrompt}
                          onChange={handleAgentTaskPromptChange}
                          placeholder="follow-up prompt for Resume"
                          aria-label="Agent task resume prompt"
                          disabled={agentTaskPromptSessionBlocked || !!loadingLabel}
                        />
                      </div>
                      <div id="agent-task-listbox" className="config-list" role="listbox" aria-label="Agent tasks">
                        {activeSession?.agentTasks?.length ? activeSession.agentTasks.map(task => (
                          <article key={task.id} className={isAgentTaskItemActive(task) ? 'active' : ''} role="option" aria-selected={isAgentTaskItemActive(task)}>
                            <strong>{task.description || task.id}</strong>
                            <small>{task.status}{task.agentType ? ` · ${task.agentType}` : ''}</small>
                            {task.lastToolName && <code>Last tool: {task.lastToolName}</code>}
                            {task.tokenCount !== undefined && <code>{task.tokenCount.toLocaleString()} tokens</code>}
                            {task.toolUseCount !== undefined && <code>{task.toolUseCount} tool use{task.toolUseCount === 1 ? '' : 's'}</code>}
                            {task.durationMs !== undefined && <code>{Math.round(task.durationMs / 1000)}s</code>}
                            {task.outputFile && <code>{task.outputFile}</code>}
                            {task.worktreePath && <code>{task.worktreePath}</code>}
                            {task.remoteSessionUrl && <code>{task.remoteSessionUrl}</code>}
                            {task.error && <p>{task.error}</p>}
                            {task.toolTimeline?.length ? (
                              <div className="mini-list">
                                {task.toolTimeline.slice(-6).map(event => (
                                  <code key={event.id}>
                                    {new Date(event.timestamp).toLocaleTimeString()} · {event.toolName} · {event.status}
                                    {event.summary ? ` · ${event.summary}` : ''}
                                  </code>
                                ))}
                              </div>
                            ) : null}
                            {task.outputPreview && <pre>{task.outputPreview}</pre>}
                            <div className="section-actions">
                              <button className="tool-button" onClick={() => handleAgentTaskReadOutputClick(task.id)} disabled={!canQueueRuntimePrompt || !!loadingLabel}>
                                <Icon name="clipboard" />Read output
                              </button>
                              <button className="tool-button" onClick={() => handleAgentTaskPreviewOutputClick(task.id)} disabled={!activeSession || !task.outputFile || !!loadingLabel}>
                                <Icon name="open" />Preview file
                              </button>
                              <button className="tool-button" onClick={() => handleAgentTaskResumeClick(task.id)} disabled={!canQueueRuntimePrompt || !agentTaskPrompt.trim() || !!loadingLabel}>
                                <Icon name="play" />Resume
                              </button>
                              <button className="tool-button danger" onClick={() => handleAgentTaskStopClick(task.id)} disabled={!canQueueRuntimePrompt || task.status !== 'running' || !!loadingLabel}>
                                <Icon name="square" />Stop
                              </button>
                            </div>
                          </article>
                        )) : (
                          <div className="workarea-empty settings-empty-state">
                            <Icon name="play" />
                            <strong>No running agent tasks</strong>
                            <span>Launch an agent task to track its output, tools, and runtime controls here.</span>
                          </div>
                        )}
                      </div>
                      {activeSession?.toolUses?.length ? (
                        <div className="mini-list">
                          <strong>Session tool uses</strong>
                          {activeSession.toolUses.slice(-8).map(event => (
                            <code key={event.id}>
                              {new Date(event.timestamp).toLocaleTimeString()} · {event.toolName} · {event.status}
                              {event.summary ? ` · ${event.summary}` : ''}
                            </code>
                          ))}
                        </div>
                      ) : null}

                    <section className="settings-section" id="agents-activity">
                      <h3>RPC Activity & Agent Steps</h3>
                      <p className="section-copy">All JSON-RPC messages and agent execution steps captured in real-time from the runtime session.</p>
                      <div className="activity-toolbar">
                        <div className="filter-tabs">
                          <button 
                            className={rpcMessageFilter === 'all' ? 'active' : ''} 
                            onClick={() => setRpcMessageFilter('all')}
                            disabled={!!loadingLabel}
                          >
                            All ({rpcMessages.length})
                          </button>
                          <button 
                            className={rpcMessageFilter === 'tool' ? 'active' : ''} 
                            onClick={() => setRpcMessageFilter('tool')}
                            disabled={!!loadingLabel}
                          >
                            Tools
                          </button>
                          <button 
                            className={rpcMessageFilter === 'message' ? 'active' : ''} 
                            onClick={() => setRpcMessageFilter('message')}
                            disabled={!!loadingLabel}
                          >
                            Messages
                          </button>
                          <button 
                            className={rpcMessageFilter === 'system' ? 'active' : ''} 
                            onClick={() => setRpcMessageFilter('system')}
                            disabled={!!loadingLabel}
                          >
                            System
                          </button>
                        </div>
                        <label className="autoscroll-toggle">
                          <input
                            type="checkbox"
                            checked={rpcAutoScroll}
                            onChange={e => setRpcAutoScroll(e.target.checked)}
                          />
                          Auto-scroll
                        </label>
                        <button 
                          className="tool-button" 
                          onClick={copySelectedRpcJson}
                          disabled={!selectedRpcMessage}
                          title="Copy raw JSON to clipboard"
                        >
                          <Icon name="clipboard" />Copy
                        </button>
                        <button 
                          className="tool-button" 
                          onClick={exportAllRpcMessages}
                          disabled={rpcMessages.length === 0}
                          title="Export all messages as JSON"
                        >
                          <Icon name="save" />Export
                        </button>
                        <button 
                          className="tool-button" 
                          onClick={() => { setRpcMessages([]); setSelectedRpcMessage(undefined) }}
                          disabled={!!loadingLabel || rpcMessages.length === 0}
                        >
                          <Icon name="trash" />Clear
                        </button>
                      </div>
                      <div className="activity-layout">
                        <div className="activity-timeline" ref={rpcTimelineRef} role="log" aria-label="RPC message timeline">
                          {(() => {
                            const sessionMessages = activeSessionId ? rpcMessages.filter(msg => msg.sessionId === activeSessionId) : rpcMessages
                            if (sessionMessages.length === 0) {
                            return (
                            <div className="workarea-empty settings-empty-state">
                              <Icon name="terminal" />
                              <strong>No RPC activity yet</strong>
                              <span>Start a chat session or run an agent to capture JSON-RPC messages here.</span>
                            </div>
                            )}
                            const filtered = sessionMessages.filter(msg => {
                              if (rpcMessageFilter === 'all') return true
                              if (rpcMessageFilter === 'tool') return msg.parsed?.isToolUse || msg.type.includes('tool')
                              if (rpcMessageFilter === 'message') return ['user', 'assistant', 'tool'].includes(msg.type)
                              if (rpcMessageFilter === 'system') return msg.type === 'system' || msg.type === 'system_init' || msg.type === 'stream_event'
                              return true
                            })
                            const reversed = [...filtered].reverse()
                            return reversed.map(msg => {
                              const time = new Date(msg.timestamp).toLocaleTimeString()
                              const isSelected = selectedRpcMessage?.id === msg.id
                              const isTool = msg.parsed?.isToolUse
                              const typeLabel = msg.subtype ? `${msg.type}/${msg.subtype}` : msg.type
                              let label = msg.parsed?.toolName 
                                ? `🔧 ${msg.parsed.toolName}` 
                                : msg.parsed?.content?.slice(0, 80)?.replace(/\n/g, ' ') ?? typeLabel
                              if (msg.parsed?.thinking) label = `💭 ${label}`
                              return (
                                <button
                                  key={msg.id}
                                  className={`activity-item ${isSelected ? 'selected' : ''} ${isTool ? 'tool-event' : ''}`}
                                  onClick={() => setSelectedRpcMessage(msg)}
                                  aria-selected={isSelected}
                                >
                                  <span className="activity-time">{time}</span>
                                  <span className={`activity-direction ${msg.direction}`} title={msg.direction}>{msg.direction === 'outgoing' ? '↑' : '↓'}</span>
                                  <span className="activity-type">{typeLabel}</span>
                                  <span className="activity-label">{label}</span>
                                </button>
                              )
                            })
                          })()}
                        </div>
                        <div className="activity-detail">
                          {selectedRpcMessage ? (
                            <div>
                              <div className="activity-detail-header">
                                <strong>Message Details</strong>
                                <small>{new Date(selectedRpcMessage.timestamp).toLocaleString()}</small>
                              </div>
                              <div className="activity-meta">
                                <div><small>Type</small><code>{selectedRpcMessage.type}</code></div>
                                {selectedRpcMessage.subtype && <div><small>Subtype</small><code>{selectedRpcMessage.subtype}</code></div>}
                                <div><small>Session</small><code>{selectedRpcMessage.sessionId.slice(0, 12)}...</code></div>
                                <div><small>Direction</small><code>{selectedRpcMessage.direction}</code></div>
                              </div>
                              {selectedRpcMessage.parsed?.toolName && (
                                <div className="activity-parsed">
                                  <small>Tool call</small>
                                  <strong>{selectedRpcMessage.parsed.toolName}</strong>
                                </div>
                              )}
                              {selectedRpcMessage.parsed?.content && (
                                <div className="activity-parsed">
                                  <small>Content preview</small>
                                  <pre>{selectedRpcMessage.parsed.content}</pre>
                                </div>
                              )}
                              {selectedRpcMessage.parsed?.thinking && (
                                <div className="activity-parsed thinking">
                                  <small>Thinking</small>
                                  <pre>{selectedRpcMessage.parsed.thinking}</pre>
                                </div>
                              )}
                              <div className="activity-raw">
                                <small>Raw JSON-RPC payload</small>
                                <pre>{JSON.stringify(selectedRpcMessage.raw, null, 2)}</pre>
                              </div>
                            </div>
                          ) : (
                            <div className="workarea-empty settings-empty-state">
                              <Icon name="search" />
                              <strong>Select a message</strong>
                              <span>Click on a timeline item to inspect full raw JSON-RPC data.</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </section>
                    </section>
                  </>
                )}

                {activePane === 'teams' && (
                <section className="settings-section" id="agents-teams">
                  <h3>Teams</h3>
                  <p className="section-copy">A team groups multiple teammates. Select a team to message all members with <code>*</code>, or choose one teammate row as the recipient.</p>
                  <div className="settings-form">
                    {teamDraftSessionBlocked && (
                      <div className="form-note">
                        Select a project session before managing teams.
                      </div>
                    )}
                    <div className="form-row">
                      <input
                        value={teamDraft.teamName}
                        onChange={handleTeamDraftTeamNameChange}
                        placeholder="team name"
                        aria-label="Team name"
                        disabled={teamDraftSessionBlocked || !!loadingLabel}
                      />
                      <input
                        value={teamDraft.agentType}
                        onChange={handleTeamDraftAgentTypeChange}
                        placeholder="lead agent type"
                        aria-label="Team lead agent type"
                        disabled={teamDraftSessionBlocked || !!loadingLabel}
                      />
                    </div>
                    <input
                      value={teamDraft.description}
                      onChange={handleTeamDraftDescriptionChange}
                      placeholder="team purpose"
                      aria-label="Team purpose"
                      disabled={teamDraftSessionBlocked || !!loadingLabel}
                    />
                    <div className="form-row">
                      <input
                        value={teamDraft.teammateAgentType}
                        onChange={handleTeamDraftTeammateAgentTypeChange}
                        placeholder="teammate agent type"
                        aria-label="Team teammate agent type"
                        disabled={teamDraftSessionBlocked || !!loadingLabel}
                      />
                      <input
                        value={teamDraft.teammateName}
                        onChange={handleTeamDraftTeammateNameChange}
                        placeholder="new teammate name"
                        aria-label="Team teammate name"
                        disabled={teamDraftSessionBlocked || !!loadingLabel}
                      />
                      <input
                        value={teamDraft.teammateMode}
                        onChange={handleTeamDraftTeammateModeChange}
                        placeholder="teammate mode"
                        aria-label="Team teammate mode"
                        disabled={teamDraftSessionBlocked || !!loadingLabel}
                      />
                    </div>
                    <textarea
                      value={teamDraft.teammatePrompt}
                      onChange={handleTeamDraftTeammatePromptChange}
                      placeholder="task prompt for new teammate"
                      aria-label="Team teammate prompt"
                      disabled={teamDraftSessionBlocked || !!loadingLabel}
                    />
                    <div className="form-row">
                      <input
                        value={teamDraft.to}
                        onChange={handleTeamDraftMessageRecipientChange}
                        placeholder="teammate name or *"
                        aria-label="Team message recipient"
                        disabled={teamDraftSessionBlocked || !!loadingLabel}
                      />
                      <input
                        value={teamDraft.shutdownReason}
                        onChange={handleTeamDraftShutdownReasonChange}
                        placeholder="shutdown reason"
                        aria-label="Team shutdown reason"
                        disabled={teamDraftSessionBlocked || !!loadingLabel}
                      />
                    </div>
                    <textarea
                      value={teamDraft.message}
                      ref={teamMessageTextareaRef}
                      onChange={handleTeamDraftMessageChange}
                      placeholder="message for selected teammate"
                      aria-label="Team message"
                      disabled={teamDraftSessionBlocked || !!loadingLabel}
                    />
                    <div className="section-actions">
                      <button className="tool-button" onClick={handleTeamFormCreateClick} disabled={!activeSession || !teamDraft.teamName.trim() || !!loadingLabel}>
                        <Icon name="plus" />Create team
                      </button>
                      <button className="tool-button" onClick={handleTeamFormSpawnTeammateClick} disabled={!canQueueRuntimePrompt || !teamDraft.teamName.trim() || !teamDraft.teammateName.trim() || !teamDraft.teammatePrompt.trim() || !!loadingLabel}>
                        <Icon name="bot" />Spawn teammate
                      </button>
                      <button className="tool-button" onClick={handleTeamFormSendClick} disabled={!canQueueRuntimePrompt || !teamDraft.teamName.trim() || !teamDraft.to.trim() || !teamDraft.message.trim() || !!loadingLabel}>
                        <Icon name="send" />Send
                      </button>
                      <button className="tool-button" onClick={handleTeamFormShutdownClick} disabled={!canQueueRuntimePrompt || !teamDraft.teamName.trim() || !teamDraft.to.trim() || !!loadingLabel}>
                        <Icon name="square" />Shutdown
                      </button>
                      <button className="tool-button danger" onClick={handleTeamFormDeleteClick} disabled={!activeSession || !teamDraft.teamName.trim() || !!loadingLabel}>
                        <Icon name="trash" />Delete team
                      </button>
                    </div>
                  </div>
                  <div id="team-listbox" className="config-list" role="listbox" aria-label="Teams" aria-activedescendant={activeTeamOptionId()}>
                    {teams.length ? teams.map(team => {
                      const teamName = team.name.trim()
                      return (
                        <article
                          key={teamName}
                          id={teamOptionId(team)}
                          role="option"
                          aria-selected={isTeamItemActive(team)}
                          aria-disabled={!activeSession || !!loadingLabel}
                          {...teamCardState(team)}
                          tabIndex={!activeSession || loadingLabel ? -1 : 0}
                          onClick={() => handleTeamRowSelectClick(team)}
                          onKeyDown={event => handleTeamRowKeyDown(event, team)}
                        >
                          <strong>{team.name}</strong>
                        <small>
                          {team.members.length} member{team.members.length === 1 ? '' : 's'}
                          {team.backend ? ` · ${team.backend}` : ''}
                          {team.mode ? ` · ${team.mode}` : ''}
                          {team.status ? ` · ${team.status}` : ''}
                          {team.active !== undefined ? ` · ${team.active ? 'active' : 'inactive'}` : ''}
                        </small>
                        {team.description && <p>{team.description}</p>}
                        <div className="team-member-list" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                          {team.members.length ? team.members.map(member => (
                            <div
                              key={member.agentId || member.name}
                              className="team-member-row"
                            >
                              <button
                                className="team-member-select"
                                type="button"
                                disabled={!activeSession || !!loadingLabel}
                                onClick={() => handleTeamMemberSelectClick(team, member)}
                              >
                                <span>@{member.name}</span>
                                <small>
                                  {[member.color, member.mode, member.status].filter(Boolean).join(' · ') || 'teammate'}
                                </small>
                              </button>
                              <button
                                className="icon-button"
                                type="button"
                                title={`Message ${member.name}`}
                                aria-label={`Message ${member.name}`}
                                data-tooltip={`Message ${member.name}`}
                                onClick={() => handleTeamMemberMessageClick(team, member)}
                                disabled={!activeSession || !!loadingLabel}
                              >
                                <Icon name="send" />
                              </button>
                              <button
                                className="icon-button danger"
                                type="button"
                                title={`Shutdown ${member.name}`}
                                aria-label={`Shutdown ${member.name}`}
                                data-tooltip={`Shutdown ${member.name}`}
                                onClick={() => handleTeamMemberShutdownClick(team, member)}
                                disabled={!canQueueRuntimePrompt || !!loadingLabel}
                              >
                                <Icon name="square" />
                              </button>
                              <button
                                className="icon-button danger"
                                type="button"
                                title={`Remove ${member.name}`}
                                aria-label={`Remove ${member.name} from ${team.name}`}
                                data-tooltip={`Remove ${member.name}`}
                                onClick={() => handleTeamMemberRemoveClick(team, member)}
                                disabled={!activeSession || !!loadingLabel}
                              >
                                <Icon name="trash" />
                              </button>
                            </div>
                          )) : (
                            <div className="team-member-empty workarea-empty">
                              <Icon name="users" />
                              <strong>No teammates reported</strong>
                              <span>Spawn a teammate or refresh Teams after agents join this team.</span>
                            </div>
                          )}
                        </div>
                        <div className="section-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                          <button className="tool-button" onClick={() => handleTeamRowSelectClick(team)} disabled={!activeSession || !!loadingLabel}>
                            <Icon name="panel" />Select
                          </button>
                          <button className="tool-button" onClick={() => handleTeamRowMessageAllClick(team)} disabled={!activeSession || !!loadingLabel}>
                            <Icon name="send" />Message all
                          </button>
                          <button className="tool-button danger" onClick={() => handleTeamRowDeleteClick(team)} disabled={!activeSession || !!loadingLabel}>
                            <Icon name="trash" />Delete team
                          </button>
                        </div>
                        </article>
                      )
                    }) : (
                      <div className="workarea-empty settings-empty-state">
                        <Icon name="users" />
                        <strong>No teams found</strong>
                        <span>Create a team in this workspace to manage teammates from the Teams page.</span>
                      </div>
                    )}
                  </div>
                </section>
                )}
              </div>
            )}

            {activePane === 'tasks' && (
              <div
                className="tasks-pane"
                role="region"
                aria-label="Scheduled task management"
                aria-busy={!!loadingLabel}
                ref={element => {
                  if (element) flushPendingPaneSection('tasks')
                }}
              >
                <div className="pane-toolbar">
                  <span>
                    Scheduled Tasks · {projectTasks.length} project · {desktopConfig?.scheduledTasks.length ?? 0} global
                  </span>
                  <div className="pane-toolbar-actions">
                    {loadingLabel && <span className="pane-loading-status" role="status">{loadingLabel}</span>}
                    <button className="tool-button" onClick={handleSettingsRefreshClick} disabled={!!loadingLabel}>
                      <Icon name="refresh" />Refresh
                    </button>
                  </div>
                </div>
                <nav className="pane-jumpbar" aria-label="Scheduled task sections">
                  <button {...paneJumpbarButtonState(tasksActiveSection === 'tasks-project-tasks')} onClick={handleProjectTasksSectionClick}>Project</button>
                  <button {...paneJumpbarButtonState(tasksActiveSection === 'tasks-global-tasks')} onClick={handleGlobalTasksSectionClick}>Global</button>
                </nav>
                {tasksStatus && (
                  <div className={`pane-status ${tasksStatus.kind}`} role="status">
                    {tasksStatus.text}
                  </div>
                )}
                {renderProjectScheduledTasksSection('tasks-project-tasks')}
                {renderGlobalScheduledTasksSection('tasks-global-tasks')}
              </div>
            )}

            {activePane === 'mcp' && (
              <div
                className="mcp-pane"
                role="region"
                aria-label="MCP server management"
                aria-busy={!!loadingLabel}
                ref={element => {
                  if (element) flushPendingPaneSection('mcp')
                }}
              >
                <div className="pane-toolbar">
                  <span>
                    MCP Servers · {desktopConfig?.mcpServers.length ?? 0} user · {projectMcpServers.length} project
                  </span>
                  <div className="pane-toolbar-actions">
                    {loadingLabel && <span className="pane-loading-status" role="status">{loadingLabel}</span>}
                    <button className="tool-button" onClick={handleSettingsRefreshClick} disabled={!!loadingLabel}>
                      <Icon name="refresh" />Refresh
                    </button>
                  </div>
                </div>
                <nav className="pane-jumpbar" aria-label="MCP sections">
                  <button {...paneJumpbarButtonState(mcpActiveSection === 'mcp-servers')} onClick={() => openPaneSection('mcp', 'mcp-servers', 'mcp')}>
                    Servers
                  </button>
                  <button {...paneJumpbarButtonState(mcpActiveSection === 'mcp-health')} onClick={() => { openPaneSection('mcp', 'mcp-health', 'mcp'); void checkMcpHealth() }}>
                    Health Check
                  </button>
                </nav>
                {mcpStatus && (
                  <div className={`pane-status ${mcpStatus.kind}`} role="status">
                    {mcpStatus.text}
                  </div>
                )}
                <section className="settings-section" id="mcp-servers">
                  <h3>MCP Servers</h3>
                  <p className="section-copy">Manage Model Context Protocol servers for user-wide or project-scoped tool access.</p>
                  <div className="settings-form">
                    <div className="form-row">
                      <input
                        value={mcpDraft.name}
                        onChange={handleMcpDraftNameChange}
                        placeholder="server name"
                        aria-label="MCP server name"
                        disabled={mcpDraftSessionBlocked || !!loadingLabel}
                      />
                      <select
                        value={mcpDraft.scope}
                        aria-label="MCP server scope"
                        disabled={!!loadingLabel}
                        onChange={handleMcpDraftScopeChange}
                      >
                        <option value="user">user scope</option>
                        <option value="project">project scope</option>
                      </select>
                    </div>
                    <div className="form-row">
                      <select
                        value={mcpDraft.mode}
                        aria-label="MCP server mode"
                        disabled={mcpDraftSessionBlocked || !!loadingLabel}
                        onChange={handleMcpDraftModeChange}
                      >
                        <option value="stdio">stdio</option>
                        <option value="remote">remote</option>
                      </select>
                    </div>
                    {mcpDraft.mode === 'stdio' ? (
                      <div className="form-row">
                        <input
                          value={mcpDraft.command}
                          onChange={handleMcpDraftCommandChange}
                          placeholder="command"
                          aria-label="MCP command"
                          disabled={mcpDraftSessionBlocked || !!loadingLabel}
                        />
                        <input
                          value={mcpDraft.args}
                          onChange={handleMcpDraftArgsChange}
                          placeholder="args"
                          aria-label="MCP command arguments"
                          disabled={mcpDraftSessionBlocked || !!loadingLabel}
                        />
                      </div>
                    ) : (
                      <div className="form-row">
                        <select
                          value={mcpDraft.type}
                          aria-label="MCP remote type"
                          disabled={mcpDraftSessionBlocked || !!loadingLabel}
                          onChange={handleMcpDraftRemoteTypeChange}
                        >
                          <option value="streamable-http">streamable-http</option>
                          <option value="sse">sse</option>
                        </select>
                        <input
                          value={mcpDraft.url}
                          onChange={handleMcpDraftRemoteUrlChange}
                          placeholder={mcpDraft.editingName ? 'leave blank to keep current URL' : 'https://mcp.example/server'}
                          aria-label="MCP remote URL"
                          disabled={mcpDraftSessionBlocked || !!loadingLabel}
                        />
                      </div>
                    )}
                    {mcpProjectNeedsSession && (
                      <div className="form-note">Project-scoped servers require selecting a workspace session.</div>
                    )}
                    <div className="section-actions">
                      <button className="tool-button" onClick={handleMcpSaveClick} disabled={!canSaveMcpDraft || !!loadingLabel}>
                        <Icon name={mcpDraft.editingName ? 'save' : 'plus'} />{mcpDraft.editingName ? 'Save changes' : 'Add server'}
                      </button>
                      {mcpDraft.editingName && (
                        <button className="tool-button" onClick={cancelMcpDraft} disabled={!!loadingLabel}>
                          <Icon name="x" />Cancel edit
                        </button>
                      )}
                      <button className="tool-button" onClick={() => void checkMcpHealth()} disabled={!!loadingLabel}>
                        <Icon name="refresh" />Check health
                      </button>
                    </div>
                  </div>
                  <div className="mini-section">
                    <h4>User servers ({desktopConfig?.mcpServers.length ?? 0})</h4>
                    {desktopConfig?.mcpServers.length ? (
                      <div className="resource-list">
                        {desktopConfig.mcpServers.map(server => (
                          <article key={`user-${server.name}`} className={`resource-row ${selectedMcpDetail?.name === server.name && selectedMcpDetailScope === 'user' ? 'selected' : ''}`} onClick={() => handleMcpInspectClick(server, 'user')}>
                            <strong>{server.name}</strong>
                            <small>
                              user · {server.approvalStatus ?? 'enabled'} · {server.type ?? server.command ?? 'stdio'} · {server.sourcePath}
                            </small>
                            {server.url && <code>{server.url}</code>}
                            {server.args?.length ? <code>{server.args.join(' ')}</code> : null}
                            <div className="section-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                              <button className="tool-button" onClick={() => handleMcpInspectClick(server, 'user')} disabled={!!loadingLabel}>
                                <Icon name="file" />Inspect
                              </button>
                              <button className="tool-button" onClick={() => handleMcpEditClick(server, 'user')} disabled={!!loadingLabel}>
                                <Icon name="pencil" />Edit
                              </button>
                              <button className="tool-button danger" onClick={() => handleMcpRemoveClick(server, 'user')} disabled={!!loadingLabel}>
                                <Icon name="trash" />Remove
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="workarea-empty settings-empty-state">
                        <Icon name="terminal" />
                        <strong>No user MCP servers</strong>
                        <span>Add a user-scoped MCP server above for global tool access across all projects.</span>
                      </div>
                    )}
                  </div>
                  <div className="mini-section">
                    <h4>Project servers ({projectMcpServers.length})</h4>
                    {projectMcpServers.length ? (
                      <div className="resource-list">
                        {projectMcpServers.map(server => (
                          <article key={`project-${server.name}`} className={`resource-row ${selectedMcpDetail?.name === server.name && selectedMcpDetailScope === 'project' ? 'selected' : ''}`} onClick={() => handleMcpInspectClick(server, 'project')}>
                            <strong>{server.name}</strong>
                            <small>
                              project · {server.approvalStatus ?? 'pending'} · {server.type ?? server.command ?? 'stdio'} · {server.sourcePath}
                            </small>
                            {server.url && <code>{server.url}</code>}
                            {server.args?.length ? <code>{server.args.join(' ')}</code> : null}
                            <div className="section-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                              <button className="tool-button" onClick={() => handleMcpInspectClick(server, 'project')} disabled={!activeSession || !!loadingLabel}>
                                <Icon name="file" />Inspect
                              </button>
                              <button className="tool-button" onClick={() => handleMcpEditClick(server, 'project')} disabled={!activeSession || !!loadingLabel}>
                                <Icon name="pencil" />Edit
                              </button>
                              <button className="tool-button" onClick={() => approveProjectMcpServer(server)} disabled={!activeSession || server.approvalStatus === 'approved' || !!loadingLabel}>
                                <Icon name="check" />Approve
                              </button>
                              <button className="tool-button" onClick={() => rejectProjectMcpServer(server)} disabled={!activeSession || server.approvalStatus === 'rejected' || !!loadingLabel}>
                                <Icon name="x" />Reject
                              </button>
                              <button className="tool-button danger" onClick={() => handleMcpRemoveClick(server, 'project')} disabled={!activeSession || !!loadingLabel}>
                                <Icon name="trash" />Remove
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : activeSession ? (
                      <div className="workarea-empty settings-empty-state">
                        <Icon name="settings" />
                        <strong>No project MCP servers</strong>
                        <span>Add a project-scoped MCP server to write this workspace's .mcp.json.</span>
                      </div>
                    ) : (
                      <div className="workarea-empty settings-empty-state">
                        <Icon name="folder" />
                        <strong>Select a project session</strong>
                        <span>Select a session to manage project MCP servers for that workspace.</span>
                      </div>
                    )}
                  </div>
                </section>
                <section className="settings-section" id="mcp-health">
                  <h3>MCP Health Check</h3>
                  <p className="section-copy">Verify connectivity and tool listing for all configured MCP servers.</p>
                  <div className="section-actions">
                    <button className="tool-button" onClick={() => void checkMcpHealth()} disabled={!!loadingLabel}>
                      <Icon name="refresh" />Run health check
                    </button>
                  </div>
                  {mcpHealthOutput ? (
                    <pre className="health-output">{mcpHealthOutput.output}</pre>
                  ) : (
                    <div className="workarea-empty settings-empty-state">
                      <Icon name="terminal" />
                      <strong>No health check run yet</strong>
                      <span>Click "Run health check" to verify all configured MCP servers.</span>
                    </div>
                  )}
                </section>
              </div>
            )}

            {activePane === 'skills' && (
              <div
                className="skills-pane"
                role="region"
                aria-label="Skills management"
                aria-busy={!!loadingLabel}
                ref={element => {
                  if (element) flushPendingPaneSection('skills')
                }}
              >
                <div className="pane-toolbar">
                  <span>
                    Skills · {desktopConfig?.skills.length ?? 0} user · {projectSkills.length} project
                  </span>
                  <div className="pane-toolbar-actions">
                    {loadingLabel && <span className="pane-loading-status" role="status">{loadingLabel}</span>}
                    <button className="tool-button" onClick={handleSettingsRefreshClick} disabled={!!loadingLabel}>
                      <Icon name="refresh" />Refresh
                    </button>
                  </div>
                </div>
                <nav className="pane-jumpbar" aria-label="Skills sections">
                  <button {...paneJumpbarButtonState(skillsActiveSection === 'skills-installed')} onClick={() => openPaneSection('skills', 'skills-installed', 'skills')}>
                    Installed
                  </button>
                  <button {...paneJumpbarButtonState(skillsActiveSection === 'skills-create')} onClick={() => openPaneSection('skills', 'skills-create', 'skills')}>
                    Create
                  </button>
                </nav>
                {skillsStatus && (
                  <div className={`pane-status ${skillsStatus.kind}`} role="status">
                    {skillsStatus.text}
                  </div>
                )}
                <section className="settings-section" id="skills-installed">
                  <h3>Installed Skills</h3>
                  <p className="section-copy">Skills are reusable instruction bundles that extend Claude's capabilities.</p>
                  <div className="mini-section">
                    <h4>User skills ({desktopConfig?.skills.length ?? 0})</h4>
                    {desktopConfig?.skills.length ? (
                      <div className="resource-list">
                        {desktopConfig.skills.map(skill => (
                          <article key={`user-${skill.name}`} className={`resource-row ${selectedSkillDetail?.name === skill.name && selectedSkillDetailScope === 'user' ? 'selected' : ''}`} onClick={() => handleSkillInspectClick(skill, 'user')}>
                            <strong>{skill.name}</strong>
                            <small>user · {skill.path}</small>
                            <div className="section-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                              <button className="tool-button" onClick={() => handleSkillInspectClick(skill, 'user')} disabled={!!loadingLabel}>
                                <Icon name="file" />View
                              </button>
                              <button className="tool-button danger" onClick={() => handleSkillRemoveClick(skill, 'user')} disabled={!!loadingLabel}>
                                <Icon name="trash" />Remove
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="workarea-empty settings-empty-state">
                        <Icon name="bot" />
                        <strong>No user skills installed</strong>
                        <span>Create a user skill above or install one from a local folder.</span>
                      </div>
                    )}
                  </div>
                  <div className="mini-section">
                    <h4>Project skills ({projectSkills.length})</h4>
                    {projectSkills.length ? (
                      <div className="resource-list">
                        {projectSkills.map(skill => (
                          <article key={`project-${skill.name}`} className={`resource-row ${selectedSkillDetail?.name === skill.name && selectedSkillDetailScope === 'project' ? 'selected' : ''}`} onClick={() => handleSkillInspectClick(skill, 'project')}>
                            <strong>{skill.name}</strong>
                            <small>project · {skill.path}</small>
                            <div className="section-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                              <button className="tool-button" onClick={() => handleSkillInspectClick(skill, 'project')} disabled={!activeSession || !!loadingLabel}>
                                <Icon name="file" />View
                              </button>
                              <button className="tool-button danger" onClick={() => handleSkillRemoveClick(skill, 'project')} disabled={!activeSession || !!loadingLabel}>
                                <Icon name="trash" />Remove
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : activeSession ? (
                      <div className="workarea-empty settings-empty-state">
                        <Icon name="bot" />
                        <strong>No project skills installed</strong>
                        <span>Create a project skill or install one from a local folder for this workspace.</span>
                      </div>
                    ) : (
                      <div className="workarea-empty settings-empty-state">
                        <Icon name="folder" />
                        <strong>Select a project session</strong>
                        <span>Select a session to manage project skills for that workspace.</span>
                      </div>
                    )}
                  </div>
                </section>
                <section className="settings-section" id="skills-create">
                  <h3>Create New Skill</h3>
                  <div className="settings-form">
                    <div className="form-row">
                      <select
                        value={skillDraft?.scope ?? 'user'}
                        aria-label="Skill scope"
                        disabled={skillDraftSessionBlocked || !!loadingLabel}
                        onChange={event => startSkillDraft(event.target.value as 'user' | 'project')}
                      >
                        <option value="user">user scope</option>
                        <option value="project">project scope</option>
                      </select>
                    </div>
                    <div className="form-row">
                      <input
                        value={skillDraft?.name ?? ''}
                        onChange={event => setSkillDraft(prev => prev ? { ...prev, name: event.target.value } : { scope: 'user', name: event.target.value })}
                        placeholder="skill name (e.g. my-skill)"
                        aria-label="Skill name"
                        disabled={skillDraftSessionBlocked || !!loadingLabel}
                      />
                    </div>
                    <div className="form-note">
                      Skill content is managed via SKILL.md file. After creation, edit the SKILL.md directly.
                    </div>
                    <div className="section-actions">
                      <button className="tool-button" onClick={handleSkillSaveClick} disabled={!canSaveSkillDraft(skillDraft, Boolean(activeSession)) || !!loadingLabel}>
                        <Icon name="plus" />Create skill
                      </button>
                      <button className="tool-button" onClick={() => void installLocalSkill()} disabled={skillDraft?.scope === 'project' && !activeSession || !!loadingLabel}>
                        <Icon name="plus" />Install local skill
                      </button>
                      {skillDraft?.scope === 'project' && (
                        <button className="tool-button" onClick={() => void installProjectSkill()} disabled={!activeSession || !!loadingLabel}>
                          <Icon name="plus" />Install to project
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedSkillDetail && (() => {
                    const scoped = selectedSkillDetailScope === 'project'
                    return (
                      <div className="settings-section" aria-label="Selected skill details">
                        <h3>{selectedSkillDetail.name}</h3>
                        <p className="section-copy">{selectedSkillDetailScope} · {selectedSkillDetail.path}</p>
                        {selectedSkillDetail.description && <p>{selectedSkillDetail.description}</p>}
                      </div>
                    )
                  })()}
                </section>
              </div>
            )}

            {activePane === 'settings' && (
              <div
                className="settings-pane"
                aria-busy={!!loadingLabel}
                ref={element => {
                  if (element) flushPendingPaneSection('settings')
                }}
              >
                <div className="settings-layout">
                  <aside className="settings-sidebar" aria-label="Settings navigation">
                    <button className="settings-back-button" onClick={handleSettingsBackClick} disabled={!!loadingLabel}>
                      <Icon name="chevron-left" />Back to app
                    </button>
                    <input
                      value={settingsSearch}
                      onChange={handleSettingsSearchChange}
                      onKeyDown={handleSettingsSearchKeyDown}
                      placeholder="Search settings..."
                      aria-label="Search settings"
                      aria-describedby="settings-search-results"
                      disabled={!!loadingLabel}
                      role="combobox"
                      aria-expanded="true"
                      aria-controls="settings-nav-listbox"
                      aria-activedescendant={activeSettingsNavItem ? settingsNavOptionId(activeSettingsNavItem) : undefined}
                    />
                    <div id="settings-search-results" className="settings-search-results" role="status">
                      {settingsSearch.trim()
                        ? visibleSettingsNavItems.length
                          ? `${visibleSettingsNavItems.length} matching setting${visibleSettingsNavItems.length === 1 ? '' : 's'}`
                          : 'No matching settings'
                        : 'Type to filter settings'}
                    </div>
                    <nav id="settings-nav-listbox" className="settings-nav" aria-label="Settings groups" role="listbox">
                      {visibleSettingsNavGroups.map(group => (
                        <div className="settings-nav-group" key={group.label} role="group" aria-label={group.label}>
                          <span>{group.label}</span>
                          {group.items.map(item => (
                            <button
                              key={item.sectionId}
                              id={settingsNavOptionId(item)}
                              role="option"
                              aria-selected={isSettingsNavItemActive(item)}
                              {...settingsNavButtonState(item.sectionId)}
                              onClick={() => handleSettingsNavItemClick(item)}
                            >
                              <Icon name={item.icon} />{item.label}
                            </button>
                          ))}
                        </div>
                      ))}
                      {visibleSettingsNavGroups.length === 0 && (
                        <div className="settings-nav-empty">
                          <Icon name="search" />
                          <strong>No matching settings</strong>
                          <span>Try a shorter query or clear search to browse groups.</span>
                        </div>
                      )}
                    </nav>
                  </aside>
                  <div className="settings-content">
                    <div className="settings-content-header">
                      <div>
                        <div className="eyebrow">Settings</div>
                        <h2>Claude Code configuration</h2>
                      </div>
                      <div className="pane-toolbar-actions">
                        {loadingLabel && <span className="pane-loading-status" role="status">{loadingLabel}</span>}
                        <button className="tool-button" onClick={handleSettingsRefreshClick} disabled={!!loadingLabel}>
                          <Icon name="refresh" />Refresh
                        </button>
                      </div>
                    </div>
                    {settingsStatus && (
                      <div className={`pane-status ${settingsStatus.kind}`} role="status">
                        {settingsStatus.text}
                      </div>
                    )}

                <section className="settings-section" id="settings-runtime">
                  <h3>Runtime Settings</h3>
                  <div className="settings-grid">
                    <div>
                      <small>Claude home</small>
                      <code>{desktopConfig?.claudeHome ?? '~/.claude'}</code>
                    </div>
                    <div>
                      <small>settings.json</small>
                      <code>{desktopConfig?.settingsExists ? desktopConfig.settingsPath : 'Not found'}</code>
                    </div>
                    <div>
                      <small>settings.local.json</small>
                      <code>{desktopConfig?.localSettingsExists ? desktopConfig.localSettingsPath : 'Not found'}</code>
                    </div>
                  </div>
                  <div className="section-actions">
                    <button className="tool-button" onClick={handleDiagnosticsExportClick} disabled={!!loadingLabel}>
                      <Icon name="clipboard" />Export diagnostics
                    </button>
                  </div>
                  <pre>{rawSummary(desktopConfig?.settings ?? {})}</pre>
                </section>

                <section className="settings-section" id="settings-proxy">
                  <h3>Proxy</h3>
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={proxyDraft.enabled}
                      aria-label="Enable proxy for Claude Code runtime"
                      disabled={!!loadingLabel}
                      onChange={handleProxyEnabledChange}
                    />
                    Enable proxy for Claude Code runtime
                  </label>
                  <div className="proxy-row">
                    <input
                      value={proxyDraft.url}
                      onChange={handleProxyUrlChange}
                      placeholder="socks5://127.0.0.1:7890"
                      aria-label="Proxy URL"
                      disabled={!!loadingLabel}
                    />
                    <button className="tool-button" onClick={handleProxySaveClick} disabled={!canSaveProxy || !!loadingLabel}>
                      <Icon name="save" />Save
                    </button>
                  </div>
                  {proxyDraft.enabled && !canSaveProxy && (
                    <div className="form-note">
                      Proxy URL must start with socks5://, socks4://, http://, or https://.
                    </div>
                  )}
                </section>

                <section className="settings-section" id="settings-plugins">
                  <h3>Plugins</h3>
                  <p className="section-copy">Install and manage Codex plugins that extend functionality with skills, MCP servers, and commands.</p>
                  <div className="settings-form">
                    <div className="form-row">
                      <input
                        value={pluginDraft.plugin}
                        onChange={handlePluginDraftPackageChange}
                        placeholder="plugin or plugin@marketplace"
                        aria-label="Plugin package"
                        disabled={pluginDraftSessionBlocked || !!loadingLabel}
                      />
                      <select
                        value={pluginDraft.scope}
                        aria-label="Plugin install scope"
                        disabled={!!loadingLabel}
                        onChange={handlePluginDraftScopeChange}
                      >
                        <option value="user">user scope</option>
                        <option value="project">project scope</option>
                        <option value="local">local scope</option>
                      </select>
                    </div>
                    {pluginScopeNeedsSession && (
                      <div className="form-note">
                        Select a session to install project or local plugins.
                      </div>
                    )}
                    <div className="section-actions">
                      <button className="tool-button" onClick={handlePluginListClick} disabled={!!loadingLabel || !canRunPluginCommand}>
                        <Icon name="refresh" />List plugins
                      </button>
                      <button className="tool-button" onClick={handlePluginInstallClick} disabled={!!loadingLabel || !canInstallPlugin}>
                        <Icon name="plus" />Install plugin
                      </button>
                    </div>
                  </div>
                  {pluginOutput ? (
                    pluginOutput.text.trim() ? (
                      <pre>{`${pluginOutput.ok ? 'OK' : 'FAILED'}\n${pluginOutput.text}`}</pre>
                    ) : (
                      <div className="workarea-empty settings-empty-state plugin-output-empty">
                        <Icon name="settings" />
                        <strong>{pluginOutput.ok ? 'Plugin command completed' : 'Plugin command failed'}</strong>
                        <span>{pluginOutput.ok ? 'The plugin command completed without output.' : 'The plugin command failed without output.'}</span>
                      </div>
                    )
                  ) : null}
                  <div id="plugin-listbox" className="config-list" role="listbox" aria-label="Installed plugins" aria-activedescendant={activePluginOptionId()}>
                    {desktopConfig?.plugins.length ? desktopConfig.plugins.map(plugin => {
                      const pluginId = plugin.id.trim()
                      const pluginScope = plugin.scope === 'project'
                        ? 'project'
                        : plugin.scope === 'local'
                          ? 'local'
                          : 'user'
                      const pluginEnabled = plugin.enabled !== false
                      return (
                        <article
                          key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? ''}`}
                          id={pluginOptionId(plugin)}
                          role="option"
                          aria-selected={isPluginItemActive(plugin)}
                          aria-disabled={!canSelectPlugin(plugin)}
                          tabIndex={canSelectPlugin(plugin) ? 0 : -1}
                          onClick={() => handlePluginRowClick(plugin)}
                          onKeyDown={event => handlePluginRowKeyDown(event, plugin)}
                        >
                          <strong>{plugin.id}</strong>
                          <small>{plugin.scope ?? 'user'} · {plugin.version ?? 'unknown version'}</small>
                          {plugin.installPath && <code>{plugin.installPath}</code>}
                          <div className="row-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
                            <button
                              className="tool-button"
                              onClick={event => handlePluginUpdateClick(event, plugin)}
                              disabled={!canSelectPlugin(plugin) || !!loadingLabel}
                            >
                              <Icon name="refresh" />Update
                            </button>
                            <button
                              className="tool-button"
                              onClick={event => handlePluginToggleClick(event, plugin, !pluginEnabled)}
                              disabled={!canSelectPlugin(plugin) || !!loadingLabel}
                            >
                              {pluginEnabled ? <><Icon name="pause" />Disable</> : <><Icon name="play" />Enable</>}
                            </button>
                            <button
                              className="tool-button danger"
                              onClick={event => handlePluginUninstallClick(event, plugin)}
                              disabled={!canSelectPlugin(plugin) || !!loadingLabel}
                            >
                              <Icon name="trash" />Remove
                            </button>
                          </div>
                        </article>
                      )
                    }) : (
                      <div className="workarea-empty settings-empty-state">
                        <Icon name="settings" />
                        <strong>No plugins installed</strong>
                        <span>List available plugins or install a plugin package into the selected scope.</span>
                      </div>
                    )}
                  </div>
                </section>
                  </div>
                </div>
              </div>
            )}
          </section>
        </section>
      </section>

      {commandPaletteOpen && (
        <div className="modal-backdrop command-palette-backdrop">
          <section
            ref={commandPaletteRef}
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-palette-title"
            onKeyDown={handleCommandPaletteKeyDown}
          >
            <div className="command-palette-search">
              <Icon name="search" />
              <input
                ref={commandPaletteInputRef}
                value={commandPaletteQuery}
                onChange={handleCommandPaletteQueryChange}
                placeholder="Search commands"
                aria-label="Search commands"
                disabled={!!loadingLabel}
                role="combobox"
                aria-expanded="true"
                aria-controls="command-palette-list"
                aria-activedescendant={
                  commandPaletteItemsForQuery[commandPaletteActiveIndex]
                    ? commandPaletteOptionId(commandPaletteItemsForQuery[commandPaletteActiveIndex]!)
                    : undefined
                }
              />
              <button className="icon-button" title="Close" aria-label="Close command palette" data-tooltip="Close" onClick={closeCommandPalette}>
                <Icon name="x" />
              </button>
            </div>
            <h2 id="command-palette-title">Commands</h2>
            {commandPaletteStatus && (
              <div className={`command-palette-status ${commandPaletteStatus.kind}`} role="status">
                {commandPaletteStatus.text}
              </div>
            )}
            <div id="command-palette-list" className="command-palette-list" role="listbox" aria-label="Commands">
              {commandPaletteItemsForQuery.length ? commandPaletteItemsForQuery.map((item, index) => (
                <button
                  key={item.id}
                  id={commandPaletteOptionId(item)}
                  type="button"
                  role="option"
                  aria-selected={index === commandPaletteActiveIndex}
                  aria-disabled={item.disabled ? 'true' : undefined}
                  tabIndex={item.disabled ? -1 : 0}
                  className={index === commandPaletteActiveIndex ? 'active' : undefined}
                  onMouseEnter={() => !item.disabled && setCommandPaletteActiveIndex(index)}
                  onClick={() => runCommandPaletteItem(item)}
                >
                  <Icon name={item.icon} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.disabled ? `${item.detail} · ${item.disabledReason ?? 'unavailable'}` : item.detail}</small>
                  </span>
                </button>
              )) : (
                <div className="command-palette-empty" role="status">
                  <Icon name="search" />
                  <strong>No matching commands</strong>
                  <span>Try a shorter query or use the composer shortcuts.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {confirmRequest && (
        <div
          className="modal-backdrop"
          onClick={event => {
            if (event.target === event.currentTarget && !loadingLabel) {
              settleConfirmation(false)
            }
          }}
        >
          <section ref={confirmModalRef} className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
            <div className="eyebrow">Confirm action</div>
            <h2 id="confirmation-title">{confirmRequest.title}</h2>
            <p>{confirmRequest.message}</p>
            <div className="modal-actions">
              <button ref={confirmCancelButtonRef} className="tool-button" onClick={() => resolveConfirmationModal(false)} disabled={!!loadingLabel}>
                <Icon name="x" />
                {confirmRequest.cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={confirmRequest.tone === 'danger' ? 'tool-button danger strong' : 'send-button'}
                onClick={() => resolveConfirmationModal(true)}
                disabled={!!loadingLabel}
              >
                <Icon name={confirmRequest.tone === 'danger' ? 'trash' : 'play'} />
                {confirmRequest.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}

      {pendingPermission && (
        <div
          className="modal-backdrop"
          onClick={event => {
            if (event.target === event.currentTarget && !loadingLabel && !permissionResponding) {
              void respondToPermission('deny')
            }
          }}
        >
          <section ref={permissionModalRef} className="permission-modal" role="dialog" aria-modal="true" aria-labelledby="permission-title">
            <div className="eyebrow">Permission request</div>
            <h2 id="permission-title">{pendingPermission.toolName}</h2>
            <p>{pendingPermission.description}</p>
            {pendingPermission.blockedPath && (
              <p className="permission-detail">Blocked path: {pendingPermission.blockedPath}</p>
            )}
            {pendingPermission.decisionReason && (
              <p className="permission-detail">{pendingPermission.decisionReason}</p>
            )}
            {pendingPermission.agentContext && (
              <p className="permission-detail">{pendingPermission.agentContext}</p>
            )}
            {pendingPermission.teamContext && (
              <p className="permission-detail">{pendingPermission.teamContext}</p>
            )}
            <section className="permission-section" aria-label="Tool input">
              <h3>Tool input</h3>
              {renderPermissionInput(pendingPermission.input)}
            </section>
            {pendingPermission.permissionSuggestions?.length ? (
              <section className="permission-section" aria-label="Permission suggestions">
                <h3>Permission suggestions</h3>
                <pre>{rawSummary(pendingPermission.permissionSuggestions)}</pre>
              </section>
            ) : null}
            <section className="permission-section" aria-label="Raw request">
              <h3>Raw request</h3>
              <pre>{rawSummary(pendingPermission.raw)}</pre>
            </section>
            {permissionResponding && (
              <div className="permission-status" role="status">
                Sending permission response...
              </div>
            )}
            {pendingPermission.error && <div className="inline-error">{pendingPermission.error}</div>}
            <div className="modal-actions">
              <button className="tool-button" onClick={handlePermissionCancelTurnClick} disabled={!cancelAvailable || !!loadingLabel || permissionResponding}>
                <Icon name="square" />Cancel turn
              </button>
              <button ref={permissionDenyButtonRef} className="tool-button" onClick={() => handlePermissionResponseClick('deny')} disabled={!!loadingLabel || permissionResponding}>
                <Icon name="x" />Deny
              </button>
              <button ref={permissionAllowButtonRef} className="send-button" onClick={() => handlePermissionResponseClick('allow')} disabled={!!loadingLabel || permissionResponding}>
                <Icon name="check" />{permissionResponding ? 'Sending...' : 'Allow'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
