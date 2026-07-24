import { _electron as electron } from 'playwright'

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'
const expectedHtml = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/renderer/index.html'

console.log('Main path exists:', await (await import('node:fs')).existsSync(mainPath))
console.log('HTML path exists:', await (await import('node:fs')).existsSync(expectedHtml))

const app = await electron.launch({
  executablePath: electronPath,
  args: [mainPath],
  env: { ...process.env, NODE_ENV: 'production' },
})
const page = await app.firstWindow()

page.on('console', msg => console.log(`[console.${msg.type()}]`, msg.text()))
page.on('pageerror', err => console.log('[pageerror]', err.message))
page.on('requestfailed', req => console.log('[requestfailed]', req.url(), req.failure()?.errorText))

await page.waitForTimeout(5000)
console.log('Final URL:', page.url())
console.log('Content length:', (await page.content()).length)

await app.close()
process.exit(0)
