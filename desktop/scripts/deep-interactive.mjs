import { _electron as electron } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots/deep-interactive'
mkdirSync(OUT, { recursive: true })

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({ executablePath: electronPath, args: [mainPath], env: { ...process.env, NODE_ENV: 'production' } })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', err => errors.push(`PageError: ${err.message}`))
page.on('console', msg => { if (msg.type() === 'error') errors.push(`Console: ${msg.text()}`) })
await page.waitForTimeout(4000)

async function snap(name) { await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, name) }); console.log(`  ✓ ${name}`) }

// === 1. Test MCP Remove (should show confirmation modal) ===
console.log('\n=== MCP Remove flow (confirmation modal) ===')
await page.keyboard.press('Meta+,')
await page.waitForTimeout(800)
await page.click('#settings-nav-option-settings-mcp')
await page.waitForTimeout(800)
await snap('01-mcp-with-server.png')

// Find and click Remove on test-server
const removeBtn = page.locator('article:has-text("test-server") button:has-text("Remove")').first()
if (await removeBtn.count() > 0) {
  await removeBtn.click()
  await page.waitForTimeout(800)
  await snap('02-remove-confirmation-modal.png')
  
  // Check modal exists with proper buttons
  const modal = page.locator('.modal-backdrop, [role="dialog"]')
  const modalVisible = await modal.isVisible().catch(() => false)
  console.log(`  Confirmation modal visible: ${modalVisible}`)
  
  // Press Escape to dismiss (cancel)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await snap('03-after-escape-modal.png')
  console.log('  Modal dismissed via Escape')
} else {
  console.log('  No test-server found to remove')
}

// === 2. Test MCP Edit flow ===
console.log('\n=== MCP Edit flow ===')
await page.click('#settings-nav-option-settings-mcp').catch(() => {})
await page.waitForTimeout(500)
const editBtn = page.locator('article:has-text("test-server") button:has-text("Edit")').first()
if (await editBtn.count() > 0) {
  await editBtn.click()
  await page.waitForTimeout(800)
  await snap('04-mcp-edit-mode.png')
  // Cancel edit
  const cancelBtn = page.locator('button:has-text("Cancel")').first()
  if (await cancelBtn.count() > 0) {
    await cancelBtn.click()
    await page.waitForTimeout(300)
  }
}

// === 3. Test backdrop click dismisses modal ===
console.log('\n=== Backdrop dismiss ===')
// Open settings again if needed
const removeBtn2 = page.locator('article:has-text("test-server") button:has-text("Remove")').first()
if (await removeBtn2.count() > 0) {
  await removeBtn2.click()
  await page.waitForTimeout(800)
  await snap('05-modal-for-backdrop.png')
  // Click outside the modal (top-left corner of backdrop)
  const viewport = page.viewportSize()
  await page.mouse.click(10, 10)
  await page.waitForTimeout(500)
  const modalGone = !(await page.locator('.modal-backdrop, [role="dialog"]').isVisible().catch(() => false))
  await snap('06-after-backdrop-click.png')
  console.log(`  Modal dismissed by backdrop click: ${modalGone}`)
}

// === 4. Settings search - test that non-matching items are hidden ===
console.log('\n=== Settings search filtering ===')
await page.click('#settings-nav-option-settings-mcp').catch(() => {})
await page.waitForTimeout(500)
const searchInput = page.locator('input[placeholder*="Search"]')
await searchInput.click()
await page.keyboard.type('skills')
await page.waitForTimeout(500)
await snap('07-search-skills.png')

await searchInput.fill('proxy')
await page.waitForTimeout(500)
await snap('08-search-proxy.png')

// Clear search
await searchInput.fill('')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// === 5. Agents page - test tab switching and Select button ===
console.log('\n=== Agents tabs ===')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.keyboard.press('Meta+2')
await page.waitForTimeout(800)
await snap('09-agents-default.png')

// Click Run tab
const runTab = page.locator('button:has-text("Run")').first()
if (await runTab.count() > 0) {
  await runTab.click()
  await page.waitForTimeout(500)
  await snap('10-agents-run-tab.png')
}

// Click Custom tab
const customTab = page.locator('button:has-text("Custom")').first()
if (await customTab.count() > 0) {
  await customTab.click()
  await page.waitForTimeout(500)
  await snap('11-agents-custom-tab.png')
}

// Click Running tab
const runningTab = page.locator('button:has-text("Running")').first()
if (await runningTab.count() > 0) {
  await runningTab.click()
  await page.waitForTimeout(500)
  await snap('12-agents-running-tab.png')
}

// === 6. New session (Cmd+N) and close (Cmd+W) ===
console.log('\n=== Session lifecycle ===')
await page.keyboard.press('Meta+1')
await page.waitForTimeout(500)
await page.keyboard.press('Meta+n')
await page.waitForTimeout(1500)
await snap('13-after-new-session.png')

// Check session count
const sessionCount = await page.evaluate(() => {
  const badges = document.querySelectorAll('[class*="session-count"], .sessions-count')
  return badges.length ? Array.from(badges).map(b => b.textContent?.trim()).join(', ') : 'checking sidebar'
})
console.log(`  Session count badge: ${sessionCount}`)

await page.keyboard.press('Meta+w')
await page.waitForTimeout(800)
await snap('14-after-close-session.png')

// === 7. Verify all nav shortcuts ===
console.log('\n=== Nav shortcuts ===')
for (const [key, name] of [['Meta+2','agents'],['Meta+3','teams'],['Meta+4','tasks'],['Meta+1','chat']]) {
  await page.keyboard.press(key)
  await page.waitForTimeout(400)
  await snap(`15-nav-${name}.png`)
}

// === 8. Workspace pane shortcuts ===
console.log('\n=== Workspace pane shortcuts ===')
for (const [key, name] of [['Meta+Shift+1','files'],['Meta+Shift+2','diff'],['Meta+Shift+3','editor'],['Meta+Shift+4','terminal'],['Meta+Shift+5','preview']]) {
  await page.keyboard.press(key)
  await page.waitForTimeout(300)
  await snap(`16-pane-${name}.png`)
}

if (errors.length) {
  console.log('\n⚠️ ERRORS:')
  errors.forEach(e => console.log(' ', e))
} else {
  console.log('\n✅ No page/console errors')
}

await app.close()
console.log('\nDone!')
