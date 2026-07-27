import { spawn, spawnSync } from 'node:child_process'
import electronPath from 'electron'
import {
  buildElectronLaunch,
  isExistingInstanceHandoff,
  isFailedElectronStartup,
} from './devSupport.mjs'

const electronStartupGraceMs = Number(process.env.DESKTOP_DEV_STARTUP_GRACE_MS ?? 3000)

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  })
  child.on('exit', code => {
    if (code && code !== 0) {
      process.exit(code)
    }
  })
  return child
}

const cliBuild = spawnSync('bun', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (cliBuild.status !== 0) {
  process.exit(cliBuild.status ?? 1)
}

const build = spawnSync('bun', ['run', 'desktop:build-main'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (build.status !== 0) {
  process.exit(build.status ?? 1)
}

const vite = spawn('vite', ['--config', 'desktop/vite.config.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
})

setTimeout(() => {
  const launch = buildElectronLaunch(electronPath, 'desktop/dist/main/main.js')
  const startedAt = Date.now()
  const electron = run(launch.command, launch.args, {
    env: {
      ...process.env,
      DESKTOP_RENDERER_URL: 'http://127.0.0.1:5174',
    },
  })

  electron.on('exit', (code, signal) => {
    vite.kill()
    const elapsedMs = Date.now() - startedAt
    if (isExistingInstanceHandoff(elapsedMs, electronStartupGraceMs, code, signal)) {
      console.log(
        `Electron exited after ${elapsedMs}ms with code 0; ` +
          'an existing Claude Code Desktop window was likely focused.',
      )
      process.exit(0)
    }
    if (isFailedElectronStartup(elapsedMs, electronStartupGraceMs, code, signal)) {
      console.error(
        `Electron exited after ${elapsedMs}ms during desktop dev startup ` +
          `(code ${code ?? 'null'}, signal ${signal ?? 'null'}).`,
      )
      process.exit(code && code !== 0 ? code : 1)
    }
  })
}, 1500)

process.on('SIGINT', () => {
  vite.kill()
  process.exit(0)
})
