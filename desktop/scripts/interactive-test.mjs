import { _electron as electron } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots/interactive'
mkdirSync(OUT, { recursive: true })

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({ executablePath: electronPath, args: [mainPath], env: { ...process.env, NODE_ENV: 'production' } })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', err => errors.push(`PageError: ${err.message}`))
page.on('console', msg => { if (msg.type() === 'error') errors.push(`Console: ${msg.text()}`) })
await page.waitForTimeout(4000)

async function snap(name) { await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, name) }); console.log(`  ✓ ${name}`) }

// === 1. Settings MCP form ===
console.log('\n=== Settings MCP ===')
await page.keyboard.press('Meta+,')
await page.waitForTimeout(800)
await page.click('#settings-nav-option-settings-mcp')
await page.waitForTimeout(500)

const mcpName = page.locator('input[aria-label="MCP server name"]')
await mcpName.fill('test-server')
const mcpScope = page.locator('select[aria-label="MCP server scope"]')
await mcpScope.selectOption('user')
const mcpMode = page.locator('select[aria-label="MCP server mode"]')
await mcpMode.selectOption('stdio')
const cmdInput = page.locator('input[aria-label="MCP command"]')
await cmdInput.fill('echo')
await snap('01-mcp-form-filled.png')

const addBtn = page.locator('button:has-text("Add MCP")')
await addBtn.click()
await page.waitForTimeout(1500)
await snap('02-mcp-after-add.png')

// Read any status messages
const statusText = await page.locator('[class*="settings-status"], [role="status"]').allTextContents()
console.log('  Status after Add MCP:', statusText.filter(t => t.trim()).join(' | ') || '(none)')

// === 2. Check remote mode shows URL field ===
console.log('\n=== MCP remote mode ===')
await mcpMode.selectOption('remote')
await page.waitForTimeout(300)
await snap('03-mcp-remote-mode.png')

// Switch back to stdio
await mcpMode.selectOption('stdio')
await mcpName.fill('')
await cmdInput.fill('')
await page.waitForTimeout(200)

// === 3. Skills ===
console.log('\n=== Skills ===')
await page.click('#settings-nav-option-settings-skills')
await page.waitForTimeout(500)
await snap('04-skills-section.png')

// Test clicking skill buttons - New user skill
const newUserSkillBtn = page.locator('button:has-text("New user skill")')
if (await newUserSkillBtn.count() > 0) {
  await newUserSkillBtn.click()
  await page.waitForTimeout(500)
  await snap('05-new-skill-clicked.png')
}

// === 4. Plugins ===
await page.click('#settings-nav-option-settings-plugins')
await page.waitForTimeout(500)
await snap('06-plugins-section.png')

// Test List plugins button
const listPluginsBtn = page.locator('button:has-text("List plugins")')
if (await listPluginsBtn.count() > 0) {
  await listPluginsBtn.click()
  await page.waitForTimeout(1500)
  await snap('07-plugins-list-clicked.png')
}

await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// === 5. Command palette ===
console.log('\n=== Command palette ===')
await page.keyboard.press('Meta+k')
await page.waitForTimeout(500)
await page.keyboard.type('mcp')
await page.waitForTimeout(300)
await snap('08-cmd-palette-mcp.png')
await page.keyboard.press('ArrowDown')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')
await page.waitForTimeout(800)
await snap('09-cmd-palette-executed.png')
await page.keyboard.press('Escape').catch(() => {})

// === 6. Test Escape to chat from agents ===
console.log('\n=== Nav lifecycle ===')
await page.keyboard.press('Meta+2')
await page.waitForTimeout(500)
await snap('10-agents-page.png')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await snap('11-escape-to-chat.png')

// === 7. Teams page ===
await page.keyboard.press('Meta+3')
await page.waitForTimeout(500)
await snap('12-teams-page.png')

// === 8. Tasks page ===
await page.keyboard.press('Meta+4')
await page.waitForTimeout(500)
await snap('13-tasks-page.png')

// === 9. Composer ===
console.log('\n=== Composer ===')
await page.keyboard.press('Meta+1')
await page.waitForTimeout(300)

const composer = page.locator('textarea[placeholder*="Ask Claude"]')
if (await composer.count() > 0) {
  await composer.click()
  await page.keyboard.type('test message')
  await page.waitForTimeout(300)
  await snap('14-composer-typing.png')
  // Send button state - should be disabled for empty session? 
  const sendBtn = page.locator('button:has-text("Send")')
  const sendDisabled = await sendBtn.isDisabled().catch(() => true)
  console.log(`  Send button disabled: ${sendDisabled}`)
  await composer.fill('')
} else {
  console.log('  Composer not found')
}

// === 10. Workspace pane tabs ===
console.log('\n=== Pane tabs ===')
for (const [shortcut, name] of [['Meta+Shift+1','files'],['Meta+Shift+2','diff'],['Meta+Shift+3','editor'],['Meta+Shift+4','terminal'],['Meta+Shift+5','preview']]) {
  await page.keyboard.press(shortcut)
  await page.waitForTimeout(400)
  await snap(`15-pane-${name}.png`)
}

if (errors.length) {
  console.log('\n⚠️ ERRORS:')
  errors.forEach(e => console.log(' ', e))
} else {
  console.log('\n✅ No page/console errors')
}

await app.close()
console.log('\nDone!')
