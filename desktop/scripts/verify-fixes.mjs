import { _electron as electron } from 'playwright'
import { join } from 'path'
const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots'
const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({ executablePath: electronPath, args: [mainPath], env: { ...process.env, NODE_ENV: 'production' } })
const page = await app.firstWindow()
await page.waitForTimeout(3000)

// Diff pane - should now show clean "Not a git repository" without dark empty box
await page.keyboard.press('Meta+Shift+2')
await page.waitForTimeout(1000)
await page.screenshot({ path: join(OUT, '40-diff-fixed.png') })
console.log('✓ diff pane fixed')

// Command palette with filter
await page.keyboard.press('Meta+1')
await page.waitForTimeout(300)
await page.keyboard.press('Meta+k')
await page.waitForTimeout(500)
await page.keyboard.type('skill')
await page.waitForTimeout(300)
await page.screenshot({ path: join(OUT, '41-cmd-palette-skill.png') })
console.log('✓ command palette skill filter')
await page.keyboard.press('Escape')

// Agents page
await page.keyboard.press('Meta+2')
await page.waitForTimeout(800)
await page.screenshot({ path: join(OUT, '42-agents-page.png') })
console.log('✓ agents page')

// Teams page
await page.keyboard.press('Meta+3')
await page.waitForTimeout(800)
await page.screenshot({ path: join(OUT, '43-teams-page.png') })
console.log('✓ teams page')

// Tasks page  
await page.keyboard.press('Meta+4')
await page.waitForTimeout(800)
await page.screenshot({ path: join(OUT, '44-tasks-page.png') })
console.log('✓ tasks page')

await app.close()
console.log('Done!')
