import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveBuildMetadata } from './build-cli.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const packageJsonPath = join(root, 'package.json')

export function electronBuilderArgs(metadata = resolveBuildMetadata()) {
  const args = ['--config', 'desktop/electron-builder.json']
  if (metadata.isRelease) {
    args.push(`--config.buildVersion=${metadata.version}`)
  } else {
    args.push('--config.mac.forceCodeSigning=false')
    args.push('--config.mac.notarize=false')
  }
  return args
}

export function packageJsonForRelease(originalContents, version) {
  const parsed = JSON.parse(originalContents)
  return `${JSON.stringify({ ...parsed, version }, null, 2)}\n`
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed`)
    error.exitCode = result.status ?? 1
    throw error
  }
}

function main() {
  let metadata
  try {
    metadata = resolveBuildMetadata()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  run('node', ['desktop/scripts/build-cli.mjs'])
  run('bun', ['run', 'desktop:build-main'])
  run('vite', ['build', '--config', 'desktop/vite.config.ts'])
  const originalPackageJson = readFileSync(packageJsonPath, 'utf8')
  try {
    if (metadata.isRelease) {
      writeFileSync(
        packageJsonPath,
        packageJsonForRelease(originalPackageJson, metadata.version),
        'utf8',
      )
    }
    run('electron-builder', electronBuilderArgs(metadata))
  } finally {
    if (metadata.isRelease) {
      writeFileSync(packageJsonPath, originalPackageJson, 'utf8')
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(typeof error?.exitCode === 'number' ? error.exitCode : 1)
  }
}
