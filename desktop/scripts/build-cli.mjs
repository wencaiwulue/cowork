import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

export function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)
}

export function resolveBuildMetadata(env = process.env) {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const releaseVersion = env.DESKTOP_RELEASE_VERSION?.trim()
  if (releaseVersion && !isSemver(releaseVersion)) {
    throw new Error(`DESKTOP_RELEASE_VERSION must be semver, got ${releaseVersion}`)
  }
  const isRelease = Boolean(releaseVersion)
  return {
    version: releaseVersion || String(packageJson.version ?? '999.0.0-local'),
    buildTime: isRelease
      ? env.DESKTOP_RELEASE_BUILD_TIME?.trim() || new Date().toISOString()
      : '1970-01-01T00:00:00.000Z',
    isRelease,
  }
}

export function cliBuildArgs(metadata = resolveBuildMetadata()) {
  return [
    'build',
    './src/entrypoints/cli.tsx',
    '--compile',
    '--outfile',
    './dist/claude-local',
    '--target=bun',
    '--define',
    `MACRO.VERSION=${JSON.stringify(metadata.version)}`,
    '--define',
    `MACRO.BUILD_TIME=${JSON.stringify(metadata.buildTime)}`,
    '--define',
    'MACRO.PACKAGE_URL="@anthropic-ai/claude-code"',
    '--define',
    'MACRO.NATIVE_PACKAGE_URL="@anthropic-ai/claude-code"',
    '--define',
    'MACRO.FEEDBACK_CHANNEL="https://github.com/anthropics/claude-code/issues"',
    '--define',
    'MACRO.ISSUES_EXPLAINER="open an issue at https://github.com/anthropics/claude-code/issues"',
    '--define',
    'MACRO.VERSION_CHANGELOG=[]',
  ]
}

function main() {
  let metadata
  try {
    metadata = resolveBuildMetadata()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  const result = spawnSync('bun', cliBuildArgs(metadata), {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  process.exit(result.status ?? 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
