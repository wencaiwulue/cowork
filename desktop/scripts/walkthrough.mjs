import { _electron as electron } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots/walkthrough'
mkdirSync(OUT, { recursive: true })

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({ executablePath: electronPath, args: [mainPath], env: { ...process.env, NODE_ENV: 'production' } })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', err => errors.push(`PageError: ${err.message}`))
page.on('console', msg => { if (msg.type() === 'error') errors.push(`Console: ${msg.text()}`) })
await page.waitForTimeout(4000)

async function snap(name) { await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, name) }); console.log(`✓ ${name}`) }

console.log('=== STEP 1: Landing on Chat ===')
await snap('01-chat-landing.png')

console.log('=== STEP 2: Click Agents in sidebar ===')
await page.click('button:has-text("Agents")')
await page.waitForTimeout(800)
await snap('02-agents-page.png')

console.log('=== STEP 3: Click Available tab on Agents ===')
await page.locator('button:has-text("Available")').first().click()
await page.waitForTimeout(500)
await snap('03-agents-available.png')

console.log('=== STEP 4: Click Select on first agent ===')
await page.locator('button:has-text("Select")').first().click()
await page.waitForTimeout(500)
await snap('04-agent-selected.png')

console.log('=== STEP 5: Click Teams ===')
await page.click('button:has-text("Teams")')
await page.waitForTimeout(800)
await snap('05-teams-page.png')

console.log('=== STEP 6: Click Tasks ===')
await page.click('button:has-text("Tasks")')
await page.waitForTimeout(800)
await snap('06-tasks-page.png')

console.log('=== STEP 7: Click Global tab on Tasks ===')
await page.locator('button:has-text("Global")').first().click()
await page.waitForTimeout(500)
await snap('07-tasks-global.png')

console.log('=== STEP 8: Open Settings ===')
await page.click('button:has-text("Settings")')
await page.waitForTimeout(800)
await snap('08-settings-general.png')

console.log('=== STEP 9: Click MCP in settings nav ===')
await page.click('#settings-nav-option-settings-mcp')
await page.waitForTimeout(500)
await snap('09-settings-mcp.png')

console.log('=== STEP 10: Add MCP server - fill form ===')
await page.locator('input[aria-label="MCP server name"]').fill('playwright-test')
await page.locator('select[aria-label="MCP server scope"]').selectOption('user')
await page.locator('select[aria-label="MCP server mode"]').selectOption('stdio')
await page.locator('input[aria-label="MCP command"]').fill('echo')
await snap('10-mcp-form-filled.png')

console.log('=== STEP 11: Click Add MCP ===')
await page.locator('button:has-text("Add MCP")').click()
await page.waitForTimeout(1500)
await snap('11-mcp-added.png')

console.log('=== STEP 12: Click Edit on new server ===')
await page.locator('article:has-text("playwright-test") button:has-text("Edit")').first().click()
await page.waitForTimeout(500)
await snap('12-mcp-edit.png')

console.log('=== STEP 13: Click Cancel edit ===')
await page.locator('button:has-text("Cancel edit")').click()
await page.waitForTimeout(300)

console.log('=== STEP 14: Click Disable ===')
await page.locator('article:has-text("playwright-test") button:has-text("Disable")').first().click()
await page.waitForTimeout(1000)
await snap('13-mcp-disabled.png')

console.log('=== STEP 15: Click Enable to re-enable ===')
await page.locator('article:has-text("playwright-test") button:has-text("Enable")').first().click()
await page.waitForTimeout(800)
await snap('14-mcp-enabled.png')

console.log('=== STEP 16: Click Skills ===')
await page.click('#settings-nav-option-settings-skills')
await page.waitForTimeout(500)
await snap('15-settings-skills.png')

console.log('=== STEP 17: Click New user skill ===')
await page.locator('button:has-text("New user skill")').click()
await page.waitForTimeout(500)
await snap('16-new-skill-form.png')

console.log('=== STEP 18: Click Cancel on skill form (no save) ===')
const cancelSkillBtn = page.locator('button:has-text("Cancel edit")').first()
if (await cancelSkillBtn.count() > 0) await cancelSkillBtn.click()
await page.waitForTimeout(300)

console.log('=== STEP 19: Click Plugins ===')
await page.click('#settings-nav-option-settings-plugins')
await page.waitForTimeout(500)
await snap('17-settings-plugins.png')

console.log('=== STEP 20: Click Configuration (proxy) ===')
await page.click('#settings-nav-option-settings-proxy')
await page.waitForTimeout(500)
await snap('18-settings-proxy.png')

console.log('=== STEP 21: Test search - type "mcp" ===')
const search = page.locator('input[placeholder*="Search"]')
await search.click()
await page.keyboard.type('mcp')
await page.waitForTimeout(500)
await snap('19-search-mcp.png')

console.log('=== STEP 22: Clear search and close settings ===')
await search.fill('')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

console.log('=== STEP 23: Open command palette with Cmd+K ===')
await page.keyboard.press('Meta+k')
await page.waitForTimeout(500)
await snap('20-cmd-palette.png')

console.log('=== STEP 24: Type "agent" in palette ===')
await page.keyboard.type('agent')
await page.waitForTimeout(300)
await snap('21-palette-agent.png')

console.log('=== STEP 25: Arrow down and Enter ===')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('Enter')
await page.waitForTimeout(800)
await snap('22-palette-executed.png')

console.log('=== STEP 26: Go back to chat ===')
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)

console.log('=== STEP 27: Switch through workspace panes ===')
for (const [key, name] of [['Meta+Shift+1','files'],['Meta+Shift+2','diff'],['Meta+Shift+3','editor'],['Meta+Shift+4','terminal'],['Meta+Shift+5','preview']]) {
  await page.keyboard.press(key)
  await page.waitForTimeout(400)
  await snap(`23-pane-${name}.png`)
}

console.log('=== STEP 28: Type in composer ===')
await page.keyboard.press('Meta+1')
await page.waitForTimeout(300)
const composer = page.locator('textarea[placeholder*="Ask Claude"]')
await composer.click()
await page.keyboard.type('Hello, this is a test message to verify the composer works correctly')
await page.waitForTimeout(300)
await snap('24-composer-text.png')
await composer.fill('')

console.log('=== STEP 29: Remove test MCP server ===')
await page.keyboard.press('Meta+,')
await page.waitForTimeout(800)
await page.click('#settings-nav-option-settings-mcp')
await page.waitForTimeout(500)
const removeBtn = page.locator('article:has-text("playwright-test") button:has-text("Remove")').first()
if (await removeBtn.count() > 0) {
  await removeBtn.click()
  await page.waitForTimeout(800)
  await snap('25-remove-confirm.png')
  await page.locator('button:has-text("Remove MCP")').click()
  await page.waitForTimeout(1500)
  await snap('26-removed.png')
}

console.log('=== STEP 30: Back to chat final ===')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)
await snap('27-final-chat.png')

if (errors.length) {
  console.log('\n⚠️ ERRORS:')
  errors.forEach(e => console.log(' ', e))
} else {
  console.log('\n✅ No page/console errors across all 27 steps')
}

await app.close()
console.log('Done!')
