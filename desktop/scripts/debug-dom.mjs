import { _electron as electron } from 'playwright'

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({
  executablePath: electronPath,
  args: [mainPath],
  env: { ...process.env, NODE_ENV: 'production' },
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', err => errors.push(`PageError: ${err.message}`))
page.on('console', msg => { if (msg.type() === 'error') errors.push(`Console.error: ${msg.text()}`) })

await page.waitForTimeout(5000)

console.log('=== Initial chat page ===')
const chatHTML = await page.evaluate(() => document.querySelector('#root')?.innerHTML?.substring(0, 500) || 'NO ROOT')
console.log(chatHTML)
console.log('Body children:', await page.evaluate(() => document.body.childElementCount))

// Now press Cmd+, for settings
await page.keyboard.press('Meta+,')
await page.waitForTimeout(2000)

console.log('\n=== After Cmd+, (Settings) ===')
const settingsHTML = await page.evaluate(() => document.querySelector('#root')?.innerHTML?.substring(0, 1000) || 'NO ROOT')
console.log(settingsHTML)

// Check what's visible
const settingsVisible = await page.evaluate(() => {
  const settingsEl = document.querySelector('[class*="settings"]')
  return settingsEl ? `Found settings element: ${settingsEl.className}, visible: ${settingsEl.offsetWidth > 0}` : 'No settings element found'
})
console.log('\nSettings element:', settingsVisible)

// Check all nav items
const navItems = await page.evaluate(() => {
  const buttons = document.querySelectorAll('button')
  return Array.from(buttons).slice(0, 30).map(b => ({ text: b.textContent?.trim()?.substring(0, 30), id: b.id, cls: b.className?.substring(0, 60) }))
})
console.log('\nButtons found:', navItems)

if (errors.length) {
  console.log('\n⚠️ Errors:', errors)
}

await page.screenshot({ path: '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots/debug-settings.png' })
await app.close()
