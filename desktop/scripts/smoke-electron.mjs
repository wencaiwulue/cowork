import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  classifyRendererShellState,
  collectElectronStartupDiagnostics,
} from './smokeDiagnostics.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

process.on('unhandledRejection', cause => {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (
    message.includes('Page.handleJavaScriptDialog') &&
    message.includes('No dialog is showing')
  ) {
    return
  }
  throw cause
})

const DESKTOP_SHORTCUT_MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control'

function desktopShortcut(key, options = {}) {
  return `${DESKTOP_SHORTCUT_MODIFIER}${options.shift ? '+Shift' : ''}+${key}`
}

function commitWorkspaceBaseline(cwd, message) {
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
  })
  if (!status.trim()) return
  execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', message], { cwd, stdio: 'ignore' })
}

async function setupWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'claude-desktop-e2e-'))
  await mkdir(join(cwd, 'src'), { recursive: true })
  await mkdir(join(cwd, '.claude/commands'), { recursive: true })
  await mkdir(join(cwd, '.claude/teams/frontend'), { recursive: true })
  await writeFile(join(cwd, 'src', 'app.txt'), 'hello\n')
  await writeFile(join(cwd, 'src', 'notes.txt'), 'notes\n')
  await writeFile(join(cwd, 'src', 'binary.bin'), Buffer.from([0x63, 0x00, 0x64]))
  await writeFile(
    join(cwd, '.claude/commands/desktop-smoke.md'),
    '---\ndescription: Run the desktop smoke custom command\n---\n\nUse the local desktop smoke command.\n',
  )
  await writeFile(join(cwd, '.claude/teams/frontend/config.json'), JSON.stringify({
    name: 'frontend',
    description: 'Desktop smoke team',
    backend: 'local',
    mode: 'parallel',
    status: 'running',
    active: true,
    members: [{
      agentId: 'alice@frontend',
      name: 'alice',
      color: 'blue',
      mode: 'plan',
      status: 'active',
    }],
  }, null, 2))
  await writeFile(
    join(cwd, 'this-is-a-deliberately-long-file-name-used-to-check-file-tree-overflow-in-narrow-desktop-panes.txt'),
    'long path smoke\n',
  )
  execFileSync('git', ['init'], { cwd, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'desktop-smoke@example.com'], {
    cwd,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Desktop Smoke'], {
    cwd,
    stdio: 'ignore',
  })
  execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd, stdio: 'ignore' })
  return cwd
}

async function setupPlainWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'claude-desktop-e2e-second-'))
  await writeFile(join(cwd, 'README.md'), '# second\n')
  return cwd
}

async function setupEmptyWorkspace() {
  return mkdtemp(join(tmpdir(), 'claude-desktop-e2e-empty-'))
}

async function setupFailureWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'claude-desktop-e2e-failure-'))
  await writeFile(join(cwd, 'README.md'), '# failure\n')
  return cwd
}

async function setupTerminalFailureWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'claude-desktop-e2e-terminal-failure-'))
  await writeFile(join(cwd, 'README.md'), '# terminal failure\n')
  return cwd
}

async function setupTerminalCloseWorkspace() {
  const cwd = await mkdtemp(join(tmpdir(), 'claude-desktop-e2e-terminal-close-'))
  await writeFile(join(cwd, 'README.md'), '# terminal close\n')
  return cwd
}

async function setupRailWorkspaces(count) {
  const workspaces = []
  for (let index = 0; index < count; index += 1) {
    const cwd = await mkdtemp(join(tmpdir(), `claude-desktop-e2e-rail-${String(index).padStart(2, '0')}-`))
    await writeFile(join(cwd, 'README.md'), `# rail ${index}\n`)
    workspaces.push(cwd)
  }
  return workspaces
}

async function setupClaudeHome() {
  const home = await mkdtemp(join(tmpdir(), 'claude-desktop-home-'))
  await mkdir(join(home, 'skills/existing-skill'), { recursive: true })
  await mkdir(join(home, 'plugins'), { recursive: true })
  await writeFile(join(home, 'settings.json'), JSON.stringify({
    env: {
      ANTHROPIC_AUTH_TOKEN: 'desktop-smoke-secret-token',
      ANTHROPIC_BASE_URL: 'https://example.invalid/anthropic',
    },
  }, null, 2))
  await writeFile(join(home, '.mcp.json'), JSON.stringify({
    mcpServers: {
      playwright: { command: 'npx', args: ['@playwright/mcp@latest', '--headless'] },
      remote: { type: 'streamable-http', url: 'https://mcp.example.invalid/server?key=secret' },
    },
  }, null, 2))
  await writeFile(join(home, 'scheduled_tasks.json'), JSON.stringify({
    tasks: [{ id: 'task-1', prompt: 'desktop smoke scheduled task' }],
  }, null, 2))
  await mkdir(join(home, 'teams/frontend'), { recursive: true })
  await writeFile(join(home, 'teams/frontend/config.json'), JSON.stringify({
    name: 'frontend',
    description: 'Desktop smoke team',
    backend: 'local',
    mode: 'parallel',
    status: 'running',
    active: true,
    members: [{
      agentId: 'alice@frontend',
      name: 'alice',
      color: 'blue',
      mode: 'plan',
      status: 'active',
    }],
  }, null, 2))
  await writeFile(
    join(home, 'skills/existing-skill/SKILL.md'),
    '---\ndescription: Existing smoke skill\n---\n',
  )
  await writeFile(join(home, 'plugins/installed_plugins.json'), JSON.stringify({
    plugins: {
      'superpowers@claude-plugins-official': [{
        scope: 'user',
        version: '1.0.0',
        installPath: '/tmp/superpowers',
      }],
      'desktop-smoke-project-plugin': [{
        scope: 'project',
        version: '1.0.0',
        installPath: '/tmp/desktop-smoke-project-plugin',
      }],
      'desktop-smoke-local-plugin': [{
        scope: 'local',
        version: '1.0.0',
        installPath: '/tmp/desktop-smoke-local-plugin',
      }],
    },
  }, null, 2))
  return home
}

async function setupInstallableSkill() {
  const dir = await mkdtemp(join(tmpdir(), 'installable-skill-'))
  await writeFile(
    join(dir, 'SKILL.md'),
    '---\ndescription: Installed through desktop GUI\n---\n\nSmoke inspect body.\n',
  )
  return dir
}

async function setupFakeRuntime() {
  const dir = await mkdtemp(join(tmpdir(), 'claude-desktop-runtime-'))
  const runtime = join(dir, 'fake-runtime.mjs')
  const pluginLog = join(dir, 'plugin-commands.log')
  const mcpLog = join(dir, 'mcp-commands.log')
  await writeFile('/tmp/desktop-smoke-agent-output.txt', 'desktop smoke agent output preview\n')
  await writeFile(
    runtime,
    `#!/usr/bin/env node
import readline from 'node:readline'
import { appendFileSync, existsSync } from 'node:fs'
if (process.argv.includes('mcp') && process.argv.includes('list')) {
  appendFileSync(${JSON.stringify(mcpLog)}, 'list\\n')
  console.log('desktop-smoke-mcp-health ok')
  process.exit(0)
}
if (process.argv.includes('plugin') && process.argv.includes('list')) {
  appendFileSync(${JSON.stringify(pluginLog)}, 'list\\n')
  console.log(JSON.stringify({ installed: [], available: [{ id: 'desktop-smoke-plugin' }] }))
  process.exit(0)
}
if (process.argv.includes('plugin') && process.argv.includes('install')) {
  const plugin = process.argv[process.argv.indexOf('install') + 1]
  appendFileSync(${JSON.stringify(pluginLog)}, 'install ' + plugin + '\\n')
  if (plugin === 'desktop-smoke-plugin-fail') {
    console.error('plugin install smoke failure')
    process.exit(7)
  }
  console.log('installed plugin ' + plugin)
  process.exit(0)
}
if (process.argv.includes('agents') && process.argv.includes('--json')) {
  if (process.env.CLAUDE_CODE_DESKTOP_AGENT_CLI_FAIL_FLAG && existsSync(process.env.CLAUDE_CODE_DESKTOP_AGENT_CLI_FAIL_FLAG)) {
    console.log(JSON.stringify({
      activeAgents: [],
      allAgents: [],
      failedFiles: [{ path: '.claude/agents/unreadable-smoke-agent.md', error: 'desktop smoke parse failure' }],
    }))
    process.exit(0)
  }
  console.log(JSON.stringify({
    activeAgents: [{
      agentType: 'desktop-smoke-agent',
      source: 'built-in',
      sourceLabel: 'Built-in agents',
      whenToUse: 'Use for desktop smoke tests.',
      active: true,
      tools: ['Read'],
      skills: ['missing-smoke-skill'],
      requiredMcpServers: ['missing-smoke-mcp'],
      model: 'inherit',
      baseDir: 'built-in',
    }],
    allAgents: [
      {
        agentType: 'desktop-smoke-agent',
        source: 'built-in',
        sourceLabel: 'Built-in agents',
        whenToUse: 'Use for desktop smoke tests.',
        active: true,
        tools: ['Read'],
        skills: ['missing-smoke-skill'],
        requiredMcpServers: ['missing-smoke-mcp'],
        model: 'inherit',
        baseDir: 'built-in',
      },
      {
        agentType: 'desktop-project-agent',
        source: 'projectSettings',
        sourceLabel: 'Project agents',
        whenToUse: 'Use for project-only catalog filtering.',
        active: false,
        tools: ['Read', 'Edit'],
        model: 'sonnet',
        baseDir: '.claude/agents',
      },
    ],
  }))
  process.exit(0)
}
const rl = readline.createInterface({ input: process.stdin })
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: process.argv.at(-1) }))
rl.on('line', line => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.type === 'user') {
    const text = msg.message?.content ?? ''
    if (String(text).includes('runtime failure desktop')) {
      console.error('desktop runtime smoke failure')
      process.exit(42)
    }
    console.log(JSON.stringify({
      type: 'stream_event',
      uuid: 'thinking-stream-' + Date.now(),
      session_id: msg.session_id,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'checking workspace context' } }
    }))
    setTimeout(() => console.log(JSON.stringify({
      type: 'stream_event',
      uuid: 'tool-stream-' + Date.now(),
      session_id: msg.session_id,
      event: {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'tool_use',
          id: 'toolu-stream-smoke',
          name: 'Bash',
          input: { command: 'printf desktop-stream-tool' }
        }
      }
    })), 5)
    setTimeout(() => console.log(JSON.stringify({
      type: 'stream_event',
      uuid: 'todo-stream-' + Date.now(),
      session_id: msg.session_id,
      event: {
        type: 'content_block_start',
        index: 3,
        content_block: {
          type: 'tool_use',
          id: 'toolu-todo-smoke',
          name: 'TodoWrite',
          input: {
            todos: [
              { id: 'todo-smoke-1', content: 'Inspect desktop smoke workflow', status: 'in_progress', priority: 'high' },
              { id: 'todo-smoke-2', content: 'Verify activity panel', status: 'pending', priority: 'medium' }
            ]
          }
        }
      }
    })), 8)
    setTimeout(() => console.log(JSON.stringify({
      type: 'stream_event',
      uuid: 'stream-1-' + Date.now(),
      session_id: msg.session_id,
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'streaming ' } }
    })), 10)
    setTimeout(() => console.log(JSON.stringify({
      type: 'stream_event',
      uuid: 'stream-2-' + Date.now(),
      session_id: msg.session_id,
      event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'desktop response' } }
    })), 20)
    setTimeout(() => console.log(JSON.stringify({
      type: 'stream_event',
      uuid: 'thinking-stream-late-' + Date.now(),
      session_id: msg.session_id,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' after answer draft' } }
    })), 30)
    setTimeout(() => {
      if (
        String(text).includes('scheduled desktop automatic prompt') ||
        String(text).includes('global desktop run now prompt') ||
        String(text).includes('project native cron prompt') ||
        String(text).includes('global desktop automatic prompt')
      ) {
        const response = String(text).includes('global desktop run now prompt')
          ? 'global scheduled task ran now'
          : String(text).includes('project native cron prompt')
            ? 'project scheduled task ran now'
            : String(text).includes('global desktop automatic prompt')
              ? 'global scheduled task fired automatically'
              : 'project scheduled task fired automatically'
        console.log(JSON.stringify({
          type: 'assistant',
          uuid: 'scheduled-assistant-' + Date.now(),
          session_id: msg.session_id,
          message: { content: [{ type: 'text', text: response }] }
        }))
        console.log(JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'scheduled task complete',
          session_id: msg.session_id
        }))
        return
      }
    if (String(text).includes('"subagent_type": "desktop-smoke-agent"')) {
      console.log(JSON.stringify({
        type: 'assistant',
        uuid: 'agent-tool-use-' + Date.now(),
        session_id: msg.session_id,
        message: {
          content: [{
            type: 'tool_use',
            id: 'toolu-agent-smoke',
            name: 'Agent',
            input: {
              subagent_type: 'desktop-smoke-agent',
              description: 'desktop smoke agent task',
              prompt: 'inspect agent gui smoke path',
              run_in_background: true,
            },
          }],
        },
      }))
      console.log(JSON.stringify({
        type: 'user',
        uuid: 'agent-tool-result-' + Date.now(),
        session_id: msg.session_id,
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'toolu-agent-smoke',
            content: JSON.stringify({
              status: 'async_launched',
              agentId: 'agent-smoke-1',
              subagent_type: 'desktop-smoke-agent',
              description: 'desktop smoke agent task',
              outputFile: '/tmp/desktop-smoke-agent-output.txt',
              totalTokens: 321,
              totalDurationMs: 1200,
            }),
          }],
        },
      }))
      console.log(JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'agent task launched',
        session_id: msg.session_id
      }))
      return
    }
    if (
      String(text).includes('Use the TaskOutput tool exactly once') ||
      String(text).includes('Use the TaskStop tool exactly once') ||
      String(text).includes('Use this to continue or resume the selected agent task') ||
      String(text).includes('Use the TeamCreate tool exactly once') ||
      String(text).includes('Use the TeamDelete tool exactly once') ||
      String(text).includes('Send this message within team "') ||
      String(text).includes('Request a graceful shutdown for "')
    ) {
      console.log(JSON.stringify({
        type: 'assistant',
        uuid: 'control-assistant-' + Date.now(),
        session_id: msg.session_id,
        message: { content: [{ type: 'text', text: 'desktop control request accepted' }] }
      }))
      console.log(JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'desktop control complete',
        session_id: msg.session_id
      }))
      return
    }
    console.log(JSON.stringify({
      type: 'assistant',
      uuid: 'assistant-' + Date.now(),
      session_id: msg.session_id,
      message: {
        content: [{
          type: 'text',
          text: [
            '## fake desktop response',
            '',
            '- proxy=' + (process.env.ALL_PROXY || 'none'),
            '- long-token=\`desktop_smoke_' + 'x'.repeat(160) + '\`',
            '',
            '\`\`\`ts',
            'const desktopSmoke = true',
            '\`\`\`',
            '',
            '[desktop docs](https://example.com/desktop)',
          ].join('\\n'),
        }],
      }
    }))
    console.log(JSON.stringify({
      type: 'control_request',
      uuid: 'permission-' + Date.now(),
      session_id: msg.session_id,
      request_id: 'permission-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        display_name: 'Shell command',
        description: 'Run printf for desktop smoke',
        input: { command: 'printf permission-ok' },
        tool_use_id: 'toolu-smoke-1',
        agent_context: {
          agent_type: 'desktop-smoke-agent',
          agent_id: 'agent-smoke-1',
          description: 'desktop smoke agent task'
        },
        team_context: {
          team_name: 'frontend',
          teammate_name: 'alice',
          mode: 'plan'
        },
        permission_suggestions: [{
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'printf permission-ok' }],
          behavior: 'allow',
          destination: 'session'
        }]
      }
    }))
    if (String(text).includes('hello desktop')) {
      console.log(JSON.stringify({
        type: 'control_request',
        uuid: 'permission-second-' + Date.now(),
        session_id: msg.session_id,
        request_id: 'permission-2',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          display_name: 'Shell command',
          description: 'Run queued printf for desktop smoke',
          input: { command: 'printf permission-queued-ok' },
          tool_use_id: 'toolu-smoke-2',
          permission_suggestions: [{
            type: 'addRules',
            rules: [{ toolName: 'Bash', ruleContent: 'printf permission-queued-ok' }],
            behavior: 'allow',
            destination: 'session'
          }]
        }
      }))
    }
    console.log(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'fake desktop response',
      session_id: msg.session_id
    }))
    }, 500)
  }
  if (msg.type === 'control_response') {
    const behavior = msg.response?.response?.behavior ?? 'unknown'
    const toolUseID = msg.response?.response?.toolUseID ?? 'missing-tool-use'
    const command = msg.response?.response?.updatedInput?.command ?? 'missing-command'
    setTimeout(() => {
      console.log(JSON.stringify({
        type: 'assistant',
        uuid: 'permission-response-' + Date.now(),
        message: { content: [{ type: 'text', text: 'permission ' + behavior + ' received for ' + toolUseID + ' ' + command }] }
      }))
    }, 800)
  }
  if (msg.type === 'control_request') {
    console.log(JSON.stringify({ type: 'control_cancel_request', request_id: msg.request_id }))
    if (msg.request?.subtype === 'interrupt') {
      console.log(JSON.stringify({
        type: 'assistant',
        uuid: 'interrupt-response-' + Date.now(),
        message: { content: [{ type: 'text', text: 'interrupt received by desktop smoke runtime' }] }
      }))
    }
  }
})
`,
    { mode: 0o755 },
  )
  return { runtime, pluginLog, mcpLog }
}

async function waitFor(page, predicate, timeout = 10_000, ...args) {
  const start = Date.now()
  let lastResult
  while (Date.now() - start < timeout) {
    const result = await page.evaluate(predicate, ...args)
    lastResult = result
    if (result && typeof result === 'object' && 'ready' in result) {
      if (result.ready) return result
      await page.waitForTimeout(100)
      continue
    }
    if (result) return result
    await page.waitForTimeout(100)
  }
  throw new Error(`Timed out waiting for condition${lastResult === undefined ? '' : `: ${JSON.stringify(lastResult)}`}`)
}

async function waitForApp(app, predicate, timeout = 10_000, ...args) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const result = await app.evaluate(predicate, ...args)
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for Electron app condition')
}

async function waitForActiveSessionId(page, sessionId) {
  return waitFor(page, expectedSessionId =>
    window.claudeDesktop.sessions
      .list()
      .then(sessions => sessions[0]?.id === expectedSessionId),
  10_000, sessionId)
}

async function focusSmokeSession(page, sessionId) {
  await withTimeout(
    page.evaluate(async expectedSessionId => {
      window.__claudeDesktopSmokeDiscardEditorChanges?.()
      await window.claudeDesktop.app.setUnsavedChanges(false)
      if (typeof window.__claudeDesktopSmokeFocusSession === 'function') {
        await window.__claudeDesktopSmokeFocusSession(expectedSessionId)
        return
      }
      await window.claudeDesktop.sessions.focus(expectedSessionId)
    }, sessionId),
    20_000,
    `renderer focus session ${sessionId}`,
  )
  const mainFocused = await waitForActiveSessionId(page, sessionId)
    .then(() => true, () => false)
  if (!mainFocused) {
    await page.evaluate(
      expectedSessionId => window.claudeDesktop.sessions.focus(expectedSessionId),
      sessionId,
    )
  }
  try {
    await waitForActiveSessionId(page, sessionId)
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'focus-smoke-session-timeout',
      expectedSessionId: sessionId,
      state: await page.evaluate(async () => {
        const sessions = await window.claudeDesktop.sessions.list()
        return {
          activeRow: document.querySelector('.session-row.active')?.textContent ?? '',
          sessions: sessions.slice(0, 5).map(session => ({
            id: session.id,
            title: session.title,
            cwd: session.cwd,
            status: session.status,
          })),
          confirmation: document.querySelector('.confirmation-modal')?.textContent ?? '',
        }
      }),
    }, null, 2))
    throw cause
  }
}

async function focusSmokeSessionDirect(page, sessionId) {
  await page.evaluate(
    expectedSessionId => window.claudeDesktop.sessions.focus(expectedSessionId),
    sessionId,
  )
  await waitForActiveSessionId(page, sessionId)
}

async function waitForFile(path, predicate, timeout = 10_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const contents = await readFile(path, 'utf8')
      if (predicate(contents)) return contents
    } catch {
      // File may not exist until the renderer save action reaches main.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for file: ${path}`)
}

async function countPluginCommands(kind) {
  try {
    const contents = await readFile(fakeRuntime.pluginLog, 'utf8')
    return contents
      .split('\n')
      .filter(line => line.startsWith(kind))
      .length
  } catch {
    return 0
  }
}

async function countMcpCommands(kind) {
  try {
    const contents = await readFile(fakeRuntime.mcpLog, 'utf8')
    return contents
      .split('\n')
      .filter(line => line.startsWith(kind))
      .length
  } catch {
    return 0
  }
}

async function waitForMcpCommandCount(kind, expected, message) {
  const start = Date.now()
  let lastCount = 0
  while (Date.now() - start < 10_000) {
    lastCount = await countMcpCommands(kind)
    if (lastCount >= expected) return lastCount
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${message}: expected at least ${expected}, saw ${lastCount}`)
}

const cwd = await setupWorkspace()
const primarySessionTitle = cwd.split('/').at(-1)
assert(primarySessionTitle, 'primary session title was not derived from workspace path')
const secondCwd = await setupPlainWorkspace()
const emptyCwd = await setupEmptyWorkspace()
const menuOpenCwd = await setupPlainWorkspace()
const failureCwd = await setupFailureWorkspace()
const terminalFailureCwd = await setupTerminalFailureWorkspace()
const terminalCloseCwd = await setupTerminalCloseWorkspace()
const missingEditorCwd = await setupWorkspace(`claude-desktop-e2e-missing-editor-${randomUUID().slice(0, 8)}`)
const diffRestoreCwd = await setupWorkspace(`claude-desktop-e2e-diff-restore-${randomUUID().slice(0, 8)}`)
const agentRestoreCwd = await setupPlainWorkspace()
const teammateRestoreCwd = await setupWorkspace(`claude-desktop-e2e-teammate-restore-${randomUUID().slice(0, 8)}`)
const settingsRestoreCwd = await setupPlainWorkspace()
const tasksRestoreCwd = await setupPlainWorkspace()
await mkdir(join(tasksRestoreCwd, '.claude'), { recursive: true })
await writeFile(join(tasksRestoreCwd, '.claude/scheduled_tasks.json'), JSON.stringify({
  tasks: [{
    id: 'project-restore-task',
    cron: '0 10 * * *',
    prompt: 'project restore prompt',
    createdAt: Date.now(),
  }],
}, null, 2))
const railWorkspaces = await setupRailWorkspaces(12)
const fakeRuntime = await setupFakeRuntime()
const claudeHome = await setupClaudeHome()
const installableSkill = await setupInstallableSkill()
const storeDir = await mkdtemp(join(tmpdir(), 'claude-desktop-store-'))
const storePath = join(storeDir, 'sessions.json')
const userDataDir = await mkdtemp(join(tmpdir(), 'claude-desktop-user-data-'))
const defaultWorkspaceCwd = join(homedir(), '.claude', 'desktop-workspace')
const executablePath = process.env.DESKTOP_SMOKE_EXECUTABLE_PATH || electronPath
const launchArgs = process.env.DESKTOP_SMOKE_EXECUTABLE_PATH
  ? []
  : ['desktop/dist/main/main.js']
const deepLinkArgs = process.env.DESKTOP_SMOKE_EXECUTABLE_PATH
  ? url => [url]
  : url => ['desktop/dist/main/main.js', url]
const logProgress = process.env.DESKTOP_SMOKE_PROGRESS === '1'
const screenshotDir = process.env.DESKTOP_SMOKE_SCREENSHOT_DIR

function progress(message) {
  if (logProgress) console.error(`[desktop-smoke] ${message}`)
}

async function withTimeout(promise, timeoutMs, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function diagnoseElectronStartup(app, phase) {
  try {
    return await withTimeout(
      app.evaluate(collectElectronStartupDiagnostics, phase),
      5_000,
      `${phase} diagnostics`,
    )
  } catch (cause) {
    return {
      phase,
      diagnosticsError: cause instanceof Error ? cause.message : String(cause),
    }
  }
}

async function waitForFirstWindow(app, label) {
  try {
    const page = await withTimeout(app.firstWindow(), 20_000, label)
    await withTimeout(
      page.waitForLoadState('domcontentloaded'),
      20_000,
      `${label} domcontentloaded`,
    )
    await withTimeout(
      page.waitForFunction(() => {
        const bodyText = document.body.textContent ?? ''
        return Boolean(document.querySelector('.desktop-shell')) ||
          /\/assets\/.*\.(?:js|css)(?:$|[?#])/.test(window.location.href) ||
          /^\s*(?:function|import|export|\.|:root|body\s*\{)/.test(bodyText) ||
          bodyText.includes('className:"desktop-shell"') ||
          bodyText.includes('.desktop-shell{')
      }),
      20_000,
      `${label} renderer shell`,
    )
    const rendererState = await page.evaluate(() => {
      const url = window.location.href
      const bodyText = document.body.textContent ?? ''
      return {
        url,
        hasRoot: Boolean(document.querySelector('#root')),
        hasShell: Boolean(document.querySelector('.desktop-shell')),
        rootChildCount: document.querySelector('#root')?.childElementCount ?? 0,
        bodyText,
        bodySample: bodyText.slice(0, 160),
      }
    })
    const shellState = classifyRendererShellState(rendererState)
    assert(
      shellState.ok,
      `${label} did not render the desktop shell (${shellState.reason}): ${JSON.stringify(rendererState)}`,
    )
    return page
  } catch (cause) {
    const diagnostics = await diagnoseElectronStartup(app, label)
    console.log(JSON.stringify(diagnostics, null, 2))
    if (cause && typeof cause === 'object') {
      cause.startupDiagnostics = diagnostics
    }
    throw cause
  }
}

async function capture(page, name) {
  if (!screenshotDir) return
  await mkdir(screenshotDir, { recursive: true })
  await page.screenshot({ path: join(screenshotDir, `${name}.png`) })
}

async function installSmokeEventHook(page) {
  await page.evaluate(() => {
    window.__claudeDesktopDisposeSmokeEvents?.()
    const events = []
    window.__claudeDesktopSmokeEvents = events
    window.__claudeDesktopDisposeSmokeEvents = window.claudeDesktop.onEvent(event => events.push(event))
  })
}

async function assertChatCopyControls(page, app) {
  const assistantMessage = page
    .locator('.message-assistant')
    .filter({ hasText: 'fake desktop response' })
    .last()
  await assistantMessage.locator('button[aria-label="Copy message"]').click()
  await waitFor(page, () => {
    return Boolean(
      [...document.querySelectorAll('.message-assistant')]
        .find(message => (message.textContent ?? '').includes('fake desktop response'))
        ?.querySelector('button[aria-label="Copied message"]'),
    )
  })
  await waitFor(page, () => {
    return Boolean(
      [...document.querySelectorAll('.message-assistant')]
        .find(message => (message.textContent ?? '').includes('fake desktop response'))
        ?.querySelector('button[aria-label="Copied message"] .glyph[data-icon="check"]'),
    )
  })
  const copiedMessage = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert(
    copiedMessage.includes('## fake desktop response') &&
      copiedMessage.includes('proxy=socks5://127.0.0.1:18999') &&
      copiedMessage.includes('```ts\nconst desktopSmoke = true\n```'),
    'assistant copy button did not write the full markdown message to the clipboard',
  )
  await assistantMessage.locator('button[aria-label="Copy code"]').click()
  await waitFor(page, () => {
    return Boolean(
      [...document.querySelectorAll('.message-assistant')]
        .find(message => (message.textContent ?? '').includes('fake desktop response'))
        ?.querySelector('button[aria-label="Copied code"]'),
    )
  })
  await waitFor(page, () => {
    return Boolean(
      [...document.querySelectorAll('.message-assistant')]
        .find(message => (message.textContent ?? '').includes('fake desktop response'))
        ?.querySelector('button[aria-label="Copied code"] .glyph[data-icon="check"]'),
    )
  })
  const copiedCode = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert(
    copiedCode === 'const desktopSmoke = true',
    `assistant code copy button wrote unexpected clipboard text: ${JSON.stringify(copiedCode)}`,
  )
}

async function assertMenuCreatesSession(
  app,
  page,
  menuItemId,
  selectedCwd,
  expectedDialogCalls = 1,
) {
  const menuSession = await app.evaluate(async ({ BrowserWindow, Menu, dialog }, { itemId, cwd: pickedCwd }) => {
    const originalShowOpenDialog = dialog.showOpenDialog
    let dialogCalls = 0
    dialog.showOpenDialog = async () => {
      dialogCalls += 1
      await new Promise(resolve => setTimeout(resolve, 100))
      return {
        canceled: false,
        filePaths: [pickedCwd],
        bookmarks: [],
      }
    }
    try {
      const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
      const window = BrowserWindow.getAllWindows()[0]
      if (!item || !window) return { ok: false, reason: 'missing menu item or window' }
      item.click(undefined, window, undefined)
      item.click(undefined, window, undefined)
      await new Promise(resolve => setTimeout(resolve, 20))
      return { ok: true, dialogCalls }
    } finally {
      dialog.showOpenDialog = originalShowOpenDialog
    }
  }, { itemId: menuItemId, cwd: selectedCwd })
  assert(menuSession.ok, `${menuItemId} menu item did not run: ${JSON.stringify(menuSession)}`)
  assert(
    menuSession.dialogCalls === expectedDialogCalls,
    `${menuItemId} rapid menu action opened ${menuSession.dialogCalls} project pickers`,
  )
  await waitFor(page, expectedCwd => {
    return window.claudeDesktop.sessions.list().then(sessions =>
      sessions.some(session => session.cwd === expectedCwd),
    )
  }, 10_000, selectedCwd)
  await waitFor(page, expectedTitle => {
    const text = document.querySelector('.session-list')?.textContent ?? ''
    return text.includes(expectedTitle)
  }, 10_000, selectedCwd.split('/').at(-1))
  await page.evaluate(async expectedCwd => {
    const sessions = await window.claudeDesktop.sessions.list()
    const session = sessions.find(item => item.cwd === expectedCwd)
    if (!session) throw new Error(`Missing menu-created session for ${expectedCwd}`)
    await window.claudeDesktop.sessions.close(session.id)
  }, selectedCwd)
  await waitFor(page, expectedCwd => {
    return window.claudeDesktop.sessions.list().then(sessions =>
      sessions.every(session => session.cwd !== expectedCwd),
    )
  }, 10_000, selectedCwd)
}

async function clickApplicationMenuItem(app, itemId) {
  const result = await app.evaluate(({ BrowserWindow, Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id)
    const window = BrowserWindow.getAllWindows()[0]
    if (!item || !window) return { ok: false }
    item.click(undefined, window, undefined)
    return { ok: true }
  }, itemId)
  assert(result.ok, `${itemId} menu item did not run`)
}

async function assertNoHorizontalOverflow(page, selector, label) {
  const result = await page.evaluate(targetSelector => {
    const element = document.querySelector(targetSelector)
    if (!element) return { ok: false, reason: 'missing target' }
    const targetRect = element.getBoundingClientRect()
    const offenders = [...element.querySelectorAll('*')]
      .filter(child => {
        if (child.closest('.pane-jumpbar')) return false
        const rect = child.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        return rect.left < targetRect.left - 1 || rect.right > targetRect.right + 1
      })
      .slice(0, 5)
      .map(child => ({
        tag: child.tagName.toLowerCase(),
        className: typeof child.className === 'string' ? child.className : '',
        text: child.textContent?.trim().slice(0, 120) ?? '',
        left: Math.round(child.getBoundingClientRect().left - targetRect.left),
        right: Math.round(child.getBoundingClientRect().right - targetRect.right),
      }))
    return {
      ok: element.scrollWidth <= element.clientWidth + 1 && offenders.length === 0,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      offenders,
    }
  }, selector)
  assert(result.ok, `${label} has horizontal overflow: ${JSON.stringify(result)}`)
}

async function assertJumpbarNoHorizontalOverflow(page, selector, label) {
  const result = await page.evaluate(targetSelector => {
    const jumpbar = document.querySelector(`${targetSelector} .pane-jumpbar`)
    if (!(jumpbar instanceof HTMLElement)) return { ok: false, reason: 'missing jumpbar' }
    const buttons = [...jumpbar.querySelectorAll('button')]
    const backgroundColor = getComputedStyle(jumpbar).backgroundColor
    const alphaMatch = backgroundColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)/)
    const alpha = alphaMatch ? Number.parseFloat(alphaMatch[1] ?? '0') : 1
    return {
      ok: jumpbar.scrollWidth <= jumpbar.clientWidth + 1 &&
        buttons.length > 0 &&
        buttons.every(button => button.scrollWidth <= button.clientWidth + 1) &&
        alpha >= 0.94,
      scrollWidth: jumpbar.scrollWidth,
      clientWidth: jumpbar.clientWidth,
      backgroundColor,
      clippedButtons: buttons
        .filter(button => button.scrollWidth > button.clientWidth + 1)
        .map(button => button.textContent?.trim() ?? ''),
    }
  }, selector)
  assert(result.ok, `${label} jumpbar has horizontal overflow: ${JSON.stringify(result)}`)
}

async function assertNoScrollableInlineOverflow(page, selector, label) {
  const result = await page.evaluate(targetSelector => {
    const elements = [...document.querySelectorAll(targetSelector)]
    const offenders = elements
      .filter(element => element.scrollWidth > element.clientWidth + 1)
      .slice(0, 5)
      .map(element => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : '',
        text: element.textContent?.trim().slice(0, 120) ?? '',
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }))
    return {
      ok: elements.length > 0 && offenders.length === 0,
      count: elements.length,
      offenders,
    }
  }, selector)
  assert(result.ok, `${label} has scrollable inline overflow: ${JSON.stringify(result)}`)
}

async function assertVisibleButtonLayout(page, label) {
  const result = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.icon-button, .tool-button, .send-button, .pane-tabs button')]
      .filter(button => {
        const rect = button.getBoundingClientRect()
        const style = getComputedStyle(button)
        return rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          !button.closest('.empty-state')
      })
    const offenders = buttons
      .flatMap(button => {
        const rect = button.getBoundingClientRect()
        const className = typeof button.className === 'string' ? button.className : ''
        const text = button.textContent?.trim() ?? ''
        const issues = []
        if (text && button.scrollWidth > button.clientWidth + 1) {
          issues.push('text-overflow')
        }
        if (
          button.classList.contains('icon-button') ||
          (
            button.classList.contains('tool-button') &&
            button.classList.contains('icon-only')
          )
        ) {
          const width = Math.round(rect.width)
          const height = Math.round(rect.height)
          if (width !== 32 || height !== 32) {
            issues.push(`icon-button-size-${width}x${height}`)
          }
        }
        if (button.closest('.pane-tabs')) {
          const height = Math.round(rect.height)
          if (height !== 32) issues.push(`tab-height-${height}`)
        }
        if (button.closest('.pane-toolbar')) {
          const fontSize = Number.parseFloat(getComputedStyle(button).fontSize)
          if (!Number.isFinite(fontSize) || fontSize > 14) {
            issues.push(`pane-toolbar-button-font-${fontSize}`)
          }
        }
        if (
          button.disabled &&
          (
            button.classList.contains('send-button') ||
            button.classList.contains('primary') ||
            button.classList.contains('strong')
          )
        ) {
          const background = getComputedStyle(button).backgroundColor
          if (
            background === 'rgb(200, 111, 69)' ||
            background === 'rgb(169, 87, 53)' ||
            background === 'rgb(180, 71, 75)'
          ) {
            issues.push(`disabled-prominent-background-${background}`)
          }
        }
        const glyph = button.querySelector('.glyph')
        if (glyph) {
          const glyphRect = glyph.getBoundingClientRect()
          const width = Math.round(glyphRect.width)
          const height = Math.round(glyphRect.height)
          if (width !== 16 || height !== 16) {
            issues.push(`glyph-size-${width}x${height}`)
          }
        }
        return issues.length
          ? [{
              className,
              text: text.slice(0, 80),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              scrollWidth: button.scrollWidth,
              clientWidth: button.clientWidth,
              issues,
            }]
          : []
      })
      .slice(0, 8)
    return {
      ok: buttons.length > 0 && offenders.length === 0,
      count: buttons.length,
      offenders,
    }
  })
  assert(result.ok, `${label} button layout is unstable: ${JSON.stringify(result)}`)
}

async function assertPrimaryNavState(page, expectedLabel) {
  const result = await page.evaluate(label => {
    const buttons = [
      ...document.querySelectorAll('.primary-nav button, .rail-footer button'),
    ]
    const current = buttons.filter(button => button.getAttribute('aria-current') === 'page')
    const pressed = buttons.filter(button => button.getAttribute('aria-pressed') === 'true')
    const mismatched = buttons
      .filter(button =>
        button.classList.contains('active') !==
          (button.getAttribute('aria-current') === 'page') ||
        button.classList.contains('active') !==
          (button.getAttribute('aria-pressed') === 'true'),
      )
      .map(button => ({
        text: button.textContent?.trim(),
        className: button.className,
        current: button.getAttribute('aria-current'),
        pressed: button.getAttribute('aria-pressed'),
      }))
    return {
      ok:
        current.length === 1 &&
        pressed.length === 1 &&
        current[0] === pressed[0] &&
        current[0]?.textContent?.includes(label) &&
        mismatched.length === 0,
      current: current.map(button => button.textContent?.trim()),
      pressed: pressed.map(button => button.textContent?.trim()),
      mismatched,
    }
  }, expectedLabel)
  assert(
    result.ok,
    `${expectedLabel} primary nav state is not accessible: ${JSON.stringify(result)}`,
  )
}

async function waitForPrimaryNavState(page, expectedLabel) {
  await waitFor(page, label => {
    const buttons = [
      ...document.querySelectorAll('.primary-nav button, .rail-footer button'),
    ]
    const current = buttons.filter(button => button.getAttribute('aria-current') === 'page')
    const pressed = buttons.filter(button => button.getAttribute('aria-pressed') === 'true')
    return current.length === 1 &&
      pressed.length === 1 &&
      current[0] === pressed[0] &&
      current[0]?.textContent?.includes(label)
  }, 10_000, expectedLabel)
  await assertPrimaryNavState(page, expectedLabel)
}

async function assertWorkspacePaneTabState(page, expectedLabel) {
  const result = await page.evaluate(label => {
    const buttons = [...document.querySelectorAll('.pane-tabs button')]
    const pressed = buttons.filter(button => button.getAttribute('aria-pressed') === 'true')
    const mismatched = buttons
      .filter(button =>
        button.classList.contains('active') !==
          (button.getAttribute('aria-pressed') === 'true'),
      )
      .map(button => ({
        label: button.getAttribute('aria-label'),
        className: button.className,
        pressed: button.getAttribute('aria-pressed'),
      }))
    return {
      ok:
        buttons.length === 5 &&
        pressed.length === 1 &&
        pressed[0]?.getAttribute('aria-label') === label &&
        mismatched.length === 0,
      pressed: pressed.map(button => button.getAttribute('aria-label')),
      mismatched,
    }
  }, expectedLabel)
  assert(
    result.ok,
    `${expectedLabel} workspace pane tab state is not accessible: ${JSON.stringify(result)}`,
  )
}

async function assertComposerFocused(page, label) {
  const result = await waitFor(page, () => {
    const composer = document.querySelector('.composer textarea')
    const active = document.activeElement
    const result = {
      ok:
        composer instanceof HTMLTextAreaElement &&
        active === composer &&
        !composer.disabled &&
        composer.getAttribute('aria-label') === 'Message Claude',
      activeTag: active?.tagName,
      activeLabel: active?.getAttribute?.('aria-label'),
      disabled: composer instanceof HTMLTextAreaElement ? composer.disabled : undefined,
    }
    return result.ok ? result : false
  })
  assert(result.ok, `${label} did not focus the composer: ${JSON.stringify(result)}`)
}

async function fillComposer(page, value) {
  const composer = page.locator('textarea[placeholder^="Ask Claude"]')
  await composer.fill(value)
  const filled = await waitFor(page, expected => {
    const composer = document.querySelector('.composer textarea')
    return composer instanceof HTMLTextAreaElement && composer.value === expected
  }, 1_000, value).then(() => true, () => false)
  if (filled) return
  await composer.evaluate((element, nextValue) => {
    if (!(element instanceof HTMLTextAreaElement)) return
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set
    setter?.call(element, nextValue)
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: nextValue,
      inputType: 'insertText',
    }))
    element.setSelectionRange(nextValue.length, nextValue.length)
  }, value)
  try {
    await waitFor(page, expected => {
      const composer = document.querySelector('.composer textarea')
      return composer instanceof HTMLTextAreaElement && composer.value === expected
    }, 10_000, value)
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'fill-composer-timeout',
      expected: value,
      snapshot: await page.evaluate(() => ({
        input: document.querySelector('.composer textarea')?.value,
        selectionStart: document.querySelector('.composer textarea')?.selectionStart,
        activeElement: document.activeElement instanceof HTMLElement
          ? {
              tag: document.activeElement.tagName,
              text: document.activeElement.textContent,
              ariaLabel: document.activeElement.getAttribute('aria-label'),
            }
          : null,
        menu: document.querySelector('.composer-menu')?.textContent ?? '',
      })),
    }, null, 2))
    throw cause
  }
}

async function discardSmokeEditorChanges(page) {
  await page.evaluate(() => {
    window.__claudeDesktopSmokeDiscardEditorChanges?.()
  })
  await waitFor(page, () => window.__claudeDesktopSmokeHasUnsavedChanges !== true)
}

async function assertChatChromeStable(page, label) {
  const result = await page.evaluate(() => {
    const headerText = document.querySelector('.chat-header p')
    const composer = document.querySelector('.composer')
    const textarea = document.querySelector('.composer textarea')
    const sendButton = document.querySelector('.composer .send-button')
    if (!headerText || !composer || !textarea || !sendButton) {
      return { ok: false, reason: 'missing chat chrome element' }
    }

    const composerRect = composer.getBoundingClientRect()
    const textareaRect = textarea.getBoundingClientRect()
    const sendRect = sendButton.getBoundingClientRect()
    const sideBySide = textareaRect.right <= sendRect.left + 1 || sendRect.right <= textareaRect.left + 1
    const stacked = textareaRect.bottom <= sendRect.top + 1 || sendRect.bottom <= textareaRect.top + 1
    const headerStyle = getComputedStyle(headerText)

    return {
      ok:
        headerText.scrollWidth <= headerText.clientWidth + 1 &&
        composer.scrollWidth <= composer.clientWidth + 1 &&
        textareaRect.left >= composerRect.left - 1 &&
        sendRect.right <= composerRect.right + 1 &&
        (sideBySide || stacked) &&
        headerStyle.whiteSpace !== 'nowrap',
      headerScrollWidth: headerText.scrollWidth,
      headerClientWidth: headerText.clientWidth,
      composerScrollWidth: composer.scrollWidth,
      composerClientWidth: composer.clientWidth,
      textarea: {
        left: Math.round(textareaRect.left - composerRect.left),
        right: Math.round(textareaRect.right - composerRect.left),
        bottom: Math.round(textareaRect.bottom - composerRect.top),
      },
      send: {
        left: Math.round(sendRect.left - composerRect.left),
        right: Math.round(sendRect.right - composerRect.left),
        top: Math.round(sendRect.top - composerRect.top),
      },
      whiteSpace: headerStyle.whiteSpace,
    }
  })
  assert(result.ok, `${label} chat chrome is cramped: ${JSON.stringify(result)}`)
}

async function clickSettingsSidebarButton(page, label) {
  const result = await page.evaluate(label => {
    const button = [...document.querySelectorAll('.settings-sidebar .settings-nav-group button')]
      .find(button => button.textContent?.trim() === label)
    if (!(button instanceof HTMLButtonElement)) {
      return { ok: false, reason: 'missing button' }
    }
    button.click()
    return { ok: true }
  }, label)
  assert(result.ok, `Settings sidebar button ${label} was not clickable: ${JSON.stringify(result)}`)
}

async function assertSettingsActionStates(page) {
  const result = await page.evaluate(() => {
    const buttonState = name => {
      const buttons = [...document.querySelectorAll('button')]
      const button = buttons.find(item => item.textContent?.trim() === name)
      return button
        ? { found: true, disabled: button.disabled }
        : { found: false, disabled: undefined }
    }
    const states = {
      refresh: buttonState('Refresh'),
      saveProxy: buttonState('Save'),
      addMcp: buttonState('Add MCP'),
      installUserSkill: buttonState('Install user skill'),
      installProjectSkill: buttonState('Install project skill'),
    }
    return {
      ok:
        states.refresh.found &&
        states.saveProxy.found &&
        states.installUserSkill.found &&
        states.installProjectSkill.found &&
        !states.refresh.disabled &&
        !states.saveProxy.disabled &&
        states.addMcp.found &&
        states.addMcp.disabled &&
        !states.installUserSkill.disabled &&
        states.installProjectSkill.disabled,
      states,
    }
  })
  assert(result.ok, `settings action states are unclear: ${JSON.stringify(result)}`)
}

async function assertSettingsBusyFeedback(page, app) {
  const settingsRefreshBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['config:get'] ?? 0)
  await page.evaluate(() => {
    const refresh = [...document.querySelectorAll('.settings-content-header button')]
      .find(button => button.textContent?.includes('Refresh'))
    if (!(refresh instanceof HTMLButtonElement)) {
      throw new Error('missing Settings Refresh button for rapid-settings-refresh smoke')
    }
    refresh.click()
    refresh.click()
  })
  await waitFor(page, () => {
    const pane = document.querySelector('.settings-pane')
    const status = pane?.querySelector('.pane-loading-status')?.textContent ?? ''
    const refresh = pane?.querySelector('.settings-content-header button')
    return (
      pane?.getAttribute('aria-busy') === 'true' &&
      status.includes('Refreshing config') &&
      refresh instanceof HTMLButtonElement &&
      refresh.disabled
    )
  })
  await page.waitForTimeout(250)
  const rapidSettingsRefreshDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['config:get'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), settingsRefreshBaseline)
  assert(
    rapidSettingsRefreshDebug.calls === 1,
    `rapid Settings Refresh submitted ${rapidSettingsRefreshDebug.calls} config reads: ${JSON.stringify(rapidSettingsRefreshDebug)}`,
  )
  await waitFor(page, () => {
    const pane = document.querySelector('.settings-pane')
    return (
      pane?.getAttribute('aria-busy') === 'false' &&
      !pane.querySelector('.pane-loading-status')
    )
  })
  await assertSettingsStatus(page, 'Refreshed configuration.')
}

async function assertSettingsStatus(page, text, kind = 'success') {
  await waitFor(page, ({ expectedText, expectedKind }) => {
    const status = document.querySelector(`.settings-pane .pane-status.${expectedKind}`)?.textContent ?? ''
    return status.includes(expectedText)
  }, 10_000, { expectedText: text, expectedKind: kind })
}

async function waitForProxyStoreUrl(storePath, expectedUrl) {
  const start = Date.now()
  let latest
  while (Date.now() - start < 10_000) {
    try {
      latest = JSON.parse(await readFile(storePath, 'utf8'))
      if (latest.config?.proxy?.url === expectedUrl) return latest
    } catch (cause) {
      latest = { error: cause instanceof Error ? cause.message : String(cause) }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`proxy store did not reach ${expectedUrl}: ${JSON.stringify(latest?.config?.proxy ?? latest)}`)
}

async function saveProxyUrlAndWait(page, storePath, url) {
  await page.evaluate(async nextUrl => {
    await window.claudeDesktop.config.updateProxy({
      enabled: true,
      url: nextUrl,
    })
  }, url)
  await waitForProxyStoreUrl(storePath, url)
}

async function waitForEditedDiff(page) {
  const condition = () => {
    const text = document.body.textContent ?? ''
    const toolbar = document.querySelector('.diff-pane .pane-toolbar')?.textContent ?? ''
    const busy = document.querySelector('.diff-pane')?.getAttribute('aria-busy')
    const status = document.querySelector('.diff-inline-status.success')?.textContent ?? ''
    return (
      text.includes('src/app.txt') &&
      text.includes('updated through monaco') &&
      toolbar.includes('Git changes · 1 file') &&
      busy === 'false' &&
      status.includes('Updated git changes: 1 file changed.')
    )
  }
  try {
    await waitFor(page, condition, 30_000)
    return
  } catch (cause) {
    const snapshot = await page.evaluate(() => ({
      bodySample: (document.body.textContent ?? '').slice(0, 2000),
      toolbar: document.querySelector('.diff-pane .pane-toolbar')?.textContent ?? '',
      busy: document.querySelector('.diff-pane')?.getAttribute('aria-busy'),
      status: document.querySelector('.diff-inline-status')?.textContent ?? '',
      statusClass: document.querySelector('.diff-inline-status')?.className ?? '',
      gitStatus: document.querySelector('.diff-status')?.textContent ?? '',
      diffSample: document.querySelector('.diff-viewer')?.textContent?.slice(0, 1000) ?? '',
    }))
    console.log(JSON.stringify({
      phase: 'edited-diff-initial-timeout',
      snapshot,
    }, null, 2))
    const refresh = page.locator('.diff-pane .pane-toolbar').getByRole('button', { name: /Refresh/ })
    await refresh.click()
    await waitFor(page, condition, 30_000)
  }
}

async function waitForSavedEditor(page, workspace, path, expectedContents) {
  try {
    await waitFor(page, () => {
      const text = document.querySelector('.editor-toolbar')?.textContent ?? ''
      const status = document.querySelector('.editor-status.success')?.textContent ?? ''
      return (
        text.includes('app.txt') &&
        !text.includes('Unsaved') &&
        status.includes('Saved src/app.txt')
      )
    }, 30_000)
    return
  } catch (cause) {
    const snapshot = await page.evaluate(() => ({
      toolbar: document.querySelector('.editor-toolbar')?.textContent ?? '',
      status: document.querySelector('.editor-status')?.textContent ?? '',
      statusClass: document.querySelector('.editor-status')?.className ?? '',
      loading: document.querySelector('.pane-loading-status')?.textContent ?? '',
      dirty: window.__claudeDesktopSmokeHasUnsavedChanges,
      editorSample: window.__claudeDesktopSmokeEditor?.getValue?.().slice(0, 1000) ?? '',
    }))
    console.log(JSON.stringify({
      phase: 'editor-save-status-timeout',
      snapshot,
    }, null, 2))
    await waitFor(page, async ({ cwd, filePath, contents }) => {
      const saved = await window.claudeDesktop.workspace.readFile(cwd, filePath)
      return saved === contents && window.__claudeDesktopSmokeHasUnsavedChanges === false
    }, 30_000, { cwd: workspace, filePath: path, contents: expectedContents })
  }
}

async function assertDiagnosticsExport(page, app, label, trigger, options = {}) {
  const rapid = options.rapid === true
  const diagnosticsPath = join(
    tmpdir(),
    `claude-desktop-smoke-diagnostics-${label}-${Date.now()}.json`,
  )
  await app.evaluate(({ dialog }, outputPath) => {
    globalThis.__claudeDesktopSmokeOriginalShowSaveDialog = dialog.showSaveDialog
    globalThis.__claudeDesktopSmokeDiagnosticsDialogCalls = 0
    dialog.showSaveDialog = async () => {
      globalThis.__claudeDesktopSmokeDiagnosticsDialogCalls += 1
      return {
        canceled: false,
        filePath: outputPath,
        bookmark: '',
      }
    }
  }, diagnosticsPath)
  try {
    const diagnosticsExportBaseline = await app.evaluate(({ app: electronApp }) =>
      electronApp.__claudeDesktopSmokeIpcCalls?.['diagnostics:export'] ?? 0)
    await trigger(diagnosticsPath, { rapid })
    await assertSettingsStatus(page, `Exported diagnostics to ${diagnosticsPath}`)
    const diagnosticsExportDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
      calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['diagnostics:export'] ?? 0) - baseline,
      allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
    }), diagnosticsExportBaseline)
    assert(
      diagnosticsExportDebug.calls === 1,
      `${label} diagnostics export submitted ${diagnosticsExportDebug.calls} IPC calls${rapid ? ' during rapid export' : ''}: ${JSON.stringify(diagnosticsExportDebug)}`,
    )
    const diagnosticsDialogCalls = await app.evaluate(() =>
      globalThis.__claudeDesktopSmokeDiagnosticsDialogCalls ?? 0)
    assert(diagnosticsDialogCalls === 1, `${label} diagnostics export opened ${diagnosticsDialogCalls} save dialogs${rapid ? ' during rapid export' : ''}`)
    const diagnosticsRaw = await readFile(diagnosticsPath, 'utf8')
    const diagnosticsBundle = JSON.parse(diagnosticsRaw)
    assert(
      diagnosticsBundle.schemaVersion === 1 &&
        diagnosticsBundle.app &&
        diagnosticsBundle.runtime &&
        diagnosticsBundle.config?.proxyEnabled === true &&
        typeof diagnosticsBundle.config?.proxyUrl === 'string' &&
        diagnosticsBundle.config.proxyUrl.includes('%5Bredacted%5D') &&
        Array.isArray(diagnosticsBundle.sessions) &&
        Array.isArray(diagnosticsBundle.operationalEvents),
      `${label} diagnostics bundle shape is incomplete: ${diagnosticsRaw}`,
    )
    assert(
      !diagnosticsRaw.includes('desktop-smoke-secret-token') &&
        !diagnosticsRaw.includes('desktop_smoke_') &&
        diagnosticsRaw.includes('%5Bredacted%5D'),
      `${label} diagnostics bundle leaked or failed to mark redacted data: ${diagnosticsRaw}`,
    )
  } finally {
    await app.evaluate(({ dialog }) => {
      if (globalThis.__claudeDesktopSmokeOriginalShowSaveDialog) {
        dialog.showSaveDialog = globalThis.__claudeDesktopSmokeOriginalShowSaveDialog
        delete globalThis.__claudeDesktopSmokeOriginalShowSaveDialog
      }
      delete globalThis.__claudeDesktopSmokeDiagnosticsDialogCalls
    })
  }
}

async function assertTasksStatus(page, text, kind = 'success') {
  await waitFor(page, ({ expectedText, expectedKind }) => {
    const status = document.querySelector(`.tasks-pane .pane-status.${expectedKind}`)?.textContent ?? ''
    return status.includes(expectedText)
  }, 10_000, { expectedText: text, expectedKind: kind })
}

async function assertAgentsStatus(page, text, kind = 'success') {
  await waitFor(page, ({ expectedText, expectedKind }) => {
    const status = document.querySelector(`.agents-pane .pane-status.${expectedKind}`)?.textContent ?? ''
    return status.includes(expectedText)
  }, 10_000, { expectedText: text, expectedKind: kind })
}

async function assertTeamsStatus(page, text, kind = 'success') {
  await waitFor(page, ({ expectedText, expectedKind }) => {
    const status = document.querySelector(`.teams-pane .pane-status.${expectedKind}`)?.textContent ?? ''
    return status.includes(expectedText)
  }, 10_000, { expectedText: text, expectedKind: kind })
}

async function assertPaneCanReachSection(page, paneSelector, headingText, label) {
  const result = await page.evaluate(({ selector, heading }) => {
    const pane = document.querySelector(selector)
    if (!pane) return { ok: false, reason: 'missing pane' }
    pane.scrollTop = pane.scrollHeight
    const toolbar = pane.querySelector('.pane-toolbar')
    const headingElement = [...pane.querySelectorAll('h3')]
      .find(item => item.textContent?.trim() === heading)
    const paneRect = pane.getBoundingClientRect()
    const toolbarRect = toolbar?.getBoundingClientRect()
    const headingRect = headingElement?.getBoundingClientRect()
    return {
      ok: Boolean(
        headingElement &&
        toolbar &&
        toolbarRect &&
        headingRect &&
        getComputedStyle(pane).overflowY === 'auto' &&
        getComputedStyle(toolbar).position === 'sticky' &&
        (pane.scrollTop > 0 || pane.scrollHeight <= pane.clientHeight + 1) &&
        headingRect.top >= paneRect.top &&
        headingRect.bottom <= paneRect.bottom &&
        toolbarRect.top >= paneRect.top - 1 &&
        toolbarRect.bottom <= paneRect.bottom + 1
      ),
      scrollTop: pane.scrollTop,
      scrollHeight: pane.scrollHeight,
      clientHeight: pane.clientHeight,
      toolbarPosition: toolbar ? getComputedStyle(toolbar).position : 'missing',
      headingFound: Boolean(headingElement),
      headingTop: headingRect ? Math.round(headingRect.top - paneRect.top) : null,
      headingBottom: headingRect ? Math.round(headingRect.bottom - paneRect.top) : null,
    }
  }, { selector: paneSelector, heading: headingText })
  assert(result.ok, `${label} cannot reach ${headingText}: ${JSON.stringify(result)}`)
}

async function assertPolishedScrollableSurfaces(page, selectors, label) {
  const result = await page.evaluate(items => {
    const surfaces = items.map(selector => {
      const element = document.querySelector(selector)
      if (!element) {
        return { selector, ok: false, reason: 'missing surface' }
      }
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const canScroll = element.scrollHeight > element.clientHeight + 1 ||
        element.scrollWidth > element.clientWidth + 1
      return {
        selector,
        ok: Boolean(
          rect.width > 0 &&
          rect.height > 0 &&
          style.scrollbarGutter.includes('stable') &&
          style.scrollbarColor !== 'auto' &&
          (!canScroll || ['auto', 'scroll'].includes(style.overflowY)),
        ),
        scrollbarGutter: style.scrollbarGutter,
        scrollbarColor: style.scrollbarColor,
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }
    })
    return {
      ok: surfaces.every(surface => surface.ok),
      surfaces,
    }
  }, selectors)
  assert(result.ok, `${label} scroll surfaces are not polished: ${JSON.stringify(result)}`)
}

async function assertPaneJumpbar(page, paneSelector, buttonText, headingText, label) {
  const initial = await page.evaluate(selector => {
    const pane = document.querySelector(selector)
    const jumpbar = pane?.querySelector('.pane-jumpbar')
    const toolbar = pane?.querySelector('.pane-toolbar')
    const jumpbarRect = jumpbar?.getBoundingClientRect()
    const toolbarRect = toolbar?.getBoundingClientRect()
    return {
      ok: Boolean(
        pane &&
        jumpbar &&
        toolbar &&
        jumpbarRect &&
        toolbarRect &&
        getComputedStyle(jumpbar).position === 'sticky' &&
        ['hidden', 'clip'].includes(getComputedStyle(jumpbar).overflowX) &&
        jumpbarRect.top >= toolbarRect.bottom - 1,
      ),
      jumpbarFound: Boolean(jumpbar),
      position: jumpbar ? getComputedStyle(jumpbar).position : 'missing',
      overflowX: jumpbar ? getComputedStyle(jumpbar).overflowX : 'missing',
      jumpbarTop: jumpbarRect ? Math.round(jumpbarRect.top) : null,
      toolbarBottom: toolbarRect ? Math.round(toolbarRect.bottom) : null,
    }
  }, paneSelector)
  assert(initial.ok, `${label} jumpbar is not usable: ${JSON.stringify(initial)}`)
  await page.locator(`${paneSelector} .pane-jumpbar`).getByRole('button', { name: buttonText }).click()
  const result = await page.evaluate(({ selector, heading }) => {
    const pane = document.querySelector(selector)
    if (!pane) return { ok: false, reason: 'missing pane' }
    const jumpbar = pane.querySelector('.pane-jumpbar')
    const headingElement = [...pane.querySelectorAll('h3')]
      .find(item => item.textContent?.trim() === heading)
    const paneRect = pane.getBoundingClientRect()
    const jumpbarRect = jumpbar?.getBoundingClientRect()
    const headingRect = headingElement?.getBoundingClientRect()
    return {
      ok: Boolean(
        headingElement &&
        jumpbarRect &&
        headingRect &&
        headingRect.top >= jumpbarRect.bottom - 1 &&
        headingRect.bottom <= paneRect.bottom,
      ),
      headingFound: Boolean(headingElement),
      headingTop: headingRect ? Math.round(headingRect.top - paneRect.top) : null,
      headingBottom: headingRect ? Math.round(headingRect.bottom - paneRect.top) : null,
      jumpbarBottom: jumpbarRect ? Math.round(jumpbarRect.bottom - paneRect.top) : null,
      scrollTop: pane.scrollTop,
    }
  }, { selector: paneSelector, heading: headingText })
  assert(result.ok, `${label} jumpbar did not reach ${headingText}: ${JSON.stringify(result)}`)
}

async function assertPaneSectionVisible(page, paneSelector, headingText, label, requireScroll = false) {
  let result
  const start = Date.now()
  while (Date.now() - start < 10_000) {
    result = await page.evaluate(({ selector, heading, scrolled }) => {
      const pane = document.querySelector(selector)
      if (!pane) return { ok: false, reason: 'missing pane' }
      const headingElement = [...pane.querySelectorAll('h3')]
        .find(item => item.textContent?.trim() === heading)
      let paneRect = pane.getBoundingClientRect()
      let headingRect = headingElement?.getBoundingClientRect()
      if (
        headingElement &&
        headingRect &&
        (headingRect.top < paneRect.top || headingRect.bottom > paneRect.bottom)
      ) {
        pane.scrollTop += headingRect.top - paneRect.top - 8
        paneRect = pane.getBoundingClientRect()
        headingRect = headingElement.getBoundingClientRect()
      }
      return {
        ok: Boolean(
          headingElement &&
          headingRect &&
          (!scrolled || pane.scrollTop > 0) &&
          headingRect.top >= paneRect.top &&
          headingRect.bottom <= paneRect.bottom,
        ),
        headingFound: Boolean(headingElement),
        headingTop: headingRect ? Math.round(headingRect.top - paneRect.top) : null,
        headingBottom: headingRect ? Math.round(headingRect.bottom - paneRect.top) : null,
        scrollTop: pane.scrollTop,
      }
    }, { selector: paneSelector, heading: headingText, scrolled: requireScroll })
    if (result.ok) break
    await page.waitForTimeout(100)
  }
  assert(result.ok, `${label} did not show ${headingText}: ${JSON.stringify(result)}`)
}

async function assertSessionRailCanReach(page, sessionTitle) {
  const result = await page.evaluate(title => {
    const list = document.querySelector('.session-list')
    if (!list) return { ok: false, reason: 'missing session list' }
    const row = [...list.querySelectorAll('.session-row')]
      .find(item => item.querySelector('strong')?.textContent?.trim() === title)
    row?.scrollIntoView({ block: 'nearest' })
    const listRect = list.getBoundingClientRect()
    const rowRect = row?.getBoundingClientRect()
    return {
      ok: Boolean(
        row &&
        rowRect &&
        getComputedStyle(list).overflowY === 'auto' &&
        list.scrollHeight > list.clientHeight &&
        rowRect.top >= listRect.top - 1 &&
        rowRect.bottom <= listRect.bottom + 1
      ),
      scrollTop: list.scrollTop,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      rowFound: Boolean(row),
      rowTop: rowRect ? Math.round(rowRect.top - listRect.top) : null,
      rowBottom: rowRect ? Math.round(rowRect.bottom - listRect.top) : null,
    }
  }, sessionTitle)
  assert(result.ok, `session rail cannot reach ${sessionTitle}: ${JSON.stringify(result)}`)
}

async function startPreviewServer() {
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Claude Desktop Preview Smoke</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #fffaf3;
            color: #26211d;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          main {
            border: 1px solid #dccfc2;
            border-radius: 8px;
            padding: 24px;
            background: white;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Claude Desktop Preview Smoke</h1>
          <p>Rendered inside the embedded preview iframe.</p>
        </main>
      </body>
    </html>`
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'preview server did not expose an address')
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve, reject) => {
      server.close(cause => {
        if (cause) reject(cause)
        else resolve()
      })
    }),
  }
}

async function confirmDesktopDialog(page, name) {
  const dialog = page.locator('.confirmation-modal')
  await dialog.waitFor({ state: 'visible' })
  await waitFor(page, () => {
    const buttons = [...document.querySelectorAll('.confirmation-modal .modal-actions button')]
    return buttons.length >= 2 && buttons.every(button => button.querySelector('.glyph'))
  })
  await dialog.getByRole('button', { name }).click()
  await dialog.waitFor({ state: 'hidden' })
}

async function clickPaneTabExpectingUnsavedDialog(page, tabLabel, options = {}) {
  const { requireCancelFocus = false } = options
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator(`.pane-tabs button[aria-label="${tabLabel}"]`).click()
    const appeared = await waitFor(page, requireCancel => {
      const text = document.querySelector('.confirmation-modal')?.textContent ?? ''
      const activeButtons = [...document.querySelectorAll('button.active')]
        .map(button => button.textContent ?? '')
      const active = document.activeElement
      return (
        text.includes('Discard unsaved changes?') &&
        text.includes('src/app.txt') &&
        activeButtons.some(label => label.includes('Editor')) &&
        (!requireCancel ||
          (active instanceof HTMLButtonElement && active.textContent?.includes('Keep editing')))
      )
    }, 2_000, requireCancelFocus).then(() => true, () => false)
    if (appeared) return
  }
  console.log(JSON.stringify({
    phase: `unsaved-${tabLabel.toLowerCase()}-dialog-timeout`,
    state: await page.evaluate(label => ({
      activeButtons: [...document.querySelectorAll('button.active')]
        .map(button => button.textContent ?? ''),
      toolbar: document.querySelector('.editor-toolbar')?.textContent ?? '',
      smokeHasUnsavedChanges: window.__claudeDesktopSmokeHasUnsavedChanges,
      confirmation: document.querySelector('.confirmation-modal')?.textContent ?? '',
      targetPressed: document.querySelector(`.pane-tabs button[aria-label="${label}"]`)?.getAttribute('aria-pressed'),
      activeElement: document.activeElement instanceof HTMLElement
        ? {
            tag: document.activeElement.tagName,
            text: document.activeElement.textContent,
            ariaLabel: document.activeElement.getAttribute('aria-label'),
          }
        : null,
    }), tabLabel),
  }, null, 2))
  throw new Error(`unsaved ${tabLabel} pane switch dialog did not appear`)
}

async function setSmokeEditorValueAndWaitForUnsaved(page, value) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.evaluate(nextValue => {
      const ok = window.__claudeDesktopSmokeEditor?.setValue(nextValue)
      if (!ok) throw new Error('Monaco smoke editor hook was not ready')
    }, value)
    const markedUnsaved = await waitFor(page, expectedValue => {
      const text = document.querySelector('.editor-toolbar')?.textContent ?? ''
      return (
        text.includes('app.txt') &&
        text.includes('Unsaved') &&
        window.__claudeDesktopSmokeEditor?.getValue() === expectedValue &&
        window.__claudeDesktopSmokeHasUnsavedChanges === true
      )
    }, 2_000, value).then(() => true, () => false)
    if (markedUnsaved) return
  }
  console.log(JSON.stringify({
    phase: 'editor-unsaved-timeout',
    state: await page.evaluate(() => ({
      toolbar: document.querySelector('.editor-toolbar')?.textContent ?? '',
      status: document.querySelector('.editor-status')?.textContent ?? '',
      hookValue: window.__claudeDesktopSmokeEditor?.getValue(),
      smokeHasUnsavedChanges: window.__claudeDesktopSmokeHasUnsavedChanges,
      activeButtons: [...document.querySelectorAll('button.active')]
        .map(button => button.textContent ?? ''),
    })),
  }, null, 2))
  throw new Error('Monaco editor did not show an Unsaved state')
}

async function assertNamedFormControls(page, selector) {
  const missing = await page.evaluate(rootSelector => {
    const root = document.querySelector(rootSelector)
    if (!root) return [`Missing root: ${rootSelector}`]
    return [...root.querySelectorAll('input, textarea, select')]
      .filter(control => {
        const element = control
        const hasExplicitName =
          element.getAttribute('aria-label') ||
          element.getAttribute('aria-labelledby') ||
          element.getAttribute('title')
        const hasAssociatedLabel =
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
            ? element.labels.length > 0
            : false
        return !hasExplicitName && !hasAssociatedLabel
      })
      .map(control => {
        const placeholder = control.getAttribute('placeholder')
        const type = control.getAttribute('type')
        return `${control.tagName.toLowerCase()}${type ? `[type=${type}]` : ''}${placeholder ? `[placeholder="${placeholder}"]` : ''}`
      })
  }, selector)
  assert(missing.length === 0, `${selector} has unnamed form controls: ${missing.join(', ')}`)
}

async function assertFocusInside(page, selector) {
  const inside = await page.evaluate(rootSelector => {
    const root = document.querySelector(rootSelector)
    return Boolean(root && document.activeElement && root.contains(document.activeElement))
  }, selector)
  assert(inside, `Focus escaped ${selector}`)
}

async function resizeMainWindow(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setSize(size.width, size.height)
  }, { width, height })
}

function appEnv() {
  return {
    ...process.env,
    CLAUDE_CODE_DESKTOP_CLI_COMMAND: fakeRuntime.runtime,
    CLAUDE_CODE_DESKTOP_CLAUDE_HOME: claudeHome,
    CLAUDE_CONFIG_DIR: claudeHome,
    CLAUDE_CODE_DESKTOP_STORE_PATH: storePath,
    CLAUDE_CODE_DESKTOP_USER_DATA_DIR: userDataDir,
    CLAUDE_CODE_DESKTOP_TASK_SCHEDULER_INTERVAL_MS: '1000',
    CLAUDE_CODE_DESKTOP_AGENT_CLI_FAIL_FLAG: join(claudeHome, 'agent-cli-fail'),
    CLAUDE_CODE_DESKTOP_SMOKE: '1',
  }
}

async function launchApp() {
  progress(`launching ${executablePath}`)
  return electron.launch({
    executablePath,
    args: launchArgs,
    cwd: process.cwd(),
    env: appEnv(),
  })
}

function isRetryableStartupFailure(cause) {
  const diagnostics = cause && typeof cause === 'object'
    ? cause.startupDiagnostics
    : undefined
  return Boolean(
    diagnostics &&
      diagnostics.isReady === false &&
      diagnostics.windowCount === 0,
  )
}

async function launchAppWithFirstWindow(label, attempts = 3) {
  let lastCause
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const electronApp = await launchApp()
    try {
      return {
        app: electronApp,
        page: await waitForFirstWindow(electronApp, label),
      }
    } catch (cause) {
      lastCause = cause
      const retryable = isRetryableStartupFailure(cause)
      await closeApp(electronApp, `${label} attempt ${attempt}`)
      if (!retryable || attempt === attempts) {
        throw cause
      }
      progress(`${label} startup did not reach app ready; retrying (${attempt + 1}/${attempts})`)
    }
  }
  throw lastCause
}

async function closeApp(electronApp, label = 'app') {
  const child = electronApp.process()
  try {
    await electronApp.evaluate(({ app, BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.destroy()
      }
      app.quit()
    })
    await withTimeout(
      new Promise(resolve => {
        if (!child || child.exitCode !== null) {
          resolve(undefined)
          return
        }
        child.once('exit', resolve)
      }),
      10_000,
      `${label} close`,
    )
  } catch (cause) {
    progress(`${label} close timed out; killing Electron process`)
    child?.kill('SIGKILL')
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

async function triggerSecondInstanceDeepLink(url) {
  await new Promise((resolve, reject) => {
    const child = spawn(executablePath, deepLinkArgs(url), {
      cwd: process.cwd(),
      env: appEnv(),
      stdio: 'ignore',
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Timed out waiting for deep link second instance to exit'))
    }, 5_000)
    child.on('error', cause => {
      clearTimeout(timer)
      reject(cause)
    })
    child.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

const previewServer = await startPreviewServer()
let app

try {
  const launched = await launchAppWithFirstWindow('initial window')
  app = launched.app
  const page = launched.page
  progress('main window loaded')
  progress('checking menu')
  let menuLabels
  try {
    menuLabels = await withTimeout(
      app.evaluate(({ Menu }) => {
        const menu = Menu.getApplicationMenu()
        return {
          newSession: menu?.getMenuItemById('new-session')?.label,
          openFolder: menu?.getMenuItemById('open-folder')?.label,
          commandPalette: menu?.getMenuItemById('command-palette')?.label,
          viewAgents: menu?.getMenuItemById('view-agents')?.label,
          viewSettings: menu?.getMenuItemById('view-settings')?.label,
          paneFiles: menu?.getMenuItemById('pane-files')?.label,
          panePreview: menu?.getMenuItemById('pane-preview')?.label,
          helpCommandPalette: menu?.getMenuItemById('help-command-palette')?.label,
          helpRefreshSettings: menu?.getMenuItemById('help-refresh-settings')?.label,
          helpExportDiagnostics: menu?.getMenuItemById('help-export-diagnostics')?.label,
          docs: menu?.getMenuItemById('open-claude-code-docs')?.label,
        }
      }),
      20_000,
      'menu inspection',
    )
  } catch (cause) {
    console.log(JSON.stringify(await diagnoseElectronStartup(app, 'menu inspection'), null, 2))
    throw cause
  }
  assert(menuLabels.newSession === 'New Session', 'New Session menu item is missing')
  assert(menuLabels.openFolder === 'Open Project Folder...', 'Open Folder menu item is missing')
  assert(menuLabels.commandPalette === 'Command Palette...', 'Command Palette menu item is missing')
  assert(menuLabels.viewAgents === 'Agents', 'Agents view menu item is missing')
  assert(menuLabels.viewSettings === 'Settings', 'Settings view menu item is missing')
  assert(menuLabels.paneFiles === 'Files', 'Files pane menu item is missing')
  assert(menuLabels.panePreview === 'Preview', 'Preview pane menu item is missing')
  assert(menuLabels.helpCommandPalette === 'Command Palette', 'Help Command Palette menu item is missing')
  assert(menuLabels.helpRefreshSettings === 'Refresh Settings', 'Help Refresh Settings menu item is missing')
  assert(menuLabels.helpExportDiagnostics === 'Export Diagnostics', 'Help Export Diagnostics menu item is missing')
  assert(menuLabels.docs === 'Claude Code Docs', 'Docs menu item is missing')
  await clickApplicationMenuItem(app, 'command-palette')
  await waitFor(page, () => {
    const palette = document.querySelector('.command-palette')
    const input = palette?.querySelector('input[aria-label="Search commands"]')
    return input === document.activeElement
  })
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('run agent')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Run agent') &&
      active.textContent.includes('Start or select a session first.') &&
      active.getAttribute('aria-disabled') === 'true'
  })
  await page.keyboard.press('Enter')
  await waitFor(page, () => {
    const palette = document.querySelector('.command-palette')
    const status = palette?.querySelector('.command-palette-status')?.textContent ?? ''
    return Boolean(palette) &&
      status.includes('Run agent is unavailable.') &&
      status.includes('Start or select a session first.')
  })
  await page.keyboard.press('Escape')
  await waitFor(page, () => !document.querySelector('.command-palette'))
  await clickApplicationMenuItem(app, 'help-command-palette')
  await waitFor(page, () => {
    const palette = document.querySelector('.command-palette')
    const input = palette?.querySelector('input[aria-label="Search commands"]')
    return input === document.activeElement
  })
  await page.keyboard.press('Escape')
  await waitFor(page, () => !document.querySelector('.command-palette'))

  progress('checking menu session action')
  await assertMenuCreatesSession(app, page, 'new-session', defaultWorkspaceCwd, 0)
  await assertMenuCreatesSession(app, page, 'open-folder', menuOpenCwd)
  progress('checking renderer error recovery')
  await page.evaluate(() => localStorage.setItem('claude-desktop-render-crash-test', '1'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('alert').getByText('Renderer recovered from an error').waitFor()
  await page.getByRole('alert').getByText('Desktop renderer crash test').waitFor()
  await page.getByRole('button', { name: /Reload desktop/ }).click()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.desktop-shell')

  progress('checking settings GUI')
  await page.getByRole('button', { name: /Settings/ }).click()
  await assertPrimaryNavState(page, 'Settings')
  const leftSettingsNavigation = await page.evaluate(() => {
    const rail = document.querySelector('.session-rail')
    const footer = document.querySelector('.rail-footer')
    const settings = footer?.querySelector('button')
    const primaryLabels = [...document.querySelectorAll('.primary-nav button')]
      .map(button => button.querySelector('span')?.textContent?.trim())
      .filter(Boolean)
    const layout = document.querySelector('.workspace-layout.primary-settings')
    const paneTabs = document.querySelector('.workspace-layout.primary-settings .pane-tabs')
    const sidebar = document.querySelector('.settings-sidebar')
    const content = document.querySelector('.settings-content')
    const back = document.querySelector('.settings-back-button')
    const search = document.querySelector('.settings-sidebar input[aria-label="Search settings"]')
    const topJumpbar = document.querySelector('.settings-pane .pane-jumpbar')
    const mcpSection = document.querySelector('.settings-content #settings-mcp')
    const skillsSection = document.querySelector('.settings-content #settings-skills')
    const pluginsSection = document.querySelector('.settings-content #settings-plugins')
    const groups = [...document.querySelectorAll('.settings-sidebar .settings-nav-group')]
      .map(group => ({
        label: group.querySelector(':scope > span')?.textContent?.trim(),
        buttons: [...group.querySelectorAll('button')]
          .map(button => button.textContent?.trim())
          .filter(Boolean),
      }))
    if (!(rail instanceof HTMLElement) || !(footer instanceof HTMLElement) || !(settings instanceof HTMLElement)) {
      return { ok: false, reason: 'missing left settings navigation' }
    }
    const railRect = rail.getBoundingClientRect()
    const footerRect = footer.getBoundingClientRect()
    const sidebarElement = sidebar instanceof HTMLElement ? sidebar : undefined
    const contentElement = content instanceof HTMLElement ? content : undefined
    return {
      ok:
        footerRect.bottom <= railRect.bottom + 1 &&
        footerRect.top > railRect.top + railRect.height / 2 &&
        settings.textContent?.includes('Settings') &&
        primaryLabels.join('|') === 'Chat|Agents|Teams|Tasks' &&
        layout instanceof HTMLElement &&
        paneTabs instanceof HTMLElement &&
        getComputedStyle(paneTabs).display === 'none' &&
        sidebarElement &&
        contentElement &&
        getComputedStyle(sidebarElement).overflowY === 'auto' &&
        getComputedStyle(contentElement).overflowY === 'auto' &&
        back instanceof HTMLButtonElement &&
        back.textContent?.includes('Back to app') &&
        search instanceof HTMLInputElement &&
        !topJumpbar &&
        mcpSection instanceof HTMLElement &&
        skillsSection instanceof HTMLElement &&
        pluginsSection instanceof HTMLElement &&
        groups.some(group => group.label === 'Personal' && group.buttons.join('|') === 'General|Configuration') &&
        groups.some(group => group.label === 'Integrations' && group.buttons.join('|') === 'MCP|Skills|Plugins') &&
        groups.some(group => group.label === 'Coding' && group.buttons.join('|') === 'Project tasks|Global tasks'),
      groups,
      primaryLabels,
      hasTopJumpbar: Boolean(topJumpbar),
      hasMcpSection: Boolean(mcpSection),
      hasSkillsSection: Boolean(skillsSection),
      hasPluginsSection: Boolean(pluginsSection),
      sidebarOverflowY: sidebarElement ? getComputedStyle(sidebarElement).overflowY : null,
      contentOverflowY: contentElement ? getComputedStyle(contentElement).overflowY : null,
      paneTabsDisplay: paneTabs instanceof HTMLElement ? getComputedStyle(paneTabs).display : null,
      railBottom: railRect.bottom,
      footerBottom: footerRect.bottom,
    }
  })
  assert(
    leftSettingsNavigation.ok,
    `Settings is not grouped or anchored in the left footer: ${JSON.stringify(leftSettingsNavigation)}`,
  )
  try {
    await waitFor(page, () => {
      const text = document.body.textContent ?? ''
      return (
        text.includes('Runtime Settings') &&
        text.includes('playwright') &&
        text.includes('Existing smoke skill') &&
        text.includes('Open project tasks') &&
        text.includes('Open global tasks') &&
        text.includes('superpowers@claude-plugins-official') &&
        text.includes('desktop-smoke-project-plugin') &&
        text.includes('desktop-smoke-local-plugin') &&
        text.includes('[redacted]')
      )
    })
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'settings-gui-timeout',
      body: await page.textContent('body'),
    }, null, 2))
    throw cause
  }
  const stalePluginRowState = await page.evaluate(() => {
    const packageInput = document.querySelector('#settings-plugins input[aria-label="Plugin package"]')
    const rows = [...document.querySelectorAll('#plugin-listbox [role="option"]')]
    function rowState(name) {
      const row = rows.find(item => item.textContent?.includes(name))
      return row instanceof HTMLElement
        ? {
          ariaDisabled: row.getAttribute('aria-disabled'),
          tabIndex: row.tabIndex,
        }
        : null
    }
    const originalPackage = packageInput instanceof HTMLInputElement ? packageInput.value : null
    rows.find(item => item.textContent?.includes('desktop-smoke-project-plugin'))?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    rows.find(item => item.textContent?.includes('desktop-smoke-local-plugin'))?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    const afterPackage = packageInput instanceof HTMLInputElement ? packageInput.value : null
    return {
      project: rowState('desktop-smoke-project-plugin'),
      local: rowState('desktop-smoke-local-plugin'),
      user: rowState('superpowers@claude-plugins-official'),
      packageUnchanged: originalPackage === afterPackage,
    }
  })
  assert(
    stalePluginRowState.project?.ariaDisabled === 'true' &&
      stalePluginRowState.project?.tabIndex === -1 &&
      stalePluginRowState.local?.ariaDisabled === 'true' &&
      stalePluginRowState.local?.tabIndex === -1 &&
      stalePluginRowState.user?.ariaDisabled === 'false' &&
      stalePluginRowState.user?.tabIndex === 0 &&
      stalePluginRowState.packageUnchanged,
    `project/local plugin rows were selectable without an active session: ${JSON.stringify(stalePluginRowState)}`,
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await waitFor(page, () => {
    const button = document.querySelector('.tool-button')
    if (!button || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    const duration = getComputedStyle(button).transitionDuration
    const seconds = duration.endsWith('ms')
      ? Number.parseFloat(duration) / 1000
      : Number.parseFloat(duration)
    return Number.isFinite(seconds) && seconds <= 0.001
  })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await assertNamedFormControls(page, '.settings-pane')
  await assertSettingsActionStates(page)
  await assertSettingsBusyFeedback(page, app)
  const helpRefreshBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['config:get'] ?? 0)
  await clickApplicationMenuItem(app, 'help-refresh-settings')
  await assertPrimaryNavState(page, 'Settings')
  await assertSettingsStatus(page, 'Refreshed configuration.')
  const helpRefreshDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['config:get'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), helpRefreshBaseline)
  assert(
    helpRefreshDebug.calls === 1,
    `Help Refresh settings submitted ${helpRefreshDebug.calls} config reads: ${JSON.stringify(helpRefreshDebug)}`,
  )
  await assertPolishedScrollableSurfaces(page, ['.settings-sidebar', '.settings-content'], 'settings pane')
  await capture(page, 'settings')
  await resizeMainWindow(app, 900, 700)
  await page.waitForTimeout(200)
  await waitFor(page, () => {
    const root = document.documentElement
    const shell = document.querySelector('.desktop-shell')
    const settingsPane = document.querySelector('.settings-pane')
    const sidebar = document.querySelector('.settings-sidebar')
    const content = document.querySelector('.settings-content')
    const paneTabs = document.querySelector('.workspace-layout.primary-settings .pane-tabs')
    if (!shell || !settingsPane || !sidebar || !content) return false
    return (
      window.innerWidth <= 920 &&
      root.scrollWidth <= root.clientWidth + 1 &&
      shell.scrollWidth <= shell.clientWidth + 1 &&
      getComputedStyle(settingsPane).overflowY === 'hidden' &&
      getComputedStyle(sidebar).overflowY === 'auto' &&
      getComputedStyle(content).overflowY === 'auto' &&
      paneTabs instanceof HTMLElement &&
      getComputedStyle(paneTabs).display === 'none'
    )
  })
  await assertNoHorizontalOverflow(page, '.settings-pane', 'settings pane')
  await clickSettingsSidebarButton(page, 'Plugins')
  await assertPaneSectionVisible(page, '.settings-content', 'Plugins', 'settings sidebar')
  await page.locator('.settings-sidebar input[aria-label="Search settings"]').fill('skill')
  await waitFor(page, () => {
    const visibleButtons = [...document.querySelectorAll('.settings-sidebar .settings-nav-group button')]
      .filter(button => button.getClientRects().length > 0)
      .map(button => button.textContent?.trim())
    const resultText = document.querySelector('#settings-search-results')?.textContent ?? ''
    return visibleButtons.join('|') === 'Skills' && resultText.includes('1 matching setting')
  })
  await page.keyboard.press('Enter')
  await assertPaneSectionVisible(page, '.settings-content', 'Skills', 'settings search')
  await capture(page, 'settings-skills')
  await page.locator('.settings-sidebar input[aria-label="Search settings"]').fill('no-such-setting')
  await waitFor(page, () => {
    const visibleButtons = [...document.querySelectorAll('.settings-sidebar .settings-nav-group button')]
      .filter(button => button.getClientRects().length > 0)
    const resultText = document.querySelector('#settings-search-results')?.textContent ?? ''
    const empty = document.querySelector('.settings-nav-empty')?.textContent ?? ''
    return visibleButtons.length === 0 &&
      resultText.includes('No matching settings') &&
      empty.includes('No settings match your search.')
  })
  await page.keyboard.press('Escape')
  await waitFor(page, () => {
    const search = document.querySelector('.settings-sidebar input[aria-label="Search settings"]')
    const visibleButtons = [...document.querySelectorAll('.settings-sidebar .settings-nav-group button')]
      .filter(button => button.getClientRects().length > 0)
    return search?.value === '' && visibleButtons.length >= 7
  })
  await page.locator('.settings-sidebar input[aria-label="Search settings"]').fill('')
  await clickSettingsSidebarButton(page, 'Project tasks')
  await assertPrimaryNavState(page, 'Tasks')
  await assertPaneCanReachSection(page, '.tasks-pane', 'Project Scheduled Tasks', 'tasks pane')
  await page.locator('.tasks-pane .pane-jumpbar').getByRole('button', { name: /^Global$/ }).click()
  await assertTasksStatus(page, 'Opened global scheduled tasks.', 'info')
  await assertPaneCanReachSection(page, '.tasks-pane', 'Global Scheduled Tasks', 'tasks pane')
  await page.getByRole('button', { name: /Settings/ }).click()
  await assertPrimaryNavState(page, 'Settings')
  await assertVisibleButtonLayout(page, 'narrow settings')
  await capture(page, 'settings-narrow')
  await resizeMainWindow(app, 720, 700)
  await page.waitForTimeout(200)
  await waitFor(page, () => {
    const root = document.documentElement
    const shell = document.querySelector('.desktop-shell')
    const layout = document.querySelector('.workspace-layout')
    return (
      window.innerWidth <= 740 &&
      root.scrollWidth <= root.clientWidth + 1 &&
      shell instanceof HTMLElement &&
      shell.scrollWidth <= shell.clientWidth + 1 &&
      layout instanceof HTMLElement &&
      layout.scrollWidth <= layout.clientWidth + 1
    )
  })
  await assertNoHorizontalOverflow(page, '.settings-pane', 'compact settings pane')
  await resizeMainWindow(app, 1440, 920)
  await page.waitForTimeout(200)
  await page.getByRole('checkbox', { name: /Enable proxy/ }).setChecked(true)
  await page.locator('.proxy-row input').fill('')
  await waitFor(page, () => {
    const save = [...document.querySelectorAll('#settings-proxy button')]
      .find(button => button.textContent?.trim() === 'Save')
    const note = document.querySelector('#settings-proxy .form-note')?.textContent ?? ''
    return (
      save instanceof HTMLButtonElement &&
      save.disabled &&
      note.includes('Proxy URL must start with')
    )
  })
  await page.locator('.proxy-row input').fill('socks5://127.0.0.1:18999')
  await waitFor(page, () => {
    const save = [...document.querySelectorAll('#settings-proxy button')]
      .find(button => button.textContent?.trim() === 'Save')
    return save instanceof HTMLButtonElement && !save.disabled
  })
  const proxySaveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['config:updateProxy'] ?? 0)
  await page.evaluate(() => {
    const save = [...document.querySelectorAll('#settings-proxy button')]
      .find(button => button.textContent?.trim() === 'Save')
    if (!(save instanceof HTMLButtonElement)) {
      throw new Error('missing proxy Save button for rapid-proxy-save smoke')
    }
    save.click()
    save.click()
  })
  await page.waitForTimeout(250)
  const proxySaveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['config:updateProxy'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
    smokeEnv: process.env.CLAUDE_CODE_DESKTOP_SMOKE,
  }), proxySaveBaseline)
  assert(
    proxySaveDebug.calls === 1,
    `rapid proxy Save submitted ${proxySaveDebug.calls} config updates: ${JSON.stringify(proxySaveDebug)}`,
  )
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return !text.includes('Saving proxy settings')
  })
  await assertSettingsStatus(page, 'Saved proxy settings.')
  const proxyStore = JSON.parse(await readFile(storePath, 'utf8'))
  assert(
    proxyStore.config?.proxy?.enabled === true &&
      proxyStore.config?.proxy?.url === 'socks5://127.0.0.1:18999',
    `proxy settings were not persisted to desktop store: ${JSON.stringify(proxyStore.config?.proxy)}`,
  )
  await saveProxyUrlAndWait(
    page,
    storePath,
    'https://proxy.example.invalid/connect?token=desktop-smoke-secret-token',
  )
  await assertDiagnosticsExport(page, app, 'help-menu', async () => {
    await clickApplicationMenuItem(app, 'help-export-diagnostics')
    await assertPrimaryNavState(page, 'Settings')
  })
  await assertDiagnosticsExport(page, app, 'settings-button', async (_diagnosticsPath, { rapid }) => {
    const button = page.getByRole('button', { name: /Export diagnostics/ })
    if (rapid) {
      await waitFor(page, () => {
        const exportButton = [...document.querySelectorAll('button')]
          .find(item => item.textContent?.includes('Export diagnostics'))
        return exportButton instanceof HTMLButtonElement && !exportButton.disabled
      })
      await button.evaluate(element => {
        if (!(element instanceof HTMLButtonElement)) {
          throw new Error('missing Export diagnostics button for rapid-diagnostics-export smoke')
        }
        if (element.disabled) {
          throw new Error('Export diagnostics button stayed disabled before rapid-diagnostics-export smoke')
        }
        element.click()
        element.click()
      })
    } else {
      await button.click()
    }
  }, { rapid: true })
  await saveProxyUrlAndWait(page, storePath, 'socks5://127.0.0.1:18999')
  await app.evaluate(({ dialog }) => {
    globalThis.__claudeDesktopSmokeOriginalShowOpenDialog = dialog.showOpenDialog
    globalThis.__claudeDesktopSmokeSkillDialogCalls = 0
    dialog.showOpenDialog = async () => {
      globalThis.__claudeDesktopSmokeSkillDialogCalls += 1
      await new Promise(resolve => setTimeout(resolve, 100))
      return {
        canceled: true,
        filePaths: [],
        bookmarks: [],
      }
    }
  })
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#settings-skills button')]
      .find(item => item.textContent?.includes('Install user skill'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Install user skill button for rapid-skill-install smoke')
    }
    button.click()
    button.click()
  })
  await assertSettingsStatus(page, 'Skill install cancelled.', 'info')
  const rapidSkillDialogCalls = await app.evaluate(() => globalThis.__claudeDesktopSmokeSkillDialogCalls ?? 0)
  assert(
    rapidSkillDialogCalls === 1,
    `rapid Install user skill opened ${rapidSkillDialogCalls} folder pickers`,
  )
  await waitFor(page, () => {
    const section = document.querySelector('#settings-skills')
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Install project skill'))
    const note = section?.querySelector('.form-note')?.textContent ?? ''
    const empty = section?.querySelector('.settings-empty-state')
    const projectRows = [...(section?.querySelectorAll('article') ?? [])]
      .filter(item => item.textContent?.includes('project ·'))
    const projectRowsDisabled = projectRows.every(item =>
      item.getAttribute('aria-disabled') === 'true' &&
        item.getAttribute('tabindex') === '-1',
    )
    return (
      button instanceof HTMLButtonElement &&
      button.disabled &&
      note.includes('Select a session to install project skills') &&
      projectRowsDisabled &&
      Boolean(
        empty?.querySelector('.glyph') &&
        empty?.querySelector('strong')?.textContent?.includes('Select a project session') &&
        empty?.textContent?.includes('project skills'),
      )
    )
  })
  await app.evaluate(({ dialog }) => {
    if (globalThis.__claudeDesktopSmokeOriginalShowOpenDialog) {
      dialog.showOpenDialog = globalThis.__claudeDesktopSmokeOriginalShowOpenDialog
      delete globalThis.__claudeDesktopSmokeOriginalShowOpenDialog
    }
  })
  await page.evaluate(sourceDir =>
    window.claudeDesktop.skills.installLocal(sourceDir),
  installableSkill)
  await page.getByRole('button', { name: /Refresh/ }).click()
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('Installed through desktop GUI')
  })
  const installedSkillName = installableSkill.split('/').pop()
  assert(installedSkillName, 'installable skill name was not derived from source path')
  const userSkillInspectBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['skills:read'] ?? 0)
  await page
    .locator('#settings-skills article')
    .filter({ hasText: installedSkillName })
    .filter({ hasText: 'user ·' })
    .getByRole('button', { name: /Inspect/ })
    .evaluate(button => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('missing user skill Inspect button for rapid-skill-inspect smoke')
      }
      if (button.disabled) {
        throw new Error('user skill Inspect button stayed disabled before rapid-skill-inspect smoke')
      }
      button.click()
      button.click()
    })
  await waitFor(page, name => {
    const detail = document.querySelector('[aria-label="Selected skill contents"]')
    const text = detail?.textContent ?? ''
    return (
      text.includes(name) &&
      text.includes('Installed through desktop GUI') &&
      text.includes('Smoke inspect body.') &&
      text.includes('/skills/')
    )
  }, 10_000, installedSkillName)
  const userSkillInspectDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['skills:read'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), userSkillInspectBaseline)
  assert(
    userSkillInspectDebug.calls === 1,
    `rapid user skill Inspect submitted ${userSkillInspectDebug.calls} reads: ${JSON.stringify(userSkillInspectDebug)}`,
  )
  const savedUserSkillName = 'smoke-user-saved-skill'
  const userSkillSaveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['skills:save'] ?? 0)
  await page.getByRole('button', { name: /New user skill/ }).click()
  await page.locator('#settings-skills input[aria-label="Skill name"]').fill(savedUserSkillName)
  await page.locator('#settings-skills textarea[aria-label="Skill contents"]').fill(
    '---\ndescription: Saved user smoke skill\n---\n\nSaved directly from desktop Settings.\n',
  )
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#settings-skills button')]
      .find(item => item.textContent?.includes('Save skill'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Save skill button for rapid-user-skill-save smoke')
    }
    if (button.disabled) {
      throw new Error('Save skill button stayed disabled before rapid-user-skill-save smoke')
    }
    button.click()
    button.click()
  })
  await assertSettingsStatus(page, `Saved user skill "${savedUserSkillName}".`)
  const userSkillSaveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['skills:save'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), userSkillSaveBaseline)
  assert(
    userSkillSaveDebug.calls === 1,
    `rapid user skill Save submitted ${userSkillSaveDebug.calls} writes: ${JSON.stringify(userSkillSaveDebug)}`,
  )
  assert(
    (await readFile(join(claudeHome, 'skills', savedUserSkillName, 'SKILL.md'), 'utf8'))
      .includes('Saved directly from desktop Settings.'),
    'user skill save did not write SKILL.md',
  )
  const userSkillRemoveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['skills:remove'] ?? 0)
  await page
    .locator('#settings-skills article')
    .filter({ hasText: installedSkillName })
    .filter({ hasText: 'user ·' })
    .getByRole('button', { name: /Remove/ })
    .evaluate(button => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('missing user skill Remove button for rapid-skill-remove smoke')
      }
      if (button.disabled) {
        throw new Error('user skill Remove button stayed disabled before rapid-skill-remove smoke')
      }
      button.click()
      button.click()
    })
  await confirmDesktopDialog(page, /Remove skill/)
  await assertSettingsStatus(page, `Removed user skill "${installedSkillName}".`)
  const userSkillRemoveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['skills:remove'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), userSkillRemoveBaseline)
  assert(
    userSkillRemoveDebug.calls === 1,
    `rapid user skill Remove submitted ${userSkillRemoveDebug.calls} deletes: ${JSON.stringify(userSkillRemoveDebug)}`,
  )
  await waitFor(page, name =>
    ![...document.querySelectorAll('#settings-skills article')]
      .some(item =>
        item.textContent?.includes(name) &&
        item.textContent?.includes('user ·'),
      ),
  10_000,
  installedSkillName)
  assert(
    await readFile(join(claudeHome, 'skills', installedSkillName, 'SKILL.md'), 'utf8')
      .then(() => false, () => true),
    'user skill directory was not removed',
  )
  progress('checking plugin GUI commands')
  const pluginSection = page.locator('#settings-plugins')
  await rm(join(claudeHome, 'plugins/installed_plugins.json'), { force: true })
  await page.locator('.settings-content-header').getByRole('button', { name: /^Refresh$/ }).click()
  await assertSettingsStatus(page, 'Refreshed configuration.')
  await waitFor(page, () => {
    const empty = document.querySelector('#settings-plugins .settings-empty-state')
    return Boolean(
      empty?.querySelector('.glyph') &&
      empty?.querySelector('strong')?.textContent?.includes('No plugins installed') &&
      empty?.textContent?.includes('install a plugin package'),
    )
  })
  await pluginSection.locator('input[placeholder="plugin or plugin@marketplace"]').fill('desktop-smoke-plugin')
  await pluginSection.locator('select[aria-label="Plugin install scope"]').selectOption('project')
  await waitFor(page, () => {
    const section = document.querySelector('#settings-plugins')
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Install plugin'))
    const note = section?.querySelector('.form-note')?.textContent ?? ''
    return (
      button instanceof HTMLButtonElement &&
      button.disabled &&
      note.includes('Select a session to install project or local plugins')
    )
  })
  await pluginSection.locator('select[aria-label="Plugin install scope"]').selectOption('user')
  const pluginListBaseline = await countPluginCommands('list')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#settings-plugins button')]
      .find(item => item.textContent?.includes('List plugins'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing List plugins button for rapid-plugin-list smoke')
    }
    button.click()
    button.click()
  })
  await waitFor(page, () => (document.body.textContent ?? '').includes('desktop-smoke-plugin'))
  await assertSettingsStatus(page, 'Listed available plugins.')
  const pluginListCount = await countPluginCommands('list')
  assert(
    pluginListCount === pluginListBaseline + 1,
    `rapid List plugins ran ${pluginListCount - pluginListBaseline} plugin list commands`,
  )
  await pluginSection.locator('input[placeholder="plugin or plugin@marketplace"]').fill('desktop-smoke-plugin')
  const pluginInstallBaseline = await countPluginCommands('install desktop-smoke-plugin')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#settings-plugins button')]
      .find(item => item.textContent?.includes('Install plugin'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Install plugin button for rapid-plugin-install smoke')
    }
    button.click()
    button.click()
  })
  await waitFor(page, () => (document.body.textContent ?? '').includes('installed plugin desktop-smoke-plugin'))
  await assertSettingsStatus(page, 'Installed plugin desktop-smoke-plugin.')
  const pluginInstallCount = await countPluginCommands('install desktop-smoke-plugin')
  assert(
    pluginInstallCount === pluginInstallBaseline + 1,
    `rapid Install plugin ran ${pluginInstallCount - pluginInstallBaseline} plugin install commands`,
  )
  await waitFor(page, () => {
    const input = document.querySelector('#settings-plugins input[aria-label="Plugin package"]')
    return input instanceof HTMLInputElement && input.value === ''
  })
  await pluginSection.locator('input[placeholder="plugin or plugin@marketplace"]').fill('desktop-smoke-plugin-fail')
  await pluginSection.getByRole('button', { name: /Install plugin/ }).click()
  await waitFor(page, () => {
    const status = document.querySelector('.settings-pane .pane-status.error')?.textContent ?? ''
    return status.includes('plugin install smoke failure')
  })
  await waitFor(page, () => {
    const input = document.querySelector('#settings-plugins input[aria-label="Plugin package"]')
    return input instanceof HTMLInputElement && input.value === 'desktop-smoke-plugin-fail'
  })
  progress('checking MCP and scheduled task GUI management')
  page.on('dialog', dialog => {
    dialog.accept().catch(() => {
      // A beforeunload dialog can disappear while Electron is closing windows.
    })
  })
  const mcpSection = page.locator('.settings-section').filter({ hasText: 'MCP Servers' })
  await mcpSection.getByRole('button', { name: /Add MCP/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement) || !button.disabled) {
      throw new Error('empty MCP form should disable Add MCP')
    }
  })
  await mcpSection.locator('input[placeholder="server name"]').fill('desktop-smoke-mcp')
  await mcpSection.locator('input[placeholder="command"]').fill('node')
  await mcpSection.locator('input[placeholder="args"]').fill('--version')
  await mcpSection.locator('select[aria-label="MCP server scope"]').selectOption('project')
  await waitFor(page, () => {
    const section = document.querySelector('#settings-mcp')
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Add MCP'))
    const note = section?.querySelector('.form-note')?.textContent ?? ''
    const empty = section?.querySelector('.settings-empty-state')
    const projectRows = [...(section?.querySelectorAll('article') ?? [])]
      .filter(item => item.textContent?.includes('project ·'))
    const projectRowsDisabled = projectRows.every(item =>
      item.getAttribute('aria-disabled') === 'true' &&
        item.getAttribute('tabindex') === '-1',
    )
    return (
      button instanceof HTMLButtonElement &&
      button.disabled &&
      note.includes('Select a session before editing project MCP servers') &&
      projectRowsDisabled &&
      Boolean(
        empty?.querySelector('.glyph') &&
        empty?.querySelector('strong')?.textContent?.includes('Select a project session') &&
        empty?.textContent?.includes('project MCP servers'),
      )
    )
  })
  await mcpSection.locator('select[aria-label="MCP server scope"]').selectOption('user')
  await waitFor(page, () => {
    const section = [...document.querySelectorAll('.settings-section')]
      .find(item => item.textContent?.includes('MCP Servers'))
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Add MCP'))
    return button instanceof HTMLButtonElement && !button.disabled
  })
  const mcpAddBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['mcp:addOrUpdate'] ?? 0)
  await page.evaluate(() => {
    const add = [...document.querySelectorAll('#settings-mcp button')]
      .find(button => button.textContent?.includes('Add MCP'))
    if (!(add instanceof HTMLButtonElement)) {
      throw new Error('missing Add MCP button for rapid-mcp-add smoke')
    }
    add.click()
    add.click()
  })
  await page.waitForTimeout(250)
  const rapidMcpAddDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['mcp:addOrUpdate'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), mcpAddBaseline)
  assert(
    rapidMcpAddDebug.calls === 1,
    `rapid Add MCP submitted ${rapidMcpAddDebug.calls} config updates: ${JSON.stringify(rapidMcpAddDebug)}`,
  )
  await waitFor(page, () => (document.body.textContent ?? '').includes('desktop-smoke-mcp'))
  await assertSettingsStatus(page, 'Saved MCP server.')
  await capture(page, 'settings-mcp')
  const mcpRaw = JSON.parse(await readFile(join(claudeHome, '.mcp.json'), 'utf8'))
  assert(mcpRaw.mcpServers['desktop-smoke-mcp'].command === 'node', 'MCP add did not persist')
  const userMcpInspectBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['mcp:read'] ?? 0)
  await mcpSection.locator('article').filter({ hasText: 'desktop-smoke-mcp' }).getByRole('button', { name: /Inspect/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing user MCP Inspect button for rapid-mcp-inspect smoke')
    }
    if (button.disabled) {
      throw new Error('user MCP Inspect button stayed disabled before rapid-mcp-inspect smoke')
    }
    button.click()
    button.click()
  })
  await waitFor(page, () => {
    const detail = document.querySelector('[aria-label="Selected MCP server details"]')
    const text = detail?.textContent ?? ''
    return (
      text.includes('desktop-smoke-mcp') &&
      text.includes('.mcp.json') &&
      text.includes('node') &&
      text.includes('--version')
    )
  })
  const userMcpInspectDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['mcp:read'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), userMcpInspectBaseline)
  assert(
    userMcpInspectDebug.calls === 1,
    `rapid user MCP Inspect submitted ${userMcpInspectDebug.calls} reads: ${JSON.stringify(userMcpInspectDebug)}`,
  )
  await mcpSection.locator('article').filter({ hasText: 'desktop-smoke-mcp' }).getByRole('button', { name: /Edit/ }).click()
  await assertSettingsStatus(page, 'Editing user MCP server "desktop-smoke-mcp".', 'info')
  await waitFor(page, () => {
    const section = [...document.querySelectorAll('.settings-section')]
      .find(item => item.textContent?.includes('MCP Servers'))
    const cancel = [...(section?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent?.trim() === 'Cancel edit')
    return Boolean(cancel?.querySelector('.glyph'))
  })
  await mcpSection.getByRole('button', { name: /^Cancel edit$/ }).click()
  await assertSettingsStatus(page, 'Cancelled MCP edit.', 'info')
  await mcpSection.locator('article').filter({ hasText: 'desktop-smoke-mcp' }).getByRole('button', { name: /Edit/ }).click()
  await assertSettingsStatus(page, 'Editing user MCP server "desktop-smoke-mcp".', 'info')
  const userMcpRemoveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['mcp:remove'] ?? 0)
  await mcpSection.locator('article').filter({ hasText: 'desktop-smoke-mcp' }).getByRole('button', { name: /Remove/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing user MCP Remove button for rapid-mcp-remove smoke')
    }
    if (button.disabled) {
      throw new Error('user MCP Remove button stayed disabled before rapid-mcp-remove smoke')
    }
    button.click()
    button.click()
  })
  await confirmDesktopDialog(page, /Remove MCP/)
  await waitFor(page, () =>
    ![...document.querySelectorAll('.settings-section article')]
      .some(item => item.textContent?.includes('desktop-smoke-mcp')))
  await assertSettingsStatus(page, 'Removed user MCP server "desktop-smoke-mcp".')
  const userMcpRemoveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['mcp:remove'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), userMcpRemoveBaseline)
  assert(
    userMcpRemoveDebug.calls === 1,
    `rapid user MCP Remove submitted ${userMcpRemoveDebug.calls} deletes: ${JSON.stringify(userMcpRemoveDebug)}`,
  )
  const mcpRemovedRaw = JSON.parse(await readFile(join(claudeHome, '.mcp.json'), 'utf8'))
  assert(!mcpRemovedRaw.mcpServers['desktop-smoke-mcp'], 'MCP remove did not persist')

  await page.getByRole('button', { name: /^Tasks$/ }).click()
  await assertPrimaryNavState(page, 'Tasks')
  const taskSection = page.locator('#tasks-global-tasks')
  await taskSection.getByRole('button', { name: /Add task/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement) || !button.disabled) {
      throw new Error('empty scheduled task form should disable Add task')
    }
  })
  await taskSection.locator('textarea[placeholder="prompt"]').fill('managed scheduled task prompt')
  await waitFor(page, () => {
    const section = document.querySelector('#tasks-global-tasks')
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Add task'))
    const note = section?.querySelector('.form-note')?.textContent ?? ''
    return (
      button instanceof HTMLButtonElement &&
      button.disabled &&
      note.includes('Enter a valid 5-field cron schedule')
    )
  })
  await taskSection.locator('input[placeholder="task name"]').fill('Desktop smoke task')
  await taskSection.locator('input[placeholder="schedule"]').fill('0 8 * * *')
  await waitFor(page, () => {
    const section = [...document.querySelectorAll('.settings-section')]
      .find(item => item.textContent?.includes('Global Scheduled Tasks'))
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Add task'))
    return button instanceof HTMLButtonElement && !button.disabled
  })
  const taskSaveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['tasks:addOrUpdate'] ?? 0)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#tasks-global-tasks button')]
      .find(item => item.textContent?.includes('Add task'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Add task button for rapid-task-save smoke')
    }
    button.click()
    button.click()
  })
  await waitFor(page, () => (document.body.textContent ?? '').includes('managed scheduled task prompt'))
  await assertTasksStatus(page, 'Saved scheduled task.')
  await page.waitForTimeout(200)
  const tasksRaw = JSON.parse(await waitForFile(
    join(claudeHome, 'scheduled_tasks.json'),
    contents => {
      const raw = JSON.parse(contents)
      return raw.tasks?.some(task =>
        task.name === 'Desktop smoke task' &&
        task.prompt === 'managed scheduled task prompt',
      )
    },
  ))
  const rapidTaskSaveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['tasks:addOrUpdate'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), taskSaveBaseline)
  assert(
    rapidTaskSaveDebug.calls === 1,
    `rapid Add task submitted ${rapidTaskSaveDebug.calls} task saves: ${JSON.stringify(rapidTaskSaveDebug)}`,
  )
  const matchingTaskCount = tasksRaw.tasks.filter(task =>
    task.name === 'Desktop smoke task' &&
    task.prompt === 'managed scheduled task prompt'
  ).length
  assert(matchingTaskCount === 1, `rapid Add task persisted ${matchingTaskCount} matching tasks`)
  const createdTask = tasksRaw.tasks.find(task => task.prompt === 'managed scheduled task prompt')
  assert(createdTask?.name === 'Desktop smoke task', 'scheduled task add did not persist')
  await capture(page, 'tasks')
  const managedTaskArticle = taskSection.locator('article').filter({ hasText: 'managed scheduled task prompt' })
  const taskPauseBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['tasks:addOrUpdate'] ?? 0)
  await managedTaskArticle.evaluate(article => {
    const button = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Pause'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing global scheduled task Pause button for rapid-task-pause smoke')
    }
    if (button.disabled) {
      throw new Error('global scheduled task Pause button stayed disabled before rapid-task-pause smoke')
    }
    button.click()
    button.click()
  })
  await assertTasksStatus(page, 'Paused scheduled task "Desktop smoke task".')
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#tasks-global-tasks article')]
      .find(item => item.textContent?.includes('managed scheduled task prompt'))
    const runNow = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Run now'))
    return (
      article?.textContent?.includes('disabled') &&
      runNow instanceof HTMLButtonElement &&
      runNow.disabled &&
      [...(article.querySelectorAll('button') ?? [])]
        .some(button => button.textContent?.includes('Resume'))
    )
  })
  const taskPauseDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['tasks:addOrUpdate'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), taskPauseBaseline)
  assert(
    taskPauseDebug.calls === 1,
    `rapid global task Pause submitted ${taskPauseDebug.calls} updates: ${JSON.stringify(taskPauseDebug)}`,
  )
  const pausedTaskRaw = JSON.parse(await readFile(join(claudeHome, 'scheduled_tasks.json'), 'utf8'))
  assert(
    pausedTaskRaw.tasks.some(task =>
      task.prompt === 'managed scheduled task prompt' &&
      task.enabled === false
    ),
    'scheduled task pause did not persist enabled=false',
  )
  const taskResumeBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['tasks:addOrUpdate'] ?? 0)
  await managedTaskArticle.evaluate(article => {
    const button = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Resume'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing global scheduled task Resume button for rapid-task-resume smoke')
    }
    if (button.disabled) {
      throw new Error('global scheduled task Resume button stayed disabled before rapid-task-resume smoke')
    }
    button.click()
    button.click()
  })
  await assertTasksStatus(page, 'Resumed scheduled task "Desktop smoke task".')
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#tasks-global-tasks article')]
      .find(item => item.textContent?.includes('managed scheduled task prompt'))
    return (
      article?.textContent?.includes('enabled') &&
      [...(article.querySelectorAll('button') ?? [])]
        .some(button => button.textContent?.includes('Pause'))
    )
  })
  const taskResumeDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['tasks:addOrUpdate'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), taskResumeBaseline)
  assert(
    taskResumeDebug.calls === 1,
    `rapid global task Resume submitted ${taskResumeDebug.calls} updates: ${JSON.stringify(taskResumeDebug)}`,
  )
  const resumedTaskRaw = JSON.parse(await readFile(join(claudeHome, 'scheduled_tasks.json'), 'utf8'))
  assert(
    resumedTaskRaw.tasks.some(task =>
      task.prompt === 'managed scheduled task prompt' &&
      task.enabled === true
    ),
    'scheduled task resume did not persist enabled=true',
  )
  await taskSection.locator('article').filter({ hasText: 'managed scheduled task prompt' }).getByRole('button', { name: /Edit/ }).click()
  await assertTasksStatus(page, 'Editing scheduled task "Desktop smoke task".', 'info')
  await waitFor(page, () => {
    const section = [...document.querySelectorAll('.settings-section')]
      .find(item => item.textContent?.includes('Global Scheduled Tasks'))
    const cancel = [...(section?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent?.trim() === 'Cancel edit')
    return Boolean(cancel?.querySelector('.glyph'))
  })
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#tasks-global-tasks article')]
      .find(item => item.textContent?.includes('managed scheduled task prompt'))
    const button = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.trim() === 'Remove')
    const loading = document.querySelector('.pane-loading-status')?.textContent ?? ''
    return button instanceof HTMLButtonElement && !button.disabled && !loading
  })
  const scheduledTaskRemoveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['tasks:remove'] ?? 0)
  await page.evaluate(() => {
    const article = [...document.querySelectorAll('#tasks-global-tasks article')]
      .find(item => item.textContent?.includes('managed scheduled task prompt'))
    const button = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.trim() === 'Remove')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing global scheduled task Remove button for rapid-task-remove smoke')
    }
    if (button.disabled) {
      throw new Error('global scheduled task Remove button stayed disabled before rapid-task-remove smoke')
    }
    button.click()
    button.click()
  })
  await confirmDesktopDialog(page, /Remove task/)
  await assertTasksStatus(page, 'Removed scheduled task')
  const scheduledTaskRemoveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['tasks:remove'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), scheduledTaskRemoveBaseline)
  assert(
    scheduledTaskRemoveDebug.calls === 1,
    `rapid global scheduled task Remove submitted ${scheduledTaskRemoveDebug.calls} deletes: ${JSON.stringify(scheduledTaskRemoveDebug)}`,
  )
  await waitFor(page, () => !(document.body.textContent ?? '').includes('managed scheduled task prompt'))
  await waitFor(page, () => {
    const section = document.querySelector('#tasks-global-tasks')
    const name = section?.querySelector('input[placeholder="task name"]')
    const schedule = section?.querySelector('input[placeholder="schedule"]')
    const prompt = section?.querySelector('textarea[placeholder="prompt"]')
    const add = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Add task'))
    const cancel = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.trim() === 'Cancel edit')
    return (
      name instanceof HTMLInputElement &&
      schedule instanceof HTMLInputElement &&
      prompt instanceof HTMLTextAreaElement &&
      add instanceof HTMLButtonElement &&
      name.value === '' &&
      schedule.value === '' &&
      prompt.value === '' &&
      add.disabled &&
      !cancel
    )
  })
  const tasksRemovedRaw = JSON.parse(await readFile(join(claudeHome, 'scheduled_tasks.json'), 'utf8'))
  assert(
    !tasksRemovedRaw.tasks.some(task => task.prompt === 'managed scheduled task prompt'),
    'scheduled task remove did not persist',
  )

  progress('creating first session')
  await waitFor(page, () => {
    const header = document.querySelector('.chat-header')?.textContent ?? ''
    const text = document.querySelector('.empty-state')?.textContent ?? ''
    return header.includes('Start a Claude Code session') &&
      header.includes('quick desktop workspace') &&
      !header.includes('Choose a project folder') &&
      text.includes('Start a quick session') &&
      text.includes('Quick session') &&
      text.includes('Choose folder')
  })
  await installSmokeEventHook(page)
  await app.evaluate(({ dialog }, workspace) => {
    globalThis.__claudeDesktopSmokeOriginalShowOpenDialog = dialog.showOpenDialog
    globalThis.__claudeDesktopSmokeCreateDialogCalls = 0
    dialog.showOpenDialog = async () => {
      globalThis.__claudeDesktopSmokeCreateDialogCalls += 1
      await new Promise(resolve => setTimeout(resolve, 100))
      return {
        canceled: false,
        filePaths: [workspace],
        bookmarks: [],
      }
    }
  }, cwd)
  await page.getByRole('button', { name: /^New session$/ }).click()
  await waitFor(page, () => {
    const menu = document.querySelector('.session-create-menu')
    const text = menu?.textContent ?? ''
    const active = menu?.querySelector('button.active')
    return text.includes('Quick desktop workspace') &&
      text.includes('Choose project folder') &&
      active?.textContent?.includes('Quick desktop workspace') &&
      active.getAttribute('aria-selected') === 'true'
  })
  await page.keyboard.press('ArrowDown')
  await waitFor(page, () => {
    const active = document.querySelector('.session-create-menu button.active')
    return active?.textContent?.includes('Choose project folder') &&
      active.getAttribute('aria-selected') === 'true'
  })
  await page.keyboard.press('Home')
  await waitFor(page, () => {
    const active = document.querySelector('.session-create-menu button.active')
    return active?.textContent?.includes('Quick desktop workspace') &&
      active.getAttribute('aria-selected') === 'true'
  })
  await page.keyboard.press('Enter')
  const railQuickSessionId = await waitFor(page, expectedCwd => window.claudeDesktop.sessions.list().then(sessions =>
    sessions.find(session => session.cwd === expectedCwd)?.id ?? '',
  ), 10_000, defaultWorkspaceCwd)
  await assertComposerFocused(page, 'rail quick session')
  const railQuickSessionDialogCalls = await app.evaluate(() => globalThis.__claudeDesktopSmokeCreateDialogCalls ?? 0)
  assert(
    railQuickSessionDialogCalls === 0,
    `New session quick action opened ${railQuickSessionDialogCalls} project pickers`,
  )
  await page.evaluate(sessionId => window.claudeDesktop.sessions.close(sessionId), railQuickSessionId)
  await waitFor(page, () => {
    const choose = [...document.querySelectorAll('.empty-state button')]
      .find(item => item.textContent?.includes('Choose folder'))
    return choose instanceof HTMLButtonElement && !choose.disabled
  })
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.empty-state button')]
      .find(item => item.textContent?.includes('Quick session'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing empty Quick session button')
    }
    button.click()
  })
  const quickSessionId = await waitFor(page, expectedCwd => window.claudeDesktop.sessions.list().then(sessions =>
    sessions.find(session => session.cwd === expectedCwd)?.id ?? '',
  ), 10_000, defaultWorkspaceCwd)
  await assertComposerFocused(page, 'empty quick session')
  const quickSessionDialogCalls = await app.evaluate(() => globalThis.__claudeDesktopSmokeCreateDialogCalls ?? 0)
  assert(
    quickSessionDialogCalls === 0,
    `Quick session opened ${quickSessionDialogCalls} project pickers`,
  )
  await page.evaluate(sessionId => window.claudeDesktop.sessions.close(sessionId), quickSessionId)
  await waitFor(page, () => {
    const choose = [...document.querySelectorAll('.empty-state button')]
      .find(item => item.textContent?.includes('Choose folder'))
    return choose instanceof HTMLButtonElement && !choose.disabled
  })
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({
      canceled: true,
      filePaths: [],
      bookmarks: [],
    })
  })
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.empty-state button')]
      .find(item => item.textContent?.includes('Choose folder'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing empty Choose folder button for cancel feedback smoke')
    }
    button.click()
  })
  await waitFor(page, () => {
    const status = document.querySelector('.chat-header .inline-status.info')?.textContent ?? ''
    return status.includes('No project folder selected.') &&
      !status.includes('New session cancelled.')
  })
  await app.evaluate(({ dialog }, workspace) => {
    globalThis.__claudeDesktopSmokeCreateDialogCalls = 0
    dialog.showOpenDialog = async () => {
      globalThis.__claudeDesktopSmokeCreateDialogCalls += 1
      await new Promise(resolve => setTimeout(resolve, 100))
      return {
        canceled: false,
        filePaths: [workspace],
        bookmarks: [],
      }
    }
  }, cwd)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.empty-state button')]
      .find(item => item.textContent?.includes('Choose folder'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing empty Choose folder button for rapid-session-create smoke')
    }
    button.click()
    button.click()
  })

  await page.waitForSelector('.session-row.active')
  await waitFor(page, () => {
    const active = document.querySelector('.session-row.active')
    return active?.getAttribute('aria-current') === 'true'
  })
  const rapidCreateDialogCalls = await app.evaluate(() => globalThis.__claudeDesktopSmokeCreateDialogCalls ?? 0)
  assert(
    rapidCreateDialogCalls === 1,
    `rapid Choose folder opened ${rapidCreateDialogCalls} project pickers`,
  )
  const initialSessionId = await page.evaluate(async workspace => {
    const sessions = await window.claudeDesktop.sessions.list()
    window.__claudeDesktopSmokeSession = sessions.find(session => session.cwd === workspace)
    return window.__claudeDesktopSmokeSession?.id
  }, cwd)
  assert(initialSessionId, 'primary session id was not returned')
  await app.evaluate(({ dialog }) => {
    if (globalThis.__claudeDesktopSmokeOriginalShowOpenDialog) {
      dialog.showOpenDialog = globalThis.__claudeDesktopSmokeOriginalShowOpenDialog
      delete globalThis.__claudeDesktopSmokeOriginalShowOpenDialog
    }
  })
  progress('checking native navigation menu actions')
  await waitFor(page, () => {
    const buttons = [
      ...document.querySelectorAll('.primary-nav button, .rail-footer button'),
    ]
    return buttons.length > 0 &&
      buttons.every(button => button.getAttribute('aria-disabled') !== 'true')
  })
  await clickApplicationMenuItem(app, 'view-agents')
  await waitForPrimaryNavState(page, 'Agents')
  await clickApplicationMenuItem(app, 'view-settings')
  await waitForPrimaryNavState(page, 'Settings')
  await clickApplicationMenuItem(app, 'view-chat')
  await waitForPrimaryNavState(page, 'Chat')
  await clickApplicationMenuItem(app, 'pane-preview')
  await waitFor(page, async workspace => {
    const tab = document.querySelector('.pane-tabs button[aria-label="Preview"]')
    if (tab?.getAttribute('aria-pressed') !== 'true') return false
    const session = (await window.claudeDesktop.sessions.list())
      .find(item => item.cwd === workspace)
    return session?.layout.activePane === 'preview' && session.layout.primaryView === 'chat'
  }, 10_000, cwd)
  await assertWorkspacePaneTabState(page, 'Preview')
  await clickApplicationMenuItem(app, 'pane-files')
  await waitFor(page, async workspace => {
    const tab = document.querySelector('.pane-tabs button[aria-label="Files"]')
    if (tab?.getAttribute('aria-pressed') !== 'true') return false
    const session = (await window.claudeDesktop.sessions.list())
      .find(item => item.cwd === workspace)
    return session?.layout.activePane === 'files' && session.layout.primaryView === 'chat'
  }, 10_000, cwd)
  await assertWorkspacePaneTabState(page, 'Files')
  progress('checking desktop keyboard shortcuts')
  await page.keyboard.press(desktopShortcut('2'))
  await assertPrimaryNavState(page, 'Agents')
  await page.keyboard.press(desktopShortcut('3'))
  await assertPrimaryNavState(page, 'Teams')
  await page.keyboard.press(desktopShortcut('4'))
  await assertPrimaryNavState(page, 'Tasks')
  await page.keyboard.press(desktopShortcut('5'))
  await assertPrimaryNavState(page, 'Settings')
  await page.keyboard.press(desktopShortcut('1'))
  await assertPrimaryNavState(page, 'Chat')
  await assertComposerFocused(page, 'primary nav keyboard shortcut')
  await page.keyboard.press(desktopShortcut('2', { shift: true }))
  await waitFor(page, () => {
    const tab = document.querySelector('.pane-tabs button[aria-label="Diff"]')
    return tab?.getAttribute('aria-pressed') === 'true'
  })
  await assertWorkspacePaneTabState(page, 'Diff')
  await page.keyboard.press(desktopShortcut('3', { shift: true }))
  await waitFor(page, () => {
    const tab = document.querySelector('.pane-tabs button[aria-label="Editor"]')
    return tab?.getAttribute('aria-pressed') === 'true'
  })
  await assertWorkspacePaneTabState(page, 'Editor')
  await page.keyboard.press(desktopShortcut('5', { shift: true }))
  await waitFor(page, () => {
    const tab = document.querySelector('.pane-tabs button[aria-label="Preview"]')
    return tab?.getAttribute('aria-pressed') === 'true'
  })
  await assertWorkspacePaneTabState(page, 'Preview')
  await page.keyboard.press(desktopShortcut('1', { shift: true }))
  await waitFor(page, async workspace => {
    const tab = document.querySelector('.pane-tabs button[aria-label="Files"]')
    if (tab?.getAttribute('aria-pressed') !== 'true') return false
    const session = (await window.claudeDesktop.sessions.list())
      .find(item => item.cwd === workspace)
    return session?.layout.activePane === 'files' && session.layout.primaryView === 'chat'
  }, 10_000, cwd)
  await assertWorkspacePaneTabState(page, 'Files')
  progress('checking command palette')
  await page.keyboard.press(desktopShortcut('K'))
  await waitFor(page, () => {
    const palette = document.querySelector('.command-palette')
    const input = palette?.querySelector('input[aria-label="Search commands"]')
    const active = palette?.querySelector('button[aria-selected="true"]')
    const activeElement = document.activeElement instanceof HTMLElement
      ? {
          tag: document.activeElement.tagName,
          text: document.activeElement.textContent,
          ariaLabel: document.activeElement.getAttribute('aria-label'),
        }
      : null
    return {
      ready: input === document.activeElement &&
      Boolean(active) &&
      (palette?.textContent ?? '').includes('Commands'),
      hasPalette: Boolean(palette),
      inputFocused: input === document.activeElement,
      activeText: active?.textContent ?? null,
      paletteText: palette?.textContent ?? null,
      activeElement,
    }
  })
  await capture(page, 'command-palette')
  await page.locator('.command-palette input[aria-label="Search commands"]').focus()
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('agents')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Agents')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Agents')
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('mcp')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('MCP settings')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Settings')
  await waitFor(page, () => {
    const status = document.querySelector('.settings-pane .pane-status')?.textContent ?? ''
    return status.includes('Opened MCP settings.')
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('plugin')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Plugin settings')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Settings')
  await waitFor(page, () => {
    const status = document.querySelector('.settings-pane .pane-status')?.textContent ?? ''
    const plugins = document.getElementById('settings-plugins')
    return status.includes('Opened Plugins settings.') && Boolean(plugins)
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('add mcp')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Add MCP server')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Settings')
  await waitFor(page, () => {
    const status = document.querySelector('.settings-pane .pane-status')?.textContent ?? ''
    const mcp = document.getElementById('settings-mcp')
    const input = mcp?.querySelector('input[aria-label="MCP server name"]')
    return (
      status.includes('Ready to add a new MCP server.') &&
      input instanceof HTMLInputElement &&
      input.value === ''
    )
  })
  const commandPaletteMcpCheckBaseline = await countMcpCommands('list')
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('check mcp')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Check MCP health')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Settings')
  await assertSettingsStatus(page, 'MCP health check passed.')
  await waitFor(page, () => {
    const mcpHealthOutput = document.querySelector('#settings-mcp pre')?.textContent ?? ''
    return mcpHealthOutput.includes('desktop-smoke-mcp-health ok')
  })
  const commandPaletteMcpCheckCount = await waitForMcpCommandCount(
    'list',
    commandPaletteMcpCheckBaseline + 1,
    'command palette Check MCP command count did not advance',
  )
  assert(
    commandPaletteMcpCheckCount === commandPaletteMcpCheckBaseline + 1,
    `command palette Check MCP ran ${commandPaletteMcpCheckCount - commandPaletteMcpCheckBaseline} MCP list commands`,
  )
  await app.evaluate(({ dialog }) => {
    globalThis.__claudeDesktopSmokeOriginalCommandPaletteDialog = dialog.showOpenDialog
    globalThis.__claudeDesktopSmokeCommandPaletteSkillDialogCalls = 0
    dialog.showOpenDialog = async () => {
      globalThis.__claudeDesktopSmokeCommandPaletteSkillDialogCalls += 1
      return {
        canceled: true,
        filePaths: [],
        bookmarks: [],
      }
    }
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('install user skill')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Install user skill')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Settings')
  await assertSettingsStatus(page, 'Skill install cancelled.', 'info')
  const commandPaletteSkillDialogCalls = await app.evaluate(() =>
    globalThis.__claudeDesktopSmokeCommandPaletteSkillDialogCalls ?? 0)
  assert(
    commandPaletteSkillDialogCalls === 1,
    `command palette Install user skill opened ${commandPaletteSkillDialogCalls} folder pickers`,
  )
  const commandPaletteProjectSkillDialogBaseline = commandPaletteSkillDialogCalls
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('install project skill')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Install project skill')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Settings')
  await assertSettingsStatus(page, 'Project skill install cancelled.', 'info')
  const commandPaletteProjectSkillDialogTotal = await app.evaluate(() =>
    globalThis.__claudeDesktopSmokeCommandPaletteSkillDialogCalls ?? 0)
  const commandPaletteProjectSkillDialogCalls =
    commandPaletteProjectSkillDialogTotal - commandPaletteProjectSkillDialogBaseline
  assert(
    commandPaletteProjectSkillDialogCalls === 1,
    `command palette Install project skill opened ${commandPaletteProjectSkillDialogCalls} folder pickers`,
  )
  await app.evaluate(({ dialog }) => {
    if (globalThis.__claudeDesktopSmokeOriginalCommandPaletteDialog) {
      dialog.showOpenDialog = globalThis.__claudeDesktopSmokeOriginalCommandPaletteDialog
      delete globalThis.__claudeDesktopSmokeOriginalCommandPaletteDialog
    }
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('new user skill')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('New user skill')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Settings')
  await assertSettingsStatus(page, 'Creating a new user skill.', 'info')
  await waitFor(page, () => {
    const skills = document.getElementById('settings-skills')
    const name = skills?.querySelector('input[aria-label="Skill name"]')
    const scope = skills?.querySelector('select[aria-label="Skill scope"]')
    return skills instanceof HTMLElement &&
      name instanceof HTMLInputElement &&
      name.value === '' &&
      scope instanceof HTMLSelectElement &&
      scope.value === 'user'
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('new project skill')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('New project skill')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Settings')
  await assertSettingsStatus(page, 'Creating a new project skill.', 'info')
  await waitFor(page, () => {
    const skills = document.getElementById('settings-skills')
    const name = skills?.querySelector('input[aria-label="Skill name"]')
    const scope = skills?.querySelector('select[aria-label="Skill scope"]')
    return skills instanceof HTMLElement &&
      name instanceof HTMLInputElement &&
      name.value === '' &&
      scope instanceof HTMLSelectElement &&
      scope.value === 'project'
  })
  await page.locator('#settings-skills').getByRole('button', { name: /Cancel edit/ }).click()
  await assertSettingsStatus(page, 'Cancelled skill edit.', 'info')
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('list plugins')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('List plugins')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Settings')
  await waitFor(page, () => (document.body.textContent ?? '').includes('desktop-smoke-plugin'))
  await assertSettingsStatus(page, 'Listed available plugins.')
  await saveProxyUrlAndWait(
    page,
    storePath,
    'https://proxy.example.invalid/connect?token=desktop-smoke-secret-token',
  )
  await assertDiagnosticsExport(page, app, 'command-palette-settings', async () => {
    await page.keyboard.press(desktopShortcut('K'))
    await page.locator('.command-palette input[aria-label="Search commands"]').fill('export diagnostics')
    await waitFor(page, () => {
      const active = document.querySelector('.command-palette button[aria-selected="true"]')
      return active?.textContent?.includes('Export diagnostics')
    })
    await page.keyboard.press('Enter')
    await assertPrimaryNavState(page, 'Settings')
  })
  await saveProxyUrlAndWait(page, storePath, 'socks5://127.0.0.1:18999')
  const commandPaletteRefreshBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['config:get'] ?? 0)
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('refresh settings')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Refresh settings')
  })
  await page.evaluate(() => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    if (!(active instanceof HTMLButtonElement)) {
      throw new Error('missing Refresh settings command for command-palette-refresh smoke')
    }
    active.click()
    active.click()
  })
  await assertPrimaryNavState(page, 'Settings')
  await assertSettingsStatus(page, 'Refreshed configuration.')
  const commandPaletteRefreshDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['config:get'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), commandPaletteRefreshBaseline)
  assert(
    commandPaletteRefreshDebug.calls === 1,
    `command palette Refresh settings submitted ${commandPaletteRefreshDebug.calls} config reads: ${JSON.stringify(commandPaletteRefreshDebug)}`,
  )
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('project scheduled')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Project scheduled tasks')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Tasks')
  await waitFor(page, () => {
    const status = document.querySelector('.tasks-pane .pane-status')?.textContent ?? ''
    const projectTasks = document.getElementById('tasks-project-tasks')
    return status.includes('Opened project scheduled tasks.') && Boolean(projectTasks)
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('run agent')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Run agent')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Agents')
  await waitFor(page, () => {
    const status = document.querySelector('.agents-pane .pane-status')?.textContent ?? ''
    const launch = document.getElementById('agents-launch')
    return status.includes('Opened agent runner.') && Boolean(launch)
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('team management')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Team management')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Teams')
  await waitFor(page, () => {
    const status = document.querySelector('.teams-pane .pane-status')?.textContent ?? ''
    const teamsSection = document.getElementById('agents-teams')
    return status.includes('Opened team management.') && Boolean(teamsSection)
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('new custom agent')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('New custom agent')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Agents')
  await assertAgentsStatus(page, 'Ready to create a new agent.', 'info')
  await waitFor(page, () => {
    const section = document.querySelector('#agents-editor')
    const input = section?.querySelector('input[placeholder="agent type"]')
    return section instanceof HTMLElement &&
      input instanceof HTMLInputElement &&
      input.value === ''
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('new team')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('New team')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Teams')
  await assertTeamsStatus(page, 'Ready to create a new team.', 'info')
  await waitFor(page, () => {
    const section = document.querySelector('#agents-teams')
    const input = section?.querySelector('input[aria-label="Team name"]')
    return section instanceof HTMLElement &&
      input instanceof HTMLInputElement &&
      input.value === ''
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('new global scheduled task')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('New global scheduled task')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Tasks')
  await assertTasksStatus(page, 'Ready to create a new global scheduled task.', 'info')
  await waitFor(page, () => {
    const section = document.querySelector('#tasks-global-tasks')
    const name = section?.querySelector('input[aria-label="Scheduled task name"]')
    const schedule = section?.querySelector('input[aria-label="Scheduled task schedule"]')
    const prompt = section?.querySelector('textarea[aria-label="Scheduled task prompt"]')
    return section instanceof HTMLElement &&
      name instanceof HTMLInputElement &&
      schedule instanceof HTMLInputElement &&
      prompt instanceof HTMLTextAreaElement &&
      name.value === '' &&
      schedule.value === '' &&
      prompt.value === ''
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('new project scheduled task')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('New project scheduled task')
  })
  await page.keyboard.press('Enter')
  await assertPrimaryNavState(page, 'Tasks')
  await assertTasksStatus(page, 'Ready to create a new project scheduled task.', 'info')
  await waitFor(page, () => {
    const section = document.querySelector('#tasks-project-tasks')
    const cron = section?.querySelector('input[aria-label="Project task cron schedule"]')
    const prompt = section?.querySelector('textarea[aria-label="Project task prompt"]')
    return section instanceof HTMLElement &&
      cron instanceof HTMLInputElement &&
      prompt instanceof HTMLTextAreaElement &&
      cron.value === '' &&
      prompt.value === ''
  })
  await page.keyboard.press(desktopShortcut('K'))
  await page.locator('.command-palette input[aria-label="Search commands"]').fill('preview')
  await waitFor(page, () => {
    const active = document.querySelector('.command-palette button[aria-selected="true"]')
    return active?.textContent?.includes('Preview')
  })
  await page.keyboard.press('Enter')
  await waitFor(page, async workspace => {
    const tab = document.querySelector('.pane-tabs button[aria-label="Preview"]')
    if (tab?.getAttribute('aria-pressed') !== 'true') return false
    const session = (await window.claudeDesktop.sessions.list())
      .find(item => item.cwd === workspace)
    return session?.layout.activePane === 'preview' && session.layout.primaryView === 'chat'
  }, 10_000, cwd)
  progress('checking keyboard workspace resize')
  await page.evaluate(async workspace => {
    const session = (await window.claudeDesktop.sessions.list())
      .find(item => item.cwd === workspace)
    if (!session) throw new Error(`missing smoke session for ${workspace}`)
    await window.claudeDesktop.sessions.updateLayout(session.id, {
      workspaceRatio: 0.5,
      activePane: 'preview',
      primaryView: 'chat',
    })
  }, cwd)
  await waitFor(page, () => {
    const separator = document.querySelector('.resize-handle')
    return separator?.getAttribute('aria-valuenow') === '50'
  })
  const resizeSeparator = page.getByRole('separator', { name: /Resize workspace/ })
  await resizeSeparator.focus()
  try {
    await waitFor(page, () => {
      const separator = document.querySelector('.resize-handle')
      return (
        document.activeElement === separator &&
        separator?.getAttribute('aria-valuemin') === '30' &&
        separator?.getAttribute('aria-valuemax') === '75' &&
        separator?.getAttribute('aria-valuenow') === '50'
      )
    })
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'keyboard-resize-focus-timeout',
      state: await page.evaluate(async workspace => {
        const session = (await window.claudeDesktop.sessions.list())
          .find(item => item.cwd === workspace)
        const separator = document.querySelector('.resize-handle')
        return {
          activeElement: document.activeElement instanceof HTMLElement
            ? {
                tag: document.activeElement.tagName,
                ariaLabel: document.activeElement.getAttribute('aria-label'),
                className: document.activeElement.className,
              }
            : null,
          separator: separator instanceof HTMLElement
            ? {
                tabIndex: separator.tabIndex,
                ariaValueMin: separator.getAttribute('aria-valuemin'),
                ariaValueMax: separator.getAttribute('aria-valuemax'),
                ariaValueNow: separator.getAttribute('aria-valuenow'),
                rect: separator.getBoundingClientRect().toJSON(),
              }
            : null,
          layout: session?.layout,
        }
      }, cwd),
    }, null, 2))
    throw cause
  }
  const resizeBefore = await page.evaluate(async workspace => {
    const session = (await window.claudeDesktop.sessions.list())
      .find(item => item.cwd === workspace)
    return session?.layout.workspaceRatio
  }, cwd)
  assert(resizeBefore === 0.5, 'initial workspace ratio was not 0.5')
  await resizeSeparator.press('ArrowLeft')
  const resizeAfterLeft = await waitFor(page, async workspace => {
    const session = (await window.claudeDesktop.sessions.list())
      .find(item => item.cwd === workspace)
    return session && session.layout.workspaceRatio > 0.5
      ? session.layout.workspaceRatio
      : ''
  }, 10_000, cwd)
  assert(Number(resizeAfterLeft) > 0.5, 'ArrowLeft did not expand workspace pane')
  await resizeSeparator.press('ArrowRight')
  await waitFor(page, async workspace => {
    const session = (await window.claudeDesktop.sessions.list())
      .find(item => item.cwd === workspace)
    return Math.abs((session?.layout.workspaceRatio ?? 0) - 0.5) < 0.001
  }, 10_000, cwd)
  const handleBox = await resizeSeparator.boundingBox()
  assert(handleBox, 'workspace resize handle did not have a bounding box')
  const pointerLayoutBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:updateLayout'] ?? 0)
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    handleBox.x - 120,
    handleBox.y + handleBox.height / 2,
    { steps: 6 },
  )
  await page.mouse.up()
  const pointerResizeRatio = await waitFor(page, async workspace => {
    const session = (await window.claudeDesktop.sessions.list())
      .find(item => item.cwd === workspace)
    return session && session.layout.workspaceRatio > 0.55
      ? session.layout.workspaceRatio
      : ''
  }, 10_000, cwd)
  assert(Number(pointerResizeRatio) > 0.55, 'pointer drag did not expand workspace pane')
  const pointerLayoutUpdates = await app.evaluate(({ app: electronApp }, baseline) =>
    (electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:updateLayout'] ?? 0) - baseline,
  pointerLayoutBaseline)
  assert(
    pointerLayoutUpdates === 1,
    `pointer drag persisted ${pointerLayoutUpdates} workspace layout updates`,
  )
  await resizeSeparator.press('ArrowRight')
  await waitFor(page, async ({ workspace, previousRatio }) => {
    const session = (await window.claudeDesktop.sessions.list())
      .find(item => item.cwd === workspace)
    return session && session.layout.workspaceRatio < previousRatio
  }, 10_000, { workspace: cwd, previousRatio: Number(pointerResizeRatio) })
  progress('checking partial workspace refresh')
  const agentCliFailFlag = join(claudeHome, 'agent-cli-fail')
  await writeFile(agentCliFailFlag, 'fail agents cli\n')
  await page.getByLabel('Refresh workspace').click()
  try {
    await waitFor(page, () => {
      const text = document.querySelector('.chat-header')?.textContent ?? ''
      return text.includes('Workspace partially refreshed') && text.includes('agents')
    })
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'partial-workspace-refresh-timeout',
      snapshot: await page.evaluate(async workspace => {
        let agents
        try {
          agents = await window.claudeDesktop.agents.list(workspace)
        } catch (agentCause) {
          agents = String(agentCause)
        }
        return {
          url: location.href,
          body: document.body?.textContent ?? '',
          header: document.querySelector('.chat-header')?.textContent ?? '',
          agents,
        }
      }, cwd),
    }, null, 2))
    throw cause
  }
  await rm(agentCliFailFlag, { force: true })
  await page.getByLabel('Refresh workspace').click()
  await waitFor(page, () => {
    const text = document.querySelector('.chat-header')?.textContent ?? ''
    return !text.includes('Workspace partially refreshed') && text.includes('Workspace refreshed.')
  })
  progress('checking global scheduled task run now')
  await page.getByRole('button', { name: /^Tasks$/ }).click()
  await assertPrimaryNavState(page, 'Tasks')
  await page.locator('.tasks-pane .pane-jumpbar').getByRole('button', { name: /^Global$/ }).click()
  const globalTaskSection = page.locator('#tasks-global-tasks')
  await globalTaskSection.locator('input[placeholder="task name"]').fill('Global run task')
  await globalTaskSection.locator('input[placeholder="schedule"]').fill('0 10 * * *')
  await globalTaskSection.locator('textarea[placeholder="prompt"]').fill('global desktop run now prompt')
  await globalTaskSection.getByRole('button', { name: /Add task/ }).click()
  await waitFor(page, () => (document.body.textContent ?? '').includes('global desktop run now prompt'))
  const globalRunNowPromptBaseline = await page.evaluate(sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('global desktop run now prompt')
      ).length
    }),
  initialSessionId)
  const globalRunNowArticle = globalTaskSection
    .locator('article')
    .filter({ hasText: 'global desktop run now prompt' })
  await globalRunNowArticle.waitFor()
  await globalRunNowArticle.evaluate(article => {
    const button = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Run now'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing global Run now button for rapid-scheduled-run smoke')
    }
    button.click()
    button.click()
  })
  await assertTasksStatus(page, 'Queued scheduled task "Global run task".')
  await waitFor(page, ({ sessionId, baseline }) =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      const count = (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('global desktop run now prompt')
      ).length
      return count > baseline
    }),
  10_000, { sessionId: initialSessionId, baseline: globalRunNowPromptBaseline })
  const globalRunNowPromptCount = await page.evaluate(sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('global desktop run now prompt')
      ).length
    }),
  initialSessionId)
  assert(
    globalRunNowPromptCount === globalRunNowPromptBaseline + 1,
    `rapid global Run now queued ${globalRunNowPromptCount - globalRunNowPromptBaseline} prompts`,
  )
  await waitFor(page, () => (document.body.textContent ?? '').includes('global scheduled task ran now'))
  await globalTaskSection.locator('article').filter({ hasText: 'global desktop run now prompt' }).getByRole('button', { name: /Remove/ }).click()
  await confirmDesktopDialog(page, /Remove task/)
  await waitFor(page, () => {
    const sections = [...document.querySelectorAll('.settings-section')]
    const section = sections.find(item => item.textContent?.includes('Global Scheduled Tasks'))
    return !(section?.textContent ?? '').includes('global desktop run now prompt')
  })
  progress('checking automatic global scheduler')
  const globalScheduledNow = new Date()
  const globalScheduledCreatedAt = new Date(globalScheduledNow)
  globalScheduledCreatedAt.setMinutes(globalScheduledNow.getMinutes() - 1, 0, 0)
  await writeFile(join(claudeHome, 'scheduled_tasks.json'), JSON.stringify({
    tasks: [{
      id: 'desktop-global-auto-task',
      name: 'Global automatic task',
      schedule: `${globalScheduledNow.getMinutes()} ${globalScheduledNow.getHours()} * * *`,
      prompt: 'global desktop automatic prompt',
      enabled: true,
      createdAt: globalScheduledCreatedAt.getTime(),
    }],
  }))
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('global scheduled task fired automatically')
  }, 20_000)
  const globalAutoTaskRaw = JSON.parse(await readFile(join(claudeHome, 'scheduled_tasks.json'), 'utf8'))
  assert(
    globalAutoTaskRaw.tasks.some(task =>
      task.id === 'desktop-global-auto-task' &&
      typeof task.lastFiredAt === 'number'
    ),
    'automatic global scheduled task did not persist lastFiredAt',
  )
  progress('checking automatic project scheduler')
  const scheduledNow = new Date()
  const scheduledCreatedAt = new Date(scheduledNow)
  scheduledCreatedAt.setMinutes(scheduledNow.getMinutes() - 1, 0, 0)
  await mkdir(join(cwd, '.claude'), { recursive: true })
  await writeFile(join(cwd, '.claude/scheduled_tasks.json'), JSON.stringify({
    tasks: [{
      id: 'desktop-auto-task',
      cron: `${scheduledNow.getMinutes()} ${scheduledNow.getHours()} * * *`,
      prompt: 'scheduled desktop automatic prompt',
      createdAt: scheduledCreatedAt.getTime(),
    }],
  }))
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('project scheduled task fired automatically')
  }, 20_000)
  const autoTaskRaw = JSON.parse(await readFile(join(cwd, '.claude/scheduled_tasks.json'), 'utf8'))
  assert(
    !autoTaskRaw.tasks.some(task => task.id === 'desktop-auto-task'),
    'automatic one-shot scheduled task was not removed after firing',
  )
  progress('checking project skill install')
  await page.getByRole('button', { name: /Settings/ }).click()
  await app.evaluate(({ dialog }) => {
    globalThis.__claudeDesktopSmokeOriginalShowOpenDialog = dialog.showOpenDialog
    globalThis.__claudeDesktopSmokeProjectSkillDialogCalls = 0
    dialog.showOpenDialog = async () => {
      globalThis.__claudeDesktopSmokeProjectSkillDialogCalls += 1
      await new Promise(resolve => setTimeout(resolve, 100))
      return {
        canceled: true,
        filePaths: [],
        bookmarks: [],
      }
    }
  })
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#settings-skills button')]
      .find(item => item.textContent?.includes('Install project skill'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Install project skill button for rapid-project-skill-install smoke')
    }
    button.click()
    button.click()
  })
  await assertSettingsStatus(page, 'Project skill install cancelled.', 'info')
  const rapidProjectSkillDialogCalls = await app.evaluate(() => globalThis.__claudeDesktopSmokeProjectSkillDialogCalls ?? 0)
  assert(
    rapidProjectSkillDialogCalls === 1,
    `rapid Install project skill opened ${rapidProjectSkillDialogCalls} folder pickers`,
  )
  await app.evaluate(({ dialog }) => {
    if (globalThis.__claudeDesktopSmokeOriginalShowOpenDialog) {
      dialog.showOpenDialog = globalThis.__claudeDesktopSmokeOriginalShowOpenDialog
      delete globalThis.__claudeDesktopSmokeOriginalShowOpenDialog
    }
  })
  await app.evaluate(({ dialog }, sourceDir) => {
    globalThis.__claudeDesktopSmokeOriginalShowOpenDialog = dialog.showOpenDialog
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [sourceDir],
      bookmarks: [],
    })
  }, installableSkill)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#settings-skills button')]
      .find(item => item.textContent?.includes('Install project skill'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Install project skill button for project-skill-install smoke')
    }
    button.click()
  })
  await assertSettingsStatus(page, 'Installed project skill.')
  await app.evaluate(({ dialog }) => {
    if (globalThis.__claudeDesktopSmokeOriginalShowOpenDialog) {
      dialog.showOpenDialog = globalThis.__claudeDesktopSmokeOriginalShowOpenDialog
      delete globalThis.__claudeDesktopSmokeOriginalShowOpenDialog
    }
  })
  const projectSkill = await page.evaluate(workspace =>
    window.claudeDesktop.workspaceSkills.list(workspace),
  cwd)
  assert(
    projectSkill.some(skill => skill.description === 'Installed through desktop GUI'),
    'project skill list did not include installed skill',
  )
  assert(
    (await readFile(join(cwd, '.claude/skills', installedSkillName, 'SKILL.md'), 'utf8'))
      .includes('Installed through desktop GUI'),
    'project skill was not copied into .claude/skills',
  )
  const projectSkillInspectBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceSkills:read'] ?? 0)
  await page
    .locator('#settings-skills article')
    .filter({ hasText: installedSkillName })
    .filter({ hasText: 'project ·' })
    .getByRole('button', { name: /Inspect/ })
    .evaluate(button => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('missing project skill Inspect button for rapid-project-skill-inspect smoke')
      }
      if (button.disabled) {
        throw new Error('project skill Inspect button stayed disabled before rapid-project-skill-inspect smoke')
      }
      button.click()
      button.click()
    })
  await waitFor(page, name => {
    const detail = document.querySelector('[aria-label="Selected skill contents"]')
    const text = detail?.textContent ?? ''
    return (
      text.includes(name) &&
      text.includes('Installed through desktop GUI') &&
      text.includes('Smoke inspect body.') &&
      text.includes('.claude/skills')
    )
  }, 10_000, installedSkillName)
  const projectSkillInspectDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceSkills:read'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), projectSkillInspectBaseline)
  assert(
    projectSkillInspectDebug.calls === 1,
    `rapid project skill Inspect submitted ${projectSkillInspectDebug.calls} reads: ${JSON.stringify(projectSkillInspectDebug)}`,
  )
  const savedProjectSkillName = 'smoke-project-saved-skill'
  await page.getByRole('button', { name: /New project skill/ }).click()
  await page.locator('#settings-skills input[aria-label="Skill name"]').fill(savedProjectSkillName)
  await page.locator('#settings-skills textarea[aria-label="Skill contents"]').fill(
    '---\ndescription: Saved project smoke skill\n---\n\nSaved into this workspace from desktop Settings.\n',
  )
  await page.getByRole('button', { name: /Save skill/ }).click()
  await assertSettingsStatus(page, `Saved project skill "${savedProjectSkillName}".`)
  assert(
    (await readFile(join(cwd, '.claude/skills', savedProjectSkillName, 'SKILL.md'), 'utf8'))
      .includes('Saved into this workspace from desktop Settings.'),
    'project skill save did not write SKILL.md',
  )
  await page.evaluate(({ workspace, name }) =>
    window.claudeDesktop.workspaceSkills.remove(workspace, name),
  { workspace: cwd, name: savedProjectSkillName })
  await page.locator('.settings-content-header').getByRole('button', { name: /^Refresh$/ }).click()
  await assertSettingsStatus(page, 'Refreshed configuration.')
  const projectSkillRemoveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceSkills:remove'] ?? 0)
  await page
    .locator('#settings-skills article')
    .filter({ hasText: installedSkillName })
    .filter({ hasText: 'project ·' })
    .getByRole('button', { name: /Remove/ })
    .evaluate(button => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('missing project skill Remove button for rapid-project-skill-remove smoke')
      }
      if (button.disabled) {
        throw new Error('project skill Remove button stayed disabled before rapid-project-skill-remove smoke')
      }
      button.click()
      button.click()
    })
  await confirmDesktopDialog(page, /Remove skill/)
  await assertSettingsStatus(page, `Removed project skill "${installedSkillName}".`)
  const projectSkillRemoveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceSkills:remove'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), projectSkillRemoveBaseline)
  assert(
    projectSkillRemoveDebug.calls === 1,
    `rapid project skill Remove submitted ${projectSkillRemoveDebug.calls} deletes: ${JSON.stringify(projectSkillRemoveDebug)}`,
  )
  await waitFor(page, name =>
    ![...document.querySelectorAll('#settings-skills article')]
      .some(item =>
        item.textContent?.includes(name) &&
        item.textContent?.includes('project ·'),
      ),
  10_000,
  installedSkillName)
  assert(
    await readFile(join(cwd, '.claude/skills', installedSkillName, 'SKILL.md'), 'utf8')
      .then(() => false, () => true),
    'project skill directory was not removed',
  )
  await waitFor(page, () => {
    const empty = document.querySelector('#settings-skills .settings-empty-state')
    return Boolean(
      empty?.querySelector('.glyph') &&
      empty?.querySelector('strong')?.textContent?.includes('No project skills installed') &&
      empty?.textContent?.includes('.claude/skills'),
    )
  })
  progress('checking project scheduled task GUI management')
  await page.getByRole('button', { name: /^Tasks$/ }).click()
  await assertPrimaryNavState(page, 'Tasks')
  const projectTaskSection = page.locator('#tasks-project-tasks')
  await projectTaskSection.getByRole('button', { name: /Add project task/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement) || !button.disabled) {
      throw new Error('empty project scheduled task form should disable Add project task')
    }
  })
  await waitFor(page, () => {
    const empty = document.querySelector('#tasks-project-tasks .task-empty-state')
    return Boolean(
      empty?.querySelector('.glyph') &&
      empty?.querySelector('strong')?.textContent?.includes('No project scheduled tasks') &&
      empty?.textContent?.includes('.claude/scheduled_tasks.json'),
    )
  })
  await projectTaskSection.locator('input[placeholder="0 9 * * *"]').fill('not a cron')
  await projectTaskSection.locator('textarea[placeholder="Prompt to run on this schedule"]').fill('project native cron prompt')
  await waitFor(page, () => {
    const section = document.querySelector('#tasks-project-tasks')
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Add project task'))
    const note = section?.querySelector('.form-note')?.textContent ?? ''
    return (
      button instanceof HTMLButtonElement &&
      button.disabled &&
      note.includes('Enter a valid 5-field cron schedule')
    )
  })
  await projectTaskSection.locator('input[placeholder="0 9 * * *"]').fill('*/5 * * * *')
  await waitFor(page, () => {
    const section = [...document.querySelectorAll('.settings-section')]
      .find(item => item.textContent?.includes('Project Scheduled Tasks'))
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Add project task'))
    return button instanceof HTMLButtonElement && !button.disabled
  })
  const projectTaskSaveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceTasks:addOrUpdate'] ?? 0)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#tasks-project-tasks button')]
      .find(item => item.textContent?.includes('Add project task'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Add project task button for rapid-project-task-save smoke')
    }
    button.click()
    button.click()
  })
  await waitForFile(join(cwd, '.claude/scheduled_tasks.json'), contents => {
    const raw = JSON.parse(contents)
    return raw.tasks?.some(task =>
      task.prompt === 'project native cron prompt' &&
      task.cron === '*/5 * * * *'
    )
  }, 5_000)
  await assertTasksStatus(page, 'Saved project scheduled task.')
  await page.waitForTimeout(200)
  const projectTasksRaw = JSON.parse(await readFile(join(cwd, '.claude/scheduled_tasks.json'), 'utf8'))
  const rapidProjectTaskSaveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceTasks:addOrUpdate'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), projectTaskSaveBaseline)
  assert(
    rapidProjectTaskSaveDebug.calls === 1,
    `rapid Add project task submitted ${rapidProjectTaskSaveDebug.calls} task saves: ${JSON.stringify(rapidProjectTaskSaveDebug)}`,
  )
  const matchingProjectTaskCount = projectTasksRaw.tasks.filter(task =>
    task.prompt === 'project native cron prompt' &&
    task.cron === '*/5 * * * *'
  ).length
  assert(
    matchingProjectTaskCount === 1,
    `rapid Add project task persisted ${matchingProjectTaskCount} matching tasks`,
  )
  const projectTask = projectTasksRaw.tasks.find(task => task.prompt === 'project native cron prompt')
  assert(projectTask?.cron === '*/5 * * * *', 'project scheduled task add did not persist')
  assert(typeof projectTask.createdAt === 'number', 'project scheduled task did not use native createdAt field')
  assert(projectTask.enabled === undefined, 'project scheduled task active file should keep native schema')
  const projectTaskArticle = projectTaskSection.locator('article').filter({ hasText: 'project native cron prompt' })
  const projectTaskPauseBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceTasks:pause'] ?? 0)
  await projectTaskArticle.evaluate(article => {
    const button = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Pause'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing project scheduled task Pause button for rapid-project-task-pause smoke')
    }
    if (button.disabled) {
      throw new Error('project scheduled task Pause button stayed disabled before rapid-project-task-pause smoke')
    }
    button.click()
    button.click()
  })
  await assertTasksStatus(page, `Paused project scheduled task "${projectTask.id}".`)
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#tasks-project-tasks article')]
      .find(item => item.textContent?.includes('project native cron prompt'))
    const runNow = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Run now'))
    return (
      article?.textContent?.includes('paused · recurring') &&
      runNow instanceof HTMLButtonElement &&
      runNow.disabled
    )
  })
  const projectTaskPauseDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceTasks:pause'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), projectTaskPauseBaseline)
  assert(
    projectTaskPauseDebug.calls === 1,
    `rapid project task Pause submitted ${projectTaskPauseDebug.calls} pauses: ${JSON.stringify(projectTaskPauseDebug)}`,
  )
  const pausedProjectTasksRaw = JSON.parse(await readFile(join(cwd, '.claude/scheduled_tasks.paused.json'), 'utf8'))
  const activeProjectTasksAfterPause = JSON.parse(await readFile(join(cwd, '.claude/scheduled_tasks.json'), 'utf8'))
  assert(
    pausedProjectTasksRaw.tasks.some(task =>
      task.id === projectTask.id &&
      task.prompt === 'project native cron prompt' &&
      task.enabled === undefined
    ),
    'project scheduled task pause did not persist to paused sidecar with native task schema',
  )
  assert(
    !activeProjectTasksAfterPause.tasks.some(task => task.id === projectTask.id),
    'project scheduled task pause did not remove the active cron',
  )
  const projectTaskResumeBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceTasks:resume'] ?? 0)
  await projectTaskArticle.evaluate(article => {
    const button = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Resume'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing project scheduled task Resume button for rapid-project-task-resume smoke')
    }
    if (button.disabled) {
      throw new Error('project scheduled task Resume button stayed disabled before rapid-project-task-resume smoke')
    }
    button.click()
    button.click()
  })
  await assertTasksStatus(page, `Resumed project scheduled task "${projectTask.id}".`)
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#tasks-project-tasks article')]
      .find(item => item.textContent?.includes('project native cron prompt'))
    const runNow = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Run now'))
    return (
      article?.textContent?.includes('enabled · recurring') &&
      runNow instanceof HTMLButtonElement &&
      !runNow.disabled
    )
  })
  const projectTaskResumeDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceTasks:resume'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), projectTaskResumeBaseline)
  assert(
    projectTaskResumeDebug.calls === 1,
    `rapid project task Resume submitted ${projectTaskResumeDebug.calls} resumes: ${JSON.stringify(projectTaskResumeDebug)}`,
  )
  const pausedProjectTasksAfterResume = JSON.parse(await readFile(join(cwd, '.claude/scheduled_tasks.paused.json'), 'utf8'))
  const activeProjectTasksAfterResume = JSON.parse(await readFile(join(cwd, '.claude/scheduled_tasks.json'), 'utf8'))
  assert(
    !pausedProjectTasksAfterResume.tasks.some(task => task.id === projectTask.id),
    'project scheduled task resume did not remove paused sidecar record',
  )
  assert(
    activeProjectTasksAfterResume.tasks.some(task =>
      task.id === projectTask.id &&
      task.prompt === 'project native cron prompt' &&
      task.enabled === undefined
    ),
    'project scheduled task resume did not restore active native cron',
  )
  const projectRunNowPromptBaseline = await page.evaluate(sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('project native cron prompt')
      ).length
    }),
  initialSessionId)
  await projectTaskSection.locator('article').filter({ hasText: 'project native cron prompt' }).evaluate(article => {
    const button = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Run now'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing project Run now button for rapid-project-scheduled-run smoke')
    }
    if (button.disabled) {
      throw new Error('project Run now button stayed disabled before rapid-project-scheduled-run smoke')
    }
    button.click()
    button.click()
  })
  await assertTasksStatus(page, `Queued project scheduled task "${projectTask.id}".`)
  await waitFor(page, ({ sessionId, baseline }) =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      const count = (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('project native cron prompt')
      ).length
      return count > baseline
    }),
  10_000, { sessionId: initialSessionId, baseline: projectRunNowPromptBaseline })
  const projectRunNowPromptCount = await page.evaluate(sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('project native cron prompt')
      ).length
    }),
  initialSessionId)
  assert(
    projectRunNowPromptCount === projectRunNowPromptBaseline + 1,
    `rapid project Run now queued ${projectRunNowPromptCount - projectRunNowPromptBaseline} prompts`,
  )
  await waitFor(page, () => (document.body.textContent ?? '').includes('project scheduled task ran now'))
  await projectTaskSection.locator('article').filter({ hasText: 'project native cron prompt' }).getByRole('button', { name: /Edit/ }).click()
  await assertTasksStatus(page, `Editing project scheduled task "${projectTask.id}".`, 'info')
  await waitFor(page, () => {
    const section = [...document.querySelectorAll('.settings-section')]
      .find(item => item.textContent?.includes('Project Scheduled Tasks'))
    const cancel = [...(section?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent?.trim() === 'Cancel edit')
    return Boolean(cancel?.querySelector('.glyph'))
  })
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#tasks-project-tasks article')]
      .find(item => item.textContent?.includes('project native cron prompt'))
    const button = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.trim() === 'Remove')
    const loading = document.querySelector('.pane-loading-status')?.textContent ?? ''
    return button instanceof HTMLButtonElement && !button.disabled && !loading
  })
  const projectScheduledTaskRemoveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceTasks:remove'] ?? 0)
  await page.evaluate(() => {
    const article = [...document.querySelectorAll('#tasks-project-tasks article')]
      .find(item => item.textContent?.includes('project native cron prompt'))
    const button = [...(article?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.trim() === 'Remove')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing project scheduled task Remove button for rapid-project-task-remove smoke')
    }
    if (button.disabled) {
      throw new Error('project scheduled task Remove button stayed disabled before rapid-project-task-remove smoke')
    }
    button.click()
    button.click()
  })
  await confirmDesktopDialog(page, /Remove task/)
  await waitFor(page, () => {
    const section = [...document.querySelectorAll('.settings-section')]
      .find(item => item.textContent?.includes('Project Scheduled Tasks'))
    return !(section?.textContent ?? '').includes('project native cron prompt')
  })
  await assertTasksStatus(page, 'Removed project scheduled task')
  const projectScheduledTaskRemoveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceTasks:remove'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), projectScheduledTaskRemoveBaseline)
  assert(
    projectScheduledTaskRemoveDebug.calls === 1,
    `rapid project scheduled task Remove submitted ${projectScheduledTaskRemoveDebug.calls} deletes: ${JSON.stringify(projectScheduledTaskRemoveDebug)}`,
  )
  await waitFor(page, () => {
    const section = document.querySelector('#tasks-project-tasks')
    const cron = section?.querySelector('input[placeholder="0 9 * * *"]')
    const prompt = section?.querySelector('textarea[aria-label="Project task prompt"]')
    const add = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Add project task'))
    const cancel = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.trim() === 'Cancel edit')
    return (
      cron instanceof HTMLInputElement &&
      prompt instanceof HTMLTextAreaElement &&
      add instanceof HTMLButtonElement &&
      cron.value === '' &&
      prompt.value === '' &&
      add.disabled &&
      !cancel
    )
  })
  await waitFor(page, () => {
    const empty = document.querySelector('#tasks-project-tasks .task-empty-state')
    return Boolean(
      empty?.querySelector('.glyph') &&
      empty?.querySelector('strong')?.textContent?.includes('No project scheduled tasks') &&
      empty?.textContent?.includes('.claude/scheduled_tasks.json'),
    )
  })
  const projectTasksRemovedRaw = JSON.parse(await readFile(join(cwd, '.claude/scheduled_tasks.json'), 'utf8'))
  assert(
    !projectTasksRemovedRaw.tasks.some(task => task.prompt === 'project native cron prompt'),
    'project scheduled task remove did not persist',
  )
  progress('checking project MCP GUI management')
  await page.getByRole('button', { name: /Settings/ }).click()
  await assertPrimaryNavState(page, 'Settings')
  const projectMcpSection = page.locator('.settings-section').filter({ hasText: 'MCP Servers' })
  await projectMcpSection.getByRole('button', { name: /Add MCP/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement) || !button.disabled) {
      throw new Error('empty project MCP form should disable Add MCP')
    }
  })
  await projectMcpSection.locator('input[placeholder="server name"]').fill('desktop-shared-mcp')
  await projectMcpSection.locator('select[aria-label="MCP server scope"]').selectOption('user')
  await projectMcpSection.locator('input[placeholder="command"]').fill('node')
  await projectMcpSection.locator('input[placeholder="args"]').fill('--version')
  await projectMcpSection.getByRole('button', { name: /Add MCP/ }).click()
  await waitFor(page, () =>
    [...document.querySelectorAll('#settings-mcp article')]
      .some(item =>
        (item.textContent ?? '').includes('desktop-shared-mcp') &&
        (item.textContent ?? '').includes('user · enabled'),
      ))
  await assertSettingsStatus(page, 'Saved MCP server.')
  const userMcpArticle = projectMcpSection
    .locator('article')
    .filter({ hasText: 'desktop-shared-mcp' })
    .filter({ hasText: 'user ·' })
  await userMcpArticle.getByRole('button', { name: /Disable/ }).click()
  await assertSettingsStatus(page, 'Disabled user MCP server "desktop-shared-mcp".')
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#settings-mcp article')]
      .find(item =>
        (item.textContent ?? '').includes('desktop-shared-mcp') &&
        (item.textContent ?? '').includes('user ·'),
      )
    return article?.textContent?.includes('user · disabled') &&
      [...(article.querySelectorAll('button') ?? [])]
        .some(button => button.textContent?.includes('Enable'))
  })
  let userMcpSettings = JSON.parse(await readFile(join(claudeHome, 'settings.json'), 'utf8'))
  assert(
    userMcpSettings.disabledMcpServers?.includes('desktop-shared-mcp'),
    'user MCP disable did not persist disabledMcpServers',
  )
  await userMcpArticle.getByRole('button', { name: /Enable/ }).click()
  await assertSettingsStatus(page, 'Enabled user MCP server "desktop-shared-mcp".')
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#settings-mcp article')]
      .find(item =>
        (item.textContent ?? '').includes('desktop-shared-mcp') &&
        (item.textContent ?? '').includes('user ·'),
      )
    return article?.textContent?.includes('user · enabled') &&
      [...(article.querySelectorAll('button') ?? [])]
        .some(button => button.textContent?.includes('Disable'))
  })
  userMcpSettings = JSON.parse(await readFile(join(claudeHome, 'settings.json'), 'utf8'))
  assert(
    !(userMcpSettings.disabledMcpServers ?? []).includes('desktop-shared-mcp'),
    'user MCP enable did not clear disabledMcpServers',
  )
  await projectMcpSection.locator('input[placeholder="server name"]').fill('desktop-shared-mcp')
  await projectMcpSection.locator('select[aria-label="MCP server scope"]').selectOption('project')
  await projectMcpSection.locator('input[placeholder="command"]').fill('node')
  await projectMcpSection.locator('input[placeholder="args"]').fill('--version')
  await projectMcpSection.getByRole('button', { name: /Add MCP/ }).click()
  await waitFor(page, () =>
    [...document.querySelectorAll('#settings-mcp article')]
      .some(item =>
        (item.textContent ?? '').includes('desktop-shared-mcp') &&
        (item.textContent ?? '').includes('project ·'),
      ))
  await assertSettingsStatus(page, 'Saved MCP server.')
  await projectMcpSection
    .locator('article')
    .filter({ hasText: 'desktop-shared-mcp' })
    .filter({ hasText: 'project ·' })
    .getByRole('button', { name: /Edit/ })
    .click()
  await assertSettingsStatus(page, 'Editing project MCP server "desktop-shared-mcp".', 'info')
  await projectMcpSection
    .locator('article')
    .filter({ hasText: 'desktop-shared-mcp' })
    .filter({ hasText: 'user ·' })
    .getByRole('button', { name: /Remove/ })
    .click()
  await confirmDesktopDialog(page, /Remove MCP/)
  await assertSettingsStatus(page, 'Removed user MCP server "desktop-shared-mcp".')
  await waitFor(page, () => {
    const section = document.querySelector('#settings-mcp')
    const name = section?.querySelector('input[aria-label="MCP server name"]')
    const scope = section?.querySelector('select[aria-label="MCP server scope"]')
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Update MCP'))
    const userArticleRemoved = ![...(section?.querySelectorAll('article') ?? [])]
      .some(item =>
        (item.textContent ?? '').includes('desktop-shared-mcp') &&
        (item.textContent ?? '').includes('user ·'),
      )
    return (
      name instanceof HTMLInputElement &&
      name.value === 'desktop-shared-mcp' &&
      scope instanceof HTMLSelectElement &&
      scope.value === 'project' &&
      button instanceof HTMLButtonElement &&
      !button.disabled &&
      userArticleRemoved
    )
  })
  await projectMcpSection.getByRole('button', { name: /^Cancel edit$/ }).click()
  await assertSettingsStatus(page, 'Cancelled MCP edit.', 'info')
  await projectMcpSection
    .locator('article')
    .filter({ hasText: 'desktop-shared-mcp' })
    .filter({ hasText: 'project ·' })
    .getByRole('button', { name: /Remove/ })
    .click()
  await confirmDesktopDialog(page, /Remove MCP/)
  await assertSettingsStatus(page, 'Removed project MCP server "desktop-shared-mcp".')
  await projectMcpSection.locator('input[placeholder="server name"]').fill('desktop-project-mcp')
  await projectMcpSection.locator('select').nth(0).selectOption('project')
  await projectMcpSection.locator('input[placeholder="command"]').fill('node')
  await projectMcpSection.locator('input[placeholder="args"]').fill('--version')
  await waitFor(page, () => {
    const section = [...document.querySelectorAll('.settings-section')]
      .find(item => item.textContent?.includes('MCP Servers'))
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Add MCP'))
    return button instanceof HTMLButtonElement && !button.disabled
  })
  await projectMcpSection.getByRole('button', { name: /Add MCP/ }).click()
  await waitFor(page, () => (document.body.textContent ?? '').includes('desktop-project-mcp'))
  await assertSettingsStatus(page, 'Saved MCP server.')
  const projectMcpRaw = JSON.parse(await readFile(join(cwd, '.mcp.json'), 'utf8'))
  assert(
    projectMcpRaw.mcpServers['desktop-project-mcp'].command === 'node',
    'project MCP add did not persist',
  )
  const projectMcpArticle = projectMcpSection.locator('article').filter({ hasText: 'desktop-project-mcp' })
  const projectMcpInspectBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceMcp:read'] ?? 0)
  await projectMcpArticle.getByRole('button', { name: /Inspect/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing project MCP Inspect button for rapid-project-mcp-inspect smoke')
    }
    if (button.disabled) {
      throw new Error('project MCP Inspect button stayed disabled before rapid-project-mcp-inspect smoke')
    }
    button.click()
    button.click()
  })
  await waitFor(page, () => {
    const detail = document.querySelector('[aria-label="Selected MCP server details"]')
    const text = detail?.textContent ?? ''
    return (
      text.includes('desktop-project-mcp') &&
      text.includes('.mcp.json') &&
      text.includes('node') &&
      text.includes('--version')
    )
  })
  const projectMcpInspectDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceMcp:read'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), projectMcpInspectBaseline)
  assert(
    projectMcpInspectDebug.calls === 1,
    `rapid project MCP Inspect submitted ${projectMcpInspectDebug.calls} reads: ${JSON.stringify(projectMcpInspectDebug)}`,
  )
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#settings-mcp article')]
      .find(item => item.textContent?.includes('desktop-project-mcp'))
    return (
      article?.textContent?.includes('project · pending') &&
      [...(article.querySelectorAll('button') ?? [])]
        .some(button => button.textContent?.includes('Approve')) &&
      [...(article.querySelectorAll('button') ?? [])]
        .some(button => button.textContent?.includes('Reject'))
    )
  })
  await projectMcpArticle.getByRole('button', { name: /Approve/ }).click()
  await assertSettingsStatus(page, 'Approved project MCP server "desktop-project-mcp".')
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#settings-mcp article')]
      .find(item => item.textContent?.includes('desktop-project-mcp'))
    return article?.textContent?.includes('project · approved')
  })
  let projectMcpLocalSettings = JSON.parse(await readFile(join(cwd, '.claude/settings.local.json'), 'utf8'))
  assert(
    projectMcpLocalSettings.enabledMcpjsonServers?.includes('desktop-project-mcp'),
    'project MCP approve did not persist enabledMcpjsonServers',
  )
  await projectMcpArticle.getByRole('button', { name: /Reject/ }).click()
  await assertSettingsStatus(page, 'Rejected project MCP server "desktop-project-mcp".')
  await waitFor(page, () => {
    const article = [...document.querySelectorAll('#settings-mcp article')]
      .find(item => item.textContent?.includes('desktop-project-mcp'))
    return article?.textContent?.includes('project · rejected')
  })
  projectMcpLocalSettings = JSON.parse(await readFile(join(cwd, '.claude/settings.local.json'), 'utf8'))
  assert(
    projectMcpLocalSettings.disabledMcpjsonServers?.includes('desktop-project-mcp') &&
      !(projectMcpLocalSettings.enabledMcpjsonServers ?? []).includes('desktop-project-mcp'),
    'project MCP reject did not persist disabledMcpjsonServers',
  )
  const mcpCheckBaseline = await countMcpCommands('list')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#settings-mcp button')]
      .find(item => item.textContent?.includes('Check MCP'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Check MCP button for rapid-mcp-check smoke')
    }
    button.click()
    button.click()
  })
  const mcpCheckCount = await waitForMcpCommandCount(
    'list',
    mcpCheckBaseline + 1,
    'rapid Check MCP command count did not advance',
  )
  await waitFor(page, () => (document.body.textContent ?? '').includes('desktop-smoke-mcp-health ok'))
  assert(
    mcpCheckCount === mcpCheckBaseline + 1,
    `rapid Check MCP ran ${mcpCheckCount - mcpCheckBaseline} MCP list commands`,
  )
  const projectMcpRemoveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceMcp:remove'] ?? 0)
  await projectMcpSection.locator('article').filter({ hasText: 'desktop-project-mcp' }).getByRole('button', { name: /Remove/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing project MCP Remove button for rapid-project-mcp-remove smoke')
    }
    if (button.disabled) {
      throw new Error('project MCP Remove button stayed disabled before rapid-project-mcp-remove smoke')
    }
    button.click()
    button.click()
  })
  await confirmDesktopDialog(page, /Remove MCP/)
  await waitFor(page, () =>
    ![...document.querySelectorAll('.settings-section article')]
      .some(item => item.textContent?.includes('desktop-project-mcp')))
  await assertSettingsStatus(page, 'Removed project MCP server "desktop-project-mcp".')
  const projectMcpRemoveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspaceMcp:remove'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), projectMcpRemoveBaseline)
  assert(
    projectMcpRemoveDebug.calls === 1,
    `rapid project MCP Remove submitted ${projectMcpRemoveDebug.calls} deletes: ${JSON.stringify(projectMcpRemoveDebug)}`,
  )
  const projectMcpRemovedRaw = JSON.parse(await readFile(join(cwd, '.mcp.json'), 'utf8'))
  assert(!projectMcpRemovedRaw.mcpServers['desktop-project-mcp'], 'project MCP remove did not persist')
  await waitFor(page, () => {
    const empty = document.querySelector('#settings-mcp .settings-empty-state')
    return Boolean(
      empty?.querySelector('.glyph') &&
      empty?.querySelector('strong')?.textContent?.includes('No project MCP servers') &&
      empty?.textContent?.includes('.mcp.json'),
    )
  })

  progress('checking Agents pane catalog, diagnostics, and launch')
  await page.getByRole('button', { name: /Agents/ }).click()
  await assertPrimaryNavState(page, 'Agents')
  await waitFor(page, () => {
    const pane = document.querySelector('.agents-pane')
    return pane ? getComputedStyle(pane).overflowY === 'auto' : false
  })
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('desktop-smoke-agent') && text.includes('Use for desktop smoke tests.')
  })
  await assertNamedFormControls(page, '.agents-pane')
  await assertNoHorizontalOverflow(page, '.agents-pane', 'agents pane')
  await assertJumpbarNoHorizontalOverflow(page, '.agents-pane', 'agents pane')
  await assertPaneCanReachSection(page, '.agents-pane', 'Running tasks', 'agents pane')
  await assertPaneJumpbar(page, '.agents-pane', 'Running', 'Running tasks', 'agents pane')
  await assertVisibleButtonLayout(page, 'agents pane')
  await assertPolishedScrollableSurfaces(page, ['.agents-pane'], 'agents pane')
  await capture(page, 'agents')
  await page.getByLabel('Primary navigation').getByRole('button', { name: /^Teams$/ }).click()
  await waitFor(page, () => {
    const active = [...document.querySelectorAll('.primary-nav button.active')]
      .map(button => button.textContent ?? '')
    const pane = document.querySelector('.teams-pane')
    const teams = document.querySelector('#agents-teams')
    const toolbar = document.querySelector('.teams-pane .pane-toolbar span')?.textContent ?? ''
    const jumpbarButtons = [...document.querySelectorAll('.teams-pane .pane-jumpbar button')]
      .map(button => button.textContent?.trim())
    return active.some(label => label.includes('Teams')) &&
      pane instanceof HTMLElement &&
      teams instanceof HTMLElement &&
      toolbar.includes('Teams') &&
      jumpbarButtons.length === 1 &&
      jumpbarButtons[0] === 'Teams' &&
      !document.querySelector('#agents-catalog') &&
      teams.getBoundingClientRect().top < pane.getBoundingClientRect().bottom
  })
  await assertNamedFormControls(page, '.teams-pane')
  await assertNoHorizontalOverflow(page, '.teams-pane', 'teams pane')
  await assertPaneJumpbar(page, '.teams-pane', 'Teams', 'Teams', 'teams pane')
  await assertPolishedScrollableSurfaces(page, ['.teams-pane'], 'teams pane')
  await assertPrimaryNavState(page, 'Teams')
  await page.getByRole('button', { name: /Agents/ }).click()
  await waitFor(page, () => {
    const active = [...document.querySelectorAll('.primary-nav button.active')]
      .map(button => button.textContent ?? '')
    const toolbar = document.querySelector('.agents-pane .pane-toolbar span')?.textContent ?? ''
    const status = document.querySelector('.agents-pane .pane-status')?.textContent ?? ''
    return (
      active.some(label => label.includes('Agents')) &&
      toolbar.includes('Agents') &&
      Boolean(document.querySelector('#agents-catalog')) &&
      !status.includes('teammate management')
    )
  })
  const agentSection = page.locator('.settings-section').filter({ hasText: 'Available agents' })
  await agentSection.locator('input[placeholder="search agents"]').fill('missing-agent')
  await waitFor(page, () => (document.body.textContent ?? '').includes('No agents match the current catalog filters.'))
  await agentSection.locator('input[placeholder="search agents"]').fill('smoke')
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('desktop-smoke-agent') && !text.includes('desktop-project-agent')
  })
  await agentSection.locator('input[placeholder="search agents"]').fill('')
  await agentSection.locator('select').selectOption('project')
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('desktop-project-agent') && text.includes('Use for project-only catalog filtering.')
  })
  await agentSection.locator('select').selectOption('active')
  await agentSection.locator('article').filter({ hasText: 'desktop-smoke-agent' }).getByRole('button', { name: /Select/ }).click()
  await assertAgentsStatus(page, 'Selected agent desktop-smoke-agent.', 'info')
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    const activeAgent = [...document.querySelectorAll('#agents-catalog article.active')]
      .find(article => article.textContent?.includes('desktop-smoke-agent'))
    return (
      text.includes('Selected agent') &&
      text.includes('desktop-smoke-agent') &&
      text.includes('Tools: Allowed: Read · Disallowed: none') &&
      text.includes('MCP: missing-smoke-mcp') &&
      activeAgent?.getAttribute('aria-current') === 'true' &&
      ![...document.querySelectorAll('.agents-pane select option')]
        .some(option => option.textContent === 'remote')
    )
  })
  await waitFor(page, () =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === window.__claudeDesktopSmokeSession?.id)
      return (
        session?.layout.selectedAgentType === 'desktop-smoke-agent' &&
        session?.layout.selectedAgentSource === 'built-in'
      )
    }),
  )
  const selectedAgentSection = page.locator('#agents-selected')
  await waitFor(page, () => {
    const buttons = [...document.querySelectorAll('#agents-selected button')]
    return (
      buttons.length === 4 &&
      buttons.every(button => button.querySelector('.glyph')) &&
      buttons.some(button => button.textContent?.includes('Diagnose')) &&
      buttons.some(button => button.textContent?.includes('New session')) &&
      buttons.some(button => button.textContent?.includes('Prepare task')) &&
      buttons.some(button => button.textContent?.includes('Override'))
    )
  })
  await capture(page, 'agents-selected')
  const originalSelectedAgentSessionId = await page.evaluate(() => window.__claudeDesktopSmokeSession?.id)
  await selectedAgentSection.getByRole('button', { name: /New session/ }).click()
  await waitFor(page, originalSessionId => {
    return window.claudeDesktop.sessions.list().then(sessions =>
      sessions.some(session =>
        session.id !== originalSessionId &&
        session.agent?.agentType === 'desktop-smoke-agent'
      ),
    )
  }, 10_000, originalSelectedAgentSessionId)
  await focusSmokeSession(page, originalSelectedAgentSessionId)
  await page.getByRole('button', { name: /Agents/ }).click()
  await selectedAgentSection.getByRole('button', { name: /Prepare task/ }).click()
  await assertAgentsStatus(page, 'Ready to run desktop-smoke-agent.', 'info')
  await waitFor(page, () => {
    const pane = document.querySelector('.agents-pane')
    const section = document.querySelector('#agents-launch')
    const input = section?.querySelector('input[placeholder="agent type"]')
    return (
      pane instanceof HTMLElement &&
      section instanceof HTMLElement &&
      input instanceof HTMLInputElement &&
      input.value === 'desktop-smoke-agent' &&
      section.getBoundingClientRect().top < pane.getBoundingClientRect().bottom
    )
  })
  await selectedAgentSection.getByRole('button', { name: /Override/ }).click()
  await assertAgentsStatus(page, 'Prepared project override for desktop-smoke-agent.', 'info')
  await waitFor(page, () => {
    const pane = document.querySelector('.agents-pane')
    const section = document.querySelector('#agents-editor')
    const type = section?.querySelector('input[placeholder="agent type"]')
    const source = section?.querySelector('select')
    return (
      pane instanceof HTMLElement &&
      section instanceof HTMLElement &&
      type instanceof HTMLInputElement &&
      source instanceof HTMLSelectElement &&
      type.value === 'desktop-smoke-agent' &&
      source.value === 'project' &&
      section.getBoundingClientRect().top < pane.getBoundingClientRect().bottom
    )
  })
  await selectedAgentSection.getByRole('button', { name: /Diagnose/ }).click()
  await assertAgentsStatus(page, 'Agent desktop-smoke-agent needs setup.', 'info')
  const agentEditorSection = page.locator('.settings-section').filter({ hasText: 'Custom agents' })
  await waitFor(page, () => {
    const section = [...document.querySelectorAll('.settings-section')]
      .find(item => item.textContent?.includes('Custom agents'))
    const deleteButton = [...(section?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent?.includes('Delete'))
    return (
      section?.textContent?.includes('Selected agent is read-only') &&
      deleteButton?.disabled === true
    )
  })
  await agentEditorSection.locator('input[placeholder="agent type"]').fill('desktop-ui-agent')
  await agentEditorSection.locator('input[placeholder="when to use this agent"]').fill('Use for editor metadata smoke tests.')
  await agentEditorSection.locator('input[placeholder="model"]').fill('sonnet')
  await agentEditorSection.locator('input[placeholder="permission mode"]').fill('acceptEdits')
  await agentEditorSection.locator('input[placeholder="tools, comma-separated"]').fill('Read, Edit')
  await agentEditorSection.locator('input[placeholder="disallowed tools, comma-separated"]').fill('Bash')
  await agentEditorSection.locator('input[placeholder="skills, comma-separated"]').fill('existing-skill')
  await agentEditorSection.locator('input[placeholder="memory scope"]').fill('project')
  await agentEditorSection.locator('input[placeholder="required MCP servers, comma-separated"]').fill('playwright')
  await agentEditorSection.locator('select').nth(1).selectOption('worktree')
  await agentEditorSection.locator('textarea[placeholder="agent system prompt"]').fill('Operate from the desktop editor smoke test.')
  await agentEditorSection.getByRole('checkbox').setChecked(true)
  const agentSaveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['agents:save'] ?? 0)
  await agentEditorSection.getByRole('button', { name: /Save agent/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Save agent button for rapid-agent-save smoke')
    }
    button.click()
    button.click()
  })
  await assertAgentsStatus(page, 'Saved agent desktop-ui-agent.')
  const agentSaveDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['agents:save'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), agentSaveBaseline)
  assert(
    agentSaveDebug.calls === 1,
    `rapid Save agent submitted ${agentSaveDebug.calls} saves: ${JSON.stringify(agentSaveDebug)}`,
  )
  const savedAgentPath = join(cwd, '.claude/agents/desktop-ui-agent.md')
  const savedAgentMarkdown = await waitForFile(
    savedAgentPath,
    contents => contents.includes('Operate from the desktop editor smoke test.'),
  )
  assert(savedAgentMarkdown.includes('model: sonnet'), 'agent editor did not save model')
  assert(savedAgentMarkdown.includes('permissionMode: acceptEdits'), 'agent editor did not save permission mode')
  assert(savedAgentMarkdown.includes('tools: Read, Edit'), 'agent editor did not save allowed tools')
  assert(savedAgentMarkdown.includes('disallowedTools: Bash'), 'agent editor did not save disallowed tools')
  assert(savedAgentMarkdown.includes('skills: existing-skill'), 'agent editor did not save skills')
  assert(savedAgentMarkdown.includes('requiredMcpServers: playwright'), 'agent editor did not save required MCP servers')
  assert(savedAgentMarkdown.includes('memory: project'), 'agent editor did not save memory')
  assert(savedAgentMarkdown.includes('isolation: worktree'), 'agent editor did not save isolation')
  assert(savedAgentMarkdown.includes('background: true'), 'agent editor did not save background')
  await waitFor(page, () => {
    const section = document.querySelector('#agents-editor')
    const deleteButton = [...(section?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent?.trim() === 'Delete')
    return deleteButton instanceof HTMLButtonElement && !deleteButton.disabled
  })
  await agentEditorSection.getByRole('button', { name: /^Delete$/ }).click()
  await waitFor(page, () => {
    const text = document.querySelector('.confirmation-modal')?.textContent ?? ''
    return text.includes('Delete agent?') && text.includes('desktop-ui-agent')
  })
  await confirmDesktopDialog(page, /Cancel/)
  const savedAgentAfterCancel = await readFile(savedAgentPath, 'utf8')
  assert(savedAgentAfterCancel.includes('Operate from the desktop editor smoke test.'), 'agent delete cancel removed the saved agent')
  const agentDeleteBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['agents:delete'] ?? 0)
  await agentEditorSection.getByRole('button', { name: /^Delete$/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Delete agent button for rapid-agent-delete smoke')
    }
    if (button.disabled) {
      throw new Error('Delete agent button stayed disabled before rapid-agent-delete smoke')
    }
    button.click()
    button.click()
  })
  await confirmDesktopDialog(page, /Delete agent/)
  await assertAgentsStatus(page, 'Deleted agent desktop-ui-agent.')
  const agentDeleteDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['agents:delete'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), agentDeleteBaseline)
  assert(
    agentDeleteDebug.calls === 1,
    `rapid Delete agent submitted ${agentDeleteDebug.calls} deletes: ${JSON.stringify(agentDeleteDebug)}`,
  )
  await waitFor(page, async filePath => {
    try {
      await readFile(filePath, 'utf8')
      return false
    } catch {
      return true
    }
  }, 10_000, savedAgentPath)
  await waitFor(page, () => {
    const input = document.querySelector('#agents-editor input[placeholder="agent type"]')
    return input instanceof HTMLInputElement && input.value === ''
  })
  await agentEditorSection.getByRole('button', { name: /^New$/ }).click()
  await waitFor(page, () => {
    const input = document.querySelector('#agents-editor input[placeholder="agent type"]')
    return input instanceof HTMLInputElement && input.value === ''
  })
  await assertAgentsStatus(page, 'Ready to create a new agent.', 'info')
  await agentSection.locator('article').filter({ hasText: 'desktop-smoke-agent' }).getByRole('button', { name: /Select/ }).click()
  await assertAgentsStatus(page, 'Selected agent desktop-smoke-agent.', 'info')
  await agentSection.locator('article').filter({ hasText: 'desktop-smoke-agent' }).getByRole('button', { name: /Diagnose/ }).click()
  await assertAgentsStatus(page, 'Agent desktop-smoke-agent needs setup.', 'info')
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return (
      text.includes('Diagnostics') &&
      text.includes('MCP servers') &&
      text.includes('Tools') &&
      text.includes('Hooks') &&
      text.includes('Memory') &&
      text.includes('Isolation') &&
      text.includes('Missing MCP: missing-smoke-mcp') &&
      text.includes('Missing skills: missing-smoke-skill')
    )
  })
  await waitFor(page, () => {
    const diagnostics = [...document.querySelectorAll('.settings-section')]
      .find(section => section.textContent?.includes('Diagnostics'))
    const buttons = [...(diagnostics?.querySelectorAll('.tool-button') ?? [])]
      .filter(button =>
        button.textContent?.includes('Open MCP settings') ||
        button.textContent?.includes('Open Skills settings'))
    return buttons.length === 2 && buttons.every(button => button.querySelector('.glyph'))
  })
  const diagnosticsSection = page.locator('.agents-pane .settings-section').filter({ hasText: 'Diagnostics' })
  await diagnosticsSection.getByRole('button', { name: /Open MCP settings/ }).click()
  await waitFor(page, () => {
    const pane = document.querySelector('.settings-content')
    const toolbar = pane?.querySelector('.settings-content-header')
    if (!(pane instanceof HTMLElement) || !(toolbar instanceof HTMLElement)) return false
    return (
      getComputedStyle(pane).overflowY === 'auto' &&
      getComputedStyle(toolbar).position === 'sticky'
    )
  })
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    const activeButtons = [...document.querySelectorAll('button.active')]
      .map(button => button.textContent ?? '')
    const mcpInput = document.querySelector('input[placeholder="server name"]')
    return (
      activeButtons.some(label => label.includes('Settings')) &&
      text.includes('MCP Servers') &&
      mcpInput instanceof HTMLInputElement &&
      mcpInput.value === 'missing-smoke-mcp'
    )
  })
  await assertPaneSectionVisible(page, '.settings-content', 'MCP Servers', 'diagnostic MCP action')
  await page.getByRole('button', { name: /Agents/ }).click()
  await diagnosticsSection.getByRole('button', { name: /Open Skills settings/ }).click()
  await assertSettingsStatus(page, 'Opened Skills settings.', 'info')
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    const activeButtons = [...document.querySelectorAll('button.active')]
      .map(button => button.textContent ?? '')
    return activeButtons.some(label => label.includes('Settings')) && text.includes('Skills')
  })
  await assertPaneSectionVisible(page, '.settings-content', 'Skills', 'diagnostic Skills action', true)
  await waitFor(page, () => {
    const glyphs = [...document.querySelectorAll('.glyph')]
      .filter(glyph => glyph.getClientRects().length > 0)
    return glyphs.length > 10 && glyphs.every(glyph => {
      const rect = glyph.getBoundingClientRect()
      const expected = glyph.closest('.empty-state')
        ? 28
        : glyph.closest('.workarea-empty')
          ? 24
          : 16
      return Math.round(rect.width) === expected && Math.round(rect.height) === expected
    })
  })
  await waitFor(page, () => {
    const iconButtons = [...document.querySelectorAll('button')]
      .filter(button => button.querySelector('.glyph'))
    return iconButtons.every(button =>
      Boolean(button.textContent?.trim() || button.getAttribute('aria-label') || button.getAttribute('title')),
    )
  })
  await waitFor(page, () => {
    const iconOnlyButtons = [...document.querySelectorAll('button.icon-button, button.tool-button.icon-only, .pane-tabs button')]
    return iconOnlyButtons.length >= 13 && iconOnlyButtons.every(button => {
      const tooltip = button.getAttribute('data-tooltip')?.trim()
      const name = button.getAttribute('aria-label')?.trim() || button.getAttribute('title')?.trim()
      return Boolean(tooltip && name && (tooltip === name || name.startsWith(tooltip) || tooltip.startsWith(name)))
    })
  })
  await page.getByRole('button', { name: /Chat/ }).click()
  await assertPrimaryNavState(page, 'Chat')
  await page.locator('.pane-tabs button[aria-label="Files"]').hover()
  await waitFor(page, () => {
    const button = document.querySelector('.pane-tabs button[aria-label="Files"]')
    if (!(button instanceof HTMLElement)) return false
    const rect = button.getBoundingClientRect()
    const style = getComputedStyle(button, '::after')
    if (style.opacity !== '1' || style.content === 'none') return false
    const top = Number.parseFloat(style.top)
    if (!Number.isFinite(top)) return false
    const tooltipTop = rect.top + top
    const height = Number.parseFloat(style.height)
    const lineHeight = Number.parseFloat(style.lineHeight)
    const paddingTop = Number.parseFloat(style.paddingTop)
    const paddingBottom = Number.parseFloat(style.paddingBottom)
    const tooltipHeight = Number.isFinite(height)
      ? height
      : Number.isFinite(lineHeight) && Number.isFinite(paddingTop) && Number.isFinite(paddingBottom)
        ? lineHeight + paddingTop + paddingBottom
        : 24
    return (
      tooltipTop >= 0 &&
      tooltipTop >= rect.bottom &&
      tooltipTop + tooltipHeight <= window.innerHeight
    )
  })
  await waitFor(page, () => {
    const tabs = document.querySelector('.pane-tabs')
    return tabs ? tabs.scrollWidth <= tabs.clientWidth + 1 : false
  })
  await page.getByRole('button', { name: /Agents/ }).click()
  await waitFor(page, () => {
    const rows = [...document.querySelectorAll('.agents-pane .form-row')]
      .filter(row => row.getClientRects().length > 0)
    return rows.length > 0 && rows.every(row => row.scrollWidth <= row.clientWidth + 1)
  })
  await agentSection.locator('article').filter({ hasText: 'desktop-smoke-agent' }).getByRole('button', { name: /Select/ }).click()
  const launchSection = page.locator('.settings-section').filter({ hasText: 'Launch' })
  const originalAgentGuiSessionId = await page.evaluate(() => window.__claudeDesktopSmokeSession?.id)
  await launchSection.locator('input[placeholder="agent type"]').fill('')
  await launchSection.locator('input[placeholder="short task description"]').fill('desktop smoke invalid launch')
  await launchSection.locator('textarea[placeholder="task prompt for the selected agent"]').fill('missing agent type prompt')
  await waitFor(page, () => {
    const section = document.querySelector('#agents-launch')
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Launch task'))
    const note = section?.querySelector('.form-note')?.textContent ?? ''
    return (
      button instanceof HTMLButtonElement &&
      button.disabled &&
      note.includes('Choose an agent type before launching a task')
    )
  })
  await agentSection.locator('article').filter({ hasText: 'desktop-smoke-agent' }).getByRole('button', { name: /Select/ }).click()
  await launchSection.locator('input[placeholder="permission mode"]').fill('acceptEdits')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#agents-launch button')]
      .find(item => item.textContent?.includes('New agent session'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing New agent session button for rapid-agent-session smoke')
    }
    button.click()
    button.click()
  })
  await waitFor(page, originalSessionId => {
    return window.claudeDesktop.sessions.list().then(sessions =>
      sessions.filter(session =>
        session.id !== originalSessionId &&
        session.agent?.agentType === 'desktop-smoke-agent' &&
        session.agent?.permissionMode === 'acceptEdits'
      ).length > 0,
    )
  }, 10_000, originalAgentGuiSessionId)
  const createdAgentSessions = await page.evaluate(originalSessionId =>
    window.claudeDesktop.sessions.list().then(sessions =>
      sessions.filter(session =>
        session.id !== originalSessionId &&
        session.agent?.agentType === 'desktop-smoke-agent' &&
        session.agent?.permissionMode === 'acceptEdits'
      ).length,
    ),
  originalAgentGuiSessionId)
  assert(
    createdAgentSessions === 1,
    `rapid New agent session created ${createdAgentSessions} agent sessions`,
  )
  await focusSmokeSession(page, originalAgentGuiSessionId)
  await waitFor(page, title => {
    const active = document.querySelector('.session-row.active')
    return active?.querySelector('strong')?.textContent?.trim() === title
  }, 10_000, primarySessionTitle)
  await waitFor(page, () => {
    const pane = document.querySelector('.agents-pane')
    return pane?.getAttribute('aria-busy') === 'false' && !pane.querySelector('.pane-loading-status')
  })
  await launchSection.locator('input[placeholder="short task description"]').fill('desktop smoke agent task')
  await launchSection.locator('textarea[placeholder="task prompt for the selected agent"]').fill('inspect agent gui smoke path')
  const launchPromptBaseline = await page.evaluate(sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('Use the Agent tool exactly once') &&
        message.text.includes('desktop smoke agent task')
      ).length
    }),
  originalAgentGuiSessionId)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#agents-launch button')]
      .find(item => item.textContent?.includes('Launch task'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Launch task button for rapid-launch-task smoke')
    }
    button.click()
    button.click()
  })
  await assertAgentsStatus(page, 'Launched agent task "desktop smoke agent task".')
  await waitFor(page, ({ sessionId, baseline }) =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      const count = (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('Use the Agent tool exactly once') &&
        message.text.includes('desktop smoke agent task')
      ).length
      return count > baseline
    }),
  10_000, { sessionId: originalAgentGuiSessionId, baseline: launchPromptBaseline })
  const launchPromptCount = await page.evaluate(sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('Use the Agent tool exactly once') &&
        message.text.includes('desktop smoke agent task')
      ).length
    }),
  originalAgentGuiSessionId)
  assert(
    launchPromptCount === launchPromptBaseline + 1,
    `rapid Launch task sent ${launchPromptCount - launchPromptBaseline} agent launch prompts`,
  )
  await waitFor(page, expectedSessionId => {
    return window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === expectedSessionId)
      return session?.agentTasks?.some(task =>
        task.id === 'agent-smoke-1' &&
        task.agentType === 'desktop-smoke-agent' &&
        task.description === 'desktop smoke agent task' &&
        task.toolTimeline?.some(event => event.toolName === 'Agent' && event.status === 'completed')
      ) && session.toolUses?.some(event => event.toolName === 'Agent' && event.status === 'completed')
    })
  }, 10_000, originalAgentGuiSessionId)
  const visibleAgentToolResults = await page.evaluate(() =>
    [...document.querySelectorAll('.message-user')]
      .filter(message => {
        const text = message.textContent ?? ''
        return text.includes('"status":"async_launched"') ||
          text.includes('"agentId":"agent-smoke-1"') ||
          text.includes('agent task launched')
      })
      .length,
  )
  assert(
    visibleAgentToolResults === 0,
    `agent tool results leaked into visible user chat: ${visibleAgentToolResults}`,
  )
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return (
      text.includes('desktop smoke agent task') &&
      text.includes('desktop-smoke-agent') &&
      text.includes('321 tokens') &&
      text.includes('Session tool uses') &&
      text.includes('Agent · completed')
    )
  })
  await waitFor(page, () => {
    const taskSection = document.querySelector('#agents-tasks')
    const buttons = [...(taskSection?.querySelectorAll('.section-actions .tool-button') ?? [])]
    return buttons.length >= 4 && buttons.every(button => button.querySelector('.glyph'))
  })
  const agentTaskSection = page.locator('#agents-tasks')
  const readOutputControlBaseline = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#agents-tasks button')]
      .find(item => item.textContent?.includes('Read output'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Read output button for rapid-read-output smoke')
    }
    button.click()
    button.click()
  })
  await assertAgentsStatus(page, 'Requested output for task agent-smoke-1.')
  await waitFor(page, baseline => {
    const count = [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length
    return count > baseline
  }, 10_000, readOutputControlBaseline)
  const readOutputControlCount = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  assert(
    readOutputControlCount === readOutputControlBaseline + 1,
    `rapid Read output sent ${readOutputControlCount - readOutputControlBaseline} agent task control requests`,
  )
  await agentTaskSection.getByRole('button', { name: /Preview file/ }).click()
  await assertAgentsStatus(page, 'Previewed output for task agent-smoke-1.')
  await waitFor(page, () => {
    const text = document.querySelector('#agents-tasks')?.textContent ?? ''
    return text.includes('desktop smoke agent output preview')
  })
  await agentTaskSection.locator('input[aria-label="Agent task resume prompt"]').fill('desktop smoke resume follow-up')
  const resumeControlBaseline = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#agents-tasks button')]
      .find(item => item.textContent?.includes('Resume'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Resume button for rapid-resume smoke')
    }
    button.click()
    button.click()
  })
  await assertAgentsStatus(page, 'Resumed agent task agent-smoke-1.')
  await waitFor(page, baseline => {
    const count = [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length
    return count > baseline
  }, 10_000, resumeControlBaseline)
  const resumeControlCount = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  assert(
    resumeControlCount === resumeControlBaseline + 1,
    `rapid Resume sent ${resumeControlCount - resumeControlBaseline} agent task control requests`,
  )
  await waitFor(page, () => {
    const input = document.querySelector('#agents-tasks input[aria-label="Agent task resume prompt"]')
    return input instanceof HTMLInputElement && input.value === ''
  })
  const stopControlBaseline = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#agents-tasks button')]
      .find(item => item.textContent?.trim() === 'Stop')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Stop button for rapid-agent-stop smoke')
    }
    button.click()
    button.click()
  })
  await assertAgentsStatus(page, 'Stopped agent task agent-smoke-1.')
  await waitFor(page, baseline => {
    const count = [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length
    return count > baseline
  }, 10_000, stopControlBaseline)
  const stopControlCount = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  assert(
    stopControlCount === stopControlBaseline + 1,
    `rapid Stop sent ${stopControlCount - stopControlBaseline} agent task control requests`,
  )
  const teamApiResult = await page.evaluate(workspace =>
    window.claudeDesktop.teams.list(workspace),
  cwd)
  assert(
    teamApiResult.some(team =>
      team.name === 'frontend' &&
      team.backend === 'local' &&
      team.mode === 'parallel' &&
      team.status === 'running' &&
      team.active === true &&
      team.members.some(member =>
        member.name === 'alice' &&
        member.color === 'blue' &&
        member.mode === 'plan' &&
        member.status === 'active'
      )
    ),
    `team metadata API did not include smoke team: ${JSON.stringify(teamApiResult)}`,
  )
  const agentsRefreshBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['agents:refresh'] ?? 0)
  await page.evaluate(() => {
    const refresh = [...document.querySelectorAll('.agents-pane .pane-toolbar button')]
      .find(button => button.textContent?.includes('Refresh'))
    if (!(refresh instanceof HTMLButtonElement)) {
      throw new Error('missing Agents Refresh button for rapid-agents-refresh smoke')
    }
    refresh.click()
    refresh.click()
  })
  await page.waitForTimeout(350)
  const rapidAgentsRefreshDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['agents:refresh'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), agentsRefreshBaseline)
  assert(
    rapidAgentsRefreshDebug.calls === 1,
    `rapid Agents Refresh submitted ${rapidAgentsRefreshDebug.calls} refreshes: ${JSON.stringify(rapidAgentsRefreshDebug)}`,
  )
  await assertAgentsStatus(page, 'Refreshed agents and teams.')
  await page.getByLabel('Primary navigation').getByRole('button', { name: /^Teams$/ }).click()
  await page.getByRole('region', { name: /Team management/ }).waitFor()
  await waitFor(page, () => {
    const teamSection = [...document.querySelectorAll('.settings-section')]
      .find(section => section.textContent?.includes('Teams'))
    const teamText = teamSection?.textContent?.replace(/\s+/g, ' ') ?? ''
    const memberButton = [...(teamSection?.querySelectorAll('.team-member-select') ?? [])]
      .find(button => button.textContent?.includes('@alice'))
    const memberText = memberButton?.textContent?.replace(/\s+/g, ' ') ?? ''
    return (
      teamText.includes('frontend') &&
      teamText.includes('Desktop smoke team') &&
      teamText.includes('1 member · local · parallel · running · active') &&
      memberText.includes('@alice') &&
      memberText.includes('blue · plan · active')
    )
  })
  await waitFor(page, () => {
    const teamsSection = [...document.querySelectorAll('.settings-section')]
      .find(section => section.textContent?.includes('Teams'))
    const select = [...(teamsSection?.querySelectorAll('.tool-button') ?? [])]
      .find(button => button.textContent?.trim() === 'Select')
    const messageAll = [...(teamsSection?.querySelectorAll('.tool-button') ?? [])]
      .find(button => button.textContent?.trim() === 'Message all')
    const message = teamsSection?.querySelector('button[aria-label="Message alice"]')
    return Boolean(
      select?.querySelector('.glyph') &&
      messageAll?.querySelector('.glyph') &&
      message?.querySelector('.glyph'),
    )
  })
  await capture(page, 'teams')
  await page.locator('#agents-teams article').filter({ hasText: 'frontend' }).getByRole('button', { name: /Message all/ }).click()
  await assertTeamsStatus(page, 'Ready to message all teammates in team frontend.', 'info')
  await waitFor(page, () => {
    const recipient = document.querySelector('#agents-teams input[aria-label="Team message recipient"]')
    const message = document.querySelector('#agents-teams textarea[aria-label="Team message"]')
    const chatTarget = document.querySelector('select[aria-label="Send message to"]')
    const targetTeam = document.querySelector('select[aria-label="Target team"]')
    return (
      recipient instanceof HTMLInputElement &&
      message instanceof HTMLTextAreaElement &&
      recipient.value === '*' &&
      document.activeElement === message &&
      chatTarget instanceof HTMLSelectElement &&
      chatTarget.value === 'team' &&
      targetTeam instanceof HTMLSelectElement &&
      targetTeam.value === 'frontend'
    )
  })
  await page.locator('#agents-teams button[aria-label="Message alice"]').click()
  await assertTeamsStatus(page, 'Ready to message alice in team frontend.', 'info')
  await waitFor(page, () => {
    const recipient = document.querySelector('#agents-teams input[aria-label="Team message recipient"]')
    const message = document.querySelector('#agents-teams textarea[aria-label="Team message"]')
    const chatTarget = document.querySelector('select[aria-label="Send message to"]')
    const targetTeam = document.querySelector('select[aria-label="Target team"]')
    return (
      recipient instanceof HTMLInputElement &&
      message instanceof HTMLTextAreaElement &&
      recipient.value === 'alice' &&
      document.activeElement === message &&
      chatTarget instanceof HTMLSelectElement &&
      chatTarget.value === 'team' &&
      targetTeam instanceof HTMLSelectElement &&
      targetTeam.value === 'frontend'
    )
  })
  await page.locator('#agents-teams input[aria-label="Team name"]').fill('')
  await page.locator('#agents-teams').getByRole('button', { name: /Delete team/ }).evaluate(button => {
    if (!(button instanceof HTMLButtonElement) || !button.disabled) {
      throw new Error('empty team name should disable Delete team')
    }
  })
  await page.locator('#agents-teams article').filter({ hasText: 'frontend' }).getByRole('button', { name: /Select/ }).click()
  await waitFor(page, () => {
    const input = document.querySelector('#agents-teams input[aria-label="Team name"]')
    const activeTeam = [...document.querySelectorAll('#agents-teams article.active')]
      .find(article => article.textContent?.includes('frontend'))
    return (
      input instanceof HTMLInputElement &&
      input.value === 'frontend' &&
      activeTeam?.getAttribute('aria-current') === 'true'
    )
  })
  await assertTeamsStatus(page, 'Selected team frontend.', 'info')
  await waitFor(page, sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return (
        session?.layout.selectedTeamName === 'frontend' &&
        session?.layout.selectedTeamRecipient === '*'
      )
    }),
  10_000, originalAgentGuiSessionId)
  await page.locator('#agents-teams input[aria-label="Team teammate agent type"]').fill('desktop-smoke-agent')
  await page.locator('#agents-teams input[aria-label="Team teammate name"]').fill('bob')
  await page.locator('#agents-teams input[aria-label="Team teammate mode"]').fill('plan')
  await page.locator('#agents-teams textarea[aria-label="Team teammate prompt"]').fill('inspect team spawn path')
  await waitFor(page, sessionId =>
    window.claudeDesktop.sessions.list().then(sessions =>
      sessions.find(session => session.id === sessionId)?.activity === 'idle',
    ),
  10_000, originalAgentGuiSessionId)
  const teamSpawnPromptBaseline = await page.evaluate(sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('Use the Agent tool exactly once') &&
        message.text.includes('"team_name": "frontend"') &&
        message.text.includes('"name": "bob"')
      ).length
    }),
  originalAgentGuiSessionId)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#agents-teams button')]
      .find(item => item.textContent?.trim() === 'Spawn teammate')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Spawn teammate button for rapid-team-spawn smoke')
    }
    if (button.disabled) {
      throw new Error('Spawn teammate button stayed disabled before rapid-team-spawn smoke')
    }
    button.click()
    button.click()
  })
  await assertTeamsStatus(page, 'Spawned teammate bob.')
  await waitFor(page, ({ sessionId, baseline }) =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      const count = (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('Use the Agent tool exactly once') &&
        message.text.includes('"team_name": "frontend"') &&
        message.text.includes('"name": "bob"') &&
        message.text.includes('"mode": "plan"')
      ).length
      return count > baseline
    }),
  10_000, { sessionId: originalAgentGuiSessionId, baseline: teamSpawnPromptBaseline })
  const teamSpawnPromptCount = await page.evaluate(sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return (session?.messages ?? []).filter(message =>
        message.role === 'user' &&
        message.text.includes('Use the Agent tool exactly once') &&
        message.text.includes('"team_name": "frontend"') &&
        message.text.includes('"name": "bob"')
      ).length
    }),
  originalAgentGuiSessionId)
  assert(
    teamSpawnPromptCount === teamSpawnPromptBaseline + 1,
    `rapid Spawn teammate sent ${teamSpawnPromptCount - teamSpawnPromptBaseline} agent launch prompts`,
  )
  await waitFor(page, () => {
    const name = document.querySelector('#agents-teams input[aria-label="Team teammate name"]')
    const prompt = document.querySelector('#agents-teams textarea[aria-label="Team teammate prompt"]')
    return (
      name instanceof HTMLInputElement &&
      name.value === '' &&
      prompt instanceof HTMLTextAreaElement &&
      prompt.value === ''
    )
  })
  await page.locator('#agents-teams input[aria-label="Team message recipient"]').fill('alice')
  await page.locator('#agents-teams textarea[aria-label="Team message"]').fill('desktop smoke team message')
  await waitFor(page, sessionId =>
    window.claudeDesktop.sessions.list().then(sessions =>
      sessions.find(session => session.id === sessionId)?.activity === 'idle',
    ),
  10_000, originalAgentGuiSessionId)
  const teamSendControlBaseline = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#agents-teams button')]
      .find(item => item.textContent?.trim() === 'Send')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Send button for rapid-team-send smoke')
    }
    button.click()
    button.click()
  })
  await assertTeamsStatus(page, 'Sent team message to alice.')
  await waitFor(page, baseline => {
    const count = [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length
    return count > baseline
  }, 10_000, teamSendControlBaseline)
  const teamSendControlCount = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  assert(
    teamSendControlCount === teamSendControlBaseline + 1,
    `rapid Team Send sent ${teamSendControlCount - teamSendControlBaseline} control requests`,
  )
  await waitFor(page, () => {
    const message = document.querySelector('#agents-teams textarea[aria-label="Team message"]')
    return message instanceof HTMLTextAreaElement && message.value === ''
  })
  const teammateShutdownControlBaseline = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  await page.evaluate(() => {
    const button = document.querySelector('#agents-teams button[aria-label="Shutdown alice"]')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing teammate row Shutdown button for rapid-team-member-shutdown smoke')
    }
    if (!button.querySelector('.glyph')) {
      throw new Error('teammate row Shutdown button is missing an icon')
    }
    button.click()
    button.click()
  })
  await assertTeamsStatus(page, 'Requested shutdown for alice.')
  await waitFor(page, baseline => {
    const count = [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length
    return count > baseline
  }, 10_000, teammateShutdownControlBaseline)
  const teammateShutdownControlCount = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  assert(
    teammateShutdownControlCount === teammateShutdownControlBaseline + 1,
    `rapid Teammate Shutdown sent ${teammateShutdownControlCount - teammateShutdownControlBaseline} control requests`,
  )
  await page.locator('#agents-teams input[aria-label="Team shutdown reason"]').fill('desktop smoke shutdown')
  const teamShutdownControlBaseline = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#agents-teams button')]
      .find(item => item.textContent?.trim() === 'Shutdown')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Shutdown button for rapid-team-shutdown smoke')
    }
    button.click()
    button.click()
  })
  await assertTeamsStatus(page, 'Requested shutdown for alice.')
  await waitFor(page, baseline => {
    const count = [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length
    return count > baseline
  }, 10_000, teamShutdownControlBaseline)
  const teamShutdownControlCount = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message => (message.textContent ?? '').includes('desktop control request accepted'))
      .length,
  )
  assert(
    teamShutdownControlCount === teamShutdownControlBaseline + 1,
    `rapid Team Shutdown sent ${teamShutdownControlCount - teamShutdownControlBaseline} control requests`,
  )
  await waitFor(page, () => {
    const reason = document.querySelector('#agents-teams input[aria-label="Team shutdown reason"]')
    return reason instanceof HTMLInputElement && reason.value === ''
  })
  const teammateRemoveBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['teams:removeMember'] ?? 0)
  await page.evaluate(() => {
    const button = document.querySelector('#agents-teams button[aria-label="Remove alice from frontend"]')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing teammate row Remove button for rapid-team-member-remove smoke')
    }
    if (!button.querySelector('.glyph')) {
      throw new Error('teammate row Remove button is missing an icon')
    }
    button.click()
    button.click()
  })
  await waitFor(page, () => {
    const modals = [...document.querySelectorAll('.confirmation-modal')]
    const text = modals[0]?.textContent ?? ''
    return modals.length === 1 &&
      text.includes('Remove teammate?') &&
      text.includes('alice') &&
      text.includes('frontend')
  })
  await confirmDesktopDialog(page, /Remove teammate/)
  await assertTeamsStatus(page, 'Removed teammate alice from team frontend.')
  await waitFor(page, workspace =>
    window.claudeDesktop.teams.list(workspace).then(teams => {
      const team = teams.find(item => item.name === 'frontend')
      return Boolean(
        team &&
        !team.members.some(member => member.name === 'alice') &&
        team.members.some(member => member.name === 'bob'),
      )
    }),
  10_000, cwd)
  const teammateRemoveCount = await app.evaluate(({ app: electronApp }, baseline) =>
    (electronApp.__claudeDesktopSmokeIpcCalls?.['teams:removeMember'] ?? 0) - baseline,
  teammateRemoveBaseline)
  assert(
    teammateRemoveCount === 1,
    `rapid Teammate Remove submitted ${teammateRemoveCount} remove requests`,
  )
  await waitFor(page, () => {
    const teamsSection = document.querySelector('#agents-teams')
    const text = teamsSection?.textContent ?? ''
    const recipient = document.querySelector('#agents-teams input[aria-label="Team message recipient"]')
    return (
      !text.includes('@alice') &&
      text.includes('@bob') &&
      recipient instanceof HTMLInputElement &&
      recipient.value === ''
    )
  })
  const smokeTeamName = 'desktop-smoke-created-team'
  await page.locator('#agents-teams input[aria-label="Team name"]').fill(smokeTeamName)
  await page.locator('#agents-teams input[aria-label="Team lead agent type"]').fill('desktop-smoke-agent')
  await page.locator('#agents-teams input[aria-label="Team purpose"]').fill('Created by Electron smoke')
  await page.locator('#agents-teams').getByRole('button', { name: /Create team/ }).click()
  await assertTeamsStatus(page, `Created team ${smokeTeamName}.`)
  await waitFor(page, () => {
    const button = [...document.querySelectorAll('#agents-teams button')]
      .find(item => item.textContent?.trim() === 'Delete team')
    const loading = document.querySelector('.pane-loading-status')?.textContent ?? ''
    return button instanceof HTMLButtonElement && !button.disabled && !loading
  })
  const teamDeleteBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['teams:delete'] ?? 0)
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#agents-teams button')]
      .find(item => item.textContent?.trim() === 'Delete team')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Delete team button for rapid-team-delete smoke')
    }
    if (button.disabled) {
      throw new Error('Delete team button stayed disabled before rapid-team-delete smoke')
    }
    button.click()
    button.click()
  })
  await confirmDesktopDialog(page, /Delete team/)
  await assertTeamsStatus(page, `Deleted team ${smokeTeamName}.`)
  const teamDeleteDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['teams:delete'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), teamDeleteBaseline)
  assert(
    teamDeleteDebug.calls === 1,
    `rapid Delete team submitted ${teamDeleteDebug.calls} team deletes: ${JSON.stringify(teamDeleteDebug)}`,
  )
  await waitFor(page, () => {
    const section = document.querySelector('#agents-teams')
    const teamName = section?.querySelector('input[aria-label="Team name"]')
    const agentType = section?.querySelector('input[aria-label="Team lead agent type"]')
    const purpose = section?.querySelector('input[aria-label="Team purpose"]')
    const deleteButton = [...(section?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent?.includes('Delete team'))
    return (
      teamName instanceof HTMLInputElement &&
      teamName.value === '' &&
      agentType instanceof HTMLInputElement &&
      agentType.value === '' &&
      purpose instanceof HTMLInputElement &&
      purpose.value === '' &&
      deleteButton instanceof HTMLButtonElement &&
      deleteButton.disabled
    )
  })

  progress('checking composer target routing')
  await waitFor(page, sessionId =>
    window.claudeDesktop.sessions.list().then(sessions =>
      sessions.find(session => session.id === sessionId)?.activity === 'idle',
    ),
  10_000, originalAgentGuiSessionId)
  await page.getByRole('button', { name: /Chat/ }).click()
  await assertPrimaryNavState(page, 'Chat')
  await page.locator('select[aria-label="Send message to"]').selectOption('team')
  await page.locator('select[aria-label="Target team"]').selectOption('frontend')
  await page.locator('textarea[placeholder^="Ask Claude"]').fill('composer team route')
  const composerTeamBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['teams:send'] ?? 0)
  await page.locator('.composer').getByRole('button', { name: /Send/ }).click()
  await waitFor(page, () => {
    const status = document.querySelector('.conversation-status')?.textContent ?? ''
    const input = document.querySelector('.composer textarea')
    return status.includes('Sent message to team frontend.') &&
      input instanceof HTMLTextAreaElement &&
      input.value === ''
  })
  const composerTeamCalls = await app.evaluate(({ app: electronApp }, baseline) =>
    (electronApp.__claudeDesktopSmokeIpcCalls?.['teams:send'] ?? 0) - baseline,
  composerTeamBaseline)
  assert(composerTeamCalls === 1, `composer team target submitted ${composerTeamCalls} sends`)
  await waitFor(page, sessionId =>
    window.claudeDesktop.sessions.list().then(sessions =>
      sessions.find(session => session.id === sessionId)?.activity === 'idle',
    ),
  10_000, originalAgentGuiSessionId)
  await page.locator('select[aria-label="Send message to"]').selectOption('agent')
  await page.locator('select[aria-label="Target agent"]').selectOption('desktop-smoke-agent')
  await page.locator('textarea[placeholder^="Ask Claude"]').fill('composer agent route')
  const composerAgentBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:launchAgentTask'] ?? 0)
  await page.locator('.composer').getByRole('button', { name: /Send/ }).click()
  await waitFor(page, () => {
    const status = document.querySelector('.conversation-status')?.textContent ?? ''
    const input = document.querySelector('.composer textarea')
    return status.includes('Sent message to agent desktop-smoke-agent.') &&
      input instanceof HTMLTextAreaElement &&
      input.value === ''
  })
  const composerAgentCalls = await app.evaluate(({ app: electronApp }, baseline) =>
    (electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:launchAgentTask'] ?? 0) - baseline,
  composerAgentBaseline)
  assert(composerAgentCalls === 1, `composer agent target submitted ${composerAgentCalls} launches`)
  await waitFor(page, sessionId =>
    window.claudeDesktop.sessions.list().then(sessions =>
      sessions.find(session => session.id === sessionId)?.activity === 'idle',
    ),
  10_000, originalAgentGuiSessionId)
  await page.locator('select[aria-label="Send message to"]').selectOption('session')

  progress('creating and switching sessions')
  const focusResult = await page.evaluate(async ({ secondWorkspace, emptyWorkspace }) => {
    const first = window.__claudeDesktopSmokeSession
    const second = await window.claudeDesktop.sessions.create(secondWorkspace)
    const empty = await window.claudeDesktop.sessions.create(emptyWorkspace)
    const sessions = await window.claudeDesktop.sessions.list()
    window.__claudeDesktopSecondSession = second
    window.__claudeDesktopEmptySession = empty
    return { first: first.id, second: second.id, empty: empty.id, secondTitle: second.title, sessionCount: sessions.length }
  }, { secondWorkspace: secondCwd, emptyWorkspace: emptyCwd })
  await focusSmokeSession(page, focusResult.empty)
  await waitFor(page, () => {
    const active = document.querySelector('.session-row.active')?.textContent ?? ''
    return active.includes('empty')
  })
  await page.getByRole('button', { name: /Sessions/ }).click()
  await waitFor(page, () => {
    const toggle = document.querySelector('.rail-section-toggle')
    return toggle?.getAttribute('aria-expanded') === 'false' &&
      !document.querySelector('.session-list') &&
      window.localStorage.getItem('claudeDesktop.sessionRailCollapsed') === 'true'
  })
  const collapsedRailSummary = await page.evaluate(expectedCount => {
    const toggle = document.querySelector('.rail-section-toggle')
    const count = toggle?.querySelector('.rail-section-count')
    const toggleRect = toggle?.getBoundingClientRect()
    const countRect = count?.getBoundingClientRect()
    return {
      label: toggle?.getAttribute('aria-label') ?? '',
      text: toggle?.textContent ?? '',
      count: count?.textContent ?? '',
      countFits: Boolean(
        toggleRect &&
          countRect &&
          countRect.left >= toggleRect.left &&
          countRect.right <= toggleRect.right,
      ),
      expected: String(expectedCount),
    }
  }, focusResult.sessionCount)
  assert(
    collapsedRailSummary.count === collapsedRailSummary.expected &&
      collapsedRailSummary.label.includes(`${focusResult.sessionCount} sessions`) &&
      collapsedRailSummary.text.includes('Sessions') &&
      collapsedRailSummary.countFits,
    `collapsed session rail did not expose a stable count: ${JSON.stringify(collapsedRailSummary)}`,
  )
  await page.getByRole('button', { name: /Sessions/ }).click()
  await waitFor(page, () => {
    const toggle = document.querySelector('.rail-section-toggle')
    return toggle?.getAttribute('aria-expanded') === 'true' &&
      Boolean(document.querySelector('.session-list')) &&
      window.localStorage.getItem('claudeDesktop.sessionRailCollapsed') === 'false'
  })
  await page.getByRole('button', { name: /Files/ }).click()
  await waitFor(page, () => {
    const text = document.querySelector('.file-tree')?.textContent ?? ''
    return text.includes('No files found')
  })
  const filesEmptyState = await page.evaluate(() => {
    const placeholder = document.querySelector('.file-tree-empty')
    return {
      hasIcon: Boolean(placeholder?.querySelector('.glyph')),
      hasTitle: Boolean(placeholder?.querySelector('strong')?.textContent?.includes('No files found')),
      hasDetails: Boolean(placeholder?.textContent?.includes('Create or open files in this project to edit them here.')),
    }
  })
  assert(
    filesEmptyState.hasIcon && filesEmptyState.hasTitle && filesEmptyState.hasDetails,
    `files empty state is too sparse: ${JSON.stringify(filesEmptyState)}`,
  )
  await focusSmokeSession(page, focusResult.first)
  const rapidFocusTargetReady = await waitFor(page, ({ firstTitle, secondTitle }) => {
    const active = document.querySelector('.session-row.active')
    const target = [...document.querySelectorAll('.session-row')]
      .find(item => (item.textContent ?? '').includes(secondTitle))
    return {
      ready: Boolean(
        active?.textContent?.includes(firstTitle) &&
          target instanceof HTMLButtonElement &&
          target.disabled === false &&
          !target.classList.contains('active') &&
          window.__claudeDesktopSmokeSessionFocusInFlight?.() === false,
      ),
      firstTitle,
      secondTitle,
      activeText: active?.textContent ?? '',
      targetText: target?.textContent ?? '',
      targetDisabled: target instanceof HTMLButtonElement ? target.disabled : undefined,
      focusInFlight: window.__claudeDesktopSmokeSessionFocusInFlight?.(),
    }
  }, 10_000, { firstTitle: cwd, secondTitle: secondCwd })
  const rapidFocusBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:focus'] ?? 0)
  await page.evaluate(title => {
    const row = [...document.querySelectorAll('.session-row')]
      .find(item => (item.textContent ?? '').includes(title))
    if (!(row instanceof HTMLButtonElement)) {
      throw new Error(`Missing session row for ${title}`)
    }
    row.click()
    row.click()
  }, rapidFocusTargetReady.secondTitle)
  await waitForApp(app, ({ app: electronApp }, baseline) => {
    const calls = electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:focus'] ?? 0
    return calls - baseline === 1
  }, 5_000, rapidFocusBaseline)
  const rapidFocusCalls = await app.evaluate(({ app: electronApp }, baseline) => {
    const calls = electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:focus'] ?? 0
    return calls - baseline
  }, rapidFocusBaseline)
  assert(
    rapidFocusCalls === 1,
    `rapid session row clicks submitted ${rapidFocusCalls} focus requests`,
  )
  await waitFor(page, expectedSessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const active = document.querySelector('.session-row.active')?.textContent ?? ''
      return sessions[0]?.id === expectedSessionId &&
        active.includes('claude-desktop-e2e-second-')
    }),
  10_000, focusResult.second)
  await page.evaluate(({ firstTitle, secondTitle }) => {
    const rows = [...document.querySelectorAll('.session-row')]
    const first = rows.find(item => (item.textContent ?? '').includes(firstTitle))
    const second = rows.find(item => (item.textContent ?? '').includes(secondTitle))
    if (!(first instanceof HTMLButtonElement) || !(second instanceof HTMLButtonElement)) {
      throw new Error('Missing session rows for rapid alternating focus smoke')
    }
    first.click()
    second.click()
  }, { firstTitle: primarySessionTitle, secondTitle: secondCwd })
  try {
    await waitFor(page, expectedSessionId =>
      window.claudeDesktop.sessions.list().then(sessions => {
        const active = document.querySelector('.session-row.active')?.textContent ?? ''
        return sessions[0]?.id === expectedSessionId &&
          active.includes('claude-desktop-e2e-second-')
      }),
    30_000, focusResult.second)
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'rapid-alternating-session-focus-timeout',
      expectedSessionId: focusResult.second,
      snapshot: await page.evaluate(async () => ({
        active: document.querySelector('.session-row.active')?.textContent ?? '',
        rows: [...document.querySelectorAll('.session-row')].map(row => row.textContent ?? ''),
        sessions: (await window.claudeDesktop.sessions.list()).map(session => ({
          id: session.id,
          title: session.title,
          cwd: session.cwd,
        })),
      })),
    }, null, 2))
    throw cause
  }
  const alternatingFocusState = await page.evaluate(async sessionId => {
    const sessions = await window.claudeDesktop.sessions.list()
    return {
      activeId: sessions[0]?.id,
      activeText: document.querySelector('.session-row.active')?.textContent ?? '',
      expectedId: sessionId,
    }
  }, focusResult.second)
  assert(
    alternatingFocusState.activeId === alternatingFocusState.expectedId &&
      alternatingFocusState.activeText.includes('claude-desktop-e2e-second-'),
    `rapid alternating session clicks did not keep the last clicked session active: ${JSON.stringify(alternatingFocusState)}`,
  )
  await waitFor(page, () => {
    const status = document.querySelector('.chat-header .inline-status.info')?.textContent ?? ''
    return !status.includes('No project folder selected.')
  })
  await focusSmokeSession(page, focusResult.second)
  await focusSmokeSession(page, focusResult.first)
  progress('checking session row management menu')
  await app.evaluate(({ shell }) => {
    globalThis.__claudeDesktopSmokeOpenPaths = []
    shell.openPath = async path => {
      globalThis.__claudeDesktopSmokeOpenPaths.push(path)
      return ''
    }
  })
  await waitFor(page, () => {
    const active = document.querySelector('.session-row.active')
    const button = active?.closest('.session-row-shell')?.querySelector('.session-menu-button')
    return button instanceof HTMLButtonElement && button.disabled === false
  })
  await page.evaluate(() => {
    const active = document.querySelector('.session-row.active')
    const button = active?.closest('.session-row-shell')?.querySelector('.session-menu-button')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing active session management button')
    }
    button.click()
  })
  await waitFor(page, () => {
    const menu = document.querySelector('.session-context-menu')
    const actions = [...(menu?.querySelectorAll('button') ?? [])]
      .map(button => button.textContent?.trim())
    const active = menu?.querySelector('button.active')
    return actions.join('|') === 'Focus session|Open folder|Close session' &&
      active?.textContent?.includes('Focus session') &&
      active.getAttribute('aria-selected') === 'true'
  })
  const openFolderBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspace:openFolder'] ?? 0)
  await page.keyboard.press('ArrowDown')
  await waitFor(page, () => {
    const active = document.querySelector('.session-context-menu button.active')
    return active?.textContent?.includes('Open folder') &&
      active.getAttribute('aria-selected') === 'true'
  })
  await page.keyboard.press('Enter')
  await waitFor(page, () => !document.querySelector('.session-context-menu'))
  const sessionMenuOpenFolder = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspace:openFolder'] ?? 0) - baseline,
    paths: globalThis.__claudeDesktopSmokeOpenPaths ?? [],
  }), openFolderBaseline)
  assert(
    sessionMenuOpenFolder.calls === 1 && sessionMenuOpenFolder.paths.includes(cwd),
    `session menu Open folder did not use workspace:openFolder: ${JSON.stringify(sessionMenuOpenFolder)}`,
  )
  progress('checking session rail overflow')
  await resizeMainWindow(app, 1024, 700)
  await page.waitForTimeout(200)
  const railSessionIds = await page.evaluate(async workspaces => {
    const created = []
    for (const workspace of workspaces) {
      const session = await window.claudeDesktop.sessions.create(workspace)
      if (session) created.push(session.id)
    }
    return created
  }, railWorkspaces)
  assert(railSessionIds.length === railWorkspaces.length, 'session rail workspaces were not all created')
  await waitFor(page, count => document.querySelectorAll('.session-row').length >= count, 10_000, railWorkspaces.length)
  await assertSessionRailCanReach(page, primarySessionTitle)
  const primaryRailRowReady = await waitFor(page, title => {
    const row = [...document.querySelectorAll('.session-row')]
      .find(item => item.querySelector('strong')?.textContent?.trim() === title)
    return {
      ready: row instanceof HTMLButtonElement && row.disabled === false,
      title,
      rowText: row?.textContent ?? '',
      rowDisabled: row instanceof HTMLButtonElement ? row.disabled : undefined,
    }
  }, 10_000, primarySessionTitle)
  await page.evaluate(title => {
    const row = [...document.querySelectorAll('.session-row')]
      .find(item => item.querySelector('strong')?.textContent?.trim() === title)
    if (!(row instanceof HTMLButtonElement)) throw new Error(`Missing session row for ${title}`)
    row.click()
  }, primaryRailRowReady.title)
  await waitFor(page, () => {
    const active = document.querySelector('.session-row.active')?.textContent ?? ''
    return active.includes('claude-desktop-e2e-') && !active.includes('rail') && !active.includes('second')
  })
  await page.evaluate(async sessionIds => {
    for (const sessionId of sessionIds) {
      await window.claudeDesktop.sessions.close(sessionId)
    }
  }, railSessionIds)
  await waitFor(page, sessionIds =>
    window.claudeDesktop.sessions.list().then(sessions =>
      sessionIds.every(sessionId => !sessions.some(session => session.id === sessionId)),
    ),
  10_000, railSessionIds)
  await focusSmokeSession(page, focusResult.first)
  await resizeMainWindow(app, 1440, 920)
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: /Chat/ }).click()
  await assertPrimaryNavState(page, 'Chat')
  await assertComposerFocused(page, 'chat primary navigation')
  await fillComposer(page, '@')
  await waitFor(page, () => {
    const menu = document.querySelector('.composer-menu')
    return (menu?.textContent ?? '').includes('Resources') &&
      Boolean(menu?.querySelector('button[role="option"]'))
  })
  await page.locator('.composer-menu button').filter({ hasText: 'existing-skill' }).click()
  await waitFor(page, () => {
    const input = document.querySelector('.composer textarea')
    return input instanceof HTMLTextAreaElement && /^@\S+\s/.test(input.value)
  })
  await fillComposer(page, '')
  await fillComposer(page, '@existing')
  try {
    await waitFor(page, () => {
      const menu = document.querySelector('.composer-menu')
      const text = menu?.textContent ?? ''
      return text.includes('Resources') &&
        text.includes('existing-skill') &&
        text.includes('Skill · user')
    })
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'composer-skill-resource-timeout',
      snapshot: await page.evaluate(async workspace => {
        const config = await window.claudeDesktop.config.get()
        const projectSkills = await window.claudeDesktop.workspaceSkills.list(workspace)
        return {
          input: document.querySelector('.composer textarea')?.value,
          textareaCount: document.querySelectorAll('textarea').length,
          composerCount: document.querySelectorAll('.composer').length,
          primaryActive: document.querySelector('.primary-nav button.active')?.textContent ?? '',
          bodySample: (document.body.textContent ?? '').slice(0, 500),
          menu: document.querySelector('.composer-menu')?.textContent ?? '',
          userSkills: config.skills.map(skill => skill.name),
          projectSkills: projectSkills.map(skill => skill.name),
        }
      }, cwd),
    }, null, 2))
    throw cause
  }
  await page.locator('.composer-menu button').filter({ hasText: 'existing-skill' }).click()
  await waitFor(page, () => {
    const input = document.querySelector('.composer textarea')
    return input instanceof HTMLTextAreaElement &&
      input.value.startsWith('@skill:existing-skill ')
  })
  await fillComposer(page, '')
  await fillComposer(page, '@play')
  try {
    await waitFor(page, () => {
      const menu = document.querySelector('.composer-menu')
      const text = menu?.textContent ?? ''
      return text.includes('Resources') &&
        text.includes('playwright') &&
        text.includes('MCP · user')
    })
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'composer-mcp-resource-timeout',
      snapshot: await page.evaluate(async workspace => {
        const config = await window.claudeDesktop.config.get()
        const projectServers = await window.claudeDesktop.workspaceMcp.list(workspace)
        return {
          input: document.querySelector('.composer textarea')?.value,
          textareaCount: document.querySelectorAll('textarea').length,
          composerCount: document.querySelectorAll('.composer').length,
          primaryActive: document.querySelector('.primary-nav button.active')?.textContent ?? '',
          bodySample: (document.body.textContent ?? '').slice(0, 500),
          menu: document.querySelector('.composer-menu')?.textContent ?? '',
          userMcp: config.mcpServers.map(server => server.name),
          projectMcp: projectServers.map(server => server.name),
        }
      }, cwd),
    }, null, 2))
    throw cause
  }
  await page.locator('.composer-menu button').filter({ hasText: 'playwright' }).click()
  try {
    await waitFor(page, () => {
      const input = document.querySelector('.composer textarea')
      return input instanceof HTMLTextAreaElement &&
        input.value.startsWith('@mcp:playwright ')
    })
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'composer-mcp-click-timeout',
      snapshot: await page.evaluate(() => ({
        input: document.querySelector('.composer textarea')?.value,
        selectionStart: document.querySelector('.composer textarea')?.selectionStart,
        activeElement: document.activeElement instanceof HTMLElement
          ? {
              tag: document.activeElement.tagName,
              text: document.activeElement.textContent,
              ariaLabel: document.activeElement.getAttribute('aria-label'),
            }
          : null,
        menu: document.querySelector('.composer-menu')?.textContent ?? '',
        buttons: [...document.querySelectorAll('.composer-menu button')]
          .map(button => button.textContent),
      })),
    }, null, 2))
    throw cause
  }
  await fillComposer(page, '/review')
  await waitFor(page, () => {
    const menu = document.querySelector('.composer-menu')
    return (menu?.textContent ?? '').includes('Actions') &&
      (menu?.textContent ?? '').includes('Review diff')
  })
  await page.locator('textarea[placeholder^="Ask Claude"]').press('Enter')
  await waitFor(page, () => {
    const input = document.querySelector('.composer textarea')
    return input instanceof HTMLTextAreaElement &&
      input.value.includes('Review the current git diff')
  })
  await fillComposer(page, '/')
  await waitFor(page, () => {
    const menu = document.querySelector('.composer-menu')
    const active = menu?.querySelector('button[aria-selected="true"]')
    return (menu?.textContent ?? '').includes('Actions') &&
      active?.textContent?.includes('Review diff')
  })
  await capture(page, 'composer-actions')
  await page.locator('textarea[placeholder^="Ask Claude"]').press('ArrowDown')
  await waitFor(page, () => {
    const active = document.querySelector('.composer-menu button[aria-selected="true"]')
    return active?.textContent?.includes('Explain current file')
  })
  await page.locator('textarea[placeholder^="Ask Claude"]').press('Enter')
  try {
    await waitFor(page, () => {
      const input = document.querySelector('.composer textarea')
      return input instanceof HTMLTextAreaElement &&
        input.value.includes('Explain') &&
        !input.value.includes('Review the current git diff')
    })
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'composer-slash-keyboard-timeout',
      snapshot: await page.evaluate(() => ({
        input: document.querySelector('.composer textarea')?.value,
        selectionStart: document.querySelector('.composer textarea')?.selectionStart,
        activeElement: document.activeElement instanceof HTMLElement
          ? {
              tag: document.activeElement.tagName,
              text: document.activeElement.textContent,
              ariaLabel: document.activeElement.getAttribute('aria-label'),
            }
          : null,
        menu: document.querySelector('.composer-menu')?.textContent ?? '',
        active: document.querySelector('.composer-menu button[aria-selected="true"]')?.textContent,
        buttons: [...document.querySelectorAll('.composer-menu button')]
          .map(button => ({
            text: button.textContent,
            selected: button.getAttribute('aria-selected'),
          })),
      })),
    }, null, 2))
    throw cause
  }
  await fillComposer(page, '/new-custom')
  await waitFor(page, () => {
    const menu = document.querySelector('.composer-menu')
    return (menu?.textContent ?? '').includes('Actions') &&
      (menu?.textContent ?? '').includes('New custom agent')
  })
  await page.locator('.composer-menu button').filter({ hasText: 'New custom agent' }).click()
  await assertPrimaryNavState(page, 'Agents')
  await assertAgentsStatus(page, 'Ready to create a new agent.', 'info')
  await waitFor(page, () => {
    const section = document.querySelector('#agents-editor')
    const input = section?.querySelector('input[placeholder="agent type"]')
    return section instanceof HTMLElement &&
      input instanceof HTMLInputElement &&
      input.value === ''
  })
  await page.getByRole('button', { name: /Chat/ }).click()
  await assertPrimaryNavState(page, 'Chat')
  await assertComposerFocused(page, 'composer lifecycle action return')
  await fillComposer(page, '/add-mcp')
  await waitFor(page, () => {
    const menu = document.querySelector('.composer-menu')
    return (menu?.textContent ?? '').includes('Actions') &&
      (menu?.textContent ?? '').includes('Add MCP server')
  })
  await page.locator('.composer-menu button').filter({ hasText: 'Add MCP server' }).click()
  await assertPrimaryNavState(page, 'Settings')
  await assertSettingsStatus(page, 'Ready to add a new MCP server.', 'info')
  await waitFor(page, () => {
    const mcp = document.getElementById('settings-mcp')
    const input = mcp?.querySelector('input[aria-label="MCP server name"]')
    return mcp instanceof HTMLElement &&
      input instanceof HTMLInputElement &&
      input.value === ''
  })
  await page.getByRole('button', { name: /Chat/ }).click()
  await assertPrimaryNavState(page, 'Chat')
  await assertComposerFocused(page, 'composer settings action return after MCP')
  await fillComposer(page, '/new-user-skill')
  await waitFor(page, () => {
    const menu = document.querySelector('.composer-menu')
    return (menu?.textContent ?? '').includes('Actions') &&
      (menu?.textContent ?? '').includes('New user skill')
  })
  await page.locator('.composer-menu button').filter({ hasText: 'New user skill' }).click()
  await assertPrimaryNavState(page, 'Settings')
  await assertSettingsStatus(page, 'Creating a new user skill.', 'info')
  await waitFor(page, () => {
    const skills = document.getElementById('settings-skills')
    const name = skills?.querySelector('input[aria-label="Skill name"]')
    const scope = skills?.querySelector('select[aria-label="Skill scope"]')
    return skills instanceof HTMLElement &&
      name instanceof HTMLInputElement &&
      name.value === '' &&
      scope instanceof HTMLSelectElement &&
      scope.value === 'user'
  })
  await page.getByRole('button', { name: /Chat/ }).click()
  await assertPrimaryNavState(page, 'Chat')
  await assertComposerFocused(page, 'composer settings action return after user skill')
  await fillComposer(page, '/new-project-skill')
  await waitFor(page, () => {
    const menu = document.querySelector('.composer-menu')
    return (menu?.textContent ?? '').includes('Actions') &&
      (menu?.textContent ?? '').includes('New project skill')
  })
  await page.locator('.composer-menu button').filter({ hasText: 'New project skill' }).click()
  await assertPrimaryNavState(page, 'Settings')
  await assertSettingsStatus(page, 'Creating a new project skill.', 'info')
  await waitFor(page, () => {
    const skills = document.getElementById('settings-skills')
    const name = skills?.querySelector('input[aria-label="Skill name"]')
    const scope = skills?.querySelector('select[aria-label="Skill scope"]')
    return skills instanceof HTMLElement &&
      name instanceof HTMLInputElement &&
      name.value === '' &&
      scope instanceof HTMLSelectElement &&
      scope.value === 'project'
  })
  await page.locator('#settings-skills').getByRole('button', { name: /Cancel edit/ }).click()
  await assertSettingsStatus(page, 'Cancelled skill edit.', 'info')
  await page.getByRole('button', { name: /Chat/ }).click()
  await assertPrimaryNavState(page, 'Chat')
  await assertComposerFocused(page, 'composer settings action return')
  await fillComposer(page, '/project:desktop-smoke')
  await waitFor(page, () => {
    const menu = document.querySelector('.composer-menu')
    return (menu?.textContent ?? '').includes('Run the desktop smoke custom command')
  })
  await page.locator('.composer-menu button').filter({ hasText: '/project:desktop-smoke' }).click()
  await waitFor(page, () => {
    const input = document.querySelector('.composer textarea')
    return input instanceof HTMLTextAreaElement &&
      input.value === '/project:desktop-smoke ' &&
      input.selectionStart === 23 &&
      input.selectionEnd === 23 &&
      document.activeElement === input
  })
  await fillComposer(page, 'hello desktop')
  await waitFor(page, () => {
    const button = [...document.querySelectorAll('.composer button')]
      .find(item => item.textContent?.includes('Send'))
    return button && !button.disabled
  })
  assert(
    await page.getByLabel('Cancel turn').evaluate(button => button.disabled),
    'cancel button should be disabled before a turn is active',
  )
  await waitFor(page, () => {
    const list = document.querySelector('.message-list')
    return (
      list?.getAttribute('aria-live') === 'polite' &&
      list?.getAttribute('aria-relevant') === 'additions text' &&
      list?.getAttribute('aria-busy') === 'false'
    )
  })
  await page.locator('textarea[placeholder^="Ask Claude"]').press('Enter')
  progress('sent first prompt with Enter')
  await waitFor(page, () => {
    const userMessages = [...document.querySelectorAll('.message-user')]
      .filter(message => (message.textContent ?? '').includes('hello desktop'))
    return userMessages.length > 0
  })
  const rapidSendUserMessages = await page.evaluate(() =>
    [...document.querySelectorAll('.message-user')]
      .filter(message => (message.textContent ?? '').includes('hello desktop'))
      .length,
  )
  assert(
    rapidSendUserMessages === 1,
    `rapid Send submitted ${rapidSendUserMessages} user messages`,
  )
  await waitFor(page, expectedSessionId => {
    return window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === expectedSessionId)
      return session && ['sending', 'streaming', 'waiting_permission'].includes(session.activity)
    })
  }, 10_000, focusResult.first)
  await page.locator('textarea[placeholder^="Ask Claude"]').fill('second prompt while busy')
  await waitFor(page, () => {
    const sendButton = [...document.querySelectorAll('.composer button')]
      .find(item => item.textContent?.includes('Send'))
    const cancelButton = document.querySelector('button[aria-label="Cancel turn"]')
    return Boolean(sendButton?.disabled && cancelButton && !cancelButton.disabled)
  })
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('streaming desktop response')
  })
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('Using Bash...')
  })
  await waitFor(page, () => {
    const activity = document.querySelector('.conversation-activity')?.textContent ?? ''
    return activity.includes('Tool activity') &&
      activity.includes('Bash') &&
      activity.includes('TodoWrite') &&
      activity.includes('Todos') &&
      activity.includes('Inspect desktop smoke workflow') &&
      activity.includes('Verify activity panel')
  })
  await waitFor(page, () => {
    const text = document.querySelector('.conversation-status.streaming')?.textContent ?? ''
    const list = document.querySelector('.message-list')
    return text.includes('Claude is streaming a response.') &&
      list?.getAttribute('aria-busy') === 'true'
  })
  await page.getByRole('button', { name: /^Tasks$/ }).click()
  const scheduledRunNowBusyDisabled = await page.evaluate(() => {
    const section = document.querySelector('#tasks-global-tasks')
    const button = [...(section?.querySelectorAll('button') ?? [])]
      .find(item => item.textContent?.includes('Run now'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing global Run now button for busy-turn guard smoke')
    }
    return button.disabled
  })
  assert(scheduledRunNowBusyDisabled, 'global scheduled task Run now stayed enabled while the active turn was busy')
  await page.getByRole('button', { name: /Agents/ }).click()
  await page.locator('#agents-launch input[placeholder="agent type"]').fill('desktop-smoke-agent')
  await page.locator('#agents-launch input[placeholder="short task description"]').fill('busy launch task')
  await page.locator('#agents-launch textarea[placeholder="task prompt for the selected agent"]').fill('busy launch prompt')
  const agentLaunchBusyDisabled = await page.evaluate(() => {
    const button = [...document.querySelectorAll('#agents-launch button')]
      .find(item => item.textContent?.includes('Launch task'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing Launch task button for busy-turn guard smoke')
    }
    return button.disabled
  })
  assert(agentLaunchBusyDisabled, 'agent Launch task stayed enabled while the active turn was busy')
  await page.getByRole('button', { name: /Chat/ }).click()
  await assertPrimaryNavState(page, 'Chat')
  await page.getByRole('button', { name: /Files/ }).click()
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return /thinking/i.test(text) && text.includes('checking workspace context after answer draft')
  })
  await waitFor(page, () => {
    const label = document.querySelector('.message-thinking.message-streaming .message-stream-label')?.textContent ?? ''
    return label.includes('Streaming')
  })
  await waitFor(page, () => {
    const list = document.querySelector('.message-list')
    return list ? list.scrollTop + list.clientHeight >= list.scrollHeight - 2 : false
  })
  await assertNoHorizontalOverflow(page, '.message-list', 'conversation timeline')
  await assertNoScrollableInlineOverflow(
    page,
    '.message-list .message-plain, .message-list .message-markdown p, .message-list .message-markdown li',
    'conversation messages',
  )
  await assertPolishedScrollableSurfaces(page, ['.message-list', '.session-list'], 'chat timeline')
  await capture(page, 'chat-streaming')
  await waitFor(page, expectedSessionId => {
    return window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === expectedSessionId)
      const activeText = document.querySelector('.session-row.active')?.textContent ?? ''
      return (
        session?.activity === 'streaming' &&
        activeText.includes('streaming')
      )
    })
  }, 10_000, focusResult.first)

  try {
    await waitFor(page, () => {
      const text = document.body.textContent ?? ''
      return text.includes('fake desktop response') &&
        text.includes('proxy=socks5://127.0.0.1:18999') &&
        text.includes('long-token=desktop_smoke_') &&
        text.includes('const desktopSmoke = true') &&
        text.includes('desktop docs')
    }, 20_000)
    const markdownResult = await page.evaluate(() => {
      const messages = [...document.querySelectorAll('.message-assistant .message-markdown')]
      const markdown = messages.find(message =>
        (message.textContent ?? '').includes('fake desktop response'),
      )
      if (!markdown) return { ok: false, reason: 'missing markdown message' }
      const heading = markdown.querySelector('h2')
      const list = markdown.querySelector('ul')
      const proxyItem = [...markdown.querySelectorAll('li')].find(item =>
        (item.textContent ?? '').includes('proxy=socks5://127.0.0.1:18999'),
      )
      const longToken = [...markdown.querySelectorAll('code')].find(code =>
        (code.textContent ?? '').includes('desktop_smoke_'),
      )
      const code = markdown.querySelector('pre.message-code-block code')
      const link = markdown.querySelector('a[href="https://example.com/desktop"]')
      const ok = Boolean(
        heading?.textContent === 'fake desktop response' &&
        list &&
        proxyItem &&
        longToken &&
        code?.textContent?.includes('const desktopSmoke = true') &&
        link?.textContent === 'desktop docs',
      )
      return {
        ok,
        heading: heading?.textContent,
        hasList: Boolean(list),
        hasProxyItem: Boolean(proxyItem),
        hasLongToken: Boolean(longToken),
        code: code?.textContent,
        linkText: link?.textContent,
        linkHref: link?.getAttribute('href'),
      }
    })
    assert(markdownResult.ok, `assistant markdown DOM missing expected structure: ${JSON.stringify(markdownResult)}`)
  } catch (cause) {
    console.log(
      JSON.stringify(
        {
          phase: 'assistant-render-timeout',
          body: await page.textContent('body'),
          events: await page.evaluate(() => window.__claudeDesktopSmokeEvents ?? []),
          markdownMessages: await page.evaluate(() =>
            [...document.querySelectorAll('.message-assistant .message-markdown')].map(message => ({
              text: message.textContent,
              headings: [...message.querySelectorAll('h2, h3')].map(node => node.textContent),
              listItems: [...message.querySelectorAll('li')].map(node => node.textContent),
              inlineCodes: [...message.querySelectorAll('code')].map(node => node.textContent),
              codeBlocks: [...message.querySelectorAll('pre.message-code-block code')].map(node => node.textContent),
              links: [...message.querySelectorAll('a')].map(node => ({
                text: node.textContent,
                href: node.getAttribute('href'),
              })),
            })),
          ),
        },
        null,
        2,
      ),
    )
    throw cause
  }

  await page.waitForSelector('.permission-modal')
  await waitFor(page, () => {
    const text = document.querySelector('.conversation-status.waiting_permission')?.textContent ?? ''
    const list = document.querySelector('.message-list')
    return text.includes('Claude is waiting for a permission decision.') &&
      list?.getAttribute('aria-busy') === 'true'
  })
  await waitFor(page, expectedSessionId => {
    return window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === expectedSessionId)
      const headerText = document.querySelector('.chat-header')?.textContent ?? ''
      return (
        session?.activity === 'waiting_permission' &&
        headerText.includes('waiting for permission')
      )
    })
  }, 10_000, focusResult.first)
  progress('handling allow permissions')
  await waitFor(page, () => {
    const active = document.activeElement
    return active instanceof HTMLButtonElement && active.textContent?.includes('Deny')
  })
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Tab')
    await assertFocusInside(page, '.permission-modal')
  }
  await waitFor(page, () => {
    const modal = document.querySelector('.permission-modal')
    if (!modal) return false
    const rect = modal.getBoundingClientRect()
    const style = getComputedStyle(modal)
    return (
      rect.top >= 0 &&
      rect.bottom <= window.innerHeight &&
      style.overflowY === 'auto' &&
      style.maxHeight !== 'none'
    )
  })
  await waitFor(page, () => {
    const modal = document.querySelector('.permission-modal')
    const actions = modal?.querySelector('.modal-actions')
    if (!(modal instanceof HTMLElement) || !(actions instanceof HTMLElement)) return false
    const modalRect = modal.getBoundingClientRect()
    const actionsRect = actions.getBoundingClientRect()
    const style = getComputedStyle(actions)
    return (
      style.position === 'sticky' &&
      style.bottom === '0px' &&
      actionsRect.bottom <= modalRect.bottom + 1
    )
  })
  assert(
    (await page.textContent('.permission-modal'))?.includes('Run printf for desktop smoke'),
    'permission modal did not include request details',
  )
  assert(
    (await page.textContent('.permission-modal'))?.includes('Tool input'),
    'permission modal did not include structured tool input heading',
  )
  assert(
    (await page.textContent('.permission-modal'))?.includes('command'),
    'permission modal did not include structured tool input key',
  )
  assert(
    (await page.textContent('.permission-modal'))?.includes('printf permission-ok'),
    'permission modal did not include structured tool input value',
  )
  assert(
    (await page.textContent('.permission-modal'))?.includes('Permission suggestions'),
    'permission modal did not label permission suggestions',
  )
  assert(
    (await page.textContent('.permission-modal'))?.includes('Raw request'),
    'permission modal did not label the raw permission payload',
  )
  await assertNoHorizontalOverflow(page, '.permission-modal', 'permission modal')
  await assertNoScrollableInlineOverflow(page, '.permission-modal pre, .permission-input-row dd', 'permission review fields')
  assert(
    (await page.textContent('.permission-modal'))?.includes('Agent: desktop-smoke-agent · agent-smoke-1 · desktop smoke agent task'),
    'permission modal did not include agent context',
  )
  assert(
    (await page.textContent('.permission-modal'))?.includes('Team: frontend · @alice · plan'),
    'permission modal did not include team context',
  )
  await waitFor(page, () => {
    const modal = document.querySelector('.permission-modal')
    const deny = [...(modal?.querySelectorAll('.tool-button') ?? [])]
      .find(button => button.textContent?.includes('Deny'))
    const allow = [...(modal?.querySelectorAll('.send-button') ?? [])]
      .find(button => button.textContent?.includes('Allow'))
    return Boolean(deny?.querySelector('.glyph') && allow?.querySelector('.glyph'))
  })
  await capture(page, 'permission-modal')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.permission-modal button')]
      .find(item => item.textContent?.includes('Allow'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing permission Allow button for rapid-allow smoke')
    }
    button.click()
    button.click()
  })
  await waitFor(page, () => {
    const bodyText = document.body.textContent ?? ''
    if (bodyText.includes('permission allow received for toolu-smoke-1 printf permission-ok')) {
      return true
    }
    const modal = document.querySelector('.permission-modal')
    const allow = [...document.querySelectorAll('.permission-modal button')]
      .find(button => button.textContent?.includes('Sending'))
    const deny = [...document.querySelectorAll('.permission-modal button')]
      .find(button => button.textContent?.includes('Deny'))
    return (
      modal?.textContent?.includes('Sending permission response...') &&
      allow?.disabled === true &&
      deny?.disabled === true
    )
  })
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('permission allow received for toolu-smoke-1 printf permission-ok')
  })
  await page.waitForTimeout(1000)
  const rapidAllowMessages = await page.evaluate(() =>
    [...document.querySelectorAll('.message-assistant')]
      .filter(message =>
        (message.textContent ?? '').includes('permission allow received for toolu-smoke-1 printf permission-ok'),
      )
      .length,
  )
  assert(
    rapidAllowMessages === 1,
    `rapid Allow submitted ${rapidAllowMessages} permission responses`,
  )
  await page.waitForSelector('.permission-modal')
  assert(
    (await page.textContent('.permission-modal'))?.includes('Run queued printf for desktop smoke'),
    'queued permission modal did not appear after allowing the first request',
  )
  await page.getByRole('button', { name: /Allow/ }).click()
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('permission allow received for toolu-smoke-2 printf permission-queued-ok')
  })
  await waitFor(page, () => {
    const list = document.querySelector('.message-list')
    return list?.getAttribute('aria-busy') === 'false'
  })
  await waitFor(page, () => {
    const label = document.querySelector('.message-thinking:not(.message-streaming) .message-stream-label')?.textContent ?? ''
    return label.includes('Complete')
  })
  await assertChatCopyControls(page, app)
  await app.evaluate(({ shell }) => {
    globalThis.__claudeDesktopSmokeExternalUrls = []
    shell.openExternal = async url => {
      globalThis.__claudeDesktopSmokeExternalUrls.push(url)
    }
  })
  const markdownExternalBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['preview:openExternal'] ?? 0)
  await page
    .locator('.message-assistant .message-markdown a[href="https://example.com/desktop"]')
    .click()
  await waitFor(page, () => {
    const status = document.querySelector('.conversation-status.success')?.textContent ?? ''
    return status.includes('Opened https://example.com/desktop in browser.')
  })
  const markdownExternalCalls = await app.evaluate(({ app: electronApp }, baseline) =>
    (electronApp.__claudeDesktopSmokeIpcCalls?.['preview:openExternal'] ?? 0) - baseline,
  markdownExternalBaseline)
  const markdownExternalUrls = await app.evaluate(() => globalThis.__claudeDesktopSmokeExternalUrls ?? [])
  assert(
    markdownExternalCalls === 1,
    `assistant markdown link submitted ${markdownExternalCalls} preview:openExternal requests`,
  )
  assert(
    markdownExternalUrls.includes('https://example.com/desktop'),
    `assistant markdown link did not open expected external URL: ${JSON.stringify(markdownExternalUrls)}`,
  )
  await page.locator('textarea[placeholder^="Ask Claude"]').fill('cancel desktop')
  await waitFor(page, () => {
    const button = [...document.querySelectorAll('.composer button')]
      .find(item => item.textContent?.includes('Send'))
    return button && !button.disabled
  })
  await page.locator('.composer').getByRole('button', { name: /Send/ }).click()
  await page.waitForSelector('.permission-modal')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.permission-modal button')]
      .find(item => item.textContent?.includes('Cancel turn'))
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing permission Cancel turn button for rapid-cancel smoke')
    }
    button.click()
    button.click()
  })
  progress('sent cancel')
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('Cancellation requested')
  })
  const cancellationNotices = await page.evaluate(() =>
    [...document.querySelectorAll('.message-system')]
      .filter(message => (message.textContent ?? '').includes('Cancellation requested'))
      .length,
  )
  assert(
    cancellationNotices === 1,
    `rapid Cancel turn submitted ${cancellationNotices} cancellation requests`,
  )
  try {
    await waitFor(page, expectedSessionId => {
      return (window.__claudeDesktopSmokeEvents ?? []).some(event =>
        event.type === 'session-updated' &&
        event.session?.id === expectedSessionId &&
        event.session?.activity === 'cancelling'
      )
    }, 10_000, focusResult.first)
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'cancel-activity-timeout',
      body: await page.textContent('body'),
      cancelButton: await page.getByTitle('Cancel turn').evaluate(button => ({
        disabled: button.disabled,
        text: button.textContent,
      })),
      events: await page.evaluate(() => (window.__claudeDesktopSmokeEvents ?? []).slice(-20)),
      sessions: await page.evaluate(() => window.claudeDesktop.sessions.list()),
    }, null, 2))
    throw cause
  }
  await waitFor(page, () => !document.querySelector('.permission-modal'))
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return (
      text.includes('Cancellation requested') &&
      text.includes('interrupt received by desktop smoke runtime')
    )
  })
  await waitFor(page, () => {
    const text = document.querySelector('.conversation-status.info')?.textContent ?? ''
    return text.includes('Turn cancelled.')
  })
  await page.locator('textarea[placeholder^="Ask Claude"]').fill('deny desktop')
  await waitFor(page, () => {
    const button = [...document.querySelectorAll('.composer button')]
      .find(item => item.textContent?.includes('Send'))
    return button && !button.disabled
  })
  await page.locator('.composer').getByRole('button', { name: /Send/ }).click()
  await page.waitForSelector('.permission-modal')
  await page.getByRole('button', { name: /Deny/ }).click()
  progress('handled deny permission')
  await waitFor(page, () => {
    const text = document.body.textContent ?? ''
    return text.includes('permission deny received for toolu-smoke-1')
  })

  commitWorkspaceBaseline(cwd, 'desktop smoke metadata baseline')
  progress('editing file and refreshing diff')
  await page.getByRole('button', { name: /Diff/ }).click()
  await page.locator('.diff-pane').getByRole('button', { name: /^Refresh$/ }).click()
  await waitFor(page, () => {
    const text = document.querySelector('.diff-viewer')?.textContent ?? ''
    const status = document.querySelector('.diff-inline-status.success')?.textContent ?? ''
    return (
      text.includes('No unstaged changes') &&
      status.includes('No unstaged git changes.')
    )
  })
  const diffEmptyState = await page.evaluate(() => {
    const placeholder = document.querySelector('.diff-placeholder')
    return {
      hasIcon: Boolean(placeholder?.querySelector('.glyph')),
      hasTitle: Boolean(placeholder?.querySelector('strong')?.textContent?.includes('No unstaged changes')),
      hasDetails: Boolean(placeholder?.textContent?.includes('Edit a file or refresh the workspace to review changes here.')),
    }
  })
  assert(
    diffEmptyState.hasIcon && diffEmptyState.hasTitle && diffEmptyState.hasDetails,
    `diff empty state is too sparse: ${JSON.stringify(diffEmptyState)}`,
  )
  await page.getByRole('button', { name: /Files/ }).click()
  await waitFor(page, () => {
    const filesTab = document.querySelector('.pane-tabs button[aria-label="Files"]')
    return filesTab?.getAttribute('aria-pressed') === 'true'
  })
  await waitFor(page, () => {
    const text = document.querySelector('.file-tree')?.textContent ?? ''
    return text.includes('deliberately-long-file-name')
  })
  const fileCountBeforeRefresh = await page.evaluate(() => {
    const toolbarText = document.querySelector('.files-pane .pane-toolbar')?.textContent ?? ''
    return Number.parseInt(toolbarText.match(/Files · (\d+) files?/)?.[1] ?? '0', 10)
  })
  await writeFile(join(cwd, 'external-refresh.txt'), 'created outside the desktop\n')
  const filesRefreshBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspace:tree'] ?? 0)
  await page.evaluate(() => {
    const refresh = [...document.querySelectorAll('.files-pane .pane-toolbar button')]
      .find(button => button.textContent?.includes('Refresh'))
    if (!(refresh instanceof HTMLButtonElement)) {
      throw new Error('missing Files Refresh button for rapid-files-refresh smoke')
    }
    refresh.click()
    refresh.click()
  })
  await waitFor(page, () => {
    const status = document.querySelector('.files-status.info')?.textContent ?? ''
    return status.includes('Refreshing files...')
  })
  await page.waitForTimeout(250)
  const rapidFilesRefreshDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspace:tree'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), filesRefreshBaseline)
  assert(
    rapidFilesRefreshDebug.calls === 1,
    `rapid Files Refresh submitted ${rapidFilesRefreshDebug.calls} tree refreshes: ${JSON.stringify(rapidFilesRefreshDebug)}`,
  )
  await waitFor(page, previousCount => {
    const treeText = document.querySelector('.file-tree')?.textContent ?? ''
    const toolbarText = document.querySelector('.files-pane .pane-toolbar')?.textContent ?? ''
    const nextCount = Number.parseInt(toolbarText.match(/Files · (\d+) files?/)?.[1] ?? '0', 10)
    return treeText.includes('external-refresh.txt') && nextCount >= previousCount + 1
  }, 10_000, fileCountBeforeRefresh)
  await waitFor(page, () => {
    const status = document.querySelector('.files-status.success')?.textContent ?? ''
    return status.includes('Updated files:')
  })
  await assertNoHorizontalOverflow(page, '.file-tree', 'file tree')
  await waitFor(page, () => {
    const sourceDirectory = [...document.querySelectorAll('.tree-row.directory')]
      .find(button => button.textContent?.trim() === 'src')
    return sourceDirectory?.getAttribute('aria-expanded') === 'false'
  })
  await page.getByRole('button', { name: /src/ }).click()
  await waitFor(page, () => {
    const sourceDirectory = [...document.querySelectorAll('.tree-row.directory')]
      .find(button => button.textContent?.trim() === 'src')
    return sourceDirectory?.getAttribute('aria-expanded') === 'true'
  })
  await capture(page, 'files')
  await focusSmokeSession(page, focusResult.second)
  await focusSmokeSession(page, focusResult.first)
  await page.getByRole('button', { name: /Files/ }).click()
  await waitFor(page, () => {
    const sourceDirectory = [...document.querySelectorAll('.tree-row.directory')]
      .find(button => button.textContent?.trim() === 'src')
    return sourceDirectory?.getAttribute('aria-expanded') === 'true'
  })
  await page.getByRole('button', { name: /binary\.bin/ }).click()
  await waitFor(page, () => {
    const status = document.querySelector('.editor-status.error')?.textContent ?? ''
    const toolbar = document.querySelector('.editor-toolbar')?.textContent ?? ''
    return (
      status.includes('Binary files cannot be opened in the desktop editor') &&
      toolbar.includes('Open a file from the Files pane')
    )
  })
  const editorEmptyState = await page.evaluate(() => {
    const placeholder = document.querySelector('.editor-placeholder')
    return {
      hasIcon: Boolean(placeholder?.querySelector('.glyph')),
      hasTitle: Boolean(placeholder?.querySelector('strong')?.textContent?.includes('Open a file')),
      hasDetails: Boolean(placeholder?.textContent?.includes('Select a text file from Files to inspect or edit it here.')),
    }
  })
  assert(
    editorEmptyState.hasIcon && editorEmptyState.hasTitle && editorEmptyState.hasDetails,
    `editor empty state is too sparse: ${JSON.stringify(editorEmptyState)}`,
  )
  await page.getByRole('button', { name: /Files/ }).click()
  await page.getByRole('button', { name: /app\.txt/ }).click()
  await waitFor(page, () => {
    const status = document.querySelector('.editor-status.success')?.textContent ?? ''
    return status.includes('Opened src/app.txt')
  })
  await page.getByRole('region', { name: /Editor for src\/app\.txt/ }).waitFor()
  try {
    await page.locator('.monaco-editor').click({ timeout: 10_000 })
    await waitFor(page, () => Boolean(window.__claudeDesktopSmokeEditor))
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'monaco-editor-timeout',
      body: await page.textContent('body'),
      editor: await page.evaluate(() => ({
        activeButtons: [...document.querySelectorAll('button.active')]
          .map(button => button.textContent ?? ''),
        toolbar: document.querySelector('.editor-toolbar')?.textContent ?? '',
        status: document.querySelector('.editor-status')?.textContent ?? '',
        monacoHost: Boolean(document.querySelector('.monaco-host')),
        monacoEditor: Boolean(document.querySelector('.monaco-editor')),
        monacoHostHtml: document.querySelector('.monaco-host')?.innerHTML.slice(0, 500) ?? '',
      })),
    }, null, 2))
    throw cause
  }
  await capture(page, 'editor')
  await setSmokeEditorValueAndWaitForUnsaved(page, 'hello\nupdated through monaco\n')
  progress('checking unsaved editor Files pane switch guard')
  await capture(page, 'before-unsaved-files-pane-switch')
  await clickPaneTabExpectingUnsavedDialog(page, 'Files', { requireCancelFocus: true })
  progress('unsaved Files pane switch dialog appeared')
  await capture(page, 'unsaved-files-pane-switch-dialog')
  await page.keyboard.press('Shift+Tab')
  await assertFocusInside(page, '.confirmation-modal')
  await page.keyboard.press('Tab')
  await assertFocusInside(page, '.confirmation-modal')
  await page.keyboard.press('Escape')
  await waitFor(page, () => !document.querySelector('.confirmation-modal'))
  try {
    await waitFor(page, () => {
      const activeButtons = [...document.querySelectorAll('button.active')]
        .map(button => button.textContent ?? '')
      const toolbar = document.querySelector('.editor-toolbar')?.textContent ?? ''
      return activeButtons.some(label => label.includes('Editor')) &&
        toolbar.includes('app.txt') &&
        toolbar.includes('Unsaved')
    })
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'after-unsaved-files-escape-timeout',
      state: await page.evaluate(async () => {
        const sessions = await window.claudeDesktop.sessions.list()
        return {
          activeButtons: [...document.querySelectorAll('button.active')]
            .map(button => button.textContent ?? ''),
          toolbar: document.querySelector('.editor-toolbar')?.textContent ?? '',
          confirmation: document.querySelector('.confirmation-modal')?.textContent ?? '',
          smokeHasUnsavedChanges: window.__claudeDesktopSmokeHasUnsavedChanges,
          editorValue: window.__claudeDesktopSmokeEditor?.getValue?.(),
          activeSessionLayout: sessions.find(session =>
            document.querySelector('.session-row.active')?.textContent?.includes(session.cwd),
          )?.layout,
        }
      }),
    }, null, 2))
    throw cause
  }
  progress('unsaved Files pane switch Escape kept editor active')
  const unsavedGuard = await waitFor(page, () => {
    const toolbar = document.querySelector('.editor-toolbar')?.textContent ?? ''
    return toolbar.includes('app.txt') && toolbar.includes('Unsaved')
      ? true
      : false
  })
  assert(unsavedGuard, 'unsaved editor guard did not block switching panes')
  const dirtyBeforeSave = await page.evaluate(() => window.__claudeDesktopSmokeHasUnsavedChanges)
  assert(dirtyBeforeSave === true, 'unsaved editor did not register a window close guard')
  progress('checking unsaved editor Diff pane switch guard')
  await capture(page, 'before-unsaved-diff-pane-switch')
  await clickPaneTabExpectingUnsavedDialog(page, 'Diff')
  progress('clicked Diff with unsaved editor')
  progress('unsaved Diff pane switch dialog appeared')
  await capture(page, 'unsaved-diff-pane-switch-dialog')
  await confirmDesktopDialog(page, /Keep editing/)
  progress('kept editing after unsaved Diff pane switch dialog')
  try {
    await waitFor(page, () => {
    const activeButtons = [...document.querySelectorAll('button.active')]
      .map(button => button.textContent ?? '')
    const toolbar = document.querySelector('.editor-toolbar')?.textContent ?? ''
    return activeButtons.some(label => label.includes('Editor')) &&
      toolbar.includes('app.txt') &&
      toolbar.includes('Unsaved')
    })
  } catch (cause) {
    const state = await page.evaluate(() => ({
      activeButtons: [...document.querySelectorAll('button.active')]
        .map(button => button.textContent ?? ''),
      toolbar: document.querySelector('.editor-toolbar')?.textContent ?? '',
      confirmation: document.querySelector('.confirmation-modal')?.textContent ?? '',
      smokeHasUnsavedChanges: window.__claudeDesktopSmokeHasUnsavedChanges,
    }))
    console.error(JSON.stringify({ phase: 'after-unsaved-diff-keep-editing-timeout', state }, null, 2))
    throw cause
  }
  progress('unsaved Diff pane switch guard kept editor active')
  await capture(page, 'after-unsaved-diff-pane-switch-keep-editing')
  await setSmokeEditorValueAndWaitForUnsaved(page, 'hello\nupdated through monaco for discard\n')
  await clickPaneTabExpectingUnsavedDialog(page, 'Diff')
  await confirmDesktopDialog(page, /Discard changes/)
  try {
    await waitFor(page, () => {
      const activeButtons = [...document.querySelectorAll('button.active')]
        .map(button => button.textContent ?? '')
      return activeButtons.some(label => label.includes('Diff')) &&
        window.__claudeDesktopSmokeHasUnsavedChanges === false
    })
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'discard-unsaved-switch-to-diff',
      state: await page.evaluate(async () => {
        const sessions = await window.claudeDesktop.sessions.list()
        return {
          activeButtons: [...document.querySelectorAll('button.active')]
            .map(button => button.textContent ?? ''),
          smokeHasUnsavedChanges: window.__claudeDesktopSmokeHasUnsavedChanges,
          editorToolbar: document.querySelector('.editor-toolbar')?.textContent ?? '',
          confirmation: document.querySelector('.confirmation-modal')?.textContent ?? '',
          activeSessionLayout: sessions[0]?.layout,
        }
      }),
    }, null, 2))
    throw cause
  }
  await page.getByRole('button', { name: /^Editor$/ }).click()
  await waitFor(page, () => {
    const toolbar = document.querySelector('.editor-toolbar')?.textContent ?? ''
    return toolbar.includes('app.txt') && !toolbar.includes('Unsaved')
  })
  await setSmokeEditorValueAndWaitForUnsaved(page, 'hello\nupdated through monaco\n')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close()
  })
  await waitFor(page, () => {
    const text = document.querySelector('.confirmation-modal')?.textContent ?? ''
    return text.includes('Close window?') && text.includes('src/app.txt')
  })
  await confirmDesktopDialog(page, /Keep editing/)
  await waitFor(page, () => !document.querySelector('.confirmation-modal'))
  await page.getByRole('button', { name: /Editor/ }).waitFor()
  await setSmokeEditorValueAndWaitForUnsaved(page, 'hello\nupdated through monaco\n')
  const saveFileBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspace:saveFile'] ?? 0)
  await page.evaluate(() => {
    const save = document.querySelector('button[title="Save file"]')
    if (!(save instanceof HTMLButtonElement)) {
      throw new Error('missing Save file button for rapid-save-file smoke')
    }
    save.click()
    save.click()
  })
  await page.waitForTimeout(250)
  const rapidSaveFileDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspace:saveFile'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), saveFileBaseline)
  assert(
    rapidSaveFileDebug.calls === 1,
    `rapid Save file submitted ${rapidSaveFileDebug.calls} file writes: ${JSON.stringify(rapidSaveFileDebug)}`,
  )
  await waitForSavedEditor(page, cwd, 'src/app.txt', 'hello\nupdated through monaco\n')
  const dirtyAfterSave = await page.evaluate(() => window.__claudeDesktopSmokeHasUnsavedChanges)
  assert(dirtyAfterSave === false, 'saved editor did not clear the window close guard')
  await page.getByRole('button', { name: /Diff/ }).click()
  await page.getByRole('region', { name: /Diff viewer/ }).waitFor()
  await waitForEditedDiff(page)
  await capture(page, 'diff')
  const diffRefreshBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['workspace:tree'] ?? 0)
  await page.evaluate(() => {
    const refresh = [...document.querySelectorAll('.diff-pane .pane-toolbar button')]
      .find(button => button.textContent?.includes('Refresh'))
    if (!(refresh instanceof HTMLButtonElement)) {
      throw new Error('missing Diff Refresh button for rapid-diff-refresh smoke')
    }
    refresh.click()
    refresh.click()
  })
  const diffBusyAfterRapidRefresh = await page.evaluate(() =>
    new Promise(resolve => {
      requestAnimationFrame(() => {
        const status = document.querySelector('.diff-pane .pane-loading-status')?.textContent ?? ''
        resolve(status.includes('Refreshing diff'))
      })
    }),
  )
  assert(
    diffBusyAfterRapidRefresh === true,
    'rapid Diff Refresh cleared busy feedback before the refresh completed',
  )
  await page.waitForTimeout(250)
  const rapidDiffRefreshDebug = await app.evaluate(({ app: electronApp }, baseline) => ({
    calls: (electronApp.__claudeDesktopSmokeIpcCalls?.['workspace:tree'] ?? 0) - baseline,
    allCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
  }), diffRefreshBaseline)
  assert(
    rapidDiffRefreshDebug.calls === 1,
    `rapid Diff Refresh submitted ${rapidDiffRefreshDebug.calls} tree refreshes: ${JSON.stringify(rapidDiffRefreshDebug)}`,
  )
  try {
    await waitFor(page, () => {
      const text = document.body.textContent ?? ''
      const toolbar = document.querySelector('.diff-pane .pane-toolbar')?.textContent ?? ''
      const busy = document.querySelector('.diff-pane')?.getAttribute('aria-busy')
      const status = document.querySelector('.diff-inline-status.success')?.textContent ?? ''
      return (
        text.includes('src/app.txt') &&
        text.includes('updated through monaco') &&
        toolbar.includes('Git changes · 1 file') &&
        toolbar.includes('Refresh') &&
        busy === 'false' &&
        status.includes('Updated git changes: 1 file changed.')
      )
    })
  } catch (cause) {
    console.log(JSON.stringify({
      phase: 'diff-after-save-timeout',
      body: await page.textContent('body'),
      diffStatus: await page.locator('.diff-inline-status').textContent().catch(() => ''),
      diffText: await page.locator('.diff-pane').textContent().catch(() => ''),
    }, null, 2))
    throw cause
  }
  await focusSmokeSession(page, focusResult.second)
  await waitFor(page, () => {
    const status = document.querySelector('.diff-inline-status')?.textContent ?? ''
    const header = document.querySelector('.chat-header')?.textContent ?? ''
    return (
      header.includes('claude-desktop-e2e-second-') &&
      !status.includes('Updated git changes: 1 file changed.')
    )
  })
  await focusSmokeSession(page, focusResult.first)

  progress('starting terminal')
  await page.getByRole('button', { name: /Terminal/ }).click()
  await page.getByRole('region', { name: /Terminal output/ }).waitFor()
  const terminalEmptyState = await page.evaluate(() => {
    const placeholder = document.querySelector('.terminal-placeholder')
    return {
      hasIcon: Boolean(placeholder?.querySelector('.glyph')),
      hasTitle: Boolean(placeholder?.querySelector('strong')?.textContent?.includes('Start a shell')),
      hasDetails: Boolean(placeholder?.textContent?.includes('Commands run in the active project folder')),
    }
  })
  assert(
    terminalEmptyState.hasIcon && terminalEmptyState.hasTitle && terminalEmptyState.hasDetails,
    `terminal empty state is too sparse: ${JSON.stringify(terminalEmptyState)}`,
  )
  const primarySessionId = await page.evaluate(() => window.__claudeDesktopSmokeSession?.id)
  assert(primarySessionId, 'primary session id was not available before terminal checks')
  await page.getByRole('button', { name: /Start shell/ }).click()
  const terminalId = await waitFor(page, () => {
    const events = window.__claudeDesktopSmokeEvents ?? []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      const terminalId = event.session?.layout?.terminalId
      if (event.type === 'session-updated' && terminalId) return terminalId
    }
    return ''
  })
  const terminalResize = await waitFor(page, id => {
    const states = (window.__claudeDesktopSmokeEvents ?? [])
      .filter(event => event.type === 'terminal-state' && event.terminal?.id === id)
      .map(event => event.terminal)
    return states.find(state =>
      state.columns >= 20 &&
      state.rows >= 5 &&
      (state.columns !== 100 || state.rows !== 28)
    )
  }, 10_000, terminalId)
  await page.evaluate(
    id => window.claudeDesktop.terminal.write(id, 'printf desktop-terminal-ok\n'),
    terminalId,
  )
  const terminalMode = await waitFor(page, () => {
    const events = window.__claudeDesktopSmokeEvents ?? []
    const state = events.find(event => event.type === 'terminal-state')
    return state?.terminal?.mode ?? ''
  })
  await waitFor(page, () => {
    const text = document.querySelector('.terminal-toolbar')?.textContent ?? ''
    return text.includes('PTY') || text.includes('Shell fallback')
  })
  await waitFor(page, () => {
    const text = document.querySelector('.terminal-status.success')?.textContent ?? ''
    return text.includes('Shell running:')
  })

  const terminalOutput = await waitFor(page, () => {
    const events = window.__claudeDesktopSmokeEvents ?? []
    const output = events
      .filter(event => event.type === 'terminal-data')
      .map(event => event.data)
      .join('')
    return output.includes('desktop-terminal-ok')
      ? 'desktop-terminal-ok'
      : ''
  })
  await page.evaluate(
    id => window.claudeDesktop.terminal.write(id, 'exit\n'),
    terminalId,
  )
  await waitFor(page, id => {
    const events = window.__claudeDesktopSmokeEvents ?? []
    return events.some(event => event.type === 'terminal-exit' && event.terminalId === id)
  }, 10_000, terminalId)
  await waitFor(page, () => {
    const text = document.querySelector('.terminal-status.info')?.textContent ?? ''
    return text.includes('Shell exited')
  })
  await page.getByRole('button', { name: /Start shell/ }).click()
  const restartedTerminalId = await waitFor(page, previousId => {
    const events = window.__claudeDesktopSmokeEvents ?? []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      const terminalId = event.session?.layout?.terminalId
      if (event.type === 'session-updated' && terminalId && terminalId !== previousId) {
        return terminalId
      }
    }
    return ''
  }, 10_000, terminalId)
  assert(restartedTerminalId !== terminalId, 'terminal did not restart after shell exit')
  await waitFor(page, () => {
    const text = document.querySelector('.terminal-status.success')?.textContent ?? ''
    return text.includes('Shell running:')
  })
  await page.getByRole('button', { name: /Stop/ }).click()
  await waitFor(page, () => {
    const text = document.querySelector('.terminal-status.info')?.textContent ?? ''
    return text.includes('Shell stopped')
  })
  await waitFor(page, sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return session && session.layout.terminalId === undefined
    }),
  10_000, primarySessionId)
  await waitFor(page, () => {
    const startButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Start shell'))
    const stopButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.trim() === 'Stop')
    return (
      startButton instanceof HTMLButtonElement &&
      !startButton.disabled &&
      stopButton instanceof HTMLButtonElement &&
      stopButton.disabled
    )
  })
  const rapidStartBaseline = await page.evaluate(() =>
    (window.__claudeDesktopSmokeEvents ?? [])
      .filter(event => event.type === 'session-updated' && event.session?.layout?.terminalId)
      .length,
  )
  await page.evaluate(() => {
    const startButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Start shell'))
    if (!(startButton instanceof HTMLButtonElement)) {
      throw new Error('missing Start shell button for rapid-start smoke')
    }
    startButton.click()
    startButton.click()
  })
  const rapidTerminalId = await waitFor(page, baseline => {
    const events = (window.__claudeDesktopSmokeEvents ?? [])
      .filter(event => event.type === 'session-updated' && event.session?.layout?.terminalId)
      .slice(baseline)
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      const terminalId = event.session?.layout?.terminalId
      if (terminalId) return terminalId
    }
    return ''
  }, 10_000, rapidStartBaseline)
  await page.waitForTimeout(500)
  const rapidStartIds = await page.evaluate(baseline =>
    (window.__claudeDesktopSmokeEvents ?? [])
      .filter(event => event.type === 'session-updated' && event.session?.layout?.terminalId)
      .slice(baseline)
      .map(event => event.session.layout.terminalId),
  rapidStartBaseline)
  assert(
    new Set(rapidStartIds).size === 1,
    `rapid Start shell created multiple terminals: ${JSON.stringify(rapidStartIds)}`,
  )
  await waitFor(page, () => {
    const stopButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.trim() === 'Stop')
    return stopButton instanceof HTMLButtonElement && !stopButton.disabled
  })
  const rapidStopBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['terminal:kill'] ?? 0)
  await page.evaluate(() => {
    const stopButton = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.trim() === 'Stop')
    if (!(stopButton instanceof HTMLButtonElement)) {
      throw new Error('missing Stop button for rapid-stop smoke')
    }
    stopButton.click()
    stopButton.click()
  })
  await page.waitForTimeout(250)
  const rapidStopKills = await app.evaluate(({ app: electronApp }, baseline) =>
    (electronApp.__claudeDesktopSmokeIpcCalls?.['terminal:kill'] ?? 0) - baseline,
  rapidStopBaseline)
  assert(
    rapidStopKills === 1,
    `rapid Stop submitted ${rapidStopKills} terminal kill requests`,
  )
  await waitFor(page, sessionId =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const session = sessions.find(item => item.id === sessionId)
      return session && session.layout.terminalId === undefined
    }),
  10_000, primarySessionId)
  await waitFor(page, () => {
    const text = document.querySelector('.terminal-status.info')?.textContent ?? ''
    return text.includes('Shell stopped')
  })

  progress('checking terminal failure visibility')
  await page.evaluate(async workspace => {
    await window.claudeDesktop.sessions.create(workspace)
  }, terminalFailureCwd)
  await waitFor(page, () => {
    const active = document.querySelector('.session-row.active')?.textContent ?? ''
    return active.includes('claude-desktop-e2e-terminal-failure-')
  })
  await rm(terminalFailureCwd, { recursive: true, force: true })
  await page.getByRole('button', { name: /Terminal/ }).click()
  await page.getByRole('region', { name: /Terminal output/ }).waitFor()
  await page.getByRole('button', { name: /Start shell/ }).click()
  await waitFor(page, () => {
    const status = document.querySelector('.terminal-status.error')?.textContent ?? ''
    const placeholder = document.querySelector('.terminal-placeholder')?.textContent ?? ''
    return (
      placeholder.includes('Start a shell') &&
      (
        status.includes('not accessible') ||
        status.includes('does not exist') ||
        status.includes('no such file') ||
        status.includes('ENOENT') ||
        status.includes('spawn')
      )
    )
  })
  await focusSmokeSessionDirect(page, primarySessionId)
  await page.getByRole('button', { name: /Terminal/ }).click()
  await page.getByRole('region', { name: /Terminal output/ }).waitFor()
  await waitFor(page, () => {
    const status = document.querySelector('.terminal-status')?.textContent ?? ''
    const placeholder = document.querySelector('.terminal-placeholder')?.textContent ?? ''
    return placeholder.includes('Start a shell') && !status.includes('Restoring shell state')
  })
  progress('terminal verified')
  await capture(page, 'terminal')

  progress('checking preview')
  await page.getByRole('button', { name: /Preview/ }).click()
  await page.getByRole('region', { name: /Preview pane/ }).waitFor()
  await waitFor(page, () => {
    const text = document.querySelector('.preview-frame')?.textContent ?? ''
    const openButton = [...document.querySelectorAll('.preview-toolbar button')]
      .find(button => button.textContent?.trim() === 'Open')
    const externalButton = document.querySelector('.preview-toolbar button[aria-label="Open in browser"]')
    return (
      text.includes('Open a preview') &&
      text.includes('Enter an http:// or https:// URL to render it inside this pane.') &&
      openButton?.disabled === true &&
      externalButton?.disabled === true
    )
  })
  await page.locator('.preview-toolbar input').fill('file:///tmp/nope.html')
  await waitFor(page, () => {
    const text = document.querySelector('.preview-frame')?.textContent ?? ''
    const status = document.querySelector('.preview-status.error')?.textContent ?? ''
    const openButton = [...document.querySelectorAll('.preview-toolbar button')]
      .find(button => button.textContent?.trim() === 'Open')
    const externalButton = document.querySelector('.preview-toolbar button[aria-label="Open in browser"]')
    return (
      text.includes('URL must start with http:// or https://') &&
      status.includes('URL must start with http:// or https://') &&
      openButton?.disabled === true &&
      externalButton?.disabled === true
    )
  })
  const rejectedPreview = await page.evaluate(async () => {
    try {
      await window.claudeDesktop.preview.setUrl('file:///tmp/nope.html')
      return false
    } catch (cause) {
      return String(cause).includes('preview:setUrl url must start with http:// or https://')
    }
  })
  assert(rejectedPreview, 'invalid preview URL was not rejected by IPC validation')
  await page.locator('.preview-toolbar input').fill(previewServer.url)
  await waitFor(page, () => {
    const status = document.querySelector('.preview-status.info')?.textContent ?? ''
    return status.includes('Press Open to update the embedded preview.')
  })
  await waitFor(page, () => {
    const openButton = [...document.querySelectorAll('.preview-toolbar button')]
      .find(button => button.textContent?.trim() === 'Open')
    return (
      openButton instanceof HTMLButtonElement &&
      !openButton.disabled &&
      Boolean(openButton.querySelector('.glyph'))
    )
  })
  const previewOpenBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['preview:setUrl'] ?? 0)
  await page.evaluate(() => {
    const openButton = [...document.querySelectorAll('.preview-toolbar button')]
      .find(button => button.textContent?.trim() === 'Open')
    if (!(openButton instanceof HTMLButtonElement)) {
      throw new Error('missing Preview Open button for rapid-open smoke')
    }
    openButton.click()
    openButton.click()
  })
  await page.waitForTimeout(100)
  const rapidPreviewOpenCalls = await app.evaluate(({ app: electronApp }, baseline) =>
    (electronApp.__claudeDesktopSmokeIpcCalls?.['preview:setUrl'] ?? 0) - baseline,
  previewOpenBaseline)
  assert(
    rapidPreviewOpenCalls === 1,
    `rapid Preview Open submitted ${rapidPreviewOpenCalls} preview:setUrl requests`,
  )
  await waitFor(page, () => {
    const frame = document.querySelector('iframe[title="Embedded preview"]')
    const status = document.querySelector('.preview-status.success')?.textContent ?? ''
    return frame?.getAttribute('src')?.startsWith('http://127.0.0.1:') &&
      status.includes('Previewing http://127.0.0.1:')
  })
  await app.evaluate(({ shell }) => {
    globalThis.__claudeDesktopSmokeExternalUrls = []
    shell.openExternal = async url => {
      globalThis.__claudeDesktopSmokeExternalUrls.push(url)
    }
  })
  await page.locator('.preview-toolbar').getByRole('button', { name: /Open in browser/ }).click()
  await waitFor(page, () => {
    const status = document.querySelector('.preview-status.success')?.textContent ?? ''
    const iframe = document.querySelector('iframe[title="Embedded preview"]')
    return status.includes('Opened http://127.0.0.1:') &&
      status.includes('in browser') &&
      status.includes('Embedded preview unchanged.') &&
      iframe?.getAttribute('src')?.startsWith('http://127.0.0.1:')
  })
  const openedExternalUrls = await app.evaluate(() => globalThis.__claudeDesktopSmokeExternalUrls ?? [])
  assert(
    openedExternalUrls.includes(previewServer.url),
    `external preview button did not call shell.openExternal with preview URL: ${JSON.stringify(openedExternalUrls)}`,
  )
  await app.evaluate(({ shell }) => {
    globalThis.__claudeDesktopSmokeExternalUrls = []
    globalThis.__claudeDesktopSmokeResolveExternal = undefined
    shell.openExternal = async url => {
      globalThis.__claudeDesktopSmokeExternalUrls.push(url)
      await new Promise(resolve => {
        globalThis.__claudeDesktopSmokeResolveExternal = resolve
      })
    }
  })
  await page.evaluate(() => {
    const button = document.querySelector('.preview-toolbar button[aria-label="Open in browser"]')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('preview external button missing')
    }
    button.click()
    button.click()
  })
  await waitFor(page, () => {
    const status = document.querySelector('.preview-status.info')?.textContent ?? ''
    const externalButton = document.querySelector('.preview-toolbar button[aria-label="Open in browser"]')
    return status.includes('Opening http://127.0.0.1:') && externalButton?.disabled === true
  })
  await new Promise(resolve => setTimeout(resolve, 100))
  const rapidExternalUrls = await app.evaluate(() => globalThis.__claudeDesktopSmokeExternalUrls ?? [])
  assert(
    rapidExternalUrls.length === 1,
    `rapid external preview clicks opened ${rapidExternalUrls.length} browser windows`,
  )
  await app.evaluate(() => {
    globalThis.__claudeDesktopSmokeResolveExternal?.()
  })
  await waitFor(page, () => {
    const status = document.querySelector('.preview-status.success')?.textContent ?? ''
    const iframe = document.querySelector('iframe[title="Embedded preview"]')
    return status.includes('Opened http://127.0.0.1:') &&
      status.includes('in browser') &&
      status.includes('Embedded preview unchanged.') &&
      iframe?.getAttribute('src')?.startsWith('http://127.0.0.1:')
  })
  await page.frameLocator('iframe').getByText('Claude Desktop Preview Smoke').waitFor()
  await capture(page, 'preview')

  progress('checking preview session isolation')
  const secondPreviewUrl = `${previewServer.url}?session=second`
  await focusSmokeSessionDirect(page, focusResult.second)
  await page.getByRole('button', { name: /Preview/ }).click()
  await page.getByRole('region', { name: /Preview pane/ }).waitFor()
  await waitFor(page, () => {
    const input = document.querySelector('.preview-toolbar input')
    const iframe = document.querySelector('iframe[title="Embedded preview"]')
    const placeholder = document.querySelector('.preview-placeholder')?.textContent ?? ''
    return input?.value === '' &&
      iframe?.getAttribute('src') === 'about:blank' &&
      placeholder.includes('Enter an http:// or https:// URL')
  })
  const previewEmptyState = await page.evaluate(() => {
    const placeholder = document.querySelector('.preview-placeholder')
    return {
      hasIcon: Boolean(placeholder?.querySelector('.glyph')),
      hasTitle: Boolean(placeholder?.querySelector('strong')?.textContent?.includes('Open a preview')),
      hasDetails: Boolean(placeholder?.textContent?.includes('Enter an http:// or https:// URL to render it inside this pane.')),
    }
  })
  assert(
    previewEmptyState.hasIcon && previewEmptyState.hasTitle && previewEmptyState.hasDetails,
    `preview empty state is too sparse: ${JSON.stringify(previewEmptyState)}`,
  )
  await page.locator('.preview-toolbar input').fill(secondPreviewUrl)
  await page.locator('.preview-toolbar').getByRole('button', { name: /^Open$/ }).click()
  await waitFor(page, expectedUrl => {
    const input = document.querySelector('.preview-toolbar input')
    const iframe = document.querySelector('iframe[title="Embedded preview"]')
    const status = document.querySelector('.preview-status.success')?.textContent ?? ''
    return input?.value === expectedUrl &&
      iframe?.getAttribute('src') === expectedUrl &&
      status.includes(`Previewing ${expectedUrl}`)
  }, 10_000, secondPreviewUrl)
  await page.evaluate(primarySessionId =>
    window.claudeDesktop.sessions.focus(primarySessionId),
  focusResult.first)
  await waitForActiveSessionId(page, focusResult.first)
  await waitFor(page, expectedUrl => {
    const input = document.querySelector('.preview-toolbar input')
    const iframe = document.querySelector('iframe[title="Embedded preview"]')
    const status = document.querySelector('.preview-status.success')?.textContent ?? ''
    return input?.value === expectedUrl &&
      iframe?.getAttribute('src') === expectedUrl &&
      status.includes(`Previewing ${expectedUrl}`)
  }, 10_000, previewServer.url)
  await page.evaluate(secondSessionId =>
    window.claudeDesktop.sessions.focus(secondSessionId),
  focusResult.second)
  await waitForActiveSessionId(page, focusResult.second)
  await waitFor(page, expectedUrl => {
    const input = document.querySelector('.preview-toolbar input')
    const iframe = document.querySelector('iframe[title="Embedded preview"]')
    const status = document.querySelector('.preview-status.success')?.textContent ?? ''
    return input?.value === expectedUrl &&
      iframe?.getAttribute('src') === expectedUrl &&
      status.includes(`Previewing ${expectedUrl}`)
  }, 10_000, secondPreviewUrl)
  await page.evaluate(primarySessionId =>
    window.claudeDesktop.sessions.focus(primarySessionId),
  focusResult.first)
  await waitForActiveSessionId(page, focusResult.first)

  const result = await page.evaluate(async workspace => {
    const session = window.__claudeDesktopSmokeSession
    const tree = await window.claudeDesktop.workspace.tree(workspace)
    const after = await window.claudeDesktop.workspace.readFile(workspace, 'src/app.txt')
    const status = await window.claudeDesktop.git.status(workspace)
    const diff = await window.claudeDesktop.git.diff(workspace)
    return {
      sessionId: session?.id,
      treeNames: tree.map(entry => entry.name),
      after,
      status,
      diff,
      disposeType: typeof window.__claudeDesktopDisposeSmokeEvents,
      iframeSrc: document.querySelector('iframe')?.getAttribute('src'),
    }
  }, cwd)

  assert(result.sessionId, 'session id was not returned')
  assert(result.treeNames.includes('src'), 'workspace tree did not include src')
  assert(result.after === 'hello\nupdated through monaco\n', 'workspace save did not persist')
  assert(result.status.includes('M src/app.txt'), 'git status did not show edited file')
  assert(result.diff.includes('updated through monaco'), 'git diff did not show edited file')
  assert(result.disposeType === 'function', 'event disposer is not a function')
  assert(result.iframeSrc === previewServer.url, 'preview iframe was not updated')
  assert(terminalOutput.includes('desktop-terminal-ok'), 'terminal output was not rendered')
  assert(terminalResize.columns >= 20, 'terminal resize did not include valid columns')
  assert(terminalResize.rows >= 5, 'terminal resize did not include valid rows')

  const bodyText = await page.textContent('body')
  assert(
    bodyText?.includes('fake desktop response') &&
      bodyText.includes('proxy=socks5://127.0.0.1:18999') &&
      bodyText.includes('desktop_smoke_') &&
      bodyText.includes('const desktopSmoke = true') &&
      bodyText.includes('desktop docs'),
    'assistant response with proxy env was not rendered',
  )
  const duplicateChatState = await page.evaluate(() => ({
    helloUserMessages: [...document.querySelectorAll('.message-user')]
      .filter(message => (message.textContent ?? '').includes('hello desktop'))
      .length,
    fakeSystemMessages: [...document.querySelectorAll('.message-system')]
      .filter(message => (message.textContent ?? '').includes('fake desktop response'))
      .length,
  }))
  assert(
    duplicateChatState.helloUserMessages === 1 && duplicateChatState.fakeSystemMessages === 0,
    `chat rendered duplicate user/system messages: ${JSON.stringify(duplicateChatState)}`,
  )
  assert(
    bodyText?.includes('permission allow received for toolu-smoke-1 printf permission-ok'),
    'permission response did not reach runtime',
  )
  assert(
    bodyText?.includes('permission allow received for toolu-smoke-2 printf permission-queued-ok'),
    'queued permission response did not reach runtime',
  )
  assert(
    bodyText?.includes('permission deny received for toolu-smoke-1'),
    'deny response did not reach runtime',
  )
  const terminalStates = await page.evaluate(() =>
    (window.__claudeDesktopSmokeEvents ?? [])
      .filter(event => event.type === 'terminal-state')
      .map(event => event.terminal),
  )
  assert(
    terminalMode === 'pty',
    `terminal did not start in PTY mode: ${JSON.stringify(terminalStates)}`,
  )

  progress('checking runtime failure visibility')
  const runtimeFailureSessionId = await withTimeout(
    page.evaluate(async workspace => {
      const session = await window.claudeDesktop.sessions.create(workspace)
      return session.id
    }, failureCwd),
    20_000,
    'runtime failure session create',
  )
  progress('runtime failure session created')
  await waitFor(page, () => {
    const active = document.querySelector('.session-row.active')?.textContent ?? ''
    return active.includes('claude-desktop-e2e-failure-')
  })
  await page.locator('select[aria-label="Send message to"]').selectOption('session')
  await fillComposer(page, 'runtime failure desktop')
  progress('runtime failure prompt filled')
  const runtimeFailureSendBaseline = await app.evaluate(({ app: electronApp }) => ({
    session: electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:send'] ?? 0,
    agent: electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:launchAgentTask'] ?? 0,
    team: electronApp.__claudeDesktopSmokeIpcCalls?.['teams:send'] ?? 0,
  }))
  await withTimeout(
    page.locator('.composer').getByRole('button', { name: /Send/ }).click(),
    20_000,
    'runtime failure send click',
  )
  progress('runtime failure prompt sent')
  const runtimeFailureSendCalls = await app.evaluate(({ app: electronApp }, baseline) => ({
    session: (electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:send'] ?? 0) - baseline.session,
    agent: (electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:launchAgentTask'] ?? 0) - baseline.agent,
    team: (electronApp.__claudeDesktopSmokeIpcCalls?.['teams:send'] ?? 0) - baseline.team,
  }), runtimeFailureSendBaseline)
  assert(
    runtimeFailureSendCalls.session === 1 &&
      runtimeFailureSendCalls.agent === 0 &&
      runtimeFailureSendCalls.team === 0,
    `runtime failure prompt routed to wrong target: ${JSON.stringify(runtimeFailureSendCalls)}`,
  )
  try {
    await waitForApp(app, ({ app: electronApp }, sessionId) => {
      const events = electronApp.__claudeDesktopSmokeEvents ?? []
      const runtimeError = events.find(event =>
        event?.type === 'runtime-error' &&
        event.sessionId === sessionId &&
        String(event.message).includes('desktop runtime smoke failure'),
      )
      const failedUpdate = [...events].reverse().find(event =>
        event?.type === 'session-updated' &&
        event.session?.id === sessionId &&
        event.session?.status === 'error' &&
        String(event.session?.lastError ?? '').includes('desktop runtime smoke failure'),
      )
      return runtimeError && failedUpdate
        ? { runtimeError, failedUpdate }
        : undefined
    }, 20_000, runtimeFailureSessionId)
  } catch (cause) {
    const snapshot = await app.evaluate(({ app: electronApp }) => {
      const events = electronApp.__claudeDesktopSmokeEvents ?? []
      return {
        lastEvents: events.slice(-12).map(event => {
          if (event?.type === 'session-updated') {
            return {
              type: event.type,
              sessionId: event.session?.id,
              title: event.session?.title,
              status: event.session?.status,
              activity: event.session?.activity,
              lastError: event.session?.lastError,
              lastMessage: event.session?.messages?.at(-1)?.text,
            }
          }
          return event
        }),
        ipcCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
        ipcArgs: electronApp.__claudeDesktopSmokeIpcArgs ?? {},
      }
    })
    console.log(JSON.stringify({
      phase: 'runtime-failure-main-event-timeout',
      runtimeFailureSessionId,
      runtimeFailureSendCalls,
      snapshot,
    }, null, 2))
    throw cause
  }
  progress('runtime failure main event observed')
  progress('checking runtime failure visible state')
  try {
    await withTimeout(
      page.getByText('desktop runtime smoke failure').first().waitFor({ timeout: 10_000 }),
      20_000,
      'runtime failure visible state',
    )
  } catch (cause) {
    const pageSnapshot = await withTimeout(page.evaluate(async sessionId => {
      const sessions = await window.claudeDesktop.sessions.list()
      return {
        active: document.querySelector('.session-row.active')?.textContent ?? '',
        headerError: document.querySelector('.chat-header .inline-error')?.textContent ?? '',
        composer: document.querySelector('.composer textarea')?.value,
        bodySample: (document.body.textContent ?? '').slice(0, 1000),
        session: sessions.find(item => item.id === sessionId),
      }
    }, runtimeFailureSessionId), 5_000, 'runtime failure page snapshot').catch(error => ({
      snapshotError: error instanceof Error ? error.message : String(error),
    }))
    const appSnapshot = await withTimeout(app.evaluate(({ app: electronApp, BrowserWindow }) => ({
      ipcCalls: electronApp.__claudeDesktopSmokeIpcCalls ?? {},
      windows: BrowserWindow.getAllWindows().map(window => ({
        url: window.webContents.getURL(),
        title: window.getTitle(),
        destroyed: window.isDestroyed(),
        visible: window.isVisible(),
      })),
    })), 5_000, 'runtime failure app snapshot').catch(error => ({
      snapshotError: error instanceof Error ? error.message : String(error),
    }))
    console.log(JSON.stringify({
      phase: 'runtime-failure-visible-timeout',
      pageSnapshot,
      appSnapshot,
    }, null, 2))
    throw cause
  }
  progress('runtime failure visible state observed')
  const runtimeFailureState = await page.evaluate(async sessionId => {
    const sessions = await window.claudeDesktop.sessions.list()
    return sessions.find(session => session.id === sessionId)
  }, runtimeFailureSessionId)
  assert(runtimeFailureState?.status === 'error', 'runtime failure session did not persist error status')
  assert(
    runtimeFailureState?.lastError?.includes('desktop runtime smoke failure'),
    'runtime failure session did not persist visible error text',
  )
  progress('runtime failure persisted state observed')
  await discardSmokeEditorChanges(page)
  await withTimeout(
    focusSmokeSessionDirect(page, result.sessionId),
    20_000,
    'runtime failure refocus primary session',
  )

  progress('checking terminal close race')
  await page.evaluate(async ({ workspace, primarySessionId }) => {
    const session = await window.claudeDesktop.sessions.create(workspace)
    const terminal = await window.claudeDesktop.terminal.create(workspace)
    await window.claudeDesktop.sessions.updateLayout(session.id, {
      activePane: 'terminal',
      terminalId: terminal.id,
    })
    await window.claudeDesktop.terminal.write(
      terminal.id,
      'while true; do printf desktop-terminal-close-race; sleep 0.05; done\n',
    )
    await window.claudeDesktop.sessions.focus(primarySessionId)
    return terminal.id
  }, { workspace: terminalCloseCwd, primarySessionId: result.sessionId })
  await waitFor(page, () => {
    const events = window.__claudeDesktopSmokeEvents ?? []
    return events.some(event =>
      event.type === 'terminal-data' &&
      String(event.data).includes('desktop-terminal-close-race'),
    )
  })
  const missingEditorFile = join(missingEditorCwd, 'src/missing.txt')
  const missingEditorSessionId = await page.evaluate(async workspace => {
    const session = await window.claudeDesktop.sessions.create(workspace)
    await window.claudeDesktop.workspace.saveFile(
      workspace,
      'src/missing.txt',
      'temporary editor restore smoke\n',
    )
    await window.claudeDesktop.sessions.updateLayout(session.id, {
      activePane: 'editor',
      activeFile: 'src/missing.txt',
    })
    await window.claudeDesktop.sessions.focus(window.__claudeDesktopSmokeSession.id)
    return session.id
  }, missingEditorCwd)
  await rm(missingEditorFile, { force: true })
  await writeFile(join(diffRestoreCwd, 'src/app.txt'), 'hello\nrestored diff smoke\n')
  const diffRestoreSessionId = await page.evaluate(async ({ workspace, primarySessionId }) => {
    const session = await window.claudeDesktop.sessions.create(workspace)
    await window.claudeDesktop.sessions.updateLayout(session.id, {
      activePane: 'diff',
    })
    await window.claudeDesktop.sessions.focus(primarySessionId)
    return session.id
  }, { workspace: diffRestoreCwd, primarySessionId: result.sessionId })
  const teamRestoreSessionId = await page.evaluate(async ({ workspace, primarySessionId }) => {
    const session = await window.claudeDesktop.sessions.create(workspace)
    await window.claudeDesktop.sessions.updateLayout(session.id, {
      activePane: 'teams',
      primaryView: 'teams',
      teamsActiveSection: 'agents-teams',
      selectedTeamName: 'frontend',
      selectedTeamRecipient: 'builder',
    })
    await window.claudeDesktop.sessions.focus(primarySessionId)
    return session.id
  }, { workspace: teammateRestoreCwd, primarySessionId: result.sessionId })
  const agentRestoreSessionId = await page.evaluate(async ({ workspace, primarySessionId }) => {
    const session = await window.claudeDesktop.sessions.create(workspace)
    await window.claudeDesktop.sessions.updateLayout(session.id, {
      activePane: 'agents',
      primaryView: 'agents',
      agentsActiveSection: 'agents-editor',
      selectedAgentType: 'desktop-smoke-agent',
      selectedAgentSource: 'built-in',
    })
    await window.claudeDesktop.sessions.focus(primarySessionId)
    return session.id
  }, { workspace: agentRestoreCwd, primarySessionId: result.sessionId })
  const settingsRestoreSessionId = await page.evaluate(async ({
    workspace,
    primarySessionId,
    mcpSourcePath,
    skillPath,
  }) => {
    const session = await window.claudeDesktop.sessions.create(workspace)
    await window.claudeDesktop.sessions.updateLayout(session.id, {
      activePane: 'settings',
      primaryView: 'settings',
      settingsActiveSection: 'settings-mcp',
      selectedMcpName: 'playwright',
      selectedMcpSourcePath: mcpSourcePath,
      selectedMcpScope: 'project',
      selectedSkillName: 'existing-skill',
      selectedSkillPath: skillPath,
      selectedSkillScope: 'project',
    })
    await window.claudeDesktop.sessions.focus(primarySessionId)
    return session.id
  }, {
    workspace: settingsRestoreCwd,
    primarySessionId: result.sessionId,
    mcpSourcePath: join(claudeHome, '.mcp.json'),
    skillPath: join(claudeHome, 'skills/existing-skill'),
  })
  const globalRestoreTaskId = await page.evaluate(async () => {
    const tasks = await window.claudeDesktop.tasks.addOrUpdate({
      name: 'Global restore task',
      schedule: '0 9 * * *',
      prompt: 'desktop smoke scheduled task',
      enabled: true,
    })
    const task = tasks.find(item =>
      item.name === 'Global restore task' &&
        item.prompt === 'desktop smoke scheduled task')
    if (!task) throw new Error('Global restore task was not created')
    return task.id
  })
  await waitFor(page, taskId => window.claudeDesktop.config.get().then(config =>
    config.scheduledTasks.some(task =>
      task.id === taskId &&
      task.prompt === 'desktop smoke scheduled task',
    ),
  ), 10_000, globalRestoreTaskId)
  const tasksRestoreSessionId = await page.evaluate(async ({ workspace, primarySessionId, globalTaskId }) => {
    const session = await window.claudeDesktop.sessions.create(workspace)
    await window.claudeDesktop.sessions.updateLayout(session.id, {
      activePane: 'tasks',
      primaryView: 'tasks',
      tasksActiveSection: 'tasks-global-tasks',
      selectedGlobalTaskId: globalTaskId,
      selectedProjectTaskId: 'project-restore-task',
    })
    await window.claudeDesktop.sessions.focus(primarySessionId)
    return session.id
  }, { workspace: tasksRestoreCwd, primarySessionId: result.sessionId, globalTaskId: globalRestoreTaskId })

  progress('checking restore')
  await waitFor(page, () => {
    const toggle = document.querySelector('.rail-section-toggle')
    return toggle instanceof HTMLButtonElement && toggle.disabled === false
  })
  await page.evaluate(() => {
    const toggle = document.querySelector('.rail-section-toggle')
    if (
      toggle instanceof HTMLButtonElement &&
      toggle.getAttribute('aria-expanded') === 'true'
    ) {
      toggle.click()
    }
  })
  await waitFor(page, () => {
    const toggle = document.querySelector('.rail-section-toggle')
    return toggle?.getAttribute('aria-expanded') === 'false' &&
      window.localStorage.getItem('claudeDesktop.sessionRailCollapsed') === 'true'
  })
  await closeApp(app, 'pre-restore app')
  const restoredLaunch = await launchAppWithFirstWindow('restored window')
  app = restoredLaunch.app
  const restoredPage = restoredLaunch.page
  await installSmokeEventHook(restoredPage)
  await restoredPage.waitForSelector('.rail-section-toggle')
  const restoredRailCollapsed = await restoredPage.evaluate(async () => {
    const toggle = document.querySelector('.rail-section-toggle')
    const count = toggle?.querySelector('.rail-section-count')
    const sessions = await window.claudeDesktop.sessions.list()
    const toggleRect = toggle?.getBoundingClientRect()
    const countRect = count?.getBoundingClientRect()
    return {
      expanded: toggle?.getAttribute('aria-expanded'),
      hasSessionList: Boolean(document.querySelector('.session-list')),
      label: toggle?.getAttribute('aria-label') ?? '',
      count: count?.textContent ?? '',
      expected: String(sessions.length),
      countFits: Boolean(
        toggleRect &&
          countRect &&
          countRect.left >= toggleRect.left &&
          countRect.right <= toggleRect.right,
      ),
      stored: window.localStorage.getItem('claudeDesktop.sessionRailCollapsed'),
    }
  })
  assert(
    restoredRailCollapsed.expanded === 'false' &&
      restoredRailCollapsed.hasSessionList === false &&
      restoredRailCollapsed.count === restoredRailCollapsed.expected &&
      restoredRailCollapsed.label.includes(`${restoredRailCollapsed.expected} sessions`) &&
      restoredRailCollapsed.countFits &&
      restoredRailCollapsed.stored === 'true',
    `session rail collapsed preference was not restored: ${JSON.stringify(restoredRailCollapsed)}`,
  )
  await restoredPage.getByRole('button', { name: /Sessions/ }).click()
  await restoredPage.waitForSelector('.session-row.active')
  await waitForActiveSessionId(restoredPage, result.sessionId)
  await waitFor(restoredPage, () => {
    const input = document.querySelector('.preview-toolbar input')
    const iframe = document.querySelector('iframe')
    return (
      input?.value?.startsWith('http://127.0.0.1:') &&
      iframe?.getAttribute('src')?.startsWith('http://127.0.0.1:')
    )
  })
  const restoredState = await restoredPage.evaluate(async workspace => {
    const sessions = await window.claudeDesktop.sessions.list()
    const restored = sessions.find(session => session.cwd === workspace)
    return {
      sessionCount: sessions.length,
      activeText: document.querySelector('.session-row.active')?.textContent ?? '',
      activePane: restored?.layout.activePane,
      activeFile: restored?.layout.activeFile,
      previewUrl: restored?.layout.previewUrl,
      terminalId: restored?.layout.terminalId,
    }
  }, cwd)
  assert(restoredState.sessionCount >= 2, 'stored sessions were not restored')
  assert(restoredState.activeText.includes(cwd), 'restored active session was not selected')
  assert(restoredState.activePane === 'preview', 'active pane was not restored')
  assert(restoredState.activeFile === 'src/app.txt', 'active file was not restored')
  assert(restoredState.previewUrl === previewServer.url, 'preview URL was not restored')
  assert(restoredState.terminalId === undefined, 'volatile terminal id should not be restored')
  await restoredPage.getByRole('button', { name: /Editor/ }).click()
  await restoredPage.getByRole('region', { name: /Editor for src\/app\.txt/ }).waitFor()
  await waitFor(restoredPage, () => {
    const status = document.querySelector('.editor-status')?.textContent ?? ''
    const editorReady = Boolean(window.__claudeDesktopSmokeEditor)
    const editorValue = window.__claudeDesktopSmokeEditor?.getValue?.() ?? ''
    return (
      editorReady &&
      status.includes('Opened src/app.txt') &&
      editorValue.includes('updated through monaco')
    )
  })
  await focusSmokeSessionDirect(restoredPage, missingEditorSessionId)
  await restoredPage.getByRole('button', { name: /Editor/ }).click()
  await restoredPage.getByRole('region', { name: /File editor/ }).waitFor()
  await waitFor(restoredPage, () => {
    const status = document.querySelector('.editor-status.error')?.textContent ?? ''
    const placeholder = document.querySelector('.editor-placeholder')?.textContent ?? ''
    const toolbar = document.querySelector('.editor-toolbar')?.textContent ?? ''
    return (
      status.includes('missing.txt') &&
      placeholder.includes('Open a file') &&
      toolbar.includes('Open a file from the Files pane')
    )
  })
  const missingEditorState = await restoredPage.evaluate(async sessionId => {
    const sessions = await window.claudeDesktop.sessions.list()
    return sessions.find(session => session.id === sessionId)?.layout.activeFile
  }, missingEditorSessionId)
  assert(missingEditorState === undefined, 'missing restored editor file was not cleared from layout')
  await focusSmokeSessionDirect(restoredPage, diffRestoreSessionId)
  await restoredPage.getByRole('region', { name: /Diff viewer/ }).waitFor()
  await waitFor(restoredPage, () => {
    const toolbar = document.querySelector('.diff-pane .pane-toolbar')?.textContent ?? ''
    const fileList = document.querySelector('.diff-file-list')?.textContent ?? ''
    const diffText = document.querySelector('.diff-viewer')?.textContent ?? ''
    const status = document.querySelector('.diff-inline-status.success')?.textContent ?? ''
    return (
      toolbar.includes('Git changes · 1 file') &&
      fileList.includes('src/app.txt') &&
      diffText.includes('restored diff smoke') &&
      status.includes('Updated git changes: 1 file changed.')
    )
  })
  await focusSmokeSessionDirect(restoredPage, teamRestoreSessionId)
  await restoredPage.getByRole('region', { name: /Team management/ }).waitFor()
  await waitFor(restoredPage, () => {
    const active = [...document.querySelectorAll('.primary-nav button.active')]
      .map(button => button.textContent ?? '')
    const toolbar = document.querySelector('.teams-pane .pane-toolbar span')?.textContent ?? ''
    const jumpbarButtons = [...document.querySelectorAll('.teams-pane .pane-jumpbar button')]
    const jumpbarLabels = jumpbarButtons.map(button => button.textContent?.trim())
    const activeJumpbar = jumpbarButtons.find(button => button.classList.contains('active'))
    const activeTeam = [...document.querySelectorAll('#agents-teams article.active')]
      .find(article => article.textContent?.includes('frontend'))
    return (
      active.some(label => label.includes('Teams')) &&
      document.querySelector('.teams-pane') instanceof HTMLElement &&
      toolbar.includes('Teams') &&
      jumpbarLabels.length === 1 &&
      jumpbarLabels[0] === 'Teams' &&
      activeJumpbar?.textContent?.trim() === 'Teams' &&
      activeJumpbar.getAttribute('aria-current') === 'page' &&
      activeJumpbar.getAttribute('aria-pressed') === 'true' &&
      activeTeam?.getAttribute('aria-current') === 'true' &&
      !document.querySelector('#agents-catalog')
    )
  })
  const teamRestoreState = await restoredPage.evaluate(async sessionId => {
    const sessions = await window.claudeDesktop.sessions.list()
    const session = sessions.find(item => item.id === sessionId)
    const activeTeam = [...document.querySelectorAll('#agents-teams article.active')]
      .find(article => article.textContent?.includes('frontend'))
    return {
      activePane: session?.layout.activePane,
      primaryView: session?.layout.primaryView,
      teamsActiveSection: session?.layout.teamsActiveSection,
      selectedTeamName: session?.layout.selectedTeamName,
      selectedTeamRecipient: session?.layout.selectedTeamRecipient,
      selectedTeamCardCurrent: activeTeam?.getAttribute('aria-current') === 'true',
    }
  }, teamRestoreSessionId)
  assert(teamRestoreState.activePane === 'teams', 'team active pane was not restored')
  assert(teamRestoreState.primaryView === 'teams', 'team primary view was not restored')
  assert(teamRestoreState.teamsActiveSection === 'agents-teams', 'teams grouped section was not restored')
  assert(teamRestoreState.selectedTeamName === 'frontend', 'selected team name was not restored')
  assert(teamRestoreState.selectedTeamRecipient === 'builder', 'selected team recipient was not restored')
  assert(teamRestoreState.selectedTeamCardCurrent, 'selected team current card state was not restored')
  await focusSmokeSessionDirect(restoredPage, agentRestoreSessionId)
  await restoredPage.getByRole('region', { name: /Agent management/ }).waitFor()
  await waitFor(restoredPage, () => {
    const agentsLayout = document.querySelector('.workspace-layout.primary-agents')
    const activePrimary = [...document.querySelectorAll('.primary-nav button.active')]
      .map(button => button.textContent ?? '')
    const pane = document.querySelector('.agents-pane')
    const activeJumpbar = [...document.querySelectorAll('.agents-pane .pane-jumpbar button.active')]
    const activeJumpbarLabels = activeJumpbar.map(button => button.textContent?.trim() ?? '')
    const customJumpbar = activeJumpbar.find(button => button.textContent?.trim() === 'Custom')
    const activeSelectedAgent = [...document.querySelectorAll('#agents-catalog article.active')]
      .find(article => article.textContent?.includes('desktop-smoke-agent'))
    const section = document.querySelector('#agents-editor')
    const heading = section?.querySelector('h3')
    if (!(agentsLayout instanceof HTMLElement) ||
      !activePrimary.some(label => label.includes('Agents')) ||
      !(pane instanceof HTMLElement) ||
      !(section instanceof HTMLElement) ||
      !(heading instanceof HTMLElement)
    ) {
      return false
    }
    const paneRect = pane.getBoundingClientRect()
    const headingRect = heading.getBoundingClientRect()
    return (
      pane.scrollTop > 0 &&
      headingRect.top >= paneRect.top &&
      headingRect.bottom <= paneRect.bottom &&
      activeJumpbarLabels.includes('Custom') &&
      customJumpbar?.getAttribute('aria-current') === 'page' &&
      customJumpbar.getAttribute('aria-pressed') === 'true' &&
      activeSelectedAgent?.getAttribute('aria-current') === 'true' &&
      section.textContent?.includes('Custom agents')
    )
  })
  const agentRestoreState = await restoredPage.evaluate(async sessionId => {
    const sessions = await window.claudeDesktop.sessions.list()
    const session = sessions.find(item => item.id === sessionId)
    const activeSelectedAgent = [...document.querySelectorAll('#agents-catalog article.active')]
      .find(article => article.textContent?.includes('desktop-smoke-agent'))
    return {
      activePane: session?.layout.activePane,
      primaryView: session?.layout.primaryView,
      agentsActiveSection: session?.layout.agentsActiveSection,
      selectedAgentType: session?.layout.selectedAgentType,
      selectedAgentSource: session?.layout.selectedAgentSource,
      selectedAgentCardCurrent: activeSelectedAgent?.getAttribute('aria-current') === 'true',
    }
  }, agentRestoreSessionId)
  assert(agentRestoreState.activePane === 'agents', 'agents active pane was not restored')
  assert(agentRestoreState.primaryView === 'agents', 'agents primary view was not restored')
  assert(
    agentRestoreState.agentsActiveSection === 'agents-editor',
    'agents grouped section was not restored',
  )
  assert(agentRestoreState.selectedAgentType === 'desktop-smoke-agent', 'selected agent type was not restored')
  assert(agentRestoreState.selectedAgentSource === 'built-in', 'selected agent source was not restored')
  assert(agentRestoreState.selectedAgentCardCurrent, 'selected agent current card state was not restored')
  await focusSmokeSessionDirect(restoredPage, settingsRestoreSessionId)
  await restoredPage.waitForSelector('.settings-pane')
  await waitFor(restoredPage, () => {
    const settingsLayout = document.querySelector('.workspace-layout.primary-settings')
    const activeFooter = document.querySelector('.rail-footer button.active')?.textContent ?? ''
    const activeSettings = document.querySelector('.settings-sidebar button.active')?.textContent ?? ''
    const section = document.querySelector('#settings-mcp')
    const mcpDetail = document.querySelector('[aria-label="Selected MCP server details"]')
    const skillDetail = document.querySelector('[aria-label="Selected skill contents"]')
    return (
      settingsLayout instanceof HTMLElement &&
      activeFooter.includes('Settings') &&
      activeSettings.includes('MCP') &&
      section instanceof HTMLElement &&
      mcpDetail?.textContent?.includes('playwright') &&
      mcpDetail.textContent.includes('@playwright/mcp@latest') &&
      skillDetail?.textContent?.includes('existing-skill') &&
      skillDetail.textContent.includes('Existing smoke skill')
    )
  })
  const settingsRestoreState = await restoredPage.evaluate(async sessionId => {
    const sessions = await window.claudeDesktop.sessions.list()
    const session = sessions.find(item => item.id === sessionId)
    const mcpDetail = document.querySelector('[aria-label="Selected MCP server details"]')
    const skillDetail = document.querySelector('[aria-label="Selected skill contents"]')
    return {
      activePane: session?.layout.activePane,
      primaryView: session?.layout.primaryView,
      settingsActiveSection: session?.layout.settingsActiveSection,
      selectedMcpName: session?.layout.selectedMcpName,
      selectedMcpSourcePath: session?.layout.selectedMcpSourcePath,
      selectedMcpScope: session?.layout.selectedMcpScope,
      selectedSkillName: session?.layout.selectedSkillName,
      selectedSkillPath: session?.layout.selectedSkillPath,
      selectedSkillScope: session?.layout.selectedSkillScope,
      mcpDetailRestored: mcpDetail?.textContent?.includes('playwright') &&
        mcpDetail.textContent.includes('@playwright/mcp@latest'),
      skillDetailRestored: skillDetail?.textContent?.includes('existing-skill') &&
        skillDetail.textContent.includes('Existing smoke skill'),
    }
  }, settingsRestoreSessionId)
  assert(settingsRestoreState.activePane === 'settings', 'settings active pane was not restored')
  assert(settingsRestoreState.primaryView === 'settings', 'settings primary view was not restored')
  assert(
    settingsRestoreState.settingsActiveSection === 'settings-mcp',
    'settings grouped section was not restored',
  )
  assert(settingsRestoreState.selectedMcpName === 'playwright', 'selected MCP name was not restored')
  assert(settingsRestoreState.selectedMcpSourcePath?.endsWith('/.mcp.json'), 'selected MCP source path was not restored')
  assert(settingsRestoreState.selectedMcpScope === 'project', 'selected MCP scope was not restored')
  assert(settingsRestoreState.selectedSkillName === 'existing-skill', 'selected skill name was not restored')
  assert(settingsRestoreState.selectedSkillPath?.endsWith('/skills/existing-skill'), 'selected skill path was not restored')
  assert(settingsRestoreState.selectedSkillScope === 'project', 'selected skill scope was not restored')
  assert(settingsRestoreState.mcpDetailRestored, 'selected MCP detail was not restored')
  assert(settingsRestoreState.skillDetailRestored, 'selected skill detail was not restored')
  await focusSmokeSessionDirect(restoredPage, tasksRestoreSessionId)
  await restoredPage.getByRole('region', { name: /Scheduled task management/ }).waitFor()
  await waitFor(restoredPage, async sessionId => {
    const config = await window.claudeDesktop.config.get()
    const sessions = await window.claudeDesktop.sessions.list()
    const session = sessions.find(item => item.id === sessionId)
    const tasksLayout = document.querySelector('.workspace-layout.primary-tasks')
    const activePrimary = [...document.querySelectorAll('.primary-nav button.active')]
      .map(button => button.textContent ?? '')
    const activeJumpbar = [...document.querySelectorAll('.tasks-pane .pane-jumpbar button.active')]
    const activeJumpbarLabels = activeJumpbar.map(button => button.textContent?.trim() ?? '')
    const globalJumpbar = activeJumpbar.find(button => button.textContent?.trim() === 'Global')
    const pane = document.querySelector('.tasks-pane')
    const section = document.querySelector('#tasks-global-tasks')
    const heading = section?.querySelector('h3')
    const globalTask = [...document.querySelectorAll('#tasks-global-tasks article[aria-selected="true"]')]
      .find(article => article.textContent?.includes('desktop smoke scheduled task'))
    const projectTask = [...document.querySelectorAll('#tasks-project-tasks article[aria-selected="true"]')]
      .find(article => article.textContent?.includes('project restore prompt'))
    const globalPrompt = document.querySelector('#tasks-global-tasks textarea[aria-label="Scheduled task prompt"]')
    const projectPrompt = document.querySelector('#tasks-project-tasks textarea[aria-label="Project task prompt"]')
    const paneRect = pane instanceof HTMLElement ? pane.getBoundingClientRect() : null
    const headingRect = heading instanceof HTMLElement ? heading.getBoundingClientRect() : null
    const checks = {
      hasTasksLayout: tasksLayout instanceof HTMLElement,
      activePrimaryHasTasks: activePrimary.some(label => label.includes('Tasks')),
      hasPane: pane instanceof HTMLElement,
      hasSection: section instanceof HTMLElement,
      hasHeading: heading instanceof HTMLElement,
      paneScrolled: pane instanceof HTMLElement && pane.scrollTop > 0,
      headingVisible: Boolean(
        paneRect &&
        headingRect &&
        headingRect.top >= paneRect.top &&
        headingRect.bottom <= paneRect.bottom,
      ),
      activeJumpbarHasGlobal: activeJumpbarLabels.includes('Global'),
      globalJumpbarCurrent: globalJumpbar?.getAttribute('aria-current') === 'page',
      globalJumpbarPressed: globalJumpbar?.getAttribute('aria-pressed') === 'true',
      sectionHasTitle: Boolean(section?.textContent?.includes('Global Scheduled Tasks')),
      globalTaskCurrent: globalTask?.getAttribute('aria-selected') === 'true',
      projectTaskCurrent: projectTask?.getAttribute('aria-selected') === 'true',
      globalPromptRestored: globalPrompt instanceof HTMLTextAreaElement &&
        globalPrompt.value === 'desktop smoke scheduled task',
      projectPromptRestored: projectPrompt instanceof HTMLTextAreaElement &&
        projectPrompt.value === 'project restore prompt',
    }
    return {
      ready: Object.values(checks).every(Boolean),
      checks,
      activePrimary,
      activeJumpbarLabels,
      paneScrollTop: pane instanceof HTMLElement ? pane.scrollTop : null,
      globalPromptValue: globalPrompt instanceof HTMLTextAreaElement ? globalPrompt.value : null,
      projectPromptValue: projectPrompt instanceof HTMLTextAreaElement ? projectPrompt.value : null,
      globalActiveText: globalTask?.textContent?.trim() ?? null,
      projectActiveText: projectTask?.textContent?.trim() ?? null,
      configTaskIds: config.scheduledTasks.map(task => task.id),
      sessionLayout: session?.layout,
    }
  }, 10_000, tasksRestoreSessionId)
  const tasksRestoreState = await restoredPage.evaluate(async sessionId => {
    const sessions = await window.claudeDesktop.sessions.list()
    const session = sessions.find(item => item.id === sessionId)
    const globalPrompt = document.querySelector('#tasks-global-tasks textarea[aria-label="Scheduled task prompt"]')
    const projectPrompt = document.querySelector('#tasks-project-tasks textarea[aria-label="Project task prompt"]')
    return {
      activePane: session?.layout.activePane,
      primaryView: session?.layout.primaryView,
      settingsActiveSection: session?.layout.settingsActiveSection,
      tasksActiveSection: session?.layout.tasksActiveSection,
      selectedGlobalTaskId: session?.layout.selectedGlobalTaskId,
      selectedProjectTaskId: session?.layout.selectedProjectTaskId,
      globalTaskDraftRestored: globalPrompt instanceof HTMLTextAreaElement &&
        globalPrompt.value === 'desktop smoke scheduled task',
      projectTaskDraftRestored: projectPrompt instanceof HTMLTextAreaElement &&
        projectPrompt.value === 'project restore prompt',
    }
  }, tasksRestoreSessionId)
  assert(tasksRestoreState.activePane === 'tasks', 'tasks active pane was not restored')
  assert(tasksRestoreState.primaryView === 'tasks', 'tasks primary view was not restored')
  assert(tasksRestoreState.settingsActiveSection !== 'tasks-global-tasks', 'tasks section leaked into settings layout state')
  assert(
    tasksRestoreState.tasksActiveSection === 'tasks-global-tasks',
    'tasks grouped section was not restored',
  )
  assert(tasksRestoreState.selectedGlobalTaskId === globalRestoreTaskId, 'selected global scheduled task was not restored')
  assert(tasksRestoreState.selectedProjectTaskId === 'project-restore-task', 'selected project scheduled task was not restored')
  assert(tasksRestoreState.globalTaskDraftRestored, 'selected global scheduled task draft was not restored')
  assert(tasksRestoreState.projectTaskDraftRestored, 'selected project scheduled task draft was not restored')
  await focusSmokeSessionDirect(restoredPage, result.sessionId)

  progress('checking deep link')
  await triggerSecondInstanceDeepLink(
    `claude-dev://resume?session=${encodeURIComponent(focusResult.second)}&cwd=${encodeURIComponent(secondCwd)}`,
  )
  await waitFor(restoredPage, () => {
    const active = document.querySelector('.session-row.active')?.textContent ?? ''
    return active.includes('claude-desktop-e2e-second-')
  })
  const deepLinkedState = await restoredPage.evaluate(async workspace => {
    const sessions = await window.claudeDesktop.sessions.list()
    return {
      matchingSessions: sessions.filter(session => session.cwd === workspace).length,
      activeText: document.querySelector('.session-row.active')?.textContent ?? '',
    }
  }, secondCwd)
  assert(deepLinkedState.matchingSessions === 1, 'deep link duplicated an existing session')
  assert(
    deepLinkedState.activeText.includes(secondCwd),
    'deep link did not focus the requested session',
  )
  await discardSmokeEditorChanges(restoredPage)
  await waitFor(restoredPage, () => {
    const active = document.querySelector('.session-row.active')
    const button = active?.closest('.session-row-shell')?.querySelector('.session-menu-button')
    return button instanceof HTMLButtonElement && button.disabled === false
  })
  await restoredPage.evaluate(() => {
    const active = document.querySelector('.session-row.active')
    const button = active?.closest('.session-row-shell')?.querySelector('.session-menu-button')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing active restored session menu button')
    }
    button.click()
  })
  await waitFor(restoredPage, () =>
    [...document.querySelectorAll('.session-context-menu [role="menuitem"]')]
      .some(item => item.textContent?.includes('Close session')),
  )
  await restoredPage.getByRole('menuitem', { name: /Close session/ }).click()
  await waitFor(restoredPage, () => {
    const text = document.querySelector('.confirmation-modal')?.textContent ?? ''
    return text.includes('Close session?') && text.includes('from the sidebar')
  })
  await confirmDesktopDialog(restoredPage, /Cancel/)
  await waitFor(restoredPage, ({ sessionId, workspace }) =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const activeText = document.querySelector('.session-row.active')?.textContent ?? ''
      return sessions.some(session => session.id === sessionId) &&
        activeText.includes(workspace)
    }),
  10_000, { sessionId: focusResult.second, workspace: secondCwd })
  await waitFor(restoredPage, () => {
    const active = document.querySelector('.session-row.active')
    const button = active?.closest('.session-row-shell')?.querySelector('.session-menu-button')
    return button instanceof HTMLButtonElement && button.disabled === false
  })
  await restoredPage.evaluate(() => {
    const active = document.querySelector('.session-row.active')
    const button = active?.closest('.session-row-shell')?.querySelector('.session-menu-button')
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('missing active restored session menu button')
    }
    button.click()
  })
  await waitFor(restoredPage, () =>
    [...document.querySelectorAll('.session-context-menu [role="menuitem"]')]
      .some(item => item.textContent?.includes('Close session')),
  )
  await restoredPage.getByRole('menuitem', { name: /Close session/ }).click()
  const closeSessionBaseline = await app.evaluate(({ app: electronApp }) =>
    electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:close'] ?? 0)
  await restoredPage.evaluate(() => {
    const confirm = [...document.querySelectorAll('.confirmation-modal .modal-actions button')]
      .find(button => button.textContent?.includes('Close session'))
    if (!(confirm instanceof HTMLButtonElement)) {
      throw new Error('missing Close session confirmation button for rapid-close smoke')
    }
    confirm.click()
    confirm.click()
  })
  await waitFor(restoredPage, () => !document.querySelector('.confirmation-modal'))
  const rapidCloseCalls = await app.evaluate(({ app: electronApp }, baseline) =>
    (electronApp.__claudeDesktopSmokeIpcCalls?.['sessions:close'] ?? 0) - baseline,
  closeSessionBaseline)
  assert(
    rapidCloseCalls === 1,
    `rapid Close session submitted ${rapidCloseCalls} close requests`,
  )
  await waitFor(restoredPage, ({ sessionId, workspace }) =>
    window.claudeDesktop.sessions.list().then(sessions => {
      const activeText = document.querySelector('.session-row.active')?.textContent ?? ''
      return !sessions.some(session => session.id === sessionId) &&
        sessions[0]?.id !== sessionId &&
        !activeText.includes(workspace)
    }),
  10_000, { sessionId: focusResult.second, workspace: secondCwd })
  const closedState = await restoredPage.evaluate(async ({ workspace, sessionId }) => {
    const sessions = await window.claudeDesktop.sessions.list()
    return {
      matchingSessions: sessions.filter(session => session.cwd === workspace).length,
      matchingIds: sessions.filter(session => session.id === sessionId).length,
      activeText: document.querySelector('.session-row.active')?.textContent ?? '',
      headerText: document.querySelector('.chat-header')?.textContent ?? '',
    }
  }, { workspace: secondCwd, sessionId: focusResult.second })
  assert(closedState.matchingSessions === 0, 'closed session remained in the session list')
  assert(closedState.matchingIds === 0, 'closed session id remained in the store')
  assert(!closedState.activeText.includes(secondCwd), 'closed session remained active')
  assert(!closedState.headerText.includes('Session closed.'), 'closed session status leaked into the next active session')
  progress('completed')

  console.log(
    JSON.stringify(
      {
        ok: true,
        cwd,
        storePath,
        sessionId: result.sessionId,
        renderedAssistant: true,
        streamedAssistant: true,
        indexedStreamMessageCoalescing: true,
        streamedToolActivity: true,
        conversationToolActivityPanel: true,
        visibleTodoList: true,
        duplicateChatMessagesSuppressed: true,
        agentToolResultsHiddenFromChat: true,
        thinkingStreamStateLabels: true,
        visibleActivityState: true,
        enterSendsMessage: true,
        rapidSendGuard: true,
        composerTeamTargetRouting: true,
        composerAgentTargetRouting: true,
        composerResourceMenu: true,
        composerSkillResourceMenu: true,
        composerMcpResourceMenu: true,
        composerMenuKeyboardNavigation: true,
        composerActionMenu: true,
        composerCustomSlashCommand: true,
        composerLifecycleActionShortcuts: true,
        composerSettingsActionShortcuts: true,
        firstClassLeftNavigation: true,
        accessiblePrimaryNavigation: true,
        nativeNavigationMenuActions: true,
        nativeHelpSupportMenuActions: true,
        primaryNavKeyboardShortcuts: true,
        workspacePaneKeyboardShortcuts: true,
        commandPaletteNavigation: true,
        commandPaletteMenuAction: true,
        commandPaletteUnavailableFeedback: true,
        commandPaletteLifecycleNavigation: true,
        commandPaletteLifecycleCreateShortcuts: true,
        commandPaletteSettingsManagement: true,
        commandPaletteMcpHealthCheck: true,
        commandPaletteProjectSkillInstall: true,
        commandPaletteSkillDraftShortcuts: true,
        commandPaletteSettingsDiagnosticsExport: true,
        commandPaletteSettingsDiagnosticsRedaction: true,
        commandPaletteSettingsRefresh: true,
        commandPaletteSettingsRefreshGuard: true,
        teamsFirstClassPage: true,
        teamsFirstClassManagement: true,
        agentsFirstClassPage: true,
        agentsSectionRestored: true,
        tasksFirstClassPage: true,
        tasksSectionRestored: true,
        selectedScheduledTaskStateRestored: true,
        scheduledTaskPauseResume: true,
        scheduledTaskPausedRunNowGuard: true,
        settingsFirstClassPage: true,
        settingsMcpSkillsInlineSections: true,
        agentTeammateStatusIsolated: true,
        teamPrimaryViewRestored: true,
        teamsSectionRestored: true,
        selectedTeamStateRestored: true,
        settingsInLeftFooter: true,
        groupedSettingsNavigation: true,
        settingsSidebarNavigation: true,
        settingsSectionRestored: true,
        selectedSettingsDetailStateRestored: true,
        settingsSearchFiltering: true,
        workspaceRefreshFeedback: true,
        menuSessionAction: true,
        sessionRowManagementMenu: true,
        sessionCreateMenuKeyboardNavigation: true,
        sessionMenuKeyboardNavigation: true,
        rapidMenuSessionCreateGuard: true,
        menuOpenFolderAction: true,
        sessionRowOpenFolderAction: true,
        sessionCreateCancelFeedback: true,
        quickSessionEntry: true,
        railQuickSessionEntry: true,
        rapidSessionCreateGuard: true,
        rapidSessionFocusGuard: true,
        rapidSessionFocusLastClickWins: true,
        collapsibleSessions: true,
        collapsedSessionCountVisible: true,
        sessionRailCollapseRestored: true,
        pointerWorkspaceResize: true,
        pointerWorkspaceResizeSingleCommit: true,
        staleSessionStatusCleared: true,
        conversationNoHorizontalOverflow: true,
        chatCopyFeedback: true,
        chatMarkdownExternalLink: true,
        buttonLayoutStable: true,
        toolbarButtonTypographyStable: true,
        iconOnlyTooltips: true,
        polishedScrollableSurfaces: true,
        workareaEmptyStateGuidance: true,
        compactSettingsLayout: true,
        paneJumpbarsNoHorizontalOverflow: true,
        agentTaskActionIcons: true,
        agentTaskActionFeedback: true,
        rapidAgentTaskActionGuard: true,
        rapidAgentTaskStopGuard: true,
        rapidAgentLaunchGuard: true,
        agentLaunchTurnBusyGuard: true,
        rapidAgentsRefreshGuard: true,
        agentDiagnosticActionIcons: true,
        selectedAgentActionRow: true,
        selectedAgentVisualEvidence: true,
        selectedAgentStateRestored: true,
        selectedAgentNewSessionAction: true,
        selectedAgentPrepareTaskAction: true,
        selectedAgentOverrideAction: true,
        agentEditorNewFeedback: true,
        rapidAgentSaveGuard: true,
        agentDeleteFeedback: true,
        rapidAgentDeleteGuard: true,
        teamSelectActionIcon: true,
        teamSelectFeedback: true,
        selectedTeamCurrentState: true,
        teamsManagementVisualEvidence: true,
        teamBroadcastMessageAction: true,
        teamMemberMessageAction: true,
        teamSpawnTeammateAction: true,
        teamMemberShutdownAction: true,
        teamMemberRemoveAction: true,
        teamActionFeedback: true,
        rapidTeamActionGuard: true,
        rapidTeamMemberShutdownGuard: true,
        rapidTeamMemberRemoveGuard: true,
        teamDeleteDisabledState: true,
        teamDeleteFeedback: true,
        rapidTeamDeleteGuard: true,
        teamDeleteClearsDraft: true,
        permissionDecisionActionIcons: true,
        rapidPermissionDecisionGuard: true,
        sessionRailScrollable: true,
        permissionRoundTrip: true,
        queuedPermissionRoundTrip: true,
        permissionDenyRoundTrip: true,
        cancelRoundTrip: true,
        rapidCancelGuard: true,
        cancelTurnFeedback: true,
        runtimeFailureVisible: true,
        filesRefreshFeedback: true,
        rapidFilesRefreshGuard: true,
        rapidDiffRefreshGuard: true,
        fileTreeExpandedPathPersistence: true,
        editorEmptyStateGuidance: true,
        editedFile: true,
        rapidFileSaveGuard: true,
        renderedDiff: true,
        renderedTerminal: true,
        terminalEmptyStateGuidance: true,
        restartedTerminal: true,
        terminalRapidStartGuard: true,
        terminalRapidStopGuard: true,
        resizedTerminal: true,
        terminalFailureVisible: true,
        terminalCloseRaceSafe: true,
        terminalMode,
        rejectedInvalidPreview: true,
        previewExternalOpen: true,
        previewRapidOpenGuard: true,
        previewRapidExternalGuard: true,
        previewSessionIsolation: true,
        previewOpenActionIcon: true,
        settingsPaneErrorFeedback: true,
        settingsRefreshFeedback: true,
        rapidSettingsRefreshGuard: true,
        settingsEditFeedback: true,
        settingsEditCancelFeedback: true,
        settingsEditCancelIcon: true,
        confirmationActionIcons: true,
        closeSessionConfirmation: true,
        rapidCloseSessionGuard: true,
        restoredSession: true,
        restoredEditorContent: true,
        restoredMissingEditorRecovery: true,
        restoredDiffContent: true,
        deepLinkedSession: true,
        closedSession: true,
        previewIframe: result.iframeSrc,
        settingsGui: true,
        settingsDiagnosticsExport: true,
        settingsDiagnosticsRedaction: true,
        rapidDiagnosticsExportGuard: true,
        proxyFormValidation: true,
        rapidProxySaveGuard: true,
        proxyRuntimeEnv: true,
        localSkillInstall: true,
        localSkillInspect: true,
        localSkillSave: true,
        rapidSkillInspectGuard: true,
        rapidSkillSaveGuard: true,
        localSkillRemove: true,
        projectSkillInstall: true,
        projectSkillInspect: true,
        projectSkillSave: true,
        projectSkillRemove: true,
        projectSkillSessionGuidance: true,
        projectSettingsRowsDisabledNoSession: true,
        settingsSkillsEmptyState: true,
        skillInstallCancelFeedback: true,
        rapidSkillInstallGuard: true,
        rapidSkillRemoveGuard: true,
        pluginCommands: true,
        settingsPluginEmptyState: true,
        rapidPluginActionGuard: true,
        pluginFormFeedback: true,
        pluginScopeValidation: true,
        projectPluginRowsDisabledNoSession: true,
        mcpCrossScopeEditIsolation: true,
        scheduledTaskFormValidation: true,
        rapidMcpSaveGuard: true,
        rapidMcpRemoveGuard: true,
        agentGui: true,
        agentLaunchValidation: true,
        agentDiagnosticSettingsJump: true,
        mcpManagement: true,
        userMcpInspect: true,
        rapidMcpInspectGuard: true,
        mcpProjectScopeValidation: true,
        projectMcpInspect: true,
        userMcpEnableDisable: true,
        projectMcpManagement: true,
        projectMcpApprovalLifecycle: true,
        settingsMcpEmptyState: true,
        mcpHealthCheck: true,
        rapidMcpHealthCheckGuard: true,
        scheduledTaskManagement: true,
        projectScheduledTaskEmptyState: true,
        scheduledTaskRemoveFeedback: true,
        scheduledTaskDeleteClearsDraft: true,
        rapidScheduledTaskSaveGuard: true,
        rapidScheduledTaskRemoveGuard: true,
        rapidScheduledTaskPauseResumeGuard: true,
        scheduledTaskRunNowFeedback: true,
        rapidScheduledRunNowGuard: true,
        scheduledRunNowTurnBusyGuard: true,
        globalScheduledTaskRunNow: true,
        automaticGlobalScheduler: true,
        projectScheduledTaskManagement: true,
        projectScheduledTaskRemoveFeedback: true,
        projectScheduledTaskDeleteClearsDraft: true,
        rapidProjectScheduledTaskSaveGuard: true,
        rapidProjectScheduledPauseResumeGuard: true,
        rapidProjectScheduledTaskRemoveGuard: true,
        rapidProjectScheduledRunNowGuard: true,
        projectScheduledTaskPauseResume: true,
        projectScheduledTaskRunNow: true,
        automaticProjectScheduler: true,
      },
      null,
      2,
    ),
  )
} finally {
  if (app) await closeApp(app, 'final app')
  await previewServer.close()
}
