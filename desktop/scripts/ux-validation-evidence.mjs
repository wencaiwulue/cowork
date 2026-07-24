import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const defaultOutputPath = join(root, 'desktop/release/ux-validation-evidence.md')
export const requiredUxValidationScreenshots = [
  'chat-streaming.png',
  'settings.png',
  'settings-narrow.png',
  'settings-mcp.png',
  'settings-skills.png',
  'command-palette.png',
  'agents.png',
  'agents-selected.png',
  'tasks.png',
  'teams.png',
  'composer-actions.png',
  'permission-modal.png',
  'files.png',
  'editor.png',
  'diff.png',
  'before-unsaved-files-pane-switch.png',
  'unsaved-files-pane-switch-dialog.png',
  'before-unsaved-diff-pane-switch.png',
  'unsaved-diff-pane-switch-dialog.png',
  'after-unsaved-diff-pane-switch-keep-editing.png',
  'terminal.png',
  'preview.png',
]
export const requiredUxValidationManualTasks = [
  'Create a new local session from the session rail.',
  'Send a short prompt and wait for streaming output.',
  'Trigger a permission request and choose allow, then deny on a second request.',
  'Open Files, expand a folder, edit a text file, save, and refresh Diff.',
  'Start Terminal, run `pwd` and `git status`, then stop/restart it.',
  'Open Preview with a local URL and then open externally.',
  'Open Agents, launch an agent task, and inspect running task feedback.',
  'Open Teams and route a composer message to a teammate or team.',
  'Use Command Palette and native View menu navigation.',
  'Use native Help menu support actions.',
  'Use Command Palette lifecycle create commands.',
  'Use Command Palette Settings management commands.',
  'Inspect MCP and Skills details from Settings.',
  'Use `@` resources and `/` actions from the composer.',
  'Use `/` composer lifecycle and Settings shortcuts.',
  'Export diagnostics from Settings.',
]
const requiredUxValidationManualTaskRows = [
  [requiredUxValidationManualTasks[0], 'Session appears, focuses, and status is visible.'],
  [requiredUxValidationManualTasks[1], 'Chat shows streaming assistant output without duplicate echoed messages.'],
  [requiredUxValidationManualTasks[2], 'Permission modal is understandable and both decisions reach the runtime.'],
  [requiredUxValidationManualTasks[3], 'Editor saves the file and Diff shows the Git change.'],
  [requiredUxValidationManualTasks[4], 'xterm renders output, resize remains stable, restart works.'],
  [requiredUxValidationManualTasks[5], 'iframe updates in app and external open is explicit.'],
  [requiredUxValidationManualTasks[6], 'Agent management, launch validation, and task action feedback are clear.'],
  [requiredUxValidationManualTasks[7], 'Target routing is clear and team/agent state is not confused.'],
  [requiredUxValidationManualTasks[8], 'Cmd/Ctrl+K opens searchable commands; View menu page/pane actions switch pages and persist pane layout.'],
  [requiredUxValidationManualTasks[9], 'Help menu Command Palette opens the searchable command palette. Help menu Refresh Settings reports refreshed configuration. Help menu Export Diagnostics writes a redacted bundle.'],
  [requiredUxValidationManualTasks[10], 'New custom agent, New team, New global scheduled task, and New project scheduled task open clean drafts with visible status.'],
  [requiredUxValidationManualTasks[11], 'Settings sections, Add MCP, Check MCP, user/project Skill drafts, user/project skill install cancellation, plugin listing, diagnostics, and refresh provide visible feedback.'],
  [requiredUxValidationManualTasks[12], 'User/project MCP details and user/project Skill contents render with redacted, readonly details.'],
  [requiredUxValidationManualTasks[13], 'Menus are discoverable, keyboard focus is usable, selected target is visible, and a project custom slash command can be selected.'],
  [requiredUxValidationManualTasks[14], '`/new-custom` and `/add-mcp` route to clean drafts with visible page status.'],
  [requiredUxValidationManualTasks[15], 'A redacted diagnostic bundle is produced and no secret values are visible in summaries.'],
]

function currentGitCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  return result.status === 0 ? result.stdout.trim() : '[git commit SHA]'
}

function valueOrPlaceholder(value, placeholder) {
  return value?.trim() || placeholder
}

export function buildUxValidationEvidenceTemplate(options = {}) {
  const version = valueOrPlaceholder(options.version, '[DESKTOP_RELEASE_VERSION]')
  const commit = valueOrPlaceholder(options.commit, '[git commit SHA]')
  const releaseEvidencePath = valueOrPlaceholder(
    options.releaseEvidencePath,
    'desktop/release/release-evidence.json',
  )
  const screenshotArtifactPath = valueOrPlaceholder(
    options.screenshotArtifactPath,
    'desktop/release/ux-screenshots',
  )

  return [
    '# Claude Code Desktop UX Validation Evidence',
    '',
    'Use this file as the completed release-candidate UX validation record.',
    'Fill every placeholder before running `bun run desktop:verify-release`.',
    '',
    '## Release Candidate',
    '',
    `- Version: \`${version}\``,
    `- Commit: \`${commit}\``,
    `- Artifact evidence: \`${releaseEvidencePath}\``,
    `- Screenshot artifact: \`${screenshotArtifactPath}\``,
    '- Validator: `[name, role, YYYY-MM-DD]`',
    '- Representative user: `[name or role, YYYY-MM-DD]`',
    '- Representative user validation: `[observed, facilitator, YYYY-MM-DD]`',
    '',
    '## Screenshot Review',
    '',
    '| Area | Evidence | Result | Notes |',
    '| --- | --- | --- | --- |',
    '| Chat streaming and tool activity | `chat-streaming.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Settings desktop layout | `settings.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Settings narrow layout | `settings-narrow.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| MCP management | `settings-mcp.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Skills management | `settings-skills.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Command Palette | `command-palette.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Agents management | `agents.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Selected agent actions | `agents-selected.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Scheduled tasks management | `tasks.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Teams management | `teams.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Composer actions menu | `composer-actions.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Permission review modal | `permission-modal.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Files browser | `files.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Editor | `editor.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Diff viewer | `diff.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Files/editor unsaved guard | `before-unsaved-files-pane-switch.png`, `unsaved-files-pane-switch-dialog.png`, `before-unsaved-diff-pane-switch.png`, `unsaved-diff-pane-switch-dialog.png`, `after-unsaved-diff-pane-switch-keep-editing.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Terminal | `terminal.png` | `[pass/fail/n/a]` | `[notes]` |',
    '| Preview | `preview.png` | `[pass/fail/n/a]` | `[notes]` |',
    '',
    'Every screenshot row must be `pass` or `n/a` before release approval.',
    '',
    '## Manual Task Script',
    '',
    '| Task | Expected result | Result | Notes |',
    '| --- | --- | --- | --- |',
    ...requiredUxValidationManualTaskRows
      .map(([task, expected]) => `| ${task} | ${expected} | \`[pass/fail]\` | \`[notes]\` |`),
    '',
    'Every required manual task row below must be present and `pass` before release approval.',
    '',
    '## Approval',
    '',
    '- Blocking issues filed: `[none]`',
    '- Non-blocking follow-ups: `[links or none]`',
    '- Known limitations accepted: `[yes, approver]`',
    '- UX release approval: `[approved/rejected, approver, YYYY-MM-DD]`',
    '',
  ].join('\n')
}

function sectionBetween(text, heading, nextHeading) {
  const start = text.indexOf(heading)
  if (start < 0) return ''
  const end = text.indexOf(nextHeading, start + heading.length)
  return text.slice(start, end < 0 ? undefined : end)
}

function markdownTableRows(section) {
  return String(section)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|') && line.endsWith('|'))
    .filter(line => !/^\|\s*-+\s*\|/.test(line))
    .filter(line => !/^\|\s*(Area|Task)\s*\|/i.test(line))
    .map(line => line
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim()))
    .filter(cells => cells.length >= 3)
}

function markdownTableResultValues(section) {
  return markdownTableRows(section)
    .map(cells => cells[2].replace(/`/g, '').trim().toLowerCase())
}

function markdownTableEvidenceValues(section) {
  return markdownTableRows(section)
    .map(cells => cells[1] ?? '')
}

export function uxValidationEvidenceFieldValue(contents, label) {
  const text = String(contents ?? '')
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^\\s*-\\s*${escapedLabel}:\\s*(.+)$`, 'im').exec(text)
  return match?.[1]?.trim() ?? ''
}

function unquoteEvidenceValue(value) {
  return String(value ?? '').trim().replace(/^`(.+)`$/, '$1').trim()
}

function hasIsoDate(value) {
  return /\b20\d{2}-\d{2}-\d{2}\b/.test(String(value ?? ''))
}

function isPlaceholderPerson(value) {
  return /^(?:n\/a|none|tbd|todo|unknown|placeholder)\b/i.test(String(value ?? '').trim())
}

export function summarizeUxValidationEvidenceContents(contents) {
  const text = String(contents ?? '')
  const knownLimitationsAccepted = uxValidationEvidenceFieldValue(text, 'Known limitations accepted')
  const releaseApproval = uxValidationEvidenceFieldValue(text, 'UX release approval')
  const approvalParts = releaseApproval.split(',').map(part => part.trim()).filter(Boolean)
  const representativeUserValidation = uxValidationEvidenceFieldValue(text, 'Representative user validation')
  const representativeUserValidationParts = representativeUserValidation.split(',').map(part => part.trim()).filter(Boolean)
  return {
    validator: uxValidationEvidenceFieldValue(text, 'Validator'),
    representativeUser: uxValidationEvidenceFieldValue(text, 'Representative user'),
    representativeUserValidation,
    representativeUserValidationStatus: representativeUserValidationParts[0] ?? '',
    representativeUserValidationFacilitator: representativeUserValidationParts[1] ?? '',
    representativeUserValidationDate: representativeUserValidationParts[2] ?? '',
    knownLimitationsAccepted,
    knownLimitationsApprover: knownLimitationsAccepted.replace(/^yes\s*,\s*/i, '').trim(),
    uxApprovalStatus: approvalParts[0] ?? '',
    uxApprovalApprover: approvalParts[1] ?? '',
    uxApprovalDate: approvalParts[2] ?? '',
  }
}

export function validateUxValidationEvidenceContents(contents, options = {}) {
  const text = String(contents ?? '')
  const failures = []
  const {
    expectedVersion,
    expectedCommit,
  } = options

  if (/\[[^\]\n]+\]/.test(text)) {
    failures.push('UX validation evidence still contains template placeholders.')
  }
  if (expectedVersion) {
    const actualVersion = unquoteEvidenceValue(uxValidationEvidenceFieldValue(text, 'Version'))
    if (actualVersion !== expectedVersion) {
      failures.push(`UX validation evidence Version=${actualVersion || '<missing>'} does not match releaseVersion=${expectedVersion}.`)
    }
  }
  if (expectedCommit) {
    const actualCommit = unquoteEvidenceValue(uxValidationEvidenceFieldValue(text, 'Commit'))
    if (actualCommit !== expectedCommit) {
      failures.push(`UX validation evidence Commit=${actualCommit || '<missing>'} does not match release commit=${expectedCommit}.`)
    }
  }
  const validator = uxValidationEvidenceFieldValue(text, 'Validator')
  if (
    !validator ||
    isPlaceholderPerson(validator) ||
    !hasIsoDate(validator)
  ) {
    failures.push('UX validation evidence must name a validator with YYYY-MM-DD validation date.')
  }
  const representativeUser = uxValidationEvidenceFieldValue(text, 'Representative user')
  if (
    !representativeUser ||
    /^(?:n\/a|none|tbd)\b/i.test(representativeUser) ||
    !hasIsoDate(representativeUser)
  ) {
    failures.push('UX validation evidence must name a representative user with YYYY-MM-DD validation date.')
  }
  const representativeUserValidation = uxValidationEvidenceFieldValue(text, 'Representative user validation')
  const representativeUserValidationParts = representativeUserValidation.split(',').map(part => part.trim()).filter(Boolean)
  if (!/^observed\s*,\s*[^,\n]+,\s*20\d{2}-\d{2}-\d{2}\s*$/i.test(representativeUserValidation)) {
    failures.push('UX validation evidence must record representative user validation: observed, facilitator, YYYY-MM-DD.')
  } else if (isPlaceholderPerson(representativeUserValidationParts[1])) {
    failures.push('UX validation evidence must name a real representative user validation facilitator.')
  }
  const releaseApproval = uxValidationEvidenceFieldValue(text, 'UX release approval')
  const releaseApprovalParts = releaseApproval.split(',').map(part => part.trim()).filter(Boolean)
  if (!/^approved\s*,\s*[^,\n]+,\s*20\d{2}-\d{2}-\d{2}\s*$/i.test(releaseApproval)) {
    failures.push('UX validation evidence must include UX release approval: approved, approver, YYYY-MM-DD.')
  } else if (isPlaceholderPerson(releaseApprovalParts[1])) {
    failures.push('UX validation evidence must name a real UX release approval approver.')
  }
  const screenshotReviewSection = sectionBetween(text, '## Screenshot Review', '## Manual Task Script')
  const screenshotResults = markdownTableResultValues(screenshotReviewSection)
  const screenshotEvidenceValues = markdownTableEvidenceValues(screenshotReviewSection)
  const missingRequiredScreenshots = requiredUxValidationScreenshots
    .filter(name => !screenshotEvidenceValues.some(evidence => evidence.includes(name)))
  const incompleteScreenshotResults = screenshotResults
    .filter(result => !['pass', 'n/a'].includes(result))
  if (screenshotResults.length === 0 || incompleteScreenshotResults.length > 0) {
    failures.push('UX screenshot review results must be pass or n/a.')
  }
  if (missingRequiredScreenshots.length > 0) {
    failures.push(`UX validation evidence must review required screenshots: ${missingRequiredScreenshots.join(', ')}.`)
  }
  const manualTaskResults = markdownTableResultValues(
    sectionBetween(text, '## Manual Task Script', '## Approval'),
  )
  const manualTaskSection = sectionBetween(text, '## Manual Task Script', '## Approval')
  const manualTaskRows = markdownTableRows(manualTaskSection)
  const missingRequiredManualTasks = requiredUxValidationManualTasks
    .filter(task => !manualTaskRows.some(cells => cells[0] === task))
  const incompleteManualTaskResults = manualTaskResults
    .filter(result => result !== 'pass')
  if (manualTaskResults.length === 0 || incompleteManualTaskResults.length > 0) {
    failures.push('UX manual task results must all be pass.')
  }
  if (missingRequiredManualTasks.length > 0) {
    failures.push(`UX validation evidence must include required manual tasks: ${missingRequiredManualTasks.join(', ')}.`)
  }
  if (!/Blocking issues filed:\s*(?:none|无)\b/i.test(text)) {
    failures.push('UX validation evidence must record no blocking issues.')
  }
  const knownLimitationsAccepted = uxValidationEvidenceFieldValue(text, 'Known limitations accepted')
  const knownLimitationsApprover = knownLimitationsAccepted.replace(/^yes\s*,\s*/i, '').trim()
  if (!/^yes\s*,\s*[^,\n]+/i.test(knownLimitationsAccepted)) {
    failures.push('UX validation evidence must record known limitations accepted: yes, approver.')
  } else if (isPlaceholderPerson(knownLimitationsApprover)) {
    failures.push('UX validation evidence must name a real known limitations approver.')
  }

  return failures
}

export function validateUxValidationEvidenceFile(options = {}) {
  const {
    outputPath = defaultOutputPath,
    readFile = readFileSync,
  } = options

  try {
    return validateUxValidationEvidenceContents(readFile(outputPath, 'utf8'), options)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return [
      `UX validation evidence is missing or unreadable: ${outputPath}`,
      detail,
    ]
  }
}

export function writeUxValidationEvidenceTemplate(options = {}) {
  const {
    outputPath = defaultOutputPath,
    force = false,
    exists = existsSync,
    mkdir = mkdirSync,
    writeFile = writeFileSync,
  } = options

  if (exists(outputPath) && !force) {
    throw new Error(`${outputPath} already exists. Pass --force to overwrite it.`)
  }

  const contents = buildUxValidationEvidenceTemplate(options)
  mkdir(dirname(outputPath), { recursive: true })
  writeFile(outputPath, contents, 'utf8')
  return { path: outputPath, contents }
}

function parseArgs(argv) {
  const options = {
    check: false,
    force: false,
    outputPath: defaultOutputPath,
    version: process.env.DESKTOP_RELEASE_VERSION,
    commit: currentGitCommit(),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') {
      options.check = true
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--output') {
      options.outputPath = argv[++index]
    } else if (arg === '--version') {
      options.version = argv[++index]
    } else if (arg === '--commit') {
      options.commit = argv[++index]
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!options.outputPath) {
    throw new Error('--output requires a path')
  }

  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.check) {
    const failures = validateUxValidationEvidenceFile(options)
    if (failures.length > 0) {
      for (const failure of failures) console.error(`- ${failure}`)
      process.exit(1)
    }
    console.log(`UX validation evidence is complete: ${options.outputPath}`)
    return
  }

  writeUxValidationEvidenceTemplate(options)
  console.log(`UX validation evidence template written to ${options.outputPath}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
