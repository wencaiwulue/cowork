import { _electron as electron } from 'playwright'
import { join } from 'node:path'
const outDir = '/tmp/desktop-audit4'
let n = 0
const cap = async (page, name) => { n++; await page.screenshot({ path: join(outDir, `${String(n).padStart(2,'0')}-${name}.png`) }); console.log(n, name) }

const app = await electron.launch({
  executablePath: '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  args: ['/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'],
  env: { ...process.env },
})
const page = await app.firstWindow()
await page.waitForTimeout(2500)

// Create a quick session first
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)
const sessionExists = await page.locator('.session-row').count()
if (sessionExists === 0) {
  await page.getByRole('button', { name: 'Quick session' }).click()
  await page.waitForTimeout(2500)
}

// 1. Session row context menu (three dots on session)
await page.locator('.session-menu-button').first().click()
await page.waitForTimeout(400)
await cap(page, '01-session-context-menu')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// 2. Collapse sessions
await page.locator('.rail-section-toggle').click()
await page.waitForTimeout(400)
await cap(page, '02-sessions-collapsed')
await page.locator('.rail-section-toggle').click()
await page.waitForTimeout(400)

// 3. New session + button menu
await page.locator('button[aria-label="New session"]').click()
await page.waitForTimeout(400)
await cap(page, '03-new-session-menu')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// 4. Type in composer and try @ menu
await page.locator('textarea[aria-label="Message Claude"]').fill('@example')
await page.waitForTimeout(800)
await page.locator('textarea[aria-label="Message Claude"]').fill('')
await page.waitForTimeout(200)

// 5. Terminal pane - start shell
await page.keyboard.press('Meta+Shift+4')
await page.waitForTimeout(500)
await cap(page, '04-terminal-empty')
// Click Start shell
await page.getByRole('button', { name: 'Start shell' }).click()
await page.waitForTimeout(2000)
await cap(page, '05-terminal-started')
// Type something in terminal
const terminal = page.locator('.terminal-pane .xterm').first()
if (await terminal.count() > 0) {
  await terminal.click()
  await page.waitForTimeout(300)
  await page.keyboard.type('ls\n')
  await page.waitForTimeout(1000)
  await cap(page, '06-terminal-ls')
}
// Click Stop
await page.getByRole('button', { name: 'Stop' }).click()
await page.waitForTimeout(500)

// 6. Editor pane
await page.keyboard.press('Meta+Shift+3')
await page.waitForTimeout(500)
await cap(page, '07-editor-empty')

// 7. Files pane - try refresh
await page.keyboard.press('Meta+Shift+1')
await page.waitForTimeout(500)
await cap(page, '08-files-pane')

// 8. Preview pane - type invalid URL
await page.keyboard.press('Meta+Shift+5')
await page.waitForTimeout(500)
await cap(page, '09-preview-empty')
await page.locator('.preview-pane input').fill('not-a-url')
await page.waitForTimeout(400)
await cap(page, '10-preview-invalid-url')
await page.locator('.preview-pane input').fill('https://example.com')
await page.waitForTimeout(300)
await cap(page, '11-preview-valid-url')

// 9. Command palette - scroll through items
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)
await page.keyboard.press('Meta+k')
await page.waitForTimeout(500)
// Type to filter
await page.keyboard.type('mcp')
await page.waitForTimeout(300)
await cap(page, '12-palette-filter-mcp')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// 10. Settings - narrow/mobile view check
await page.keyboard.press('Meta+5')
await await page.waitForTimeout(800)
// Scroll to plugins
await page.evaluate(() => document.getElementById('settings-plugins')?.scrollIntoView({ block: 'start' }))
await page.waitForTimeout(400)
await cap(page, '13-settings-plugins')

// 11. Agents - Custom section (for editing agents)
await page.keyboard.press('Meta+2')
await page.waitForTimeout(800)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.agents-pane .pane-jumpbar button')]
  btns.find(b => b.textContent?.trim() === 'Custom')?.click()
})
await page.waitForTimeout(500)
await cap(page, '14-agents-custom')

// 12. Tasks - fill in form
await page.keyboard.press('Meta+4')
await page.waitForTimeout(800)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.tasks-pane .pane-jumpbar button')]
  btns.find(b => b.textContent?.trim() === 'Global')?.click()
})
await page.waitForTimeout(500)
// Fill task form
const taskInputs = page.locator('.tasks-pane input')
if (await taskInputs.count() > 0) {
  await taskInputs.nth(0).fill('My task')
  await taskInputs.nth(1).fill('0 9 * * *')
  await page.locator('.tasks-pane textarea').first().fill('Do something')
  await page.waitForTimeout(300)
}
await cap(page, '15-tasks-form-filled')

// 13. Back to chat, try Cmd+W
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)
await cap(page, '16-back-to-chat')

console.log('\nDone!')
await app.close()
