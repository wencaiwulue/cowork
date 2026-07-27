import { _electron as electron } from 'playwright'

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({
  executablePath: electronPath,
  args: [mainPath],
  env: { ...process.env, NODE_ENV: 'production' },
})
const page = await app.firstWindow()

// Ensure window has focus
await page.bringToFront()
await page.waitForTimeout(5000)

// Check body content 
const bodyText = await page.evaluate(() => document.body.innerText?.substring(0, 200))
console.log('Body text:', bodyText)
console.log('URL:', page.url())

// Click on the page to ensure focus, then use keyboard shortcut
await page.mouse.click(100, 100)
await page.waitForTimeout(500)

// Try clicking the Settings button in the footer instead of keyboard
const settingsBtn = page.locator('button:has-text("Settings")').first()
const settingsExists = await settingsBtn.count()
console.log('Settings button count:', settingsExists)
if (settingsExists > 0) {
  await settingsBtn.click()
  await page.waitForTimeout(2000)
  const settingsText = await page.evaluate(() => document.body.innerText?.substring(0, 500))
  console.log('After clicking Settings:', settingsText)
  await page.screenshot({ path: '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots/dbg-settings-click.png' })
}

await app.close()
process.exit(0)
