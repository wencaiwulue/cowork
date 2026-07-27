import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const requiredSmokeScreenshots = [
  'chat-streaming.png',
  'settings.png',
  'settings-narrow.png',
  'settings-mcp.png',
  'settings-skills.png',
  'command-palette.png',
  'agents.png',
  'agents-selected.png',
  'tasks.png',
  'teams.png',
  'composer-actions.png',
  'permission-modal.png',
  'files.png',
  'editor.png',
  'diff.png',
  'before-unsaved-files-pane-switch.png',
  'unsaved-files-pane-switch-dialog.png',
  'before-unsaved-diff-pane-switch.png',
  'unsaved-diff-pane-switch-dialog.png',
  'after-unsaved-diff-pane-switch-keep-editing.png',
  'terminal.png',
  'preview.png',
]
export const minimumScreenshotWidth = 640
export const minimumScreenshotHeight = 480
export const minimumScreenshotBytes = 1024

function packagedExecutable() {
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    return join(
      process.cwd(),
      `desktop/release/mac-${arch}/Claude Code Desktop.app/Contents/MacOS/Claude Code Desktop`,
    )
  }
  if (process.platform === 'win32') {
    return join(process.cwd(), 'desktop/release/win-unpacked/Claude Code Desktop.exe')
  }
  return join(process.cwd(), 'desktop/release/linux-unpacked/Claude Code Desktop')
}

function main() {
  const executablePath = packagedExecutable()
  const screenshotDir = process.env.DESKTOP_SMOKE_SCREENSHOT_DIR ||
    join(process.cwd(), 'desktop/release/ux-screenshots')
  if (!existsSync(executablePath)) {
    console.error(`Packaged desktop executable not found: ${executablePath}`)
    console.error('Run `bun run desktop:build` first.')
    process.exit(1)
  }

  const child = spawn(process.execPath, ['desktop/scripts/smoke-electron.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DESKTOP_SMOKE_EXECUTABLE_PATH: executablePath,
      DESKTOP_SMOKE_PROGRESS: process.env.DESKTOP_SMOKE_PROGRESS || '1',
      DESKTOP_SMOKE_SCREENSHOT_DIR: screenshotDir,
    },
    stdio: 'inherit',
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    if (code === 0) {
      const failures = verifySmokeScreenshots(screenshotDir)
      if (failures.length > 0) {
        console.error('Packaged smoke screenshots are incomplete:')
        for (const failure of failures) {
          console.error(`- ${failure}`)
        }
        process.exit(1)
      }
    }
    process.exit(code ?? 1)
  })
}

export function verifySmokeScreenshots(dir) {
  return requiredSmokeScreenshots.flatMap(name => {
    const path = join(dir, name)
    if (!existsSync(path)) {
      return [`Missing ${path}`]
    }
    const contents = readFileSync(path)
    const header = contents.subarray(0, 8)
    if (!header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return [`Invalid PNG ${path}`]
    }
    if (contents.byteLength < 24 || contents.subarray(12, 16).toString('ascii') !== 'IHDR') {
      return [`Invalid PNG ${path}`]
    }
    const width = contents.readUInt32BE(16)
    const height = contents.readUInt32BE(20)
    if (
      width < minimumScreenshotWidth ||
      height < minimumScreenshotHeight ||
      contents.byteLength < minimumScreenshotBytes
    ) {
      return [`Too small PNG ${path} (${width}x${height}, ${contents.byteLength} bytes)`]
    }
    return []
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
