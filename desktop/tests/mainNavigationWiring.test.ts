import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop main navigation wiring', () => {
  const mainSource = readFileSync(join(process.cwd(), 'desktop/main/main.ts'), 'utf8')
  const rendererSource = readFileSync(join(process.cwd(), 'desktop/renderer/src/App.tsx'), 'utf8')
  const stylesSource = readFileSync(join(process.cwd(), 'desktop/renderer/src/styles.css'), 'utf8')
  const activeSessionGuard = 'if (activeSessionIdRef.current !== session.id) return'

  function expectGuardBetween(source: string, guard: string, after: string, before: string): void {
    const afterIndex = source.indexOf(after)
    const beforeIndex = source.indexOf(before, afterIndex)
    const guardIndex = source.indexOf(guard, afterIndex)
    expect(afterIndex).toBeGreaterThanOrEqual(0)
    expect(beforeIndex).toBeGreaterThan(afterIndex)
    expect(guardIndex).toBeGreaterThan(afterIndex)
    expect(guardIndex).toBeLessThan(beforeIndex)
  }

  it('uses the active renderer entry URL for top-level navigation policy', () => {
    expect(mainSource).toContain('navigationActionForUrl(targetUrl, activeRendererEntryUrl())')
    expect(mainSource).toContain('navigationActionForUrl(details.url, activeRendererEntryUrl())')
  })

  it('does not skip top-level navigation policy in dev mode', () => {
    expect(mainSource).not.toContain('if (!mainWindow || isDev) return')
  })

  it('keeps native View menu and renderer shortcuts aligned for first-class pages', () => {
    const pages = [
      ['Chat', 'chat', '1'],
      ['Agents', 'agents', '2'],
      ['Teams', 'teams', '3'],
      ['Tasks', 'tasks', '4'],
      ['Settings', 'settings', '5'],
    ] as const

    expect(mainSource).toContain("id: 'command-palette'")
    expect(mainSource).toContain("accelerator: 'CmdOrCtrl+K'")
    expect(rendererSource).toContain("event.key.toLowerCase() === 'k'")

    for (const [label, view, key] of pages) {
      expect(mainSource).toContain(`id: 'view-${view}'`)
      expect(mainSource).toContain(`label: '${label}'`)
      expect(mainSource).toContain(`accelerator: 'CmdOrCtrl+${key}'`)
      expect(mainSource).toContain(`sendDesktopEvent({ type: 'primary-nav', view: '${view}' })`)
      expect(rendererSource).toContain(`'${key}': '${view}'`)
      expect(rendererSource).toContain(`selectPrimaryNavView('${view}')`)
      expect(rendererSource).toContain(`primaryNavState('${view}')`)
      expect(rendererSource).toContain(`{...primaryNavState('${view}')} onClick={handlePrimaryNavClick('${view}')}`)
      expect(rendererSource).not.toContain(`{...primaryNavState('${view}')} onClick={() => selectPrimaryNavView('${view}')}`)
    }
  })

  it('routes native File menu transcript clearing through the renderer lifecycle action', () => {
    const fileMenuStart = mainSource.indexOf("label: 'File'")
    const fileMenuEnd = mainSource.indexOf("label: 'Edit'", fileMenuStart)
    const fileMenuBody = mainSource.slice(fileMenuStart, fileMenuEnd)
    expect(fileMenuBody).toContain("id: 'clear-desktop-transcript-view'")
    expect(fileMenuBody).toContain("label: 'Clear Desktop Transcript View'")
    expect(fileMenuBody).toContain("sendDesktopEvent({ type: 'clear-desktop-transcript-view' })")

    expect(rendererSource).toContain("| { type: 'clear-desktop-transcript-view' }")
    const eventStart = rendererSource.indexOf("if (event.type === 'command-palette')")
    const eventEnd = rendererSource.indexOf("if (event.type === 'session-updated')", eventStart)
    const eventBody = rendererSource.slice(eventStart, eventEnd)
    expect(eventBody).toContain("if (event.type === 'clear-desktop-transcript-view')")
    expect(eventBody).toContain('void clearDesktopTranscriptView()')
  })

  it('routes native lifecycle and settings management menu items through renderer actions', () => {
    const fileMenuStart = mainSource.indexOf("label: 'File'")
    const fileMenuEnd = mainSource.indexOf("label: 'Edit'", fileMenuStart)
    const fileMenuBody = mainSource.slice(fileMenuStart, fileMenuEnd)
    const expectedItems = [
      ['new-custom-agent', 'New Custom Agent'],
      ['new-team', 'New Team'],
      ['new-global-task', 'New Global Scheduled Task'],
      ['new-project-task', 'New Project Scheduled Task'],
      ['add-mcp-server', 'Add MCP Server'],
      ['new-user-skill', 'New User Skill'],
      ['new-project-skill', 'New Project Skill'],
    ] as const

    for (const [action, label] of expectedItems) {
      expect(fileMenuBody).toContain(`id: '${action}'`)
      expect(fileMenuBody).toContain(`label: '${label}'`)
      expect(fileMenuBody).toContain(`sendDesktopEvent({ type: 'lifecycle-action', action: '${action}' })`)
    }

    expect(rendererSource).toContain("| { type: 'lifecycle-action'; action: DesktopLifecycleAction }")
    const eventStart = rendererSource.indexOf("if (event.type === 'command-palette')")
    const eventEnd = rendererSource.indexOf("if (event.type === 'session-updated')", eventStart)
    const eventBody = rendererSource.slice(eventStart, eventEnd)
    expect(eventBody).toContain("if (event.type === 'lifecycle-action')")
    expect(eventBody).toContain('runDesktopLifecycleAction(event.action)')

    const handlerStart = rendererSource.indexOf('function runDesktopLifecycleAction')
    const handlerEnd = rendererSource.indexOf('function openSettingsSection', handlerStart)
    const handlerBody = rendererSource.slice(handlerStart, handlerEnd)
    expect(handlerBody).toContain("case 'new-custom-agent':")
    expect(handlerBody).toContain("openPaneSection('agents', 'agents-editor', 'agents')")
    expect(handlerBody).toContain('startNewAgentDraft()')
    expect(handlerBody).toContain("case 'new-team':")
    expect(handlerBody).toContain("openPaneSection('teams', 'agents-teams', 'teams')")
    expect(handlerBody).toContain('startNewTeamDraft()')
    expect(handlerBody).toContain("case 'new-global-task':")
    expect(handlerBody).toContain("openPaneSection('tasks', 'tasks-global-tasks', 'tasks')")
    expect(handlerBody).toContain('startNewScheduledTaskDraft()')
    expect(handlerBody).toContain("case 'new-project-task':")
    expect(handlerBody).toContain("openPaneSection('tasks', 'tasks-project-tasks', 'tasks')")
    expect(handlerBody).toContain('startNewProjectScheduledTaskDraft()')
    expect(handlerBody).toContain("case 'add-mcp-server':")
    expect(handlerBody).toContain("openPaneSection('settings', 'settings-mcp', 'settings')")
    expect(handlerBody).toContain('startNewMcpDraft()')
    expect(handlerBody).toContain("case 'new-user-skill':")
    expect(handlerBody).toContain("openPaneSection('settings', 'settings-skills', 'settings')")
    expect(handlerBody).toContain('startNewUserSkillDraft()')
    expect(handlerBody).toContain("case 'new-project-skill':")
    expect(handlerBody).toContain('startNewProjectSkillDraft()')
  })

  it('routes native grouped Settings menu items through renderer settings actions', () => {
    const settingsMenuItemStart = mainSource.indexOf("id: 'settings-general'")
    const settingsMenuStart = settingsMenuItemStart >= 0
      ? mainSource.lastIndexOf("label: 'Settings'", settingsMenuItemStart)
      : -1
    const settingsMenuEnd = settingsMenuStart >= 0
      ? mainSource.indexOf("label: 'Window'", settingsMenuStart)
      : -1
    const settingsMenuBody = settingsMenuStart >= 0 && settingsMenuEnd > settingsMenuStart
      ? mainSource.slice(settingsMenuStart, settingsMenuEnd)
      : ''
    const expectedItems = [
      ['settings-general', 'General', 'general'],
      ['settings-proxy', 'Proxy', 'proxy'],
      ['settings-mcp', 'MCP Servers', 'mcp'],
      ['settings-mcp-check', 'Check MCP Health', 'mcp-check'],
      ['settings-skills', 'Skills', 'skills'],
      ['settings-install-user-skill', 'Install User Skill', 'install-user-skill'],
      ['settings-install-project-skill', 'Install Project Skill', 'install-project-skill'],
      ['settings-plugins', 'Plugins', 'plugins'],
      ['settings-list-plugins', 'List Plugins', 'list-plugins'],
      ['settings-install-plugin', 'Install Plugin', 'install-plugin'],
      ['settings-refresh', 'Refresh Settings', 'refresh'],
      ['settings-diagnostics', 'Export Diagnostics', 'diagnostics'],
    ] as const

    expect(settingsMenuBody).toContain("label: 'Settings'")
    expect(settingsMenuBody).toContain("accelerator: 'CmdOrCtrl+,'")
    for (const [id, label, action] of expectedItems) {
      expect(settingsMenuBody).toContain(`id: '${id}'`)
      expect(settingsMenuBody).toContain(`label: '${label}'`)
      expect(settingsMenuBody).toContain(`sendDesktopEvent({ type: 'settings-action', action: '${action}' })`)
    }

    expect(rendererSource).toContain("| { type: 'settings-action'; action: DesktopSettingsAction }")
    const eventStart = rendererSource.indexOf("if (event.type === 'command-palette')")
    const eventEnd = rendererSource.indexOf("if (event.type === 'session-updated')", eventStart)
    const eventBody = rendererSource.slice(eventStart, eventEnd)
    expect(eventBody).toContain("if (event.type === 'settings-action')")
    expect(eventBody).toContain('runDesktopSettingsAction(event.action)')

    const handlerStart = rendererSource.indexOf('function runDesktopSettingsAction')
    const handlerEnd = rendererSource.indexOf('function openSettingsSection', handlerStart)
    const handlerBody = rendererSource.slice(handlerStart, handlerEnd)
    expect(handlerBody).toContain("case 'general':")
    expect(handlerBody).toContain("openPaneSection('settings', 'settings-runtime', 'settings')")
    expect(handlerBody).toContain("case 'proxy':")
    expect(handlerBody).toContain("openPaneSection('settings', 'settings-proxy', 'settings')")
    expect(handlerBody).toContain("case 'mcp':")
    expect(handlerBody).toContain("openPaneSection('settings', 'settings-mcp', 'settings')")
    expect(handlerBody).toContain("case 'mcp-check':")
    expect(handlerBody).toContain('void checkMcpHealth()')
    expect(handlerBody).toContain("case 'skills':")
    expect(handlerBody).toContain("openPaneSection('settings', 'settings-skills', 'settings')")
    expect(handlerBody).toContain("case 'install-user-skill':")
    expect(handlerBody).toContain('void installLocalSkill()')
    expect(handlerBody).toContain("case 'install-project-skill':")
    expect(handlerBody).toContain('void installProjectSkill()')
    expect(handlerBody).toContain("case 'plugins':")
    expect(handlerBody).toContain("openPaneSection('settings', 'settings-plugins', 'settings')")
    expect(handlerBody).toContain("case 'list-plugins':")
    expect(handlerBody).toContain('void listAvailablePlugins()')
    expect(handlerBody).toContain("case 'install-plugin':")
    expect(handlerBody).toContain('void installPlugin()')
    expect(handlerBody).toContain("case 'refresh':")
    expect(handlerBody).toContain('void refreshSettingsConfig()')
    expect(handlerBody).toContain("case 'diagnostics':")
    expect(handlerBody).toContain('void exportDiagnostics()')
  })

  it('routes native grouped Tasks menu items through renderer task actions', () => {
    const tasksMenuItemStart = mainSource.indexOf("id: 'tasks-project'")
    const tasksMenuStart = tasksMenuItemStart >= 0
      ? mainSource.lastIndexOf("label: 'Tasks'", tasksMenuItemStart)
      : -1
    const tasksMenuEnd = tasksMenuStart >= 0
      ? mainSource.indexOf("label: 'Settings'", tasksMenuStart)
      : -1
    const tasksMenuBody = tasksMenuStart >= 0 && tasksMenuEnd > tasksMenuStart
      ? mainSource.slice(tasksMenuStart, tasksMenuEnd)
      : ''
    const expectedItems = [
      ['tasks-project', 'Project Scheduled Tasks', 'project'],
      ['tasks-global', 'Global Scheduled Tasks', 'global'],
      ['tasks-new-project', 'New Project Scheduled Task', 'new-project'],
      ['tasks-new-global', 'New Global Scheduled Task', 'new-global'],
      ['tasks-refresh', 'Refresh Tasks', 'refresh'],
    ] as const

    expect(tasksMenuBody).toContain("label: 'Tasks'")
    for (const [id, label, action] of expectedItems) {
      expect(tasksMenuBody).toContain(`id: '${id}'`)
      expect(tasksMenuBody).toContain(`label: '${label}'`)
      expect(tasksMenuBody).toContain(`sendDesktopEvent({ type: 'tasks-action', action: '${action}' })`)
    }

    expect(rendererSource).toContain("| { type: 'tasks-action'; action: DesktopTasksAction }")
    const eventStart = rendererSource.indexOf("if (event.type === 'command-palette')")
    const eventEnd = rendererSource.indexOf("if (event.type === 'session-updated')", eventStart)
    const eventBody = rendererSource.slice(eventStart, eventEnd)
    expect(eventBody).toContain("if (event.type === 'tasks-action')")
    expect(eventBody).toContain('runDesktopTasksAction(event.action)')

    const handlerStart = rendererSource.indexOf('function runDesktopTasksAction')
    const handlerEnd = rendererSource.indexOf('function runDesktopLifecycleAction', handlerStart)
    const handlerBody = rendererSource.slice(handlerStart, handlerEnd)
    expect(handlerBody).toContain("case 'project':")
    expect(handlerBody).toContain("openTasksSection('tasks-project-tasks')")
    expect(handlerBody).toContain("case 'global':")
    expect(handlerBody).toContain("openTasksSection('tasks-global-tasks')")
    expect(handlerBody).toContain("case 'new-project':")
    expect(handlerBody).toContain("openPaneSection('tasks', 'tasks-project-tasks', 'tasks')")
    expect(handlerBody).toContain('startNewProjectScheduledTaskDraft()')
    expect(handlerBody).toContain("case 'new-global':")
    expect(handlerBody).toContain("openPaneSection('tasks', 'tasks-global-tasks', 'tasks')")
    expect(handlerBody).toContain('startNewScheduledTaskDraft()')
    expect(handlerBody).toContain("case 'refresh':")
    expect(handlerBody).toContain("openPaneSection('tasks', effectiveTasksActiveSection(), 'tasks'")
    expect(handlerBody).toContain('void refreshSettingsConfig()')
  })

  it('routes native grouped Agents and Teams menu items through renderer lifecycle actions', () => {
    const agentsMenuItemStart = mainSource.indexOf("id: 'agents-overview'")
    const agentsMenuStart = agentsMenuItemStart >= 0
      ? mainSource.lastIndexOf("label: 'Agents'", agentsMenuItemStart)
      : -1
    const agentsMenuEnd = agentsMenuStart >= 0
      ? mainSource.indexOf("label: 'Teams'", agentsMenuStart)
      : -1
    const agentsMenuBody = agentsMenuStart >= 0 && agentsMenuEnd > agentsMenuStart
      ? mainSource.slice(agentsMenuStart, agentsMenuEnd)
      : ''
    const expectedAgentItems = [
      ['agents-overview', 'Overview', 'overview'],
      ['agents-available', 'Available Agents', 'available'],
      ['agents-run', 'Run Agent', 'run'],
      ['agents-custom', 'Custom Agents', 'custom'],
      ['agents-running', 'Running Agent Tasks', 'running'],
      ['agents-new-custom', 'New Custom Agent', 'new-custom'],
      ['agents-refresh', 'Refresh Agents', 'refresh'],
    ] as const

    expect(agentsMenuBody).toContain("label: 'Agents'")
    for (const [id, label, action] of expectedAgentItems) {
      expect(agentsMenuBody).toContain(`id: '${id}'`)
      expect(agentsMenuBody).toContain(`label: '${label}'`)
      expect(agentsMenuBody).toContain(`sendDesktopEvent({ type: 'agents-action', action: '${action}' })`)
    }

    const teamsMenuItemStart = mainSource.indexOf("id: 'teams-management'")
    const teamsMenuStart = teamsMenuItemStart >= 0
      ? mainSource.lastIndexOf("label: 'Teams'", teamsMenuItemStart)
      : -1
    const teamsMenuEnd = teamsMenuStart >= 0
      ? mainSource.indexOf("label: 'Tasks'", teamsMenuStart)
      : -1
    const teamsMenuBody = teamsMenuStart >= 0 && teamsMenuEnd > teamsMenuStart
      ? mainSource.slice(teamsMenuStart, teamsMenuEnd)
      : ''
    const expectedTeamItems = [
      ['teams-management', 'Team Management', 'management'],
      ['teams-new', 'New Team', 'new'],
      ['teams-refresh', 'Refresh Teams', 'refresh'],
    ] as const

    expect(teamsMenuBody).toContain("label: 'Teams'")
    for (const [id, label, action] of expectedTeamItems) {
      expect(teamsMenuBody).toContain(`id: '${id}'`)
      expect(teamsMenuBody).toContain(`label: '${label}'`)
      expect(teamsMenuBody).toContain(`sendDesktopEvent({ type: 'teams-action', action: '${action}' })`)
    }

    expect(rendererSource).toContain("| { type: 'agents-action'; action: DesktopAgentsAction }")
    expect(rendererSource).toContain("| { type: 'teams-action'; action: DesktopTeamsAction }")
    const eventStart = rendererSource.indexOf("if (event.type === 'command-palette')")
    const eventEnd = rendererSource.indexOf("if (event.type === 'session-updated')", eventStart)
    const eventBody = rendererSource.slice(eventStart, eventEnd)
    expect(eventBody).toContain("if (event.type === 'agents-action')")
    expect(eventBody).toContain('runDesktopAgentsAction(event.action)')
    expect(eventBody).toContain("if (event.type === 'teams-action')")
    expect(eventBody).toContain('runDesktopTeamsAction(event.action)')

    const agentsHandlerStart = rendererSource.indexOf('function runDesktopAgentsAction')
    const agentsHandlerEnd = rendererSource.indexOf('function runDesktopTeamsAction', agentsHandlerStart)
    const agentsHandlerBody = rendererSource.slice(agentsHandlerStart, agentsHandlerEnd)
    expect(agentsHandlerBody).toContain("case 'overview':")
    expect(agentsHandlerBody).toContain("openPaneSection('agents', 'agents-sources', 'agents')")
    expect(agentsHandlerBody).toContain("case 'available':")
    expect(agentsHandlerBody).toContain("openPaneSection('agents', 'agents-catalog', 'agents')")
    expect(agentsHandlerBody).toContain("case 'run':")
    expect(agentsHandlerBody).toContain("openPaneSection('agents', 'agents-launch', 'agents')")
    expect(agentsHandlerBody).toContain("case 'custom':")
    expect(agentsHandlerBody).toContain("openPaneSection('agents', 'agents-editor', 'agents')")
    expect(agentsHandlerBody).toContain("case 'running':")
    expect(agentsHandlerBody).toContain("openPaneSection('agents', 'agents-tasks', 'agents')")
    expect(agentsHandlerBody).toContain("case 'new-custom':")
    expect(agentsHandlerBody).toContain('startNewAgentDraft()')
    expect(agentsHandlerBody).toContain("case 'refresh':")
    expect(agentsHandlerBody).toContain("openPaneSection('agents', agentsActiveSection, 'agents'")
    expect(agentsHandlerBody).toContain('void refreshAgents()')

    const teamsHandlerStart = rendererSource.indexOf('function runDesktopTeamsAction')
    const teamsHandlerEnd = rendererSource.indexOf('function runDesktopTasksAction', teamsHandlerStart)
    const teamsHandlerBody = rendererSource.slice(teamsHandlerStart, teamsHandlerEnd)
    expect(teamsHandlerBody).toContain("case 'management':")
    expect(teamsHandlerBody).toContain("openPaneSection('teams', 'agents-teams', 'teams')")
    expect(teamsHandlerBody).toContain("case 'new':")
    expect(teamsHandlerBody).toContain('startNewTeamDraft()')
    expect(teamsHandlerBody).toContain("case 'refresh':")
    expect(teamsHandlerBody).toContain("openPaneSection('teams', teamsActiveSection, 'teams'")
    expect(teamsHandlerBody).toContain('void refreshAgents()')
  })

  it('routes native MCP and Skills menu items through renderer settings management actions', () => {
    const mcpMenuItemStart = mainSource.indexOf("id: 'mcp-servers'")
    const mcpMenuStart = mcpMenuItemStart >= 0
      ? mainSource.lastIndexOf("label: 'MCP'", mcpMenuItemStart)
      : -1
    const mcpMenuEnd = mcpMenuStart >= 0
      ? mainSource.indexOf("label: 'Skills'", mcpMenuStart)
      : -1
    const mcpMenuBody = mcpMenuStart >= 0 && mcpMenuEnd > mcpMenuStart
      ? mainSource.slice(mcpMenuStart, mcpMenuEnd)
      : ''
    const expectedMcpItems = [
      ['mcp-servers', 'MCP Servers', 'servers'],
      ['mcp-add-server', 'Add MCP Server', 'add-server'],
      ['mcp-check-health', 'Check MCP Health', 'check-health'],
    ] as const

    expect(mcpMenuBody).toContain("label: 'MCP'")
    for (const [id, label, action] of expectedMcpItems) {
      expect(mcpMenuBody).toContain(`id: '${id}'`)
      expect(mcpMenuBody).toContain(`label: '${label}'`)
      expect(mcpMenuBody).toContain(`sendDesktopEvent({ type: 'mcp-action', action: '${action}' })`)
    }

    const skillsMenuItemStart = mainSource.indexOf("id: 'skills-list'")
    const skillsMenuStart = skillsMenuItemStart >= 0
      ? mainSource.lastIndexOf("label: 'Skills'", skillsMenuItemStart)
      : -1
    const skillsMenuEnd = skillsMenuStart >= 0
      ? mainSource.indexOf("label: 'Settings'", skillsMenuStart)
      : -1
    const skillsMenuBody = skillsMenuStart >= 0 && skillsMenuEnd > skillsMenuStart
      ? mainSource.slice(skillsMenuStart, skillsMenuEnd)
      : ''
    const expectedSkillItems = [
      ['skills-list', 'Skills', 'list'],
      ['skills-new-user', 'New User Skill', 'new-user'],
      ['skills-new-project', 'New Project Skill', 'new-project'],
      ['skills-install-user', 'Install User Skill', 'install-user'],
      ['skills-install-project', 'Install Project Skill', 'install-project'],
    ] as const

    expect(skillsMenuBody).toContain("label: 'Skills'")
    for (const [id, label, action] of expectedSkillItems) {
      expect(skillsMenuBody).toContain(`id: '${id}'`)
      expect(skillsMenuBody).toContain(`label: '${label}'`)
      expect(skillsMenuBody).toContain(`sendDesktopEvent({ type: 'skills-action', action: '${action}' })`)
    }

    expect(rendererSource).toContain("| { type: 'mcp-action'; action: DesktopMcpAction }")
    expect(rendererSource).toContain("| { type: 'skills-action'; action: DesktopSkillsAction }")
    const eventStart = rendererSource.indexOf("if (event.type === 'command-palette')")
    const eventEnd = rendererSource.indexOf("if (event.type === 'session-updated')", eventStart)
    const eventBody = rendererSource.slice(eventStart, eventEnd)
    expect(eventBody).toContain("if (event.type === 'mcp-action')")
    expect(eventBody).toContain('runDesktopMcpAction(event.action)')
    expect(eventBody).toContain("if (event.type === 'skills-action')")
    expect(eventBody).toContain('runDesktopSkillsAction(event.action)')

    const mcpHandlerStart = rendererSource.indexOf('function runDesktopMcpAction')
    const mcpHandlerEnd = rendererSource.indexOf('function runDesktopSkillsAction', mcpHandlerStart)
    const mcpHandlerBody = rendererSource.slice(mcpHandlerStart, mcpHandlerEnd)
    expect(mcpHandlerBody).toContain("case 'servers':")
    expect(mcpHandlerBody).toContain("openPaneSection('settings', 'settings-mcp', 'settings')")
    expect(mcpHandlerBody).toContain("case 'add-server':")
    expect(mcpHandlerBody).toContain('startNewMcpDraft()')
    expect(mcpHandlerBody).toContain("case 'check-health':")
    expect(mcpHandlerBody).toContain("openPaneSection('settings', 'settings-mcp', 'settings', { showStatus: false })")
    expect(mcpHandlerBody).toContain('void checkMcpHealth()')

    const skillsHandlerStart = rendererSource.indexOf('function runDesktopSkillsAction')
    const skillsHandlerEnd = rendererSource.indexOf('function runDesktopAgentsAction', skillsHandlerStart)
    const skillsHandlerBody = rendererSource.slice(skillsHandlerStart, skillsHandlerEnd)
    expect(skillsHandlerBody).toContain("case 'list':")
    expect(skillsHandlerBody).toContain("openPaneSection('settings', 'settings-skills', 'settings')")
    expect(skillsHandlerBody).toContain("case 'new-user':")
    expect(skillsHandlerBody).toContain('startNewUserSkillDraft()')
    expect(skillsHandlerBody).toContain("case 'new-project':")
    expect(skillsHandlerBody).toContain('startNewProjectSkillDraft()')
    expect(skillsHandlerBody).toContain("case 'install-user':")
    expect(skillsHandlerBody).toContain('void installLocalSkill()')
    expect(skillsHandlerBody).toContain("case 'install-project':")
    expect(skillsHandlerBody).toContain('void installProjectSkill()')
  })

  it('routes native Plugins menu items through renderer settings management actions', () => {
    const pluginsMenuItemStart = mainSource.indexOf("id: 'plugins-settings'")
    const pluginsMenuStart = pluginsMenuItemStart >= 0
      ? mainSource.lastIndexOf("label: 'Plugins'", pluginsMenuItemStart)
      : -1
    const pluginsMenuEnd = pluginsMenuStart >= 0
      ? mainSource.indexOf("label: 'Settings'", pluginsMenuStart)
      : -1
    const pluginsMenuBody = pluginsMenuStart >= 0 && pluginsMenuEnd > pluginsMenuStart
      ? mainSource.slice(pluginsMenuStart, pluginsMenuEnd)
      : ''
    const expectedPluginItems = [
      ['plugins-settings', 'Plugins', 'settings'],
      ['plugins-list', 'List Plugins', 'list'],
      ['plugins-install', 'Install Plugin', 'install'],
      ['plugins-refresh', 'Refresh Plugins', 'refresh'],
    ] as const

    expect(pluginsMenuBody).toContain("label: 'Plugins'")
    for (const [id, label, action] of expectedPluginItems) {
      expect(pluginsMenuBody).toContain(`id: '${id}'`)
      expect(pluginsMenuBody).toContain(`label: '${label}'`)
      expect(pluginsMenuBody).toContain(`sendDesktopEvent({ type: 'plugins-action', action: '${action}' })`)
    }

    expect(rendererSource).toContain("| { type: 'plugins-action'; action: DesktopPluginsAction }")
    const eventStart = rendererSource.indexOf("if (event.type === 'command-palette')")
    const eventEnd = rendererSource.indexOf("if (event.type === 'session-updated')", eventStart)
    const eventBody = rendererSource.slice(eventStart, eventEnd)
    expect(eventBody).toContain("if (event.type === 'plugins-action')")
    expect(eventBody).toContain('runDesktopPluginsAction(event.action)')

    const handlerStart = rendererSource.indexOf('function runDesktopPluginsAction')
    const handlerEnd = rendererSource.indexOf('function runDesktopMcpAction', handlerStart)
    const handlerBody = rendererSource.slice(handlerStart, handlerEnd)
    expect(handlerBody).toContain("case 'settings':")
    expect(handlerBody).toContain("openPaneSection('settings', 'settings-plugins', 'settings')")
    expect(handlerBody).toContain("case 'list':")
    expect(handlerBody).toContain('void listAvailablePlugins()')
    expect(handlerBody).toContain("case 'install':")
    expect(handlerBody).toContain('void installPlugin()')
    expect(handlerBody).toContain("case 'refresh':")
    expect(handlerBody).toContain("openPaneSection('settings', 'settings-plugins', 'settings', { showStatus: false })")
    expect(handlerBody).toContain('void refreshSettingsConfig()')
  })

  it('routes native Help menu support actions through existing renderer actions', () => {
    const helpMenuStart = mainSource.indexOf("label: 'Help'")
    const helpMenuBody = helpMenuStart >= 0 ? mainSource.slice(helpMenuStart) : ''
    const expectedItems = [
      ['help-command-palette', 'Command Palette', "sendDesktopEvent({ type: 'command-palette' })"],
      ['help-refresh-settings', 'Refresh Settings', "sendDesktopEvent({ type: 'settings-action', action: 'refresh' })"],
      ['help-export-diagnostics', 'Export Diagnostics', "sendDesktopEvent({ type: 'settings-action', action: 'diagnostics' })"],
      ['open-claude-code-docs', 'Claude Code Docs', "shell.openExternal('https://code.claude.com/docs')"],
    ] as const

    expect(helpMenuBody).toContain("label: 'Help'")
    for (const [id, label, action] of expectedItems) {
      expect(helpMenuBody).toContain(`id: '${id}'`)
      expect(helpMenuBody).toContain(`label: '${label}'`)
      expect(helpMenuBody).toContain(action)
    }

    const eventStart = rendererSource.indexOf("if (event.type === 'command-palette')")
    const eventEnd = rendererSource.indexOf("if (event.type === 'session-updated')", eventStart)
    const eventBody = rendererSource.slice(eventStart, eventEnd)
    expect(eventBody).toContain("if (event.type === 'command-palette')")
    expect(eventBody).toContain('setCommandPaletteOpen(true)')
    expect(eventBody).toContain("if (event.type === 'settings-action')")
    expect(eventBody).toContain('runDesktopSettingsAction(event.action)')

    const handlerStart = rendererSource.indexOf('function runDesktopSettingsAction')
    const handlerEnd = rendererSource.indexOf('function openSettingsSection', handlerStart)
    const handlerBody = rendererSource.slice(handlerStart, handlerEnd)
    expect(handlerBody).toContain("case 'refresh':")
    expect(handlerBody).toContain('void refreshSettingsConfig()')
    expect(handlerBody).toContain("case 'diagnostics':")
    expect(handlerBody).toContain('void exportDiagnostics()')
  })

  it('shows feedback for native Settings actions that require an active session', () => {
    const healthStart = rendererSource.indexOf('async function checkMcpHealth')
    const healthEnd = rendererSource.indexOf('function pluginCommandCwd', healthStart)
    const healthBody = rendererSource.slice(healthStart, healthEnd)
    expect(healthBody).toContain("if (!activeSession) {")
    expect(healthBody).toContain("text: 'Select a session to check project MCP health.'")

    const installStart = rendererSource.indexOf('async function installProjectSkill')
    const installEnd = rendererSource.indexOf('function editSkill', installStart)
    const installBody = rendererSource.slice(installStart, installEnd)
    expect(installBody).toContain("if (!activeSession) {")
    expect(installBody).toContain("text: 'Select a session to install a project skill.'")
  })

  it('disables primary navigation while loading', () => {
    const helperStart = rendererSource.indexOf('function primaryNavState')
    const helperEnd = rendererSource.indexOf('const visibleSettingsNavGroups', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)

    expect(helperBody).toContain("'aria-disabled': !!loadingLabel")
    expect(helperBody).toContain('tabIndex: loadingLabel ? -1 : 0')
    for (const view of ['chat', 'agents', 'teams', 'tasks', 'settings']) {
      expect(rendererSource).toContain(`{...primaryNavState('${view}')} onClick={handlePrimaryNavClick('${view}')}`)
      expect(rendererSource).not.toContain(`{...primaryNavState('${view}')} onClick={() => selectPrimaryNavView('${view}')}`)
    }
  })

  it('blocks primary navigation entrypoints while loading', () => {
    const openStart = rendererSource.indexOf('function openPrimaryView')
    const openEnd = rendererSource.indexOf('useEffect(() => {', openStart)
    const openBody = rendererSource.slice(openStart, openEnd)

    expect(openBody).toContain('if (loadingLabel) return')
    expect(openBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      openBody.indexOf('setPrimaryNavView(view)'),
    )
    expect(openBody).toContain('function selectPrimaryNavView(view: PrimaryNavView): void')
    expect(openBody).toContain('openPrimaryView(view)')
    expect(openBody).toContain('function handlePrimaryNavClick(view: PrimaryNavView): () => void')
    expect(openBody).toContain('return () => selectPrimaryNavView(view)')

    const pendingNavigationStart = rendererSource.indexOf('if (!pendingDesktopNavigation) return')
    const pendingNavigationEnd = rendererSource.indexOf('useEffect(() => {', pendingNavigationStart + 1)
    const pendingNavigationBody = rendererSource.slice(pendingNavigationStart, pendingNavigationEnd)
    expect(pendingNavigationBody).toContain("if (event.type === 'primary-nav')")
    expect(pendingNavigationBody).toContain('selectPrimaryNavView(event.view)')
    expect(pendingNavigationBody).not.toContain('openPrimaryView(event.view)')

    const shortcutsStart = rendererSource.indexOf("if (event.key === ',')")
    const shortcutsEnd = rendererSource.indexOf('window.addEventListener', shortcutsStart)
    const shortcutsBody = rendererSource.slice(shortcutsStart, shortcutsEnd)

    expect(shortcutsBody).toContain('if (loadingLabel) return')
    expect(shortcutsBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      shortcutsBody.indexOf("selectPrimaryNavView('settings')"),
    )
    expect(shortcutsBody).toContain("selectPrimaryNavView('settings')")
    expect(shortcutsBody).not.toContain("openPrimaryView('settings')")
    expect(shortcutsBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      shortcutsBody.indexOf('selectPrimaryNavView(view)'),
    )
    expect(shortcutsBody).toContain('selectPrimaryNavView(view)')
    expect(shortcutsBody).not.toContain('openPrimaryView(view)')

    const shortcutEffectEnd = rendererSource.indexOf('function closeCommandPalette', shortcutsStart)
    const shortcutEffectBody = rendererSource.slice(shortcutsStart, shortcutEffectEnd)
    expect(shortcutEffectBody).toContain('loadingLabel,')

    for (const view of ['chat', 'agents', 'teams', 'tasks', 'settings']) {
      const itemStart = rendererSource.indexOf(`id: 'primary:${view}'`)
      const itemEnd = rendererSource.indexOf('},', itemStart)
      const itemBody = rendererSource.slice(itemStart, itemEnd)

      expect(itemBody).toContain('disabled: !!loadingLabel')
      expect(itemBody).toContain('disabledReason: loadingReason')
      expect(itemBody).toContain(`run: () => selectPrimaryNavView('${view}')`)
      expect(itemBody).not.toContain(`run: () => openPrimaryView('${view}')`)
    }
  })

  it('keeps native View menu and renderer shortcuts aligned for workspace panes', () => {
    const panes = [
      ['Files', 'files', '1'],
      ['Diff', 'diff', '2'],
      ['Editor', 'editor', '3'],
      ['Terminal', 'terminal', '4'],
      ['Preview', 'preview', '5'],
    ] as const

    for (const [label, pane, key] of panes) {
      expect(mainSource).toContain(`id: 'pane-${pane}'`)
      expect(mainSource).toContain(`label: '${label}'`)
      expect(mainSource).toContain(`accelerator: 'CmdOrCtrl+Shift+${key}'`)
      expect(mainSource).toContain(`sendDesktopEvent({ type: 'workspace-pane', pane: '${pane}' })`)
      expect(rendererSource).toContain(`'${key}': '${pane}'`)
      expect(rendererSource).toContain(`selectWorkspacePane('${pane}')`)
    }

    const eventStart = rendererSource.indexOf('if (!pendingDesktopNavigation) return')
    const eventEnd = rendererSource.indexOf('useEffect(() => {', eventStart + 1)
    const eventBody = rendererSource.slice(eventStart, eventEnd)
    expect(eventBody).toContain("if (event.type === 'primary-nav')")
    expect(eventBody).toContain('selectWorkspacePane(event.pane)')
    expect(eventBody).not.toContain('void setPane(event.pane)')
  })

  it('shows command palette disabled reasons in the item detail', () => {
    expect(rendererSource).toContain('disabledReason?: string')
    expect(rendererSource).toContain("const sessionRequiredReason = 'Start or select a session first.'")
    expect(rendererSource).toContain("`${item.detail} · ${item.disabledReason ?? 'unavailable'}`")
  })

  it('routes generic async action errors to the origin workspace pane', () => {
    const start = rendererSource.indexOf('function setActivePaneError')
    const end = rendererSource.indexOf('async function copyText', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('function setActivePaneError(pane: PaneId, message: string): void')
    expect(body).toContain('switch (pane)')
    expect(body).toContain('const errorTarget = activePane')
    expect(body.indexOf('const errorTarget = activePane')).toBeLessThan(
      body.indexOf('return await action()'),
    )
    expect(body).toContain('setActivePaneError(errorTarget, message)')
    expect(body).not.toContain('setActivePaneError(message)')
  })

  it('runs selected command palette actions only once', () => {
    const start = rendererSource.indexOf('function runCommandPaletteItem')
    const end = rendererSource.indexOf('function handleCommandPaletteKeyDown')
    const body = rendererSource.slice(start, end)
    expect(body.match(/item\.run\(\)/g) ?? []).toHaveLength(1)
  })

  it('blocks stale command palette action execution while loading', () => {
    const start = rendererSource.indexOf('function runCommandPaletteItem')
    const end = rendererSource.indexOf('function handleCommandPaletteKeyDown')
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (loadingLabel) return')
    expect(body.indexOf('if (loadingLabel) return')).toBeLessThan(
      body.indexOf('if (item.disabled) {'),
    )
    expect(body.indexOf('if (loadingLabel) return')).toBeLessThan(
      body.indexOf('item.run()'),
    )
  })

  it('keeps the command palette active option on an enabled command', () => {
    const start = rendererSource.indexOf('if (commandPaletteItemsForQuery.length === 0)')
    const end = rendererSource.indexOf('useEffect(() => {', start + 1)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const firstEnabledCommandIndex = commandPaletteItemsForQuery.findIndex(item => !item.disabled)')
    expect(body).toContain('const activeCommand = commandPaletteItemsForQuery[commandPaletteActiveIndex]')
    expect(body).toContain('if (firstEnabledCommandIndex >= 0 && activeCommand?.disabled)')
    expect(body).toContain('setCommandPaletteActiveIndex(firstEnabledCommandIndex)')
  })

  it('keeps disabled command palette options visible but inert', () => {
    const paletteStart = rendererSource.indexOf('id="command-palette-list"')
    const start = rendererSource.indexOf('role="option"', paletteStart)
    const end = rendererSource.indexOf('<Icon name={item.icon}', start)
    const optionBody = rendererSource.slice(start, end)

    expect(optionBody).toContain("aria-disabled={item.disabled ? 'true' : undefined}")
    expect(optionBody).toContain('tabIndex={item.disabled ? -1 : 0}')
    expect(optionBody).toContain('onMouseEnter={() => !item.disabled && setCommandPaletteActiveIndex(index)}')
    expect(optionBody).toContain('onClick={() => runCommandPaletteItem(item)}')
  })

  it('shows a structured empty state when the command palette has no matches', () => {
    const paletteStart = rendererSource.indexOf('id="command-palette-list"')
    const paletteEnd = rendererSource.indexOf('</div>', paletteStart)
    const paletteBody = rendererSource.slice(paletteStart, paletteEnd)
    const emptyStart = paletteBody.indexOf('command-palette-empty')
    const emptyEnd = paletteBody.indexOf('</div>', emptyStart)
    const emptyBody = paletteBody.slice(emptyStart, emptyEnd)

    expect(emptyBody).toContain('command-palette-empty')
    expect(emptyBody).toContain('<Icon name="search" />')
    expect(emptyBody).toContain('<strong>No matching commands</strong>')
  })

  it('exposes command palette search as an expanded combobox', () => {
    const start = rendererSource.indexOf('ref={commandPaletteInputRef}')
    const end = rendererSource.indexOf('/>', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('role="combobox"')
    expect(body).toContain('aria-expanded="true"')
    expect(body).toContain('aria-controls="command-palette-list"')
    expect(body).toContain('aria-activedescendant={')
  })

  it('disables command palette search edits while loading', () => {
    const start = rendererSource.indexOf('ref={commandPaletteInputRef}')
    const end = rendererSource.indexOf('/>', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('disabled={!!loadingLabel}')
    expect(rendererSource).toContain('function handleCommandPaletteQueryChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(body).toContain('onChange={handleCommandPaletteQueryChange}')
    expect(body).not.toContain('setCommandPaletteQuery(event.target.value)')
  })

  it('encodes command palette option ids before wiring active descendant state', () => {
    const helperStart = rendererSource.indexOf('function commandPaletteOptionId')
    const helperEnd = rendererSource.indexOf('function handleCommandPaletteKeyDown', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const inputStart = rendererSource.indexOf('ref={commandPaletteInputRef}')
    const inputEnd = rendererSource.indexOf('/>', inputStart)
    const inputBody = rendererSource.slice(inputStart, inputEnd)
    const itemStart = rendererSource.indexOf('key={item.id}', rendererSource.indexOf('id="command-palette-list"'))
    const itemEnd = rendererSource.indexOf('type="button"', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)

    expect(helperBody).toContain("function commandPaletteOptionId(item: Pick<CommandPaletteItem, 'id'>): string")
    expect(helperBody).toContain('optionIdSegment(item.id)')
    expect(inputBody).toContain('commandPaletteOptionId(commandPaletteItemsForQuery[commandPaletteActiveIndex]!)')
    expect(itemBody).toContain('id={commandPaletteOptionId(item)}')
  })

  it('defines command palette prerequisites before command items are built', () => {
    expect(rendererSource.indexOf('const pluginScopeNeedsSession')).toBeLessThan(
      rendererSource.indexOf('const commandPaletteItems = useMemo'),
    )
    expect(rendererSource.indexOf('const canRunPluginCommand')).toBeLessThan(
      rendererSource.indexOf('const commandPaletteItems = useMemo'),
    )
    expect(rendererSource.indexOf('const canInstallPlugin')).toBeLessThan(
      rendererSource.indexOf('const commandPaletteItems = useMemo'),
    )
  })

  it('exposes diagnostic export from the command palette with visible settings feedback', () => {
    expect(rendererSource).toContain("id: 'settings:diagnostics'")
    expect(rendererSource).toContain("label: 'Export diagnostics'")
    expect(rendererSource).toContain("detail: 'Write a redacted local support bundle'")
    expect(rendererSource).toContain("openPaneSection('settings', 'settings-runtime', 'settings')")
    expect(rendererSource).toContain('void exportDiagnostics()')
  })

  it('exposes grouped general and proxy settings from the command palette', () => {
    expect(rendererSource).toContain("id: 'settings:general'")
    expect(rendererSource).toContain("label: 'General settings'")
    expect(rendererSource).toContain("run: () => openPaneSection('settings', 'settings-runtime', 'settings')")
    expect(rendererSource).toContain("id: 'settings:proxy'")
    expect(rendererSource).toContain("label: 'Proxy settings'")
    expect(rendererSource).toContain("run: () => openPaneSection('settings', 'settings-proxy', 'settings')")
  })

  it('supports keyboard navigation through filtered settings search results', () => {
    const start = rendererSource.indexOf('function handleSettingsSearchKeyDown')
    const end = rendererSource.indexOf('async function toggleDirectory', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain("if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visibleSettingsNavItems.length)")
    expect(body).toContain('const currentIndex = visibleSettingsNavItems.findIndex(item =>')
    expect(body).toContain("const direction = event.key === 'ArrowDown' ? 1 : -1")
    expect(body).toContain('const nextIndex = currentIndex >= 0')
    expect(body).toContain('openSettingsNavItem(visibleSettingsNavItems[nextIndex]!)')
    expect(body).toContain("if ((event.key === 'Home' || event.key === 'End') && visibleSettingsNavItems.length)")
    expect(body).toContain("const nextIndex = event.key === 'Home' ? 0 : visibleSettingsNavItems.length - 1")
    expect(body).toContain('openSettingsNavItem(visibleSettingsNavItems[nextIndex]!)')
    expect(body).toContain("if (event.key === 'Enter' && (activeSettingsNavItem || visibleSettingsNavItems[0]))")
    expect(body).toContain('openSettingsNavItem(activeSettingsNavItem ?? visibleSettingsNavItems[0]!)')
  })

  it('does not navigate filtered settings search results while loading', () => {
    const start = rendererSource.indexOf('function handleSettingsSearchKeyDown')
    const end = rendererSource.indexOf('async function toggleDirectory', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (loadingLabel) return')
    expect(body.indexOf('if (loadingLabel) return')).toBeGreaterThan(
      body.indexOf('function handleSettingsSearchKeyDown'),
    )
    expect(body.indexOf('if (loadingLabel) return')).toBeLessThan(
      body.indexOf("if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visibleSettingsNavItems.length)"),
    )
  })

  it('disables settings nav row clicks while loading', () => {
    const helperStart = rendererSource.indexOf('function settingsNavButtonState')
    const helperEnd = rendererSource.indexOf('function isSettingsNavItemActive', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const navStart = rendererSource.indexOf('id="settings-nav-listbox"')
    const navEnd = rendererSource.indexOf('{visibleSettingsNavGroups.length === 0', navStart)
    const navBody = rendererSource.slice(navStart, navEnd)

    expect(helperBody).toContain("'aria-disabled': !!loadingLabel")
    expect(helperBody).toContain('tabIndex: loadingLabel ? -1 : 0')
    expect(rendererSource).toContain('function handleSettingsNavItemClick(item: SettingsNavItem): void')
    expect(navBody).toContain('onClick={() => handleSettingsNavItemClick(item)}')
    expect(navBody).not.toContain('onClick={() => !loadingLabel && openSettingsNavItem(item)}')
  })

  it('disables settings back navigation while loading', () => {
    const buttonStart = rendererSource.indexOf('<button className="settings-back-button"')
    const buttonEnd = rendererSource.indexOf('</button>', buttonStart)
    const buttonBody = rendererSource.slice(buttonStart, buttonEnd)

    expect(rendererSource).toContain('function handleSettingsBackClick(): void')
    expect(buttonBody).toContain('onClick={handleSettingsBackClick}')
    expect(buttonBody).not.toContain("onClick={() => !loadingLabel && openPrimaryView('chat')}")
    expect(buttonBody).toContain('disabled={!!loadingLabel}')
  })

  it('exposes settings search as a grouped combobox navigation control', () => {
    const inputStart = rendererSource.indexOf('value={settingsSearch}')
    const inputEnd = rendererSource.indexOf('/>', inputStart)
    const inputBody = rendererSource.slice(inputStart, inputEnd)
    const navStart = rendererSource.indexOf('id="settings-nav-listbox"', inputEnd)
    const navEnd = rendererSource.indexOf('{visibleSettingsNavGroups.length === 0', navStart)
    const navBody = rendererSource.slice(navStart, navEnd)

    expect(inputBody).toContain('role="combobox"')
    expect(inputBody).toContain('aria-expanded="true"')
    expect(inputBody).toContain('aria-controls="settings-nav-listbox"')
    expect(inputBody).toContain('aria-activedescendant={')
    expect(navBody).toContain('id="settings-nav-listbox"')
    expect(navBody).toContain('role="listbox"')
    expect(navBody).toContain('role="group"')
    expect(navBody).toContain('role="option"')
    expect(navBody).toContain('aria-selected={')
  })

  it('shows a structured empty state when settings search has no matches', () => {
    const navStart = rendererSource.indexOf('id="settings-nav-listbox"')
    const navEnd = rendererSource.indexOf('</nav>', navStart)
    const navBody = rendererSource.slice(navStart, navEnd)
    const emptyStart = navBody.indexOf('settings-nav-empty')
    const emptyEnd = navBody.indexOf('</div>', emptyStart)
    const emptyBody = navBody.slice(emptyStart, emptyEnd)

    expect(emptyBody).toContain('settings-nav-empty')
    expect(emptyBody).toContain('<Icon name="search" />')
    expect(emptyBody).toContain('<strong>No matching settings</strong>')
    expect(navBody).not.toContain('No settings match your search.')
  })

  it('disables settings search edits while loading', () => {
    const inputStart = rendererSource.indexOf('value={settingsSearch}')
    const inputEnd = rendererSource.indexOf('/>', inputStart)
    const inputBody = rendererSource.slice(inputStart, inputEnd)

    expect(inputBody).toContain('disabled={!!loadingLabel}')
    expect(rendererSource).toContain('function handleSettingsSearchChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(inputBody).toContain('onChange={handleSettingsSearchChange}')
    expect(inputBody).not.toContain('setSettingsSearch(event.target.value)')
  })

  it('disables file tree navigation while loading or without an active session', () => {
    const toggleStart = rendererSource.indexOf('async function toggleDirectory')
    const toggleEnd = rendererSource.indexOf('async function openPreview', toggleStart)
    const toggleBody = rendererSource.slice(toggleStart, toggleEnd)
    const openStart = rendererSource.indexOf('async function openFile')
    const openEnd = rendererSource.indexOf('async function saveFile', openStart)
    const openBody = rendererSource.slice(openStart, openEnd)
    const treeStart = rendererSource.indexOf('className={`tree-row')
    const treeEnd = rendererSource.indexOf('</button>', treeStart)
    const treeBody = rendererSource.slice(treeStart, treeEnd)

    expect(toggleBody).toContain('if (!activeSession) {')
    expect(toggleBody).toContain("setFilesStatus({ kind: 'error', text: 'Select a session before expanding folders.' })")
    expect(toggleBody.indexOf('if (!activeSession) {')).toBeLessThan(
      toggleBody.indexOf('const next = new Set<string>(expandedPaths)'),
    )
    expect(toggleBody.indexOf('if (!activeSession) {')).toBeLessThan(
      toggleBody.indexOf('await updateSessionLayout(session.id, { expandedPaths: [...next] })'),
    )
    expect(toggleBody).toContain('const session = activeSession')
    expect(toggleBody).toContain('await updateSessionLayout(session.id, { expandedPaths: [...next] })')
    expect(toggleBody).not.toContain('await updateLayout({ expandedPaths: [...next] })')
    expect(toggleBody).toContain('if (loadingLabel) return')
    expect(openBody).toContain('if (!activeSession) {')
    expect(openBody).toContain('if (loadingLabel) return')
    expect(rendererSource).toContain('function handleFileTreeEntryClick(entry: WorkspaceEntry): void')
    expect(treeBody).toContain('onClick={() => handleFileTreeEntryClick(entry)}')
    expect(treeBody).not.toContain("onClick={() => !loadingLabel && (entry.type === 'directory' ? void toggleDirectory(entry.path) : void openFile(entry.path))}")
    expect(treeBody).toContain('disabled={!activeSession || !!loadingLabel}')
  })

  it('disables diff file selection while loading or without an active session', () => {
    const handlerStart = rendererSource.indexOf('function selectDiffFile')
    const handlerEnd = rendererSource.indexOf('async function refreshDiff', handlerStart)
    const handlerBody = rendererSource.slice(handlerStart, handlerEnd)
    const listStart = rendererSource.indexOf('<div className="diff-file-list">')
    const buttonStart = rendererSource.indexOf('<button', listStart)
    const buttonEnd = rendererSource.indexOf('</button>', buttonStart)
    const buttonBody = rendererSource.slice(buttonStart, buttonEnd)

    expect(handlerBody).toContain('if (!activeSession) {')
    expect(handlerBody).toContain("setDiffStatus({ kind: 'error', text: 'Select a session before selecting diff files.' })")
    expect(handlerBody.indexOf('if (!activeSession) {')).toBeLessThan(
      handlerBody.indexOf('setSelectedDiffPath(path)'),
    )
    expect(handlerBody).toContain('if (loadingLabel) return')
    expect(rendererSource).toContain('function handleDiffFileClick(path: string): void')
    expect(buttonBody).toContain('onClick={() => handleDiffFileClick(file.path)}')
    expect(buttonBody).not.toContain('onClick={() => !loadingLabel && selectDiffFile(file.path)}')
    expect(buttonBody).toContain('disabled={!activeSession || !!loadingLabel}')
  })

  it('blocks Files and Diff pane action buttons while loading', () => {
    const filesStart = rendererSource.indexOf('{activePane === \'files\' && (')
    const filesEnd = rendererSource.indexOf('{activePane === \'diff\' && (', filesStart)
    const filesBody = rendererSource.slice(filesStart, filesEnd)
    const diffStart = rendererSource.indexOf('{activePane === \'diff\' && (')
    const diffEnd = rendererSource.indexOf('{activePane === \'editor\' && (', diffStart)
    const diffBody = rendererSource.slice(diffStart, diffEnd)

    expect(filesBody).toContain('<button className="tool-button" onClick={handleRefreshFilesClick} disabled={!activeSession || !!loadingLabel}>')
    expect(filesBody).toContain('onClick={() => handleFileTreeEntryClick(entry)}')
    expect(diffBody).toContain('<button className="tool-button" onClick={handleRefreshDiffClick} disabled={!activeSession || !!loadingLabel}>')
    expect(diffBody).toContain('onClick={() => handleDiffFileClick(file.path)}')
  })

  it('routes stale file tree row clicks through file handlers', () => {
    const treeStart = rendererSource.indexOf('className={`tree-row')
    const treeEnd = rendererSource.indexOf('</button>', treeStart)
    const treeBody = rendererSource.slice(treeStart, treeEnd)

    expect(treeBody).toContain('onClick={() => handleFileTreeEntryClick(entry)}')
    expect(treeBody).toContain('disabled={!activeSession || !!loadingLabel}')
    expect(treeBody).not.toContain("activeSession && !loadingLabel && (entry.type === 'directory' ? void toggleDirectory(entry.path) : void openFile(entry.path))")
  })

  it('routes stale diff file selection through a Diff handler', () => {
    const listStart = rendererSource.indexOf('<div className="diff-file-list">')
    const buttonStart = rendererSource.indexOf('<button', listStart)
    const buttonEnd = rendererSource.indexOf('</button>', buttonStart)
    const buttonBody = rendererSource.slice(buttonStart, buttonEnd)

    expect(buttonBody).toContain('onClick={() => handleDiffFileClick(file.path)}')
    expect(buttonBody).toContain('disabled={!activeSession || !!loadingLabel}')
    expect(buttonBody).not.toContain('activeSession && !loadingLabel && setSelectedDiffPath(file.path)')
  })

  it('shows visible session guidance on disabled Files and Diff panes', () => {
    const filesStart = rendererSource.indexOf('{activePane === \'files\' && (')
    const filesEnd = rendererSource.indexOf('{activePane === \'diff\' && (', filesStart)
    const filesBody = rendererSource.slice(filesStart, filesEnd)
    const diffStart = rendererSource.indexOf('{activePane === \'diff\' && (')
    const diffEnd = rendererSource.indexOf('{activePane === \'editor\' && (', diffStart)
    const diffBody = rendererSource.slice(diffStart, diffEnd)

    expect(filesBody).toContain('{!activeSession && (')
    expect(filesBody).toContain('Select a project session before browsing files.')
    expect(diffBody).toContain('{!activeSession && (')
    expect(diffBody).toContain('Select a project session before reviewing git changes.')
  })

  it('keeps project MCP row actions disabled without an active session', () => {
    const start = rendererSource.indexOf('{projectMcpServers.length ? projectMcpServers.map(server => {')
    const end = rendererSource.indexOf('}) : activeSession ? (', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(body).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(body).toContain("onClick={() => handleMcpRowClick(server, 'project')}")
    expect(body).toContain("onKeyDown={event => handleMcpServerRowKeyDown(event, server, 'project')}")
    expect(body).toContain("onClick={() => handleMcpInspectClick(server, 'project')} disabled={!activeSession || !!loadingLabel}")
    expect(body).toContain("onClick={() => handleMcpEditClick(server, 'project')} disabled={!activeSession || !!loadingLabel}")
    expect(body).toContain("onClick={() => handleMcpRemoveClick(server, 'project')} disabled={!activeSession || !!loadingLabel}")
    expect(body).not.toContain("onClick={() => !loadingLabel && editMcpServer(server, 'project')}")
    expect(body).not.toContain('onClick={() => !loadingLabel && void inspectProjectMcp(server)}')
    expect(body).not.toContain("onClick={() => !loadingLabel && void removeMcpServer(server.name, 'project')}")
    expect(body).not.toContain('if (!loadingLabel) void inspectProjectMcp(server)')
    expect(body).not.toContain('if (!loadingLabel) editMcpServer(server, \'project\')')
    expect(body).not.toContain('if (!loadingLabel) void removeMcpServer(server.name, \'project\')')
  })

  it('disables MCP row selection and edit actions while loading', () => {
    const userStart = rendererSource.indexOf('key={`user-${serverName}`}')
    const userEnd = rendererSource.indexOf('<strong>{server.name}</strong>', userStart)
    const userBody = rendererSource.slice(userStart, userEnd)
    const userActionsStart = rendererSource.indexOf('<div className="section-actions"', userEnd)
    const userActionsEnd = rendererSource.indexOf('<button className="tool-button" onClick={() => !loadingLabel && void setUserMcpEnabled(server, server.enabled === false)}', userActionsStart)
    const userActionsBody = rendererSource.slice(userActionsStart, userActionsEnd)
    const projectStart = rendererSource.indexOf('key={`project-${serverName}`}', userEnd)
    const projectEnd = rendererSource.indexOf('<strong>{server.name}</strong>', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)

    expect(userBody).toContain('aria-disabled={!!loadingLabel}')
    expect(userBody).toContain('tabIndex={loadingLabel ? -1 : 0}')
    expect(userBody).toContain("onClick={() => handleMcpRowClick(server, 'user')}")
    expect(userBody).toContain("onKeyDown={event => handleMcpServerRowKeyDown(event, server, 'user')}")
    expect(userActionsBody).toContain("onClick={() => handleMcpEditClick(server, 'user')} disabled={!!loadingLabel}")

    expect(projectBody).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(projectBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(projectBody).toContain("onClick={() => handleMcpRowClick(server, 'project')}")
    expect(projectBody).toContain("onKeyDown={event => handleMcpServerRowKeyDown(event, server, 'project')}")
  })

  it('blocks MCP runtime management entrypoints while loading', () => {
    const functionRanges = [
      ['saveMcpServer', 'async function removeMcpServer'],
      ['removeMcpServer', 'async function inspectUserMcp'],
      ['inspectUserMcp', 'async function inspectProjectMcp'],
      ['inspectProjectMcp', 'async function setProjectMcpApproval'],
      ['setProjectMcpApproval', 'async function setUserMcpEnabled'],
      ['setUserMcpEnabled', 'function editMcpServer'],
      ['checkMcpHealth', 'function pluginCommandCwd'],
    ] as const

    for (const [functionName, endNeedle] of functionRanges) {
      const start = rendererSource.indexOf(`async function ${functionName}`)
      const end = rendererSource.indexOf(endNeedle, start + 1)
      const body = rendererSource.slice(start, end)

      expect(body).toContain('if (loadingLabel) return')
      expect(body.indexOf('if (loadingLabel) return')).toBeGreaterThan(
        body.indexOf(`async function ${functionName}`),
      )
      expect(body.indexOf('if (loadingLabel) return')).toBeLessThan(
        body.indexOf('mcpActionPendingRef.current.has'),
      )
    }

    expect(rendererSource).toContain('<button className="tool-button" onClick={handleMcpHealthCheckClick} disabled={!activeSession || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={handleMcpSaveClick} disabled={!canSaveMcp || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => handleMcpInspectClick(server, \'user\')} disabled={!!loadingLabel}>')
    expect(rendererSource).toContain('function toggleUserMcpServer(server: McpServerInfo): void')
    expect(rendererSource).toContain('if (loadingLabel) return')
    expect(rendererSource).toContain('void setUserMcpEnabled(server, server.enabled === false)')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => toggleUserMcpServer(server)} disabled={!!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button danger" onClick={() => handleMcpRemoveClick(server, \'user\')} disabled={!!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => handleMcpInspectClick(server, \'project\')} disabled={!activeSession || !!loadingLabel}>')
    expect(rendererSource).toContain('function approveProjectMcpServer(server: McpServerInfo): void')
    expect(rendererSource).toContain('void setProjectMcpApproval(server, true)')
    expect(rendererSource).toContain('function rejectProjectMcpServer(server: McpServerInfo): void')
    expect(rendererSource).toContain('void setProjectMcpApproval(server, false)')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => approveProjectMcpServer(server)} disabled={!activeSession || server.approvalStatus === \'approved\' || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => rejectProjectMcpServer(server)} disabled={!activeSession || server.approvalStatus === \'rejected\' || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button danger" onClick={() => handleMcpRemoveClick(server, \'project\')} disabled={!activeSession || !!loadingLabel}>')
    expect(rendererSource).not.toContain('<button className="tool-button" onClick={() => !loadingLabel && void setUserMcpEnabled(server, server.enabled === false)} disabled={!!loadingLabel}>')
    expect(rendererSource).not.toContain('<button className="tool-button" onClick={() => !loadingLabel && void setProjectMcpApproval(server, true)} disabled={!activeSession || server.approvalStatus === \'approved\' || !!loadingLabel}>')
    expect(rendererSource).not.toContain('<button className="tool-button" onClick={() => !loadingLabel && void setProjectMcpApproval(server, false)} disabled={!activeSession || server.approvalStatus === \'rejected\' || !!loadingLabel}>')
  })

  it('routes stale MCP health checks through the Settings handler', () => {
    const mcpStart = rendererSource.indexOf('<section className="settings-section" id="settings-mcp">')
    const mcpEnd = rendererSource.indexOf('<section className="settings-section" id="settings-skills">', mcpStart)
    const mcpBody = rendererSource.slice(mcpStart, mcpEnd)

    expect(rendererSource).toContain('function handleMcpHealthCheckClick(): void')
    expect(mcpBody).toContain('<button className="tool-button" onClick={handleMcpHealthCheckClick} disabled={!activeSession || !!loadingLabel}>')
    expect(mcpBody).not.toContain('onClick={() => !loadingLabel && void checkMcpHealth()}')
    expect(mcpBody).not.toContain('activeSession && !loadingLabel && void checkMcpHealth()')
  })

  it('routes stale MCP save clicks through the Settings handler', () => {
    const saveStart = rendererSource.indexOf('async function saveMcpServer')
    const saveEnd = rendererSource.indexOf('async function removeMcpServer', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const mcpStart = rendererSource.indexOf('<section className="settings-section" id="settings-mcp">')
    const mcpEnd = rendererSource.indexOf('<section className="settings-section" id="settings-skills">', mcpStart)
    const mcpBody = rendererSource.slice(mcpStart, mcpEnd)

    expect(saveBody).toContain("text: 'Choose a valid MCP scope before saving.'")
    expect(saveBody).toContain("text: 'Choose a valid MCP transport mode before saving.'")
    expect(saveBody).toContain("text: 'Enter a valid MCP remote URL before saving.'")
    expect(saveBody).toContain("text: 'Select a session before editing project MCP servers'")
    expect(rendererSource).toContain('function handleMcpSaveClick(): void')
    expect(mcpBody).toContain('<button className="tool-button" onClick={handleMcpSaveClick} disabled={!canSaveMcp || !!loadingLabel}>')
    expect(mcpBody).not.toContain('onClick={() => !loadingLabel && void saveMcpServer()}')
    expect(mcpBody).not.toContain('canSaveMcp && !loadingLabel && void saveMcpServer()')
  })

  it('blocks MCP edit and cancel buttons while loading', () => {
    const mcpStart = rendererSource.indexOf('<section className="settings-section" id="settings-mcp">')
    const mcpEnd = rendererSource.indexOf('<details className="settings-drawer" open>', mcpStart)
    const mcpBody = rendererSource.slice(mcpStart, mcpEnd)

    expect(rendererSource).toContain('function handleMcpCancelEditClick(): void')
    expect(rendererSource).toContain("function handleMcpEditClick(server: McpServerInfo, scope: 'user' | 'project'): void")
    expect(mcpBody).toContain('<button className="tool-button" onClick={handleMcpCancelEditClick} disabled={!!loadingLabel}>')
    expect(mcpBody).toContain('<button className="tool-button" onClick={() => handleMcpEditClick(server, \'user\')} disabled={!!loadingLabel}>')
    expect(mcpBody).toContain('<button className="tool-button" onClick={() => handleMcpEditClick(server, \'project\')} disabled={!activeSession || !!loadingLabel}>')
    expect(mcpBody).not.toContain('onClick={() => !loadingLabel && cancelMcpEdit()}')
    expect(mcpBody).not.toContain("onClick={() => !loadingLabel && editMcpServer(server, 'user')}")
    expect(mcpBody).not.toContain("onClick={() => !loadingLabel && editMcpServer(server, 'project')}")
  })

  it('disables Skill row inspection while loading', () => {
    const userStart = rendererSource.indexOf('key={`user-${skillPath}`}')
    const userEnd = rendererSource.indexOf('<strong>{skill.name}</strong>', userStart)
    const userBody = rendererSource.slice(userStart, userEnd)
    const projectStart = rendererSource.indexOf('key={`project-${skillPath}`}', userEnd)
    const projectEnd = rendererSource.indexOf('<strong>{skill.name}</strong>', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)

    expect(userBody).toContain('aria-disabled={!!loadingLabel}')
    expect(userBody).toContain('tabIndex={loadingLabel ? -1 : 0}')
    expect(rendererSource).toContain("function handleSkillRowClick(skill: InstalledSkillInfo, scope: 'user' | 'project'): void")
    expect(userBody).toContain("onClick={() => handleSkillRowClick(skill, 'user')}")
    expect(userBody).toContain("onKeyDown={event => handleSkillRowKeyDown(event, skill, 'user')}")
    expect(projectBody).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(projectBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(projectBody).toContain("onClick={() => handleSkillRowClick(skill, 'project')}")
    expect(projectBody).toContain("onKeyDown={event => handleSkillRowKeyDown(event, skill, 'project')}")
    expect(rendererSource).toContain("function handleSkillRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, skill: InstalledSkillInfo, scope: 'user' | 'project'): void")
    expect(rendererSource).not.toContain('onKeyDown={event => !loadingLabel && handleOptionSelectKeyDown(event, () => void inspectUserSkill(skill))}')
    expect(rendererSource).not.toContain('onKeyDown={event => !loadingLabel && handleOptionSelectKeyDown(event, () => void inspectProjectSkill(skill))}')
  })

  it('exposes settings refresh from the command palette with visible settings feedback', () => {
    expect(rendererSource).toContain("id: 'settings:refresh'")
    expect(rendererSource).toContain("label: 'Refresh settings'")
    expect(rendererSource).toContain("detail: 'Reload Claude Code configuration'")
    expect(rendererSource).toContain('disabled: !!loadingLabel')
    expect(rendererSource).toContain('disabledReason: loadingReason')
    expect(rendererSource).toContain("openPaneSection('settings', 'settings-runtime', 'settings')")
    expect(rendererSource).toContain('void refreshSettingsConfig()')
    expect(rendererSource).toContain("await runAction('Refreshing config', async () =>")
    expect(rendererSource).toContain('refreshDesktopConfig({ showStatus: !session })')
    expect(rendererSource).toContain("setSettingsStatus({ kind: 'success', text: 'Refreshed configuration.' })")
  })

  it('refreshes active workspace settings resources from Settings refresh', () => {
    const refreshStart = rendererSource.indexOf('async function refreshSettingsConfig')
    const refreshEnd = rendererSource.indexOf('async function exportDiagnostics', refreshStart)
    const refreshBody = rendererSource.slice(refreshStart, refreshEnd)

    expect(refreshBody).toContain('const session = activeSession')
    expect(refreshBody).toContain('await refreshDesktopConfig({ showStatus: !session })')
    expect(refreshBody).toContain('if (session) {')
    expect(refreshBody).toContain('await refreshWorkspace(session)')
    expect(refreshBody).toContain('if (activeSessionIdRef.current !== session.id) return')
    expect(refreshBody).toContain("setSettingsStatus({ kind: 'success', text: 'Refreshed configuration and workspace settings.' })")
  })

  it('blocks runtime and proxy settings management entrypoints while loading', () => {
    const refreshStart = rendererSource.indexOf('async function refreshSettingsConfig')
    const refreshEnd = rendererSource.indexOf('async function exportDiagnostics', refreshStart)
    const refreshBody = rendererSource.slice(refreshStart, refreshEnd)
    const exportStart = rendererSource.indexOf('async function exportDiagnostics')
    const exportEnd = rendererSource.indexOf('useEffect(() => {', exportStart)
    const exportBody = rendererSource.slice(exportStart, exportEnd)
    const proxyStart = rendererSource.indexOf('async function saveProxySettings')
    const proxyEnd = rendererSource.indexOf('async function runSkillAction', proxyStart)
    const proxyBody = rendererSource.slice(proxyStart, proxyEnd)
    const tasksStart = rendererSource.indexOf('Scheduled Tasks ·')
    const tasksEnd = rendererSource.indexOf('<nav className="pane-jumpbar" aria-label="Scheduled task sections">', tasksStart)
    const tasksBody = rendererSource.slice(tasksStart, tasksEnd)
    const settingsHeaderStart = rendererSource.indexOf('<div className="settings-content-header">')
    const settingsHeaderEnd = rendererSource.indexOf('{settingsStatus && (', settingsHeaderStart)
    const settingsHeaderBody = rendererSource.slice(settingsHeaderStart, settingsHeaderEnd)
    const runtimeStart = rendererSource.indexOf('<section className="settings-section" id="settings-runtime">')
    const runtimeEnd = rendererSource.indexOf('<section className="settings-section" id="settings-proxy">', runtimeStart)
    const runtimeBody = rendererSource.slice(runtimeStart, runtimeEnd)
    const proxySectionStart = rendererSource.indexOf('<section className="settings-section" id="settings-proxy">')
    const proxySectionEnd = rendererSource.indexOf('<details className="settings-drawer" open>', proxySectionStart)
    const proxySectionBody = rendererSource.slice(proxySectionStart, proxySectionEnd)

    expect(refreshBody).toContain('if (loadingLabel) return')
    expect(refreshBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      refreshBody.indexOf('if (settingsRefreshActionPendingRef.current) return'),
    )
    expect(exportBody).toContain('if (loadingLabel) return')
    expect(exportBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      exportBody.indexOf('if (diagnosticsExportActionPendingRef.current) return'),
    )
    expect(proxyBody).toContain('if (loadingLabel) return')
    expect(proxyBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      proxyBody.indexOf('if (proxyActionPendingRef.current) return'),
    )
    expect(rendererSource).toContain('function handleSettingsRefreshClick(): void')
    expect(rendererSource).toContain('function handleDiagnosticsExportClick(): void')
    expect(rendererSource).toContain('function handleProxySaveClick(): void')
    expect(tasksBody).toContain('<button className="tool-button" onClick={handleSettingsRefreshClick} disabled={!!loadingLabel}>')
    expect(settingsHeaderBody).toContain('<button className="tool-button" onClick={handleSettingsRefreshClick} disabled={!!loadingLabel}>')
    expect(runtimeBody).toContain('<button className="tool-button" onClick={handleDiagnosticsExportClick} disabled={!!loadingLabel}>')
    expect(proxySectionBody).toContain('<button className="tool-button" onClick={handleProxySaveClick} disabled={!canSaveProxy || !!loadingLabel}>')
    expect(tasksBody).not.toContain('onClick={() => !loadingLabel && void refreshSettingsConfig()}')
    expect(settingsHeaderBody).not.toContain('onClick={() => !loadingLabel && void refreshSettingsConfig()}')
    expect(runtimeBody).not.toContain('onClick={() => !loadingLabel && void exportDiagnostics()}')
    expect(proxySectionBody).not.toContain('onClick={() => !loadingLabel && void saveProxySettings()}')
    expect(proxySectionBody).not.toContain('canSaveProxy && !loadingLabel && void saveProxySettings()')
  })

  it('exposes custom slash commands from the command palette', () => {
    const start = rendererSource.indexOf('const commandPaletteItems = useMemo')
    const end = rendererSource.indexOf('const commandPaletteItemsForQuery', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('customCommands.map(command => ({')
    expect(body).toContain('id: `slash-command:${customCommandOptionId(command)}`')
    expect(body).toContain('label: `/${command.name}`')
    expect(body).toContain('detail: customCommandDetail(command)')
    expect(body).toContain('icon: \'terminal\'')
    expect(body).toContain('run: () => stageSlashCommand(command.name)')

    const helperStart = rendererSource.indexOf('function stageSlashCommand')
    const helperEnd = rendererSource.indexOf('const commandPaletteItems = useMemo', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    expect(helperBody).toContain('function stageSlashCommand(commandName: string): void')
    expect(helperBody).toContain('const nextCursor = commandName.length + 2')
    expect(helperBody).toContain("openPrimaryView('chat')")
    expect(helperBody).toContain('setInput(`/${commandName} `)')
    expect(helperBody).toContain('setComposerCursor(nextCursor)')
    expect(helperBody).toContain('const textarea = composerTextareaRef.current')
    expect(helperBody).toContain('textarea?.focus()')
    expect(helperBody).toContain('textarea?.setSelectionRange(nextCursor, nextCursor)')
  })

  it('disables command palette custom slash commands while loading', () => {
    const paletteStart = rendererSource.indexOf('const commandPaletteItems = useMemo')
    const paletteEnd = rendererSource.indexOf('const commandPaletteItemsForQuery', paletteStart)
    const paletteBody = rendererSource.slice(paletteStart, paletteEnd)

    expect(paletteBody).toContain("item.id.startsWith('slash-command:')")
    expect(paletteBody).toContain('disabledReason: item.disabledReason ?? loadingReason')
  })

  it('routes scheduled task jumpbar actions through lifecycle feedback', () => {
    expect(rendererSource).toContain("function openTasksSection(sectionId: string)")
    expect(rendererSource).toContain("function openProjectTasksSection(): void")
    expect(rendererSource).toContain('function handleProjectTasksSectionClick(): void')
    expect(rendererSource).toContain('function handleGlobalTasksSectionClick(): void')
    expect(rendererSource).toContain('function handleSettingsProjectTasksClick(): void')
    expect(rendererSource).toContain('function handleSettingsGlobalTasksClick(): void')
    expect(rendererSource).toContain("setTasksStatus({")
    expect(rendererSource).toContain("Opened global scheduled tasks.")
    expect(rendererSource).toContain("{...paneJumpbarButtonState(tasksActiveSection === 'tasks-project-tasks')} onClick={handleProjectTasksSectionClick}")
    expect(rendererSource).toContain("{...paneJumpbarButtonState(tasksActiveSection === 'tasks-global-tasks')} onClick={handleGlobalTasksSectionClick}")
  })

  it('disables Settings task shortcut buttons while loading or without a project session', () => {
    const projectStart = rendererSource.indexOf('id="settings-project-tasks"')
    const projectEnd = rendererSource.indexOf('</section>', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)
    const globalStart = rendererSource.indexOf('id="settings-global-tasks"')
    const globalEnd = rendererSource.indexOf('</section>', globalStart)
    const globalBody = rendererSource.slice(globalStart, globalEnd)

    expect(projectBody).toContain('Select a project session before opening project scheduled tasks.')
    expect(rendererSource).toContain('function handleSettingsProjectTasksClick(): void')
    expect(rendererSource).toContain('function handleSettingsGlobalTasksClick(): void')
    expect(projectBody).toContain('onClick={handleSettingsProjectTasksClick}')
    expect(projectBody).toContain('disabled={!activeSession || !!loadingLabel}')
    expect(globalBody).toContain('onClick={handleSettingsGlobalTasksClick}')
    expect(globalBody).toContain('disabled={!!loadingLabel}')
  })

  it('routes stale Settings project task shortcuts through a handler', () => {
    const handlerStart = rendererSource.indexOf('function openProjectTasksSection(): void')
    const handlerEnd = rendererSource.indexOf('function openPrimaryView', handlerStart)
    const handlerBody = rendererSource.slice(handlerStart, handlerEnd)
    const projectStart = rendererSource.indexOf('id="settings-project-tasks"')
    const projectEnd = rendererSource.indexOf('</section>', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)

    expect(handlerBody).toContain('if (loadingLabel) return')
    expect(handlerBody).toContain('if (!activeSession) {')
    expect(handlerBody).toContain("setSettingsStatus({ kind: 'error', text: 'Select a project session before opening project scheduled tasks.' })")
    expect(handlerBody).toContain("openTasksSection('tasks-project-tasks')")
    expect(rendererSource).toContain('function handleSettingsProjectTasksClick(): void')
    expect(projectBody).toContain('onClick={handleSettingsProjectTasksClick}')
    expect(projectBody).not.toContain('onClick={() => !loadingLabel && openProjectTasksSection()}')
    expect(projectBody).not.toContain("activeSession && !loadingLabel && openTasksSection('tasks-project-tasks')")
  })

  it('exposes scheduled task lists as selectable lifecycle options', () => {
    const projectListStart = rendererSource.indexOf('id="project-task-listbox"')
    const projectListEnd = rendererSource.indexOf('{projectTasks.length ? projectTasks.map', projectListStart)
    const projectListBody = rendererSource.slice(projectListStart, projectListEnd)
    const projectItemStart = rendererSource.indexOf('key={taskId}', projectListEnd)
    const projectItemEnd = rendererSource.indexOf('<strong>{task.id}</strong>', projectItemStart)
    const projectItemBody = rendererSource.slice(projectItemStart, projectItemEnd)
    const globalListStart = rendererSource.indexOf('id="scheduled-task-listbox"')
    const globalListEnd = rendererSource.indexOf('{desktopConfig?.scheduledTasks.length ? desktopConfig.scheduledTasks.map', globalListStart)
    const globalListBody = rendererSource.slice(globalListStart, globalListEnd)
    const globalItemStart = rendererSource.indexOf('key={taskId}', globalListEnd)
    const globalItemEnd = rendererSource.indexOf('<strong>{task.name || task.id}</strong>', globalItemStart)
    const globalItemBody = rendererSource.slice(globalItemStart, globalItemEnd)

    expect(projectListBody).toContain('id="project-task-listbox"')
    expect(projectListBody).toContain('role="listbox"')
    expect(projectListBody).toContain('aria-label="Project scheduled tasks"')
    expect(projectListBody).toContain('aria-activedescendant={activeProjectScheduledTaskOptionId()}')
    expect(projectItemBody).toContain('id={projectScheduledTaskOptionId(task)}')
    expect(projectItemBody).toContain('role="option"')
    expect(projectItemBody).toContain('aria-selected={isProjectScheduledTaskItemActive(task)}')
    expect(globalListBody).toContain('id="scheduled-task-listbox"')
    expect(globalListBody).toContain('role="listbox"')
    expect(globalListBody).toContain('aria-label="Global scheduled tasks"')
    expect(globalListBody).toContain('aria-activedescendant={activeScheduledTaskOptionId()}')
    expect(globalItemBody).toContain('id={scheduledTaskOptionId(task)}')
    expect(globalItemBody).toContain('role="option"')
    expect(globalItemBody).toContain('aria-selected={isScheduledTaskItemActive(task)}')
  })

  it('exposes agent task rows as selected lifecycle options', () => {
    const activeStart = rendererSource.indexOf('function isAgentTaskItemActive')
    const activeEnd = rendererSource.indexOf('function isProjectScheduledTaskItemActive', activeStart)
    const activeBody = rendererSource.slice(activeStart, activeEnd)
    const listStart = rendererSource.indexOf('id="agent-task-listbox"')
    const listEnd = rendererSource.indexOf('{activeSession?.agentTasks?.length', listStart)
    const listBody = rendererSource.slice(listStart, listEnd)
    const itemStart = rendererSource.indexOf('key={task.id}', listEnd)
    const itemEnd = rendererSource.indexOf('<strong>{task.description || task.id}</strong>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)

    expect(activeBody).toContain('activeSession?.layout.selectedAgentTaskId?.trim()')
    expect(activeBody).toContain('task.id.trim()')
    expect(listBody).toContain('id="agent-task-listbox"')
    expect(listBody).toContain('role="listbox"')
    expect(listBody).toContain('aria-label="Agent tasks"')
    expect(itemBody).toContain("className={isAgentTaskItemActive(task) ? 'active' : ''}")
    expect(itemBody).toContain('role="option"')
    expect(itemBody).toContain('aria-selected={isAgentTaskItemActive(task)}')
  })

  it('encodes user-controlled scheduled task option ids', () => {
    const projectStart = rendererSource.indexOf('function projectScheduledTaskOptionId')
    const projectEnd = rendererSource.indexOf('function isScheduledTaskItemActive', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)
    const globalStart = rendererSource.indexOf('function scheduledTaskOptionId')
    const globalEnd = rendererSource.indexOf('function optionIdSegment', globalStart)
    const globalBody = rendererSource.slice(globalStart, globalEnd)

    expect(projectBody).toContain('optionIdSegment(taskId)')
    expect(globalBody).toContain('optionIdSegment(taskId)')
  })

  it('normalizes scheduled task option ids and render keys with canonical task ids', () => {
    const projectStart = rendererSource.indexOf('function projectScheduledTaskOptionId')
    const projectEnd = rendererSource.indexOf('function isScheduledTaskItemActive', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)
    const globalStart = rendererSource.indexOf('function scheduledTaskOptionId')
    const globalEnd = rendererSource.indexOf('function optionIdSegment', globalStart)
    const globalBody = rendererSource.slice(globalStart, globalEnd)
    const projectItemStart = rendererSource.indexOf('{projectTasks.length ? projectTasks.map')
    const projectItemEnd = rendererSource.indexOf('<strong>{task.id}</strong>', projectItemStart)
    const projectItemBody = rendererSource.slice(projectItemStart, projectItemEnd)
    const globalItemStart = rendererSource.indexOf('{desktopConfig?.scheduledTasks.length ? desktopConfig.scheduledTasks.map')
    const globalItemEnd = rendererSource.indexOf('<strong>{task.name || task.id}</strong>', globalItemStart)
    const globalItemBody = rendererSource.slice(globalItemStart, globalItemEnd)

    expect(projectBody).toContain('const taskId = task.id.trim()')
    expect(projectBody).toContain('optionIdSegment(taskId)')
    expect(globalBody).toContain('const taskId = task.id.trim()')
    expect(globalBody).toContain('optionIdSegment(taskId)')
    expect(projectItemBody).toContain('const taskId = task.id.trim()')
    expect(projectItemBody).toContain('key={taskId}')
    expect(globalItemBody).toContain('const taskId = task.id.trim()')
    expect(globalItemBody).toContain('key={taskId}')
  })

  it('normalizes scheduled task row active comparisons', () => {
    const projectStart = rendererSource.indexOf('function isProjectScheduledTaskItemActive')
    const projectEnd = rendererSource.indexOf('function projectScheduledTaskOptionId', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)
    const globalStart = rendererSource.indexOf('function isScheduledTaskItemActive')
    const globalEnd = rendererSource.indexOf('function scheduledTaskOptionId', globalStart)
    const globalBody = rendererSource.slice(globalStart, globalEnd)

    expect(projectBody).toContain('return projectTaskDraft.id === task.id.trim()')
    expect(globalBody).toContain('return taskDraft.id === task.id.trim()')
  })

  it('selects scheduled task rows directly from pointer and keyboard input', () => {
    const projectItemStart = rendererSource.indexOf('key={taskId}', rendererSource.indexOf('id="project-task-listbox"'))
    const projectItemEnd = rendererSource.indexOf('<strong>{task.id}</strong>', projectItemStart)
    const projectItemBody = rendererSource.slice(projectItemStart, projectItemEnd)
    const globalItemStart = rendererSource.indexOf('key={taskId}', rendererSource.indexOf('id="scheduled-task-listbox"'))
    const globalItemEnd = rendererSource.indexOf('<strong>{task.name || task.id}</strong>', globalItemStart)
    const globalItemBody = rendererSource.slice(globalItemStart, globalItemEnd)
    const projectActionsStart = rendererSource.indexOf('<div className="section-actions"', projectItemEnd)
    const projectActionsEnd = rendererSource.indexOf('<Icon name="pencil" />Edit', projectActionsStart)
    const projectActionsBody = rendererSource.slice(projectActionsStart, projectActionsEnd)
    const globalActionsStart = rendererSource.indexOf('<div className="section-actions"', globalItemEnd)
    const globalActionsEnd = rendererSource.indexOf('<button className="tool-button" onClick={() => handleScheduledTaskEditClick(task)} disabled={!!loadingLabel}>', globalActionsStart)
    const globalActionsBody = rendererSource.slice(globalActionsStart, globalActionsEnd)

    expect(projectItemBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(projectItemBody).toContain('onClick={() => handleProjectScheduledTaskRowClick(task)}')
    expect(projectItemBody).toContain('onKeyDown={event => handleProjectScheduledTaskRowKeyDown(event, task)}')
    expect(globalItemBody).toContain('tabIndex={loadingLabel ? -1 : 0}')
    expect(globalItemBody).toContain('onClick={() => handleScheduledTaskRowClick(task)}')
    expect(globalItemBody).toContain('onKeyDown={event => handleScheduledTaskRowKeyDown(event, task)}')
    expect(rendererSource).toContain('function handleProjectScheduledTaskRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, task: ProjectScheduledTaskInfo): void')
    expect(rendererSource).toContain('function handleScheduledTaskRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, task: ScheduledTaskInfo): void')
    expect(projectItemBody).not.toContain('onKeyDown={event => !loadingLabel && handleOptionSelectKeyDown(event, () => editProjectScheduledTask(task))}')
    expect(globalItemBody).not.toContain('onKeyDown={event => !loadingLabel && handleOptionSelectKeyDown(event, () => editScheduledTask(task))}')
    expect(projectActionsBody).toContain('onClick={event => event.stopPropagation()}')
    expect(projectActionsBody).toContain('onKeyDown={event => event.stopPropagation()}')
    expect(globalActionsBody).toContain('onClick={event => event.stopPropagation()}')
    expect(globalActionsBody).toContain('onKeyDown={event => event.stopPropagation()}')
  })

  it('disables scheduled task row selection and edit actions while loading', () => {
    const projectItemStart = rendererSource.indexOf('key={taskId}', rendererSource.indexOf('id="project-task-listbox"'))
    const projectItemEnd = rendererSource.indexOf('<strong>{task.id}</strong>', projectItemStart)
    const projectItemBody = rendererSource.slice(projectItemStart, projectItemEnd)
    const globalItemStart = rendererSource.indexOf('key={taskId}', rendererSource.indexOf('id="scheduled-task-listbox"'))
    const globalItemEnd = rendererSource.indexOf('<strong>{task.name || task.id}</strong>', globalItemStart)
    const globalItemBody = rendererSource.slice(globalItemStart, globalItemEnd)
    const projectActionsStart = rendererSource.indexOf('<div className="section-actions"', projectItemEnd)
    const projectActionsEnd = rendererSource.indexOf('<Icon name="pencil" />Edit', projectActionsStart)
    const projectActionsBody = rendererSource.slice(projectActionsStart, projectActionsEnd)
    const globalActionsStart = rendererSource.indexOf('<div className="section-actions"', globalItemEnd)
    const globalActionsEnd = rendererSource.indexOf('<button className="tool-button" onClick={() => handleScheduledTaskToggleClick(task)}', globalActionsStart)
    const globalActionsBody = rendererSource.slice(globalActionsStart, globalActionsEnd)

    expect(projectItemBody).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(projectItemBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(projectItemBody).toContain('onClick={() => handleProjectScheduledTaskRowClick(task)}')
    expect(projectItemBody).toContain('onKeyDown={event => handleProjectScheduledTaskRowKeyDown(event, task)}')
    expect(projectActionsBody).toContain('onClick={() => handleProjectScheduledTaskEditClick(task)} disabled={!activeSession || !!loadingLabel}')

    expect(globalItemBody).toContain('aria-disabled={!!loadingLabel}')
    expect(globalItemBody).toContain('tabIndex={loadingLabel ? -1 : 0}')
    expect(globalItemBody).toContain('onClick={() => handleScheduledTaskRowClick(task)}')
    expect(globalItemBody).toContain('onKeyDown={event => handleScheduledTaskRowKeyDown(event, task)}')
    expect(globalActionsBody).toContain('onClick={() => handleScheduledTaskEditClick(task)} disabled={!!loadingLabel}')
  })

  it('routes project scheduled task actions through handlers when active session becomes stale', () => {
    const projectStart = rendererSource.indexOf('function renderProjectScheduledTasksSection')
    const projectEnd = rendererSource.indexOf('function renderGlobalScheduledTasksSection', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)
    const projectItemStart = rendererSource.indexOf('key={taskId}', rendererSource.indexOf('id="project-task-listbox"'))
    const projectItemEnd = rendererSource.indexOf('</article>', projectItemStart)
    const projectActionsStart = rendererSource.indexOf('<div className="section-actions"', projectItemStart)
    const projectActionsBody = rendererSource.slice(projectActionsStart, projectItemEnd)

    expect(rendererSource).toContain('function handleProjectScheduledTaskSaveClick(): void')
    expect(rendererSource).toContain('function handleProjectScheduledTaskEditClick(task: ProjectScheduledTaskInfo): void')
    expect(rendererSource).toContain('function handleProjectScheduledTaskToggleClick(task: ProjectScheduledTaskInfo): void')
    expect(rendererSource).toContain('function handleProjectScheduledTaskRunClick(task: ProjectScheduledTaskInfo): void')
    expect(rendererSource).toContain('function handleProjectScheduledTaskRemoveClick(task: ProjectScheduledTaskInfo): void')
    expect(projectBody).toContain('<button className="tool-button" onClick={handleProjectScheduledTaskSaveClick} disabled={!canSaveProjectTask || !!loadingLabel}>')
    expect(projectActionsBody).toContain('onClick={() => handleProjectScheduledTaskEditClick(task)} disabled={!activeSession || !!loadingLabel}')
    expect(projectActionsBody).toContain('onClick={() => handleProjectScheduledTaskToggleClick(task)} disabled={!activeSession || !!loadingLabel}')
    expect(projectActionsBody).toContain('onClick={() => handleProjectScheduledTaskRunClick(task)} disabled={!activeSession || !task.enabled || !canQueueRuntimePrompt || !!loadingLabel}')
    expect(projectActionsBody).toContain('onClick={() => handleProjectScheduledTaskRemoveClick(task)} disabled={!activeSession || !!loadingLabel}')
    expect(projectActionsBody).not.toContain('activeSession && !loadingLabel && editProjectScheduledTask(task)')
    expect(projectActionsBody).not.toContain('activeSession && !loadingLabel && void toggleProjectScheduledTaskEnabled(task)')
    expect(projectActionsBody).not.toContain('activeSession && task.enabled && canQueueRuntimePrompt && !loadingLabel && void runProjectScheduledTaskNow(task)')
    expect(projectActionsBody).not.toContain('activeSession && !loadingLabel && void removeProjectScheduledTask(task.id)')
    expect(projectActionsBody).not.toContain('if (!loadingLabel) editProjectScheduledTask(task)')
    expect(projectActionsBody).not.toContain('if (!loadingLabel) void toggleProjectScheduledTaskEnabled(task)')
    expect(projectActionsBody).not.toContain('if (!loadingLabel) void runProjectScheduledTaskNow(task)')
    expect(projectActionsBody).not.toContain('if (!loadingLabel) void removeProjectScheduledTask(task.id)')
    expect(projectActionsBody).not.toContain('onClick={() => !loadingLabel && editProjectScheduledTask(task)}')
    expect(projectActionsBody).not.toContain('onClick={() => !loadingLabel && void toggleProjectScheduledTaskEnabled(task)}')
    expect(projectActionsBody).not.toContain('onClick={() => !loadingLabel && void runProjectScheduledTaskNow(task)}')
    expect(projectActionsBody).not.toContain('onClick={() => !loadingLabel && void removeProjectScheduledTask(task.id)}')
  })

  it('routes stale project scheduled task row selection through the edit handler', () => {
    const projectItemStart = rendererSource.indexOf('key={taskId}', rendererSource.indexOf('id="project-task-listbox"'))
    const projectItemEnd = rendererSource.indexOf('<strong>{task.id}</strong>', projectItemStart)
    const projectItemBody = rendererSource.slice(projectItemStart, projectItemEnd)

    expect(projectItemBody).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(projectItemBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(rendererSource).toContain('function handleProjectScheduledTaskRowClick(task: ProjectScheduledTaskInfo): void')
    expect(projectItemBody).toContain('onClick={() => handleProjectScheduledTaskRowClick(task)}')
    expect(projectItemBody).toContain('onKeyDown={event => handleProjectScheduledTaskRowKeyDown(event, task)}')
    expect(projectItemBody).not.toContain('onClick={() => !loadingLabel && editProjectScheduledTask(task)}')
    expect(projectItemBody).not.toContain('activeSession && !loadingLabel && editProjectScheduledTask(task)')
    expect(projectItemBody).not.toContain('activeSession && !loadingLabel && handleOptionSelectKeyDown(event, () => editProjectScheduledTask(task))')
  })

  it('exposes accessible active state for lifecycle pane jumpbars', () => {
    const helperStart = rendererSource.indexOf('function paneJumpbarButtonState')
    const helperEnd = rendererSource.indexOf('function menuItemState', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)

    expect(rendererSource).toContain('function paneJumpbarButtonState(active: boolean):')
    expect(helperBody).toContain("'aria-current': active ? 'page' : undefined")
    expect(helperBody).toContain("'aria-pressed': active")
    expect(helperBody).toContain("'aria-disabled': !!loadingLabel")
    expect(helperBody).toContain('tabIndex: loadingLabel ? -1 : 0')
    expect(rendererSource).toContain('function handleTeamsSectionClick(): void')
    expect(rendererSource).toContain('function handleAgentsOverviewSectionClick(): void')
    expect(rendererSource).toContain('function handleAgentsCatalogSectionClick(): void')
    expect(rendererSource).toContain('function handleAgentsLaunchSectionClick(): void')
    expect(rendererSource).toContain('function handleAgentsEditorSectionClick(): void')
    expect(rendererSource).toContain('function handleAgentsTasksSectionClick(): void')
    expect(rendererSource).toContain("{...paneJumpbarButtonState(teamsActiveSection === 'agents-teams')} onClick={handleTeamsSectionClick}")
    expect(rendererSource).toContain("{...paneJumpbarButtonState(agentsActiveSection === 'agents-sources')} onClick={handleAgentsOverviewSectionClick}")
    expect(rendererSource).toContain("{...paneJumpbarButtonState(agentsActiveSection === 'agents-catalog')} onClick={handleAgentsCatalogSectionClick}")
    expect(rendererSource).toContain("{...paneJumpbarButtonState(agentsActiveSection === 'agents-launch')} onClick={handleAgentsLaunchSectionClick}")
    expect(rendererSource).toContain("{...paneJumpbarButtonState(agentsActiveSection === 'agents-editor')} onClick={handleAgentsEditorSectionClick}")
    expect(rendererSource).toContain("{...paneJumpbarButtonState(agentsActiveSection === 'agents-tasks')} onClick={handleAgentsTasksSectionClick}")
    expect(rendererSource).not.toContain("{...paneJumpbarButtonState(teamsActiveSection === 'agents-teams')} onClick={() => !loadingLabel && openPaneSection('teams', 'agents-teams', 'teams')}")
    expect(rendererSource).not.toContain("{...paneJumpbarButtonState(agentsActiveSection === 'agents-sources')} onClick={() => !loadingLabel && openPaneSection('agents', 'agents-sources', 'agents')}")
    expect(rendererSource).not.toContain("{...paneJumpbarButtonState(agentsActiveSection === 'agents-catalog')} onClick={() => !loadingLabel && openPaneSection('agents', 'agents-catalog', 'agents')}")
    expect(rendererSource).not.toContain("{...paneJumpbarButtonState(agentsActiveSection === 'agents-launch')} onClick={() => !loadingLabel && openPaneSection('agents', 'agents-launch', 'agents')}")
    expect(rendererSource).not.toContain("{...paneJumpbarButtonState(agentsActiveSection === 'agents-editor')} onClick={() => !loadingLabel && openPaneSection('agents', 'agents-editor', 'agents')}")
    expect(rendererSource).not.toContain("{...paneJumpbarButtonState(agentsActiveSection === 'agents-tasks')} onClick={() => !loadingLabel && openPaneSection('agents', 'agents-tasks', 'agents')}")
    expect(rendererSource).toContain("{...paneJumpbarButtonState(tasksActiveSection === 'tasks-project-tasks')} onClick={handleProjectTasksSectionClick}")
    expect(rendererSource).toContain("{...paneJumpbarButtonState(tasksActiveSection === 'tasks-global-tasks')} onClick={handleGlobalTasksSectionClick}")
  })

  it('flushes pending sections when first-class Agents and Teams pages mount', () => {
    const paneStart = rendererSource.indexOf("{(activePane === 'agents' || activePane === 'teams') && (")
    const paneEnd = rendererSource.indexOf('<div className="pane-toolbar">', paneStart)
    const paneBody = rendererSource.slice(paneStart, paneEnd)

    expect(paneBody).toContain("if (element) flushPendingPaneSection(activePane === 'teams' ? 'teams' : 'agents')")
    expect(paneBody).not.toContain("if (element && activePane === 'agents') flushPendingPaneSection('agents')")
  })

  it('exposes accessible selected state for session menus', () => {
    const createMenuStart = rendererSource.indexOf('{sessionCreateMenu && (')
    const createMenuEnd = rendererSource.indexOf('{sessionMenu && (', createMenuStart)
    const createMenuBody = rendererSource.slice(createMenuStart, createMenuEnd)
    const actionMenuStart = rendererSource.indexOf('{sessionMenu && (')
    const actionMenuEnd = rendererSource.indexOf('<section', actionMenuStart)
    const actionMenuBody = rendererSource.slice(actionMenuStart, actionMenuEnd)

    expect(rendererSource).toContain("function menuItemState(active: boolean, className = ''):")
    expect(rendererSource).toContain("'aria-selected': active")
    expect(rendererSource).toContain('aria-haspopup="menu"')
    expect(rendererSource).toContain('aria-controls="session-create-menu"')
    expect(rendererSource).toContain('aria-expanded={Boolean(sessionCreateMenu)}')
    expect(rendererSource).toContain('id="session-create-menu"')
    expect(rendererSource).toContain("aria-controls={sessionMenu?.sessionId === session.id ? 'session-action-menu' : undefined}")
    expect(rendererSource).toContain('aria-expanded={sessionMenu?.sessionId === session.id}')
    expect(rendererSource).toContain('id="session-action-menu"')
    expect(createMenuBody).toContain("aria-activedescendant={sessionCreateMenuItemIds[sessionCreateMenuActiveIndex]}")
    expect(createMenuBody).toContain('id={sessionCreateMenuItemIds[0]}')
    expect(createMenuBody).toContain('id={sessionCreateMenuItemIds[1]}')
    expect(createMenuBody).not.toContain('session-create-menu-item-${sessionCreateMenuActiveIndex}')
    expect(actionMenuBody).toContain("aria-activedescendant={sessionActionMenuItemIds[sessionMenuActiveIndex]}")
    expect(actionMenuBody).toContain('id={sessionActionMenuItemIds[0]}')
    expect(actionMenuBody).toContain('id={sessionActionMenuItemIds[1]}')
    expect(actionMenuBody).toContain('id={sessionActionMenuItemIds[2]}')
    expect(actionMenuBody).not.toContain('session-menu-item-${sessionMenuActiveIndex}')
    expect(rendererSource).toContain("{...menuItemState(sessionCreateMenuActiveIndex === 0)}")
    expect(rendererSource).toContain("{...menuItemState(sessionCreateMenuActiveIndex === 1)}")
    expect(rendererSource).toContain("{...menuItemState(sessionMenuActiveIndex === 0)}")
    expect(rendererSource).toContain("{...menuItemState(sessionMenuActiveIndex === 1)}")
    expect(rendererSource).toContain("{...menuItemState(sessionMenuActiveIndex === 2, 'danger')}")
  })

  it('disables session create menu actions while loading', () => {
    const actionStart = rendererSource.indexOf('function runSessionCreateMenuAction')
    const actionEnd = rendererSource.indexOf('function updateComposerSelection', actionStart)
    const actionBody = rendererSource.slice(actionStart, actionEnd)
    expect(actionBody).toContain('if (loadingLabel) return')

    const menuStart = rendererSource.indexOf('{sessionCreateMenu && (')
    const menuEnd = rendererSource.indexOf('{sessionMenu && (', menuStart)
    const menuBody = rendererSource.slice(menuStart, menuEnd)
    expect(menuBody).toContain('aria-disabled={!!loadingLabel}')
    expect(menuBody).toContain('onClick={() => handleSessionCreateMenuItemClick(0)}')
    expect(menuBody).toContain('onClick={() => handleSessionCreateMenuItemClick(1)}')
    expect(menuBody).not.toContain('onClick={() => !loadingLabel && runSessionCreateMenuAction(')
  })

  it('blocks session creation entrypoints while loading', () => {
    const createStart = rendererSource.indexOf('async function createSession')
    const createEnd = rendererSource.indexOf('async function createDefaultSession', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)

    expect(createBody).toContain('if (loadingLabel) return')
    expect(createBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      createBody.indexOf('sessionCreateActionPendingRef.current = true'),
    )

    const defaultStart = rendererSource.indexOf('async function createDefaultSession')
    const defaultEnd = rendererSource.indexOf('function openSessionCreateMenu', defaultStart)
    const defaultBody = rendererSource.slice(defaultStart, defaultEnd)

    expect(defaultBody).toContain('if (loadingLabel) return')
    expect(defaultBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      defaultBody.indexOf('sessionCreateActionPendingRef.current = true'),
    )

    const openStart = rendererSource.indexOf('function openSessionCreateMenu')
    const openEnd = rendererSource.indexOf('function runSessionCreateMenuAction', openStart)
    const openBody = rendererSource.slice(openStart, openEnd)

    expect(openBody).toContain('if (loadingLabel) return')
    expect(openBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      openBody.indexOf('setSessionCreateMenuActiveIndex(0)'),
    )

    expect(rendererSource).toContain('function handleSessionCreateButtonClick(event: ReactMouseEvent<HTMLElement>): void')
    expect(rendererSource).toContain('onClick={handleSessionCreateButtonClick}')
    expect(rendererSource).not.toContain('onClick={event => !loadingLabel && openSessionCreateMenu(event)}')
  })

  it('shows actionable feedback when project folder selection is cancelled without an active session', () => {
    const createStart = rendererSource.indexOf('async function createSession')
    const createEnd = rendererSource.indexOf('async function createDefaultSession', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)

    expect(createBody).toContain("'Choose a project folder to start a session, or use Quick session to continue without selecting a folder.'")
    expect(createBody).not.toContain('No project folder selected.')
  })

  it('blocks chat header and empty session buttons while loading', () => {
    const headerStart = rendererSource.indexOf('<div className="header-actions">')
    const headerEnd = rendererSource.indexOf('</div>', headerStart)
    const headerBody = rendererSource.slice(headerStart, headerEnd)
    const emptyStart = rendererSource.indexOf('<div className="empty-actions">')
    const emptyEnd = rendererSource.indexOf('</div>', emptyStart)
    const emptyBody = rendererSource.slice(emptyStart, emptyEnd)

    expect(headerBody).toContain('onClick={handleRefreshWorkspaceClick} disabled={!activeSession || !!loadingLabel}')
    expect(headerBody).toContain('onClick={handleCancelTurnClick} disabled={!cancelAvailable || !!loadingLabel}')
    expect(headerBody).toContain('onClick={handleClearDesktopTranscriptViewClick} disabled={!activeSession || !!loadingLabel}')
    expect(headerBody).toContain('onClick={handleCloseSessionClick} disabled={!activeSession || !!loadingLabel}')
    expect(rendererSource).toContain('function handleQuickSessionClick(): void')
    expect(rendererSource).toContain('function handleChooseFolderSessionClick(): void')
    expect(emptyBody).toContain('<button className="send-button" onClick={handleQuickSessionClick} disabled={!!loadingLabel}>')
    expect(emptyBody).toContain('<button className="tool-button" onClick={handleChooseFolderSessionClick} disabled={!!loadingLabel}>')
    expect(emptyBody).not.toContain('<button className="send-button" onClick={() => !loadingLabel && void createDefaultSession()} disabled={!!loadingLabel}>')
    expect(emptyBody).not.toContain('<button className="tool-button" onClick={() => !loadingLabel && void createSession()} disabled={!!loadingLabel}>')
  })

  it('routes stale chat header lifecycle clicks through handlers', () => {
    const headerStart = rendererSource.indexOf('<div className="header-actions">')
    const headerEnd = rendererSource.indexOf('</div>', headerStart)
    const headerBody = rendererSource.slice(headerStart, headerEnd)

    expect(rendererSource).toContain('function handleRefreshWorkspaceClick(): void')
    expect(rendererSource).toContain('function handleCancelTurnClick(): void')
    expect(rendererSource).toContain('function handleClearDesktopTranscriptViewClick(): void')
    expect(rendererSource).toContain('function handleCloseSessionClick(): void')
    expect(headerBody).toContain('onClick={handleRefreshWorkspaceClick} disabled={!activeSession || !!loadingLabel}')
    expect(headerBody).toContain('onClick={handleCancelTurnClick} disabled={!cancelAvailable || !!loadingLabel}')
    expect(headerBody).toContain('onClick={handleClearDesktopTranscriptViewClick} disabled={!activeSession || !!loadingLabel}')
    expect(headerBody).toContain('onClick={handleCloseSessionClick} disabled={!activeSession || !!loadingLabel}')
    expect(headerBody).not.toContain('onClick={() => !loadingLabel && void refreshActiveWorkspace()}')
    expect(headerBody).not.toContain('onClick={() => !loadingLabel && void cancelSession()}')
    expect(headerBody).not.toContain('onClick={() => !loadingLabel && void clearDesktopTranscriptView()}')
    expect(headerBody).not.toContain('onClick={() => !loadingLabel && void closeSession()}')
    expect(headerBody).not.toContain('cancelAvailable && !loadingLabel && void cancelSession()')
    expect(headerBody).not.toContain('activeSession && !loadingLabel && void runAction(\'Refreshing workspace\'')
    expect(headerBody).not.toContain('activeSession && !loadingLabel && void clearDesktopTranscriptView()')
    expect(headerBody).not.toContain('activeSession && !loadingLabel && void closeSession()')
  })

  it('exposes clear desktop transcript view through guarded session lifecycle actions', () => {
    const actionStart = rendererSource.indexOf('async function clearDesktopTranscriptView')
    const actionEnd = rendererSource.indexOf('async function closeSession', actionStart)
    const actionBody = rendererSource.slice(actionStart, actionEnd)
    expect(actionBody).toContain('if (!activeSession) {')
    expect(actionBody).toContain('if (loadingLabel) return')
    expect(actionBody).toContain("title: 'Clear desktop transcript view?'")
    expect(actionBody).toContain('window.claudeDesktop.sessions.clearDesktopView(session.id)')
    expect(actionBody).toContain("setConversationNotice({ kind: 'success', text: 'Cleared the desktop transcript view.' })")

    const paletteStart = rendererSource.indexOf('const commandPaletteItems = useMemo')
    const paletteEnd = rendererSource.indexOf('const commandPaletteItemsForQuery', paletteStart)
    const paletteBody = rendererSource.slice(paletteStart, paletteEnd)
    expect(paletteBody).toContain("id: 'session:clear-desktop-view'")
    expect(paletteBody).toContain("label: 'Clear desktop transcript view'")
    expect(paletteBody).toContain('disabled: sessionRequired || !!loadingLabel')
    expect(paletteBody).toContain('run: () => void clearDesktopTranscriptView()')
  })

  it('shows a conversation notice when session lifecycle actions lose the active session', () => {
    const refreshStart = rendererSource.indexOf('async function refreshActiveWorkspace')
    expect(refreshStart).toBeGreaterThan(-1)
    const refreshEnd = rendererSource.indexOf('async function refreshWorkspace', refreshStart)
    const refreshBody = rendererSource.slice(refreshStart, refreshEnd)
    const cancelStart = rendererSource.indexOf('async function cancelSession')
    const cancelEnd = rendererSource.indexOf('async function clearDesktopTranscriptView', cancelStart)
    const cancelBody = rendererSource.slice(cancelStart, cancelEnd)
    const clearStart = rendererSource.indexOf('async function clearDesktopTranscriptView')
    const clearEnd = rendererSource.indexOf('async function closeSession', clearStart)
    const clearBody = rendererSource.slice(clearStart, clearEnd)
    const closeStart = rendererSource.indexOf('async function closeSession')
    const closeEnd = rendererSource.indexOf('async function closeSessionById', closeStart)
    const closeBody = rendererSource.slice(closeStart, closeEnd)

    expect(refreshBody).toContain('if (!activeSession) {')
    expect(refreshBody).toContain("setConversationNotice({ kind: 'error', text: 'Select a session before refreshing the workspace.' })")
    expect(refreshBody.indexOf('if (!activeSession) {')).toBeLessThan(
      refreshBody.indexOf("await runAction('Refreshing workspace'"),
    )

    expect(cancelBody).toContain('if (!activeSession) {')
    expect(cancelBody).toContain("setConversationNotice({ kind: 'error', text: 'Select a session before cancelling a turn.' })")
    expect(cancelBody).toContain('if (permissionResponding) {')
    expect(cancelBody).toContain("setConversationNotice({ kind: 'info', text: 'Wait for the permission response to finish before cancelling the turn.' })")
    expect(cancelBody).toContain('if (!cancelAvailable) {')
    expect(cancelBody).toContain("setConversationNotice({ kind: 'info', text: 'No active Claude turn is available to cancel.' })")
    expect(cancelBody.indexOf('if (!activeSession) {')).toBeLessThan(
      cancelBody.indexOf('if (permissionResponding) {'),
    )
    expect(cancelBody.indexOf('if (permissionResponding) {')).toBeLessThan(
      cancelBody.indexOf('if (!cancelAvailable) {'),
    )
    expect(cancelBody.indexOf('if (!cancelAvailable) {')).toBeLessThan(
      cancelBody.indexOf('if (cancelActionPendingRef.current) return'),
    )
    expect(cancelBody.indexOf('if (cancelActionPendingRef.current) return')).toBeLessThan(
      cancelBody.indexOf('cancelActionPendingRef.current = true'),
    )
    expect(cancelBody.indexOf('if (!activeSession) {')).toBeLessThan(
      cancelBody.indexOf("await runAction('Cancelling turn'"),
    )

    expect(clearBody).toContain('if (!activeSession) {')
    expect(clearBody).toContain("setConversationNotice({ kind: 'error', text: 'Select a session before clearing the desktop transcript view.' })")
    expect(clearBody.indexOf('if (!activeSession) {')).toBeLessThan(
      clearBody.indexOf('requestConfirmation({'),
    )
    expect(clearBody.indexOf('if (!activeSession) {')).toBeLessThan(
      clearBody.indexOf("await runAction('Clearing desktop transcript view'"),
    )

    expect(closeBody).toContain('if (!activeSession) {')
    expect(closeBody).toContain("setConversationNotice({ kind: 'error', text: 'Select a session before closing it.' })")
    expect(closeBody.indexOf('if (!activeSession) {')).toBeLessThan(
      closeBody.indexOf('await closeSessionById(activeSession.id)'),
    )
  })

  it('disables session row action menu while loading', () => {
    const actionStart = rendererSource.indexOf('function runSessionMenuAction')
    const actionEnd = rendererSource.indexOf('async function openSessionFolder', actionStart)
    const actionBody = rendererSource.slice(actionStart, actionEnd)
    expect(actionBody).toContain('if (loadingLabel) return')

    const menuStart = rendererSource.indexOf('{sessionMenu && (')
    const menuEnd = rendererSource.indexOf('<section', menuStart)
    const menuBody = rendererSource.slice(menuStart, menuEnd)
    expect(menuBody).toContain('aria-disabled={!!loadingLabel}')
    expect(menuBody).toContain('onClick={() => handleSessionMenuItemClick(0)}')
    expect(menuBody).toContain('onClick={() => handleSessionMenuItemClick(1)}')
    expect(menuBody).toContain('onClick={() => handleSessionMenuItemClick(2)}')
    expect(menuBody).not.toContain('onClick={() => !loadingLabel && runSessionMenuAction(')
  })

  it('disables session row focus and menu triggers while loading', () => {
    const focusStart = rendererSource.indexOf('async function focusSession')
    const focusEnd = rendererSource.indexOf('useEffect(() => {', focusStart)
    const focusBody = rendererSource.slice(focusStart, focusEnd)

    expect(focusBody).toContain('if (loadingLabel) return')
    expect(focusBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      focusBody.indexOf('desiredActiveSessionIdRef.current = sessionId'),
    )

    const openMenuStart = rendererSource.indexOf('function openSessionMenu')
    const openMenuEnd = rendererSource.indexOf('function runSessionMenuAction', openMenuStart)
    const openMenuBody = rendererSource.slice(openMenuStart, openMenuEnd)

    expect(openMenuBody).toContain('if (loadingLabel) return')
    expect(openMenuBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      openMenuBody.indexOf('setSessionMenuActiveIndex(0)'),
    )

    const railStart = rendererSource.indexOf('<section className={`rail-sessions')
    const railEnd = rendererSource.indexOf('<div className="rail-footer">', railStart)
    const railBody = rendererSource.slice(railStart, railEnd)

    expect(openMenuBody).toContain('function openSessionMenuForRow(event: ReactMouseEvent, sessionId: string): void')
    expect(openMenuBody).toContain('openSessionMenu(event, sessionId)')
    expect(railBody).toContain('onContextMenu={event => openSessionMenuForRow(event, session.id)}')
    expect(rendererSource).toContain('function handleSessionRowClick(sessionId: string): void')
    expect(railBody).toContain('onClick={() => handleSessionRowClick(session.id)}')
    expect(railBody).toContain('disabled={!!loadingLabel}')
    expect(railBody).toContain('onClick={event => openSessionMenuForRow(event, session.id)}')
    expect(railBody).not.toContain('onContextMenu={event => !loadingLabel && openSessionMenu(event, session.id)}')
    expect(railBody).not.toContain('onClick={() => !loadingLabel && void focusSession(session.id)}')
    expect(railBody).not.toContain('onClick={event => !loadingLabel && openSessionMenu(event, session.id)}')
  })

  it('binds restored active file cleanup to the focused session', () => {
    const restoreStart = rendererSource.indexOf('if (activeSession.layout.activeFile) {')
    const restoreEnd = rendererSource.indexOf('const shouldApplyContents = shouldApplyLoadedEditorContents', restoreStart)
    const restoreBody = rendererSource.slice(restoreStart, restoreEnd)

    expect(restoreBody).toContain('activeSession.layout.activeFile')
    expect(restoreBody).toContain('await window.claudeDesktop.workspace.readFile(')
    expect(restoreBody).toContain('activeSession.cwd,')
    expect(restoreBody).toContain('activeSession.layout.activeFile,')
    expect(restoreBody).toContain('await updateSessionLayout(activeSession.id, { activeFile: undefined })')
    expect(restoreBody).not.toContain('await updateLayout({ activeFile: undefined })')
    expect(restoreBody.indexOf('await updateSessionLayout(activeSession.id, { activeFile: undefined })')).toBeGreaterThan(
      restoreBody.indexOf("setSavedFileContents('')"),
    )
  })

  it('disables session rail collapse while loading', () => {
    const handlerStart = rendererSource.indexOf('function toggleSessionsCollapsed')
    const handlerEnd = rendererSource.indexOf('async function createSession', handlerStart)
    const handlerBody = rendererSource.slice(handlerStart, handlerEnd)
    const toggleStart = rendererSource.indexOf('className="rail-section-toggle"')
    const toggleEnd = rendererSource.indexOf('<Icon name={sessionsCollapsed', toggleStart)
    const toggleBody = rendererSource.slice(toggleStart, toggleEnd)

    expect(handlerBody).toContain('function toggleSessionsCollapsed(): void')
    expect(handlerBody).toContain('if (loadingLabel) return')
    expect(handlerBody).toContain('setSessionsCollapsed(value => !value)')
    expect(handlerBody).toContain('function handleSessionsCollapseClick(): void')
    expect(handlerBody).toContain('toggleSessionsCollapsed()')
    expect(toggleBody).toContain('onClick={handleSessionsCollapseClick}')
    expect(toggleBody).not.toContain('onClick={() => toggleSessionsCollapsed()}')
    expect(toggleBody).not.toContain('setSessionsCollapsed(value => !value)')
    expect(toggleBody).toContain('disabled={!!loadingLabel}')
  })

  it('keeps disabled session menu items visible but inert while loading', () => {
    const createHoverStart = rendererSource.indexOf('function highlightSessionCreateMenuItem')
    const createHoverEnd = rendererSource.indexOf('function highlightSessionMenuItem', createHoverStart)
    const createHoverBody = rendererSource.slice(createHoverStart, createHoverEnd)
    const sessionHoverStart = rendererSource.indexOf('function highlightSessionMenuItem')
    const sessionHoverEnd = rendererSource.indexOf('function toggleSessionsCollapsed', sessionHoverStart)
    const sessionHoverBody = rendererSource.slice(sessionHoverStart, sessionHoverEnd)
    const createMenuStart = rendererSource.indexOf('{sessionCreateMenu && (')
    const createMenuEnd = rendererSource.indexOf('{sessionMenu && (', createMenuStart)
    const createMenuBody = rendererSource.slice(createMenuStart, createMenuEnd)

    expect(createHoverBody).toContain('function highlightSessionCreateMenuItem(index: number): void')
    expect(createHoverBody).toContain('if (loadingLabel) return')
    expect(createHoverBody).toContain('setSessionCreateMenuActiveIndex(index)')
    expect(createMenuBody).toContain('aria-disabled={!!loadingLabel}')
    expect(createMenuBody).toContain('tabIndex={loadingLabel ? -1 : 0}')
    expect(createMenuBody).toContain('onMouseEnter={() => handleSessionCreateMenuItemMouseEnter(0)}')
    expect(createMenuBody).toContain('onMouseEnter={() => handleSessionCreateMenuItemMouseEnter(1)}')
    expect(createMenuBody).toContain('onClick={() => handleSessionCreateMenuItemClick(0)}')
    expect(createMenuBody).toContain('onClick={() => handleSessionCreateMenuItemClick(1)}')
    expect(createMenuBody).not.toContain('onMouseEnter={() => highlightSessionCreateMenuItem(')
    expect(createMenuBody).not.toContain('onClick={() => !loadingLabel && runSessionCreateMenuAction(')
    expect(createMenuBody).not.toContain('setSessionCreateMenuActiveIndex(')

    const sessionMenuStart = rendererSource.indexOf('{sessionMenu && (')
    const sessionMenuEnd = rendererSource.indexOf('<section', sessionMenuStart)
    const sessionMenuBody = rendererSource.slice(sessionMenuStart, sessionMenuEnd)

    expect(sessionHoverBody).toContain('function highlightSessionMenuItem(index: number): void')
    expect(sessionHoverBody).toContain('if (loadingLabel) return')
    expect(sessionHoverBody).toContain('setSessionMenuActiveIndex(index)')
    expect(sessionMenuBody).toContain('aria-disabled={!!loadingLabel}')
    expect(sessionMenuBody).toContain('tabIndex={loadingLabel ? -1 : 0}')
    expect(sessionMenuBody).toContain('onMouseEnter={() => handleSessionMenuItemMouseEnter(0)}')
    expect(sessionMenuBody).toContain('onMouseEnter={() => handleSessionMenuItemMouseEnter(1)}')
    expect(sessionMenuBody).toContain('onMouseEnter={() => handleSessionMenuItemMouseEnter(2)}')
    expect(sessionMenuBody).toContain('onClick={() => handleSessionMenuItemClick(0)}')
    expect(sessionMenuBody).toContain('onClick={() => handleSessionMenuItemClick(1)}')
    expect(sessionMenuBody).toContain('onClick={() => handleSessionMenuItemClick(2)}')
    expect(sessionMenuBody).not.toContain('onMouseEnter={() => highlightSessionMenuItem(')
    expect(sessionMenuBody).not.toContain('onClick={() => !loadingLabel && runSessionMenuAction(')
    expect(sessionMenuBody).not.toContain('setSessionMenuActiveIndex(')
  })

  it('keeps session menu keyboard handlers current with loading state', () => {
    const effectStart = rendererSource.indexOf('if (!sessionMenu && !sessionCreateMenu) return')
    const effectEnd = rendererSource.indexOf('useEffect(() => {', effectStart + 1)
    const effectBody = rendererSource.slice(effectStart, effectEnd)
    expect(effectBody).toContain('loadingLabel,')
  })

  it('uses shared accessible state for workspace pane tabs', () => {
    const helperStart = rendererSource.indexOf('function workspacePaneTabState')
    const helperEnd = rendererSource.indexOf('function agentCatalogCardState', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const selectStart = rendererSource.indexOf('function selectWorkspacePane')
    const selectEnd = rendererSource.indexOf('function workspacePaneTabState', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)

    expect(helperBody).toContain('function workspacePaneTabState(pane: PaneId):')
    expect(helperBody).toContain("'aria-pressed': activePane === pane")
    expect(helperBody).toContain("className: activePane === pane ? 'active' : ''")
    expect(helperBody).toContain("'aria-disabled': !!loadingLabel")
    expect(helperBody).toContain('tabIndex: loadingLabel ? -1 : 0')
    expect(selectBody).toContain('function selectWorkspacePane(pane: PaneId): void')
    expect(selectBody).toContain('if (loadingLabel) return')
    expect(selectBody).toContain('void setPane(pane)')
    expect(selectBody).toContain('function handleWorkspacePaneClick(pane: PaneId): () => void')
    expect(selectBody).toContain('return () => selectWorkspacePane(pane)')
    for (const pane of ['files', 'diff', 'editor', 'terminal', 'preview']) {
      expect(rendererSource).toContain(`{...workspacePaneTabState('${pane}')} onClick={handleWorkspacePaneClick('${pane}')}`)
      expect(rendererSource).not.toContain(`{...workspacePaneTabState('${pane}')} onClick={() => selectWorkspacePane('${pane}')}`)
      expect(rendererSource).not.toContain(`{...workspacePaneTabState('${pane}')} onClick={() => !loadingLabel && void setPane('${pane}')}`)
    }
  })

  it('blocks workspace pane navigation entrypoints while loading', () => {
    const setPaneStart = rendererSource.indexOf('async function setPane')
    const setPaneEnd = rendererSource.indexOf('async function refreshFiles', setPaneStart)
    const setPaneBody = rendererSource.slice(setPaneStart, setPaneEnd)

    expect(setPaneBody).toContain('if (loadingLabel) return')

    const shortcutsStart = rendererSource.indexOf('const pane = WORKSPACE_PANE_SHORTCUTS[event.key]')
    const shortcutsEnd = rendererSource.indexOf("if (event.key === ',')", shortcutsStart)
    const shortcutsBody = rendererSource.slice(shortcutsStart, shortcutsEnd)

    expect(shortcutsBody).toContain('if (loadingLabel) return')
    expect(shortcutsBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      shortcutsBody.indexOf('selectWorkspacePane(pane)'),
    )
    expect(shortcutsBody).toContain('selectWorkspacePane(pane)')
    expect(shortcutsBody).not.toContain('void setPane(pane)')

    const shortcutEffectStart = rendererSource.indexOf('const pane = WORKSPACE_PANE_SHORTCUTS[event.key]')
    const shortcutEffectEnd = rendererSource.indexOf('function closeCommandPalette', shortcutEffectStart)
    const shortcutEffectBody = rendererSource.slice(shortcutEffectStart, shortcutEffectEnd)
    expect(shortcutEffectBody).toContain('loadingLabel,')

    for (const pane of ['files', 'diff', 'editor', 'terminal', 'preview']) {
      const itemStart = rendererSource.indexOf(`id: 'pane:${pane}'`)
      const itemEnd = rendererSource.indexOf('},', itemStart)
      const itemBody = rendererSource.slice(itemStart, itemEnd)

      expect(itemBody).toContain('disabled: sessionRequired || !!loadingLabel')
      expect(itemBody).toContain('disabledReason: sessionRequired ? sessionRequiredReason : loadingReason')
      expect(itemBody).toContain(`run: () => selectWorkspacePane('${pane}')`)
      expect(itemBody).not.toContain(`run: () => void setPane('${pane}')`)
    }
  })

  it('binds workspace pane layout changes to the origin session', () => {
    const setPaneStart = rendererSource.indexOf('async function setPane')
    const setPaneEnd = rendererSource.indexOf('async function refreshFiles', setPaneStart)
    const setPaneBody = rendererSource.slice(setPaneStart, setPaneEnd)

    expect(setPaneBody).toContain('const session = activeSession')
    expect(setPaneBody.indexOf('const session = activeSession')).toBeLessThan(
      setPaneBody.indexOf('confirmDiscardUnsavedChanges()'),
    )
    expect(setPaneBody).toContain('if (!session) return')
    expect(setPaneBody).toContain('const patch: DesktopSessionLayoutPatch = { activePane: pane, primaryView }')
    expect(setPaneBody).toContain('await updateSessionLayout(session.id, patch)')
    expect(setPaneBody).not.toContain('await updateLayout(patch)')
  })

  it('shows Files and Diff errors when workspace refresh actions lose the active session', () => {
    const filesStart = rendererSource.indexOf('async function refreshFiles')
    const filesEnd = rendererSource.indexOf('async function refreshDiff', filesStart)
    const filesBody = rendererSource.slice(filesStart, filesEnd)
    const diffStart = rendererSource.indexOf('async function refreshDiff')
    const diffEnd = rendererSource.indexOf('function scrollPaneSection', diffStart)
    const diffBody = rendererSource.slice(diffStart, diffEnd)

    expect(filesBody).toContain('if (!activeSession) {')
    expect(filesBody).toContain("setFilesStatus({ kind: 'error', text: 'Select a session before refreshing files.' })")
    expect(filesBody.indexOf('if (!activeSession) {')).toBeLessThan(
      filesBody.indexOf('workspaceRefreshActionPendingRef.current.has(activeSession.id)'),
    )
    expect(filesBody.indexOf('if (!activeSession) {')).toBeLessThan(
      filesBody.indexOf("await runAction('Refreshing files'"),
    )

    expect(diffBody).toContain('if (!activeSession) {')
    expect(diffBody).toContain("setDiffStatus({ kind: 'error', text: 'Select a session before refreshing diff.' })")
    expect(diffBody.indexOf('if (!activeSession) {')).toBeLessThan(
      diffBody.indexOf('workspaceRefreshActionPendingRef.current.has(activeSession.id)'),
    )
    expect(diffBody.indexOf('if (!activeSession) {')).toBeLessThan(
      diffBody.indexOf("await runAction('Refreshing diff'"),
    )
  })

  it('shows structured empty state in the Diff file list', () => {
    const diffPaneStart = rendererSource.indexOf("{activePane === 'diff' && (")
    const diffPaneEnd = rendererSource.indexOf("{activePane === 'editor' && (", diffPaneStart)
    const diffPaneBody = rendererSource.slice(diffPaneStart, diffPaneEnd)
    const emptyStart = diffPaneBody.indexOf('diff-empty workarea-empty')
    const emptyEnd = diffPaneBody.indexOf('</div>', emptyStart)
    const emptyBody = diffPaneBody.slice(emptyStart, emptyEnd)

    expect(emptyBody).toContain('diff-empty workarea-empty')
    expect(emptyBody).toContain('<Icon name="diff" />')
    expect(emptyBody).toContain('<strong>No changed files</strong>')
  })
  it('shows raw git status output in a styled block when available', () => {
    const diffPaneStart = rendererSource.indexOf("{activePane === 'diff' && (")
    const diffPaneEnd = rendererSource.indexOf("{activePane === 'editor' && (", diffPaneStart)
    const diffPaneBody = rendererSource.slice(diffPaneStart, diffPaneEnd)
    const styleStart = stylesSource.indexOf('.git-status-empty')
    const styleEnd = stylesSource.indexOf('.diff-viewer', styleStart)
    const styleBody = stylesSource.slice(styleStart, styleEnd)

    expect(diffPaneBody).toContain('{gitStatus.trim() && (')
    expect(diffPaneBody).toContain('<div className="diff-status">')
    expect(diffPaneBody).toContain('<pre>{gitStatus}</pre>')
    expect(styleBody).toContain('.git-status-empty')
    expect(styleBody).toContain('min-height: 88px')
  })

  it('reports clean diff refreshes as completed workspace checks', () => {
    const refreshStart = rendererSource.indexOf('async function refreshWorkspace')
    const refreshEnd = rendererSource.indexOf('async function refreshFiles', refreshStart)
    const refreshBody = rendererSource.slice(refreshStart, refreshEnd)

    expect(refreshBody).toContain("'Checked git changes: workspace is clean.'")
    expect(refreshBody).not.toContain('No unstaged git changes.')
  })

  it('blocks workspace resizing while loading or without an active session', () => {
    const startResizeStart = rendererSource.indexOf('function startResize')
    const startResizeEnd = rendererSource.indexOf('function clampWorkspaceRatio', startResizeStart)
    const startResizeBody = rendererSource.slice(startResizeStart, startResizeEnd)

    expect(startResizeBody).toContain('if (!activeSession) {')
    expect(startResizeBody).toContain("setConversationNotice({ kind: 'error', text: 'Select a session before resizing the workspace.' })")
    expect(startResizeBody.indexOf('if (!activeSession) {')).toBeLessThan(
      startResizeBody.indexOf('const sessionId = activeSession.id'),
    )
    expect(startResizeBody).toContain('if (!!loadingLabel || !workspaceRef.current) return')

    const keyboardResizeStart = rendererSource.indexOf('function resizeWorkspaceWithKeyboard')
    const keyboardResizeEnd = rendererSource.indexOf('async function respondToPermission', keyboardResizeStart)
    const keyboardResizeBody = rendererSource.slice(keyboardResizeStart, keyboardResizeEnd)

    expect(keyboardResizeBody).toContain('if (!activeSession) {')
    expect(keyboardResizeBody).toContain("setConversationNotice({ kind: 'error', text: 'Select a session before resizing the workspace.' })")
    expect(keyboardResizeBody.indexOf('if (!activeSession) {')).toBeLessThan(
      keyboardResizeBody.indexOf('const keyRatios: Record<string, number>'),
    )
    expect(keyboardResizeBody).toContain('if (loadingLabel) return')
    expect(keyboardResizeBody).toContain('const sessionId = activeSession.id')
    expect(keyboardResizeBody).toContain('void updateSessionLayout(sessionId, { workspaceRatio: clampWorkspaceRatio(nextRatio) })')
    expect(keyboardResizeBody).not.toContain('void updateLayout({ workspaceRatio:')

    const handleStart = rendererSource.indexOf('className="resize-handle"')
    const handleEnd = rendererSource.indexOf('/>', handleStart)
    const handleBody = rendererSource.slice(handleStart, handleEnd)

    expect(handleBody).toContain('aria-disabled={!!loadingLabel}')
    expect(handleBody).toContain('tabIndex={activeSession && !loadingLabel ? 0 : -1}')
  })

  it('shows structured empty states for runtime activity cards', () => {
    const activityStart = rendererSource.indexOf('<section className="conversation-activity"')
    const activityEnd = rendererSource.indexOf('{activeSession?.messages.map', activityStart)
    const activityBody = rendererSource.slice(activityStart, activityEnd)
    const toolEmptyStart = activityBody.indexOf('workarea-empty activity-empty-state')
    const toolEmptyEnd = activityBody.indexOf('</div>', toolEmptyStart)
    const toolEmptyBody = activityBody.slice(toolEmptyStart, toolEmptyEnd)
    const todoEmptyStart = activityBody.indexOf('workarea-empty activity-empty-state', toolEmptyEnd)
    const todoEmptyEnd = activityBody.indexOf('</div>', todoEmptyStart)
    const todoEmptyBody = activityBody.slice(todoEmptyStart, todoEmptyEnd)

    expect(toolEmptyBody).toContain('workarea-empty activity-empty-state')
    expect(toolEmptyBody).toContain('<Icon name="terminal" />')
    expect(toolEmptyBody).toContain('<strong>No tool activity</strong>')
    expect(todoEmptyBody).toContain('workarea-empty activity-empty-state')
    expect(todoEmptyBody).toContain('<Icon name="check" />')
    expect(todoEmptyBody).toContain('<strong>No todos yet</strong>')
  })

  it('blocks lifecycle section navigation entrypoints while loading', () => {
    const paneSectionStart = rendererSource.indexOf('function openPaneSection')
    const paneSectionEnd = rendererSource.indexOf('function openSettingsSection', paneSectionStart)
    const paneSectionBody = rendererSource.slice(paneSectionStart, paneSectionEnd)

    expect(paneSectionBody).toContain('if (loadingLabel) return')
    expect(paneSectionBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      paneSectionBody.indexOf('pendingPaneSectionRef.current = { pane, sectionId }'),
    )

    const settingsSectionStart = rendererSource.indexOf('function openSettingsSection')
    const settingsSectionEnd = rendererSource.indexOf('function openTasksSection', settingsSectionStart)
    const settingsSectionBody = rendererSource.slice(settingsSectionStart, settingsSectionEnd)

    expect(settingsSectionBody).toContain('if (loadingLabel) return')
    expect(settingsSectionBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      settingsSectionBody.indexOf('setSettingsActiveSection(sectionId)'),
    )

    const paletteStart = rendererSource.indexOf('const commandPaletteItems = useMemo')
    const paletteEnd = rendererSource.indexOf('const commandPaletteItemsForQuery', paletteStart)
    const paletteBody = rendererSource.slice(paletteStart, paletteEnd)

    expect(paletteBody).toContain("item.id.startsWith('primary:')")
    expect(paletteBody).toContain("item.id.startsWith('pane:')")
    expect(paletteBody).toContain("item.id.startsWith('settings:')")
    expect(paletteBody).toContain("item.id.startsWith('agents:')")
    expect(paletteBody).toContain("item.id.startsWith('teams:')")
    expect(paletteBody).toContain("item.id.startsWith('tasks:')")
    expect(paletteBody).toContain('disabled: true')
    expect(paletteBody).toContain('disabledReason: item.disabledReason ?? loadingReason')
  })

  it('exposes accessible current state for selected agent catalog cards', () => {
    expect(rendererSource).toContain('function agentCatalogCardState(agent: AgentInfo):')
    expect(rendererSource).toContain('const active = isAgentCatalogItemActive(agent)')
    expect(rendererSource).toContain("return selectedAgentType === agent.agentType.trim() && selectedAgentSource === agent.source")
    expect(rendererSource).toContain("'aria-current': active ? 'true' : undefined")
    expect(rendererSource).toContain('{...agentCatalogCardState(agent)}')
  })

  it('normalizes selected agent identity before comparing catalog state', () => {
    const selectedStart = rendererSource.indexOf('const selectedAgent = useMemo')
    const selectedEnd = rendererSource.indexOf('const selectedAgentReadOnly', selectedStart)
    const selectedBody = rendererSource.slice(selectedStart, selectedEnd)
    const activeStart = rendererSource.indexOf('function isAgentCatalogItemActive')
    const activeEnd = rendererSource.indexOf('function agentCatalogOptionId', activeStart)
    const activeBody = rendererSource.slice(activeStart, activeEnd)

    expect(selectedBody).toContain('agent.agentType.trim() === selectedAgentType')
    expect(selectedBody).not.toContain('agent.agentType === selectedAgentType')
    expect(activeBody).toContain('selectedAgentType === agent.agentType.trim()')
    expect(activeBody).not.toContain('selectedAgentType === agent.agentType &&')
  })

  it('exposes agent catalog search as a combobox with selectable options', () => {
    const inputStart = rendererSource.indexOf('value={agentCatalogQuery}')
    const inputEnd = rendererSource.indexOf('/>', inputStart)
    const inputBody = rendererSource.slice(inputStart, inputEnd)
    const listStart = rendererSource.indexOf('id="agent-catalog-listbox"', inputEnd)
    const listEnd = rendererSource.indexOf('{visibleAgents.length ? visibleAgents.map', listStart)
    const listBody = rendererSource.slice(listStart, listEnd)
    const itemStart = rendererSource.indexOf('key={`${agent.source}-${agentType}`}', listEnd)
    const itemEnd = rendererSource.indexOf('<strong>{agent.agentType}</strong>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)
    const emptyStart = rendererSource.indexOf('workarea-empty settings-empty-state', itemEnd)
    const emptyEnd = rendererSource.indexOf('</div>', emptyStart)
    const emptyBody = rendererSource.slice(emptyStart, emptyEnd)

    expect(inputBody).toContain('role="combobox"')
    expect(inputBody).toContain('aria-expanded="true"')
    expect(inputBody).toContain('aria-controls="agent-catalog-listbox"')
    expect(inputBody).toContain('aria-activedescendant={')
    expect(listBody).toContain('id="agent-catalog-listbox"')
    expect(listBody).toContain('role="listbox"')
    expect(itemBody).toContain('id={agentCatalogOptionId(agent)}')
    expect(itemBody).toContain('role="option"')
    expect(itemBody).toContain('aria-selected={')
    expect(emptyBody).toContain('workarea-empty settings-empty-state')
    expect(emptyBody).toContain('<Icon name="bot" />')
    expect(emptyBody).toContain('<strong>No matching agents</strong>')
  })

  it('disables agent catalog filter edits while loading', () => {
    const inputStart = rendererSource.indexOf('value={agentCatalogQuery}')
    const inputEnd = rendererSource.indexOf('/>', inputStart)
    const inputBody = rendererSource.slice(inputStart, inputEnd)
    const sourceStart = rendererSource.indexOf('value={agentCatalogSource}')
    const sourceEnd = rendererSource.indexOf('</select>', sourceStart)
    const sourceBody = rendererSource.slice(sourceStart, sourceEnd)

    expect(inputBody).toContain('disabled={!!loadingLabel}')
    expect(rendererSource).toContain('function handleAgentCatalogQueryChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(inputBody).toContain('onChange={handleAgentCatalogQueryChange}')
    expect(inputBody).not.toContain('setAgentCatalogQuery(event.target.value)')
    expect(sourceBody).toContain('disabled={!!loadingLabel}')
    expect(rendererSource).toContain('function handleAgentCatalogSourceChange(event: ReactChangeEvent<HTMLSelectElement>): void')
    expect(sourceBody).toContain('onChange={handleAgentCatalogSourceChange}')
    expect(sourceBody).not.toContain('setAgentCatalogSource(event.target.value as AgentCatalogSourceFilter)')
  })

  it('encodes user-controlled agent and team option ids', () => {
    const agentStart = rendererSource.indexOf('function agentCatalogOptionId')
    const agentEnd = rendererSource.indexOf('const activeAgentCatalogItem', agentStart)
    const agentBody = rendererSource.slice(agentStart, agentEnd)
    const teamStart = rendererSource.indexOf('function teamOptionId')
    const teamEnd = rendererSource.indexOf('function handleOptionSelectKeyDown', teamStart)
    const teamBody = rendererSource.slice(teamStart, teamEnd)

    expect(agentBody).toContain('optionIdSegment(agent.source)')
    expect(agentBody).toContain('optionIdSegment(agentType)')
    expect(teamBody).toContain('optionIdSegment(teamName)')
  })

  it('normalizes agent catalog option ids and render keys with the canonical agent type', () => {
    const optionStart = rendererSource.indexOf('function agentCatalogOptionId')
    const optionEnd = rendererSource.indexOf('const activeAgentCatalogItem', optionStart)
    const optionBody = rendererSource.slice(optionStart, optionEnd)
    const agentItemStart = rendererSource.indexOf('{visibleAgents.length ? visibleAgents.map')
    const agentItemEnd = rendererSource.indexOf('<strong>{agent.agentType}</strong>', agentItemStart)
    const agentItemBody = rendererSource.slice(agentItemStart, agentItemEnd)

    expect(optionBody).toContain('const agentType = agent.agentType.trim()')
    expect(optionBody).toContain('optionIdSegment(agentType)')
    expect(agentItemBody).toContain('const agentType = agent.agentType.trim()')
    expect(agentItemBody).toContain('key={`${agent.source}-${agentType}`}')
  })

  it('selects agent catalog rows directly from pointer and keyboard input', () => {
    const itemStart = rendererSource.indexOf('key={`${agent.source}-${agentType}`}', rendererSource.indexOf('id="agent-catalog-listbox"'))
    const itemEnd = rendererSource.indexOf('<strong>{agent.agentType}</strong>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)
    const actionsStart = rendererSource.indexOf('<div className="section-actions"', itemEnd)
    const actionsEnd = rendererSource.indexOf('</div>', actionsStart)
    const actionsBody = rendererSource.slice(actionsStart, actionsEnd)

    expect(itemBody).toContain('tabIndex={loadingLabel ? -1 : 0}')
    expect(rendererSource).toContain('function handleAgentCatalogRowClick(agent: AgentInfo): void')
    expect(itemBody).toContain('onClick={() => handleAgentCatalogRowClick(agent)}')
    expect(itemBody).toContain('onKeyDown={event => handleAgentCatalogRowKeyDown(event, agent)}')
    expect(rendererSource).toContain('function handleAgentCatalogRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, agent: AgentInfo): void')
    expect(itemBody).not.toContain('onClick={() => !loadingLabel && void selectAgent(agent)}')
    expect(itemBody).not.toContain('onKeyDown={event => !loadingLabel && handleOptionSelectKeyDown(event, () => void selectAgent(agent))}')
    expect(actionsBody).toContain('onClick={event => event.stopPropagation()}')
    expect(actionsBody).toContain('onKeyDown={event => event.stopPropagation()}')
  })

  it('disables agent catalog row selection while loading', () => {
    const itemStart = rendererSource.indexOf('key={`${agent.source}-${agentType}`}', rendererSource.indexOf('id="agent-catalog-listbox"'))
    const itemEnd = rendererSource.indexOf('<strong>{agent.agentType}</strong>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)

    expect(itemBody).toContain('aria-disabled={!!loadingLabel}')
    expect(itemBody).toContain('tabIndex={loadingLabel ? -1 : 0}')
    expect(rendererSource).toContain('function handleAgentCatalogRowClick(agent: AgentInfo): void')
    expect(itemBody).toContain('onClick={() => handleAgentCatalogRowClick(agent)}')
    expect(itemBody).toContain('onKeyDown={event => handleAgentCatalogRowKeyDown(event, agent)}')
  })

  it('blocks agent catalog action buttons while loading', () => {
    const actionsStart = rendererSource.indexOf('<div className="section-actions"', rendererSource.indexOf('id="agent-catalog-listbox"'))
    const actionsEnd = rendererSource.indexOf('</div>', actionsStart)
    const actionsBody = rendererSource.slice(actionsStart, actionsEnd)

    expect(rendererSource).toContain('function handleAgentCatalogSelectClick(agent: AgentInfo): void')
    expect(rendererSource).toContain('function handleAgentCatalogDiagnoseClick(agent: AgentInfo): void')
    expect(actionsBody).toContain('<button className="tool-button" onClick={() => handleAgentCatalogSelectClick(agent)} disabled={!!loadingLabel}>')
    expect(actionsBody).toContain('<button className="tool-button" onClick={() => handleAgentCatalogDiagnoseClick(agent)} disabled={!activeSession || !!loadingLabel}>')
  })

  it('routes stale agent catalog Diagnose through handlers', () => {
    const actionsStart = rendererSource.indexOf('<div className="section-actions"', rendererSource.indexOf('id="agent-catalog-listbox"'))
    const actionsEnd = rendererSource.indexOf('</div>', actionsStart)
    const actionsBody = rendererSource.slice(actionsStart, actionsEnd)

    expect(rendererSource).toContain('function handleAgentCatalogDiagnoseClick(agent: AgentInfo): void')
    expect(actionsBody).toContain('<button className="tool-button" onClick={() => handleAgentCatalogDiagnoseClick(agent)} disabled={!activeSession || !!loadingLabel}>')
    expect(actionsBody).not.toContain('onClick={() => !loadingLabel && void selectAgent(agent).then(() => diagnoseAgentByType(agent.agentType))}')
    expect(actionsBody).not.toContain('activeSession && !loadingLabel && void selectAgent(agent).then(() => diagnoseAgentByType(agent.agentType))')
    expect(actionsBody).not.toContain('if (!loadingLabel) void selectAgent(agent).then(() => diagnoseAgentByType(agent.agentType))')
  })

  it('supports keyboard navigation through filtered agent catalog results', () => {
    const helperStart = rendererSource.indexOf('function handleAgentCatalogKeyDown')
    const helperEnd = rendererSource.indexOf('function teamCardState', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const inputStart = rendererSource.indexOf('value={agentCatalogQuery}')
    const inputEnd = rendererSource.indexOf('/>', inputStart)
    const inputBody = rendererSource.slice(inputStart, inputEnd)

    expect(helperBody).toContain('function handleAgentCatalogKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void')
    expect(helperBody).toContain("if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visibleAgents.length)")
    expect(helperBody).toContain('const currentIndex = visibleAgents.findIndex(agent => isAgentCatalogItemActive(agent))')
    expect(helperBody).toContain("const direction = event.key === 'ArrowDown' ? 1 : -1")
    expect(helperBody).toContain('void selectAgent(visibleAgents[nextIndex]!)')
    expect(helperBody).toContain("if ((event.key === 'Home' || event.key === 'End') && visibleAgents.length)")
    expect(helperBody).toContain("const nextIndex = event.key === 'Home' ? 0 : visibleAgents.length - 1")
    expect(helperBody).toContain('void selectAgent(visibleAgents[nextIndex]!)')
    expect(helperBody).toContain("if (event.key === 'Enter' && (activeAgentCatalogItem || visibleAgents[0]))")
    expect(helperBody).toContain('void selectAgent(activeAgentCatalogItem ?? visibleAgents[0]!)')
    expect(helperBody).toContain("if (event.key === 'Escape' && agentCatalogQuery)")
    expect(helperBody).toContain("setAgentCatalogQuery('')")
    expect(inputBody).toContain('onKeyDown={handleAgentCatalogKeyDown}')
  })

  it('does not select agent catalog search results while loading', () => {
    const helperStart = rendererSource.indexOf('function handleAgentCatalogKeyDown')
    const helperEnd = rendererSource.indexOf('function teamCardState', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)

    expect(helperBody).toContain('if (loadingLabel) return')
    expect(helperBody.indexOf('if (loadingLabel) return')).toBeGreaterThan(
      helperBody.indexOf('function handleAgentCatalogKeyDown'),
    )
    expect(helperBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      helperBody.indexOf("if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && visibleAgents.length)"),
    )
  })

  it('exposes accessible current state for selected team cards', () => {
    expect(rendererSource).toContain('function teamCardState(team: TeamInfo):')
    expect(rendererSource).toContain('const active = isTeamItemActive(team)')
    expect(rendererSource).toContain('return teamDraft.teamName === team.name.trim()')
    expect(rendererSource).toContain("'aria-current': active ? 'true' : undefined")
    expect(rendererSource).toContain('{...teamCardState(team)}')
  })

  it('normalizes selected team identity before comparing team card state', () => {
    const activeStart = rendererSource.indexOf('function isTeamItemActive')
    const activeEnd = rendererSource.indexOf('function teamOptionId', activeStart)
    const activeBody = rendererSource.slice(activeStart, activeEnd)

    expect(activeBody).toContain('teamDraft.teamName === team.name.trim()')
    expect(activeBody).not.toContain('return teamDraft.teamName === team.name\n')
  })

  it('exposes teams list as selectable options', () => {
    const listStart = rendererSource.indexOf('id="team-listbox"')
    const listEnd = rendererSource.indexOf('{teams.length ? teams.map', listStart)
    const listBody = rendererSource.slice(listStart, listEnd)
    const itemStart = rendererSource.indexOf('key={teamName}', listEnd)
    const itemEnd = rendererSource.indexOf('<strong>{team.name}</strong>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)
    const emptyStart = rendererSource.indexOf('workarea-empty settings-empty-state', itemEnd)
    const emptyEnd = rendererSource.indexOf('</div>', emptyStart)
    const emptyBody = rendererSource.slice(emptyStart, emptyEnd)

    expect(listBody).toContain('id="team-listbox"')
    expect(listBody).toContain('role="listbox"')
    expect(listBody).toContain('aria-label="Teams"')
    expect(listBody).toContain('aria-activedescendant={activeTeamOptionId()}')
    expect(itemBody).toContain('id={teamOptionId(team)}')
    expect(itemBody).toContain('role="option"')
    expect(itemBody).toContain('aria-selected={')
    expect(emptyBody).toContain('workarea-empty settings-empty-state')
    expect(emptyBody).toContain('<Icon name="users" />')
    expect(emptyBody).toContain('<strong>No teams found</strong>')
  })

  it('shows structured empty state for team cards without reported teammates', () => {
    const itemStart = rendererSource.indexOf('key={teamName}', rendererSource.indexOf('id="team-listbox"'))
    const itemEnd = rendererSource.indexOf('<div className="section-actions"', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)
    const emptyStart = itemBody.indexOf('team-member-empty')
    const emptyEnd = itemBody.indexOf('</div>', emptyStart)
    const emptyBody = itemBody.slice(emptyStart, emptyEnd)
    const styleStart = stylesSource.indexOf('.team-member-empty')
    const styleEnd = stylesSource.indexOf('.settings-grid small', styleStart)
    const styleBody = stylesSource.slice(styleStart, styleEnd)

    expect(emptyBody).toContain('team-member-empty')
    expect(emptyBody).toContain('workarea-empty')
    expect(emptyBody).toContain('<Icon name="users" />')
    expect(emptyBody).toContain('<strong>No teammates reported</strong>')
    expect(emptyBody).toContain('<span>Spawn a teammate or refresh Teams after agents join this team.</span>')
    expect(itemBody).not.toContain('team-empty-member')
    expect(itemBody).not.toContain('No teammates reported yet.')
    expect(styleBody).toContain('.team-member-empty')
    expect(styleBody).toContain('min-height: 88px')
  })

  it('normalizes team option ids and render keys with the canonical team name', () => {
    const optionStart = rendererSource.indexOf('function teamOptionId')
    const optionEnd = rendererSource.indexOf('function handleOptionSelectKeyDown', optionStart)
    const optionBody = rendererSource.slice(optionStart, optionEnd)
    const teamItemStart = rendererSource.indexOf('{teams.length ? teams.map')
    const teamItemEnd = rendererSource.indexOf('<strong>{team.name}</strong>', teamItemStart)
    const teamItemBody = rendererSource.slice(teamItemStart, teamItemEnd)

    expect(optionBody).toContain('const teamName = team.name.trim()')
    expect(optionBody).toContain('optionIdSegment(teamName)')
    expect(teamItemBody).toContain('const teamName = team.name.trim()')
    expect(teamItemBody).toContain('key={teamName}')
  })

  it('supports roving keyboard navigation between selectable listbox rows', () => {
    const helperStart = rendererSource.indexOf('function handleOptionSelectKeyDown')
    const helperEnd = rendererSource.indexOf('function isProjectScheduledTaskItemActive', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)

    expect(helperBody).toContain("if (event.key === 'Enter' || event.key === ' ')")
    expect(helperBody).toContain("if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return")
    expect(helperBody).toContain("const listbox = event.currentTarget.closest('[role=\"listbox\"]')")
    expect(helperBody).toContain("Array.from(listbox.querySelectorAll<HTMLElement>('[role=\"option\"]'))")
    expect(helperBody).toContain("option.getAttribute('aria-disabled') !== 'true'")
    expect(helperBody).toContain("const nextIndex = event.key === 'Home'")
    expect(helperBody).toContain('nextOption.focus()')
    expect(helperBody).toContain('nextOption.click()')
  })

  it('selects team rows directly from pointer and keyboard input', () => {
    const itemStart = rendererSource.indexOf('key={teamName}', rendererSource.indexOf('id="team-listbox"'))
    const itemEnd = rendererSource.indexOf('<strong>{team.name}</strong>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)
    const memberListStart = rendererSource.indexOf('<div className="team-member-list"', itemEnd)
    const memberListEnd = rendererSource.indexOf('{team.members.length ? team.members.map', memberListStart)
    const memberListBody = rendererSource.slice(memberListStart, memberListEnd)
    const actionsStart = rendererSource.indexOf('<div className="section-actions"', itemEnd)
    const actionsEnd = rendererSource.indexOf('<button className="tool-button" onClick={() => handleTeamRowSelectClick(team)} disabled={!activeSession || !!loadingLabel}>', actionsStart)
    const actionsBody = rendererSource.slice(actionsStart, actionsEnd)

    expect(itemBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(itemBody).toContain('onClick={() => handleTeamRowSelectClick(team)}')
    expect(itemBody).toContain('onKeyDown={event => handleTeamRowKeyDown(event, team)}')
    expect(rendererSource).toContain('function handleTeamRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, team: TeamInfo): void')
    expect(itemBody).not.toContain('onKeyDown={event => !loadingLabel && handleOptionSelectKeyDown(event, () => selectTeam(team))}')
    expect(memberListBody).toContain('onClick={event => event.stopPropagation()}')
    expect(memberListBody).toContain('onKeyDown={event => event.stopPropagation()}')
    expect(actionsBody).toContain('onClick={event => event.stopPropagation()}')
    expect(actionsBody).toContain('onKeyDown={event => event.stopPropagation()}')
  })

  it('disables team row selection and message shortcuts while loading', () => {
    const itemStart = rendererSource.indexOf('key={teamName}', rendererSource.indexOf('id="team-listbox"'))
    const itemEnd = rendererSource.indexOf('<strong>{team.name}</strong>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)
    const memberButtonStart = rendererSource.indexOf('className="team-member-select"', itemEnd)
    const memberButtonEnd = rendererSource.indexOf('>', memberButtonStart)
    const memberButtonBody = rendererSource.slice(memberButtonStart, memberButtonEnd)
    const actionsStart = rendererSource.indexOf('<div className="section-actions"', itemEnd)
    const actionsEnd = rendererSource.indexOf('</div>', actionsStart)
    const actionsBody = rendererSource.slice(actionsStart, actionsEnd)

    expect(itemBody).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(itemBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(itemBody).toContain('onClick={() => handleTeamRowSelectClick(team)}')
    expect(itemBody).toContain('onKeyDown={event => handleTeamRowKeyDown(event, team)}')
    expect(memberButtonBody).toContain('disabled={!activeSession || !!loadingLabel}')
    expect(actionsBody).toContain('onClick={() => handleTeamRowSelectClick(team)} disabled={!activeSession || !!loadingLabel}')
    expect(actionsBody).toContain('onClick={() => handleTeamRowMessageAllClick(team)} disabled={!activeSession || !!loadingLabel}')
  })

  it('routes stale team row action buttons through handlers', () => {
    const itemStart = rendererSource.indexOf('key={teamName}', rendererSource.indexOf('id="team-listbox"'))
    const itemEnd = rendererSource.indexOf('</article>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)
    const actionsStart = rendererSource.indexOf('<div className="section-actions"', itemStart)
    const actionsBody = rendererSource.slice(actionsStart, itemEnd)

    expect(rendererSource).toContain('function handleTeamMemberMessageClick(team: TeamInfo, member: TeamMemberInfo): void')
    expect(rendererSource).toContain('function handleTeamMemberRemoveClick(team: TeamInfo, member: TeamMemberInfo): void')
    expect(rendererSource).toContain('function handleTeamRowSelectClick(team: TeamInfo): void')
    expect(rendererSource).toContain('function handleTeamRowMessageAllClick(team: TeamInfo): void')
    expect(rendererSource).toContain('function handleTeamRowDeleteClick(team: TeamInfo): void')
    expect(itemBody).toContain('onClick={() => handleTeamMemberMessageClick(team, member)}')
    expect(itemBody).toContain('onClick={() => handleTeamMemberRemoveClick(team, member)}')
    expect(actionsBody).toContain('onClick={() => handleTeamRowSelectClick(team)} disabled={!activeSession || !!loadingLabel}')
    expect(actionsBody).toContain('onClick={() => handleTeamRowMessageAllClick(team)} disabled={!activeSession || !!loadingLabel}')
    expect(actionsBody).toContain('onClick={() => handleTeamRowDeleteClick(team)} disabled={!activeSession || !!loadingLabel}')
    expect(itemBody).not.toContain('onClick={() => !loadingLabel && prepareTeamMemberMessage(team, member)}')
    expect(itemBody).not.toContain('onClick={() => !loadingLabel && void removeTeamMember(team, member)}')
    expect(actionsBody).not.toContain('onClick={() => !loadingLabel && selectTeam(team)}')
    expect(actionsBody).not.toContain('onClick={() => !loadingLabel && prepareTeamBroadcastMessage(team)}')
    expect(actionsBody).not.toContain('onClick={() => !loadingLabel && void deleteTeam(team)}')
    expect(itemBody).not.toContain('activeSession && !loadingLabel && prepareTeamMemberMessage(team, member)')
    expect(itemBody).not.toContain('activeSession && !loadingLabel && void removeTeamMember(team, member)')
    expect(itemBody).not.toContain('if (!loadingLabel) prepareTeamMemberMessage(team, member)')
    expect(itemBody).not.toContain('if (!loadingLabel) void removeTeamMember(team, member)')
    expect(actionsBody).not.toContain('activeSession && !loadingLabel && selectTeam(team)')
    expect(actionsBody).not.toContain('activeSession && !loadingLabel && prepareTeamBroadcastMessage(team)')
    expect(actionsBody).not.toContain('activeSession && !loadingLabel && void deleteTeam(team)')
    expect(actionsBody).not.toContain('if (!loadingLabel) selectTeam(team)')
    expect(actionsBody).not.toContain('if (!loadingLabel) prepareTeamBroadcastMessage(team)')
    expect(actionsBody).not.toContain('if (!loadingLabel) void deleteTeam(team)')
  })

  it('routes stale team row selection through the selection handler', () => {
    const itemStart = rendererSource.indexOf('key={teamName}', rendererSource.indexOf('id="team-listbox"'))
    const itemEnd = rendererSource.indexOf('<strong>{team.name}</strong>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)

    expect(itemBody).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(itemBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(rendererSource).toContain('function handleTeamRowSelectClick(team: TeamInfo): void')
    expect(itemBody).toContain('onClick={() => handleTeamRowSelectClick(team)}')
    expect(itemBody).not.toContain('onClick={() => !loadingLabel && selectTeam(team)}')
    expect(itemBody).toContain('onKeyDown={event => handleTeamRowKeyDown(event, team)}')
    expect(itemBody).not.toContain('activeSession && !loadingLabel && selectTeam(team)')
    expect(itemBody).not.toContain('activeSession && !loadingLabel && handleOptionSelectKeyDown(event, () => selectTeam(team))')
  })

  it('blocks team selection and message entrypoints while loading', () => {
    const selectStart = rendererSource.indexOf('function selectTeam(team: TeamInfo): void')
    const selectEnd = rendererSource.indexOf('function selectTeamMember', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const inlineMemberStart = rendererSource.indexOf('function selectTeamMember(team: TeamInfo, member: TeamMemberInfo): void')
    const inlineMemberEnd = rendererSource.indexOf('function prepareTeamMemberMessage', inlineMemberStart)
    const inlineMemberBody = rendererSource.slice(inlineMemberStart, inlineMemberEnd)
    const memberStart = rendererSource.indexOf('function prepareTeamMemberMessage(team: TeamInfo, member: TeamMemberInfo): void')
    const memberEnd = rendererSource.indexOf('function prepareTeamBroadcastMessage', memberStart)
    const memberBody = rendererSource.slice(memberStart, memberEnd)
    const broadcastStart = rendererSource.indexOf('function prepareTeamBroadcastMessage(team: TeamInfo): void')
    const broadcastEnd = rendererSource.indexOf('async function deleteTeam', broadcastStart)
    const broadcastBody = rendererSource.slice(broadcastStart, broadcastEnd)
    const itemStart = rendererSource.indexOf('key={teamName}', rendererSource.indexOf('id="team-listbox"'))
    const itemEnd = rendererSource.indexOf('<strong>{team.name}</strong>', itemStart)
    const memberHandlerStart = rendererSource.indexOf('handleTeamMemberMessageClick(team, member)', itemEnd)
    const memberButtonStart = rendererSource.lastIndexOf('<button', memberHandlerStart)
    const memberButtonEnd = rendererSource.indexOf('</button>', memberButtonStart)
    const memberButtonBody = rendererSource.slice(memberButtonStart, memberButtonEnd)
    const inlineMemberSelectStart = rendererSource.indexOf('className="team-member-select"', itemEnd)
    const inlineMemberSelectEnd = rendererSource.indexOf('</button>', inlineMemberSelectStart)
    const inlineMemberSelectBody = rendererSource.slice(inlineMemberSelectStart, inlineMemberSelectEnd)
    const actionsStart = rendererSource.indexOf('<div className="section-actions"', itemEnd)
    const actionsEnd = rendererSource.indexOf('</div>', actionsStart)
    const actionsBody = rendererSource.slice(actionsStart, actionsEnd)

    for (const body of [selectBody, inlineMemberBody, memberBody, broadcastBody]) {
      expect(body).toContain('if (loadingLabel) return')
      expect(body.indexOf('if (loadingLabel) return')).toBeLessThan(
        body.indexOf('if (!activeSession) {'),
      )
      expect(body.indexOf('if (loadingLabel) return')).toBeLessThan(
        body.indexOf('setTeamDraft(prev => ({'),
      )
    }
    expect(inlineMemberSelectBody).toContain('onClick={() => handleTeamMemberSelectClick(team, member)}')
    expect(rendererSource).toContain('function handleTeamMemberSelectClick(team: TeamInfo, member: TeamMemberInfo): void')
    expect(inlineMemberSelectBody).not.toContain('if (!activeSession) {')
    expect(inlineMemberSelectBody).not.toContain('setTeamDraft(prev => ({')
    expect(memberButtonBody).toContain('onClick={() => handleTeamMemberMessageClick(team, member)}')
    expect(actionsBody).toContain('onClick={() => handleTeamRowSelectClick(team)} disabled={!activeSession || !!loadingLabel}')
    expect(actionsBody).toContain('onClick={() => handleTeamRowMessageAllClick(team)} disabled={!activeSession || !!loadingLabel}')
  })

  it('shows a Teams error when selection and message entrypoints lose the active session', () => {
    const selectStart = rendererSource.indexOf('function selectTeam(team: TeamInfo): void')
    const selectEnd = rendererSource.indexOf('function selectTeamMember', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const inlineMemberStart = rendererSource.indexOf('function selectTeamMember(team: TeamInfo, member: TeamMemberInfo): void')
    const inlineMemberEnd = rendererSource.indexOf('function prepareTeamMemberMessage', inlineMemberStart)
    const inlineMemberBody = rendererSource.slice(inlineMemberStart, inlineMemberEnd)
    const memberStart = rendererSource.indexOf('function prepareTeamMemberMessage(team: TeamInfo, member: TeamMemberInfo): void')
    const memberEnd = rendererSource.indexOf('function prepareTeamBroadcastMessage', memberStart)
    const memberBody = rendererSource.slice(memberStart, memberEnd)
    const broadcastStart = rendererSource.indexOf('function prepareTeamBroadcastMessage(team: TeamInfo): void')
    const broadcastEnd = rendererSource.indexOf('async function deleteTeam', broadcastStart)
    const broadcastBody = rendererSource.slice(broadcastStart, broadcastEnd)
    const itemStart = rendererSource.indexOf('key={teamName}', rendererSource.indexOf('id="team-listbox"'))
    const itemEnd = rendererSource.indexOf('<strong>{team.name}</strong>', itemStart)
    const memberHandlerStart = rendererSource.indexOf('handleTeamMemberMessageClick(team, member)', itemEnd)
    const memberButtonStart = rendererSource.lastIndexOf('<button', memberHandlerStart)
    const memberButtonEnd = rendererSource.indexOf('</button>', memberButtonStart)
    const memberButtonBody = rendererSource.slice(memberButtonStart, memberButtonEnd)
    const actionsStart = rendererSource.indexOf('<div className="section-actions"', itemEnd)
    const actionsEnd = rendererSource.indexOf('</div>', actionsStart)
    const actionsBody = rendererSource.slice(actionsStart, actionsEnd)

    for (const body of [selectBody, inlineMemberBody, memberBody, broadcastBody]) {
      expect(body).toContain('if (loadingLabel) return')
      expect(body).toContain('if (!activeSession) {')
      expect(body).toContain("text: 'Select a session before managing teams.'")
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('setTeamDraft(prev => ({'),
      )
    }
    for (const body of [selectBody, memberBody, broadcastBody]) {
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('setChatTarget({'),
      )
    }
    expect(memberButtonBody).toContain('onClick={() => handleTeamMemberMessageClick(team, member)}')
    expect(actionsBody).toContain('onClick={() => handleTeamRowSelectClick(team)} disabled={!activeSession || !!loadingLabel}')
    expect(actionsBody).toContain('onClick={() => handleTeamRowMessageAllClick(team)} disabled={!activeSession || !!loadingLabel}')
  })

  it('shows a Teams error before selection shortcuts run with missing team or teammate names', () => {
    const selectStart = rendererSource.indexOf('function selectTeam(team: TeamInfo): void')
    const selectEnd = rendererSource.indexOf('function selectTeamMember', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const inlineMemberStart = rendererSource.indexOf('function selectTeamMember(team: TeamInfo, member: TeamMemberInfo): void')
    const inlineMemberEnd = rendererSource.indexOf('function prepareTeamMemberMessage', inlineMemberStart)
    const inlineMemberBody = rendererSource.slice(inlineMemberStart, inlineMemberEnd)
    const memberStart = rendererSource.indexOf('function prepareTeamMemberMessage(team: TeamInfo, member: TeamMemberInfo): void')
    const memberEnd = rendererSource.indexOf('function prepareTeamBroadcastMessage', memberStart)
    const memberBody = rendererSource.slice(memberStart, memberEnd)
    const broadcastStart = rendererSource.indexOf('function prepareTeamBroadcastMessage(team: TeamInfo): void')
    const broadcastEnd = rendererSource.indexOf('async function deleteTeam', broadcastStart)
    const broadcastBody = rendererSource.slice(broadcastStart, broadcastEnd)
    const normalizedTeamName = 'const teamName = team.name.trim()'
    const normalizedMemberName = 'const memberName = member.name.trim()'
    const selectTeamGuard = 'if (!teamName) {'
    const teamGuard = 'if (!teamName) {'
    const memberGuard = 'if (!teamName || !memberName) {'

    expect(selectBody).toContain(normalizedTeamName)
    expect(selectBody).toContain(selectTeamGuard)
    expect(selectBody).toContain("text: 'Select a team before editing.'")
    expect(selectBody.indexOf(normalizedTeamName)).toBeLessThan(
      selectBody.indexOf(selectTeamGuard),
    )
    expect(selectBody.indexOf(selectTeamGuard)).toBeLessThan(
      selectBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(selectBody.indexOf(selectTeamGuard)).toBeLessThan(
      selectBody.indexOf('setChatTarget({'),
    )

    expect(inlineMemberBody).toContain(normalizedTeamName)
    expect(inlineMemberBody).toContain(normalizedMemberName)
    expect(inlineMemberBody).toContain(memberGuard)
    expect(inlineMemberBody).toContain("text: 'Choose a team and teammate before selecting a recipient.'")
    expect(inlineMemberBody.indexOf(normalizedTeamName)).toBeLessThan(
      inlineMemberBody.indexOf(memberGuard),
    )
    expect(inlineMemberBody.indexOf(normalizedMemberName)).toBeLessThan(
      inlineMemberBody.indexOf(memberGuard),
    )
    expect(inlineMemberBody.indexOf(memberGuard)).toBeLessThan(
      inlineMemberBody.indexOf('setTeamDraft(prev => ({'),
    )

    expect(memberBody).toContain(normalizedTeamName)
    expect(memberBody).toContain(normalizedMemberName)
    expect(memberBody).toContain(memberGuard)
    expect(memberBody).toContain("text: 'Choose a team and teammate before preparing a message.'")
    expect(memberBody.indexOf(normalizedTeamName)).toBeLessThan(
      memberBody.indexOf(memberGuard),
    )
    expect(memberBody.indexOf(normalizedMemberName)).toBeLessThan(
      memberBody.indexOf(memberGuard),
    )
    expect(memberBody.indexOf(memberGuard)).toBeLessThan(
      memberBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(memberBody.indexOf(memberGuard)).toBeLessThan(
      memberBody.indexOf('setChatTarget({'),
    )

    expect(broadcastBody).toContain(normalizedTeamName)
    expect(broadcastBody).toContain(teamGuard)
    expect(broadcastBody).toContain("text: 'Select a team before preparing a broadcast.'")
    expect(broadcastBody.indexOf(normalizedTeamName)).toBeLessThan(
      broadcastBody.indexOf(teamGuard),
    )
    expect(broadcastBody.indexOf(teamGuard)).toBeLessThan(
      broadcastBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(broadcastBody.indexOf(teamGuard)).toBeLessThan(
      broadcastBody.indexOf('setChatTarget({'),
    )
  })

  it('normalizes team message targets before writing drafts and chat target', () => {
    const inlineMemberStart = rendererSource.indexOf('function selectTeamMember(team: TeamInfo, member: TeamMemberInfo): void')
    const inlineMemberEnd = rendererSource.indexOf('function prepareTeamMemberMessage', inlineMemberStart)
    const inlineMemberBody = rendererSource.slice(inlineMemberStart, inlineMemberEnd)
    const memberStart = rendererSource.indexOf('function prepareTeamMemberMessage(team: TeamInfo, member: TeamMemberInfo): void')
    const memberEnd = rendererSource.indexOf('function prepareTeamBroadcastMessage', memberStart)
    const memberBody = rendererSource.slice(memberStart, memberEnd)
    const broadcastStart = rendererSource.indexOf('function prepareTeamBroadcastMessage(team: TeamInfo): void')
    const broadcastEnd = rendererSource.indexOf('async function deleteTeam', broadcastStart)
    const broadcastBody = rendererSource.slice(broadcastStart, broadcastEnd)

    expect(inlineMemberBody).toContain('const teamName = team.name.trim()')
    expect(inlineMemberBody).toContain('const memberName = member.name.trim()')
    expect(inlineMemberBody).toContain('teamName,')
    expect(inlineMemberBody).toContain('to: memberName')
    expect(inlineMemberBody).toContain('text: `Selected ${memberName} in team ${teamName}.`')
    expect(inlineMemberBody.indexOf('const teamName = team.name.trim()')).toBeLessThan(
      inlineMemberBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(inlineMemberBody.indexOf('const memberName = member.name.trim()')).toBeLessThan(
      inlineMemberBody.indexOf('to: memberName'),
    )

    expect(memberBody).toContain('const teamName = team.name.trim()')
    expect(memberBody).toContain('const memberName = member.name.trim()')
    expect(memberBody).toContain('teamName,')
    expect(memberBody).toContain('to: memberName')
    expect(memberBody).toContain('teamName,')
    expect(memberBody).toContain('text: `Ready to message ${memberName} in team ${teamName}.`')
    expect(memberBody.indexOf('const teamName = team.name.trim()')).toBeLessThan(
      memberBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(memberBody.indexOf('const memberName = member.name.trim()')).toBeLessThan(
      memberBody.indexOf('to: memberName'),
    )

    expect(broadcastBody).toContain('const teamName = team.name.trim()')
    expect(broadcastBody).toContain('teamName,')
    expect(broadcastBody).toContain('text: `Ready to message all teammates in team ${teamName}.`')
    expect(broadcastBody.indexOf('const teamName = team.name.trim()')).toBeLessThan(
      broadcastBody.indexOf('setChatTarget({'),
    )
  })

  it('blocks team runtime and destructive entrypoints while loading', () => {
    const createStart = rendererSource.indexOf('async function createTeam')
    const createEnd = rendererSource.indexOf('async function sendTeamMessage', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)
    const sendStart = rendererSource.indexOf('async function sendTeamMessage')
    const sendEnd = rendererSource.indexOf('async function spawnTeamTeammate', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)
    const spawnStart = rendererSource.indexOf('async function spawnTeamTeammate')
    const spawnEnd = rendererSource.indexOf('async function requestTeamShutdown', spawnStart)
    const spawnBody = rendererSource.slice(spawnStart, spawnEnd)
    const shutdownStart = rendererSource.indexOf('async function requestTeamShutdown')
    const shutdownEnd = rendererSource.indexOf('async function removeTeamMember', shutdownStart)
    const shutdownBody = rendererSource.slice(shutdownStart, shutdownEnd)
    const removeStart = rendererSource.indexOf('async function removeTeamMember')
    const removeEnd = rendererSource.indexOf('function selectTeam', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('async function saveScheduledTask', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const formActionsStart = rendererSource.indexOf('<div className="section-actions">', rendererSource.indexOf('<section className="settings-section" id="agents-teams">'))
    const formActionsEnd = rendererSource.indexOf('</div>', formActionsStart)
    const formActionsBody = rendererSource.slice(formActionsStart, formActionsEnd)
    const memberSelectStart = rendererSource.indexOf('className="team-member-select"')
    const memberSelectEnd = rendererSource.indexOf('</button>', memberSelectStart)
    const memberSelectBody = rendererSource.slice(memberSelectStart, memberSelectEnd)
    const memberShutdownStart = rendererSource.indexOf('handleTeamMemberShutdownClick(team, member)', memberSelectEnd)
    const memberShutdownButtonStart = rendererSource.lastIndexOf('<button', memberShutdownStart)
    const memberShutdownButtonEnd = rendererSource.indexOf('</button>', memberShutdownButtonStart)
    const memberShutdownBody = rendererSource.slice(memberShutdownButtonStart, memberShutdownButtonEnd)
    const memberRemoveStart = rendererSource.indexOf('handleTeamMemberRemoveClick(team, member)', memberShutdownButtonEnd)
    const memberRemoveButtonStart = rendererSource.lastIndexOf('<button', memberRemoveStart)
    const memberRemoveButtonEnd = rendererSource.indexOf('</button>', memberRemoveButtonStart)
    const memberRemoveBody = rendererSource.slice(memberRemoveButtonStart, memberRemoveButtonEnd)

    for (const body of [createBody, sendBody, spawnBody, shutdownBody, removeBody, deleteBody]) {
      expect(body).toContain('if (loadingLabel) return')
    }
    expect(formActionsBody).toContain('onClick={handleTeamFormCreateClick}')
    expect(formActionsBody).toContain('onClick={handleTeamFormSpawnTeammateClick}')
    expect(formActionsBody).toContain('onClick={handleTeamFormSendClick}')
    expect(formActionsBody).toContain('onClick={handleTeamFormShutdownClick}')
    expect(formActionsBody).toContain('onClick={handleTeamFormDeleteClick}')
    expect(memberSelectBody).toContain('onClick={() => handleTeamMemberSelectClick(team, member)}')
    expect(memberSelectBody).not.toContain('if (!activeSession) {')
    expect(memberSelectBody).not.toContain('if (loadingLabel) return')
    expect(memberShutdownBody).toContain('onClick={() => handleTeamMemberShutdownClick(team, member)}')
    expect(memberRemoveBody).toContain('onClick={() => handleTeamMemberRemoveClick(team, member)}')
  })

  it('routes stale team form create and delete through handlers', () => {
    const formActionsStart = rendererSource.indexOf('<div className="section-actions">', rendererSource.indexOf('<section className="settings-section" id="agents-teams">'))
    const formActionsEnd = rendererSource.indexOf('</div>', formActionsStart)
    const formActionsBody = rendererSource.slice(formActionsStart, formActionsEnd)

    expect(rendererSource).toContain('function handleTeamFormCreateClick(): void')
    expect(rendererSource).toContain('function handleTeamFormDeleteClick(): void')
    expect(formActionsBody).toContain('onClick={handleTeamFormCreateClick}')
    expect(formActionsBody).toContain('onClick={handleTeamFormDeleteClick}')
    expect(formActionsBody).not.toContain('onClick={() => !loadingLabel && void createTeam()}')
    expect(formActionsBody).not.toContain('onClick={() => !loadingLabel && void deleteTeam()}')
    expect(formActionsBody).not.toContain('activeSession && teamDraft.teamName.trim() && !loadingLabel && void createTeam()')
    expect(formActionsBody).not.toContain('activeSession && teamDraft.teamName.trim() && !loadingLabel && void deleteTeam()')
  })

  it('routes stale team form Spawn teammate clicks through the handler', () => {
    const spawnStart = rendererSource.indexOf('async function spawnTeamTeammate')
    const spawnEnd = rendererSource.indexOf('async function requestTeamShutdown', spawnStart)
    const spawnBody = rendererSource.slice(spawnStart, spawnEnd)
    const formActionsStart = rendererSource.indexOf('<div className="section-actions">', rendererSource.indexOf('<section className="settings-section" id="agents-teams">'))
    const formActionsEnd = rendererSource.indexOf('</div>', formActionsStart)
    const formActionsBody = rendererSource.slice(formActionsStart, formActionsEnd)

    expect(spawnBody).toContain("text: 'Select a session before managing teams.'")
    expect(spawnBody).toContain("text: 'Choose a team, teammate name, and prompt before spawning.'")
    expect(spawnBody).toContain("text: 'Wait for the current Claude turn to finish before spawning a teammate.'")
    expect(rendererSource).toContain('function handleTeamFormSpawnTeammateClick(): void')
    expect(formActionsBody).toContain('onClick={handleTeamFormSpawnTeammateClick}')
    expect(formActionsBody).not.toContain('onClick={() => !loadingLabel && void spawnTeamTeammate()}')
    expect(formActionsBody).not.toContain('teamDraft.teamName.trim() && teamDraft.teammateName.trim() && teamDraft.teammatePrompt.trim() && !loadingLabel && void spawnTeamTeammate()')
  })

  it('routes stale team form Send clicks through the handler', () => {
    const sendStart = rendererSource.indexOf('async function sendTeamMessage')
    const sendEnd = rendererSource.indexOf('async function spawnTeamTeammate', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)
    const formActionsStart = rendererSource.indexOf('<div className="section-actions">', rendererSource.indexOf('<section className="settings-section" id="agents-teams">'))
    const formActionsEnd = rendererSource.indexOf('</div>', formActionsStart)
    const formActionsBody = rendererSource.slice(formActionsStart, formActionsEnd)

    expect(sendBody).toContain("text: 'Select a session before managing teams.'")
    expect(sendBody).toContain("text: 'Choose a team, recipient, and message before sending.'")
    expect(sendBody).toContain("text: 'Wait for the current Claude turn to finish before sending a team message.'")
    expect(rendererSource).toContain('function handleTeamFormSendClick(): void')
    expect(formActionsBody).toContain('onClick={handleTeamFormSendClick}')
    expect(formActionsBody).not.toContain('onClick={() => !loadingLabel && void sendTeamMessage()}')
    expect(formActionsBody).not.toContain('teamDraft.teamName.trim() && teamDraft.to.trim() && teamDraft.message.trim() && !loadingLabel && void sendTeamMessage()')
  })

  it('routes stale team form Shutdown clicks through the handler', () => {
    const shutdownStart = rendererSource.indexOf('async function requestTeamShutdown')
    const shutdownEnd = rendererSource.indexOf('async function removeTeamMember', shutdownStart)
    const shutdownBody = rendererSource.slice(shutdownStart, shutdownEnd)
    const formActionsStart = rendererSource.indexOf('<div className="section-actions">', rendererSource.indexOf('<section className="settings-section" id="agents-teams">'))
    const formActionsEnd = rendererSource.indexOf('</div>', formActionsStart)
    const formActionsBody = rendererSource.slice(formActionsStart, formActionsEnd)

    expect(shutdownBody).toContain("text: 'Select a session before managing teams.'")
    expect(shutdownBody).toContain("text: 'Choose a team and teammate before requesting shutdown.'")
    expect(shutdownBody).toContain("text: 'Wait for the current Claude turn to finish before requesting teammate shutdown.'")
    expect(rendererSource).toContain('function handleTeamFormShutdownClick(): void')
    expect(formActionsBody).toContain('onClick={handleTeamFormShutdownClick}')
    expect(formActionsBody).not.toContain('onClick={() => !loadingLabel && void requestTeamShutdown()}')
    expect(formActionsBody).not.toContain('teamDraft.teamName.trim() && teamDraft.to.trim() && !loadingLabel && void requestTeamShutdown()')
  })

  it('routes stale team member Shutdown clicks through the handler', () => {
    const shutdownStart = rendererSource.indexOf('async function requestTeamShutdown')
    const shutdownEnd = rendererSource.indexOf('async function removeTeamMember', shutdownStart)
    const shutdownBody = rendererSource.slice(shutdownStart, shutdownEnd)
    const memberShutdownHandlerStart = rendererSource.indexOf('async function requestTeamMemberShutdown')
    const memberShutdownHandlerEnd = rendererSource.indexOf('async function removeTeamMember', memberShutdownHandlerStart)
    const memberShutdownHandlerBody = rendererSource.slice(memberShutdownHandlerStart, memberShutdownHandlerEnd)
    const memberSelectStart = rendererSource.indexOf('className="team-member-select"')
    const memberSelectEnd = rendererSource.indexOf('</button>', memberSelectStart)
    const memberShutdownStart = rendererSource.indexOf('handleTeamMemberShutdownClick(team, member)', memberSelectEnd)
    const memberShutdownButtonStart = rendererSource.lastIndexOf('<button', memberShutdownStart)
    const memberShutdownButtonEnd = rendererSource.indexOf('</button>', memberShutdownButtonStart)
    const memberShutdownBody = rendererSource.slice(memberShutdownButtonStart, memberShutdownButtonEnd)

    expect(shutdownBody).toContain("text: 'Select a session before managing teams.'")
    expect(shutdownBody).toContain("text: 'Choose a team and teammate before requesting shutdown.'")
    expect(shutdownBody).toContain("text: 'Wait for the current Claude turn to finish before requesting teammate shutdown.'")
    expect(memberShutdownHandlerBody).toContain("text: 'Select a session before managing teams.'")
    expect(memberShutdownHandlerBody).toContain("text: 'Choose a team and teammate before requesting shutdown.'")
    expect(memberShutdownHandlerBody).toContain('return requestTeamShutdown({')
    expect(rendererSource).toContain('function handleTeamMemberShutdownClick(team: TeamInfo, member: TeamMemberInfo): void')
    expect(memberShutdownBody).toContain('onClick={() => handleTeamMemberShutdownClick(team, member)}')
    expect(memberShutdownBody).toContain('disabled={!canQueueRuntimePrompt || !!loadingLabel}')
    expect(memberShutdownBody).not.toContain('requestTeamShutdown({')
    expect(memberShutdownBody).not.toContain('onClick={() => !loadingLabel && void requestTeamMemberShutdown(team, member)}')
    expect(memberShutdownBody).not.toContain('onClick={() => canQueueRuntimePrompt && !loadingLabel && void requestTeamMemberShutdown(team, member)}')
  })

  it('exposes direct team deletion on team cards without relying on the draft', () => {
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('async function saveScheduledTask', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const itemStart = rendererSource.indexOf('key={teamName}', rendererSource.indexOf('id="team-listbox"'))
    const itemEnd = rendererSource.indexOf('</article>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)

    expect(deleteBody).toContain("async function deleteTeam(team: Pick<TeamInfo, 'name'> = { name: teamDraft.teamName }): Promise<void>")
    expect(deleteBody).toContain('const deletedTeamName = team.name.trim()')
    expect(deleteBody).toContain('const input = { teamName: deletedTeamName }')
    expect(rendererSource).toContain('function handleTeamRowDeleteClick(team: TeamInfo): void')
    expect(itemBody).toContain('<button className="tool-button danger" onClick={() => handleTeamRowDeleteClick(team)} disabled={!activeSession || !!loadingLabel}>')
    expect(itemBody).not.toContain('onClick={() => !loadingLabel && void deleteTeam(team)}')
    expect(itemBody).toContain('<Icon name="trash" />Delete team')
  })

  it('preserves unrelated team drafts after deleting a team card', () => {
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('async function saveScheduledTask', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)

    expect(deleteBody).toContain('setTeamDraft(prev =>')
    expect(deleteBody).toContain('prev.teamName.trim() === deletedTeamName ? emptyTeamDraft() : prev')
    expect(deleteBody).not.toContain('setTeamDraft(emptyTeamDraft())')
    expect(deleteBody.indexOf('setTeamDraft(prev =>')).toBeLessThan(
      deleteBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })'),
    )
  })

  it('preserves selected team layout after deleting an unrelated team card', () => {
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('async function saveScheduledTask', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const selectedLayoutGuard = "if (session.layout.selectedTeamName?.trim() === deletedTeamName) {"

    expect(deleteBody).toContain(selectedLayoutGuard)
    expect(deleteBody.indexOf(selectedLayoutGuard)).toBeLessThan(
      deleteBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })'),
    )
    expect(deleteBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })')).toBeLessThan(
      deleteBody.indexOf("setTeamsStatus({ kind: 'success'"),
    )
  })

  it('moves the composer off a deleted selected team before reporting success', () => {
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('async function saveScheduledTask', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const selectedLayoutGuard = "if (session.layout.selectedTeamName?.trim() === deletedTeamName) {"

    expect(deleteBody).toContain(selectedLayoutGuard)
    expect(deleteBody).toContain('const fallbackAgentType = session.layout.selectedAgentType?.trim()')
    expect(deleteBody).toContain('const fallbackChatTarget: ChatTarget = fallbackAgentType')
    expect(deleteBody).toContain("? { type: 'agent', teamName: '', agentType: fallbackAgentType }")
    expect(deleteBody).toContain(": { type: 'session', teamName: '', agentType: '' }")
    expect(deleteBody).toContain('setChatTarget(prev =>')
    expect(deleteBody).toContain("prev.type === 'team' && prev.teamName.trim() === deletedTeamName")
    expect(deleteBody).toContain('? fallbackChatTarget')
    expect(deleteBody.indexOf('setChatTarget(prev =>')).toBeGreaterThan(
      deleteBody.indexOf(selectedLayoutGuard),
    )
    expect(deleteBody.indexOf('setChatTarget(prev =>')).toBeLessThan(
      deleteBody.indexOf("setTeamsStatus({ kind: 'success'"),
    )
  })

  it('shows a Teams error when team runtime actions lose the active session', () => {
    const createStart = rendererSource.indexOf('async function createTeam')
    const createEnd = rendererSource.indexOf('async function sendTeamMessage', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)
    const sendStart = rendererSource.indexOf('async function sendTeamMessage')
    const sendEnd = rendererSource.indexOf('async function spawnTeamTeammate', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)
    const spawnStart = rendererSource.indexOf('async function spawnTeamTeammate')
    const spawnEnd = rendererSource.indexOf('async function requestTeamShutdown', spawnStart)
    const spawnBody = rendererSource.slice(spawnStart, spawnEnd)
    const shutdownStart = rendererSource.indexOf('async function requestTeamShutdown')
    const shutdownEnd = rendererSource.indexOf('async function removeTeamMember', shutdownStart)
    const shutdownBody = rendererSource.slice(shutdownStart, shutdownEnd)
    const removeStart = rendererSource.indexOf('async function removeTeamMember')
    const removeEnd = rendererSource.indexOf('function selectTeam', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('async function saveScheduledTask', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)

    for (const body of [createBody, sendBody, spawnBody, shutdownBody, removeBody, deleteBody]) {
      expect(body).toContain('if (!activeSession) {')
      expect(body).toContain("text: 'Select a session before managing teams.'")
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('const session = activeSession'),
      )
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('await runTeamAction('),
      )
    }
    for (const body of [removeBody, deleteBody]) {
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('requestConfirmation({'),
      )
    }
  })

  it('shows a Teams error before sending a team message with missing required fields', () => {
    const sendStart = rendererSource.indexOf('async function sendTeamMessage')
    const sendEnd = rendererSource.indexOf('async function spawnTeamTeammate', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)
    const guard = 'if (!teamDraft.teamName.trim() || !teamDraft.to.trim() || !teamDraft.message.trim()) {'

    expect(sendBody).toContain(guard)
    expect(sendBody).toContain("text: 'Choose a team, recipient, and message before sending.'")
    expect(sendBody.indexOf(guard)).toBeLessThan(
      sendBody.indexOf('if (turnBusy)'),
    )
    expect(sendBody.indexOf(guard)).toBeLessThan(
      sendBody.indexOf('await runTeamAction('),
    )
  })

  it('shows a Teams error before creating a team with a missing name', () => {
    const createStart = rendererSource.indexOf('async function createTeam')
    const createEnd = rendererSource.indexOf('async function sendTeamMessage', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)
    const guard = 'if (!teamDraft.teamName.trim()) {'

    expect(createBody).toContain(guard)
    expect(createBody).toContain("text: 'Enter a team name before creating a team.'")
    expect(createBody.indexOf(guard)).toBeLessThan(
      createBody.indexOf('const session = activeSession'),
    )
    expect(createBody.indexOf(guard)).toBeLessThan(
      createBody.indexOf('await runTeamAction('),
    )
  })

  it('shows a Teams error before spawning a teammate with missing required fields', () => {
    const spawnStart = rendererSource.indexOf('async function spawnTeamTeammate')
    const spawnEnd = rendererSource.indexOf('async function requestTeamShutdown', spawnStart)
    const spawnBody = rendererSource.slice(spawnStart, spawnEnd)
    const guard = 'if (!teamDraft.teamName.trim() || !teamDraft.teammateName.trim() || !teamDraft.teammatePrompt.trim()) {'

    expect(spawnBody).toContain(guard)
    expect(spawnBody).toContain("text: 'Choose a team, teammate name, and prompt before spawning.'")
    expect(spawnBody.indexOf(guard)).toBeLessThan(
      spawnBody.indexOf('if (turnBusy)'),
    )
    expect(spawnBody.indexOf(guard)).toBeLessThan(
      spawnBody.indexOf('await runTeamAction('),
    )
  })

  it('shows a Teams error before requesting shutdown with missing required fields', () => {
    const shutdownStart = rendererSource.indexOf('async function requestTeamShutdown')
    const shutdownEnd = rendererSource.indexOf('async function removeTeamMember', shutdownStart)
    const shutdownBody = rendererSource.slice(shutdownStart, shutdownEnd)
    const guard = 'if (!input.teamName || !input.to) {'

    expect(shutdownBody).toContain('const rawInput = inputOverride ?? teamShutdownInputFromDraft(teamDraft)')
    expect(shutdownBody).toContain('const input: TeamShutdownInput = {')
    expect(shutdownBody).toContain('teamName: rawInput.teamName.trim(),')
    expect(shutdownBody).toContain('to: rawInput.to.trim(),')
    expect(shutdownBody).toContain('reason: rawInput.reason?.trim() || undefined,')
    expect(shutdownBody).toContain(guard)
    expect(shutdownBody).toContain("text: 'Choose a team and teammate before requesting shutdown.'")
    expect(shutdownBody.indexOf('const input: TeamShutdownInput = {')).toBeLessThan(
      shutdownBody.indexOf(guard),
    )
    expect(shutdownBody.indexOf(guard)).toBeLessThan(
      shutdownBody.indexOf('if (turnBusy)'),
    )
    expect(shutdownBody.indexOf(guard)).toBeLessThan(
      shutdownBody.indexOf('await runTeamAction('),
    )
  })

  it('normalizes team shutdown targets before runtime queueing and feedback', () => {
    const shutdownStart = rendererSource.indexOf('async function requestTeamShutdown')
    const shutdownEnd = rendererSource.indexOf('async function removeTeamMember', shutdownStart)
    const shutdownBody = rendererSource.slice(shutdownStart, shutdownEnd)

    expect(shutdownBody).toContain('const rawInput = inputOverride ?? teamShutdownInputFromDraft(teamDraft)')
    expect(shutdownBody).toContain('const input: TeamShutdownInput = {')
    expect(shutdownBody).toContain('teamName: rawInput.teamName.trim(),')
    expect(shutdownBody).toContain('to: rawInput.to.trim(),')
    expect(shutdownBody).toContain('reason: rawInput.reason?.trim() || undefined,')
    expect(shutdownBody.indexOf('const input: TeamShutdownInput = {')).toBeLessThan(
      shutdownBody.indexOf('if (turnBusy)'),
    )
    expect(shutdownBody).toContain("await runTeamAction(`${sessionId}:${input.teamName}:${input.to}:shutdown`, 'Requesting teammate shutdown'")
    expect(shutdownBody).toContain('await window.claudeDesktop.teams.shutdown(')
    expect(shutdownBody).toContain('input,')
    expect(shutdownBody).toContain("setTeamsStatus({ kind: 'success', text: `Requested shutdown for ${input.to}.` })")
  })

  it('shows a Teams error before removing a teammate with missing required fields', () => {
    const removeStart = rendererSource.indexOf('async function removeTeamMember')
    const removeEnd = rendererSource.indexOf('function selectTeam', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const guard = 'if (!teamName || !memberName) {'

    expect(removeBody).toContain('const teamName = team.name.trim()')
    expect(removeBody).toContain('const memberName = member.name.trim()')
    expect(removeBody).toContain(guard)
    expect(removeBody).toContain("text: 'Choose a team and teammate before removing.'")
    expect(removeBody.indexOf('const teamName = team.name.trim()')).toBeLessThan(
      removeBody.indexOf(guard),
    )
    expect(removeBody.indexOf('const memberName = member.name.trim()')).toBeLessThan(
      removeBody.indexOf(guard),
    )
    expect(removeBody.indexOf(guard)).toBeLessThan(
      removeBody.indexOf('requestConfirmation({'),
    )
  })

  it('shows a Teams error before deleting a team with a missing name', () => {
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('async function saveScheduledTask', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const guard = 'if (!deletedTeamName) {'

    expect(deleteBody).toContain('const deletedTeamName = team.name.trim()')
    expect(deleteBody).toContain(guard)
    expect(deleteBody).toContain("text: 'Choose a team before deleting.'")
    expect(deleteBody.indexOf('const deletedTeamName = team.name.trim()')).toBeLessThan(
      deleteBody.indexOf(guard),
    )
    expect(deleteBody.indexOf(guard)).toBeLessThan(
      deleteBody.indexOf('requestConfirmation({'),
    )
    expect(deleteBody.indexOf(guard)).toBeLessThan(
      deleteBody.indexOf('await runTeamAction('),
    )
  })

  it('persists and restores active grouped Settings, Tasks, Agents, and Teams sections in session layout', () => {
    expect(rendererSource).toContain('const restoredSettingsSection = activeSession.layout.settingsActiveSection ??')
    expect(rendererSource).toContain('const restoredTasksSection = activeSession.layout.tasksActiveSection ??')
    expect(rendererSource).toContain('const restoredAgentsSection = activeSession.layout.agentsActiveSection ??')
    expect(rendererSource).toContain('setSelectedAgentType(activeSession.layout.selectedAgentType)')
    expect(rendererSource).toContain('setSelectedAgentSource(activeSession.layout.selectedAgentSource as AgentSource | undefined)')
    expect(rendererSource).toContain('const restoredTeamsSection = activeSession.layout.teamsActiveSection ??')
    expect(rendererSource).toContain('setSettingsActiveSection(restoredSettingsSection)')
    expect(rendererSource).toContain('setTasksActiveSection(restoredTasksSection)')
    expect(rendererSource).toContain('setAgentsActiveSection(restoredAgentsSection)')
    expect(rendererSource).toContain('setTeamsActiveSection(restoredTeamsSection)')
    expect(rendererSource).toContain("activeSession.layout.activePane === 'settings'")
    expect(rendererSource).toContain("activeSession.layout.activePane === 'tasks'")
    expect(rendererSource).toContain("activeSession.layout.activePane === 'agents'")
    expect(rendererSource).toContain("activeSession.layout.activePane === 'teams'")
    expect(rendererSource).toContain('pendingPaneSectionRef.current = {')
    expect(rendererSource).toContain('tasksActiveSection: pane === \'tasks\' ? sectionId : undefined')
    expect(rendererSource).toContain('agentsActiveSection: pane === \'agents\' ? sectionId : undefined')
    expect(rendererSource).toContain('teamsActiveSection: pane === \'teams\' ? sectionId : undefined')
    expect(rendererSource).toContain("flushPendingPaneSection(activePane === 'teams' ? 'teams' : 'agents')")
    expect(rendererSource).toContain("openPaneSection('agents', 'agents-editor', 'agents')")
    const settingsSectionStart = rendererSource.indexOf('function openSettingsSection')
    const settingsSectionEnd = rendererSource.indexOf('function openTasksSection', settingsSectionStart)
    const settingsSectionBody = rendererSource.slice(settingsSectionStart, settingsSectionEnd)
    expect(settingsSectionBody).toContain('const session = activeSession')
    expect(settingsSectionBody).toContain(
      "if (session) void updateSessionLayout(session.id, { settingsActiveSection: sectionId })",
    )
    expect(settingsSectionBody).not.toContain('void updateLayout({ settingsActiveSection: sectionId })')
    expect(rendererSource).toContain(
      "settingsActiveSection: pane === 'settings' ? sectionId : undefined",
    )
  })

  it('clears stale pending lifecycle sections when the active session has no lifecycle pane', () => {
    const noSessionMarker = rendererSource.indexOf('activeSessionIdRef.current = undefined')
    const noSessionStart = rendererSource.lastIndexOf('if (!activeSession) {', noSessionMarker)
    const noSessionEnd = rendererSource.indexOf('return\n    }', noSessionStart)
    const noSessionBody = rendererSource.slice(noSessionStart, noSessionEnd)
    const restoreStart = rendererSource.indexOf("activeSession.layout.activePane === 'settings'", noSessionEnd)
    const restoreEnd = rendererSource.indexOf('setConversationNotice(undefined)', restoreStart)
    const restoreBody = rendererSource.slice(restoreStart, restoreEnd)

    expect(noSessionBody).toContain('pendingPaneSectionRef.current = undefined')
    expect(restoreBody).toContain('} else {\n      pendingPaneSectionRef.current = undefined\n    }')
  })

  it('guards scheduled task removal against duplicate destructive submissions', () => {
    const globalStart = rendererSource.indexOf('async function removeScheduledTask')
    const globalEnd = rendererSource.indexOf('async function toggleScheduledTaskEnabled', globalStart)
    const globalBody = rendererSource.slice(globalStart, globalEnd)
    const projectStart = rendererSource.indexOf('async function removeProjectScheduledTask')
    const projectEnd = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)

    expect(globalBody).toContain('const removedTaskId = taskId.trim()')
    expect(globalBody).toContain("const actionKey = `global:${removedTaskId}:remove`")
    expect(globalBody).toContain("await runScheduledTaskAction(actionKey, 'Removing scheduled task'")
    expect(projectBody).toContain('const session = activeSession')
    expect(projectBody).toContain('const removedTaskId = taskId.trim()')
    expect(projectBody).toContain("const actionKey = `${session.id}:project:${removedTaskId}:remove`")
    expect(projectBody).toContain("await runScheduledTaskAction(actionKey, 'Removing project scheduled task'")
  })

  it('shows a scheduled task error before removing a global task with a missing id', () => {
    const start = rendererSource.indexOf('async function removeScheduledTask')
    const end = rendererSource.indexOf('async function toggleScheduledTaskEnabled', start)
    const body = rendererSource.slice(start, end)
    const guard = 'if (!removedTaskId) {'

    expect(body).toContain('const removedTaskId = taskId.trim()')
    expect(body).toContain(guard)
    expect(body).toContain("text: 'Select a scheduled task before removing.'")
    expect(body.indexOf('const removedTaskId = taskId.trim()')).toBeLessThan(
      body.indexOf(guard),
    )
    expect(body.indexOf(guard)).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
  })

  it('normalizes global scheduled task removal before confirmation and IPC', () => {
    const start = rendererSource.indexOf('async function removeScheduledTask')
    const end = rendererSource.indexOf('async function toggleScheduledTaskEnabled', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const removedTaskId = taskId.trim()')
    expect(body.indexOf('const removedTaskId = taskId.trim()')).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
    expect(body).toContain('message: `Remove scheduled task "${removedTaskId}" from global Claude Code settings.`')
    expect(body).toContain('await window.claudeDesktop.tasks.remove(removedTaskId)')
    expect(body).toContain('if (taskDraft.id === removedTaskId) {')
    expect(body).toContain('setScheduledTaskStatus({ kind: \'success\', text: `Removed scheduled task "${removedTaskId}".` }, statusTarget)')
  })

  it('blocks project scheduled task removal before confirmation without an active session', () => {
    const start = rendererSource.indexOf('async function removeProjectScheduledTask')
    const end = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (!activeSession)')
    expect(body).toContain("text: 'Select a session before removing project scheduled tasks.'")
    expect(body.indexOf('if (!activeSession)')).toBeLessThan(
      body.indexOf("const actionKey = `${session.id}:project:${removedTaskId}:remove`"),
    )
    expect(body.indexOf('if (!activeSession)')).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
  })

  it('shows a scheduled task error before removing a project task with a missing id', () => {
    const start = rendererSource.indexOf('async function removeProjectScheduledTask')
    const end = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled', start)
    const body = rendererSource.slice(start, end)
    const guard = 'if (!removedTaskId) {'

    expect(body).toContain('const removedTaskId = taskId.trim()')
    expect(body).toContain(guard)
    expect(body).toContain("text: 'Select a project scheduled task before removing.'")
    expect(body.indexOf('const removedTaskId = taskId.trim()')).toBeLessThan(
      body.indexOf(guard),
    )
    expect(body.indexOf(guard)).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
  })

  it('normalizes project scheduled task removal before confirmation and IPC', () => {
    const start = rendererSource.indexOf('async function removeProjectScheduledTask')
    const end = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const removedTaskId = taskId.trim()')
    expect(body.indexOf('const removedTaskId = taskId.trim()')).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
    expect(body).toContain('message: `Remove project scheduled task "${removedTaskId}" from this workspace.`')
    expect(body).toContain('removedTaskId,')
    expect(body).toContain('if (projectTaskDraft.id === removedTaskId) {')
    expect(body).toContain('setScheduledTaskStatus({ kind: \'success\', text: `Removed project scheduled task "${removedTaskId}".` }, statusTarget)')
  })

  it('guards session close confirmation against duplicate destructive submissions', () => {
    const start = rendererSource.indexOf('async function closeSessionById')
    const end = rendererSource.indexOf('function openSessionMenu', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (sessionCloseActionPendingRef.current.has(sessionId)) return')
    expect(body.indexOf('sessionCloseActionPendingRef.current.add(sessionId)')).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
    expect(body).toContain("await runAction('Closing session'")
    expect(body).toContain('sessionCloseActionPendingRef.current.delete(sessionId)')
  })

  it('clears editor dirty state synchronously when discarding pane-switch changes', () => {
    const start = rendererSource.indexOf('function discardEditorChanges')
    const end = rendererSource.indexOf('async function focusSession', start)
    const body = rendererSource.slice(start, end)

    expect(rendererSource).toContain('const fileContentsRef = useRef')
    expect(rendererSource).toContain('fileContentsRef.current = fileContents')
    expect(body).toContain('fileContentsRef.current = savedContents')
    expect(body).toContain('hasUnsavedChangesRef.current = false')
    expect(body).toContain('window.__claudeDesktopSmokeHasUnsavedChanges = false')
  })

  it('re-clears editor dirty state after save refresh completes', () => {
    const start = rendererSource.indexOf('async function saveFile')
    const end = rendererSource.indexOf('async function startTerminal', start)
    const body = rendererSource.slice(start, end)
    const refreshIndex = body.indexOf('await refreshWorkspace(session)')
    const afterRefresh = body.slice(refreshIndex)

    expect(refreshIndex).toBeGreaterThan(-1)
    expect(afterRefresh).toContain('shouldSyncSavedEditorModel({')
    expect(afterRefresh).toContain('fileContentsRef.current = contents')
    expect(afterRefresh).toContain('setFileContents(contents)')
    expect(afterRefresh).toContain('hasUnsavedChangesRef.current = false')
    expect(afterRefresh).toContain('window.__claudeDesktopSmokeHasUnsavedChanges = false')
  })

  it('guards editor file async results against stale session writes', () => {
    const openStart = rendererSource.indexOf('async function openFile')
    const openEnd = rendererSource.indexOf('async function saveFile', openStart)
    const openBody = rendererSource.slice(openStart, openEnd)
    const saveStart = rendererSource.indexOf('async function saveFile')
    const saveEnd = rendererSource.indexOf('async function startTerminal', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)

    expect(openBody).toContain('const session = activeSession')
    expect(openBody).toContain('window.claudeDesktop.workspace.readFile(')
    expect(openBody).toContain('session.cwd,')
    expect(openBody).toContain('if (activeSessionIdRef.current !== session.id) return')
    expect(openBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeGreaterThan(
      openBody.indexOf('contents = await window.claudeDesktop.workspace.readFile('),
    )
    expect(openBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      openBody.indexOf('setActiveFile(path)'),
    )
    expectGuardBetween(
      openBody,
      activeSessionGuard,
      'const message = cause instanceof Error ? cause.message : String(cause)',
      "setPrimaryNavView('chat')",
    )
    expect(openBody).toContain('await updateSessionLayout(session.id, {')
    expect(openBody).toContain('activeFile: undefined,')
    expect(openBody).toContain('activeFile: path, activePane: \'editor\', primaryView: \'chat\'')
    expect(openBody).not.toContain('await updateLayout({\n          activeFile: undefined,')
    expect(openBody).not.toContain('await updateLayout({ activeFile: path, activePane: \'editor\', primaryView: \'chat\' })')
    expect(openBody.indexOf('await updateSessionLayout(session.id, {\n          activeFile: undefined,')).toBeGreaterThan(
      openBody.indexOf("setSavedFileContents('')"),
    )
    expect(openBody.indexOf('await updateSessionLayout(session.id, { activeFile: path, activePane: \'editor\', primaryView: \'chat\' })')).toBeGreaterThan(
      openBody.indexOf('setEditorStatus({ kind: \'success\', text: `Opened ${path}` })'),
    )

    expect(saveBody).toContain('const session = activeSession')
    expect(saveBody).toContain('const filePath = activeFile')
    expect(saveBody).toContain('session.cwd,')
    expect(saveBody).toContain('filePath,')
    expect(saveBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeGreaterThan(
      saveBody.indexOf('await window.claudeDesktop.workspace.saveFile('),
    )
    expect(saveBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      saveBody.indexOf('fileContentsRef.current = contents'),
    )
    expectGuardBetween(
      saveBody,
      activeSessionGuard,
      'const message = cause instanceof Error ? cause.message : String(cause)',
      'setEditorStatus({ kind: \'error\', text: message })',
    )
    expectGuardBetween(
      saveBody,
      activeSessionGuard,
      'await refreshWorkspace(session)',
      'if (shouldSyncSavedEditorModel({',
    )
  })

  it('shows Editor errors when file actions lose their prerequisites', () => {
    const openStart = rendererSource.indexOf('async function openFile')
    const openEnd = rendererSource.indexOf('async function saveFile', openStart)
    const openBody = rendererSource.slice(openStart, openEnd)
    const saveStart = rendererSource.indexOf('async function saveFile')
    const saveEnd = rendererSource.indexOf('async function startTerminal', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)

    expect(openBody).toContain('if (!activeSession) {')
    expect(openBody).toContain("setEditorStatus({ kind: 'error', text: 'Select a session before opening files.' })")
    expect(openBody.indexOf('if (!activeSession) {')).toBeLessThan(
      openBody.indexOf('confirmDiscardUnsavedChanges()'),
    )
    expect(openBody.indexOf('if (!activeSession) {')).toBeLessThan(
      openBody.indexOf("await runAction('Opening file'"),
    )

    expect(saveBody).toContain('if (!activeSession) {')
    expect(saveBody).toContain("setEditorStatus({ kind: 'error', text: 'Select a session before saving files.' })")
    expect(saveBody.indexOf('if (!activeSession) {')).toBeLessThan(
      saveBody.indexOf('fileSaveActionPendingRef.current'),
    )
    expect(saveBody.indexOf('if (!activeSession) {')).toBeLessThan(
      saveBody.indexOf("await runAction('Saving file'"),
    )

    expect(saveBody).toContain('if (!activeFile) {')
    expect(saveBody).toContain("setEditorStatus({ kind: 'error', text: 'Open a file before saving.' })")
    expect(saveBody.indexOf('if (!activeFile) {')).toBeLessThan(
      saveBody.indexOf('fileSaveActionPendingRef.current'),
    )
    expect(saveBody.indexOf('if (!activeFile) {')).toBeLessThan(
      saveBody.indexOf("await runAction('Saving file'"),
    )
  })

  it('blocks editor save and composer send buttons while loading', () => {
    const editorStart = rendererSource.indexOf('{activePane === \'editor\' && (')
    const editorEnd = rendererSource.indexOf('{activePane === \'terminal\' && (', editorStart)
    const editorBody = rendererSource.slice(editorStart, editorEnd)
    const composerStart = rendererSource.indexOf('<footer className="composer">')
    const composerEnd = rendererSource.indexOf('</footer>', composerStart)
    const composerBody = rendererSource.slice(composerStart, composerEnd)

    expect(editorBody).toContain('<button className="icon-button" title="Save file" aria-label="Save file" data-tooltip="Save file" onClick={handleSaveFileClick} disabled={!activeSession || !activeFile || !!loadingLabel}>')
    expect(composerBody).toContain('<button className="send-button" onClick={handleComposerSendClick} disabled={!activeSession || turnBusy || !input.trim() || !!loadingLabel}>')
  })

  it('routes stale composer Send clicks through the message handler', () => {
    const composerStart = rendererSource.indexOf('<footer className="composer">')
    const composerEnd = rendererSource.indexOf('</footer>', composerStart)
    const composerBody = rendererSource.slice(composerStart, composerEnd)

    expect(rendererSource).toContain('function handleComposerSendClick(): void')
    expect(composerBody).toContain('<button className="send-button" onClick={handleComposerSendClick} disabled={!activeSession || turnBusy || !input.trim() || !!loadingLabel}>')
    expect(composerBody).not.toContain('<button className="send-button" onClick={() => !loadingLabel && void sendMessage()} disabled={!activeSession || turnBusy || !input.trim() || !!loadingLabel}>')
    expect(composerBody).not.toContain('activeSession && !turnBusy && input.trim() && !loadingLabel && void sendMessage()')
    expect(composerBody).not.toContain('!turnBusy && input.trim() && !loadingLabel && void sendMessage()')
  })

  it('blocks composer and preview input edits while loading', () => {
    const composerStart = rendererSource.indexOf('<footer className="composer">')
    const composerEnd = rendererSource.indexOf('onClick={event => updateComposerSelection(event.currentTarget)}', composerStart)
    const composerBody = rendererSource.slice(composerStart, composerEnd)
    const previewLabel = rendererSource.indexOf('aria-label="Preview URL"')
    const previewStart = rendererSource.lastIndexOf('<input', previewLabel)
    const previewEnd = rendererSource.indexOf('/>', previewLabel)
    const previewBody = rendererSource.slice(previewStart, previewEnd)

    expect(rendererSource).toContain('function handleComposerInputChange(event: ReactChangeEvent<HTMLTextAreaElement>): void')
    expect(composerBody).toContain('onChange={handleComposerInputChange}')
    expect(composerBody).not.toContain('setInput(event.target.value)')
    expect(rendererSource).toContain('function handlePreviewUrlChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(previewBody).toContain('onChange={handlePreviewUrlChange}')
    expect(previewBody).not.toContain('setPreviewUrl(nextUrl)')
  })

  it('sets the Monaco editor read-only while loading', () => {
    const effectStart = rendererSource.indexOf("if (activePane !== 'editor' || !monacoHostRef.current) return")
    const effectEnd = rendererSource.indexOf('async function createSession', effectStart)
    const effectBody = rendererSource.slice(effectStart, effectEnd)

    expect(effectBody).toContain('readOnly: !!loadingLabel')
    expect(effectBody).toContain('monacoEditorRef.current.updateOptions({ readOnly: !!loadingLabel })')
    expect(effectBody).toContain('}, [activePane, activeFile, fileContents, workspaceRatio, loadingLabel])')
  })

  it('guards terminal lifecycle async results against stale session writes', () => {
    const startStart = rendererSource.indexOf('async function startTerminal')
    const startEnd = rendererSource.indexOf('async function stopTerminal', startStart)
    const startBody = rendererSource.slice(startStart, startEnd)
    const stopStart = rendererSource.indexOf('async function stopTerminal')
    const stopEnd = rendererSource.indexOf('async function setPane', stopStart)
    const stopBody = rendererSource.slice(stopStart, stopEnd)

    expect(startBody).toContain('const session = activeSession')
    expect(startBody).toContain('window.claudeDesktop.terminal.create(session.cwd)')
    expect(startBody).toContain('if (activeSessionIdRef.current !== session.id) return')
    expect(startBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeGreaterThan(
      startBody.indexOf('info = await window.claudeDesktop.terminal.create(session.cwd)'),
    )
    expect(startBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      startBody.indexOf('setTerminalInfo(info)'),
    )
    expectGuardBetween(
      startBody,
      activeSessionGuard,
      'const message = cause instanceof Error ? cause.message : String(cause)',
      'setTerminalId(undefined)',
    )
    expect(startBody).toContain('await updateSessionLayout(session.id, {')
    expect(startBody).toContain('terminalId: info.id,')
    expect(startBody).toContain('activePane: \'terminal\',')
    expect(startBody).not.toContain('await updateLayout({\n          terminalId: info.id,')
    expect(startBody.indexOf('await updateSessionLayout(session.id, {')).toBeLessThan(
      startBody.indexOf('})\n      })'),
    )

    expect(stopBody).toContain('const session = activeSession')
    expect(stopBody).toContain('const currentTerminalId = terminalIdRef.current')
    expect(stopBody).toContain('if (activeSessionIdRef.current !== session.id) return')
    expect(stopBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeGreaterThan(
      stopBody.indexOf('await window.claudeDesktop.terminal.kill(currentTerminalId)'),
    )
    expect(stopBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      stopBody.indexOf('setTerminalId(undefined)'),
    )
    expect(stopBody).toContain('await updateSessionLayout(session.id, { terminalId: undefined })')
    expect(stopBody).not.toContain('await updateLayout({ terminalId: undefined })')
  })

  it('shows a Terminal error when terminal lifecycle actions lose the active session', () => {
    const startStart = rendererSource.indexOf('async function startTerminal')
    const startEnd = rendererSource.indexOf('async function stopTerminal', startStart)
    const startBody = rendererSource.slice(startStart, startEnd)
    const stopStart = rendererSource.indexOf('async function stopTerminal')
    const stopEnd = rendererSource.indexOf('async function setPane', stopStart)
    const stopBody = rendererSource.slice(stopStart, stopEnd)

    for (const body of [startBody, stopBody]) {
      expect(body).toContain('if (!activeSession) {')
      expect(body).toContain("text: 'Select a session before using the terminal.'")
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('const session = activeSession'),
      )
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('terminalActionPendingRef.current = true'),
      )
    }
    expect(startBody.indexOf('if (!activeSession) {')).toBeLessThan(
      startBody.indexOf('window.claudeDesktop.terminal.create(session.cwd)'),
    )
    expect(stopBody.indexOf('if (!activeSession) {')).toBeLessThan(
      stopBody.indexOf('await window.claudeDesktop.terminal.kill(currentTerminalId)'),
    )
  })

  it('blocks Terminal and Preview pane action buttons while loading', () => {
    const terminalStart = rendererSource.indexOf('{activePane === \'terminal\' && (')
    const terminalEnd = rendererSource.indexOf('{activePane === \'preview\' && (', terminalStart)
    const terminalBody = rendererSource.slice(terminalStart, terminalEnd)
    const previewStart = rendererSource.indexOf('{activePane === \'preview\' && (')
    const previewEnd = rendererSource.indexOf('{activePane === \'settings\' && (', previewStart)
    const previewBody = rendererSource.slice(previewStart, previewEnd)

    expect(terminalBody).toContain('<button className="tool-button" onClick={handleStartTerminalClick} disabled={!activeSession || !!terminalId || !!loadingLabel}>')
    expect(terminalBody).toContain('<button className="tool-button" onClick={handleStopTerminalClick} disabled={!activeSession || !terminalId || !!loadingLabel}>')
    expect(previewBody).toContain('<button className="tool-button" onClick={handleOpenPreviewClick} disabled={!activeSession || !previewUrlValid || !!loadingLabel}>')
    expect(previewBody).toContain('<button className="tool-button icon-only" onClick={handleOpenExternalPreviewClick} disabled={!activeSession || !previewUrlValid || !!loadingLabel}')
  })

  it('routes stale Workspace action buttons through handlers', () => {
    const filesStart = rendererSource.indexOf('{activePane === \'files\' && (')
    const filesEnd = rendererSource.indexOf('{activePane === \'diff\' && (', filesStart)
    const filesBody = rendererSource.slice(filesStart, filesEnd)
    const diffStart = rendererSource.indexOf('{activePane === \'diff\' && (')
    const diffEnd = rendererSource.indexOf('{activePane === \'editor\' && (', diffStart)
    const diffBody = rendererSource.slice(diffStart, diffEnd)
    const editorStart = rendererSource.indexOf('{activePane === \'editor\' && (')
    const editorEnd = rendererSource.indexOf('{activePane === \'terminal\' && (', editorStart)
    const editorBody = rendererSource.slice(editorStart, editorEnd)
    const terminalStart = rendererSource.indexOf('{activePane === \'terminal\' && (')
    const terminalEnd = rendererSource.indexOf('{activePane === \'preview\' && (', terminalStart)
    const terminalBody = rendererSource.slice(terminalStart, terminalEnd)
    const previewStart = rendererSource.indexOf('{activePane === \'preview\' && (')
    const previewEnd = rendererSource.indexOf('{activePane === \'settings\' && (', previewStart)
    const previewBody = rendererSource.slice(previewStart, previewEnd)

    expect(rendererSource).toContain('function handleRefreshFilesClick(): void')
    expect(rendererSource).toContain('function handleRefreshDiffClick(): void')
    expect(rendererSource).toContain('function handleSaveFileClick(): void')
    expect(rendererSource).toContain('function handleStartTerminalClick(): void')
    expect(rendererSource).toContain('function handleStopTerminalClick(): void')
    expect(rendererSource).toContain('function handleOpenPreviewClick(): void')
    expect(rendererSource).toContain('function handleOpenExternalPreviewClick(): void')
    expect(filesBody).toContain('<button className="tool-button" onClick={handleRefreshFilesClick} disabled={!activeSession || !!loadingLabel}>')
    expect(diffBody).toContain('<button className="tool-button" onClick={handleRefreshDiffClick} disabled={!activeSession || !!loadingLabel}>')
    expect(editorBody).toContain('<button className="icon-button" title="Save file" aria-label="Save file" data-tooltip="Save file" onClick={handleSaveFileClick} disabled={!activeSession || !activeFile || !!loadingLabel}>')
    expect(terminalBody).toContain('<button className="tool-button" onClick={handleStartTerminalClick} disabled={!activeSession || !!terminalId || !!loadingLabel}>')
    expect(terminalBody).toContain('<button className="tool-button" onClick={handleStopTerminalClick} disabled={!activeSession || !terminalId || !!loadingLabel}>')
    expect(previewBody).toContain('<button className="tool-button" onClick={handleOpenPreviewClick} disabled={!activeSession || !previewUrlValid || !!loadingLabel}>')
    expect(previewBody).toContain('<button className="tool-button icon-only" onClick={handleOpenExternalPreviewClick} disabled={!activeSession || !previewUrlValid || !!loadingLabel}')

    expect(filesBody).not.toContain('onClick={() => !loadingLabel && void refreshFiles()}')
    expect(diffBody).not.toContain('onClick={() => !loadingLabel && void refreshDiff()}')
    expect(editorBody).not.toContain('onClick={() => !loadingLabel && void saveFile()}')
    expect(terminalBody).not.toContain('onClick={() => !loadingLabel && void startTerminal()}')
    expect(terminalBody).not.toContain('onClick={() => !loadingLabel && void stopTerminal()}')
    expect(previewBody).not.toContain('onClick={() => !loadingLabel && void openPreview()}')
    expect(previewBody).not.toContain('onClick={() => !loadingLabel && void openExternalPreview()}')
    expect(filesBody).not.toContain('activeSession && !loadingLabel && void refreshFiles()')
    expect(diffBody).not.toContain('activeSession && !loadingLabel && void refreshDiff()')
    expect(editorBody).not.toContain('activeSession && activeFile && !loadingLabel && void saveFile()')
    expect(terminalBody).not.toContain('activeSession && !terminalId && !loadingLabel && void startTerminal()')
    expect(terminalBody).not.toContain('activeSession && terminalId && !loadingLabel && void stopTerminal()')
    expect(terminalBody).not.toContain('if (!loadingLabel) void startTerminal()')
    expect(terminalBody).not.toContain('if (!loadingLabel) void stopTerminal()')
    expect(previewBody).not.toContain('activeSession && previewUrlValid && !loadingLabel && void openPreview()')
    expect(previewBody).not.toContain('activeSession && previewUrlValid && !loadingLabel && void openExternalPreview()')
  })

  it('shows visible session guidance on disabled Terminal and Preview panes', () => {
    const terminalStart = rendererSource.indexOf('{activePane === \'terminal\' && (')
    const terminalEnd = rendererSource.indexOf('{activePane === \'preview\' && (', terminalStart)
    const terminalBody = rendererSource.slice(terminalStart, terminalEnd)
    const previewStart = rendererSource.indexOf('{activePane === \'preview\' && (')
    const previewEnd = rendererSource.indexOf('{(activePane === \'agents\' || activePane === \'teams\') && (', previewStart)
    const previewBody = rendererSource.slice(previewStart, previewEnd)

    expect(terminalBody).toContain('{!activeSession && (')
    expect(terminalBody).toContain('Select a project session before starting a shell.')
    expect(previewBody).toContain('{!activeSession && (')
    expect(previewBody).toContain('Select a project session before opening an embedded preview.')
  })

  it('guards composer send and cancel async results against stale session writes', () => {
    const sendStart = rendererSource.indexOf('async function sendMessage')
    const sendEnd = rendererSource.indexOf('async function cancelSession', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)
    const cancelStart = rendererSource.indexOf('async function cancelSession')
    const cancelEnd = rendererSource.indexOf('async function closeSession', cancelStart)
    const cancelBody = rendererSource.slice(cancelStart, cancelEnd)

    expect(sendBody).toContain('const session = activeSession')
    expect(sendBody).toContain('window.claudeDesktop.teams.send(session.id,')
    expect(sendBody).toContain('window.claudeDesktop.sessions.launchAgentTask(session.id,')
    expect(sendBody).toContain('await window.claudeDesktop.sessions.send(session.id, text)')
    expectGuardBetween(
      sendBody,
      activeSessionGuard,
      'await window.claudeDesktop.teams.send(session.id,',
      'setConversationNotice({',
    )
    expectGuardBetween(
      sendBody,
      activeSessionGuard,
      'await window.claudeDesktop.sessions.launchAgentTask(session.id,',
      'setConversationNotice({',
    )

    expect(cancelBody).toContain('const session = activeSession')
    expect(cancelBody).toContain('const sessionId = session.id')
    expect(cancelBody).toContain('if (activeSessionIdRef.current !== session.id) return')
    expect(cancelBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeGreaterThan(
      cancelBody.indexOf('await window.claudeDesktop.sessions.cancel(sessionId)'),
    )
    expect(cancelBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      cancelBody.indexOf('setPermissionQueue(prev =>'),
    )
  })

  it('shows a conversation notice when composer send loses the active session', () => {
    const sendStart = rendererSource.indexOf('async function sendMessage')
    const sendEnd = rendererSource.indexOf('async function cancelSession', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)
    const guard = 'if (!activeSession) {'

    expect(sendBody).toContain(guard)
    expect(sendBody).toContain("text: 'Select a session before sending a message.'")
    expect(sendBody.indexOf(guard)).toBeLessThan(
      sendBody.indexOf('if (input.trim().length === 0) {'),
    )
    expect(sendBody.indexOf(guard)).toBeLessThan(
      sendBody.indexOf('const session = activeSession'),
    )
  })

  it('shows a conversation notice when composer send is attempted during a busy turn', () => {
    const sendStart = rendererSource.indexOf('async function sendMessage')
    const sendEnd = rendererSource.indexOf('async function cancelSession', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)
    const guard = 'if (turnBusy) {'

    expect(sendBody).toContain(guard)
    expect(sendBody).toContain("text: 'Wait for the current Claude turn to finish before sending another message.'")
    expect(sendBody.indexOf(guard)).toBeGreaterThan(
      sendBody.indexOf("text: 'Select a session before sending a message.'"),
    )
    expect(sendBody.indexOf(guard)).toBeLessThan(
      sendBody.indexOf('if (input.trim().length === 0) {'),
    )
    expect(sendBody.indexOf(guard)).toBeLessThan(
      sendBody.indexOf('const session = activeSession'),
    )
  })

  it('shows a conversation notice when composer send is attempted with an empty prompt', () => {
    const sendStart = rendererSource.indexOf('async function sendMessage')
    const sendEnd = rendererSource.indexOf('async function cancelSession', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)
    const guard = 'if (input.trim().length === 0) {'

    expect(sendBody).toContain(guard)
    expect(sendBody).toContain("text: 'Enter a message before sending.'")
    expect(sendBody.indexOf(guard)).toBeGreaterThan(
      sendBody.indexOf("text: 'Wait for the current Claude turn to finish before sending another message.'"),
    )
    expect(sendBody.indexOf(guard)).toBeLessThan(
      sendBody.indexOf('if (sendActionPendingRef.current) return'),
    )
    expect(sendBody.indexOf(guard)).toBeLessThan(
      sendBody.indexOf('const session = activeSession'),
    )
  })

  it('guards preview open async results against stale session writes', () => {
    const openStart = rendererSource.indexOf('async function openPreview')
    const openEnd = rendererSource.indexOf('async function openExternalPreview', openStart)
    const openBody = rendererSource.slice(openStart, openEnd)
    const externalStart = rendererSource.indexOf('async function openExternalPreview')
    const externalEnd = rendererSource.indexOf('async function saveProxySettings', externalStart)
    const externalBody = rendererSource.slice(externalStart, externalEnd)

    expect(openBody).toContain('const session = activeSession')
    expect(openBody).toContain('const url = previewUrl')
    expect(openBody).toContain('window.claudeDesktop.preview.setUrl(url)')
    expect(openBody).toContain('await updateSessionLayout(session.id, { previewUrl: url, activePane: \'preview\', primaryView: \'chat\' })')
    expect(openBody).not.toContain('await updateLayout({ previewUrl: url, activePane: \'preview\', primaryView: \'chat\' })')
    expectGuardBetween(
      openBody,
      activeSessionGuard,
      'await window.claudeDesktop.preview.setUrl(url)',
      "setPrimaryNavView('chat')",
    )
    expect(openBody.indexOf('await updateSessionLayout(session.id, { previewUrl: url, activePane: \'preview\', primaryView: \'chat\' })')).toBeLessThan(
      openBody.indexOf('setPreviewStatus({ kind: \'success\''),
    )

    expect(externalBody).toContain('const session = activeSession')
    expect(externalBody).toContain('const url = previewUrl')
    expect(externalBody).toContain('await window.claudeDesktop.preview.openExternal(url)')
    expectGuardBetween(
      externalBody,
      activeSessionGuard,
      'await window.claudeDesktop.preview.openExternal(url)',
      'setPreviewStatus({ kind: \'success\'',
    )
  })

  it('routes assistant markdown links through controlled external browser IPC', () => {
    const markdownStart = rendererSource.indexOf('function renderInlineMarkdown')
    const markdownEnd = rendererSource.indexOf('function MessageContent', markdownStart)
    const markdownBody = rendererSource.slice(markdownStart, markdownEnd)
    const linkClickStart = rendererSource.indexOf('function handleInlineMarkdownLinkClick')
    const linkClickEnd = rendererSource.indexOf('function renderInlineMarkdown', linkClickStart)
    const linkClickBody = rendererSource.slice(linkClickStart, linkClickEnd)
    const contentStart = rendererSource.indexOf('function MessageContent')
    const contentEnd = rendererSource.indexOf('function sessionSummary', contentStart)
    const contentBody = rendererSource.slice(contentStart, contentEnd)
    const handlerStart = rendererSource.indexOf('async function openExternalLink')
    const handlerEnd = rendererSource.indexOf('async function saveProxySettings', handlerStart)
    const handlerBody = rendererSource.slice(handlerStart, handlerEnd)
    const messageContentStart = rendererSource.indexOf('<MessageContent')
    const messageContentEnd = rendererSource.indexOf('/>', messageContentStart)
    const messageContentCall = rendererSource.slice(messageContentStart, messageContentEnd)

    expect(markdownBody).toContain('onOpenExternalLink?: (url: string) => void')
    expect(linkClickBody).toContain('function handleInlineMarkdownLinkClick(')
    expect(linkClickBody).toContain('event.preventDefault()')
    expect(linkClickBody).toContain('onOpenExternalLink?.(url)')
    expect(markdownBody).toContain('onClick={event => handleInlineMarkdownLinkClick(event, match[4], onOpenExternalLink)}')
    expect(markdownBody).not.toContain('onClick={event => {')
    expect(contentBody).toContain('onOpenExternalLink?: (url: string) => void')
    expect(contentBody).toContain('renderInlineMarkdown(block.text, onOpenExternalLink)')
    expect(contentBody).toContain('renderInlineMarkdown(item, onOpenExternalLink)')
    expect(messageContentCall).toContain('onOpenExternalLink={url => void openExternalLink(url)}')
    expect(handlerBody).toContain('const session = activeSession')
    expect(handlerBody).toContain('if (!isHttpUrl(url))')
    expect(handlerBody).toContain('await window.claudeDesktop.preview.openExternal(url)')
    expect(handlerBody).toContain('setConversationNotice({')
    expectGuardBetween(
      handlerBody,
      activeSessionGuard,
      'await window.claudeDesktop.preview.openExternal(url)',
      'setConversationNotice({',
    )
  })

  it('disables the preview URL field while loading or without an active session', () => {
    const labelIndex = rendererSource.indexOf('aria-label="Preview URL"')
    expect(labelIndex).toBeGreaterThanOrEqual(0)

    const fieldStart = rendererSource.lastIndexOf('<input', labelIndex)
    const fieldEnd = rendererSource.indexOf('/>', labelIndex)
    const fieldBody = rendererSource.slice(fieldStart, fieldEnd)

    expect(fieldBody).toContain('disabled={!activeSession || !!loadingLabel}')
  })

  it('keeps permission response errors attached to the original request', () => {
    const start = rendererSource.indexOf('async function respondToPermission')
    const end = rendererSource.indexOf('return (', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const request = pendingPermission')
    expect(body).toContain('item.requestId === request.requestId')
    expect(body).not.toContain('index === 0 ? { ...item, error: message } : item')
  })

  it('shows a structured empty state when permission input has no rows', () => {
    const renderStart = rendererSource.indexOf('function renderPermissionInput')
    const renderEnd = rendererSource.indexOf('function isHttpUrl', renderStart)
    const renderBody = rendererSource.slice(renderStart, renderEnd)
    const emptyStart = renderBody.indexOf('permission-empty')
    const emptyEnd = renderBody.indexOf('</div>', emptyStart)
    const emptyBody = renderBody.slice(emptyStart, emptyEnd)

    expect(emptyBody).toContain('permission-empty')
    expect(emptyBody).toContain('<Icon name="check" />')
    expect(emptyBody).toContain('<strong>No tool input</strong>')
    expect(renderBody).not.toContain('<p className="permission-empty">No tool input was provided.</p>')
  })

  it('blocks permission modal cancel turn while loading', () => {
    const modalStart = rendererSource.indexOf('{pendingPermission && (')
    const modalEnd = rendererSource.indexOf('{confirmRequest && (', modalStart)
    const modalBody = rendererSource.slice(modalStart, modalEnd)

    expect(rendererSource).toContain('function handlePermissionCancelTurnClick(): void')
    expect(modalBody).toContain('<button className="tool-button" onClick={handlePermissionCancelTurnClick} disabled={!cancelAvailable || !!loadingLabel || permissionResponding}>')
    expect(modalBody).not.toContain('<button className="tool-button" onClick={() => !loadingLabel && void cancelSession()} disabled={!cancelAvailable || !!loadingLabel || permissionResponding}>')
    expect(modalBody).not.toContain('cancelAvailable && !loadingLabel && !permissionResponding && void cancelSession()')
  })

  it('blocks permission Allow and Deny while loading', () => {
    const respondStart = rendererSource.indexOf('async function respondToPermission')
    const respondEnd = rendererSource.indexOf('return (', respondStart)
    const respondBody = rendererSource.slice(respondStart, respondEnd)
    const modalStart = rendererSource.indexOf('{pendingPermission && (')
    const modalEnd = rendererSource.indexOf('{confirmRequest && (', modalStart)
    const modalBody = rendererSource.slice(modalStart, modalEnd)

    expect(respondBody).toContain('loadingLabel ||')
    expect(respondBody.indexOf('loadingLabel ||')).toBeLessThan(
      respondBody.indexOf('permissionActionPendingRef.current'),
    )
    expect(rendererSource).toContain("function handlePermissionResponseClick(behavior: 'allow' | 'deny'): void")
    expect(modalBody).toContain("onClick={() => handlePermissionResponseClick('deny')} disabled={!!loadingLabel || permissionResponding}")
    expect(modalBody).toContain("onClick={() => handlePermissionResponseClick('allow')} disabled={!!loadingLabel || permissionResponding}")
    expect(modalBody).not.toContain("onClick={() => !loadingLabel && !permissionResponding && void respondToPermission('deny')}")
    expect(modalBody).not.toContain("onClick={() => !loadingLabel && !permissionResponding && void respondToPermission('allow')}")
  })

  it('blocks confirmation modal resolution while loading', () => {
    const settleStart = rendererSource.indexOf('function settleConfirmation')
    const settleEnd = rendererSource.indexOf('function restoreFocus', settleStart)
    const settleBody = rendererSource.slice(settleStart, settleEnd)
    const effectStart = rendererSource.indexOf('if (!confirmRequest) return')
    const effectEnd = rendererSource.indexOf('window.addEventListener', effectStart)
    const effectBody = rendererSource.slice(effectStart, effectEnd)
    const modalStart = rendererSource.indexOf('{confirmRequest && (')
    const modalEnd = rendererSource.indexOf('{pendingPermission && (', modalStart)
    const modalBody = rendererSource.slice(modalStart, modalEnd)

    expect(settleBody).toContain('if (loadingLabel) return')
    expect(settleBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      settleBody.indexOf('confirmResolverRef.current(confirmed)'),
    )
    expect(settleBody).toContain('if (!confirmResolverRef.current) return')
    expect(settleBody.indexOf('if (!confirmResolverRef.current) return')).toBeLessThan(
      settleBody.indexOf('confirmResolverRef.current(confirmed)'),
    )
    expect(effectBody).toContain('if (loadingLabel) return')
    expect(effectBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      effectBody.indexOf('settleConfirmation(false)'),
    )
    expect(settleBody).toContain('function resolveConfirmationModal(confirmed: boolean): void')
    expect(settleBody).toContain('settleConfirmation(confirmed)')
    expect(modalBody).toContain('onClick={() => resolveConfirmationModal(false)}')
    expect(modalBody).toContain('disabled={!!loadingLabel}')
    expect(modalBody).toContain('onClick={() => resolveConfirmationModal(true)}')
    expect(modalBody).not.toContain('onClick={() => !loadingLabel && settleConfirmation(false)}')
    expect(modalBody).not.toContain('onClick={() => !loadingLabel && settleConfirmation(true)}')
  })

  it('guards window close confirmation against duplicate destructive submissions', () => {
    const start = rendererSource.indexOf('async function handleAppCloseRequest')
    const end = rendererSource.indexOf('function mergeSession', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (appCloseActionPendingRef.current) return')
    expect(body.indexOf('appCloseActionPendingRef.current = true')).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
    expect(body).toContain('await window.claudeDesktop.app.closeWindow()')
    expect(body).toContain('appCloseActionPendingRef.current = false')
  })

  it('guards unsaved editor discard confirmation against duplicate destructive prompts', () => {
    const start = rendererSource.indexOf('async function confirmDiscardUnsavedChanges')
    const end = rendererSource.indexOf('function discardEditorChanges', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (discardEditorChangesActionPendingRef.current) return false')
    expect(body.indexOf('discardEditorChangesActionPendingRef.current = true')).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
    expect(body).toContain('discardEditorChangesActionPendingRef.current = false')
  })

  it('exposes first-class lifecycle create commands from the command palette', () => {
    expect(rendererSource).toContain("id: 'agents:new'")
    expect(rendererSource).toContain("label: 'New custom agent'")
    expect(rendererSource).toContain("openPaneSection('agents', 'agents-editor', 'agents')")
    expect(rendererSource).toContain('startNewAgentDraft()')

    expect(rendererSource).toContain("id: 'teams:new'")
    expect(rendererSource).toContain("label: 'New team'")
    expect(rendererSource).toContain("openPaneSection('teams', 'agents-teams', 'teams')")
    expect(rendererSource).toContain('startNewTeamDraft()')

    expect(rendererSource).toContain("id: 'tasks:new-global'")
    expect(rendererSource).toContain("label: 'New global scheduled task'")
    expect(rendererSource).toContain("openPaneSection('tasks', 'tasks-global-tasks', 'tasks')")
    expect(rendererSource).toContain('startNewScheduledTaskDraft()')

    expect(rendererSource).toContain("id: 'tasks:new-project'")
    expect(rendererSource).toContain("label: 'New project scheduled task'")
    expect(rendererSource).toContain("openPaneSection('tasks', 'tasks-project-tasks', 'tasks')")
    expect(rendererSource).toContain('startNewProjectScheduledTaskDraft()')
  })

  it('keeps user agent command palette actions available without an active session', () => {
    const paletteStart = rendererSource.indexOf('const commandPaletteItems = useMemo<CommandPaletteItem[]>')
    const paletteEnd = rendererSource.indexOf('function executeCommandPaletteItem', paletteStart)
    const paletteBody = rendererSource.slice(paletteStart, paletteEnd)
    const availableStart = paletteBody.indexOf("id: 'agents:available'")
    const runStart = paletteBody.indexOf("id: 'agents:run'")
    const customStart = paletteBody.indexOf("id: 'agents:custom'")
    const newStart = paletteBody.indexOf("id: 'agents:new'")
    const runningStart = paletteBody.indexOf("id: 'agents:running'")
    const teamsStart = paletteBody.indexOf("id: 'teams:management'")
    const availableBody = paletteBody.slice(availableStart, runStart)
    const runBody = paletteBody.slice(runStart, customStart)
    const customBody = paletteBody.slice(customStart, newStart)
    const newBody = paletteBody.slice(newStart, runningStart)
    const runningBody = paletteBody.slice(runningStart, teamsStart)

    for (const body of [availableBody, customBody, newBody]) {
      expect(body).toContain('disabled: !!loadingLabel')
      expect(body).toContain('disabledReason: loadingReason')
      expect(body).not.toContain('sessionRequired')
    }
    for (const body of [runBody, runningBody]) {
      expect(body).toContain('disabled: sessionRequired || !!loadingLabel')
      expect(body).toContain('disabledReason: sessionRequired ? sessionRequiredReason : loadingReason')
    }
  })

  it('exposes direct MCP, Skills, and Plugins management commands from the command palette', () => {
    expect(rendererSource).toContain("id: 'settings:mcp:add'")
    expect(rendererSource).toContain("label: 'Add MCP server'")
    expect(rendererSource).toContain("openPaneSection('settings', 'settings-mcp', 'settings')")
    expect(rendererSource).toContain('startNewMcpDraft()')

    expect(rendererSource).toContain("id: 'settings:mcp:check'")
    expect(rendererSource).toContain("label: 'Check MCP health'")
    expect(rendererSource).toContain('void checkMcpHealth()')

    expect(rendererSource).toContain("id: 'settings:skills:new-user'")
    expect(rendererSource).toContain("label: 'New user skill'")
    expect(rendererSource).toContain('startNewUserSkillDraft()')

    expect(rendererSource).toContain("id: 'settings:skills:new-project'")
    expect(rendererSource).toContain("label: 'New project skill'")
    expect(rendererSource).toContain('startNewProjectSkillDraft()')

    expect(rendererSource).toContain("id: 'settings:skills:install-user'")
    expect(rendererSource).toContain("label: 'Install user skill'")
    expect(rendererSource).toContain('void installLocalSkill()')

    expect(rendererSource).toContain("id: 'settings:skills:install-project'")
    expect(rendererSource).toContain("label: 'Install project skill'")
    expect(rendererSource).toContain('void installProjectSkill()')

    expect(rendererSource).toContain("id: 'settings:plugins:list'")
    expect(rendererSource).toContain("label: 'List plugins'")
    expect(rendererSource).toContain('void listAvailablePlugins()')

    expect(rendererSource).toContain("id: 'settings:plugins:install'")
    expect(rendererSource).toContain("label: 'Install plugin'")
    expect(rendererSource).toContain("openPaneSection('settings', 'settings-plugins', 'settings')")
    expect(rendererSource).toContain('void installPlugin()')
  })

  it('exposes skill inspection actions directly in Settings', () => {
    expect(rendererSource).toContain('selectedSkillDetail')
    expect(rendererSource).toContain('window.claudeDesktop.skills.read(selectedSkillName)')
    expect(rendererSource).toContain('window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)')
    expect(rendererSource).toContain('<Icon name="file" />Inspect')
    expect(rendererSource).toContain('aria-label="Selected skill contents"')
  })

  it('exposes direct Skill creation and editing controls in Settings', () => {
    expect(rendererSource).toContain('skillDraft')
    expect(rendererSource).toContain('startNewUserSkillDraft()')
    expect(rendererSource).toContain('startNewProjectSkillDraft()')
    expect(rendererSource).toContain('editSkillDetail(')
    expect(rendererSource).toContain('cancelSkillDraft()')
    expect(rendererSource).toContain('async function saveSkillDraft')
    expect(rendererSource).toContain('window.claudeDesktop.skills.save({')
    expect(rendererSource).toContain('window.claudeDesktop.workspaceSkills.save(session.cwd, {')
    expect(rendererSource).toContain('<Icon name="plus" />New user skill')
    expect(rendererSource).toContain('<Icon name="plus" />New project skill')
    expect(rendererSource).toContain('<Icon name="edit" />Edit')
    expect(rendererSource).toContain('<Icon name="save" />Save skill')
    expect(rendererSource).toContain('disabled={!skillDraft || !!loadingLabel || !canSaveSkill}')
  })

  it('keeps selected project skill detail editing disabled without an active session', () => {
    const detailStart = rendererSource.indexOf('{selectedSkillDetail && (() => {')
    const detailEnd = rendererSource.indexOf('<pre>{selectedSkillDetail.contents ?? \'\'}</pre>', detailStart)
    const detailBody = rendererSource.slice(detailStart, detailEnd)

    expect(rendererSource).toContain("const [selectedSkillDetailScope, setSelectedSkillDetailScope] = useState<'user' | 'project'>()")
    expect(detailBody).toContain("const selectedSkillDetailProjectScoped = selectedSkillDetailScope === 'project'")
    expect(rendererSource).toContain('function handleSelectedSkillDetailEditClick(): void')
    expect(rendererSource).toContain('function handleSelectedSkillDetailRemoveClick(): void')
    expect(detailBody).toContain('onClick={handleSelectedSkillDetailEditClick}')
    expect(detailBody).toContain('onClick={handleSelectedSkillDetailRemoveClick}')
    expect(detailBody).toContain('disabled={!!loadingLabel || (selectedSkillDetailProjectScoped && !activeSession)}')
    expect(detailBody).not.toContain('!loadingLabel && editSkillDetail(')
    expect(detailBody).not.toContain('!loadingLabel && void removeSkillDetail(')
    expect(detailBody).not.toContain('if (!loadingLabel) editSkillDetail(')
    expect(detailBody).toContain('<Icon name="trash" />Remove')
  })

  it('shows visible session guidance on disabled selected project skill details', () => {
    const detailStart = rendererSource.indexOf('{selectedSkillDetail && (')
    const detailEnd = rendererSource.indexOf('<pre>{selectedSkillDetail.contents ?? \'\'}</pre>', detailStart)
    const detailBody = rendererSource.slice(detailStart, detailEnd)

    expect(detailBody).toContain('{selectedSkillDetailProjectScoped && !activeSession && (')
    expect(detailBody).toContain('<div className="form-note">')
    expect(detailBody).toContain('Select a project session before editing this project skill.')
  })

  it('tracks selected skill detail scope for restoration, actions, and cleanup', () => {
    const restoreStart = rendererSource.indexOf('async function restoreSelectedSettingsDetails')
    const restoreEnd = rendererSource.indexOf('useEffect(() => {', restoreStart)
    const restoreBody = rendererSource.slice(restoreStart, restoreEnd)
    const inspectUserStart = rendererSource.indexOf('async function inspectUserSkill')
    const inspectUserEnd = rendererSource.indexOf('async function inspectProjectSkill', inspectUserStart)
    const inspectUserBody = rendererSource.slice(inspectUserStart, inspectUserEnd)
    const inspectProjectStart = rendererSource.indexOf('async function inspectProjectSkill')
    const inspectProjectEnd = rendererSource.indexOf('function startNewUserSkillDraft', inspectProjectStart)
    const inspectProjectBody = rendererSource.slice(inspectProjectStart, inspectProjectEnd)
    const saveStart = rendererSource.indexOf('async function saveSkillDraft')
    const saveEnd = rendererSource.indexOf('async function removeUserSkill', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const removeUserStart = rendererSource.indexOf('async function removeUserSkill')
    const removeUserEnd = rendererSource.indexOf('async function removeProjectSkill', removeUserStart)
    const removeUserBody = rendererSource.slice(removeUserStart, removeUserEnd)
    const removeProjectStart = rendererSource.indexOf('async function removeProjectSkill')
    const removeProjectEnd = rendererSource.indexOf('async function saveMcpServer', removeProjectStart)
    const removeProjectBody = rendererSource.slice(removeProjectStart, removeProjectEnd)
    const activeStart = rendererSource.indexOf('if (!activeSession) {')
    const activeEnd = rendererSource.indexOf('void runAction(\'Refreshing workspace\'', activeStart)
    const activeBody = rendererSource.slice(activeStart, activeEnd)

    expect(restoreBody).toContain("const detailScope = restoredSkillScope ?? (userSkill ? 'user' : projectSkill ? 'project' : undefined)")
    expect(restoreBody).toContain('setSelectedSkillDetailScope(detailScope)')
    expect(inspectUserBody).toContain("setSelectedSkillDetailScope('user')")
    expect(inspectProjectBody).toContain("setSelectedSkillDetailScope('project')")
    expect(saveBody).toContain('setSelectedSkillDetailScope(scope)')
    expect(removeUserBody).toContain("selectedSkillDetailScope === 'user'")
    expect(removeProjectBody).toContain("selectedSkillDetailScope === 'project'")
    expect(removeUserBody).toContain('setSelectedSkillDetailScope(undefined)')
    expect(removeProjectBody).toContain('setSelectedSkillDetailScope(undefined)')
    expect(activeBody).toContain('setSelectedSkillDetailScope(undefined)')
  })

  it('clears persisted selected skill detail when starting a new skill draft', () => {
    const newUserStart = rendererSource.indexOf('function startNewUserSkillDraft(): void')
    const newUserEnd = rendererSource.indexOf('function startNewProjectSkillDraft', newUserStart)
    const newUserBody = rendererSource.slice(newUserStart, newUserEnd)
    const newProjectStart = rendererSource.indexOf('function startNewProjectSkillDraft(): void')
    const newProjectEnd = rendererSource.indexOf('function editSkillDetail', newProjectStart)
    const newProjectBody = rendererSource.slice(newProjectStart, newProjectEnd)

    for (const body of [newUserBody, newProjectBody]) {
      expect(body).toContain('setSelectedSkillDetail(undefined)')
      expect(body).toContain('setSelectedSkillDetailScope(undefined)')
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('if (session) void updateSessionLayout(session.id, {')
      expect(body).toContain('selectedSkillName: undefined')
      expect(body).toContain('selectedSkillPath: undefined')
      expect(body).toContain('selectedSkillScope: undefined')
      expect(body).not.toContain('void updateLayout({')
      expect(body.indexOf('setSelectedSkillDetailScope(undefined)')).toBeLessThan(
        body.indexOf('if (session) void updateSessionLayout(session.id, {'),
      )
    }
  })

  it('shows structured empty state when a selected skill has no description', () => {
    const detailStart = rendererSource.indexOf('{selectedSkillDetail && (')
    const detailEnd = rendererSource.indexOf('<div className="mini-list">', detailStart)
    const detailBody = rendererSource.slice(detailStart, detailEnd)
    const styleStart = stylesSource.indexOf('.skill-description-empty')
    const styleEnd = stylesSource.indexOf('.task-empty-state', styleStart)
    const styleBody = stylesSource.slice(styleStart, styleEnd)

    expect(detailBody).toContain('selectedSkillDetail.description ? (')
    expect(detailBody).toContain('<p className="section-copy">{selectedSkillDetail.description}</p>')
    expect(detailBody).toContain('skill-description-empty')
    expect(detailBody).toContain('<Icon name="bot" />')
    expect(detailBody).toContain('<strong>No skill description</strong>')
    expect(detailBody).toContain('<span>Add a description in SKILL.md to document when this skill should be used.</span>')
    expect(detailBody).not.toContain('No description declared.')
    expect(styleBody).toContain('.skill-description-empty')
    expect(styleBody).toContain('min-height: 88px')
  })

  it('exposes MCP inspection actions directly in Settings', () => {
    expect(rendererSource).toContain('selectedMcpDetail')
    expect(rendererSource).toContain("window.claudeDesktop.mcp.read(selectedMcpName)")
    expect(rendererSource).toContain("window.claudeDesktop.workspaceMcp.read(session.cwd, selectedMcpName)")
    expect(rendererSource).toContain('<Icon name="file" />Inspect')
    expect(rendererSource).toContain('aria-label="Selected MCP server details"')
  })

  it('exposes direct MCP detail management controls in Settings', () => {
    const detailStart = rendererSource.indexOf('{selectedMcpDetail && (() => {')
    const detailEnd = rendererSource.indexOf('<pre>{rawSummary(selectedMcpDetail.raw ?? selectedMcpDetail)}</pre>', detailStart)
    const detailBody = rendererSource.slice(detailStart, detailEnd)

    expect(detailBody).toContain("const selectedMcpDetailProjectScoped = selectedMcpDetailScope === 'project'")
    expect(detailBody).toContain('Select a project session before managing this project MCP server.')
    expect(rendererSource).toContain('function handleSelectedMcpDetailEditClick(): void')
    expect(detailBody).toContain('onClick={handleSelectedMcpDetailEditClick}')
    expect(rendererSource).toContain('function handleSelectedMcpDetailApprovalClick(approved: boolean): void')
    expect(detailBody).toContain('onClick={() => handleSelectedMcpDetailApprovalClick(true)}')
    expect(detailBody).toContain('onClick={() => handleSelectedMcpDetailApprovalClick(false)}')
    expect(detailBody).not.toContain('onClick={() => setSelectedMcpDetailApproval(true)}')
    expect(detailBody).not.toContain('onClick={() => setSelectedMcpDetailApproval(false)}')
    expect(rendererSource).toContain('function handleSelectedMcpDetailRemoveClick(): void')
    expect(detailBody).toContain('onClick={handleSelectedMcpDetailRemoveClick}')
    expect(detailBody).not.toContain("editMcpServer(selectedMcpDetail, selectedMcpDetailProjectScoped ? 'project' : 'user')")
    expect(detailBody).not.toContain("removeMcpServer(selectedMcpDetail.name, selectedMcpDetailProjectScoped ? 'project' : 'user')")
    expect(detailBody).toContain('disabled={!!loadingLabel || (selectedMcpDetailProjectScoped && !activeSession)}')
    expect(detailBody).toContain("disabled={!!loadingLabel || !selectedMcpDetailProjectScoped || !activeSession || selectedMcpDetail.approvalStatus === 'approved'}")
    expect(detailBody).toContain("disabled={!!loadingLabel || !selectedMcpDetailProjectScoped || !activeSession || selectedMcpDetail.approvalStatus === 'rejected'}")
    expect(detailBody).toContain('disabled={!!loadingLabel || (selectedMcpDetailProjectScoped && !activeSession)}')
    expect(detailBody).toContain('<Icon name="trash" />Remove')
  })

  it('renders empty MCP health output as structured Settings feedback', () => {
    const stateStart = rendererSource.indexOf('type McpHealthOutputState')
    const stateEnd = rendererSource.indexOf('type PluginOutputState', stateStart)
    const stateBody = rendererSource.slice(stateStart, stateEnd)
    const healthStart = rendererSource.indexOf('async function checkMcpHealth')
    const healthEnd = rendererSource.indexOf('function pluginCommandCwd', healthStart)
    const healthBody = rendererSource.slice(healthStart, healthEnd)
    const mcpSectionStart = rendererSource.indexOf('<section className="settings-section" id="settings-mcp">')
    const mcpOutputStart = rendererSource.indexOf('{mcpHealthOutput ? (', mcpSectionStart)
    const mcpOutputEnd = rendererSource.indexOf('<div id="mcp-server-listbox"', mcpOutputStart)
    const mcpOutputBody = rendererSource.slice(mcpOutputStart, mcpOutputEnd)
    const styleStart = stylesSource.indexOf('.mcp-health-empty')
    const styleEnd = stylesSource.indexOf('.plugin-output-empty', styleStart)
    const styleBody = stylesSource.slice(styleStart, styleEnd)

    expect(stateBody).toContain('type McpHealthOutputState = {')
    expect(rendererSource).toContain('const [mcpHealthOutput, setMcpHealthOutput] = useState<McpHealthOutputState | null>(null)')
    expect(healthBody).toContain('setMcpHealthOutput({')
    expect(healthBody).toContain('ok: result.ok,')
    expect(healthBody).toContain('text: result.output || result.error || \'\',')
    expect(mcpOutputBody).toContain('mcpHealthOutput.text.trim() ? (')
    expect(mcpOutputBody).toContain('<pre>{`${mcpHealthOutput.ok ? \'OK\' : \'FAILED\'}\\n${mcpHealthOutput.text}`}</pre>')
    expect(mcpOutputBody).toContain('mcp-health-empty')
    expect(mcpOutputBody).toContain('<Icon name="settings" />')
    expect(mcpOutputBody).toContain('<strong>{mcpHealthOutput.ok ? \'MCP health check completed\' : \'MCP health check failed\'}</strong>')
    expect(mcpOutputBody).toContain('<span>{mcpHealthOutput.ok ? \'The MCP health check completed without output.\' : \'The MCP health check failed without output.\'}</span>')
    expect(mcpOutputBody).not.toContain('No output')
    expect(styleBody).toContain('.mcp-health-empty')
    expect(styleBody).toContain('min-height: 96px')
  })

  it('persists and restores selected MCP and Skill details in session layout', () => {
    expect(rendererSource).toContain('activeSession?.layout.selectedMcpName')
    expect(rendererSource).toContain('activeSession?.layout.selectedMcpSourcePath')
    expect(rendererSource).toContain('activeSession?.layout.selectedMcpScope')
    expect(rendererSource).toContain('activeSession?.layout.selectedSkillName')
    expect(rendererSource).toContain('activeSession?.layout.selectedSkillPath')
    expect(rendererSource).toContain('activeSession?.layout.selectedSkillScope')
    expect(rendererSource).toContain('selectedMcpName: detail.name')
    expect(rendererSource).toContain('selectedMcpSourcePath: detail.sourcePath')
    expect(rendererSource).toContain("selectedMcpScope: 'user'")
    expect(rendererSource).toContain("selectedMcpScope: 'project'")
    expect(rendererSource).toContain('selectedSkillName: detail.name')
    expect(rendererSource).toContain('selectedSkillPath: detail.path')
    expect(rendererSource).toContain("selectedSkillScope: 'user'")
    expect(rendererSource).toContain("selectedSkillScope: 'project'")
    expect(rendererSource).toContain('restoreSelectedSettingsDetails')
    expect(rendererSource).toContain('setSelectedMcpDetail(undefined)')
    expect(rendererSource).toContain('setSelectedSkillDetail(undefined)')
    expect(rendererSource).toContain('selectedMcpScope: undefined')
    expect(rendererSource).toContain('selectedSkillScope: undefined')
  })

  it('clears stale selected MCP and Skill details when restored Settings rows disappear', () => {
    const restoreStart = rendererSource.indexOf('async function restoreSelectedSettingsDetails')
    const restoreEnd = rendererSource.indexOf('useEffect(() => {', restoreStart)
    const restoreBody = rendererSource.slice(restoreStart, restoreEnd)

    expect(restoreBody).toContain('const selectedMcpDetailMatchesRestored = Boolean(')
    expect(restoreBody).toContain('if (!userMcp && !projectMcp) {')
    expect(restoreBody).toContain('setSelectedMcpDetail(undefined)')
    expect(restoreBody).toContain('setSelectedMcpDetailScope(undefined)')
    expect(restoreBody).toContain('await updateSessionLayout(session.id, {')
    expect(restoreBody).toContain('selectedMcpName: undefined')
    expect(restoreBody).toContain('selectedMcpSourcePath: undefined')
    expect(restoreBody).toContain('selectedMcpScope: undefined')

    expect(restoreBody).toContain('const selectedSkillDetailMatchesRestored = Boolean(')
    expect(restoreBody).toContain('if (!userSkill && !projectSkill) {')
    expect(restoreBody).toContain('setSelectedSkillDetail(undefined)')
    expect(restoreBody).toContain('setSelectedSkillDetailScope(undefined)')
    expect(restoreBody).toContain('selectedSkillName: undefined')
    expect(restoreBody).toContain('selectedSkillPath: undefined')
    expect(restoreBody).toContain('selectedSkillScope: undefined')
    expect(restoreBody.indexOf('if (!userMcp && !projectMcp) {')).toBeLessThan(
      restoreBody.indexOf('try {'),
    )
    expect(restoreBody.indexOf('if (!userSkill && !projectSkill) {')).toBeLessThan(
      restoreBody.lastIndexOf('try {'),
    )
  })

  it('clears persisted selected MCP detail when starting a new MCP draft', () => {
    const start = rendererSource.indexOf('function startNewMcpDraft(): void')
    const end = rendererSource.indexOf('async function checkMcpHealth', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('setMcpDraft(emptyMcpDraft())')
    expect(body).toContain('setSelectedMcpDetail(undefined)')
    expect(body).toContain('setSelectedMcpDetailScope(undefined)')
    expect(body).toContain('const session = activeSession')
    expect(body).toContain('if (session) void updateSessionLayout(session.id, {')
    expect(body).toContain('selectedMcpName: undefined')
    expect(body).toContain('selectedMcpSourcePath: undefined')
    expect(body).toContain('selectedMcpScope: undefined')
    expect(body).not.toContain('void updateLayout({')
    expect(body.indexOf('setSelectedMcpDetailScope(undefined)')).toBeLessThan(
      body.indexOf('if (session) void updateSessionLayout(session.id, {'),
    )
  })

  it('normalizes restored MCP and Skill detail identity before matching rows and IPC', () => {
    const restoreStart = rendererSource.indexOf('async function restoreSelectedSettingsDetails')
    const restoreEnd = rendererSource.indexOf('useEffect(() => {', restoreStart)
    const restoreBody = rendererSource.slice(restoreStart, restoreEnd)
    const mcpActiveStart = rendererSource.indexOf('function isMcpServerItemActive')
    const mcpActiveEnd = rendererSource.indexOf('function mcpServerOptionId', mcpActiveStart)
    const mcpActiveBody = rendererSource.slice(mcpActiveStart, mcpActiveEnd)
    const skillActiveStart = rendererSource.indexOf('function isSkillItemActive')
    const skillActiveEnd = rendererSource.indexOf('function skillOptionId', skillActiveStart)
    const skillActiveBody = rendererSource.slice(skillActiveStart, skillActiveEnd)

    expect(restoreBody).toContain('const restoredMcpName = selectedMcpName?.trim()')
    expect(restoreBody).toContain("const restoredMcpScope = selectedMcpScope === 'user' || selectedMcpScope === 'project'")
    expect(restoreBody).toContain('const restoredSkillName = selectedSkillName?.trim()')
    expect(restoreBody).toContain("const restoredSkillScope = selectedSkillScope === 'user' || selectedSkillScope === 'project'")
    expect(restoreBody).toContain('selectedMcpDetail?.name.trim() === restoredMcpName')
    expect(restoreBody).toContain('selectedMcpDetailScope === restoredMcpScope')
    expect(restoreBody).toContain('server.name.trim() === restoredMcpName')
    expect(restoreBody).toContain("restoredMcpScope === 'user'")
    expect(restoreBody).toContain("restoredMcpScope === 'project'")
    expect(restoreBody).toContain("restoredMcpScope === 'user' && userMcp")
    expect(restoreBody).toContain("restoredMcpScope === 'project' && projectMcp")
    expect(restoreBody).toContain('setSelectedMcpDetailScope(detailScope)')
    expect(restoreBody).toContain('selectedSkillDetail?.name.trim() === restoredSkillName')
    expect(restoreBody).toContain('selectedSkillDetailScope === restoredSkillScope')
    expect(restoreBody).toContain('skill.name.trim() === restoredSkillName')
    expect(restoreBody).toContain("restoredSkillScope === 'user'")
    expect(restoreBody).toContain("restoredSkillScope === 'project'")
    expect(restoreBody).toContain("restoredSkillScope === 'user' && userSkill")
    expect(restoreBody).toContain("restoredSkillScope === 'project' && projectSkill")
    expect(restoreBody).toContain('setSelectedSkillDetailScope(detailScope)')

    expect(mcpActiveBody).toContain('const serverName = server.name.trim()')
    expect(mcpActiveBody).toContain('mcpDraft.editingName?.trim() === serverName')
    expect(mcpActiveBody).toContain('selectedMcpDetail?.name.trim() === serverName')
    expect(skillActiveBody).toContain('const skillName = skill.name.trim()')
    expect(skillActiveBody).toContain('selectedSkillDetail?.name.trim() === skillName')
  })

  it('records restored selected Settings detail identity in electron smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const fixtureStart = smokeSource.indexOf('const settingsRestoreSessionId = await page.evaluate')
    const fixtureEnd = smokeSource.indexOf('await page.evaluate(async () => {', fixtureStart)
    const fixtureBody = smokeSource.slice(fixtureStart, fixtureEnd)
    const restoreStart = smokeSource.indexOf('const settingsRestoreState = await restoredPage.evaluate')
    const restoreEnd = smokeSource.indexOf('await focusSmokeSessionDirect(restoredPage, tasksRestoreSessionId)', restoreStart)
    const restoreBody = smokeSource.slice(restoreStart, restoreEnd)

    expect(fixtureBody).toContain("selectedMcpName: 'playwright'")
    expect(fixtureBody).toContain('selectedMcpSourcePath: mcpSourcePath')
    expect(fixtureBody).toContain("selectedMcpScope: 'project'")
    expect(fixtureBody).toContain("selectedSkillName: 'existing-skill'")
    expect(fixtureBody).toContain('selectedSkillPath: skillPath')
    expect(fixtureBody).toContain("selectedSkillScope: 'project'")
    expect(restoreBody).toContain('selectedMcpName: session?.layout.selectedMcpName')
    expect(restoreBody).toContain('selectedMcpScope: session?.layout.selectedMcpScope')
    expect(restoreBody).toContain('selectedSkillName: session?.layout.selectedSkillName')
    expect(restoreBody).toContain('selectedSkillScope: session?.layout.selectedSkillScope')
    expect(restoreBody).toContain('mcpDetailRestored')
    expect(restoreBody).toContain('skillDetailRestored')
    expect(smokeSource).toContain('selectedSettingsDetailStateRestored: true')
  })

  it('exposes MCP and Skills management rows as selectable options', () => {
    const mcpListStart = rendererSource.indexOf('id="mcp-server-listbox"')
    const mcpListEnd = rendererSource.indexOf('{desktopConfig?.mcpServers.length ? desktopConfig.mcpServers.map', mcpListStart)
    const mcpListBody = rendererSource.slice(mcpListStart, mcpListEnd)
    const userMcpStart = rendererSource.indexOf('key={`user-${serverName}`}', mcpListEnd)
    const userMcpEnd = rendererSource.indexOf('<strong>{server.name}</strong>', userMcpStart)
    const userMcpBody = rendererSource.slice(userMcpStart, userMcpEnd)
    const projectMcpStart = rendererSource.indexOf('key={`project-${serverName}`}', userMcpEnd)
    const projectMcpEnd = rendererSource.indexOf('<strong>{server.name}</strong>', projectMcpStart)
    const projectMcpBody = rendererSource.slice(projectMcpStart, projectMcpEnd)
    const skillsListStart = rendererSource.indexOf('id="skill-listbox"')
    const skillsListEnd = rendererSource.indexOf('{desktopConfig?.skills.length ? desktopConfig.skills.map', skillsListStart)
    const skillsListBody = rendererSource.slice(skillsListStart, skillsListEnd)
    const userSkillStart = rendererSource.indexOf('key={`user-${skillPath}`}', skillsListEnd)
    const userSkillEnd = rendererSource.indexOf('<strong>{skill.name}</strong>', userSkillStart)
    const userSkillBody = rendererSource.slice(userSkillStart, userSkillEnd)
    const projectSkillStart = rendererSource.indexOf('key={`project-${skillPath}`}', userSkillEnd)
    const projectSkillEnd = rendererSource.indexOf('<strong>{skill.name}</strong>', projectSkillStart)
    const projectSkillBody = rendererSource.slice(projectSkillStart, projectSkillEnd)

    expect(mcpListBody).toContain('id="mcp-server-listbox"')
    expect(mcpListBody).toContain('role="listbox"')
    expect(mcpListBody).toContain('aria-label="MCP servers"')
    expect(mcpListBody).toContain('aria-activedescendant={activeMcpServerOptionId()}')
    expect(userMcpBody).toContain("id={mcpServerOptionId(server, 'user')}")
    expect(userMcpBody).toContain('role="option"')
    expect(userMcpBody).toContain("aria-selected={isMcpServerItemActive(server, 'user')}")
    expect(projectMcpBody).toContain("id={mcpServerOptionId(server, 'project')}")
    expect(projectMcpBody).toContain('role="option"')
    expect(projectMcpBody).toContain("aria-selected={isMcpServerItemActive(server, 'project')}")
    expect(skillsListBody).toContain('id="skill-listbox"')
    expect(skillsListBody).toContain('role="listbox"')
    expect(skillsListBody).toContain('aria-label="Skills"')
    expect(skillsListBody).toContain('aria-activedescendant={activeSkillOptionId()}')
    expect(userSkillBody).toContain("id={skillOptionId(skill, 'user')}")
    expect(userSkillBody).toContain('role="option"')
    expect(userSkillBody).toContain('aria-selected={isSkillItemActive(skill)}')
    expect(projectSkillBody).toContain("id={skillOptionId(skill, 'project')}")
    expect(projectSkillBody).toContain('role="option"')
    expect(projectSkillBody).toContain('aria-selected={isSkillItemActive(skill)}')
  })

  it('normalizes MCP and Skill option ids and render keys with canonical settings identities', () => {
    const mcpOptionStart = rendererSource.indexOf('function mcpServerOptionId')
    const mcpOptionEnd = rendererSource.indexOf('function isSkillItemActive', mcpOptionStart)
    const mcpOptionBody = rendererSource.slice(mcpOptionStart, mcpOptionEnd)
    const skillOptionStart = rendererSource.indexOf('function skillOptionId')
    const skillOptionEnd = rendererSource.indexOf('function isPluginItemActive', skillOptionStart)
    const skillOptionBody = rendererSource.slice(skillOptionStart, skillOptionEnd)
    const userMcpStart = rendererSource.indexOf('{desktopConfig?.mcpServers.length ? desktopConfig.mcpServers.map')
    const userMcpEnd = rendererSource.indexOf('<strong>{server.name}</strong>', userMcpStart)
    const userMcpBody = rendererSource.slice(userMcpStart, userMcpEnd)
    const projectMcpStart = rendererSource.indexOf('{projectMcpServers.length ? projectMcpServers.map')
    const projectMcpEnd = rendererSource.indexOf('<strong>{server.name}</strong>', projectMcpStart)
    const projectMcpBody = rendererSource.slice(projectMcpStart, projectMcpEnd)
    const userSkillStart = rendererSource.indexOf('{desktopConfig?.skills.length ? desktopConfig.skills.map')
    const userSkillEnd = rendererSource.indexOf('<strong>{skill.name}</strong>', userSkillStart)
    const userSkillBody = rendererSource.slice(userSkillStart, userSkillEnd)
    const projectSkillStart = rendererSource.indexOf('{projectSkills.length ? projectSkills.map')
    const projectSkillEnd = rendererSource.indexOf('<strong>{skill.name}</strong>', projectSkillStart)
    const projectSkillBody = rendererSource.slice(projectSkillStart, projectSkillEnd)

    expect(mcpOptionBody).toContain('const serverName = server.name.trim()')
    expect(mcpOptionBody).toContain('optionIdSegment(serverName)')
    expect(skillOptionBody).toContain('const skillName = skill.name.trim()')
    expect(skillOptionBody).toContain('const skillPath = skill.path.trim()')
    expect(skillOptionBody).toContain('optionIdSegment(skillPath)')
    expect(skillOptionBody).toContain('optionIdSegment(skillName)')
    expect(userMcpBody).toContain('const serverName = server.name.trim()')
    expect(userMcpBody).toContain('key={`user-${serverName}`}')
    expect(projectMcpBody).toContain('const serverName = server.name.trim()')
    expect(projectMcpBody).toContain('key={`project-${serverName}`}')
    expect(userSkillBody).toContain('const skillPath = skill.path.trim()')
    expect(userSkillBody).toContain('key={`user-${skillPath}`}')
    expect(projectSkillBody).toContain('const skillPath = skill.path.trim()')
    expect(projectSkillBody).toContain('key={`project-${skillPath}`}')
  })

  it('exposes installed plugin rows as selectable options', () => {
    const pluginListStart = rendererSource.indexOf('id="plugin-listbox"')
    const pluginListEnd = rendererSource.indexOf('{desktopConfig?.plugins.length ? desktopConfig.plugins.map', pluginListStart)
    const pluginListBody = rendererSource.slice(pluginListStart, pluginListEnd)
    const pluginItemStart = rendererSource.indexOf('key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? \'\'}`}', pluginListEnd)
    const pluginItemEnd = rendererSource.indexOf('<strong>{plugin.id}</strong>', pluginItemStart)
    const pluginItemBody = rendererSource.slice(pluginItemStart, pluginItemEnd)

    expect(pluginListBody).toContain('id="plugin-listbox"')
    expect(pluginListBody).toContain('role="listbox"')
    expect(pluginListBody).toContain('aria-label="Installed plugins"')
    expect(pluginListBody).toContain('aria-activedescendant={activePluginOptionId()}')
    expect(pluginItemBody).toContain('id={pluginOptionId(plugin)}')
    expect(pluginItemBody).toContain('role="option"')
    expect(pluginItemBody).toContain('aria-selected={isPluginItemActive(plugin)}')
  })

  it('selects installed plugin rows into the plugin form', () => {
    const helperStart = rendererSource.indexOf('function selectPlugin')
    const helperEnd = rendererSource.indexOf('function openSettingsNavItem', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const itemStart = rendererSource.indexOf('key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? \'\'}`}')
    const itemEnd = rendererSource.indexOf('<strong>{plugin.id}</strong>', itemStart)
    const itemBody = rendererSource.slice(itemStart, itemEnd)

    expect(helperBody).toContain('function selectPlugin(plugin: NonNullable<ClaudeDesktopConfig[\'plugins\']>[number]): void')
    expect(helperBody).toContain('setPluginDraft({')
    expect(helperBody).toContain('plugin: pluginId')
    expect(helperBody).toContain("scope: plugin.scope === 'project'")
    expect(helperBody).toContain("setSettingsStatus({ kind: 'info', text: `Selected plugin ${pluginId}.` })")
    expect(rendererSource).toContain("function handlePluginRowClick(plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): void")
    expect(itemBody).toContain('onClick={() => handlePluginRowClick(plugin)}')
    expect(itemBody).not.toContain('onClick={() => canSelectPlugin(plugin) && selectPlugin(plugin)}')
  })

  it('normalizes installed plugin row targets before active comparison, draft writes, and feedback', () => {
    const activeStart = rendererSource.indexOf('function isPluginItemActive')
    const activeEnd = rendererSource.indexOf('function pluginOptionId', activeStart)
    const activeBody = rendererSource.slice(activeStart, activeEnd)
    const selectStart = rendererSource.indexOf('function selectPlugin')
    const selectEnd = rendererSource.indexOf('function openSettingsNavItem', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)

    expect(activeBody).toContain('const pluginId = plugin.id.trim()')
    expect(activeBody).toContain('pluginDraft.plugin.trim() === pluginId')
    expect(selectBody).toContain('const pluginId = plugin.id.trim()')
    expect(selectBody).toContain('if (!pluginId) {')
    expect(selectBody).toContain('plugin: pluginId')
    expect(selectBody).toContain('text: `Selected plugin ${pluginId}.`')
  })

  it('matches installed plugin active rows by package and scope', () => {
    const activeStart = rendererSource.indexOf('function isPluginItemActive')
    const activeEnd = rendererSource.indexOf('function pluginOptionId', activeStart)
    const activeBody = rendererSource.slice(activeStart, activeEnd)

    expect(activeBody).toContain('const pluginScope = plugin.scope === \'project\'')
    expect(activeBody).toContain('? \'project\'')
    expect(activeBody).toContain(": plugin.scope === 'local'")
    expect(activeBody).toContain("? 'local'")
    expect(activeBody).toContain(": 'user'")
    expect(activeBody).toContain('pluginDraft.plugin.trim() === pluginId &&')
    expect(activeBody).toContain('pluginDraft.scope === pluginScope &&')
    expect(activeBody).toContain('selectedPluginIdentity === installedPluginIdentity(plugin)')
  })

  it('normalizes installed plugin option ids and render keys with the canonical plugin id', () => {
    const optionStart = rendererSource.indexOf('function pluginOptionId')
    const optionEnd = rendererSource.indexOf('function canSelectPlugin', optionStart)
    const optionBody = rendererSource.slice(optionStart, optionEnd)
    const pluginItemStart = rendererSource.indexOf('{desktopConfig?.plugins.length ? desktopConfig.plugins.map')
    const pluginItemEnd = rendererSource.indexOf('<strong>{plugin.id}</strong>', pluginItemStart)
    const pluginItemBody = rendererSource.slice(pluginItemStart, pluginItemEnd)

    expect(optionBody).toContain('const pluginId = plugin.id.trim()')
    expect(optionBody).toContain('optionIdSegment(pluginId)')
    expect(pluginItemBody).toContain('const pluginId = plugin.id.trim()')
    expect(pluginItemBody).toContain("key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? ''}`}")
  })

  it('scopes installed plugin option ids and render keys', () => {
    const optionStart = rendererSource.indexOf('function pluginOptionId')
    const optionEnd = rendererSource.indexOf('function canSelectPlugin', optionStart)
    const optionBody = rendererSource.slice(optionStart, optionEnd)
    const pluginItemStart = rendererSource.indexOf('{desktopConfig?.plugins.length ? desktopConfig.plugins.map')
    const pluginItemEnd = rendererSource.indexOf('<strong>{plugin.id}</strong>', pluginItemStart)
    const pluginItemBody = rendererSource.slice(pluginItemStart, pluginItemEnd)

    expect(optionBody).toContain('const pluginScope = plugin.scope === \'project\'')
    expect(optionBody).toContain('optionIdSegment(pluginScope)')
    expect(optionBody).toContain('optionIdSegment(pluginId)')
    expect(pluginItemBody).toContain('const pluginScope = plugin.scope === \'project\'')
    expect(pluginItemBody).toContain("key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? ''}`}")
  })

  it('matches installed plugin active rows by full installed identity', () => {
    const stateStart = rendererSource.indexOf('const [pluginDraft, setPluginDraft]')
    const stateEnd = rendererSource.indexOf('const [mcpHealthOutput', stateStart)
    const stateBody = rendererSource.slice(stateStart, stateEnd)
    const activeStart = rendererSource.indexOf('function isPluginItemActive')
    const activeEnd = rendererSource.indexOf('function pluginOptionId', activeStart)
    const activeBody = rendererSource.slice(activeStart, activeEnd)
    const selectStart = rendererSource.indexOf('function selectPlugin')
    const selectEnd = rendererSource.indexOf('function openSettingsNavItem', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const packageHandlerStart = rendererSource.indexOf('function handlePluginDraftPackageChange')
    const packageHandlerEnd = rendererSource.indexOf('function handlePluginDraftScopeChange', packageHandlerStart)
    const packageHandlerBody = rendererSource.slice(packageHandlerStart, packageHandlerEnd)
    const scopeHandlerStart = rendererSource.indexOf('function handlePluginDraftScopeChange')
    const scopeHandlerEnd = rendererSource.indexOf('function handlePluginUpdateClick', scopeHandlerStart)
    const scopeHandlerBody = rendererSource.slice(scopeHandlerStart, scopeHandlerEnd)

    expect(stateBody).toContain('const [selectedPluginIdentity, setSelectedPluginIdentity] = useState<string | undefined>()')
    expect(rendererSource).toContain('function installedPluginIdentity(plugin: NonNullable<ClaudeDesktopConfig[\'plugins\']>[number]): string')
    expect(activeBody).toContain('selectedPluginIdentity === installedPluginIdentity(plugin)')
    expect(selectBody).toContain('const selectedPluginIdentity = installedPluginIdentity(plugin)')
    expect(selectBody).toContain('setSelectedPluginIdentity(selectedPluginIdentity)')
    expect(selectBody).toContain('const session = activeSession')
    expect(selectBody).toContain('if (session) void updateSessionLayout(session.id, { selectedPluginIdentity })')
    expect(selectBody).not.toContain('void updateLayout({')
    expect(packageHandlerBody).toContain('setSelectedPluginIdentity(undefined)')
    expect(packageHandlerBody).toContain('const session = activeSession')
    expect(packageHandlerBody).toContain('if (session) void updateSessionLayout(session.id, { selectedPluginIdentity: undefined })')
    expect(packageHandlerBody).not.toContain('void updateLayout({')
    expect(scopeHandlerBody).toContain('setSelectedPluginIdentity(undefined)')
    expect(scopeHandlerBody).toContain('const session = activeSession')
    expect(scopeHandlerBody).toContain('if (session) void updateSessionLayout(session.id, { selectedPluginIdentity: undefined })')
    expect(scopeHandlerBody).not.toContain('void updateLayout({')
  })

  it('blocks installed plugin row selection when the row cannot be selected', () => {
    const helperStart = rendererSource.indexOf('function selectPlugin')
    const helperEnd = rendererSource.indexOf('function openSettingsNavItem', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)

    expect(helperBody).toContain('if (!canSelectPlugin(plugin)) return')
    expect(helperBody.indexOf('if (!canSelectPlugin(plugin)) return')).toBeLessThan(
      helperBody.indexOf('setPluginDraft({'),
    )
  })

  it('exposes direct installed plugin uninstall actions', () => {
    const helperStart = rendererSource.indexOf('async function uninstallPlugin')
    const helperEnd = rendererSource.indexOf('async function listAvailablePlugins', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const pluginItemStart = rendererSource.indexOf('key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? \'\'}`}')
    const pluginItemEnd = rendererSource.indexOf('</article>', pluginItemStart)
    const pluginItemBody = rendererSource.slice(pluginItemStart, pluginItemEnd)

    expect(helperBody).toContain('async function uninstallPlugin(plugin: NonNullable<ClaudeDesktopConfig[\'plugins\']>[number]): Promise<void>')
    expect(helperBody).toContain('if (!canSelectPlugin(plugin)) {')
    expect(helperBody).toContain('const pluginId = plugin.id.trim()')
    expect(helperBody).toContain('const scope = plugin.scope === \'project\'')
    expect(helperBody.indexOf('const scope = plugin.scope === \'project\'')).toBeLessThan(
      helperBody.indexOf('if (!canSelectPlugin(plugin)) {'),
    )
    expect(helperBody).toContain('const session = activeSession')
    expect(helperBody).toContain('const cwd = pluginCommandCwd(scope, session)')
    expect(helperBody).toContain('await requestConfirmation({')
    expect(helperBody).toContain('confirmLabel: \'Remove plugin\'')
    expect(helperBody).toContain('await window.claudeDesktop.plugins.uninstall(cwd, {')
    expect(helperBody).toContain('plugin: pluginId,')
    expect(helperBody).toContain('scope,')
    expect(helperBody).toContain('await refreshDesktopConfig()')
    expect(helperBody).toContain('setSelectedPluginIdentity(current =>')
    expect(helperBody).toContain('if (session) await updateSessionLayout(session.id, { selectedPluginIdentity: undefined })')
    expect(helperBody).not.toContain('await updateLayout({ selectedPluginIdentity: undefined })')
    expect(helperBody.indexOf('setSelectedPluginIdentity(current =>')).toBeLessThan(
      helperBody.indexOf('if (session) await updateSessionLayout(session.id, { selectedPluginIdentity: undefined })'),
    )
    expect(helperBody.indexOf('if (session) await updateSessionLayout(session.id, { selectedPluginIdentity: undefined })')).toBeLessThan(
      helperBody.indexOf('await refreshDesktopConfig()'),
    )
    expect(pluginItemBody).toContain('onClick={event => handlePluginUninstallClick(event, plugin)}')
    expect(pluginItemBody).not.toContain('if (!loadingLabel) void uninstallPlugin(plugin)')
    expect(pluginItemBody).toContain('disabled={!canSelectPlugin(plugin) || !!loadingLabel}')
    expect(pluginItemBody).toContain('<Icon name="trash" />Remove')
  })

  it('exposes direct installed plugin enable and disable actions', () => {
    const helperStart = rendererSource.indexOf('async function setPluginEnabled')
    const helperEnd = rendererSource.indexOf('async function uninstallPlugin', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const pluginItemStart = rendererSource.indexOf('key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? \'\'}`}')
    const pluginItemEnd = rendererSource.indexOf('</article>', pluginItemStart)
    const pluginItemBody = rendererSource.slice(pluginItemStart, pluginItemEnd)

    expect(helperBody).toContain('async function setPluginEnabled(plugin: NonNullable<ClaudeDesktopConfig[\'plugins\']>[number], enabled: boolean): Promise<void>')
    expect(helperBody).toContain('if (!canSelectPlugin(plugin)) {')
    expect(helperBody).toContain('const pluginId = plugin.id.trim()')
    expect(helperBody).toContain('const scope = plugin.scope === \'project\'')
    expect(helperBody.indexOf('const scope = plugin.scope === \'project\'')).toBeLessThan(
      helperBody.indexOf('if (!canSelectPlugin(plugin)) {'),
    )
    expect(helperBody).toContain('const session = activeSession')
    expect(helperBody).toContain('const cwd = pluginCommandCwd(scope, session)')
    expect(helperBody).toContain('await window.claudeDesktop.plugins.setEnabled(cwd, {')
    expect(helperBody).toContain('plugin: pluginId,')
    expect(helperBody).toContain('enabled,')
    expect(helperBody).toContain('await refreshDesktopConfig()')
    expect(helperBody).toContain('await selectInstalledPluginAfterRefresh(pluginId, scope, session)')
    expect(helperBody.indexOf('await refreshDesktopConfig()')).toBeLessThan(
      helperBody.indexOf('await selectInstalledPluginAfterRefresh(pluginId, scope, session)'),
    )
    expect(rendererSource).toContain('const pluginEnabled = plugin.enabled !== false')
    expect(pluginItemBody).toContain('onClick={event => handlePluginToggleClick(event, plugin, !pluginEnabled)}')
    expect(pluginItemBody).toContain('disabled={!canSelectPlugin(plugin) || !!loadingLabel}')
    expect(pluginItemBody).toContain("{pluginEnabled ? <><Icon name=\"pause\" />Disable</> : <><Icon name=\"play\" />Enable</>}")
  })

  it('exposes direct installed plugin update actions', () => {
    const helperStart = rendererSource.indexOf('async function updatePlugin')
    const helperEnd = rendererSource.indexOf('async function setPluginEnabled', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const pluginItemStart = rendererSource.indexOf('key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? \'\'}`}')
    const pluginItemEnd = rendererSource.indexOf('</article>', pluginItemStart)
    const pluginItemBody = rendererSource.slice(pluginItemStart, pluginItemEnd)

    expect(helperBody).toContain('async function updatePlugin(plugin: NonNullable<ClaudeDesktopConfig[\'plugins\']>[number]): Promise<void>')
    expect(helperBody).toContain('if (!canSelectPlugin(plugin)) {')
    expect(helperBody).toContain('const pluginId = plugin.id.trim()')
    expect(helperBody).toContain('const scope = plugin.scope === \'project\'')
    expect(helperBody.indexOf('const scope = plugin.scope === \'project\'')).toBeLessThan(
      helperBody.indexOf('if (!canSelectPlugin(plugin)) {'),
    )
    expect(helperBody).toContain('const session = activeSession')
    expect(helperBody).toContain('const cwd = pluginCommandCwd(scope, session)')
    expect(helperBody).toContain('await window.claudeDesktop.plugins.update(cwd, {')
    expect(helperBody).toContain('plugin: pluginId,')
    expect(helperBody).toContain('scope,')
    expect(helperBody).toContain('await refreshDesktopConfig()')
    expect(helperBody).toContain('await selectInstalledPluginAfterRefresh(pluginId, scope, session)')
    expect(helperBody.indexOf('await refreshDesktopConfig()')).toBeLessThan(
      helperBody.indexOf('await selectInstalledPluginAfterRefresh(pluginId, scope, session)'),
    )
    expect(pluginItemBody).toContain('handlePluginUpdateClick(event, plugin)')
    expect(pluginItemBody).toContain('<Icon name="refresh" />Update')
    expect(pluginItemBody).toContain('disabled={!canSelectPlugin(plugin) || !!loadingLabel}')
  })

  it('prevents installed plugin row selection when using row actions', () => {
    const pluginItemStart = rendererSource.indexOf('key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? \'\'}`}')
    const pluginItemEnd = rendererSource.indexOf('</article>', pluginItemStart)
    const pluginItemBody = rendererSource.slice(pluginItemStart, pluginItemEnd)

    expect(pluginItemBody).toContain('onKeyDown={event => event.stopPropagation()}')
    expect(pluginItemBody).toContain('onClick={event => handlePluginUpdateClick(event, plugin)}')
    expect(pluginItemBody).toContain('onClick={event => handlePluginToggleClick(event, plugin, !pluginEnabled)}')
    expect(pluginItemBody).toContain('onClick={event => handlePluginUninstallClick(event, plugin)}')
  })

  it('routes installed plugin row actions through handlers even when selection becomes stale', () => {
    const pluginItemStart = rendererSource.indexOf('key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? \'\'}`}')
    const pluginItemEnd = rendererSource.indexOf('</article>', pluginItemStart)
    const pluginItemBody = rendererSource.slice(pluginItemStart, pluginItemEnd)
    const updateClickStart = rendererSource.indexOf('function handlePluginUpdateClick')
    const updateClickEnd = rendererSource.indexOf('function handlePluginToggleClick', updateClickStart)
    const updateClickBody = rendererSource.slice(updateClickStart, updateClickEnd)
    const toggleClickStart = rendererSource.indexOf('function handlePluginToggleClick')
    const toggleClickEnd = rendererSource.indexOf('function handlePluginUninstallClick', toggleClickStart)
    const toggleClickBody = rendererSource.slice(toggleClickStart, toggleClickEnd)
    const uninstallClickStart = rendererSource.indexOf('function handlePluginUninstallClick')
    const uninstallClickEnd = rendererSource.indexOf('function selectPlugin', uninstallClickStart)
    const uninstallClickBody = rendererSource.slice(uninstallClickStart, uninstallClickEnd)

    expect(pluginItemBody).toContain('onClick={event => handlePluginUpdateClick(event, plugin)}')
    expect(pluginItemBody).toContain('onClick={event => handlePluginToggleClick(event, plugin, !pluginEnabled)}')
    expect(pluginItemBody).toContain('onClick={event => handlePluginUninstallClick(event, plugin)}')
    for (const body of [updateClickBody, toggleClickBody, uninstallClickBody]) {
      expect(body).toContain('event.stopPropagation()')
      expect(body).toContain('if (loadingLabel) return')
    }
    expect(updateClickBody).toContain('void updatePlugin(plugin)')
    expect(toggleClickBody).toContain('void setPluginEnabled(plugin, enabled)')
    expect(uninstallClickBody).toContain('void uninstallPlugin(plugin)')
    expect(pluginItemBody).not.toContain('if (!loadingLabel) void updatePlugin(plugin)')
    expect(pluginItemBody).not.toContain('if (!loadingLabel) void setPluginEnabled(plugin, !pluginEnabled)')
    expect(pluginItemBody).not.toContain('if (!loadingLabel) void uninstallPlugin(plugin)')
    expect(pluginItemBody).not.toContain('if (canSelectPlugin(plugin) && !loadingLabel) void updatePlugin(plugin)')
    expect(pluginItemBody).not.toContain('if (canSelectPlugin(plugin) && !loadingLabel) void setPluginEnabled(plugin, !pluginEnabled)')
    expect(pluginItemBody).not.toContain('if (canSelectPlugin(plugin) && !loadingLabel) void uninstallPlugin(plugin)')
  })

  it('shows a Settings error before selecting an installed plugin with a missing id', () => {
    const helperStart = rendererSource.indexOf('function selectPlugin')
    const helperEnd = rendererSource.indexOf('function openSettingsNavItem', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const guard = 'if (!pluginId) {'

    expect(helperBody).toContain('const pluginId = plugin.id.trim()')
    expect(helperBody).toContain(guard)
    expect(helperBody).toContain("text: 'Select an installed plugin before editing the install form.'")
    expect(helperBody.indexOf(guard)).toBeLessThan(
      helperBody.indexOf('setPluginDraft({'),
    )
  })

  it('selects installed plugin rows from keyboard input', () => {
    const pluginItemStart = rendererSource.indexOf('key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? \'\'}`}')
    const pluginItemEnd = rendererSource.indexOf('<strong>{plugin.id}</strong>', pluginItemStart)
    const pluginItemBody = rendererSource.slice(pluginItemStart, pluginItemEnd)

    expect(pluginItemBody).toContain('tabIndex={canSelectPlugin(plugin) ? 0 : -1}')
    expect(pluginItemBody).toContain('onKeyDown={event => handlePluginRowKeyDown(event, plugin)}')
    expect(rendererSource).toContain("function handlePluginRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, plugin: NonNullable<ClaudeDesktopConfig['plugins']>[number]): void")
    expect(pluginItemBody).not.toContain('onKeyDown={event => canSelectPlugin(plugin) && handleOptionSelectKeyDown(event, () => selectPlugin(plugin))}')
  })

  it('disables project and local plugin rows without an active session or while loading', () => {
    const helperStart = rendererSource.indexOf('function canSelectPlugin')
    const helperEnd = rendererSource.indexOf('function selectPlugin', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const pluginItemStart = rendererSource.indexOf('key={`${pluginScope}-${pluginId}-${plugin.installPath ?? plugin.version ?? \'\'}`}')
    const pluginItemEnd = rendererSource.indexOf('<strong>{plugin.id}</strong>', pluginItemStart)
    const pluginItemBody = rendererSource.slice(pluginItemStart, pluginItemEnd)

    expect(helperBody).toContain('if (loadingLabel) return false')
    expect(helperBody).toContain("return plugin.scope !== 'project' && plugin.scope !== 'local' || Boolean(activeSession)")
    expect(pluginItemBody).toContain('aria-disabled={!canSelectPlugin(plugin)}')
    expect(pluginItemBody).toContain('tabIndex={canSelectPlugin(plugin) ? 0 : -1}')
    expect(pluginItemBody).toContain('onClick={() => handlePluginRowClick(plugin)}')
    expect(pluginItemBody).not.toContain('onClick={() => canSelectPlugin(plugin) && selectPlugin(plugin)}')
    expect(pluginItemBody).toContain('onKeyDown={event => handlePluginRowKeyDown(event, plugin)}')
    expect(pluginItemBody).not.toContain('onKeyDown={event => canSelectPlugin(plugin) && handleOptionSelectKeyDown(event, () => selectPlugin(plugin))}')
  })

  it('blocks plugin management entrypoints while loading', () => {
    const selectStart = rendererSource.indexOf('function selectPlugin')
    const selectEnd = rendererSource.indexOf('function openSettingsNavItem', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const listStart = rendererSource.indexOf('async function listAvailablePlugins')
    const listEnd = rendererSource.indexOf('async function installPlugin', listStart)
    const listBody = rendererSource.slice(listStart, listEnd)
    const installStart = rendererSource.indexOf('async function installPlugin')
    const installEnd = rendererSource.indexOf('async function refreshAgents', installStart)
    const installBody = rendererSource.slice(installStart, installEnd)
    const pluginSectionStart = rendererSource.indexOf('<section className="settings-section" id="settings-plugins">')
    const pluginSectionEnd = rendererSource.indexOf('{pluginOutput ? (', pluginSectionStart)
    const pluginSectionBody = rendererSource.slice(pluginSectionStart, pluginSectionEnd)

    expect(selectBody).toContain('if (!canSelectPlugin(plugin)) return')
    expect(selectBody.indexOf('if (!canSelectPlugin(plugin)) return')).toBeLessThan(
      selectBody.indexOf('setPluginDraft({'),
    )
    expect(listBody).toContain('if (loadingLabel) return')
    expect(listBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      listBody.indexOf('const scope = pluginDraft.scope'),
    )
    expect(installBody).toContain('if (loadingLabel) return')
    expect(installBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      installBody.indexOf('const scope = pluginDraft.scope'),
    )
    expect(rendererSource).toContain('function handlePluginListClick(): void')
    expect(rendererSource).toContain('function handlePluginInstallClick(): void')
    expect(pluginSectionBody).toContain('<button className="tool-button" onClick={handlePluginListClick} disabled={!!loadingLabel || !canRunPluginCommand}>')
    expect(pluginSectionBody).toContain('<button className="tool-button" onClick={handlePluginInstallClick} disabled={!!loadingLabel || !canInstallPlugin}>')
  })

  it('routes stale plugin list and install clicks through the Settings handlers', () => {
    const listStart = rendererSource.indexOf('async function listAvailablePlugins')
    const listEnd = rendererSource.indexOf('async function installPlugin', listStart)
    const listBody = rendererSource.slice(listStart, listEnd)
    const installStart = rendererSource.indexOf('async function installPlugin')
    const installEnd = rendererSource.indexOf('async function refreshAgents', installStart)
    const installBody = rendererSource.slice(installStart, installEnd)
    const pluginSectionStart = rendererSource.indexOf('<section className="settings-section" id="settings-plugins">')
    const pluginSectionEnd = rendererSource.indexOf('{pluginOutput ? (', pluginSectionStart)
    const pluginSectionBody = rendererSource.slice(pluginSectionStart, pluginSectionEnd)

    for (const body of [listBody, installBody]) {
      expect(body).toContain("text: 'Choose a valid plugin scope before running plugin commands.'")
    }
    expect(listBody).toContain("text: 'Select a session to use project or local plugin scope.'")
    expect(installBody).toContain("text: pluginScopeNeedsSession\n          ? 'Select a session to install project or local plugins.'\n          : 'Enter a plugin package before installing.'")
    expect(rendererSource).toContain('function handlePluginListClick(): void')
    expect(rendererSource).toContain('function handlePluginInstallClick(): void')
    expect(pluginSectionBody).toContain('<button className="tool-button" onClick={handlePluginListClick} disabled={!!loadingLabel || !canRunPluginCommand}>')
    expect(pluginSectionBody).toContain('<button className="tool-button" onClick={handlePluginInstallClick} disabled={!!loadingLabel || !canInstallPlugin}>')
    expect(pluginSectionBody).not.toContain('onClick={() => !loadingLabel && void listAvailablePlugins()}')
    expect(pluginSectionBody).not.toContain('onClick={() => !loadingLabel && void installPlugin()}')
    expect(pluginSectionBody).not.toContain('canRunPluginCommand && !loadingLabel && void listAvailablePlugins()')
    expect(pluginSectionBody).not.toContain('canInstallPlugin && !loadingLabel && void installPlugin()')
  })

  it('shows Settings errors when project or local plugin row actions lose the active session', () => {
    const updateStart = rendererSource.indexOf('async function updatePlugin')
    const updateEnd = rendererSource.indexOf('async function setPluginEnabled', updateStart)
    const updateBody = rendererSource.slice(updateStart, updateEnd)
    const enabledStart = rendererSource.indexOf('async function setPluginEnabled')
    const enabledEnd = rendererSource.indexOf('async function uninstallPlugin', enabledStart)
    const enabledBody = rendererSource.slice(enabledStart, enabledEnd)
    const uninstallStart = rendererSource.indexOf('async function uninstallPlugin')
    const uninstallEnd = rendererSource.indexOf('async function listAvailablePlugins', uninstallStart)
    const uninstallBody = rendererSource.slice(uninstallStart, uninstallEnd)

    for (const body of [updateBody, enabledBody, uninstallBody]) {
      expect(body).toContain("if (!canSelectPlugin(plugin)) {")
      expect(body).toContain("if (scope === 'project' || scope === 'local') {")
      expect(body).toContain('setSettingsStatus({')
      expect(body.indexOf("const scope = plugin.scope === 'project'")).toBeLessThan(
        body.indexOf('if (!canSelectPlugin(plugin)) {'),
      )
      expect(body.indexOf("if (scope === 'project' || scope === 'local') {")).toBeLessThan(
        body.indexOf('return'),
      )
    }

    expect(updateBody).toContain("text: 'Select a session to update project or local plugins.'")
    expect(enabledBody).toContain("text: 'Select a session to enable or disable project or local plugins.'")
    expect(uninstallBody).toContain("text: 'Select a session to remove project or local plugins.'")
  })

  it('renders empty plugin command output as structured Settings feedback', () => {
    const stateStart = rendererSource.indexOf('type PluginOutputState')
    const stateEnd = rendererSource.indexOf('function pluginCommandCwd', stateStart)
    const stateBody = rendererSource.slice(stateStart, stateEnd)
    const listStart = rendererSource.indexOf('async function listAvailablePlugins')
    const listEnd = rendererSource.indexOf('async function installPlugin', listStart)
    const listBody = rendererSource.slice(listStart, listEnd)
    const installStart = rendererSource.indexOf('async function installPlugin')
    const installEnd = rendererSource.indexOf('async function refreshAgents', installStart)
    const installBody = rendererSource.slice(installStart, installEnd)
    const pluginOutputStart = rendererSource.indexOf('{pluginOutput ? (')
    const pluginOutputEnd = rendererSource.indexOf('<div id="plugin-listbox"', pluginOutputStart)
    const pluginOutputBody = rendererSource.slice(pluginOutputStart, pluginOutputEnd)
    const styleStart = stylesSource.indexOf('.plugin-output-empty')
    const styleEnd = stylesSource.indexOf('.tree-row', styleStart)
    const styleBody = stylesSource.slice(styleStart, styleEnd)

    expect(stateBody).toContain('type PluginOutputState = {')
    expect(rendererSource).toContain('const [pluginOutput, setPluginOutput] = useState<PluginOutputState | null>(null)')
    expect(listBody).toContain('setPluginOutput({')
    expect(listBody).toContain('ok: result.ok,')
    expect(listBody).toContain('text: result.output || result.error || \'\',')
    expect(installBody).toContain('setPluginOutput({')
    expect(installBody).toContain('ok: result.ok,')
    expect(installBody).toContain('text: result.output || result.error || \'\',')
    expect(pluginOutputBody).toContain('pluginOutput.text.trim() ? (')
    expect(pluginOutputBody).toContain('<pre>{`${pluginOutput.ok ? \'OK\' : \'FAILED\'}\\n${pluginOutput.text}`}</pre>')
    expect(pluginOutputBody).toContain('plugin-output-empty')
    expect(pluginOutputBody).toContain('<Icon name="settings" />')
    expect(pluginOutputBody).toContain('<strong>{pluginOutput.ok ? \'Plugin command completed\' : \'Plugin command failed\'}</strong>')
    expect(pluginOutputBody).toContain('<span>{pluginOutput.ok ? \'The plugin command completed without output.\' : \'The plugin command failed without output.\'}</span>')
    expect(pluginOutputBody).not.toContain('No plugin output.')
    expect(styleBody).toContain('.plugin-output-empty')
    expect(styleBody).toContain('min-height: 96px')
  })

  it('reports empty plugin install failures without raw placeholder copy', () => {
    const installStart = rendererSource.indexOf('async function installPlugin')
    const installEnd = rendererSource.indexOf('async function refreshAgents', installStart)
    const installBody = rendererSource.slice(installStart, installEnd)

    expect(installBody).toContain(
      "const failureText =\n        [result.error, result.output].filter(Boolean).join('\\n') ||\n        'Plugin command failed without error output.'",
    )
    expect(installBody).not.toContain('No plugin output.')
  })

  it('shows a Settings error before plugin commands run with an invalid scope', () => {
    const listStart = rendererSource.indexOf('async function listAvailablePlugins')
    const listEnd = rendererSource.indexOf('async function installPlugin', listStart)
    const listBody = rendererSource.slice(listStart, listEnd)
    const installStart = rendererSource.indexOf('async function installPlugin')
    const installEnd = rendererSource.indexOf('async function refreshAgents', installStart)
    const installBody = rendererSource.slice(installStart, installEnd)
    const guard = 'if (!isPluginScope(scope)) {'

    expect(rendererSource).toContain('function isPluginScope(scope: string): scope is PluginDraft[\'scope\']')
    for (const body of [listBody, installBody]) {
      expect(body).toContain('const scope = pluginDraft.scope as string')
      expect(body).toContain(guard)
      expect(body).toContain("text: 'Choose a valid plugin scope before running plugin commands.'")
      expect(body.indexOf(guard)).toBeLessThan(
        body.indexOf('const cwd = pluginCommandCwd('),
      )
      expect(body.indexOf(guard)).toBeLessThan(
        body.indexOf('await runPluginAction('),
      )
    }
  })

  it('normalizes plugin install package input before invoking plugin commands', () => {
    const installStart = rendererSource.indexOf('async function installPlugin')
    const installEnd = rendererSource.indexOf('async function refreshAgents', installStart)
    const installBody = rendererSource.slice(installStart, installEnd)
    const normalizedPlugin = 'const plugin = pluginDraft.plugin.trim()'

    expect(installBody).toContain(normalizedPlugin)
    expect(installBody.indexOf(normalizedPlugin)).toBeLessThan(
      installBody.indexOf('await runPluginAction(`${cwd}:${scope}:install:${plugin}`'),
    )
    expect(installBody.indexOf(normalizedPlugin)).toBeLessThan(
      installBody.indexOf('await window.claudeDesktop.plugins.install(cwd, {'),
    )
    expect(installBody).toContain('plugin,')
    expect(installBody).toContain('scope,')
    expect(installBody).toContain('`Installed plugin ${plugin}.`')
  })

  it('keeps successful plugin installs selected in the install form', () => {
    const installStart = rendererSource.indexOf('async function installPlugin')
    const installEnd = rendererSource.indexOf('async function refreshAgents', installStart)
    const installBody = rendererSource.slice(installStart, installEnd)

    expect(installBody).toContain('if (result.ok) {')
    expect(installBody).toContain('setPluginDraft({')
    expect(installBody).toContain('plugin,')
    expect(installBody).toContain('scope,')
    expect(installBody).not.toContain('setPluginDraft(emptyPluginDraft())')
    expect(installBody.indexOf('setPluginDraft({')).toBeLessThan(
      installBody.indexOf('await refreshDesktopConfig()'),
    )
    expect(installBody).toContain('await selectInstalledPluginAfterRefresh(plugin, scope, session)')
    expect(installBody.indexOf('await refreshDesktopConfig()')).toBeLessThan(
      installBody.indexOf('await selectInstalledPluginAfterRefresh(plugin, scope, session)'),
    )
  })

  it('clears stale installed plugin selection after refreshed plugin lists drop it', () => {
    const start = rendererSource.indexOf('if (!selectedPluginIdentity) return')
    const end = rendererSource.indexOf('function isMcpServerItemActive', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (!selectedPluginIdentity) return')
    expect(body).toContain('if (!desktopConfig?.plugins) return')
    expect(body).toContain('const selectedPluginIdentityExists = desktopConfig?.plugins.some(plugin =>')
    expect(body).toContain('installedPluginIdentity(plugin) === selectedPluginIdentity')
    expect(body).toContain('if (selectedPluginIdentityExists) return')
    expect(body).toContain('setSelectedPluginIdentity(undefined)')
    expect(body).toContain('setPluginDraft(emptyPluginDraft())')
    expect(body).toContain('const session = activeSession')
    expect(body).toContain('if (session) void updateSessionLayout(session.id, { selectedPluginIdentity: undefined })')
    expect(body).not.toContain('void updateLayout({ selectedPluginIdentity: undefined })')
    expect(body.indexOf('if (!selectedPluginIdentity) return')).toBeLessThan(
      body.indexOf('if (!desktopConfig?.plugins) return'),
    )
    expect(body.indexOf('if (!desktopConfig?.plugins) return')).toBeLessThan(
      body.indexOf('const selectedPluginIdentityExists = desktopConfig?.plugins.some(plugin =>'),
    )
    expect(body.indexOf('if (selectedPluginIdentityExists) return')).toBeLessThan(
      body.indexOf('setSelectedPluginIdentity(undefined)'),
    )
    expect(body.indexOf('setSelectedPluginIdentity(undefined)')).toBeLessThan(
      body.indexOf('setPluginDraft(emptyPluginDraft())'),
    )
  })

  it('persists and restores selected plugin identity in session layout', () => {
    const selectStart = rendererSource.indexOf('function selectPlugin(plugin:')
    const selectEnd = rendererSource.indexOf('function selectInstalledPluginAfterRefresh', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const focusStart = rendererSource.indexOf("if (!activeSession) {")
    const focusEnd = rendererSource.indexOf("void runAction('Refreshing workspace'", focusStart)
    const focusBody = rendererSource.slice(focusStart, focusEnd)
    const activeBranch = focusBody.slice(focusBody.indexOf('activeSessionIdRef.current = activeSession.id'))
    const staleStart = rendererSource.indexOf('if (!selectedPluginIdentity) return')
    const staleEnd = rendererSource.indexOf('function isMcpServerItemActive', staleStart)
    const staleBody = rendererSource.slice(staleStart, staleEnd)

    expect(selectBody).toContain('const selectedPluginIdentity = installedPluginIdentity(plugin)')
    expect(selectBody).toContain('setSelectedPluginIdentity(selectedPluginIdentity)')
    expect(selectBody).toContain('const session = activeSession')
    expect(selectBody).toContain('if (session) void updateSessionLayout(session.id, { selectedPluginIdentity })')
    expect(activeBranch).toContain('const restoredPluginIdentity = activeSession.layout.selectedPluginIdentity')
    expect(activeBranch).toContain('const restoredPlugin = restoredPluginIdentity')
    expect(activeBranch).toContain('desktopConfig?.plugins.find(plugin => installedPluginIdentity(plugin) === restoredPluginIdentity)')
    expect(activeBranch).toContain('setSelectedPluginIdentity(restoredPlugin ? restoredPluginIdentity : undefined)')
    expect(activeBranch).toContain('setPluginDraft(restoredPlugin ? {')
    expect(activeBranch).toContain('plugin: restoredPlugin.id.trim()')
    expect(staleBody).toContain('const session = activeSession')
    expect(staleBody).toContain('if (session) void updateSessionLayout(session.id, { selectedPluginIdentity: undefined })')
  })

  it('styles disabled Settings list rows as inert controls', () => {
    const disabledStyleStart = stylesSource.indexOf('.config-list article[aria-disabled="true"]')
    const disabledStyleEnd = stylesSource.indexOf('.config-list small', disabledStyleStart)
    const disabledStyleBody = stylesSource.slice(disabledStyleStart, disabledStyleEnd)

    expect(disabledStyleBody).toContain('cursor: default')
    expect(disabledStyleBody).toContain('opacity: 0.62')
    expect(disabledStyleBody).toContain('box-shadow: none')
  })

  it('selects MCP and Skill rows directly from pointer and keyboard input', () => {
    const helperStart = rendererSource.indexOf('function handleOptionSelectKeyDown')
    const helperEnd = rendererSource.indexOf('function isProjectScheduledTaskItemActive', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const userMcpStart = rendererSource.indexOf('key={`user-${serverName}`}')
    const userMcpEnd = rendererSource.indexOf('<strong>{server.name}</strong>', userMcpStart)
    const userMcpBody = rendererSource.slice(userMcpStart, userMcpEnd)
    const projectMcpStart = rendererSource.indexOf('key={`project-${serverName}`}', userMcpEnd)
    const projectMcpEnd = rendererSource.indexOf('<strong>{server.name}</strong>', projectMcpStart)
    const projectMcpBody = rendererSource.slice(projectMcpStart, projectMcpEnd)
    const userSkillStart = rendererSource.indexOf('key={`user-${skillPath}`}')
    const userSkillEnd = rendererSource.indexOf('<strong>{skill.name}</strong>', userSkillStart)
    const userSkillBody = rendererSource.slice(userSkillStart, userSkillEnd)
    const projectSkillStart = rendererSource.indexOf('key={`project-${skillPath}`}', userSkillEnd)
    const projectSkillEnd = rendererSource.indexOf('<strong>{skill.name}</strong>', projectSkillStart)
    const projectSkillBody = rendererSource.slice(projectSkillStart, projectSkillEnd)

    expect(helperBody).toContain('function handleOptionSelectKeyDown(event: ReactKeyboardEvent<HTMLElement>, select: () => void): void')
    expect(helperBody).toContain("if (event.key === 'Enter' || event.key === ' ')")
    expect(helperBody).toContain("if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return")
    expect(helperBody).toContain('event.preventDefault()')
    expect(helperBody).toContain('select()')
    expect(userMcpBody).toContain('tabIndex={loadingLabel ? -1 : 0}')
    expect(userMcpBody).toContain("onClick={() => handleMcpRowClick(server, 'user')}")
    expect(userMcpBody).toContain("onKeyDown={event => handleMcpServerRowKeyDown(event, server, 'user')}")
    expect(projectMcpBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(projectMcpBody).toContain("onClick={() => handleMcpRowClick(server, 'project')}")
    expect(projectMcpBody).toContain("onKeyDown={event => handleMcpServerRowKeyDown(event, server, 'project')}")
    expect(userSkillBody).toContain('tabIndex={loadingLabel ? -1 : 0}')
    expect(userSkillBody).toContain("onClick={() => handleSkillRowClick(skill, 'user')}")
    expect(userSkillBody).toContain("onKeyDown={event => handleSkillRowKeyDown(event, skill, 'user')}")
    expect(projectSkillBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(projectSkillBody).toContain("onClick={() => handleSkillRowClick(skill, 'project')}")
    expect(projectSkillBody).toContain("onKeyDown={event => handleSkillRowKeyDown(event, skill, 'project')}")
    expect(rendererSource).toContain('<div className="section-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>')
  })

  it('ignores stale project MCP and Skill inspection results after session focus changes', () => {
    const skillStart = rendererSource.indexOf('async function inspectProjectSkill')
    const skillEnd = rendererSource.indexOf('async function removeUserSkill', skillStart)
    const skillBody = rendererSource.slice(skillStart, skillEnd)
    const mcpStart = rendererSource.indexOf('async function inspectProjectMcp')
    const mcpEnd = rendererSource.indexOf('async function setProjectMcpApproval', mcpStart)
    const mcpBody = rendererSource.slice(mcpStart, mcpEnd)

    expect(skillBody).toContain('const session = activeSession')
    expect(skillBody).toContain('const detail = await window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)')
    expect(skillBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeGreaterThan(
      skillBody.indexOf('const detail = await window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)'),
    )
    expect(skillBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      skillBody.indexOf('setSelectedSkillDetail(detail)'),
    )

    expect(mcpBody).toContain('const session = activeSession')
    expect(mcpBody).toContain('const detail = await window.claudeDesktop.workspaceMcp.read(session.cwd, selectedMcpName)')
    expect(mcpBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeGreaterThan(
      mcpBody.indexOf('const detail = await window.claudeDesktop.workspaceMcp.read(session.cwd, selectedMcpName)'),
    )
    expect(mcpBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      mcpBody.indexOf('setSelectedMcpDetail(detail)'),
    )
  })

  it('exposes first-class lifecycle and settings shortcuts from the composer action menu', () => {
    const start = rendererSource.indexOf('const composerMenuItems = useMemo')
    const end = rendererSource.indexOf('const pluginScopeNeedsSession')
    const body = rendererSource.slice(start, end)

    expect(body).toContain('customCommands')
    expect(body).toContain('id: `custom-command:${customCommandOptionId(command)}`')
    expect(body).toContain('value: `/${command.name}`')
    expect(body).toContain('detail: customCommandDetail(command)')

    expect(body).toContain("id: 'action:new-custom-agent'")
    expect(body).toContain("label: 'New custom agent'")
    expect(body).toContain("openPaneSection('agents', 'agents-editor', 'agents')")
    expect(body).toContain('startNewAgentDraft()')

    expect(body).toContain("id: 'action:new-team'")
    expect(body).toContain("label: 'New team'")
    expect(body).toContain("openPaneSection('teams', 'agents-teams', 'teams')")
    expect(body).toContain('startNewTeamDraft()')

    expect(body).toContain("id: 'action:new-global-task'")
    expect(body).toContain("label: 'New global scheduled task'")
    expect(body).toContain("openPaneSection('tasks', 'tasks-global-tasks', 'tasks')")
    expect(body).toContain('startNewScheduledTaskDraft()')

    expect(body).toContain("id: 'action:new-project-task'")
    expect(body).toContain("label: 'New project scheduled task'")
    expect(body).toContain("openPaneSection('tasks', 'tasks-project-tasks', 'tasks')")
    expect(body).toContain('startNewProjectScheduledTaskDraft()')

    expect(body).toContain("id: 'action:add-mcp'")
    expect(body).toContain("label: 'Add MCP server'")
    expect(body).toContain("openPaneSection('settings', 'settings-mcp', 'settings')")
    expect(body).toContain('startNewMcpDraft()')

    expect(body).toContain("id: 'action:new-user-skill'")
    expect(body).toContain("label: 'New user skill'")
    expect(body).toContain("openPaneSection('settings', 'settings-skills', 'settings')")
    expect(body).toContain('startNewUserSkillDraft()')

    expect(body).toContain("id: 'action:new-project-skill'")
    expect(body).toContain("label: 'New project skill'")
    expect(body).toContain('startNewProjectSkillDraft()')

    expect(body).toContain("id: 'action:install-user-skill'")
    expect(body).toContain("label: 'Install user skill'")
    expect(body).toContain("openPaneSection('settings', 'settings-skills', 'settings')")
    expect(body).toContain('void installLocalSkill()')

    expect(body).toContain("id: 'action:install-project-skill'")
    expect(body).toContain("label: 'Install project skill'")
    expect(body).toContain('void installProjectSkill()')

    expect(body).toContain("id: 'action:list-plugins'")
    expect(body).toContain("label: 'List plugins'")
    expect(body).toContain("openPaneSection('settings', 'settings-plugins', 'settings')")
    expect(body).toContain('void listAvailablePlugins()')

    expect(body).toContain("id: 'action:refresh-settings'")
    expect(body).toContain("label: 'Refresh settings'")
    expect(body).toContain("openPaneSection('settings', 'settings-runtime', 'settings')")
    expect(body).toContain('void refreshSettingsConfig()')
  })

  it('keeps global composer action shortcuts available without an active session', () => {
    const menuStart = rendererSource.indexOf('const composerMenuItems = useMemo')
    const menuEnd = rendererSource.indexOf('const pluginScopeNeedsSession', menuStart)
    const menuBody = rendererSource.slice(menuStart, menuEnd)

    expect(menuBody).toContain('if (!currentComposerTrigger) return []')
    expect(menuBody).not.toContain('if (!currentComposerTrigger || !activeSession) return []')

    const resourceMenuStart = menuBody.indexOf("if (currentComposerTrigger.kind === '@')")
    const resourceMenuEnd = menuBody.indexOf('const customCommandItems', resourceMenuStart)
    const resourceMenuBody = menuBody.slice(resourceMenuStart, resourceMenuEnd)
    expect(resourceMenuBody).toContain('if (!activeSession) return []')

    expect(rendererSource).toContain("{currentComposerTrigger && (currentComposerTrigger.kind === '/' || activeSession) && (")

    const menuUiStart = rendererSource.indexOf('id="composer-menu-listbox"')
    const menuUiEnd = rendererSource.indexOf('<textarea', menuUiStart)
    const menuUiBody = rendererSource.slice(menuUiStart, menuUiEnd)
    expect(menuUiBody).toContain('aria-activedescendant={')

    const textareaStart = rendererSource.indexOf('<textarea', menuUiEnd)
    const textareaEnd = rendererSource.indexOf('placeholder="Ask Claude to inspect, edit, test, or explain this workspace"', textareaStart)
    const textareaBody = rendererSource.slice(textareaStart, textareaEnd)
    expect(textareaBody).toContain("aria-expanded={Boolean(currentComposerTrigger && (currentComposerTrigger.kind === '/' || activeSession))}")
    expect(textareaBody).toContain('onKeyDown={handleComposerKeyDown}')

    const globalActions = [
      "id: 'action:new-custom-agent'",
      "id: 'action:add-mcp'",
      "id: 'action:new-user-skill'",
      "id: 'action:new-global-task'",
      "id: 'action:refresh-settings'",
    ]
    for (const marker of globalActions) {
      const actionStart = menuBody.indexOf(marker)
      const actionEnd = menuBody.indexOf('},', actionStart)
      const actionBody = menuBody.slice(actionStart, actionEnd)
      expect(actionBody).not.toContain('disabled: workspaceActionDisabled')
      expect(actionBody).not.toContain('disabled: !activeSession || Boolean(loadingLabel)')
    }

    const workspaceActions = [
      "id: 'action:refresh-workspace'",
      "id: 'action:new-team'",
      "id: 'action:new-project-task'",
      "id: 'action:new-project-skill'",
      "id: 'action:install-project-skill'",
    ]
    for (const marker of workspaceActions) {
      const actionStart = menuBody.indexOf(marker)
      const actionEnd = menuBody.indexOf('},', actionStart)
      const actionBody = menuBody.slice(actionStart, actionEnd)
      expect(actionBody).toContain('disabled:')
      expect(actionBody).toContain('disabledReason:')
    }
  })

  it('exposes active descendant state for composer resource and action menus', () => {
    const start = rendererSource.indexOf("{currentComposerTrigger && (currentComposerTrigger.kind === '/' || activeSession) && (")
    const end = rendererSource.indexOf('<textarea', start)
    const body = rendererSource.slice(start, end)
    const helperStart = rendererSource.indexOf('function composerMenuOptionId')
    const helperEnd = rendererSource.indexOf('function commandPaletteOptionId', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)

    expect(helperBody).toContain("return `composer-menu-item-${optionIdSegment(item.id)}`")
    expect(body).toContain('id="composer-menu-listbox"')
    expect(body).toContain('aria-activedescendant={')
    expect(body).toContain('composerMenuItems[composerMenuActiveIndex]')
    expect(body).toContain('composerMenuOptionId(composerMenuItems[composerMenuActiveIndex]!)')
    expect(body).toContain('id={composerMenuOptionId(item)}')

    const textareaStart = rendererSource.indexOf('<textarea', end)
    const textareaEnd = rendererSource.indexOf('placeholder="Ask Claude to inspect, edit, test, or explain this workspace"', textareaStart)
    const textareaBody = rendererSource.slice(textareaStart, textareaEnd)
    expect(textareaBody).toContain('aria-controls={currentComposerTrigger ? \'composer-menu-listbox\' : undefined}')
    expect(textareaBody).toContain("aria-expanded={Boolean(currentComposerTrigger && (currentComposerTrigger.kind === '/' || activeSession))}")
    expect(textareaBody).toContain('aria-activedescendant={')
    expect(textareaBody).toContain('composerMenuItems[composerMenuActiveIndex]')
    expect(textareaBody).toContain('composerMenuOptionId(composerMenuItems[composerMenuActiveIndex]!)')
    expect(textareaBody).toContain('onKeyDown={handleComposerKeyDown}')
  })

  it('routes composer menu and submit keys through a focused handler', () => {
    const handlerStart = rendererSource.indexOf('function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void')
    const handlerEnd = rendererSource.indexOf('async function confirmDiscardUnsavedChanges', handlerStart)
    const handlerBody = rendererSource.slice(handlerStart, handlerEnd)
    const textareaStart = rendererSource.indexOf('<textarea', rendererSource.indexOf('id="composer-menu-listbox"'))
    const textareaEnd = rendererSource.indexOf('placeholder="Ask Claude to inspect, edit, test, or explain this workspace"', textareaStart)
    const textareaBody = rendererSource.slice(textareaStart, textareaEnd)

    expect(textareaBody).toContain('onKeyDown={handleComposerKeyDown}')
    expect(textareaBody).not.toContain('onKeyDown={event => {')
    expect(handlerBody).toContain("if (currentComposerTrigger && composerMenuItems.length && event.key === 'Enter')")
    expect(handlerBody).toContain("if (currentComposerTrigger && composerMenuItems.length && event.key === 'ArrowDown')")
    expect(handlerBody).toContain("if (currentComposerTrigger && composerMenuItems.length && event.key === 'ArrowUp')")
    expect(handlerBody).toContain("if (currentComposerTrigger && composerMenuItems.length && event.key === 'Home')")
    expect(handlerBody).toContain("if (currentComposerTrigger && composerMenuItems.length && event.key === 'End')")
    expect(handlerBody).toContain("if (currentComposerTrigger && event.key === 'Escape')")
    expect(handlerBody).toContain('setInput(value => value.slice(0, currentComposerTrigger.start) + value.slice(currentComposerTrigger.end))')
    expect(handlerBody).toContain('if (shouldSubmitComposerKey(event))')
    expect(handlerBody).toContain('void sendMessage()')
  })

  it('keeps disabled composer menu actions visible but inert', () => {
    const typeStart = rendererSource.indexOf('type ComposerMenuItem = {')
    const typeEnd = rendererSource.indexOf('type CommandPaletteItem', typeStart)
    const typeBody = rendererSource.slice(typeStart, typeEnd)
    expect(typeBody).toContain('disabled?: boolean')
    expect(typeBody).toContain('disabledReason?: string')

    const menuStart = rendererSource.indexOf('const composerMenuItems = useMemo')
    const menuEnd = rendererSource.indexOf('const pluginScopeNeedsSession', menuStart)
    const menuBody = rendererSource.slice(menuStart, menuEnd)
    expect(menuBody).toContain("const sessionRequiredReason = 'Start or select a session first.'")
    expect(menuBody).toContain("const loadingReason = loadingLabel")
    expect(menuBody).toContain("id: 'action:new-project-task'")
    expect(menuBody).toContain('disabled: !activeSession || Boolean(loadingLabel)')
    expect(menuBody).toContain('disabledReason: !activeSession ? sessionRequiredReason : loadingReason')
    expect(menuBody).toContain("id: 'action:refresh-workspace'")
    expect(menuBody).toContain('disabled: !activeSession || Boolean(loadingLabel)')

    const chooseStart = rendererSource.indexOf('function chooseComposerMenuItem')
    const chooseEnd = rendererSource.indexOf('async function confirmDiscardUnsavedChanges', chooseStart)
    const chooseBody = rendererSource.slice(chooseStart, chooseEnd)
    expect(chooseBody).toContain('if (item.disabled || loadingLabel) return')
    expect(rendererSource).toContain('function handleComposerMenuItemMouseDown(event: ReactMouseEvent<HTMLButtonElement>, item: ComposerMenuItem): void')

    const menuUiStart = rendererSource.indexOf('id="composer-menu-listbox"')
    const menuUiEnd = rendererSource.indexOf('<textarea', menuUiStart)
    const menuUiBody = rendererSource.slice(menuUiStart, menuUiEnd)
    expect(menuUiBody).toContain("aria-disabled={item.disabled ? 'true' : undefined}")
    expect(menuUiBody).toContain('onMouseDown={event => handleComposerMenuItemMouseDown(event, item)}')
    expect(menuUiBody).not.toContain('onMouseDown={event => {')
    expect(menuUiBody).toContain("item.disabled ? `${item.detail} · ${item.disabledReason ?? 'unavailable'}` : item.detail")
  })

  it('shows a structured empty state when composer menus have no matches', () => {
    const menuUiStart = rendererSource.indexOf('id="composer-menu-listbox"')
    const menuUiEnd = rendererSource.indexOf('<textarea', menuUiStart)
    const menuUiBody = rendererSource.slice(menuUiStart, menuUiEnd)
    const emptyStart = menuUiBody.indexOf('composer-menu-empty')
    const emptyEnd = menuUiBody.indexOf('</div>', emptyStart)
    const emptyBody = menuUiBody.slice(emptyStart, emptyEnd)

    expect(emptyBody).toContain('composer-menu-empty')
    expect(emptyBody).toContain('<Icon name="search" />')
    expect(emptyBody).toContain('<strong>No matches</strong>')
    expect(menuUiBody).not.toContain('<p>No matches</p>')
  })

  it('disables every composer menu option while loading', () => {
    const menuStart = rendererSource.indexOf('const composerMenuItems = useMemo')
    const menuEnd = rendererSource.indexOf('const pluginScopeNeedsSession', menuStart)
    const menuBody = rendererSource.slice(menuStart, menuEnd)
    expect(menuBody).toContain('function withComposerMenuAvailability(items: ComposerMenuItem[]): ComposerMenuItem[]')
    expect(menuBody).toContain('if (!loadingReason) return items')
    expect(menuBody).toContain('return items.map(item => ({')
    expect(menuBody).toContain('disabled: true')
    expect(menuBody).toContain('disabledReason: item.disabledReason ?? loadingReason')
    expect(menuBody).toContain('return withComposerMenuAvailability([...fileItems, ...teamItems, ...agentItems, ...skillItems, ...mcpItems].slice(0, 14))')
    expect(menuBody).toContain('return withComposerMenuAvailability([...customCommandItems, ...actions.filter(item =>')

    const chooseStart = rendererSource.indexOf('function chooseComposerMenuItem')
    const chooseEnd = rendererSource.indexOf('async function confirmDiscardUnsavedChanges', chooseStart)
    const chooseBody = rendererSource.slice(chooseStart, chooseEnd)
    expect(chooseBody).toContain('if (item.disabled || loadingLabel) return')
  })

  it('disables composer target changes while loading', () => {
    const targetStart = rendererSource.indexOf('className="composer-targets"')
    const targetEnd = rendererSource.indexOf('<textarea', targetStart)
    const targetBody = rendererSource.slice(targetStart, targetEnd)

    expect(targetBody.match(/disabled=\{!activeSession \|\| !!loadingLabel\}/g) ?? []).toHaveLength(3)
    expect(rendererSource).toContain('function handleComposerTargetTypeChange(event: ReactChangeEvent<HTMLSelectElement>): void')
    expect(rendererSource).toContain('function handleComposerTargetTeamChange(event: ReactChangeEvent<HTMLSelectElement>): void')
    expect(rendererSource).toContain('function handleComposerTargetAgentChange(event: ReactChangeEvent<HTMLSelectElement>): void')
    expect(targetBody).toContain('onChange={handleComposerTargetTypeChange}')
    expect(targetBody).toContain('onChange={handleComposerTargetTeamChange}')
    expect(targetBody).toContain('onChange={handleComposerTargetAgentChange}')
    expect(targetBody).not.toContain('setChatTarget(prev => ({')
  })

  it('records command palette settings management in electron smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    expect(smokeSource).toContain('commandPaletteSettingsManagement: true')
    expect(smokeSource).toContain("fill('add mcp')")
    expect(smokeSource).toContain("fill('install user skill')")
    expect(smokeSource).toContain("fill('list plugins')")
  })

  it('records native Help menu support actions in electron smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const evidenceSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-evidence.mjs'), 'utf8')

    expect(evidenceSource).toContain("'nativeHelpSupportMenuActions'")
    expect(smokeSource).toContain('nativeHelpSupportMenuActions: true')
    expect(smokeSource).toContain("getMenuItemById('help-command-palette')")
    expect(smokeSource).toContain("getMenuItemById('help-refresh-settings')")
    expect(smokeSource).toContain("getMenuItemById('help-export-diagnostics')")
    expect(smokeSource).toContain("clickApplicationMenuItem(app, 'help-command-palette')")
    expect(smokeSource).toContain("clickApplicationMenuItem(app, 'help-refresh-settings')")
    expect(smokeSource).toContain('saveProxyUrlAndWait(')
    expect(smokeSource).toContain("'https://proxy.example.invalid/connect?token=desktop-smoke-secret-token'")
    expect(smokeSource).toContain("await saveProxyUrlAndWait(page, storePath, 'socks5://127.0.0.1:18999')")
    expect(smokeSource).toContain("clickApplicationMenuItem(app, 'help-export-diagnostics')")
  })

  it('keeps command palette keyboard smoke focused after screenshot capture', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const start = smokeSource.indexOf("await capture(page, 'command-palette')")
    const end = smokeSource.indexOf("await page.locator('.command-palette input[aria-label=\"Search commands\"]').fill('agents')", start)
    const body = smokeSource.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(body).toContain("await page.locator('.command-palette input[aria-label=\"Search commands\"]').focus()")
  })

  it('records command palette skill draft shortcuts as required smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const evidenceSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-evidence.mjs'), 'utf8')

    expect(evidenceSource).toContain("'commandPaletteSkillDraftShortcuts'")
    expect(smokeSource).toContain('commandPaletteSkillDraftShortcuts: true')
    expect(smokeSource).toContain("fill('new user skill')")
    expect(smokeSource).toContain("assertSettingsStatus(page, 'Creating a new user skill.', 'info')")
    expect(smokeSource).toContain("fill('new project skill')")
    expect(smokeSource).toContain("assertSettingsStatus(page, 'Creating a new project skill.', 'info')")
  })

  it('records command palette project skill install as required smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const evidenceSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-evidence.mjs'), 'utf8')

    expect(evidenceSource).toContain("'commandPaletteProjectSkillInstall'")
    expect(smokeSource).toContain('commandPaletteProjectSkillInstall: true')
    expect(smokeSource).toContain("fill('install project skill')")
    expect(smokeSource).toContain("active?.textContent?.includes('Install project skill')")
    expect(smokeSource).toContain("assertSettingsStatus(page, 'Project skill install cancelled.', 'info')")
    expect(smokeSource).toContain('commandPaletteProjectSkillDialogCalls === 1')
  })

  it('records command palette MCP health check as required smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const evidenceSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-evidence.mjs'), 'utf8')

    expect(evidenceSource).toContain("'commandPaletteMcpHealthCheck'")
    expect(smokeSource).toContain('commandPaletteMcpHealthCheck: true')
    expect(smokeSource).toContain("fill('check mcp')")
    expect(smokeSource).toContain("active?.textContent?.includes('Check MCP health')")
    expect(smokeSource).toContain("assertSettingsStatus(page, 'MCP health check passed.')")
    expect(smokeSource).toContain("mcpHealthOutput.includes('desktop-smoke-mcp-health ok')")
  })

  it('records stale project and local plugin row protection in electron smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')

    expect(smokeSource).toContain('projectPluginRowsDisabledNoSession: true')
    expect(smokeSource).toContain('desktop-smoke-project-plugin')
    expect(smokeSource).toContain('desktop-smoke-local-plugin')
    expect(smokeSource).toContain("ariaDisabled === 'true'")
    expect(smokeSource).toContain('tabIndex === -1')
  })

  it('uses DOM-backed Settings sidebar clicks in electron smoke narrow layout', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const helperStart = smokeSource.indexOf('async function clickSettingsSidebarButton')
    const helperEnd = smokeSource.indexOf('async function assertSettingsActionStates', helperStart)
    const helperBody = smokeSource.slice(helperStart, helperEnd)
    const visibleStart = smokeSource.indexOf('async function assertPaneSectionVisible')
    const visibleEnd = smokeSource.indexOf('async function assertSessionRailCanReach', visibleStart)
    const visibleBody = smokeSource.slice(visibleStart, visibleEnd)
    const narrowStart = smokeSource.indexOf("await assertNoHorizontalOverflow(page, '.settings-pane', 'settings pane')")
    const narrowEnd = smokeSource.indexOf("await page.locator('.settings-sidebar input[aria-label=\"Search settings\"]').fill('skill')", narrowStart)
    const narrowBody = smokeSource.slice(narrowStart, narrowEnd)
    const tasksStart = smokeSource.indexOf("await page.locator('.settings-sidebar input[aria-label=\"Search settings\"]').fill('')", narrowEnd)
    const tasksEnd = smokeSource.indexOf("await assertPrimaryNavState(page, 'Tasks')", tasksStart)
    const tasksBody = smokeSource.slice(tasksStart, tasksEnd)

    expect(helperBody).toContain('.settings-sidebar .settings-nav-group button')
    expect(helperBody).toContain('button.textContent?.trim() === label')
    expect(helperBody).toContain('button.click()')
    expect(visibleBody).toContain('pane.scrollTop += headingRect.top - paneRect.top - 8')
    expect(narrowBody).toContain("await clickSettingsSidebarButton(page, 'Plugins')")
    expect(tasksBody).toContain("await clickSettingsSidebarButton(page, 'Project tasks')")
  })

  it('seeds project team metadata for electron smoke team management', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const workspaceStart = smokeSource.indexOf('async function setupWorkspace()')
    const workspaceEnd = smokeSource.indexOf('async function setupPlainWorkspace()', workspaceStart)
    const workspaceBody = smokeSource.slice(workspaceStart, workspaceEnd)

    expect(workspaceBody).toContain("mkdir(join(cwd, '.kode/teams/frontend')")
    expect(workspaceBody).toContain("writeFile(join(cwd, '.kode/teams/frontend/config.json')")
    expect(workspaceBody).toContain("name: 'frontend'")
    expect(workspaceBody).toContain("name: 'alice'")
  })

  it('rebases electron smoke git diff after metadata management scenarios', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const diffStart = smokeSource.indexOf("progress('editing file and refreshing diff')")
    const beforeDiff = smokeSource.slice(Math.max(0, diffStart - 500), diffStart)

    expect(smokeSource).toContain('function commitWorkspaceBaseline(cwd, message)')
    expect(beforeDiff).toContain("commitWorkspaceBaseline(cwd, 'desktop smoke metadata baseline')")
  })

  it('clears smoke editor dirty state before renderer session focus', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const focusStart = smokeSource.indexOf('async function focusSmokeSession')
    const focusEnd = smokeSource.indexOf('async function waitForTerminalText', focusStart)
    const body = smokeSource.slice(focusStart, focusEnd)

    expect(body).toContain('window.__claudeDesktopSmokeDiscardEditorChanges?.()')
    expect(body.indexOf('window.__claudeDesktopSmokeDiscardEditorChanges?.()')).toBeLessThan(
      body.indexOf('await window.__claudeDesktopSmokeFocusSession(expectedSessionId)'),
    )
  })

  it('waits for rapid session focus IPC evidence in electron smoke', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const rapidStart = smokeSource.indexOf('await focusSmokeSession(page, focusResult.first)')
    const rapidEnd = smokeSource.indexOf("await waitFor(page, expectedSessionId =>", rapidStart)
    const rapidBody = smokeSource.slice(rapidStart, rapidEnd)

    expect(rapidBody).toContain('const rapidFocusTargetReady = await waitFor(page,')
    expect(rapidBody).toContain('active?.textContent?.includes(firstTitle)')
    expect(rapidBody).toContain('target.disabled === false')
    expect(rapidBody).toContain('window.__claudeDesktopSmokeSessionFocusInFlight?.() === false')
    expect(rapidBody).toContain('await waitForApp(app, ({ app: electronApp }, baseline) =>')
    expect(rapidBody).toContain("electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:focus']")
    expect(rapidBody).toContain('return calls - baseline === 1')
  })

  it('waits for active session menu button readiness in electron smoke', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const menuStart = smokeSource.indexOf("progress('checking session row management menu')")
    const menuEnd = smokeSource.indexOf('const openFolderBaseline', menuStart)
    const menuBody = smokeSource.slice(menuStart, menuEnd)

    expect(menuBody).toContain('await waitFor(page, () => {')
    expect(menuBody).toContain("const button = active?.closest('.session-row-shell')?.querySelector('.session-menu-button')")
    expect(menuBody).toContain('button.disabled === false')
  })

  it('waits for primary session row readiness in rail overflow smoke', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const railStart = smokeSource.indexOf("progress('checking session rail overflow')")
    const railEnd = smokeSource.indexOf("await page.getByRole('button', { name: /Chat/ }).click()", railStart)
    const railBody = smokeSource.slice(railStart, railEnd)

    expect(railBody).toContain('const primaryRailRowReady = await waitFor(page, title =>')
    expect(railBody).toContain('row.disabled === false')
    expect(railBody).toContain('primaryRailRowReady.title')
  })

  it('records composer lifecycle and settings shortcut execution in electron smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    expect(smokeSource).toContain('composerLifecycleActionShortcuts: true')
    expect(smokeSource).toContain('composerSettingsActionShortcuts: true')
    expect(smokeSource).toContain("fillComposer(page, '/new-custom')")
    expect(smokeSource).toContain("hasText: 'New custom agent'")
    expect(smokeSource).toContain("assertAgentsStatus(page, 'Ready to create a new agent.', 'info')")
    expect(smokeSource).toContain("fillComposer(page, '/add-mcp')")
    expect(smokeSource).toContain("hasText: 'Add MCP server'")
    expect(smokeSource).toContain("assertSettingsStatus(page, 'Ready to add a new MCP server.', 'info')")
    expect(smokeSource).toContain("fillComposer(page, '/new-user-skill')")
    expect(smokeSource).toContain("hasText: 'New user skill'")
    expect(smokeSource).toContain("assertSettingsStatus(page, 'Creating a new user skill.', 'info')")
    expect(smokeSource).toContain("fillComposer(page, '/new-project-skill')")
    expect(smokeSource).toContain("hasText: 'New project skill'")
    expect(smokeSource).toContain("assertSettingsStatus(page, 'Creating a new project skill.', 'info')")
  })

  it('records custom slash command execution from the composer menu in electron smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const evidenceSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-evidence.mjs'), 'utf8')

    expect(evidenceSource).toContain("'composerCustomSlashCommand'")
    expect(smokeSource).toContain("mkdir(join(cwd, '.kode/commands'), { recursive: true })")
    expect(smokeSource).toContain("join(cwd, '.kode/commands/desktop-smoke.md')")
    expect(smokeSource).toContain('composerCustomSlashCommand: true')
    expect(smokeSource).toContain("fillComposer(page, '/project:desktop-smoke')")
    expect(smokeSource).toContain("hasText: '/project:desktop-smoke'")
    expect(smokeSource).toContain("input.value === '/project:desktop-smoke '")
    expect(smokeSource).toContain('input.selectionStart === 23')
  })

  it('records command palette lifecycle create execution in electron smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    expect(smokeSource).toContain('commandPaletteLifecycleCreateShortcuts: true')
    expect(smokeSource).toContain("fill('new custom agent')")
    expect(smokeSource).toContain("assertAgentsStatus(page, 'Ready to create a new agent.', 'info')")
    expect(smokeSource).toContain("fill('new team')")
    expect(smokeSource).toContain("assertTeamsStatus(page, 'Ready to create a new team.', 'info')")
    expect(smokeSource).toContain("fill('new global scheduled task')")
    expect(smokeSource).toContain("assertTasksStatus(page, 'Ready to create a new global scheduled task.', 'info')")
    expect(smokeSource).toContain("fill('new project scheduled task')")
    expect(smokeSource).toContain("assertTasksStatus(page, 'Ready to create a new project scheduled task.', 'info')")
  })

  it('disables project-scoped destructive settings actions without an active session', () => {
    expect(rendererSource).toContain(
      `onClick={() => handleMcpRemoveClick(server, 'project')} disabled={!activeSession || !!loadingLabel}`,
    )
    expect(rendererSource).toContain(
      "onClick={() => handleSkillRemoveClick(skill, 'project')} disabled={!activeSession || !!loadingLabel}",
    )
  })

  it('disables project-scoped Settings management rows without an active session', () => {
    const projectMcpStart = rendererSource.indexOf('key={`project-${serverName}`}')
    const projectMcpEnd = rendererSource.indexOf('<strong>{server.name}</strong>', projectMcpStart)
    const projectMcpBody = rendererSource.slice(projectMcpStart, projectMcpEnd)
    const projectSkillStart = rendererSource.indexOf('key={`project-${skillPath}`}')
    const projectSkillEnd = rendererSource.indexOf('<strong>{skill.name}</strong>', projectSkillStart)
    const projectSkillBody = rendererSource.slice(projectSkillStart, projectSkillEnd)

    expect(projectMcpBody).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(projectMcpBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(projectMcpBody).toContain("onClick={() => handleMcpRowClick(server, 'project')}")
    expect(projectMcpBody).toContain("onKeyDown={event => handleMcpServerRowKeyDown(event, server, 'project')}")
    expect(projectSkillBody).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(projectSkillBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(projectSkillBody).toContain("onClick={() => handleSkillRowClick(skill, 'project')}")
    expect(projectSkillBody).toContain("onKeyDown={event => handleSkillRowKeyDown(event, skill, 'project')}")
  })

  it('routes project MCP and Skill actions through handlers when active session becomes stale', () => {
    const projectMcpStart = rendererSource.indexOf('key={`project-${serverName}`}')
    const projectMcpEnd = rendererSource.indexOf('</article>', projectMcpStart)
    const projectMcpActionsStart = rendererSource.indexOf('<div className="section-actions"', projectMcpStart)
    const projectMcpBody = rendererSource.slice(projectMcpActionsStart, projectMcpEnd)
    const selectedMcpStart = rendererSource.indexOf('{selectedMcpDetail && (() => {')
    const selectedMcpEnd = rendererSource.indexOf('<pre>{rawSummary(selectedMcpDetail.raw ?? selectedMcpDetail)}</pre>', selectedMcpStart)
    const selectedMcpBody = rendererSource.slice(selectedMcpStart, selectedMcpEnd)
    const projectSkillStart = rendererSource.indexOf('key={`project-${skillPath}`}')
    const projectSkillEnd = rendererSource.indexOf('</article>', projectSkillStart)
    const projectSkillActionsStart = rendererSource.indexOf('<div className="section-actions"', projectSkillStart)
    const projectSkillBody = rendererSource.slice(projectSkillActionsStart, projectSkillEnd)
    const selectedSkillStart = rendererSource.indexOf('{selectedSkillDetail && (() => {')
    const selectedSkillEnd = rendererSource.indexOf('<pre>{selectedSkillDetail.contents ?? \'\'}</pre>', selectedSkillStart)
    const selectedSkillBody = rendererSource.slice(selectedSkillStart, selectedSkillEnd)

    expect(rendererSource).toContain("function handleMcpInspectClick(server: McpServerInfo, scope: 'user' | 'project'): void")
    expect(rendererSource).toContain("function handleMcpEditClick(server: McpServerInfo, scope: 'user' | 'project'): void")
    expect(rendererSource).toContain("function handleMcpRemoveClick(server: McpServerInfo, scope: 'user' | 'project'): void")
    expect(projectMcpBody).toContain("onClick={() => handleMcpInspectClick(server, 'project')}")
    expect(projectMcpBody).toContain("onClick={() => handleMcpEditClick(server, 'project')}")
    expect(projectMcpBody).toContain('onClick={() => approveProjectMcpServer(server)}')
    expect(projectMcpBody).toContain('onClick={() => rejectProjectMcpServer(server)}')
    expect(projectMcpBody).toContain("onClick={() => handleMcpRemoveClick(server, 'project')}")
    expect(projectMcpBody).toContain('disabled={!activeSession || !!loadingLabel}')
    expect(projectMcpBody).not.toContain('!loadingLabel && void inspectProjectMcp(server)')
    expect(projectMcpBody).not.toContain("!loadingLabel && editMcpServer(server, 'project')")
    expect(projectMcpBody).not.toContain("!loadingLabel && void removeMcpServer(server.name, 'project')")
    expect(projectMcpBody).not.toContain('activeSession && !loadingLabel && void inspectProjectMcp(server)')
    expect(projectMcpBody).not.toContain("activeSession && !loadingLabel && editMcpServer(server, 'project')")
    expect(projectMcpBody).not.toContain('if (!loadingLabel) void inspectProjectMcp(server)')
    expect(projectMcpBody).not.toContain("if (!loadingLabel) editMcpServer(server, 'project')")
    expect(projectMcpBody).not.toContain("activeSession && server.approvalStatus !== 'approved' && !loadingLabel && void setProjectMcpApproval(server, true)")
    expect(projectMcpBody).not.toContain("activeSession && server.approvalStatus !== 'rejected' && !loadingLabel && void setProjectMcpApproval(server, false)")
    expect(projectMcpBody).not.toContain("server.approvalStatus !== 'approved' && !loadingLabel")
    expect(projectMcpBody).not.toContain("server.approvalStatus !== 'rejected' && !loadingLabel")
    expect(projectMcpBody).not.toContain("activeSession && !loadingLabel && void removeMcpServer(server.name, 'project')")
    expect(projectMcpBody).not.toContain("if (!loadingLabel) void removeMcpServer(server.name, 'project')")

    expect(rendererSource).toContain('function handleSelectedMcpDetailEditClick(): void')
    expect(rendererSource).toContain('function handleSelectedMcpDetailRemoveClick(): void')
    expect(selectedMcpBody).toContain('onClick={handleSelectedMcpDetailEditClick}')
    expect(selectedMcpBody).toContain('onClick={() => handleSelectedMcpDetailApprovalClick(true)}')
    expect(selectedMcpBody).toContain('onClick={() => handleSelectedMcpDetailApprovalClick(false)}')
    expect(selectedMcpBody).toContain('onClick={handleSelectedMcpDetailRemoveClick}')
    expect(selectedMcpBody).toContain('disabled={!!loadingLabel || (selectedMcpDetailProjectScoped && !activeSession)}')
    expect(selectedMcpBody).not.toContain("!loadingLabel && editMcpServer(selectedMcpDetail, selectedMcpDetailProjectScoped ? 'project' : 'user')")
    expect(selectedMcpBody).not.toContain("!loadingLabel && void removeMcpServer(selectedMcpDetail.name, selectedMcpDetailProjectScoped ? 'project' : 'user')")
    expect(selectedMcpBody).not.toContain("if (!loadingLabel) editMcpServer(selectedMcpDetail, selectedMcpDetailProjectScoped ? 'project' : 'user')")
    expect(selectedMcpBody).not.toContain("if (!loadingLabel) void removeMcpServer(selectedMcpDetail.name, selectedMcpDetailProjectScoped ? 'project' : 'user')")

    expect(rendererSource).toContain("function handleSkillInspectClick(skill: InstalledSkillInfo, scope: 'user' | 'project'): void")
    expect(rendererSource).toContain("function handleSkillEditClick(skill: InstalledSkillInfo, scope: 'user' | 'project'): void")
    expect(rendererSource).toContain("function handleSkillRemoveClick(skill: InstalledSkillInfo, scope: 'user' | 'project'): void")
    expect(projectSkillBody).toContain("onClick={() => handleSkillInspectClick(skill, 'project')}")
    expect(projectSkillBody).toContain("onClick={() => handleSkillEditClick(skill, 'project')}")
    expect(projectSkillBody).toContain("onClick={() => handleSkillRemoveClick(skill, 'project')}")
    expect(projectSkillBody).toContain('disabled={!activeSession || !!loadingLabel}')
    expect(projectSkillBody).not.toContain('!loadingLabel && void inspectProjectSkill(skill)')
    expect(projectSkillBody).not.toContain('!loadingLabel && void editProjectSkill(skill)')
    expect(projectSkillBody).not.toContain('!loadingLabel && void removeProjectSkill(skill)')
    expect(projectSkillBody).not.toContain('activeSession && !loadingLabel && void inspectProjectSkill(skill)')
    expect(projectSkillBody).not.toContain('activeSession && !loadingLabel && void editProjectSkill(skill)')
    expect(projectSkillBody).not.toContain('activeSession && !loadingLabel && void removeProjectSkill(skill)')
    expect(projectSkillBody).not.toContain('if (!loadingLabel) void inspectProjectSkill(skill)')
    expect(projectSkillBody).not.toContain('if (!loadingLabel) void editProjectSkill(skill)')
    expect(projectSkillBody).not.toContain('if (!loadingLabel) void removeProjectSkill(skill)')

    expect(rendererSource).toContain('function handleSelectedSkillDetailEditClick(): void')
    expect(rendererSource).toContain('function handleSelectedSkillDetailRemoveClick(): void')
    expect(selectedSkillBody).toContain('onClick={handleSelectedSkillDetailEditClick}')
    expect(selectedSkillBody).toContain('onClick={handleSelectedSkillDetailRemoveClick}')
    expect(selectedSkillBody).toContain('disabled={!!loadingLabel || (selectedSkillDetailProjectScoped && !activeSession)}')
    expect(selectedSkillBody).not.toContain("!loadingLabel && editSkillDetail(")
    expect(selectedSkillBody).not.toContain("!loadingLabel && void removeSkillDetail(")
    expect(selectedSkillBody).not.toContain("if (!loadingLabel) editSkillDetail(")
    expect(selectedSkillBody).not.toContain("if (!loadingLabel) void removeSkillDetail(")
  })

  it('routes stale project MCP row selection through the edit handler', () => {
    const projectMcpStart = rendererSource.indexOf('key={`project-${serverName}`}')
    const projectMcpEnd = rendererSource.indexOf('<strong>{server.name}</strong>', projectMcpStart)
    const projectMcpBody = rendererSource.slice(projectMcpStart, projectMcpEnd)

    expect(projectMcpBody).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(projectMcpBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(rendererSource).toContain("function handleMcpRowClick(server: McpServerInfo, scope: 'user' | 'project'): void")
    expect(projectMcpBody).toContain("onClick={() => handleMcpRowClick(server, 'project')}")
    expect(projectMcpBody).toContain("onKeyDown={event => handleMcpServerRowKeyDown(event, server, 'project')}")
    expect(projectMcpBody).not.toContain("onClick={() => !loadingLabel && editMcpServer(server, 'project')}")
    expect(projectMcpBody).not.toContain("activeSession && !loadingLabel && editMcpServer(server, 'project')")
    expect(projectMcpBody).not.toContain("activeSession && !loadingLabel && handleOptionSelectKeyDown(event, () => editMcpServer(server, 'project'))")
  })

  it('routes stale project Skill row selection through the inspect handler', () => {
    const projectSkillStart = rendererSource.indexOf('key={`project-${skillPath}`}')
    const projectSkillEnd = rendererSource.indexOf('<strong>{skill.name}</strong>', projectSkillStart)
    const projectSkillBody = rendererSource.slice(projectSkillStart, projectSkillEnd)

    expect(projectSkillBody).toContain('aria-disabled={!activeSession || !!loadingLabel}')
    expect(projectSkillBody).toContain('tabIndex={!activeSession || loadingLabel ? -1 : 0}')
    expect(rendererSource).toContain("function handleSkillRowClick(skill: InstalledSkillInfo, scope: 'user' | 'project'): void")
    expect(projectSkillBody).toContain("onClick={() => handleSkillRowClick(skill, 'project')}")
    expect(projectSkillBody).not.toContain('onClick={() => !loadingLabel && void inspectProjectSkill(skill)}')
    expect(projectSkillBody).toContain("onKeyDown={event => handleSkillRowKeyDown(event, skill, 'project')}")
    expect(projectSkillBody).not.toContain('activeSession && !loadingLabel && void inspectProjectSkill(skill)')
    expect(projectSkillBody).not.toContain('activeSession && !loadingLabel && handleOptionSelectKeyDown(event, () => void inspectProjectSkill(skill))')
  })

  it('guards MCP removal against duplicate destructive submissions', () => {
    const start = rendererSource.indexOf('async function removeMcpServer')
    const end = rendererSource.indexOf('async function inspectUserMcp', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const session = activeSession')
    expect(body).toContain("const projectSession = scope === 'project' ? session : undefined")
    expect(body).toContain(
      "const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:remove:${removedMcpName}`",
    )
    expect(body).toContain('if (mcpActionPendingRef.current.has(actionKey)) return')
    expect(body).toContain('mcpActionPendingRef.current.add(actionKey)')
    expect(body).toContain('mcpActionPendingRef.current.delete(actionKey)')
  })

  it('blocks project MCP removal before confirmation without an active session', () => {
    const start = rendererSource.indexOf('async function removeMcpServer')
    const end = rendererSource.indexOf('async function inspectUserMcp', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain("if (scope === 'project' && !projectSession)")
    expect(body).toContain("text: 'Select a session before editing project MCP servers'")
    expect(body.indexOf("if (scope === 'project' && !projectSession)")).toBeLessThan(
      body.indexOf("const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:remove:${removedMcpName}`"),
    )
    expect(body.indexOf("if (scope === 'project' && !projectSession)")).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
    expect(body).toContain(
      "const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:remove:${removedMcpName}`",
    )
  })

  it('shows a Settings error when project MCP inspect or approval has no active session', () => {
    const inspectStart = rendererSource.indexOf('async function inspectProjectMcp')
    const inspectEnd = rendererSource.indexOf('async function setProjectMcpApproval', inspectStart)
    const inspectBody = rendererSource.slice(inspectStart, inspectEnd)
    const approvalStart = rendererSource.indexOf('async function setProjectMcpApproval')
    const approvalEnd = rendererSource.indexOf('async function setUserMcpEnabled', approvalStart)
    const approvalBody = rendererSource.slice(approvalStart, approvalEnd)

    expect(inspectBody).toContain("if (!activeSession)")
    expect(inspectBody).toContain("text: 'Select a session before editing project MCP servers'")
    expect(inspectBody.indexOf("if (!activeSession)")).toBeLessThan(
      inspectBody.indexOf('const session = activeSession'),
    )
    expect(inspectBody.indexOf("if (!activeSession)")).toBeLessThan(
      inspectBody.indexOf('window.claudeDesktop.workspaceMcp.read(session.cwd, selectedMcpName)'),
    )

    expect(approvalBody).toContain("if (!activeSession)")
    expect(approvalBody).toContain("text: 'Select a session before editing project MCP servers'")
    expect(approvalBody).toContain("if (scope !== 'project') {")
    expect(approvalBody).toContain("text: 'Select a project MCP server before updating approval.'")
    expect(approvalBody.indexOf("if (scope !== 'project') {")).toBeLessThan(
      approvalBody.indexOf("if (!activeSession)"),
    )
    expect(approvalBody.indexOf("if (!activeSession)")).toBeLessThan(
      approvalBody.indexOf('const session = activeSession'),
    )
    expect(approvalBody.indexOf("if (!activeSession)")).toBeLessThan(
      approvalBody.indexOf('window.claudeDesktop.workspaceMcp.setApproval('),
    )
  })

  it('shows a Settings notice before project MCP approval repeats the current state', () => {
    const approvalStart = rendererSource.indexOf('async function setProjectMcpApproval')
    const approvalEnd = rendererSource.indexOf('async function setUserMcpEnabled', approvalStart)
    const approvalBody = rendererSource.slice(approvalStart, approvalEnd)
    const approvedGuard = "if (approved && server.approvalStatus === 'approved') {"
    const rejectedGuard = "if (!approved && server.approvalStatus === 'rejected') {"

    expect(approvalBody).toContain(approvedGuard)
    expect(approvalBody).toContain("text: `Project MCP server \"${selectedMcpName}\" is already approved.`")
    expect(approvalBody).toContain(rejectedGuard)
    expect(approvalBody).toContain("text: `Project MCP server \"${selectedMcpName}\" is already rejected.`")
    expect(approvalBody.indexOf(approvedGuard)).toBeGreaterThan(
      approvalBody.indexOf('const selectedMcpName = server.name.trim()'),
    )
    expect(approvalBody.indexOf(rejectedGuard)).toBeGreaterThan(
      approvalBody.indexOf(approvedGuard),
    )
    expect(approvalBody.indexOf(rejectedGuard)).toBeLessThan(
      approvalBody.indexOf('const session = activeSession'),
    )
    expect(approvalBody.indexOf(rejectedGuard)).toBeLessThan(
      approvalBody.indexOf('window.claudeDesktop.workspaceMcp.setApproval('),
    )
  })

  it('shows a Settings error before MCP actions run with a missing server name', () => {
    const removeStart = rendererSource.indexOf('async function removeMcpServer')
    const removeEnd = rendererSource.indexOf('async function inspectUserMcp', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const inspectUserStart = rendererSource.indexOf('async function inspectUserMcp')
    const inspectUserEnd = rendererSource.indexOf('async function inspectProjectMcp', inspectUserStart)
    const inspectUserBody = rendererSource.slice(inspectUserStart, inspectUserEnd)
    const inspectProjectStart = rendererSource.indexOf('async function inspectProjectMcp')
    const inspectProjectEnd = rendererSource.indexOf('async function setProjectMcpApproval', inspectProjectStart)
    const inspectProjectBody = rendererSource.slice(inspectProjectStart, inspectProjectEnd)
    const approvalStart = rendererSource.indexOf('async function setProjectMcpApproval')
    const approvalEnd = rendererSource.indexOf('async function setUserMcpEnabled', approvalStart)
    const approvalBody = rendererSource.slice(approvalStart, approvalEnd)
    const enabledStart = rendererSource.indexOf('async function setUserMcpEnabled')
    const enabledEnd = rendererSource.indexOf('function editMcpServer', enabledStart)
    const enabledBody = rendererSource.slice(enabledStart, enabledEnd)
    const editStart = rendererSource.indexOf('function editMcpServer')
    const editEnd = rendererSource.indexOf('function cancelMcpEdit', editStart)
    const editBody = rendererSource.slice(editStart, editEnd)
    const serverName = 'const selectedMcpName = server.name.trim()'
    const serverGuard = 'if (!selectedMcpName) {'
    const removedName = 'const removedMcpName = name.trim()'
    const nameGuard = 'if (!removedMcpName) {'

    expect(removeBody).toContain(removedName)
    expect(removeBody).toContain(nameGuard)
    expect(removeBody.indexOf(removedName)).toBeLessThan(
      removeBody.indexOf(nameGuard),
    )
    expect(removeBody).toContain("text: scope === 'project' ? 'Select a project MCP server before removing.' : 'Select an MCP server before removing.'")
    expect(removeBody.indexOf(nameGuard)).toBeLessThan(
      removeBody.indexOf('requestConfirmation({'),
    )

    for (const body of [inspectUserBody, inspectProjectBody, approvalBody, enabledBody, editBody]) {
      expect(body).toContain(serverName)
      expect(body.indexOf(serverName)).toBeLessThan(
        body.indexOf(serverGuard),
      )
    }
    expect(inspectUserBody).toContain(serverGuard)
    expect(inspectUserBody).toContain("text: 'Select an MCP server before inspecting.'")
    expect(inspectUserBody.indexOf(serverGuard)).toBeLessThan(
      inspectUserBody.indexOf('await window.claudeDesktop.mcp.read(selectedMcpName)'),
    )

    expect(inspectProjectBody).toContain(serverGuard)
    expect(inspectProjectBody).toContain("text: 'Select a project MCP server before inspecting.'")
    expect(inspectProjectBody.indexOf(serverGuard)).toBeLessThan(
      inspectProjectBody.indexOf('await window.claudeDesktop.workspaceMcp.read(session.cwd, selectedMcpName)'),
    )

    expect(approvalBody).toContain(serverGuard)
    expect(approvalBody).toContain("text: 'Select a project MCP server before updating approval.'")
    expect(approvalBody.indexOf(serverGuard)).toBeLessThan(
      approvalBody.indexOf('window.claudeDesktop.workspaceMcp.setApproval('),
    )

    expect(enabledBody).toContain(serverGuard)
    expect(enabledBody).toContain("text: 'Select an MCP server before enabling or disabling.'")
    expect(enabledBody.indexOf(serverGuard)).toBeLessThan(
      enabledBody.indexOf('window.claudeDesktop.mcp.setEnabled('),
    )

    expect(editBody).toContain(serverGuard)
    expect(editBody).toContain("text: scope === 'project' ? 'Select a project MCP server before editing.' : 'Select an MCP server before editing.'")
    expect(editBody.indexOf(serverGuard)).toBeLessThan(
      editBody.indexOf('setMcpDraft({ ...mcpDraftFromServer(server, scope), name: selectedMcpName, editingName: selectedMcpName })'),
    )
  })

  it('normalizes MCP server management targets before IPC and feedback', () => {
    const removeStart = rendererSource.indexOf('async function removeMcpServer')
    const removeEnd = rendererSource.indexOf('async function inspectUserMcp', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const inspectUserStart = rendererSource.indexOf('async function inspectUserMcp')
    const inspectUserEnd = rendererSource.indexOf('async function inspectProjectMcp', inspectUserStart)
    const inspectUserBody = rendererSource.slice(inspectUserStart, inspectUserEnd)
    const inspectProjectStart = rendererSource.indexOf('async function inspectProjectMcp')
    const inspectProjectEnd = rendererSource.indexOf('async function setProjectMcpApproval', inspectProjectStart)
    const inspectProjectBody = rendererSource.slice(inspectProjectStart, inspectProjectEnd)
    const approvalStart = rendererSource.indexOf('async function setProjectMcpApproval')
    const approvalEnd = rendererSource.indexOf('async function setUserMcpEnabled', approvalStart)
    const approvalBody = rendererSource.slice(approvalStart, approvalEnd)
    const enabledStart = rendererSource.indexOf('async function setUserMcpEnabled')
    const enabledEnd = rendererSource.indexOf('function editMcpServer', enabledStart)
    const enabledBody = rendererSource.slice(enabledStart, enabledEnd)
    const editStart = rendererSource.indexOf('function editMcpServer')
    const editEnd = rendererSource.indexOf('function cancelMcpEdit', editStart)
    const editBody = rendererSource.slice(editStart, editEnd)

    expect(removeBody).toContain("const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:remove:${removedMcpName}`")
    expect(removeBody).toContain('message: `Remove ${scope} MCP server "${removedMcpName}" from the desktop configuration.`')
    expect(removeBody).toContain('await window.claudeDesktop.workspaceMcp.remove(projectSession.cwd, removedMcpName)')
    expect(removeBody).toContain('await window.claudeDesktop.mcp.remove(removedMcpName)')
    expect(removeBody).toContain('if (mcpDraft.editingName?.trim() === removedMcpName && mcpDraft.scope === scope) {')
    expect(removeBody).toContain('if (selectedMcpDetailMatchesRemovedScope) {')
    expect(removeBody).toContain('setSettingsStatus({ kind: \'success\', text: `Removed ${scope} MCP server "${removedMcpName}".` })')

    expect(inspectUserBody).toContain('const actionKey = `user-mcp:${selectedMcpName}:read`')
    expect(inspectUserBody).toContain('const detail = await window.claudeDesktop.mcp.read(selectedMcpName)')
    expect(inspectUserBody).toContain('setSettingsStatus({ kind: \'info\', text: `Inspecting user MCP server "${selectedMcpName}".` })')

    expect(inspectProjectBody).toContain('const actionKey = `${session.cwd}:project-mcp:${selectedMcpName}:read`')
    expect(inspectProjectBody).toContain('const detail = await window.claudeDesktop.workspaceMcp.read(session.cwd, selectedMcpName)')
    expect(inspectProjectBody).toContain('setSettingsStatus({ kind: \'info\', text: `Inspecting project MCP server "${selectedMcpName}".` })')

    expect(approvalBody).toContain("const actionKey = `${session.cwd}:project-mcp:${selectedMcpName}:${approved ? 'approve' : 'reject'}`")
    expect(approvalBody).toContain('selectedMcpName,')
    expect(approvalBody).toContain('text: `${approved ? \'Approved\' : \'Rejected\'} project MCP server "${selectedMcpName}".`,')

    expect(enabledBody).toContain("const actionKey = `user-mcp:${selectedMcpName}:${enabled ? 'enable' : 'disable'}`")
    expect(enabledBody).toContain('selectedMcpName,')
    expect(enabledBody).toContain('text: `${enabled ? \'Enabled\' : \'Disabled\'} user MCP server "${selectedMcpName}".`,')

    expect(editBody).toContain('setMcpDraft({ ...mcpDraftFromServer(server, scope), name: selectedMcpName, editingName: selectedMcpName })')
    expect(editBody).toContain('setSettingsStatus({ kind: \'info\', text: `Editing ${scope} MCP server "${selectedMcpName}".` })')
  })

  it('preserves remote MCP server URL when loading it into the edit draft', () => {
    const draftStart = rendererSource.indexOf("function mcpDraftFromServer(server: McpServerInfo, scope: 'user' | 'project'): McpDraft")
    const draftEnd = rendererSource.indexOf('function mcpInputFromDraft', draftStart)
    const draftBody = rendererSource.slice(draftStart, draftEnd)

    expect(draftBody).toContain("const isRemote = Boolean(server.url || server.type === 'streamable-http' || server.type === 'sse')")
    expect(draftBody).toContain("mode: isRemote ? 'remote' : 'stdio'")
    expect(draftBody).toContain("type: server.type === 'sse' ? 'sse' : 'streamable-http'")
    expect(draftBody).toContain("url: server.url ?? ''")
    expect(draftBody).not.toContain("url: '',")
  })

  it('updates selected MCP detail after project approval changes', () => {
    const approvalStart = rendererSource.indexOf('async function setProjectMcpApproval')
    const approvalEnd = rendererSource.indexOf('async function setUserMcpEnabled', approvalStart)
    const approvalBody = rendererSource.slice(approvalStart, approvalEnd)

    expect(approvalBody).toContain('const updatedSelectedMcpDetail = servers.find(server =>')
    expect(approvalBody).toContain('server.name.trim() === selectedMcpName &&')
    expect(approvalBody).toContain('server.sourcePath === selectedMcpDetail?.sourcePath')
    expect(approvalBody).toContain('if (updatedSelectedMcpDetail) setSelectedMcpDetail(updatedSelectedMcpDetail)')
    expect(approvalBody.indexOf('const updatedSelectedMcpDetail = servers.find(server =>')).toBeGreaterThan(
      approvalBody.indexOf('if (activeSessionIdRef.current !== session.id) return'),
    )
    expect(approvalBody.indexOf('if (updatedSelectedMcpDetail) setSelectedMcpDetail(updatedSelectedMcpDetail)')).toBeLessThan(
      approvalBody.indexOf('await refreshWorkspace(session)'),
    )
  })

  it('updates selected MCP detail after user enable changes', () => {
    const enabledStart = rendererSource.indexOf('async function setUserMcpEnabled')
    const enabledEnd = rendererSource.indexOf('function editMcpServer', enabledStart)
    const enabledBody = rendererSource.slice(enabledStart, enabledEnd)

    expect(enabledBody).toContain('const updatedSelectedMcpDetail = servers.find(server =>')
    expect(enabledBody).toContain("selectedMcpDetailScope === 'user' &&")
    expect(enabledBody).toContain('server.name.trim() === selectedMcpName &&')
    expect(enabledBody).toContain('server.sourcePath === selectedMcpDetail?.sourcePath')
    expect(enabledBody).toContain('if (updatedSelectedMcpDetail) setSelectedMcpDetail(updatedSelectedMcpDetail)')
    expect(enabledBody.indexOf('const updatedSelectedMcpDetail = servers.find(server =>')).toBeGreaterThan(
      enabledBody.indexOf('setDesktopConfig(prev => prev'),
    )
    expect(enabledBody.indexOf('if (updatedSelectedMcpDetail) setSelectedMcpDetail(updatedSelectedMcpDetail)')).toBeLessThan(
      enabledBody.indexOf('await refreshDesktopConfig()'),
    )
  })

  it('guards agent diagnostics against duplicate lifecycle requests', () => {
    const start = rendererSource.indexOf('async function diagnoseAgentByType')
    const end = rendererSource.indexOf('async function saveAgentDraft', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const session = activeSession')
    expect(body).toContain("const actionKey = `${session.id}:${agentType}:diagnose`")
    expect(body).toContain('if (agentDiagnosticActionPendingRef.current.has(actionKey)) return')
    expect(body.indexOf('agentDiagnosticActionPendingRef.current.add(actionKey)')).toBeLessThan(
      body.indexOf("await runAction('Diagnosing agent'"),
    )
    expect(body).toContain('agentDiagnosticActionPendingRef.current.delete(actionKey)')
  })

  it('blocks agent and team refresh entrypoints while loading', () => {
    const refreshStart = rendererSource.indexOf('async function refreshAgents')
    const refreshEnd = rendererSource.indexOf('async function selectAgent', refreshStart)
    const refreshBody = rendererSource.slice(refreshStart, refreshEnd)
    const toolbarStart = rendererSource.indexOf("activePane === 'teams'")
    const toolbarEnd = rendererSource.indexOf('<nav className="pane-jumpbar"', toolbarStart)
    const toolbarBody = rendererSource.slice(toolbarStart, toolbarEnd)

    expect(refreshBody).toContain('if (loadingLabel) return')
    expect(refreshBody.indexOf('if (loadingLabel) return')).toBeLessThan(
      refreshBody.indexOf('if (agentRefreshActionPendingRef.current) return'),
    )
    expect(rendererSource).toContain('function handleAgentsRefreshClick(): void')
    expect(toolbarBody).toContain('<button className="tool-button" onClick={handleAgentsRefreshClick} disabled={(activePane === \'teams\' && !activeSession) || !!loadingLabel}>')
    expect(toolbarBody).not.toContain('onClick={() => !loadingLabel && void refreshAgents()}')
    expect(toolbarBody).not.toContain("(activePane !== 'teams' || activeSession) && !loadingLabel && void refreshAgents()")
  })

  it('refreshes user agents without an active project session', () => {
    const refreshStart = rendererSource.indexOf('async function refreshAgents')
    const refreshEnd = rendererSource.indexOf('async function selectAgent', refreshStart)
    const refreshBody = rendererSource.slice(refreshStart, refreshEnd)

    expect(refreshBody).toContain("const cwd = session?.cwd ?? ''")
    expect(refreshBody).toContain('window.claudeDesktop.agents.refresh(cwd)')
    expect(refreshBody).toContain('if (session) {')
    expect(refreshBody).toContain('window.claudeDesktop.teams.list(session.cwd)')
    expect(refreshBody).toContain('if (session && activeSessionIdRef.current !== session.id) return')
    expect(refreshBody).toContain("setAgentsStatus({ kind: 'success', text: session ? 'Refreshed agents and teams.' : 'Refreshed user agents.' })")
  })

  it('guides no-session agent catalog users to refresh user agents instead of selecting a session', () => {
    const catalogStart = rendererSource.indexOf('<section className="settings-section" id="agents-catalog">')
    const catalogEnd = rendererSource.indexOf('{selectedAgent && (', catalogStart)
    const catalogBody = rendererSource.slice(catalogStart, catalogEnd)

    expect(catalogBody).not.toContain('Select a session to load available agents.')
    expect(catalogBody).toContain('Refresh to load built-in and user agents.')
    expect(rendererSource).toContain('<button className="tool-button" onClick={handleAgentsRefreshClick} disabled={(activePane === \'teams\' && !activeSession) || !!loadingLabel}>')
  })

  it('keeps user-level first-class pages stable without an active project session', () => {
    const noSessionMarker = rendererSource.indexOf('activeSessionIdRef.current = undefined')
    const noSessionStart = rendererSource.lastIndexOf("if (!activeSession) {", noSessionMarker)
    const noSessionEnd = rendererSource.indexOf('return', noSessionStart)
    const noSessionBody = rendererSource.slice(noSessionStart, noSessionEnd)

    expect(noSessionBody).not.toContain("setPrimaryNavView('chat')")
    expect(noSessionBody).not.toContain("setTasksActiveSection('tasks-project-tasks')")
    expect(noSessionBody).not.toContain('setTaskDraft(emptyTaskDraft())')
    expect(noSessionBody).toContain('setProjectTaskDraft(emptyProjectTaskDraft())')

    const openPrimaryStart = rendererSource.indexOf('function openPrimaryView')
    const openPrimaryEnd = rendererSource.indexOf('useEffect(() => {', openPrimaryStart)
    const openPrimaryBody = rendererSource.slice(openPrimaryStart, openPrimaryEnd)

    expect(openPrimaryBody).toContain("const defaultTasksSection = activeSession ? 'tasks-project-tasks' : 'tasks-global-tasks'")
    expect(openPrimaryBody).toContain("void openPaneSection('tasks', defaultTasksSection, 'tasks')")

    expect(rendererSource).toContain('function effectiveTasksActiveSection(): string')
    const effectiveTasksStart = rendererSource.indexOf('function effectiveTasksActiveSection(): string')
    const effectiveTasksEnd = rendererSource.indexOf('function openTasksSection', effectiveTasksStart)
    const effectiveTasksBody = rendererSource.slice(effectiveTasksStart, effectiveTasksEnd)
    expect(effectiveTasksBody).toContain("return activeSession ? tasksActiveSection : 'tasks-global-tasks'")

    const tasksActionStart = rendererSource.indexOf('function runDesktopTasksAction')
    const tasksActionEnd = rendererSource.indexOf('function runDesktopLifecycleAction', tasksActionStart)
    const tasksActionBody = rendererSource.slice(tasksActionStart, tasksActionEnd)
    expect(tasksActionBody).toContain("openPaneSection('tasks', effectiveTasksActiveSection(), 'tasks', { showStatus: false })")
  })

  it('blocks session-bound native lifecycle drafts without an active project session', () => {
    const teamStart = rendererSource.indexOf('function startNewTeamDraft(): void')
    const teamEnd = rendererSource.indexOf('const workspaceRef', teamStart)
    const teamBody = rendererSource.slice(teamStart, teamEnd)

    expect(teamBody).toContain('if (loadingLabel) return')
    expect(teamBody).toContain('if (!activeSession) {')
    expect(teamBody).toContain("setTeamsStatus({ kind: 'error', text: 'Select a session before creating teams.' })")
    expect(teamBody.indexOf('if (!activeSession) {')).toBeLessThan(
      teamBody.indexOf('setTeamDraft(emptyTeamDraft())'),
    )

    const projectTaskStart = rendererSource.indexOf('function startNewProjectScheduledTaskDraft(): void')
    const projectTaskEnd = rendererSource.indexOf('async function runProjectScheduledTaskNow', projectTaskStart)
    const projectTaskBody = rendererSource.slice(projectTaskStart, projectTaskEnd)

    expect(projectTaskBody).toContain('if (loadingLabel) return')
    expect(projectTaskBody).toContain('if (!activeSession) {')
    expect(projectTaskBody).toContain("setTasksStatus({ kind: 'error', text: 'Select a session before creating project scheduled tasks.' })")
    expect(projectTaskBody.indexOf('if (!activeSession) {')).toBeLessThan(
      projectTaskBody.indexOf('setProjectTaskDraft(emptyProjectTaskDraft())'),
    )
  })

  it('disables agent diagnostics setup shortcuts while loading', () => {
    const diagnosticsStart = rendererSource.indexOf('{agentDiagnostics && (')
    const diagnosticsEnd = rendererSource.indexOf('<section className="settings-section" id="agents-editor">', diagnosticsStart)
    const diagnosticsBody = rendererSource.slice(diagnosticsStart, diagnosticsEnd)

    expect(rendererSource).toContain('function handleAgentDiagnosticsMcpSettingsClick(): void')
    expect(rendererSource).toContain('function handleAgentDiagnosticsSkillsSettingsClick(): void')
    expect(diagnosticsBody).toContain('onClick={handleAgentDiagnosticsMcpSettingsClick}')
    expect(diagnosticsBody).toContain('onClick={handleAgentDiagnosticsSkillsSettingsClick}')
    expect(diagnosticsBody).not.toContain("void openPaneSection('settings', 'settings-mcp')")
    expect(diagnosticsBody).not.toContain("onClick={() => !loadingLabel && void openPaneSection('settings', 'settings-skills')}")
    expect(diagnosticsBody).toContain('disabled={!!loadingLabel}')
  })

  it('guards session folder open actions against duplicate OS requests', () => {
    const start = rendererSource.indexOf('async function openSessionFolder')
    const end = rendererSource.indexOf('async function openFile', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (sessionOpenFolderActionPendingRef.current.has(sessionId)) return')
    expect(body.indexOf('sessionOpenFolderActionPendingRef.current.add(sessionId)')).toBeLessThan(
      body.indexOf('window.claudeDesktop.workspace.openFolder(session.cwd)'),
    )
    expect(body).toContain('sessionOpenFolderActionPendingRef.current.delete(sessionId)')
  })

  it('shows a session error when stale Open folder actions lose their session', () => {
    const start = rendererSource.indexOf('async function openSessionFolder')
    const end = rendererSource.indexOf('async function openFile', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain("if (!session) {")
    expect(body).toContain("setSessionStatus({ kind: 'error', text: 'Session is no longer available.' })")
    expect(body.indexOf("if (!session) {")).toBeLessThan(
      body.indexOf('sessionOpenFolderActionPendingRef.current.add(sessionId)'),
    )
    expect(body.indexOf("if (!session) {")).toBeLessThan(
      body.indexOf('window.claudeDesktop.workspace.openFolder(session.cwd)'),
    )
  })

  it('guards skill removal confirmation against duplicate destructive submissions', () => {
    const userStart = rendererSource.indexOf('async function removeUserSkill')
    const userEnd = rendererSource.indexOf('async function removeProjectSkill', userStart)
    const userBody = rendererSource.slice(userStart, userEnd)
    const projectStart = rendererSource.indexOf('async function removeProjectSkill')
    const projectEnd = rendererSource.indexOf('async function saveMcpServer', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)

    expect(userBody).toContain("const actionKey = `user:remove:${removedSkillName}`")
    expect(userBody.indexOf('skillActionPendingRef.current.add(actionKey)')).toBeLessThan(
      userBody.indexOf('requestConfirmation({'),
    )
    expect(userBody).toContain("await runSkillAction(actionKey, 'Removing skill'")
    expect(projectBody).toContain("const actionKey = `${session.id}:project:remove:${removedSkillName}`")
    expect(projectBody.indexOf('skillActionPendingRef.current.add(actionKey)')).toBeLessThan(
      projectBody.indexOf('requestConfirmation({'),
    )
    expect(projectBody).toContain("await runSkillAction(actionKey, 'Removing project skill'")
  })

  it('shows a Settings error when project skill removal has no active session', () => {
    const start = rendererSource.indexOf('async function removeProjectSkill')
    const end = rendererSource.indexOf('async function saveMcpServer', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain("if (!activeSession)")
    expect(body).toContain("text: 'Select a session before editing project skills.'")
    expect(body.indexOf("if (!activeSession)")).toBeLessThan(
      body.indexOf("const actionKey = `${session.id}:project:remove:${removedSkillName}`"),
    )
    expect(body.indexOf("if (!activeSession)")).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
  })

  it('shows a Settings error when project skill inspect or edit has no active session', () => {
    const inspectStart = rendererSource.indexOf('async function inspectProjectSkill')
    const inspectEnd = rendererSource.indexOf('function startNewUserSkillDraft', inspectStart)
    const inspectBody = rendererSource.slice(inspectStart, inspectEnd)
    const editStart = rendererSource.indexOf('async function editProjectSkill')
    const editEnd = rendererSource.indexOf('function cancelSkillDraft', editStart)
    const editBody = rendererSource.slice(editStart, editEnd)

    expect(inspectBody).toContain("if (!activeSession)")
    expect(inspectBody).toContain("text: 'Select a session before editing project skills.'")
    expect(inspectBody.indexOf("if (!activeSession)")).toBeLessThan(
      inspectBody.indexOf('const session = activeSession'),
    )
    expect(inspectBody.indexOf("if (!activeSession)")).toBeLessThan(
      inspectBody.indexOf('window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)'),
    )

    expect(editBody).toContain("if (!activeSession)")
    expect(editBody).toContain("text: 'Select a session before editing project skills.'")
    expect(editBody.indexOf("if (!activeSession)")).toBeLessThan(
      editBody.indexOf('const session = activeSession'),
    )
    expect(editBody.indexOf("if (!activeSession)")).toBeLessThan(
      editBody.indexOf('window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)'),
    )
  })

  it('shows a Settings error before skill actions run with a missing skill name', () => {
    const inspectUserStart = rendererSource.indexOf('async function inspectUserSkill')
    const inspectUserEnd = rendererSource.indexOf('async function inspectProjectSkill', inspectUserStart)
    const inspectUserBody = rendererSource.slice(inspectUserStart, inspectUserEnd)
    const inspectProjectStart = rendererSource.indexOf('async function inspectProjectSkill')
    const inspectProjectEnd = rendererSource.indexOf('function startNewUserSkillDraft', inspectProjectStart)
    const inspectProjectBody = rendererSource.slice(inspectProjectStart, inspectProjectEnd)
    const detailEditStart = rendererSource.indexOf('function editSkillDetail')
    const detailEditEnd = rendererSource.indexOf('async function editUserSkill', detailEditStart)
    const detailEditBody = rendererSource.slice(detailEditStart, detailEditEnd)
    const editUserStart = rendererSource.indexOf('async function editUserSkill')
    const editUserEnd = rendererSource.indexOf('async function editProjectSkill', editUserStart)
    const editUserBody = rendererSource.slice(editUserStart, editUserEnd)
    const editProjectStart = rendererSource.indexOf('async function editProjectSkill')
    const editProjectEnd = rendererSource.indexOf('function cancelSkillDraft', editProjectStart)
    const editProjectBody = rendererSource.slice(editProjectStart, editProjectEnd)
    const removeUserStart = rendererSource.indexOf('async function removeUserSkill')
    const removeUserEnd = rendererSource.indexOf('async function removeProjectSkill', removeUserStart)
    const removeUserBody = rendererSource.slice(removeUserStart, removeUserEnd)
    const removeProjectStart = rendererSource.indexOf('async function removeProjectSkill')
    const removeProjectEnd = rendererSource.indexOf('async function saveMcpServer', removeProjectStart)
    const removeProjectBody = rendererSource.slice(removeProjectStart, removeProjectEnd)
    const skillName = 'const selectedSkillName = skill.name.trim()'
    const skillGuard = 'if (!selectedSkillName) {'
    const detailName = 'const selectedSkillName = detail.name.trim()'
    const detailGuard = 'if (!selectedSkillName) {'
    const removedName = 'const removedSkillName = skill.name.trim()'
    const removeGuard = 'if (!removedSkillName) {'

    for (const body of [inspectUserBody, inspectProjectBody, editUserBody, editProjectBody]) {
      expect(body).toContain(skillName)
      expect(body.indexOf(skillName)).toBeLessThan(
        body.indexOf(skillGuard),
      )
    }
    expect(inspectUserBody).toContain(skillGuard)
    expect(inspectUserBody).toContain("text: 'Select a skill before inspecting.'")
    expect(inspectUserBody.indexOf(skillGuard)).toBeLessThan(
      inspectUserBody.indexOf('await window.claudeDesktop.skills.read(selectedSkillName)'),
    )

    expect(inspectProjectBody).toContain(skillGuard)
    expect(inspectProjectBody).toContain("text: 'Select a project skill before inspecting.'")
    expect(inspectProjectBody.indexOf(skillGuard)).toBeLessThan(
      inspectProjectBody.indexOf('await window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)'),
    )

    expect(detailEditBody).toContain(detailName)
    expect(detailEditBody.indexOf(detailName)).toBeLessThan(
      detailEditBody.indexOf(detailGuard),
    )
    expect(detailEditBody).toContain(detailGuard)
    expect(detailEditBody).toContain("scope === 'project' ? 'Select a project skill before editing.' : 'Select a skill before editing.'")
    expect(detailEditBody.indexOf(detailGuard)).toBeLessThan(
      detailEditBody.indexOf('setSkillDraft({ ...skillDraftFromDetail(detail, scope), name: selectedSkillName, editingName: selectedSkillName })'),
    )

    expect(editUserBody).toContain(skillGuard)
    expect(editUserBody).toContain("text: 'Select a skill before editing.'")
    expect(editUserBody.indexOf(skillGuard)).toBeLessThan(
      editUserBody.indexOf('await window.claudeDesktop.skills.read(selectedSkillName)'),
    )

    expect(editProjectBody).toContain(skillGuard)
    expect(editProjectBody).toContain("text: 'Select a project skill before editing.'")
    expect(editProjectBody.indexOf(skillGuard)).toBeLessThan(
      editProjectBody.indexOf('await window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)'),
    )

    for (const body of [removeUserBody, removeProjectBody]) {
      expect(body).toContain(removedName)
      expect(body.indexOf(removedName)).toBeLessThan(
        body.indexOf(removeGuard),
      )
    }
    expect(removeUserBody).toContain(removeGuard)
    expect(removeUserBody).toContain("text: 'Select a skill before removing.'")
    expect(removeUserBody.indexOf(removeGuard)).toBeLessThan(
      removeUserBody.indexOf('requestConfirmation({'),
    )

    expect(removeProjectBody).toContain(removeGuard)
    expect(removeProjectBody).toContain("text: 'Select a project skill before removing.'")
    expect(removeProjectBody.indexOf(removeGuard)).toBeLessThan(
      removeProjectBody.indexOf('requestConfirmation({'),
    )
  })

  it('normalizes Skill management targets before IPC and feedback', () => {
    const inspectUserStart = rendererSource.indexOf('async function inspectUserSkill')
    const inspectUserEnd = rendererSource.indexOf('async function inspectProjectSkill', inspectUserStart)
    const inspectUserBody = rendererSource.slice(inspectUserStart, inspectUserEnd)
    const inspectProjectStart = rendererSource.indexOf('async function inspectProjectSkill')
    const inspectProjectEnd = rendererSource.indexOf('function startNewUserSkillDraft', inspectProjectStart)
    const inspectProjectBody = rendererSource.slice(inspectProjectStart, inspectProjectEnd)
    const detailEditStart = rendererSource.indexOf('function editSkillDetail')
    const detailEditEnd = rendererSource.indexOf('async function editUserSkill', detailEditStart)
    const detailEditBody = rendererSource.slice(detailEditStart, detailEditEnd)
    const editUserStart = rendererSource.indexOf('async function editUserSkill')
    const editUserEnd = rendererSource.indexOf('async function editProjectSkill', editUserStart)
    const editUserBody = rendererSource.slice(editUserStart, editUserEnd)
    const editProjectStart = rendererSource.indexOf('async function editProjectSkill')
    const editProjectEnd = rendererSource.indexOf('function cancelSkillDraft', editProjectStart)
    const editProjectBody = rendererSource.slice(editProjectStart, editProjectEnd)
    const removeUserStart = rendererSource.indexOf('async function removeUserSkill')
    const removeUserEnd = rendererSource.indexOf('async function removeProjectSkill', removeUserStart)
    const removeUserBody = rendererSource.slice(removeUserStart, removeUserEnd)
    const removeProjectStart = rendererSource.indexOf('async function removeProjectSkill')
    const removeProjectEnd = rendererSource.indexOf('async function saveMcpServer', removeProjectStart)
    const removeProjectBody = rendererSource.slice(removeProjectStart, removeProjectEnd)

    expect(inspectUserBody).toContain('const selectedSkillName = skill.name.trim()')
    expect(inspectUserBody).toContain('await runSkillAction(`user:read:${selectedSkillName}`')
    expect(inspectUserBody).toContain('const detail = await window.claudeDesktop.skills.read(selectedSkillName)')
    expect(inspectUserBody).toContain('setSettingsStatus({ kind: \'info\', text: `Inspecting user skill "${selectedSkillName}".` })')

    expect(inspectProjectBody).toContain('const selectedSkillName = skill.name.trim()')
    expect(inspectProjectBody).toContain('await runSkillAction(`${session.id}:project:read:${selectedSkillName}`')
    expect(inspectProjectBody).toContain('const detail = await window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)')
    expect(inspectProjectBody).toContain('setSettingsStatus({ kind: \'info\', text: `Inspecting project skill "${selectedSkillName}".` })')

    expect(detailEditBody).toContain('const selectedSkillName = detail.name.trim()')
    expect(detailEditBody).toContain('setSkillDraft({ ...skillDraftFromDetail(detail, scope), name: selectedSkillName, editingName: selectedSkillName })')
    expect(detailEditBody).toContain('setSettingsStatus({ kind: \'info\', text: `Editing ${scope} skill "${selectedSkillName}".` })')

    expect(editUserBody).toContain('const selectedSkillName = skill.name.trim()')
    expect(editUserBody).toContain('await runSkillAction(`user:edit:${selectedSkillName}`')
    expect(editUserBody).toContain('const detail = await window.claudeDesktop.skills.read(selectedSkillName)')

    expect(editProjectBody).toContain('const selectedSkillName = skill.name.trim()')
    expect(editProjectBody).toContain('await runSkillAction(`${session.id}:project:edit:${selectedSkillName}`')
    expect(editProjectBody).toContain('const detail = await window.claudeDesktop.workspaceSkills.read(session.cwd, selectedSkillName)')

    expect(removeUserBody).toContain('const removedSkillName = skill.name.trim()')
    expect(removeUserBody).toContain('const actionKey = `user:remove:${removedSkillName}`')
    expect(removeUserBody).toContain('message: `Remove user skill "${removedSkillName}" from Claude Code settings.`')
    expect(removeUserBody).toContain('const skills = await window.claudeDesktop.skills.remove(removedSkillName)')
    expect(removeUserBody).toContain('if (skillDraft?.editingName?.trim() === removedSkillName && skillDraft.scope === \'user\') {')
    expect(removeUserBody).toContain('if (selectedSkillDetailScope === \'user\' && selectedSkillDetail?.name.trim() === removedSkillName && selectedSkillDetail.path === skill.path) {')
    expect(removeUserBody).toContain('setSettingsStatus({ kind: \'success\', text: `Removed user skill "${removedSkillName}".` })')

    expect(removeProjectBody).toContain('const removedSkillName = skill.name.trim()')
    expect(removeProjectBody).toContain('const actionKey = `${session.id}:project:remove:${removedSkillName}`')
    expect(removeProjectBody).toContain('message: `Remove project skill "${removedSkillName}" from this workspace.`')
    expect(removeProjectBody).toContain('removedSkillName,')
    expect(removeProjectBody).toContain('if (skillDraft?.editingName?.trim() === removedSkillName && skillDraft.scope === \'project\') {')
    expect(removeProjectBody).toContain('if (selectedSkillDetailScope === \'project\' && selectedSkillDetail?.name.trim() === removedSkillName && selectedSkillDetail.path === skill.path) {')
    expect(removeProjectBody).toContain('setSettingsStatus({ kind: \'success\', text: `Removed project skill "${removedSkillName}".` })')
  })

  it('shows a Settings error before Skill and MCP saves run with an invalid scope', () => {
    const skillStart = rendererSource.indexOf('async function saveSkillDraft')
    const skillEnd = rendererSource.indexOf('async function removeUserSkill', skillStart)
    const skillBody = rendererSource.slice(skillStart, skillEnd)
    const mcpStart = rendererSource.indexOf('async function saveMcpServer')
    const mcpEnd = rendererSource.indexOf('async function removeMcpServer', mcpStart)
    const mcpBody = rendererSource.slice(mcpStart, mcpEnd)
    const scopeGuard = 'if (!isUserProjectScope(scope)) {'

    expect(rendererSource).toContain('function isUserProjectScope(scope: string): scope is \'user\' | \'project\'')
    expect(skillBody).toContain('const scope = skillDraft.scope as string')
    expect(skillBody).toContain(scopeGuard)
    expect(skillBody).toContain("text: 'Choose a valid skill scope before saving.'")
    expect(skillBody.indexOf(scopeGuard)).toBeLessThan(
      skillBody.indexOf('const session = activeSession'),
    )
    expect(skillBody.indexOf(scopeGuard)).toBeLessThan(
      skillBody.indexOf('const actionKey = `${scope === \'project\' ? session?.id : \'user\'}:${scope}:save-skill:${editingSkillName ?? name}`'),
    )

    expect(mcpBody).toContain('const scope = mcpDraft.scope as string')
    expect(mcpBody).toContain(scopeGuard)
    expect(mcpBody).toContain("text: 'Choose a valid MCP scope before saving.'")
    expect(mcpBody.indexOf(scopeGuard)).toBeLessThan(
      mcpBody.indexOf('const session = activeSession'),
    )
    expect(mcpBody.indexOf(scopeGuard)).toBeLessThan(
      mcpBody.indexOf("const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:save:${editingMcpName ?? name}`"),
    )
  })

  it('normalizes Skill and MCP save edit targets before action keys and removal IPC', () => {
    const skillStart = rendererSource.indexOf('async function saveSkillDraft')
    const skillEnd = rendererSource.indexOf('async function removeUserSkill', skillStart)
    const skillBody = rendererSource.slice(skillStart, skillEnd)
    const mcpStart = rendererSource.indexOf('async function saveMcpServer')
    const mcpEnd = rendererSource.indexOf('async function removeMcpServer', mcpStart)
    const mcpBody = rendererSource.slice(mcpStart, mcpEnd)

    expect(skillBody).toContain('const editingSkillName = skillDraft.editingName?.trim()')
    expect(skillBody).toContain("const actionKey = `${scope === 'project' ? session?.id : 'user'}:${scope}:save-skill:${editingSkillName ?? name}`")
    expect(skillBody).toContain('editingSkillName &&')
    expect(skillBody).toContain('editingSkillName !== name')
    expect(skillBody).toContain('await window.claudeDesktop.workspaceSkills.remove(session.cwd, editingSkillName)')
    expect(skillBody).toContain('await window.claudeDesktop.skills.remove(editingSkillName)')

    expect(mcpBody).toContain('const editingMcpName = mcpDraft.editingName?.trim()')
    expect(mcpBody).toContain("const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:save:${editingMcpName ?? name}`")
    expect(mcpBody).toContain('if (editingMcpName && editingMcpName !== name) {')
    expect(mcpBody).toContain('await window.claudeDesktop.workspaceMcp.remove(projectSession.cwd, editingMcpName)')
    expect(mcpBody).toContain('await window.claudeDesktop.mcp.remove(editingMcpName)')
  })

  it('shows a Settings error before MCP saves run with an invalid transport mode or remote type', () => {
    const canSaveStart = rendererSource.indexOf('function canSaveMcpDraft')
    const canSaveEnd = rendererSource.indexOf('function emptySkillDraft', canSaveStart)
    const canSaveBody = rendererSource.slice(canSaveStart, canSaveEnd)
    const mcpStart = rendererSource.indexOf('async function saveMcpServer')
    const mcpEnd = rendererSource.indexOf('async function removeMcpServer', mcpStart)
    const mcpBody = rendererSource.slice(mcpStart, mcpEnd)
    const modeGuard = 'if (!isMcpMode(mcpDraft.mode)) {'
    const typeGuard = "if (mcpDraft.mode === 'remote' && !isMcpRemoteType(mcpDraft.type)) {"
    const urlGuard = "if (mcpDraft.mode === 'remote' && !isHttpUrl(mcpDraft.url.trim())) {"

    expect(rendererSource).toContain('function isMcpMode(mode: string): mode is McpDraft[\'mode\']')
    expect(rendererSource).toContain('function isMcpRemoteType(type: string): type is McpDraft[\'type\']')
    expect(canSaveBody).toContain('if (!isMcpMode(draft.mode)) return false')
    expect(canSaveBody).toContain("if (draft.mode === 'remote' && !isMcpRemoteType(draft.type)) return false")
    expect(canSaveBody).toContain("if (draft.mode === 'remote') return isHttpUrl(draft.url.trim())")
    expect(canSaveBody).not.toContain('if (draft.editingName && !draft.url.trim()) return true')

    expect(mcpBody).toContain(modeGuard)
    expect(mcpBody).toContain("text: 'Choose a valid MCP transport mode before saving.'")
    expect(mcpBody.indexOf(modeGuard)).toBeLessThan(
      mcpBody.indexOf('const session = activeSession'),
    )
    expect(mcpBody.indexOf(modeGuard)).toBeLessThan(
      mcpBody.indexOf("const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:save:${editingMcpName ?? name}`"),
    )

    expect(mcpBody).toContain(typeGuard)
    expect(mcpBody).toContain("text: 'Choose a valid MCP remote type before saving.'")
    expect(mcpBody.indexOf(typeGuard)).toBeLessThan(
      mcpBody.indexOf('const session = activeSession'),
    )
    expect(mcpBody.indexOf(typeGuard)).toBeLessThan(
      mcpBody.indexOf("const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:save:${editingMcpName ?? name}`"),
    )

    expect(mcpBody).toContain(urlGuard)
    expect(mcpBody).toContain("text: 'Enter a valid MCP remote URL before saving.'")
    expect(mcpBody.indexOf(urlGuard)).toBeLessThan(
      mcpBody.indexOf('const session = activeSession'),
    )
    expect(mcpBody.indexOf(urlGuard)).toBeLessThan(
      mcpBody.indexOf("const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:save:${editingMcpName ?? name}`"),
    )
  })

  it('clears project-scoped settings and lifecycle state before refreshing a newly focused session', () => {
    const start = rendererSource.indexOf("if (!activeSession) {")
    const end = rendererSource.indexOf("void runAction('Refreshing workspace'", start)
    const body = rendererSource.slice(start, end)
    const activeBranch = body.slice(body.indexOf('activeSessionIdRef.current = activeSession.id'))

    expect(activeBranch).toContain('activeSessionIdRef.current = activeSession.id')
    expect(activeBranch).toContain('setProjectTasks([])')
    expect(activeBranch).toContain('setProjectMcpServers([])')
    expect(activeBranch).toContain('setSelectedMcpDetail(undefined)')
    expect(activeBranch).toContain('setProjectSkills([])')
    expect(activeBranch).toContain('setSelectedSkillDetail(undefined)')
    expect(activeBranch).toContain('setAgentList({ activeAgents: [], allAgents: [] })')
    expect(activeBranch).toContain('setTeams([])')
  })

  it('clears project-scoped edit drafts and selections before refreshing a newly focused session', () => {
    const start = rendererSource.indexOf("if (!activeSession) {")
    const end = rendererSource.indexOf("void runAction('Refreshing workspace'", start)
    const body = rendererSource.slice(start, end)
    const activeBranch = body.slice(body.indexOf('activeSessionIdRef.current = activeSession.id'))

    expect(activeBranch).toContain('setMcpDraft(prev =>')
    expect(activeBranch).toContain("prev.scope === 'project' ? emptyMcpDraft() : prev")
    expect(activeBranch).toContain('setProjectTaskDraft(emptyProjectTaskDraft())')
    expect(activeBranch).toContain('setAgentDraft(prev =>')
    expect(activeBranch).toContain("prev.source === 'project' ? emptyAgentDraft() : prev")
    expect(activeBranch).toContain('setSelectedAgentType(activeSession.layout.selectedAgentType)')
    expect(activeBranch).toContain('setSelectedAgentSource(activeSession.layout.selectedAgentSource as AgentSource | undefined)')
    expect(activeBranch).toContain('activeSession.layout.selectedAgentType')
    expect(activeBranch).toContain('agentType: activeSession.layout.selectedAgentType')
    expect(activeBranch).toContain('activeSession.layout.selectedTeamName')
    expect(activeBranch).toContain('const restoredTeamRecipient = activeSession.layout.selectedTeamRecipient ?? (activeSession.layout.selectedTeamName ? \'*\' : \'\')')
    expect(activeBranch).toContain("teamName: activeSession.layout.selectedTeamName ?? ''")
    expect(activeBranch).toContain('to: restoredTeamRecipient')
    const restoredChatTargetStart = activeBranch.indexOf('setChatTarget({')
    const restoredChatTargetEnd = activeBranch.indexOf('})', restoredChatTargetStart)
    const restoredChatTargetBody = activeBranch.slice(restoredChatTargetStart, restoredChatTargetEnd)
    expect(restoredChatTargetBody).toContain("type: activeSession.layout.selectedTeamName")
    expect(restoredChatTargetBody).toContain("? 'team'")
    expect(restoredChatTargetBody).toContain(": activeSession.layout.selectedAgentType")
    expect(restoredChatTargetBody).toContain("? 'agent'")
    expect(restoredChatTargetBody).toContain("agentType: activeSession.layout.selectedTeamName ? '' : activeSession.layout.selectedAgentType ?? ''")
    expect(activeBranch).toContain('const selectedGlobalTaskId = activeSession.layout.selectedGlobalTaskId?.trim()')
    expect(activeBranch).toContain('desktopConfig?.scheduledTasks.find(task => task.id.trim() === selectedGlobalTaskId)')
    expect(activeBranch).toContain('setTaskDraft(restoredGlobalTask ? { ...taskDraftFromTask(restoredGlobalTask), id: selectedGlobalTaskId } : emptyTaskDraft())')
  })

  it('persists selected agent identity when selecting catalog rows', () => {
    const start = rendererSource.indexOf('async function selectAgent(agent: AgentInfo): Promise<void>')
    const end = rendererSource.indexOf('async function diagnoseAgentByType', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const session = activeSession')
    expect(body).toContain('if (session) await updateSessionLayout(session.id, {')
    expect(body).not.toContain('await updateLayout({')
    expect(body).toContain('selectedAgentType: agentType')
    expect(body).toContain('selectedAgentSource: agent.source')
  })

  it('records restored selected agent identity in electron smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const selectStart = smokeSource.indexOf("assertAgentsStatus(page, 'Selected agent desktop-smoke-agent.', 'info')")
    const selectEnd = smokeSource.indexOf('const selectedAgentSection = page.locator', selectStart)
    const selectBody = smokeSource.slice(selectStart, selectEnd)
    const fixtureStart = smokeSource.indexOf('const agentRestoreSessionId = await page.evaluate')
    const fixtureEnd = smokeSource.indexOf('const settingsRestoreSessionId = await page.evaluate', fixtureStart)
    const fixtureBody = smokeSource.slice(fixtureStart, fixtureEnd)
    const restoreStart = smokeSource.indexOf('const agentRestoreState = await restoredPage.evaluate')
    const restoreEnd = smokeSource.indexOf('await focusSmokeSessionDirect(restoredPage, settingsRestoreSessionId)', restoreStart)
    const restoreBody = smokeSource.slice(restoreStart, restoreEnd)

    expect(selectBody).toContain("session?.layout.selectedAgentType === 'desktop-smoke-agent'")
    expect(selectBody).toContain("session?.layout.selectedAgentSource === 'built-in'")
    expect(fixtureBody).toContain("selectedAgentType: 'desktop-smoke-agent'")
    expect(fixtureBody).toContain("selectedAgentSource: 'built-in'")
    expect(restoreBody).toContain('selectedAgentType: session?.layout.selectedAgentType')
    expect(restoreBody).toContain('selectedAgentSource: session?.layout.selectedAgentSource')
    expect(restoreBody).toContain("activeSelectedAgent?.getAttribute('aria-current') === 'true'")
    expect(restoreBody).toContain("agentRestoreState.selectedAgentType === 'desktop-smoke-agent'")
    expect(restoreBody).toContain("agentRestoreState.selectedAgentSource === 'built-in'")
    expect(smokeSource).toContain('selectedAgentStateRestored: true')
  })

  it('clears stale selected agent layout after agent lists load', () => {
    const helperStart = rendererSource.indexOf('async function clearStaleSelectedAgentSelection')
    const helperEnd = rendererSource.indexOf('async function clearStaleSelectedTeamSelection', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const refreshWorkspaceStart = rendererSource.indexOf('async function refreshWorkspace')
    const refreshWorkspaceEnd = rendererSource.indexOf('async function refreshSessions', refreshWorkspaceStart)
    const refreshWorkspaceBody = rendererSource.slice(refreshWorkspaceStart, refreshWorkspaceEnd)
    const refreshAgentsStart = rendererSource.indexOf('async function refreshAgents(): Promise<void>')
    const refreshAgentsEnd = rendererSource.indexOf('async function selectAgent', refreshAgentsStart)
    const refreshAgentsBody = rendererSource.slice(refreshAgentsStart, refreshAgentsEnd)

    expect(helperBody).toContain('const selectedAgentType = session.layout.selectedAgentType?.trim()')
    expect(helperBody).toContain('nextAgents.allAgents.some(agent => agent.agentType.trim() === selectedAgentType)')
    expect(helperBody).toContain('nextAgents.activeAgents.some(agent => agent.agentType.trim() === selectedAgentType)')
    expect(helperBody).toContain('setSelectedAgentType(undefined)')
    expect(helperBody).toContain('setSelectedAgentSource(undefined)')
    expect(helperBody).toContain('setAgentLaunchDraft(prev =>')
    expect(helperBody).toContain('setChatTarget(prev =>')
    expect(helperBody).toContain("prev.type === 'agent' && prev.agentType.trim() === selectedAgentType")
    expect(helperBody).toContain("{ type: 'session', teamName: '', agentType: '' }")
    expect(helperBody).toContain('await updateSessionLayout(session.id, {')
    expect(helperBody).toContain('selectedAgentType: undefined')
    expect(helperBody).toContain('selectedAgentSource: undefined')
    expect(refreshWorkspaceBody).toContain("if (agents.status === 'fulfilled') {")
    expect(refreshWorkspaceBody).toContain('setAgentList(agents.value)')
    expect(refreshWorkspaceBody).toContain('await clearStaleSelectedAgentSelection(agents.value, session)')
    expect(refreshAgentsBody).toContain('setAgentList(nextAgents)')
    expect(refreshAgentsBody).toContain('await clearStaleSelectedAgentSelection(nextAgents, session)')
  })

  it('normalizes stale selected agent source to an available same-type agent after agent lists load', () => {
    const helperStart = rendererSource.indexOf('async function clearStaleSelectedAgentSelection')
    const helperEnd = rendererSource.indexOf('async function clearStaleSelectedTeamSelection', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)

    expect(helperBody).toContain('const selectedAgentSource = session.layout.selectedAgentSource')
    expect(helperBody).toContain('const selectedAgent =')
    expect(helperBody).toContain('agent.agentType.trim() === selectedAgentType &&')
    expect(helperBody).toContain('agent.source === selectedAgentSource')
    expect(helperBody).toContain('const fallbackAgent =')
    expect(helperBody).toContain('if (!selectedAgent && fallbackAgent) {')
    expect(helperBody).toContain('setSelectedAgentType(fallbackAgent.agentType)')
    expect(helperBody).toContain('setSelectedAgentSource(fallbackAgent.source)')
    expect(helperBody).toContain('agentType: fallbackAgent.agentType')
    expect(helperBody).toContain('setChatTarget(prev =>')
    expect(helperBody).toContain('prev.type === \'agent\' && prev.agentType.trim() === selectedAgentType')
    expect(helperBody).toContain("agentType: fallbackAgent.agentType")
    expect(helperBody).toContain('selectedAgentType: fallbackAgent.agentType')
    expect(helperBody).toContain('selectedAgentSource: fallbackAgent.source')
    expect(helperBody.indexOf('if (!selectedAgent && fallbackAgent) {')).toBeLessThan(
      helperBody.indexOf('setSelectedAgentType(undefined)'),
    )
  })

  it('persists selected team identity through selection and deletion', () => {
    const selectStart = rendererSource.indexOf('function selectTeam(team: TeamInfo): void')
    const selectEnd = rendererSource.indexOf('function prepareTeamMemberMessage', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const createStart = rendererSource.indexOf('async function createTeam(): Promise<void>')
    const createEnd = rendererSource.indexOf('async function sendTeamMessage', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('function openSettingsNavItem', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)

    expect(selectBody).toContain('const session = activeSession')
    expect(selectBody).toContain("void updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: '*' })")
    expect(selectBody).not.toContain('void updateLayout({')
    expect(createBody).toContain("await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: '*' })")
    expect(deleteBody).toContain('await updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })')
  })

  it('clears selected team identity when starting a new team draft', () => {
    const draftStart = rendererSource.indexOf('function startNewTeamDraft(): void')
    const draftEnd = rendererSource.indexOf('const workspaceRef', draftStart)
    const draftBody = rendererSource.slice(draftStart, draftEnd)

    expect(draftBody).toContain('if (loadingLabel) return')
    expect(draftBody).toContain('if (!activeSession) {')
    expect(draftBody).toContain('setTeamDraft(emptyTeamDraft())')
    expect(draftBody).toContain("type: 'session'")
    expect(draftBody).toContain("teamName: ''")
    expect(draftBody).toContain("agentType: ''")
    expect(draftBody).toContain('const session = activeSession')
    expect(draftBody).toContain('void updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })')
    expect(draftBody).not.toContain('void updateLayout({')
    expect(draftBody).toContain("setTeamsStatus({ kind: 'info', text: 'Ready to create a new team.' })")
    expect(draftBody.indexOf('if (!activeSession) {')).toBeLessThan(
      draftBody.indexOf('setTeamDraft(emptyTeamDraft())'),
    )
    expect(draftBody.indexOf('setChatTarget({')).toBeLessThan(
      draftBody.indexOf('void updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })'),
    )
    expect(draftBody.indexOf('void updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })')).toBeLessThan(
      draftBody.indexOf("setTeamsStatus({ kind: 'info', text: 'Ready to create a new team.' })"),
    )
  })

  it('selects the newly created team for immediate follow-up actions', () => {
    const createStart = rendererSource.indexOf('async function createTeam(): Promise<void>')
    const createEnd = rendererSource.indexOf('async function sendTeamMessage', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)

    expect(createBody).toContain('setTeamDraft(prev => ({')
    expect(createBody).toContain('teamName: input.teamName')
    expect(createBody).toContain("to: '*'")
    expect(createBody).toContain("setChatTarget({")
    expect(createBody).toContain("type: 'team'")
    expect(createBody).toContain('teamName: input.teamName')
    expect(createBody.indexOf('setTeams(nextTeams)')).toBeLessThan(
      createBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(createBody.indexOf('setTeamDraft(prev => ({')).toBeLessThan(
      createBody.indexOf("await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: '*' })"),
    )
  })

  it('keeps sent team message context selected for immediate follow-up actions', () => {
    const sendStart = rendererSource.indexOf('async function sendTeamMessage')
    const sendEnd = rendererSource.indexOf('async function spawnTeamTeammate', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)

    expect(sendBody).toContain('setTeamDraft(prev => ({')
    expect(sendBody).toContain('teamName: input.teamName')
    expect(sendBody).toContain('to: input.to')
    expect(sendBody).toContain("message: ''")
    expect(sendBody).toContain('setChatTarget({')
    expect(sendBody).toContain("type: 'team'")
    expect(sendBody).toContain('teamName: input.teamName')
    expect(sendBody).toContain('await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.to })')
    expect(sendBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      sendBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(sendBody.indexOf('setTeamDraft(prev => ({')).toBeLessThan(
      sendBody.indexOf('setChatTarget({'),
    )
    expect(sendBody.indexOf('setChatTarget({')).toBeLessThan(
      sendBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.to })'),
    )
    expect(sendBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.to })')).toBeLessThan(
      sendBody.indexOf('setTeamsStatus({ kind: \'success\''),
    )
  })

  it('selects spawned teammate context for immediate follow-up actions', () => {
    const spawnStart = rendererSource.indexOf('async function spawnTeamTeammate')
    const spawnEnd = rendererSource.indexOf('async function requestTeamShutdown', spawnStart)
    const spawnBody = rendererSource.slice(spawnStart, spawnEnd)

    expect(spawnBody).toContain('setTeamDraft(prev => ({')
    expect(spawnBody).toContain('teamName: input.teamName')
    expect(spawnBody).toContain('to: input.name')
    expect(spawnBody).toContain("teammateName: ''")
    expect(spawnBody).toContain("teammatePrompt: ''")
    expect(spawnBody).toContain('setChatTarget({')
    expect(spawnBody).toContain("type: 'team'")
    expect(spawnBody).toContain('teamName: input.teamName')
    expect(spawnBody).toContain('await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.name })')
    expect(spawnBody.indexOf('setTeams(nextTeams)')).toBeLessThan(
      spawnBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(spawnBody.indexOf('setTeamDraft(prev => ({')).toBeLessThan(
      spawnBody.indexOf('setChatTarget({'),
    )
    expect(spawnBody.indexOf('setChatTarget({')).toBeLessThan(
      spawnBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.name })'),
    )
    expect(spawnBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.name })')).toBeLessThan(
      spawnBody.indexOf('setTeamsStatus({ kind: \'success\''),
    )
  })

  it('keeps shutdown teammate context selected for immediate follow-up actions', () => {
    const shutdownStart = rendererSource.indexOf('async function requestTeamShutdown')
    const shutdownEnd = rendererSource.indexOf('async function removeTeamMember', shutdownStart)
    const shutdownBody = rendererSource.slice(shutdownStart, shutdownEnd)

    expect(shutdownBody).toContain('setTeamDraft(prev => ({')
    expect(shutdownBody).toContain('teamName: input.teamName')
    expect(shutdownBody).toContain('to: input.to')
    expect(shutdownBody).toContain("shutdownReason: ''")
    expect(shutdownBody).toContain('setChatTarget({')
    expect(shutdownBody).toContain("type: 'team'")
    expect(shutdownBody).toContain('teamName: input.teamName')
    expect(shutdownBody).toContain('await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.to })')
    expect(shutdownBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      shutdownBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(shutdownBody.indexOf('setTeamDraft(prev => ({')).toBeLessThan(
      shutdownBody.indexOf('setChatTarget({'),
    )
    expect(shutdownBody.indexOf('setChatTarget({')).toBeLessThan(
      shutdownBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.to })'),
    )
    expect(shutdownBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: input.teamName, selectedTeamRecipient: input.to })')).toBeLessThan(
      shutdownBody.indexOf('setTeamsStatus({ kind: \'success\''),
    )
  })

  it('keeps team context selected after removing a teammate', () => {
    const removeStart = rendererSource.indexOf('async function removeTeamMember')
    const removeEnd = rendererSource.indexOf('function selectTeam(team: TeamInfo): void', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)

    expect(removeBody).toContain('setTeamDraft(prev => ({')
    expect(removeBody).toContain('teamName,')
    expect(removeBody).toContain("to: prev.to.trim() === memberName ? '' : prev.to")
    expect(removeBody).toContain('setChatTarget({')
    expect(removeBody).toContain("type: 'team'")
    expect(removeBody).toContain('teamName,')
    expect(removeBody).toContain('await updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: nextSelectedTeamRecipient })')
    expect(removeBody.indexOf('setTeams(nextTeams)')).toBeLessThan(
      removeBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(removeBody.indexOf('setTeamDraft(prev => ({')).toBeLessThan(
      removeBody.indexOf('setChatTarget({'),
    )
    expect(removeBody.indexOf('setChatTarget({')).toBeLessThan(
      removeBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: nextSelectedTeamRecipient })'),
    )
    expect(removeBody.indexOf('await updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: nextSelectedTeamRecipient })')).toBeLessThan(
      removeBody.indexOf('setTeamsStatus({ kind: \'success\''),
    )
  })

  it('normalizes selected team identity before writing drafts, layout, and chat target', () => {
    const selectStart = rendererSource.indexOf('function selectTeam(team: TeamInfo): void')
    const selectEnd = rendererSource.indexOf('function prepareTeamMemberMessage', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const normalizedTeamName = 'const teamName = team.name.trim()'

    expect(selectBody).toContain(normalizedTeamName)
    expect(selectBody).toContain('teamName,')
    expect(selectBody).toContain('const session = activeSession')
    expect(selectBody).toContain("void updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: '*' })")
    expect(selectBody).toContain('text: `Selected team ${teamName}.`')
    expect(selectBody.indexOf(normalizedTeamName)).toBeLessThan(
      selectBody.indexOf('teamName,'),
    )
    expect(selectBody.indexOf(normalizedTeamName)).toBeLessThan(
      selectBody.indexOf("void updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: '*' })"),
    )
    expect(selectBody.indexOf(normalizedTeamName)).toBeLessThan(
      selectBody.indexOf('setChatTarget({'),
    )
  })

  it('persists selected team recipient from member and broadcast shortcuts', () => {
    const memberSelectStart = rendererSource.indexOf('function selectTeamMember')
    const memberSelectEnd = rendererSource.indexOf('function prepareTeamMemberMessage', memberSelectStart)
    const memberSelectBody = rendererSource.slice(memberSelectStart, memberSelectEnd)
    const memberMessageStart = rendererSource.indexOf('function prepareTeamMemberMessage')
    const memberMessageEnd = rendererSource.indexOf('function prepareTeamBroadcastMessage', memberMessageStart)
    const memberMessageBody = rendererSource.slice(memberMessageStart, memberMessageEnd)
    const broadcastStart = rendererSource.indexOf('function prepareTeamBroadcastMessage')
    const broadcastEnd = rendererSource.indexOf('function handleTeamDraftTeamNameChange', broadcastStart)
    const broadcastBody = rendererSource.slice(broadcastStart, broadcastEnd)

    expect(memberSelectBody).toContain('const session = activeSession')
    expect(memberSelectBody).toContain('void updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: memberName })')
    expect(memberSelectBody).not.toContain('void updateLayout({')
    expect(memberMessageBody).toContain('const session = activeSession')
    expect(memberMessageBody).toContain('void updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: memberName })')
    expect(memberMessageBody).not.toContain('void updateLayout({')
    expect(broadcastBody).toContain('const session = activeSession')
    expect(broadcastBody).toContain("void updateSessionLayout(session.id, { selectedTeamName: teamName, selectedTeamRecipient: '*' })")
    expect(broadcastBody).not.toContain('void updateLayout({')
  })

  it('records restored selected team identity in electron smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const selectStart = smokeSource.indexOf("assertTeamsStatus(page, 'Selected team frontend.', 'info')")
    const selectEnd = smokeSource.indexOf("await page.locator('#agents-teams input[aria-label=\"Team teammate agent type\"]')", selectStart)
    const selectBody = smokeSource.slice(selectStart, selectEnd)
    const fixtureStart = smokeSource.indexOf('const teamRestoreSessionId = await page.evaluate')
    const fixtureEnd = smokeSource.indexOf('const agentRestoreSessionId = await page.evaluate', fixtureStart)
    const fixtureBody = smokeSource.slice(fixtureStart, fixtureEnd)
    const restoreStart = smokeSource.indexOf('const teamRestoreState = await restoredPage.evaluate')
    const restoreEnd = smokeSource.indexOf('await focusSmokeSessionDirect(restoredPage, agentRestoreSessionId)', restoreStart)
    const restoreBody = smokeSource.slice(restoreStart, restoreEnd)

    expect(selectBody).toContain("session?.layout.selectedTeamName === 'frontend'")
    expect(selectBody).toContain("session?.layout.selectedTeamRecipient === '*'")
    expect(fixtureBody).toContain("selectedTeamName: 'frontend'")
    expect(fixtureBody).toContain("selectedTeamRecipient: 'builder'")
    expect(restoreBody).toContain('selectedTeamName: session?.layout.selectedTeamName')
    expect(restoreBody).toContain('selectedTeamRecipient: session?.layout.selectedTeamRecipient')
    expect(restoreBody).toContain("activeTeam?.getAttribute('aria-current') === 'true'")
    expect(restoreBody).toContain("teamRestoreState.selectedTeamName === 'frontend'")
    expect(restoreBody).toContain("teamRestoreState.selectedTeamRecipient === 'builder'")
    expect(smokeSource).toContain('selectedTeamStateRestored: true')
  })

  it('clears stale selected team layout after team lists load', () => {
    const helperStart = rendererSource.indexOf('async function clearStaleSelectedTeamSelection')
    const helperEnd = rendererSource.indexOf('async function refreshWorkspace', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)
    const refreshWorkspaceStart = rendererSource.indexOf('async function refreshWorkspace')
    const refreshWorkspaceEnd = rendererSource.indexOf('async function refreshSessions', refreshWorkspaceStart)
    const refreshWorkspaceBody = rendererSource.slice(refreshWorkspaceStart, refreshWorkspaceEnd)
    const refreshAgentsStart = rendererSource.indexOf('async function refreshAgents(): Promise<void>')
    const refreshAgentsEnd = rendererSource.indexOf('async function selectAgent', refreshAgentsStart)
    const refreshAgentsBody = rendererSource.slice(refreshAgentsStart, refreshAgentsEnd)

    expect(helperBody).toContain('const selectedTeamName = session.layout.selectedTeamName?.trim()')
    expect(helperBody).toContain('const selectedTeamRecipient = session.layout.selectedTeamRecipient?.trim()')
    expect(helperBody).toContain('const selectedTeam = nextTeams.find(team => team.name.trim() === selectedTeamName)')
    expect(helperBody).toContain('if (selectedTeam) {')
    expect(helperBody).toContain('setTeamDraft(prev =>')
    expect(helperBody).toContain('setChatTarget(prev =>')
    expect(helperBody).toContain('const fallbackAgentType = session.layout.selectedAgentType?.trim()')
    expect(helperBody).toContain('const fallbackChatTarget: ChatTarget = fallbackAgentType')
    expect(helperBody).toContain("? { type: 'agent', teamName: '', agentType: fallbackAgentType }")
    expect(helperBody).toContain(": { type: 'session', teamName: '', agentType: '' }")
    expect(helperBody).toContain('? fallbackChatTarget')
    expect(helperBody).toContain('await updateSessionLayout(session.id, { selectedTeamName: undefined, selectedTeamRecipient: undefined })')
    expect(refreshWorkspaceBody).toContain('if (teams.status === \'fulfilled\') {')
    expect(refreshWorkspaceBody).toContain('setTeams(teams.value)')
    expect(refreshWorkspaceBody).toContain('await clearStaleSelectedTeamSelection(teams.value, session)')
    expect(refreshAgentsBody).toContain('setTeams(nextTeams ?? [])')
    expect(refreshAgentsBody).toContain('await clearStaleSelectedTeamSelection(nextTeams ?? [], session)')
  })

  it('clears stale selected team recipient when the team remains after team lists load', () => {
    const helperStart = rendererSource.indexOf('async function clearStaleSelectedTeamSelection')
    const helperEnd = rendererSource.indexOf('async function refreshWorkspace', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)

    expect(helperBody).toContain("selectedTeamRecipient === '*'")
    expect(helperBody).toContain('selectedTeam.members.some(member => member.name.trim() === selectedTeamRecipient)')
    expect(helperBody).toContain('const selectedTeamRecipientIsCurrent =')
    expect(helperBody).toContain('if (selectedTeamRecipientIsCurrent) return')
    expect(helperBody).toContain("to: '*'")
    expect(helperBody).toContain("await updateSessionLayout(session.id, { selectedTeamRecipient: '*' })")
    expect(helperBody.indexOf('if (selectedTeamRecipientIsCurrent) return')).toBeLessThan(
      helperBody.indexOf("await updateSessionLayout(session.id, { selectedTeamRecipient: '*' })"),
    )
    expect(helperBody.indexOf("await updateSessionLayout(session.id, { selectedTeamRecipient: '*' })")).toBeLessThan(
      helperBody.indexOf('const fallbackAgentType = session.layout.selectedAgentType?.trim()'),
    )
  })

  it('persists selected scheduled task identities through edit and clear actions', () => {
    const globalEditStart = rendererSource.indexOf('function editScheduledTask(task: ScheduledTaskInfo): void')
    const globalEditEnd = rendererSource.indexOf('function cancelScheduledTaskEdit', globalEditStart)
    const globalEditBody = rendererSource.slice(globalEditStart, globalEditEnd)
    const globalCancelStart = rendererSource.indexOf('function cancelScheduledTaskEdit(): void')
    const globalCancelEnd = rendererSource.indexOf('function startNewScheduledTaskDraft', globalCancelStart)
    const globalCancelBody = rendererSource.slice(globalCancelStart, globalCancelEnd)
    const globalNewStart = rendererSource.indexOf('function startNewScheduledTaskDraft(): void')
    const globalNewEnd = rendererSource.indexOf('async function runScheduledTaskAction', globalNewStart)
    const globalNewBody = rendererSource.slice(globalNewStart, globalNewEnd)
    const globalRemoveStart = rendererSource.indexOf('async function removeScheduledTask')
    const globalRemoveEnd = rendererSource.indexOf('async function toggleScheduledTaskEnabled', globalRemoveStart)
    const globalRemoveBody = rendererSource.slice(globalRemoveStart, globalRemoveEnd)
    const projectEditStart = rendererSource.indexOf('function editProjectScheduledTask(task: ProjectScheduledTaskInfo): void')
    const projectEditEnd = rendererSource.indexOf('function cancelProjectScheduledTaskEdit', projectEditStart)
    const projectEditBody = rendererSource.slice(projectEditStart, projectEditEnd)
    const projectCancelStart = rendererSource.indexOf('function cancelProjectScheduledTaskEdit(): void')
    const projectCancelEnd = rendererSource.indexOf('function startNewProjectScheduledTaskDraft', projectCancelStart)
    const projectCancelBody = rendererSource.slice(projectCancelStart, projectCancelEnd)
    const projectNewStart = rendererSource.indexOf('function startNewProjectScheduledTaskDraft(): void')
    const projectNewEnd = rendererSource.indexOf('async function runProjectScheduledTaskNow', projectNewStart)
    const projectNewBody = rendererSource.slice(projectNewStart, projectNewEnd)
    const projectRemoveStart = rendererSource.indexOf('async function removeProjectScheduledTask')
    const projectRemoveEnd = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled', projectRemoveStart)
    const projectRemoveBody = rendererSource.slice(projectRemoveStart, projectRemoveEnd)

    expect(globalEditBody).toContain('const session = activeSession')
    expect(globalEditBody).toContain('if (session) void updateSessionLayout(session.id, { selectedGlobalTaskId: editedGlobalTaskId })')
    expect(globalCancelBody).toContain('const session = activeSession')
    expect(globalCancelBody).toContain('if (session) void updateSessionLayout(session.id, { selectedGlobalTaskId: undefined })')
    expect(globalNewBody).toContain('const session = activeSession')
    expect(globalNewBody).toContain('if (session) void updateSessionLayout(session.id, { selectedGlobalTaskId: undefined })')
    expect(globalRemoveBody).toContain('if (session) await updateSessionLayout(session.id, { selectedGlobalTaskId: undefined })')
    expect(projectEditBody).toContain('const session = activeSession')
    expect(projectEditBody).toContain('void updateSessionLayout(session.id, { selectedProjectTaskId: editedProjectTaskId })')
    expect(projectCancelBody).toContain('const session = activeSession')
    expect(projectCancelBody).toContain('if (session) void updateSessionLayout(session.id, { selectedProjectTaskId: undefined })')
    expect(projectNewBody).toContain('const session = activeSession')
    expect(projectNewBody).toContain('void updateSessionLayout(session.id, { selectedProjectTaskId: undefined })')
    expect(projectRemoveBody).toContain('await updateSessionLayout(session.id, { selectedProjectTaskId: undefined })')
    for (const body of [globalEditBody, globalCancelBody, globalNewBody, projectEditBody, projectCancelBody, projectNewBody]) {
      expect(body).not.toContain('void updateLayout({')
    }
  })

  it('disables metadata edit cancellation while loading', () => {
    const globalCancelStart = rendererSource.indexOf('function cancelScheduledTaskEdit(): void')
    const globalCancelEnd = rendererSource.indexOf('function startNewScheduledTaskDraft', globalCancelStart)
    const globalCancelBody = rendererSource.slice(globalCancelStart, globalCancelEnd)
    const projectCancelStart = rendererSource.indexOf('function cancelProjectScheduledTaskEdit(): void')
    const projectCancelEnd = rendererSource.indexOf('function startNewProjectScheduledTaskDraft', projectCancelStart)
    const projectCancelBody = rendererSource.slice(projectCancelStart, projectCancelEnd)
    const mcpCancelStart = rendererSource.indexOf('function cancelMcpEdit(): void')
    const mcpCancelEnd = rendererSource.indexOf('function startNewMcpDraft', mcpCancelStart)
    const mcpCancelBody = rendererSource.slice(mcpCancelStart, mcpCancelEnd)

    expect(globalCancelBody).toContain('if (loadingLabel) return')
    expect(projectCancelBody).toContain('if (loadingLabel) return')
    expect(mcpCancelBody).toContain('if (loadingLabel) return')
    expect(rendererSource).toContain('function handleScheduledTaskCancelClick(): void')
    expect(rendererSource).toContain('function handleProjectScheduledTaskCancelClick(): void')
    expect(rendererSource).toContain('<button className="tool-button" onClick={handleScheduledTaskCancelClick} disabled={!!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={handleProjectScheduledTaskCancelClick} disabled={!!loadingLabel}>')
    expect(rendererSource).toContain('function handleMcpCancelEditClick(): void')
    expect(rendererSource).toContain('<button className="tool-button" onClick={handleMcpCancelEditClick} disabled={!!loadingLabel}>')
  })

  it('blocks scheduled task edit and cancel buttons while loading', () => {
    const projectStart = rendererSource.indexOf('function renderProjectScheduledTasksSection')
    const projectEnd = rendererSource.indexOf('function renderGlobalScheduledTasksSection', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)
    const globalStart = rendererSource.indexOf('function renderGlobalScheduledTasksSection')
    const globalEnd = rendererSource.indexOf('function renderSettingsPane', globalStart)
    const globalBody = rendererSource.slice(globalStart, globalEnd)

    expect(projectBody).toContain('<button className="tool-button" onClick={handleProjectScheduledTaskCancelClick} disabled={!!loadingLabel}>')
    expect(projectBody).toContain('<button className="tool-button" onClick={() => handleProjectScheduledTaskEditClick(task)} disabled={!activeSession || !!loadingLabel}>')
    expect(globalBody).toContain('<button className="tool-button" onClick={handleScheduledTaskCancelClick} disabled={!!loadingLabel}>')
    expect(globalBody).toContain('<button className="tool-button" onClick={() => handleScheduledTaskEditClick(task)} disabled={!!loadingLabel}>')
  })

  it('blocks metadata edit entrypoints while loading', () => {
    const globalEditStart = rendererSource.indexOf('function editScheduledTask(task: ScheduledTaskInfo): void')
    const globalEditEnd = rendererSource.indexOf('function cancelScheduledTaskEdit', globalEditStart)
    const globalEditBody = rendererSource.slice(globalEditStart, globalEditEnd)
    const globalNewStart = rendererSource.indexOf('function startNewScheduledTaskDraft(): void')
    const globalNewEnd = rendererSource.indexOf('async function runScheduledTaskAction', globalNewStart)
    const globalNewBody = rendererSource.slice(globalNewStart, globalNewEnd)
    const projectEditStart = rendererSource.indexOf('function editProjectScheduledTask(task: ProjectScheduledTaskInfo): void')
    const projectEditEnd = rendererSource.indexOf('function cancelProjectScheduledTaskEdit', projectEditStart)
    const projectEditBody = rendererSource.slice(projectEditStart, projectEditEnd)
    const projectNewStart = rendererSource.indexOf('function startNewProjectScheduledTaskDraft(): void')
    const projectNewEnd = rendererSource.indexOf('async function runProjectScheduledTaskNow', projectNewStart)
    const projectNewBody = rendererSource.slice(projectNewStart, projectNewEnd)
    const mcpEditStart = rendererSource.indexOf("function editMcpServer(server: McpServerInfo, scope: 'user' | 'project'): void")
    const mcpEditEnd = rendererSource.indexOf('function cancelMcpEdit', mcpEditStart)
    const mcpEditBody = rendererSource.slice(mcpEditStart, mcpEditEnd)
    const mcpNewStart = rendererSource.indexOf('function startNewMcpDraft(): void')
    const mcpNewEnd = rendererSource.indexOf('async function checkMcpHealth', mcpNewStart)
    const mcpNewBody = rendererSource.slice(mcpNewStart, mcpNewEnd)

    for (const body of [globalEditBody, globalNewBody, projectEditBody, projectNewBody, mcpEditBody, mcpNewBody]) {
      expect(body).toContain('if (loadingLabel) return')
    }
  })

  it('blocks project scheduled task edit entrypoints without an active session', () => {
    const projectEditStart = rendererSource.indexOf('function editProjectScheduledTask(task: ProjectScheduledTaskInfo): void')
    const projectEditEnd = rendererSource.indexOf('function cancelProjectScheduledTaskEdit', projectEditStart)
    const projectEditBody = rendererSource.slice(projectEditStart, projectEditEnd)
    const projectStart = rendererSource.indexOf('function renderProjectScheduledTasksSection')
    const projectEnd = rendererSource.indexOf('function renderGlobalScheduledTasksSection', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)

    expect(projectEditBody).toContain('if (!activeSession)')
    expect(projectEditBody).toContain("text: 'Select a session before editing project scheduled tasks.'")
    expect(projectEditBody.indexOf('if (!activeSession)')).toBeLessThan(
      projectEditBody.indexOf('setProjectTaskDraft({ ...projectTaskDraftFromTask(task), id: editedProjectTaskId })'),
    )
    expect(projectEditBody.indexOf('if (!activeSession)')).toBeLessThan(
      projectEditBody.indexOf('void updateSessionLayout(session.id, { selectedProjectTaskId: editedProjectTaskId })'),
    )
    expect(rendererSource).toContain('function handleProjectScheduledTaskRowClick(task: ProjectScheduledTaskInfo): void')
    expect(rendererSource).toContain('function handleProjectScheduledTaskEditClick(task: ProjectScheduledTaskInfo): void')
    expect(projectBody).toContain('onClick={() => handleProjectScheduledTaskRowClick(task)}')
    expect(projectBody).toContain('onKeyDown={event => handleProjectScheduledTaskRowKeyDown(event, task)}')
    expect(projectBody).toContain('<button className="tool-button" onClick={() => handleProjectScheduledTaskEditClick(task)} disabled={!activeSession || !!loadingLabel}>')
  })

  it('shows a scheduled task error before editing tasks with a missing id', () => {
    const globalEditStart = rendererSource.indexOf('function editScheduledTask(task: ScheduledTaskInfo): void')
    const globalEditEnd = rendererSource.indexOf('function cancelScheduledTaskEdit', globalEditStart)
    const globalEditBody = rendererSource.slice(globalEditStart, globalEditEnd)
    const projectEditStart = rendererSource.indexOf('function editProjectScheduledTask(task: ProjectScheduledTaskInfo): void')
    const projectEditEnd = rendererSource.indexOf('function cancelProjectScheduledTaskEdit', projectEditStart)
    const projectEditBody = rendererSource.slice(projectEditStart, projectEditEnd)
    const globalGuard = 'if (!editedGlobalTaskId) {'
    const projectGuard = 'if (!editedProjectTaskId) {'

    expect(globalEditBody).toContain('const editedGlobalTaskId = task.id.trim()')
    expect(globalEditBody).toContain(globalGuard)
    expect(globalEditBody).toContain("text: 'Select a scheduled task before editing.'")
    expect(globalEditBody.indexOf('const editedGlobalTaskId = task.id.trim()')).toBeLessThan(
      globalEditBody.indexOf(globalGuard),
    )
    expect(globalEditBody.indexOf(globalGuard)).toBeLessThan(
      globalEditBody.indexOf('setTaskDraft({ ...taskDraftFromTask(task), id: editedGlobalTaskId })'),
    )
    expect(globalEditBody.indexOf(globalGuard)).toBeLessThan(
      globalEditBody.indexOf('if (session) void updateSessionLayout(session.id, { selectedGlobalTaskId: editedGlobalTaskId })'),
    )

    expect(projectEditBody).toContain('const editedProjectTaskId = task.id.trim()')
    expect(projectEditBody).toContain(projectGuard)
    expect(projectEditBody).toContain("text: 'Select a project scheduled task before editing.'")
    expect(projectEditBody.indexOf('const editedProjectTaskId = task.id.trim()')).toBeLessThan(
      projectEditBody.indexOf(projectGuard),
    )
    expect(projectEditBody.indexOf(projectGuard)).toBeLessThan(
      projectEditBody.indexOf('setProjectTaskDraft({ ...projectTaskDraftFromTask(task), id: editedProjectTaskId })'),
    )
    expect(projectEditBody.indexOf(projectGuard)).toBeLessThan(
      projectEditBody.indexOf('void updateSessionLayout(session.id, { selectedProjectTaskId: editedProjectTaskId })'),
    )
  })

  it('normalizes global scheduled task edit identity before writing draft and layout', () => {
    const start = rendererSource.indexOf('function editScheduledTask(task: ScheduledTaskInfo): void')
    const end = rendererSource.indexOf('function cancelScheduledTaskEdit', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const editedGlobalTaskId = task.id.trim()')
    expect(body.indexOf('const editedGlobalTaskId = task.id.trim()')).toBeLessThan(
      body.indexOf('setTaskDraft({ ...taskDraftFromTask(task), id: editedGlobalTaskId })'),
    )
    expect(body).toContain('setTaskDraft({ ...taskDraftFromTask(task), id: editedGlobalTaskId })')
    expect(body).toContain('const session = activeSession')
    expect(body).toContain('if (session) void updateSessionLayout(session.id, { selectedGlobalTaskId: editedGlobalTaskId })')
    expect(body).toContain('setScheduledTaskStatus({ kind: \'info\', text: `Editing scheduled task "${task.name || editedGlobalTaskId}".` })')
  })

  it('normalizes project scheduled task edit identity before writing draft and layout', () => {
    const start = rendererSource.indexOf('function editProjectScheduledTask(task: ProjectScheduledTaskInfo): void')
    const end = rendererSource.indexOf('function cancelProjectScheduledTaskEdit', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const editedProjectTaskId = task.id.trim()')
    expect(body.indexOf('const editedProjectTaskId = task.id.trim()')).toBeLessThan(
      body.indexOf('setProjectTaskDraft({ ...projectTaskDraftFromTask(task), id: editedProjectTaskId })'),
    )
    expect(body).toContain('setProjectTaskDraft({ ...projectTaskDraftFromTask(task), id: editedProjectTaskId })')
    expect(body).toContain('const session = activeSession')
    expect(body).toContain('void updateSessionLayout(session.id, { selectedProjectTaskId: editedProjectTaskId })')
    expect(body).toContain('setScheduledTaskStatus({ kind: \'info\', text: `Editing project scheduled task "${editedProjectTaskId}".` })')
  })

  it('selects saved scheduled tasks for immediate follow-up actions', () => {
    const globalSaveStart = rendererSource.indexOf('async function saveScheduledTask(): Promise<void>')
    const globalSaveEnd = rendererSource.indexOf('async function removeScheduledTask', globalSaveStart)
    const globalSaveBody = rendererSource.slice(globalSaveStart, globalSaveEnd)
    const projectSaveStart = rendererSource.indexOf('async function saveProjectScheduledTask')
    const projectSaveEnd = rendererSource.indexOf('async function removeProjectScheduledTask', projectSaveStart)
    const projectSaveBody = rendererSource.slice(projectSaveStart, projectSaveEnd)

    expect(rendererSource).toContain('function findSavedScheduledTask(')
    expect(rendererSource).toContain('function findSavedProjectScheduledTask(')

    expect(globalSaveBody).toContain('const tasks = await window.claudeDesktop.tasks.addOrUpdate(input)')
    expect(globalSaveBody).toContain('const savedTask = findSavedScheduledTask(input, tasks)')
    expect(globalSaveBody).toContain('setTaskDraft(savedTask ? { ...taskDraftFromTask(savedTask), id: savedTask.id } : emptyTaskDraft())')
    expect(globalSaveBody).toContain('if (session) await updateSessionLayout(session.id, { selectedGlobalTaskId: savedTask?.id })')
    expect(globalSaveBody.indexOf('const tasks = await window.claudeDesktop.tasks.addOrUpdate(input)')).toBeLessThan(
      globalSaveBody.indexOf('const savedTask = findSavedScheduledTask(input, tasks)'),
    )
    expect(globalSaveBody.indexOf('const savedTask = findSavedScheduledTask(input, tasks)')).toBeLessThan(
      globalSaveBody.indexOf('setTaskDraft(savedTask ? { ...taskDraftFromTask(savedTask), id: savedTask.id } : emptyTaskDraft())'),
    )
    expect(globalSaveBody.indexOf('setTaskDraft(savedTask ? { ...taskDraftFromTask(savedTask), id: savedTask.id } : emptyTaskDraft())')).toBeLessThan(
      globalSaveBody.indexOf('if (session) await updateSessionLayout(session.id, { selectedGlobalTaskId: savedTask?.id })'),
    )

    expect(projectSaveBody).toContain('const savedTask = findSavedProjectScheduledTask(input, tasks)')
    expect(projectSaveBody).toContain('setProjectTaskDraft(savedTask ? { ...projectTaskDraftFromTask(savedTask), id: savedTask.id } : emptyProjectTaskDraft())')
    expect(projectSaveBody).toContain('await updateSessionLayout(session.id, { selectedProjectTaskId: savedTask?.id })')
    expect(projectSaveBody).not.toContain('await updateLayout({ selectedProjectTaskId: savedTask?.id })')
    expect(projectSaveBody.indexOf('const tasks = await window.claudeDesktop.workspaceTasks.addOrUpdate(')).toBeLessThan(
      projectSaveBody.indexOf('const savedTask = findSavedProjectScheduledTask(input, tasks)'),
    )
    expect(projectSaveBody.indexOf('const savedTask = findSavedProjectScheduledTask(input, tasks)')).toBeLessThan(
      projectSaveBody.indexOf('setProjectTaskDraft(savedTask ? { ...projectTaskDraftFromTask(savedTask), id: savedTask.id } : emptyProjectTaskDraft())'),
    )
    expect(projectSaveBody.indexOf('setProjectTaskDraft(savedTask ? { ...projectTaskDraftFromTask(savedTask), id: savedTask.id } : emptyProjectTaskDraft())')).toBeLessThan(
      projectSaveBody.indexOf('await updateSessionLayout(session.id, { selectedProjectTaskId: savedTask?.id })'),
    )
  })

  it('keeps run-now scheduled task context selected for immediate follow-up actions', () => {
    const globalRunStart = rendererSource.indexOf('async function runScheduledTaskNow')
    const globalRunEnd = rendererSource.indexOf('async function saveProjectScheduledTask', globalRunStart)
    const globalRunBody = rendererSource.slice(globalRunStart, globalRunEnd)
    const projectRunStart = rendererSource.indexOf('async function runProjectScheduledTaskNow')
    const projectRunEnd = rendererSource.indexOf('function renderProjectScheduledTasksSection', projectRunStart)
    const projectRunBody = rendererSource.slice(projectRunStart, projectRunEnd)

    expect(globalRunBody).toContain('setTaskDraft({ ...taskDraftFromTask(task), id: queuedTaskId })')
    expect(globalRunBody).toContain('await updateSessionLayout(session.id, { selectedGlobalTaskId: queuedTaskId })')
    expect(globalRunBody).not.toContain('await updateLayout({ selectedGlobalTaskId: queuedTaskId })')
    expect(globalRunBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      globalRunBody.indexOf('setTaskDraft({ ...taskDraftFromTask(task), id: queuedTaskId })'),
    )
    expect(globalRunBody.indexOf('setTaskDraft({ ...taskDraftFromTask(task), id: queuedTaskId })')).toBeLessThan(
      globalRunBody.indexOf('await updateSessionLayout(session.id, { selectedGlobalTaskId: queuedTaskId })'),
    )
    expect(globalRunBody.indexOf('await updateSessionLayout(session.id, { selectedGlobalTaskId: queuedTaskId })')).toBeLessThan(
      globalRunBody.indexOf('setScheduledTaskStatus({ kind: \'success\''),
    )

    expect(projectRunBody).toContain('setProjectTaskDraft({ ...projectTaskDraftFromTask(task), id: queuedProjectTaskId })')
    expect(projectRunBody).toContain('await updateSessionLayout(session.id, { selectedProjectTaskId: queuedProjectTaskId })')
    expect(projectRunBody).not.toContain('await updateLayout({ selectedProjectTaskId: queuedProjectTaskId })')
    expect(projectRunBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      projectRunBody.indexOf('setProjectTaskDraft({ ...projectTaskDraftFromTask(task), id: queuedProjectTaskId })'),
    )
    expect(projectRunBody.indexOf('setProjectTaskDraft({ ...projectTaskDraftFromTask(task), id: queuedProjectTaskId })')).toBeLessThan(
      projectRunBody.indexOf('await updateSessionLayout(session.id, { selectedProjectTaskId: queuedProjectTaskId })'),
    )
    expect(projectRunBody.indexOf('await updateSessionLayout(session.id, { selectedProjectTaskId: queuedProjectTaskId })')).toBeLessThan(
      projectRunBody.indexOf('setScheduledTaskStatus({ kind: \'success\''),
    )
  })

  it('blocks project scheduled task save without an active session before validation', () => {
    const start = rendererSource.indexOf('async function saveProjectScheduledTask')
    const end = rendererSource.indexOf('async function removeProjectScheduledTask', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (!activeSession)')
    expect(body).toContain("text: 'Select a session before saving project scheduled tasks.'")
    expect(body.indexOf('if (!activeSession)')).toBeLessThan(
      body.indexOf('if (!canSaveProjectTask)'),
    )
    expect(body.indexOf('if (!activeSession)')).toBeLessThan(
      body.indexOf('const actionKey = `${sessionId}:project:${input.id ?? \'new\'}:${input.cron}:${input.prompt}:save`'),
    )
  })

  it('blocks project scheduled task pause or resume without an active session', () => {
    const start = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled')
    const end = rendererSource.indexOf('function editProjectScheduledTask', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (!activeSession)')
    expect(body).toContain("text: 'Select a session before updating project scheduled tasks.'")
    expect(body.indexOf('if (!activeSession)')).toBeLessThan(
      body.indexOf('const nextEnabled = !task.enabled'),
    )
    expect(body.indexOf('if (!activeSession)')).toBeLessThan(
      body.indexOf('window.claudeDesktop.workspaceTasks.resume(session.cwd, updatedTaskId)'),
    )
  })

  it('shows a scheduled task error before pausing or resuming a project task with a missing id', () => {
    const start = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled')
    const end = rendererSource.indexOf('function editProjectScheduledTask', start)
    const body = rendererSource.slice(start, end)
    const guard = 'if (!updatedTaskId) {'

    expect(body).toContain('const updatedTaskId = task.id.trim()')
    expect(body).toContain(guard)
    expect(body).toContain("text: 'Select a project scheduled task before pausing or resuming.'")
    expect(body.indexOf('const updatedTaskId = task.id.trim()')).toBeLessThan(
      body.indexOf(guard),
    )
    expect(body.indexOf(guard)).toBeLessThan(
      body.indexOf('window.claudeDesktop.workspaceTasks.resume(session.cwd, updatedTaskId)'),
    )
  })

  it('normalizes project scheduled task pause or resume before IPC and status', () => {
    const start = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled')
    const end = rendererSource.indexOf('function editProjectScheduledTask', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const updatedTaskId = task.id.trim()')
    expect(body.indexOf('const updatedTaskId = task.id.trim()')).toBeLessThan(
      body.indexOf('const nextEnabled = !task.enabled'),
    )
    expect(body).toContain("`${session.id}:project:${updatedTaskId}:${nextEnabled ? 'resume' : 'pause'}`")
    expect(body).toContain('window.claudeDesktop.workspaceTasks.resume(session.cwd, updatedTaskId)')
    expect(body).toContain('window.claudeDesktop.workspaceTasks.pause(session.cwd, updatedTaskId)')
    expect(body).toContain('text: `${nextEnabled ? \'Resumed\' : \'Paused\'} project scheduled task "${updatedTaskId}".`')
  })

  it('syncs selected project scheduled task draft after pause or resume', () => {
    const start = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled')
    const end = rendererSource.indexOf('function editProjectScheduledTask', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const updatedTask = tasks.find(nextTask => nextTask.id.trim() === updatedTaskId)')
    expect(body).toContain('if (updatedTask) {')
    expect(body).toContain('setProjectTaskDraft({ ...projectTaskDraftFromTask(updatedTask), id: updatedTaskId })')
    expect(body).toContain('await updateSessionLayout(session.id, { selectedProjectTaskId: updatedTaskId })')
    expect(body).not.toContain('await updateLayout({ selectedProjectTaskId: updatedTaskId })')
    expect(body.indexOf('const updatedTask = tasks.find')).toBeGreaterThan(
      body.indexOf('setProjectTasks(tasks)'),
    )
    expect(body.indexOf('setProjectTaskDraft({ ...projectTaskDraftFromTask(updatedTask), id: updatedTaskId })')).toBeLessThan(
      body.indexOf('await refreshWorkspace(session)'),
    )
  })

  it('blocks project scheduled task run now without an active session', () => {
    const start = rendererSource.indexOf('async function runProjectScheduledTaskNow')
    const end = rendererSource.indexOf('function startResize', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (!activeSession)')
    expect(body).toContain("text: 'Select a session before running project scheduled tasks.'")
    expect(body.indexOf('if (!activeSession)')).toBeLessThan(
      body.indexOf('if (turnBusy)'),
    )
    expect(body.indexOf('if (!activeSession)')).toBeLessThan(
      body.indexOf('await window.claudeDesktop.sessions.send(sessionId, queuedProjectPrompt)'),
    )
  })

  it('shows a scheduled task error before running a project task with a missing id', () => {
    const start = rendererSource.indexOf('async function runProjectScheduledTaskNow')
    const end = rendererSource.indexOf('function startResize', start)
    const body = rendererSource.slice(start, end)
    const guard = 'if (!queuedProjectTaskId) {'

    expect(body).toContain('const queuedProjectTaskId = task.id.trim()')
    expect(body).toContain(guard)
    expect(body).toContain("text: 'Select a project scheduled task before running.'")
    expect(body.indexOf('const queuedProjectTaskId = task.id.trim()')).toBeLessThan(
      body.indexOf(guard),
    )
    expect(body.indexOf(guard)).toBeLessThan(
      body.indexOf('if (turnBusy)'),
    )
    expect(body.indexOf(guard)).toBeLessThan(
      body.indexOf('await window.claudeDesktop.sessions.send(sessionId, queuedProjectPrompt)'),
    )
  })

  it('normalizes project scheduled task run now before runtime queueing', () => {
    const start = rendererSource.indexOf('async function runProjectScheduledTaskNow')
    const end = rendererSource.indexOf('function startResize', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const queuedProjectTaskId = task.id.trim()')
    expect(body).toContain('const queuedProjectPrompt = task.prompt.trim()')
    expect(body.indexOf('const queuedProjectTaskId = task.id.trim()')).toBeLessThan(
      body.indexOf('const session = activeSession'),
    )
    expect(body.indexOf('const queuedProjectPrompt = task.prompt.trim()')).toBeLessThan(
      body.indexOf('const session = activeSession'),
    )
    expect(body).toContain('text: `Resume project scheduled task "${queuedProjectTaskId}" before running it now.`')
    expect(body).toContain('await runScheduledTaskAction(`${sessionId}:project:${queuedProjectTaskId}:run-now`')
    expect(body).toContain('await window.claudeDesktop.sessions.send(sessionId, queuedProjectPrompt)')
    expect(body).toContain('setScheduledTaskStatus({ kind: \'success\', text: `Queued project scheduled task "${queuedProjectTaskId}".` }, statusTarget)')
  })

  it('shows a scheduled task error when global run now loses the active session', () => {
    const start = rendererSource.indexOf('async function runScheduledTaskNow')
    const end = rendererSource.indexOf('async function saveProjectScheduledTask', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('if (!activeSession) {')
    expect(body).toContain("text: 'Select a session before running scheduled tasks.'")
    expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
      body.indexOf('if (turnBusy)'),
    )
    expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
      body.indexOf('await window.claudeDesktop.sessions.send(sessionId, queuedPrompt)'),
    )
  })

  it('shows a scheduled task error before running a global task with a missing id', () => {
    const start = rendererSource.indexOf('async function runScheduledTaskNow')
    const end = rendererSource.indexOf('async function saveProjectScheduledTask', start)
    const body = rendererSource.slice(start, end)
    const guard = 'if (!queuedTaskId) {'

    expect(body).toContain('const queuedTaskId = task.id.trim()')
    expect(body).toContain(guard)
    expect(body).toContain("text: 'Select a scheduled task before running.'")
    expect(body.indexOf('const queuedTaskId = task.id.trim()')).toBeLessThan(
      body.indexOf(guard),
    )
    expect(body.indexOf(guard)).toBeLessThan(
      body.indexOf('if (turnBusy)'),
    )
    expect(body.indexOf(guard)).toBeLessThan(
      body.indexOf('await window.claudeDesktop.sessions.send(sessionId, queuedPrompt)'),
    )
  })

  it('normalizes global scheduled task run now before runtime queueing', () => {
    const start = rendererSource.indexOf('async function runScheduledTaskNow')
    const end = rendererSource.indexOf('async function saveProjectScheduledTask', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const queuedTaskId = task.id.trim()')
    expect(body).toContain('const queuedPrompt = task.prompt.trim()')
    expect(body.indexOf('const queuedTaskId = task.id.trim()')).toBeLessThan(
      body.indexOf('const session = activeSession'),
    )
    expect(body.indexOf('const queuedPrompt = task.prompt.trim()')).toBeLessThan(
      body.indexOf('const session = activeSession'),
    )
    expect(body).toContain("const label = task.name || queuedTaskId")
    expect(body).toContain('await runScheduledTaskAction(`${sessionId}:global:${queuedTaskId}:run-now`')
    expect(body).toContain('await window.claudeDesktop.sessions.send(sessionId, queuedPrompt)')
    expect(body).toContain('setScheduledTaskStatus({ kind: \'success\', text: `Queued scheduled task "${label}".` }, statusTarget)')
  })

  it('shows a scheduled task error before running tasks with missing prompts', () => {
    const globalStart = rendererSource.indexOf('async function runScheduledTaskNow')
    const globalEnd = rendererSource.indexOf('async function saveProjectScheduledTask', globalStart)
    const globalBody = rendererSource.slice(globalStart, globalEnd)
    const projectStart = rendererSource.indexOf('async function runProjectScheduledTaskNow')
    const projectEnd = rendererSource.indexOf('function renderProjectScheduledTasksSection', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)
    const globalGuard = 'if (!queuedPrompt) {'
    const projectGuard = 'if (!queuedProjectPrompt) {'

    expect(globalBody).toContain('const queuedPrompt = task.prompt.trim()')
    expect(globalBody).toContain(globalGuard)
    expect(globalBody).toContain("text: 'Select a scheduled task with a prompt before running.'")
    expect(globalBody.indexOf('const queuedPrompt = task.prompt.trim()')).toBeLessThan(
      globalBody.indexOf(globalGuard),
    )
    expect(globalBody.indexOf(globalGuard)).toBeLessThan(
      globalBody.indexOf('if (turnBusy)'),
    )
    expect(globalBody.indexOf(globalGuard)).toBeLessThan(
      globalBody.indexOf('await window.claudeDesktop.sessions.send(sessionId, queuedPrompt)'),
    )

    expect(projectBody).toContain('const queuedProjectPrompt = task.prompt.trim()')
    expect(projectBody).toContain(projectGuard)
    expect(projectBody).toContain("text: 'Select a project scheduled task with a prompt before running.'")
    expect(projectBody.indexOf('const queuedProjectPrompt = task.prompt.trim()')).toBeLessThan(
      projectBody.indexOf(projectGuard),
    )
    expect(projectBody.indexOf(projectGuard)).toBeLessThan(
      projectBody.indexOf('if (turnBusy)'),
    )
    expect(projectBody.indexOf(projectGuard)).toBeLessThan(
      projectBody.indexOf('await window.claudeDesktop.sessions.send(sessionId, queuedProjectPrompt)'),
    )
  })

  it('shows a scheduled task error before pausing or resuming a global task with a missing id', () => {
    const start = rendererSource.indexOf('async function toggleScheduledTaskEnabled')
    const end = rendererSource.indexOf('function editScheduledTask', start)
    const body = rendererSource.slice(start, end)
    const guard = 'if (!updatedGlobalTaskId) {'

    expect(body).toContain('const updatedGlobalTaskId = task.id.trim()')
    expect(body).toContain(guard)
    expect(body).toContain("text: 'Select a scheduled task before pausing or resuming.'")
    expect(body.indexOf('const updatedGlobalTaskId = task.id.trim()')).toBeLessThan(
      body.indexOf(guard),
    )
    expect(body.indexOf(guard)).toBeLessThan(
      body.indexOf('const tasks = nextEnabled'),
    )
  })

  it('normalizes global scheduled task pause or resume before update and status', () => {
    const start = rendererSource.indexOf('async function toggleScheduledTaskEnabled')
    const end = rendererSource.indexOf('function editScheduledTask', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const updatedGlobalTaskId = task.id.trim()')
    expect(body.indexOf('const updatedGlobalTaskId = task.id.trim()')).toBeLessThan(
      body.indexOf('const nextEnabled = !task.enabled'),
    )
    expect(body).toContain('const label = task.name || updatedGlobalTaskId')
    expect(body).toContain("await runScheduledTaskAction(`global:${updatedGlobalTaskId}:${nextEnabled ? 'resume' : 'pause'}`")
    expect(body).toContain('const tasks = nextEnabled')
    expect(body).toContain('await window.claudeDesktop.tasks.resume(updatedGlobalTaskId)')
    expect(body).toContain('await window.claudeDesktop.tasks.pause(updatedGlobalTaskId)')
    expect(body).not.toContain('await window.claudeDesktop.tasks.addOrUpdate({')
    expect(body).toContain('const updatedTask = tasks.find(nextTask => nextTask.id.trim() === updatedGlobalTaskId)')
    expect(body).toContain('if (updatedTask) {')
    expect(body).toContain('text: `${nextEnabled ? \'Resumed\' : \'Paused\'} scheduled task "${label}".`')
  })

  it('syncs selected global scheduled task draft after pause or resume', () => {
    const start = rendererSource.indexOf('async function toggleScheduledTaskEnabled')
    const end = rendererSource.indexOf('function editScheduledTask', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const tasks = nextEnabled')
    expect(body).toContain('const updatedTask = tasks.find(nextTask => nextTask.id.trim() === updatedGlobalTaskId)')
    expect(body).toContain('if (updatedTask) {')
    expect(body).toContain('setTaskDraft({ ...taskDraftFromTask(updatedTask), id: updatedGlobalTaskId })')
    expect(body).toContain('if (session) await updateSessionLayout(session.id, { selectedGlobalTaskId: updatedGlobalTaskId })')
    expect(body.indexOf('const updatedTask = tasks.find')).toBeGreaterThan(
      body.indexOf('const tasks = nextEnabled'),
    )
    expect(body.indexOf('setTaskDraft({ ...taskDraftFromTask(updatedTask), id: updatedGlobalTaskId })')).toBeLessThan(
      body.indexOf('await refreshDesktopConfig()'),
    )
  })

  it('blocks scheduled task runtime entrypoints while loading', () => {
    const saveStart = rendererSource.indexOf('async function saveScheduledTask(): Promise<void>')
    const saveEnd = rendererSource.indexOf('async function removeScheduledTask', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const removeStart = rendererSource.indexOf('async function removeScheduledTask')
    const removeEnd = rendererSource.indexOf('async function toggleScheduledTaskEnabled', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const toggleStart = rendererSource.indexOf('async function toggleScheduledTaskEnabled')
    const toggleEnd = rendererSource.indexOf('function editScheduledTask', toggleStart)
    const toggleBody = rendererSource.slice(toggleStart, toggleEnd)
    const runStart = rendererSource.indexOf('async function runScheduledTaskNow')
    const runEnd = rendererSource.indexOf('async function saveProjectScheduledTask', runStart)
    const runBody = rendererSource.slice(runStart, runEnd)
    const projectSaveStart = rendererSource.indexOf('async function saveProjectScheduledTask')
    const projectSaveEnd = rendererSource.indexOf('async function removeProjectScheduledTask', projectSaveStart)
    const projectSaveBody = rendererSource.slice(projectSaveStart, projectSaveEnd)
    const projectRemoveStart = rendererSource.indexOf('async function removeProjectScheduledTask')
    const projectRemoveEnd = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled', projectRemoveStart)
    const projectRemoveBody = rendererSource.slice(projectRemoveStart, projectRemoveEnd)
    const projectToggleStart = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled')
    const projectToggleEnd = rendererSource.indexOf('function editProjectScheduledTask', projectToggleStart)
    const projectToggleBody = rendererSource.slice(projectToggleStart, projectToggleEnd)
    const projectRunStart = rendererSource.indexOf('async function runProjectScheduledTaskNow')
    const projectRunEnd = rendererSource.indexOf('function startResize', projectRunStart)
    const projectRunBody = rendererSource.slice(projectRunStart, projectRunEnd)

    for (const body of [
      saveBody,
      removeBody,
      toggleBody,
      runBody,
      projectSaveBody,
      projectRemoveBody,
      projectToggleBody,
      projectRunBody,
    ]) {
      expect(body).toContain('if (loadingLabel) return')
    }

    expect(rendererSource).toContain('<button className="tool-button" onClick={handleScheduledTaskSaveClick} disabled={!canSaveTask || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => handleScheduledTaskToggleClick(task)} disabled={!!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => handleScheduledTaskRunClick(task)} disabled={!task.enabled || !canQueueRuntimePrompt || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button danger" onClick={() => handleScheduledTaskRemoveClick(task)} disabled={!!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={handleProjectScheduledTaskSaveClick} disabled={!canSaveProjectTask || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => handleProjectScheduledTaskToggleClick(task)} disabled={!activeSession || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => handleProjectScheduledTaskRunClick(task)} disabled={!activeSession || !task.enabled || !canQueueRuntimePrompt || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button danger" onClick={() => handleProjectScheduledTaskRemoveClick(task)} disabled={!activeSession || !!loadingLabel}>')
  })

  it('routes stale global scheduled task Run now clicks through the runtime handler', () => {
    const runStart = rendererSource.indexOf('async function runScheduledTaskNow')
    const runEnd = rendererSource.indexOf('async function saveProjectScheduledTask', runStart)
    const runBody = rendererSource.slice(runStart, runEnd)
    const sectionStart = rendererSource.indexOf('function renderGlobalScheduledTasksSection')
    const sectionEnd = rendererSource.indexOf('function renderProjectScheduledTasksSection', sectionStart)
    const sectionBody = rendererSource.slice(sectionStart, sectionEnd)
    const runNowLabel = sectionBody.indexOf('<Icon name="play" />Run now')
    const buttonStart = sectionBody.lastIndexOf('<button className="tool-button"', runNowLabel)
    const buttonEnd = sectionBody.indexOf('</button>', buttonStart)
    const buttonBody = sectionBody.slice(buttonStart, buttonEnd)

    expect(runBody).toContain("setScheduledTaskStatus({\n        kind: 'error',\n        text: 'Select a session before running scheduled tasks.',\n      })")
    expect(runBody).toContain("text: `Resume scheduled task \"${label}\" before running it now.`")
    expect(runBody).toContain("text: 'Wait for the current Claude turn to finish before running a scheduled task.'")
    expect(rendererSource).toContain('function handleScheduledTaskRunClick(task: ScheduledTaskInfo): void')
    expect(buttonBody).toContain('onClick={() => handleScheduledTaskRunClick(task)}')
    expect(buttonBody).toContain('disabled={!task.enabled || !canQueueRuntimePrompt || !!loadingLabel}')
    expect(buttonBody).not.toContain('onClick={() => !loadingLabel && void runScheduledTaskNow(task)}')
    expect(buttonBody).not.toContain('task.enabled && canQueueRuntimePrompt && !loadingLabel && void runScheduledTaskNow(task)')
  })

  it('routes stale global scheduled task Save clicks through the save handler', () => {
    const saveStart = rendererSource.indexOf('async function saveScheduledTask(): Promise<void>')
    const saveEnd = rendererSource.indexOf('async function removeScheduledTask', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const sectionStart = rendererSource.indexOf('function renderGlobalScheduledTasksSection')
    const sectionEnd = rendererSource.indexOf('function renderProjectScheduledTasksSection', sectionStart)
    const sectionBody = rendererSource.slice(sectionStart, sectionEnd)
    const saveLabel = sectionBody.indexOf("{taskDraft.id ? 'Update task' : 'Add task'}")
    const buttonStart = sectionBody.lastIndexOf('<button className="tool-button"', saveLabel)
    const buttonEnd = sectionBody.indexOf('</button>', buttonStart)
    const buttonBody = sectionBody.slice(buttonStart, buttonEnd)

    expect(saveBody).toContain('if (!canSaveTask) {')
    expect(saveBody).toContain("text: 'Enter a valid 5-field cron schedule and prompt before saving.'")
    expect(rendererSource).toContain('function handleScheduledTaskSaveClick(): void')
    expect(buttonBody).toContain('onClick={handleScheduledTaskSaveClick}')
    expect(buttonBody).toContain('disabled={!canSaveTask || !!loadingLabel}')
    expect(buttonBody).not.toContain('onClick={() => !loadingLabel && void saveScheduledTask()}')
    expect(buttonBody).not.toContain('canSaveTask && !loadingLabel && void saveScheduledTask()')
  })

  it('disables metadata draft fields while loading', () => {
    function expectFieldDisabled(source: string, ariaLabel: string): void {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const fieldEnd = source.indexOf('/>', labelIndex)
      const fieldBody = source.slice(fieldStart, fieldEnd)
      expect(fieldBody).toContain('disabled={!!loadingLabel}')
    }
    function expectFieldLoadingDisabled(source: string, ariaLabel: string): void {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const fieldEnd = source.indexOf('/>', labelIndex)
      const fieldBody = source.slice(fieldStart, fieldEnd)
      expect(fieldBody).toContain('!!loadingLabel')
    }
    function expectFieldChangeGuarded(source: string, ariaLabel: string, setter: string): void {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const closingEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : -1
      const fieldEnd = closingEnd > -1 ? closingEnd : selfClosingEnd
      const fieldBody = source.slice(fieldStart, fieldEnd)
      expect(fieldBody).toContain('if (loadingLabel) return')
      expect(fieldBody.indexOf('if (loadingLabel) return')).toBeLessThan(
        fieldBody.indexOf(setter),
      )
    }
    function expectFieldChangeLoadingGuarded(source: string, ariaLabel: string, setter: string): void {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const closingEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : -1
      const fieldEnd = closingEnd > -1 ? closingEnd : selfClosingEnd
      const fieldBody = source.slice(fieldStart, fieldEnd)
      expect(fieldBody).toContain('loadingLabel) return')
      expect(fieldBody.indexOf('loadingLabel) return')).toBeLessThan(
        fieldBody.indexOf(setter),
      )
    }
    function fieldBodyFor(source: string, ariaLabel: string): string {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const closingEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : -1
      const fieldEnd = closingEnd > -1 ? closingEnd : selfClosingEnd
      return source.slice(fieldStart, fieldEnd)
    }

    const projectTaskStart = rendererSource.indexOf('function renderProjectScheduledTasksSection')
    const projectTaskEnd = rendererSource.indexOf('function renderGlobalScheduledTasksSection', projectTaskStart)
    const projectTaskBody = rendererSource.slice(projectTaskStart, projectTaskEnd)
    expectFieldDisabled(projectTaskBody, 'Project task cron schedule')
    expectFieldDisabled(projectTaskBody, 'Project task recurring')
    expectFieldDisabled(projectTaskBody, 'Project task prompt')
    expect(rendererSource).toContain('function handleProjectTaskCronChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(rendererSource).toContain('function handleProjectTaskRecurringChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(rendererSource).toContain('function handleProjectTaskPromptChange(event: ReactChangeEvent<HTMLTextAreaElement>): void')
    expect(fieldBodyFor(projectTaskBody, 'Project task cron schedule')).toContain('onChange={handleProjectTaskCronChange}')
    expect(fieldBodyFor(projectTaskBody, 'Project task recurring')).toContain('onChange={handleProjectTaskRecurringChange}')
    expect(fieldBodyFor(projectTaskBody, 'Project task prompt')).toContain('onChange={handleProjectTaskPromptChange}')
    expect(fieldBodyFor(projectTaskBody, 'Project task cron schedule')).not.toContain('setProjectTaskDraft(prev => ({')
    expect(fieldBodyFor(projectTaskBody, 'Project task recurring')).not.toContain('setProjectTaskDraft(prev => ({')
    expect(fieldBodyFor(projectTaskBody, 'Project task prompt')).not.toContain('setProjectTaskDraft(prev => ({')

    const globalTaskStart = rendererSource.indexOf('function renderGlobalScheduledTasksSection')
    const globalTaskEnd = rendererSource.indexOf('function startResize', globalTaskStart)
    const globalTaskBody = rendererSource.slice(globalTaskStart, globalTaskEnd)
    expectFieldDisabled(globalTaskBody, 'Scheduled task name')
    expectFieldDisabled(globalTaskBody, 'Scheduled task schedule')
    expectFieldDisabled(globalTaskBody, 'Scheduled task prompt')
    expectFieldDisabled(globalTaskBody, 'Scheduled task enabled')
    expect(rendererSource).toContain('function handleScheduledTaskNameChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(rendererSource).toContain('function handleScheduledTaskScheduleChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(rendererSource).toContain('function handleScheduledTaskPromptChange(event: ReactChangeEvent<HTMLTextAreaElement>): void')
    expect(rendererSource).toContain('function handleScheduledTaskEnabledChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(fieldBodyFor(globalTaskBody, 'Scheduled task name')).toContain('onChange={handleScheduledTaskNameChange}')
    expect(fieldBodyFor(globalTaskBody, 'Scheduled task schedule')).toContain('onChange={handleScheduledTaskScheduleChange}')
    expect(fieldBodyFor(globalTaskBody, 'Scheduled task prompt')).toContain('onChange={handleScheduledTaskPromptChange}')
    expect(fieldBodyFor(globalTaskBody, 'Scheduled task enabled')).toContain('onChange={handleScheduledTaskEnabledChange}')
    expect(fieldBodyFor(globalTaskBody, 'Scheduled task name')).not.toContain('setTaskDraft(prev => ({')
    expect(fieldBodyFor(globalTaskBody, 'Scheduled task schedule')).not.toContain('setTaskDraft(prev => ({')
    expect(fieldBodyFor(globalTaskBody, 'Scheduled task prompt')).not.toContain('setTaskDraft(prev => ({')
    expect(fieldBodyFor(globalTaskBody, 'Scheduled task enabled')).not.toContain('setTaskDraft(prev => ({')

    const mcpStart = rendererSource.indexOf('<section className="settings-section" id="settings-mcp">')
    const mcpEnd = rendererSource.indexOf('{mcpProjectNeedsSession && (', mcpStart)
    const mcpBody = rendererSource.slice(mcpStart, mcpEnd)
    expectFieldLoadingDisabled(mcpBody, 'MCP server name')
    expectFieldDisabled(mcpBody, 'MCP server scope')
    expectFieldLoadingDisabled(mcpBody, 'MCP server mode')
    expectFieldLoadingDisabled(mcpBody, 'MCP command')
    expectFieldLoadingDisabled(mcpBody, 'MCP command arguments')
    expectFieldLoadingDisabled(mcpBody, 'MCP remote type')
    expectFieldLoadingDisabled(mcpBody, 'MCP remote URL')
    expect(rendererSource).toContain('function handleMcpDraftNameChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(rendererSource).toContain('function handleMcpDraftScopeChange(event: ReactChangeEvent<HTMLSelectElement>): void')
    expect(rendererSource).toContain('function handleMcpDraftModeChange(event: ReactChangeEvent<HTMLSelectElement>): void')
    expect(rendererSource).toContain('function handleMcpDraftCommandChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(rendererSource).toContain('function handleMcpDraftArgsChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(rendererSource).toContain('function handleMcpDraftRemoteTypeChange(event: ReactChangeEvent<HTMLSelectElement>): void')
    expect(rendererSource).toContain('function handleMcpDraftRemoteUrlChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(fieldBodyFor(mcpBody, 'MCP server name')).toContain('onChange={handleMcpDraftNameChange}')
    expect(fieldBodyFor(mcpBody, 'MCP server scope')).toContain('onChange={handleMcpDraftScopeChange}')
    expect(fieldBodyFor(mcpBody, 'MCP server mode')).toContain('onChange={handleMcpDraftModeChange}')
    expect(fieldBodyFor(mcpBody, 'MCP command')).toContain('onChange={handleMcpDraftCommandChange}')
    expect(fieldBodyFor(mcpBody, 'MCP command arguments')).toContain('onChange={handleMcpDraftArgsChange}')
    expect(fieldBodyFor(mcpBody, 'MCP remote type')).toContain('onChange={handleMcpDraftRemoteTypeChange}')
    expect(fieldBodyFor(mcpBody, 'MCP remote URL')).toContain('onChange={handleMcpDraftRemoteUrlChange}')
  })

  it('disables project MCP draft content fields without an active session', () => {
    function fieldBodyFor(source: string, ariaLabel: string): string {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const fieldEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : selfClosingEnd
      return source.slice(fieldStart, fieldEnd)
    }
    function expectProjectMcpFieldGuarded(source: string, ariaLabel: string, setter: string): void {
      const fieldBody = fieldBodyFor(source, ariaLabel)
      expect(fieldBody).toContain('disabled={mcpDraftSessionBlocked || !!loadingLabel}')
      expect(fieldBody).toContain('if (mcpDraftSessionBlocked || loadingLabel) return')
      expect(fieldBody.indexOf('if (mcpDraftSessionBlocked || loadingLabel) return')).toBeLessThan(
        fieldBody.indexOf(setter),
      )
    }

    const mcpStart = rendererSource.indexOf('<section className="settings-section" id="settings-mcp">')
    const mcpEnd = rendererSource.indexOf('{mcpProjectNeedsSession && (', mcpStart)
    const mcpBody = rendererSource.slice(mcpStart, mcpEnd)

    expect(rendererSource).toContain("const mcpDraftSessionBlocked = mcpDraft.scope === 'project' && !activeSession")
    expect(fieldBodyFor(mcpBody, 'MCP server scope')).toContain('disabled={!!loadingLabel}')
    expect(fieldBodyFor(mcpBody, 'MCP server scope')).toContain('onChange={handleMcpDraftScopeChange}')
    expect(fieldBodyFor(mcpBody, 'MCP server name')).toContain('onChange={handleMcpDraftNameChange}')
    expect(fieldBodyFor(mcpBody, 'MCP server name')).not.toContain('setMcpDraft(prev => ({')
    expect(fieldBodyFor(mcpBody, 'MCP server mode')).toContain('onChange={handleMcpDraftModeChange}')
    expect(fieldBodyFor(mcpBody, 'MCP server mode')).not.toContain('setMcpDraft(prev => ({')
    expect(fieldBodyFor(mcpBody, 'MCP command')).toContain('onChange={handleMcpDraftCommandChange}')
    expect(fieldBodyFor(mcpBody, 'MCP command')).not.toContain('setMcpDraft(prev => ({')
    expect(fieldBodyFor(mcpBody, 'MCP command arguments')).toContain('onChange={handleMcpDraftArgsChange}')
    expect(fieldBodyFor(mcpBody, 'MCP command arguments')).not.toContain('setMcpDraft(prev => ({')
    expect(fieldBodyFor(mcpBody, 'MCP remote type')).toContain('onChange={handleMcpDraftRemoteTypeChange}')
    expect(fieldBodyFor(mcpBody, 'MCP remote type')).not.toContain('setMcpDraft(prev => ({')
    expect(fieldBodyFor(mcpBody, 'MCP remote URL')).toContain('onChange={handleMcpDraftRemoteUrlChange}')
    expect(fieldBodyFor(mcpBody, 'MCP remote URL')).not.toContain('setMcpDraft(prev => ({')
  })

  it('blocks project MCP edit entrypoints without an active session while keeping user MCP editable', () => {
    const editStart = rendererSource.indexOf("function editMcpServer(server: McpServerInfo, scope: 'user' | 'project'): void")
    const editEnd = rendererSource.indexOf('function cancelMcpEdit', editStart)
    const editBody = rendererSource.slice(editStart, editEnd)
    const mcpStart = rendererSource.indexOf('<section className="settings-section" id="settings-mcp">')
    const mcpEnd = rendererSource.indexOf('<section className="settings-section" id="settings-skills">', mcpStart)
    const mcpBody = rendererSource.slice(mcpStart, mcpEnd)

    expect(editBody).toContain("if (scope === 'project' && !activeSession)")
    expect(editBody).toContain("text: 'Select a session before editing project MCP servers'")
    expect(editBody.indexOf("if (scope === 'project' && !activeSession)")).toBeLessThan(
      editBody.indexOf('setMcpDraft({ ...mcpDraftFromServer(server, scope), name: selectedMcpName, editingName: selectedMcpName })'),
    )
    expect(rendererSource).toContain("function handleMcpServerRowKeyDown(event: ReactKeyboardEvent<HTMLElement>, server: McpServerInfo, scope: 'user' | 'project'): void")
    expect(rendererSource).toContain("function handleMcpRowClick(server: McpServerInfo, scope: 'user' | 'project'): void")
    expect(mcpBody).toContain("onClick={() => handleMcpRowClick(server, 'user')}")
    expect(mcpBody).toContain("onKeyDown={event => handleMcpServerRowKeyDown(event, server, 'user')}")
    expect(mcpBody).toContain("onClick={() => handleMcpRowClick(server, 'project')}")
    expect(mcpBody).toContain("onKeyDown={event => handleMcpServerRowKeyDown(event, server, 'project')}")
    expect(mcpBody).toContain("onClick={() => handleMcpEditClick(server, 'user')} disabled={!!loadingLabel}")
    expect(mcpBody).toContain("onClick={() => handleMcpEditClick(server, 'project')} disabled={!activeSession || !!loadingLabel}")
    expect(mcpBody).not.toContain("onClick={() => !loadingLabel && editMcpServer(server, 'user')}")
    expect(mcpBody).not.toContain("onClick={() => !loadingLabel && editMcpServer(server, 'project')}")
    expect(mcpBody).not.toContain("onKeyDown={event => !loadingLabel && handleOptionSelectKeyDown(event, () => editMcpServer(server, 'user'))}")
    expect(mcpBody).not.toContain("onKeyDown={event => !loadingLabel && handleOptionSelectKeyDown(event, () => editMcpServer(server, 'project'))}")
  })

  it('shows a Settings error before project MCP save can run without an active session', () => {
    const saveStart = rendererSource.indexOf('async function saveMcpServer')
    const saveEnd = rendererSource.indexOf('async function removeMcpServer', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const guard = "if (scope === 'project' && !projectSession) {"

    expect(saveBody).toContain(guard)
    expect(saveBody).toContain("text: 'Select a session before editing project MCP servers'")
    expect(saveBody.indexOf(guard)).toBeLessThan(
      saveBody.indexOf("const actionKey = `${projectSession?.cwd ?? 'user'}:${scope}:save:${editingMcpName ?? name}`"),
    )
    expect(saveBody.indexOf(guard)).toBeLessThan(
      saveBody.indexOf("await runAction('Saving MCP server'"),
    )
  })

  it('disables agent draft fields while loading', () => {
    function expectOpeningTagDisabled(source: string, ariaLabel: string): void {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const fieldEnd = source.indexOf('>', labelIndex)
      const fieldBody = source.slice(fieldStart, fieldEnd)
      expect(fieldBody).toContain('!!loadingLabel')
    }
    function expectFieldChangeGuarded(source: string, ariaLabel: string, setter: string): void {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const closingEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : -1
      const fieldEnd = closingEnd > -1 ? closingEnd : selfClosingEnd
      const fieldBody = source.slice(fieldStart, fieldEnd)
      expect(fieldBody).toContain('loadingLabel) return')
      expect(fieldBody.indexOf('loadingLabel) return')).toBeLessThan(
        fieldBody.indexOf(setter),
      )
    }
    function fieldBodyFor(source: string, ariaLabel: string): string {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const closingEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : -1
      const fieldEnd = closingEnd > -1 ? closingEnd : selfClosingEnd
      return source.slice(fieldStart, fieldEnd)
    }

    const launchStart = rendererSource.indexOf('<section className="settings-section" id="agents-launch">')
    const launchEnd = rendererSource.indexOf('{agentDiagnostics && (', launchStart)
    const launchBody = rendererSource.slice(launchStart, launchEnd)
    const launchFields: Array<{ label: string; handler: string; element: string }> = [
      { label: 'Launch agent type', handler: 'handleAgentLaunchAgentTypeChange', element: 'HTMLInputElement' },
      { label: 'Launch model override', handler: 'handleAgentLaunchModelChange', element: 'HTMLInputElement' },
      { label: 'Launch permission mode', handler: 'handleAgentLaunchPermissionModeChange', element: 'HTMLInputElement' },
      { label: 'Launch task description', handler: 'handleAgentLaunchDescriptionChange', element: 'HTMLInputElement' },
      { label: 'Launch isolation', handler: 'handleAgentLaunchIsolationChange', element: 'HTMLSelectElement' },
      { label: 'Launch task prompt', handler: 'handleAgentLaunchPromptChange', element: 'HTMLTextAreaElement' },
      { label: 'Launch teammate name', handler: 'handleAgentLaunchNameChange', element: 'HTMLInputElement' },
      { label: 'Launch team name', handler: 'handleAgentLaunchTeamNameChange', element: 'HTMLInputElement' },
      { label: 'Launch teammate mode', handler: 'handleAgentLaunchModeChange', element: 'HTMLInputElement' },
      { label: 'Run launch task in background', handler: 'handleAgentLaunchRunInBackgroundChange', element: 'HTMLInputElement' },
    ]
    for (const { label } of launchFields) {
      expectOpeningTagDisabled(launchBody, label)
    }
    for (const { label, handler, element } of launchFields) {
      expect(rendererSource).toContain(`function ${handler}(event: ReactChangeEvent<${element}>): void`)
      expect(fieldBodyFor(launchBody, label)).toContain(`onChange={${handler}}`)
      expect(fieldBodyFor(launchBody, label)).not.toContain('setAgentLaunchDraft(prev => ({')
    }

    const editorStart = rendererSource.indexOf('<section className="settings-section" id="agents-editor">')
    const editorEnd = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">', editorStart)
    const editorBody = rendererSource.slice(editorStart, editorEnd)
    const editorFields: Array<{ label: string; handler: string; element: string }> = [
      { label: 'Agent editor type', handler: 'handleAgentEditorTypeChange', element: 'HTMLInputElement' },
      { label: 'Agent editor source', handler: 'handleAgentEditorSourceChange', element: 'HTMLSelectElement' },
      { label: 'When to use this agent', handler: 'handleAgentEditorWhenToUseChange', element: 'HTMLInputElement' },
      { label: 'Agent editor model', handler: 'handleAgentEditorModelChange', element: 'HTMLInputElement' },
      { label: 'Agent editor permission mode', handler: 'handleAgentEditorPermissionModeChange', element: 'HTMLInputElement' },
      { label: 'Agent editor allowed tools', handler: 'handleAgentEditorToolsChange', element: 'HTMLInputElement' },
      { label: 'Agent editor disallowed tools', handler: 'handleAgentEditorDisallowedToolsChange', element: 'HTMLInputElement' },
      { label: 'Agent editor skills', handler: 'handleAgentEditorSkillsChange', element: 'HTMLInputElement' },
      { label: 'Agent editor memory scope', handler: 'handleAgentEditorMemoryChange', element: 'HTMLInputElement' },
      { label: 'Agent editor required MCP servers', handler: 'handleAgentEditorRequiredMcpServersChange', element: 'HTMLInputElement' },
      { label: 'Agent editor isolation', handler: 'handleAgentEditorIsolationChange', element: 'HTMLSelectElement' },
      { label: 'Agent system prompt', handler: 'handleAgentEditorPromptChange', element: 'HTMLTextAreaElement' },
      { label: 'Agent runs in background', handler: 'handleAgentEditorBackgroundChange', element: 'HTMLInputElement' },
    ]
    for (const { label } of editorFields) {
      expectOpeningTagDisabled(editorBody, label)
    }
    for (const { label, handler, element } of editorFields) {
      expect(rendererSource).toContain(`function ${handler}(event: ReactChangeEvent<${element}>): void`)
      expect(fieldBodyFor(editorBody, label)).toContain(`onChange={${handler}}`)
      expect(fieldBodyFor(editorBody, label)).not.toContain('setAgentDraft(prev => ({')
    }
    expect(rendererSource).toContain('function handleAgentEditorNewClick(): void')
    expect(editorBody).toContain('<button className="tool-button" onClick={handleAgentEditorNewClick} disabled={!!loadingLabel}>')

    const tasksStart = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">')
    const tasksEnd = rendererSource.indexOf("{activePane === 'teams' && (", tasksStart)
    const tasksBody = rendererSource.slice(tasksStart, tasksEnd)
    expectOpeningTagDisabled(tasksBody, 'Agent task resume prompt')
    expect(tasksBody).toContain('onChange={handleAgentTaskPromptChange}')

    const newDraftStart = rendererSource.indexOf('function startNewAgentDraft(): void')
    const newDraftEnd = rendererSource.indexOf('async function deleteSelectedAgent', newDraftStart)
    const newDraftBody = rendererSource.slice(newDraftStart, newDraftEnd)
    expect(newDraftBody).toContain('if (loadingLabel) return')
  })

  it('disables agent launch draft fields without an active session', () => {
    function fieldBodyFor(source: string, ariaLabel: string): string {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const fieldEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : selfClosingEnd
      return source.slice(fieldStart, fieldEnd)
    }
    const launchStart = rendererSource.indexOf('<section className="settings-section" id="agents-launch">')
    const launchEnd = rendererSource.indexOf('{agentDiagnostics && (', launchStart)
    const launchBody = rendererSource.slice(launchStart, launchEnd)

    expect(rendererSource).toContain('const agentLaunchDraftSessionBlocked = !activeSession')
    const launchFields: Array<{ label: string; handler: string }> = [
      { label: 'Launch agent type', handler: 'handleAgentLaunchAgentTypeChange' },
      { label: 'Launch model override', handler: 'handleAgentLaunchModelChange' },
      { label: 'Launch permission mode', handler: 'handleAgentLaunchPermissionModeChange' },
      { label: 'Launch task description', handler: 'handleAgentLaunchDescriptionChange' },
      { label: 'Launch isolation', handler: 'handleAgentLaunchIsolationChange' },
      { label: 'Launch task prompt', handler: 'handleAgentLaunchPromptChange' },
      { label: 'Launch teammate name', handler: 'handleAgentLaunchNameChange' },
      { label: 'Launch team name', handler: 'handleAgentLaunchTeamNameChange' },
      { label: 'Launch teammate mode', handler: 'handleAgentLaunchModeChange' },
      { label: 'Run launch task in background', handler: 'handleAgentLaunchRunInBackgroundChange' },
    ]
    for (const { label, handler } of launchFields) {
      const fieldBody = fieldBodyFor(launchBody, label)
      expect(fieldBody).toContain('disabled={agentLaunchDraftSessionBlocked || !!loadingLabel}')
      expect(fieldBody).toContain(`onChange={${handler}}`)
      expect(fieldBody).not.toContain('setAgentLaunchDraft(prev => ({')
    }
  })

  it('shows visible session guidance on disabled agent launch and team forms', () => {
    const launchStart = rendererSource.indexOf('<section className="settings-section" id="agents-launch">')
    const launchEnd = rendererSource.indexOf('{agentDiagnostics && (', launchStart)
    const launchBody = rendererSource.slice(launchStart, launchEnd)
    const teamStart = rendererSource.indexOf('<section className="settings-section" id="agents-teams">')
    const teamEnd = rendererSource.indexOf('<div id="team-listbox"', teamStart)
    const teamBody = rendererSource.slice(teamStart, teamEnd)

    expect(launchBody).toContain('{agentLaunchDraftSessionBlocked && (')
    expect(launchBody).toContain('<div className="form-note">')
    expect(launchBody).toContain('Select a project session before running agents.')
    expect(teamBody).toContain('{teamDraftSessionBlocked && (')
    expect(teamBody).toContain('<div className="form-note">')
    expect(teamBody).toContain('Select a project session before managing teams.')
  })

  it('disables agent task resume prompt without an active session', () => {
    const tasksStart = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">')
    const tasksEnd = rendererSource.indexOf("{activePane === 'teams' && (", tasksStart)
    const tasksBody = rendererSource.slice(tasksStart, tasksEnd)
    const labelIndex = tasksBody.indexOf('aria-label="Agent task resume prompt"')
    expect(labelIndex).toBeGreaterThanOrEqual(0)
    const fieldStart = tasksBody.lastIndexOf('<', labelIndex)
    const fieldEnd = tasksBody.indexOf('/>', labelIndex)
    const fieldBody = tasksBody.slice(fieldStart, fieldEnd)

    expect(rendererSource).toContain('const agentTaskPromptSessionBlocked = !activeSession')
    expect(fieldBody).toContain('disabled={agentTaskPromptSessionBlocked || !!loadingLabel}')
    expect(rendererSource).toContain('function handleAgentTaskPromptChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(fieldBody).toContain('onChange={handleAgentTaskPromptChange}')
    expect(fieldBody).not.toContain('setAgentTaskPrompt(event.target.value)')
  })

  it('blocks agent editor save and delete entrypoints when prerequisites are unavailable', () => {
    const saveStart = rendererSource.indexOf('async function saveAgentDraft')
    const saveEnd = rendererSource.indexOf('function startNewAgentDraft', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const deleteStart = rendererSource.indexOf('async function deleteSelectedAgent')
    const deleteEnd = rendererSource.indexOf('async function runAgentEditorAction', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const editorStart = rendererSource.indexOf('<section className="settings-section" id="agents-editor">')
    const editorEnd = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">', editorStart)
    const editorBody = rendererSource.slice(editorStart, editorEnd)

    for (const body of [saveBody, deleteBody]) {
      expect(body).toContain('if (loadingLabel) return')
    }
    const missingAgentTypeGuard = 'if (!agentDraft.agentType) {'
    expect(deleteBody).toContain(missingAgentTypeGuard)
    expect(deleteBody).toContain("text: 'Select an agent before deleting.'")
    expect(deleteBody.indexOf(missingAgentTypeGuard)).toBeLessThan(
      deleteBody.indexOf('await requestConfirmation({'),
    )
    expect(rendererSource).toContain('function handleAgentEditorSaveClick(): void')
    expect(rendererSource).toContain('function handleAgentEditorDeleteClick(): void')
    expect(editorBody).toContain('<button className="tool-button" onClick={handleAgentEditorSaveClick} disabled={(agentDraft.source === \'project\' && !activeSession) || !agentDraft.agentType.trim() || !agentDraft.whenToUse.trim() || !agentDraft.prompt.trim() || !!loadingLabel}>')
    expect(editorBody).toContain('<button className="tool-button danger" onClick={handleAgentEditorDeleteClick} disabled={!canDeleteAgentDraft || !!loadingLabel}>')
  })

  it('routes stale agent editor save clicks through the Agents handler', () => {
    const saveStart = rendererSource.indexOf('async function saveAgentDraft')
    const saveEnd = rendererSource.indexOf('function startNewAgentDraft', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const editorStart = rendererSource.indexOf('<section className="settings-section" id="agents-editor">')
    const editorEnd = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">', editorStart)
    const editorBody = rendererSource.slice(editorStart, editorEnd)

    expect(saveBody).toContain("text: 'Choose an agent type before saving.'")
    expect(saveBody).toContain("text: 'Enter when-to-use guidance before saving this agent.'")
    expect(saveBody).toContain("text: 'Enter an agent system prompt before saving.'")
    expect(saveBody.indexOf("text: 'Choose an agent type before saving.'")).toBeLessThan(
      saveBody.indexOf('await runAgentEditorAction('),
    )
    expect(saveBody.indexOf("text: 'Enter when-to-use guidance before saving this agent.'")).toBeLessThan(
      saveBody.indexOf('await runAgentEditorAction('),
    )
    expect(saveBody.indexOf("text: 'Enter an agent system prompt before saving.'")).toBeLessThan(
      saveBody.indexOf('await runAgentEditorAction('),
    )
    expect(rendererSource).toContain('function handleAgentEditorSaveClick(): void')
    expect(editorBody).toContain('<button className="tool-button" onClick={handleAgentEditorSaveClick} disabled={(agentDraft.source === \'project\' && !activeSession) || !agentDraft.agentType.trim() || !agentDraft.whenToUse.trim() || !agentDraft.prompt.trim() || !!loadingLabel}>')
    expect(editorBody).not.toContain('onClick={() => !loadingLabel && void saveAgentDraft()}')
    expect(editorBody).not.toContain('(agentDraft.source !== \'project\' || activeSession) && agentDraft.agentType.trim() && agentDraft.whenToUse.trim() && agentDraft.prompt.trim() && !loadingLabel && void saveAgentDraft()')
  })

  it('routes stale agent editor delete clicks through the Agents handler', () => {
    const deleteStart = rendererSource.indexOf('async function deleteSelectedAgent')
    const deleteEnd = rendererSource.indexOf('async function runAgentEditorAction', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const editorStart = rendererSource.indexOf('<section className="settings-section" id="agents-editor">')
    const editorEnd = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">', editorStart)
    const editorBody = rendererSource.slice(editorStart, editorEnd)

    expect(deleteBody).toContain("text: 'Select a session before managing project agents.'")
    expect(deleteBody).toContain("text: 'Select an agent before deleting.'")
    expect(deleteBody.indexOf("text: 'Select a session before managing project agents.'")).toBeLessThan(
      deleteBody.indexOf('await requestConfirmation({'),
    )
    expect(deleteBody.indexOf("text: 'Select an agent before deleting.'")).toBeLessThan(
      deleteBody.indexOf('await requestConfirmation({'),
    )
    expect(rendererSource).toContain('function handleAgentEditorDeleteClick(): void')
    expect(editorBody).toContain('<button className="tool-button danger" onClick={handleAgentEditorDeleteClick} disabled={!canDeleteAgentDraft || !!loadingLabel}>')
    expect(editorBody).not.toContain('onClick={() => !loadingLabel && void deleteSelectedAgent()}')
    expect(editorBody).not.toContain('canDeleteAgentDraft && !loadingLabel && void deleteSelectedAgent()')
  })

  it('clears persisted selected agent identity when starting a new agent draft', () => {
    const start = rendererSource.indexOf('function startNewAgentDraft(): void')
    const end = rendererSource.indexOf('async function deleteSelectedAgent', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('setSelectedAgentType(undefined)')
    expect(body).toContain('setSelectedAgentSource(undefined)')
    expect(body).toContain('setChatTarget(prev =>')
    expect(body).toContain("prev.type === 'agent'")
    expect(body).toContain("? { type: 'session', teamName: '', agentType: '' }")
    expect(body).toContain('const session = activeSession')
    expect(body).toContain('if (session) void updateSessionLayout(session.id, {')
    expect(body).toContain('selectedAgentType: undefined')
    expect(body).toContain('selectedAgentSource: undefined')
    expect(body).not.toContain('void updateLayout({')
    expect(body.indexOf('setSelectedAgentSource(undefined)')).toBeLessThan(
      body.indexOf('setChatTarget(prev =>'),
    )
    expect(body.indexOf('setChatTarget(prev =>')).toBeLessThan(
      body.indexOf('if (session) void updateSessionLayout(session.id, {'),
    )
  })

  it('allows user custom agent lifecycle without an active project session', () => {
    const canDeleteStart = rendererSource.indexOf('const canDeleteAgentDraft = Boolean(')
    const canDeleteEnd = rendererSource.indexOf('function setActivePaneError', canDeleteStart)
    const canDeleteBody = rendererSource.slice(canDeleteStart, canDeleteEnd)
    const saveStart = rendererSource.indexOf('async function saveAgentDraft')
    const saveEnd = rendererSource.indexOf('function startNewAgentDraft', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const deleteStart = rendererSource.indexOf('async function deleteSelectedAgent')
    const deleteEnd = rendererSource.indexOf('async function runAgentEditorAction', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)

    expect(canDeleteBody).toContain("(agentDraft.source === 'user' || activeSession)")
    expect(saveBody).toContain("if (!activeSession && agentDraft.source === 'project')")
    expect(saveBody).toContain("const cwd = session?.cwd ?? ''")
    expect(saveBody).toContain('await window.claudeDesktop.agents.save(')
    expect(deleteBody).toContain("if (!activeSession && agent.source === 'project')")
    expect(deleteBody).toContain("const cwd = session?.cwd ?? ''")
    expect(deleteBody).toContain('await window.claudeDesktop.agents.delete(')
  })

  it('shows an Agents error when project agent save or delete loses the active session', () => {
    const saveStart = rendererSource.indexOf('async function saveAgentDraft')
    const saveEnd = rendererSource.indexOf('function startNewAgentDraft', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const deleteStart = rendererSource.indexOf('async function deleteSelectedAgent')
    const deleteEnd = rendererSource.indexOf('async function runAgentEditorAction', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)

    expect(saveBody).toContain("if (!activeSession && agentDraft.source === 'project') {")
    expect(saveBody).toContain("text: 'Select a session before managing project agents.'")
    expect(saveBody.indexOf("if (!activeSession && agentDraft.source === 'project') {")).toBeLessThan(
      saveBody.indexOf('const session = activeSession'),
    )

    expect(deleteBody).toContain("if (!activeSession && agent.source === 'project') {")
    expect(deleteBody).toContain("text: 'Select a session before managing project agents.'")
    expect(deleteBody.indexOf("if (!activeSession && agent.source === 'project') {")).toBeLessThan(
      deleteBody.indexOf('const session = activeSession'),
    )
    for (const body of [saveBody, deleteBody]) {
      expect(body).toContain("text: 'Select a session before managing project agents.'")
    }
    expect(deleteBody.indexOf("if (!activeSession && agent.source === 'project') {")).toBeLessThan(
      deleteBody.indexOf("const actionKey = `${session?.id ?? 'user'}:${deletedAgentSource}:${deletedAgentType.trim()}:delete`"),
    )
    expect(deleteBody.indexOf("if (!activeSession && agent.source === 'project') {")).toBeLessThan(
      deleteBody.indexOf('requestConfirmation({'),
    )
  })

  it('disables team draft fields while loading', () => {
    function expectOpeningTagDisabled(source: string, ariaLabel: string): void {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const fieldEnd = source.indexOf('>', labelIndex)
      const fieldBody = source.slice(fieldStart, fieldEnd)
      expect(fieldBody).toContain('!!loadingLabel')
    }
    function fieldBodyFor(source: string, ariaLabel: string): string {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const closingEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : -1
      const fieldEnd = closingEnd > -1 ? closingEnd : selfClosingEnd
      return source.slice(fieldStart, fieldEnd)
    }

    const teamStart = rendererSource.indexOf('<section className="settings-section" id="agents-teams">')
    const teamEnd = rendererSource.indexOf('<div id="team-listbox"', teamStart)
    const teamBody = rendererSource.slice(teamStart, teamEnd)
    const fields: Array<{ label: string; handler: string; element: string }> = [
      { label: 'Team name', handler: 'handleTeamDraftTeamNameChange', element: 'HTMLInputElement' },
      { label: 'Team lead agent type', handler: 'handleTeamDraftAgentTypeChange', element: 'HTMLInputElement' },
      { label: 'Team purpose', handler: 'handleTeamDraftDescriptionChange', element: 'HTMLInputElement' },
      { label: 'Team teammate agent type', handler: 'handleTeamDraftTeammateAgentTypeChange', element: 'HTMLInputElement' },
      { label: 'Team teammate name', handler: 'handleTeamDraftTeammateNameChange', element: 'HTMLInputElement' },
      { label: 'Team teammate mode', handler: 'handleTeamDraftTeammateModeChange', element: 'HTMLInputElement' },
      { label: 'Team teammate prompt', handler: 'handleTeamDraftTeammatePromptChange', element: 'HTMLTextAreaElement' },
      { label: 'Team message recipient', handler: 'handleTeamDraftMessageRecipientChange', element: 'HTMLInputElement' },
      { label: 'Team shutdown reason', handler: 'handleTeamDraftShutdownReasonChange', element: 'HTMLInputElement' },
      { label: 'Team message', handler: 'handleTeamDraftMessageChange', element: 'HTMLTextAreaElement' },
    ]
    for (const { label, handler, element } of fields) {
      expect(rendererSource).toContain(`function ${handler}(event: ReactChangeEvent<${element}>): void`)
      expectOpeningTagDisabled(teamBody, label)
      expect(fieldBodyFor(teamBody, label)).toContain(`onChange={${handler}}`)
    }
  })

  it('disables team draft fields without an active session', () => {
    function fieldBodyFor(source: string, ariaLabel: string): string {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const fieldEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : selfClosingEnd
      return source.slice(fieldStart, fieldEnd)
    }
    const teamStart = rendererSource.indexOf('<section className="settings-section" id="agents-teams">')
    const teamEnd = rendererSource.indexOf('<div id="team-listbox"', teamStart)
    const teamBody = rendererSource.slice(teamStart, teamEnd)

    expect(rendererSource).toContain('const teamDraftSessionBlocked = !activeSession')
    const fields: Array<{ label: string; handler: string }> = [
      { label: 'Team name', handler: 'handleTeamDraftTeamNameChange' },
      { label: 'Team lead agent type', handler: 'handleTeamDraftAgentTypeChange' },
      { label: 'Team purpose', handler: 'handleTeamDraftDescriptionChange' },
      { label: 'Team teammate agent type', handler: 'handleTeamDraftTeammateAgentTypeChange' },
      { label: 'Team teammate name', handler: 'handleTeamDraftTeammateNameChange' },
      { label: 'Team teammate mode', handler: 'handleTeamDraftTeammateModeChange' },
      { label: 'Team teammate prompt', handler: 'handleTeamDraftTeammatePromptChange' },
      { label: 'Team message recipient', handler: 'handleTeamDraftMessageRecipientChange' },
      { label: 'Team shutdown reason', handler: 'handleTeamDraftShutdownReasonChange' },
      { label: 'Team message', handler: 'handleTeamDraftMessageChange' },
    ]
    for (const { label, handler } of fields) {
      const fieldBody = fieldBodyFor(teamBody, label)
      expect(fieldBody).toContain('disabled={teamDraftSessionBlocked || !!loadingLabel}')
      expect(fieldBody).toContain(`onChange={${handler}}`)
      expect(fieldBody).not.toContain('setTeamDraft(prev => ({')
    }
  })

  it('disables skill and plugin draft fields while loading', () => {
    function fieldBodyFor(source: string, ariaLabel: string): string {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const fieldEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : selfClosingEnd
      return source.slice(fieldStart, fieldEnd)
    }
    function expectOpeningTagDisabled(source: string, ariaLabel: string): void {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const fieldEnd = source.indexOf('>', labelIndex)
      const fieldBody = source.slice(fieldStart, fieldEnd)
      expect(fieldBody).toContain('!!loadingLabel')
    }
    function expectFieldChangeGuarded(source: string, ariaLabel: string, setter: string): void {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const closingEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : -1
      const fieldEnd = closingEnd > -1 ? closingEnd : selfClosingEnd
      const fieldBody = source.slice(fieldStart, fieldEnd)
      expect(fieldBody).toContain('loadingLabel) return')
      expect(fieldBody.indexOf('loadingLabel) return')).toBeLessThan(
        fieldBody.indexOf(setter),
      )
    }

    const proxyStart = rendererSource.indexOf('<section className="settings-section" id="settings-proxy">')
    const proxyEnd = rendererSource.indexOf('<details className="settings-drawer" open>', proxyStart)
    const proxyBody = rendererSource.slice(proxyStart, proxyEnd)
    expectOpeningTagDisabled(proxyBody, 'Enable proxy for Claude Code runtime')
    expectOpeningTagDisabled(proxyBody, 'Proxy URL')
    expect(rendererSource).toContain('function handleProxyEnabledChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(rendererSource).toContain('function handleProxyUrlChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(fieldBodyFor(proxyBody, 'Enable proxy for Claude Code runtime')).toContain('onChange={handleProxyEnabledChange}')
    expect(fieldBodyFor(proxyBody, 'Proxy URL')).toContain('onChange={handleProxyUrlChange}')
    expect(fieldBodyFor(proxyBody, 'Enable proxy for Claude Code runtime')).not.toContain('setProxyDraft(prev => ({')
    expect(fieldBodyFor(proxyBody, 'Proxy URL')).not.toContain('setProxyDraft(prev => ({')

    const skillStart = rendererSource.indexOf('<div className="settings-form" aria-label="Skill editor">')
    const skillEnd = rendererSource.indexOf('<div id="skill-listbox"', skillStart)
    const skillBody = rendererSource.slice(skillStart, skillEnd)
    expectOpeningTagDisabled(skillBody, 'Skill name')
    expectOpeningTagDisabled(skillBody, 'Skill scope')
    expectOpeningTagDisabled(skillBody, 'Skill contents')
    expect(skillBody).toContain('onChange={handleSkillDraftNameChange}')
    expect(skillBody).toContain('onChange={handleSkillDraftScopeChange}')
    expect(skillBody).toContain('onChange={handleSkillDraftContentsChange}')

    const newUserStart = rendererSource.indexOf('function startNewUserSkillDraft(): void')
    const newUserEnd = rendererSource.indexOf('function startNewProjectSkillDraft', newUserStart)
    const newUserBody = rendererSource.slice(newUserStart, newUserEnd)
    const newProjectStart = rendererSource.indexOf('function startNewProjectSkillDraft(): void')
    const newProjectEnd = rendererSource.indexOf('function editSkillDetail', newProjectStart)
    const newProjectBody = rendererSource.slice(newProjectStart, newProjectEnd)
    const cancelStart = rendererSource.indexOf('function cancelSkillDraft(): void')
    const cancelEnd = rendererSource.indexOf('async function saveSkillDraft', cancelStart)
    const cancelBody = rendererSource.slice(cancelStart, cancelEnd)
    expect(newUserBody).toContain('if (loadingLabel) return')
    expect(newProjectBody).toContain('if (loadingLabel) return')
    expect(cancelBody).toContain('if (loadingLabel) return')

    const pluginStart = rendererSource.indexOf('<section className="settings-section" id="settings-plugins">')
    const pluginEnd = rendererSource.indexOf('{pluginOutput ? (', pluginStart)
    const pluginBody = rendererSource.slice(pluginStart, pluginEnd)
    expect(fieldBodyFor(pluginBody, 'Plugin package')).toContain('!!loadingLabel')
    expectOpeningTagDisabled(pluginBody, 'Plugin install scope')
    expect(rendererSource).toContain('function handlePluginDraftPackageChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(rendererSource).toContain('function handlePluginDraftScopeChange(event: ReactChangeEvent<HTMLSelectElement>): void')
    expect(fieldBodyFor(pluginBody, 'Plugin package')).toContain('onChange={handlePluginDraftPackageChange}')
    expect(fieldBodyFor(pluginBody, 'Plugin install scope')).toContain('onChange={handlePluginDraftScopeChange}')
  })

  it('disables project and local plugin package edits without an active session', () => {
    function fieldBodyFor(source: string, ariaLabel: string): string {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const fieldEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : selfClosingEnd
      return source.slice(fieldStart, fieldEnd)
    }

    const pluginStart = rendererSource.indexOf('<section className="settings-section" id="settings-plugins">')
    const pluginEnd = rendererSource.indexOf('{pluginOutput ? (', pluginStart)
    const pluginBody = rendererSource.slice(pluginStart, pluginEnd)
    const packageBody = fieldBodyFor(pluginBody, 'Plugin package')
    const scopeBody = fieldBodyFor(pluginBody, 'Plugin install scope')

    expect(rendererSource).toContain('const pluginDraftSessionBlocked = pluginScopeNeedsSession')
    expect(packageBody).toContain('disabled={pluginDraftSessionBlocked || !!loadingLabel}')
    expect(packageBody).toContain('onChange={handlePluginDraftPackageChange}')
    expect(packageBody).not.toContain('setPluginDraft(prev => ({')
    expect(scopeBody).toContain('disabled={!!loadingLabel}')
    expect(scopeBody).toContain('onChange={handlePluginDraftScopeChange}')
  })

  it('disables project skill draft fields without an active session', () => {
    function expectProjectSkillFieldGuarded(source: string, ariaLabel: string, handler: string): void {
      const labelIndex = source.indexOf(`aria-label="${ariaLabel}"`)
      expect(labelIndex).toBeGreaterThanOrEqual(0)
      const fieldStart = source.lastIndexOf('<', labelIndex)
      const openingEnd = source.indexOf('>', labelIndex)
      const tagName = source.slice(fieldStart + 1, openingEnd).split(/\s+/)[0]
      const closingIndex = tagName === 'select' || tagName === 'textarea'
        ? source.indexOf(`</${tagName}>`, labelIndex)
        : -1
      const selfClosingEnd = source.indexOf('/>', labelIndex)
      const fieldEnd = closingIndex > -1 ? closingIndex + `</${tagName}>`.length : selfClosingEnd
      const fieldBody = source.slice(fieldStart, fieldEnd)

      expect(fieldBody).toContain('disabled={skillDraftSessionBlocked || !!loadingLabel}')
      expect(fieldBody).toContain(`onChange={${handler}}`)
      expect(fieldBody).not.toContain('setSkillDraft(prev => prev ? {')
    }

    const skillStart = rendererSource.indexOf('<div className="settings-form" aria-label="Skill editor">')
    const skillEnd = rendererSource.indexOf('<div id="skill-listbox"', skillStart)
    const skillBody = rendererSource.slice(skillStart, skillEnd)

    expect(rendererSource).toContain("const skillDraftSessionBlocked = skillDraft?.scope === 'project' && !activeSession")
    expect(rendererSource).toContain('function handleSkillDraftNameChange(event: ReactChangeEvent<HTMLInputElement>): void')
    expect(rendererSource).toContain('function handleSkillDraftScopeChange(event: ReactChangeEvent<HTMLSelectElement>): void')
    expect(rendererSource).toContain('function handleSkillDraftContentsChange(event: ReactChangeEvent<HTMLTextAreaElement>): void')
    expectProjectSkillFieldGuarded(skillBody, 'Skill name', 'handleSkillDraftNameChange')
    expectProjectSkillFieldGuarded(skillBody, 'Skill scope', 'handleSkillDraftScopeChange')
    expectProjectSkillFieldGuarded(skillBody, 'Skill contents', 'handleSkillDraftContentsChange')
  })

  it('blocks skill edit entrypoints while loading', () => {
    const editDetailStart = rendererSource.indexOf('function editSkillDetail(')
    const editDetailEnd = rendererSource.indexOf('async function editUserSkill', editDetailStart)
    const editDetailBody = rendererSource.slice(editDetailStart, editDetailEnd)
    const editUserStart = rendererSource.indexOf('async function editUserSkill(skill: InstalledSkillInfo): Promise<void>')
    const editUserEnd = rendererSource.indexOf('async function editProjectSkill', editUserStart)
    const editUserBody = rendererSource.slice(editUserStart, editUserEnd)
    const editProjectStart = rendererSource.indexOf('async function editProjectSkill(skill: InstalledSkillInfo): Promise<void>')
    const editProjectEnd = rendererSource.indexOf('function cancelSkillDraft', editProjectStart)
    const editProjectBody = rendererSource.slice(editProjectStart, editProjectEnd)

    for (const body of [editDetailBody, editUserBody, editProjectBody]) {
      expect(body).toContain('if (loadingLabel) return')
    }
  })

  it('blocks skill draft and edit buttons while loading', () => {
    const skillStart = rendererSource.indexOf('<section className="settings-section" id="settings-skills">')
    const skillEnd = rendererSource.indexOf('<section className="settings-section" id="settings-project-tasks">', skillStart)
    const skillBody = rendererSource.slice(skillStart, skillEnd)

    expect(rendererSource).toContain('function handleUserSkillNewClick(): void')
    expect(rendererSource).toContain('function handleProjectSkillNewClick(): void')
    expect(rendererSource).toContain('function handleSkillCancelClick(): void')
    expect(rendererSource).toContain("function handleSkillEditClick(skill: InstalledSkillInfo, scope: 'user' | 'project'): void")
    expect(skillBody).toContain('<button className="tool-button" onClick={handleUserSkillNewClick} disabled={!!loadingLabel}>')
    expect(skillBody).toContain('<button className="tool-button" onClick={handleProjectSkillNewClick} disabled={!activeSession || !!loadingLabel}>')
    expect(skillBody).toContain('<button className="tool-button" onClick={handleSkillCancelClick} disabled={!!loadingLabel}>')
    expect(skillBody).toContain('<button className="tool-button" onClick={() => handleSkillEditClick(skill, \'user\')} disabled={!!loadingLabel}>')
    expect(skillBody).toContain('<button className="tool-button" onClick={() => handleSkillEditClick(skill, \'project\')} disabled={!activeSession || !!loadingLabel}>')
    expect(skillBody).toContain('onClick={handleSelectedSkillDetailEditClick}')
    expect(skillBody).not.toContain('!loadingLabel && editSkillDetail(')
    expect(skillBody).not.toContain('if (!loadingLabel) editSkillDetail(')
  })

  it('routes stale project skill creation through the Settings handler', () => {
    const skillStart = rendererSource.indexOf('<section className="settings-section" id="settings-skills">')
    const skillEnd = rendererSource.indexOf('<section className="settings-section" id="settings-project-tasks">', skillStart)
    const skillBody = rendererSource.slice(skillStart, skillEnd)

    expect(rendererSource).toContain('function handleProjectSkillNewClick(): void')
    expect(skillBody).toContain('<button className="tool-button" onClick={handleProjectSkillNewClick} disabled={!activeSession || !!loadingLabel}>')
    expect(skillBody).not.toContain('onClick={() => !loadingLabel && startNewProjectSkillDraft()}')
    expect(skillBody).not.toContain('activeSession && !loadingLabel && startNewProjectSkillDraft()')
  })

  it('blocks skill runtime management entrypoints while loading', () => {
    const installUserStart = rendererSource.indexOf('async function installLocalSkill(): Promise<void>')
    const installUserEnd = rendererSource.indexOf('async function installProjectSkill', installUserStart)
    const installUserBody = rendererSource.slice(installUserStart, installUserEnd)
    const installProjectStart = rendererSource.indexOf('async function installProjectSkill(): Promise<void>')
    const installProjectEnd = rendererSource.indexOf('async function inspectUserSkill', installProjectStart)
    const installProjectBody = rendererSource.slice(installProjectStart, installProjectEnd)
    const inspectUserStart = rendererSource.indexOf('async function inspectUserSkill(skill: InstalledSkillInfo): Promise<void>')
    const inspectUserEnd = rendererSource.indexOf('async function inspectProjectSkill', inspectUserStart)
    const inspectUserBody = rendererSource.slice(inspectUserStart, inspectUserEnd)
    const inspectProjectStart = rendererSource.indexOf('async function inspectProjectSkill(skill: InstalledSkillInfo): Promise<void>')
    const inspectProjectEnd = rendererSource.indexOf('function startNewUserSkillDraft', inspectProjectStart)
    const inspectProjectBody = rendererSource.slice(inspectProjectStart, inspectProjectEnd)
    const saveStart = rendererSource.indexOf('async function saveSkillDraft(): Promise<void>')
    const saveEnd = rendererSource.indexOf('async function removeUserSkill', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const removeUserStart = rendererSource.indexOf('async function removeUserSkill(skill: InstalledSkillInfo): Promise<void>')
    const removeUserEnd = rendererSource.indexOf('async function removeProjectSkill', removeUserStart)
    const removeUserBody = rendererSource.slice(removeUserStart, removeUserEnd)
    const removeProjectStart = rendererSource.indexOf('async function removeProjectSkill(skill: InstalledSkillInfo): Promise<void>')
    const removeProjectEnd = rendererSource.indexOf('async function saveMcpServer', removeProjectStart)
    const removeProjectBody = rendererSource.slice(removeProjectStart, removeProjectEnd)

    for (const body of [
      installUserBody,
      installProjectBody,
      inspectUserBody,
      inspectProjectBody,
      saveBody,
      removeUserBody,
      removeProjectBody,
    ]) {
      expect(body).toContain('if (loadingLabel) return')
    }

    expect(rendererSource).toContain('<button className="tool-button" onClick={handleUserSkillInstallClick} disabled={!!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={handleProjectSkillInstallClick} disabled={!activeSession || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={handleSkillSaveClick} disabled={!skillDraft || !!loadingLabel || !canSaveSkill}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => handleSkillInspectClick(skill, \'user\')} disabled={!!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button danger" onClick={() => handleSkillRemoveClick(skill, \'user\')} disabled={!!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => handleSkillInspectClick(skill, \'project\')} disabled={!activeSession || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button" onClick={() => handleSkillEditClick(skill, \'project\')} disabled={!activeSession || !!loadingLabel}>')
    expect(rendererSource).toContain('<button className="tool-button danger" onClick={() => handleSkillRemoveClick(skill, \'project\')} disabled={!activeSession || !!loadingLabel}>')
  })

  it('routes stale project skill installs through the Settings handler', () => {
    const skillStart = rendererSource.indexOf('<section className="settings-section" id="settings-skills">')
    const skillEnd = rendererSource.indexOf('<section className="settings-section" id="settings-project-tasks">', skillStart)
    const skillBody = rendererSource.slice(skillStart, skillEnd)

    expect(rendererSource).toContain('function handleProjectSkillInstallClick(): void')
    expect(skillBody).toContain('<button className="tool-button" onClick={handleProjectSkillInstallClick} disabled={!activeSession || !!loadingLabel}>')
    expect(skillBody).not.toContain('onClick={() => !loadingLabel && void installProjectSkill()}')
    expect(skillBody).not.toContain('activeSession && !loadingLabel && void installProjectSkill()')
  })

  it('routes stale skill save clicks through the Settings handler', () => {
    const saveStart = rendererSource.indexOf('async function saveSkillDraft(): Promise<void>')
    const saveEnd = rendererSource.indexOf('async function removeUserSkill', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const skillStart = rendererSource.indexOf('<section className="settings-section" id="settings-skills">')
    const skillEnd = rendererSource.indexOf('<section className="settings-section" id="settings-project-tasks">', skillStart)
    const skillBody = rendererSource.slice(skillStart, skillEnd)

    expect(saveBody).toContain("text: 'Start or select a skill draft before saving.'")
    expect(saveBody).toContain("text: 'Choose a valid skill scope before saving.'")
    expect(saveBody).toContain("throw new Error('Skill name and contents are required.')")
    expect(saveBody).toContain("throw new Error('Select a session before editing project skills.')")
    expect(rendererSource).toContain('function handleSkillSaveClick(): void')
    expect(skillBody).toContain('<button className="tool-button" onClick={handleSkillSaveClick} disabled={!skillDraft || !!loadingLabel || !canSaveSkill}>')
    expect(skillBody).not.toContain('onClick={() => !loadingLabel && void saveSkillDraft()}')
    expect(skillBody).not.toContain('canSaveSkill && !loadingLabel && void saveSkillDraft()')
  })

  it('selects installed skills for immediate follow-up actions', () => {
    const installUserStart = rendererSource.indexOf('async function installLocalSkill(): Promise<void>')
    const installUserEnd = rendererSource.indexOf('async function installProjectSkill', installUserStart)
    const installUserBody = rendererSource.slice(installUserStart, installUserEnd)
    const installProjectStart = rendererSource.indexOf('async function installProjectSkill(): Promise<void>')
    const installProjectEnd = rendererSource.indexOf('async function inspectUserSkill', installProjectStart)
    const installProjectBody = rendererSource.slice(installProjectStart, installProjectEnd)

    expect(installUserBody).toContain('setSelectedSkillDetail(installed)')
    expect(installUserBody).toContain("setSelectedSkillDetailScope('user')")
    expect(installUserBody).toContain('selectedSkillName: installed.name')
    expect(installUserBody).toContain('selectedSkillPath: installed.path')
    expect(installUserBody).toContain("selectedSkillScope: 'user'")
    expect(installUserBody.indexOf('setSelectedSkillDetail(installed)')).toBeLessThan(
      installUserBody.indexOf('await refreshDesktopConfig()'),
    )

    expect(installProjectBody).toContain('setSelectedSkillDetail(installed)')
    expect(installProjectBody).toContain("setSelectedSkillDetailScope('project')")
    expect(installProjectBody).toContain('selectedSkillName: installed.name')
    expect(installProjectBody).toContain('selectedSkillPath: installed.path')
    expect(installProjectBody).toContain("selectedSkillScope: 'project'")
    expect(installProjectBody.indexOf('setSelectedSkillDetail(installed)')).toBeGreaterThan(
      installProjectBody.indexOf('if (activeSessionIdRef.current !== session.id) return'),
    )
    expect(installProjectBody.indexOf('setSelectedSkillDetail(installed)')).toBeLessThan(
      installProjectBody.indexOf('await refreshWorkspace(session)'),
    )
  })

  it('shows a Settings error before saving without a skill draft', () => {
    const saveStart = rendererSource.indexOf('async function saveSkillDraft(): Promise<void>')
    const saveEnd = rendererSource.indexOf('async function removeUserSkill', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const missingDraftGuard = 'if (!skillDraft) {'

    expect(saveBody).toContain(missingDraftGuard)
    expect(saveBody).toContain("text: 'Start or select a skill draft before saving.'")
    expect(saveBody.indexOf(missingDraftGuard)).toBeLessThan(
      saveBody.indexOf('await runSkillAction('),
    )
  })

  it('restores selected scheduled task drafts after task lists load', () => {
    const globalStart = rendererSource.indexOf('const selectedGlobalTaskId = activeSession.layout.selectedGlobalTaskId?.trim()')
    const globalEnd = rendererSource.indexOf('useEffect(() => {', globalStart + 1)
    const globalBody = rendererSource.slice(globalStart, globalEnd)
    const projectStart = rendererSource.indexOf('const selectedProjectTaskId = activeSession.layout.selectedProjectTaskId?.trim()')
    const projectEnd = rendererSource.indexOf('useEffect(() => {', projectStart + 1)
    const projectBody = rendererSource.slice(projectStart, projectEnd)

    expect(globalBody).toContain('const selectedGlobalTaskId = activeSession.layout.selectedGlobalTaskId?.trim()')
    expect(globalBody).toContain('if (!selectedGlobalTaskId) return')
    expect(globalBody).not.toContain('taskDraft.id === selectedGlobalTaskId')
    expect(globalBody).toContain('desktopConfig.scheduledTasks.find(task => task.id.trim() === selectedGlobalTaskId)')
    expect(globalBody).toContain('setTaskDraft({ ...taskDraftFromTask(restoredTask), id: selectedGlobalTaskId })')
    expect(projectBody).toContain('const selectedProjectTaskId = activeSession.layout.selectedProjectTaskId?.trim()')
    expect(projectBody).toContain('if (!selectedProjectTaskId) return')
    expect(projectBody).not.toContain('projectTaskDraft.id === selectedProjectTaskId')
    expect(projectBody).toContain('projectTasks.find(task => task.id.trim() === selectedProjectTaskId)')
    expect(projectBody).toContain('setProjectTaskDraft({ ...projectTaskDraftFromTask(restoredTask), id: selectedProjectTaskId })')
  })

  it('clears stale selected scheduled task layout when restore target is missing', () => {
    const globalStart = rendererSource.indexOf('const selectedGlobalTaskId = activeSession.layout.selectedGlobalTaskId?.trim()')
    const globalEnd = rendererSource.indexOf('useEffect(() => {', globalStart + 1)
    const globalBody = rendererSource.slice(globalStart, globalEnd)
    const projectStart = rendererSource.indexOf('const selectedProjectTaskId = activeSession.layout.selectedProjectTaskId?.trim()')
    const projectEnd = rendererSource.indexOf('useEffect(() => {', projectStart + 1)
    const projectBody = rendererSource.slice(projectStart, projectEnd)

    expect(globalBody).toContain('if (restoredTask) {')
    expect(globalBody).toContain('setTaskDraft({ ...taskDraftFromTask(restoredTask), id: selectedGlobalTaskId })')
    expect(globalBody).toContain('} else {')
    expect(globalBody).toContain('setTaskDraft(emptyTaskDraft())')
    expect(globalBody).toContain('void updateSessionLayout(activeSession.id, { selectedGlobalTaskId: undefined })')
    expect(globalBody).not.toContain('void updateLayout({ selectedGlobalTaskId: undefined })')
    expect(globalBody.indexOf('setTaskDraft(emptyTaskDraft())')).toBeLessThan(
      globalBody.indexOf('void updateSessionLayout(activeSession.id, { selectedGlobalTaskId: undefined })'),
    )
    expect(projectBody).toContain('if (restoredTask) {')
    expect(projectBody).toContain('setProjectTaskDraft({ ...projectTaskDraftFromTask(restoredTask), id: selectedProjectTaskId })')
    expect(projectBody).toContain('} else {')
    expect(projectBody).toContain('setProjectTaskDraft(emptyProjectTaskDraft())')
    expect(projectBody).toContain('void updateSessionLayout(activeSession.id, { selectedProjectTaskId: undefined })')
    expect(projectBody).not.toContain('void updateLayout({ selectedProjectTaskId: undefined })')
    expect(projectBody.indexOf('setProjectTaskDraft(emptyProjectTaskDraft())')).toBeLessThan(
      projectBody.indexOf('void updateSessionLayout(activeSession.id, { selectedProjectTaskId: undefined })'),
    )
  })

  it('clears stale selected agent task layout when restore target is missing', () => {
    const start = rendererSource.indexOf('const selectedAgentTaskId = activeSession.layout.selectedAgentTaskId?.trim()')
    const end = rendererSource.indexOf('useEffect(() => {', start + 1)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const selectedAgentTaskId = activeSession.layout.selectedAgentTaskId?.trim()')
    expect(body).toContain('if (!selectedAgentTaskId) return')
    expect(body).toContain('activeSession.agentTasks?.some(task => task.id.trim() === selectedAgentTaskId)')
    expect(body).toContain('if (restoredTaskExists) return')
    expect(body).toContain('void updateSessionLayout(activeSession.id, { selectedAgentTaskId: undefined })')
    expect(body).not.toContain('void updateLayout({ selectedAgentTaskId: undefined })')
    expect(body.indexOf('const restoredTaskExists =')).toBeLessThan(
      body.indexOf('void updateSessionLayout(activeSession.id, { selectedAgentTaskId: undefined })'),
    )
  })

  it('clears incomplete restored Settings MCP and Skill detail identities', () => {
    const start = rendererSource.indexOf('async function restoreSelectedSettingsDetails')
    const end = rendererSource.indexOf('useEffect(() => {', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const hasIncompleteRestoredMcpIdentity = Boolean(')
    expect(body).toContain('(restoredMcpName && !selectedMcpSourcePath) ||')
    expect(body).toContain('(!restoredMcpName && selectedMcpSourcePath)')
    expect(body).toContain('const hasIncompleteRestoredSkillIdentity = Boolean(')
    expect(body).toContain('(restoredSkillName && !selectedSkillPath) ||')
    expect(body).toContain('(!restoredSkillName && selectedSkillPath)')
    expect(body).toContain('if (hasIncompleteRestoredMcpIdentity) {')
    expect(body).toContain('if (hasIncompleteRestoredSkillIdentity) {')
    expect(body).toContain('selectedMcpName: undefined')
    expect(body).toContain('selectedMcpSourcePath: undefined')
    expect(body).toContain('selectedSkillName: undefined')
    expect(body).toContain('selectedSkillPath: undefined')
    expect(body.indexOf('if (hasIncompleteRestoredMcpIdentity) {')).toBeLessThan(
      body.indexOf('if (restoredMcpName && selectedMcpSourcePath) {'),
    )
    expect(body.indexOf('if (hasIncompleteRestoredSkillIdentity) {')).toBeLessThan(
      body.indexOf('if (restoredSkillName && selectedSkillPath) {'),
    )
  })

  it('records restored selected scheduled task identity in electron smoke evidence', () => {
    const smokeSource = readFileSync(join(process.cwd(), 'desktop/scripts/smoke-electron.mjs'), 'utf8')
    const fixtureStart = smokeSource.indexOf('const tasksRestoreSessionId = await page.evaluate')
    const fixtureEnd = smokeSource.indexOf("progress('checking restore')", fixtureStart)
    const fixtureBody = smokeSource.slice(fixtureStart, fixtureEnd)
    const restoreStart = smokeSource.indexOf('const tasksRestoreState = await restoredPage.evaluate')
    const restoreEnd = smokeSource.indexOf('await focusSmokeSessionDirect(restoredPage, result.sessionId)', restoreStart)
    const restoreBody = smokeSource.slice(restoreStart, restoreEnd)

    expect(fixtureBody).toContain('selectedGlobalTaskId: globalTaskId')
    expect(fixtureBody).toContain("selectedProjectTaskId: 'project-restore-task'")
    expect(smokeSource).toContain('const globalRestoreTaskId = await page.evaluate')
    expect(restoreBody).toContain('selectedGlobalTaskId: session?.layout.selectedGlobalTaskId')
    expect(restoreBody).toContain('selectedProjectTaskId: session?.layout.selectedProjectTaskId')
    expect(smokeSource).toContain('#tasks-global-tasks article[aria-selected="true"]')
    expect(smokeSource).toContain('#tasks-project-tasks article[aria-selected="true"]')
    expect(restoreBody).toContain("globalTaskDraftRestored: globalPrompt instanceof HTMLTextAreaElement")
    expect(restoreBody).toContain("projectTaskDraftRestored: projectPrompt instanceof HTMLTextAreaElement")
    expect(smokeSource).toContain('selectedScheduledTaskStateRestored: true')
  })

  it('clears project and local plugin drafts before refreshing a newly focused session', () => {
    const start = rendererSource.indexOf("if (!activeSession) {")
    const end = rendererSource.indexOf("void runAction('Refreshing workspace'", start)
    const body = rendererSource.slice(start, end)
    const activeBranch = body.slice(body.indexOf('activeSessionIdRef.current = activeSession.id'))

    expect(activeBranch).toContain('setPluginDraft(restoredPlugin ? {')
    expect(activeBranch).toContain("prev.scope === 'project' || prev.scope === 'local'")
    expect(activeBranch).toContain('? emptyPluginDraft()')
    expect(activeBranch).toContain(': prev')
  })

  it('clears scoped plugin command output before refreshing a newly focused session', () => {
    const start = rendererSource.indexOf("if (!activeSession) {")
    const end = rendererSource.indexOf("void runAction('Refreshing workspace'", start)
    const body = rendererSource.slice(start, end)
    const activeBranch = body.slice(body.indexOf('activeSessionIdRef.current = activeSession.id'))

    expect(activeBranch).toContain('setPluginOutput(null)')
  })

  it('guards agent delete confirmation against duplicate destructive submissions', () => {
    const start = rendererSource.indexOf('async function deleteSelectedAgent')
    const end = rendererSource.indexOf('async function runAgentLaunchAction', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const session = activeSession')
    expect(body).toContain('const deletedAgentType = agent.agentType')
    expect(body).toContain('const deletedAgentSource = agent.source')
    expect(body).toContain("const actionKey = `${session?.id ?? 'user'}:${deletedAgentSource}:${deletedAgentType.trim()}:delete`")
    expect(body.indexOf('agentEditorActionPendingRef.current.add(actionKey)')).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
    expect(body).toContain("await runAgentEditorAction(actionKey, 'Deleting agent'")
  })

  it('falls back to an available same-type agent after deleting a selected override', () => {
    const start = rendererSource.indexOf('async function deleteSelectedAgent')
    const end = rendererSource.indexOf('async function runAgentEditorAction', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('const fallbackAgent =')
    expect(body).toContain('nextAgents.allAgents.find(agent =>')
    expect(body).toContain('agent.agentType === deletedAgentType')
    expect(body).toContain('agent.source !== deletedAgentSource')
    expect(body).toContain('setSelectedAgentType(fallbackAgent.agentType)')
    expect(body).toContain('setSelectedAgentSource(fallbackAgent.source)')
    expect(body).toContain('selectedAgentType: fallbackAgent.agentType')
    expect(body).toContain('selectedAgentSource: fallbackAgent.source')
  })

  it('moves the composer off a deleted selected agent before reporting success', () => {
    const start = rendererSource.indexOf('async function deleteSelectedAgent')
    const end = rendererSource.indexOf('async function runAgentEditorAction', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('setChatTarget(prev =>')
    expect(body).toContain("prev.type === 'agent' && prev.agentType.trim() === deletedAgentType")
    expect(body).toContain('{ ...prev, agentType: fallbackAgent.agentType }')
    expect(body).toContain(": { type: 'session', teamName: '', agentType: '' }")
    expect(body.indexOf('setChatTarget(prev =>')).toBeGreaterThan(
      body.indexOf('const fallbackAgent ='),
    )
    expect(body.indexOf('setChatTarget(prev =>')).toBeLessThan(
      body.indexOf("setAgentsStatus({ kind: 'success'"),
    )
  })

  it('persists selected agent identity after saving an agent draft', () => {
    const start = rendererSource.indexOf('async function saveAgentDraft')
    const end = rendererSource.indexOf('function startNewAgentDraft', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain('setSelectedAgentType(saved.agentType)')
    expect(body).toContain('setSelectedAgentSource(saved.source)')
    expect(body).toContain('if (session) await updateSessionLayout(session.id, {')
    expect(body).toContain('selectedAgentType: saved.agentType')
    expect(body).toContain('selectedAgentSource: saved.source')
    expect(body.indexOf('setSelectedAgentSource(saved.source)')).toBeLessThan(
      body.indexOf('if (session) await updateSessionLayout(session.id, {'),
    )
    expect(body.indexOf('if (session) await updateSessionLayout(session.id, {')).toBeLessThan(
      body.indexOf('const nextAgents = await window.claudeDesktop.agents.refresh(cwd)'),
    )
  })

  it('guards team delete confirmation against duplicate destructive submissions', () => {
    const start = rendererSource.indexOf('async function deleteTeam')
    const end = rendererSource.indexOf('async function saveScheduledTask', start)
    const body = rendererSource.slice(start, end)

    expect(body).toContain("const actionKey = `${sessionId}:${deletedTeamName}:delete`")
    expect(body.indexOf('teamActionPendingRef.current.add(actionKey)')).toBeLessThan(
      body.indexOf('requestConfirmation({'),
    )
    expect(body).toContain("await runTeamAction(actionKey, 'Deleting team'")
  })

  it('confirms direct team member removal with lifecycle feedback and duplicate guard', () => {
    const removeStart = rendererSource.indexOf('async function removeTeamMember')
    const removeEnd = rendererSource.indexOf('function selectTeam', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)

    expect(removeBody).toContain('const teamName = team.name.trim()')
    expect(removeBody).toContain('const memberName = member.name.trim()')
    expect(removeBody.indexOf('const teamName = team.name.trim()')).toBeLessThan(
      removeBody.indexOf('requestConfirmation({'),
    )
    expect(removeBody.indexOf('const memberName = member.name.trim()')).toBeLessThan(
      removeBody.indexOf('requestConfirmation({'),
    )
    expect(removeBody).toContain("const actionKey = `${sessionId}:${teamName}:${memberName}:remove-member`")
    expect(removeBody.indexOf('teamActionPendingRef.current.add(actionKey)')).toBeLessThan(
      removeBody.indexOf('requestConfirmation({'),
    )
    expect(removeBody).toContain("title: 'Remove teammate?'")
    expect(removeBody).toContain('message: `Remove ${memberName} from local team ${teamName}. This does not stop a running agent; use Shutdown for that.`')
    expect(removeBody).toContain("confirmLabel: 'Remove teammate'")
    expect(removeBody).toContain("await runTeamAction(actionKey, 'Removing teammate'")
    expect(removeBody).toContain('await window.claudeDesktop.teams.removeMember(')
    expect(removeBody).toContain('teamName,')
    expect(removeBody).toContain('memberName,')
    expect(removeBody).toContain('const nextTeams = await window.claudeDesktop.teams.list(cwd)')
    expect(removeBody).toContain('setTeams(nextTeams)')
    expect(removeBody).toContain("setTeamsStatus({ kind: 'success', text: `Removed teammate ${memberName} from team ${teamName}.` })")

    const memberListStart = rendererSource.indexOf('<div className="team-member-list"')
    const memberListEnd = rendererSource.indexOf('</div>', rendererSource.indexOf('<div className="section-actions"', memberListStart))
    const memberListBody = rendererSource.slice(memberListStart, memberListEnd)
    expect(memberListBody).toContain('aria-label={`Remove ${member.name} from ${team.name}`}')
    expect(memberListBody).toContain('onClick={() => handleTeamMemberRemoveClick(team, member)}')
  })

  it('routes Teams IPC handlers through the validated workspace cwd', () => {
    expect(mainSource).toContain("handleIpc('teams:list', async (cwd: string) =>")
    expect(mainSource).toContain('listTeams(await workspaceCwd(cwd))')
    expect(mainSource).toContain("handleIpc('teams:members', async (cwd: string, teamName: string) =>")
    expect(mainSource).toContain('listTeamMembers(teamName, await workspaceCwd(cwd))')
    expect(mainSource).toContain('return createTeam(input, session.cwd)')
    expect(mainSource).toContain('await deleteTeam(input, session.cwd)')
    expect(mainSource).toContain('if (input.teamName) await upsertTeamMember(input, session.cwd)')
    expect(mainSource).toContain("handleIpc('teams:removeMember', async (sessionId: string, input: TeamRemoveMemberInput) =>")
    expect(mainSource).toContain('await removeTeamMember(input, session.cwd)')
  })

  it('routes user agent list, save, delete, and refresh without requiring a validated workspace cwd', () => {
    const listStart = mainSource.indexOf("handleIpc('agents:list'")
    const listEnd = mainSource.indexOf("handleIpc('agents:get'", listStart)
    const listBody = mainSource.slice(listStart, listEnd)
    const saveStart = mainSource.indexOf("handleIpc('agents:save'")
    const saveEnd = mainSource.indexOf("handleIpc('agents:delete'", saveStart)
    const saveBody = mainSource.slice(saveStart, saveEnd)
    const deleteStart = mainSource.indexOf("handleIpc('agents:delete'")
    const deleteEnd = mainSource.indexOf("handleIpc('agents:refresh'", deleteStart)
    const deleteBody = mainSource.slice(deleteStart, deleteEnd)
    const refreshStart = mainSource.indexOf("handleIpc('agents:refresh'")
    const refreshEnd = mainSource.indexOf("handleIpc('agents:diagnose'", refreshStart)
    const refreshBody = mainSource.slice(refreshStart, refreshEnd)

    expect(listBody).toContain("listAgents(cwd ? await workspaceCwd(cwd) : '')")
    expect(saveBody).toContain("input.source === 'project' ? await workspaceCwd(cwd) : ''")
    expect(saveBody).toContain('saveAgent(')
    expect(deleteBody).toContain("source === 'project' ? await workspaceCwd(cwd) : ''")
    expect(deleteBody).toContain('deleteAgent(')
    expect(refreshBody).toContain("listAgents(cwd ? await workspaceCwd(cwd) : '')")
  })

  it('treats team create and delete as local first-class lifecycle actions', () => {
    const createStart = mainSource.indexOf("handleIpc('teams:create'")
    const createEnd = mainSource.indexOf("handleIpc('teams:send'", createStart)
    const createBody = mainSource.slice(createStart, createEnd)
    const deleteStart = mainSource.indexOf("handleIpc('teams:delete'")
    const deleteEnd = mainSource.indexOf('}\n\nfunction installApplicationMenu', deleteStart)
    const deleteBody = mainSource.slice(deleteStart, deleteEnd)

    expect(createBody).toContain('const session = sessionManager.getSession(sessionId)')
    expect(createBody).toContain('return createTeam(input, session.cwd)')
    expect(createBody).not.toContain('sessionManager.send')
    expect(createBody).not.toContain('buildTeamCreatePrompt')

    expect(deleteBody).toContain('const session = sessionManager.getSession(sessionId)')
    expect(deleteBody).toContain('await deleteTeam(input, session.cwd)')
    expect(deleteBody).not.toContain('sessionManager.send')
    expect(deleteBody).not.toContain('buildTeamDeletePrompt')
  })

  it('uses the stored session cwd after queueing a team teammate launch', () => {
    const launchStart = mainSource.indexOf("handleIpc('sessions:launchAgentTask'")
    const launchEnd = mainSource.indexOf("handleIpc('sessions:stopAgentTask'", launchStart)
    const body = mainSource.slice(launchStart, launchEnd)

    expect(body).toContain('const session = sessionManager.getSession(sessionId)')
    expect(body).toContain('await sessionManager.send(sessionId, buildAgentLaunchPrompt(input))')
    expect(body.indexOf('const session = sessionManager.getSession(sessionId)')).toBeLessThan(
      body.indexOf('await sessionManager.send(sessionId, buildAgentLaunchPrompt(input))'),
    )
    expect(body).toContain('if (input.teamName) await upsertTeamMember(input, session.cwd)')
  })

  it('does not block local team create and delete on a busy runtime turn', () => {
    const createStart = rendererSource.indexOf('async function createTeam')
    const createEnd = rendererSource.indexOf('async function sendTeamMessage', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('async function saveScheduledTask', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)

    expect(createBody).toContain('await window.claudeDesktop.teams.create(')
    expect(createBody).not.toContain('turnBusy')
    expect(deleteBody).toContain('await window.claudeDesktop.teams.delete(')
    expect(deleteBody).not.toContain('turnBusy')
  })

  it('uses the stored session cwd for team create and delete lifecycle', () => {
    const createStart = mainSource.indexOf("handleIpc('teams:create'")
    const createEnd = mainSource.indexOf("handleIpc('teams:send'", createStart)
    const createBody = mainSource.slice(createStart, createEnd)
    const deleteStart = mainSource.indexOf("handleIpc('teams:delete'")
    const deleteEnd = mainSource.indexOf('}\n\nfunction installApplicationMenu', deleteStart)
    const deleteBody = mainSource.slice(deleteStart, deleteEnd)

    expect(createBody).toContain('const session = sessionManager.getSession(sessionId)')
    expect(createBody).toContain('return createTeam(input, session.cwd)')

    expect(deleteBody).toContain('const session = sessionManager.getSession(sessionId)')
    expect(deleteBody).toContain('await deleteTeam(input, session.cwd)')
  })

  it('guards agent lifecycle async results against stale session writes', () => {
    const refreshStart = rendererSource.indexOf('async function refreshAgents')
    const refreshEnd = rendererSource.indexOf('async function selectAgent', refreshStart)
    const refreshBody = rendererSource.slice(refreshStart, refreshEnd)
    const diagnoseStart = rendererSource.indexOf('async function diagnoseAgentByType')
    const diagnoseEnd = rendererSource.indexOf('async function saveAgentDraft', diagnoseStart)
    const diagnoseBody = rendererSource.slice(diagnoseStart, diagnoseEnd)
    const saveStart = rendererSource.indexOf('async function saveAgentDraft')
    const saveEnd = rendererSource.indexOf('function startNewAgentDraft', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const deleteStart = rendererSource.indexOf('async function deleteSelectedAgent')
    const deleteEnd = rendererSource.indexOf('async function runAgentEditorAction', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)

    expect(refreshBody).toContain('const session = activeSession')
    expect(refreshBody).toContain("const cwd = session?.cwd ?? ''")
    expect(refreshBody).toContain('window.claudeDesktop.agents.refresh(cwd)')
    expect(refreshBody).toContain('window.claudeDesktop.teams.list(session.cwd)')
    expect(refreshBody).toContain('if (session && activeSessionIdRef.current !== session.id) return')
    expect(refreshBody.indexOf('if (session && activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      refreshBody.indexOf('setAgentList(nextAgents)'),
    )
    expect(refreshBody).toContain("const statusTarget = activePane === 'teams' ? 'teams' : 'agents'")
    expect(refreshBody).not.toContain("if (activePane === 'teams')")
    expect(refreshBody).toContain("if (statusTarget === 'teams')")

    expect(diagnoseBody).toContain('const session = activeSession')
    expect(diagnoseBody).toContain("const actionKey = `${session.id}:${agentType}:diagnose`")
    expect(diagnoseBody).toContain('session.cwd,')
    expect(diagnoseBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      diagnoseBody.indexOf('setAgentDiagnostics(diagnostics)'),
    )

    for (const body of [saveBody, deleteBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain("const cwd = session?.cwd ?? ''")
      expect(body).toContain('cwd,')
      expect(body).toContain('if (session && activeSessionIdRef.current !== session.id) return')
    }
    expect(saveBody.indexOf('if (session && activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      saveBody.indexOf('setSelectedAgentType(saved.agentType)'),
    )
    expect(deleteBody.indexOf('if (session && activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      deleteBody.indexOf('setAgentDraft(emptyAgentDraft())'),
    )
  })

  it('guards agent runtime async results against stale session writes', () => {
    const createStart = rendererSource.indexOf('async function createAgentSession')
    const createEnd = rendererSource.indexOf('async function createSelectedAgentSession', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)
    const createSelectedStart = rendererSource.indexOf('async function createSelectedAgentSession')
    const createSelectedEnd = rendererSource.indexOf('async function launchAgentTask', createSelectedStart)
    const createSelectedBody = rendererSource.slice(createSelectedStart, createSelectedEnd)
    const launchStart = rendererSource.indexOf('async function launchAgentTask')
    const launchEnd = rendererSource.indexOf('async function runAgentTaskAction', launchStart)
    const launchBody = rendererSource.slice(launchStart, launchEnd)
    const readStart = rendererSource.indexOf('async function readAgentTaskOutput')
    const readEnd = rendererSource.indexOf('async function previewAgentTaskOutput', readStart)
    const readBody = rendererSource.slice(readStart, readEnd)
    const previewStart = rendererSource.indexOf('async function previewAgentTaskOutput')
    const previewEnd = rendererSource.indexOf('async function stopAgentTask', previewStart)
    const previewBody = rendererSource.slice(previewStart, previewEnd)
    const stopStart = rendererSource.indexOf('async function stopAgentTask')
    const stopEnd = rendererSource.indexOf('async function resumeAgentTask', stopStart)
    const stopBody = rendererSource.slice(stopStart, stopEnd)
    const resumeStart = rendererSource.indexOf('async function resumeAgentTask')
    const resumeEnd = rendererSource.indexOf('async function runTeamAction', resumeStart)
    const resumeBody = rendererSource.slice(resumeStart, resumeEnd)

    for (const body of [createBody, createSelectedBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('const sessionId = session.id')
      expect(body).toContain('const cwd = session.cwd')
      expect(body).toContain('if (activeSessionIdRef.current !== session.id) return')
      expect(body.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeGreaterThan(
        body.indexOf('await window.claudeDesktop.sessions.create({'),
      )
      expect(body.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
        body.indexOf('mergeSession(createdSession)'),
      )
    }

    for (const body of [launchBody, readBody, previewBody, stopBody, resumeBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('const sessionId = session.id')
      expect(body).toContain('if (activeSessionIdRef.current !== session.id) return')
    }

    expect(launchBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeGreaterThan(
      launchBody.indexOf('await window.claudeDesktop.sessions.launchAgentTask('),
    )
    expect(launchBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      launchBody.indexOf('setAgentsStatus({ kind: \'success\', text: `Launched agent task'),
    )
    expect(readBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      readBody.indexOf('setAgentsStatus({ kind: \'success\', text: `Requested output'),
    )
    expect(previewBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      previewBody.indexOf('setSessions(prev => prev.map(session => {'),
    )
    expect(stopBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      stopBody.indexOf('setAgentsStatus({ kind: \'success\', text: `Stopped agent task'),
    )
    expect(resumeBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      resumeBody.indexOf("setAgentTaskPrompt('')"),
    )
  })

  it('binds agent editor and task layout writes to the origin session', () => {
    const saveStart = rendererSource.indexOf('async function saveAgentDraft')
    const saveEnd = rendererSource.indexOf('function startNewAgentDraft', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const deleteStart = rendererSource.indexOf('async function deleteSelectedAgent')
    const deleteEnd = rendererSource.indexOf('async function runAgentEditorAction', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const readStart = rendererSource.indexOf('async function readAgentTaskOutput')
    const readEnd = rendererSource.indexOf('async function previewAgentTaskOutput', readStart)
    const readBody = rendererSource.slice(readStart, readEnd)
    const previewStart = rendererSource.indexOf('async function previewAgentTaskOutput')
    const previewEnd = rendererSource.indexOf('async function stopAgentTask', previewStart)
    const previewBody = rendererSource.slice(previewStart, previewEnd)
    const stopStart = rendererSource.indexOf('async function stopAgentTask')
    const stopEnd = rendererSource.indexOf('async function resumeAgentTask', stopStart)
    const stopBody = rendererSource.slice(stopStart, stopEnd)
    const resumeStart = rendererSource.indexOf('async function resumeAgentTask')
    const resumeEnd = rendererSource.indexOf('async function runTeamAction', resumeStart)
    const resumeBody = rendererSource.slice(resumeStart, resumeEnd)

    for (const body of [saveBody, deleteBody, readBody, previewBody, stopBody, resumeBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('await updateSessionLayout(session.id,')
    }
    expect(saveBody).not.toContain('await updateLayout({\n        selectedAgentType:')
    expect(deleteBody).not.toContain('await updateLayout({\n            selectedAgentType:')
    for (const body of [readBody, previewBody, stopBody, resumeBody]) {
      expect(body).not.toContain('await updateLayout({ selectedAgentTaskId })')
    }
  })

  it('blocks agent selection and runtime entrypoints while loading', () => {
    const selectStart = rendererSource.indexOf('async function selectAgent(agent: AgentInfo): Promise<void>')
    const selectEnd = rendererSource.indexOf('async function diagnoseSelectedAgent', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const diagnoseStart = rendererSource.indexOf('async function diagnoseSelectedAgent')
    const diagnoseEnd = rendererSource.indexOf('function prepareSelectedAgentRun', diagnoseStart)
    const diagnoseBody = rendererSource.slice(diagnoseStart, diagnoseEnd)
    const prepareRunStart = rendererSource.indexOf('function prepareSelectedAgentRun(): void')
    const prepareRunEnd = rendererSource.indexOf('function prepareSelectedAgentEdit', prepareRunStart)
    const prepareRunBody = rendererSource.slice(prepareRunStart, prepareRunEnd)
    const prepareEditStart = rendererSource.indexOf('function prepareSelectedAgentEdit(): void')
    const prepareEditEnd = rendererSource.indexOf('async function diagnoseAgentByType', prepareEditStart)
    const prepareEditBody = rendererSource.slice(prepareEditStart, prepareEditEnd)
    const createStart = rendererSource.indexOf('async function createAgentSession')
    const createEnd = rendererSource.indexOf('async function createSelectedAgentSession', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)
    const createSelectedStart = rendererSource.indexOf('async function createSelectedAgentSession')
    const createSelectedEnd = rendererSource.indexOf('async function launchAgentTask', createSelectedStart)
    const createSelectedBody = rendererSource.slice(createSelectedStart, createSelectedEnd)
    const launchStart = rendererSource.indexOf('async function launchAgentTask')
    const launchEnd = rendererSource.indexOf('async function runAgentTaskAction', launchStart)
    const launchBody = rendererSource.slice(launchStart, launchEnd)
    const readStart = rendererSource.indexOf('async function readAgentTaskOutput')
    const readEnd = rendererSource.indexOf('async function previewAgentTaskOutput', readStart)
    const readBody = rendererSource.slice(readStart, readEnd)
    const previewStart = rendererSource.indexOf('async function previewAgentTaskOutput')
    const previewEnd = rendererSource.indexOf('async function stopAgentTask', previewStart)
    const previewBody = rendererSource.slice(previewStart, previewEnd)
    const stopStart = rendererSource.indexOf('async function stopAgentTask')
    const stopEnd = rendererSource.indexOf('async function resumeAgentTask', stopStart)
    const stopBody = rendererSource.slice(stopStart, stopEnd)
    const resumeStart = rendererSource.indexOf('async function resumeAgentTask')
    const resumeEnd = rendererSource.indexOf('async function runTeamAction', resumeStart)
    const resumeBody = rendererSource.slice(resumeStart, resumeEnd)

    for (const body of [
      selectBody,
      diagnoseBody,
      prepareRunBody,
      prepareEditBody,
      createBody,
      createSelectedBody,
      launchBody,
      readBody,
      previewBody,
      stopBody,
      resumeBody,
    ]) {
      expect(body).toContain('if (loadingLabel) return')
    }
  })

  it('shows an Agents error before selected agent shortcuts run with a missing agent type', () => {
    const selectStart = rendererSource.indexOf('async function selectAgent(agent: AgentInfo): Promise<void>')
    const selectEnd = rendererSource.indexOf('async function diagnoseSelectedAgent', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const diagnoseByTypeStart = rendererSource.indexOf('async function diagnoseAgentByType(agentType: string): Promise<void>')
    const diagnoseByTypeEnd = rendererSource.indexOf('async function saveAgentDraft', diagnoseByTypeStart)
    const diagnoseByTypeBody = rendererSource.slice(diagnoseByTypeStart, diagnoseByTypeEnd)
    const prepareRunStart = rendererSource.indexOf('function prepareSelectedAgentRun(): void')
    const prepareRunEnd = rendererSource.indexOf('function prepareSelectedAgentEdit', prepareRunStart)
    const prepareRunBody = rendererSource.slice(prepareRunStart, prepareRunEnd)
    const prepareEditStart = rendererSource.indexOf('function prepareSelectedAgentEdit(): void')
    const prepareEditEnd = rendererSource.indexOf('async function diagnoseAgentByType', prepareEditStart)
    const prepareEditBody = rendererSource.slice(prepareEditStart, prepareEditEnd)
    const createSelectedStart = rendererSource.indexOf('async function createSelectedAgentSession')
    const createSelectedEnd = rendererSource.indexOf('async function launchAgentTask', createSelectedStart)
    const createSelectedBody = rendererSource.slice(createSelectedStart, createSelectedEnd)
    const normalizedAgentType = 'const agentType = agent.agentType.trim()'
    const agentGuard = 'if (!agentType) {'
    const selectedGuard = 'if (!selectedAgent.agentType.trim()) {'
    const typeGuard = 'if (!agentType.trim()) {'

    expect(selectBody).toContain(normalizedAgentType)
    expect(selectBody).toContain(agentGuard)
    expect(selectBody).toContain("text: 'Select an agent before selecting.'")
    expect(selectBody.indexOf(normalizedAgentType)).toBeLessThan(
      selectBody.indexOf(agentGuard),
    )
    expect(selectBody.indexOf(agentGuard)).toBeLessThan(
      selectBody.indexOf('setSelectedAgentType(agentType)'),
    )
    expect(selectBody.indexOf(agentGuard)).toBeLessThan(
      selectBody.indexOf('if (session) await updateSessionLayout(session.id, {'),
    )

    expect(diagnoseByTypeBody).toContain(typeGuard)
    expect(diagnoseByTypeBody).toContain("text: 'Select an agent before diagnosing.'")
    expect(diagnoseByTypeBody.indexOf(typeGuard)).toBeLessThan(
      diagnoseByTypeBody.indexOf('const actionKey = `${session.id}:${agentType}:diagnose`'),
    )

    for (const [body, statusText, firstMutation] of [
      [
        prepareRunBody,
        "text: 'Select an agent before preparing a run.'",
        'setAgentLaunchDraft(prev => ({',
      ],
      [
        prepareEditBody,
        "text: 'Select an agent before editing.'",
        'setAgentDraft(agentDraftFromAgent(',
      ],
      [
        createSelectedBody,
        "text: 'Select an agent before creating an agent session.'",
        'await runAgentLaunchAction(',
      ],
    ] as const) {
      expect(body).toContain(selectedGuard)
      expect(body).toContain(statusText)
      expect(body.indexOf(selectedGuard)).toBeLessThan(body.indexOf(firstMutation))
    }
  })

  it('normalizes selected agent identity before writing layout and launch drafts', () => {
    const selectStart = rendererSource.indexOf('async function selectAgent(agent: AgentInfo): Promise<void>')
    const selectEnd = rendererSource.indexOf('async function diagnoseSelectedAgent', selectStart)
    const selectBody = rendererSource.slice(selectStart, selectEnd)
    const normalizedAgentType = 'const agentType = agent.agentType.trim()'

    expect(selectBody).toContain(normalizedAgentType)
    expect(selectBody).toContain('const session = activeSession')
    expect(selectBody).toContain('setSelectedAgentType(agentType)')
    expect(selectBody).toContain('if (session) await updateSessionLayout(session.id, {')
    expect(selectBody).toContain('selectedAgentType: agentType')
    expect(selectBody).toContain('agentType,')
    expect(selectBody).toContain('agentDraftFromAgent({ ...agent, agentType }, canUseRemoteIsolation)')
    expect(selectBody).toContain('text: `Selected agent ${agentType}.`')
    expect(selectBody.indexOf(normalizedAgentType)).toBeLessThan(
      selectBody.indexOf('setSelectedAgentType(agentType)'),
    )
    expect(selectBody.indexOf(normalizedAgentType)).toBeLessThan(
      selectBody.indexOf('selectedAgentType: agentType'),
    )
    expect(selectBody.indexOf(normalizedAgentType)).toBeLessThan(
      selectBody.indexOf('agentDraftFromAgent({ ...agent, agentType }, canUseRemoteIsolation)'),
    )
  })

  it('blocks selected agent action buttons while loading', () => {
    const selectedStart = rendererSource.indexOf('{selectedAgent && (')
    const selectedEnd = rendererSource.indexOf('<section className="settings-section" id="agents-launch">', selectedStart)
    const selectedBody = rendererSource.slice(selectedStart, selectedEnd)

    expect(selectedBody).toContain('<button className="tool-button" onClick={handleSelectedAgentDiagnoseClick} disabled={!activeSession || !!loadingLabel}>')
    expect(selectedBody).toContain('<button className="tool-button" onClick={handleSelectedAgentNewSessionClick} disabled={!activeSession || !!loadingLabel}>')
    expect(selectedBody).toContain('<button className="tool-button" onClick={handleSelectedAgentPrepareRunClick} disabled={!activeSession || !!loadingLabel}>')
    expect(selectedBody).toContain('<button className="tool-button" onClick={handleSelectedAgentPrepareEditClick} disabled={!canEditSelectedAgent || !!loadingLabel}>')
    expect(selectedBody).toContain('<button className="tool-button danger" onClick={handleSelectedAgentDeleteClick} disabled={!canDeleteSelectedAgent || !!loadingLabel}>')
  })

  it('routes stale selected agent runtime action buttons through handlers', () => {
    const selectedStart = rendererSource.indexOf('{selectedAgent && (')
    const selectedEnd = rendererSource.indexOf('<section className="settings-section" id="agents-launch">', selectedStart)
    const selectedBody = rendererSource.slice(selectedStart, selectedEnd)

    expect(rendererSource).toContain('function handleSelectedAgentDiagnoseClick(): void')
    expect(rendererSource).toContain('function handleSelectedAgentNewSessionClick(): void')
    expect(rendererSource).toContain('function handleSelectedAgentPrepareRunClick(): void')
    expect(selectedBody).toContain('<button className="tool-button" onClick={handleSelectedAgentDiagnoseClick} disabled={!activeSession || !!loadingLabel}>')
    expect(selectedBody).toContain('<button className="tool-button" onClick={handleSelectedAgentNewSessionClick} disabled={!activeSession || !!loadingLabel}>')
    expect(selectedBody).toContain('<button className="tool-button" onClick={handleSelectedAgentPrepareRunClick} disabled={!activeSession || !!loadingLabel}>')
    expect(selectedBody).not.toContain('onClick={() => !loadingLabel && void diagnoseSelectedAgent()}')
    expect(selectedBody).not.toContain('onClick={() => !loadingLabel && void createSelectedAgentSession()}')
    expect(selectedBody).not.toContain('onClick={() => !loadingLabel && prepareSelectedAgentRun()}')
    expect(selectedBody).not.toContain('activeSession && !loadingLabel && void diagnoseSelectedAgent()')
    expect(selectedBody).not.toContain('activeSession && !loadingLabel && void createSelectedAgentSession()')
    expect(selectedBody).not.toContain('activeSession && !loadingLabel && prepareSelectedAgentRun()')
    expect(selectedBody).not.toContain('if (!loadingLabel) prepareSelectedAgentRun()')
  })

  it('routes stale selected agent Edit clicks through the edit handler', () => {
    const prepareEditStart = rendererSource.indexOf('function prepareSelectedAgentEdit(): void')
    const prepareEditEnd = rendererSource.indexOf('async function diagnoseAgentByType', prepareEditStart)
    const prepareEditBody = rendererSource.slice(prepareEditStart, prepareEditEnd)
    const selectedStart = rendererSource.indexOf('{selectedAgent && (')
    const selectedEnd = rendererSource.indexOf('<section className="settings-section" id="agents-launch">', selectedStart)
    const selectedBody = rendererSource.slice(selectedStart, selectedEnd)

    expect(prepareEditBody).toContain('if (!canEditSelectedAgent) {')
    expect(prepareEditBody).toContain("text: 'Select a project session before editing this agent.'")
    expect(rendererSource).toContain('function handleSelectedAgentPrepareEditClick(): void')
    expect(selectedBody).toContain('<button className="tool-button" onClick={handleSelectedAgentPrepareEditClick} disabled={!canEditSelectedAgent || !!loadingLabel}>')
    expect(selectedBody).not.toContain('onClick={() => !loadingLabel && prepareSelectedAgentEdit()}')
    expect(selectedBody).not.toContain('canEditSelectedAgent && !loadingLabel && prepareSelectedAgentEdit()')
    expect(selectedBody).not.toContain('if (!loadingLabel) prepareSelectedAgentEdit()')
  })

  it('routes stale selected agent Delete clicks through the delete handler', () => {
    const deleteStart = rendererSource.indexOf('async function deleteSelectedAgent')
    const deleteEnd = rendererSource.indexOf('async function runAgentEditorAction', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const selectedStart = rendererSource.indexOf('{selectedAgent && (')
    const selectedEnd = rendererSource.indexOf('<section className="settings-section" id="agents-launch">', selectedStart)
    const selectedBody = rendererSource.slice(selectedStart, selectedEnd)

    expect(deleteBody).toContain("if (!activeSession && agent.source === 'project') {")
    expect(deleteBody).toContain("text: 'Select a session before managing project agents.'")
    expect(deleteBody).toContain("text: 'Select an agent before deleting.'")
    expect(rendererSource).toContain('function handleSelectedAgentDeleteClick(): void')
    expect(selectedBody).toContain('<button className="tool-button danger" onClick={handleSelectedAgentDeleteClick} disabled={!canDeleteSelectedAgent || !!loadingLabel}>')
    expect(selectedBody).not.toContain('onClick={() => !loadingLabel && void deleteSelectedAgent(selectedAgent)}')
    expect(selectedBody).not.toContain('canDeleteSelectedAgent && !loadingLabel && void deleteSelectedAgent(selectedAgent)')
  })

  it('allows selected user custom agents to delete from the detail card without an active project session', () => {
    const canEditStart = rendererSource.indexOf('const canEditSelectedAgent = Boolean(')
    const canDeleteStart = rendererSource.indexOf('const canDeleteSelectedAgent = Boolean(', canEditStart)
    const canDeleteDraftStart = rendererSource.indexOf('const canDeleteAgentDraft = Boolean(', canDeleteStart)
    const canDeleteBody = rendererSource.slice(canDeleteStart, canDeleteDraftStart)
    const deleteStart = rendererSource.indexOf('async function deleteSelectedAgent')
    const deleteEnd = rendererSource.indexOf('async function runAgentEditorAction', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const selectedStart = rendererSource.indexOf('{selectedAgent && (')
    const selectedEnd = rendererSource.indexOf('<section className="settings-section" id="agents-launch">', selectedStart)
    const selectedBody = rendererSource.slice(selectedStart, selectedEnd)

    expect(canDeleteBody).toContain("selectedAgent.source === 'user' || activeSession")
    expect(canDeleteBody).toContain('selectedAgent.editable')
    expect(deleteBody).toContain("async function deleteSelectedAgent(agent: Pick<AgentInfo, 'agentType' | 'source'> = agentDraft): Promise<void>")
    expect(deleteBody).toContain("if (!activeSession && agent.source === 'project') {")
    expect(deleteBody).toContain("const deletedAgentType = agent.agentType")
    expect(deleteBody).toContain('const deletedAgentSource = agent.source')
    expect(selectedBody).toContain('<button className="tool-button danger" onClick={handleSelectedAgentDeleteClick} disabled={!canDeleteSelectedAgent || !!loadingLabel}>')
  })

  it('does not block selected user agent deletion because of a stale project draft', () => {
    const deleteStart = rendererSource.indexOf('async function deleteSelectedAgent')
    const deleteEnd = rendererSource.indexOf('async function runAgentEditorAction', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)
    const selectedSourceGuard = "if (!activeSession && agent.source === 'project') {"

    expect(deleteBody).toContain(selectedSourceGuard)
    expect(deleteBody).not.toContain("if (!activeSession && agentDraft.source === 'project') {")
    expect(deleteBody.indexOf(selectedSourceGuard)).toBeLessThan(
      deleteBody.indexOf("const deletedAgentSource = agent.source"),
    )
  })

  it('shows visible session guidance on disabled selected agent runtime actions', () => {
    const selectedStart = rendererSource.indexOf('{selectedAgent && (')
    const selectedEnd = rendererSource.indexOf('<section className="settings-section" id="agents-launch">', selectedStart)
    const selectedBody = rendererSource.slice(selectedStart, selectedEnd)

    expect(selectedBody).toContain('{!activeSession && (')
    expect(selectedBody).toContain('<div className="form-note">')
    expect(selectedBody).toContain('Select a project session to diagnose, start sessions, or prepare agent tasks.')
  })

  it('blocks selected agent run preparation without an active session', () => {
    const prepareRunStart = rendererSource.indexOf('function prepareSelectedAgentRun(): void')
    const prepareRunEnd = rendererSource.indexOf('function prepareSelectedAgentEdit', prepareRunStart)
    const prepareRunBody = rendererSource.slice(prepareRunStart, prepareRunEnd)

    expect(prepareRunBody).toContain('if (!activeSession) {')
    expect(prepareRunBody).toContain("text: 'Select a session before running agents.'")
    const missingSelectedAgentGuard = 'if (!selectedAgent) {'
    expect(prepareRunBody).toContain(missingSelectedAgentGuard)
    expect(prepareRunBody).toContain("text: 'Select an agent before preparing a run.'")
    expect(prepareRunBody.indexOf('if (!activeSession) {')).toBeLessThan(
      prepareRunBody.indexOf('setAgentLaunchDraft(prev => ({'),
    )
    expect(prepareRunBody.indexOf('if (!activeSession) {')).toBeLessThan(
      prepareRunBody.indexOf("void openPaneSection('agents', 'agents-launch', 'agents', { showStatus: false })"),
    )
    expect(prepareRunBody.indexOf(missingSelectedAgentGuard)).toBeLessThan(
      prepareRunBody.indexOf('setAgentLaunchDraft(prev => ({'),
    )
    expect(prepareRunBody.indexOf(missingSelectedAgentGuard)).toBeLessThan(
      prepareRunBody.indexOf("void openPaneSection('agents', 'agents-launch', 'agents', { showStatus: false })"),
    )
  })

  it('shows an Agents error before preparing selected agent editing without a selected agent', () => {
    const prepareEditStart = rendererSource.indexOf('function prepareSelectedAgentEdit(): void')
    const prepareEditEnd = rendererSource.indexOf('async function diagnoseAgentByType', prepareEditStart)
    const prepareEditBody = rendererSource.slice(prepareEditStart, prepareEditEnd)
    const missingSelectedAgentGuard = 'if (!selectedAgent) {'

    expect(prepareEditBody).toContain(missingSelectedAgentGuard)
    expect(prepareEditBody).toContain("text: 'Select an agent before editing.'")
    expect(prepareEditBody.indexOf(missingSelectedAgentGuard)).toBeLessThan(
      prepareEditBody.indexOf('setAgentDraft(agentDraftFromAgent('),
    )
    expect(prepareEditBody.indexOf(missingSelectedAgentGuard)).toBeLessThan(
      prepareEditBody.indexOf("void openPaneSection('agents', 'agents-editor', 'agents', { showStatus: false })"),
    )
  })

  it('shows an Agents error when agent diagnostics lose the active session', () => {
    const diagnoseSelectedStart = rendererSource.indexOf('async function diagnoseSelectedAgent')
    const diagnoseSelectedEnd = rendererSource.indexOf('function prepareSelectedAgentRun', diagnoseSelectedStart)
    const diagnoseSelectedBody = rendererSource.slice(diagnoseSelectedStart, diagnoseSelectedEnd)
    const diagnoseByTypeStart = rendererSource.indexOf('async function diagnoseAgentByType(agentType: string): Promise<void>')
    const diagnoseByTypeEnd = rendererSource.indexOf('async function saveAgentDraft', diagnoseByTypeStart)
    const diagnoseByTypeBody = rendererSource.slice(diagnoseByTypeStart, diagnoseByTypeEnd)

    expect(diagnoseSelectedBody).toContain('if (!activeSession) {')
    expect(diagnoseSelectedBody).toContain("text: 'Select a session before diagnosing agents.'")
    const missingAgentTypeGuard = 'if (!selectedAgentType) {'
    expect(diagnoseSelectedBody).toContain(missingAgentTypeGuard)
    expect(diagnoseSelectedBody).toContain("text: 'Select an agent before diagnosing.'")
    expect(diagnoseSelectedBody.indexOf('if (!activeSession) {')).toBeLessThan(
      diagnoseSelectedBody.indexOf('await diagnoseAgentByType(selectedAgentType)'),
    )
    expect(diagnoseSelectedBody.indexOf(missingAgentTypeGuard)).toBeLessThan(
      diagnoseSelectedBody.indexOf('await diagnoseAgentByType(selectedAgentType)'),
    )
    expect(diagnoseByTypeBody).toContain('if (!activeSession) {')
    expect(diagnoseByTypeBody).toContain("text: 'Select a session before diagnosing agents.'")
    expect(diagnoseByTypeBody.indexOf('if (!activeSession) {')).toBeLessThan(
      diagnoseByTypeBody.indexOf('const actionKey = `${session.id}:${agentType}:diagnose`'),
    )
  })

  it('shows an Agents error when agent session creation loses the active session', () => {
    const createStart = rendererSource.indexOf('async function createAgentSession')
    const createEnd = rendererSource.indexOf('async function createSelectedAgentSession', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)
    const createSelectedStart = rendererSource.indexOf('async function createSelectedAgentSession')
    const createSelectedEnd = rendererSource.indexOf('async function launchAgentTask', createSelectedStart)
    const createSelectedBody = rendererSource.slice(createSelectedStart, createSelectedEnd)

    for (const body of [createBody, createSelectedBody]) {
      expect(body).toContain('if (!activeSession) {')
      expect(body).toContain("text: 'Select a session before creating agent sessions.'")
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('const session = activeSession'),
      )
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('await runAgentLaunchAction('),
      )
    }
    const missingAgentTypeGuard = 'if (!agentLaunchDraft.agentType.trim()) {'
    expect(createBody).toContain(missingAgentTypeGuard)
    expect(createBody).toContain("text: 'Choose an agent type before creating an agent session.'")
    expect(createBody.indexOf(missingAgentTypeGuard)).toBeLessThan(
      createBody.indexOf('const session = activeSession'),
    )
    expect(createBody.indexOf(missingAgentTypeGuard)).toBeLessThan(
      createBody.indexOf('await runAgentLaunchAction('),
    )
    const missingSelectedAgentGuard = 'if (!selectedAgent) {'
    expect(createSelectedBody).toContain(missingSelectedAgentGuard)
    expect(createSelectedBody).toContain("text: 'Select an agent before creating an agent session.'")
    expect(createSelectedBody.indexOf(missingSelectedAgentGuard)).toBeLessThan(
      createSelectedBody.indexOf('const session = activeSession'),
    )
    expect(createSelectedBody.indexOf(missingSelectedAgentGuard)).toBeLessThan(
      createSelectedBody.indexOf('await runAgentLaunchAction('),
    )
  })

  it('shows an Agents error when agent task launch loses the active session', () => {
    const launchStart = rendererSource.indexOf('async function launchAgentTask')
    const launchEnd = rendererSource.indexOf('async function runAgentTaskAction', launchStart)
    const launchBody = rendererSource.slice(launchStart, launchEnd)

    expect(launchBody).toContain('if (!activeSession) {')
    expect(launchBody).toContain("text: 'Select a session before launching agent tasks.'")
    expect(launchBody.indexOf('if (!activeSession) {')).toBeLessThan(
      launchBody.indexOf('if (turnBusy)'),
    )
    expect(launchBody.indexOf('if (!activeSession) {')).toBeLessThan(
      launchBody.indexOf('await runAgentLaunchAction('),
    )
  })

  it('shows an Agents error when agent task actions lose the active session', () => {
    const readStart = rendererSource.indexOf('async function readAgentTaskOutput')
    const readEnd = rendererSource.indexOf('async function previewAgentTaskOutput', readStart)
    const readBody = rendererSource.slice(readStart, readEnd)
    const previewStart = rendererSource.indexOf('async function previewAgentTaskOutput')
    const previewEnd = rendererSource.indexOf('async function stopAgentTask', previewStart)
    const previewBody = rendererSource.slice(previewStart, previewEnd)
    const stopStart = rendererSource.indexOf('async function stopAgentTask')
    const stopEnd = rendererSource.indexOf('async function resumeAgentTask', stopStart)
    const stopBody = rendererSource.slice(stopStart, stopEnd)
    const resumeStart = rendererSource.indexOf('async function resumeAgentTask')
    const resumeEnd = rendererSource.indexOf('async function runTeamAction', resumeStart)
    const resumeBody = rendererSource.slice(resumeStart, resumeEnd)

    for (const body of [readBody, previewBody, stopBody, resumeBody]) {
      expect(body).toContain('if (!activeSession) {')
      expect(body).toContain("text: 'Select a session before managing agent tasks.'")
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('const session = activeSession'),
      )
      expect(body.indexOf('if (!activeSession) {')).toBeLessThan(
        body.indexOf('await runAgentTaskAction('),
      )
    }
    const missingPromptGuard = 'if (!agentTaskPrompt.trim()) {'
    expect(resumeBody).toContain(missingPromptGuard)
    expect(resumeBody).toContain("text: 'Enter a follow-up prompt before resuming an agent task.'")
    expect(resumeBody.indexOf(missingPromptGuard)).toBeLessThan(
      resumeBody.indexOf('if (turnBusy)'),
    )
    expect(resumeBody.indexOf(missingPromptGuard)).toBeLessThan(
      resumeBody.indexOf('await runAgentTaskAction('),
    )
  })

  it('shows an Agents error before running agent task actions with a missing task id', () => {
    const readStart = rendererSource.indexOf('async function readAgentTaskOutput')
    const readEnd = rendererSource.indexOf('async function previewAgentTaskOutput', readStart)
    const readBody = rendererSource.slice(readStart, readEnd)
    const previewStart = rendererSource.indexOf('async function previewAgentTaskOutput')
    const previewEnd = rendererSource.indexOf('async function stopAgentTask', previewStart)
    const previewBody = rendererSource.slice(previewStart, previewEnd)
    const stopStart = rendererSource.indexOf('async function stopAgentTask')
    const stopEnd = rendererSource.indexOf('async function resumeAgentTask', stopStart)
    const stopBody = rendererSource.slice(stopStart, stopEnd)
    const resumeStart = rendererSource.indexOf('async function resumeAgentTask')
    const resumeEnd = rendererSource.indexOf('async function runTeamAction', resumeStart)
    const resumeBody = rendererSource.slice(resumeStart, resumeEnd)
    const normalizedTaskId = 'const selectedAgentTaskId = taskId.trim()'
    const guard = 'if (!selectedAgentTaskId) {'

    for (const body of [readBody, previewBody, stopBody, resumeBody]) {
      expect(body).toContain(normalizedTaskId)
      expect(body.indexOf(normalizedTaskId)).toBeLessThan(
        body.indexOf(guard),
      )
    }
    expect(readBody).toContain(guard)
    expect(readBody).toContain("text: 'Select an agent task before reading output.'")
    expect(readBody.indexOf(guard)).toBeLessThan(
      readBody.indexOf('if (turnBusy)'),
    )
    expect(readBody.indexOf(guard)).toBeLessThan(
      readBody.indexOf('await runAgentTaskAction('),
    )

    expect(previewBody).toContain(guard)
    expect(previewBody).toContain("text: 'Select an agent task before previewing output.'")
    expect(previewBody.indexOf(guard)).toBeLessThan(
      previewBody.indexOf('await runAgentTaskAction('),
    )

    expect(stopBody).toContain(guard)
    expect(stopBody).toContain("text: 'Select an agent task before stopping.'")
    expect(stopBody.indexOf(guard)).toBeLessThan(
      stopBody.indexOf('if (turnBusy)'),
    )
    expect(stopBody.indexOf(guard)).toBeLessThan(
      stopBody.indexOf('await runAgentTaskAction('),
    )

    expect(resumeBody).toContain(guard)
    expect(resumeBody).toContain("text: 'Select an agent task before resuming.'")
    expect(resumeBody.indexOf(guard)).toBeLessThan(
      resumeBody.indexOf('if (!agentTaskPrompt.trim())'),
    )
    expect(resumeBody.indexOf(guard)).toBeLessThan(
      resumeBody.indexOf('await runAgentTaskAction('),
    )
  })

  it('normalizes agent task runtime ids before IPC and feedback', () => {
    const readStart = rendererSource.indexOf('async function readAgentTaskOutput')
    const readEnd = rendererSource.indexOf('async function previewAgentTaskOutput', readStart)
    const readBody = rendererSource.slice(readStart, readEnd)
    const previewStart = rendererSource.indexOf('async function previewAgentTaskOutput')
    const previewEnd = rendererSource.indexOf('async function stopAgentTask', previewStart)
    const previewBody = rendererSource.slice(previewStart, previewEnd)
    const stopStart = rendererSource.indexOf('async function stopAgentTask')
    const stopEnd = rendererSource.indexOf('async function resumeAgentTask', stopStart)
    const stopBody = rendererSource.slice(stopStart, stopEnd)
    const resumeStart = rendererSource.indexOf('async function resumeAgentTask')
    const resumeEnd = rendererSource.indexOf('async function runTeamAction', resumeStart)
    const resumeBody = rendererSource.slice(resumeStart, resumeEnd)

    expect(readBody).toContain('await runAgentTaskAction(`${sessionId}:${selectedAgentTaskId}:read`')
    expect(readBody).toContain('taskId: selectedAgentTaskId,')
    expect(readBody).toContain('setAgentsStatus({ kind: \'success\', text: `Requested output for task ${selectedAgentTaskId}.` })')

    expect(previewBody).toContain('await runAgentTaskAction(`${sessionId}:${selectedAgentTaskId}:preview`')
    expect(previewBody).toContain('{ taskId: selectedAgentTaskId },')
    expect(previewBody).toContain('task.id.trim() === selectedAgentTaskId')
    expect(previewBody).toContain('setAgentsStatus({ kind: \'success\', text: `Previewed output for task ${selectedAgentTaskId}.` })')

    expect(stopBody).toContain('await runAgentTaskAction(`${sessionId}:${selectedAgentTaskId}:stop`')
    expect(stopBody).toContain('await window.claudeDesktop.sessions.stopAgentTask(sessionId, { taskId: selectedAgentTaskId })')
    expect(stopBody).toContain('setAgentsStatus({ kind: \'success\', text: `Stopped agent task ${selectedAgentTaskId}.` })')

    expect(resumeBody).toContain('await runAgentTaskAction(`${sessionId}:${selectedAgentTaskId}:resume`')
    expect(resumeBody).toContain('taskId: selectedAgentTaskId,')
    expect(resumeBody).toContain('setAgentsStatus({ kind: \'success\', text: `Resumed agent task ${selectedAgentTaskId}.` })')
  })

  it('keeps agent task runtime context selected for immediate follow-up actions', () => {
    const ipcSource = readFileSync(join(process.cwd(), 'desktop/main/ipc.ts'), 'utf8')
    const diagnosticsSource = readFileSync(join(process.cwd(), 'desktop/main/diagnostics.ts'), 'utf8')
    const readStart = rendererSource.indexOf('async function readAgentTaskOutput')
    const readEnd = rendererSource.indexOf('async function previewAgentTaskOutput', readStart)
    const readBody = rendererSource.slice(readStart, readEnd)
    const previewStart = rendererSource.indexOf('async function previewAgentTaskOutput')
    const previewEnd = rendererSource.indexOf('async function stopAgentTask', previewStart)
    const previewBody = rendererSource.slice(previewStart, previewEnd)
    const stopStart = rendererSource.indexOf('async function stopAgentTask')
    const stopEnd = rendererSource.indexOf('async function resumeAgentTask', stopStart)
    const stopBody = rendererSource.slice(stopStart, stopEnd)
    const resumeStart = rendererSource.indexOf('async function resumeAgentTask')
    const resumeEnd = rendererSource.indexOf('async function runTeamAction', resumeStart)
    const resumeBody = rendererSource.slice(resumeStart, resumeEnd)

    expect(ipcSource).toContain('selectedAgentTaskId?: string')
    expect(diagnosticsSource).toContain('selectedAgentTaskId?: string')
    expect(diagnosticsSource).toContain('selectedAgentTaskId: session.layout.selectedAgentTaskId')
    expect(diagnosticsSource).toContain('selectedAgentType?: string')
    expect(diagnosticsSource).toContain('selectedAgentSource?: AgentSource')
    expect(diagnosticsSource).toContain('selectedAgentType: session.layout.selectedAgentType')
    expect(diagnosticsSource).toContain('selectedAgentSource: session.layout.selectedAgentSource')
    expect(diagnosticsSource).toContain('selectedPluginIdentity?: string')
    expect(diagnosticsSource).toContain('selectedPluginIdentity: session.layout.selectedPluginIdentity')
    expect(diagnosticsSource).toContain('activeFile?: string')
    expect(diagnosticsSource).toContain('terminalId?: string')
    expect(diagnosticsSource).toContain('previewUrl?: string')
    expect(diagnosticsSource).toContain('sidebarWidth: number')
    expect(diagnosticsSource).toContain('workspaceRatio: number')
    expect(diagnosticsSource).toContain('expandedPathCount: number')
    expect(diagnosticsSource).toContain('activeFile: session.layout.activeFile')
    expect(diagnosticsSource).toContain('terminalId: session.layout.terminalId')
    expect(diagnosticsSource).toContain('previewUrl: session.layout.previewUrl')
    expect(diagnosticsSource).toContain('sidebarWidth: session.layout.sidebarWidth')
    expect(diagnosticsSource).toContain('workspaceRatio: session.layout.workspaceRatio')
    expect(diagnosticsSource).toContain('expandedPathCount: session.layout.expandedPaths?.length ?? 0')

    for (const body of [readBody, previewBody, stopBody, resumeBody]) {
      expect(body).toContain('await updateSessionLayout(session.id, { selectedAgentTaskId })')
      expect(body.indexOf(activeSessionGuard)).toBeLessThan(
        body.indexOf('await updateSessionLayout(session.id, { selectedAgentTaskId })'),
      )
      expect(body.indexOf('await updateSessionLayout(session.id, { selectedAgentTaskId })')).toBeLessThan(
        body.indexOf('setAgentsStatus({ kind: \'success\''),
      )
    }
  })

  it('allows selected user custom agents to load into the editor without an active project session', () => {
    const canEditStart = rendererSource.indexOf('const canEditSelectedAgent = Boolean(')
    const canEditEnd = rendererSource.indexOf('const canDeleteAgentDraft = Boolean(', canEditStart)
    const canEditBody = rendererSource.slice(canEditStart, canEditEnd)
    const prepareEditStart = rendererSource.indexOf('function prepareSelectedAgentEdit(): void')
    const prepareEditEnd = rendererSource.indexOf('async function diagnoseAgentByType', prepareEditStart)
    const prepareEditBody = rendererSource.slice(prepareEditStart, prepareEditEnd)
    const cannotEditGuard = 'if (!canEditSelectedAgent) {'

    expect(canEditBody).toContain("selectedAgent.source === 'user' || activeSession")
    expect(prepareEditBody).toContain(cannotEditGuard)
    expect(prepareEditBody).toContain("text: 'Select a project session before editing this agent.'")
    expect(prepareEditBody.indexOf(cannotEditGuard)).toBeLessThan(
      prepareEditBody.indexOf('setAgentDraft(agentDraftFromAgent('),
    )
    expect(rendererSource).toContain('<button className="tool-button" onClick={handleSelectedAgentPrepareEditClick} disabled={!canEditSelectedAgent || !!loadingLabel}>')
  })

  it('blocks agent launch form buttons when prerequisites are unavailable', () => {
    const launchStart = rendererSource.indexOf('<section className="settings-section" id="agents-launch">')
    const launchEnd = rendererSource.indexOf('{agentDiagnostics && (', launchStart)
    const launchBody = rendererSource.slice(launchStart, launchEnd)

    expect(launchBody).toContain('<button className="tool-button" onClick={handleAgentLaunchCreateSessionClick} disabled={!activeSession || !agentLaunchDraft.agentType.trim() || !!loadingLabel}>')
    expect(launchBody).toContain('<button className="send-button" onClick={handleAgentLaunchTaskClick} disabled={!canLaunchAgentTask || !!loadingLabel}>')
  })

  it('routes stale agent launch session creation through handlers', () => {
    const launchStart = rendererSource.indexOf('<section className="settings-section" id="agents-launch">')
    const launchEnd = rendererSource.indexOf('{agentDiagnostics && (', launchStart)
    const launchBody = rendererSource.slice(launchStart, launchEnd)

    expect(rendererSource).toContain('function handleAgentLaunchCreateSessionClick(): void')
    expect(launchBody).toContain('<button className="tool-button" onClick={handleAgentLaunchCreateSessionClick} disabled={!activeSession || !agentLaunchDraft.agentType.trim() || !!loadingLabel}>')
    expect(launchBody).not.toContain('onClick={() => !loadingLabel && void createAgentSession()}')
    expect(launchBody).not.toContain('activeSession && agentLaunchDraft.agentType.trim() && !loadingLabel && void createAgentSession()')
  })

  it('routes stale agent task launch clicks through the handler', () => {
    const launchStart = rendererSource.indexOf('<section className="settings-section" id="agents-launch">')
    const launchEnd = rendererSource.indexOf('{agentDiagnostics && (', launchStart)
    const launchBody = rendererSource.slice(launchStart, launchEnd)

    expect(rendererSource).toContain('function handleAgentLaunchTaskClick(): void')
    expect(launchBody).toContain('<button className="send-button" onClick={handleAgentLaunchTaskClick} disabled={!canLaunchAgentTask || !!loadingLabel}>')
    expect(launchBody).not.toContain('onClick={() => !loadingLabel && void launchAgentTask()}')
    expect(launchBody).not.toContain('canLaunchAgentTask && !loadingLabel && void launchAgentTask()')
  })

  it('blocks agent task action buttons while loading', () => {
    const tasksStart = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">')
    const tasksEnd = rendererSource.indexOf("{activePane === 'teams' && (", tasksStart)
    const tasksBody = rendererSource.slice(tasksStart, tasksEnd)

    expect(tasksBody).toContain('<button className="tool-button" onClick={() => handleAgentTaskReadOutputClick(task.id)} disabled={!canQueueRuntimePrompt || !!loadingLabel}>')
    expect(tasksBody).toContain('<button className="tool-button" onClick={() => handleAgentTaskPreviewOutputClick(task.id)} disabled={!activeSession || !task.outputFile || !!loadingLabel}>')
    expect(tasksBody).toContain('<button className="tool-button" onClick={() => handleAgentTaskResumeClick(task.id)} disabled={!canQueueRuntimePrompt || !agentTaskPrompt.trim() || !!loadingLabel}>')
    expect(tasksBody).toContain('<button className="tool-button danger" onClick={() => handleAgentTaskStopClick(task.id)} disabled={!canQueueRuntimePrompt || task.status !== \'running\' || !!loadingLabel}>')
  })

  it('routes stale agent task output previews through the handler', () => {
    const tasksStart = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">')
    const tasksEnd = rendererSource.indexOf("{activePane === 'teams' && (", tasksStart)
    const tasksBody = rendererSource.slice(tasksStart, tasksEnd)

    expect(rendererSource).toContain('function handleAgentTaskPreviewOutputClick(taskId: string): void')
    expect(tasksBody).toContain('<button className="tool-button" onClick={() => handleAgentTaskPreviewOutputClick(task.id)} disabled={!activeSession || !task.outputFile || !!loadingLabel}>')
    expect(tasksBody).not.toContain('onClick={() => !loadingLabel && void previewAgentTaskOutput(task.id)}')
    expect(tasksBody).not.toContain('task.outputFile && !loadingLabel && void previewAgentTaskOutput(task.id)')
  })

  it('routes stale agent task Read output clicks through the handler', () => {
    const readStart = rendererSource.indexOf('async function readAgentTaskOutput')
    const readEnd = rendererSource.indexOf('async function previewAgentTaskOutput', readStart)
    const readBody = rendererSource.slice(readStart, readEnd)
    const tasksStart = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">')
    const tasksEnd = rendererSource.indexOf("{activePane === 'teams' && (", tasksStart)
    const tasksBody = rendererSource.slice(tasksStart, tasksEnd)

    expect(readBody).toContain("text: 'Select a session before managing agent tasks.'")
    expect(readBody).toContain("text: 'Select an agent task before reading output.'")
    expect(readBody).toContain("text: 'Wait for the current Claude turn to finish before reading agent output.'")
    expect(rendererSource).toContain('function handleAgentTaskReadOutputClick(taskId: string): void')
    expect(tasksBody).toContain('<button className="tool-button" onClick={() => handleAgentTaskReadOutputClick(task.id)} disabled={!canQueueRuntimePrompt || !!loadingLabel}>')
    expect(tasksBody).not.toContain('onClick={() => !loadingLabel && void readAgentTaskOutput(task.id)}')
    expect(tasksBody).not.toContain('canQueueRuntimePrompt && !loadingLabel && void readAgentTaskOutput(task.id)')
  })

  it('routes stale agent task Resume clicks through the handler', () => {
    const resumeStart = rendererSource.indexOf('async function resumeAgentTask')
    const resumeEnd = rendererSource.indexOf('async function runTeamAction', resumeStart)
    const resumeBody = rendererSource.slice(resumeStart, resumeEnd)
    const tasksStart = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">')
    const tasksEnd = rendererSource.indexOf("{activePane === 'teams' && (", tasksStart)
    const tasksBody = rendererSource.slice(tasksStart, tasksEnd)

    expect(resumeBody).toContain("text: 'Select a session before managing agent tasks.'")
    expect(resumeBody).toContain("text: 'Select an agent task before resuming.'")
    expect(resumeBody).toContain("text: 'Enter a follow-up prompt before resuming an agent task.'")
    expect(resumeBody).toContain("text: 'Wait for the current Claude turn to finish before resuming an agent task.'")
    expect(rendererSource).toContain('function handleAgentTaskResumeClick(taskId: string): void')
    expect(tasksBody).toContain('<button className="tool-button" onClick={() => handleAgentTaskResumeClick(task.id)} disabled={!canQueueRuntimePrompt || !agentTaskPrompt.trim() || !!loadingLabel}>')
    expect(tasksBody).not.toContain('onClick={() => !loadingLabel && void resumeAgentTask(task.id)}')
    expect(tasksBody).not.toContain('agentTaskPrompt.trim() && !loadingLabel && void resumeAgentTask(task.id)')
  })

  it('routes stale agent task Stop clicks through the handler', () => {
    const stopStart = rendererSource.indexOf('async function stopAgentTask')
    const stopEnd = rendererSource.indexOf('async function resumeAgentTask', stopStart)
    const stopBody = rendererSource.slice(stopStart, stopEnd)
    const tasksStart = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">')
    const tasksEnd = rendererSource.indexOf("{activePane === 'teams' && (", tasksStart)
    const tasksBody = rendererSource.slice(tasksStart, tasksEnd)

    expect(stopBody).toContain("text: 'Select a session before managing agent tasks.'")
    expect(stopBody).toContain("text: 'Select an agent task before stopping.'")
    expect(stopBody).toContain("text: 'Wait for the current Claude turn to finish before stopping an agent task.'")
    expect(rendererSource).toContain('function handleAgentTaskStopClick(taskId: string): void')
    expect(tasksBody).toContain('<button className="tool-button danger" onClick={() => handleAgentTaskStopClick(task.id)} disabled={!canQueueRuntimePrompt || task.status !== \'running\' || !!loadingLabel}>')
    expect(tasksBody).not.toContain('onClick={() => !loadingLabel && void stopAgentTask(task.id)}')
    expect(tasksBody).not.toContain("task.status === 'running' && !loadingLabel && void stopAgentTask(task.id)")
  })

  it('shows structured empty state for agent task history', () => {
    const tasksStart = rendererSource.indexOf('<section className="settings-section" id="agents-tasks">')
    const tasksEnd = rendererSource.indexOf("{activePane === 'teams' && (", tasksStart)
    const tasksBody = rendererSource.slice(tasksStart, tasksEnd)
    const emptyStart = tasksBody.indexOf('workarea-empty settings-empty-state')
    const emptyEnd = tasksBody.indexOf('</div>', emptyStart)
    const emptyBody = tasksBody.slice(emptyStart, emptyEnd)

    expect(emptyBody).toContain('workarea-empty settings-empty-state')
    expect(emptyBody).toContain('<Icon name="play" />')
    expect(emptyBody).toContain('<strong>No running agent tasks</strong>')
  })

  it('guards team lifecycle async results against stale session writes', () => {
    const createStart = rendererSource.indexOf('async function createTeam')
    const createEnd = rendererSource.indexOf('async function sendTeamMessage', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)
    const sendStart = rendererSource.indexOf('async function sendTeamMessage')
    const sendEnd = rendererSource.indexOf('async function spawnTeamTeammate', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)
    const spawnStart = rendererSource.indexOf('async function spawnTeamTeammate')
    const spawnEnd = rendererSource.indexOf('async function requestTeamShutdown', spawnStart)
    const spawnBody = rendererSource.slice(spawnStart, spawnEnd)
    const shutdownStart = rendererSource.indexOf('async function requestTeamShutdown')
    const shutdownEnd = rendererSource.indexOf('function selectTeam', shutdownStart)
    const shutdownBody = rendererSource.slice(shutdownStart, shutdownEnd)
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('async function saveScheduledTask', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)

    for (const body of [createBody, spawnBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('const sessionId = session.id')
      expect(body).toContain('const cwd = session.cwd')
      expect(body).toContain('if (activeSessionIdRef.current !== session.id) return')
      expect(body.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
        body.indexOf('const nextTeams = await window.claudeDesktop.teams.list(cwd)'),
      )
      expectGuardBetween(
        body,
        activeSessionGuard,
        'const nextTeams = await window.claudeDesktop.teams.list(cwd)',
        'setTeams(nextTeams)',
      )
    }

    for (const body of [sendBody, shutdownBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('const sessionId = session.id')
      expect(body).toContain('if (activeSessionIdRef.current !== session.id) return')
    }
    expect(sendBody).toContain("message: ''")
    expect(sendBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      sendBody.indexOf('setTeamDraft(prev => ({'),
    )
    expect(shutdownBody).toContain("shutdownReason: ''")
    expect(shutdownBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      shutdownBody.indexOf('setTeamDraft(prev => ({'),
    )

    expect(deleteBody).toContain('const session = activeSession')
    expect(deleteBody).toContain('const sessionId = session.id')
    expect(deleteBody).toContain('const cwd = session.cwd')
    expect(deleteBody).toContain('if (activeSessionIdRef.current !== session.id) return')
    expect(deleteBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeGreaterThan(
      deleteBody.indexOf('await window.claudeDesktop.teams.delete('),
    )
    expect(deleteBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      deleteBody.indexOf('const nextTeams = await window.claudeDesktop.teams.list(cwd)'),
    )
    expectGuardBetween(
      deleteBody,
      activeSessionGuard,
      'const nextTeams = await window.claudeDesktop.teams.list(cwd)',
      'setTeams(nextTeams)',
    )
  })

  it('binds team lifecycle layout writes to the origin session', () => {
    const createStart = rendererSource.indexOf('async function createTeam')
    const createEnd = rendererSource.indexOf('async function sendTeamMessage', createStart)
    const createBody = rendererSource.slice(createStart, createEnd)
    const sendStart = rendererSource.indexOf('async function sendTeamMessage')
    const sendEnd = rendererSource.indexOf('async function spawnTeamTeammate', sendStart)
    const sendBody = rendererSource.slice(sendStart, sendEnd)
    const spawnStart = rendererSource.indexOf('async function spawnTeamTeammate')
    const spawnEnd = rendererSource.indexOf('async function requestTeamShutdown', spawnStart)
    const spawnBody = rendererSource.slice(spawnStart, spawnEnd)
    const shutdownStart = rendererSource.indexOf('async function requestTeamShutdown')
    const shutdownEnd = rendererSource.indexOf('async function requestTeamMemberShutdown', shutdownStart)
    const shutdownBody = rendererSource.slice(shutdownStart, shutdownEnd)
    const removeStart = rendererSource.indexOf('async function removeTeamMember')
    const removeEnd = rendererSource.indexOf('function selectTeam(team: TeamInfo): void', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const deleteStart = rendererSource.indexOf('async function deleteTeam')
    const deleteEnd = rendererSource.indexOf('function handleTeamFormCreateClick', deleteStart)
    const deleteBody = rendererSource.slice(deleteStart, deleteEnd)

    for (const body of [createBody, sendBody, spawnBody, shutdownBody, removeBody, deleteBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('await updateSessionLayout(session.id,')
      expect(body).not.toContain('await updateLayout({ selectedTeamName:')
    }
  })

  it('guards scoped plugin command async results against stale session writes', () => {
    const listStart = rendererSource.indexOf('async function listAvailablePlugins')
    const listEnd = rendererSource.indexOf('async function installPlugin', listStart)
    const listBody = rendererSource.slice(listStart, listEnd)
    const installStart = rendererSource.indexOf('async function installPlugin')
    const installEnd = rendererSource.indexOf('async function refreshAgents', installStart)
    const installBody = rendererSource.slice(installStart, installEnd)
    const updateStart = rendererSource.indexOf('async function updatePlugin')
    const updateEnd = rendererSource.indexOf('async function setPluginEnabled', updateStart)
    const updateBody = rendererSource.slice(updateStart, updateEnd)
    const enabledStart = rendererSource.indexOf('async function setPluginEnabled')
    const enabledEnd = rendererSource.indexOf('async function uninstallPlugin', enabledStart)
    const enabledBody = rendererSource.slice(enabledStart, enabledEnd)
    const uninstallStart = rendererSource.indexOf('async function uninstallPlugin')
    const uninstallEnd = rendererSource.indexOf('async function listAvailablePlugins', uninstallStart)
    const uninstallBody = rendererSource.slice(uninstallStart, uninstallEnd)
    const helperStart = rendererSource.indexOf('async function selectInstalledPluginAfterRefresh')
    const helperEnd = rendererSource.indexOf('function openSettingsNavItem', helperStart)
    const helperBody = rendererSource.slice(helperStart, helperEnd)

    expect(listBody).toContain("const session = scope === 'project' || scope === 'local' ? activeSession : undefined")
    expect(listBody).toContain('const cwd = pluginCommandCwd(scope, session)')
    expect(listBody).toContain("if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return")
    expect(listBody.indexOf("if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return")).toBeLessThan(
      listBody.indexOf('setPluginOutput('),
    )
    expect(installBody).toContain('const session = activeSession')
    expect(installBody).toContain('const cwd = pluginCommandCwd(scope, session)')
    expect(installBody).toContain("if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return")
    expect(installBody.indexOf("if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return")).toBeLessThan(
      installBody.indexOf('setPluginOutput('),
    )
    for (const body of [updateBody, enabledBody, uninstallBody]) {
      expect(body).toContain('const session = activeSession')
    }
    for (const body of [updateBody, enabledBody]) {
      expect(body).not.toContain("const session = scope === 'project' || scope === 'local' ? activeSession : undefined")
    }

    expect(helperBody).toContain("originSession?: Pick<DesktopSession, 'id'>")
    expect(helperBody).toContain("if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== originSession?.id) return")
    expect(helperBody).toContain('await updateSessionLayout(originSession.id, { selectedPluginIdentity })')
    expect(helperBody).not.toContain('await updateLayout({ selectedPluginIdentity })')
    for (const body of [listBody, installBody, updateBody, enabledBody, uninstallBody]) {
      expect(body).toContain('await refreshDesktopConfig()')
      expect(body).toContain('if ((scope === \'project\' || scope === \'local\') && activeSessionIdRef.current !== session?.id) return')
    }
    for (const body of [installBody, updateBody, enabledBody]) {
      expect(body).toContain('await selectInstalledPluginAfterRefresh(plugin')
      expect(body).toContain('scope, session)')
      expect(body.indexOf('await refreshDesktopConfig()')).toBeLessThan(
        body.lastIndexOf("if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return"),
      )
      expect(body.lastIndexOf("if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return")).toBeLessThan(
        body.indexOf('await selectInstalledPluginAfterRefresh('),
      )
    }
    for (const body of [listBody, uninstallBody]) {
      const postRefreshGuard = body.lastIndexOf("if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return")
      expect(body.indexOf('await refreshDesktopConfig()')).toBeLessThan(postRefreshGuard)
      expect(postRefreshGuard).toBeLessThan(body.lastIndexOf('setSettingsStatus({'))
    }
    expect(uninstallBody).toContain('await updateSessionLayout(session.id, { selectedPluginIdentity: undefined })')
    expect(uninstallBody).not.toContain('await updateLayout({ selectedPluginIdentity: undefined })')
    expect(uninstallBody.indexOf('await updateSessionLayout(session.id, { selectedPluginIdentity: undefined })')).toBeGreaterThan(
      uninstallBody.indexOf("if ((scope === 'project' || scope === 'local') && activeSessionIdRef.current !== session?.id) return"),
    )
    expect(uninstallBody.indexOf('await updateSessionLayout(session.id, { selectedPluginIdentity: undefined })')).toBeLessThan(
      uninstallBody.indexOf('await refreshDesktopConfig()'),
    )
  })

  it('guards project MCP async results against stale session writes', () => {
    const inspectStart = rendererSource.indexOf('async function inspectProjectMcp')
    const inspectEnd = rendererSource.indexOf('async function setProjectMcpApproval', inspectStart)
    const inspectBody = rendererSource.slice(inspectStart, inspectEnd)
    const approvalStart = rendererSource.indexOf('async function setProjectMcpApproval')
    const approvalEnd = rendererSource.indexOf('async function setUserMcpEnabled', approvalStart)
    const approvalBody = rendererSource.slice(approvalStart, approvalEnd)
    const healthStart = rendererSource.indexOf('async function checkMcpHealth')
    const healthEnd = rendererSource.indexOf('function pluginCommandCwd', healthStart)
    const healthBody = rendererSource.slice(healthStart, healthEnd)

    expect(inspectBody).toContain('const session = activeSession')
    expect(inspectBody).toContain('const detail = await window.claudeDesktop.workspaceMcp.read(session.cwd, selectedMcpName)')
    expect(inspectBody).toContain('await updateSessionLayout(session.id, {')
    expect(inspectBody).toContain("selectedMcpScope: 'project',")
    expect(inspectBody).not.toContain('void updateLayout({')
    expectGuardBetween(
      inspectBody,
      activeSessionGuard,
      'const detail = await window.claudeDesktop.workspaceMcp.read(session.cwd, selectedMcpName)',
      'setSelectedMcpDetail(detail)',
    )

    expect(approvalBody).toContain('const session = activeSession')
    expect(approvalBody).toContain("const actionKey = `${session.cwd}:project-mcp:${selectedMcpName}:${approved ? 'approve' : 'reject'}`")
    expect(approvalBody).toContain('session.cwd,')
    expect(approvalBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      approvalBody.indexOf('setProjectMcpServers(servers)'),
    )
    expect(approvalBody).toContain('await refreshWorkspace(session)')
    expectGuardBetween(
      approvalBody,
      activeSessionGuard,
      'await refreshWorkspace(session)',
      'setSettingsStatus({',
    )

    expect(healthBody).toContain('const session = activeSession')
    expect(healthBody).toContain('const cwd = session.cwd')
    expect(healthBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      healthBody.indexOf('setMcpHealthOutput('),
    )
  })

  it('guards project skill async results against stale session writes', () => {
    const installStart = rendererSource.indexOf('async function installProjectSkill')
    const installEnd = rendererSource.indexOf('async function inspectUserSkill', installStart)
    const installBody = rendererSource.slice(installStart, installEnd)
    const saveStart = rendererSource.indexOf('async function saveSkillDraft')
    const saveEnd = rendererSource.indexOf('async function removeUserSkill', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const removeStart = rendererSource.indexOf('async function removeProjectSkill')
    const removeEnd = rendererSource.indexOf('async function saveMcpServer', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)

    expect(installBody).toContain('const session = activeSession')
    expect(installBody).toContain('if (activeSessionIdRef.current !== session.id) return')
    expect(installBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      installBody.indexOf("setSettingsStatus({ kind: 'success', text: 'Installed project skill.' })"),
    )
    expect(installBody).toContain('await refreshWorkspace(session)')
    expectGuardBetween(
      installBody,
      activeSessionGuard,
      'await refreshWorkspace(session)',
      "setSettingsStatus({ kind: 'success', text: 'Installed project skill.' })",
    )

    expect(saveBody).toContain('const session = activeSession')
    expect(saveBody).toContain('window.claudeDesktop.workspaceSkills.save(session.cwd, {')
    expect(saveBody).toContain('if (activeSessionIdRef.current !== session.id) return')
    expect(saveBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      saveBody.indexOf('setProjectSkills(skills)'),
    )
    expect(saveBody).toContain('await refreshWorkspace(session)')
    expectGuardBetween(
      saveBody,
      activeSessionGuard,
      'await refreshWorkspace(session)',
      "setSettingsStatus({ kind: 'success', text: `Saved",
    )

    expect(removeBody).toContain('const session = activeSession')
    expect(removeBody).toContain('if (activeSessionIdRef.current !== session.id) return')
    expect(removeBody.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
      removeBody.indexOf('setProjectSkills(skills)'),
    )
    expect(removeBody).toContain('await refreshWorkspace(session)')
    expectGuardBetween(
      removeBody,
      activeSessionGuard,
      'await refreshWorkspace(session)',
      'setSettingsStatus({ kind: \'success\', text: `Removed project skill',
    )
  })

  it('binds Skill async layout writes to the origin session', () => {
    const installUserStart = rendererSource.indexOf('async function installLocalSkill')
    const installUserEnd = rendererSource.indexOf('async function installProjectSkill', installUserStart)
    const installUserBody = rendererSource.slice(installUserStart, installUserEnd)
    const installProjectStart = rendererSource.indexOf('async function installProjectSkill')
    const installProjectEnd = rendererSource.indexOf('async function inspectUserSkill', installProjectStart)
    const installProjectBody = rendererSource.slice(installProjectStart, installProjectEnd)
    const inspectUserStart = rendererSource.indexOf('async function inspectUserSkill')
    const inspectUserEnd = rendererSource.indexOf('async function inspectProjectSkill', inspectUserStart)
    const inspectUserBody = rendererSource.slice(inspectUserStart, inspectUserEnd)
    const inspectProjectStart = rendererSource.indexOf('async function inspectProjectSkill')
    const inspectProjectEnd = rendererSource.indexOf('function startNewUserSkillDraft', inspectProjectStart)
    const inspectProjectBody = rendererSource.slice(inspectProjectStart, inspectProjectEnd)
    const editUserStart = rendererSource.indexOf('async function editUserSkill')
    const editUserEnd = rendererSource.indexOf('async function editProjectSkill', editUserStart)
    const editUserBody = rendererSource.slice(editUserStart, editUserEnd)
    const editProjectStart = rendererSource.indexOf('async function editProjectSkill')
    const editProjectEnd = rendererSource.indexOf('function cancelSkillDraft', editProjectStart)
    const editProjectBody = rendererSource.slice(editProjectStart, editProjectEnd)
    const saveStart = rendererSource.indexOf('async function saveSkillDraft')
    const saveEnd = rendererSource.indexOf('async function removeUserSkill', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const removeUserStart = rendererSource.indexOf('async function removeUserSkill')
    const removeUserEnd = rendererSource.indexOf('async function removeProjectSkill', removeUserStart)
    const removeUserBody = rendererSource.slice(removeUserStart, removeUserEnd)
    const removeProjectStart = rendererSource.indexOf('async function removeProjectSkill')
    const removeProjectEnd = rendererSource.indexOf('async function saveMcpServer', removeProjectStart)
    const removeProjectBody = rendererSource.slice(removeProjectStart, removeProjectEnd)

    for (const body of [
      installUserBody,
      installProjectBody,
      inspectUserBody,
      inspectProjectBody,
      editUserBody,
      editProjectBody,
      saveBody,
      removeUserBody,
      removeProjectBody,
    ]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('if (session) await updateSessionLayout(session.id,')
      expect(body).not.toContain('await updateLayout({\n          selectedSkillName:')
      expect(body).not.toContain('void updateLayout({\n        selectedSkillName:')
      expect(body).not.toContain('await updateLayout({\n            selectedSkillName: undefined')
    }
  })

  it('guards project MCP save and remove async results against stale session writes', () => {
    const saveStart = rendererSource.indexOf('async function saveMcpServer')
    const saveEnd = rendererSource.indexOf('async function removeMcpServer', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const removeStart = rendererSource.indexOf('async function removeMcpServer')
    const removeEnd = rendererSource.indexOf('async function inspectUserMcp', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)

    expect(saveBody).toContain('const session = activeSession')
    expect(saveBody).toContain("const projectSession = scope === 'project' ? session : undefined")
    expect(saveBody).toContain("if (scope === 'project' && !projectSession)")
    expect(saveBody).toContain('projectSession.cwd,')
    expect(saveBody.indexOf("if (scope === 'project' && activeSessionIdRef.current !== projectSession.id) return")).toBeLessThan(
      saveBody.indexOf('setMcpDraft(emptyMcpDraft())'),
    )
    const savePostConfigGuard = saveBody.indexOf(
      "if (scope === 'project' && activeSessionIdRef.current !== projectSession.id) return",
      saveBody.indexOf('await refreshDesktopConfig()'),
    )
    expect(savePostConfigGuard).toBeGreaterThan(saveBody.indexOf('await refreshDesktopConfig()'))
    expect(savePostConfigGuard).toBeLessThan(saveBody.indexOf('await refreshWorkspace(projectSession)'))
    expect(saveBody).toContain('await refreshWorkspace(projectSession)')
    expectGuardBetween(
      saveBody,
      'if (activeSessionIdRef.current !== projectSession.id) return',
      'await refreshWorkspace(projectSession)',
      "setSettingsStatus({ kind: 'success', text: 'Saved MCP server.' })",
    )

    expect(removeBody).toContain('const session = activeSession')
    expect(removeBody).toContain("const projectSession = scope === 'project' ? session : undefined")
    expect(removeBody).toContain("if (scope === 'project' && !projectSession)")
    expect(removeBody).toContain('projectSession.cwd,')
    expect(removeBody.indexOf("if (scope === 'project' && activeSessionIdRef.current !== projectSession.id) return")).toBeLessThan(
      removeBody.indexOf('if (mcpDraft.editingName?.trim() === removedMcpName && mcpDraft.scope === scope)'),
    )
    const removePostConfigGuard = removeBody.indexOf(
      "if (scope === 'project' && activeSessionIdRef.current !== projectSession.id) return",
      removeBody.indexOf('await refreshDesktopConfig()'),
    )
    expect(removePostConfigGuard).toBeGreaterThan(removeBody.indexOf('await refreshDesktopConfig()'))
    expect(removePostConfigGuard).toBeLessThan(removeBody.indexOf('await refreshWorkspace(projectSession)'))
    expect(removeBody).toContain('await refreshWorkspace(projectSession)')
    expectGuardBetween(
      removeBody,
      'if (activeSessionIdRef.current !== projectSession.id) return',
      'await refreshWorkspace(projectSession)',
      "setSettingsStatus({ kind: 'success', text: `Removed ${scope} MCP server",
    )
  })

  it('binds user MCP async layout writes to the origin session', () => {
    const saveStart = rendererSource.indexOf('async function saveMcpServer')
    const saveEnd = rendererSource.indexOf('async function removeMcpServer', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const removeStart = rendererSource.indexOf('async function removeMcpServer')
    const removeEnd = rendererSource.indexOf('async function inspectUserMcp', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const inspectStart = rendererSource.indexOf('async function inspectUserMcp')
    const inspectEnd = rendererSource.indexOf('async function inspectProjectMcp', inspectStart)
    const inspectBody = rendererSource.slice(inspectStart, inspectEnd)

    for (const body of [saveBody, removeBody, inspectBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('if (session) await updateSessionLayout(session.id,')
    }
    expect(inspectBody).not.toContain('void updateLayout({')
    expect(saveBody).not.toContain('await updateLayout({\n          selectedMcpName:')
    expect(removeBody).not.toContain('await updateLayout({\n            selectedMcpName: undefined')
  })

  it('selects saved MCP server details for immediate follow-up actions', () => {
    const saveStart = rendererSource.indexOf('async function saveMcpServer')
    const saveEnd = rendererSource.indexOf('async function removeMcpServer', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)

    expect(saveBody).toContain('let savedMcpServers: McpServerInfo[]')
    expect(saveBody).toContain('savedMcpServers = await window.claudeDesktop.workspaceMcp.addOrUpdate(')
    expect(saveBody).toContain('savedMcpServers = await window.claudeDesktop.mcp.addOrUpdate(mcpInputFromDraft(mcpDraft))')
    expect(saveBody).toContain('const savedSelectedMcpDetail = savedMcpServers.find(server => server.name.trim() === name)')
    expect(saveBody).toContain('if (savedSelectedMcpDetail) {')
    expect(saveBody).toContain('setSelectedMcpDetail(savedSelectedMcpDetail)')
    expect(saveBody).toContain('selectedMcpName: savedSelectedMcpDetail.name')
    expect(saveBody).toContain('selectedMcpSourcePath: savedSelectedMcpDetail.sourcePath')
    expect(saveBody.indexOf('const savedSelectedMcpDetail = savedMcpServers.find(server => server.name.trim() === name)')).toBeLessThan(
      saveBody.indexOf('if (savedSelectedMcpDetail) {'),
    )
    expect(saveBody.indexOf('if (savedSelectedMcpDetail) {')).toBeLessThan(
      saveBody.indexOf('setMcpDraft(emptyMcpDraft())'),
    )
  })

  it('preserves selected MCP detail when removing a same-name server from another scope', () => {
    const removeStart = rendererSource.indexOf('async function removeMcpServer')
    const removeEnd = rendererSource.indexOf('async function inspectUserMcp', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const scopedDetailMatch = 'const selectedMcpDetailMatchesRemovedScope = Boolean('

    expect(removeBody).toContain(scopedDetailMatch)
    expect(removeBody).toContain("scope === 'project'")
    expect(removeBody).toContain('projectMcpServers.some(server =>')
    expect(removeBody).toContain('desktopConfig?.mcpServers.some(server =>')
    expect(removeBody).toContain('server.sourcePath === selectedMcpDetail.sourcePath')
    expect(removeBody).toContain('if (selectedMcpDetailMatchesRemovedScope) {')
    expect(removeBody).not.toContain('if (selectedMcpDetail?.name.trim() === removedMcpName) {')
    expect(removeBody.indexOf(scopedDetailMatch)).toBeLessThan(
      removeBody.indexOf('if (selectedMcpDetailMatchesRemovedScope) {'),
    )
  })

  it('guards project scheduled task async results against stale session writes', () => {
    const saveStart = rendererSource.indexOf('async function saveProjectScheduledTask')
    const saveEnd = rendererSource.indexOf('async function removeProjectScheduledTask', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const removeStart = rendererSource.indexOf('async function removeProjectScheduledTask')
    const removeEnd = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const toggleStart = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled')
    const toggleEnd = rendererSource.indexOf('function editProjectScheduledTask', toggleStart)
    const toggleBody = rendererSource.slice(toggleStart, toggleEnd)

    for (const body of [saveBody, removeBody, toggleBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body.indexOf('if (activeSessionIdRef.current !== session.id) return')).toBeLessThan(
        body.indexOf('setProjectTasks(tasks)'),
      )
      expect(body).toContain('await refreshWorkspace(session)')
      expectGuardBetween(
        body,
        activeSessionGuard,
        'await refreshWorkspace(session)',
        'setScheduledTaskStatus({',
      )
    }

    expect(saveBody).toContain('const sessionId = session.id')
    expect(saveBody).toContain('const cwd = session.cwd')
    expect(removeBody).toContain('const actionKey = `${session.id}:project:${removedTaskId}:remove`')
    expect(removeBody).toContain('session.cwd,')
    expect(toggleBody).toContain("`${session.id}:project:${updatedTaskId}:${nextEnabled ? 'resume' : 'pause'}`")
    expect(toggleBody).toContain('window.claudeDesktop.workspaceTasks.resume(session.cwd, updatedTaskId)')
    expect(toggleBody).toContain('window.claudeDesktop.workspaceTasks.pause(session.cwd, updatedTaskId)')
  })

  it('binds project scheduled task async layout writes to the origin session', () => {
    const saveStart = rendererSource.indexOf('async function saveProjectScheduledTask')
    const saveEnd = rendererSource.indexOf('async function removeProjectScheduledTask', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const removeStart = rendererSource.indexOf('async function removeProjectScheduledTask')
    const removeEnd = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const toggleStart = rendererSource.indexOf('async function toggleProjectScheduledTaskEnabled')
    const toggleEnd = rendererSource.indexOf('function editProjectScheduledTask', toggleStart)
    const toggleBody = rendererSource.slice(toggleStart, toggleEnd)

    expect(saveBody).toContain('await updateSessionLayout(session.id, { selectedProjectTaskId: savedTask?.id })')
    expect(removeBody).toContain('await updateSessionLayout(session.id, { selectedProjectTaskId: undefined })')
    expect(toggleBody).toContain('await updateSessionLayout(session.id, { selectedProjectTaskId: updatedTaskId })')

    for (const body of [saveBody, removeBody, toggleBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).not.toContain('await updateLayout({ selectedProjectTaskId:')
    }
  })

  it('guards scheduled task run-now feedback against stale session writes', () => {
    const globalStart = rendererSource.indexOf('async function runScheduledTaskNow')
    const globalEnd = rendererSource.indexOf('async function saveProjectScheduledTask', globalStart)
    const globalBody = rendererSource.slice(globalStart, globalEnd)
    const projectStart = rendererSource.indexOf('async function runProjectScheduledTaskNow')
    const projectEnd = rendererSource.indexOf('function renderProjectScheduledTasksSection', projectStart)
    const projectBody = rendererSource.slice(projectStart, projectEnd)

    for (const body of [globalBody, projectBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('const sessionId = session.id')
    }

    expect(globalBody).toContain('await window.claudeDesktop.sessions.send(sessionId, queuedPrompt)')
    expectGuardBetween(
      globalBody,
      activeSessionGuard,
      'await window.claudeDesktop.sessions.send(sessionId, queuedPrompt)',
      'setScheduledTaskStatus({ kind: \'success\'',
    )
    expect(projectBody).toContain('await window.claudeDesktop.sessions.send(sessionId, queuedProjectPrompt)')
    expectGuardBetween(
      projectBody,
      activeSessionGuard,
      'await window.claudeDesktop.sessions.send(sessionId, queuedProjectPrompt)',
      'setScheduledTaskStatus({ kind: \'success\'',
    )
  })

  it('binds global scheduled task async layout writes to the origin session', () => {
    const saveStart = rendererSource.indexOf('async function saveScheduledTask')
    const saveEnd = rendererSource.indexOf('async function removeScheduledTask', saveStart)
    const saveBody = rendererSource.slice(saveStart, saveEnd)
    const removeStart = rendererSource.indexOf('async function removeScheduledTask')
    const removeEnd = rendererSource.indexOf('async function toggleScheduledTaskEnabled', removeStart)
    const removeBody = rendererSource.slice(removeStart, removeEnd)
    const toggleStart = rendererSource.indexOf('async function toggleScheduledTaskEnabled')
    const toggleEnd = rendererSource.indexOf('function editScheduledTask', toggleStart)
    const toggleBody = rendererSource.slice(toggleStart, toggleEnd)

    for (const body of [saveBody, removeBody, toggleBody]) {
      expect(body).toContain('const session = activeSession')
      expect(body).toContain('if (session) await updateSessionLayout(session.id,')
      expect(body).not.toContain('await updateLayout({ selectedGlobalTaskId:')
    }
    expect(removeBody.indexOf('const session = activeSession')).toBeLessThan(
      removeBody.indexOf('requestConfirmation({'),
    )
  })

  it('routes scheduled task async feedback to the origin lifecycle surface', () => {
    expect(rendererSource).toContain("type ScheduledTaskStatusTarget = 'tasks' | 'settings'")
    expect(rendererSource).toContain('function currentScheduledTaskStatusTarget(): ScheduledTaskStatusTarget')
    expect(rendererSource).toContain(
      'function setScheduledTaskStatus(status: PaneStatus, target: ScheduledTaskStatusTarget = currentScheduledTaskStatusTarget())',
    )

    const functionNames = [
      'saveScheduledTask',
      'toggleScheduledTaskEnabled',
      'runScheduledTaskNow',
      'saveProjectScheduledTask',
      'toggleProjectScheduledTaskEnabled',
      'runProjectScheduledTaskNow',
    ]

    for (const functionName of functionNames) {
      const start = rendererSource.indexOf(`async function ${functionName}`)
      const nextFunction = rendererSource.indexOf('\n  async function ', start + 1)
      const nextPlainFunction = rendererSource.indexOf('\n  function ', start + 1)
      const endCandidates = [nextFunction, nextPlainFunction].filter(index => index > start)
      const end = Math.min(...endCandidates)
      const body = rendererSource.slice(start, end)

      expect(body).toContain('const statusTarget = currentScheduledTaskStatusTarget()')
      expect(body).toContain('setScheduledTaskStatus({')
      expect(body).toContain('}, statusTarget)')
    }
  })
})
