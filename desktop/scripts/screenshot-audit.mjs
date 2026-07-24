import { _electron as electron } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots'
mkdirSync(OUT, { recursive: true })

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({
  executablePath: electronPath,
  args: [mainPath],
  env: { ...process.env, NODE_ENV: 'production' },
})

const page = await app.firstWindow()
await page.waitForTimeout(3000)

// Helper: take screenshot with name
async function snap(name) {
  await page.waitForTimeout(800)
  const path = join(OUT, `${name}.png`)
  await page.screenshot({ path })
  console.log(`  ✓ ${name}`)
  return path
}

console.log('Screenshot audit starting...')

// 1. Chat (default landing)
console.log('1. Chat view (default)')
await snap('01-chat-default')

// 2. Settings - press Cmd+,
console.log('2. Settings page')
await page.keyboard.press('Meta+,')
await snap('02-settings-main')

// 3. Settings - scroll to MCP/skills section
console.log('3. Settings - Integrations section')
await page.evaluate(() => window.scrollTo(0, 600))
await snap('03-settings-integrations')

// 4. Agents page - Cmd+2
console.log('4. Agents page')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.keyboard.press('Meta+2')
await snap('04-agents-page')

// 5. Teams page - Cmd+3
console.log('5. Teams page')
await page.keyboard.press('Meta+3')
await snap('05-teams-page')

// 6. Tasks page - Cmd+4
console.log('6. Tasks page')
await page.keyboard.press('Meta+4')
await snap('06-tasks-page')

// 7. Command palette - Cmd+K
console.log('7. Command palette')
await page.keyboard.press('Meta+1')
await page.waitForTimeout(300)
await page.keyboard.press('Meta+k')
await snap('07-command-palette')
await page.keyboard.press('Escape')

// 8. Preview pane
console.log('8. Preview pane')
await page.keyboard.press('Meta+Shift+5')
await snap('08-preview-pane')

// 9. Back to chat
console.log('9. Chat with sidebar')
await page.keyboard.press('Meta+1')
await snap('09-chat-final')

await app.close()
console.log('\nDone! All screenshots saved to:', OUT)
