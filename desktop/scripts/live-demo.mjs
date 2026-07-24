import { _electron as electron } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots/live-demo'
mkdirSync(OUT, { recursive: true })

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({ executablePath: electronPath, args: [mainPath], env: { ...process.env, NODE_ENV: 'production' } })
const page = await app.firstWindow()
await page.waitForTimeout(4000)

async function snap(name) { await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, name) }); console.log(`✓ ${name}`) }

// 1. Chat home
console.log('1. Chat home')
await page.keyboard.press('Meta+1')
await snap('01-chat-home.png')

// 2. Settings - General
console.log('2. Settings')
await page.keyboard.press('Meta+,')
await page.waitForTimeout(800)
await snap('02-settings-general.png')

// 3. MCP section
await page.click('#settings-nav-option-settings-mcp')
await page.waitForTimeout(500)
await snap('03-settings-mcp.png')

// 4. Skills section
await page.click('#settings-nav-option-settings-skills')
await page.waitForTimeout(500)
await snap('04-settings-skills.png')

// 5. Plugins section
await page.click('#settings-nav-option-settings-plugins')
await page.waitForTimeout(500)
await snap('05-settings-plugins.png')

// 6. Configuration (proxy)
await page.click('#settings-nav-option-settings-proxy')
await page.waitForTimeout(500)
await snap('06-settings-config.png')
await page.keyboard.press('Escape')

// 7. Agents page
console.log('7. Agents')
await page.keyboard.press('Meta+2')
await page.waitForTimeout(500)
await snap('07-agents-available.png')

// 8. Teams
console.log('8. Teams')
await page.keyboard.press('Meta+3')
await page.waitForTimeout(500)
await snap('08-teams.png')

// 9. Tasks
console.log('9. Tasks')
await page.keyboard.press('Meta+4')
await page.waitForTimeout(500)
await snap('09-tasks-project.png')

// 10. Command Palette
console.log('10. Cmd+K')
await page.keyboard.press('Meta+1')
await page.waitForTimeout(300)
await page.keyboard.press('Meta+k')
await page.waitForTimeout(500)
await snap('10-command-palette.png')
await page.keyboard.type('mcp')
await page.waitForTimeout(300)
await snap('11-cmd-palette-mcp.png')
await page.keyboard.press('Escape')

// 11. Preview pane
console.log('11. Workspace panes')
await page.keyboard.press('Meta+Shift+5')
await page.waitForTimeout(500)
await snap('12-pane-preview.png')

// 12. Diff pane
await page.keyboard.press('Meta+Shift+2')
await page.waitForTimeout(500)
await snap('13-pane-diff.png')

// 13. Terminal pane
await page.keyboard.press('Meta+Shift+4')
await page.waitForTimeout(500)
await snap('14-pane-terminal.png')

// 14. Composer with text
console.log('14. Composer')
await page.keyboard.press('Meta+1')
await page.waitForTimeout(300)
const composer = page.locator('textarea[placeholder*="Ask Claude"]')
await composer.click()
await page.keyboard.type('帮我分析一下这个项目的架构')
await page.waitForTimeout(300)
await snap('15-composer-typing.png')

await app.close()
console.log('\nDone!')
