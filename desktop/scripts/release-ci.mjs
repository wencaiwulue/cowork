import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { TextDecoder } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { basename, dirname, join } from 'node:path'
import {
  discoverMacReleaseArtifacts,
  verifyMacReleaseArtifacts,
} from './verify-release-artifacts.mjs'
import {
  summarizeUxValidationEvidenceContents,
  validateUxValidationEvidenceFile,
} from './ux-validation-evidence.mjs'
import {
  extractSmokeSummaryFromOutput,
  missingSmokeSummaryFlags,
  summarizeSmokeSummary,
} from './smoke-evidence.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const defaultEvidencePath = join(root, 'desktop/release/release-evidence.json')
const uxScreenshotDir = join(root, 'desktop/release/ux-screenshots')
const defaultReleaseNotesEvidencePath = join(root, 'desktop/release/release-notes-evidence.md')
const defaultUxValidationEvidencePath = join(root, 'desktop/release/ux-validation-evidence.md')
const defaultPackageJsonPath = join(root, 'package.json')
const defaultLockfilePath = join(root, 'bun.lock')
const defaultReleaseToolingPaths = {
  releaseCi: join(root, 'desktop/scripts/release-ci.mjs'),
  releaseVerifier: join(root, 'desktop/scripts/verify-release-artifacts.mjs'),
  releaseWorkflow: join(root, '.github/workflows/desktop-release.yml'),
}
const releaseNotesEvidenceDetailCheckIds = new Set([
  'mac-app-codesign',
  'mac-app-gatekeeper',
  'mac-app-notarization',
  'mac-dmg-codesign',
  'mac-dmg-gatekeeper',
  'mac-dmg-notarization',
])

function configuredEnvValue(value) {
  if (!value?.trim()) return false
  return !/(^example$|example\.com|not-a-secret|placeholder|changeme|TEAMID1234|Developer ID Application: Example)/i.test(value)
}

function hasConfiguredAny(env, names) {
  return names.some(name => configuredEnvValue(env[name]))
}

export function isDeveloperIdApplicationIdentity(value) {
  const identity = value?.trim() ?? ''
  return configuredEnvValue(identity) &&
    /^Developer ID Application:\s+.+\s+\([A-Z0-9]{10}\)$/i.test(identity)
}

function hasDeveloperIdApplicationSigningIdentity(env) {
  if (configuredEnvValue(env.CSC_LINK)) return true
  const cscName = env.CSC_NAME?.trim() ?? ''
  return isDeveloperIdApplicationIdentity(cscName)
}

function signingCredentialFailures(env) {
  if (configuredEnvValue(env.CSC_LINK)) {
    const failures = []
    if (!pathLikeSecret(env.CSC_LINK) && !isValidInlineBase64Secret(env.CSC_LINK)) {
      failures.push('Inline CSC_LINK must be valid base64 for a Developer ID Application certificate bundle, or a path to an existing certificate file.')
    } else if (!pathLikeSecret(env.CSC_LINK) && isPlaceholderInlineCertificateBundle(env.CSC_LINK)) {
      failures.push('Inline CSC_LINK must be a real Developer ID Application certificate bundle, not base64-encoded placeholder text.')
    } else if (!pathLikeSecret(env.CSC_LINK) && !isPlausibleInlineCertificateBundle(env.CSC_LINK)) {
      failures.push('Inline CSC_LINK must be a complete PKCS#12 certificate bundle, not a truncated base64 fragment.')
    }
    if (!configuredEnvValue(env.CSC_KEY_PASSWORD)) {
      failures.push('CSC_KEY_PASSWORD must be set when CSC_LINK is used for the Developer ID Application certificate.')
    }
    return failures
  }

  const cscName = env.CSC_NAME?.trim() ?? ''
  if (isDeveloperIdApplicationIdentity(cscName)) {
    return []
  }
  if (configuredEnvValue(cscName) && /^Developer ID Application:/i.test(cscName)) {
    return ['CSC_NAME must be a Developer ID Application identity with a 10-character Team ID, for example: Developer ID Application: Example Corp (ABCDE12345).']
  }

  return ['CSC_LINK or CSC_NAME must identify a Developer ID Application signing certificate.']
}

function pathLikeSecret(value) {
  const trimmed = value?.trim() ?? ''
  return trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('~')
}

export function isValidInlineBase64Secret(value) {
  const compact = String(value ?? '').replace(/\s+/g, '')
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return false
  }
  const decoded = Buffer.from(compact, 'base64')
  if (decoded.length === 0) return false
  const normalized = decoded.toString('base64')
  return normalized.replace(/=+$/, '') === compact.replace(/=+$/, '')
}

export function isPlaceholderInlineCertificateBundle(value) {
  if (!isValidInlineBase64Secret(value)) return false
  const decoded = Buffer.from(String(value ?? '').replace(/\s+/g, ''), 'base64')
  const text = decoded.toString('utf8').trim()
  if (!text || text.includes('\uFFFD')) return false
  if (!/^[\x09\x0a\x0d\x20-\x7e]+$/.test(text)) return false
  return /(developer[-_ ]?id|certificate|p(?:kcs)?c?12|placeholder|example|not[-_ ]?a[-_ ]?secret)/i.test(text)
}

export function isPlausibleInlineCertificateBundle(value) {
  if (!isValidInlineBase64Secret(value)) return false
  const decoded = Buffer.from(String(value ?? '').replace(/\s+/g, ''), 'base64')
  return decoded.length >= 512 && decoded[0] === 0x30
}

function secretPath(value) {
  const trimmed = value.trim()
  if (trimmed === '~') {
    return homedir()
  }
  if (trimmed.startsWith('~/')) {
    return join(homedir(), trimmed.slice(2))
  }
  return trimmed
}

function secretSource(value) {
  return pathLikeSecret(value) ? 'path' : 'inline'
}

function signingBundleOpenFailures(env, run, exists) {
  if (!configuredEnvValue(env.CSC_LINK) || !configuredEnvValue(env.CSC_KEY_PASSWORD)) {
    return []
  }

  const args = ['pkcs12', '-info', '-noout', '-passin', 'env:CSC_KEY_PASSWORD']
  const options = {
    encoding: 'utf8',
    shell: false,
    env: {
      ...process.env,
      CSC_KEY_PASSWORD: env.CSC_KEY_PASSWORD,
    },
  }

  if (pathLikeSecret(env.CSC_LINK)) {
    const certificatePath = secretPath(env.CSC_LINK)
    if (!exists(certificatePath)) return []
    args.push('-in', certificatePath)
  } else {
    if (!isValidInlineBase64Secret(env.CSC_LINK)) return []
    options.input = Buffer.from(String(env.CSC_LINK).replace(/\s+/g, ''), 'base64')
  }

  const result = run('openssl', args, options)
  return result.status === 0
    ? []
    : ['CSC_LINK certificate bundle could not be opened with CSC_KEY_PASSWORD on the release runner.']
}

function appleApiKeyOpenFailures(env, run, exists) {
  if (notarizationCredentialStrategy(env) !== 'api-key') return []

  const args = ['pkey', '-noout']
  const options = {
    encoding: 'utf8',
    shell: false,
  }

  if (pathLikeSecret(env.APPLE_API_KEY)) {
    const keyPath = secretPath(env.APPLE_API_KEY)
    if (!exists(keyPath)) return []
    args.push('-in', keyPath)
  } else {
    if (!inlineAppleApiKeySecret(env.APPLE_API_KEY)) return []
    options.input = env.APPLE_API_KEY
  }

  const result = run('openssl', args, options)
  return result.status === 0
    ? []
    : ['APPLE_API_KEY private key could not be opened on the release runner.']
}

function inlineAppleApiKeySecret(value) {
  const text = String(value ?? '').trim()
  return /-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(text)
}

function validAppleApiKeySecret(value) {
  return configuredEnvValue(value) &&
    (pathLikeSecret(value) || inlineAppleApiKeySecret(value))
}

function validAppleApiKeyId(value) {
  return /^[A-Z0-9]{10}$/.test(String(value ?? '').trim())
}

function validAppleApiIssuer(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? '').trim())
}

function validAppleId(value) {
  return configuredEnvValue(value) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim())
}

function validAppleTeamId(value) {
  return /^[A-Z0-9]{10}$/.test(String(value ?? '').trim())
}

function validKeychainProfile(value) {
  return configuredEnvValue(value) &&
    /^[A-Za-z0-9._-]+$/.test(String(value ?? '').trim())
}

function validOptionalKeychainPath(value) {
  return !value || pathLikeSecret(value)
}

function appStoreConnectCredentialFailures(env) {
  if (!hasConfiguredAny(env, ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'])) {
    return []
  }

  const failures = []
  if (!validAppleApiKeySecret(env.APPLE_API_KEY)) {
    failures.push('APPLE_API_KEY must be a local .p8 path or inline private key PEM.')
  }
  if (!validAppleApiKeyId(env.APPLE_API_KEY_ID)) {
    failures.push('APPLE_API_KEY_ID must be a 10-character App Store Connect key ID.')
  }
  if (!validAppleApiIssuer(env.APPLE_API_ISSUER)) {
    failures.push('APPLE_API_ISSUER must be an App Store Connect issuer UUID.')
  }
  return failures
}

function appleIdCredentialFailures(env) {
  if (!hasConfiguredAny(env, ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_ID_PASSWORD', 'APPLE_TEAM_ID'])) {
    return []
  }

  const failures = []
  if (!validAppleId(env.APPLE_ID)) {
    failures.push('APPLE_ID must be an email address for Apple ID notarization.')
  }
  if (!hasConfiguredAny(env, ['APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_ID_PASSWORD'])) {
    failures.push('APPLE_APP_SPECIFIC_PASSWORD or APPLE_ID_PASSWORD must be set for Apple ID notarization.')
  }
  if (!validAppleTeamId(env.APPLE_TEAM_ID)) {
    failures.push('APPLE_TEAM_ID must be a 10-character Apple Team ID.')
  }
  return failures
}

function keychainProfileCredentialFailures(env) {
  if (!hasConfiguredAny(env, ['APPLE_KEYCHAIN_PROFILE', 'APPLE_KEYCHAIN'])) {
    return []
  }

  const failures = []
  if (!validKeychainProfile(env.APPLE_KEYCHAIN_PROFILE)) {
    failures.push('APPLE_KEYCHAIN_PROFILE must be a keychain profile name, not a path or shell fragment.')
  }
  if (!validOptionalKeychainPath(env.APPLE_KEYCHAIN)) {
    failures.push('APPLE_KEYCHAIN must be a local keychain path when provided.')
  }
  return failures
}

function signingCredentialMetadata(env) {
  if (configuredEnvValue(env.CSC_LINK)) {
    return {
      strategy: 'csc-link',
      source: secretSource(env.CSC_LINK),
    }
  }
  if (configuredEnvValue(env.CSC_NAME)) {
    return {
      strategy: 'csc-name',
      source: 'keychain',
    }
  }
  return {
    strategy: '<missing>',
    source: '<missing>',
  }
}

function notarizationCredentialMetadata(env) {
  const strategy = notarizationCredentialStrategy(env)
  if (strategy === 'api-key') {
    return {
      strategy,
      source: secretSource(env.APPLE_API_KEY),
    }
  }
  if (strategy === 'apple-id') {
    return {
      strategy,
      source: 'account',
    }
  }
  if (strategy === 'keychain-profile') {
    return {
      strategy,
      source: env.APPLE_KEYCHAIN ? 'keychain' : 'default-keychain',
    }
  }
  return {
    strategy: '<missing>',
    source: '<missing>',
  }
}

function requiredReleaseToolFailures(run) {
  const requiredTools = [
    {
      command: 'bun',
      args: ['--version'],
      failure: 'bun must be available on the release runner before running desktop:release-ci.',
    },
    {
      command: 'npx',
      args: ['--no-install', 'electron-builder', '--version'],
      failure: 'electron-builder must be installed in node_modules before running desktop:release-ci.',
    },
    {
      command: 'npx',
      args: ['--no-install', 'asar', '--version'],
      failure: '@electron/asar must be installed in node_modules before running desktop:release-ci.',
    },
  ]

  return requiredTools.flatMap(tool => {
    const result = run(tool.command, tool.args, {
      encoding: 'utf8',
      shell: false,
    })
    return result.status === 0 ? [] : [tool.failure]
  })
}

function trackedSourceFailures(run) {
  const unstagedResult = run('git', ['diff', '--quiet', '--ignore-submodules', '--'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  })
  const stagedResult = run('git', ['diff', '--cached', '--quiet', '--ignore-submodules', '--'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  })
  return [
    ...(unstagedResult.status === 0
      ? []
      : ['Release source tree has tracked file changes. Commit or discard tracked changes before running desktop:release-ci.']),
    ...(stagedResult.status === 0
      ? []
      : ['Release source tree has staged file changes. Commit or unstage tracked changes before running desktop:release-ci.']),
  ]
}

export function notarizationCredentialStrategy(env = process.env) {
  const strategies = notarizationCredentialStrategies(env)
  return strategies.length === 1 ? strategies[0] : undefined
}

function notarizationCredentialStrategies(env = process.env) {
  return [
    validAppleApiKeySecret(env.APPLE_API_KEY) &&
      validAppleApiKeyId(env.APPLE_API_KEY_ID) &&
      validAppleApiIssuer(env.APPLE_API_ISSUER)
      ? 'api-key'
      : undefined,
    validAppleId(env.APPLE_ID) &&
      hasConfiguredAny(env, ['APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_ID_PASSWORD']) &&
      validAppleTeamId(env.APPLE_TEAM_ID)
      ? 'apple-id'
      : undefined,
    validKeychainProfile(env.APPLE_KEYCHAIN_PROFILE) &&
      validOptionalKeychainPath(env.APPLE_KEYCHAIN)
      ? 'keychain-profile'
      : undefined,
  ].filter(Boolean)
}

export function validateReleaseEnvironment(env = process.env, options = {}) {
  const failures = []
  const releaseVersion = env.DESKTOP_RELEASE_VERSION?.trim() ?? ''
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(releaseVersion) || /local/i.test(releaseVersion)) {
    failures.push('DESKTOP_RELEASE_VERSION must be set to a semver production version.')
  }
  failures.push(...signingCredentialFailures(env))
  const notarizationStrategies = notarizationCredentialStrategies(env)
  const appStoreConnectFailures = notarizationStrategies.includes('api-key')
    ? []
    : appStoreConnectCredentialFailures(env)
  const appleIdFailures = notarizationStrategies.includes('apple-id')
    ? []
    : appleIdCredentialFailures(env)
  const keychainProfileFailures = notarizationStrategies.includes('keychain-profile')
    ? []
    : keychainProfileCredentialFailures(env)
  const notarizationCredentialFailures = [
    ...appStoreConnectFailures,
    ...appleIdFailures,
    ...keychainProfileFailures,
  ]
  if (notarizationStrategies.length === 0) {
    failures.push(...(notarizationCredentialFailures.length > 0
      ? notarizationCredentialFailures
      : ['Configure one macOS notarization credential strategy: APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD/APPLE_ID_PASSWORD + APPLE_TEAM_ID, or APPLE_KEYCHAIN_PROFILE with optional APPLE_KEYCHAIN.']))
  } else if (notarizationStrategies.length > 1) {
    failures.push(`Configure exactly one macOS notarization credential strategy; found ${notarizationStrategies.join(' and ')}.`)
  } else {
    failures.push(...notarizationCredentialFailures)
  }
  const uxValidationEvidence = uxValidationEvidenceFromReleaseEnv(env, options)
  if (uxValidationEvidence.error) {
    failures.push(uxValidationEvidence.error)
  }
  return failures
}

export function validateReleaseMachine(options = {}) {
  const {
    platform = process.platform,
    run = spawnSync,
    env = process.env,
    exists = existsSync,
  } = options
  const failures = []

  if (platform !== 'darwin') {
    failures.push('Desktop release CI must run on macOS so signing, notarization, Gatekeeper, and stapler checks are available.')
    return failures
  }

  const notarytool = run('xcrun', ['--find', 'notarytool'], {
    encoding: 'utf8',
    shell: false,
  })
  if (notarytool.status !== 0) {
    failures.push('xcrun notarytool must be available on the release runner. Install Xcode command line tools and accept the Xcode license before running desktop:release-ci.')
  }

  failures.push(...requiredReleaseToolFailures(run))
  failures.push(...trackedSourceFailures(run))

  if (configuredEnvValue(env.CSC_LINK) && pathLikeSecret(env.CSC_LINK) && !exists(secretPath(env.CSC_LINK))) {
    failures.push(`CSC_LINK file was not found on the release runner: ${env.CSC_LINK.trim()}`)
  }
  failures.push(...signingBundleOpenFailures(env, run, exists))

  if (
    notarizationCredentialStrategy(env) === 'api-key' &&
    pathLikeSecret(env.APPLE_API_KEY) &&
    !exists(secretPath(env.APPLE_API_KEY))
  ) {
    failures.push(`APPLE_API_KEY file was not found on the release runner: ${env.APPLE_API_KEY.trim()}`)
  }
  failures.push(...appleApiKeyOpenFailures(env, run, exists))

  if (!configuredEnvValue(env.CSC_LINK) && configuredEnvValue(env.CSC_NAME)) {
    const identity = env.CSC_NAME.trim()
    const identities = run('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
      shell: false,
    })
    const output = `${identities.stdout ?? ''}\n${identities.stderr ?? ''}`
    if (identities.status !== 0 || !output.includes(identity)) {
      failures.push(`CSC_NAME identity was not found in the release runner keychain: ${identity}`)
    }
  }

  return failures
}

export function releasePipelineSteps() {
  const smokeEnv = { DESKTOP_SMOKE_PROGRESS: '1' }
  const packagedSmokeEnv = {
    ...smokeEnv,
    DESKTOP_SMOKE_SCREENSHOT_DIR: uxScreenshotDir,
  }
  return [
    { id: 'source-check', command: 'bun', args: ['run', 'check'] },
    { id: 'desktop-check', command: 'bun', args: ['run', 'desktop:check'] },
    { id: 'desktop-test', command: 'bun', args: ['run', 'desktop:test'] },
    { id: 'smoke-electron', command: 'bun', args: ['run', 'desktop:smoke-electron'], env: smokeEnv },
    { id: 'prod-check', command: 'bun', args: ['run', 'desktop:prod-check'] },
    { id: 'desktop-build', command: 'bun', args: ['run', 'desktop:build'] },
    { id: 'smoke-packaged', command: 'node', args: ['desktop/scripts/smoke-packaged.mjs'], env: packagedSmokeEnv },
    {
      id: 'verify-release',
      command: 'bun',
      args: ['run', 'desktop:verify-release'],
      env: { DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_VERIFY_STEP: '1' },
    },
    {
      id: 'final-verify-release',
      command: 'bun',
      args: ['run', 'desktop:verify-release'],
      env: { DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_FINAL_VERIFY_STEP: '1' },
    },
  ]
}

function preflightRecord(id, phase, failures, now) {
  const startedAt = now()
  const endedAt = now()
  return {
    id,
    command: 'node',
    args: ['desktop/scripts/release-ci.mjs', `preflight:${phase}`],
    status: failures.length > 0 ? 'fail' : 'pass',
    exitCode: failures.length > 0 ? 1 : 0,
    startedAt,
    endedAt,
    durationMs: 0,
    ...(failures.length > 0 ? { failures } : {}),
  }
}

function decodeBase64Utf8(value) {
  const compact = String(value ?? '').replace(/\s+/g, '')
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return undefined
  }
  const decoded = Buffer.from(compact, 'base64')
  const normalized = decoded.toString('base64')
  if (normalized.replace(/=+$/, '') !== compact.replace(/=+$/, '')) {
    return undefined
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(decoded)
  } catch {
    return undefined
  }
}

function decodeBufferUtf8(value) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value))
  } catch {
    return undefined
  }
}

function uxValidationEvidenceFromReleaseEnv(env, options = {}) {
  const {
    readFile = readFileSync,
  } = options

  if (configuredEnvValue(env.DESKTOP_UX_VALIDATION_EVIDENCE_BASE64)) {
    const contents = decodeBase64Utf8(env.DESKTOP_UX_VALIDATION_EVIDENCE_BASE64)
    return contents === undefined
      ? {
        error: 'DESKTOP_UX_VALIDATION_EVIDENCE_BASE64 must be valid base64-encoded UTF-8 markdown.',
      }
      : {
        contents,
        source: 'DESKTOP_UX_VALIDATION_EVIDENCE_BASE64',
      }
  }

  if (configuredEnvValue(env.DESKTOP_UX_VALIDATION_EVIDENCE_PATH)) {
    const evidencePath = secretPath(env.DESKTOP_UX_VALIDATION_EVIDENCE_PATH)
    try {
      const contents = decodeBufferUtf8(readFile(evidencePath))
      return contents === undefined
        ? {
          error: `DESKTOP_UX_VALIDATION_EVIDENCE_PATH must point to UTF-8 markdown: ${evidencePath}`,
        }
        : {
          contents,
          source: 'DESKTOP_UX_VALIDATION_EVIDENCE_PATH',
          path: evidencePath,
        }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        error: `DESKTOP_UX_VALIDATION_EVIDENCE_PATH could not be read: ${evidencePath}; ${detail}`,
      }
    }
  }

  return {
    error: 'DESKTOP_UX_VALIDATION_EVIDENCE_BASE64 or DESKTOP_UX_VALIDATION_EVIDENCE_PATH must provide the completed UX validation evidence.',
  }
}

function materializeUxValidationEvidence(options = {}) {
  const {
    env = process.env,
    outputPath = defaultUxValidationEvidencePath,
    mkdir = mkdirSync,
    writeFile = writeFileSync,
    readFile = readFileSync,
  } = options
  const evidence = uxValidationEvidenceFromReleaseEnv(env, { readFile })
  if (evidence.error) {
    return [evidence.error]
  }
  mkdir(dirname(outputPath), { recursive: true })
  writeFile(outputPath, evidence.contents, 'utf8')
  return []
}

export function releasePreflightRecords(options = {}) {
  const {
    env = process.env,
    machineOptions = {},
    uxValidationOptions = {},
    commit = currentGitCommit(),
    now = () => new Date().toISOString(),
  } = options
  const releaseVersion = env.DESKTOP_RELEASE_VERSION?.trim() ?? ''
  const expectedUxValidationOptions = {
    ...uxValidationOptions,
    ...(releaseVersion ? { expectedVersion: releaseVersion } : {}),
    ...(commit ? { expectedCommit: commit } : {}),
  }

  const envFailures = validateReleaseEnvironment(env, expectedUxValidationOptions)
  const envRecord = preflightRecord('release-env', 'environment', envFailures, now)
  if (envFailures.length > 0) {
    return [envRecord]
  }

  const uxValidationFailures = [
    ...materializeUxValidationEvidence({
      ...expectedUxValidationOptions,
      env,
    }),
  ]
  if (uxValidationFailures.length === 0) {
    uxValidationFailures.push(...validateUxValidationEvidenceFile(expectedUxValidationOptions))
  }
  const uxValidationRecord = preflightRecord('release-ux-validation', 'ux-validation', uxValidationFailures, now)
  if (uxValidationFailures.length > 0) {
    return [
      envRecord,
      uxValidationRecord,
    ]
  }

  const machineFailures = validateReleaseMachine({
    ...machineOptions,
    env: machineOptions.env ?? env,
  })
  const machineRecord = preflightRecord('release-machine', 'runner', machineFailures, now)
  if (machineFailures.length > 0) {
    return [
      envRecord,
      uxValidationRecord,
      machineRecord,
    ]
  }

  return [
    envRecord,
    uxValidationRecord,
    machineRecord,
  ]
}

export function releasePreflightRecordsForPhase(phase, options = {}) {
  const records = releasePreflightRecords(options)
  if (phase === 'all') {
    return records
  }
  if (phase === 'environment') {
    return records.slice(0, 1)
  }
  if (phase === 'ux-validation') {
    return records.slice(0, Math.min(records.length, 2))
  }
  if (phase === 'runner') {
    return records
  }
  throw new Error(`Unknown release preflight phase: ${phase}`)
}

export function releasePreflightFailureHeading(record) {
  if (record?.id === 'release-env') {
    return 'Desktop release environment is incomplete:'
  }
  if (record?.id === 'release-ux-validation') {
    return 'Desktop UX validation evidence is incomplete:'
  }
  return 'Desktop release runner is not ready:'
}

function currentGitCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  return result.status === 0 ? result.stdout.trim() : '<unknown>'
}

export function describeReleaseArtifact(path, options = {}) {
  const {
    stat = statSync,
    readFile = readFileSync,
  } = options

  try {
    const info = stat(path)
    if (!info.isFile()) {
      return {
        path,
        exists: true,
        type: info.isDirectory() ? 'directory' : 'other',
      }
    }
    const contents = readFile(path)
    return {
      path,
      exists: true,
      type: 'file',
      sizeBytes: info.size,
      sha256: createHash('sha256').update(contents).digest('hex'),
    }
  } catch {
    return {
      path,
      exists: false,
      type: 'missing',
    }
  }
}

export function describeReleaseArtifacts(artifacts, options = {}) {
  return Object.fromEntries(
    Object.entries(artifacts)
      .filter(([, path]) => typeof path === 'string' && path.length > 0)
      .map(([name, path]) => [name, describeReleaseArtifact(path, options)]),
  )
}

export function buildReleaseChecksumManifest(artifactDigests) {
  const lines = Object.entries(artifactDigests)
    .filter(([, artifact]) => artifact?.type === 'file' && artifact.sha256 && artifact.path)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([, artifact]) => `${artifact.sha256}  ${basename(artifact.path)}`)

  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

function describeChecksumManifest(artifactDigests, path) {
  const contents = buildReleaseChecksumManifest(artifactDigests)
  if (!contents) return undefined
  return {
    path,
    type: 'file',
    sizeBytes: Buffer.byteLength(contents),
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
}

function releaseEvidenceVerifyOptions(verifyOptions, checksumManifestPath, checksumManifestContents) {
  if (!checksumManifestContents) return verifyOptions
  const exists = verifyOptions.exists ?? existsSync
  const readFile = verifyOptions.readFile ?? readFileSync
  return {
    ...verifyOptions,
    exists: path => path === checksumManifestPath || exists(path),
    readFile: (path, ...args) => path === checksumManifestPath
      ? Buffer.from(checksumManifestContents)
      : readFile(path, ...args),
  }
}

function describeReleaseTextArtifact(path, contents) {
  return {
    path,
    type: 'file',
    sizeBytes: Buffer.byteLength(contents),
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
}

function describeUxValidationSummary(path, options = {}) {
  const readFile = options.readFile ?? readFileSync
  try {
    const summary = summarizeUxValidationEvidenceContents(readFile(path, 'utf8'))
    const entries = Object.entries(summary)
      .filter(([, value]) => String(value ?? '').trim())
    return entries.length > 0 ? Object.fromEntries(entries) : null
  } catch {
    return null
  }
}

function readPackageMetadata(path = defaultPackageJsonPath, readFile = readFileSync) {
  try {
    return JSON.parse(String(readFile(path, 'utf8')))
  } catch {
    return {}
  }
}

export function cleanReleaseOutputDirectory(options = {}) {
  const {
    releaseDir = dirname(defaultEvidencePath),
    exists = existsSync,
    readDir = readdirSync,
    stat = statSync,
    rm = rmSync,
  } = options

  if (!exists(releaseDir)) return []

  const removed = []
  const removableFiles = new Set([
    'release-evidence.json',
    'release-notes-evidence.md',
    'SHA256SUMS',
    'builder-debug.yml',
    'builder-effective-config.yaml',
  ])
  const removableDirectories = new Set([
    'ux-screenshots',
    'win-unpacked',
    'linux-unpacked',
  ])

  for (const entry of readDir(releaseDir)) {
    const path = join(releaseDir, entry)
    const info = stat(path)
    const shouldRemove =
      removableFiles.has(entry) ||
      entry.endsWith('.dmg') ||
      entry.endsWith('.zip') ||
      entry.endsWith('.blockmap') ||
      (info.isDirectory() && (entry.startsWith('mac-') || removableDirectories.has(entry)))

    if (!shouldRemove) continue
    rm(path, { recursive: info.isDirectory(), force: true })
    removed.push(path)
  }

  return removed
}

function describeReleaseToolchain(options = {}) {
  const {
    packageJson = readPackageMetadata(),
    lockfilePath = defaultLockfilePath,
    lockfileOptions = {},
  } = options

  return {
    packageManager: packageJson.packageManager ?? '<missing>',
    node: packageJson.engines?.node ?? '<missing>',
    lockfile: describeReleaseArtifact(lockfilePath, lockfileOptions),
  }
}

function describeReleaseTooling(options = {}) {
  const {
    paths = defaultReleaseToolingPaths,
    artifactOptions = {},
  } = options

  return Object.fromEntries(
    Object.entries(paths).map(([name, path]) => [
      name,
      describeReleaseArtifact(path, artifactOptions),
    ]),
  )
}

function describeUxScreenshots(path, options = {}) {
  const {
    exists = existsSync,
    readDir = readdirSync,
    stat = statSync,
    readFile = readFileSync,
  } = options

  if (!exists(path)) return []
  return readDir(path)
    .filter(entry => entry.endsWith('.png'))
    .sort()
    .map(entry => describeReleaseArtifact(join(path, entry), { stat, readFile }))
    .filter(screenshot => screenshot.type === 'file')
}

function summarizeArtifactVerificationChecks(checks) {
  return checks.map(check => ({
    id: check.id,
    status: check.status,
    message: check.message,
    evidence: check.evidence,
    ...(check.nextAction ? { nextAction: check.nextAction } : {}),
  }))
}

function releaseNotesEvidenceDetail(value) {
  const detail = String(value ?? '<missing>')
    .replace(/\s+/g, ' ')
    .trim()
    .replaceAll('`', "'")
  return detail || '<missing>'
}

function releaseNotesArtifactVerificationLines(checks) {
  return checks.flatMap(check => {
    const lines = [`- \`${check.id}\`: ${check.status} - ${check.message}`]
    if (releaseNotesEvidenceDetailCheckIds.has(check.id)) {
      lines.push(`  - Evidence: \`${releaseNotesEvidenceDetail(check.evidence)}\``)
    }
    return lines
  })
}

function releaseSourceMetadata(env, commit) {
  const repository = env.GITHUB_REPOSITORY?.trim()
  const refName = env.GITHUB_REF_NAME?.trim()
  const refType = env.GITHUB_REF_TYPE?.trim()
  const eventName = env.GITHUB_EVENT_NAME?.trim()
  const ciRunId = env.GITHUB_RUN_ID?.trim()
  const ciRunAttempt = env.GITHUB_RUN_ATTEMPT?.trim()
  const serverUrl = env.GITHUB_SERVER_URL?.trim() || 'https://github.com'
  const ciRunUrl = repository && ciRunId
    ? `${serverUrl}/${repository}/actions/runs/${ciRunId}${ciRunAttempt ? `/attempts/${ciRunAttempt}` : ''}`
    : undefined

  return {
    repository: repository || '<local>',
    refName: refName || '<local>',
    refType: refType || '<local>',
    eventName: eventName || '<local>',
    commit,
    ...(ciRunId ? { ciRunId } : {}),
    ...(ciRunAttempt ? { ciRunAttempt } : {}),
    ...(ciRunUrl ? { ciRunUrl } : {}),
  }
}

function releaseCredentialMetadata(env) {
  return {
    signing: signingCredentialMetadata(env),
    notarization: notarizationCredentialMetadata(env),
  }
}

export function buildReleaseNotesEvidence(evidence) {
  const fileArtifacts = Object.values(evidence.artifactDigests ?? {})
    .filter(artifact => artifact?.type === 'file' && artifact.path && artifact.sha256)
    .map(artifact => `- \`${basename(artifact.path)}\`: \`${artifact.sha256}\` (${artifact.sizeBytes ?? 0} bytes)`)
  const stepLines = (evidence.steps ?? [])
    .map(step => `- \`${step.id}\`: ${step.status} (${step.durationMs ?? 0} ms)`)
  const smokeSummary = (evidence.steps ?? []).find(step => step?.id === 'smoke-electron')?.smokeSummary
  const smokeSummaryLines = [
    ...(smokeSummary?.terminalMode ? [`- \`terminalMode\`: \`${smokeSummary.terminalMode}\``] : []),
    ...Object.entries(smokeSummary?.requiredFlags ?? {})
      .map(([flag, value]) => `- \`${flag}\`: \`${value}\``),
  ]
  const artifactVerificationLines = releaseNotesArtifactVerificationLines(evidence.artifactVerificationChecks ?? [])
  const screenshotLines = (evidence.uxScreenshots ?? [])
    .map(screenshot => `- \`${screenshot.path.replace(/^.*desktop\/release\//, '')}\`: \`${screenshot.sha256}\` (${screenshot.sizeBytes} bytes)`)
  const releaseToolingLines = Object.values(evidence.releaseTooling ?? {})
    .filter(tool => tool?.path && tool?.sha256)
    .map(tool => `- \`${tool.path.replace(`${root}/`, '')}\`: \`${tool.sha256}\` (${tool.sizeBytes ?? 0} bytes)`)
  const uxSummary = evidence.uxValidationSummary
  const uxValidationLines = uxSummary
    ? [
      `- Validator: \`${uxSummary.validator ?? '<missing>'}\``,
      `- Representative user: \`${uxSummary.representativeUser ?? '<missing>'}\``,
      `- Representative user validation: \`${uxSummary.representativeUserValidation ?? '<missing>'}\``,
      `- Known limitations accepted: \`${uxSummary.knownLimitationsAccepted ?? '<missing>'}\``,
      `- UX approval: \`${uxSummary.uxApprovalStatus ?? '<missing>'}\` by \`${uxSummary.uxApprovalApprover ?? '<missing>'}\` on \`${uxSummary.uxApprovalDate ?? '<missing>'}\``,
    ]
    : ['- `<missing>`']

  return [
    '# Claude Code Desktop Release Evidence Summary',
    '',
    `- Version: \`${evidence.releaseVersion}\``,
    `- Commit: \`${evidence.commit}\``,
    `- Generated at: \`${evidence.generatedAt}\``,
    `- Repository: \`${evidence.source?.repository ?? '<local>'}\``,
    `- Ref: \`${evidence.source?.refName ?? '<local>'}\``,
    `- Ref type: \`${evidence.source?.refType ?? '<local>'}\``,
    `- Event: \`${evidence.source?.eventName ?? '<local>'}\``,
    ...(evidence.source?.ciRunUrl ? [`- CI run: ${evidence.source.ciRunUrl}`] : []),
    ...(evidence.evidencePurpose ? [`- Evidence purpose: \`${evidence.evidencePurpose}\``] : []),
    `- Signing: \`${evidence.releaseCredentials?.signing?.strategy ?? '<missing>'}\` via \`${evidence.releaseCredentials?.signing?.source ?? '<missing>'}\``,
    `- Notarization: \`${evidence.releaseCredentials?.notarization?.strategy ?? '<missing>'}\` via \`${evidence.releaseCredentials?.notarization?.source ?? '<missing>'}\``,
    '- Release evidence: `release-evidence.json`',
    `- Checksum manifest: \`${evidence.checksumManifest?.path ? basename(evidence.checksumManifest.path) : '<none>'}\``,
    `- Toolchain: \`${evidence.toolchain?.packageManager ?? '<missing>'}\`, \`node@${evidence.toolchain?.node ?? '<missing>'}\``,
    `- Lockfile: \`${basename(evidence.toolchain?.lockfile?.path ?? 'bun.lock')}\` \`${evidence.toolchain?.lockfile?.sha256 ?? '<missing>'}\``,
    `- Release tooling: \`${releaseToolingLines.length}\` files`,
    `- UX validation: \`${basename(evidence.uxValidationEvidence?.path ?? 'ux-validation-evidence.md')}\` \`${evidence.uxValidationEvidence?.sha256 ?? '<missing>'}\``,
    `- UX screenshots: \`${(evidence.uxScreenshots ?? []).length}\``,
    '',
    '## Artifacts',
    '',
    ...(fileArtifacts.length > 0 ? fileArtifacts : ['- `<none>`']),
    '',
    '## Artifact Verification',
    '',
    ...(artifactVerificationLines.length > 0 ? artifactVerificationLines : ['- `<none>`']),
    '',
    '## Pipeline Steps',
    '',
    ...(stepLines.length > 0 ? stepLines : ['- `<none>`']),
    '',
    '## Smoke Summary',
    '',
    ...(smokeSummaryLines.length > 0 ? smokeSummaryLines : ['- `<none>`']),
    '',
    '## Release Tooling',
    '',
    ...(releaseToolingLines.length > 0 ? releaseToolingLines : ['- `<none>`']),
    '',
    '## UX Validation',
    '',
    ...uxValidationLines,
    '',
    '## UX Screenshots',
    '',
    ...(screenshotLines.length > 0 ? screenshotLines : ['- `<none>`']),
    '',
  ].join('\n')
}

export function buildReleaseEvidence(options = {}) {
  const {
    env = process.env,
    generatedAt = new Date().toISOString(),
    platform = process.platform,
    arch = process.arch,
    commit = currentGitCommit(),
    source = releaseSourceMetadata(env, commit),
    releaseCredentials = releaseCredentialMetadata(env),
    steps = [],
    artifacts = discoverMacReleaseArtifacts({ arch, version: env.DESKTOP_RELEASE_VERSION?.trim() }),
    artifactDigests = describeReleaseArtifacts(artifacts),
    verifyOptions = {},
    checksumManifestPath = join(dirname(artifacts.dmgPath ?? artifacts.zipPath ?? defaultEvidencePath), 'SHA256SUMS'),
    checksumManifestContents = buildReleaseChecksumManifest(artifactDigests),
    checksumManifest = describeChecksumManifest(artifactDigests, checksumManifestPath),
    artifactVerificationChecks = summarizeArtifactVerificationChecks(verifyMacReleaseArtifacts({
      ...releaseEvidenceVerifyOptions(verifyOptions, checksumManifestPath, checksumManifestContents),
      platform,
      arch,
      version: env.DESKTOP_RELEASE_VERSION?.trim(),
      skipReleaseEvidenceChecks: true,
    })),
    uxScreenshotsDir = uxScreenshotDir,
    uxScreenshotOptions = {},
    uxScreenshots = describeUxScreenshots(uxScreenshotsDir, uxScreenshotOptions),
    releaseNotesEvidencePath,
    toolchain = describeReleaseToolchain(),
    releaseTooling = describeReleaseTooling(),
    uxValidationEvidencePath = defaultUxValidationEvidencePath,
    uxValidationEvidenceOptions = {},
    uxValidationEvidence = describeReleaseArtifact(uxValidationEvidencePath, uxValidationEvidenceOptions),
    uxValidationSummary = describeUxValidationSummary(uxValidationEvidencePath, uxValidationEvidenceOptions),
    evidencePurpose,
  } = options

  const evidence = {
    schemaVersion: 1,
    product: 'Claude Code Desktop',
    releaseVersion: env.DESKTOP_RELEASE_VERSION?.trim() || '<missing>',
    commit,
    generatedAt,
    platform,
    arch,
    ...(evidencePurpose ? { evidencePurpose } : {}),
    source,
    releaseCredentials,
    toolchain,
    releaseTooling,
    artifacts,
    artifactDigests,
    ...(checksumManifest ? { checksumManifest } : {}),
    artifactVerificationChecks,
    uxValidationEvidence,
    ...(uxValidationSummary ? { uxValidationSummary } : {}),
    uxScreenshotsDir,
    ...(uxScreenshots.length > 0 ? { uxScreenshots } : {}),
    steps: steps.map(step => ({
      id: step.id,
      command: step.command,
      args: step.args,
      status: step.status,
      exitCode: step.exitCode,
      startedAt: step.startedAt,
      endedAt: step.endedAt,
      durationMs: step.durationMs,
      ...(step.env ? { env: step.env } : {}),
      ...(step.smokeSummary ? { smokeSummary: step.smokeSummary } : {}),
      ...(step.status !== 'pass' && Array.isArray(step.failures) && step.failures.length > 0 ? { failures: step.failures } : {}),
    })),
  }

  return releaseNotesEvidencePath
    ? {
      ...evidence,
      releaseNotesEvidence: describeReleaseTextArtifact(
        releaseNotesEvidencePath,
        buildReleaseNotesEvidence(evidence),
      ),
    }
    : evidence
}

function writeReleaseEvidence(steps, evidencePath = defaultEvidencePath, buildOptions = {}) {
  const notesPath = join(dirname(evidencePath), basename(defaultReleaseNotesEvidencePath))
  const evidence = buildReleaseEvidence({ steps, releaseNotesEvidencePath: notesPath, ...buildOptions })
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(
    evidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  )
  console.log(`Release evidence written to ${evidencePath}`)

  const checksumManifest = buildReleaseChecksumManifest(evidence.artifactDigests)
  const checksumPath = join(dirname(evidencePath), 'SHA256SUMS')
  if (checksumManifest) {
    writeFileSync(checksumPath, checksumManifest, 'utf8')
    console.log(`Release checksums written to ${checksumPath}`)
  } else if (existsSync(checksumPath)) {
    rmSync(checksumPath)
    console.log(`Stale release checksums removed from ${checksumPath}`)
  }

  writeFileSync(notesPath, buildReleaseNotesEvidence(evidence), 'utf8')
  console.log(`Release notes evidence written to ${notesPath}`)
}

function runStep(step) {
  console.log(`\n==> ${step.id}: ${step.command} ${step.args.join(' ')}`)
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const captureOutput = step.id === 'smoke-electron'
  const result = spawnSync(step.command, step.args, {
    cwd: root,
    env: { ...process.env, ...step.env },
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: captureOutput ? 'utf8' : undefined,
    maxBuffer: captureOutput ? 1024 * 1024 * 100 : undefined,
    shell: process.platform === 'win32',
  })
  if (captureOutput) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  }
  const endedAt = new Date().toISOString()
  const exitCode = result.status ?? 1
  const smokeSummary = captureOutput
    ? summarizeSmokeSummary(extractSmokeSummaryFromOutput(result.stdout ?? ''))
    : undefined
  const record = {
    ...step,
    status: exitCode === 0 ? 'pass' : 'fail',
    exitCode,
    startedAt,
    endedAt,
    durationMs: Date.now() - startedMs,
    ...(smokeSummary ? { smokeSummary } : {}),
  }
  if (exitCode !== 0) {
    const error = new Error(`Release step failed: ${step.id}`)
    error.exitCode = exitCode
    error.stepRecord = record
    throw error
  }
  if (captureOutput) {
    const missingFlags = missingSmokeSummaryFlags(smokeSummary)
    if (missingFlags.length > 0) {
      record.status = 'fail'
      record.exitCode = 1
      record.failures = [`Missing smoke summary flags: ${missingFlags.join(', ')}`]
      const error = new Error(`Release step failed: ${step.id}`)
      error.exitCode = 1
      error.stepRecord = record
      throw error
    }
  }
  return record
}

function writePreflightResult(records) {
  const failedPreflight = records.find(record => record.status === 'fail')
  const preflightBuildOptions = {
    evidencePurpose: 'preflight-only',
    artifacts: {},
    artifactDigests: {},
    artifactVerificationChecks: [],
    checksumManifest: null,
  }
  if (failedPreflight) {
    writeReleaseEvidence(records, undefined, preflightBuildOptions)
    console.error(releasePreflightFailureHeading(failedPreflight))
    for (const failure of failedPreflight.failures ?? []) console.error(`- ${failure}`)
    return 1
  }
  writeReleaseEvidence(records, undefined, preflightBuildOptions)
  return 0
}

function main(argv = process.argv.slice(2)) {
  cleanReleaseOutputDirectory()

  const preflightArg = argv.find(arg => String(arg).startsWith('preflight:'))
  if (preflightArg) {
    const phase = preflightArg.slice('preflight:'.length)
    process.exit(writePreflightResult(releasePreflightRecordsForPhase(phase)))
  }

  const records = releasePreflightRecords()
  const preflightExitCode = writePreflightResult(records)
  if (preflightExitCode !== 0) process.exit(preflightExitCode)

  try {
    for (const step of releasePipelineSteps()) {
      records.push(runStep(step))
      writeReleaseEvidence(records)
    }
  } catch (error) {
    if (error?.stepRecord) {
      records.push(error.stepRecord)
      writeReleaseEvidence(records)
    }
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(typeof error?.exitCode === 'number' ? error.exitCode : 1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
