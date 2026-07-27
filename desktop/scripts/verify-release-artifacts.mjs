import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  summarizeUxValidationEvidenceContents,
  validateUxValidationEvidenceContents,
} from './ux-validation-evidence.mjs'
import {
  minimumScreenshotBytes,
  minimumScreenshotHeight,
  minimumScreenshotWidth,
  requiredSmokeScreenshots,
} from './smoke-packaged.mjs'
import { missingSmokeSummaryFlags } from './smoke-evidence.mjs'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..')
const productName = 'Claude Code Desktop'
const appId = 'com.anthropic.claude-code-desktop'
const requiredReleaseToolingPaths = {
  releaseCi: join(root, 'desktop/scripts/release-ci.mjs'),
  releaseVerifier: join(root, 'desktop/scripts/verify-release-artifacts.mjs'),
  releaseWorkflow: join(root, '.github/workflows/desktop-release.yml'),
}
const requiredReleaseEvidenceArtifactCheckIds = [
  'mac-app-artifact',
  'mac-dmg-artifact',
  'mac-zip-artifact',
  'mac-checksum-manifest',
  'mac-dmg-checksum',
  'mac-zip-checksum',
  'mac-zip-integrity',
  'mac-zip-app-bundle',
  'mac-dmg-integrity',
  'mac-app-asar',
  'mac-main-bundle',
  'mac-preload-bundle',
  'mac-renderer-bundle',
  'mac-package-main',
  'mac-package-version',
  'mac-cli-runtime',
  'mac-cli-runtime-executable',
  'mac-node-pty-native',
  'mac-node-pty-helper',
  'mac-node-pty-helper-executable',
  'mac-bundle-id',
  'mac-short-version',
  'mac-build-version',
  'mac-app-codesign',
  'mac-signing-identity-consistency',
  'mac-app-gatekeeper',
  'mac-app-notarization',
  'mac-dmg-codesign',
  'mac-dmg-gatekeeper',
  'mac-dmg-notarization',
]
const requiredReleaseEvidenceStepIds = [
  'release-env',
  'release-ux-validation',
  'release-machine',
  'source-check',
  'desktop-check',
  'desktop-test',
  'smoke-electron',
  'prod-check',
  'desktop-build',
  'smoke-packaged',
  'verify-release',
  'final-verify-release',
]
const releaseNotesEvidenceDetailCheckIds = new Set([
  'mac-app-codesign',
  'mac-app-gatekeeper',
  'mac-app-notarization',
  'mac-dmg-codesign',
  'mac-dmg-gatekeeper',
  'mac-dmg-notarization',
])
const requiredReleaseEvidenceStepCommands = new Map([
  ['release-env', { command: 'node', args: ['desktop/scripts/release-ci.mjs', 'preflight:environment'] }],
  ['release-ux-validation', { command: 'node', args: ['desktop/scripts/release-ci.mjs', 'preflight:ux-validation'] }],
  ['release-machine', { command: 'node', args: ['desktop/scripts/release-ci.mjs', 'preflight:runner'] }],
  ['source-check', { command: 'bun', args: ['run', 'check'] }],
  ['desktop-check', { command: 'bun', args: ['run', 'desktop:check'] }],
  ['desktop-test', { command: 'bun', args: ['run', 'desktop:test'] }],
  ['smoke-electron', { command: 'bun', args: ['run', 'desktop:smoke-electron'] }],
  ['prod-check', { command: 'bun', args: ['run', 'desktop:prod-check'] }],
  ['desktop-build', { command: 'bun', args: ['run', 'desktop:build'] }],
  ['smoke-packaged', { command: 'node', args: ['desktop/scripts/smoke-packaged.mjs'] }],
  ['verify-release', { command: 'bun', args: ['run', 'desktop:verify-release'] }],
  ['final-verify-release', { command: 'bun', args: ['run', 'desktop:verify-release'] }],
])
function requiredReleaseEvidenceStepEnv(releaseDir) {
  return new Map([
    ['smoke-electron', { DESKTOP_SMOKE_PROGRESS: '1' }],
    ['smoke-packaged', {
      DESKTOP_SMOKE_PROGRESS: '1',
      DESKTOP_SMOKE_SCREENSHOT_DIR: join(releaseDir, 'ux-screenshots'),
    }],
    ['verify-release', { DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_VERIFY_STEP: '1' }],
    ['final-verify-release', { DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_FINAL_VERIFY_STEP: '1' }],
  ])
}

function pass(id, message, evidence) {
  return { id, status: 'pass', message, evidence }
}

function fail(id, message, evidence, nextAction) {
  return { id, status: 'fail', message, evidence, nextAction }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  }
}

function readableCommand(command, args) {
  return [command, ...args.map(shellQuote)].join(' ')
}

function readableStepCommand(command, args = []) {
  return [command, ...args].filter(part => typeof part === 'string' && part.length > 0).join(' ')
}

function releaseNotesEvidenceDetail(value) {
  const detail = String(value ?? '<missing>')
    .replace(/\s+/g, ' ')
    .trim()
    .replaceAll('`', "'")
  return detail || '<missing>'
}

function releaseNotesUxScreenshotLine(screenshot) {
  return `- \`${String(screenshot.path).replace(/^.*desktop\/release\//, '')}\`: \`${screenshot.sha256}\` (${screenshot.sizeBytes} bytes)`
}

function isProductionReleaseVersion(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value) && !/local/i.test(value)
}

function appResourcePath(appPath, ...segments) {
  return join(appPath, 'Contents', 'Resources', ...segments)
}

function appInfoPlistPath(appPath) {
  return join(appPath, 'Contents', 'Info.plist')
}

function fileExistsCheck(id, message, path, nextAction, exists) {
  return exists(path)
    ? pass(id, message, path)
    : fail(id, message, path, nextAction)
}

function fileExecutableCheck(id, message, path, stat, nextAction) {
  try {
    const mode = stat(path).mode & 0o777
    return (mode & 0o111) !== 0
      ? pass(id, message, `${path} mode=${mode.toString(8)}`)
      : fail(id, message, `${path} mode=${mode.toString(8)}`, nextAction)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return fail(id, message, `${path}\n${detail}`, nextAction)
  }
}

function parseChecksumManifest(contents) {
  const checksums = new Map()
  for (const line of String(contents).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(trimmed)
    if (match) {
      checksums.set(match[2], match[1].toLowerCase())
    }
  }
  return checksums
}

function sha256File(path, readFile) {
  return createHash('sha256').update(readFile(path)).digest('hex')
}

function hasPngSignature(contents) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
}

function pngDimensions(contents) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  if (!hasPngSignature(bytes) || bytes.byteLength < 24) return undefined
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return undefined
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

function checksumManifestCheck(id, message, artifactPath, manifestPath, manifest, readFile) {
  const artifactName = basename(artifactPath)
  const expected = manifest.get(artifactName)
  if (!expected) {
    return fail(
      id,
      message,
      `missing ${artifactName} in ${manifestPath}`,
      'Regenerate desktop/release/SHA256SUMS from the signed release artifacts.',
    )
  }

  let actual
  try {
    actual = sha256File(artifactPath, readFile)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return fail(
      id,
      message,
      `${artifactPath}\n${detail}`,
      'Rebuild the release artifact and regenerate desktop/release/SHA256SUMS.',
    )
  }

  return actual === expected
    ? pass(id, message, `${actual}  ${artifactName}`)
    : fail(
      id,
      message,
      `${artifactName} expected ${actual}, got ${expected} in ${manifestPath}`,
      'Regenerate desktop/release/SHA256SUMS after building the signed release artifacts.',
    )
}

function readReleaseEvidence(evidencePath, readFile) {
  try {
    return {
      evidence: JSON.parse(String(readFile(evidencePath, 'utf8'))),
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function releaseEvidenceVersionCheck(evidence, expectedVersion) {
  const actualVersion = evidence?.releaseVersion
  return actualVersion === expectedVersion
    ? pass('mac-release-evidence-version', 'Release evidence records the verified release version.', `releaseVersion=${actualVersion}`)
    : fail(
      'mac-release-evidence-version',
      'Release evidence version does not match the artifact verification version.',
      `expected ${expectedVersion}, got ${actualVersion || '<missing>'}`,
      'Regenerate desktop/release/release-evidence.json with the same DESKTOP_RELEASE_VERSION used for the signed artifacts.',
    )
}

function releaseEvidenceTargetCheck(evidence, expectedPlatform, expectedArch, evidencePath) {
  const failures = []
  if (evidence?.platform !== expectedPlatform) {
    failures.push(`platform=${evidence?.platform ?? '<missing>'}; expected=${expectedPlatform}`)
  }
  if (evidence?.arch !== expectedArch) {
    failures.push(`arch=${evidence?.arch ?? '<missing>'}; expected=${expectedArch}`)
  }

  if (failures.length > 0) {
    return fail(
      'mac-release-evidence-target',
      'Release evidence target platform and architecture match the verified artifacts.',
      `${failures.join('; ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json on the same macOS release runner and architecture used to build the artifacts.',
    )
  }

  return pass(
    'mac-release-evidence-target',
    'Release evidence target platform and architecture match the verified artifacts.',
    `platform=${evidence.platform}; arch=${evidence.arch}`,
  )
}

function releaseEvidenceIdentityCheck(evidence, evidencePath) {
  const generatedAt = evidence?.generatedAt
  const generatedDate = new Date(generatedAt)
  const failures = []
  if (evidence?.schemaVersion !== 1) {
    failures.push(`schemaVersion=${evidence?.schemaVersion ?? '<missing>'}`)
  }
  if (evidence?.product !== productName) {
    failures.push(`product=${evidence?.product ?? '<missing>'}`)
  }
  if (
    typeof generatedAt !== 'string' ||
    Number.isNaN(generatedDate.getTime()) ||
    generatedDate.toISOString() !== generatedAt
  ) {
    failures.push(`generatedAt=${generatedAt ?? '<missing>'}`)
  }

  if (failures.length > 0) {
    return fail(
      'mac-release-evidence-identity',
      'Release evidence records schema, product, and generation timestamp metadata.',
      `${failures.join('; ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so schemaVersion, product, and generatedAt are archived.',
    )
  }

  return pass(
    'mac-release-evidence-identity',
    'Release evidence records schema, product, and generation timestamp metadata.',
    `schemaVersion=${evidence.schemaVersion}; product=${evidence.product}; generatedAt=${generatedAt}`,
  )
}

function isoTimestampValue(value) {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
    ? date
    : undefined
}

function releaseEvidencePurposeCheck(evidence, evidencePath) {
  const purpose = evidence?.evidencePurpose
  if (purpose === undefined || purpose === 'artifact-release') {
    return pass(
      'mac-release-evidence-purpose',
      'Release evidence is suitable for artifact verification.',
      `evidencePurpose=${purpose ?? '<unspecified>'}`,
    )
  }

  if (purpose === 'preflight-only') {
    return fail(
      'mac-release-evidence-purpose',
      'Preflight-only release evidence cannot verify production artifacts.',
      `evidencePurpose=${purpose} in ${evidencePath}`,
      'Run the full signed desktop:release-ci pipeline so release evidence is regenerated after artifact build, smoke, signing, notarization, and verification.',
    )
  }

  return fail(
    'mac-release-evidence-purpose',
    'Release evidence purpose is not supported for artifact verification.',
    `evidencePurpose=${purpose} in ${evidencePath}`,
    'Run the full signed desktop:release-ci pipeline so release evidence is regenerated after artifact build, smoke, signing, notarization, and verification.',
  )
}

function releaseEvidenceSourceCheck(evidence, evidencePath) {
  const source = evidence?.source
  const failures = []
  const repository = source?.repository
  const refName = source?.refName
  const refType = source?.refType
  const eventName = source?.eventName
  const commit = source?.commit
  const ciRunId = source?.ciRunId
  const ciRunAttempt = source?.ciRunAttempt
  const ciRunUrl = source?.ciRunUrl
  const expectedRunPath = repository && ciRunId
    ? `/${repository}/actions/runs/${ciRunId}${ciRunAttempt ? `/attempts/${ciRunAttempt}` : ''}`
    : undefined
  const expectedRunUrl = expectedRunPath ? `https://github.com${expectedRunPath}` : undefined

  if (!source || typeof source !== 'object') {
    failures.push('source=<missing>')
  }
  if (!repository || repository === '<local>' || !/^[^/\s]+\/[^/\s]+$/.test(String(repository))) {
    failures.push(`source.repository=${repository ?? '<missing>'}`)
  }
  if (!refName || refName === '<local>') {
    failures.push(`source.refName=${refName ?? '<missing>'}`)
  }
  if (!['branch', 'tag'].includes(String(refType))) {
    failures.push(`source.refType=${refType ?? '<missing>'}`)
  }
  if (!['workflow_dispatch', 'push'].includes(String(eventName))) {
    failures.push(`source.eventName=${eventName ?? '<missing>'}`)
  }
  if (
    typeof refName === 'string' &&
    refName.startsWith('desktop-v') &&
    refName !== `desktop-v${evidence?.releaseVersion ?? '<missing>'}`
  ) {
    failures.push(`source.refName=${refName}; expected=desktop-v${evidence?.releaseVersion ?? '<missing>'}`)
  }
  if (eventName === 'push') {
    if (refType !== 'tag') {
      failures.push(`source.refType=${refType ?? '<missing>'}; expected=tag for push release`)
    }
    if (refName !== `desktop-v${evidence?.releaseVersion ?? '<missing>'}`) {
      failures.push(`source.refName=${refName ?? '<missing>'}; expected=desktop-v${evidence?.releaseVersion ?? '<missing>'} for push release`)
    }
  }
  if (!commit || commit === '<unknown>' || commit !== evidence?.commit) {
    failures.push(`source.commit=${commit ?? '<missing>'}; commit=${evidence?.commit ?? '<missing>'}`)
  }
  if (!ciRunId || !/^\d+$/.test(String(ciRunId))) {
    failures.push(`source.ciRunId=${ciRunId ?? '<missing>'}`)
  }
  if (ciRunAttempt !== undefined && !/^\d+$/.test(String(ciRunAttempt))) {
    failures.push(`source.ciRunAttempt=${ciRunAttempt}`)
  }
  if (!ciRunUrl || !/^https:\/\/github\.com\/.+\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/.test(String(ciRunUrl))) {
    failures.push(`source.ciRunUrl=${ciRunUrl ?? '<missing>'}${expectedRunUrl ? `; expected=${expectedRunUrl}` : ''}`)
  } else if (expectedRunPath) {
    try {
      const parsedRunUrl = new URL(ciRunUrl)
      if (parsedRunUrl.href !== expectedRunUrl) {
        failures.push(`source.ciRunUrl=${ciRunUrl}; expected=${expectedRunUrl}`)
      }
    } catch {
      failures.push(`source.ciRunUrl=${ciRunUrl}`)
    }
  }

  if (failures.length > 0) {
    return fail(
      'mac-release-evidence-source',
      'Release evidence records CI source metadata for the signed artifacts.',
      `${failures.join('; ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json from the signed release CI workflow so source repository, ref, commit, and CI run metadata are archived.',
    )
  }

  return pass(
    'mac-release-evidence-source',
    'Release evidence records CI source metadata for the signed artifacts.',
    `${repository}@${refName} ${commit} run=${ciRunUrl}`,
  )
}

function releaseEvidenceArtifactsCheck(evidence, artifacts, evidencePath) {
  const failures = []
  for (const key of ['appPath', 'dmgPath', 'zipPath']) {
    const actual = evidence?.artifacts?.[key]
    const expected = artifacts[key]
    if (actual !== expected) {
      failures.push(`artifacts.${key}=${actual ?? '<missing>'}; expected=${expected ?? '<missing>'}`)
    }
  }

  if (failures.length > 0) {
    return fail(
      'mac-release-evidence-artifacts',
      'Release evidence artifact paths match the verified release artifacts.',
      `${failures.join('; ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json from the same signed .app, .dmg, and .zip artifacts being verified.',
    )
  }

  return pass(
    'mac-release-evidence-artifacts',
    'Release evidence artifact paths match the verified release artifacts.',
    `app=${artifacts.appPath}; dmg=${artifacts.dmgPath}; zip=${artifacts.zipPath}`,
  )
}

function releaseEvidenceChecksumCheck(id, message, evidence, digestKey, artifactPath, evidencePath, readFile) {
  const expected = evidence?.artifactDigests?.[digestKey]
  if (!expected?.sha256) {
    return fail(
      id,
      message,
      `missing ${digestKey} sha256 in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after building the signed release artifacts.',
    )
  }

  if (expected.path !== artifactPath) {
    return fail(
      id,
      message,
      `artifactDigests.${digestKey}.path=${expected.path ?? '<missing>'}; expected=${artifactPath} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json from the same signed artifact paths being verified.',
    )
  }

  let actual
  try {
    actual = sha256File(artifactPath, readFile)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return fail(
      id,
      message,
      `${artifactPath}\n${detail}`,
      'Rebuild the release artifact and regenerate desktop/release/release-evidence.json.',
    )
  }

  return actual === expected.sha256
    ? pass(id, message, `${actual}  ${basename(artifactPath)}`)
    : fail(
      id,
      message,
      `${basename(artifactPath)} expected ${actual}, got ${expected.sha256} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after building the signed release artifacts.',
    )
}

function releaseEvidenceChecksumManifestCheck(evidence, manifestPath, evidencePath, readFile) {
  const expected = evidence?.checksumManifest
  if (!expected?.sha256 || typeof expected.sizeBytes !== 'number') {
    return fail(
      'mac-release-evidence-checksum-manifest',
      'Release evidence records checksum manifest metadata.',
      `missing checksumManifest sizeBytes/sha256 in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after writing desktop/release/SHA256SUMS.',
    )
  }

  let contents
  try {
    contents = readFile(manifestPath)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return fail(
      'mac-release-evidence-checksum-manifest',
      'Release evidence checksum manifest metadata can be verified.',
      `${manifestPath}\n${detail}`,
      'Regenerate desktop/release/SHA256SUMS and desktop/release/release-evidence.json together.',
    )
  }

  const actualSize = Buffer.byteLength(contents)
  const actualSha256 = createHash('sha256').update(contents).digest('hex')
  if (expected.path !== manifestPath) {
    return fail(
      'mac-release-evidence-checksum-manifest',
      'Release evidence checksum manifest path matches SHA256SUMS.',
      `checksumManifest.path=${expected.path ?? '<missing>'}; expected=${manifestPath} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json and desktop/release/SHA256SUMS from the same release directory.',
    )
  }

  const expectedPath = basename(manifestPath)
  if (actualSize === expected.sizeBytes && actualSha256 === expected.sha256) {
    return pass(
      'mac-release-evidence-checksum-manifest',
      'Release evidence checksum manifest metadata matches SHA256SUMS.',
      `size=${actualSize} sha256=${actualSha256} ${expectedPath}`,
    )
  }

  return fail(
    'mac-release-evidence-checksum-manifest',
    'Release evidence checksum manifest metadata is stale.',
    `${expectedPath} expected size=${actualSize} sha256=${actualSha256}, got path=${expected.path ?? '<missing>'} size=${expected.sizeBytes} sha256=${expected.sha256} in ${evidencePath}`,
    'Regenerate desktop/release/release-evidence.json and desktop/release/SHA256SUMS from the same release artifacts.',
  )
}

function releaseEvidenceToolchainCheck(evidence, evidencePath, readFile) {
  const toolchain = evidence?.toolchain
  if (
    !/^bun@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(toolchain?.packageManager ?? '')) ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(toolchain?.node ?? ''))
  ) {
    return fail(
      'mac-release-evidence-toolchain',
      'Release evidence records pinned Bun and Node toolchain versions.',
      `packageManager=${toolchain?.packageManager ?? '<missing>'}; node=${toolchain?.node ?? '<missing>'} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json with pinned packageManager and engines.node metadata.',
    )
  }

  const expected = toolchain?.lockfile
  const expectedLockfilePath = join(root, 'bun.lock')
  if (!expected?.path || !expected?.sha256 || typeof expected.sizeBytes !== 'number') {
    return fail(
      'mac-release-evidence-toolchain',
      'Release evidence records lockfile metadata.',
      `missing toolchain.lockfile path/sizeBytes/sha256 in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after committing bun.lock.',
    )
  }

  if (expected.path !== expectedLockfilePath) {
    return fail(
      'mac-release-evidence-toolchain',
      'Release evidence lockfile path matches the current checkout bun.lock.',
      `toolchain.lockfile.path=${expected.path}; expected=${expectedLockfilePath} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json from the same source checkout used for the signed artifacts.',
    )
  }

  let contents
  try {
    contents = readFile(expectedLockfilePath)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return fail(
      'mac-release-evidence-toolchain',
      'Release evidence lockfile metadata can be verified.',
      `${expectedLockfilePath}\n${detail}`,
      'Regenerate desktop/release/release-evidence.json from a checkout that contains bun.lock.',
    )
  }

  const actualSize = Buffer.byteLength(contents)
  const actualSha256 = createHash('sha256').update(contents).digest('hex')
  if (actualSize === expected.sizeBytes && actualSha256 === expected.sha256 && basename(expected.path) === 'bun.lock') {
    return pass(
      'mac-release-evidence-toolchain',
      'Release evidence records pinned toolchain and lockfile metadata.',
      `${toolchain.packageManager}; node=${toolchain.node}; bun.lock size=${actualSize} sha256=${actualSha256}`,
    )
  }

  return fail(
    'mac-release-evidence-toolchain',
    'Release evidence lockfile metadata is stale.',
    `bun.lock expected size=${actualSize} sha256=${actualSha256}, got path=${expected.path} size=${expected.sizeBytes} sha256=${expected.sha256} in ${evidencePath}`,
    'Regenerate desktop/release/release-evidence.json after updating bun.lock.',
  )
}

function releaseToolingNotesLine(tool) {
  return `- \`${tool.path.replace(`${root}/`, '')}\`: \`${tool.sha256}\` (${tool.sizeBytes ?? 0} bytes)`
}

function releaseEvidenceToolingCheck(evidence, evidencePath, readFile) {
  const tooling = evidence?.releaseTooling
  if (!tooling || typeof tooling !== 'object') {
    return fail(
      'mac-release-evidence-tooling',
      'Release evidence records release tooling provenance.',
      `missing releaseTooling in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so release scripts and workflow provenance are archived.',
    )
  }

  const failures = []
  for (const [name, expectedPath] of Object.entries(requiredReleaseToolingPaths)) {
    const expected = tooling[name]
    if (!expected?.path || !expected?.sha256 || typeof expected.sizeBytes !== 'number') {
      failures.push(`${name}=<missing path/sizeBytes/sha256>`)
      continue
    }
    if (expected.path !== expectedPath) {
      failures.push(`${name}.path=${expected.path}; expected=${expectedPath}`)
      continue
    }
    if (expected.type !== 'file') {
      failures.push(`${name}.type=${expected.type ?? '<missing>'}; expected=file`)
      continue
    }

    try {
      const contents = readFile(expectedPath)
      const actualSize = Buffer.byteLength(contents)
      const actualSha256 = createHash('sha256').update(contents).digest('hex')
      if (actualSize !== expected.sizeBytes || actualSha256 !== expected.sha256) {
        failures.push(`${name} expected size=${actualSize} sha256=${actualSha256}, got size=${expected.sizeBytes} sha256=${expected.sha256}`)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      failures.push(`${name} ${expectedPath}: ${detail}`)
    }
  }

  if (failures.length > 0) {
    return fail(
      'mac-release-evidence-tooling',
      'Release evidence release tooling provenance matches the current checkout.',
      `${failures.join('; ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json from the same release tooling checkout used for the signed artifacts.',
    )
  }

  return pass(
    'mac-release-evidence-tooling',
    'Release evidence records release tooling provenance.',
    Object.entries(requiredReleaseToolingPaths)
      .map(([name, expectedPath]) => `${name}=${tooling[name].sha256} ${expectedPath}`)
      .join('; '),
  )
}

function releaseEvidenceCredentialsCheck(evidence, evidencePath) {
  const signing = evidence?.releaseCredentials?.signing
  const notarization = evidence?.releaseCredentials?.notarization
  const signingStrategies = new Set(['csc-link', 'csc-name'])
  const signingSources = new Set(['inline', 'path', 'keychain'])
  const notarizationStrategies = new Set(['api-key', 'apple-id', 'keychain-profile'])
  const notarizationSources = new Set(['inline', 'path', 'account', 'keychain', 'default-keychain'])
  const signingSourcesByStrategy = new Map([
    ['csc-link', new Set(['inline', 'path'])],
    ['csc-name', new Set(['keychain'])],
  ])
  const notarizationSourcesByStrategy = new Map([
    ['api-key', new Set(['inline', 'path'])],
    ['apple-id', new Set(['account'])],
    ['keychain-profile', new Set(['keychain', 'default-keychain'])],
  ])
  const allowedCredentialKeys = new Set(['strategy', 'source'])
  const failures = []

  if (!signingStrategies.has(signing?.strategy)) {
    failures.push(`releaseCredentials.signing.strategy=${signing?.strategy ?? '<missing>'}`)
  }
  if (!signingSources.has(signing?.source)) {
    failures.push(`releaseCredentials.signing.source=${signing?.source ?? '<missing>'}`)
  }
  if (
    signingStrategies.has(signing?.strategy) &&
    signingSources.has(signing?.source) &&
    !signingSourcesByStrategy.get(signing.strategy)?.has(signing.source)
  ) {
    failures.push(`releaseCredentials.signing.source=${signing.source}; expected=${[...signingSourcesByStrategy.get(signing.strategy)].join('|')} for ${signing.strategy}`)
  }
  if (!notarizationStrategies.has(notarization?.strategy)) {
    failures.push(`releaseCredentials.notarization.strategy=${notarization?.strategy ?? '<missing>'}`)
  }
  if (!notarizationSources.has(notarization?.source)) {
    failures.push(`releaseCredentials.notarization.source=${notarization?.source ?? '<missing>'}`)
  }
  if (
    notarizationStrategies.has(notarization?.strategy) &&
    notarizationSources.has(notarization?.source) &&
    !notarizationSourcesByStrategy.get(notarization.strategy)?.has(notarization.source)
  ) {
    failures.push(`releaseCredentials.notarization.source=${notarization.source}; expected=${[...notarizationSourcesByStrategy.get(notarization.strategy)].join('|')} for ${notarization.strategy}`)
  }
  for (const [scope, metadata] of [
    ['signing', signing],
    ['notarization', notarization],
  ]) {
    if (!metadata || typeof metadata !== 'object') continue
    for (const key of Object.keys(metadata)) {
      if (!allowedCredentialKeys.has(key)) {
        failures.push(`releaseCredentials.${scope}.${key}`)
      }
    }
  }

  if (failures.length > 0) {
    return fail(
      'mac-release-evidence-credentials',
      'Release evidence records redacted signing and notarization credential metadata.',
      `${failures.join('; ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json with releaseCredentials signing/notarization strategy and source metadata from desktop:release-ci.',
    )
  }

  return pass(
    'mac-release-evidence-credentials',
    'Release evidence records redacted signing and notarization credential metadata.',
    `signing=${signing.strategy} via ${signing.source}; notarization=${notarization.strategy} via ${notarization.source}`,
  )
}

function sensitiveContentLabels(contents) {
  const text = String(contents ?? '')
  const labels = []
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text) ||
    /["']?(?:privateKey|private_key|private-key)["']?\s*[:=]\s*[`'"]?[^`'",}\s]+/i.test(text)
  ) {
    labels.push('private key material')
  }
  if (
    /\b(?:certificate-password|app-specific-secret)\b/i.test(text) ||
    /["']?[\w.-]*password[\w.-]*["']?\s*[:=]\s*[`'"]?[^`'",}\s]+/i.test(text)
  ) {
    labels.push('password material')
  }
  if (/\bdeveloper[-_ ]?id[-_ ]?(?:application[-_ ]?)?p(?:kcs)?c?12\b/i.test(text)) {
    labels.push('placeholder certificate material')
  }
  if (/\b(?:CSC_KEY_PASSWORD|APPLE_APP_SPECIFIC_PASSWORD|APPLE_ID_PASSWORD)\s*[:=]\s*[`'"]?[^`'"\s]+/i.test(text)) {
    labels.push('credential password material')
  }
  if (
    /"(?:CSC_LINK|APPLE_API_KEY|CSC_KEY_PASSWORD|APPLE_APP_SPECIFIC_PASSWORD|APPLE_ID_PASSWORD)"\s*:\s*"[^"]+"/i.test(text) ||
    /\b(?:CSC_LINK|APPLE_API_KEY|CSC_KEY_PASSWORD|APPLE_APP_SPECIFIC_PASSWORD|APPLE_ID_PASSWORD)=\S+/i.test(text)
  ) {
    labels.push('raw credential environment value')
  }
  return [...new Set(labels)]
}

function sensitiveContentCheck(id, message, path, contents, nextAction) {
  const labels = sensitiveContentLabels(contents)
  if (labels.length === 0) {
    return pass(id, message, `${path} contains no raw private key or password material`)
  }

  return fail(
    id,
    message,
    `${path} contains ${labels.join(', ')}`,
    nextAction,
  )
}

function releaseNotesSensitiveContentCheck(notesPath, readFile) {
  let notes
  try {
    notes = String(readFile(notesPath, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return fail(
      'mac-release-notes-sensitive-content',
      'Release notes evidence does not include raw credential material.',
      `${notesPath}\n${detail}`,
      'Regenerate desktop/release/release-notes-evidence.md with desktop:release-ci and archive it with release artifacts.',
    )
  }

  return sensitiveContentCheck(
    'mac-release-notes-sensitive-content',
    'Release notes evidence does not include raw credential material.',
    notesPath,
    notes,
    'Remove raw credentials from release notes evidence, regenerate it with desktop:release-ci, and rotate any exposed secret.',
  )
}

function releaseEvidenceVerificationChecksCheck(evidence, evidencePath, currentChecks = []) {
  const recordedChecks = evidence?.artifactVerificationChecks
  if (!Array.isArray(recordedChecks)) {
    return fail(
      'mac-release-evidence-verification-checks',
      'Release evidence records artifact verification check coverage.',
      `missing artifactVerificationChecks array in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci after verifying signed release artifacts.',
    )
  }

  const checksById = new Map(recordedChecks.filter(check => check?.id).map(check => [check.id, check]))
  const missingIds = requiredReleaseEvidenceArtifactCheckIds.filter(id => !checksById.has(id))
  if (missingIds.length > 0) {
    return fail(
      'mac-release-evidence-verification-checks',
      'Release evidence is missing required artifact verification check coverage.',
      `missing ${missingIds.join(', ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so artifactVerificationChecks includes the full signed artifact verification set.',
    )
  }

  const failedIds = requiredReleaseEvidenceArtifactCheckIds.filter(id => checksById.get(id)?.status !== 'pass')
  if (failedIds.length > 0) {
    return fail(
      'mac-release-evidence-verification-checks',
      'Release evidence records failed required artifact verification checks.',
      `failed ${failedIds.join(', ')} in ${evidencePath}`,
      'Fix the failing release artifact checks, then regenerate desktop/release/release-evidence.json with desktop:release-ci.',
    )
  }

  const currentChecksById = new Map(currentChecks.filter(check => check?.id).map(check => [check.id, check]))
  const staleIds = requiredReleaseEvidenceArtifactCheckIds.filter(id => {
    const recorded = checksById.get(id)
    const current = currentChecksById.get(id)
    return current &&
      (
        recorded?.status !== current.status ||
        recorded?.message !== current.message ||
        recorded?.evidence !== current.evidence
      )
  })
  if (staleIds.length > 0) {
    return fail(
      'mac-release-evidence-verification-checks',
      'Release evidence artifact verification check details match the current artifacts.',
      `stale ${staleIds.join(', ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so artifactVerificationChecks are captured from the same artifact verification run.',
    )
  }

  return pass(
    'mac-release-evidence-verification-checks',
    'Release evidence records required artifact verification checks.',
    `${requiredReleaseEvidenceArtifactCheckIds.length} required artifact checks recorded as pass`,
  )
}

function releaseEvidencePipelineStepsCheck(evidence, evidencePath, releaseDir, options = {}) {
  const {
    allowMissingVerifyReleaseStep = false,
    allowMissingFinalVerifyReleaseStep = false,
  } = options
  const skippableStepIds = new Set([
    ...(allowMissingVerifyReleaseStep ? ['verify-release', 'final-verify-release'] : []),
    ...(allowMissingFinalVerifyReleaseStep ? ['final-verify-release'] : []),
  ])
  const requiredStepIds = requiredReleaseEvidenceStepIds.filter(id => !skippableStepIds.has(id))
  const steps = evidence?.steps
  if (!Array.isArray(steps)) {
    return fail(
      'mac-release-evidence-pipeline-steps',
      'Release evidence records required release pipeline step coverage.',
      `missing steps array in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so release preflight and pipeline steps are archived.',
    )
  }

  const stepsById = new Map(steps.filter(step => step?.id).map(step => [step.id, step]))
  const missingIds = requiredStepIds.filter(id => !stepsById.has(id))
  if (missingIds.length > 0) {
    return fail(
      'mac-release-evidence-pipeline-steps',
      'Release evidence is missing required release pipeline step coverage.',
      `missing ${missingIds.join(', ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so release preflight, build, test, and smoke steps are archived.',
    )
  }

  const recordedStepIds = steps.map(step => step?.id).filter(id => typeof id === 'string')
  let previousIndex = -1
  const outOfOrderIds = []
  for (const id of requiredStepIds) {
    const index = recordedStepIds.indexOf(id)
    if (index <= previousIndex) {
      outOfOrderIds.push(id)
    }
    previousIndex = Math.max(previousIndex, index)
  }
  if (outOfOrderIds.length > 0) {
    return fail(
      'mac-release-evidence-pipeline-steps',
      'Release evidence records required release pipeline steps in desktop:release-ci order.',
      `out of order ${outOfOrderIds.join(', ')} in ${evidencePath}; expected ${requiredStepIds.join(' -> ')}`,
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so preflight, build, test, and smoke steps are recorded in execution order.',
    )
  }

  const commandMismatchIds = requiredStepIds.filter(id => {
    const step = stepsById.get(id)
    const expected = requiredReleaseEvidenceStepCommands.get(id)
    return expected &&
      (
        step?.command !== expected.command ||
        JSON.stringify(step?.args ?? []) !== JSON.stringify(expected.args)
      )
  })
  if (commandMismatchIds.length > 0) {
    return fail(
      'mac-release-evidence-pipeline-steps',
      'Release evidence records the expected release pipeline commands.',
      commandMismatchIds
        .map(id => {
          const step = stepsById.get(id)
          const expected = requiredReleaseEvidenceStepCommands.get(id)
          return `${id} command=${readableStepCommand(step?.command, step?.args)}; expected=${readableStepCommand(expected.command, expected.args)}`
        })
        .join('; '),
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so pipeline commands and arguments match the signed release workflow.',
    )
  }

  const expectedStepEnv = requiredReleaseEvidenceStepEnv(releaseDir)
  const envMismatches = []
  for (const [id, expectedEnv] of expectedStepEnv.entries()) {
    if (!requiredStepIds.includes(id)) continue
    const step = stepsById.get(id)
    for (const [key, expectedValue] of Object.entries(expectedEnv)) {
      const actualValue = step?.env?.[key]
      if (actualValue !== expectedValue) {
        envMismatches.push(`${id} env.${key}=${actualValue ?? '<missing>'}; expected=${expectedValue}`)
      }
    }
  }
  if (envMismatches.length > 0) {
    return fail(
      'mac-release-evidence-pipeline-steps',
      'Release evidence records required smoke test environment.',
      envMismatches.join('; '),
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so smoke test environment records the screenshot capture directory.',
    )
  }

  const timingMismatches = []
  for (const id of requiredStepIds) {
    const step = stepsById.get(id)
    const startedAt = isoTimestampValue(step?.startedAt)
    const endedAt = isoTimestampValue(step?.endedAt)
    const durationMs = step?.durationMs
    if (!startedAt || !endedAt || typeof durationMs !== 'number' || durationMs < 0 || endedAt.getTime() < startedAt.getTime()) {
      timingMismatches.push(`${id} startedAt=${step?.startedAt ?? '<missing>'} endedAt=${step?.endedAt ?? '<missing>'} durationMs=${durationMs ?? '<missing>'}`)
    }
  }
  if (timingMismatches.length > 0) {
    return fail(
      'mac-release-evidence-pipeline-steps',
      'Release evidence records auditable timing metadata for required pipeline steps.',
      timingMismatches.join('; '),
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so required pipeline steps include ISO startedAt/endedAt timestamps and non-negative durations.',
    )
  }

  const contradictoryPassIds = requiredStepIds.filter(id => {
    const step = stepsById.get(id)
    return step?.status === 'pass' &&
      (
        step.exitCode !== 0 ||
        (Array.isArray(step.failures) && step.failures.length > 0)
      )
  })
  if (contradictoryPassIds.length > 0) {
    return fail(
      'mac-release-evidence-pipeline-steps',
      'Release evidence pass steps have zero exit codes and no failure records.',
      contradictoryPassIds
        .map(id => {
          const step = stepsById.get(id)
          const failureCount = Array.isArray(step?.failures) ? step.failures.length : 0
          return `${id} status=pass exitCode=${step?.exitCode ?? '<missing>'} failures=${failureCount}`
        })
        .join('; '),
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci so passed pipeline steps cannot carry failed exit codes or failure details.',
    )
  }

  const failedIds = requiredStepIds.filter(id => stepsById.get(id)?.status !== 'pass')
  if (failedIds.length === 0) {
    return pass(
      'mac-release-evidence-pipeline-steps',
      'Release evidence records required release pipeline steps.',
      `${requiredStepIds.length} required release steps recorded as pass`,
    )
  }

  return fail(
    'mac-release-evidence-pipeline-steps',
    'Release evidence records failed required release pipeline steps.',
    `failed ${failedIds.join(', ')} in ${evidencePath}`,
    'Fix the failing release pipeline steps, then regenerate desktop/release/release-evidence.json with desktop:release-ci.',
  )
}

function releaseEvidenceSmokeSummaryCheck(evidence, evidencePath) {
  const smokeStep = (evidence?.steps ?? []).find(step => step?.id === 'smoke-electron')
  const missingFlags = missingSmokeSummaryFlags(smokeStep?.smokeSummary)
  if (missingFlags.length > 0) {
    return fail(
      'mac-release-evidence-smoke-summary',
      'Release evidence records required desktop smoke feature flags.',
      `missing smoke summary flags ${missingFlags.join(', ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json with desktop:release-ci after Electron smoke prints the required summary flags.',
    )
  }

  return pass(
    'mac-release-evidence-smoke-summary',
    'Release evidence records required desktop smoke feature flags.',
    `${Object.keys(smokeStep.smokeSummary.requiredFlags ?? {}).length} required smoke summary flags recorded as pass`,
  )
}

function releaseEvidenceUxScreenshotsCheck(evidence, evidencePath, uxScreenshotsDir, readFile) {
  const screenshots = evidence?.uxScreenshots
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    return fail(
      'mac-release-evidence-ux-screenshots',
      'Release evidence records packaged UX screenshot path and metadata.',
      `missing uxScreenshots array in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after packaged smoke captures desktop/release/ux-screenshots/**/*.png.',
    )
  }

  const expectedPrefix = `${uxScreenshotsDir}/`
  const stalePathScreenshots = screenshots
    .map(screenshot => String(screenshot?.path ?? ''))
    .filter(path => path && !path.startsWith(expectedPrefix))
  if (stalePathScreenshots.length > 0) {
    return fail(
      'mac-release-evidence-ux-screenshots',
      'Release evidence UX screenshot paths match the current release directory.',
      `uxScreenshots.path=${stalePathScreenshots.join(', ')}; expected prefix=${expectedPrefix} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after packaged smoke captures screenshots in the current release directory.',
    )
  }

  const escapedPathScreenshots = screenshots
    .map(screenshot => String(screenshot?.path ?? ''))
    .filter(path => {
      if (!path) return false
      const relativePath = relative(uxScreenshotsDir, path)
      return relativePath === '' || relativePath.startsWith('..') || relativePath.startsWith('/')
    })
  if (escapedPathScreenshots.length > 0) {
    return fail(
      'mac-release-evidence-ux-screenshots',
      'Release evidence UX screenshot paths stay inside the archived screenshot directory.',
      `uxScreenshots.path=${escapedPathScreenshots.join(', ')}; expected directory=${uxScreenshotsDir} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after packaged smoke captures screenshots without path traversal segments.',
    )
  }

  const invalidScreenshots = screenshots
    .filter(screenshot =>
      screenshot?.type !== 'file' ||
      !String(screenshot.path ?? '').endsWith('.png') ||
      typeof screenshot.sizeBytes !== 'number' ||
      !/^[a-f0-9]{64}$/.test(String(screenshot.sha256 ?? '')),
    )
    .map(screenshot => screenshot?.path || '<missing>')
  if (invalidScreenshots.length > 0) {
    return fail(
      'mac-release-evidence-ux-screenshots',
      'Release evidence UX screenshot metadata is incomplete.',
      `invalid ${invalidScreenshots.join(', ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after packaged smoke captures readable PNG screenshots.',
    )
  }

  const staleScreenshots = []
  const corruptScreenshots = []
  const tooSmallScreenshots = []
  for (const screenshot of screenshots) {
    try {
      const contents = readFile(screenshot.path)
      const actualSize = Buffer.byteLength(contents)
      const actualSha256 = createHash('sha256').update(contents).digest('hex')
      const dimensions = pngDimensions(contents)
      if (!dimensions) {
        corruptScreenshots.push(basename(screenshot.path))
        continue
      }
      if (
        dimensions.width < minimumScreenshotWidth ||
        dimensions.height < minimumScreenshotHeight ||
        actualSize < minimumScreenshotBytes
      ) {
        tooSmallScreenshots.push(`${basename(screenshot.path)} (${dimensions.width}x${dimensions.height}, ${actualSize} bytes)`)
        continue
      }
      if (actualSize !== screenshot.sizeBytes || actualSha256 !== screenshot.sha256) {
        staleScreenshots.push(basename(screenshot.path))
      }
    } catch {
      staleScreenshots.push(basename(screenshot.path))
    }
  }
  if (corruptScreenshots.length > 0) {
    return fail(
      'mac-release-evidence-ux-screenshots',
      'Release evidence UX screenshots are valid PNG files.',
      `invalid PNG ${corruptScreenshots.join(', ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after packaged smoke captures valid PNG screenshots.',
    )
  }

  if (tooSmallScreenshots.length > 0) {
    return fail(
      'mac-release-evidence-ux-screenshots',
      'Release evidence UX screenshots are large enough for visual review.',
      `too small PNG ${tooSmallScreenshots.join(', ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after packaged smoke captures reviewable PNG screenshots.',
    )
  }

  if (staleScreenshots.length > 0) {
    return fail(
      'mac-release-evidence-ux-screenshots',
      'Release evidence UX screenshot metadata is stale.',
      `stale ${staleScreenshots.join(', ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after packaged smoke captures the archived screenshots.',
    )
  }

  const screenshotNames = new Set(screenshots.map(screenshot => basename(String(screenshot?.path ?? ''))))
  const missingRequiredScreenshots = requiredSmokeScreenshots
    .filter(name => !screenshotNames.has(name))
  if (missingRequiredScreenshots.length > 0) {
    return fail(
      'mac-release-evidence-ux-screenshots',
      'Release evidence records every required packaged UX screenshot.',
      `missing required UX screenshots ${missingRequiredScreenshots.join(', ')} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after packaged smoke captures every required UX screenshot.',
    )
  }

  return pass(
    'mac-release-evidence-ux-screenshots',
    'Release evidence records packaged UX screenshot path and metadata.',
    `${screenshots.length} screenshot metadata records verified`,
  )
}

function releaseEvidenceUxValidationCheck(evidence, evidencePath, uxValidationPath, readFile) {
  const expected = evidence?.uxValidationEvidence
  if (!expected?.path || !expected?.sha256 || typeof expected.sizeBytes !== 'number') {
    return fail(
      'mac-release-evidence-ux-validation',
      'Release evidence records completed UX validation evidence metadata.',
      `missing uxValidationEvidence path/sizeBytes/sha256 in ${evidencePath}`,
      'Attach a completed desktop/release/ux-validation-evidence.md and regenerate desktop/release/release-evidence.json.',
    )
  }

  if (expected.path !== uxValidationPath) {
    return fail(
      'mac-release-evidence-ux-validation',
      'Release evidence UX validation path matches ux-validation-evidence.md.',
      `uxValidationEvidence.path=${expected.path}; expected=${uxValidationPath} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json and desktop/release/ux-validation-evidence.md from the same release directory.',
    )
  }

  let contents
  try {
    contents = String(readFile(uxValidationPath, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return fail(
      'mac-release-evidence-ux-validation',
      'Completed UX validation evidence exists and is readable.',
      `${uxValidationPath}\n${detail}`,
      'Attach a completed desktop/release/ux-validation-evidence.md before running desktop:verify-release.',
    )
  }

  const actualSize = Buffer.byteLength(contents)
  const actualSha256 = createHash('sha256').update(contents).digest('hex')
  if (
    actualSize !== expected.sizeBytes ||
    actualSha256 !== expected.sha256
  ) {
    return fail(
      'mac-release-evidence-ux-validation',
      'Release evidence UX validation metadata matches ux-validation-evidence.md.',
      `ux-validation-evidence.md expected size=${actualSize} sha256=${actualSha256}, got path=${expected.path} size=${expected.sizeBytes} sha256=${expected.sha256} in ${evidencePath}`,
      'Regenerate desktop/release/release-evidence.json after updating UX validation evidence.',
    )
  }

  const uxValidationFailures = validateUxValidationEvidenceContents(contents, {
    expectedVersion: evidence?.releaseVersion,
    expectedCommit: evidence?.commit,
  })
  if (uxValidationFailures.length > 0) {
    return fail(
      'mac-release-evidence-ux-validation',
      'Completed UX validation evidence has reviewer approval and passing release checklist results.',
      `${expected.path}: ${uxValidationFailures.join('; ')}`,
      'Complete docs/desktop-ux-validation-checklist.md for this release candidate, save it as desktop/release/ux-validation-evidence.md, and rerun release verification.',
    )
  }

  const expectedSummary = summarizeUxValidationEvidenceContents(contents)
  const actualSummary = evidence?.uxValidationSummary
  const summaryFailures = Object.entries(expectedSummary)
    .filter(([, value]) => String(value ?? '').trim())
    .filter(([key, value]) => actualSummary?.[key] !== value)
    .map(([key, value]) => `${key}=${actualSummary?.[key] ?? '<missing>'}; expected=${value}`)
  if (summaryFailures.length > 0) {
    return fail(
      'mac-release-evidence-ux-validation',
      'Release evidence records UX validation approval metadata.',
      `${expected.path}: ${summaryFailures.join('; ')}`,
      'Regenerate desktop/release/release-evidence.json after updating UX validation evidence.',
    )
  }

  return pass(
    'mac-release-evidence-ux-validation',
    'Completed UX validation evidence is archived, passing, and approved.',
    `${expected.path} size=${actualSize} sha256=${actualSha256}`,
  )
}

function releaseNotesEvidenceCheck(evidence, notesPath, readFile) {
  let notes
  try {
    notes = String(readFile(notesPath, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return fail(
      'mac-release-notes-evidence',
      'Release notes evidence summary exists and is readable.',
      `${notesPath}\n${detail}`,
      'Regenerate desktop/release/release-notes-evidence.md with desktop:release-ci and archive it with release artifacts.',
    )
  }

  const expected = evidence?.releaseNotesEvidence
  if (!expected?.sha256 || typeof expected.sizeBytes !== 'number') {
    return fail(
      'mac-release-notes-evidence',
      'Release evidence records release notes evidence metadata.',
      `missing releaseNotesEvidence sizeBytes/sha256 in release-evidence.json`,
      'Regenerate desktop/release/release-evidence.json and desktop/release/release-notes-evidence.md together with desktop:release-ci.',
    )
  }
  const actualSize = Buffer.byteLength(notes)
  const actualSha256 = createHash('sha256').update(notes).digest('hex')
  const expectedPath = basename(notesPath)
  if (expected.path !== notesPath) {
    return fail(
      'mac-release-notes-evidence',
      'Release evidence release notes path matches release-notes-evidence.md.',
      `releaseNotesEvidence.path=${expected.path ?? '<missing>'}; expected=${notesPath} in release-evidence.json`,
      'Regenerate desktop/release/release-evidence.json and desktop/release/release-notes-evidence.md from the same release directory.',
    )
  }
  if (actualSize !== expected.sizeBytes || actualSha256 !== expected.sha256) {
    return fail(
      'mac-release-notes-evidence',
      'Release evidence release notes metadata matches release-notes-evidence.md.',
      `${expectedPath} expected size=${actualSize} sha256=${actualSha256}, got path=${expected.path ?? '<missing>'} size=${expected.sizeBytes} sha256=${expected.sha256} in release-evidence.json`,
      'Regenerate desktop/release/release-evidence.json and desktop/release/release-notes-evidence.md from the same desktop:release-ci run.',
    )
  }

  const requiredSnippets = [
    '# Claude Code Desktop Release Evidence Summary',
    `Version: \`${evidence?.releaseVersion}\``,
    'release-evidence.json',
    '## Artifact Verification',
    `UX screenshots: \`${(evidence?.uxScreenshots ?? []).length}\``,
  ]
  requiredSnippets.push(evidence?.checksumManifest?.path
    ? `Checksum manifest: \`${basename(evidence.checksumManifest.path)}\``
    : 'Checksum manifest: `<none>`')
  for (const check of evidence?.artifactVerificationChecks ?? []) {
    if (check?.id && check?.status && check?.message) {
      requiredSnippets.push(`- \`${check.id}\`: ${check.status} - ${check.message}`)
      if (releaseNotesEvidenceDetailCheckIds.has(check.id)) {
        requiredSnippets.push(`  - Evidence: \`${releaseNotesEvidenceDetail(check.evidence)}\``)
      }
    }
  }
  for (const step of evidence?.steps ?? []) {
    if (step?.id && step?.status) {
      requiredSnippets.push(`- \`${step.id}\`: ${step.status} (${step.durationMs ?? 0} ms)`)
    }
  }
  const smokeSummary = (evidence?.steps ?? []).find(step => step?.id === 'smoke-electron')?.smokeSummary
  if (smokeSummary) {
    requiredSnippets.push('## Smoke Summary')
    if (smokeSummary.terminalMode) {
      requiredSnippets.push(`- \`terminalMode\`: \`${smokeSummary.terminalMode}\``)
    }
    for (const [flag, value] of Object.entries(smokeSummary.requiredFlags ?? {})) {
      requiredSnippets.push(`- \`${flag}\`: \`${value}\``)
    }
  }
  if (evidence?.commit) {
    requiredSnippets.push(`Commit: \`${evidence.commit}\``)
  }
  if (evidence?.generatedAt) {
    requiredSnippets.push(`Generated at: \`${evidence.generatedAt}\``)
  }
  if (evidence?.source) {
    requiredSnippets.push(
      `Repository: \`${evidence.source.repository}\``,
      `Ref: \`${evidence.source.refName}\``,
      `Ref type: \`${evidence.source.refType}\``,
      `Event: \`${evidence.source.eventName}\``,
    )
    if (evidence.source.ciRunUrl) {
      requiredSnippets.push(`CI run: ${evidence.source.ciRunUrl}`)
    }
  }
  if (evidence?.evidencePurpose) {
    requiredSnippets.push(`Evidence purpose: \`${evidence.evidencePurpose}\``)
  }
  if (evidence?.releaseCredentials?.signing) {
    requiredSnippets.push(
      `Signing: \`${evidence.releaseCredentials.signing.strategy}\` via \`${evidence.releaseCredentials.signing.source}\``,
    )
  }
  if (evidence?.releaseCredentials?.notarization) {
    requiredSnippets.push(
      `Notarization: \`${evidence.releaseCredentials.notarization.strategy}\` via \`${evidence.releaseCredentials.notarization.source}\``,
    )
  }
  if (evidence?.toolchain) {
    requiredSnippets.push(
      `Toolchain: \`${evidence.toolchain.packageManager}\`, \`node@${evidence.toolchain.node}\``,
    )
    if (evidence.toolchain.lockfile?.sha256) {
      requiredSnippets.push(
        `Lockfile: \`${basename(evidence.toolchain.lockfile.path ?? 'bun.lock')}\` \`${evidence.toolchain.lockfile.sha256}\``,
      )
    }
  }
  if (evidence?.releaseTooling) {
    requiredSnippets.push(
      `Release tooling: \`${Object.values(evidence.releaseTooling).filter(tool => tool?.path && tool?.sha256).length}\` files`,
      '## Release Tooling',
    )
    for (const tool of Object.values(evidence.releaseTooling)) {
      if (tool?.path && tool?.sha256 && typeof tool.sizeBytes === 'number') {
        requiredSnippets.push(releaseToolingNotesLine(tool))
      }
    }
  }
  if (evidence?.uxValidationEvidence?.sha256) {
    requiredSnippets.push(
      `UX validation: \`${basename(evidence.uxValidationEvidence.path ?? 'ux-validation-evidence.md')}\` \`${evidence.uxValidationEvidence.sha256}\``,
    )
  }
  if (evidence?.uxValidationSummary) {
    requiredSnippets.push(
      '## UX Validation',
      `Validator: \`${evidence.uxValidationSummary.validator}\``,
      `Representative user: \`${evidence.uxValidationSummary.representativeUser}\``,
      `Representative user validation: \`${evidence.uxValidationSummary.representativeUserValidation}\``,
      `Known limitations accepted: \`${evidence.uxValidationSummary.knownLimitationsAccepted}\``,
      `UX approval: \`${evidence.uxValidationSummary.uxApprovalStatus}\` by \`${evidence.uxValidationSummary.uxApprovalApprover}\` on \`${evidence.uxValidationSummary.uxApprovalDate}\``,
    )
  }
  for (const screenshot of evidence?.uxScreenshots ?? []) {
    if (screenshot?.path && screenshot?.sha256 && typeof screenshot.sizeBytes === 'number') {
      requiredSnippets.push(releaseNotesUxScreenshotLine(screenshot))
    }
  }

  const missingSnippets = requiredSnippets.filter(snippet => !notes.includes(snippet))
  if (missingSnippets.length > 0) {
    return fail(
      'mac-release-notes-evidence',
      'Release notes evidence summary matches release evidence metadata.',
      `missing ${missingSnippets.join(', ')} in ${notesPath}`,
      'Regenerate desktop/release/release-notes-evidence.md from the same release-evidence.json that is archived with the artifacts.',
    )
  }

  return pass(
    'mac-release-notes-evidence',
    'Release notes evidence summary matches release evidence metadata.',
    `${notesPath} size=${actualSize} sha256=${actualSha256} references release-evidence.json, SHA256SUMS, version, commit, and ${(evidence?.uxScreenshots ?? []).length} UX screenshot records`,
  )
}

function plistValueCheck(id, message, plistPath, key, expectedValue, run = runCommand) {
  const result = run('plutil', ['-extract', key, 'raw', plistPath])
  const value = String(result.stdout ?? '').trim()
  if (result.status !== 0) {
    const output = `${result.stderr || result.stdout || result.error?.message || 'no output'}`.trim()
    return fail(
      id,
      message,
      `${readableCommand('plutil', ['-extract', key, 'raw', plistPath])}\n${output}`,
      'Rebuild the desktop release artifact so its Info.plist contains the required production metadata.',
    )
  }
  return value === expectedValue
    ? pass(id, message, `${key}=${value}`)
    : fail(
      id,
      message,
      `expected ${expectedValue}, got ${value || '<empty>'}`,
      'Ensure DESKTOP_RELEASE_VERSION is set for release builds and electron-builder metadata uses the production app id.',
    )
}

function zipContainsCheck(id, message, zipPath, expectedEntry, run = runCommand) {
  const result = run('unzip', ['-l', zipPath])
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.status !== 0) {
    return fail(
      id,
      message,
      `${readableCommand('unzip', ['-l', zipPath])}\n${output.trim() || 'no output'}`,
      'Rebuild the desktop release ZIP on the macOS release runner.',
    )
  }
  return output.includes(expectedEntry)
    ? pass(id, message, expectedEntry)
    : fail(
      id,
      message,
      `missing ${expectedEntry}`,
      'Rebuild the desktop release ZIP so it contains the packaged .app bundle.',
    )
}

function listAsarEntries(asarPath, run = runCommand) {
  return run('npx', ['--no-install', 'asar', 'list', asarPath])
}

function extractAsarFile(asarPath, filePath, run = runCommand) {
  return run('npx', ['--no-install', 'asar', 'extract-file', asarPath, filePath])
}

function asarContainsCheck(id, message, asarPath, expectedEntry, listResult) {
  const output = `${listResult.stdout ?? ''}\n${listResult.stderr ?? ''}`
  if (listResult.status !== 0) {
    return fail(
      id,
      message,
      `${readableCommand('npx', ['--no-install', 'asar', 'list', asarPath])}\n${output.trim() || 'no output'}`,
      'Rebuild the desktop release package so app.asar can be inspected.',
    )
  }
  return output.includes(expectedEntry)
    ? pass(id, message, expectedEntry)
    : fail(
      id,
      message,
      `missing ${expectedEntry}`,
      'Rebuild the desktop release package so app.asar contains the Electron main, preload, and renderer bundles.',
    )
}

function asarPackageValueCheck(id, message, asarPath, packageJsonResult, key, expectedValue) {
  const output = `${packageJsonResult.stdout ?? ''}\n${packageJsonResult.stderr ?? ''}`
  if (packageJsonResult.status !== 0) {
    return fail(
      id,
      message,
      `${readableCommand('npx', ['--no-install', 'asar', 'extract-file', asarPath, 'package.json'])}\n${output.trim() || 'no output'}`,
      'Rebuild the desktop release package so app.asar includes a readable package.json.',
    )
  }
  let packageJson
  try {
    packageJson = JSON.parse(String(packageJsonResult.stdout ?? ''))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return fail(
      id,
      message,
      `invalid package.json: ${detail}`,
      'Rebuild the desktop release package so app.asar includes valid package metadata.',
    )
  }
  const value = packageJson?.[key]
  return value === expectedValue
    ? pass(id, message, `${key}=${value}`)
    : fail(
      id,
      message,
      `expected ${expectedValue}, got ${value || '<empty>'}`,
      'Ensure desktop/scripts/build-desktop.mjs injects production package metadata before electron-builder packages app.asar.',
    )
}

export function discoverMacReleaseArtifacts(options = {}) {
  const {
    releaseDir = join(root, 'desktop/release'),
    arch = process.arch,
    version = process.env.DESKTOP_RELEASE_VERSION?.trim(),
    exists = existsSync,
    readDir = readdirSync,
  } = options

  const appPath = join(releaseDir, `mac-${arch}`, `${productName}.app`)
  const dmgCandidates = []
  const zipCandidates = []
  if (version) {
    dmgCandidates.push(join(releaseDir, `${productName}-${version}-${arch}.dmg`))
    zipCandidates.push(join(releaseDir, `${productName}-${version}-${arch}-mac.zip`))
    zipCandidates.push(join(releaseDir, `${productName}-${version}-${arch}.zip`))
  }

  if (exists(releaseDir)) {
    for (const entry of readDir(releaseDir)) {
      const matchesProductAndVersion = entry.includes(productName) && (!version || entry.includes(version))
      if (entry.endsWith('.dmg') && matchesProductAndVersion && !dmgCandidates.includes(join(releaseDir, entry))) {
        dmgCandidates.push(join(releaseDir, entry))
      }
      if (entry.endsWith('.zip') && matchesProductAndVersion && !zipCandidates.includes(join(releaseDir, entry))) {
        zipCandidates.push(join(releaseDir, entry))
      }
    }
  }

  return {
    appPath,
    dmgPath: dmgCandidates.find(candidate => exists(candidate)) ?? dmgCandidates[0],
    zipPath: zipCandidates.find(candidate => exists(candidate)) ?? zipCandidates[0],
  }
}

function commandCheck(id, message, command, args, run = runCommand) {
  const result = run(command, args)
  const commandText = readableCommand(command, args)
  if (result.status === 0) {
    return pass(id, message, commandText)
  }
  const output = `${result.stderr || result.stdout || result.error?.message || 'no output'}`.trim()
  return fail(
    id,
    message,
    `${commandText}\n${output}`,
    'Run the production build on a macOS release machine with Developer ID signing and notarization enabled.',
  )
}

function parseCodesignDisplayOutput(output) {
  const lines = output.split(/\r?\n/)
  const authorities = lines.filter(line => line.startsWith('Authority='))
  const authority = lines.find(line => line.startsWith('Authority=')) ?? 'Authority=<missing>'
  return {
    authorities,
    authority,
    authorityTeamId: authority.match(/\(([A-Z0-9]{10})\)$/)?.[1],
    teamIdentifier: lines.find(line => line.startsWith('TeamIdentifier='))?.slice('TeamIdentifier='.length),
  }
}

function codesignIdentityCheck(id, message, path, verifyArgs, run = runCommand) {
  const verifyResult = run('codesign', verifyArgs)
  const verifyCommand = readableCommand('codesign', verifyArgs)
  if (verifyResult.status !== 0) {
    const output = `${verifyResult.stderr || verifyResult.stdout || verifyResult.error?.message || 'no output'}`.trim()
    return fail(
      id,
      message,
      `${verifyCommand}\n${output}`,
      'Run the production build on a macOS release machine with Developer ID signing and notarization enabled.',
    )
  }

  const displayArgs = ['-dv', '--verbose=4', path]
  const displayResult = run('codesign', displayArgs)
  const displayCommand = readableCommand('codesign', displayArgs)
  const displayOutput = `${displayResult.stderr ?? ''}\n${displayResult.stdout ?? ''}`.trim()
  if (displayResult.status !== 0) {
    return fail(
      id,
      message,
      `${displayCommand}\n${displayOutput || displayResult.error?.message || 'no output'}`,
      'Rebuild the release artifact with a Developer ID Application signing identity.',
    )
  }

  const identity = parseCodesignDisplayOutput(displayOutput)
  if (!identity.authority.startsWith('Authority=Developer ID Application:')) {
    return fail(
      id,
      message,
      `${identity.authority}; expected leaf Developer ID Application authority`,
      'Rebuild the release artifact with a Developer ID Application signing identity, not a development, ad-hoc, or installer certificate.',
    )
  }
  if (!identity.authorityTeamId || !identity.teamIdentifier || identity.authorityTeamId !== identity.teamIdentifier) {
    return fail(
      id,
      message,
      `Authority team=${identity.authorityTeamId ?? '<missing>'}; TeamIdentifier=${identity.teamIdentifier ?? '<missing>'}`,
      'Rebuild the release artifact with a Developer ID Application signing identity whose certificate team matches the signed artifact TeamIdentifier.',
    )
  }
  const requiredChainAuthorities = ['Developer ID Certification Authority', 'Apple Root CA']
  const missingChainAuthorities = requiredChainAuthorities.filter(requiredAuthority =>
    !identity.authorities.some(authority => authority === `Authority=${requiredAuthority}`),
  )
  if (missingChainAuthorities.length > 0) {
    return fail(
      id,
      message,
      `missing Developer ID certificate chain authority: ${missingChainAuthorities.join(', ')}`,
      'Rebuild the release artifact with a complete Developer ID Application certificate chain.',
    )
  }

  return {
    ...pass(
      id,
      message,
      `${verifyCommand}; ${identity.authorities.join('; ')}${identity.teamIdentifier ? `; TeamIdentifier=${identity.teamIdentifier}` : ''}`,
    ),
    ...(identity.teamIdentifier ? { signingTeamId: identity.teamIdentifier } : {}),
  }
}

function codesignConsistencyCheck(appCodesignCheck, dmgCodesignCheck) {
  const appTeamId = appCodesignCheck?.signingTeamId
  const dmgTeamId = dmgCodesignCheck?.signingTeamId
  if (!appTeamId || !dmgTeamId) {
    return fail(
      'mac-signing-identity-consistency',
      'macOS app and DMG are signed by the same Developer ID team.',
      `app TeamIdentifier=${appTeamId ?? '<missing>'}; dmg TeamIdentifier=${dmgTeamId ?? '<missing>'}`,
      'Rebuild the release artifacts so both the app bundle and DMG are signed by the same Developer ID Application team.',
    )
  }

  if (appTeamId !== dmgTeamId) {
    return fail(
      'mac-signing-identity-consistency',
      'macOS app and DMG are signed by the same Developer ID team.',
      `app TeamIdentifier=${appTeamId}; dmg TeamIdentifier=${dmgTeamId}`,
      'Rebuild the release artifacts so both the app bundle and DMG are signed by the same Developer ID Application team.',
    )
  }

  return pass(
    'mac-signing-identity-consistency',
    'macOS app and DMG are signed by the same Developer ID team.',
    `TeamIdentifier=${appTeamId}`,
  )
}

export function verifyMacReleaseArtifacts(options = {}) {
  const {
    platform = process.platform,
    arch = process.arch,
    version = process.env.DESKTOP_RELEASE_VERSION?.trim(),
    releaseDir = join(root, 'desktop/release'),
    exists = existsSync,
    readDir = readdirSync,
    readFile = readFileSync,
    stat = statSync,
    run = runCommand,
    skipReleaseEvidenceChecks = false,
    allowMissingVerifyReleaseStep = process.env.DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_VERIFY_STEP === '1',
    allowMissingFinalVerifyReleaseStep = process.env.DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_FINAL_VERIFY_STEP === '1',
  } = options

  if (platform !== 'darwin') {
    return [
      fail(
        'mac-release-platform',
        'macOS release artifacts must be verified on macOS.',
        `process.platform=${platform}`,
        'Run this command on the macOS release runner after desktop:build.',
      ),
    ]
  }

  if (!version || !isProductionReleaseVersion(version)) {
    return [
      fail(
        'mac-release-version',
        'macOS release artifact verification requires a production release version.',
        `DESKTOP_RELEASE_VERSION=${version || '<missing>'}`,
        'Set DESKTOP_RELEASE_VERSION to the exact semver production version before running desktop:verify-release.',
      ),
    ]
  }

  const artifacts = discoverMacReleaseArtifacts({ releaseDir, arch, version, exists, readDir })
  const { appPath, dmgPath, zipPath } = artifacts
  const checks = []
  checks.push(
    exists(appPath)
      ? pass('mac-app-artifact', 'Packaged macOS app exists.', appPath)
      : fail(
        'mac-app-artifact',
        'Packaged macOS app is missing.',
        appPath,
        'Run DESKTOP_RELEASE_VERSION=x.y.z bun run desktop:build on the release machine.',
      ),
  )
  checks.push(
    dmgPath && exists(dmgPath)
      ? pass('mac-dmg-artifact', 'Packaged macOS DMG exists.', dmgPath)
      : fail(
        'mac-dmg-artifact',
        'Packaged macOS DMG is missing.',
        dmgPath || '<missing>',
        'Run DESKTOP_RELEASE_VERSION=x.y.z bun run desktop:build on the release machine.',
      ),
  )
  checks.push(
    zipPath && exists(zipPath)
      ? pass('mac-zip-artifact', 'Packaged macOS ZIP exists for release archive parity.', zipPath)
      : fail(
        'mac-zip-artifact',
        'Packaged macOS ZIP is missing.',
        zipPath || '<missing>',
        'Keep the macOS electron-builder target set to dmg and zip, then rerun desktop:build on the release machine.',
      ),
  )

  let releaseEvidence
  let canReadReleaseEvidence = false
  const releaseEvidencePath = join(releaseDir, 'release-evidence.json')
  if (!skipReleaseEvidenceChecks) {
    const hasReleaseEvidence = exists(releaseEvidencePath)
    if (hasReleaseEvidence) {
      const result = readReleaseEvidence(releaseEvidencePath, readFile)
      if (result.evidence) {
        releaseEvidence = result.evidence
        canReadReleaseEvidence = true
        checks.push(pass('mac-release-evidence', 'Release evidence JSON exists and is readable.', releaseEvidencePath))
        checks.push(sensitiveContentCheck(
          'mac-release-evidence-sensitive-content',
          'Release evidence JSON does not include raw credential material.',
          releaseEvidencePath,
          JSON.stringify(releaseEvidence),
          'Remove raw credentials from release evidence, regenerate it with desktop:release-ci, and rotate any exposed secret.',
        ))
        checks.push(releaseEvidenceIdentityCheck(releaseEvidence, releaseEvidencePath))
        checks.push(releaseEvidencePurposeCheck(releaseEvidence, releaseEvidencePath))
        checks.push(releaseEvidenceVersionCheck(releaseEvidence, version))
        checks.push(releaseEvidenceTargetCheck(releaseEvidence, platform, arch, releaseEvidencePath))
        checks.push(releaseEvidenceSourceCheck(releaseEvidence, releaseEvidencePath))
        checks.push(releaseEvidenceArtifactsCheck(releaseEvidence, artifacts, releaseEvidencePath))
      } else {
        checks.push(fail(
          'mac-release-evidence',
          'Release evidence JSON cannot be read.',
          `${releaseEvidencePath}\n${result.error}`,
          'Regenerate desktop/release/release-evidence.json and make sure it is archived with readable file permissions.',
        ))
      }
    } else {
      checks.push(fail(
        'mac-release-evidence',
        'Release evidence JSON is missing.',
        releaseEvidencePath,
        'Run desktop:release-ci so desktop/release/release-evidence.json is generated and archived.',
      ))
    }
  }
  if (dmgPath && exists(dmgPath) && canReadReleaseEvidence) {
    checks.push(releaseEvidenceChecksumCheck(
      'mac-dmg-evidence-checksum',
      'Release evidence checksum matches the packaged macOS DMG.',
      releaseEvidence,
      'dmgPath',
      dmgPath,
      releaseEvidencePath,
      readFile,
    ))
  }
  if (zipPath && exists(zipPath) && canReadReleaseEvidence) {
    checks.push(releaseEvidenceChecksumCheck(
      'mac-zip-evidence-checksum',
      'Release evidence checksum matches the packaged macOS ZIP.',
      releaseEvidence,
      'zipPath',
      zipPath,
      releaseEvidencePath,
      readFile,
    ))
  }

  const checksumManifestPath = join(releaseDir, 'SHA256SUMS')
  const hasChecksumManifest = exists(checksumManifestPath)
  let checksumManifest = new Map()
  let canReadChecksumManifest = false
  if (canReadReleaseEvidence && hasChecksumManifest) {
    checks.push(releaseEvidenceChecksumManifestCheck(
      releaseEvidence,
      checksumManifestPath,
      releaseEvidencePath,
      readFile,
    ))
  }
  if (canReadReleaseEvidence) {
    checks.push(releaseEvidenceToolchainCheck(
      releaseEvidence,
      releaseEvidencePath,
      readFile,
    ))
    checks.push(releaseEvidenceToolingCheck(
      releaseEvidence,
      releaseEvidencePath,
      readFile,
    ))
    checks.push(releaseEvidenceCredentialsCheck(
      releaseEvidence,
      releaseEvidencePath,
    ))
    checks.push(releaseEvidencePipelineStepsCheck(
      releaseEvidence,
      releaseEvidencePath,
      releaseDir,
      { allowMissingVerifyReleaseStep, allowMissingFinalVerifyReleaseStep },
    ))
    checks.push(releaseEvidenceSmokeSummaryCheck(
      releaseEvidence,
      releaseEvidencePath,
    ))
    checks.push(releaseEvidenceUxScreenshotsCheck(
      releaseEvidence,
      releaseEvidencePath,
      join(releaseDir, 'ux-screenshots'),
      readFile,
    ))
    checks.push(releaseEvidenceUxValidationCheck(
      releaseEvidence,
      releaseEvidencePath,
      join(releaseDir, 'ux-validation-evidence.md'),
      readFile,
    ))
    const releaseNotesPath = join(releaseDir, 'release-notes-evidence.md')
    if (exists(releaseNotesPath)) {
      checks.push(releaseNotesSensitiveContentCheck(
        releaseNotesPath,
        readFile,
      ))
    }
    checks.push(releaseNotesEvidenceCheck(
      releaseEvidence,
      releaseNotesPath,
      readFile,
    ))
  }
  if (hasChecksumManifest) {
    try {
      checksumManifest = parseChecksumManifest(readFile(checksumManifestPath, 'utf8'))
      canReadChecksumManifest = true
      checks.push(pass('mac-checksum-manifest', 'Release checksum manifest exists and is readable.', checksumManifestPath))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      checks.push(fail(
        'mac-checksum-manifest',
        'Release checksum manifest cannot be read.',
        `${checksumManifestPath}\n${detail}`,
        'Regenerate desktop/release/SHA256SUMS and make sure it is archived with readable file permissions.',
      ))
    }
  } else {
    checks.push(fail(
      'mac-checksum-manifest',
      'Release checksum manifest is missing.',
      checksumManifestPath,
      'Run desktop:release-ci so desktop/release/SHA256SUMS is generated from release artifact digests.',
    ))
  }
  if (dmgPath && exists(dmgPath) && canReadChecksumManifest) {
    checks.push(checksumManifestCheck(
      'mac-dmg-checksum',
      'Release checksum manifest matches the packaged macOS DMG.',
      dmgPath,
      checksumManifestPath,
      checksumManifest,
      readFile,
    ))
  }
  if (zipPath && exists(zipPath) && canReadChecksumManifest) {
    checks.push(checksumManifestCheck(
      'mac-zip-checksum',
      'Release checksum manifest matches the packaged macOS ZIP.',
      zipPath,
      checksumManifestPath,
      checksumManifest,
      readFile,
    ))
  }

  if (zipPath && exists(zipPath)) {
    checks.push(commandCheck(
      'mac-zip-integrity',
      'Packaged macOS ZIP archive is structurally valid.',
      'ditto',
      ['-t', '-k', zipPath],
      run,
    ))
    checks.push(zipContainsCheck(
      'mac-zip-app-bundle',
      'Packaged macOS ZIP contains the app bundle.',
      zipPath,
      `${productName}.app/Contents/Info.plist`,
      run,
    ))
  }

  if (dmgPath && exists(dmgPath)) {
    checks.push(commandCheck(
      'mac-dmg-integrity',
      'Packaged macOS DMG image is structurally valid.',
      'hdiutil',
      ['verify', dmgPath],
      run,
    ))
  }

  if (exists(appPath)) {
    const appAsarPath = appResourcePath(appPath, 'app.asar')
    checks.push(fileExistsCheck(
      'mac-app-asar',
      'Packaged macOS app contains the Electron app archive.',
      appAsarPath,
      'Ensure electron-builder packages desktop/dist into Contents/Resources/app.asar.',
      exists,
    ))
    if (exists(appAsarPath)) {
      const appAsarList = listAsarEntries(appAsarPath, run)
      const appAsarPackageJson = extractAsarFile(appAsarPath, 'package.json', run)
      checks.push(asarContainsCheck(
        'mac-main-bundle',
        'Packaged Electron app archive contains the main process bundle.',
        appAsarPath,
        'desktop/dist/main/main.js',
        appAsarList,
      ))
      checks.push(asarContainsCheck(
        'mac-preload-bundle',
        'Packaged Electron app archive contains the preload bundle.',
        appAsarPath,
        'desktop/dist/preload/preload.cjs',
        appAsarList,
      ))
      checks.push(asarContainsCheck(
        'mac-renderer-bundle',
        'Packaged Electron app archive contains the renderer entrypoint.',
        appAsarPath,
        'desktop/dist/renderer/index.html',
        appAsarList,
      ))
      checks.push(asarPackageValueCheck(
        'mac-package-main',
        'Packaged Electron app metadata points to the main process bundle.',
        appAsarPath,
        appAsarPackageJson,
        'main',
        'desktop/dist/main/main.js',
      ))
      checks.push(asarPackageValueCheck(
        'mac-package-version',
        'Packaged Electron app metadata uses the production release version.',
        appAsarPath,
        appAsarPackageJson,
        'version',
        version,
      ))
    }

    const cliRuntimePath = appResourcePath(appPath, 'dist', 'claude-local')
    checks.push(fileExistsCheck(
      'mac-cli-runtime',
      'Packaged macOS app contains the Claude CLI runtime.',
      cliRuntimePath,
      'Ensure desktop/scripts/build-desktop.mjs builds dist/claude-local and electron-builder extraResources copies it into the app.',
      exists,
    ))
    if (exists(cliRuntimePath)) {
      checks.push(fileExecutableCheck(
        'mac-cli-runtime-executable',
        'Packaged Claude CLI runtime is executable.',
        cliRuntimePath,
        stat,
        'Ensure desktop/scripts/build-desktop.mjs preserves executable permissions for dist/claude-local before packaging.',
      ))
    }
    checks.push(fileExistsCheck(
      'mac-node-pty-native',
      'Packaged macOS app contains the node-pty native module.',
      appResourcePath(appPath, 'node_modules', 'node-pty', 'prebuilds', `darwin-${arch}`, 'pty.node'),
      'Ensure electron-builder extraResources includes node_modules/node-pty/prebuilds for the release architecture.',
      exists,
    ))
    const nodePtyHelperPath = appResourcePath(appPath, 'node_modules', 'node-pty', 'prebuilds', `darwin-${arch}`, 'spawn-helper')
    checks.push(fileExistsCheck(
      'mac-node-pty-helper',
      'Packaged macOS app contains the node-pty spawn helper.',
      nodePtyHelperPath,
      'Ensure electron-builder extraResources includes node_modules/node-pty/prebuilds for the release architecture.',
      exists,
    ))
    if (exists(nodePtyHelperPath)) {
      checks.push(fileExecutableCheck(
        'mac-node-pty-helper-executable',
        'Packaged node-pty spawn helper is executable.',
        nodePtyHelperPath,
        stat,
        'Ensure electron-builder extraResources preserves executable permissions for node-pty spawn-helper.',
      ))
    }
    const plistPath = appInfoPlistPath(appPath)
    checks.push(plistValueCheck(
      'mac-bundle-id',
      'Packaged macOS app has the production bundle identifier.',
      plistPath,
      'CFBundleIdentifier',
      appId,
      run,
    ))
    checks.push(plistValueCheck(
      'mac-short-version',
      'Packaged macOS app has the production short version.',
      plistPath,
      'CFBundleShortVersionString',
      version,
      run,
    ))
    checks.push(plistValueCheck(
      'mac-build-version',
      'Packaged macOS app has the production build version.',
      plistPath,
      'CFBundleVersion',
      version,
      run,
    ))
  }

  if (!exists(appPath) || !dmgPath || !exists(dmgPath)) {
    if (canReadReleaseEvidence) {
      checks.push(releaseEvidenceVerificationChecksCheck(
        releaseEvidence,
        releaseEvidencePath,
        checks,
      ))
    }
    return checks
  }

  const appCodesignCheck = codesignIdentityCheck(
    'mac-app-codesign',
    'macOS app has a valid Developer ID Application code signature.',
    appPath,
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    run,
  )
  checks.push(appCodesignCheck)
  checks.push(commandCheck(
    'mac-app-gatekeeper',
    'macOS app passes Gatekeeper assessment.',
    'spctl',
    ['--assess', '--type', 'execute', '--verbose', appPath],
    run,
  ))
  checks.push(commandCheck(
    'mac-app-notarization',
    'macOS app has a stapled notarization ticket.',
    'xcrun',
    ['stapler', 'validate', appPath],
    run,
  ))
  const dmgCodesignCheck = codesignIdentityCheck(
    'mac-dmg-codesign',
    'macOS DMG has a valid Developer ID Application code signature.',
    dmgPath,
    ['--verify', '--verbose=2', dmgPath],
    run,
  )
  checks.push(dmgCodesignCheck)
  checks.push(codesignConsistencyCheck(appCodesignCheck, dmgCodesignCheck))
  checks.push(commandCheck(
    'mac-dmg-gatekeeper',
    'macOS DMG passes Gatekeeper assessment.',
    'spctl',
    ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose', dmgPath],
    run,
  ))
  checks.push(commandCheck(
    'mac-dmg-notarization',
    'macOS DMG has a stapled notarization ticket.',
    'xcrun',
    ['stapler', 'validate', dmgPath],
    run,
  ))

  if (canReadReleaseEvidence) {
    checks.push(releaseEvidenceVerificationChecksCheck(
      releaseEvidence,
      releaseEvidencePath,
      checks,
    ))
  }

  return checks
}

function main() {
  const checks = verifyMacReleaseArtifacts()
  const failures = checks.filter(check => check.status === 'fail')
  for (const check of checks) {
    const marker = check.status === 'pass' ? 'PASS' : 'FAIL'
    console.log(`${marker} ${check.id}: ${check.message}`)
    console.log(`  evidence: ${check.evidence}`)
    if (check.nextAction) console.log(`  next: ${check.nextAction}`)
  }
  console.log('')
  console.log(`${checks.length - failures.length}/${checks.length} release artifact checks passed.`)
  if (failures.length > 0) {
    console.log('Production artifact verification is blocked.')
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
