import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { getWorkflowCommands } from '../../src/tools/WorkflowTool/createWorkflowCommand'

const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  }
})

describe('workflow commands', () => {
  it('loads workflow prompt commands without the WORKFLOW_SCRIPTS command gate', () => {
    const source = readFileSync(join(process.cwd(), 'src/commands.ts'), 'utf8')

    expect(source).toContain("import { getWorkflowCommands } from './tools/WorkflowTool/createWorkflowCommand.js'")
    expect(source).not.toContain("const getWorkflowCommands = feature('WORKFLOW_SCRIPTS')")
  })

  it('loads user and project workflow markdown as prompt commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-commands-'))
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    process.env.CLAUDE_CONFIG_DIR = home
    await mkdir(join(home, 'workflows'), { recursive: true })
    await mkdir(join(cwd, '.claude/workflows/review'), { recursive: true })
    await writeFile(
      join(home, 'workflows/triage.md'),
      '---\ndescription: Triage issues\nargument-hint: "[ticket]"\nallowed-tools: Read, Grep\n---\nTriage $ARGUMENTS.\n',
    )
    await writeFile(
      join(cwd, '.claude/workflows/review/security.md'),
      '---\narguments: target\n---\n# Security workflow\n\nReview $target for security regressions.\n',
    )

    const commands = await getWorkflowCommands(cwd)

    expect(commands.map(command => ({
      name: command.name,
      description: command.description,
      source: command.source,
      kind: command.kind,
      argumentHint: command.argumentHint,
      allowedTools: command.allowedTools,
      loadedFrom: command.loadedFrom,
    }))).toEqual([
      {
        name: 'review:security',
        description: 'Security workflow',
        source: 'projectSettings',
        kind: 'workflow',
        argumentHint: undefined,
        allowedTools: [],
        loadedFrom: 'commands_DEPRECATED',
      },
      {
        name: 'triage',
        description: 'Triage issues',
        source: 'userSettings',
        kind: 'workflow',
        argumentHint: '[ticket]',
        allowedTools: ['Read', 'Grep'],
        loadedFrom: 'commands_DEPRECATED',
      },
    ])

    await expect(commands[0]?.getPromptForCommand('auth.ts', {} as never))
      .resolves
      .toEqual([{ type: 'text', text: '# Security workflow\n\nReview auth.ts for security regressions.\n' }])
    await expect(commands[1]?.getPromptForCommand('BUG-123', {} as never))
      .resolves
      .toEqual([{ type: 'text', text: 'Triage BUG-123.\n' }])
  })

  it('lets project workflows shadow same-named user workflows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-commands-'))
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    process.env.CLAUDE_CONFIG_DIR = home
    await mkdir(join(home, 'workflows'), { recursive: true })
    await mkdir(join(cwd, '.claude/workflows'), { recursive: true })
    await writeFile(join(home, 'workflows/review.md'), '# User review\n\nUse user workflow.\n')
    await writeFile(join(cwd, '.claude/workflows/review.md'), '# Project review\n\nUse project workflow.\n')

    const commands = await getWorkflowCommands(cwd)

    expect(commands.map(command => ({
      name: command.name,
      source: command.source,
      description: command.description,
    }))).toEqual([
      {
        name: 'review',
        source: 'projectSettings',
        description: 'Project review',
      },
    ])
  })

  it('skips workflow files with unsafe command name segments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-commands-'))
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    process.env.CLAUDE_CONFIG_DIR = home
    await mkdir(join(cwd, '.claude/workflows/bad group'), { recursive: true })
    await mkdir(join(cwd, '.claude/workflows/good'), { recursive: true })
    await writeFile(join(cwd, '.claude/workflows/bad group/name.md'), '# Bad\n')
    await writeFile(join(cwd, '.claude/workflows/good/bad:name.md'), '# Bad\n')
    await writeFile(join(cwd, '.claude/workflows/good/name.md'), '# Good\n')

    const commands = await getWorkflowCommands(cwd)

    expect(commands.map(command => command.name)).toEqual(['good:name'])
  })

  it('loads workflow content when frontmatter is malformed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflow-commands-'))
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    process.env.CLAUDE_CONFIG_DIR = home
    await mkdir(join(cwd, '.claude/workflows'), { recursive: true })
    await writeFile(
      join(cwd, '.claude/workflows/recover.md'),
      '---\ndescription: [broken\n---\n# Recover\n\nRun recovery steps.\n',
    )

    const commands = await getWorkflowCommands(cwd)

    expect(commands.map(command => ({
      name: command.name,
      description: command.description,
    }))).toEqual([{ name: 'recover', description: 'Recover' }])
    await expect(commands[0]?.getPromptForCommand('', {} as never))
      .resolves
      .toEqual([{ type: 'text', text: '# Recover\n\nRun recovery steps.\n' }])
  })
})
