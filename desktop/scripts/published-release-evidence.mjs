import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const productName = 'Claude Code Desktop'
const evidenceKind = 'published-release-verification'
const publicEvidenceKind = 'public-release-verification'
const releaseSourceFields = ['releaseVersion', 'repository', 'refName', 'refType', 'eventName', 'commit', 'ciRunId', 'ciRunAttempt', 'ciRunUrl']

function sha256File(path, readFile = readFileSync) {
  return createHash('sha256').update(readFile(path)).digest('hex')
}

function readJson(path, readFile = readFileSync) {
  return JSON.parse(String(readFile(path, 'utf8')))
}

function expectedReleaseTag(version) {
  return `desktop-v${version}`
}

function expectedReleaseName(version) {
  return `${productName} ${version}`
}

function expectedGitHubReleaseUrl(repository, releaseTag) {
  if (!repository || !releaseTag) return undefined
  return `https://github.com/${repository}/releases/tag/${releaseTag}`
}

function expectedSourceFromEnv(env = process.env) {
  return {
    releaseVersion: env.EXPECTED_RELEASE_VERSION,
    repository: env.EXPECTED_REPOSITORY,
    refName: env.EXPECTED_REF_NAME,
    refType: env.EXPECTED_REF_TYPE,
    eventName: env.EXPECTED_EVENT_NAME,
    commit: env.EXPECTED_COMMIT,
    ciRunId: env.EXPECTED_RUN_ID,
    ciRunAttempt: env.EXPECTED_RUN_ATTEMPT,
    ciRunUrl: env.EXPECTED_RUN_URL,
  }
}

function expectedSourceFromOptions(options = {}, env = process.env) {
  return {
    releaseVersion: options.expectedReleaseVersion || env.EXPECTED_RELEASE_VERSION,
    repository: options.expectedRepository || env.EXPECTED_REPOSITORY,
    refName: options.expectedRefName || env.EXPECTED_REF_NAME,
    refType: options.expectedRefType || env.EXPECTED_REF_TYPE,
    eventName: options.expectedEventName || env.EXPECTED_EVENT_NAME,
    commit: options.expectedCommit || env.EXPECTED_COMMIT,
    ciRunId: options.expectedRunId || env.EXPECTED_RUN_ID,
    ciRunAttempt: options.expectedRunAttempt || env.EXPECTED_RUN_ATTEMPT,
    ciRunUrl: options.expectedRunUrl || env.EXPECTED_RUN_URL,
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function requiredPublishedAssetChecks(version) {
  const escapedVersion = escapeRegExp(version)
  return {
    exactNames: [
      'SHA256SUMS',
      'release-evidence.json',
      'release-notes-evidence.md',
      'ux-validation-evidence.md',
      'ux-screenshots.zip',
    ],
    patterns: [
      {
        label: 'current-version DMG asset',
        pattern: new RegExp(`^Claude Code Desktop-${escapedVersion}-.+\\.dmg$`),
      },
      {
        label: 'current-version mac ZIP asset',
        pattern: new RegExp(`^Claude Code Desktop-${escapedVersion}-.+-mac\\.zip$`),
      },
    ],
  }
}

function requiredPublicAssetChecks(version) {
  const checks = requiredPublishedAssetChecks(version)
  return {
    exactNames: [
      ...checks.exactNames,
      'production-gate-evidence.json',
      'published-release-evidence.json',
    ],
    patterns: checks.patterns,
  }
}

function summarizeDownloadedAssets(downloadedDir, options = {}) {
  const {
    readDir = readdirSync,
    readFile = readFileSync,
    stat = statSync,
  } = options

  return readDir(downloadedDir)
    .sort()
    .map(name => {
      const path = join(downloadedDir, name)
      return {
        name,
        sizeBytes: stat(path).size,
        sha256: sha256File(path, readFile),
      }
    })
}

function requireOption(options, key) {
  const value = options[key]
  if (!value) {
    throw new Error(`Missing required option: ${key}`)
  }
  return value
}

function parseArgs(argv) {
  const [command, ...args] = argv
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`)
    }
    options[key] = value
    index += 1
  }
  return { command, options }
}

export function buildPublishedReleaseEvidence(options = {}) {
  const {
    release,
    downloadedDir,
    generatedAt = new Date().toISOString(),
    env = process.env,
    readDir = readdirSync,
    readFile = readFileSync,
    stat = statSync,
  } = options
  if (!release || typeof release !== 'object') {
    throw new Error('release metadata is required')
  }
  if (!downloadedDir) {
    throw new Error('downloadedDir is required')
  }

  const assets = summarizeDownloadedAssets(downloadedDir, { readDir, readFile, stat })

  return {
    schemaVersion: 1,
    product: productName,
    evidenceKind,
    generatedAt,
    releaseVersion: env.EXPECTED_RELEASE_VERSION,
    releaseTag: release.tagName,
    releaseName: release.name,
    releaseDatabaseId: release.databaseId,
    releaseUrl: release.url,
    repository: env.EXPECTED_REPOSITORY,
    refName: env.EXPECTED_REF_NAME,
    refType: env.EXPECTED_REF_TYPE,
    eventName: env.EXPECTED_EVENT_NAME,
    commit: env.EXPECTED_COMMIT,
    ciRunId: env.EXPECTED_RUN_ID,
    ciRunAttempt: env.EXPECTED_RUN_ATTEMPT,
    ciRunUrl: env.EXPECTED_RUN_URL,
    verifiedAssetCount: assets.length,
    verifiedAssets: assets,
  }
}

export function validatePublishedReleaseEvidence(evidence, expected = expectedSourceFromEnv()) {
  const failures = []
  const expectedVersion = String(expected.releaseVersion || '')
  if (evidence?.schemaVersion !== 1 || evidence?.product !== productName || evidence?.evidenceKind !== evidenceKind) {
    failures.push('published-release-evidence.json has invalid identity metadata')
  }
  if (
    evidence?.releaseVersion !== expectedVersion ||
    evidence?.releaseTag !== expectedReleaseTag(expectedVersion) ||
    evidence?.releaseName !== expectedReleaseName(expectedVersion)
  ) {
    failures.push('published-release-evidence.json has invalid release metadata')
  }
  if (!Number.isInteger(evidence?.releaseDatabaseId) || evidence.releaseDatabaseId <= 0) {
    failures.push('published-release-evidence.json has invalid GitHub Release database id')
  }
  if (
    typeof evidence?.releaseUrl !== 'string' ||
    evidence.releaseUrl !== expectedGitHubReleaseUrl(expected.repository, expectedReleaseTag(expectedVersion))
  ) {
    failures.push('published-release-evidence.json has invalid GitHub Release URL')
  }
  for (const field of ['repository', 'refName', 'refType', 'eventName', 'commit', 'ciRunId', 'ciRunAttempt', 'ciRunUrl']) {
    if (String(evidence?.[field] || '') !== String(expected[field] || '')) {
      failures.push(`published-release-evidence.json has invalid CI source metadata: ${field}`)
    }
  }
  if (Number.isNaN(Date.parse(evidence?.generatedAt))) {
    failures.push('published-release-evidence.json has invalid generatedAt metadata')
  }
  if (!Array.isArray(evidence?.verifiedAssets) || evidence?.verifiedAssetCount !== evidence?.verifiedAssets?.length || evidence.verifiedAssets.length < 7) {
    failures.push('published-release-evidence.json has invalid verified asset summary')
  }
  if (Array.isArray(evidence?.verifiedAssets)) {
    const assetNames = evidence.verifiedAssets.map(asset => asset?.name).filter(Boolean)
    const duplicateAssetNames = assetNames.filter((name, index) => assetNames.indexOf(name) !== index)
    if (duplicateAssetNames.length > 0) {
      failures.push(`published-release-evidence.json has duplicate verified asset names: ${[...new Set(duplicateAssetNames)].join(', ')}`)
    }
    if (expectedVersion) {
      const { exactNames, patterns } = requiredPublishedAssetChecks(expectedVersion)
      const expectedAssetNames = new Set(exactNames)
      for (const { pattern } of patterns) {
        for (const name of assetNames) {
          if (pattern.test(name)) {
            expectedAssetNames.add(name)
          }
        }
      }
      for (const assetName of exactNames) {
        if (!assetNames.includes(assetName)) {
          failures.push(`published-release-evidence.json is missing verified asset ${assetName}`)
        }
      }
      for (const { label, pattern } of patterns) {
        const matches = assetNames.filter(name => pattern.test(name))
        if (matches.length !== 1) {
          failures.push(`published-release-evidence.json expected exactly one verified ${label}, found ${matches.length}`)
        }
      }
      const unexpected = assetNames.filter(name => !expectedAssetNames.has(name))
      if (unexpected.length > 0) {
        failures.push(`published-release-evidence.json has unexpected verified assets: ${unexpected.join(', ')}`)
      }
    }
    for (const asset of evidence.verifiedAssets) {
      if (
        !asset ||
        typeof asset.name !== 'string' ||
        !asset.name ||
        !Number.isInteger(asset.sizeBytes) ||
        asset.sizeBytes <= 0 ||
        !/^[a-f0-9]{64}$/.test(String(asset.sha256 || ''))
      ) {
        failures.push('published-release-evidence.json has invalid verified asset metadata')
        break
      }
    }
  }
  return failures
}

export function compareReleaseEvidenceSource(left, leftLabel, right, rightLabel) {
  const failures = []
  for (const field of releaseSourceFields) {
    if (String(left?.[field] || '') !== String(right?.[field] || '')) {
      const metadataKind = field === 'releaseVersion' ? 'release metadata' : 'CI source metadata'
      failures.push(`${leftLabel} does not match ${rightLabel} ${metadataKind}: ${field}`)
    }
  }
  return failures
}

export function comparePublicReleaseEvidenceToPublishedReleaseEvidence(publicEvidence, publishedEvidence) {
  const failures = []
  for (const field of ['releaseVersion', 'releaseTag', 'releaseName', 'releaseDatabaseId', 'releaseUrl']) {
    if (String(publicEvidence?.[field] || '') !== String(publishedEvidence?.[field] || '')) {
      failures.push(`public-release-evidence.json does not match published-release-evidence.json release metadata: ${field}`)
    }
  }
  failures.push(...compareReleaseEvidenceSource(
    publicEvidence,
    'public-release-evidence.json',
    publishedEvidence,
    'published-release-evidence.json',
  ))
  const publicAssetsByName = new Map(
    (Array.isArray(publicEvidence?.publicAssets) ? publicEvidence.publicAssets : [])
      .map(asset => [asset?.name, asset])
      .filter(([name]) => typeof name === 'string' && name),
  )
  for (const publishedAsset of Array.isArray(publishedEvidence?.verifiedAssets) ? publishedEvidence.verifiedAssets : []) {
    if (!publishedAsset?.name) continue
    const publicAsset = publicAssetsByName.get(publishedAsset.name)
    if (!publicAsset) {
      failures.push(`public-release-evidence.json is missing published verified asset metadata: ${publishedAsset.name}`)
      continue
    }
    if (publicAsset.sizeBytes !== publishedAsset.sizeBytes) {
      failures.push(`public-release-evidence.json public asset size does not match published-release-evidence.json: ${publishedAsset.name}`)
    }
  }
  return failures
}

export function comparePublishedReleaseEvidenceToDownloadedAssets(evidence, downloadedDir, options = {}) {
  const failures = []
  const actualAssets = summarizeDownloadedAssets(downloadedDir, options)
  const expectedAssets = Array.isArray(evidence?.verifiedAssets) ? evidence.verifiedAssets : []
  const actualByName = new Map(actualAssets.map(asset => [asset.name, asset]))
  const expectedByName = new Map(expectedAssets.map(asset => [asset?.name, asset]))
  const expectedNames = [...expectedByName.keys()].filter(Boolean).sort()
  const actualNames = [...actualByName.keys()].sort()
  const missing = expectedNames.filter(name => !actualByName.has(name))
  const unexpected = actualNames.filter(name => !expectedByName.has(name))
  if (missing.length > 0 || unexpected.length > 0) {
    failures.push(`published-release-evidence.json verified assets do not match downloaded directory; missing=${missing.join(', ') || '<none>'}; unexpected=${unexpected.join(', ') || '<none>'}`)
  }
  for (const name of expectedNames) {
    const expectedAsset = expectedByName.get(name)
    const actualAsset = actualByName.get(name)
    if (!actualAsset) continue
    if (actualAsset.sizeBytes !== expectedAsset.sizeBytes) {
      failures.push(`${name} downloaded size ${actualAsset.sizeBytes} did not match published evidence size ${expectedAsset.sizeBytes}`)
    }
    if (actualAsset.sha256 !== expectedAsset.sha256) {
      failures.push(`${name} downloaded SHA-256 ${actualAsset.sha256} did not match published evidence SHA-256 ${expectedAsset.sha256}`)
    }
  }
  return failures
}

export function comparePublishedReleaseEvidenceFiles(localPath, downloadedPath, options = {}) {
  const {
    readFile = readFileSync,
    stat = statSync,
  } = options
  const localSize = stat(localPath).size
  const downloadedSize = stat(downloadedPath).size
  const failures = []
  if (localSize !== downloadedSize) {
    failures.push(`published-release-evidence.json downloaded size ${downloadedSize} did not match local size ${localSize}`)
  }
  const localSha256 = sha256File(localPath, readFile)
  const downloadedSha256 = sha256File(downloadedPath, readFile)
  if (localSha256 !== downloadedSha256) {
    failures.push(`published-release-evidence.json downloaded SHA-256 ${downloadedSha256} did not match local SHA-256 ${localSha256}`)
  }
  return failures
}

function sortedAssetNamesFromRelease(release) {
  return (Array.isArray(release?.assets) ? release.assets : [])
    .map(asset => asset?.name)
    .filter(Boolean)
    .sort()
}

function sortedPublicAssetsFromRelease(release) {
  return (Array.isArray(release?.assets) ? release.assets : [])
    .filter(asset => asset?.name)
    .map(asset => ({
      name: asset.name,
      sizeBytes: asset.size,
      url: asset.url,
      ...(asset.state ? { state: asset.state } : {}),
    }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}

function isExpectedGitHubReleaseAssetUrl(url, repository) {
  if (!repository || typeof repository !== 'string') return false
  try {
    const parsed = new URL(url)
    const expectedPrefix = `/repos/${repository}/releases/assets/`
    const assetId = parsed.pathname.slice(expectedPrefix.length)
    return parsed.protocol === 'https:' &&
      parsed.hostname === 'api.github.com' &&
      parsed.pathname.startsWith(expectedPrefix) &&
      parsed.search === '' &&
      parsed.hash === '' &&
      /^\d+$/.test(assetId)
  } catch {
    return false
  }
}

export function buildPublicReleaseEvidence(options = {}) {
  const {
    release,
    generatedAt = new Date().toISOString(),
    env = process.env,
  } = options
  if (!release || typeof release !== 'object') {
    throw new Error('release metadata is required')
  }

  return {
    schemaVersion: 1,
    product: productName,
    evidenceKind: publicEvidenceKind,
    generatedAt,
    releaseVersion: env.EXPECTED_RELEASE_VERSION,
    releaseTag: release.tagName,
    releaseName: release.name,
    releaseDatabaseId: release.databaseId,
    releaseUrl: release.url,
    isDraft: release.isDraft,
    isPrerelease: release.isPrerelease,
    assetCount: sortedAssetNamesFromRelease(release).length,
    assetNames: sortedAssetNamesFromRelease(release),
    publicAssets: sortedPublicAssetsFromRelease(release),
    repository: env.EXPECTED_REPOSITORY,
    refName: env.EXPECTED_REF_NAME,
    refType: env.EXPECTED_REF_TYPE,
    eventName: env.EXPECTED_EVENT_NAME,
    commit: env.EXPECTED_COMMIT,
    ciRunId: env.EXPECTED_RUN_ID,
    ciRunAttempt: env.EXPECTED_RUN_ATTEMPT,
    ciRunUrl: env.EXPECTED_RUN_URL,
  }
}

export function validatePublicReleaseEvidence(evidence, expected = expectedSourceFromOptions(), options = {}) {
  const failures = []
  const expectedVersion = String(expected.releaseVersion || '')
  if (evidence?.schemaVersion !== 1 || evidence?.product !== productName || evidence?.evidenceKind !== publicEvidenceKind) {
    failures.push('public-release-evidence.json has invalid identity metadata')
  }
  if (
    evidence?.releaseVersion !== expectedVersion ||
    evidence?.releaseTag !== expectedReleaseTag(expectedVersion) ||
    evidence?.releaseName !== expectedReleaseName(expectedVersion)
  ) {
    failures.push('public-release-evidence.json has invalid release metadata')
  }
  if (!Number.isInteger(evidence?.releaseDatabaseId) || evidence.releaseDatabaseId <= 0) {
    failures.push('public-release-evidence.json has invalid GitHub Release database id')
  }
  if (
    typeof evidence?.releaseUrl !== 'string' ||
    evidence.releaseUrl !== expectedGitHubReleaseUrl(expected.repository, expectedReleaseTag(expectedVersion))
  ) {
    failures.push('public-release-evidence.json has invalid GitHub Release URL')
  }
  if (evidence?.isDraft !== false || evidence?.isPrerelease !== false) {
    failures.push('public-release-evidence.json must prove the Release is public and not prerelease')
  }
  for (const field of ['repository', 'refName', 'refType', 'eventName', 'commit', 'ciRunId', 'ciRunAttempt', 'ciRunUrl']) {
    if (String(evidence?.[field] || '') !== String(expected[field] || '')) {
      failures.push(`public-release-evidence.json has invalid CI source metadata: ${field}`)
    }
  }
  if (Number.isNaN(Date.parse(evidence?.generatedAt))) {
    failures.push('public-release-evidence.json has invalid generatedAt metadata')
  }
  if (!Array.isArray(evidence?.assetNames) || evidence?.assetCount !== evidence?.assetNames?.length || evidence.assetNames.length < 8) {
    failures.push('public-release-evidence.json has invalid asset summary')
  }
  if (!Array.isArray(evidence?.publicAssets) || evidence?.assetCount !== evidence?.publicAssets?.length || evidence.publicAssets.length < 8) {
    failures.push('public-release-evidence.json has invalid public asset metadata')
  }
  if (Array.isArray(evidence?.assetNames)) {
    const assetNames = evidence.assetNames.filter(Boolean)
    const sortedAssetNames = [...assetNames].sort()
    if (assetNames.some((name, index) => name !== sortedAssetNames[index])) {
      failures.push('public-release-evidence.json asset names must be sorted')
    }
    const duplicateAssetNames = assetNames.filter((name, index) => assetNames.indexOf(name) !== index)
    if (duplicateAssetNames.length > 0) {
      failures.push(`public-release-evidence.json has duplicate asset names: ${[...new Set(duplicateAssetNames)].join(', ')}`)
    }
    if (expectedVersion) {
      const { exactNames, patterns } = requiredPublicAssetChecks(expectedVersion)
      const expectedAssetNames = new Set(exactNames)
      for (const { pattern } of patterns) {
        for (const name of assetNames) {
          if (pattern.test(name)) {
            expectedAssetNames.add(name)
          }
        }
      }
      for (const assetName of exactNames) {
        if (!assetNames.includes(assetName)) {
          failures.push(`public-release-evidence.json is missing asset ${assetName}`)
        }
      }
      for (const { label, pattern } of patterns) {
        const matches = assetNames.filter(name => pattern.test(name))
        if (matches.length !== 1) {
          failures.push(`public-release-evidence.json expected exactly one ${label}, found ${matches.length}`)
        }
      }
      const unexpected = assetNames.filter(name => !expectedAssetNames.has(name))
      if (unexpected.length > 0) {
        failures.push(`public-release-evidence.json has unexpected assets: ${unexpected.join(', ')}`)
      }
    }
  }
  if (Array.isArray(evidence?.assetNames) && Array.isArray(evidence?.publicAssets)) {
    const publicAssetNames = evidence.publicAssets.map(asset => asset?.name).filter(Boolean)
    const publicAssetUrls = evidence.publicAssets.map(asset => asset?.url).filter(Boolean)
    const assetNames = evidence.assetNames.filter(Boolean)
    if (publicAssetNames.length !== assetNames.length || publicAssetNames.some((name, index) => name !== assetNames[index])) {
      failures.push('public-release-evidence.json public asset metadata must match sorted asset names')
    }
    const duplicatePublicAssetUrls = publicAssetUrls.filter((url, index) => publicAssetUrls.indexOf(url) !== index)
    if (duplicatePublicAssetUrls.length > 0) {
      failures.push(`public-release-evidence.json has duplicate public asset URLs: ${[...new Set(duplicatePublicAssetUrls)].join(', ')}`)
    }
    let hasInvalidPublicAssetDetails = false
    for (const asset of evidence.publicAssets) {
      if (
        !asset ||
        typeof asset.name !== 'string' ||
        !asset.name ||
        !Number.isInteger(asset.sizeBytes) ||
        asset.sizeBytes <= 0 ||
        typeof asset.url !== 'string' ||
        !asset.url.startsWith('https://')
      ) {
        hasInvalidPublicAssetDetails = true
      }
      if (asset.state !== undefined && asset.state !== 'uploaded') {
        failures.push(`public-release-evidence.json has non-uploaded public asset ${asset.name}: ${asset.state}`)
      }
      if (
        typeof asset?.url === 'string' &&
        asset.url.startsWith('https://') &&
        !isExpectedGitHubReleaseAssetUrl(asset.url, expected.repository)
      ) {
        failures.push(`public-release-evidence.json has asset URL outside expected repository: ${asset.name}`)
        failures.push(`public-release-evidence.json has invalid GitHub Release asset URL: ${asset.name}`)
      }
    }
    if (hasInvalidPublicAssetDetails) {
      failures.push('public-release-evidence.json has invalid public asset details')
    }
  }
  if (options.productionGateEvidence) {
    failures.push(...compareReleaseEvidenceSource(
      evidence,
      'public-release-evidence.json',
      options.productionGateEvidence,
      'production-gate-evidence.json',
    ))
  }
  if (options.publishedReleaseEvidence) {
    failures.push(...validatePublishedReleaseEvidence(options.publishedReleaseEvidence, expected))
    failures.push(...comparePublicReleaseEvidenceToPublishedReleaseEvidence(
      evidence,
      options.publishedReleaseEvidence,
    ))
  }
  return failures
}

function runGenerate(options) {
  const releaseJson = requireOption(options, 'releaseJson')
  const downloadedDir = requireOption(options, 'downloadedDir')
  const output = requireOption(options, 'output')
  const evidence = buildPublishedReleaseEvidence({
    release: readJson(releaseJson),
    downloadedDir,
  })
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`)
}

function runGeneratePublic(options) {
  const releaseJson = requireOption(options, 'releaseJson')
  const output = requireOption(options, 'output')
  const evidence = buildPublicReleaseEvidence({
    release: readJson(releaseJson),
  })
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`)
}

function runVerify(options) {
  const evidencePath = requireOption(options, 'evidence')
  const failures = []
  const evidence = readJson(evidencePath)
  if (options.local) {
    failures.push(...comparePublishedReleaseEvidenceFiles(options.local, evidencePath))
  }
  if (options.downloadedDir) {
    failures.push(...comparePublishedReleaseEvidenceToDownloadedAssets(evidence, options.downloadedDir))
  }
  failures.push(...validatePublishedReleaseEvidence(evidence, expectedSourceFromOptions(options)))
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure)
    }
    process.exit(1)
  }
}

function runVerifyPublic(options) {
  const evidencePath = requireOption(options, 'evidence')
  const failures = validatePublicReleaseEvidence(readJson(evidencePath), expectedSourceFromOptions(options), {
    ...(options.productionGateEvidence ? { productionGateEvidence: readJson(options.productionGateEvidence) } : {}),
    ...(options.publishedEvidence ? { publishedReleaseEvidence: readJson(options.publishedEvidence) } : {}),
  })
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure)
    }
    process.exit(1)
  }
}

function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv)
  if (command === 'generate') {
    runGenerate(options)
    return
  }
  if (command === 'generate-public') {
    runGeneratePublic(options)
    return
  }
  if (command === 'verify') {
    runVerify(options)
    return
  }
  if (command === 'verify-public') {
    runVerifyPublic(options)
    return
  }
  throw new Error(`Unknown command: ${command || '<missing>'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
