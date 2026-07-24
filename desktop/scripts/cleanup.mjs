import { _electron as electron } from 'playwright'
const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'
const app = await electron.launch({ executablePath: electronPath, args: [mainPath], env: { ...process.env, NODE_ENV: 'production' } })
const page = await app.firstWindow()
await page.waitForTimeout(4000)

// Go to MCP settings and remove demo-server
await page.keyboard.press('Meta+,')
await page.waitForTimeout(800)
await page.click('#settings-nav-option-settings-mcp')
await page.waitForTimeout(800)

const removeBtn = page.locator('article:has-text("demo-server") button:has-text("Remove")').first()
if (await removeBtn.count() > 0) {
  await removeBtn.click()
  await page.waitForTimeout(800)
  await page.locator('button:has-text("Remove MCP")').click()
  await page.waitForTimeout(1500)
  console.log('Removed demo-server')
} else {
  console.log('No demo-server found')
}

await app.close()
