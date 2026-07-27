import { _electron as electron } from 'playwright'
import { join } from 'path'

const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots'
const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({
  executablePath: electronPath,
  args: [mainPath],
  env: { ...process.env, NODE_ENV: 'production' },
})

const page = await app.firstWindow()
await page.waitForTimeout(3000)

// Go to settings
await page.keyboard.press('Meta+,')
await page.waitForTimeout(1000)

// Click on MCP in the sidebar
await page.click('text=MCP')
await page.waitForTimeout(800)
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(300)
await page.screenshot({ path: join(OUT, '10-settings-mcp.png') })
console.log('✓ settings-mcp')

// Scroll to Skills
await page.click('text=Skills')
await page.waitForTimeout(800)
await page.screenshot({ path: join(OUT, '11-settings-skills.png') })
console.log('✓ settings-skills')

// Click on Plugins
await page.click('text=Plugins')
await page.waitForTimeout(800)
await page.screenshot({ path: join(OUT, '12-settings-plugins.png') })
console.log('✓ settings-plugins')

// Click on Configuration
await page.click('text=Configuration')
await page.waitForTimeout(800)
await page.screenshot({ path: join(OUT, '13-settings-config.png') })
console.log('✓ settings-config')

await app.close()
console.log('Done!')
