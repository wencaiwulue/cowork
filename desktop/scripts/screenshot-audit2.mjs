import { _electron as electron } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots'
mkdirSync(OUT, { recursive: true })

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

// Collect console messages
const consoleMsgs = []
const pageErrors = []

const app = await electron.launch({
  executablePath: electronPath,
  args: [mainPath],
  env: { ...process.env, NODE_ENV: 'production' },
})

const page = await app.firstWindow()
page.on('console', msg => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`))
page.on('pageerror', err => pageErrors.push(err.message))

// Wait longer for full load
console.log('Waiting 8 seconds for full load...')
await page.waitForTimeout(8000)

// Check what's actually in the DOM
const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 2000))
console.log('Body HTML (first 2000 chars):')
console.log(bodyHTML)
console.log('---')

if (consoleMsgs.length) {
  console.log('Console messages:')
  consoleMsgs.forEach(m => console.log(' ', m))
}
if (pageErrors.length) {
  console.log('Page errors:')
  pageErrors.forEach(e => console.log(' ', e))
}

await page.screenshot({ path: join(OUT, 'debug-full-load.png') })

await app.close()
