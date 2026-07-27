import { _electron as electron } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots'
mkdirSync(OUT, { recursive: true })

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const errors = []
const app = await electron.launch({
  executablePath: electronPath,
  args: [mainPath],
  env: { ...process.env, NODE_ENV: 'production' },
})
const page = await app.firstWindow()
page.on('pageerror', err => errors.push(`PageError: ${err.message}`))
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(`Console.error: ${msg.text()}`)
})

await page.waitForTimeout(3000)

async function snap(name) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, name) })
  console.log(`  ✓ ${name}`)
}

// 1. Chat view - check composer and workspace panes
console.log('1. Chat default with panes')
await page.keyboard.press('Meta+1')
await snap('20-chat-panes.png')

// 2. Click Files pane tab (folder icon in workspace pane toolbar)
console.log('2. Files pane')
await page.keyboard.press('Meta+Shift+1')
await snap('21-files-pane.png')

// 3. Diff pane
console.log('3. Diff pane')
await page.keyboard.press('Meta+Shift+2')
await snap('22-diff-pane.png')

// 4. Editor pane
console.log('4. Editor pane')
await page.keyboard.press('Meta+Shift+3')
await snap('23-editor-pane.png')

// 5. Terminal pane
console.log('5. Terminal pane')
await page.keyboard.press('Meta+Shift+4')
await snap('24-terminal-pane.png')

// 6. Settings search - type "mcp" to test filtering
console.log('6. Settings search filter')
await page.keyboard.press('Meta+,')
await page.waitForTimeout(500)
const searchBox = page.locator('input[placeholder*="Search"]')
await searchBox.click()
await searchBox.fill('mcp')
await page.waitForTimeout(500)
await snap('25-settings-search-mcp.png')

// 7. Settings search - type "proxy"
console.log('7. Settings search proxy')
await searchBox.fill('proxy')
await page.waitForTimeout(500)
await snap('26-settings-search-proxy.png')

// 8. Settings search - clear and go back
await searchBox.fill('')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// 9. Test new session keyboard shortcut
console.log('9. New session')
await page.keyboard.press('Meta+1')
await page.waitForTimeout(300)
await page.keyboard.press('Meta+n')
await page.waitForTimeout(1000)
await snap('27-new-session.png')

// 10. Close the new session
console.log('10. Close session')
await page.keyboard.press('Meta+w')
await page.waitForTimeout(500)
await snap('28-after-close.png')

// 11. Agents page - click Available tab
console.log('11. Agents tabs')
await page.keyboard.press('Meta+2')
await page.waitForTimeout(500)
await snap('29-agents-overview.png')
await page.click('text=Available')
await page.waitForTimeout(300)
await snap('30-agents-available.png')

// 12. Check the command palette with filter
console.log('12. Command palette filtered')
await page.keyboard.press('Meta+1')
await page.waitForTimeout(300)
await page.keyboard.press('Meta+k')
await page.waitForTimeout(500)
await page.keyboard.type('mcp')
await page.waitForTimeout(300)
await snap('31-cmd-palette-filtered.png')
await page.keyboard.press('Escape')

if (errors.length) {
  console.log('\n⚠️ Errors found:')
  errors.forEach(e => console.log(' ', e))
} else {
  console.log('\n✅ No page/console errors')
}

await app.close()
