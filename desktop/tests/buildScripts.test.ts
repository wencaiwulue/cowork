import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import packageJson from '../../package.json' with { type: 'json' }
import builderConfig from '../electron-builder.json' with { type: 'json' }
import {
  cliBuildArgs,
  resolveBuildMetadata,
} from '../scripts/build-cli.mjs'
import {
  electronBuilderArgs,
  packageJsonForRelease,
} from '../scripts/build-desktop.mjs'
import {
  discoverMacReleaseArtifacts,
  verifyMacReleaseArtifacts,
} from '../scripts/verify-release-artifacts.mjs'
import {
  buildPublicReleaseEvidence,
  buildPublishedReleaseEvidence,
  comparePublishedReleaseEvidenceToDownloadedAssets,
  comparePublishedReleaseEvidenceFiles,
  validatePublicReleaseEvidence,
  validatePublishedReleaseEvidence,
} from '../scripts/published-release-evidence.mjs'
import {
  buildProductionGateEvidence,
  productionGateSteps,
  runProductionGate,
  validateProductionGateEvidence,
} from '../scripts/production-gate.mjs'
import {
  checkCodeSigningIdentity,
  checkReleaseWorkflowAutomation,
} from '../scripts/production-readiness.mjs'
import {
  buildReleaseEvidence,
  buildReleaseChecksumManifest,
  buildReleaseNotesEvidence,
  cleanReleaseOutputDirectory,
  describeReleaseArtifact,
  notarizationCredentialStrategy,
  releasePreflightFailureHeading,
  releasePreflightRecords,
  releasePreflightRecordsForPhase,
  releasePipelineSteps,
  validateReleaseEnvironment,
  validateReleaseMachine,
} from '../scripts/release-ci.mjs'
import {
  buildUxValidationEvidenceTemplate,
  requiredUxValidationManualTasks,
  validateUxValidationEvidenceContents,
  validateUxValidationEvidenceFile,
  writeUxValidationEvidenceTemplate,
} from '../scripts/ux-validation-evidence.mjs'
import { requiredSmokeScreenshots } from '../scripts/smoke-packaged.mjs'
import {
  extractSmokeSummaryFromOutput,
  requiredSmokeSummaryFlags,
  summarizeSmokeSummary,
} from '../scripts/smoke-evidence.mjs'

describe('desktop build scripts', () => {
  const completedUxEvidenceBase64 = Buffer.from('completed-ux-evidence').toString('base64')
  const truncatedInlineCertificateBundle = Buffer.from([
    0x30, 0x82, 0x03, 0x1f, 0x02, 0x01, 0x03, 0x30,
    0x82, 0x02, 0xe5, 0x06, 0x09, 0x2a, 0x86, 0x48,
    0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01,
  ]).toString('base64')
  const inlineCertificateBundle = Buffer.concat([
    Buffer.from([
      0x30, 0x82, 0x03, 0x1f, 0x02, 0x01, 0x03, 0x30,
      0x82, 0x02, 0xe5, 0x06, 0x09, 0x2a, 0x86, 0x48,
      0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01,
    ]),
    Buffer.alloc(512, 0),
  ]).toString('base64')
  const placeholderCertificateBundle = Buffer.from('developer-id-application-p12').toString('base64')
  const legacyPlaceholderCertificateBundle = Buffer.from('developer-id-pc12').toString('base64')
  const inlineAppleApiKey = [
    '-----BEGIN PRIVATE KEY-----',
    'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgAAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOgCgYIKoZIzj0DAQehRANCAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '-----END PRIVATE KEY-----',
  ].join('\n')
  const repoLockfilePath = fileURLToPath(new URL('../../bun.lock', import.meta.url))
  const repoReleaseCiPath = fileURLToPath(new URL('../scripts/release-ci.mjs', import.meta.url))
  const repoReleaseVerifierPath = fileURLToPath(new URL('../scripts/verify-release-artifacts.mjs', import.meta.url))
  const repoReleaseWorkflowPath = fileURLToPath(new URL('../../.github/workflows/desktop-release.yml', import.meta.url))
  const releaseToolingBuffers = {
    releaseCi: Buffer.from('release-ci-tooling'),
    releaseVerifier: Buffer.from('release-verifier-tooling'),
    releaseWorkflow: Buffer.from('release-workflow-tooling'),
  }
  const releaseToolingMetadata = (overrides: Record<string, Partial<{
    path: string,
    exists: boolean,
    type: string,
    sizeBytes: number,
    sha256: string,
  }>> = {}) => ({
    releaseCi: {
      path: repoReleaseCiPath,
      exists: true,
      type: 'file',
      sizeBytes: releaseToolingBuffers.releaseCi.byteLength,
      sha256: createHash('sha256').update(releaseToolingBuffers.releaseCi).digest('hex'),
      ...overrides.releaseCi,
    },
    releaseVerifier: {
      path: repoReleaseVerifierPath,
      exists: true,
      type: 'file',
      sizeBytes: releaseToolingBuffers.releaseVerifier.byteLength,
      sha256: createHash('sha256').update(releaseToolingBuffers.releaseVerifier).digest('hex'),
      ...overrides.releaseVerifier,
    },
    releaseWorkflow: {
      path: repoReleaseWorkflowPath,
      exists: true,
      type: 'file',
      sizeBytes: releaseToolingBuffers.releaseWorkflow.byteLength,
      sha256: createHash('sha256').update(releaseToolingBuffers.releaseWorkflow).digest('hex'),
      ...overrides.releaseWorkflow,
    },
  })
  const releaseToolingReadFile = (path: string) => {
    if (path === repoReleaseCiPath) return releaseToolingBuffers.releaseCi
    if (path === repoReleaseVerifierPath) return releaseToolingBuffers.releaseVerifier
    if (path === repoReleaseWorkflowPath) return releaseToolingBuffers.releaseWorkflow
    return undefined
  }
  const publishedReleaseEnv = {
    EXPECTED_RELEASE_VERSION: '1.2.3',
    EXPECTED_REPOSITORY: 'anthropic/claude-code',
    EXPECTED_REF_NAME: 'desktop-v1.2.3',
    EXPECTED_REF_TYPE: 'tag',
    EXPECTED_EVENT_NAME: 'push',
    EXPECTED_COMMIT: 'abc123',
    EXPECTED_RUN_ID: '12345',
    EXPECTED_RUN_ATTEMPT: '2',
    EXPECTED_RUN_URL: 'https://github.com/anthropic/claude-code/actions/runs/12345/attempts/2',
  }
  const publishedReleaseExpectedSource = {
    releaseVersion: '1.2.3',
    repository: 'anthropic/claude-code',
    refName: 'desktop-v1.2.3',
    refType: 'tag',
    eventName: 'push',
    commit: 'abc123',
    ciRunId: '12345',
    ciRunAttempt: '2',
    ciRunUrl: 'https://github.com/anthropic/claude-code/actions/runs/12345/attempts/2',
  }
  const publishedReleaseAssets = new Map([
    ['Claude Code Desktop-1.2.3-arm64.dmg', Buffer.from('dmg')],
    ['Claude Code Desktop-1.2.3-arm64-mac.zip', Buffer.from('zip')],
    ['SHA256SUMS', Buffer.from('checksums')],
    ['release-evidence.json', Buffer.from('release evidence')],
    ['release-notes-evidence.md', Buffer.from('release notes')],
    ['ux-validation-evidence.md', Buffer.from('ux evidence')],
    ['ux-screenshots.zip', Buffer.from('screenshots')],
  ])
  function releaseAssetId(name: string) {
    return 1000 + [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  }
  function publicReleaseAsset(name: string, contents = publishedReleaseAssets.get(name) ?? Buffer.from('published evidence')) {
    return {
      name,
      size: contents.byteLength,
      url: `https://api.github.com/repos/anthropic/claude-code/releases/assets/${releaseAssetId(name)}`,
      state: 'uploaded',
    }
  }
  function publicReleaseEvidenceAsset(name: string, contents = publishedReleaseAssets.get(name) ?? Buffer.from('published evidence')) {
    const asset = publicReleaseAsset(name, contents)
    return {
      name: asset.name,
      sizeBytes: asset.size,
      url: asset.url,
      state: asset.state,
    }
  }
  function publishedReleaseReadFile(path: string) {
    const name = path.replace('/downloaded/', '')
    const contents = publishedReleaseAssets.get(name)
    if (!contents) throw new Error(`missing ${path}`)
    return contents
  }
  function publishedReleaseStat(path: string) {
    return { size: publishedReleaseReadFile(path).byteLength }
  }

  it('builds post-publish release evidence from downloaded release assets', () => {
    const evidence = buildPublishedReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        databaseId: 887766,
        url: 'https://github.com/anthropic/claude-code/releases/tag/desktop-v1.2.3',
      },
      downloadedDir: '/downloaded',
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
      readDir: () => [...publishedReleaseAssets.keys()],
      readFile: publishedReleaseReadFile,
      stat: publishedReleaseStat,
    })

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      product: 'Claude Code Desktop',
      evidenceKind: 'published-release-verification',
      generatedAt: '2026-07-17T00:00:00.000Z',
      releaseVersion: '1.2.3',
      releaseTag: 'desktop-v1.2.3',
      releaseName: 'Claude Code Desktop 1.2.3',
      releaseDatabaseId: 887766,
      releaseUrl: 'https://github.com/anthropic/claude-code/releases/tag/desktop-v1.2.3',
      repository: 'anthropic/claude-code',
      refName: 'desktop-v1.2.3',
      refType: 'tag',
      eventName: 'push',
      commit: 'abc123',
      ciRunId: '12345',
      ciRunAttempt: '2',
      ciRunUrl: 'https://github.com/anthropic/claude-code/actions/runs/12345/attempts/2',
      verifiedAssetCount: 7,
    })
    expect(evidence.verifiedAssets).toEqual(
      [...publishedReleaseAssets.entries()]
        .sort()
        .map(([name, contents]) => ({
          name,
          sizeBytes: contents.byteLength,
          sha256: createHash('sha256').update(contents).digest('hex'),
        })),
    )
    expect(validatePublishedReleaseEvidence(evidence, publishedReleaseExpectedSource)).toEqual([])
  })

  it('rejects post-publish release evidence without stable GitHub Release identity', () => {
    const evidence = {
      ...buildPublishedReleaseEvidence({
        release: {
          tagName: 'desktop-v1.2.3',
          name: 'Claude Code Desktop 1.2.3',
        },
        downloadedDir: '/downloaded',
        generatedAt: '2026-07-17T00:00:00.000Z',
        env: publishedReleaseEnv,
        readDir: () => [...publishedReleaseAssets.keys()],
        readFile: publishedReleaseReadFile,
        stat: publishedReleaseStat,
      }),
      releaseUrl: 'https://github.com/anthropic/other/releases/tag/desktop-v1.2.3',
    }

    expect(validatePublishedReleaseEvidence(evidence, publishedReleaseExpectedSource)).toEqual(expect.arrayContaining([
      'published-release-evidence.json has invalid GitHub Release database id',
      'published-release-evidence.json has invalid GitHub Release URL',
    ]))
  })

  it('rejects post-publish release evidence with stale CI source metadata', () => {
    const evidence = buildPublishedReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
      },
      downloadedDir: '/downloaded',
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
      readDir: () => [...publishedReleaseAssets.keys()],
      readFile: publishedReleaseReadFile,
      stat: publishedReleaseStat,
    })

    expect(validatePublishedReleaseEvidence(evidence, {
      releaseVersion: '1.2.3',
      repository: 'anthropic/claude-code',
      refName: 'desktop-v1.2.3',
      refType: 'tag',
      eventName: 'push',
      commit: 'different',
      ciRunId: '12345',
      ciRunAttempt: '2',
      ciRunUrl: 'https://github.com/anthropic/claude-code/actions/runs/12345/attempts/2',
    })).toContain('published-release-evidence.json has invalid CI source metadata: commit')
  })

  it('rejects post-publish release evidence that is missing required published assets', () => {
    const assetsWithoutScreenshots = new Map(publishedReleaseAssets)
    assetsWithoutScreenshots.delete('ux-screenshots.zip')
    const evidence = buildPublishedReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
      },
      downloadedDir: '/downloaded',
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
      readDir: () => [...assetsWithoutScreenshots.keys()],
      readFile: path => {
        const name = path.replace('/downloaded/', '')
        const contents = assetsWithoutScreenshots.get(name)
        if (!contents) throw new Error(`missing ${path}`)
        return contents
      },
      stat: path => {
        const name = path.replace('/downloaded/', '')
        const contents = assetsWithoutScreenshots.get(name)
        if (!contents) throw new Error(`missing ${path}`)
        return { size: contents.byteLength }
      },
    })

    expect(validatePublishedReleaseEvidence(evidence, publishedReleaseExpectedSource)).toContain(
      'published-release-evidence.json is missing verified asset ux-screenshots.zip',
    )
  })

  it('rejects post-publish release evidence with wrong-version or unexpected published assets', () => {
    const assetsWithWrongVersion = new Map(publishedReleaseAssets)
    assetsWithWrongVersion.delete('Claude Code Desktop-1.2.3-arm64.dmg')
    assetsWithWrongVersion.set('Claude Code Desktop-1.2.2-arm64.dmg', Buffer.from('old dmg'))
    assetsWithWrongVersion.set('unexpected.txt', Buffer.from('unexpected'))
    const evidence = buildPublishedReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
      },
      downloadedDir: '/downloaded',
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
      readDir: () => [...assetsWithWrongVersion.keys()],
      readFile: path => {
        const name = path.replace('/downloaded/', '')
        const contents = assetsWithWrongVersion.get(name)
        if (!contents) throw new Error(`missing ${path}`)
        return contents
      },
      stat: path => {
        const name = path.replace('/downloaded/', '')
        const contents = assetsWithWrongVersion.get(name)
        if (!contents) throw new Error(`missing ${path}`)
        return { size: contents.byteLength }
      },
    })

    const failures = validatePublishedReleaseEvidence(evidence, publishedReleaseExpectedSource)
    expect(failures).toContain(
      'published-release-evidence.json expected exactly one verified current-version DMG asset, found 0',
    )
    expect(failures).toContain(
      'published-release-evidence.json has unexpected verified assets: Claude Code Desktop-1.2.2-arm64.dmg, unexpected.txt',
    )
  })

  it('compares post-publish release evidence asset hashes with the downloaded assets directory', () => {
    const evidence = buildPublishedReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
      },
      downloadedDir: '/downloaded',
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
      readDir: () => [...publishedReleaseAssets.keys()],
      readFile: publishedReleaseReadFile,
      stat: publishedReleaseStat,
    })
    const mutatedAssets = new Map(publishedReleaseAssets)
    mutatedAssets.set('SHA256SUMS', Buffer.from('changed checksums'))
    mutatedAssets.set('extra.log', Buffer.from('extra'))

    expect(comparePublishedReleaseEvidenceToDownloadedAssets(evidence, '/downloaded', {
      readDir: () => [...mutatedAssets.keys()],
      readFile: path => {
        const name = path.replace('/downloaded/', '')
        const contents = mutatedAssets.get(name)
        if (!contents) throw new Error(`missing ${path}`)
        return contents
      },
      stat: path => {
        const name = path.replace('/downloaded/', '')
        const contents = mutatedAssets.get(name)
        if (!contents) throw new Error(`missing ${path}`)
        return { size: contents.byteLength }
      },
    })).toEqual([
      'published-release-evidence.json verified assets do not match downloaded directory; missing=<none>; unexpected=extra.log',
      `SHA256SUMS downloaded size ${Buffer.from('changed checksums').byteLength} did not match published evidence size ${Buffer.from('checksums').byteLength}`,
      `SHA256SUMS downloaded SHA-256 ${createHash('sha256').update('changed checksums').digest('hex')} did not match published evidence SHA-256 ${createHash('sha256').update('checksums').digest('hex')}`,
    ])
  })

  it('rejects downloaded post-publish release evidence when bytes differ from the uploaded file', () => {
    const local = Buffer.from('local evidence')
    const downloaded = Buffer.from('downloaded evidence')

    expect(comparePublishedReleaseEvidenceFiles('/local/published-release-evidence.json', '/downloaded/published-release-evidence.json', {
      readFile: path => path.startsWith('/local/') ? local : downloaded,
      stat: path => ({ size: path.startsWith('/local/') ? local.byteLength : downloaded.byteLength }),
    })).toEqual([
      `published-release-evidence.json downloaded size ${downloaded.byteLength} did not match local size ${local.byteLength}`,
      `published-release-evidence.json downloaded SHA-256 ${createHash('sha256').update(downloaded).digest('hex')} did not match local SHA-256 ${createHash('sha256').update(local).digest('hex')}`,
    ])
  })

  it('builds and validates final public release evidence', () => {
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        databaseId: 998877,
        url: 'https://github.com/anthropic/claude-code/releases/tag/desktop-v1.2.3',
        isDraft: false,
        isPrerelease: false,
        assets: [
          ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseAsset(name, contents)),
          publicReleaseAsset('production-gate-evidence.json'),
          publicReleaseAsset('published-release-evidence.json'),
        ],
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
    })

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      product: 'Claude Code Desktop',
      evidenceKind: 'public-release-verification',
      releaseVersion: '1.2.3',
      releaseTag: 'desktop-v1.2.3',
      releaseName: 'Claude Code Desktop 1.2.3',
      releaseDatabaseId: 998877,
      releaseUrl: 'https://github.com/anthropic/claude-code/releases/tag/desktop-v1.2.3',
      isDraft: false,
      isPrerelease: false,
      assetCount: 9,
      repository: 'anthropic/claude-code',
      refName: 'desktop-v1.2.3',
      refType: 'tag',
      eventName: 'push',
      commit: 'abc123',
      ciRunId: '12345',
      ciRunAttempt: '2',
      ciRunUrl: 'https://github.com/anthropic/claude-code/actions/runs/12345/attempts/2',
    })
    expect(evidence.assetNames).toEqual([...evidence.assetNames].sort())
    const sortPublicAssets = (assets: Array<{ name: string }>) => [...assets].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    expect(evidence.publicAssets).toEqual(sortPublicAssets(evidence.publicAssets))
    expect(evidence.publicAssets).toEqual([
      ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseEvidenceAsset(name, contents)),
      publicReleaseEvidenceAsset('production-gate-evidence.json'),
      publicReleaseEvidenceAsset('published-release-evidence.json'),
    ].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource)).toEqual([])
  })

  it('rejects final public release evidence without stable GitHub Release identity', () => {
    const evidence = {
      ...buildPublicReleaseEvidence({
        release: {
          tagName: 'desktop-v1.2.3',
          name: 'Claude Code Desktop 1.2.3',
          isDraft: false,
          isPrerelease: false,
          assets: [
            ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseAsset(name, contents)),
            publicReleaseAsset('production-gate-evidence.json'),
            publicReleaseAsset('published-release-evidence.json'),
          ],
        },
        generatedAt: '2026-07-17T00:00:00.000Z',
        env: publishedReleaseEnv,
      }),
      releaseUrl: 'https://github.com/anthropic/other/releases/tag/desktop-v1.2.3',
    }

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource)).toEqual(expect.arrayContaining([
      'public-release-evidence.json has invalid GitHub Release database id',
      'public-release-evidence.json has invalid GitHub Release URL',
    ]))
  })

  it('rejects final public release evidence with stale commit or ref metadata', () => {
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        isDraft: false,
        isPrerelease: false,
        assets: [
          ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseAsset(name, contents)),
          publicReleaseAsset('production-gate-evidence.json'),
          publicReleaseAsset('published-release-evidence.json'),
        ],
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: {
        ...publishedReleaseEnv,
        EXPECTED_REF_NAME: 'main',
        EXPECTED_COMMIT: 'stale',
      },
    })

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource)).toEqual(expect.arrayContaining([
      'public-release-evidence.json has invalid CI source metadata: refName',
      'public-release-evidence.json has invalid CI source metadata: commit',
    ]))
  })

  it('rejects final public release evidence that is not bound to the production gate evidence source', () => {
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        isDraft: false,
        isPrerelease: false,
        assets: [
          ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseAsset(name, contents)),
          publicReleaseAsset('production-gate-evidence.json'),
          publicReleaseAsset('published-release-evidence.json'),
        ],
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
    })
    const productionGateEvidence = buildProductionGateEvidence({
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: {
        ...publishedReleaseEnv,
        EXPECTED_COMMIT: 'different',
      },
      status: 'pass',
      steps: [
        { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
        { id: 'release-preflight', status: 'pass', records: [{ id: 'release-machine', status: 'pass' }] },
        { id: 'verify-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-release'], exitCode: 0 },
        { id: 'verify-published-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-published-release'], exitCode: 0 },
      ],
    })

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource, { productionGateEvidence })).toContain(
      'public-release-evidence.json does not match production-gate-evidence.json CI source metadata: commit',
    )
  })

  it('rejects final public release evidence that is not bound to the published Release identity', () => {
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        databaseId: 998877,
        url: 'https://github.com/anthropic/claude-code/releases/tag/desktop-v1.2.3',
        isDraft: false,
        isPrerelease: false,
        assets: [
          ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseAsset(name, contents)),
          publicReleaseAsset('production-gate-evidence.json'),
          publicReleaseAsset('published-release-evidence.json'),
        ],
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
    })
    const publishedReleaseEvidence = buildPublishedReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        databaseId: 887766,
        url: 'https://github.com/anthropic/claude-code/releases/tag/desktop-v1.2.3',
      },
      downloadedDir: '/downloaded',
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
      readDir: () => [...publishedReleaseAssets.keys()],
      readFile: publishedReleaseReadFile,
      stat: publishedReleaseStat,
    })

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource, {
      publishedReleaseEvidence,
    })).toContain(
      'public-release-evidence.json does not match published-release-evidence.json release metadata: releaseDatabaseId',
    )
  })

  it('rejects final public release evidence whose public asset sizes differ from published evidence', () => {
    const publishedReleaseEvidence = buildPublishedReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        databaseId: 998877,
        url: 'https://github.com/anthropic/claude-code/releases/tag/desktop-v1.2.3',
      },
      downloadedDir: '/downloaded',
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
      readDir: () => [...publishedReleaseAssets.keys()],
      readFile: publishedReleaseReadFile,
      stat: publishedReleaseStat,
    })
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        databaseId: 998877,
        url: 'https://github.com/anthropic/claude-code/releases/tag/desktop-v1.2.3',
        isDraft: false,
        isPrerelease: false,
        assets: [
          ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseAsset(name, contents)),
          publicReleaseAsset('production-gate-evidence.json'),
          publicReleaseAsset('published-release-evidence.json'),
        ].map(asset => asset.name === 'Claude Code Desktop-1.2.3-arm64.dmg'
          ? { ...asset, size: asset.size + 1 }
          : asset),
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
    })

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource, {
      publishedReleaseEvidence,
    })).toContain(
      'public-release-evidence.json public asset size does not match published-release-evidence.json: Claude Code Desktop-1.2.3-arm64.dmg',
    )
  })

  it('rejects final public release evidence that is still draft or missing required assets', () => {
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        isDraft: true,
        isPrerelease: false,
        assets: [
          { name: 'Claude Code Desktop-1.2.3-arm64.dmg' },
          { name: 'SHA256SUMS' },
          { name: 'release-evidence.json' },
          { name: 'release-notes-evidence.md' },
          { name: 'ux-validation-evidence.md' },
          { name: 'ux-screenshots.zip' },
        ],
      },
      generatedAt: 'not-a-date',
      env: publishedReleaseEnv,
    })

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource)).toEqual(expect.arrayContaining([
      'public-release-evidence.json must prove the Release is public and not prerelease',
      'public-release-evidence.json has invalid generatedAt metadata',
      'public-release-evidence.json has invalid asset summary',
      'public-release-evidence.json is missing asset production-gate-evidence.json',
      'public-release-evidence.json is missing asset published-release-evidence.json',
      'public-release-evidence.json expected exactly one current-version mac ZIP asset, found 0',
    ]))
  })

  it('rejects final public release evidence with missing public asset metadata', () => {
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        isDraft: false,
        isPrerelease: false,
        assets: [
          ...[...publishedReleaseAssets.keys()].map(name => ({ name })),
          { name: 'published-release-evidence.json', size: 0, url: 'not-https', state: 'deleted' },
        ],
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
    })

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource)).toEqual(expect.arrayContaining([
      'public-release-evidence.json has invalid public asset details',
      'public-release-evidence.json has non-uploaded public asset published-release-evidence.json: deleted',
    ]))
  })

  it('rejects final public release evidence whose asset URLs point outside the release repository', () => {
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        isDraft: false,
        isPrerelease: false,
        assets: [
          ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseAsset(name, contents)),
          publicReleaseAsset('production-gate-evidence.json'),
          publicReleaseAsset('published-release-evidence.json'),
        ].map(asset => asset.name === 'published-release-evidence.json'
          ? { ...asset, url: 'https://api.github.com/repos/other/repo/releases/assets/123' }
          : asset),
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
    })

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource)).toContain(
      'public-release-evidence.json has asset URL outside expected repository: published-release-evidence.json',
    )
  })

  it('rejects final public release evidence whose GitHub asset URLs do not include an asset id', () => {
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        isDraft: false,
        isPrerelease: false,
        assets: [
          ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseAsset(name, contents)),
          publicReleaseAsset('production-gate-evidence.json'),
          publicReleaseAsset('published-release-evidence.json'),
        ].map(asset => asset.name === 'published-release-evidence.json'
          ? { ...asset, url: 'https://api.github.com/repos/anthropic/claude-code/releases/assets/' }
          : asset),
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
    })

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource)).toContain(
      'public-release-evidence.json has invalid GitHub Release asset URL: published-release-evidence.json',
    )
  })

  it('rejects final public release evidence whose GitHub asset URLs include query or fragment data', () => {
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        databaseId: 998877,
        url: 'https://github.com/anthropic/claude-code/releases/tag/desktop-v1.2.3',
        isDraft: false,
        isPrerelease: false,
        assets: [
          ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseAsset(name, contents)),
          publicReleaseAsset('production-gate-evidence.json'),
          publicReleaseAsset('published-release-evidence.json'),
        ].map(asset => asset.name === 'published-release-evidence.json'
          ? { ...asset, url: `${asset.url}?download=1#mutable` }
          : asset),
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
    })

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource)).toContain(
      'public-release-evidence.json has invalid GitHub Release asset URL: published-release-evidence.json',
    )
  })

  it('rejects final public release evidence with duplicate public asset URLs', () => {
    const duplicateUrl = publicReleaseAsset('production-gate-evidence.json').url
    const evidence = buildPublicReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
        isDraft: false,
        isPrerelease: false,
        assets: [
          ...[...publishedReleaseAssets.entries()].map(([name, contents]) => publicReleaseAsset(name, contents)),
          publicReleaseAsset('production-gate-evidence.json'),
          { ...publicReleaseAsset('published-release-evidence.json'), url: duplicateUrl },
        ],
      },
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
    })

    expect(validatePublicReleaseEvidence(evidence, publishedReleaseExpectedSource)).toContain(
      'public-release-evidence.json has duplicate public asset URLs: https://api.github.com/repos/anthropic/claude-code/releases/assets/3925',
    )
  })

  function completedUxValidationEvidence(overrides: {
    validator?: string,
    representativeUser?: string,
    representativeUserValidation?: string | null,
    screenshotResult?: string,
    screenshotRows?: string[],
    manualTaskRows?: string[],
    manualTaskResult?: string,
    blockingIssues?: string,
    knownLimitationsAccepted?: string,
    approval?: string,
    version?: string,
    commit?: string,
  } = {}) {
    const validator = overrides.validator ?? 'Release QA, 2026-07-16'
    const representativeUser = overrides.representativeUser ?? 'Desktop engineer, 2026-07-16'
    const representativeUserValidation = overrides.representativeUserValidation === undefined
      ? 'observed, Release PM, 2026-07-16'
      : overrides.representativeUserValidation
    const screenshotResult = overrides.screenshotResult ?? 'pass'
    const manualTaskResult = overrides.manualTaskResult ?? 'pass'
    const blockingIssues = overrides.blockingIssues ?? 'none'
    const knownLimitationsAccepted = overrides.knownLimitationsAccepted ?? 'yes, Release QA'
    const approval = overrides.approval ?? 'approved, Release QA, 2026-07-16'
    const version = overrides.version ?? '1.2.3'
    const commit = overrides.commit ?? 'abc123'
    const screenshotRows = overrides.screenshotRows ?? [
      `| Chat streaming and tool activity | \`chat-streaming.png\` | ${screenshotResult} | reviewed |`,
      `| Settings desktop layout | \`settings.png\` | ${screenshotResult} | reviewed |`,
      `| Settings narrow layout | \`settings-narrow.png\` | ${screenshotResult} | reviewed |`,
      `| MCP management | \`settings-mcp.png\` | ${screenshotResult} | reviewed |`,
      `| Skills management | \`settings-skills.png\` | ${screenshotResult} | reviewed |`,
      `| Command Palette | \`command-palette.png\` | ${screenshotResult} | reviewed |`,
      `| Agents management | \`agents.png\` | ${screenshotResult} | reviewed |`,
      `| Selected agent actions | \`agents-selected.png\` | ${screenshotResult} | reviewed |`,
      `| Scheduled tasks management | \`tasks.png\` | ${screenshotResult} | reviewed |`,
      `| Teams management | \`teams.png\` | ${screenshotResult} | reviewed |`,
      `| Composer actions menu | \`composer-actions.png\` | ${screenshotResult} | reviewed |`,
      `| Permission review modal | \`permission-modal.png\` | ${screenshotResult} | reviewed |`,
      `| Files browser | \`files.png\` | ${screenshotResult} | reviewed |`,
      `| Editor | \`editor.png\` | ${screenshotResult} | reviewed |`,
      `| Diff viewer | \`diff.png\` | ${screenshotResult} | reviewed |`,
      `| Files/editor unsaved guard | \`before-unsaved-files-pane-switch.png\`, \`unsaved-files-pane-switch-dialog.png\`, \`before-unsaved-diff-pane-switch.png\`, \`unsaved-diff-pane-switch-dialog.png\`, \`after-unsaved-diff-pane-switch-keep-editing.png\` | ${screenshotResult} | reviewed |`,
      `| Terminal | \`terminal.png\` | ${screenshotResult} | reviewed |`,
      `| Preview | \`preview.png\` | ${screenshotResult} | reviewed |`,
    ]
    const manualTaskRows = overrides.manualTaskRows ?? [
      `| Create a new local session from the session rail. | Session appears, focuses, and status is visible. | ${manualTaskResult} | reviewed |`,
      `| Send a short prompt and wait for streaming output. | Chat shows streaming assistant output. | ${manualTaskResult} | reviewed |`,
      `| Trigger a permission request and choose allow, then deny on a second request. | Permission modal is understandable and both decisions reach the runtime. | ${manualTaskResult} | reviewed |`,
      `| Open Files, expand a folder, edit a text file, save, and refresh Diff. | Editor saves the file and Diff shows the Git change. | ${manualTaskResult} | reviewed |`,
      `| Start Terminal, run \`pwd\` and \`git status\`, then stop/restart it. | xterm renders output, resize remains stable, restart works. | ${manualTaskResult} | reviewed |`,
      `| Open Preview with a local URL and then open externally. | iframe updates in app and external open is explicit. | ${manualTaskResult} | reviewed |`,
      `| Open Agents, launch an agent task, and inspect running task feedback. | Agent management, launch validation, and task action feedback are clear. | ${manualTaskResult} | reviewed |`,
      `| Open Teams and route a composer message to a teammate or team. | Target routing is clear and team/agent state is not confused. | ${manualTaskResult} | reviewed |`,
      `| Use Command Palette and native View menu navigation. | Cmd/Ctrl+K opens searchable commands; View menu page/pane actions switch pages and persist pane layout. | ${manualTaskResult} | reviewed |`,
      `| Use native Help menu support actions. | Help menu Command Palette opens the searchable command palette. Help menu Refresh Settings reports refreshed configuration. Help menu Export Diagnostics writes a redacted bundle. | ${manualTaskResult} | reviewed |`,
      `| Use Command Palette lifecycle create commands. | New custom agent, New team, New global scheduled task, and New project scheduled task open clean drafts with visible status. | ${manualTaskResult} | reviewed |`,
      `| Use Command Palette Settings management commands. | Settings sections, Add MCP, Check MCP, user/project Skill drafts, user/project skill install cancellation, plugin listing, diagnostics, and refresh provide visible feedback. | ${manualTaskResult} | reviewed |`,
      `| Inspect MCP and Skills details from Settings. | User/project MCP details and user/project Skill contents render with redacted, readonly details. | ${manualTaskResult} | reviewed |`,
      `| Use \`@\` resources and \`/\` actions from the composer. | Menus are discoverable, keyboard focus is usable, selected target is visible, and a project custom slash command can be selected. | ${manualTaskResult} | reviewed |`,
      `| Use \`/\` composer lifecycle and Settings shortcuts. | \`/new-custom\` and \`/add-mcp\` route to clean drafts with visible page status. | ${manualTaskResult} | reviewed |`,
      `| Export diagnostics from Settings. | A redacted diagnostic bundle is produced and no secret values are visible in summaries. | ${manualTaskResult} | reviewed |`,
    ]

    return [
      '# Claude Code Desktop UX Validation Evidence',
      '',
      '## Release Candidate',
      '',
      `- Version: \`${version}\``,
      `- Commit: \`${commit}\``,
      '- Artifact evidence: `desktop/release/release-evidence.json`',
      '- Screenshot artifact: `desktop/release/ux-screenshots`',
      `- Validator: ${validator}`,
      `- Representative user: ${representativeUser}`,
      ...(representativeUserValidation === null ? [] : [`- Representative user validation: ${representativeUserValidation}`]),
      '',
      '## Screenshot Review',
      '',
      '| Area | Evidence | Result | Notes |',
      '| --- | --- | --- | --- |',
      ...screenshotRows,
      '',
      '## Manual Task Script',
      '',
      '| Task | Expected result | Result | Notes |',
      '| --- | --- | --- | --- |',
      ...manualTaskRows,
      '',
      '## Approval',
      '',
      `- Blocking issues filed: ${blockingIssues}`,
      '- Non-blocking follow-ups: none',
      `- Known limitations accepted: ${knownLimitationsAccepted}`,
      `- UX release approval: ${approval}`,
      '',
    ].join('\n')
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
  const requiredReleaseNotesEvidenceDetailCheckIds = [
    'mac-app-codesign',
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
  const releaseEvidenceStepCommand = (id: string) => {
    const preflightPhases: Record<string, string> = {
      'release-env': 'environment',
      'release-ux-validation': 'ux-validation',
      'release-machine': 'runner',
    }
    if (preflightPhases[id]) {
      return { command: 'node', args: ['desktop/scripts/release-ci.mjs', `preflight:${preflightPhases[id]}`] }
    }
    if (id === 'smoke-packaged') {
      return { command: 'node', args: ['desktop/scripts/smoke-packaged.mjs'] }
    }
    const desktopScripts: Record<string, string> = {
      'source-check': 'check',
      'desktop-check': 'desktop:check',
      'desktop-test': 'desktop:test',
      'smoke-electron': 'desktop:smoke-electron',
      'prod-check': 'desktop:prod-check',
      'desktop-build': 'desktop:build',
      'verify-release': 'desktop:verify-release',
      'final-verify-release': 'desktop:verify-release',
    }
    return { command: 'bun', args: ['run', desktopScripts[id] ?? id] }
  }
  const releaseEvidenceStepEnv = (id: string) => {
    if (id === 'smoke-electron') {
      return { DESKTOP_SMOKE_PROGRESS: '1' }
    }
    if (id === 'smoke-packaged') {
      return {
        DESKTOP_SMOKE_PROGRESS: '1',
        DESKTOP_SMOKE_SCREENSHOT_DIR: '/release/ux-screenshots',
      }
    }
    if (id === 'verify-release') {
      return { DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_VERIFY_STEP: '1' }
    }
    if (id === 'final-verify-release') {
      return { DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_FINAL_VERIFY_STEP: '1' }
    }
    return undefined
  }
  const requiredSmokeSummary = {
    ok: true,
    terminalMode: 'pty',
    requiredFlags: Object.fromEntries(requiredSmokeSummaryFlags.map(flag => [flag, true])),
  }
  const releaseEvidenceStepRecord = (id: string) => ({
    id,
    ...releaseEvidenceStepCommand(id),
    status: 'pass',
    exitCode: 0,
    startedAt: '2026-07-16T00:00:00.000Z',
    endedAt: '2026-07-16T00:00:01.000Z',
    durationMs: 1000,
    ...(releaseEvidenceStepEnv(id) ? { env: releaseEvidenceStepEnv(id) } : {}),
    ...(id === 'smoke-electron' ? { smokeSummary: requiredSmokeSummary } : {}),
  })
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const pngWithDimensions = (width: number, height: number, payload: string, sizeBytes = 2048) => {
    const ihdr = Buffer.alloc(25)
    ihdr.writeUInt32BE(13, 0)
    ihdr.write('IHDR', 4, 'ascii')
    ihdr.writeUInt32BE(width, 8)
    ihdr.writeUInt32BE(height, 12)
    ihdr[16] = 8
    ihdr[17] = 2
    const contents = Buffer.concat([pngHeader, ihdr, Buffer.from(payload)])
    return Buffer.concat([contents, Buffer.alloc(Math.max(0, sizeBytes - contents.byteLength))])
  }
  const uxScreenshotContents = (name: string) => pngWithDimensions(1280, 720, `screenshot:${name}`)
  const uxScreenshotPath = (name: string, dir = '/release/ux-screenshots') => `${dir}/${name}`
  const requiredUxScreenshotMetadata = (dir = '/release/ux-screenshots') =>
    requiredSmokeScreenshots.map(name => {
      const contents = uxScreenshotContents(name)
      return {
        path: uxScreenshotPath(name, dir),
        exists: true,
        type: 'file',
        sizeBytes: contents.byteLength,
        sha256: createHash('sha256').update(contents).digest('hex'),
      }
    })

  const validReleaseWorkflow = `
name: Desktop Release
on:
  workflow_dispatch:
    inputs:
      version:
        required: true
        type: string
      ux_validation_evidence_base64:
        required: false
        type: string
  push:
    tags:
      - "desktop-v*"
concurrency:
  group: desktop-release-\${{ inputs.version || github.ref_name }}
  cancel-in-progress: false
jobs:
  macos-release:
    runs-on: macos-14
    environment: desktop-release
    timeout-minutes: 90
    permissions:
      contents: read
    outputs:
      version: \${{ steps.release-version.outputs.version }}
      artifact-suffix: \${{ steps.release-version.outputs.artifact-suffix }}
    env:
      DESKTOP_RELEASE_VERSION: \${{ inputs.version || github.ref_name }}
      CSC_LINK: \${{ secrets.DESKTOP_MAC_CSC_LINK }}
      CSC_KEY_PASSWORD: \${{ secrets.DESKTOP_MAC_CSC_KEY_PASSWORD }}
      CSC_NAME: \${{ secrets.DESKTOP_MAC_CSC_NAME }}
      APPLE_API_KEY: \${{ secrets.DESKTOP_APPLE_API_KEY }}
      APPLE_API_KEY_ID: \${{ secrets.DESKTOP_APPLE_API_KEY_ID }}
      APPLE_API_ISSUER: \${{ secrets.DESKTOP_APPLE_API_ISSUER }}
      APPLE_ID: \${{ secrets.DESKTOP_APPLE_ID }}
      APPLE_APP_SPECIFIC_PASSWORD: \${{ secrets.DESKTOP_APPLE_APP_SPECIFIC_PASSWORD }}
      APPLE_TEAM_ID: \${{ secrets.DESKTOP_APPLE_TEAM_ID }}
      APPLE_KEYCHAIN: \${{ secrets.DESKTOP_APPLE_KEYCHAIN }}
      APPLE_KEYCHAIN_PROFILE: \${{ secrets.DESKTOP_APPLE_KEYCHAIN_PROFILE }}
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: \${{ inputs.ux_validation_evidence_base64 || secrets.DESKTOP_UX_VALIDATION_EVIDENCE_BASE64 }}
    steps:
      - uses: actions/checkout@v4
      - name: Normalize tag version
        id: release-version
        run: |
          version="$DESKTOP_RELEASE_VERSION"
          if [[ "$version" == desktop-v* ]]; then
            version="\${version#desktop-v}"
          fi
          release_version_delimiter="claude_release_version_$(uuidgen)"
          {
            printf 'DESKTOP_RELEASE_VERSION<<%s\\n' "$release_version_delimiter"
            printf '%s\\n' "$version"
            printf '%s\\n' "$release_version_delimiter"
          } >> "$GITHUB_ENV"
          {
            printf 'version<<%s\\n' "$release_version_delimiter"
            printf '%s\\n' "$version"
            printf '%s\\n' "$release_version_delimiter"
          } >> "$GITHUB_OUTPUT"
          if [[ "$version" =~ ^[0-9A-Za-z._-]+$ ]]; then
            echo "artifact-suffix=$version" >> "$GITHUB_OUTPUT"
          else
            echo "artifact-suffix=invalid-\${GITHUB_RUN_ID}" >> "$GITHUB_OUTPUT"
          fi
      - name: Resolve Bun version
        id: bun-version
        run: |
          bun_version="$(node -e "const pm=require('./package.json').packageManager||''; const match=/^bun@(.+)$/.exec(pm); if (!match) throw new Error('packageManager must be bun@<version>'); console.log(match[1])")"
          echo "BUN_VERSION=$bun_version" >> "$GITHUB_ENV"
          echo "version=$bun_version" >> "$GITHUB_OUTPUT"
      - name: Resolve Node version
        id: node-version
        run: |
          node_version="$(node -e "const node=require('./package.json').engines?.node||''; if (!/^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(node)) throw new Error('engines.node must be an exact version'); console.log(node)")"
          echo "NODE_VERSION=$node_version" >> "$GITHUB_ENV"
          echo "version=$node_version" >> "$GITHUB_OUTPUT"
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: \${{ steps.bun-version.outputs.version }}
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ steps.node-version.outputs.version }}
      - run: bun install --frozen-lockfile
      - run: bun run desktop:release-ci
      - name: Archive signed app bundle
        if: success()
        run: |
          set -euo pipefail
          cd desktop/release
          app_bundle="$(find . -maxdepth 2 -type d -name 'Claude Code Desktop.app' | LC_ALL=C sort | head -n 1)"
          test -n "$app_bundle"
          tar -czf "Claude Code Desktop-\${{ steps.release-version.outputs.version }}-app-bundle.tar.gz" "$app_bundle"
      - name: Upload release evidence
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: claude-code-desktop-macos-evidence-\${{ steps.release-version.outputs.artifact-suffix }}
          retention-days: 90
          if-no-files-found: error
          path: |
            desktop/release/release-evidence.json
            desktop/release/release-notes-evidence.md
      - name: Upload supplemental release diagnostics
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: claude-code-desktop-macos-diagnostics-\${{ steps.release-version.outputs.artifact-suffix }}
          retention-days: 90
          if-no-files-found: ignore
          path: |
            desktop/release/ux-validation-evidence.md
            desktop/release/SHA256SUMS
            desktop/release/ux-screenshots/**/*.png
      - name: Upload signed release artifacts
        uses: actions/upload-artifact@v4
        if: success()
        with:
          name: claude-code-desktop-macos-artifacts-\${{ steps.release-version.outputs.artifact-suffix }}
          retention-days: 90
          if-no-files-found: error
          path: |
            desktop/release/Claude Code Desktop-\${{ steps.release-version.outputs.version }}-app-bundle.tar.gz
            desktop/release/Claude Code Desktop-\${{ steps.release-version.outputs.version }}-*.dmg
            desktop/release/Claude Code Desktop-\${{ steps.release-version.outputs.version }}-*-mac.zip
  publish-release:
    needs: macos-release
    if: success()
    runs-on: ubuntu-latest
    environment: desktop-release
    timeout-minutes: 20
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Resolve Bun version
        id: bun-version
        run: |
          bun_version="$(node -e "const pm=require('./package.json').packageManager||''; const match=/^bun@(.+)$/.exec(pm); if (!match) throw new Error('packageManager must be bun@<version>'); console.log(match[1])")"
          echo "version=$bun_version" >> "$GITHUB_OUTPUT"
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: \${{ steps.bun-version.outputs.version }}
      - name: Download signed release artifacts
        uses: actions/download-artifact@v4
        with:
          name: claude-code-desktop-macos-artifacts-\${{ needs.macos-release.outputs.artifact-suffix }}
          path: desktop/release/publish/artifacts
      - name: Download release evidence
        uses: actions/download-artifact@v4
        with:
          name: claude-code-desktop-macos-evidence-\${{ needs.macos-release.outputs.artifact-suffix }}
          path: desktop/release/publish/evidence
      - name: Download release diagnostics
        uses: actions/download-artifact@v4
        with:
          name: claude-code-desktop-macos-diagnostics-\${{ needs.macos-release.outputs.artifact-suffix }}
          path: desktop/release/publish/diagnostics
      - name: Verify release checksums before publishing
        run: |
          set -euo pipefail
          cd desktop/release/publish/artifacts
          sha256sum --check ../diagnostics/SHA256SUMS --strict
          compgen -G "Claude Code Desktop-\${{ needs.macos-release.outputs.version }}-*.dmg" >/dev/null
          compgen -G "Claude Code Desktop-\${{ needs.macos-release.outputs.version }}-*-mac.zip" >/dev/null
      - name: Verify release evidence before publishing
        env:
          EXPECTED_RELEASE_VERSION: \${{ needs.macos-release.outputs.version }}
          EXPECTED_REPOSITORY: \${{ github.repository }}
          EXPECTED_REF_NAME: \${{ github.ref_name }}
          EXPECTED_REF_TYPE: \${{ github.ref_type }}
          EXPECTED_EVENT_NAME: \${{ github.event_name }}
          EXPECTED_COMMIT: \${{ github.sha }}
          EXPECTED_RUN_ID: \${{ github.run_id }}
          EXPECTED_RUN_ATTEMPT: \${{ github.run_attempt }}
          EXPECTED_RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}/attempts/\${{ github.run_attempt }}
        run: |
          set -euo pipefail
          node <<'NODE'
          const { createHash } = require('node:crypto')
          const { readFileSync } = require('node:fs')
          const { basename, join } = require('node:path')
          function verifyEvidenceFile(label, expected, path) {
            if (!expected || !expected.sha256 || typeof expected.sizeBytes !== 'number') {
              throw new Error(\`release evidence is missing \${label} file metadata\`)
            }
            const contents = readFileSync(path)
            const actualSha256 = createHash('sha256').update(contents).digest('hex')
            if (contents.byteLength !== expected.sizeBytes || actualSha256 !== expected.sha256) {
              throw new Error(\`\${label} did not match release evidence metadata\`)
            }
          }
          function verifyScreenshotEvidence(screenshots) {
            if (!Array.isArray(screenshots) || screenshots.length === 0) {
              throw new Error('release evidence is missing UX screenshot metadata')
            }
            for (const screenshot of screenshots) {
              verifyEvidenceFile(
                \`UX screenshot \${basename(screenshot.path || '<missing>')}\`,
                screenshot,
                join('desktop/release/publish/diagnostics/ux-screenshots', basename(screenshot.path || '')),
              )
            }
          }
          function requireSourceField(source, field, expected) {
            if (String(source?.[field] || '') !== String(expected || '')) {
              throw new Error(\`release evidence source.\${field} \${source?.[field] || '<missing>'} did not match \${expected || '<missing>'}\`)
            }
          }
          const evidencePath = 'desktop/release/publish/evidence/release-evidence.json'
          const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
          const expectedVersion = process.env.EXPECTED_RELEASE_VERSION
          if (evidence.releaseVersion !== expectedVersion) {
            throw new Error(\`release evidence version \${evidence.releaseVersion || '<missing>'} did not match \${expectedVersion}\`)
          }
          if (evidence.evidencePurpose === 'preflight-only') {
            throw new Error('release evidence is preflight-only and cannot be published')
          }
          const source = evidence.source || {}
          requireSourceField(source, 'repository', process.env.EXPECTED_REPOSITORY)
          requireSourceField(source, 'refName', process.env.EXPECTED_REF_NAME)
          requireSourceField(source, 'refType', process.env.EXPECTED_REF_TYPE)
          requireSourceField(source, 'eventName', process.env.EXPECTED_EVENT_NAME)
          requireSourceField(source, 'commit', process.env.EXPECTED_COMMIT)
          requireSourceField(source, 'ciRunId', process.env.EXPECTED_RUN_ID)
          requireSourceField(source, 'ciRunAttempt', process.env.EXPECTED_RUN_ATTEMPT)
          requireSourceField(source, 'ciRunUrl', process.env.EXPECTED_RUN_URL)
          const steps = new Map((evidence.steps || []).map(step => [step.id, step]))
          for (const id of ['verify-release', 'final-verify-release']) {
            const step = steps.get(id)
            if (!step || step.status !== 'pass' || step.exitCode !== 0) {
              throw new Error(\`\${id} did not pass in release evidence\`)
            }
          }
          const checks = new Map((evidence.artifactVerificationChecks || []).map(check => [check.id, check]))
          for (const id of ['mac-app-notarization', 'mac-dmg-notarization', 'mac-app-gatekeeper', 'mac-dmg-gatekeeper']) {
            const check = checks.get(id)
            if (!check || check.status !== 'pass') {
              throw new Error(\`\${id} did not pass in release evidence\`)
            }
          }
          verifyEvidenceFile('checksum manifest', evidence.checksumManifest, 'desktop/release/publish/diagnostics/SHA256SUMS')
          verifyEvidenceFile('release notes evidence', evidence.releaseNotesEvidence, 'desktop/release/publish/evidence/release-notes-evidence.md')
          verifyEvidenceFile('UX validation evidence', evidence.uxValidationEvidence, 'desktop/release/publish/diagnostics/ux-validation-evidence.md')
          verifyScreenshotEvidence(evidence.uxScreenshots)
          NODE
      - name: Prepare UX screenshot release evidence archive
        run: |
          set -euo pipefail
          cd desktop/release/publish/diagnostics
          test -d ux-screenshots
          find ux-screenshots -type f -name '*.png' -print0 | LC_ALL=C sort -z | xargs -0 touch -t 198001010000
          find ux-screenshots -type f -name '*.png' | LC_ALL=C sort > ux-screenshots.files
          test -s ux-screenshots.files
          zip -X -q ux-screenshots.zip -@ < ux-screenshots.files
          rm ux-screenshots.files
      - name: Create draft GitHub release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: desktop-v\${{ needs.macos-release.outputs.version }}
          name: Claude Code Desktop \${{ needs.macos-release.outputs.version }}
          body_path: desktop/release/publish/evidence/release-notes-evidence.md
          draft: true
          prerelease: false
          fail_on_unmatched_files: true
          files: |
            desktop/release/publish/artifacts/Claude Code Desktop-\${{ needs.macos-release.outputs.version }}-*.dmg
            desktop/release/publish/artifacts/Claude Code Desktop-\${{ needs.macos-release.outputs.version }}-*-mac.zip
            desktop/release/publish/diagnostics/SHA256SUMS
            desktop/release/publish/evidence/release-evidence.json
            desktop/release/publish/evidence/release-notes-evidence.md
            desktop/release/publish/diagnostics/ux-validation-evidence.md
            desktop/release/publish/diagnostics/ux-screenshots.zip
      - name: Verify draft GitHub release assets
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_RELEASE_VERSION: \${{ needs.macos-release.outputs.version }}
        run: |
          set -euo pipefail
          release_tag="desktop-v\${EXPECTED_RELEASE_VERSION}"
          gh release view "$release_tag" \\
            --repo "\${{ github.repository }}" \\
            --json tagName,name,databaseId,url,isDraft,isPrerelease,assets \\
            > desktop/release/publish/github-release.json
          node <<'NODE'
          const { readFileSync } = require('node:fs')
          const release = JSON.parse(readFileSync('desktop/release/publish/github-release.json', 'utf8'))
          const version = process.env.EXPECTED_RELEASE_VERSION
          const expectedTag = \`desktop-v\${version}\`
          const expectedName = \`Claude Code Desktop \${version}\`
          if (release.tagName !== expectedTag) {
            throw new Error(\`published release tag \${release.tagName || '<missing>'} did not match \${expectedTag}\`)
          }
          if (release.name !== expectedName) {
            throw new Error(\`published release name \${release.name || '<missing>'} did not match \${expectedName}\`)
          }
          if (!release.isDraft || release.isPrerelease) {
            throw new Error('release must remain draft and not prerelease until the final production gate passes')
          }
          const assetNames = (release.assets || []).map(asset => asset.name).filter(Boolean)
          const duplicateAssetNames = assetNames.filter((name, index) => assetNames.indexOf(name) !== index)
          if (duplicateAssetNames.length > 0) {
            throw new Error(\`published release has duplicate asset names: \${[...new Set(duplicateAssetNames)].join(', ')}\`)
          }
          function escapeRegExp(value) {
            return value.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')
          }
          function requireExactAsset(name) {
            if (!assetNames.includes(name)) {
              throw new Error(\`published release is missing asset \${name}\`)
            }
          }
          function requireMatchingAsset(label, pattern) {
            if (!assetNames.some(name => pattern.test(name))) {
              throw new Error(\`published release is missing \${label}\`)
            }
          }
          const escapedVersion = escapeRegExp(version)
          requireMatchingAsset('current-version DMG asset', new RegExp(\`^Claude Code Desktop-\${escapedVersion}-.+\\\\.dmg$\`))
          requireMatchingAsset('current-version mac ZIP asset', new RegExp(\`^Claude Code Desktop-\${escapedVersion}-.+-mac\\\\.zip$\`))
          for (const assetName of [
            'SHA256SUMS',
            'release-evidence.json',
            'release-notes-evidence.md',
            'ux-validation-evidence.md',
            'ux-screenshots.zip',
          ]) {
            requireExactAsset(assetName)
          }
          NODE
      - name: Verify published GitHub release downloads
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_RELEASE_VERSION: \${{ needs.macos-release.outputs.version }}
        run: |
          set -euo pipefail
          release_tag="desktop-v\${EXPECTED_RELEASE_VERSION}"
          rm -rf desktop/release/publish/downloaded
          mkdir -p desktop/release/publish/downloaded
          gh release download "$release_tag" \\
            --repo "\${{ github.repository }}" \\
            --dir desktop/release/publish/downloaded \\
            --clobber
          node <<'NODE'
          const { createHash } = require('node:crypto')
          const { readdirSync, readFileSync, statSync } = require('node:fs')
          const { basename, join } = require('node:path')
          function escapeRegExp(value) {
            return value.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')
          }
          function sha256(path) {
            return createHash('sha256').update(readFileSync(path)).digest('hex')
          }
          function findOneFile(dir, pattern, label) {
            const matches = readdirSync(dir)
              .filter(name => pattern.test(name))
              .sort()
            if (matches.length !== 1) {
              throw new Error(\`\${label} expected exactly one match, found \${matches.length}\`)
            }
            return join(dir, matches[0])
          }
          const version = process.env.EXPECTED_RELEASE_VERSION
          const escapedVersion = escapeRegExp(version)
          const artifactsDir = 'desktop/release/publish/artifacts'
          const diagnosticsDir = 'desktop/release/publish/diagnostics'
          const evidenceDir = 'desktop/release/publish/evidence'
          const downloadedDir = 'desktop/release/publish/downloaded'
          const localDmg = findOneFile(artifactsDir, new RegExp(\`^Claude Code Desktop-\${escapedVersion}-.+\\\\.dmg$\`), 'local DMG')
          const localZip = findOneFile(artifactsDir, new RegExp(\`^Claude Code Desktop-\${escapedVersion}-.+-mac\\\\.zip$\`), 'local mac ZIP')
          const expectedFiles = new Map([
            [basename(localDmg), localDmg],
            [basename(localZip), localZip],
            ['SHA256SUMS', join(diagnosticsDir, 'SHA256SUMS')],
            ['release-evidence.json', join(evidenceDir, 'release-evidence.json')],
            ['release-notes-evidence.md', join(evidenceDir, 'release-notes-evidence.md')],
            ['ux-validation-evidence.md', join(diagnosticsDir, 'ux-validation-evidence.md')],
            ['ux-screenshots.zip', join(diagnosticsDir, 'ux-screenshots.zip')],
          ])
          const expectedNames = [...expectedFiles.keys()].sort()
          const downloadedNames = readdirSync(downloadedDir).sort()
          const missing = expectedNames.filter(name => !downloadedNames.includes(name))
          const unexpected = downloadedNames.filter(name => !expectedFiles.has(name))
          if (missing.length > 0 || unexpected.length > 0) {
            throw new Error(\`downloaded release assets mismatch; missing=\${missing.join(', ') || '<none>'}; unexpected=\${unexpected.join(', ') || '<none>'}\`)
          }
          for (const [assetName, localPath] of expectedFiles) {
            const downloadedPath = join(downloadedDir, assetName)
            const localSize = statSync(localPath).size
            const downloadedSize = statSync(downloadedPath).size
            if (localSize !== downloadedSize) {
              throw new Error(\`\${assetName} downloaded size \${downloadedSize} did not match local size \${localSize}\`)
            }
            const localSha256 = sha256(localPath)
            const downloadedSha256 = sha256(downloadedPath)
            if (localSha256 !== downloadedSha256) {
              throw new Error(\`\${assetName} downloaded SHA-256 \${downloadedSha256} did not match local SHA-256 \${localSha256}\`)
            }
          }
          NODE
      - name: Publish post-publish release evidence
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_RELEASE_VERSION: \${{ needs.macos-release.outputs.version }}
          EXPECTED_REPOSITORY: \${{ github.repository }}
          EXPECTED_REF_NAME: \${{ github.ref_name }}
          EXPECTED_REF_TYPE: \${{ github.ref_type }}
          EXPECTED_EVENT_NAME: \${{ github.event_name }}
          EXPECTED_COMMIT: \${{ github.sha }}
          EXPECTED_RUN_ID: \${{ github.run_id }}
          EXPECTED_RUN_ATTEMPT: \${{ github.run_attempt }}
          EXPECTED_RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}/attempts/\${{ github.run_attempt }}
        run: |
          set -euo pipefail
          release_tag="desktop-v\${EXPECTED_RELEASE_VERSION}"
          bun run desktop:write-published-release-evidence
          gh release upload "$release_tag" \\
            desktop/release/publish/published-release-evidence.json \\
            --repo "\${{ github.repository }}" \\
            --clobber
          rm -rf desktop/release/publish/downloaded-evidence
          mkdir -p desktop/release/publish/downloaded-evidence
          gh release download "$release_tag" \\
            --repo "\${{ github.repository }}" \\
            --pattern published-release-evidence.json \\
            --dir desktop/release/publish/downloaded-evidence \\
            --clobber
          bun run desktop:verify-published-release
      - name: Upload published release evidence
        uses: actions/upload-artifact@v4
        with:
          name: claude-code-desktop-published-evidence-\${{ needs.macos-release.outputs.artifact-suffix }}
          retention-days: 90
          if-no-files-found: error
          path: desktop/release/publish/published-release-evidence.json
  production-gate:
    needs: [macos-release, publish-release]
    if: success()
    runs-on: macos-14
    environment: desktop-release
    timeout-minutes: 30
    permissions:
      contents: read
    env:
      DESKTOP_RELEASE_VERSION: \${{ needs.macos-release.outputs.version }}
      CSC_LINK: \${{ secrets.DESKTOP_MAC_CSC_LINK }}
      CSC_KEY_PASSWORD: \${{ secrets.DESKTOP_MAC_CSC_KEY_PASSWORD }}
      CSC_NAME: \${{ secrets.DESKTOP_MAC_CSC_NAME }}
      APPLE_API_KEY: \${{ secrets.DESKTOP_APPLE_API_KEY }}
      APPLE_API_KEY_ID: \${{ secrets.DESKTOP_APPLE_API_KEY_ID }}
      APPLE_API_ISSUER: \${{ secrets.DESKTOP_APPLE_API_ISSUER }}
      APPLE_ID: \${{ secrets.DESKTOP_APPLE_ID }}
      APPLE_APP_SPECIFIC_PASSWORD: \${{ secrets.DESKTOP_APPLE_APP_SPECIFIC_PASSWORD }}
      APPLE_TEAM_ID: \${{ secrets.DESKTOP_APPLE_TEAM_ID }}
      APPLE_KEYCHAIN: \${{ secrets.DESKTOP_APPLE_KEYCHAIN }}
      APPLE_KEYCHAIN_PROFILE: \${{ secrets.DESKTOP_APPLE_KEYCHAIN_PROFILE }}
      DESKTOP_UX_VALIDATION_EVIDENCE_PATH: desktop/release/ux-validation-evidence.md
    steps:
      - uses: actions/checkout@v4
      - name: Resolve Bun version
        id: bun-version
        run: |
          bun_version="$(node -e "const pm=require('./package.json').packageManager||''; const match=/^bun@(.+)$/.exec(pm); if (!match) throw new Error('packageManager must be bun@<version>'); console.log(match[1])")"
          echo "BUN_VERSION=$bun_version" >> "$GITHUB_ENV"
          echo "version=$bun_version" >> "$GITHUB_OUTPUT"
      - name: Resolve Node version
        id: node-version
        run: |
          node_version="$(node -e "const node=require('./package.json').engines?.node||''; if (!/^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(node)) throw new Error('engines.node must be an exact version'); console.log(node)")"
          echo "NODE_VERSION=$node_version" >> "$GITHUB_ENV"
          echo "version=$node_version" >> "$GITHUB_OUTPUT"
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: \${{ steps.bun-version.outputs.version }}
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ steps.node-version.outputs.version }}
      - run: bun install --frozen-lockfile
      - name: Download signed release artifacts
        uses: actions/download-artifact@v4
        with:
          name: claude-code-desktop-macos-artifacts-\${{ needs.macos-release.outputs.artifact-suffix }}
          path: desktop/release
      - name: Restore signed app bundle
        run: |
          set -euo pipefail
          cd desktop/release
          app_bundle_archive="$(find . -maxdepth 1 -type f -name 'Claude Code Desktop-\${{ needs.macos-release.outputs.version }}-app-bundle.tar.gz' | LC_ALL=C sort | head -n 1)"
          test -n "$app_bundle_archive"
          tar -xzf "$app_bundle_archive"
          restored_app="$(find . -maxdepth 2 -type d -name 'Claude Code Desktop.app' | LC_ALL=C sort | head -n 1)"
          test -n "$restored_app"
      - name: Download release evidence
        uses: actions/download-artifact@v4
        with:
          name: claude-code-desktop-macos-evidence-\${{ needs.macos-release.outputs.artifact-suffix }}
          path: desktop/release
      - name: Download release diagnostics
        uses: actions/download-artifact@v4
        with:
          name: claude-code-desktop-macos-diagnostics-\${{ needs.macos-release.outputs.artifact-suffix }}
          path: desktop/release
      - name: Download local published release evidence
        uses: actions/download-artifact@v4
        with:
          name: claude-code-desktop-published-evidence-\${{ needs.macos-release.outputs.artifact-suffix }}
          path: desktop/release/publish
      - name: Download published release assets for final gate
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_RELEASE_VERSION: \${{ needs.macos-release.outputs.version }}
        run: |
          set -euo pipefail
          release_tag="desktop-v\${EXPECTED_RELEASE_VERSION}"
          rm -rf desktop/release/publish/downloaded desktop/release/publish/downloaded-evidence
          mkdir -p desktop/release/publish/downloaded desktop/release/publish/downloaded-evidence
          for pattern in \\
            "Claude Code Desktop-\${EXPECTED_RELEASE_VERSION}-*.dmg" \\
            "Claude Code Desktop-\${EXPECTED_RELEASE_VERSION}-*-mac.zip" \\
            "SHA256SUMS" \\
            "release-evidence.json" \\
            "release-notes-evidence.md" \\
            "ux-validation-evidence.md" \\
            "ux-screenshots.zip"
          do
            gh release download "$release_tag" \\
              --repo "\${{ github.repository }}" \\
              --pattern "$pattern" \\
              --dir desktop/release/publish/downloaded \\
              --clobber
          done
          gh release download "$release_tag" \\
            --repo "\${{ github.repository }}" \\
            --pattern published-release-evidence.json \\
            --dir desktop/release/publish/downloaded-evidence \\
            --clobber
      - name: Run final production gate
        run: bun run desktop:production-gate
      - name: Verify production gate evidence
        if: always()
        run: |
          node desktop/scripts/production-gate.mjs verify \\
            --evidence desktop/release/production-gate-evidence.json \\
            --published-evidence desktop/release/publish/downloaded-evidence/published-release-evidence.json
      - name: Upload production gate evidence
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: claude-code-desktop-production-gate-evidence-\${{ needs.macos-release.outputs.artifact-suffix }}
          retention-days: 90
          if-no-files-found: error
          path: desktop/release/production-gate-evidence.json
  publish-public-release:
    needs: [macos-release, production-gate]
    if: success()
    runs-on: ubuntu-latest
    environment: desktop-release
    timeout-minutes: 10
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Resolve Bun version
        id: bun-version
        run: |
          bun_version="$(node -e "const pm=require('./package.json').packageManager||''; const match=/^bun@(.+)$/.exec(pm); if (!match) throw new Error('packageManager must be bun@<version>'); console.log(match[1])")"
          echo "version=$bun_version" >> "$GITHUB_OUTPUT"
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: \${{ steps.bun-version.outputs.version }}
      - name: Download production gate evidence
        uses: actions/download-artifact@v4
        with:
          name: claude-code-desktop-production-gate-evidence-\${{ needs.macos-release.outputs.artifact-suffix }}
          path: public-release-input
      - name: Download published release evidence
        uses: actions/download-artifact@v4
        with:
          name: claude-code-desktop-published-evidence-\${{ needs.macos-release.outputs.artifact-suffix }}
          path: public-release-input/published-evidence
      - name: Verify downloaded production gate evidence
        run: node desktop/scripts/production-gate.mjs verify --evidence public-release-input/production-gate-evidence.json --published-evidence public-release-input/published-evidence/published-release-evidence.json
      - name: Publish verified release
        env:
          GH_TOKEN: \${{ github.token }}
          EXPECTED_RELEASE_VERSION: \${{ needs.macos-release.outputs.version }}
          EXPECTED_REPOSITORY: \${{ github.repository }}
          EXPECTED_REF_NAME: \${{ github.ref_name }}
          EXPECTED_REF_TYPE: \${{ github.ref_type }}
          EXPECTED_EVENT_NAME: \${{ github.event_name }}
          EXPECTED_COMMIT: \${{ github.sha }}
          EXPECTED_RUN_ID: \${{ github.run_id }}
          EXPECTED_RUN_ATTEMPT: \${{ github.run_attempt }}
          EXPECTED_RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}/attempts/\${{ github.run_attempt }}
        run: |
          set -euo pipefail
          release_tag="desktop-v\${EXPECTED_RELEASE_VERSION}"
          gh release upload "$release_tag" \\
            public-release-input/production-gate-evidence.json \\
            --repo "\${{ github.repository }}" \\
            --clobber
          rm -rf public-release-output/downloaded-gate-evidence
          mkdir -p public-release-output/downloaded-gate-evidence
          gh release download "$release_tag" \\
            --repo "\${{ github.repository }}" \\
            --pattern production-gate-evidence.json \\
            --dir public-release-output/downloaded-gate-evidence \\
            --clobber
          node <<'NODE'
          const { createHash } = require('node:crypto')
          const { readFileSync, statSync } = require('node:fs')
          function sha256(path) {
            return createHash('sha256').update(readFileSync(path)).digest('hex')
          }
          const localPath = 'public-release-input/production-gate-evidence.json'
          const downloadedPath = 'public-release-output/downloaded-gate-evidence/production-gate-evidence.json'
          const localSize = statSync(localPath).size
          const downloadedSize = statSync(downloadedPath).size
          if (localSize !== downloadedSize) {
            throw new Error(\`uploaded production-gate-evidence.json size \${downloadedSize} did not match local size \${localSize}\`)
          }
          const localSha256 = sha256(localPath)
          const downloadedSha256 = sha256(downloadedPath)
          if (localSha256 !== downloadedSha256) {
            throw new Error(\`uploaded production-gate-evidence.json SHA-256 \${downloadedSha256} did not match local SHA-256 \${localSha256}\`)
          }
          NODE
          gh release edit "$release_tag" \\
            --repo "\${{ github.repository }}" \\
            --draft=false \\
            --prerelease=false
          gh release view "$release_tag" \\
            --repo "\${{ github.repository }}" \\
            --json tagName,name,databaseId,url,isDraft,isPrerelease,assets \\
            > public-release.json
          node <<'NODE'
          const { readFileSync } = require('node:fs')
          const release = JSON.parse(readFileSync('public-release.json', 'utf8'))
          const version = process.env.EXPECTED_RELEASE_VERSION
          const expectedTag = \`desktop-v\${version}\`
          const expectedName = \`Claude Code Desktop \${version}\`
          if (release.tagName !== expectedTag || release.name !== expectedName) {
            throw new Error(\`public release identity mismatch: tag=\${release.tagName || '<missing>'} name=\${release.name || '<missing>'}\`)
          }
          if (release.isDraft || release.isPrerelease) {
            throw new Error('public release must not be draft or prerelease')
          }
          const assetNames = (release.assets || []).map(asset => asset.name).filter(Boolean)
          function escapeRegExp(value) {
            return value.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')
          }
          function requireExactAsset(name) {
            if (!assetNames.includes(name)) {
              throw new Error(\`public release is missing asset \${name}\`)
            }
          }
          function requireMatchingAsset(label, pattern) {
            if (!assetNames.some(name => pattern.test(name))) {
              throw new Error(\`public release is missing \${label}\`)
            }
          }
          const escapedVersion = escapeRegExp(version)
          requireMatchingAsset('current-version DMG asset', new RegExp(\`^Claude Code Desktop-\${escapedVersion}-.+\\\\.dmg$\`))
          requireMatchingAsset('current-version mac ZIP asset', new RegExp(\`^Claude Code Desktop-\${escapedVersion}-.+-mac\\\\.zip$\`))
          for (const assetName of [
            'SHA256SUMS',
            'release-evidence.json',
            'release-notes-evidence.md',
            'ux-validation-evidence.md',
            'ux-screenshots.zip',
            'production-gate-evidence.json',
            'published-release-evidence.json',
          ]) {
            requireExactAsset(assetName)
          }
          NODE
          rm -rf public-release-output/downloaded-public-release
          mkdir -p public-release-output/downloaded-public-release
          gh release download "$release_tag" \\
            --repo "\${{ github.repository }}" \\
            --dir public-release-output/downloaded-public-release \\
            --clobber
          node <<'NODE'
          const { createHash } = require('node:crypto')
          const { readdirSync, readFileSync, statSync } = require('node:fs')
          const { join } = require('node:path')
          function sha256(path) {
            return createHash('sha256').update(readFileSync(path)).digest('hex')
          }
          function fileSummary(path) {
            return {
              sizeBytes: statSync(path).size,
              sha256: sha256(path),
            }
          }
          const downloadedDir = 'public-release-output/downloaded-public-release'
          const publishedEvidencePath = 'public-release-input/published-evidence/published-release-evidence.json'
          const publishedEvidence = JSON.parse(readFileSync(publishedEvidencePath, 'utf8'))
          const expectedAssets = new Map()
          for (const asset of publishedEvidence.verifiedAssets || []) {
            expectedAssets.set(asset.name, {
              sizeBytes: asset.sizeBytes,
              sha256: asset.sha256,
            })
          }
          expectedAssets.set('production-gate-evidence.json', fileSummary('public-release-input/production-gate-evidence.json'))
          expectedAssets.set('published-release-evidence.json', fileSummary(publishedEvidencePath))
          const expectedNames = [...expectedAssets.keys()].sort()
          const downloadedNames = readdirSync(downloadedDir).sort()
          const missing = expectedNames.filter(name => !downloadedNames.includes(name))
          const unexpected = downloadedNames.filter(name => !expectedAssets.has(name))
          if (missing.length > 0 || unexpected.length > 0) {
            throw new Error(\`final public release assets mismatch; missing=\${missing.join(', ') || '<none>'}; unexpected=\${unexpected.join(', ') || '<none>'}\`)
          }
          for (const [assetName, expected] of expectedAssets) {
            const downloadedPath = join(downloadedDir, assetName)
            const downloadedSize = statSync(downloadedPath).size
            if (downloadedSize !== expected.sizeBytes) {
              throw new Error(\`final public asset size \${downloadedSize} did not match expected size \${expected.sizeBytes}: \${assetName}\`)
            }
            const downloadedSha256 = sha256(downloadedPath)
            if (downloadedSha256 !== expected.sha256) {
              throw new Error(\`final public asset SHA-256 \${downloadedSha256} did not match expected SHA-256 \${expected.sha256}: \${assetName}\`)
            }
          }
          NODE
          bun run desktop:write-public-release-evidence
          bun run desktop:verify-public-release
          node desktop/scripts/published-release-evidence.mjs verify-public \\
            --evidence public-release-evidence.json \\
            --production-gate-evidence public-release-input/production-gate-evidence.json \\
            --published-evidence public-release-input/published-evidence/published-release-evidence.json
      - name: Upload public release evidence
        uses: actions/upload-artifact@v4
        with:
          name: claude-code-desktop-public-release-evidence-\${{ needs.macos-release.outputs.artifact-suffix }}
          retention-days: 90
          if-no-files-found: error
          path: public-release-evidence.json
`

  it('enables hardened runtime and notarization for macOS release builds', () => {
    expect(builderConfig.mac.hardenedRuntime).toBe(true)
    expect(builderConfig.mac.forceCodeSigning).toBe(true)
    expect(builderConfig.mac.notarize).toBe(true)
    expect(builderConfig.mac.target).toEqual(expect.arrayContaining(['dmg', 'zip']))
  })

  it('excludes node-pty tests and sourcemaps from packaged extra resources', () => {
    const nodePtyResource = builderConfig.extraResources.find(resource =>
      resource.from === 'node_modules/node-pty',
    )

    expect(nodePtyResource?.filter).toEqual(expect.arrayContaining([
      '!lib/**/*.test.js',
      '!lib/**/*.test.js.map',
      '!lib/**/*.map',
    ]))
  })

  it('does not package node-addon-api build-time headers', () => {
    expect(builderConfig.files).not.toContain('node_modules/node-addon-api/**/*')
  })

  it('declares the asar inspection tool as an explicit release dependency', () => {
    expect(packageJson.devDependencies).toHaveProperty('@electron/asar')
  })

  it('pins the Bun release toolchain version', () => {
    expect(packageJson.packageManager).toMatch(/^bun@\d+\.\d+\.\d+/)
  })

  it('pins the Node release toolchain version', () => {
    expect(packageJson.engines?.node).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('commits the Bun lockfile used by release CI', () => {
    expect(existsSync(new URL('../../bun.lock', import.meta.url))).toBe(true)
  })

  it('exposes release preflight as a package script', async () => {
    const readinessSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8'))

    expect(packageJson.scripts?.['desktop:release-preflight']).toBe('node desktop/scripts/release-ci.mjs preflight:all')
    expect(readinessSource).toContain('desktop:release-preflight')
    expect(packageJson.scripts?.['desktop:prod-check']).toBe('node desktop/scripts/production-readiness.mjs')
    expect(packageJson.scripts?.['desktop:write-published-release-evidence']).toBe('node desktop/scripts/published-release-evidence.mjs generate --release-json desktop/release/publish/github-release.json --downloaded-dir desktop/release/publish/downloaded --output desktop/release/publish/published-release-evidence.json')
    expect(packageJson.scripts?.['desktop:verify-published-release']).toBe('node desktop/scripts/published-release-evidence.mjs verify --local desktop/release/publish/published-release-evidence.json --evidence desktop/release/publish/downloaded-evidence/published-release-evidence.json --downloaded-dir desktop/release/publish/downloaded')
    expect(packageJson.scripts?.['desktop:write-public-release-evidence']).toBe('node desktop/scripts/published-release-evidence.mjs generate-public --release-json public-release.json --output public-release-evidence.json')
    expect(packageJson.scripts?.['desktop:verify-public-release']).toBe('node desktop/scripts/published-release-evidence.mjs verify-public --evidence public-release-evidence.json --production-gate-evidence public-release-input/production-gate-evidence.json --published-evidence public-release-input/published-evidence/published-release-evidence.json')
    expect(packageJson.scripts?.['desktop:production-gate']).toBe('node desktop/scripts/production-gate.mjs')
    expect(packageJson.scripts?.['desktop:verify-production-gate-evidence']).toBe('node desktop/scripts/production-gate.mjs verify --evidence desktop/release/production-gate-evidence.json --published-evidence desktop/release/publish/downloaded-evidence/published-release-evidence.json')
    expect(readinessSource).toContain('desktop:prod-check')
    expect(readinessSource).toContain('desktop:write-published-release-evidence')
    expect(readinessSource).toContain('desktop:verify-published-release')
    expect(readinessSource).toContain('desktop:write-public-release-evidence')
    expect(readinessSource).toContain('desktop:verify-public-release')
    expect(readinessSource).toContain('desktop:production-gate')
    expect(readinessSource).toContain('desktop:verify-production-gate-evidence')
    expect(readinessSource).toContain('expectedScriptCommands')
    expect(readinessSource).toContain('node desktop/scripts/release-ci.mjs preflight:all')
    expect(readinessSource).toContain('node desktop/scripts/production-readiness.mjs')
    expect(readinessSource).toContain('node desktop/scripts/published-release-evidence.mjs generate')
    expect(readinessSource).toContain('node desktop/scripts/published-release-evidence.mjs verify')
    expect(readinessSource).toContain('node desktop/scripts/published-release-evidence.mjs generate-public')
    expect(readinessSource).toContain('node desktop/scripts/published-release-evidence.mjs verify-public')
    expect(readinessSource).toContain('--production-gate-evidence public-release-input/production-gate-evidence.json')
    expect(readinessSource).toContain('--published-evidence public-release-input/published-evidence/published-release-evidence.json')
    expect(readinessSource).toContain('node desktop/scripts/production-gate.mjs verify')
    expect(readinessSource).toContain('--published-evidence desktop/release/publish/downloaded-evidence/published-release-evidence.json')
    expect(readinessSource).toContain('public-release-evidence')
    expect(readinessSource).toContain('publicAssets')
    expect(readinessSource).toContain('isExpectedGitHubReleaseAssetUrl')
    expect(readinessSource).toContain('/^\\\\d+$/.test(assetId)')
    expect(readinessSource).toContain('asset URL outside expected repository')
    expect(readinessSource).toContain('invalid GitHub Release asset URL')
    expect(readinessSource).toContain('duplicate public asset URLs')
    expect(readinessSource).toContain('public asset metadata must match sorted asset names')
    expect(readinessSource).toContain('refName')
    expect(readinessSource).toContain('commit')
    expect(readinessSource).toContain('node desktop/scripts/production-gate.mjs')
  })

  it('defines a final production release gate over all required release checks', async () => {
    const readinessSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8'))
    const productionGateSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/production-gate.mjs', import.meta.url), 'utf8'))

    expect(productionGateSteps.map(step => step.kind ?? step.args.join(' '))).toEqual([
      'run desktop:prod-check',
      'preflight',
      'run desktop:verify-release',
      'run desktop:verify-published-release',
    ])
    expect(readinessSource).toContain('production-gate')
    expect(productionGateSource).toContain('productionGateSteps')
    expect(productionGateSource).toContain('desktop:prod-check')
    expect(productionGateSource).toContain('releasePreflightRecords')
    expect(productionGateSource).not.toContain("args: ['run', 'desktop:release-preflight']")
    expect(productionGateSource).toContain('desktop:verify-release')
    expect(productionGateSource).toContain('desktop:verify-published-release')
    expect(productionGateSource).toContain('buildProductionGateEvidence')
    expect(productionGateSource).toContain('validateProductionGateEvidence')
    expect(productionGateSource).toContain('production-gate-evidence.json')
    expect(productionGateSource).toContain('production-gate-verification')
    expect(productionGateSource).toContain("command === 'verify'")
  })

  it('stops the final production release gate at the first failing step', () => {
    const calls: string[] = []
    const exitCode = runProductionGate({
      stdio: 'pipe',
      run: (command, args) => {
        calls.push([command, ...args].join(' '))
        return {
          status: calls.length === 1 ? 1 : 0,
        }
      },
    })

    expect(exitCode).toBe(1)
    expect(calls).toEqual([
      'bun run desktop:prod-check',
    ])
  })

  it('writes final production gate evidence when all gates pass', () => {
    const writtenEvidence: unknown[] = []
    const exitCode = runProductionGate({
      stdio: 'pipe',
      now: () => '2026-07-17T00:00:00.000Z',
      env: {
        EXPECTED_RELEASE_VERSION: '1.2.3',
        GITHUB_REPOSITORY: 'anthropic/claude-code',
        GITHUB_REF_NAME: 'desktop-v1.2.3',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123',
      },
      preflightRecords: () => [
        { id: 'release-env', status: 'pass' },
        { id: 'release-machine', status: 'pass' },
      ],
      run: () => ({ status: 0 }),
      writeEvidence: evidence => writtenEvidence.push(evidence),
    })

    expect(exitCode).toBe(0)
    expect(writtenEvidence).toEqual([
      expect.objectContaining({
        schemaVersion: 1,
        product: 'Claude Code Desktop',
        evidenceKind: 'production-gate-verification',
        generatedAt: '2026-07-17T00:00:00.000Z',
        releaseVersion: '1.2.3',
        status: 'pass',
        repository: 'anthropic/claude-code',
        refName: 'desktop-v1.2.3',
        refType: 'tag',
        eventName: 'push',
        ciRunId: '12345',
        ciRunAttempt: '2',
        ciRunUrl: 'https://github.com/anthropic/claude-code/actions/runs/12345/attempts/2',
        commit: 'abc123',
      }),
    ])
    expect((writtenEvidence[0] as { steps: Array<{ id: string, status: string }> }).steps).toEqual([
      { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
      { id: 'release-preflight', status: 'pass', records: [{ id: 'release-env', status: 'pass' }, { id: 'release-machine', status: 'pass' }] },
      { id: 'verify-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-release'], exitCode: 0 },
      { id: 'verify-published-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-published-release'], exitCode: 0 },
    ])
  })

  it('runs the final production release gate preflight without spawning the cleaning preflight script', () => {
    const calls: string[] = []
    const writtenEvidence: unknown[] = []
    const exitCode = runProductionGate({
      stdio: 'pipe',
      now: () => '2026-07-17T00:00:00.000Z',
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        GITHUB_REPOSITORY: 'anthropic/claude-code',
        GITHUB_REF_NAME: 'desktop-v1.2.3',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123',
      },
      preflightRecords: () => [{
        id: 'release-machine',
        status: 'fail',
        failures: ['missing notarytool'],
      }],
      run: (command, args) => {
        calls.push([command, ...args].join(' '))
        return { status: 0 }
      },
      writeEvidence: evidence => writtenEvidence.push(evidence),
    })

    expect(exitCode).toBe(1)
    expect(calls).toEqual([
      'bun run desktop:prod-check',
    ])
    expect(writtenEvidence).toEqual([
      expect.objectContaining({
        evidenceKind: 'production-gate-verification',
        status: 'fail',
        failure: 'release-preflight failed',
        steps: [
          { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
          { id: 'release-preflight', status: 'fail', records: [{ id: 'release-machine', status: 'fail', failures: ['missing notarytool'] }] },
        ],
      }),
    ])
  })

  it('writes final production gate evidence when a gate command fails to start', () => {
    const calls: string[] = []
    const writtenEvidence: unknown[] = []
    const exitCode = runProductionGate({
      stdio: 'pipe',
      now: () => '2026-07-17T00:00:00.000Z',
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        GITHUB_REPOSITORY: 'anthropic/claude-code',
        GITHUB_REF_NAME: 'desktop-v1.2.3',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123',
      },
      preflightRecords: () => [{ id: 'release-machine', status: 'pass' }],
      run: (command, args) => {
        calls.push([command, ...args].join(' '))
        return calls.length === 2
          ? { error: new Error('spawn ENOENT') }
          : { status: 0 }
      },
      writeEvidence: evidence => writtenEvidence.push(evidence),
    })

    expect(exitCode).toBe(1)
    expect(calls).toEqual([
      'bun run desktop:prod-check',
      'bun run desktop:verify-release',
    ])
    expect(writtenEvidence).toEqual([
      expect.objectContaining({
        evidenceKind: 'production-gate-verification',
        status: 'fail',
        failure: 'verify-release failed to start',
        steps: [
          { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
          { id: 'release-preflight', status: 'pass', records: [{ id: 'release-machine', status: 'pass' }] },
          { id: 'verify-release', status: 'fail', command: 'bun', args: ['run', 'desktop:verify-release'], error: 'spawn ENOENT' },
        ],
      }),
    ])
    expect(validateProductionGateEvidence(writtenEvidence[0])).toEqual([])
  })

  it('builds production gate evidence with GitHub CI source metadata', () => {
    expect(buildProductionGateEvidence({
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        GITHUB_REPOSITORY: 'anthropic/claude-code',
        GITHUB_REF_NAME: 'desktop-v1.2.3',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123',
      },
      status: 'pass',
      steps: [],
    })).toMatchObject({
      schemaVersion: 1,
      product: 'Claude Code Desktop',
      evidenceKind: 'production-gate-verification',
      releaseVersion: '1.2.3',
      repository: 'anthropic/claude-code',
      refName: 'desktop-v1.2.3',
      refType: 'tag',
      eventName: 'push',
      ciRunId: '12345',
      ciRunAttempt: '2',
      ciRunUrl: 'https://github.com/anthropic/claude-code/actions/runs/12345/attempts/2',
      commit: 'abc123',
      status: 'pass',
      steps: [],
    })
  })

  it('validates production gate evidence content', () => {
    const evidence = buildProductionGateEvidence({
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        GITHUB_REPOSITORY: 'anthropic/claude-code',
        GITHUB_REF_NAME: 'desktop-v1.2.3',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123',
      },
      status: 'pass',
      steps: [
        { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
        { id: 'release-preflight', status: 'pass', records: [{ id: 'release-machine', status: 'pass' }] },
        { id: 'verify-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-release'], exitCode: 0 },
        { id: 'verify-published-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-published-release'], exitCode: 0 },
      ],
    })

    expect(validateProductionGateEvidence(evidence)).toEqual([])
  })

  it('rejects contradictory production gate step exit details', () => {
    const evidence = buildProductionGateEvidence({
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        GITHUB_REPOSITORY: 'anthropic/claude-code',
        GITHUB_REF_NAME: 'desktop-v1.2.3',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123',
      },
      status: 'fail',
      failure: 'verify-release failed',
      steps: [
        { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 1 },
        { id: 'release-preflight', status: 'pass', records: [{ id: 'release-machine', status: 'fail' }] },
        { id: 'verify-release', status: 'fail', command: 'bun', args: ['run', 'desktop:verify-release'], exitCode: 0 },
      ],
    })

    expect(validateProductionGateEvidence(evidence)).toEqual([
      'production-gate-evidence.json has invalid pass exit code for prod-check',
      'production-gate-evidence.json has invalid pass preflight records',
      'production-gate-evidence.json has invalid fail exit code for verify-release',
    ])
  })

  it('rejects production gate evidence that continues after a failed step', () => {
    const evidence = buildProductionGateEvidence({
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        GITHUB_REPOSITORY: 'anthropic/claude-code',
        GITHUB_REF_NAME: 'desktop-v1.2.3',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123',
      },
      status: 'fail',
      failure: 'prod-check failed',
      steps: [
        { id: 'prod-check', status: 'fail', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 1 },
        { id: 'release-preflight', status: 'pass', records: [{ id: 'release-machine', status: 'pass' }] },
      ],
    })

    expect(validateProductionGateEvidence(evidence)).toContain(
      'production-gate-evidence.json failed gates must stop at the first failed step',
    )
  })

  it('rejects passing production gate evidence with failure details', () => {
    const evidence = buildProductionGateEvidence({
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        GITHUB_REPOSITORY: 'anthropic/claude-code',
        GITHUB_REF_NAME: 'desktop-v1.2.3',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123',
      },
      status: 'pass',
      failure: 'stale failure',
      steps: [
        { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
        { id: 'release-preflight', status: 'pass', records: [{ id: 'release-machine', status: 'pass' }] },
        { id: 'verify-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-release'], exitCode: 0 },
        { id: 'verify-published-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-published-release'], exitCode: 0 },
      ],
    })

    expect(validateProductionGateEvidence(evidence)).toContain(
      'production-gate-evidence.json pass gates must not record failure',
    )
  })

  it('rejects production gate evidence that is not bound to the published release evidence source', () => {
    const evidence = buildProductionGateEvidence({
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
      status: 'pass',
      steps: [
        { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
        { id: 'release-preflight', status: 'pass', records: [{ id: 'release-machine', status: 'pass' }] },
        { id: 'verify-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-release'], exitCode: 0 },
        { id: 'verify-published-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-published-release'], exitCode: 0 },
      ],
    })
    const publishedEvidence = buildPublishedReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
      },
      downloadedDir: '/downloaded',
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: {
        ...publishedReleaseEnv,
        EXPECTED_COMMIT: 'different',
      },
      readDir: () => [...publishedReleaseAssets.keys()],
      readFile: publishedReleaseReadFile,
      stat: publishedReleaseStat,
    })

    expect(validateProductionGateEvidence(evidence, { publishedReleaseEvidence: publishedEvidence })).toContain(
      'production-gate-evidence.json does not match published-release-evidence.json CI source metadata: commit',
    )
  })

  it('rejects production gate evidence when the bound published release evidence is malformed', () => {
    const evidence = buildProductionGateEvidence({
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
      status: 'pass',
      steps: [
        { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
        { id: 'release-preflight', status: 'pass', records: [{ id: 'release-machine', status: 'pass' }] },
        { id: 'verify-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-release'], exitCode: 0 },
        { id: 'verify-published-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-published-release'], exitCode: 0 },
      ],
    })
    const malformedPublishedEvidence = buildPublishedReleaseEvidence({
      release: {
        tagName: 'desktop-v1.2.3',
        name: 'Claude Code Desktop 1.2.3',
      },
      downloadedDir: '/downloaded',
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: publishedReleaseEnv,
      readDir: () => [...publishedReleaseAssets.keys()].filter(name => name !== 'SHA256SUMS'),
      readFile: publishedReleaseReadFile,
      stat: publishedReleaseStat,
    })

    expect(validateProductionGateEvidence(evidence, {
      publishedReleaseEvidence: malformedPublishedEvidence,
    })).toContain('published-release-evidence.json is missing verified asset SHA256SUMS')
  })

  it('rejects malformed production gate evidence', () => {
    const evidence = buildProductionGateEvidence({
      generatedAt: 'invalid-date',
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
      },
      status: 'pass',
      steps: [
        { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
        { id: 'verify-release', status: 'fail', command: 'bun', args: ['run', 'desktop:verify-release'], exitCode: 1 },
        { id: 'release-preflight', status: 'pass', records: [] },
      ],
    })

    expect(validateProductionGateEvidence(evidence)).toEqual(expect.arrayContaining([
      'production-gate-evidence.json has invalid generatedAt metadata',
      'production-gate-evidence.json has invalid CI source metadata: repository',
      'production-gate-evidence.json has invalid CI source metadata: refName',
      'production-gate-evidence.json has invalid CI source metadata: refType',
      'production-gate-evidence.json has invalid CI source metadata: eventName',
      'production-gate-evidence.json has invalid CI source metadata: ciRunId',
      'production-gate-evidence.json has invalid CI source metadata: ciRunAttempt',
      'production-gate-evidence.json has invalid CI source metadata: ciRunUrl',
      'production-gate-evidence.json has invalid CI source metadata: commit',
      'production-gate-evidence.json step order is invalid',
      'production-gate-evidence.json status is pass but includes failed steps',
    ]))
  })

  it('rejects production gate evidence with stale release source metadata', () => {
    const evidence = buildProductionGateEvidence({
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        GITHUB_REPOSITORY: 'anthropic/claude-code',
        GITHUB_REF_NAME: 'main',
        GITHUB_REF_TYPE: 'branch',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123',
      },
      status: 'pass',
      steps: [
        { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
        { id: 'release-preflight', status: 'pass', records: [{ id: 'release-machine', status: 'pass' }] },
        { id: 'verify-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-release'], exitCode: 0 },
        { id: 'verify-published-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-published-release'], exitCode: 0 },
      ],
    })

    expect(validateProductionGateEvidence(evidence)).toEqual(expect.arrayContaining([
      'production-gate-evidence.json has invalid CI source metadata: refName',
      'production-gate-evidence.json has invalid CI source metadata: refType',
    ]))
  })

  it('allows production gate evidence from manual workflow dispatch refs', () => {
    const evidence = buildProductionGateEvidence({
      generatedAt: '2026-07-17T00:00:00.000Z',
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        GITHUB_REPOSITORY: 'anthropic/claude-code',
        GITHUB_REF_NAME: 'main',
        GITHUB_REF_TYPE: 'branch',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_SHA: 'abc123',
      },
      status: 'pass',
      steps: [
        { id: 'prod-check', status: 'pass', command: 'bun', args: ['run', 'desktop:prod-check'], exitCode: 0 },
        { id: 'release-preflight', status: 'pass', records: [{ id: 'release-machine', status: 'pass' }] },
        { id: 'verify-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-release'], exitCode: 0 },
        { id: 'verify-published-release', status: 'pass', command: 'bun', args: ['run', 'desktop:verify-published-release'], exitCode: 0 },
      ],
    })

    expect(validateProductionGateEvidence(evidence)).toEqual([])
  })

  it('keeps release notes template and runbook aligned with release gates', async () => {
    const [releaseNotesTemplate, releaseRunbook, readinessSource] = await Promise.all([
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../../docs/desktop-release-notes-template.md', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../../docs/desktop-release-runbook.md', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8')),
    ])

    for (const snippet of [
      'bun run check',
      'bun run desktop:release-preflight',
      'bun run desktop:prod-check',
      'bun run desktop:production-gate',
      'production-gate-evidence.json',
      'bun run desktop:verify-production-gate-evidence',
      'bun run desktop:verify-release',
      'published-release-evidence.json',
      'public-release-evidence.json',
      'draft GitHub Release asset verification',
      'bun run desktop:write-published-release-evidence',
      'bun run desktop:verify-published-release',
      'public-release-input/published-evidence/published-release-evidence.json',
      '--published-evidence',
      'Known Limitations',
      'manual tasks pass',
      'blocking issues none',
      'known limitations accepted',
      'UX validation summary',
      'release version/commit match',
      'validator/date',
      'representative user/date',
      'observed representative user validation',
      'native Help menu support actions',
      'Help menu Command Palette',
      'Help menu Refresh Settings',
      'Help menu Export Diagnostics',
      'approver/date',
      'Support intake channel',
      'Rollback Procedure',
      'Release Approval',
    ]) {
      expect(releaseNotesTemplate).toContain(snippet)
      expect(readinessSource).toContain(snippet)
    }
    for (const snippet of [
      'DESKTOP_RELEASE_VERSION',
      'desktop-release',
      'Developer ID Application',
      'APPLE_API_KEY',
      'bun run desktop:release-preflight',
      'bun run desktop:prod-check',
      'bun run desktop:release-ci',
      'bun run desktop:production-gate',
      'production-gate-evidence.json',
      'bun run desktop:verify-production-gate-evidence',
      'release-evidence.json',
      'published-release-evidence.json',
      'observed representative user validation',
      'native Help menu support actions',
      'Help menu Command Palette',
      'Help menu Refresh Settings',
      'Help menu Export Diagnostics',
      'bun run desktop:write-published-release-evidence',
      'bun run desktop:verify-published-release',
      'public-release-input/published-evidence/published-release-evidence.json',
      '--published-evidence',
      'Failure Handling',
    ]) {
      expect(releaseRunbook).toContain(snippet)
      expect(readinessSource).toContain(snippet)
    }
  })

  it('keeps manual release command order aligned with release CI', async () => {
    const productionReadiness = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../../docs/desktop-production-readiness.md', import.meta.url), 'utf8'))
    const sectionStart = productionReadiness.indexOf('## Required Release Command Set')
    const commandBlockStart = productionReadiness.indexOf('```sh', sectionStart)
    const commandBlockEnd = productionReadiness.indexOf('```', commandBlockStart + 1)
    const commandBlock = productionReadiness.slice(commandBlockStart, commandBlockEnd)
    const commands = [
      'bun run desktop:prepare-ux-validation',
      'bun run desktop:release-preflight',
      'bun run check',
      'bun run desktop:check',
      'bun run desktop:test',
      'DESKTOP_SMOKE_PROGRESS=1 bun run desktop:smoke-electron',
      'bun run desktop:prod-check',
      'DESKTOP_SMOKE_PROGRESS=1 bun run desktop:smoke-packaged',
      'bun run desktop:verify-release',
    ]

    for (const command of commands) {
      expect(commandBlock).toContain(command)
    }
    const offsets = commands.map(command => commandBlock.indexOf(command))
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right))
  })

  it('archives packaged smoke screenshots by default', async () => {
    const smokePackagedSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/smoke-packaged.mjs', import.meta.url), 'utf8'))

    expect(smokePackagedSource).toContain('process.env.DESKTOP_SMOKE_SCREENSHOT_DIR ||')
    expect(smokePackagedSource).toContain("join(process.cwd(), 'desktop/release/ux-screenshots')")
    expect(smokePackagedSource).toContain('DESKTOP_SMOKE_SCREENSHOT_DIR: screenshotDir')
    expect(smokePackagedSource).toContain('requiredSmokeScreenshots')
    expect(smokePackagedSource).toContain('chat-streaming.png')
    expect(smokePackagedSource).toContain('settings-narrow.png')
    expect(smokePackagedSource).toContain('settings-mcp.png')
    expect(smokePackagedSource).toContain('settings-skills.png')
    expect(smokePackagedSource).toContain('agents-selected.png')
    expect(smokePackagedSource).toContain('tasks.png')
    expect(smokePackagedSource).toContain('teams.png')
    expect(smokePackagedSource).toContain('permission-modal.png')
    expect(smokePackagedSource).toContain('files.png')
    expect(smokePackagedSource).toContain('editor.png')
    expect(smokePackagedSource).toContain('diff.png')
    expect(smokePackagedSource).toContain('unsaved-files-pane-switch-dialog.png')
    expect(smokePackagedSource).toContain('unsaved-diff-pane-switch-dialog.png')
    expect(smokePackagedSource).toContain('terminal.png')
    expect(smokePackagedSource).toContain('preview.png')
    expect(smokePackagedSource).toContain('Invalid PNG')
    expect(smokePackagedSource).toContain('Too small PNG')
    expect(smokePackagedSource).toContain('minimumScreenshotWidth')
    expect(smokePackagedSource).toContain('minimumScreenshotHeight')
    expect(smokePackagedSource).toContain('minimumScreenshotBytes')
  })

  it('builds a sandbox-compatible CommonJS preload bundle', async () => {
    const [packageJson, mainSource, preloadConfig] = await Promise.all([
      import('../../package.json').then(module => module.default),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/main.ts', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../vite.preload.config.ts', import.meta.url), 'utf8')),
    ])

    expect(packageJson.scripts['desktop:build-main']).toContain('desktop/vite.preload.config.ts')
    expect(mainSource).toContain("../preload/preload.cjs")
    expect(mainSource).toContain('sandbox: true')
    expect(preloadConfig).toContain("entryFileNames: '[name].cjs'")
    expect(preloadConfig).toContain("format: 'cjs'")
    expect(preloadConfig).toContain("external: ['electron']")
  })

  it('validates packaged smoke screenshot artifacts', async () => {
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const {
      requiredSmokeScreenshots,
      verifySmokeScreenshots,
    } = await import('../scripts/smoke-packaged.mjs')
    const dir = await mkdtemp(join(tmpdir(), 'claude-desktop-smoke-screenshots-'))
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const pngWithDimensions = (width: number, height: number, sizeBytes = 2048) => {
      const ihdr = Buffer.alloc(25)
      ihdr.writeUInt32BE(13, 0)
      ihdr.write('IHDR', 4, 'ascii')
      ihdr.writeUInt32BE(width, 8)
      ihdr.writeUInt32BE(height, 12)
      ihdr[16] = 8
      ihdr[17] = 2
      const contents = Buffer.concat([pngHeader, ihdr, Buffer.from('desktop screenshot pixels')])
      return Buffer.concat([contents, Buffer.alloc(Math.max(0, sizeBytes - contents.byteLength))])
    }

    try {
      for (const name of requiredSmokeScreenshots) {
        await writeFile(join(dir, name), pngWithDimensions(1280, 720))
      }
      expect(verifySmokeScreenshots(dir)).toEqual([])

      await rm(join(dir, 'preview.png'))
      expect(verifySmokeScreenshots(dir)).toContain(`Missing ${join(dir, 'preview.png')}`)

      await writeFile(join(dir, 'preview.png'), pngHeader)
      await writeFile(join(dir, 'terminal.png'), 'not a png')
      expect(verifySmokeScreenshots(dir)).toContain(`Invalid PNG ${join(dir, 'terminal.png')}`)

      await writeFile(join(dir, 'terminal.png'), pngWithDimensions(1, 1))
      expect(verifySmokeScreenshots(dir)).toContain(`Too small PNG ${join(dir, 'terminal.png')} (1x1, 2048 bytes)`)

      await writeFile(join(dir, 'terminal.png'), pngWithDimensions(1280, 720, 64))
      expect(verifySmokeScreenshots(dir)).toContain(`Too small PNG ${join(dir, 'terminal.png')} (1280x720, 64 bytes)`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('extracts required desktop smoke summary feature flags', () => {
    const output = [
      'vite build output',
      JSON.stringify({ unrelated: true }),
      JSON.stringify({
        ok: true,
        terminalMode: 'pty',
        firstClassLeftNavigation: true,
        accessiblePrimaryNavigation: true,
        nativeNavigationMenuActions: true,
        nativeHelpSupportMenuActions: true,
        primaryNavKeyboardShortcuts: true,
        workspacePaneKeyboardShortcuts: true,
        settingsFirstClassPage: true,
        settingsGui: true,
        settingsInLeftFooter: true,
        groupedSettingsNavigation: true,
        settingsSidebarNavigation: true,
        settingsSearchFiltering: true,
        settingsDiagnosticsExport: true,
        settingsDiagnosticsRedaction: true,
        rapidDiagnosticsExportGuard: true,
        settingsMcpSkillsInlineSections: true,
        settingsSectionRestored: true,
        selectedSettingsDetailStateRestored: true,
        settingsPaneErrorFeedback: true,
        settingsRefreshFeedback: true,
        rapidSettingsRefreshGuard: true,
        settingsEditFeedback: true,
        settingsEditCancelFeedback: true,
        settingsEditCancelIcon: true,
        proxyFormValidation: true,
        rapidProxySaveGuard: true,
        proxyRuntimeEnv: true,
        pluginCommands: true,
        settingsPluginEmptyState: true,
        rapidPluginActionGuard: true,
        pluginFormFeedback: true,
        pluginScopeValidation: true,
        projectPluginRowsDisabledNoSession: true,
        agentsFirstClassPage: true,
        agentsSectionRestored: true,
        agentGui: true,
        agentLaunchValidation: true,
        agentTaskActionIcons: true,
        agentTaskActionFeedback: true,
        rapidAgentTaskActionGuard: true,
        rapidAgentTaskStopGuard: true,
        rapidAgentLaunchGuard: true,
        agentLaunchTurnBusyGuard: true,
        rapidAgentsRefreshGuard: true,
        agentDiagnosticActionIcons: true,
        agentDiagnosticSettingsJump: true,
        selectedAgentActionRow: true,
        selectedAgentVisualEvidence: true,
        selectedAgentStateRestored: true,
        selectedAgentNewSessionAction: true,
        selectedAgentPrepareTaskAction: true,
        selectedAgentOverrideAction: true,
        agentEditorNewFeedback: true,
        rapidAgentSaveGuard: true,
        agentDeleteFeedback: true,
        rapidAgentDeleteGuard: true,
        agentTeammateStatusIsolated: true,
        teamsFirstClassPage: true,
        teamsFirstClassManagement: true,
        teamPrimaryViewRestored: true,
        teamsSectionRestored: true,
        selectedTeamStateRestored: true,
        teamSelectActionIcon: true,
        selectedTeamCurrentState: true,
        teamSelectFeedback: true,
        teamsManagementVisualEvidence: true,
        teamBroadcastMessageAction: true,
        teamMemberMessageAction: true,
        teamSpawnTeammateAction: true,
        teamMemberShutdownAction: true,
        teamMemberRemoveAction: true,
        teamActionFeedback: true,
        rapidTeamActionGuard: true,
        rapidTeamMemberShutdownGuard: true,
        rapidTeamMemberRemoveGuard: true,
        teamDeleteDisabledState: true,
        teamDeleteFeedback: true,
        rapidTeamDeleteGuard: true,
        teamDeleteClearsDraft: true,
        tasksFirstClassPage: true,
        tasksSectionRestored: true,
        selectedScheduledTaskStateRestored: true,
        scheduledTaskManagement: true,
        scheduledTaskFormValidation: true,
        scheduledTaskPauseResume: true,
        scheduledTaskPausedRunNowGuard: true,
        scheduledTaskRunNowFeedback: true,
        scheduledTaskRemoveFeedback: true,
        scheduledTaskDeleteClearsDraft: true,
        rapidScheduledTaskSaveGuard: true,
        rapidScheduledTaskPauseResumeGuard: true,
        rapidScheduledRunNowGuard: true,
        rapidScheduledTaskRemoveGuard: true,
        scheduledRunNowTurnBusyGuard: true,
        globalScheduledTaskRunNow: true,
        automaticGlobalScheduler: true,
        projectScheduledTaskManagement: true,
        projectScheduledTaskPauseResume: true,
        projectScheduledTaskRunNow: true,
        projectScheduledTaskEmptyState: true,
        projectScheduledTaskRemoveFeedback: true,
        projectScheduledTaskDeleteClearsDraft: true,
        rapidProjectScheduledTaskSaveGuard: true,
        rapidProjectScheduledPauseResumeGuard: true,
        rapidProjectScheduledTaskRemoveGuard: true,
        rapidProjectScheduledRunNowGuard: true,
        automaticProjectScheduler: true,
        mcpManagement: true,
        userMcpInspect: true,
        rapidMcpInspectGuard: true,
        projectMcpManagement: true,
        projectMcpInspect: true,
        userMcpEnableDisable: true,
        projectMcpApprovalLifecycle: true,
        settingsMcpEmptyState: true,
        rapidMcpSaveGuard: true,
        rapidMcpRemoveGuard: true,
        mcpCrossScopeEditIsolation: true,
        mcpProjectScopeValidation: true,
        projectSettingsRowsDisabledNoSession: true,
        mcpHealthCheck: true,
        rapidMcpHealthCheckGuard: true,
        localSkillInstall: true,
        localSkillInspect: true,
        localSkillSave: true,
        rapidSkillInspectGuard: true,
        rapidSkillSaveGuard: true,
        localSkillRemove: true,
        projectSkillInstall: true,
        projectSkillInspect: true,
        projectSkillSave: true,
        projectSkillRemove: true,
        rapidSkillRemoveGuard: true,
        settingsSkillsEmptyState: true,
        skillInstallCancelFeedback: true,
        rapidSkillInstallGuard: true,
        projectSkillSessionGuidance: true,
        commandPaletteNavigation: true,
        commandPaletteMenuAction: true,
        commandPaletteUnavailableFeedback: true,
        commandPaletteLifecycleNavigation: true,
        commandPaletteLifecycleCreateShortcuts: true,
        commandPaletteSettingsManagement: true,
        commandPaletteMcpHealthCheck: true,
        commandPaletteProjectSkillInstall: true,
        commandPaletteSkillDraftShortcuts: true,
        commandPaletteSettingsDiagnosticsExport: true,
        commandPaletteSettingsDiagnosticsRedaction: true,
        commandPaletteSettingsRefresh: true,
        commandPaletteSettingsRefreshGuard: true,
        composerResourceMenu: true,
        composerSkillResourceMenu: true,
        composerMcpResourceMenu: true,
        composerMenuKeyboardNavigation: true,
        composerActionMenu: true,
        composerCustomSlashCommand: true,
        composerLifecycleActionShortcuts: true,
        composerSettingsActionShortcuts: true,
        composerTeamTargetRouting: true,
        composerAgentTargetRouting: true,
        renderedAssistant: true,
        streamedAssistant: true,
        indexedStreamMessageCoalescing: true,
        streamedToolActivity: true,
        conversationToolActivityPanel: true,
        visibleTodoList: true,
        duplicateChatMessagesSuppressed: true,
        agentToolResultsHiddenFromChat: true,
        thinkingStreamStateLabels: true,
        chatMarkdownExternalLink: true,
        visibleActivityState: true,
        enterSendsMessage: true,
        rapidSendGuard: true,
        cancelRoundTrip: true,
        rapidCancelGuard: true,
        cancelTurnFeedback: true,
        closeSessionConfirmation: true,
        rapidCloseSessionGuard: true,
        menuSessionAction: true,
        sessionRowManagementMenu: true,
        sessionCreateMenuKeyboardNavigation: true,
        sessionMenuKeyboardNavigation: true,
        rapidMenuSessionCreateGuard: true,
        menuOpenFolderAction: true,
        sessionRowOpenFolderAction: true,
        sessionCreateCancelFeedback: true,
        quickSessionEntry: true,
        railQuickSessionEntry: true,
        rapidSessionCreateGuard: true,
        rapidSessionFocusGuard: true,
        rapidSessionFocusLastClickWins: true,
        collapsibleSessions: true,
        collapsedSessionCountVisible: true,
        sessionRailCollapseRestored: true,
        deepLinkedSession: true,
        permissionRoundTrip: true,
        queuedPermissionRoundTrip: true,
        permissionDenyRoundTrip: true,
        rapidPermissionDecisionGuard: true,
        runtimeFailureVisible: true,
        workspaceRefreshFeedback: true,
        pointerWorkspaceResize: true,
        pointerWorkspaceResizeSingleCommit: true,
        staleSessionStatusCleared: true,
        chatCopyFeedback: true,
        filesRefreshFeedback: true,
        rapidFilesRefreshGuard: true,
        fileTreeExpandedPathPersistence: true,
        editedFile: true,
        rapidFileSaveGuard: true,
        editorEmptyStateGuidance: true,
        restoredEditorContent: true,
        renderedDiff: true,
        rapidDiffRefreshGuard: true,
        restoredDiffContent: true,
        renderedTerminal: true,
        terminalEmptyStateGuidance: true,
        terminalFailureVisible: true,
        restartedTerminal: true,
        resizedTerminal: true,
        terminalRapidStartGuard: true,
        terminalRapidStopGuard: true,
        terminalCloseRaceSafe: true,
        rejectedInvalidPreview: true,
        previewExternalOpen: true,
        previewSessionIsolation: true,
        previewRapidOpenGuard: true,
        previewRapidExternalGuard: true,
        previewOpenActionIcon: true,
        restoredSession: true,
        restoredMissingEditorRecovery: true,
        closedSession: true,
        conversationNoHorizontalOverflow: true,
        buttonLayoutStable: true,
        toolbarButtonTypographyStable: true,
        iconOnlyTooltips: true,
        polishedScrollableSurfaces: true,
        workareaEmptyStateGuidance: true,
        compactSettingsLayout: true,
        paneJumpbarsNoHorizontalOverflow: true,
        sessionRailScrollable: true,
        permissionDecisionActionIcons: true,
        confirmationActionIcons: true,
      }, null, 2),
    ].join('\n')

    expect(summarizeSmokeSummary(extractSmokeSummaryFromOutput(output))).toEqual(requiredSmokeSummary)
  })

  it('requires smoke evidence for restored grouped Settings sections', () => {
    expect(requiredSmokeSummaryFlags).toContain('settingsSectionRestored')
    expect(requiredSmokeSummaryFlags).toContain('selectedSettingsDetailStateRestored')
  })

  it('requires smoke evidence for grouped Settings management interactions', () => {
    expect(requiredSmokeSummaryFlags).toContain('settingsGui')
    expect(requiredSmokeSummaryFlags).toContain('settingsInLeftFooter')
    expect(requiredSmokeSummaryFlags).toContain('settingsSidebarNavigation')
    expect(requiredSmokeSummaryFlags).toContain('settingsSearchFiltering')
    expect(requiredSmokeSummaryFlags).toContain('settingsDiagnosticsExport')
    expect(requiredSmokeSummaryFlags).toContain('settingsDiagnosticsRedaction')
    expect(requiredSmokeSummaryFlags).toContain('rapidDiagnosticsExportGuard')
    expect(requiredSmokeSummaryFlags).toContain('settingsPaneErrorFeedback')
    expect(requiredSmokeSummaryFlags).toContain('settingsRefreshFeedback')
    expect(requiredSmokeSummaryFlags).toContain('rapidSettingsRefreshGuard')
    expect(requiredSmokeSummaryFlags).toContain('settingsEditFeedback')
    expect(requiredSmokeSummaryFlags).toContain('settingsEditCancelFeedback')
    expect(requiredSmokeSummaryFlags).toContain('settingsEditCancelIcon')
  })

  it('requires smoke evidence for Settings Proxy and Plugin management', () => {
    expect(requiredSmokeSummaryFlags).toContain('proxyFormValidation')
    expect(requiredSmokeSummaryFlags).toContain('rapidProxySaveGuard')
    expect(requiredSmokeSummaryFlags).toContain('proxyRuntimeEnv')
    expect(requiredSmokeSummaryFlags).toContain('pluginCommands')
    expect(requiredSmokeSummaryFlags).toContain('settingsPluginEmptyState')
    expect(requiredSmokeSummaryFlags).toContain('rapidPluginActionGuard')
    expect(requiredSmokeSummaryFlags).toContain('pluginFormFeedback')
    expect(requiredSmokeSummaryFlags).toContain('pluginScopeValidation')
    expect(requiredSmokeSummaryFlags).toContain('projectPluginRowsDisabledNoSession')
  })

  it('requires smoke evidence for restored first-class Tasks sections', () => {
    expect(requiredSmokeSummaryFlags).toContain('tasksSectionRestored')
    expect(requiredSmokeSummaryFlags).toContain('selectedScheduledTaskStateRestored')
  })

  it('requires smoke evidence for scheduled task lifecycle guards', () => {
    expect(requiredSmokeSummaryFlags).toContain('scheduledTaskFormValidation')
    expect(requiredSmokeSummaryFlags).toContain('scheduledTaskPausedRunNowGuard')
    expect(requiredSmokeSummaryFlags).toContain('scheduledTaskRemoveFeedback')
    expect(requiredSmokeSummaryFlags).toContain('scheduledTaskDeleteClearsDraft')
    expect(requiredSmokeSummaryFlags).toContain('rapidScheduledTaskSaveGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidScheduledTaskPauseResumeGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidScheduledRunNowGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidScheduledTaskRemoveGuard')
    expect(requiredSmokeSummaryFlags).toContain('scheduledRunNowTurnBusyGuard')
    expect(requiredSmokeSummaryFlags).toContain('globalScheduledTaskRunNow')
    expect(requiredSmokeSummaryFlags).toContain('automaticGlobalScheduler')
    expect(requiredSmokeSummaryFlags).toContain('projectScheduledTaskRemoveFeedback')
    expect(requiredSmokeSummaryFlags).toContain('projectScheduledTaskDeleteClearsDraft')
    expect(requiredSmokeSummaryFlags).toContain('rapidProjectScheduledTaskSaveGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidProjectScheduledPauseResumeGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidProjectScheduledTaskRemoveGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidProjectScheduledRunNowGuard')
    expect(requiredSmokeSummaryFlags).toContain('automaticProjectScheduler')
  })

  it('requires smoke evidence for guarded cancellation, close, and task forms', () => {
    expect(requiredSmokeSummaryFlags).toContain('rapidCancelGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidCloseSessionGuard')
    expect(requiredSmokeSummaryFlags).toContain('scheduledTaskFormValidation')
    expect(requiredSmokeSummaryFlags).toContain('projectScheduledTaskEmptyState')
  })

  it('requires smoke evidence for Skills and MCP management guards', () => {
    expect(requiredSmokeSummaryFlags).toContain('settingsSkillsEmptyState')
    expect(requiredSmokeSummaryFlags).toContain('skillInstallCancelFeedback')
    expect(requiredSmokeSummaryFlags).toContain('rapidSkillInstallGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidSkillRemoveGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidSkillSaveGuard')
    expect(requiredSmokeSummaryFlags).toContain('projectSkillSessionGuidance')
    expect(requiredSmokeSummaryFlags).toContain('settingsMcpEmptyState')
    expect(requiredSmokeSummaryFlags).toContain('rapidMcpSaveGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidMcpInspectGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidMcpRemoveGuard')
    expect(requiredSmokeSummaryFlags).toContain('mcpCrossScopeEditIsolation')
    expect(requiredSmokeSummaryFlags).toContain('mcpProjectScopeValidation')
    expect(requiredSmokeSummaryFlags).toContain('mcpHealthCheck')
    expect(requiredSmokeSummaryFlags).toContain('rapidMcpHealthCheckGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidSkillInspectGuard')
    expect(requiredSmokeSummaryFlags).toContain('localSkillSave')
    expect(requiredSmokeSummaryFlags).toContain('projectSkillSave')
    expect(requiredSmokeSummaryFlags).toContain('projectSettingsRowsDisabledNoSession')
    expect(requiredSmokeSummaryFlags).toContain('commandPaletteProjectSkillInstall')
  })

  it('requires smoke evidence for restored first-class Agents sections', () => {
    expect(requiredSmokeSummaryFlags).toContain('agentsSectionRestored')
  })

  it('requires smoke evidence for restored first-class Teams sections', () => {
    expect(requiredSmokeSummaryFlags).toContain('teamsSectionRestored')
    expect(requiredSmokeSummaryFlags).toContain('selectedTeamStateRestored')
  })

  it('requires smoke evidence for Agents page lifecycle guards', () => {
    expect(requiredSmokeSummaryFlags).toContain('agentTaskActionIcons')
    expect(requiredSmokeSummaryFlags).toContain('agentTaskActionFeedback')
    expect(requiredSmokeSummaryFlags).toContain('rapidAgentTaskActionGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidAgentTaskStopGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidAgentLaunchGuard')
    expect(requiredSmokeSummaryFlags).toContain('agentLaunchTurnBusyGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidAgentsRefreshGuard')
    expect(requiredSmokeSummaryFlags).toContain('agentDiagnosticActionIcons')
    expect(requiredSmokeSummaryFlags).toContain('agentDiagnosticSettingsJump')
    expect(requiredSmokeSummaryFlags).toContain('agentEditorNewFeedback')
    expect(requiredSmokeSummaryFlags).toContain('rapidAgentSaveGuard')
    expect(requiredSmokeSummaryFlags).toContain('agentDeleteFeedback')
    expect(requiredSmokeSummaryFlags).toContain('rapidAgentDeleteGuard')
    expect(requiredSmokeSummaryFlags).toContain('agentTeammateStatusIsolated')
  })

  it('requires smoke evidence for selected team card current state', () => {
    expect(requiredSmokeSummaryFlags).toContain('selectedTeamCurrentState')
  })

  it('requires smoke evidence for team lifecycle actions', () => {
    expect(requiredSmokeSummaryFlags).toContain('teamSelectActionIcon')
    expect(requiredSmokeSummaryFlags).toContain('teamSelectFeedback')
    expect(requiredSmokeSummaryFlags).toContain('teamsManagementVisualEvidence')
    expect(requiredSmokeSummaryFlags).toContain('teamMemberMessageAction')
    expect(requiredSmokeSummaryFlags).toContain('teamSpawnTeammateAction')
    expect(requiredSmokeSummaryFlags).toContain('teamMemberShutdownAction')
    expect(requiredSmokeSummaryFlags).toContain('teamMemberRemoveAction')
    expect(requiredSmokeSummaryFlags).toContain('teamActionFeedback')
    expect(requiredSmokeSummaryFlags).toContain('rapidTeamActionGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidTeamMemberShutdownGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidTeamMemberRemoveGuard')
    expect(requiredSmokeSummaryFlags).toContain('teamDeleteDisabledState')
    expect(requiredSmokeSummaryFlags).toContain('teamDeleteFeedback')
    expect(requiredSmokeSummaryFlags).toContain('rapidTeamDeleteGuard')
    expect(requiredSmokeSummaryFlags).toContain('teamPrimaryViewRestored')
  })

  it('requires smoke evidence for selected agent visual state', () => {
    expect(requiredSmokeSummaryFlags).toContain('selectedAgentVisualEvidence')
  })

  it('requires smoke evidence for selected agent lifecycle actions', () => {
    expect(requiredSmokeSummaryFlags).toContain('selectedAgentActionRow')
    expect(requiredSmokeSummaryFlags).toContain('selectedAgentNewSessionAction')
    expect(requiredSmokeSummaryFlags).toContain('selectedAgentPrepareTaskAction')
    expect(requiredSmokeSummaryFlags).toContain('selectedAgentOverrideAction')
  })

  it('requires smoke evidence for selected agent state restoration', () => {
    expect(requiredSmokeSummaryFlags).toContain('selectedAgentStateRestored')
  })

  it('requires smoke evidence for Codex-style navigation and session guards', () => {
    expect(requiredSmokeSummaryFlags).toContain('workspacePaneKeyboardShortcuts')
    expect(requiredSmokeSummaryFlags).toContain('nativeHelpSupportMenuActions')
    expect(requiredSmokeSummaryFlags).toContain('commandPaletteLifecycleNavigation')
    expect(requiredSmokeSummaryFlags).toContain('commandPaletteSettingsDiagnosticsExport')
    expect(requiredSmokeSummaryFlags).toContain('commandPaletteSettingsDiagnosticsRedaction')
    expect(requiredSmokeSummaryFlags).toContain('commandPaletteSettingsRefresh')
    expect(requiredSmokeSummaryFlags).toContain('commandPaletteSettingsRefreshGuard')
    expect(requiredSmokeSummaryFlags).toContain('menuSessionAction')
    expect(requiredSmokeSummaryFlags).toContain('sessionRowManagementMenu')
    expect(requiredSmokeSummaryFlags).toContain('sessionCreateMenuKeyboardNavigation')
    expect(requiredSmokeSummaryFlags).toContain('rapidMenuSessionCreateGuard')
    expect(requiredSmokeSummaryFlags).toContain('menuOpenFolderAction')
    expect(requiredSmokeSummaryFlags).toContain('sessionRowOpenFolderAction')
    expect(requiredSmokeSummaryFlags).toContain('sessionCreateCancelFeedback')
    expect(requiredSmokeSummaryFlags).toContain('quickSessionEntry')
    expect(requiredSmokeSummaryFlags).toContain('railQuickSessionEntry')
    expect(requiredSmokeSummaryFlags).toContain('rapidSessionCreateGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidSessionFocusGuard')
    expect(requiredSmokeSummaryFlags).toContain('rapidSessionFocusLastClickWins')
    expect(requiredSmokeSummaryFlags).toContain('collapsibleSessions')
    expect(requiredSmokeSummaryFlags).toContain('collapsedSessionCountVisible')
    expect(requiredSmokeSummaryFlags).toContain('sessionRailCollapseRestored')
    expect(requiredSmokeSummaryFlags).toContain('pointerWorkspaceResize')
    expect(requiredSmokeSummaryFlags).toContain('pointerWorkspaceResizeSingleCommit')
    expect(requiredSmokeSummaryFlags).toContain('workspaceRefreshFeedback')
    expect(requiredSmokeSummaryFlags).toContain('staleSessionStatusCleared')
  })

  it('requires smoke evidence for core chat runtime and composer routing', () => {
    expect(requiredSmokeSummaryFlags).toContain('renderedAssistant')
    expect(requiredSmokeSummaryFlags).toContain('streamedAssistant')
    expect(requiredSmokeSummaryFlags).toContain('indexedStreamMessageCoalescing')
    expect(requiredSmokeSummaryFlags).toContain('streamedToolActivity')
    expect(requiredSmokeSummaryFlags).toContain('conversationToolActivityPanel')
    expect(requiredSmokeSummaryFlags).toContain('visibleTodoList')
    expect(requiredSmokeSummaryFlags).toContain('duplicateChatMessagesSuppressed')
    expect(requiredSmokeSummaryFlags).toContain('agentToolResultsHiddenFromChat')
    expect(requiredSmokeSummaryFlags).toContain('thinkingStreamStateLabels')
    expect(requiredSmokeSummaryFlags).toContain('enterSendsMessage')
    expect(requiredSmokeSummaryFlags).toContain('composerTeamTargetRouting')
    expect(requiredSmokeSummaryFlags).toContain('composerAgentTargetRouting')
    expect(requiredSmokeSummaryFlags).toContain('chatCopyFeedback')
    expect(requiredSmokeSummaryFlags).toContain('chatMarkdownExternalLink')
  })

  it('requires smoke evidence for workspace pane resilience', () => {
    expect(requiredSmokeSummaryFlags).toContain('rapidFilesRefreshGuard')
    expect(requiredSmokeSummaryFlags).toContain('fileTreeExpandedPathPersistence')
    expect(requiredSmokeSummaryFlags).toContain('editorEmptyStateGuidance')
    expect(requiredSmokeSummaryFlags).toContain('terminalEmptyStateGuidance')
    expect(requiredSmokeSummaryFlags).toContain('terminalFailureVisible')
    expect(requiredSmokeSummaryFlags).toContain('restartedTerminal')
    expect(requiredSmokeSummaryFlags).toContain('rejectedInvalidPreview')
    expect(requiredSmokeSummaryFlags).toContain('previewRapidExternalGuard')
    expect(requiredSmokeSummaryFlags).toContain('restoredSession')
    expect(requiredSmokeSummaryFlags).toContain('restoredMissingEditorRecovery')
    expect(requiredSmokeSummaryFlags).toContain('closedSession')
  })

  it('requires package and Electron Builder main metadata to match', async () => {
    const readinessSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8'))

    expect(packageJson.main).toBe('desktop/dist/main/main.js')
    expect(builderConfig.extraMetadata.main).toBe(packageJson.main)
    expect(readinessSource).toContain('packageJson.main')
    expect(readinessSource).toContain('builder.extraMetadata?.main')
  })

  it('keeps production readiness aligned with release CI environment preflight', async () => {
    const readinessSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8'))

    expect(readinessSource).toContain('validateReleaseEnvironment')
    expect(readinessSource).toContain('release-env-preflight')
    expect(readinessSource).toContain('notarizationCredentialStrategy')
    expect(readinessSource).not.toContain('function notarizationCredentialStrategy')
  })

  it('keeps production readiness aligned with release evidence sensitive-content checks', async () => {
    const readinessSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8'))

    expect(readinessSource).toContain('mac-release-evidence-sensitive-content')
    expect(readinessSource).toContain('mac-release-notes-sensitive-content')
    expect(readinessSource).toContain('sensitiveContentCheck')
    expect(readinessSource).toContain('privateKey')
    expect(readinessSource).toContain('*password')
    expect(readinessSource).toContain('placeholder certificate material')
  })

  it('keeps production readiness aligned with final release verification evidence', async () => {
    const readinessSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8'))

    expect(readinessSource).toContain("verifyReleaseTs.includes('final-verify-release')")
    expect(readinessSource).toContain("verifyReleaseTs.includes('DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_FINAL_VERIFY_STEP')")
    expect(readinessSource).toContain("releaseCiTs.includes('DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_FINAL_VERIFY_STEP')")
    expect(readinessSource).toContain("verifyReleaseTs.includes('timingMismatches')")
    expect(readinessSource).toContain("verifyReleaseTs.includes('durationMs=${durationMs')")
    expect(readinessSource).toContain("verifyReleaseTs.includes('contradictoryPassIds')")
    expect(readinessSource).toContain("verifyReleaseTs.includes('failures=${failureCount}')")
    expect(readinessSource).toContain("verifyReleaseTs.includes('mac-release-evidence-smoke-summary')")
    expect(readinessSource).toContain("releaseCiTs.includes('extractSmokeSummaryFromOutput')")
    expect(readinessSource).toContain("releaseCiTs.includes('smokeSummary')")
  })

  it('keeps production readiness aligned with release preflight subcommands', async () => {
    const readinessSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8'))

    expect(readinessSource).toContain("releaseCiTs.includes('releasePreflightRecordsForPhase')")
    expect(readinessSource).toContain("releaseCiTs.includes('preflight:')")
  })

  it('requires BrowserWindow sandbox to be enabled for production readiness', async () => {
    const [readinessSource, mainSource] = await Promise.all([
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/main.ts', import.meta.url), 'utf8')),
    ])

    expect(mainSource).toContain('sandbox: true')
    expect(readinessSource).toContain('BrowserWindow sandbox is enabled.')
    expect(readinessSource).toContain('Enable sandbox=true in BrowserWindow webPreferences.')
    expect(readinessSource).not.toContain('initial window renderer shell timed out')
  })

  it('requires release policy diagnostics in production readiness', async () => {
    const [readinessSource, diagnosticsSource, mainSource, builderConfig] = await Promise.all([
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/diagnostics.ts', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/main.ts', import.meta.url), 'utf8')),
      import('../electron-builder.json'),
    ])

    for (const snippet of [
      'diagnostic-export',
      'desktop/release-policy.json',
      'failedUpdateEventCount',
      'loadDesktopReleasePolicy',
      'packaged release policy',
    ]) {
      expect(readinessSource).toContain(snippet)
    }
    expect(diagnosticsSource).toContain('failedUpdateEventCount')
    expect(mainSource).toContain('loadDesktopReleasePolicy')
    expect(builderConfig.default.files).toContain('desktop/release-policy.json')
  })

  it('requires production packaging to exclude local source and release artifacts', async () => {
    const readinessSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8'))

    expect(builderConfig.files).toEqual(expect.arrayContaining([
      'desktop/dist/**/*',
      'desktop/release-policy.json',
      'package.json',
      '!node_modules/**/*',
      'node_modules/node-pty/**/*',
    ]))
    for (const forbiddenPattern of [
      'desktop/release/**/*',
      'desktop/tests/**/*',
      'desktop/scripts/**/*',
      'src/**/*',
      'node_modules/**/*',
    ]) {
      expect(builderConfig.files).not.toContain(forbiddenPattern)
    }
    expect(readinessSource).toContain('packaging-scope')
    expect(readinessSource).toContain('desktop/release/**/*')
    expect(readinessSource).toContain('desktop/tests/**/*')
    expect(readinessSource).toContain('desktop/scripts/**/*')
    expect(readinessSource).toContain('src/**/*')
    expect(readinessSource).toContain('!node_modules/**/*')
    expect(readinessSource).toContain('node_modules/node-pty/**/*')
  })

  it('requires external navigation URL validation in production readiness', async () => {
    const [readinessSource, navigationSource] = await Promise.all([
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/navigation.ts', import.meta.url), 'utf8')),
    ])

    for (const snippet of [
      'external-url-validation',
      'will-navigate',
      'setWindowOpenHandler',
      'navigationActionForUrl',
      'normalizeRendererEntryUrl',
      'containsControlCharacters',
      'parsed.username || parsed.password',
      'isHtmlEntryDocument(parsed)',
      'isRendererResourceDocument(parsed)',
      'js|mjs|cjs|css|map|json|wasm',
      'url: parsed.href',
    ]) {
      expect(readinessSource).toContain(snippet)
    }
    for (const snippet of [
      'containsControlCharacters',
      'parsed.username || parsed.password',
      'isHtmlEntryDocument(parsed)',
      'isRendererResourceDocument(parsed)',
      'js|mjs|cjs|css|map|json|wasm',
      'url: parsed.href',
    ]) {
      expect(navigationSource).toContain(snippet)
    }
  })

  it('requires privileged IPC security review in production readiness', async () => {
    const [readinessSource, ipcSecurityReview] = await Promise.all([
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../../docs/desktop-ipc-security-review.md', import.meta.url), 'utf8')),
    ])

    for (const snippet of [
      'ipc-security-review',
      'desktopChannels',
      'validateIpcArgs',
      'desktop/preload/preload.ts',
      'assertWorkspaceDirectory',
      'workspaceCwd',
      'assertWorkspaceFileTarget',
      'shell.openExternal',
      'shell.openPath',
      'Terminal channels',
      'desktop/tests/ipc.test.ts',
      'bun run desktop:test',
    ]) {
      expect(readinessSource).toContain(snippet)
      expect(ipcSecurityReview).toContain(snippet)
    }
  })

  it('requires desktop deep link input validation in production readiness', async () => {
    const [readinessSource, deepLinkSource] = await Promise.all([
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/deepLink.ts', import.meta.url), 'utf8')),
    ])

    expect(readinessSource).toContain('deep-link-validation')

    for (const snippet of [
      'MAX_CWD_LENGTH',
      'isAbsoluteLocalPath',
      'containsControlCharacters',
      'isSafeSessionId',
    ]) {
      expect(readinessSource).toContain(snippet)
      expect(deepLinkSource).toContain(snippet)
    }
  })

  it('requires workspace directory validation in production readiness', async () => {
    const [
      readinessSource,
      mainSource,
      workspaceDirectorySource,
      workspaceSource,
      configSource,
      workspaceTasksSource,
    ] = await Promise.all([
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/main.ts', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/workspaceDirectory.ts', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/workspace.ts', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/config.ts', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../main/workspaceTasks.ts', import.meta.url), 'utf8')),
    ])

    expect(readinessSource).toContain('workspace-directory-validation')
    expect(readinessSource).toContain('workspaceDirectoryUseCount >= 4')
    expect(readinessSource).toContain('workspaceIpcCwdUseCount >= 20')
    expect(readinessSource).toContain('lstat(cwd)')
    expect(readinessSource).toContain('info.isDirectory()')
    expect(readinessSource).toContain('isSymbolicLink()')
    expect(readinessSource).toContain('Workspace file target must not be a symlink')
    expect(workspaceDirectorySource).toContain('lstat(cwd)')
    expect(workspaceDirectorySource).toContain('Workspace folder must not be a symlink')
    expect(workspaceDirectorySource).toContain('info.isDirectory()')
    expect(workspaceDirectorySource).toContain('assertWorkspaceFileTarget')
    expect(workspaceDirectorySource).toContain('Workspace file target must not be a symlink')
    expect(workspaceSource).toContain('lstat')
    expect(workspaceSource).toContain('isSymbolicLink()')
    expect(configSource).toContain('assertWorkspaceFileTarget')
    expect(workspaceTasksSource).toContain('assertWorkspaceFileTarget')
    expect((mainSource.match(/assertWorkspaceDirectory/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect((mainSource.match(/await workspaceCwd\(cwd\)/g) ?? []).length).toBeGreaterThanOrEqual(20)
  })

  it('requires requested desktop UX scope evidence in production readiness docs', async () => {
    const [readinessSource, requirementsAudit, mvpDoc] = await Promise.all([
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../../docs/desktop-user-requirements-audit.md', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../../docs/desktop-mvp.md', import.meta.url), 'utf8')),
    ])
    const docs = `${requirementsAudit}\n${mvpDoc}`

    for (const snippet of [
      'Settings stays fixed in the left rail footer when sessions collapse and uses grouped Codex-style settings navigation.',
      'settingsFirstClassPage',
      'settingsInLeftFooter',
      'groupedSettingsNavigation',
      'settingsSidebarNavigation',
      'settingsSearchFiltering',
      'settingsMcpSkillsInlineSections',
      'settingsSectionRestored',
      'selectedSettingsDetailStateRestored',
      'settingsDiagnosticsExport',
      'settingsDiagnosticsRedaction',
      'settingsPaneErrorFeedback',
      'settingsRefreshFeedback',
      'settingsEditFeedback',
      'settingsEditCancelFeedback',
      'settingsEditCancelIcon',
      'settingsMcpEmptyState',
      'settingsSkillsEmptyState',
      'settingsPluginEmptyState',
      'settingsGui',
      'rapidSettingsRefreshGuard',
      'proxyFormValidation',
      'rapidProxySaveGuard',
      'proxyRuntimeEnv',
      'pluginCommands',
      'rapidPluginActionGuard',
      'pluginFormFeedback',
      'pluginScopeValidation',
      'projectPluginRowsDisabledNoSession',
      'Agent management is understandable.',
      'Agents page',
      'agentsFirstClassPage',
      'agentsSectionRestored',
      'agentGui',
      'agentLaunchValidation',
      'agentDiagnosticSettingsJump',
      'agentDiagnosticActionIcons',
      'selectedAgentActionRow',
      'selectedAgentVisualEvidence',
      'selectedAgentNewSessionAction',
      'selectedAgentPrepareTaskAction',
      'selectedAgentOverrideAction',
      'agentTaskActionIcons',
      'agentTaskActionFeedback',
      'rapidAgentTaskActionGuard',
      'agentEditorNewFeedback',
      'rapidAgentSaveGuard',
      'agentTeammateStatusIsolated',
      'agentLaunchTurnBusyGuard',
      'rapidAgentLaunchGuard',
      'rapidAgentsRefreshGuard',
      'agentDeleteFeedback',
      'rapidAgentDeleteGuard',
      'rapidAgentTaskStopGuard',
      'Teams are first-class and can represent multiple teammates.',
      'Team management is a first-class primary page labelled Teams.',
      'teamsFirstClassPage',
      'teamsFirstClassManagement',
      'teamsSectionRestored',
      'selectedTeamStateRestored',
      'teamSelectActionIcon',
      'teamBroadcastMessageAction',
      'teamMemberMessageAction',
      'teamSpawnTeammateAction',
      'teamMemberShutdownAction',
      'teamMemberRemoveAction',
      'teamActionFeedback',
      'rapidTeamActionGuard',
      'rapidTeamMemberShutdownGuard',
      'rapidTeamMemberRemoveGuard',
      'teamDeleteDisabledState',
      'Tasks page',
      'tasksFirstClassPage',
      'tasksSectionRestored',
      'selectedScheduledTaskStateRestored',
      'scheduledTaskManagement',
      'scheduledTaskFormValidation',
      'scheduledTaskPauseResume',
      'scheduledTaskRemoveFeedback',
      'scheduledTaskDeleteClearsDraft',
      'rapidScheduledTaskSaveGuard',
      'rapidScheduledTaskPauseResumeGuard',
      'rapidScheduledRunNowGuard',
      'rapidScheduledTaskRemoveGuard',
      'scheduledRunNowTurnBusyGuard',
      'globalScheduledTaskRunNow',
      'automaticGlobalScheduler',
      'projectScheduledTaskManagement',
      'projectScheduledTaskRemoveFeedback',
      'projectScheduledTaskDeleteClearsDraft',
      'rapidProjectScheduledTaskSaveGuard',
      'rapidProjectScheduledPauseResumeGuard',
      'rapidProjectScheduledTaskRemoveGuard',
      'rapidProjectScheduledRunNowGuard',
      'automaticProjectScheduler',
      'MCP management supports add/update/remove for user and project `.kode.mcp.json`',
      'mcpManagement',
      'projectMcpManagement',
      'userMcpInspect',
      'rapidMcpInspectGuard',
      'userMcpEnableDisable',
      'rapidMcpSaveGuard',
      'rapidMcpRemoveGuard',
      'mcpCrossScopeEditIsolation',
      'mcpProjectScopeValidation',
      'projectSettingsRowsDisabledNoSession',
      'projectPluginRowsDisabledNoSession',
      'mcpHealthCheck',
      'rapidMcpHealthCheckGuard',
      'projectMcpApprovalLifecycle',
      'projectMcpInspect',
      'localSkillInstall',
      'localSkillInspect',
      'localSkillSave',
      'rapidSkillInspectGuard',
      'rapidSkillSaveGuard',
      'skillInstallCancelFeedback',
      'rapidSkillInstallGuard',
      'localSkillRemove',
      'projectSkillInstall',
      'projectSkillInspect',
      'projectSkillSave',
      'projectSkillRemove',
      'projectSkillSessionGuidance',
      'rapidSkillRemoveGuard',
      'firstClassLeftNavigation',
      'accessiblePrimaryNavigation',
      'nativeNavigationMenuActions',
      'nativeHelpSupportMenuActions',
      'primaryNavKeyboardShortcuts',
      'workspacePaneKeyboardShortcuts',
      'commandPaletteNavigation',
      'commandPaletteMenuAction',
      'commandPaletteUnavailableFeedback',
      'commandPaletteLifecycleNavigation',
      'commandPaletteLifecycleCreateShortcuts',
      'commandPaletteSettingsManagement',
      'commandPaletteMcpHealthCheck',
      'commandPaletteProjectSkillInstall',
      'commandPaletteSkillDraftShortcuts',
      'commandPaletteSettingsDiagnosticsExport',
      'commandPaletteSettingsDiagnosticsRedaction',
      'commandPaletteSettingsRefresh',
      'commandPaletteSettingsRefreshGuard',
      'composerResourceMenu',
      'composerSkillResourceMenu',
      'composerMcpResourceMenu',
      'composerMenuKeyboardNavigation',
      'composerActionMenu',
      'composerCustomSlashCommand',
      'composerLifecycleActionShortcuts',
      'composerSettingsActionShortcuts',
      'composerTeamTargetRouting',
      'composerAgentTargetRouting',
      'agentToolResultsHiddenFromChat',
      'teamPrimaryViewRestored',
      'selectedTeamCurrentState',
      'teamSelectFeedback',
      'teamsManagementVisualEvidence',
      'teamDeleteClearsDraft',
      'scheduledTaskPausedRunNowGuard',
      'scheduledTaskRunNowFeedback',
      'projectScheduledTaskEmptyState',
      'projectScheduledTaskPauseResume',
      'projectScheduledTaskRunNow',
      'visibleActivityState',
      'renderedAssistant',
      'streamedAssistant',
      'indexedStreamMessageCoalescing',
      'thinkingStreamStateLabels',
      'chatMarkdownExternalLink',
      'runtimeFailureVisible',
      'deepLinkedSession',
      'rapidCancelGuard',
      'rapidCloseSessionGuard',
      'workspaceRefreshFeedback',
      'staleSessionStatusCleared',
      'chatCopyFeedback',
      'rapidSendGuard',
      'cancelRoundTrip',
      'cancelTurnFeedback',
      'closeSessionConfirmation',
      'sessionMenuKeyboardNavigation',
      'rapidMenuSessionCreateGuard',
      'sessionCreateCancelFeedback',
      'rapidSessionCreateGuard',
      'restoredSession',
      'closedSession',
      'permissionRoundTrip',
      'queuedPermissionRoundTrip',
      'permissionDenyRoundTrip',
      'rapidPermissionDecisionGuard',
      'editedFile',
      'filesRefreshFeedback',
      'rapidFilesRefreshGuard',
      'editorEmptyStateGuidance',
      'rapidFileSaveGuard',
      'restoredEditorContent',
      'renderedDiff',
      'restoredDiffContent',
      'rapidDiffRefreshGuard',
      'renderedTerminal',
      'terminalEmptyStateGuidance',
      'terminalFailureVisible',
      'restartedTerminal',
      'resizedTerminal',
      'terminalRapidStartGuard',
      'terminalRapidStopGuard',
      'terminalCloseRaceSafe',
      'previewExternalOpen',
      'previewSessionIsolation',
      'rejectedInvalidPreview',
      'previewRapidExternalGuard',
      'previewRapidOpenGuard',
      'previewOpenActionIcon',
      'conversationNoHorizontalOverflow',
      'buttonLayoutStable',
      'toolbarButtonTypographyStable',
      'iconOnlyTooltips',
      'polishedScrollableSurfaces',
      'workareaEmptyStateGuidance',
      'compactSettingsLayout',
      'paneJumpbarsNoHorizontalOverflow',
      'sessionRailScrollable',
      'permissionDecisionActionIcons',
      'confirmationActionIcons',
    ]) {
      expect(readinessSource).toContain(snippet)
      expect(docs).toContain(snippet)
    }
    expect(readinessSource).toContain('requested production UX scope')
    expect(readinessSource).toContain('Missing readiness doc evidence')
  })

  it('requires UX checklist release approval gates in production readiness', async () => {
    const [readinessSource, uxChecklist] = await Promise.all([
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../../docs/desktop-ux-validation-checklist.md', import.meta.url), 'utf8')),
    ])

    for (const snippet of [
      'Every screenshot row must be `pass` or `n/a` before release approval.',
      'Every required manual task row below must be present and `pass` before release',
      'Validator: `[name, role, YYYY-MM-DD]`',
      'Blocking issues filed: `[none]`',
      'Known limitations accepted: `[yes, approver]`',
    ]) {
      expect(readinessSource).toContain(snippet)
      expect(uxChecklist).toContain(snippet)
    }
  })

  it('requires native Help support actions in UX validation evidence', async () => {
    const [readinessSource, uxChecklist] = await Promise.all([
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../scripts/production-readiness.mjs', import.meta.url), 'utf8')),
      import('node:fs/promises')
        .then(fs => fs.readFile(new URL('../../docs/desktop-ux-validation-checklist.md', import.meta.url), 'utf8')),
    ])

    for (const snippet of [
      'Use native Help menu support actions.',
      'Help menu Command Palette opens the searchable command palette.',
      'Help menu Refresh Settings reports refreshed configuration.',
      'Help menu Export Diagnostics writes a redacted bundle.',
    ]) {
      expect(readinessSource).toContain(snippet)
      expect(uxChecklist).toContain(snippet)
    }
    expect(requiredUxValidationManualTasks).toContain('Use native Help menu support actions.')
  })

  it('keeps generated desktop outputs out of source control by default', async () => {
    const gitignore = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../../.gitignore', import.meta.url), 'utf8'))

    for (const ignoredPath of [
      '.DS_Store',
      '.idea/',
      '.playwright-mcp/',
      'node_modules/',
      'desktop/dist/',
      'desktop/release/',
      'dist/claude-local',
    ]) {
      expect(gitignore).toContain(ignoredPath)
    }
  })

  it('keeps preflight evidence isolated from stale release artifacts', async () => {
    const releaseCiSource = await import('node:fs/promises')
      .then(fs => fs.readFile(new URL('../scripts/release-ci.mjs', import.meta.url), 'utf8'))

    expect(releaseCiSource).toContain('cleanReleaseOutputDirectory()')
    expect(releaseCiSource).toContain('preflightBuildOptions')
    expect(releaseCiSource).toContain("evidencePurpose: 'preflight-only'")
    expect(releaseCiSource).toContain('artifacts: {}')
    expect(releaseCiSource).toContain('artifactDigests: {}')
    expect(releaseCiSource).toContain('artifactVerificationChecks: []')
    expect(releaseCiSource).toContain('checksumManifest: null')
    expect(releaseCiSource).toContain('writeReleaseEvidence(records, undefined, preflightBuildOptions)')
    expect(releaseCiSource).toContain('rmSync(checksumPath)')
    expect(releaseCiSource).toContain('Stale release checksums removed')
  })

  it('cleans stale generated release outputs before writing preflight evidence', () => {
    const directories = new Set([
      '/release/mac-arm64',
      '/release/ux-screenshots',
      '/release/win-unpacked',
    ])
    const removed: string[] = []
    const entries = [
      'release-evidence.json',
      'release-notes-evidence.md',
      'ux-validation-evidence.md',
      'SHA256SUMS',
      'builder-debug.yml',
      'builder-effective-config.yaml',
      'Claude Code Desktop-1.2.2-arm64.dmg',
      'Claude Code Desktop-1.2.2-arm64.dmg.blockmap',
      'Claude Code Desktop-1.2.2-arm64-mac.zip',
      'mac-arm64',
      'ux-screenshots',
      'win-unpacked',
      'operator-notes.md',
    ]

    const result = cleanReleaseOutputDirectory({
      releaseDir: '/release',
      exists: path => path === '/release',
      readDir: () => entries,
      stat: path => ({
        isDirectory: () => directories.has(path),
      }),
      rm: path => removed.push(path),
    })

    expect(result).toEqual(removed)
    expect(removed).toEqual([
      '/release/release-evidence.json',
      '/release/release-notes-evidence.md',
      '/release/SHA256SUMS',
      '/release/builder-debug.yml',
      '/release/builder-effective-config.yaml',
      '/release/Claude Code Desktop-1.2.2-arm64.dmg',
      '/release/Claude Code Desktop-1.2.2-arm64.dmg.blockmap',
      '/release/Claude Code Desktop-1.2.2-arm64-mac.zip',
      '/release/mac-arm64',
      '/release/ux-screenshots',
      '/release/win-unpacked',
    ])
    expect(removed).not.toContain('/release/ux-validation-evidence.md')
    expect(removed).not.toContain('/release/operator-notes.md')
  })

  it('defaults to the local source snapshot metadata', () => {
    const metadata = resolveBuildMetadata({})
    expect(metadata).toEqual({
      version: '999.0.0-local',
      buildTime: '1970-01-01T00:00:00.000Z',
      isRelease: false,
    })
    expect(cliBuildArgs(metadata)).toContain('MACRO.VERSION="999.0.0-local"')
    expect(electronBuilderArgs(metadata)).toContain('--config.mac.forceCodeSigning=false')
    expect(electronBuilderArgs(metadata)).toContain('--config.mac.notarize=false')
  })

  it('uses DESKTOP_RELEASE_VERSION for CLI and Electron release builds', () => {
    const metadata = resolveBuildMetadata({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      DESKTOP_RELEASE_BUILD_TIME: '2026-07-16T00:00:00.000Z',
    })
    expect(metadata).toEqual({
      version: '1.2.3',
      buildTime: '2026-07-16T00:00:00.000Z',
      isRelease: true,
    })
    expect(cliBuildArgs(metadata)).toContain('MACRO.VERSION="1.2.3"')
    expect(cliBuildArgs(metadata)).toContain('MACRO.BUILD_TIME="2026-07-16T00:00:00.000Z"')
    expect(electronBuilderArgs(metadata)).toContain('--config.buildVersion=1.2.3')
    expect(electronBuilderArgs(metadata)).not.toContain('--config.mac.forceCodeSigning=false')
    expect(electronBuilderArgs(metadata)).not.toContain('--config.mac.notarize=false')
  })

  it('creates release package metadata without dropping scripts', () => {
    const releasePackage = JSON.parse(packageJsonForRelease(JSON.stringify({
      name: 'demo',
      version: '999.0.0-local',
      scripts: { build: 'node desktop/scripts/build-cli.mjs' },
      devDependencies: { vitest: 'latest' },
    }), '1.2.3'))

    expect(releasePackage).toEqual({
      name: 'demo',
      version: '1.2.3',
      scripts: { build: 'node desktop/scripts/build-cli.mjs' },
      devDependencies: { vitest: 'latest' },
    })
  })

  it('rejects invalid release versions', () => {
    expect(() => resolveBuildMetadata({
      DESKTOP_RELEASE_VERSION: 'not-a-version',
    })).toThrow('DESKTOP_RELEASE_VERSION must be semver')
  })

  it('discovers release app and versioned DMG artifacts', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/Claude Code Desktop-999.0.0-local-arm64.dmg',
      '/release/Claude Code Desktop-999.0.0-local-arm64-mac.zip',
    ])
    const artifacts = discoverMacReleaseArtifacts({
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || files.has(path),
      readDir: () => [
        'Claude Code Desktop-999.0.0-local-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-999.0.0-local-arm64-mac.zip',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
    })

    expect(artifacts).toEqual({
      appPath: '/release/mac-arm64/Claude Code Desktop.app',
      dmgPath: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      zipPath: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    })
  })

  it('does not fall back to mismatched versioned release artifacts', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-999.0.0-local-arm64-mac.zip',
    ])
    const artifacts = discoverMacReleaseArtifacts({
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || files.has(path),
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-999.0.0-local-arm64-mac.zip',
      ],
    })

    expect(artifacts).toEqual({
      appPath: '/release/mac-arm64/Claude Code Desktop.app',
      dmgPath: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      zipPath: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    })
  })

  it('builds macOS signing, Gatekeeper, notarization, and release metadata checks', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/app.asar',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/dist/claude-local',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/release/release-notes-evidence.md',
      '/release/ux-validation-evidence.md',
      '/release/ux-screenshots/main.png',
    ])
    let releaseNotesEvidenceContents = Buffer.from('')
    const uxValidationEvidenceContents = Buffer.from(completedUxValidationEvidence())
    const plistValues = {
      CFBundleIdentifier: 'com.anthropic.claude-code-desktop',
      CFBundleShortVersionString: '1.2.3',
      CFBundleVersion: '1.2.3',
    }
    const runReleaseCommand = (command: string, args: string[]) => {
      if (command === 'plutil') {
        return {
          status: 0,
          stdout: `${plistValues[args[1] as keyof typeof plistValues]}\n`,
          stderr: '',
        }
      }
      if (command === 'unzip') {
        return {
          status: 0,
          stdout: 'Claude Code Desktop.app/Contents/Info.plist\n',
          stderr: '',
        }
      }
      if (command === 'npx') {
        if (args.includes('extract-file')) {
          return {
            status: 0,
            stdout: JSON.stringify({
              main: 'desktop/dist/main/main.js',
              version: '1.2.3',
            }),
            stderr: '',
          }
        }
        return {
          status: 0,
          stdout: [
            '/desktop/dist/main/main.js',
            '/desktop/dist/preload/preload.cjs',
            '/desktop/dist/renderer/index.html',
          ].join('\n'),
          stderr: '',
        }
      }
      if (command === 'codesign' && args.includes('-dv')) {
        return {
          status: 0,
          stdout: '',
          stderr: [
            'Authority=Developer ID Application: Anthropic PBC (ABCDE12345)',
            'Authority=Developer ID Certification Authority',
            'Authority=Apple Root CA',
            'TeamIdentifier=ABCDE12345',
          ].join('\n'),
        }
      }
      return { status: 0, stdout: '', stderr: '' }
    }
    let releaseEvidenceContents = Buffer.from('')
    const requiredUxScreenshots = requiredUxScreenshotMetadata()
    const artifactContents = {
      '/release/Claude Code Desktop-1.2.3-arm64.dmg': Buffer.from('dmg-data'),
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip': Buffer.from('zip-data'),
      [repoLockfilePath]: Buffer.from('lock-data'),
      [repoReleaseCiPath]: releaseToolingBuffers.releaseCi,
      [repoReleaseVerifierPath]: releaseToolingBuffers.releaseVerifier,
      [repoReleaseWorkflowPath]: releaseToolingBuffers.releaseWorkflow,
      '/release/ux-validation-evidence.md': uxValidationEvidenceContents,
      ...Object.fromEntries(requiredSmokeScreenshots.map(name => [
        uxScreenshotPath(name),
        uxScreenshotContents(name),
      ])),
      '/release/SHA256SUMS': Buffer.from([
        'c99d7be6e81807da89b9b67a6e78ce9dd6f23766a939b60054efce19e2b6d23e  Claude Code Desktop-1.2.3-arm64.dmg',
        '00c11ef6a96eac1263aef4878e7d5a8b35fea40863f5d1c84f15ffa19f65ecae  Claude Code Desktop-1.2.3-arm64-mac.zip',
        '',
      ].join('\n')),
    }
    const readFile = (path: string) => {
      if (path === '/release/release-evidence.json') return releaseEvidenceContents
      if (path === '/release/release-notes-evidence.md') return releaseNotesEvidenceContents
      return artifactContents[path as keyof typeof artifactContents] ?? Buffer.from('')
    }
    const artifactVerificationChecks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readFile,
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      stat: () => ({ mode: 0o100755 }),
      run: runReleaseCommand,
      skipReleaseEvidenceChecks: true,
    })
      .filter(check => requiredReleaseEvidenceArtifactCheckIds.includes(check.id))
      .map(check => ({
        id: check.id,
        status: check.status,
        message: check.message,
        evidence: check.evidence,
        ...(check.nextAction ? { nextAction: check.nextAction } : {}),
      }))
    releaseNotesEvidenceContents = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Generated at: `2026-07-16T00:00:00.000Z`',
      '- Repository: `anthropics/claude-code`',
      '- Ref: `desktop-v1.2.3`',
      '- Ref type: `tag`',
      '- Event: `push`',
      '- CI run: https://github.com/anthropics/claude-code/actions/runs/123/attempts/1',
      '- Signing: `csc-link` via `inline`',
      '- Notarization: `api-key` via `path`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- Toolchain: `bun@1.3.14`, `node@22.18.0`',
      '- Lockfile: `bun.lock` `0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac`',
      '- Release tooling: `3` files',
      `- UX validation: \`ux-validation-evidence.md\` \`${createHash('sha256').update(uxValidationEvidenceContents).digest('hex')}\``,
      `- UX screenshots: \`${requiredSmokeScreenshots.length}\``,
      '',
      '## Artifact Verification',
      '',
      ...artifactVerificationChecks.flatMap(check => {
        const lines = [`- \`${check.id}\`: ${check.status} - ${check.message}`]
        if (requiredReleaseNotesEvidenceDetailCheckIds.includes(check.id)) {
          lines.push(`  - Evidence: \`${String(check.evidence ?? '<missing>').replace(/\s+/g, ' ').trim().replaceAll('`', "'") || '<missing>'}\``)
        }
        return lines
      }),
      '',
      '## Pipeline Steps',
      '',
      ...requiredReleaseEvidenceStepIds.map(id => {
        const step = releaseEvidenceStepRecord(id)
        return `- \`${step.id}\`: ${step.status} (${step.durationMs ?? 0} ms)`
      }),
      '',
      '## Smoke Summary',
      '',
      `- \`terminalMode\`: \`${requiredSmokeSummary.terminalMode}\``,
      ...Object.entries(requiredSmokeSummary.requiredFlags)
        .map(([flag, value]) => `- \`${flag}\`: \`${value}\``),
      '',
      '## Release Tooling',
      '',
      `- \`desktop/scripts/release-ci.mjs\`: \`${releaseToolingMetadata().releaseCi.sha256}\` (${releaseToolingMetadata().releaseCi.sizeBytes} bytes)`,
      `- \`desktop/scripts/verify-release-artifacts.mjs\`: \`${releaseToolingMetadata().releaseVerifier.sha256}\` (${releaseToolingMetadata().releaseVerifier.sizeBytes} bytes)`,
      `- \`.github/workflows/desktop-release.yml\`: \`${releaseToolingMetadata().releaseWorkflow.sha256}\` (${releaseToolingMetadata().releaseWorkflow.sizeBytes} bytes)`,
      '',
      '## UX Validation',
      '',
      '- Validator: `Release QA, 2026-07-16`',
      '- Representative user: `Desktop engineer, 2026-07-16`',
      '- Representative user validation: `observed, Release PM, 2026-07-16`',
      '- Known limitations accepted: `yes, Release QA`',
      '- UX approval: `approved` by `Release QA` on `2026-07-16`',
      '',
      '## UX Screenshots',
      '',
      ...requiredUxScreenshots
        .map(screenshot => `- \`${screenshot.path}\`: \`${screenshot.sha256}\` (${screenshot.sizeBytes} bytes)`),
      '',
    ].join('\n'))
    releaseEvidenceContents = Buffer.from(JSON.stringify({
        schemaVersion: 1,
        product: 'Claude Code Desktop',
        releaseVersion: '1.2.3',
        commit: 'abc123',
        generatedAt: '2026-07-16T00:00:00.000Z',
        platform: 'darwin',
        arch: 'arm64',
        source: {
          repository: 'anthropics/claude-code',
          refName: 'desktop-v1.2.3',
          refType: 'tag',
          eventName: 'push',
          commit: 'abc123',
          ciRunId: '123',
          ciRunAttempt: '1',
          ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123/attempts/1',
        },
        releaseCredentials: {
          signing: {
            strategy: 'csc-link',
            source: 'inline',
          },
          notarization: {
            strategy: 'api-key',
            source: 'path',
          },
        },
        artifacts: {
          appPath: '/release/mac-arm64/Claude Code Desktop.app',
          dmgPath: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
          zipPath: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
        },
        artifactDigests: {
          dmgPath: {
            path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
            type: 'file',
            sha256: 'c99d7be6e81807da89b9b67a6e78ce9dd6f23766a939b60054efce19e2b6d23e',
          },
          zipPath: {
            path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
            type: 'file',
            sha256: '00c11ef6a96eac1263aef4878e7d5a8b35fea40863f5d1c84f15ffa19f65ecae',
          },
        },
        checksumManifest: {
          path: '/release/SHA256SUMS',
          type: 'file',
          sizeBytes: 208,
          sha256: '04ccab9ea2f3f52a036d296ffc26e6012c8bacf5a268fa123f9be814f0cf9f1c',
        },
        toolchain: {
          packageManager: 'bun@1.3.14',
          node: '22.18.0',
          lockfile: {
            path: repoLockfilePath,
            exists: true,
            type: 'file',
            sizeBytes: 9,
            sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
          },
        },
        releaseTooling: releaseToolingMetadata(),
        releaseNotesEvidence: {
          path: '/release/release-notes-evidence.md',
          type: 'file',
          sizeBytes: releaseNotesEvidenceContents.byteLength,
          sha256: createHash('sha256').update(releaseNotesEvidenceContents).digest('hex'),
        },
        uxValidationEvidence: {
          path: '/release/ux-validation-evidence.md',
          exists: true,
          type: 'file',
          sizeBytes: uxValidationEvidenceContents.byteLength,
          sha256: createHash('sha256').update(uxValidationEvidenceContents).digest('hex'),
        },
        uxValidationSummary: {
          validator: 'Release QA, 2026-07-16',
          representativeUser: 'Desktop engineer, 2026-07-16',
          representativeUserValidation: 'observed, Release PM, 2026-07-16',
          representativeUserValidationStatus: 'observed',
          representativeUserValidationFacilitator: 'Release PM',
          representativeUserValidationDate: '2026-07-16',
          knownLimitationsAccepted: 'yes, Release QA',
          knownLimitationsApprover: 'Release QA',
          uxApprovalStatus: 'approved',
          uxApprovalApprover: 'Release QA',
          uxApprovalDate: '2026-07-16',
        },
        artifactVerificationChecks,
        steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
        uxScreenshots: requiredUxScreenshots,
      }))
    const commands: string[] = []
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readFile,
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      stat: () => ({ mode: 0o100755 }),
      run: (command, args) => {
        commands.push([command, ...args].join(' '))
        return runReleaseCommand(command, args)
      },
    })

    expect(checks.every(check => check.status === 'pass')).toBe(true)
    expect(checks.map(check => check.id)).toEqual([
      'mac-app-artifact',
      'mac-dmg-artifact',
      'mac-zip-artifact',
      'mac-release-evidence',
      'mac-release-evidence-sensitive-content',
      'mac-release-evidence-identity',
      'mac-release-evidence-purpose',
      'mac-release-evidence-version',
      'mac-release-evidence-target',
      'mac-release-evidence-source',
      'mac-release-evidence-artifacts',
      'mac-dmg-evidence-checksum',
      'mac-zip-evidence-checksum',
      'mac-release-evidence-checksum-manifest',
      'mac-release-evidence-toolchain',
      'mac-release-evidence-tooling',
      'mac-release-evidence-credentials',
      'mac-release-evidence-pipeline-steps',
      'mac-release-evidence-smoke-summary',
      'mac-release-evidence-ux-screenshots',
      'mac-release-evidence-ux-validation',
      'mac-release-notes-sensitive-content',
      'mac-release-notes-evidence',
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
      'mac-app-gatekeeper',
      'mac-app-notarization',
      'mac-dmg-codesign',
      'mac-signing-identity-consistency',
      'mac-dmg-gatekeeper',
      'mac-dmg-notarization',
      'mac-release-evidence-verification-checks',
    ])
    expect(commands).toEqual([
      'ditto -t -k /release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      'unzip -l /release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      'hdiutil verify /release/Claude Code Desktop-1.2.3-arm64.dmg',
      'npx --no-install asar list /release/mac-arm64/Claude Code Desktop.app/Contents/Resources/app.asar',
      'npx --no-install asar extract-file /release/mac-arm64/Claude Code Desktop.app/Contents/Resources/app.asar package.json',
      'plutil -extract CFBundleIdentifier raw /release/mac-arm64/Claude Code Desktop.app/Contents/Info.plist',
      'plutil -extract CFBundleShortVersionString raw /release/mac-arm64/Claude Code Desktop.app/Contents/Info.plist',
      'plutil -extract CFBundleVersion raw /release/mac-arm64/Claude Code Desktop.app/Contents/Info.plist',
      'codesign --verify --deep --strict --verbose=2 /release/mac-arm64/Claude Code Desktop.app',
      'codesign -dv --verbose=4 /release/mac-arm64/Claude Code Desktop.app',
      'spctl --assess --type execute --verbose /release/mac-arm64/Claude Code Desktop.app',
      'xcrun stapler validate /release/mac-arm64/Claude Code Desktop.app',
      'codesign --verify --verbose=2 /release/Claude Code Desktop-1.2.3-arm64.dmg',
      'codesign -dv --verbose=4 /release/Claude Code Desktop-1.2.3-arm64.dmg',
      'spctl --assess --type open --context context:primary-signature --verbose /release/Claude Code Desktop-1.2.3-arm64.dmg',
      'xcrun stapler validate /release/Claude Code Desktop-1.2.3-arm64.dmg',
    ])
  })

  it('fails release artifact verification when release notes evidence is missing', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/release/ux-screenshots/main.png',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
            uxScreenshots: [{
              path: '/release/ux-screenshots/main.png',
              exists: true,
              type: 'file',
              sizeBytes: 15,
              sha256: 'c9f0775628cb480152b054cc99f190339670bc397cd5be16c63978312b9dd4f4',
            }],
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/ux-screenshots/main.png') {
          return Buffer.from('screenshot-data')
        }
        if (path === '/release/release-notes-evidence.md') {
          throw new Error('missing release-notes-evidence.md')
        }
        return Buffer.from('artifact-data')
      },
      run: (command, args) => {
        if (command === 'codesign' && args.includes('-dv')) {
          return {
            status: 0,
            stdout: '',
            stderr: 'Authority=Developer ID Application: Anthropic PBC (ABCDE12345)\nTeamIdentifier=ABCDE12345\n',
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('release-notes-evidence.md'),
    }))
  })

  it('fails release artifact verification when release notes evidence metadata is stale', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/release/release-notes-evidence.md',
      '/release/ux-screenshots/main.png',
    ])
    const releaseNotesEvidenceContents = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `1`',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            releaseNotesEvidence: {
              path: '/release/release-notes-evidence.md',
              type: 'file',
              sizeBytes: releaseNotesEvidenceContents.byteLength,
              sha256: '0000000000000000000000000000000000000000000000000000000000000000',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
            uxScreenshots: [{
              path: '/release/ux-screenshots/main.png',
              exists: true,
              type: 'file',
              sizeBytes: 15,
              sha256: 'c9f0775628cb480152b054cc99f190339670bc397cd5be16c63978312b9dd4f4',
            }],
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/ux-screenshots/main.png') {
          return Buffer.from('screenshot-data')
        }
        if (path === '/release/release-notes-evidence.md') {
          return releaseNotesEvidenceContents
        }
        return Buffer.from('artifact-data')
      },
      run: (command, args) => {
        if (command === 'codesign' && args.includes('-dv')) {
          return {
            status: 0,
            stdout: '',
            stderr: 'Authority=Developer ID Application: Anthropic PBC (ABCDE12345)\nTeamIdentifier=ABCDE12345\n',
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('release-notes-evidence.md expected'),
    }))
  })

  it('fails release artifact verification when release notes evidence path is stale', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/release/release-notes-evidence.md',
    ])
    const releaseNotesEvidenceContents = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `0`',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            releaseNotesEvidence: {
              path: '/old-release/release-notes-evidence.md',
              type: 'file',
              sizeBytes: releaseNotesEvidenceContents.byteLength,
              sha256: createHash('sha256').update(releaseNotesEvidenceContents).digest('hex'),
            },
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/release-notes-evidence.md') {
          return releaseNotesEvidenceContents
        }
        return Buffer.from('artifact-data')
      },
      run: (command, args) => {
        if (command === 'codesign' && args.includes('-dv')) {
          return {
            status: 0,
            stdout: '',
            stderr: 'Authority=Developer ID Application: Anthropic PBC (ABCDE12345)\nTeamIdentifier=ABCDE12345\n',
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('releaseNotesEvidence.path=/old-release/release-notes-evidence.md; expected=/release/release-notes-evidence.md'),
    }))
  })

  it('fails release artifact verification when release notes evidence omits toolchain metadata', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/release/release-notes-evidence.md',
      '/release/bun.lock',
      '/release/ux-screenshots/main.png',
    ])
    const releaseNotesEvidenceContents = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `1`',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            toolchain: {
              packageManager: 'bun@1.3.14',
              node: '22.18.0',
              lockfile: {
                path: '/release/bun.lock',
                exists: true,
                type: 'file',
                sizeBytes: 9,
                sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
              },
            },
            releaseNotesEvidence: {
              path: '/release/release-notes-evidence.md',
              type: 'file',
              sizeBytes: releaseNotesEvidenceContents.byteLength,
              sha256: createHash('sha256').update(releaseNotesEvidenceContents).digest('hex'),
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
            uxScreenshots: [{
              path: '/release/ux-screenshots/main.png',
              exists: true,
              type: 'file',
              sizeBytes: 15,
              sha256: 'c9f0775628cb480152b054cc99f190339670bc397cd5be16c63978312b9dd4f4',
            }],
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/bun.lock') {
          return Buffer.from('lock-data')
        }
        if (path === '/release/ux-screenshots/main.png') {
          return Buffer.from('screenshot-data')
        }
        if (path === '/release/release-notes-evidence.md') {
          return releaseNotesEvidenceContents
        }
        return Buffer.from('artifact-data')
      },
      run: (command, args) => {
        if (command === 'codesign' && args.includes('-dv')) {
          return {
            status: 0,
            stdout: '',
            stderr: 'Authority=Developer ID Application: Anthropic PBC (ABCDE12345)\nTeamIdentifier=ABCDE12345\n',
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('Toolchain'),
    }))
  })

  it('fails release artifact verification when release notes evidence omits release tooling metadata', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/release/release-notes-evidence.md',
      repoLockfilePath,
    ])
    const releaseNotesEvidenceContents = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Generated at: `2026-07-16T00:00:00.000Z`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- Toolchain: `bun@1.3.14`, `node@22.18.0`',
      '- Lockfile: `bun.lock` `0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac`',
      '- UX screenshots: `0`',
      '',
      '## Artifact Verification',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        const toolingContents = releaseToolingReadFile(path)
        if (toolingContents) return toolingContents
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            generatedAt: '2026-07-16T00:00:00.000Z',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            toolchain: {
              packageManager: 'bun@1.3.14',
              node: '22.18.0',
              lockfile: {
                path: repoLockfilePath,
                exists: true,
                type: 'file',
                sizeBytes: 9,
                sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
              },
            },
            releaseTooling: releaseToolingMetadata(),
            releaseNotesEvidence: {
              path: '/release/release-notes-evidence.md',
              type: 'file',
              sizeBytes: releaseNotesEvidenceContents.byteLength,
              sha256: createHash('sha256').update(releaseNotesEvidenceContents).digest('hex'),
            },
            artifactVerificationChecks: [],
            steps: [],
            uxScreenshots: [],
          }))
        }
        if (path === '/release/release-notes-evidence.md') {
          return releaseNotesEvidenceContents
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === repoLockfilePath) {
          return Buffer.from('lock-data')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('Release tooling: `3` files'),
    }))
  })

  it('fails release artifact verification when release notes evidence omits credential metadata', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/release/release-notes-evidence.md',
      '/release/ux-screenshots/main.png',
    ])
    const releaseNotesEvidenceContents = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `1`',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            releaseCredentials: {
              signing: {
                strategy: 'csc-link',
                source: 'inline',
              },
              notarization: {
                strategy: 'apple-id',
                source: 'account',
              },
            },
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            releaseNotesEvidence: {
              path: '/release/release-notes-evidence.md',
              type: 'file',
              sizeBytes: releaseNotesEvidenceContents.byteLength,
              sha256: createHash('sha256').update(releaseNotesEvidenceContents).digest('hex'),
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
            uxScreenshots: [{
              path: '/release/ux-screenshots/main.png',
              exists: true,
              type: 'file',
              sizeBytes: 15,
              sha256: 'c9f0775628cb480152b054cc99f190339670bc397cd5be16c63978312b9dd4f4',
            }],
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/ux-screenshots/main.png') {
          return Buffer.from('screenshot-data')
        }
        if (path === '/release/release-notes-evidence.md') {
          return releaseNotesEvidenceContents
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('Signing'),
    }))
  })

  it('fails release artifact verification when release notes evidence omits artifact verification summary', () => {
    const files = new Set([
      '/release/release-evidence.json',
      '/release/release-notes-evidence.md',
    ])
    const releaseNotesEvidenceContents = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `0`',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            releaseNotesEvidence: {
              path: '/release/release-notes-evidence.md',
              type: 'file',
              sizeBytes: releaseNotesEvidenceContents.byteLength,
              sha256: createHash('sha256').update(releaseNotesEvidenceContents).digest('hex'),
            },
            artifactVerificationChecks: [{
              id: 'mac-app-codesign',
              status: 'pass',
              message: 'macOS app has a valid Developer ID Application code signature.',
              evidence: 'TeamIdentifier=ABCDE12345',
            }],
          }))
        }
        if (path === '/release/release-notes-evidence.md') {
          return releaseNotesEvidenceContents
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('Artifact Verification'),
    }))
  })

  it('fails release artifact verification when release notes evidence omits generation timestamp', () => {
    const files = new Set([
      '/release/release-evidence.json',
      '/release/release-notes-evidence.md',
    ])
    const releaseNotesEvidenceContents = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `0`',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            generatedAt: '2026-07-16T00:00:00.000Z',
            platform: 'darwin',
            arch: 'arm64',
            releaseNotesEvidence: {
              path: '/release/release-notes-evidence.md',
              type: 'file',
              sizeBytes: releaseNotesEvidenceContents.byteLength,
              sha256: createHash('sha256').update(releaseNotesEvidenceContents).digest('hex'),
            },
          }))
        }
        if (path === '/release/release-notes-evidence.md') {
          return releaseNotesEvidenceContents
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('Generated at'),
    }))
  })

  it('fails release artifact verification when release evidence omits credential metadata', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/release/release-notes-evidence.md',
      '/release/bun.lock',
      '/release/ux-validation-evidence.md',
      '/release/ux-screenshots/main.png',
    ])
    const uxValidationEvidenceContents = Buffer.from(completedUxValidationEvidence())
    const releaseNotesEvidenceContents = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- Toolchain: `bun@1.3.14`, `node@22.18.0`',
      '- Lockfile: `bun.lock` `0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac`',
      '- UX validation: `ux-validation-evidence.md` `818d412ef36f7cb9a3d9e7450b30e3f3b85195b48da6dca7a2b02ed536a32968`',
      '- UX screenshots: `1`',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            toolchain: {
              packageManager: 'bun@1.3.14',
              node: '22.18.0',
              lockfile: {
                path: '/release/bun.lock',
                exists: true,
                type: 'file',
                sizeBytes: 9,
                sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
              },
            },
            releaseNotesEvidence: {
              path: '/release/release-notes-evidence.md',
              type: 'file',
              sizeBytes: releaseNotesEvidenceContents.byteLength,
              sha256: createHash('sha256').update(releaseNotesEvidenceContents).digest('hex'),
            },
            uxValidationEvidence: {
              path: '/release/ux-validation-evidence.md',
              exists: true,
              type: 'file',
              sizeBytes: uxValidationEvidenceContents.byteLength,
              sha256: createHash('sha256').update(uxValidationEvidenceContents).digest('hex'),
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
            uxScreenshots: [{
              path: '/release/ux-screenshots/main.png',
              exists: true,
              type: 'file',
              sizeBytes: 15,
              sha256: 'c9f0775628cb480152b054cc99f190339670bc397cd5be16c63978312b9dd4f4',
            }],
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/bun.lock') {
          return Buffer.from('lock-data')
        }
        if (path === '/release/ux-validation-evidence.md') {
          return uxValidationEvidenceContents
        }
        if (path === '/release/ux-screenshots/main.png') {
          return Buffer.from('screenshot-data')
        }
        if (path === '/release/release-notes-evidence.md') {
          return releaseNotesEvidenceContents
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-credentials',
      status: 'fail',
      evidence: expect.stringContaining('releaseCredentials'),
    }))
  })

  it('fails release artifact verification when release evidence includes raw credential material', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            releaseCredentials: {
              signing: {
                strategy: 'csc-link',
                source: 'inline',
                password: 'certificate-password',
              },
              notarization: {
                strategy: 'api-key',
                source: 'inline',
                apiKey: '-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
              },
            },
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-credentials',
      status: 'fail',
      evidence: expect.stringContaining('releaseCredentials.signing.password; releaseCredentials.notarization.apiKey'),
    }))
  })

  it('fails release artifact verification when credential strategy and source do not match', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            releaseCredentials: {
              signing: {
                strategy: 'csc-name',
                source: 'inline',
              },
              notarization: {
                strategy: 'apple-id',
                source: 'path',
              },
            },
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-credentials',
      status: 'fail',
      evidence: expect.stringContaining('releaseCredentials.signing.source=inline; expected=keychain for csc-name'),
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-credentials',
      status: 'fail',
      evidence: expect.stringContaining('releaseCredentials.notarization.source=path; expected=account for apple-id'),
    }))
  })

  it('fails release artifact verification when release evidence includes raw secret text outside credential metadata', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            generatedAt: '2026-07-16T00:00:00.000Z',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123456789',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123456789',
            },
            releaseCredentials: {
              signing: {
                strategy: 'csc-link',
                source: 'inline',
              },
              notarization: {
                strategy: 'api-key',
                source: 'path',
              },
            },
            debugDump: '-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-sensitive-content',
      status: 'fail',
      evidence: expect.stringContaining('private key material'),
    }))
  })

  it('fails release artifact verification when release evidence includes placeholder signing bundle text', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            generatedAt: '2026-07-16T00:00:00.000Z',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123456789',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123456789',
            },
            releaseCredentials: {
              signing: {
                strategy: 'csc-link',
                source: 'inline',
              },
              notarization: {
                strategy: 'api-key',
                source: 'path',
              },
            },
            debugDump: 'developer-id-pc12',
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-sensitive-content',
      status: 'fail',
      evidence: expect.stringContaining('placeholder certificate material'),
    }))
  })

  it('fails release artifact verification when release evidence includes JSON secret fields', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            generatedAt: '2026-07-16T00:00:00.000Z',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123456789',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123456789',
            },
            releaseCredentials: {
              signing: {
                strategy: 'csc-link',
                source: 'inline',
              },
              notarization: {
                strategy: 'api-key',
                source: 'path',
              },
            },
            diagnostics: {
              password: 'prod-release-password',
              privateKey: 'inline-private-key-value',
            },
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-sensitive-content',
      status: 'fail',
      evidence: expect.stringContaining('password material'),
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-sensitive-content',
      status: 'fail',
      evidence: expect.stringContaining('private key material'),
    }))
  })

  it('fails release artifact verification when release evidence includes raw signing credential environment values', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            generatedAt: '2026-07-16T00:00:00.000Z',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123456789',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123456789',
            },
            releaseCredentials: {
              signing: {
                strategy: 'csc-link',
                source: 'inline',
              },
              notarization: {
                strategy: 'api-key',
                source: 'path',
              },
            },
            steps: [{
              id: 'desktop-build',
              command: 'bun',
              args: ['run', 'desktop:build'],
              status: 'pass',
              exitCode: 0,
              env: {
                CSC_LINK: 'base64-certificate',
              },
            }],
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-sensitive-content',
      status: 'fail',
      evidence: expect.stringContaining('raw credential environment value'),
    }))
  })

  it('fails release artifact verification when release notes evidence includes raw secret text', () => {
    const secretNotes = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `0`',
      '- Debug password: `certificate-password`',
      '',
      '## Artifact Verification',
      '',
      '- `<none>`',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json' || path === '/release/release-notes-evidence.md',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            generatedAt: '2026-07-16T00:00:00.000Z',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123456789',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123456789',
            },
            releaseCredentials: {
              signing: {
                strategy: 'csc-link',
                source: 'inline',
              },
              notarization: {
                strategy: 'api-key',
                source: 'path',
              },
            },
            releaseNotesEvidence: {
              path: '/release/release-notes-evidence.md',
              type: 'file',
              sizeBytes: secretNotes.byteLength,
              sha256: createHash('sha256').update(secretNotes).digest('hex'),
            },
          }))
        }
        if (path === '/release/release-notes-evidence.md') {
          return secretNotes
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-sensitive-content',
      status: 'fail',
      evidence: expect.stringContaining('password material'),
    }))
  })

  it('fails release artifact verification when release notes evidence includes placeholder signing bundle text', () => {
    const secretNotes = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `0`',
      '- Debug signing bundle: `developer-id-application-p12`',
      '',
      '## Artifact Verification',
      '',
      '- `<none>`',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json' || path === '/release/release-notes-evidence.md',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            generatedAt: '2026-07-16T00:00:00.000Z',
            platform: 'darwin',
            arch: 'arm64',
            evidencePurpose: 'release-artifacts',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123456789',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123456789',
            },
            releaseCredentials: {
              signing: {
                strategy: 'csc-link',
                source: 'inline',
              },
              notarization: {
                strategy: 'api-key',
                source: 'path',
              },
            },
            releaseNotesEvidence: {
              path: '/release/release-notes-evidence.md',
              sha256: createHash('sha256').update(secretNotes).digest('hex'),
              size: secretNotes.length,
            },
          }))
        }
        if (path === '/release/release-notes-evidence.md') return secretNotes
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-sensitive-content',
      status: 'fail',
      evidence: expect.stringContaining('placeholder certificate material'),
    }))
  })

  it('fails release artifact verification when release notes evidence includes raw credential environment assignments', () => {
    const secretNotes = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `0`',
      '- Runner env: `APPLE_API_KEY=/tmp/AuthKey_ABCDE12345.p8`',
      '',
      '## Artifact Verification',
      '',
      '- `<none>`',
      '',
    ].join('\n'))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json' || path === '/release/release-notes-evidence.md',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            generatedAt: '2026-07-16T00:00:00.000Z',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123456789',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123456789',
            },
            releaseCredentials: {
              signing: {
                strategy: 'csc-link',
                source: 'inline',
              },
              notarization: {
                strategy: 'api-key',
                source: 'path',
              },
            },
            releaseNotesEvidence: {
              path: '/release/release-notes-evidence.md',
              type: 'file',
              sizeBytes: secretNotes.byteLength,
              sha256: createHash('sha256').update(secretNotes).digest('hex'),
            },
          }))
        }
        if (path === '/release/release-notes-evidence.md') {
          return secretNotes
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-sensitive-content',
      status: 'fail',
      evidence: expect.stringContaining('raw credential environment value'),
    }))
  })

  it('fails release artifact verification when release evidence omits CI source metadata', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-source',
      status: 'fail',
      evidence: expect.stringContaining('source'),
    }))
  })

  it('fails release artifact verification when CI run URL does not match source metadata', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            generatedAt: '2026-07-16T00:00:00.000Z',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123',
              ciRunUrl: 'https://github.com/other/repo/actions/runs/999',
            },
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-source',
      status: 'fail',
      evidence: expect.stringContaining('source.ciRunUrl=https://github.com/other/repo/actions/runs/999; expected=https://github.com/anthropics/claude-code/actions/runs/123'),
    }))
  })

  it('fails release artifact verification when desktop tag ref does not match release version', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            generatedAt: '2026-07-16T00:00:00.000Z',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.4',
              commit: 'abc123',
              ciRunId: '123',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123',
            },
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-source',
      status: 'fail',
      evidence: expect.stringContaining('source.refName=desktop-v1.2.4; expected=desktop-v1.2.3'),
    }))
  })

  it('fails release artifact verification when CI run URL is not a GitHub HTTPS workflow URL', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            generatedAt: '2026-07-16T00:00:00.000Z',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123',
              ciRunUrl: 'http://ci.example.test/anthropics/claude-code/actions/runs/123',
            },
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-source',
      status: 'fail',
      evidence: expect.stringContaining('source.ciRunUrl=http://ci.example.test/anthropics/claude-code/actions/runs/123; expected=https://github.com/anthropics/claude-code/actions/runs/123'),
    }))
  })

  it('fails release artifact verification when push release source is not a version tag', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            generatedAt: '2026-07-16T00:00:00.000Z',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'main',
              refType: 'branch',
              eventName: 'push',
              commit: 'abc123',
              ciRunId: '123',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123',
            },
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-source',
      status: 'fail',
      evidence: expect.stringContaining('source.refType=branch; expected=tag for push release'),
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-source',
      status: 'fail',
      evidence: expect.stringContaining('source.refName=main; expected=desktop-v1.2.3 for push release'),
    }))
  })

  it('fails release artifact verification when CI run attempt metadata is malformed', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            generatedAt: '2026-07-16T00:00:00.000Z',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              refType: 'tag',
              eventName: 'push',
              commit: 'abc123',
              ciRunId: '123',
              ciRunAttempt: '../2',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123/attempts/2',
            },
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-source',
      status: 'fail',
      evidence: expect.stringContaining('source.ciRunAttempt=../2'),
    }))
  })

  it('fails release artifact verification when release evidence omits identity metadata', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-identity',
      status: 'fail',
      evidence: expect.stringContaining('generatedAt'),
    }))
  })

  it('fails release artifact verification when release evidence is preflight-only', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            generatedAt: '2026-07-16T00:00:00.000Z',
            platform: 'darwin',
            arch: 'arm64',
            evidencePurpose: 'preflight-only',
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-purpose',
      status: 'fail',
      evidence: expect.stringContaining('evidencePurpose=preflight-only'),
    }))
  })

  it('fails release artifact verification when release evidence target differs from verified artifacts', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => path === '/release' || path === '/release/release-evidence.json',
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            generatedAt: '2026-07-16T00:00:00.000Z',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            platform: 'linux',
            arch: 'x64',
          }))
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-target',
      status: 'fail',
      evidence: expect.stringContaining('platform=linux'),
    }))
  })

  it('fails release artifact verification when UX validation evidence still has placeholders', () => {
    const uxValidationEvidenceContents = Buffer.from(completedUxValidationEvidence({
      representativeUser: '[name or role, YYYY-MM-DD]',
    }))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => new Set([
        '/release/mac-arm64/Claude Code Desktop.app',
        '/release/Claude Code Desktop-1.2.3-arm64.dmg',
        '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
        '/release/SHA256SUMS',
        '/release/release-evidence.json',
        '/release/release-notes-evidence.md',
        '/release/bun.lock',
        '/release/ux-validation-evidence.md',
        '/release/ux-screenshots/main.png',
      ]).has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            toolchain: {
              packageManager: 'bun@1.3.14',
              node: '22.18.0',
              lockfile: {
                path: '/release/bun.lock',
                exists: true,
                type: 'file',
                sizeBytes: 9,
                sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
              },
            },
            uxValidationEvidence: {
              path: '/release/ux-validation-evidence.md',
              exists: true,
              type: 'file',
              sizeBytes: uxValidationEvidenceContents.byteLength,
              sha256: createHash('sha256').update(uxValidationEvidenceContents).digest('hex'),
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
            uxScreenshots: [{
              path: '/release/ux-screenshots/main.png',
              exists: true,
              type: 'file',
              sizeBytes: 15,
              sha256: 'c9f0775628cb480152b054cc99f190339670bc397cd5be16c63978312b9dd4f4',
            }],
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/bun.lock') {
          return Buffer.from('lock-data')
        }
        if (path === '/release/ux-validation-evidence.md') {
          return uxValidationEvidenceContents
        }
        if (path === '/release/ux-screenshots/main.png') {
          return Buffer.from('screenshot-data')
        }
        if (path === '/release/release-notes-evidence.md') {
          return Buffer.from('release notes')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-validation',
      status: 'fail',
      evidence: expect.stringContaining('template placeholders'),
    }))
  })

  it('fails release artifact verification when UX validation evidence records failed manual tasks', () => {
    const uxValidationEvidenceContents = Buffer.from(completedUxValidationEvidence({
      manualTaskResult: 'fail',
    }))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => [
        '/release/mac-arm64/Claude Code Desktop.app',
        '/release/Claude Code Desktop-1.2.3-arm64.dmg',
        '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
        '/release/SHA256SUMS',
        '/release/release-evidence.json',
        '/release/release-notes-evidence.md',
        '/release/bun.lock',
        '/release/ux-validation-evidence.md',
        '/release/ux-screenshots/main.png',
        '/release',
      ].includes(path),
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            toolchain: {
              packageManager: 'bun@1.3.14',
              node: '22.18.0',
              lockfile: {
                path: '/release/bun.lock',
                exists: true,
                type: 'file',
                sizeBytes: 9,
                sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
              },
            },
            uxValidationEvidence: {
              path: '/release/ux-validation-evidence.md',
              exists: true,
              type: 'file',
              sizeBytes: uxValidationEvidenceContents.byteLength,
              sha256: createHash('sha256').update(uxValidationEvidenceContents).digest('hex'),
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
            uxScreenshots: [{
              path: '/release/ux-screenshots/main.png',
              exists: true,
              type: 'file',
              sizeBytes: 15,
              sha256: 'c9f0775628cb480152b054cc99f190339670bc397cd5be16c63978312b9dd4f4',
            }],
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/bun.lock') {
          return Buffer.from('lock-data')
        }
        if (path === '/release/ux-validation-evidence.md') return uxValidationEvidenceContents
        if (path === '/release/ux-screenshots/main.png') {
          return Buffer.from('screenshot-data')
        }
        if (path === '/release/release-notes-evidence.md') {
          return Buffer.from('release notes')
        }
        return Buffer.from('release artifact')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-validation',
      status: 'fail',
      evidence: expect.stringContaining('manual task results must all be pass'),
    }))
  })

  it('fails release artifact verification when UX validation summary metadata is stale', () => {
    const uxValidationEvidenceContents = Buffer.from(completedUxValidationEvidence())
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => [
        '/release/mac-arm64/Claude Code Desktop.app',
        '/release/Claude Code Desktop-1.2.3-arm64.dmg',
        '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
        '/release/SHA256SUMS',
        '/release/release-evidence.json',
        '/release/release-notes-evidence.md',
        '/release/bun.lock',
        '/release/ux-validation-evidence.md',
        '/release/ux-screenshots/main.png',
        '/release',
      ].includes(path),
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            toolchain: {
              packageManager: 'bun@1.3.14',
              node: '22.18.0',
              lockfile: {
                path: '/release/bun.lock',
                exists: true,
                type: 'file',
                sizeBytes: 9,
                sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
              },
            },
            uxValidationEvidence: {
              path: '/release/ux-validation-evidence.md',
              exists: true,
              type: 'file',
              sizeBytes: uxValidationEvidenceContents.byteLength,
              sha256: createHash('sha256').update(uxValidationEvidenceContents).digest('hex'),
            },
            uxValidationSummary: {
              validator: 'Release QA, 2026-07-16',
              representativeUser: 'Desktop engineer, 2026-07-16',
              representativeUserValidation: 'observed, Release PM, 2026-07-16',
              representativeUserValidationStatus: 'observed',
              representativeUserValidationFacilitator: 'Release PM',
              representativeUserValidationDate: '2026-07-16',
              knownLimitationsAccepted: 'yes, Release QA',
              knownLimitationsApprover: 'Release QA',
              uxApprovalStatus: 'approved',
              uxApprovalApprover: 'Release QA',
              uxApprovalDate: '2026-07-15',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
            uxScreenshots: [{
              path: '/release/ux-screenshots/main.png',
              exists: true,
              type: 'file',
              sizeBytes: 15,
              sha256: 'c9f0775628cb480152b054cc99f190339670bc397cd5be16c63978312b9dd4f4',
            }],
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/bun.lock') return Buffer.from('lock-data')
        if (path === '/release/ux-validation-evidence.md') return uxValidationEvidenceContents
        if (path === '/release/ux-screenshots/main.png') return Buffer.from('screenshot-data')
        if (path === '/release/release-notes-evidence.md') return Buffer.from('release notes')
        return Buffer.from('release artifact')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-validation',
      status: 'fail',
      evidence: expect.stringContaining('uxApprovalDate=2026-07-15; expected=2026-07-16'),
    }))
  })

  it('fails release artifact verification when UX validation evidence belongs to a different release candidate', () => {
    const uxValidationEvidenceContents = Buffer.from(completedUxValidationEvidence({
      version: '1.2.2',
      commit: 'oldcommit',
    }))
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => [
        '/release',
        '/release/release-evidence.json',
        '/release/ux-validation-evidence.md',
      ].includes(path),
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            commit: 'abc123',
            uxValidationEvidence: {
              path: '/release/ux-validation-evidence.md',
              exists: true,
              type: 'file',
              sizeBytes: uxValidationEvidenceContents.byteLength,
              sha256: createHash('sha256').update(uxValidationEvidenceContents).digest('hex'),
            },
          }))
        }
        if (path === '/release/ux-validation-evidence.md') {
          return uxValidationEvidenceContents
        }
        return Buffer.from('')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-validation',
      status: 'fail',
      evidence: expect.stringContaining('Version=1.2.2 does not match releaseVersion=1.2.3'),
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-validation',
      status: 'fail',
      evidence: expect.stringContaining('Commit=oldcommit does not match release commit=abc123'),
    }))
  })

  it('fails release artifact verification when UX validation evidence path is stale', () => {
    const uxValidationEvidenceContents = Buffer.from(completedUxValidationEvidence())
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/old-release/ux-validation-evidence.md',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            uxValidationEvidence: {
              path: '/old-release/ux-validation-evidence.md',
              exists: true,
              type: 'file',
              sizeBytes: uxValidationEvidenceContents.byteLength,
              sha256: createHash('sha256').update(uxValidationEvidenceContents).digest('hex'),
            },
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/old-release/ux-validation-evidence.md') {
          return uxValidationEvidenceContents
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-validation',
      status: 'fail',
      evidence: expect.stringContaining('uxValidationEvidence.path=/old-release/ux-validation-evidence.md; expected=/release/ux-validation-evidence.md'),
    }))
  })

  it('fails release artifact verification when release evidence omits UX screenshot metadata', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-screenshots',
      status: 'fail',
      evidence: expect.stringContaining('missing uxScreenshots'),
    }))
  })

  it('fails release artifact verification when release evidence omits required UX screenshots', () => {
    const screenshotNames = requiredSmokeScreenshots.filter(name => name !== 'preview.png')
    const screenshots = requiredUxScreenshotMetadata()
      .filter(screenshot => !String(screenshot.path).endsWith('/preview.png'))
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      ...screenshotNames.map(name => uxScreenshotPath(name)),
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            uxScreenshots: screenshots,
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        const screenshotName = screenshotNames.find(name => path === uxScreenshotPath(name))
        if (screenshotName) {
          return uxScreenshotContents(screenshotName)
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-screenshots',
      status: 'fail',
      evidence: expect.stringContaining('missing required UX screenshots preview.png'),
    }))
  })

  it('fails release artifact verification when UX screenshot metadata path is stale', () => {
    const screenshotContents = Buffer.from('screenshot-data')
    const screenshotSha256 = createHash('sha256').update(screenshotContents).digest('hex')
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/old-release/ux-screenshots/main.png',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            uxScreenshots: [{
              path: '/old-release/ux-screenshots/main.png',
              exists: true,
              type: 'file',
              sizeBytes: screenshotContents.byteLength,
              sha256: screenshotSha256,
            }],
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/old-release/ux-screenshots/main.png') {
          return screenshotContents
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-screenshots',
      status: 'fail',
      evidence: expect.stringContaining('uxScreenshots.path=/old-release/ux-screenshots/main.png; expected prefix=/release/ux-screenshots/'),
    }))
  })

  it('fails release artifact verification when UX screenshot metadata path escapes the screenshot directory', () => {
    const screenshotContents = Buffer.from('screenshot-data')
    const screenshotSha256 = createHash('sha256').update(screenshotContents).digest('hex')
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/release/ux-screenshots/../main.png',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            uxScreenshots: [{
              path: '/release/ux-screenshots/../main.png',
              exists: true,
              type: 'file',
              sizeBytes: screenshotContents.byteLength,
              sha256: screenshotSha256,
            }],
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/ux-screenshots/../main.png') {
          return screenshotContents
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-screenshots',
      status: 'fail',
      evidence: expect.stringContaining('uxScreenshots.path=/release/ux-screenshots/../main.png; expected directory=/release/ux-screenshots'),
    }))
  })

  it('fails release artifact verification when UX screenshot bytes are not PNG data', () => {
    const screenshotContents = Buffer.from('screenshot-data')
    const screenshotSha256 = createHash('sha256').update(screenshotContents).digest('hex')
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/release/ux-screenshots/main.png',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            uxScreenshots: [{
              path: '/release/ux-screenshots/main.png',
              exists: true,
              type: 'file',
              sizeBytes: screenshotContents.byteLength,
              sha256: screenshotSha256,
            }],
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/release/ux-screenshots/main.png') {
          return screenshotContents
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-screenshots',
      status: 'fail',
      evidence: expect.stringContaining('invalid PNG main.png'),
    }))
  })

  it('fails release artifact verification when UX screenshots are too small for visual review', () => {
    const tinyScreenshot = 'terminal.png'
    const screenshotContents = new Map(requiredSmokeScreenshots.map(name => [
      name,
      name === tinyScreenshot
        ? pngWithDimensions(1, 1, `tiny:${name}`)
        : uxScreenshotContents(name),
    ]))
    const screenshots = requiredSmokeScreenshots.map(name => {
      const contents = screenshotContents.get(name) ?? Buffer.from('')
      return {
        path: uxScreenshotPath(name),
        exists: true,
        type: 'file',
        sizeBytes: contents.byteLength,
        sha256: createHash('sha256').update(contents).digest('hex'),
      }
    })
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      ...requiredSmokeScreenshots.map(name => uxScreenshotPath(name)),
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            uxScreenshots: screenshots,
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        const screenshotName = requiredSmokeScreenshots.find(name => path === uxScreenshotPath(name))
        if (screenshotName) return screenshotContents.get(screenshotName) ?? Buffer.from('')
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-ux-screenshots',
      status: 'fail',
      evidence: expect.stringContaining('too small PNG terminal.png (1x1, 2048 bytes)'),
    }))
  })

  it('fails release artifact verification when release evidence omits required pipeline steps', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds
              .filter(id => id !== 'smoke-packaged')
              .map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('missing smoke-packaged'),
    }))
  })

  it('fails release artifact verification when release evidence omits required smoke summary flags', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      ...requiredSmokeScreenshots.map(name => uxScreenshotPath(name)),
    ])
    const steps = requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord)
      .map(step => step.id === 'smoke-electron'
        ? {
            ...step,
            smokeSummary: {
              ...requiredSmokeSummary,
              requiredFlags: {
                ...requiredSmokeSummary.requiredFlags,
                settingsFirstClassPage: false,
              },
            },
          }
        : step)
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              refType: 'tag',
              eventName: 'push',
              commit: 'abc123',
              ciRunId: '123',
              ciRunAttempt: '1',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123/attempts/1',
            },
            platform: 'darwin',
            arch: 'arm64',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            releaseCredentials: {
              signing: { strategy: 'csc-name', source: 'keychain' },
              notarization: { strategy: 'keychain-profile', source: 'keychain' },
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            uxScreenshots: requiredUxScreenshotMetadata(),
            steps,
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        const screenshotName = requiredSmokeScreenshots.find(name => path === uxScreenshotPath(name))
        if (screenshotName) return uxScreenshotContents(screenshotName)
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-smoke-summary',
      status: 'fail',
      evidence: expect.stringContaining('missing smoke summary flags settingsFirstClassPage'),
    }))
  })

  it('fails release artifact verification when release evidence does not prove PTY terminal mode', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      ...requiredSmokeScreenshots.map(name => uxScreenshotPath(name)),
    ])
    const steps = requiredReleaseEvidenceStepIds.map(releaseEvidenceStepRecord)
      .map(step => step.id === 'smoke-electron'
        ? {
            ...step,
            smokeSummary: {
              ...requiredSmokeSummary,
              terminalMode: 'fallback',
            },
          }
        : step)
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              refType: 'tag',
              eventName: 'push',
              commit: 'abc123',
              ciRunId: '123',
              ciRunAttempt: '1',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123/attempts/1',
            },
            platform: 'darwin',
            arch: 'arm64',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            releaseCredentials: {
              signing: { strategy: 'csc-name', source: 'keychain' },
              notarization: { strategy: 'keychain-profile', source: 'keychain' },
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            uxScreenshots: requiredUxScreenshotMetadata(),
            steps,
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        const screenshotName = requiredSmokeScreenshots.find(name => path === uxScreenshotPath(name))
        if (screenshotName) return uxScreenshotContents(screenshotName)
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-smoke-summary',
      status: 'fail',
      evidence: expect.stringContaining('missing smoke summary flags terminalMode=pty'),
    }))
  })

  it('fails release artifact verification when release evidence omits UX validation preflight', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds
              .filter(id => id !== 'release-ux-validation')
              .map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('release-ux-validation'),
    }))
  })

  it('fails release artifact verification when release evidence omits verify-release proof', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds
              .filter(id => id !== 'verify-release')
              .map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('verify-release'),
    }))
  })

  it('fails release artifact verification when release evidence omits final verification proof', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds
              .filter(id => id !== 'final-verify-release')
              .map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('final-verify-release'),
    }))
  })

  it('still requires verify-release proof while final verification is running', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      allowMissingFinalVerifyReleaseStep: true,
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds
              .filter(id => id !== 'verify-release' && id !== 'final-verify-release')
              .map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('verify-release'),
    }))
  })

  it('allows final verification to run before its own proof is recorded', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      allowMissingFinalVerifyReleaseStep: true,
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds
              .filter(id => id !== 'final-verify-release')
              .map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'pass',
    }))
  })

  it('fails release artifact verification when release evidence records a forged pipeline command', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(id => id === 'desktop-test'
              ? {
                  ...releaseEvidenceStepRecord(id),
                  command: 'true',
                  args: [],
                }
              : releaseEvidenceStepRecord(id)),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('desktop-test command=true; expected=bun run desktop:test'),
    }))
  })

  it('fails release artifact verification when a passing pipeline step records failures', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(id => id === 'desktop-test'
              ? {
                  ...releaseEvidenceStepRecord(id),
                  exitCode: 1,
                  failures: ['simulated failure'],
                }
              : releaseEvidenceStepRecord(id)),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('desktop-test status=pass exitCode=1 failures=1'),
    }))
  })

  it('fails release artifact verification when required pipeline step timing metadata is invalid', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(id => id === 'desktop-test'
              ? {
                  ...releaseEvidenceStepRecord(id),
                  startedAt: '2026-07-16T00:00:02.000Z',
                  endedAt: '2026-07-16T00:00:01.000Z',
                  durationMs: -1,
                }
              : releaseEvidenceStepRecord(id)),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('desktop-test startedAt=2026-07-16T00:00:02.000Z endedAt=2026-07-16T00:00:01.000Z durationMs=-1'),
    }))
  })

  it('fails release artifact verification when packaged smoke screenshot env is missing', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(id => {
              const step = releaseEvidenceStepRecord(id)
              if (id === 'smoke-packaged') {
                delete step.env
              }
              return step
            }),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('smoke-packaged env.DESKTOP_SMOKE_SCREENSHOT_DIR=<missing>; expected=/release/ux-screenshots'),
    }))
  })

  it('fails release artifact verification when verify-release allow env is missing', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(id => {
              const step = releaseEvidenceStepRecord(id)
              if (id === 'verify-release') {
                delete step.env
              }
              return step
            }),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('verify-release env.DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_VERIFY_STEP=<missing>; expected=1'),
    }))
  })

  it('fails release artifact verification when final verify-release allow env is missing', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: requiredReleaseEvidenceStepIds.map(id => {
              const step = releaseEvidenceStepRecord(id)
              if (id === 'final-verify-release') {
                delete step.env
              }
              return step
            }),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('final-verify-release env.DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_FINAL_VERIFY_STEP=<missing>; expected=1'),
    }))
  })

  it('fails release artifact verification when release evidence records pipeline steps out of order', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const outOfOrderStepIds = [
      'release-env',
      'source-check',
      'release-ux-validation',
      'release-machine',
      'desktop-check',
      'desktop-test',
      'smoke-electron',
      'prod-check',
      'desktop-build',
      'smoke-packaged',
      'verify-release',
      'final-verify-release',
    ]
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: 'pass',
              message: `${id} passed`,
              evidence: id,
            })),
            steps: outOfOrderStepIds.map(releaseEvidenceStepRecord),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-pipeline-steps',
      status: 'fail',
      evidence: expect.stringContaining('out of order'),
    }))
  })

  it('fails release artifact verification when release evidence omits required artifact verification checks', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds
              .filter(id => id !== 'mac-dmg-notarization')
              .map(id => ({
                id,
                status: 'pass',
                message: `${id} passed`,
                evidence: id,
              })),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-verification-checks',
      status: 'fail',
      evidence: expect.stringContaining('missing mac-dmg-notarization'),
    }))
  })

  it('fails release artifact verification when release evidence records failed required checks', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            artifactVerificationChecks: requiredReleaseEvidenceArtifactCheckIds.map(id => ({
              id,
              status: id === 'mac-app-codesign' ? 'fail' : 'pass',
              message: `${id} checked`,
              evidence: id === 'mac-app-codesign' ? 'codesign failed' : id,
            })),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-verification-checks',
      status: 'fail',
      evidence: expect.stringContaining('failed mac-app-codesign'),
    }))
  })

  it('fails release artifact verification when app signature is not Developer ID Application', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: () => Buffer.from('artifact-data'),
      run: (command, args) => {
        if (command === 'codesign' && args.includes('-dv')) {
          return {
            status: 0,
            stdout: '',
            stderr: [
              'Authority=Apple Development: Example Person (ABCDE12345)',
              'TeamIdentifier=ABCDE12345',
            ].join('\n'),
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-app-codesign',
      status: 'fail',
      evidence: expect.stringContaining('Authority=Apple Development: Example Person (ABCDE12345); expected leaf Developer ID Application authority'),
    }))
  })

  it('fails release artifact verification when only a non-leaf authority is Developer ID Application', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: () => Buffer.from('artifact-data'),
      run: (command, args) => {
        if (command === 'codesign' && args.includes('-dv')) {
          return {
            status: 0,
            stdout: '',
            stderr: [
              'Authority=Apple Development: Example Person (ABCDE12345)',
              'Authority=Developer ID Application: Anthropic PBC (ABCDE12345)',
              'TeamIdentifier=ABCDE12345',
            ].join('\n'),
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-app-codesign',
      status: 'fail',
      evidence: expect.stringContaining('Authority=Apple Development: Example Person (ABCDE12345); expected leaf Developer ID Application authority'),
    }))
  })

  it('fails release artifact verification when authority team does not match TeamIdentifier', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: () => Buffer.from('artifact-data'),
      run: (command, args) => {
        if (command === 'codesign' && args.includes('-dv')) {
          return {
            status: 0,
            stdout: '',
            stderr: [
              'Authority=Developer ID Application: Anthropic PBC (ABCDE12345)',
              'TeamIdentifier=ZZZZZ99999',
            ].join('\n'),
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-app-codesign',
      status: 'fail',
      evidence: expect.stringContaining('Authority team=ABCDE12345; TeamIdentifier=ZZZZZ99999'),
    }))
  })

  it('fails release artifact verification when the Developer ID certificate chain is incomplete', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: () => Buffer.from('artifact-data'),
      run: (command, args) => {
        if (command === 'codesign' && args.includes('-dv')) {
          return {
            status: 0,
            stdout: '',
            stderr: [
              'Authority=Developer ID Application: Anthropic PBC (ABCDE12345)',
              'TeamIdentifier=ABCDE12345',
            ].join('\n'),
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-app-codesign',
      status: 'fail',
      evidence: expect.stringContaining('missing Developer ID certificate chain authority: Developer ID Certification Authority, Apple Root CA'),
    }))
  })

  it('fails release artifact verification when Developer ID authority omits the team id', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: () => Buffer.from('artifact-data'),
      run: (command, args) => {
        if (command === 'codesign' && args.includes('-dv')) {
          return {
            status: 0,
            stdout: '',
            stderr: [
              'Authority=Developer ID Application: Anthropic PBC',
              'TeamIdentifier=ABCDE12345',
            ].join('\n'),
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-app-codesign',
      status: 'fail',
      evidence: expect.stringContaining('Authority team=<missing>; TeamIdentifier=ABCDE12345'),
    }))
  })

  it('fails release artifact verification when app and DMG signatures use different teams', () => {
    const appPath = '/release/mac-arm64/Claude Code Desktop.app'
    const dmgPath = '/release/Claude Code Desktop-1.2.3-arm64.dmg'
    const files = new Set([
      appPath,
      dmgPath,
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: () => Buffer.from('artifact-data'),
      run: (command, args) => {
        if (command === 'codesign' && args.includes('-dv')) {
          const path = args.at(-1)
          return {
            status: 0,
            stdout: '',
            stderr: [
              `Authority=Developer ID Application: Anthropic PBC (${path === appPath ? 'ABCDE12345' : 'ZZZZZ99999'})`,
              'Authority=Developer ID Certification Authority',
              'Authority=Apple Root CA',
              `TeamIdentifier=${path === appPath ? 'ABCDE12345' : 'ZZZZZ99999'}`,
            ].join('\n'),
          }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-signing-identity-consistency',
      status: 'fail',
      evidence: expect.stringContaining('app TeamIdentifier=ABCDE12345; dmg TeamIdentifier=ZZZZZ99999'),
    }))
  })

  it('fails release artifact verification when release evidence records stale required check evidence', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/app.asar',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/dist/claude-local',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const releaseDirEntries = [
      'Claude Code Desktop-1.2.3-arm64.dmg',
      'Claude Code Desktop-1.2.3-arm64-mac.zip',
    ]
    const checksumManifestContents = Buffer.from([
      '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg',
      '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip',
      '',
    ].join('\n'))
    const plistValues = {
      CFBundleIdentifier: 'com.anthropic.claude-code-desktop',
      CFBundleShortVersionString: '1.2.3',
      CFBundleVersion: '1.2.3',
    }
    const run = (command: string, args: string[]) => {
      if (command === 'plutil') {
        return {
          status: 0,
          stdout: `${plistValues[args[1] as keyof typeof plistValues]}\n`,
          stderr: '',
        }
      }
      if (command === 'unzip') {
        return {
          status: 0,
          stdout: 'Claude Code Desktop.app/Contents/Info.plist\n',
          stderr: '',
        }
      }
      if (command === 'npx') {
        if (args.includes('extract-file')) {
          return {
            status: 0,
            stdout: JSON.stringify({
              main: 'desktop/dist/main/main.js',
              version: '1.2.3',
            }),
            stderr: '',
          }
        }
        return {
          status: 0,
          stdout: [
            '/desktop/dist/main/main.js',
            '/desktop/dist/preload/preload.cjs',
            '/desktop/dist/renderer/index.html',
          ].join('\n'),
          stderr: '',
        }
      }
      if (command === 'codesign' && args.includes('-dv')) {
        return {
          status: 0,
          stdout: '',
          stderr: [
            'Authority=Developer ID Application: Anthropic PBC (ABCDE12345)',
            'Authority=Developer ID Certification Authority',
            'Authority=Apple Root CA',
            'TeamIdentifier=ABCDE12345',
          ].join('\n'),
        }
      }
      return { status: 0, stdout: '', stderr: '' }
    }
    const readFile = (path: string) => {
      if (path === '/release/SHA256SUMS') return checksumManifestContents
      return Buffer.from('artifact-data')
    }
    const currentChecks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => releaseDirEntries,
      readFile,
      stat: () => ({ mode: 0o100755 }),
      run,
      skipReleaseEvidenceChecks: true,
    })
    const artifactVerificationChecks = currentChecks
      .filter(check => requiredReleaseEvidenceArtifactCheckIds.includes(check.id))
      .map(check => ({
        id: check.id,
        status: check.status,
        message: check.message,
        evidence: check.id === 'mac-dmg-checksum' ? 'stale checksum evidence from an older DMG' : check.evidence,
        ...(check.nextAction ? { nextAction: check.nextAction } : {}),
      }))

    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => releaseDirEntries,
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            generatedAt: '2026-07-16T00:00:00.000Z',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123',
              ciRunAttempt: '1',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123/attempts/1',
            },
            artifacts: {
              appPath: '/release/mac-arm64/Claude Code Desktop.app',
              dmgPath: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
              zipPath: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
            },
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            artifactVerificationChecks,
          }))
        }
        return readFile(path)
      },
      stat: () => ({ mode: 0o100755 }),
      run,
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-verification-checks',
      status: 'fail',
      evidence: expect.stringContaining('stale mac-dmg-checksum'),
    }))
  })

  it('fails release artifact verification when release evidence records stale required check messages', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/app.asar',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/dist/claude-local',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const releaseDirEntries = [
      'Claude Code Desktop-1.2.3-arm64.dmg',
      'Claude Code Desktop-1.2.3-arm64-mac.zip',
    ]
    const checksumManifestContents = Buffer.from([
      '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg',
      '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip',
      '',
    ].join('\n'))
    const plistValues = {
      CFBundleIdentifier: 'com.anthropic.claude-code-desktop',
      CFBundleShortVersionString: '1.2.3',
      CFBundleVersion: '1.2.3',
    }
    const run = (command: string, args: string[]) => {
      if (command === 'plutil') {
        return {
          status: 0,
          stdout: `${plistValues[args[1] as keyof typeof plistValues]}\n`,
          stderr: '',
        }
      }
      if (command === 'unzip') {
        return {
          status: 0,
          stdout: 'Claude Code Desktop.app/Contents/Info.plist\n',
          stderr: '',
        }
      }
      if (command === 'npx') {
        if (args.includes('extract-file')) {
          return {
            status: 0,
            stdout: JSON.stringify({
              main: 'desktop/dist/main/main.js',
              version: '1.2.3',
            }),
            stderr: '',
          }
        }
        return {
          status: 0,
          stdout: [
            '/desktop/dist/main/main.js',
            '/desktop/dist/preload/preload.cjs',
            '/desktop/dist/renderer/index.html',
          ].join('\n'),
          stderr: '',
        }
      }
      if (command === 'codesign' && args.includes('-dv')) {
        return {
          status: 0,
          stdout: '',
          stderr: [
            'Authority=Developer ID Application: Anthropic PBC (ABCDE12345)',
            'Authority=Developer ID Certification Authority',
            'Authority=Apple Root CA',
            'TeamIdentifier=ABCDE12345',
          ].join('\n'),
        }
      }
      return { status: 0, stdout: '', stderr: '' }
    }
    const readFile = (path: string) => {
      if (path === '/release/SHA256SUMS') return checksumManifestContents
      return Buffer.from('artifact-data')
    }
    const currentChecks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => releaseDirEntries,
      readFile,
      stat: () => ({ mode: 0o100755 }),
      run,
      skipReleaseEvidenceChecks: true,
    })
    const artifactVerificationChecks = currentChecks
      .filter(check => requiredReleaseEvidenceArtifactCheckIds.includes(check.id))
      .map(check => ({
        id: check.id,
        status: check.status,
        message: check.id === 'mac-dmg-checksum' ? 'Old DMG checksum check from a previous verifier run.' : check.message,
        evidence: check.id === 'mac-dmg-checksum' ? 'old checksum evidence from previous run' : check.evidence,
        ...(check.nextAction ? { nextAction: check.nextAction } : {}),
      }))

    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => releaseDirEntries,
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            generatedAt: '2026-07-16T00:00:00.000Z',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123',
              ciRunAttempt: '1',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123/attempts/1',
            },
            artifacts: {
              appPath: '/release/mac-arm64/Claude Code Desktop.app',
              dmgPath: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
              zipPath: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
            },
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            artifactVerificationChecks,
          }))
        }
        return readFile(path)
      },
      stat: () => ({ mode: 0o100755 }),
      run,
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-verification-checks',
      status: 'fail',
      evidence: expect.stringContaining('stale mac-dmg-checksum'),
    }))
  })

  it('fails release artifact verification when SHA256SUMS is missing artifact checksums', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('0000000000000000000000000000000000000000000000000000000000000000  Claude Code Desktop-1.2.3-arm64.dmg\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-dmg-checksum',
      status: 'fail',
      evidence: expect.stringContaining('expected'),
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-zip-checksum',
      status: 'fail',
      evidence: expect.stringContaining('missing Claude Code Desktop-1.2.3-arm64-mac.zip'),
    }))
  })

  it('fails release artifact verification when release evidence has stale artifact digests', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.4',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '0000000000000000000000000000000000000000000000000000000000000000',
              },
            },
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-version',
      status: 'fail',
      evidence: 'expected 1.2.3, got 1.2.4',
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-dmg-evidence-checksum',
      status: 'fail',
      evidence: expect.stringContaining('expected 682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8'),
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-zip-evidence-checksum',
      status: 'fail',
      evidence: expect.stringContaining('missing zipPath'),
    }))
  })

  it('fails release artifact verification when release evidence artifact paths are stale', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            generatedAt: '2026-07-16T00:00:00.000Z',
            releaseVersion: '1.2.3',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123',
              ciRunAttempt: '1',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123/attempts/1',
            },
            artifacts: {
              appPath: '/release/mac-arm64/Claude Code Desktop.app',
              dmgPath: '/release/Claude Code Desktop-1.2.2-arm64.dmg',
              zipPath: '/release/Claude Code Desktop-1.2.2-arm64-mac.zip',
            },
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-artifacts',
      status: 'fail',
      evidence: expect.stringContaining('artifacts.dmgPath=/release/Claude Code Desktop-1.2.2-arm64.dmg; expected=/release/Claude Code Desktop-1.2.3-arm64.dmg'),
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-dmg-evidence-checksum',
      status: 'pass',
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-zip-evidence-checksum',
      status: 'pass',
    }))
  })

  it('fails release artifact verification when release evidence artifact digest paths are stale', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            schemaVersion: 1,
            product: 'Claude Code Desktop',
            generatedAt: '2026-07-16T00:00:00.000Z',
            releaseVersion: '1.2.3',
            commit: 'abc123',
            platform: 'darwin',
            arch: 'arm64',
            source: {
              repository: 'anthropics/claude-code',
              refName: 'desktop-v1.2.3',
              commit: 'abc123',
              ciRunId: '123',
              ciRunAttempt: '1',
              ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123/attempts/1',
            },
            artifacts: {
              appPath: '/release/mac-arm64/Claude Code Desktop.app',
              dmgPath: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
              zipPath: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
            },
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.2-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-dmg-evidence-checksum',
      status: 'fail',
      evidence: expect.stringContaining('artifactDigests.dmgPath.path=/release/Claude Code Desktop-1.2.2-arm64.dmg; expected=/release/Claude Code Desktop-1.2.3-arm64.dmg'),
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-zip-evidence-checksum',
      status: 'pass',
    }))
  })

  it('fails release artifact verification when release evidence has stale checksum manifest metadata', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 1,
              sha256: '0000000000000000000000000000000000000000000000000000000000000000',
            },
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-checksum-manifest',
      status: 'fail',
      evidence: expect.stringContaining('expected size=208 sha256=eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149'),
    }))
  })

  it('fails release artifact verification when release evidence checksum manifest path is stale', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
    ])
    const checksumManifestContents = Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/old-release/SHA256SUMS',
              type: 'file',
              sizeBytes: checksumManifestContents.byteLength,
              sha256: createHash('sha256').update(checksumManifestContents).digest('hex'),
            },
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return checksumManifestContents
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-checksum-manifest',
      status: 'fail',
      evidence: expect.stringContaining('checksumManifest.path=/old-release/SHA256SUMS; expected=/release/SHA256SUMS'),
    }))
  })

  it('fails release artifact verification when release evidence has stale lockfile metadata', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      repoLockfilePath,
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            toolchain: {
              packageManager: 'bun@1.3.14',
              node: '22.18.0',
              lockfile: {
                path: repoLockfilePath,
                exists: true,
                type: 'file',
                sizeBytes: 1,
                sha256: '0000000000000000000000000000000000000000000000000000000000000000',
              },
            },
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === repoLockfilePath) {
          return Buffer.from('lock-data')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-toolchain',
      status: 'fail',
      evidence: expect.stringContaining('bun.lock expected size=9 sha256=0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac'),
    }))
  })

  it('fails release artifact verification when release evidence lockfile path is stale', () => {
    const lockfileContents = Buffer.from('lock-data')
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      '/old-release/bun.lock',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            toolchain: {
              packageManager: 'bun@1.3.14',
              node: '22.18.0',
              lockfile: {
                path: '/old-release/bun.lock',
                exists: true,
                type: 'file',
                sizeBytes: lockfileContents.byteLength,
                sha256: createHash('sha256').update(lockfileContents).digest('hex'),
              },
            },
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === '/old-release/bun.lock') {
          return lockfileContents
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-toolchain',
      status: 'fail',
      evidence: expect.stringContaining('toolchain.lockfile.path=/old-release/bun.lock; expected='),
    }))
  })

  it('fails release artifact verification when release evidence has stale release tooling metadata', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      repoLockfilePath,
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        const toolingContents = releaseToolingReadFile(path)
        if (toolingContents) return toolingContents
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            toolchain: {
              packageManager: 'bun@1.3.14',
              node: '22.18.0',
              lockfile: {
                path: repoLockfilePath,
                exists: true,
                type: 'file',
                sizeBytes: 9,
                sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
              },
            },
            releaseTooling: releaseToolingMetadata({
              releaseVerifier: {
                sizeBytes: 1,
                sha256: '0000000000000000000000000000000000000000000000000000000000000000',
              },
            }),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === repoLockfilePath) {
          return Buffer.from('lock-data')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-tooling',
      status: 'fail',
      evidence: expect.stringContaining('releaseVerifier expected size=24 sha256='),
    }))
  })

  it('fails release artifact verification when release evidence tooling path is stale', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
      '/release/release-evidence.json',
      repoLockfilePath,
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        const toolingContents = releaseToolingReadFile(path)
        if (toolingContents) return toolingContents
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify({
            releaseVersion: '1.2.3',
            artifactDigests: {
              dmgPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
              zipPath: {
                path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
                type: 'file',
                sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
              },
            },
            checksumManifest: {
              path: '/release/SHA256SUMS',
              type: 'file',
              sizeBytes: 208,
              sha256: 'eb1d6c9c94adf4825a0d84cb6766c17711209caa802d360f4d1fa608d7d57149',
            },
            toolchain: {
              packageManager: 'bun@1.3.14',
              node: '22.18.0',
              lockfile: {
                path: repoLockfilePath,
                exists: true,
                type: 'file',
                sizeBytes: 9,
                sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
              },
            },
            releaseTooling: releaseToolingMetadata({
              releaseWorkflow: {
                path: '/old-release/desktop-release.yml',
              },
            }),
          }))
        }
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        if (path === repoLockfilePath) {
          return Buffer.from('lock-data')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-evidence-tooling',
      status: 'fail',
      evidence: expect.stringContaining('releaseWorkflow.path=/old-release/desktop-release.yml; expected='),
    }))
  })

  it('fails release artifact verification when SHA256SUMS cannot be read', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/SHA256SUMS') {
          throw new Error('permission denied')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-checksum-manifest',
      status: 'fail',
      evidence: expect.stringContaining('permission denied'),
    }))
  })

  it('can skip release evidence self-checks while preserving artifact checks', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      skipReleaseEvidenceChecks: true,
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      readFile: path => {
        if (path === '/release/SHA256SUMS') {
          return Buffer.from('682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64.dmg\n682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
        }
        return Buffer.from('artifact-data')
      },
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    const ids = checks.map(check => check.id)
    expect(ids).toContain('mac-app-artifact')
    expect(ids).toContain('mac-checksum-manifest')
    expect(ids).not.toContain('mac-release-evidence')
    expect(ids).not.toContain('mac-release-evidence-version')
    expect(ids).not.toContain('mac-release-evidence-checksum-manifest')
  })

  it('fails release artifact verification when the ZIP archive does not contain the app bundle', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/dist/claude-local',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      run: (command, args) => {
        if (command === 'unzip') {
          return { status: 0, stdout: 'Archive: release.zip\nREADME.txt\n', stderr: '' }
        }
        if (command === 'plutil') {
          return { status: 0, stdout: args[1] === 'CFBundleIdentifier' ? 'com.anthropic.claude-code-desktop\n' : '1.2.3\n', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-zip-app-bundle',
      status: 'fail',
      evidence: expect.stringContaining('Claude Code Desktop.app/Contents/Info.plist'),
    }))
  })

  it('fails release artifact verification when the packaged Electron renderer bundle is missing', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/app.asar',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/dist/claude-local',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      stat: () => ({ mode: 0o100755 }),
      run: (command, args) => {
        if (command === 'npx') {
          return {
            status: 0,
            stdout: '/desktop/dist/main/main.js\n/desktop/dist/preload/preload.cjs\n',
            stderr: '',
          }
        }
        if (command === 'plutil') {
          return { status: 0, stdout: args[1] === 'CFBundleIdentifier' ? 'com.anthropic.claude-code-desktop\n' : '1.2.3\n', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-renderer-bundle',
      status: 'fail',
      evidence: expect.stringContaining('desktop/dist/renderer/index.html'),
    }))
  })

  it('fails release artifact verification when the packaged Electron package metadata is local', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/app.asar',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/dist/claude-local',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      stat: () => ({ mode: 0o100755 }),
      run: (command, args) => {
        if (command === 'npx' && args.includes('extract-file')) {
          return {
            status: 0,
            stdout: JSON.stringify({
              main: 'desktop/dist/main/main.js',
              version: '999.0.0-local',
            }),
            stderr: '',
          }
        }
        if (command === 'npx') {
          return {
            status: 0,
            stdout: '/desktop/dist/main/main.js\n/desktop/dist/preload/preload.cjs\n/desktop/dist/renderer/index.html\n',
            stderr: '',
          }
        }
        if (command === 'plutil') {
          return { status: 0, stdout: args[1] === 'CFBundleIdentifier' ? 'com.anthropic.claude-code-desktop\n' : '1.2.3\n', stderr: '' }
        }
        return { status: 0, stdout: '', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-package-version',
      status: 'fail',
      evidence: 'expected 1.2.3, got 999.0.0-local',
    }))
  })

  it('fails release artifact verification when the app bundle version is wrong', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/dist/claude-local',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      run: (command, args) => {
        if (command === 'plutil' && args[1] === 'CFBundleShortVersionString') {
          return { status: 0, stdout: '999.0.0-local\n', stderr: '' }
        }
        return { status: 0, stdout: '1.2.3\n', stderr: '' }
      },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-short-version',
      status: 'fail',
      evidence: 'expected 1.2.3, got 999.0.0-local',
    }))
  })

  it('fails release artifact verification when the packaged app is missing the CLI runtime', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-cli-runtime',
      status: 'fail',
      evidence: '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/dist/claude-local',
    }))
  })

  it('fails release artifact verification when packaged runtime executables are not executable', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/dist/claude-local',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      '/release/mac-arm64/Claude Code Desktop.app/Contents/Resources/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      stat: () => ({ mode: 0o100644 }),
      run: command => command === 'plutil'
        ? { status: 0, stdout: '1.2.3\n', stderr: '' }
        : { status: 0, stdout: '', stderr: '' },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-cli-runtime-executable',
      status: 'fail',
      evidence: expect.stringContaining('mode=644'),
    }))
  })

  it('fails release artifact verification when the DMG image is corrupt', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      run: command => command === 'hdiutil'
        ? { status: 1, stdout: '', stderr: 'image verification failed' }
        : { status: 0, stdout: '', stderr: '' },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-dmg-integrity',
      status: 'fail',
      evidence: expect.stringContaining('image verification failed'),
    }))
  })

  it('fails release artifact verification when the ZIP archive is corrupt', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
    ])
    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => files.has(path) || path === '/release',
      readDir: () => [
        'Claude Code Desktop-1.2.3-arm64.dmg',
        'Claude Code Desktop-1.2.3-arm64-mac.zip',
      ],
      run: command => command === 'ditto'
        ? { status: 1, stdout: '', stderr: 'not a zip archive' }
        : { status: 0, stdout: '', stderr: '' },
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-zip-integrity',
      status: 'fail',
      evidence: expect.stringContaining('not a zip archive'),
    }))
  })

  it('fails release artifact verification off macOS', () => {
    const checks = verifyMacReleaseArtifacts({
      platform: 'linux',
      releaseDir: '/release',
      exists: () => false,
      readDir: () => [],
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(checks).toEqual([
      expect.objectContaining({
        id: 'mac-release-platform',
        status: 'fail',
      }),
    ])
  })

  it('requires a production release version before verifying macOS artifacts', () => {
    expect(verifyMacReleaseArtifacts({
      platform: 'darwin',
      version: undefined,
      releaseDir: '/release',
      exists: () => true,
      readDir: () => [],
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })).toEqual([
      expect.objectContaining({
        id: 'mac-release-version',
        status: 'fail',
        evidence: 'DESKTOP_RELEASE_VERSION=<missing>',
      }),
    ])

    expect(verifyMacReleaseArtifacts({
      platform: 'darwin',
      version: '999.0.0-local',
      releaseDir: '/release',
      exists: () => true,
      readDir: () => [],
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })).toEqual([
      expect.objectContaining({
        id: 'mac-release-version',
        status: 'fail',
        evidence: 'DESKTOP_RELEASE_VERSION=999.0.0-local',
      }),
    ])
  })

  it('validates the signed desktop release environment', () => {
    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([])

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      APPLE_ID: 'release@example.invalid',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-secret',
      APPLE_TEAM_ID: 'ABCDE12345',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([])

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
      DESKTOP_UX_VALIDATION_EVIDENCE_PATH: '/release/ux-validation-evidence.md',
    }, {
      readFile: () => 'completed-ux-evidence',
    })).toEqual([])

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Installer: Anthropic PBC (ABCDE12345)',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'CSC_LINK or CSC_NAME must identify a Developer ID Application signing certificate.',
    ])

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_LINK: inlineCertificateBundle,
      CSC_KEY_PASSWORD: 'certificate-password',
      CSC_NAME: 'Developer ID Installer: Anthropic PBC (ABCDE12345)',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([])

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_LINK: truncatedInlineCertificateBundle,
      CSC_KEY_PASSWORD: 'certificate-password',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'Inline CSC_LINK must be a complete PKCS#12 certificate bundle, not a truncated base64 fragment.',
    ])

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_LINK: 'base64-certificate',
      CSC_KEY_PASSWORD: 'certificate-password',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'Inline CSC_LINK must be valid base64 for a Developer ID Application certificate bundle, or a path to an existing certificate file.',
    ])

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_LINK: placeholderCertificateBundle,
      CSC_KEY_PASSWORD: 'certificate-password',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'Inline CSC_LINK must be a real Developer ID Application certificate bundle, not base64-encoded placeholder text.',
    ])

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_LINK: legacyPlaceholderCertificateBundle,
      CSC_KEY_PASSWORD: 'certificate-password',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'Inline CSC_LINK must be a real Developer ID Application certificate bundle, not base64-encoded placeholder text.',
    ])

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_LINK: '/tmp/developer-id-application.p12',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'CSC_KEY_PASSWORD must be set when CSC_LINK is used for the Developer ID Application certificate.',
    ])

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '999.0.0-local',
      CSC_NAME: 'Developer ID Application: Example',
      APPLE_ID: 'example@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'placeholder',
      APPLE_TEAM_ID: 'TEAMID1234',
    })).toEqual([
      'DESKTOP_RELEASE_VERSION must be set to a semver production version.',
      'CSC_LINK or CSC_NAME must identify a Developer ID Application signing certificate.',
      'Configure one macOS notarization credential strategy: APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD/APPLE_ID_PASSWORD + APPLE_TEAM_ID, or APPLE_KEYCHAIN_PROFILE with optional APPLE_KEYCHAIN.',
      'DESKTOP_UX_VALIDATION_EVIDENCE_BASE64 or DESKTOP_UX_VALIDATION_EVIDENCE_PATH must provide the completed UX validation evidence.',
    ])
  })

  it('rejects release environments with invalid UX validation evidence base64', () => {
    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: 'not base64!',
    })).toEqual([
      'DESKTOP_UX_VALIDATION_EVIDENCE_BASE64 must be valid base64-encoded UTF-8 markdown.',
    ])
  })

  it('rejects release environments with unreadable UX validation evidence paths', () => {
    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
      DESKTOP_UX_VALIDATION_EVIDENCE_PATH: '/release/missing-ux-validation-evidence.md',
    }, {
      readFile: () => {
        throw new Error('ENOENT')
      },
    })).toEqual([
      'DESKTOP_UX_VALIDATION_EVIDENCE_PATH could not be read: /release/missing-ux-validation-evidence.md; ENOENT',
    ])
  })

  it('reports malformed App Store Connect notarization metadata', () => {
    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'SHORT',
      APPLE_API_ISSUER: 'not-a-uuid',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'APPLE_API_KEY_ID must be a 10-character App Store Connect key ID.',
      'APPLE_API_ISSUER must be an App Store Connect issuer UUID.',
    ])
  })

  it('reports malformed Apple ID notarization metadata', () => {
    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      APPLE_ID: 'not-an-email',
      APPLE_TEAM_ID: 'SHORT',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'APPLE_ID must be an email address for Apple ID notarization.',
      'APPLE_APP_SPECIFIC_PASSWORD or APPLE_ID_PASSWORD must be set for Apple ID notarization.',
      'APPLE_TEAM_ID must be a 10-character Apple Team ID.',
    ])
  })

  it('reports malformed keychain profile notarization metadata', () => {
    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      APPLE_KEYCHAIN: 'login-keychain',
      APPLE_KEYCHAIN_PROFILE: '../desktop-notary-profile',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'APPLE_KEYCHAIN_PROFILE must be a keychain profile name, not a path or shell fragment.',
      'APPLE_KEYCHAIN must be a local keychain path when provided.',
    ])
  })

  it('requires a Developer ID Application identity when CSC_NAME is used', () => {
    const cscNameResult = checkCodeSigningIdentity({
      CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
    })
    expect(cscNameResult).toEqual(expect.objectContaining({
      id: 'code-signing-identity',
      status: 'pass',
    }))
    expect(cscNameResult.message).toContain('configured')
    expect(cscNameResult.message).not.toContain('available')
    expect(checkCodeSigningIdentity({
      CSC_LINK: '/tmp/developer-id-application.p12',
      CSC_KEY_PASSWORD: 'certificate-password',
      CSC_NAME: 'Developer ID Installer: Anthropic PBC (ABCDE12345)',
    })).toEqual(expect.objectContaining({
      id: 'code-signing-identity',
      status: 'pass',
    }))
    expect(checkCodeSigningIdentity({
      CSC_LINK: 'base64-certificate',
      CSC_KEY_PASSWORD: 'certificate-password',
    })).toEqual(expect.objectContaining({
      id: 'code-signing-identity',
      status: 'fail',
      evidence: 'CSC_LINK is not valid base64 or a local certificate path',
    }))
    expect(checkCodeSigningIdentity({
      CSC_LINK: placeholderCertificateBundle,
      CSC_KEY_PASSWORD: 'certificate-password',
    })).toEqual(expect.objectContaining({
      id: 'code-signing-identity',
      status: 'fail',
      evidence: 'CSC_LINK is base64-encoded placeholder text',
    }))
    expect(checkCodeSigningIdentity({
      CSC_LINK: legacyPlaceholderCertificateBundle,
      CSC_KEY_PASSWORD: 'certificate-password',
    })).toEqual(expect.objectContaining({
      id: 'code-signing-identity',
      status: 'fail',
      evidence: 'CSC_LINK is base64-encoded placeholder text',
    }))
    expect(checkCodeSigningIdentity({
      CSC_LINK: '/tmp/developer-id-application.p12',
    })).toEqual(expect.objectContaining({
      id: 'code-signing-identity',
      status: 'fail',
      evidence: 'CSC_LINK is set but CSC_KEY_PASSWORD is missing or looks like a placeholder',
    }))
    expect(checkCodeSigningIdentity({
      CSC_NAME: 'Developer ID Installer: Anthropic PBC (ABCDE12345)',
    })).toEqual(expect.objectContaining({
      id: 'code-signing-identity',
      status: 'fail',
      evidence: 'CSC_NAME=Developer ID Installer: Anthropic PBC (ABCDE12345)',
    }))
  })

  it('requires CSC_NAME Developer ID Application identities to include a Team ID', () => {
    expect(checkCodeSigningIdentity({
      CSC_NAME: 'Developer ID Application: Anthropic PBC',
    })).toEqual(expect.objectContaining({
      id: 'code-signing-identity',
      status: 'fail',
      evidence: 'CSC_NAME=Developer ID Application: Anthropic PBC',
    }))

    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Application: Anthropic PBC',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'CSC_NAME must be a Developer ID Application identity with a 10-character Team ID, for example: Developer ID Application: Example Corp (ABCDE12345).',
    ])
  })

  it('detects every Electron Builder notarization credential strategy', () => {
    expect(notarizationCredentialStrategy({
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
    })).toBe('api-key')
    expect(notarizationCredentialStrategy({
      APPLE_API_KEY: inlineAppleApiKey,
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
    })).toBe('api-key')
    expect(notarizationCredentialStrategy({
      APPLE_API_KEY: 'not-a-real-api-key',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
    })).toBeUndefined()
    expect(notarizationCredentialStrategy({
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'SHORT',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
    })).toBeUndefined()
    expect(notarizationCredentialStrategy({
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: 'not-a-uuid',
    })).toBeUndefined()
    expect(notarizationCredentialStrategy({
      APPLE_ID: 'release@example.invalid',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-secret',
      APPLE_TEAM_ID: 'ABCDE12345',
    })).toBe('apple-id')
    expect(notarizationCredentialStrategy({
      APPLE_ID: 'not-an-email',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-secret',
      APPLE_TEAM_ID: 'ABCDE12345',
    })).toBeUndefined()
    expect(notarizationCredentialStrategy({
      APPLE_ID: 'release@example.invalid',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-secret',
      APPLE_TEAM_ID: 'SHORT',
    })).toBeUndefined()
    expect(notarizationCredentialStrategy({
      APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
    })).toBe('keychain-profile')
    expect(notarizationCredentialStrategy({
      APPLE_KEYCHAIN_PROFILE: '../desktop-notary-profile',
    })).toBeUndefined()
    expect(notarizationCredentialStrategy({
      APPLE_KEYCHAIN: 'login-keychain',
      APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
    })).toBeUndefined()
    expect(notarizationCredentialStrategy({
      APPLE_API_KEY: 'placeholder',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
    })).toBeUndefined()
  })

  it('rejects release environments with multiple notarization credential strategies', () => {
    expect(validateReleaseEnvironment({
      DESKTOP_RELEASE_VERSION: '1.2.3',
      CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
      APPLE_API_KEY_ID: 'ABCDE12345',
      APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      APPLE_ID: 'release@example.invalid',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-secret',
      APPLE_TEAM_ID: 'ABCDE12345',
      DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: completedUxEvidenceBase64,
    })).toEqual([
      'Configure exactly one macOS notarization credential strategy; found api-key and apple-id.',
    ])
  })

  it('rejects release CI outside macOS before long build steps', () => {
    expect(validateReleaseMachine({
      platform: 'linux',
      run: () => {
        throw new Error('should not check notarytool off macOS')
      },
    })).toEqual([
      'Desktop release CI must run on macOS so signing, notarization, Gatekeeper, and stapler checks are available.',
    ])
  })

  it('requires notarytool on the macOS release runner', () => {
    expect(validateReleaseMachine({
      platform: 'darwin',
      run: (command, args) => {
        const invocation = [command, ...args].join(' ')
        if (invocation.startsWith('git diff')) {
          return { status: 0, stdout: '', stderr: '' }
        }
        return { status: 1, stdout: '', stderr: 'not found' }
      },
    })).toEqual([
      'xcrun notarytool must be available on the release runner. Install Xcode command line tools and accept the Xcode license before running desktop:release-ci.',
      'bun must be available on the release runner before running desktop:release-ci.',
      'electron-builder must be installed in node_modules before running desktop:release-ci.',
      '@electron/asar must be installed in node_modules before running desktop:release-ci.',
    ])
  })

  it('requires release build tooling on the macOS release runner', () => {
    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_LINK: inlineCertificateBundle,
      },
      run: (command, args) => {
        const invocation = [command, ...args].join(' ')
        if (invocation === 'xcrun --find notarytool') {
          return { status: 0, stdout: '/usr/bin/notarytool', stderr: '' }
        }
        if (invocation.startsWith('git diff')) {
          return { status: 0, stdout: '', stderr: '' }
        }
        return { status: 1, stdout: '', stderr: `${invocation} not found` }
      },
    })).toEqual([
      'bun must be available on the release runner before running desktop:release-ci.',
      'electron-builder must be installed in node_modules before running desktop:release-ci.',
      '@electron/asar must be installed in node_modules before running desktop:release-ci.',
    ])
  })

  it('rejects macOS release runners with tracked source changes', () => {
    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_LINK: inlineCertificateBundle,
      },
      run: (command, args) => {
        const invocation = [command, ...args].join(' ')
        if (invocation === 'git diff --quiet --ignore-submodules --') {
          return { status: 1, stdout: '', stderr: '' }
        }
        return { status: 0, stdout: '/usr/bin/notarytool', stderr: '' }
      },
    })).toEqual([
      'Release source tree has tracked file changes. Commit or discard tracked changes before running desktop:release-ci.',
    ])
  })

  it('rejects macOS release runners with staged source changes', () => {
    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_LINK: inlineCertificateBundle,
      },
      run: (command, args) => {
        const invocation = [command, ...args].join(' ')
        if (invocation === 'git diff --cached --quiet --ignore-submodules --') {
          return { status: 1, stdout: '', stderr: '' }
        }
        return { status: 0, stdout: '/usr/bin/notarytool', stderr: '' }
      },
    })).toEqual([
      'Release source tree has staged file changes. Commit or unstage tracked changes before running desktop:release-ci.',
    ])
  })

  it('accepts macOS release runners with notarytool available', () => {
    const commands: string[] = []
    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      },
      run: (command, args) => {
        commands.push([command, ...args].join(' '))
        return {
          status: 0,
          stdout: command === 'security'
            ? '1) ABCDEF123456 "Developer ID Application: Anthropic PBC (ABCDE12345)"'
            : '/usr/bin/notarytool',
          stderr: '',
        }
      },
    })).toEqual([])
    expect(commands).toEqual([
      'xcrun --find notarytool',
      'bun --version',
      'npx --no-install electron-builder --version',
      'npx --no-install asar --version',
      'git diff --quiet --ignore-submodules --',
      'git diff --cached --quiet --ignore-submodules --',
      'security find-identity -v -p codesigning',
    ])
  })

  it('validates inline CSC_LINK certificate bundles on the macOS release runner', () => {
    const commands: string[] = []

    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
      },
      run: (command, args) => {
        commands.push([command, ...args].join(' '))
        const invocation = [command, ...args].join(' ')
        if (invocation === 'openssl pkcs12 -info -noout -passin env:CSC_KEY_PASSWORD') {
          return { status: 1, stdout: '', stderr: 'mac verify failure' }
        }
        return { status: 0, stdout: '/usr/bin/notarytool', stderr: '' }
      },
    })).toEqual([
      'CSC_LINK certificate bundle could not be opened with CSC_KEY_PASSWORD on the release runner.',
    ])
    expect(commands).toContain('openssl pkcs12 -info -noout -passin env:CSC_KEY_PASSWORD')
    expect(commands.join('\n')).not.toContain('certificate-password')
  })

  it('accepts inline CSC_LINK certificate bundles that openssl can read', () => {
    const commands: string[] = []

    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
      },
      run: (command, args) => {
        commands.push([command, ...args].join(' '))
        return { status: 0, stdout: '/usr/bin/notarytool', stderr: '' }
      },
    })).toEqual([])
    expect(commands).toContain('openssl pkcs12 -info -noout -passin env:CSC_KEY_PASSWORD')
  })

  it('validates inline APPLE_API_KEY private keys on the macOS release runner', () => {
    const commands: string[] = []

    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
        APPLE_API_KEY: inlineAppleApiKey,
        APPLE_API_KEY_ID: 'ABCDE12345',
        APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      },
      run: (command, args) => {
        commands.push([command, ...args].join(' '))
        const invocation = [command, ...args].join(' ')
        if (invocation === 'openssl pkey -noout') {
          return { status: 1, stdout: '', stderr: 'private key failure' }
        }
        return {
          status: 0,
          stdout: command === 'security'
            ? '1) ABCDEF123456 "Developer ID Application: Anthropic PBC (ABCDE12345)"'
            : '/usr/bin/notarytool',
          stderr: '',
        }
      },
    })).toEqual([
      'APPLE_API_KEY private key could not be opened on the release runner.',
    ])
    expect(commands).toContain('openssl pkey -noout')
    expect(commands.join('\n')).not.toContain('BEGIN PRIVATE KEY')
  })

  it('accepts inline APPLE_API_KEY private keys that openssl can read', () => {
    const commands: string[] = []

    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
        APPLE_API_KEY: inlineAppleApiKey,
        APPLE_API_KEY_ID: 'ABCDE12345',
        APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      },
      run: (command, args) => {
        commands.push([command, ...args].join(' '))
        return {
          status: 0,
          stdout: command === 'security'
            ? '1) ABCDEF123456 "Developer ID Application: Anthropic PBC (ABCDE12345)"'
            : '/usr/bin/notarytool',
          stderr: '',
        }
      },
    })).toEqual([])
    expect(commands).toContain('openssl pkey -noout')
  })

  it('validates path-based APPLE_API_KEY private keys on the macOS release runner', () => {
    const commands: string[] = []

    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
        APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
        APPLE_API_KEY_ID: 'ABCDE12345',
        APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      },
      exists: path => path === '/tmp/AuthKey_ABCDE12345.p8',
      run: (command, args) => {
        commands.push([command, ...args].join(' '))
        const invocation = [command, ...args].join(' ')
        if (invocation === 'openssl pkey -noout -in /tmp/AuthKey_ABCDE12345.p8') {
          return { status: 1, stdout: '', stderr: 'private key failure' }
        }
        return {
          status: 0,
          stdout: command === 'security'
            ? '1) ABCDEF123456 "Developer ID Application: Anthropic PBC (ABCDE12345)"'
            : '/usr/bin/notarytool',
          stderr: '',
        }
      },
    })).toEqual([
      'APPLE_API_KEY private key could not be opened on the release runner.',
    ])
    expect(commands).toContain('openssl pkey -noout -in /tmp/AuthKey_ABCDE12345.p8')
  })

  it('accepts path-based APPLE_API_KEY private keys that openssl can read', () => {
    const commands: string[] = []

    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
        APPLE_API_KEY: '/tmp/AuthKey_ABCDE12345.p8',
        APPLE_API_KEY_ID: 'ABCDE12345',
        APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      },
      exists: path => path === '/tmp/AuthKey_ABCDE12345.p8',
      run: (command, args) => {
        commands.push([command, ...args].join(' '))
        return {
          status: 0,
          stdout: command === 'security'
            ? '1) ABCDEF123456 "Developer ID Application: Anthropic PBC (ABCDE12345)"'
            : '/usr/bin/notarytool',
          stderr: '',
        }
      },
    })).toEqual([])
    expect(commands).toContain('openssl pkey -noout -in /tmp/AuthKey_ABCDE12345.p8')
  })

  it('rejects macOS release runners missing the configured CSC_NAME identity', () => {
    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_NAME: 'Developer ID Application: Anthropic PBC (ABCDE12345)',
      },
      run: (command) => ({
        status: 0,
        stdout: command === 'security'
          ? '1) ABCDEF123456 "Developer ID Installer: Anthropic PBC (ABCDE12345)"'
          : '/usr/bin/notarytool',
        stderr: '',
      }),
    })).toEqual([
      'CSC_NAME identity was not found in the release runner keychain: Developer ID Application: Anthropic PBC (ABCDE12345)',
    ])
  })

  it('rejects macOS release runners missing path-based signing and notarization secret files', () => {
    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_LINK: '/missing/developer-id-application.p12',
        APPLE_API_KEY: '/missing/AuthKey_ABCDE12345.p8',
        APPLE_API_KEY_ID: 'ABCDE12345',
        APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      },
      exists: () => false,
      run: () => ({ status: 0, stdout: '/usr/bin/notarytool', stderr: '' }),
    })).toEqual([
      'CSC_LINK file was not found on the release runner: /missing/developer-id-application.p12',
      'APPLE_API_KEY file was not found on the release runner: /missing/AuthKey_ABCDE12345.p8',
    ])
  })

  it('expands home-relative signing secret paths before validating file existence', () => {
    const checkedPaths: string[] = []

    expect(validateReleaseMachine({
      platform: 'darwin',
      env: {
        CSC_LINK: '~/developer-id-application.p12',
        APPLE_API_KEY: '~/AuthKey_ABCDE12345.p8',
        APPLE_API_KEY_ID: 'ABCDE12345',
        APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
      },
      exists: path => {
        checkedPaths.push(path)
        return true
      },
      run: () => ({ status: 0, stdout: '/usr/bin/notarytool', stderr: '' }),
    })).toEqual([])

    expect(checkedPaths).toEqual(expect.arrayContaining([
      expect.stringContaining('/developer-id-application.p12'),
      expect.stringContaining('/AuthKey_ABCDE12345.p8'),
    ]))
    expect(checkedPaths.filter(path => path.includes('/AuthKey_ABCDE12345.p8'))).toHaveLength(2)
    expect(checkedPaths.every(path => !path.startsWith('~'))).toBe(true)
  })

  it('accepts a macOS signed release workflow with required secrets and uploads', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'pass',
      }),
    )
  })

  it('rejects release workflows without a GitHub Release publish job', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('        uses: softprops/action-gh-release@v2', '        uses: actions/upload-artifact@v4'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('publish verified desktop artifacts to a GitHub Release'),
      }),
    )
  })

  it('rejects release workflows without release outputs for publishing', () => {
    const workflow = validReleaseWorkflow.replace(
      '    outputs:\n      version: ${{ steps.release-version.outputs.version }}\n      artifact-suffix: ${{ steps.release-version.outputs.artifact-suffix }}\n',
      '',
    )

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('normalized version and artifact-suffix outputs'),
      }),
    )
  })

  it('rejects release workflows when the publish job has insufficient permissions', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      contents: write', '      contents: read'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('publish job permissions must set contents: write'),
      }),
    )
  })

  it('rejects release workflows when the publish job has extra write permissions', () => {
    const workflow = validReleaseWorkflow.replace(
      '    permissions:\n      contents: write\n',
      '    permissions:\n      contents: write\n      actions: write\n',
    )

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('write access beyond contents: actions'),
      }),
    )
  })

  it('rejects release workflows that publish with floating action refs', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('actions/download-artifact@v4', 'actions/download-artifact@main'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('actions/download-artifact@main'),
      }),
    )
  })

  it('rejects release workflows whose publish jobs run desktop scripts without checked-out source and Bun', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      - name: Setup Bun\n        uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: ${{ steps.bun-version.outputs.version }}\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('publish job must checkout source and setup Bun before running desktop release scripts'),
      }),
    )
  })

  it('rejects release workflows that omit checksum publication', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('            desktop/release/publish/diagnostics/SHA256SUMS\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('desktop/release/publish/diagnostics/SHA256SUMS'),
      }),
    )
  })

  it('rejects release workflows that publish before rechecking downloaded checksums', () => {
    const checksumStep = [
      '      - name: Verify release checksums before publishing',
      '        run: |',
      '          set -euo pipefail',
      '          cd desktop/release/publish/artifacts',
      '          sha256sum --check ../diagnostics/SHA256SUMS --strict',
      '          compgen -G "Claude Code Desktop-${{ needs.macos-release.outputs.version }}-*.dmg" >/dev/null',
      '          compgen -G "Claude Code Desktop-${{ needs.macos-release.outputs.version }}-*-mac.zip" >/dev/null',
    ].join('\n')

    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace(`${checksumStep}\n`, ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('verify downloaded DMG and ZIP checksums'),
      }),
    )
  })

  it('rejects release workflows with incomplete publish checksum verification', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          compgen -G "Claude Code Desktop-${{ needs.macos-release.outputs.version }}-*.dmg" >/dev/null\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('check SHA256SUMS'),
      }),
    )
  })

  it('rejects release workflows that publish before rechecking downloaded release evidence', () => {
    const evidenceStep = [
      '      - name: Verify release evidence before publishing',
      '        env:',
      '          EXPECTED_RELEASE_VERSION: ${{ needs.macos-release.outputs.version }}',
      '          EXPECTED_REPOSITORY: ${{ github.repository }}',
      '          EXPECTED_REF_NAME: ${{ github.ref_name }}',
      '          EXPECTED_REF_TYPE: ${{ github.ref_type }}',
      '          EXPECTED_EVENT_NAME: ${{ github.event_name }}',
      '          EXPECTED_COMMIT: ${{ github.sha }}',
      '          EXPECTED_RUN_ID: ${{ github.run_id }}',
      '          EXPECTED_RUN_ATTEMPT: ${{ github.run_attempt }}',
      '          EXPECTED_RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}/attempts/${{ github.run_attempt }}',
      '        run: |',
      '          set -euo pipefail',
      "          node <<'NODE'",
      "          const { createHash } = require('node:crypto')",
      "          const { readFileSync } = require('node:fs')",
      "          const { basename, join } = require('node:path')",
      '          function verifyEvidenceFile(label, expected, path) {',
      "            if (!expected || !expected.sha256 || typeof expected.sizeBytes !== 'number') {",
      '              throw new Error(`release evidence is missing ${label} file metadata`)',
      '            }',
      '            const contents = readFileSync(path)',
      "            const actualSha256 = createHash('sha256').update(contents).digest('hex')",
      '            if (contents.byteLength !== expected.sizeBytes || actualSha256 !== expected.sha256) {',
      '              throw new Error(`${label} did not match release evidence metadata`)',
      '            }',
      '          }',
      '          function verifyScreenshotEvidence(screenshots) {',
      '            if (!Array.isArray(screenshots) || screenshots.length === 0) {',
      "              throw new Error('release evidence is missing UX screenshot metadata')",
      '            }',
      '            for (const screenshot of screenshots) {',
      '              verifyEvidenceFile(',
      "                `UX screenshot ${basename(screenshot.path || '<missing>')}`,",
      '                screenshot,',
      "                join('desktop/release/publish/diagnostics/ux-screenshots', basename(screenshot.path || '')),",
      '              )',
      '            }',
      '          }',
      '          function requireSourceField(source, field, expected) {',
      "            if (String(source?.[field] || '') !== String(expected || '')) {",
      '              throw new Error(`release evidence source.${field} ${source?.[field] || \'<missing>\'} did not match ${expected || \'<missing>\'}`)',
      '            }',
      '          }',
      "          const evidencePath = 'desktop/release/publish/evidence/release-evidence.json'",
      "          const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))",
      '          const expectedVersion = process.env.EXPECTED_RELEASE_VERSION',
      '          if (evidence.releaseVersion !== expectedVersion) {',
      "            throw new Error(`release evidence version ${evidence.releaseVersion || '<missing>'} did not match ${expectedVersion}`)",
      '          }',
      "          if (evidence.evidencePurpose === 'preflight-only') {",
      "            throw new Error('release evidence is preflight-only and cannot be published')",
      '          }',
      '          const source = evidence.source || {}',
      "          requireSourceField(source, 'repository', process.env.EXPECTED_REPOSITORY)",
      "          requireSourceField(source, 'refName', process.env.EXPECTED_REF_NAME)",
      "          requireSourceField(source, 'refType', process.env.EXPECTED_REF_TYPE)",
      "          requireSourceField(source, 'eventName', process.env.EXPECTED_EVENT_NAME)",
      "          requireSourceField(source, 'commit', process.env.EXPECTED_COMMIT)",
      "          requireSourceField(source, 'ciRunId', process.env.EXPECTED_RUN_ID)",
      "          requireSourceField(source, 'ciRunAttempt', process.env.EXPECTED_RUN_ATTEMPT)",
      "          requireSourceField(source, 'ciRunUrl', process.env.EXPECTED_RUN_URL)",
      '          const steps = new Map((evidence.steps || []).map(step => [step.id, step]))',
      "          for (const id of ['verify-release', 'final-verify-release']) {",
      '            const step = steps.get(id)',
      "            if (!step || step.status !== 'pass' || step.exitCode !== 0) {",
      '              throw new Error(`${id} did not pass in release evidence`)',
      '            }',
      '          }',
      '          const checks = new Map((evidence.artifactVerificationChecks || []).map(check => [check.id, check]))',
      "          for (const id of ['mac-app-notarization', 'mac-dmg-notarization', 'mac-app-gatekeeper', 'mac-dmg-gatekeeper']) {",
      '            const check = checks.get(id)',
      "            if (!check || check.status !== 'pass') {",
      '              throw new Error(`${id} did not pass in release evidence`)',
      '            }',
      '          }',
      "          verifyEvidenceFile('checksum manifest', evidence.checksumManifest, 'desktop/release/publish/diagnostics/SHA256SUMS')",
      "          verifyEvidenceFile('release notes evidence', evidence.releaseNotesEvidence, 'desktop/release/publish/evidence/release-notes-evidence.md')",
      "          verifyEvidenceFile('UX validation evidence', evidence.uxValidationEvidence, 'desktop/release/publish/diagnostics/ux-validation-evidence.md')",
      '          verifyScreenshotEvidence(evidence.uxScreenshots)',
      '          NODE',
    ].join('\n')

    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace(`${evidenceStep}\n`, ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('verify downloaded release evidence'),
      }),
    )
  })

  it('rejects release workflows with incomplete publish evidence verification', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace("          if (evidence.evidencePurpose === 'preflight-only') {\n", ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('reject stale/preflight evidence'),
      }),
    )
  })

  it('rejects release workflows that do not verify current CI source metadata before publishing', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace("          requireSourceField(source, 'ciRunUrl', process.env.EXPECTED_RUN_URL)\n", ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('current CI source metadata'),
      }),
    )
  })

  it('rejects release workflows that do not verify publish checksum manifest metadata', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace("          verifyEvidenceFile('checksum manifest', evidence.checksumManifest, 'desktop/release/publish/diagnostics/SHA256SUMS')\n", ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('verify checksum, evidence attachment, and screenshot metadata'),
      }),
    )
  })

  it('rejects release workflows that do not verify publish evidence attachments', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace("          verifyEvidenceFile('UX validation evidence', evidence.uxValidationEvidence, 'desktop/release/publish/diagnostics/ux-validation-evidence.md')\n", ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('verify checksum, evidence attachment, and screenshot metadata'),
      }),
    )
  })

  it('rejects release workflows that do not verify publish UX screenshots', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          verifyScreenshotEvidence(evidence.uxScreenshots)\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('verify checksum, evidence attachment, and screenshot metadata'),
      }),
    )
  })

  it('rejects release workflows that do not archive verified UX screenshots for release publication', () => {
    const screenshotArchiveStep = [
      '      - name: Prepare UX screenshot release evidence archive',
      '        run: |',
      '          set -euo pipefail',
      '          cd desktop/release/publish/diagnostics',
      '          test -d ux-screenshots',
      "          find ux-screenshots -type f -name '*.png' -print0 | LC_ALL=C sort -z | xargs -0 touch -t 198001010000",
      "          find ux-screenshots -type f -name '*.png' | LC_ALL=C sort > ux-screenshots.files",
      '          test -s ux-screenshots.files',
      '          zip -X -q ux-screenshots.zip -@ < ux-screenshots.files',
      '          rm ux-screenshots.files',
    ].join('\n')

    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace(`${screenshotArchiveStep}\n`, ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('archive verified UX screenshots'),
      }),
    )
  })

  it('rejects release workflows that do not publish the UX screenshot archive', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('            desktop/release/publish/diagnostics/ux-screenshots.zip\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('desktop/release/publish/diagnostics/ux-screenshots.zip'),
      }),
    )
  })

  it('rejects release workflows that do not verify draft GitHub Release assets after upload', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          if (!release.isDraft || release.isPrerelease) {\n', '          if (release.isPrerelease) {\n'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('draft state'),
      }),
    )
  })

  it('rejects release workflows that publish the GitHub Release before the final gate', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          draft: true\n', '          draft: false\n'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('created as a draft'),
      }),
    )
  })

  it('rejects release workflows with incomplete published asset verification', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace("          requireMatchingAsset('current-version DMG asset', new RegExp(`^Claude Code Desktop-${escapedVersion}-.+\\\\.dmg$`))\n", ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('every required release asset'),
      }),
    )
  })

  it('rejects release workflows that do not verify downloaded GitHub Release asset bytes', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('downloaded release assets mismatch', 'downloaded release asset mismatch'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('download the published GitHub Release assets'),
      }),
    )
  })

  it('rejects release workflows with incomplete downloaded asset hash verification', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('            const localSize = statSync(localPath).size\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('compare downloaded names, sizes, and SHA-256 hashes'),
      }),
    )
  })

  it('rejects release workflows that do not publish post-publish release evidence', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('bun run desktop:write-published-release-evidence', 'bun run desktop:summarize-published-release-evidence'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('post-publish release evidence'),
      }),
    )
  })

  it('rejects release workflows that do not verify the post-publish evidence download', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('bun run desktop:verify-published-release', 'bun run desktop:inspect-published-release'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('post-publish release evidence'),
      }),
    )
  })

  it('rejects release workflows that do not validate downloaded post-publish evidence content', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          bun run desktop:verify-published-release\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('post-publish release evidence'),
      }),
    )
  })

  it('rejects release workflows that omit post-publish evidence source metadata validation', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          EXPECTED_RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}/attempts/${{ github.run_attempt }}\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('EXPECTED_RUN_URL'),
      }),
    )
  })

  it('rejects release workflows that do not archive post-publish evidence for the final production gate', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      - name: Upload published release evidence\n        uses: actions/upload-artifact@v4\n        with:\n          name: claude-code-desktop-published-evidence-${{ needs.macos-release.outputs.artifact-suffix }}\n          retention-days: 90\n          if-no-files-found: error\n          path: desktop/release/publish/published-release-evidence.json\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('published-release-evidence.json as a retained artifact'),
      }),
    )
  })

  it('rejects release workflows without a final production-gate job', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('bun run desktop:production-gate', 'bun run desktop:test'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('final production-gate job'),
      }),
    )
  })

  it('rejects final production-gate jobs that do not depend on publishing', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('    needs: [macos-release, publish-release]\n', '    needs: [macos-release]\n'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('production-gate job must depend on publish-release'),
      }),
    )
  })

  it('rejects final production-gate jobs that do not run on macos-14', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('    runs-on: macos-14\n    environment: desktop-release\n    timeout-minutes: 30\n', '    runs-on: ubuntu-latest\n    environment: desktop-release\n    timeout-minutes: 30\n'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('production-gate job must run on macos-14'),
      }),
    )
  })

  it('rejects final production-gate jobs without downloaded published evidence', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          name: claude-code-desktop-published-evidence-${{ needs.macos-release.outputs.artifact-suffix }}\n          path: desktop/release/publish\n', '          name: claude-code-desktop-published-evidence-placeholder\n          path: desktop/release/publish\n'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('claude-code-desktop-published-evidence-${{ needs.macos-release.outputs.artifact-suffix }}'),
      }),
    )
  })

  it('rejects final production-gate jobs that do not restore the signed app bundle', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      - name: Restore signed app bundle\n        run: |\n          set -euo pipefail\n          cd desktop/release\n          app_bundle_archive="$(find . -maxdepth 1 -type f -name \'Claude Code Desktop-${{ needs.macos-release.outputs.version }}-app-bundle.tar.gz\' | LC_ALL=C sort | head -n 1)"\n          test -n "$app_bundle_archive"\n          tar -xzf "$app_bundle_archive"\n          restored_app="$(find . -maxdepth 2 -type d -name \'Claude Code Desktop.app\' | LC_ALL=C sort | head -n 1)"\n          test -n "$restored_app"\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('restore the signed .app bundle'),
      }),
    )
  })

  it('rejects final production-gate jobs that do not download published release assets', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          gh release download "$release_tag" \\\n            --repo "${{ github.repository }}" \\\n            --pattern published-release-evidence.json \\\n            --dir desktop/release/publish/downloaded-evidence \\\n            --clobber\n      - name: Run final production gate\n', '      - name: Run final production gate\n'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('published-release-evidence.json before running desktop:production-gate'),
      }),
    )
  })

  it('rejects final production-gate jobs that do not retain production gate evidence', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      - name: Upload production gate evidence\n        if: always()\n        uses: actions/upload-artifact@v4\n        with:\n          name: claude-code-desktop-production-gate-evidence-${{ needs.macos-release.outputs.artifact-suffix }}\n          retention-days: 90\n          if-no-files-found: error\n          path: desktop/release/production-gate-evidence.json\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('production-gate-evidence.json as a retained artifact'),
      }),
    )
  })

  it('rejects final production-gate jobs that do not verify retained production gate evidence', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      - name: Verify production gate evidence\n        if: always()\n        run: |\n          node desktop/scripts/production-gate.mjs verify \\\n            --evidence desktop/release/production-gate-evidence.json \\\n            --published-evidence desktop/release/publish/downloaded-evidence/published-release-evidence.json\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('verify production-gate-evidence.json before upload'),
      }),
    )
  })

  it('rejects final production-gate jobs that do not bind production gate evidence to published release evidence', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('            --published-evidence desktop/release/publish/downloaded-evidence/published-release-evidence.json\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('published-release-evidence.json source metadata'),
      }),
    )
  })

  it('rejects release workflows without a post-gate public release job', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('gh release edit "$release_tag"', 'gh release inspect "$release_tag"'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('publish the draft GitHub Release publicly'),
      }),
    )
  })

  it('rejects public release jobs that do not depend on the final production gate', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('    needs: [macos-release, production-gate]\n', '    needs: [macos-release]\n'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('public release job must depend on production-gate'),
      }),
    )
  })

  it('rejects public release jobs that do not verify the final public asset set', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace("            'published-release-evidence.json',\n", ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('published-release-evidence.json'),
      }),
    )
  })

  it('rejects public release jobs that do not download final public release assets after undrafting', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          rm -rf public-release-output/downloaded-public-release\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('download final public Release assets'),
      }),
    )
  })

  it('rejects public release jobs that do not verify final public release asset hashes', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('final public asset SHA-256', 'final public asset checksum'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('compare final public Release asset names, sizes, and SHA-256 hashes'),
      }),
    )
  })

  it('rejects public release jobs that do not publish production gate evidence as a Release asset', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replaceAll('public-release-input/production-gate-evidence.json', 'public-release-input/missing-gate-evidence.json'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('production-gate-evidence.json'),
      }),
    )
  })

  it('rejects public release jobs that do not validate downloaded production gate evidence before upload', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      - name: Verify downloaded production gate evidence\n        run: node desktop/scripts/production-gate.mjs verify --evidence public-release-input/production-gate-evidence.json --published-evidence public-release-input/published-evidence/published-release-evidence.json\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('production-gate-evidence.json against published-release-evidence.json'),
      }),
    )
  })

  it('rejects public release jobs that do not bind downloaded production gate evidence to published evidence', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      - name: Download published release evidence\n        uses: actions/download-artifact@v4\n        with:\n          name: claude-code-desktop-published-evidence-${{ needs.macos-release.outputs.artifact-suffix }}\n          path: public-release-input/published-evidence\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('published-release-evidence.json'),
      }),
    )
  })

  it('rejects public release jobs that do not verify uploaded production gate evidence bytes', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('public-release-output/downloaded-gate-evidence', 'public-release-output/missing-gate-evidence'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('public-release-output/downloaded-gate-evidence'),
      }),
    )
  })

  it('rejects public release jobs that do not bind final public release evidence to production gate evidence', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          node desktop/scripts/published-release-evidence.mjs verify-public \\\n            --evidence public-release-evidence.json \\\n            --production-gate-evidence public-release-input/production-gate-evidence.json \\\n            --published-evidence public-release-input/published-evidence/published-release-evidence.json\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('public-release-evidence.json to production-gate-evidence.json'),
      }),
    )
  })

  it('rejects public release jobs that do not bind final public release evidence to published release evidence', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('            --published-evidence public-release-input/published-evidence/published-release-evidence.json\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('published-release-evidence.json Release identity'),
      }),
    )
  })

  it('rejects public release jobs that do not record final public release CI source metadata', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          EXPECTED_COMMIT: ${{ github.sha }}\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('EXPECTED_COMMIT'),
      }),
    )
  })

  it('rejects public release jobs that do not upload retained public release evidence', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      - name: Upload public release evidence\n        uses: actions/upload-artifact@v4\n        with:\n          name: claude-code-desktop-public-release-evidence-${{ needs.macos-release.outputs.artifact-suffix }}\n          retention-days: 90\n          if-no-files-found: error\n          path: public-release-evidence.json\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('public-release-evidence.json as a retained artifact'),
      }),
    )
  })

  it('rejects release workflows that do not run the release pipeline on macOS', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('runs-on: macos-14', 'runs-on: ubuntu-latest'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('release job must run on macOS'),
      }),
    )
  })

  it('rejects release workflows without serialized release concurrency', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('concurrency:\n  group: desktop-release-${{ inputs.version || github.ref_name }}\n  cancel-in-progress: false\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('concurrency'),
      }),
    )
  })

  it('rejects release workflows without manual versioned release dispatch', () => {
    const workflow = validReleaseWorkflow.replace(
      '  workflow_dispatch:\n    inputs:\n      version:\n        required: true\n        type: string\n      ux_validation_evidence_base64:\n        required: false\n        type: string\n',
      '',
    )

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('workflow_dispatch'),
      }),
    )
  })

  it('rejects release workflows without desktop-v tag releases', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('  push:\n    tags:\n      - "desktop-v*"\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('desktop-v'),
      }),
    )
  })

  it('rejects release workflows without a protected release environment', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('    environment: desktop-release\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('desktop-release'),
      }),
    )
  })

  it('rejects release workflows without a bounded job timeout', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('    timeout-minutes: 90\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('timeout-minutes'),
      }),
    )
  })

  it('rejects release workflows with an excessive job timeout', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('    timeout-minutes: 90\n', '    timeout-minutes: 360\n'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('timeout-minutes'),
      }),
    )
  })

  it('rejects release workflows without checking out source before release steps', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      - uses: actions/checkout@v4\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('checkout'),
      }),
    )
  })

  it('rejects release workflows that checkout source after dependency installation', () => {
    const workflow = validReleaseWorkflow
      .replace('      - uses: actions/checkout@v4\n', '')
      .replace('      - run: bun install --frozen-lockfile\n', '      - run: bun install --frozen-lockfile\n      - uses: actions/checkout@v4\n')

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('checkout'),
      }),
    )
  })

  it('rejects release workflows that use an unpinned checkout action ref', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('actions/checkout@v4', 'actions/checkout@main'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('actions/checkout@v4'),
      }),
    )
  })

  it('rejects release workflows that add floating action refs', () => {
    const workflow = validReleaseWorkflow.replace(
      '      - run: bun run desktop:release-ci\n',
      '      - uses: actions/cache@main\n      - run: bun run desktop:release-ci\n',
    )

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('actions/cache@main'),
      }),
    )
  })

  it('rejects release workflows without minimal GitHub token permissions', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('    permissions:\n      contents: read\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('permissions'),
      }),
    )
  })

  it('rejects release workflows that materialize UX evidence outside release CI evidence recording', () => {
    const workflow = validReleaseWorkflow.replace(
      '      - run: bun run desktop:release-ci\n',
      '      - name: Write UX validation evidence\n        run: |\n          mkdir -p desktop/release\n          printf \'%s\' "$DESKTOP_UX_VALIDATION_EVIDENCE_BASE64" | base64 --decode > desktop/release/ux-validation-evidence.md\n      - run: bun run desktop:release-ci\n',
    )

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('release-ci preflight'),
      }),
    )
  })

  it('rejects release workflows that upload artifacts before release evidence is generated', () => {
    const uploadStep = [
      '      - name: Upload release evidence',
      '        uses: actions/upload-artifact@v4',
      '        if: always()',
      '        with:',
      '          name: claude-code-desktop-macos-evidence-${{ steps.release-version.outputs.version }}',
      '          retention-days: 90',
      '          if-no-files-found: error',
      '          path: |',
      '            desktop/release/release-evidence.json',
      '            desktop/release/release-notes-evidence.md',
      '            desktop/release/ux-validation-evidence.md',
      '            desktop/release/SHA256SUMS',
      '            desktop/release/ux-screenshots/**/*.png',
      '',
    ].join('\n')
    const workflow = validReleaseWorkflow
      .replace(uploadStep, '')
      .replace('      - run: bun run desktop:release-ci\n', `${uploadStep}      - run: bun run desktop:release-ci\n`)

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('after desktop:release-ci'),
      }),
    )
  })

  it('rejects release workflows that ignore release pipeline failures', () => {
    const workflow = validReleaseWorkflow.replace(
      '      - run: bun run desktop:release-ci\n',
      '      - run: bun run desktop:release-ci\n        continue-on-error: true\n',
    )

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('continue-on-error'),
      }),
    )
  })

  it('rejects release workflows that ignore pre-release setup failures', () => {
    const workflow = validReleaseWorkflow.replace(
      '      - run: bun install --frozen-lockfile\n',
      '      - run: bun install --frozen-lockfile\n        continue-on-error: true\n',
    )

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('continue-on-error'),
      }),
    )
  })

  it('rejects release workflows that use an unpinned artifact upload action ref', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('actions/upload-artifact@v4', 'actions/upload-artifact@main'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('actions/upload-artifact@main'),
      }),
    )
  })

  it('rejects release workflows missing signing and notarization secret mappings', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('APPLE_API_KEY: ${{ secrets.DESKTOP_APPLE_API_KEY }}', 'APPLE_API_KEY: placeholder'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('APPLE_API_KEY->DESKTOP_APPLE_API_KEY'),
      }),
    )
  })

  it('rejects release workflows missing desktop tag version normalization', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('version="${version#desktop-v}"', 'version="$DESKTOP_RELEASE_VERSION"'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('normalize desktop-v tag versions'),
      }),
    )
  })

  it('rejects release workflows without delimiter-safe normalized release version outputs', () => {
    const workflow = validReleaseWorkflow.replace('            printf \'version<<%s\\n\' "$release_version_delimiter"\n', '')

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('delimiter-safe'),
      }),
    )
  })

  it('rejects release workflows that write raw release versions with single-line echo', () => {
    const workflow = validReleaseWorkflow
      .replace('          release_version_delimiter="claude_release_version_$(uuidgen)"\n', '')
      .replace('          {\n            printf \'DESKTOP_RELEASE_VERSION<<%s\\n\' "$release_version_delimiter"\n            printf \'%s\\n\' "$version"\n            printf \'%s\\n\' "$release_version_delimiter"\n          } >> "$GITHUB_ENV"\n', '          echo "DESKTOP_RELEASE_VERSION=$version" >> "$GITHUB_ENV"\n')
      .replace('          {\n            printf \'version<<%s\\n\' "$release_version_delimiter"\n            printf \'%s\\n\' "$version"\n            printf \'%s\\n\' "$release_version_delimiter"\n          } >> "$GITHUB_OUTPUT"\n', '          echo "version=$version" >> "$GITHUB_OUTPUT"\n')

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('single-line echo'),
      }),
    )
  })

  it('rejects release workflows without an artifact-safe release upload suffix', () => {
    const workflow = validReleaseWorkflow
      .replace('          if [[ "$version" =~ ^[0-9A-Za-z._-]+$ ]]; then\n', '')
      .replace('            echo "artifact-suffix=$version" >> "$GITHUB_OUTPUT"\n', '')
      .replace('          else\n', '')
      .replace('            echo "artifact-suffix=invalid-${GITHUB_RUN_ID}" >> "$GITHUB_OUTPUT"\n', '')
      .replace('          fi\n', '')

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('artifact-safe suffix'),
      }),
    )
  })

  it('rejects release workflows that normalize desktop tag versions after release generation', () => {
    const normalizeStep = [
      '      - name: Normalize tag version',
      '        id: release-version',
      '        run: |',
      '          version="$DESKTOP_RELEASE_VERSION"',
      '          if [[ "$version" == desktop-v* ]]; then',
      '            version="${version#desktop-v}"',
      '          fi',
      '          release_version_delimiter="claude_release_version_$(uuidgen)"',
      '          {',
      '            printf \'DESKTOP_RELEASE_VERSION<<%s\\n\' "$release_version_delimiter"',
      '            printf \'%s\\n\' "$version"',
      '            printf \'%s\\n\' "$release_version_delimiter"',
      '          } >> "$GITHUB_ENV"',
      '          {',
      '            printf \'version<<%s\\n\' "$release_version_delimiter"',
      '            printf \'%s\\n\' "$version"',
      '            printf \'%s\\n\' "$release_version_delimiter"',
      '          } >> "$GITHUB_OUTPUT"',
      '          if [[ "$version" =~ ^[0-9A-Za-z._-]+$ ]]; then',
      '            echo "artifact-suffix=$version" >> "$GITHUB_OUTPUT"',
      '          else',
      '            echo "artifact-suffix=invalid-${GITHUB_RUN_ID}" >> "$GITHUB_OUTPUT"',
      '          fi',
      '',
    ].join('\n')
    const workflow = validReleaseWorkflow
      .replace(normalizeStep, '')
      .replace('      - run: bun run desktop:release-ci\n', `      - run: bun run desktop:release-ci\n${normalizeStep}`)

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('normalize desktop-v tag versions'),
      }),
    )
  })

  it('rejects release workflows that use latest Bun instead of the pinned packageManager version', () => {
    const workflow = validReleaseWorkflow
      .replace('bun-version: ${{ steps.bun-version.outputs.version }}', 'bun-version: latest')

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('release job must not use bun-version: latest'),
      }),
    )
  })

  it('rejects release workflows without pinned toolchain step outputs', () => {
    const workflow = validReleaseWorkflow
      .replace('          echo "version=$bun_version" >> "$GITHUB_OUTPUT"\n', '')
      .replace('          echo "version=$node_version" >> "$GITHUB_OUTPUT"\n', '')

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('steps.bun-version.outputs.version'),
      }),
    )
    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        evidence: expect.stringContaining('steps.node-version.outputs.version'),
      }),
    )
  })

  it('rejects release workflows that pipe toolchain outputs into the runner environment', () => {
    const workflow = validReleaseWorkflow
      .replace(
        [
          '        run: |',
          '          bun_version="$(node -e "const pm=require(\'./package.json\').packageManager||\'\'; const match=/^bun@(.+)$/.exec(pm); if (!match) throw new Error(\'packageManager must be bun@<version>\'); console.log(match[1])")"',
          '          echo "BUN_VERSION=$bun_version" >> "$GITHUB_ENV"',
          '          echo "version=$bun_version" >> "$GITHUB_OUTPUT"',
        ].join('\n'),
        '        run: node -e "const pm=require(\'./package.json\').packageManager||\'\'; const match=/^bun@(.+)$/.exec(pm); if (!match) throw new Error(\'packageManager must be bun@<version>\'); console.log(\'BUN_VERSION=\' + match[1]); console.log(\'version=\' + match[1])" | tee -a "$GITHUB_ENV" >> "$GITHUB_OUTPUT"',
      )

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('pollutes the runner environment'),
      }),
    )
  })

  it('rejects release workflows that use a floating Node version', () => {
    const workflow = validReleaseWorkflow
      .replace('node-version: ${{ steps.node-version.outputs.version }}', 'node-version: "22"')

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('floating node-version'),
      }),
    )
  })

  it('rejects release workflows that install dependencies before setting up toolchains', () => {
    const workflow = validReleaseWorkflow
      .replace('      - run: bun install --frozen-lockfile\n', '')
      .replace('      - uses: oven-sh/setup-bun@v2\n', '      - run: bun install --frozen-lockfile\n      - uses: oven-sh/setup-bun@v2\n')

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('toolchain setup'),
      }),
    )
  })

  it('rejects release workflows that setup Bun before resolving its pinned version', () => {
    const resolveBunStep = '      - name: Resolve Bun version\n        id: bun-version\n        run: |\n          bun_version="$(node -e "const pm=require(\'./package.json\').packageManager||\'\'; const match=/^bun@(.+)$/.exec(pm); if (!match) throw new Error(\'packageManager must be bun@<version>\'); console.log(match[1])")"\n          echo "BUN_VERSION=$bun_version" >> "$GITHUB_ENV"\n          echo "version=$bun_version" >> "$GITHUB_OUTPUT"\n'
    const setupBunStep = '      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: ${{ steps.bun-version.outputs.version }}\n'
    const workflow = validReleaseWorkflow
      .replace(resolveBunStep, '')
      .replace(setupBunStep, `${setupBunStep}${resolveBunStep}`)

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('version resolution'),
      }),
    )
  })

  it('rejects release workflows that install without the frozen lockfile', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('bun install --frozen-lockfile', 'bun install'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('bun install --frozen-lockfile'),
      }),
    )
  })

  it('rejects release workflows missing the packaged app bundle upload', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-app-bundle.tar.gz', 'desktop/release/mac-app-placeholder'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-app-bundle.tar.gz'),
      }),
    )
  })

  it('rejects release workflows that do not archive the signed app bundle before artifact upload', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('      - name: Archive signed app bundle\n        if: success()\n        run: |\n          set -euo pipefail\n          cd desktop/release\n          app_bundle="$(find . -maxdepth 2 -type d -name \'Claude Code Desktop.app\' | LC_ALL=C sort | head -n 1)"\n          test -n "$app_bundle"\n          tar -czf "Claude Code Desktop-${{ steps.release-version.outputs.version }}-app-bundle.tar.gz" "$app_bundle"\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('archive the signed .app bundle into a tarball'),
      }),
    )
  })

  it('rejects release workflows that upload raw app bundle contents', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-app-bundle.tar.gz', 'desktop/release/mac-*/*.app/**'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('must not upload raw .app bundle contents'),
      }),
    )
  })

  it('rejects release workflows that do not always upload release evidence', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('        if: always()\n        with:', '        with:'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('if: always()'),
      }),
    )
  })

  it('rejects release workflows that silently skip missing release artifacts', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          if-no-files-found: error\n', '          if-no-files-found: ignore\n'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('if-no-files-found: error'),
      }),
    )
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          if-no-files-found: ignore\n', '          if-no-files-found: error\n'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('early preflight failures'),
      }),
    )
  })

  it('rejects release workflows without explicit artifact retention', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replaceAll('          retention-days: 90\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('retention-days'),
      }),
    )
  })

  it('rejects release workflows without an artifact-safe upload name', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          name: claude-code-desktop-macos-evidence-${{ steps.release-version.outputs.artifact-suffix }}\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('release evidence upload name'),
      }),
    )
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          name: claude-code-desktop-macos-artifacts-${{ steps.release-version.outputs.artifact-suffix }}\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('signed release artifact upload name'),
      }),
    )
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('          name: claude-code-desktop-macos-diagnostics-${{ steps.release-version.outputs.artifact-suffix }}\n', ''))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('supplemental release diagnostics upload name'),
      }),
    )
  })

  it('rejects release workflows that mix evidence and signed artifacts in one always-uploaded artifact', () => {
    const workflow = validReleaseWorkflow.replace(
      [
        '      - name: Upload release evidence',
        '        uses: actions/upload-artifact@v4',
        '        if: always()',
        '        with:',
        '          name: claude-code-desktop-macos-evidence-${{ steps.release-version.outputs.artifact-suffix }}',
        '          retention-days: 90',
        '          if-no-files-found: error',
        '          path: |',
        '            desktop/release/release-evidence.json',
        '            desktop/release/release-notes-evidence.md',
        '      - name: Upload supplemental release diagnostics',
        '        uses: actions/upload-artifact@v4',
        '        if: always()',
        '        with:',
        '          name: claude-code-desktop-macos-diagnostics-${{ steps.release-version.outputs.artifact-suffix }}',
        '          retention-days: 90',
        '          if-no-files-found: ignore',
        '          path: |',
        '            desktop/release/ux-validation-evidence.md',
        '            desktop/release/SHA256SUMS',
        '            desktop/release/ux-screenshots/**/*.png',
        '      - name: Upload signed release artifacts',
        '        uses: actions/upload-artifact@v4',
        '        if: success()',
        '        with:',
        '          name: claude-code-desktop-macos-artifacts-${{ steps.release-version.outputs.artifact-suffix }}',
        '          retention-days: 90',
        '          if-no-files-found: error',
        '          path: |',
        '            desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-app-bundle.tar.gz',
        '            desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-*.dmg',
        '            desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-*-mac.zip',
      ].join('\n'),
      [
        '      - name: Upload release artifacts',
        '        uses: actions/upload-artifact@v4',
        '        if: always()',
        '        with:',
        '          name: claude-code-desktop-macos-${{ steps.release-version.outputs.version }}',
        '          retention-days: 90',
        '          if-no-files-found: error',
        '          path: |',
        '            desktop/release/release-evidence.json',
        '            desktop/release/release-notes-evidence.md',
        '            desktop/release/ux-validation-evidence.md',
        '            desktop/release/SHA256SUMS',
        '            desktop/release/ux-screenshots/**/*.png',
        '            desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-app-bundle.tar.gz',
        '            desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-*.dmg',
        '            desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-*-mac.zip',
      ].join('\n'),
    )

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('dedicated artifact'),
      }),
    )
  })

  it('rejects release workflows that always upload signed artifacts after failed release generation', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('        if: success()\n        with:', '        if: always()\n        with:'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('unverified app bundles'),
      }),
    )
  })

  it('rejects release workflows that use job env context for versioned artifact uploads', () => {
    const workflow = validReleaseWorkflow.replaceAll(
      'steps.release-version.outputs.version',
      'env.DESKTOP_RELEASE_VERSION',
    )

    expect(checkReleaseWorkflowAutomation(workflow)).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('steps.release-version.outputs.version'),
      }),
    )
  })

  it('rejects release workflows missing the release pipeline step or artifact uploads', () => {
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('bun run desktop:release-ci', 'bun run desktop:test'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('does not contain a job step'),
      }),
    )
    expect(checkReleaseWorkflowAutomation(validReleaseWorkflow.replace('desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-*.dmg', 'desktop/release/Claude Code Desktop-*.txt'))).toEqual(
      expect.objectContaining({
        id: 'release-ci-automation',
        status: 'fail',
        evidence: expect.stringContaining('desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-*.dmg'),
      }),
    )
  })

  it('defines the production desktop release pipeline order', () => {
    const steps = releasePipelineSteps()
    expect(steps.map(step => step.id)).toEqual([
      'source-check',
      'desktop-check',
      'desktop-test',
      'smoke-electron',
      'prod-check',
      'desktop-build',
      'smoke-packaged',
      'verify-release',
      'final-verify-release',
    ])
    expect(steps[0]).toEqual({
      id: 'source-check',
      command: 'bun',
      args: ['run', 'check'],
    })
    expect(steps[1]).toEqual({
      id: 'desktop-check',
      command: 'bun',
      args: ['run', 'desktop:check'],
    })
    expect(steps.find(step => step.id === 'smoke-packaged')?.env).toEqual(
      expect.objectContaining({
        DESKTOP_SMOKE_PROGRESS: '1',
        DESKTOP_SMOKE_SCREENSHOT_DIR: expect.stringContaining('desktop/release/ux-screenshots'),
      }),
    )
    expect(steps.find(step => step.id === 'final-verify-release')?.env).toEqual({
      DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_FINAL_VERIFY_STEP: '1',
    })
  })

  it('records release environment preflight failures for release evidence', () => {
    const records = releasePreflightRecords({
      env: {
        DESKTOP_RELEASE_VERSION: '999.0.0-local',
      },
      now: () => '2026-07-16T00:00:00.000Z',
      machineOptions: {
        run: () => {
          throw new Error('should not run machine preflight when environment fails')
        },
      },
    })

    expect(records).toEqual([{
      id: 'release-env',
      command: 'node',
      args: ['desktop/scripts/release-ci.mjs', 'preflight:environment'],
      status: 'fail',
      exitCode: 1,
      startedAt: '2026-07-16T00:00:00.000Z',
      endedAt: '2026-07-16T00:00:00.000Z',
      durationMs: 0,
      failures: [
        'DESKTOP_RELEASE_VERSION must be set to a semver production version.',
        'CSC_LINK or CSC_NAME must identify a Developer ID Application signing certificate.',
        'Configure one macOS notarization credential strategy: APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD/APPLE_ID_PASSWORD + APPLE_TEAM_ID, or APPLE_KEYCHAIN_PROFILE with optional APPLE_KEYCHAIN.',
        'DESKTOP_UX_VALIDATION_EVIDENCE_BASE64 or DESKTOP_UX_VALIDATION_EVIDENCE_PATH must provide the completed UX validation evidence.',
      ],
    }])
  })

  it('records release runner preflight failures after environment preflight passes', () => {
    const completedEvidence = completedUxValidationEvidence()
    const records = releasePreflightRecords({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
        APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
        DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: Buffer.from(completedEvidence).toString('base64'),
      },
      commit: 'abc123',
      now: () => '2026-07-16T00:00:00.000Z',
      machineOptions: {
        platform: 'darwin',
        run: () => ({ status: 1, stdout: '', stderr: 'missing' }),
      },
    })

    expect(records).toEqual([
      expect.objectContaining({
        id: 'release-env',
        status: 'pass',
        exitCode: 0,
      }),
      expect.objectContaining({
        id: 'release-ux-validation',
        status: 'pass',
        exitCode: 0,
      }),
      expect.objectContaining({
        id: 'release-machine',
        args: ['desktop/scripts/release-ci.mjs', 'preflight:runner'],
        status: 'fail',
        exitCode: 1,
        failures: [
          'xcrun notarytool must be available on the release runner. Install Xcode command line tools and accept the Xcode license before running desktop:release-ci.',
          'bun must be available on the release runner before running desktop:release-ci.',
          'electron-builder must be installed in node_modules before running desktop:release-ci.',
          '@electron/asar must be installed in node_modules before running desktop:release-ci.',
          'Release source tree has tracked file changes. Commit or discard tracked changes before running desktop:release-ci.',
          'Release source tree has staged file changes. Commit or unstage tracked changes before running desktop:release-ci.',
          'CSC_LINK certificate bundle could not be opened with CSC_KEY_PASSWORD on the release runner.',
        ],
      }),
    ])
  })

  it('selects only the requested release preflight phase records', () => {
    const completedEvidence = completedUxValidationEvidence()
    const options = {
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
        APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
        DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: Buffer.from(completedEvidence).toString('base64'),
      },
      commit: 'abc123',
      now: () => '2026-07-16T00:00:00.000Z',
      machineOptions: {
        platform: 'darwin',
        run: () => ({ status: 1, stdout: '', stderr: 'missing' }),
      },
      uxValidationOptions: {
        outputPath: '/release/ux-validation-evidence.md',
        mkdir: () => {},
        writeFile: () => {},
        readFile: () => completedEvidence,
      },
    }

    expect(releasePreflightRecordsForPhase('environment', options).map(record => record.id)).toEqual([
      'release-env',
    ])
    expect(releasePreflightRecordsForPhase('ux-validation', options).map(record => record.id)).toEqual([
      'release-env',
      'release-ux-validation',
    ])
    expect(releasePreflightRecordsForPhase('runner', options).map(record => record.id)).toEqual([
      'release-env',
      'release-ux-validation',
      'release-machine',
    ])
    expect(releasePreflightRecordsForPhase('all', options).map(record => record.id)).toEqual([
      'release-env',
      'release-ux-validation',
      'release-machine',
    ])
  })

  it('materializes UX validation evidence before runner preflight failures are returned', () => {
    const writes: string[] = []
    const completedEvidence = completedUxValidationEvidence()
    const records = releasePreflightRecords({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
        APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
        DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: Buffer.from(completedEvidence).toString('base64'),
      },
      commit: 'abc123',
      now: () => '2026-07-16T00:00:00.000Z',
      machineOptions: {
        platform: 'darwin',
        run: () => ({ status: 1, stdout: '', stderr: 'missing' }),
      },
      uxValidationOptions: {
        outputPath: '/release/ux-validation-evidence.md',
        mkdir: () => {},
        writeFile: (_path, contents) => writes.push(String(contents)),
        readFile: () => writes[0],
      },
    })

    expect(records).toEqual([
      expect.objectContaining({ id: 'release-env', status: 'pass' }),
      expect.objectContaining({ id: 'release-ux-validation', status: 'pass' }),
      expect.objectContaining({ id: 'release-machine', status: 'fail' }),
    ])
    expect(writes).toEqual([completedEvidence])
  })

  it('materializes UX validation evidence from a release environment path', () => {
    const writes: string[] = []
    const completedEvidence = completedUxValidationEvidence()
    const records = releasePreflightRecords({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
        APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
        DESKTOP_UX_VALIDATION_EVIDENCE_PATH: '/release/completed-ux-validation-evidence.md',
      },
      commit: 'abc123',
      now: () => '2026-07-16T00:00:00.000Z',
      machineOptions: {
        platform: 'darwin',
        run: () => ({ status: 1, stdout: '', stderr: 'missing' }),
      },
      uxValidationOptions: {
        outputPath: '/release/ux-validation-evidence.md',
        mkdir: () => {},
        writeFile: (_path, contents) => writes.push(String(contents)),
        readFile: path => path === '/release/completed-ux-validation-evidence.md'
          ? completedEvidence
          : writes[0],
      },
    })

    expect(records).toEqual([
      expect.objectContaining({ id: 'release-env', status: 'pass' }),
      expect.objectContaining({ id: 'release-ux-validation', status: 'pass' }),
      expect.objectContaining({ id: 'release-machine', status: 'fail' }),
    ])
    expect(writes).toEqual([completedEvidence])
  })

  it('records UX validation preflight failures before release build steps', () => {
    const placeholderEvidence = completedUxValidationEvidence({
      representativeUser: '[name or role, YYYY-MM-DD]',
    })
    const records = releasePreflightRecords({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
        APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
        DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: Buffer.from(placeholderEvidence).toString('base64'),
      },
      commit: 'abc123',
      now: () => '2026-07-16T00:00:00.000Z',
      machineOptions: {
        platform: 'darwin',
        run: command => ({
          status: command === 'git' || command === 'xcrun' || command === 'bun' || command === 'npx' || command === 'openssl' ? 0 : 1,
          stdout: command === 'xcrun' ? '/usr/bin/notarytool' : '',
          stderr: '',
        }),
      },
      uxValidationOptions: {
        mkdir: () => {},
        writeFile: () => {},
        readFile: () => placeholderEvidence,
      },
    })

    expect(records).toEqual([
      expect.objectContaining({
        id: 'release-env',
        status: 'pass',
      }),
      expect.objectContaining({
        id: 'release-ux-validation',
        status: 'fail',
        failures: [
          'UX validation evidence still contains template placeholders.',
          'UX validation evidence must name a representative user with YYYY-MM-DD validation date.',
        ],
      }),
    ])
  })

  it('rejects UX validation evidence for a different release candidate during preflight', () => {
    const staleEvidence = completedUxValidationEvidence({
      version: '1.2.2',
      commit: 'oldcommit',
    })
    const records = releasePreflightRecords({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
        APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
        DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: Buffer.from(staleEvidence).toString('base64'),
      },
      commit: 'abc123',
      now: () => '2026-07-16T00:00:00.000Z',
      machineOptions: {
        platform: 'darwin',
        run: () => {
          throw new Error('runner preflight should not run after UX validation fails')
        },
      },
      uxValidationOptions: {
        mkdir: () => {},
        writeFile: () => {},
        readFile: () => staleEvidence,
      },
    })

    expect(records).toEqual([
      expect.objectContaining({ id: 'release-env', status: 'pass' }),
      expect.objectContaining({
        id: 'release-ux-validation',
        status: 'fail',
        failures: [
          'UX validation evidence Version=1.2.2 does not match releaseVersion=1.2.3.',
          'UX validation evidence Commit=oldcommit does not match release commit=abc123.',
        ],
      }),
    ])
  })

  it('uses specific release preflight failure headings for user-facing diagnostics', () => {
    expect(releasePreflightFailureHeading({ id: 'release-env' })).toBe('Desktop release environment is incomplete:')
    expect(releasePreflightFailureHeading({ id: 'release-ux-validation' })).toBe('Desktop UX validation evidence is incomplete:')
    expect(releasePreflightFailureHeading({ id: 'release-machine' })).toBe('Desktop release runner is not ready:')
  })

  it('materializes UX validation evidence from release environment before validation', () => {
    const writes: string[] = []
    const completedEvidence = completedUxValidationEvidence()
    const records = releasePreflightRecords({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
        APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
        DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: Buffer.from(completedEvidence).toString('base64'),
      },
      commit: 'abc123',
      now: () => '2026-07-16T00:00:00.000Z',
      machineOptions: {
        platform: 'darwin',
        run: command => ({
          status: command === 'git' || command === 'xcrun' || command === 'bun' || command === 'npx' || command === 'openssl' ? 0 : 1,
          stdout: command === 'xcrun' ? '/usr/bin/notarytool' : '',
          stderr: '',
        }),
      },
      uxValidationOptions: {
        outputPath: '/release/ux-validation-evidence.md',
        mkdir: () => {},
        writeFile: (_path, contents) => writes.push(String(contents)),
        readFile: () => writes[0],
      },
    })

    expect(records).toEqual([
      expect.objectContaining({ id: 'release-env', status: 'pass' }),
      expect.objectContaining({ id: 'release-ux-validation', status: 'pass' }),
      expect.objectContaining({ id: 'release-machine', status: 'pass' }),
    ])
    expect(writes).toEqual([completedEvidence])
  })

  it('records invalid UX validation evidence base64 as a release environment preflight failure', () => {
    const records = releasePreflightRecords({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
        APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
        DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: 'not base64!',
      },
      now: () => '2026-07-16T00:00:00.000Z',
      machineOptions: {
        platform: 'darwin',
        run: command => ({
          status: command === 'git' || command === 'xcrun' || command === 'bun' || command === 'npx' ? 0 : 1,
          stdout: command === 'xcrun' ? '/usr/bin/notarytool' : '',
          stderr: '',
        }),
      },
      uxValidationOptions: {
        outputPath: '/release/ux-validation-evidence.md',
        mkdir: () => {},
        writeFile: () => {},
      },
    })

    expect(records).toContainEqual(expect.objectContaining({
      id: 'release-env',
      status: 'fail',
      failures: [
        'DESKTOP_UX_VALIDATION_EVIDENCE_BASE64 must be valid base64-encoded UTF-8 markdown.',
      ],
    }))
  })

  it('records non-UTF-8 UX validation evidence bytes as a release environment preflight failure', () => {
    const records = releasePreflightRecords({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        CSC_LINK: inlineCertificateBundle,
        CSC_KEY_PASSWORD: 'certificate-password',
        APPLE_KEYCHAIN_PROFILE: 'desktop-notary-profile',
        DESKTOP_UX_VALIDATION_EVIDENCE_BASE64: Buffer.from([0xff, 0xfe, 0xfd]).toString('base64'),
      },
      now: () => '2026-07-16T00:00:00.000Z',
      machineOptions: {
        platform: 'darwin',
        run: command => ({
          status: command === 'git' || command === 'xcrun' || command === 'bun' || command === 'npx' ? 0 : 1,
          stdout: command === 'xcrun' ? '/usr/bin/notarytool' : '',
          stderr: '',
        }),
      },
      uxValidationOptions: {
        outputPath: '/release/ux-validation-evidence.md',
        mkdir: () => {},
        writeFile: () => {},
      },
    })

    expect(records).toContainEqual(expect.objectContaining({
      id: 'release-env',
      status: 'fail',
      failures: [
        'DESKTOP_UX_VALIDATION_EVIDENCE_BASE64 must be valid base64-encoded UTF-8 markdown.',
      ],
    }))
  })

  it('builds redacted release evidence for CI artifacts', () => {
    const evidence = buildReleaseEvidence({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
        APPLE_ID: 'release@example.invalid',
        APPLE_APP_SPECIFIC_PASSWORD: 'secret-password',
        APPLE_TEAM_ID: 'ABCDE12345',
        CSC_LINK: 'secret-certificate',
        CSC_KEY_PASSWORD: 'certificate-password',
        GITHUB_REPOSITORY: 'anthropics/claude-code',
        GITHUB_REF_NAME: 'desktop-v1.2.3',
        GITHUB_REF_TYPE: 'tag',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_RUN_ID: '123456789',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_SERVER_URL: 'https://github.com',
      },
      generatedAt: '2026-07-16T00:00:00.000Z',
      platform: 'darwin',
      arch: 'arm64',
      commit: 'abc123',
      artifacts: {
        appPath: '/release/mac-arm64/Claude Code Desktop.app',
        dmgPath: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      },
      artifactDigests: {
        appPath: {
          path: '/release/mac-arm64/Claude Code Desktop.app',
          exists: true,
          type: 'directory',
        },
        dmgPath: {
          path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
          exists: true,
          type: 'file',
          sizeBytes: 4,
          sha256: '3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7',
        },
      },
      checksumManifestPath: '/release/SHA256SUMS',
      artifactVerificationChecks: [{
        id: 'mac-zip-app-bundle',
        status: 'pass',
        message: 'Packaged macOS ZIP contains the app bundle.',
        evidence: 'Claude Code Desktop.app/Contents/Info.plist',
      }, {
        id: 'mac-dmg-notarization',
        status: 'fail',
        message: 'macOS DMG has a stapled notarization ticket.',
        evidence: 'xcrun stapler validate demo.dmg\nnot stapled',
        nextAction: 'Run the production build on a macOS release machine with Developer ID signing and notarization enabled.',
      }],
      toolchain: {
        packageManager: 'bun@1.3.14',
        node: '22.18.0',
        lockfile: {
          path: '/release/bun.lock',
          exists: true,
          type: 'file',
          sizeBytes: 9,
          sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
        },
      },
      releaseTooling: releaseToolingMetadata(),
      uxValidationEvidence: {
        path: '/release/ux-validation-evidence.md',
        exists: true,
        type: 'file',
        sizeBytes: 304,
        sha256: '13406130e26be28c364d5c5df8f0dc556239b26105a40aa30997796c70c10294',
      },
      uxScreenshotsDir: '/release/ux-screenshots',
      steps: [{
        id: 'desktop-test',
        command: 'bun',
        args: ['run', 'desktop:test'],
        status: 'pass',
        exitCode: 0,
        startedAt: '2026-07-16T00:00:00.000Z',
        endedAt: '2026-07-16T00:00:01.000Z',
        durationMs: 1000,
        failures: ['simulated failure for release evidence'],
      }],
    })

    expect(evidence).toEqual({
      schemaVersion: 1,
      product: 'Claude Code Desktop',
      releaseVersion: '1.2.3',
      commit: 'abc123',
      generatedAt: '2026-07-16T00:00:00.000Z',
      platform: 'darwin',
      arch: 'arm64',
      source: {
        repository: 'anthropics/claude-code',
        refName: 'desktop-v1.2.3',
        refType: 'tag',
        eventName: 'push',
        commit: 'abc123',
        ciRunId: '123456789',
        ciRunAttempt: '2',
        ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123456789/attempts/2',
      },
      releaseCredentials: {
        signing: {
          strategy: 'csc-link',
          source: 'inline',
        },
        notarization: {
          strategy: 'apple-id',
          source: 'account',
        },
      },
      toolchain: {
        packageManager: 'bun@1.3.14',
        node: '22.18.0',
        lockfile: {
          path: '/release/bun.lock',
          exists: true,
          type: 'file',
          sizeBytes: 9,
          sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
        },
      },
      releaseTooling: releaseToolingMetadata(),
      artifacts: {
        appPath: '/release/mac-arm64/Claude Code Desktop.app',
        dmgPath: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      },
      artifactDigests: {
        appPath: {
          path: '/release/mac-arm64/Claude Code Desktop.app',
          exists: true,
          type: 'directory',
        },
        dmgPath: {
          path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
          exists: true,
          type: 'file',
          sizeBytes: 4,
          sha256: '3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7',
        },
      },
      checksumManifest: {
        path: '/release/SHA256SUMS',
        type: 'file',
        sizeBytes: 102,
        sha256: 'd071e89c129f2f6d1dc5c52efc33014199af24b4dedf261a82ff8e58cba1daf6',
      },
      uxValidationEvidence: {
        path: '/release/ux-validation-evidence.md',
        exists: true,
        type: 'file',
        sizeBytes: 304,
        sha256: '13406130e26be28c364d5c5df8f0dc556239b26105a40aa30997796c70c10294',
      },
      uxValidationSummary: {
        validator: 'Release QA, 2026-07-16',
        representativeUser: 'Desktop engineer, 2026-07-16',
        representativeUserValidation: 'observed, Release PM, 2026-07-16',
        representativeUserValidationStatus: 'observed',
        representativeUserValidationFacilitator: 'Release PM',
        representativeUserValidationDate: '2026-07-16',
        knownLimitationsAccepted: 'yes, Release QA',
        knownLimitationsApprover: 'Release QA',
        uxApprovalStatus: 'approved',
        uxApprovalApprover: 'Release QA',
        uxApprovalDate: '2026-07-16',
      },
      artifactVerificationChecks: [{
        id: 'mac-zip-app-bundle',
        status: 'pass',
        message: 'Packaged macOS ZIP contains the app bundle.',
        evidence: 'Claude Code Desktop.app/Contents/Info.plist',
      }, {
        id: 'mac-dmg-notarization',
        status: 'fail',
        message: 'macOS DMG has a stapled notarization ticket.',
        evidence: 'xcrun stapler validate demo.dmg\nnot stapled',
        nextAction: 'Run the production build on a macOS release machine with Developer ID signing and notarization enabled.',
      }],
      uxScreenshotsDir: '/release/ux-screenshots',
      steps: [{
        id: 'desktop-test',
        command: 'bun',
        args: ['run', 'desktop:test'],
        status: 'pass',
        exitCode: 0,
        startedAt: '2026-07-16T00:00:00.000Z',
        endedAt: '2026-07-16T00:00:01.000Z',
        durationMs: 1000,
      }],
    })
    expect(JSON.stringify(evidence)).not.toContain('secret')
    expect(JSON.stringify(evidence)).not.toContain('simulated failure for release evidence')
  })

  it('builds release evidence without stale release evidence or checksum manifest self-checks', () => {
    const files = new Set([
      '/release/mac-arm64/Claude Code Desktop.app',
      '/release/Claude Code Desktop-1.2.3-arm64.dmg',
      '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      '/release/SHA256SUMS',
    ])
    const evidence = buildReleaseEvidence({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
      },
      generatedAt: '2026-07-16T00:00:00.000Z',
      platform: 'darwin',
      arch: 'arm64',
      commit: 'abc123',
      artifacts: {
        appPath: '/release/mac-arm64/Claude Code Desktop.app',
        dmgPath: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
        zipPath: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
      },
      artifactDigests: {
        appPath: {
          path: '/release/mac-arm64/Claude Code Desktop.app',
          exists: true,
          type: 'directory',
        },
        dmgPath: {
          path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
          exists: true,
          type: 'file',
          sizeBytes: 13,
          sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
        },
        zipPath: {
          path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
          exists: true,
          type: 'file',
          sizeBytes: 13,
          sha256: '682709f36991fd3910d7343e6264dd5510bf02005fa6503a4878ff17530751d8',
        },
      },
      verifyOptions: {
        releaseDir: '/release',
        exists: path => files.has(path) || path === '/release',
        readDir: () => [
          'Claude Code Desktop-1.2.3-arm64.dmg',
          'Claude Code Desktop-1.2.3-arm64-mac.zip',
        ],
        readFile: path => {
          if (path === '/release/SHA256SUMS') {
            return Buffer.from('0000000000000000000000000000000000000000000000000000000000000000  Claude Code Desktop-1.2.3-arm64.dmg\n0000000000000000000000000000000000000000000000000000000000000000  Claude Code Desktop-1.2.3-arm64-mac.zip\n')
          }
          return Buffer.from('artifact-data')
        },
        run: () => ({ status: 0, stdout: '', stderr: '' }),
      },
    })

    const ids = evidence.artifactVerificationChecks.map(check => check.id)
    expect(ids).toContain('mac-app-artifact')
    expect(ids).toContain('mac-checksum-manifest')
    expect(ids).toContain('mac-dmg-checksum')
    expect(ids).toContain('mac-zip-checksum')
    expect(evidence.artifactVerificationChecks).toContainEqual(expect.objectContaining({
      id: 'mac-dmg-checksum',
      status: 'pass',
    }))
    expect(evidence.artifactVerificationChecks).toContainEqual(expect.objectContaining({
      id: 'mac-zip-checksum',
      status: 'pass',
    }))
    expect(ids).not.toContain('mac-release-evidence')
    expect(ids).not.toContain('mac-release-evidence-version')
    expect(ids).not.toContain('mac-release-evidence-checksum-manifest')
  })

  it('builds release evidence with UX screenshot digests', () => {
    const evidence = buildReleaseEvidence({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
      },
      generatedAt: '2026-07-16T00:00:00.000Z',
      platform: 'darwin',
      arch: 'arm64',
      commit: 'abc123',
      uxScreenshotsDir: '/release/ux-screenshots',
      uxScreenshotOptions: {
        exists: path => path === '/release/ux-screenshots',
        readDir: () => ['main.png', 'notes.txt', 'settings.png'],
        stat: path => ({
          isFile: () => path.endsWith('.png'),
          isDirectory: () => false,
          size: path.endsWith('main.png') ? 15 : 13,
        }),
        readFile: path => Buffer.from(path.endsWith('main.png') ? 'screenshot-data' : 'settings-data'),
      },
      artifactVerificationChecks: [],
    })

    expect(evidence.uxScreenshots).toEqual([{
      path: '/release/ux-screenshots/main.png',
      exists: true,
      type: 'file',
      sizeBytes: 15,
      sha256: 'c9f0775628cb480152b054cc99f190339670bc397cd5be16c63978312b9dd4f4',
    }, {
      path: '/release/ux-screenshots/settings.png',
      exists: true,
      type: 'file',
      sizeBytes: 13,
      sha256: '3257b8362012fd9c4c90ea39d5ab152aae314adc2aab922d5886cfe3ec12509c',
    }])
  })

  it('builds release evidence with auditable UX validation metadata', () => {
    const evidence = buildReleaseEvidence({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
      },
      generatedAt: '2026-07-16T00:00:00.000Z',
      platform: 'darwin',
      arch: 'arm64',
      commit: 'abc123',
      artifactVerificationChecks: [],
      uxValidationEvidencePath: '/release/ux-validation-evidence.md',
      uxValidationEvidenceOptions: {
        stat: () => ({
          isFile: () => true,
          isDirectory: () => false,
          size: Buffer.byteLength(completedUxValidationEvidence()),
        }),
        readFile: () => Buffer.from(completedUxValidationEvidence()),
      },
    })

    expect(evidence.uxValidationSummary).toEqual({
      validator: 'Release QA, 2026-07-16',
      representativeUser: 'Desktop engineer, 2026-07-16',
      representativeUserValidation: 'observed, Release PM, 2026-07-16',
      representativeUserValidationStatus: 'observed',
      representativeUserValidationFacilitator: 'Release PM',
      representativeUserValidationDate: '2026-07-16',
      knownLimitationsAccepted: 'yes, Release QA',
      knownLimitationsApprover: 'Release QA',
      uxApprovalStatus: 'approved',
      uxApprovalApprover: 'Release QA',
      uxApprovalDate: '2026-07-16',
    })
  })

  it('builds release notes evidence from release evidence metadata', () => {
    const notes = buildReleaseNotesEvidence({
      releaseVersion: '1.2.3',
      commit: 'abc123',
      generatedAt: '2026-07-16T00:00:00.000Z',
      source: {
        repository: 'anthropics/claude-code',
        refName: 'desktop-v1.2.3',
        refType: 'tag',
        eventName: 'push',
        commit: 'abc123',
        ciRunUrl: 'https://github.com/anthropics/claude-code/actions/runs/123',
      },
      releaseCredentials: {
        signing: {
          strategy: 'csc-link',
          source: 'inline',
        },
        notarization: {
          strategy: 'api-key',
          source: 'path',
        },
      },
      artifactDigests: {
        dmgPath: {
          path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
          type: 'file',
          sizeBytes: 8,
          sha256: 'c99d7be6e81807da89b9b67a6e78ce9dd6f23766a939b60054efce19e2b6d23e',
        },
      },
      artifactVerificationChecks: [{
        id: 'mac-app-codesign',
        status: 'pass',
        message: 'macOS app has a valid Developer ID Application code signature.',
        evidence: 'TeamIdentifier=ABCDE12345',
      }, {
        id: 'mac-dmg-notarization',
        status: 'fail',
        message: 'macOS DMG has a stapled notarization ticket.',
        evidence: 'not stapled',
      }],
      checksumManifest: {
        path: '/release/SHA256SUMS',
        type: 'file',
        sizeBytes: 104,
        sha256: 'manifest-sha',
      },
      toolchain: {
        packageManager: 'bun@1.3.14',
        node: '22.18.0',
        lockfile: {
          path: '/release/bun.lock',
          type: 'file',
          sizeBytes: 9,
          sha256: '0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac',
        },
      },
      releaseTooling: releaseToolingMetadata(),
      uxValidationEvidence: {
        path: '/release/ux-validation-evidence.md',
        type: 'file',
        sizeBytes: 304,
        sha256: '13406130e26be28c364d5c5df8f0dc556239b26105a40aa30997796c70c10294',
      },
      uxValidationSummary: {
        validator: 'Release QA, 2026-07-16',
        representativeUser: 'Desktop engineer, 2026-07-16',
        representativeUserValidation: 'observed, Release PM, 2026-07-16',
        knownLimitationsAccepted: 'yes, Release QA',
        uxApprovalStatus: 'approved',
        uxApprovalApprover: 'Release QA',
        uxApprovalDate: '2026-07-16',
      },
      uxScreenshots: requiredUxScreenshotMetadata(),
      steps: [{
        id: 'desktop-test',
        status: 'pass',
        durationMs: 1000,
      }],
    })

    expect(notes).toContain('# Claude Code Desktop Release Evidence Summary')
    expect(notes).toContain('- Version: `1.2.3`')
    expect(notes).toContain('- Commit: `abc123`')
    expect(notes).toContain('- Ref type: `tag`')
    expect(notes).toContain('- Event: `push`')
    expect(notes).toContain('release-evidence.json')
    expect(notes).toContain('SHA256SUMS')
    expect(notes).toContain('Signing: `csc-link` via `inline`')
    expect(notes).toContain('Notarization: `api-key` via `path`')
    expect(notes).toContain('Toolchain: `bun@1.3.14`, `node@22.18.0`')
    expect(notes).toContain('Lockfile: `bun.lock` `0538d007cc4ec6984b70463bad27b2d734aeac02dc010d6be4f0b153fac566ac`')
    expect(notes).toContain('Release tooling: `3` files')
    expect(notes).toContain('## Release Tooling')
    expect(notes).toContain(`desktop/scripts/release-ci.mjs\`: \`${releaseToolingMetadata().releaseCi.sha256}`)
    expect(notes).toContain(`desktop/scripts/verify-release-artifacts.mjs\`: \`${releaseToolingMetadata().releaseVerifier.sha256}`)
    expect(notes).toContain(`.github/workflows/desktop-release.yml\`: \`${releaseToolingMetadata().releaseWorkflow.sha256}`)
    expect(notes).toContain('UX validation: `ux-validation-evidence.md` `13406130e26be28c364d5c5df8f0dc556239b26105a40aa30997796c70c10294`')
    expect(notes).toContain('## UX Validation')
    expect(notes).toContain('Validator: `Release QA, 2026-07-16`')
    expect(notes).toContain('Representative user: `Desktop engineer, 2026-07-16`')
    expect(notes).toContain('Representative user validation: `observed, Release PM, 2026-07-16`')
    expect(notes).toContain('Known limitations accepted: `yes, Release QA`')
    expect(notes).toContain('UX approval: `approved` by `Release QA` on `2026-07-16`')
    expect(notes).toContain('Claude Code Desktop-1.2.3-arm64.dmg')
    expect(notes).toContain('## Artifact Verification')
    expect(notes).toContain('- `mac-app-codesign`: pass - macOS app has a valid Developer ID Application code signature.')
    expect(notes).toContain('  - Evidence: `TeamIdentifier=ABCDE12345`')
    expect(notes).toContain('- `mac-dmg-notarization`: fail - macOS DMG has a stapled notarization ticket.')
    expect(notes).toContain('  - Evidence: `not stapled`')
    for (const name of requiredSmokeScreenshots) {
      expect(notes).toContain(`ux-screenshots/${name}`)
    }
    expect(notes).not.toContain('secret')
  })

  it('fails release artifact verification when release notes omit required signing evidence details', () => {
    const artifactVerificationChecks = requiredReleaseEvidenceArtifactCheckIds.map(id => ({
      id,
      status: 'pass',
      message: `${id} passed`,
      evidence: requiredReleaseNotesEvidenceDetailCheckIds.includes(id)
        ? `${id} command evidence`
        : `${id} evidence`,
    }))
    const notesWithoutDetails = [
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Generated at: `2026-07-16T00:00:00.000Z`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `0`',
      '',
      '## Artifact Verification',
      '',
      ...artifactVerificationChecks.map(check => `- \`${check.id}\`: ${check.status} - ${check.message}`),
      '',
    ].join('\n')
    const releaseEvidence = {
      releaseVersion: '1.2.3',
      commit: 'abc123',
      generatedAt: '2026-07-16T00:00:00.000Z',
      releaseNotesEvidence: {
        path: '/release/release-notes-evidence.md',
        type: 'file',
        sizeBytes: Buffer.byteLength(notesWithoutDetails),
        sha256: createHash('sha256').update(notesWithoutDetails).digest('hex'),
      },
      artifactVerificationChecks,
    }

    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => [
        '/release',
        '/release/release-evidence.json',
        '/release/release-notes-evidence.md',
      ].includes(path),
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify(releaseEvidence))
        }
        if (path === '/release/release-notes-evidence.md') {
          return Buffer.from(notesWithoutDetails)
        }
        return Buffer.from('')
      },
      run: () => ({ status: 1, stdout: '', stderr: 'not available' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('mac-app-codesign'),
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('Evidence: `mac-app-codesign command evidence`'),
    }))
  })

  it('fails release artifact verification when release notes omit pipeline step summaries', () => {
    const releaseNotesEvidenceContents = Buffer.from([
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Generated at: `2026-07-16T00:00:00.000Z`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `SHA256SUMS`',
      '- UX screenshots: `0`',
      '',
      '## Artifact Verification',
      '',
      '- `<none>`',
      '',
      '## Pipeline Steps',
      '',
      '- `<none>`',
      '',
    ].join('\n'))
    const releaseEvidence = {
      releaseVersion: '1.2.3',
      commit: 'abc123',
      generatedAt: '2026-07-16T00:00:00.000Z',
      releaseNotesEvidence: {
        path: '/release/release-notes-evidence.md',
        type: 'file',
        sizeBytes: releaseNotesEvidenceContents.byteLength,
        sha256: createHash('sha256').update(releaseNotesEvidenceContents).digest('hex'),
      },
      artifactVerificationChecks: [],
      steps: [{
        id: 'desktop-test',
        status: 'pass',
        durationMs: 1000,
      }, {
        id: 'verify-release',
        status: 'pass',
        durationMs: 2000,
      }],
    }

    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => [
        '/release',
        '/release/release-evidence.json',
        '/release/release-notes-evidence.md',
      ].includes(path),
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify(releaseEvidence))
        }
        if (path === '/release/release-notes-evidence.md') {
          return releaseNotesEvidenceContents
        }
        return Buffer.from('')
      },
      run: () => ({ status: 1, stdout: '', stderr: 'not available' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('- `desktop-test`: pass (1000 ms)'),
    }))
    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('- `verify-release`: pass (2000 ms)'),
    }))
  })

  it('fails release artifact verification when release notes omit required UX screenshot summaries', () => {
    const screenshots = requiredUxScreenshotMetadata()
    const notesWithoutPreviewScreenshot = [
      '# Claude Code Desktop Release Evidence Summary',
      '',
      '- Version: `1.2.3`',
      '- Commit: `abc123`',
      '- Generated at: `2026-07-16T00:00:00.000Z`',
      '- Release evidence: `release-evidence.json`',
      '- Checksum manifest: `<none>`',
      `- UX screenshots: \`${screenshots.length}\``,
      '',
      '## Artifact Verification',
      '',
      '- `<none>`',
      '',
      '## UX Screenshots',
      '',
      ...screenshots
        .filter(screenshot => !String(screenshot.path).endsWith('/preview.png'))
        .map(screenshot => `- \`${screenshot.path}\`: \`${screenshot.sha256}\` (${screenshot.sizeBytes} bytes)`),
      '',
    ].join('\n')
    const releaseEvidence = {
      releaseVersion: '1.2.3',
      commit: 'abc123',
      generatedAt: '2026-07-16T00:00:00.000Z',
      releaseNotesEvidence: {
        path: '/release/release-notes-evidence.md',
        type: 'file',
        sizeBytes: Buffer.byteLength(notesWithoutPreviewScreenshot),
        sha256: createHash('sha256').update(notesWithoutPreviewScreenshot).digest('hex'),
      },
      artifactVerificationChecks: [],
      uxScreenshots: screenshots,
    }

    const checks = verifyMacReleaseArtifacts({
      platform: 'darwin',
      releaseDir: '/release',
      arch: 'arm64',
      version: '1.2.3',
      exists: path => [
        '/release',
        '/release/release-evidence.json',
        '/release/release-notes-evidence.md',
      ].includes(path),
      readDir: () => [],
      readFile: path => {
        if (path === '/release/release-evidence.json') {
          return Buffer.from(JSON.stringify(releaseEvidence))
        }
        if (path === '/release/release-notes-evidence.md') {
          return Buffer.from(notesWithoutPreviewScreenshot)
        }
        return Buffer.from('')
      },
      run: () => ({ status: 1, stdout: '', stderr: 'not available' }),
    })

    expect(checks).toContainEqual(expect.objectContaining({
      id: 'mac-release-notes-evidence',
      status: 'fail',
      evidence: expect.stringContaining('ux-screenshots/preview.png'),
    }))
  })

  it('builds release evidence with release notes evidence digest', () => {
    const evidence = buildReleaseEvidence({
      env: {
        DESKTOP_RELEASE_VERSION: '1.2.3',
      },
      generatedAt: '2026-07-16T00:00:00.000Z',
      platform: 'darwin',
      arch: 'arm64',
      commit: 'abc123',
      artifacts: {},
      artifactDigests: {},
      artifactVerificationChecks: [],
      evidencePurpose: 'preflight-only',
      uxScreenshotsDir: '/release/ux-screenshots',
      releaseNotesEvidencePath: '/release/release-notes-evidence.md',
    })
    const notes = buildReleaseNotesEvidence(evidence)

    expect(evidence.releaseNotesEvidence).toEqual({
      path: '/release/release-notes-evidence.md',
      type: 'file',
      sizeBytes: Buffer.byteLength(notes),
      sha256: createHash('sha256').update(notes).digest('hex'),
    })
    expect(evidence.evidencePurpose).toBe('preflight-only')
    expect(notes).toContain('- Evidence purpose: `preflight-only`')
    expect(notes).toContain('- Checksum manifest: `<none>`')
    expect(notes).not.toContain('- Checksum manifest: `SHA256SUMS`')
    expect(JSON.stringify(evidence)).not.toContain('secret')
  })

  it('builds a stable SHA256SUMS manifest for release file artifacts', () => {
    expect(buildReleaseChecksumManifest({
      appPath: {
        path: '/release/mac-arm64/Claude Code Desktop.app',
        exists: true,
        type: 'directory',
      },
      zipPath: {
        path: '/release/Claude Code Desktop-1.2.3-arm64-mac.zip',
        exists: true,
        type: 'file',
        sizeBytes: 12,
        sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      dmgPath: {
        path: '/release/Claude Code Desktop-1.2.3-arm64.dmg',
        exists: true,
        type: 'file',
        sizeBytes: 10,
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      missingPath: {
        path: '/release/missing.zip',
        exists: false,
        type: 'missing',
      },
    })).toBe([
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  Claude Code Desktop-1.2.3-arm64.dmg',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  Claude Code Desktop-1.2.3-arm64-mac.zip',
      '',
    ].join('\n'))
  })

  it('describes release artifact checksums without hashing directories', () => {
    expect(describeReleaseArtifact('/release/demo.dmg', {
      stat: () => ({
        isFile: () => true,
        isDirectory: () => false,
        size: 4,
      }),
      readFile: () => Buffer.from('data'),
    })).toEqual({
      path: '/release/demo.dmg',
      exists: true,
      type: 'file',
      sizeBytes: 4,
      sha256: '3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7',
    })

    expect(describeReleaseArtifact('/release/Demo.app', {
      stat: () => ({
        isFile: () => false,
        isDirectory: () => true,
      }),
      readFile: () => {
        throw new Error('should not read directories')
      },
    })).toEqual({
      path: '/release/Demo.app',
      exists: true,
      type: 'directory',
    })
  })

  it('builds a UX validation evidence template with release metadata', () => {
    const template = buildUxValidationEvidenceTemplate({
      version: '1.2.3',
      commit: 'abc123',
      releaseEvidencePath: 'desktop/release/release-evidence.json',
      screenshotArtifactPath: 'desktop/release/ux-screenshots',
    })

    expect(template).toContain('- Version: `1.2.3`')
    expect(template).toContain('- Commit: `abc123`')
    expect(template).toContain('- Artifact evidence: `desktop/release/release-evidence.json`')
    expect(template).toContain('- Screenshot artifact: `desktop/release/ux-screenshots`')
    expect(template).toContain('- Validator: `[name, role, YYYY-MM-DD]`')
    expect(template).toContain('- Representative user: `[name or role, YYYY-MM-DD]`')
    expect(template).toContain('- Representative user validation: `[observed, facilitator, YYYY-MM-DD]`')
    expect(template).toContain('Every screenshot row must be `pass` or `n/a` before release approval.')
    expect(template).toContain('| MCP management | `settings-mcp.png` | `[pass/fail/n/a]` | `[notes]` |')
    expect(template).toContain('| Skills management | `settings-skills.png` | `[pass/fail/n/a]` | `[notes]` |')
    expect(template).toContain('| Command Palette | `command-palette.png` | `[pass/fail/n/a]` | `[notes]` |')
    expect(template).toContain('| Scheduled tasks management | `tasks.png` | `[pass/fail/n/a]` | `[notes]` |')
    expect(template).toContain('| Composer actions menu | `composer-actions.png` | `[pass/fail/n/a]` | `[notes]` |')
    expect(template).toContain('| Permission review modal | `permission-modal.png` | `[pass/fail/n/a]` | `[notes]` |')
    expect(template).toContain('| Files browser | `files.png` | `[pass/fail/n/a]` | `[notes]` |')
    expect(template).toContain('| Editor | `editor.png` | `[pass/fail/n/a]` | `[notes]` |')
    expect(template).toContain('| Diff viewer | `diff.png` | `[pass/fail/n/a]` | `[notes]` |')
    expect(template).toContain('Every required manual task row below must be present and `pass` before release approval.')
    expect(template).toContain('Use Command Palette and native View menu navigation.')
    expect(template).toContain('Use native Help menu support actions.')
    expect(template).toContain('Help menu Command Palette opens the searchable command palette.')
    expect(template).toContain('Help menu Refresh Settings reports refreshed configuration.')
    expect(template).toContain('Help menu Export Diagnostics writes a redacted bundle.')
    expect(template).toContain('Use Command Palette lifecycle create commands.')
    expect(template).toContain('Use Command Palette Settings management commands.')
    expect(template).toContain('Inspect MCP and Skills details from Settings.')
    expect(template).toContain('Use `/` composer lifecycle and Settings shortcuts.')
    expect(template).toContain('- Blocking issues filed: `[none]`')
    expect(template).toContain('- Known limitations accepted: `[yes, approver]`')
    expect(template).toContain('- UX release approval: `[approved/rejected, approver, YYYY-MM-DD]`')
  })

  it('validates completed UX validation evidence before release verification', () => {
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence())).toEqual([])

    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      representativeUser: '[name or role, YYYY-MM-DD]',
    }))).toContain(
      'UX validation evidence still contains template placeholders.',
    )
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      validator: 'Release QA',
    }))).toContain(
      'UX validation evidence must name a validator with YYYY-MM-DD validation date.',
    )
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      validator: 'TBD, 2026-07-16',
    }))).toContain(
      'UX validation evidence must name a validator with YYYY-MM-DD validation date.',
    )
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      representativeUser: 'Desktop engineer',
    }))).toContain(
      'UX validation evidence must name a representative user with YYYY-MM-DD validation date.',
    )
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      representativeUserValidation: null,
    }))).toContain(
      'UX validation evidence must record representative user validation: observed, facilitator, YYYY-MM-DD.',
    )
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      representativeUserValidation: 'observed, TBD, 2026-07-16',
    }))).toContain(
      'UX validation evidence must name a real representative user validation facilitator.',
    )
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      screenshotResult: 'fail',
    }))).toContain('UX screenshot review results must be pass or n/a.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      screenshotRows: [
        '| Chat streaming and tool activity | `chat-streaming.png` | pass | reviewed |',
        '| Settings desktop layout | `settings.png` | pass | reviewed |',
        '| Agents management | `agents.png` | pass | reviewed |',
      ],
    }))).toContain('UX validation evidence must review required screenshots: settings-narrow.png, settings-mcp.png, settings-skills.png, command-palette.png, agents-selected.png, tasks.png, teams.png, composer-actions.png, permission-modal.png, files.png, editor.png, diff.png, before-unsaved-files-pane-switch.png, unsaved-files-pane-switch-dialog.png, before-unsaved-diff-pane-switch.png, unsaved-diff-pane-switch-dialog.png, after-unsaved-diff-pane-switch-keep-editing.png, terminal.png, preview.png.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      screenshotRows: [
        '| Chat streaming and tool activity | `chat-streaming.png` | pass | reviewed |',
        '| Settings desktop layout | `settings.png` | pass | reviewed |',
        '| Settings narrow layout | `settings-narrow.png` | pass | reviewed |',
        '| MCP management | `settings-mcp.png` | pass | reviewed |',
        '| Skills management | `settings-skills.png` | pass | reviewed |',
        '| Command Palette | `command-palette.png` | pass | reviewed |',
        '| Agents management | `agents.png` | pass | reviewed |',
        '| Selected agent actions | `agents-selected.png` | pass | reviewed |',
        '| Scheduled tasks management | `tasks.png` | pass | reviewed |',
        '| Teams management | `teams.png` | pass | reviewed |',
        '| Composer actions menu | `composer-actions.png` | pass | reviewed |',
        '| Permission review modal | `permission-modal.png` | pass | reviewed |',
        '| Files browser | `files.png` | pass | reviewed |',
        '| Editor | `editor.png` | pass | reviewed |',
        '| Diff viewer | `diff.png` | pass | reviewed |',
        '| Files/editor unsaved guard | `before-unsaved-files-pane-switch.png`, `unsaved-files-pane-switch-dialog.png`, `before-unsaved-diff-pane-switch.png`, `unsaved-diff-pane-switch-dialog.png`, `after-unsaved-diff-pane-switch-keep-editing.png` | pass | reviewed |',
        '| Terminal | `terminal.png` | pass | reviewed |',
        '',
        'Reviewer note: preview.png still needs a screenshot table row.',
      ],
    }))).toContain('UX validation evidence must review required screenshots: preview.png.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      manualTaskResult: 'fail',
    }))).toContain('UX manual task results must all be pass.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      manualTaskRows: [
        '| Create a new local session from the session rail. | Session appears, focuses, and status is visible. | pass | reviewed |',
      ],
    }))).toContain('UX validation evidence must include required manual tasks: Send a short prompt and wait for streaming output., Trigger a permission request and choose allow, then deny on a second request., Open Files, expand a folder, edit a text file, save, and refresh Diff., Start Terminal, run `pwd` and `git status`, then stop/restart it., Open Preview with a local URL and then open externally., Open Agents, launch an agent task, and inspect running task feedback., Open Teams and route a composer message to a teammate or team., Use Command Palette and native View menu navigation., Use native Help menu support actions., Use Command Palette lifecycle create commands., Use Command Palette Settings management commands., Inspect MCP and Skills details from Settings., Use `@` resources and `/` actions from the composer., Use `/` composer lifecycle and Settings shortcuts., Export diagnostics from Settings..')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      blockingIssues: 'DESKTOP-123',
    }))).toContain('UX validation evidence must record no blocking issues.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      knownLimitationsAccepted: 'no, Release QA',
    }))).toContain('UX validation evidence must record known limitations accepted: yes, approver.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      knownLimitationsAccepted: 'yes',
    }))).toContain('UX validation evidence must record known limitations accepted: yes, approver.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      knownLimitationsAccepted: 'yes, TBD',
    }))).toContain('UX validation evidence must name a real known limitations approver.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      approval: 'approved',
    }))).toContain('UX validation evidence must include UX release approval: approved, approver, YYYY-MM-DD.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      approval: 'approved, Release QA',
    }))).toContain('UX validation evidence must include UX release approval: approved, approver, YYYY-MM-DD.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      approval: 'approved, none, 2026-07-16',
    }))).toContain('UX validation evidence must name a real UX release approval approver.')
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      version: '1.2.2',
    }), { expectedVersion: '1.2.3', expectedCommit: 'abc123' })).toContain(
      'UX validation evidence Version=1.2.2 does not match releaseVersion=1.2.3.',
    )
    expect(validateUxValidationEvidenceContents(completedUxValidationEvidence({
      commit: 'oldcommit',
    }), { expectedVersion: '1.2.3', expectedCommit: 'abc123' })).toContain(
      'UX validation evidence Commit=oldcommit does not match release commit=abc123.',
    )
  })

  it('validates UX validation evidence files against the release version and commit', () => {
    expect(validateUxValidationEvidenceFile({
      outputPath: '/release/ux-validation-evidence.md',
      expectedVersion: '1.2.3',
      expectedCommit: 'abc123',
      readFile: () => completedUxValidationEvidence({
        version: '1.2.2',
        commit: 'oldcommit',
      }),
    })).toEqual([
      'UX validation evidence Version=1.2.2 does not match releaseVersion=1.2.3.',
      'UX validation evidence Commit=oldcommit does not match release commit=abc123.',
    ])
  })

  it('does not overwrite UX validation evidence unless forced', () => {
    const writes: string[] = []

    expect(() => writeUxValidationEvidenceTemplate({
      outputPath: '/release/ux-validation-evidence.md',
      version: '1.2.3',
      commit: 'abc123',
      exists: () => true,
      mkdir: () => {},
      writeFile: path => writes.push(String(path)),
    })).toThrow('already exists')
    expect(writes).toEqual([])

    writeUxValidationEvidenceTemplate({
      outputPath: '/release/ux-validation-evidence.md',
      version: '1.2.3',
      commit: 'abc123',
      force: true,
      exists: () => true,
      mkdir: () => {},
      writeFile: path => writes.push(String(path)),
    })

    expect(writes).toEqual(['/release/ux-validation-evidence.md'])
  })
})
