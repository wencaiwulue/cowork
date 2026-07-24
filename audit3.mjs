import { _electron as electron } from 'playwright'
import { join } from 'node:path'
const outDir = '/tmp/desktop-audit5'
let n = 0
const cap = async (page, name) => { n++; await page.screenshot({ path: join(outDir, `${String(n).padStart(2,'0')}-${name}.png`) }); console.log(n, name) }

const app = await electron.launch({
  executablePath: '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  args: ['/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'],
  env: { ...process.env },
})
const page = await app.firstWindow()
await page.waitForTimeout(2500)
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)

// Editor pane
await page.keyboard.press('Meta+Shift+3')
await page.waitForTimeout(500)
await cap(page, 'editor-empty')

// Preview invalid URL
await page.keyboard.press('Meta+Shift+5')
await page.waitForTimeout(500)
await page.locator('.preview-pane input').fill('not-a-url')
await page.waitForTimeout(400)
await cap(page, 'preview-invalid')

// Command palette filter
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)
await page.keyboard.press('Meta+k')
await page.waitForTimeout(500)
await page.keyboard.type('mcp')
await page.waitForTimeout(300)
await cap(page, 'palette-mcp')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// Settings plugins
await page.keyboard.press('Meta+5')
await page.waitForTimeout(800)
await page.evaluate(() => document.getElementById('settings-plugins')?.scrollIntoView({ block: 'start' }))
await page.waitForTimeout(400)
await cap(page, 'settings-plugins')

// Agents custom
await page.keyboard.press('Meta+2')
await page.waitForTimeout(800)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.agents-pane .pane-jumpbar button')]
  btns.find(b => b.textContent?.trim() === 'Custom')?.click()
})
await page.waitForTimeout(500)
await cap(page, 'agents-custom')

// Tasks global with form
await page.keyboard.press('Meta+4')
await page.waitForTimeout(800)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.tasks-pane .pane-jumpbar button')]
  btns.find(b => b.textContent?.trim() === 'Global')?.click()
})
await page.waitForTimeout(500)
const taskInputs = page.locator('.tasks-pane input')
if (await taskInputs.count() > 0) {
  await taskInputs.nth(0).fill('My daily task')
  await taskInputs.nth(1).fill('0 9 * * *')
  await page.locator('.tasks-pane textarea').first().fill('Review yesterday work')
  await page.waitForTimeout(300)
}
await cap(page, 'tasks-global-form')

// Confirmation modal - try to close session
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)
// Right-click session row or click close button
await page.locator('.session-menu-button').first().click()
await page.waitForTimeout(300)
await page.locator('.session-context-menu button').last().click()
await page.waitForTimeout(500)
await cap(page, 'confirm-close-session')
// Cancel
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// Final check: chat with composer filled
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)
await page.locator('textarea[aria-label="Message Claude"]').fill('Hello, can you help me review this code?')
await page.waitForTimeout(200)
await cap(page, 'composer-ready')

console.log('\nDone!')
await app.close()
