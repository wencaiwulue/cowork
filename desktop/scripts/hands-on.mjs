import { _electron as electron } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT = '/Users/fengcaiwen/Downloads/claude-code/desktop/screenshots/hands-on'
mkdirSync(OUT, { recursive: true })

const electronPath = '/Users/fengcaiwen/Downloads/claude-code/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const mainPath = '/Users/fengcaiwen/Downloads/claude-code/desktop/dist/main/main.js'

const app = await electron.launch({ executablePath: electronPath, args: [mainPath], env: { ...process.env, NODE_ENV: 'production' } })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', err => errors.push(`PageError: ${err.message}`))
page.on('console', msg => { if (msg.type() === 'error') errors.push(`Console: ${msg.text()}`) })
await page.waitForTimeout(4000)

async function snap(name) { await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, name) }); console.log(`✓ ${name}`) }

// ========== TEST 1: MCP Remove with confirmation ==========
console.log('\n=== Test 1: MCP Remove flow ===')
await page.keyboard.press('Meta+,')
await page.waitForTimeout(800)
await page.click('#settings-nav-option-settings-mcp')
await page.waitForTimeout(500)
await snap('01-mcp-before-remove.png')

// Click Remove on test-server
const removeBtn = page.locator('article:has-text("test-server") button:has-text("Remove")').first()
if (await removeBtn.count() > 0) {
  await removeBtn.click()
  await page.waitForTimeout(800)
  await snap('02-remove-modal.png')
  
  // Verify modal structure
  const modalTitle = await page.locator('.modal-backdrop h3, [role="dialog"] h3, .modal h3').first().textContent().catch(() => '')
  const hasCancel = await page.locator('button:has-text("Cancel")').isVisible().catch(() => false)
  const hasRemove = await page.locator('button:has-text("Remove MCP")').isVisible().catch(() => false)
  console.log(`  Modal title: "${modalTitle}", Cancel: ${hasCancel}, Remove: ${hasRemove}`)
  
  // Click Remove MCP (confirm)
  await page.locator('button:has-text("Remove MCP")').click()
  await page.waitForTimeout(1500)
  await snap('03-after-remove.png')
  
  // Verify test-server is gone
  const stillThere = await page.locator('article:has-text("test-server")').count()
  console.log(`  test-server still present: ${stillThere > 0 ? 'YES (BUG)' : 'NO (removed OK)'}`)
  
  // Check for success notice
  const noticeText = await page.locator('[role="status"], [class*="notice"], [class*="status"]').allTextContents()
  console.log(`  Notices: ${noticeText.filter(t => t.trim()).join(' | ').substring(0, 200)}`)
} else {
  console.log('  No test-server to remove')
}

// ========== TEST 2: Add new MCP server ==========
console.log('\n=== Test 2: Add MCP server ===')
await page.locator('input[aria-label="MCP server name"]').fill('demo-server')
await page.locator('select[aria-label="MCP server scope"]').selectOption('user')
await page.locator('select[aria-label="MCP server mode"]').selectOption('stdio')
await page.locator('input[aria-label="MCP command"]').fill('ls')
await snap('04-mcp-add-form-filled.png')
await page.locator('button:has-text("Add MCP")').click()
await page.waitForTimeout(1500)
await snap('05-mcp-after-add.png')

// ========== TEST 3: Edit MCP ==========
console.log('\n=== Test 3: Edit MCP server ===')
const editBtn = page.locator('article:has-text("demo-server") button:has-text("Edit")').first()
if (await editBtn.count() > 0) {
  await editBtn.click()
  await page.waitForTimeout(800)
  await snap('06-mcp-edit-mode.png')
  // Verify form is pre-filled
  const nameVal = await page.locator('input[aria-label="MCP server name"]').inputValue()
  console.log(`  Edit mode - name field: "${nameVal}"`)
  // Cancel edit
  await page.locator('button:has-text("Cancel edit")').click()
  await page.waitForTimeout(500)
}

// ========== TEST 4: Check MCP Health ==========
console.log('\n=== Test 4: Check MCP Health ===')
await page.locator('button:has-text("Check MCP")').click()
await page.waitForTimeout(2000)
await snap('07-mcp-health-check.png')

// ========== TEST 5: MCP Remote mode ==========
console.log('\n=== Test 5: MCP Remote mode ===')
await page.locator('select[aria-label="MCP server mode"]').selectOption('remote')
await page.waitForTimeout(500)
await snap('08-mcp-remote-mode.png')
// Verify URL/type fields appear
const remoteFields = await page.evaluate(() => {
  const inputs = document.querySelectorAll('#settings-mcp input')
  return Array.from(inputs).map(i => i.placeholder || i.name || i.getAttribute('aria-label') || 'input').filter(Boolean)
})
console.log(`  Remote mode inputs: ${remoteFields.join(', ')}`)
await page.locator('select[aria-label="MCP server mode"]').selectOption('stdio')

// ========== TEST 6: Settings search with results count ==========
console.log('\n=== Test 6: Settings search ===')
const search = page.locator('input[placeholder*="Search"]')
await search.click()
await page.keyboard.type('proxy')
await page.waitForTimeout(500)
const resultsCount = await page.locator('#settings-search-results').textContent().catch(() => '')
console.log(`  Search "proxy" results: "${resultsCount.trim()}"`)
await snap('09-search-proxy.png')

await search.fill('mcp')
await page.waitForTimeout(500)
const resultsCount2 = await page.locator('#settings-search-results').textContent().catch(() => '')
console.log(`  Search "mcp" results: "${resultsCount2.trim()}"`)
await snap('10-search-mcp.png')

await search.fill('nonexistent123')
await page.waitForTimeout(500)
const resultsCount3 = await page.locator('#settings-search-results').textContent().catch(() => '')
console.log(`  Search "nonexistent123" results: "${resultsCount3.trim()}"`)
await snap('11-search-no-results.png')
await search.fill('')

// ========== TEST 7: Navigate through all settings sections ==========
console.log('\n=== Test 7: Settings nav ===')
for (const id of ['settings-runtime', 'settings-proxy', 'settings-mcp', 'settings-skills', 'settings-plugins']) {
  await page.click(`#settings-nav-option-${id}`)
  await page.waitForTimeout(300)
}
await page.keyboard.press('Escape')
console.log('  All nav items clicked successfully')

// ========== TEST 8: Escape from each page to chat ==========
console.log('\n=== Test 8: Escape navigation ===')
for (const [key, name] of [['Meta+2','agents'],['Meta+3','teams'],['Meta+4','tasks']]) {
  await page.keyboard.press(key)
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  // Check if Chat nav is active
  const chatActive = await page.evaluate(() => {
    const chatBtns = Array.from(document.querySelectorAll('button'))
    const chatBtn = chatBtns.find(b => b.textContent?.trim().startsWith('Chat'))
    return chatBtn ? chatBtn.className.includes('active') : false
  })
  console.log(`  Escape from ${name} → Chat active: ${chatActive}`)
}

// ========== TEST 9: Command palette execution ==========
console.log('\n=== Test 9: Command palette execution ===')
await page.keyboard.press('Meta+k')
await page.waitForTimeout(500)
await page.keyboard.type('teams')
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
await page.waitForTimeout(800)
const teamsVisible = await page.locator('.teams-pane, [aria-label*="Team"]').isVisible().catch(() => false)
console.log(`  Palette "teams" → Teams page visible: ${teamsVisible}`)
await snap('12-palette-teams.png')

// ========== TEST 10: Backdrop click dismiss modal ==========
console.log('\n=== Test 10: Settings "Back to app" link ===')
await page.keyboard.press('Meta+,')
await page.waitForTimeout(500)
await snap('13-settings-before-back.png')
// Click "Back to app"
const backLink = page.locator('text=Back to app').first()
if (await backLink.isVisible().catch(() => false)) {
  await backLink.click()
  await page.waitForTimeout(500)
  const backOnChat = await page.evaluate(() => {
    const chatBtns = Array.from(document.querySelectorAll('button'))
    const chatBtn = chatBtns.find(b => b.textContent?.trim().startsWith('Chat'))
    return chatBtn ? chatBtn.className.includes('active') : false
  })
  console.log(`  Back to app → Chat active: ${backOnChat}`)
}

if (errors.length) {
  console.log('\n⚠️ ERRORS:')
  errors.forEach(e => console.log(' ', e))
} else {
  console.log('\n✅ No page/console errors')
}

await app.close()
console.log('\nDone!')
