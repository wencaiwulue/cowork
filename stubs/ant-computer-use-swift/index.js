import { execFile, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

let cachedDisplayInfo = null
let displayInfoTime = 0
const DISPLAY_CACHE_MS = 5000

async function runAppleScript(script, timeoutMs = 3000) {
  try {
    const { stdout, stderr } = await execFileAsync('osascript', ['-e', script], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { stdout: stdout.trim(), stderr: stderr.trim(), error: null }
  } catch (error) {
    return { stdout: '', stderr: '', error }
  }
}

function getDisplaySizeSync() {
  if (cachedDisplayInfo && Date.now() - displayInfoTime < DISPLAY_CACHE_MS) {
    return cachedDisplayInfo
  }
  try {
    // Use a fast CGDisplay-based approach via a tiny Python one-liner
    // Fallback: parse system_profiler quickly
    const result = execSync(
      'system_profiler SPDisplaysDataType 2>/dev/null',
      { timeout: 3000, encoding: 'utf8' }
    )
    const lines = result.split('\n')
    const displays = []
    let current = null
    let displayId = 1
    for (const line of lines) {
      const resMatch = line.match(/Resolution:\s*(\d+)\s*x\s*(\d+)(\s*Retina)?/)
      if (resMatch) {
        current = {
          width: parseInt(resMatch[1], 10),
          height: parseInt(resMatch[2], 10),
          scaleFactor: resMatch[3] ? 2 : 1,
          displayId: displayId++,
          isMain: false,
        }
        displays.push(current)
      }
      if (current && line.includes('Main Display: Yes')) {
        current.isMain = true
      }
    }
    if (displays.length === 0) {
      displays.push({ width: 1920, height: 1080, scaleFactor: 1, displayId: 1, isMain: true })
    }
    cachedDisplayInfo = displays
    displayInfoTime = Date.now()
    return displays
  } catch {
    cachedDisplayInfo = [{ width: 1920, height: 1080, scaleFactor: 1, displayId: 1, isMain: true }]
    displayInfoTime = Date.now()
    return cachedDisplayInfo
  }
}

async function captureScreenshot(region) {
  const tmpPath = join(tmpdir(), `cu-ss-${randomUUID()}.png`)
  const args = ['-x', '-t', 'png']
  if (region) {
    args.push('-R', region)
  }
  args.push(tmpPath)
  try {
    await execFileAsync('screencapture', args, { timeout: 8000 })
    const data = readFileSync(tmpPath)
    const base64 = data.toString('base64')
    try { unlinkSync(tmpPath) } catch {}

    let width = 0, height = 0
    // Parse PNG dimensions from IHDR chunk (first 8 bytes after signature, then 4 bytes width, 4 bytes height)
    if (data.length > 24) {
      width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19]
      height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23]
    }
    // On Retina, screencapture returns physical pixels but API expects target dims
    // Keep physical pixels; the executor's computeTargetDims handles scaling
    return { base64, width, height }
  } catch (error) {
    try { unlinkSync(tmpPath) } catch {}
    throw error
  }
}

function parseAppList(output) {
  if (!output) return []
  return output.split(', ').map(name => {
    const clean = name.trim()
    return {
      bundleId: clean.toLowerCase().replace(/[^a-z0-9]/g, ''),
      displayName: clean,
    }
  }).filter(a => a.displayName)
}

const api = {
  _drainMainRunLoop() {},

  apps: {
    async prepareDisplay(allowlistBundleIds, hostBundleId, displayId) {
      try {
        if (hostBundleId && hostBundleId !== 'com.cli.code') {
          await runAppleScript(`tell application id "${hostBundleId}" to activate`, 1000)
        }
      } catch {}
      return { activated: undefined, hidden: [] }
    },

    async previewHideSet(allowlistBundleIds, displayId) {
      const { stdout } = await runAppleScript(
        'tell application "System Events" to get name of every process whose background only is false',
        3000
      )
      if (!stdout) return []
      return parseAppList(stdout)
        .filter(app => !allowlistBundleIds.some(id => app.bundleId.includes(id)))
        .slice(0, 20)
    },

    async findWindowDisplays(bundleIds) {
      const displays = getDisplaySizeSync()
      const mainDisplay = displays.find(d => d.isMain) || displays[0]
      return bundleIds.map(bundleId => ({
        bundleId,
        displayIds: mainDisplay ? [mainDisplay.displayId] : [1],
      }))
    },

    async appUnderPoint() {
      return null
    },

    async listInstalled() {
      try {
        const { stdout } = await execFileAsync('mdfind', ['kMDItemContentType == "com.apple.application-bundle"'], {
          timeout: 5000,
          maxBuffer: 5 * 1024 * 1024,
        })
        const paths = stdout.trim().split('\n').filter(Boolean).slice(0, 50)
        return paths.map(path => {
          const name = path.split('/').pop()?.replace('.app', '') ?? path
          return { bundleId: name.toLowerCase().replace(/[^a-z0-9]/g, ''), displayName: name, path }
        })
      } catch {
        return []
      }
    },

    async iconDataUrl() {
      return null
    },

    async listRunning() {
      const { stdout } = await runAppleScript(
        'tell application "System Events" to get name of every process whose background only is false',
        3000
      )
      return parseAppList(stdout)
    },

    async open(bundleId) {
      await runAppleScript(`tell application id "${bundleId}" to activate`, 2000)
    },

    async unhide(bundleIds) {
      for (const id of bundleIds) {
        await runAppleScript(`tell application id "${id}" to activate`, 1000)
      }
    },
  },

  display: {
    getSize(displayId) {
      const displays = getDisplaySizeSync()
      const found = displayId !== undefined
        ? displays.find(d => d.displayId === displayId)
        : displays.find(d => d.isMain)
      const d = found || displays[0]
      if (!d) return { width: 1920, height: 1080, scaleFactor: 2, displayId: 1 }
      // Return logical (point) dimensions for Retina displays
      return {
        ...d,
        width: d.scaleFactor === 2 ? Math.round(d.width / 2) : d.width,
        height: d.scaleFactor === 2 ? Math.round(d.height / 2) : d.height,
      }
    },

    async listAll() {
      return getDisplaySizeSync()
    },
  },

  screenshot: {
    async captureExcluding(allowedBundleIds, quality, width, height, displayId) {
      return captureScreenshot(null)
    },

    async captureRegion(allowedBundleIds, x, y, w, h, width, height, quality, displayId) {
      return captureScreenshot(`${x},${y},${w},${h}`)
    },
  },

  async resolvePrepareCapture(allowedBundleIds, hostBundleId, quality, width, height, displayId, autoResolve, doHide) {
    const result = await captureScreenshot(null)
    return { base64: result.base64, width: result.width, height: result.height, autoResolved: autoResolve }
  },

  hotkey: {
    async register() {},
    async unregister() {},
    async registerEscape() {},
    async notifyExpectedEscape() {},
  },

  tcc: {
    async hasAccessibilityPermission() {
      const { error } = await runAppleScript(
        'tell application "System Events" to get name of first process',
        2000
      )
      return !error
    },

    async hasScreenCapturePermission() {
      const tmpPath = join(tmpdir(), `cu-perm-${randomUUID()}.png`)
      try {
        await execFileAsync('screencapture', ['-x', '-t', 'png', '-T', '0', tmpPath], { timeout: 5000 })
        try { unlinkSync(tmpPath) } catch {}
        return true
      } catch {
        try { unlinkSync(tmpPath) } catch {}
        return false
      }
    },
  },
}

export default api
