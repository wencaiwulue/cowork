import { _electron as electron } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots/full-audit'
mkdirSync(OUT, { recursive: true })

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({
  executablePath: electronPath,
  args: [mainPath],
  env: { ...process.env, NODE_ENV: 'production' },
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', err => errors.push(`PageError: ${err.message}`))
page.on('console', msg => { if (msg.type() === 'error') errors.push(`Console: ${msg.text()}`) })

await page.waitForTimeout(4000)

async function snap(name) {
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(OUT, name) })
  console.log(`  ✓ ${name}`)
}

async function clickSettingsNav(id) {
  const btn = page.locator(`#settings-nav-option-${id}`)
  if (await btn.count() > 0) {
    await btn.click()
    await page.waitForTimeout(500)
    return true
  }
  return false
}

// === REQUIREMENT 1: Settings grouped management ===
console.log('\n=== Settings ===')
await page.keyboard.press('Meta+,')
await page.waitForTimeout(1000)
await snap('01-settings-general.png')

const settingsSections = [
  ['settings-proxy', 'configuration'],
  ['settings-mcp', 'mcp'],
  ['settings-skills', 'skills'],
  ['settings-plugins', 'plugins'],
]
for (const [id, name] of settingsSections) {
  const clicked = await clickSettingsNav(id)
  console.log(`  Settings nav ${id}: ${clicked ? 'found' : 'NOT FOUND'}`)
  if (clicked) await snap(`02-settings-${name}.png`)
}

// Project tasks and Global tasks navigate to tasks page
await clickSettingsNav('tasks-project-tasks')
await snap('03-project-tasks-via-settings.png')
await page.keyboard.press('Meta+,')
await page.waitForTimeout(500)
await clickSettingsNav('tasks-global-tasks')
await snap('04-global-tasks-via-settings.png')
await page.keyboard.press('Escape')

// Settings search
await page.keyboard.press('Meta+,')
await page.waitForTimeout(500)
const searchInput = page.locator('input[placeholder*="Search"]')
await searchInput.click()
await page.keyboard.type('mcp')
await page.waitForTimeout(500)
await snap('05-settings-search-mcp.png')
await searchInput.fill('')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// === REQUIREMENT 2: Agents/Teams/Tasks first-class ===
console.log('\n=== Primary Pages ===')
await page.keyboard.press('Meta+1')
await snap('10-chat.png')

await page.keyboard.press('Meta+2')
await snap('11-agents.png')

await page.keyboard.press('Meta+3')
await snap('12-teams.png')

await page.keyboard.press('Meta+4')
await snap('13-tasks-project.png')

// Global tasks tab
await page.locator('button:has-text("Global")').first().click().catch(() => {})
await page.waitForTimeout(400)
await snap('14-tasks-global.png')
await page.locator('button:has-text("Project")').first().click().catch(() => {})
await page.waitForTimeout(300)

// Escape back to chat
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await snap('15-escape-to-chat.png')

// === REQUIREMENT 4: Interactions ===
console.log('\n=== Interactions ===')

// Cmd+K command palette
await page.keyboard.press('Meta+k')
await page.waitForTimeout(500)
await snap('20-cmd-palette.png')
await page.keyboard.type('agent')
await page.waitForTimeout(300)
await snap('21-cmd-palette-agent.png')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// Workspace pane shortcuts
await page.keyboard.press('Meta+Shift+1')
await snap('22-pane-files.png')
await page.keyboard.press('Meta+Shift+2')
await snap('23-pane-diff.png')
await page.keyboard.press('Meta+Shift+3')
await snap('24-pane-editor.png')
await page.keyboard.press('Meta+Shift+4')
await snap('25-pane-terminal.png')
await page.keyboard.press('Meta+Shift+5')
await snap('26-pane-preview.png')

// New session
await page.keyboard.press('Meta+n')
await page.waitForTimeout(1500)
await snap('27-new-session.png')

// Back to chat
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)
await snap('28-chat-final.png')

if (errors.length) {
  console.log('\n⚠️ Errors:')
  errors.forEach(e => console.log(' ', e))
} else {
  console.log('\n✅ No page/console errors')
}

await app.close()
console.log('\nDone!')
