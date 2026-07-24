import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  isPlaceholderInlineCertificateBundle,
  isValidInlineBase64Secret,
  isDeveloperIdApplicationIdentity,
  notarizationCredentialStrategy,
  validateReleaseEnvironment,
} from './release-ci.mjs'

const root = new URL('../..', import.meta.url).pathname

function pass(id, message, evidence) {
  return { id, status: 'pass', message, evidence }
}

function fail(id, message, evidence, nextAction) {
  return { id, status: 'fail', message, evidence, nextAction }
}

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'))
}

async function readText(path) {
  return readFile(join(root, path), 'utf8')
}

function hasScript(packageJson, name) {
  return typeof packageJson.scripts?.[name] === 'string' &&
    packageJson.scripts[name].trim().length > 0
}

function configuredEnvValue(value) {
  if (!value) return false
  return !/(^example$|example\.com|not-a-secret|placeholder|changeme|TEAMID1234|Developer ID Application: Example)/i.test(value)
}

function pathLikeSecret(value) {
  const trimmed = value?.trim() ?? ''
  return trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('~')
}

function cspContent(indexHtml) {
  return indexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)
}

function asArray(value) {
  return Array.isArray(value) ? value : [value]
}

function envValueUsesSecret(env, name, secretName) {
  return String(env?.[name] ?? '').includes(`secrets.${secretName}`)
}

export function checkCodeSigningIdentity(env = process.env) {
  if (configuredEnvValue(env.CSC_LINK?.trim())) {
    if (!pathLikeSecret(env.CSC_LINK) && !isValidInlineBase64Secret(env.CSC_LINK)) {
      return fail(
        'code-signing-identity',
        'Production builds require a Developer ID Application certificate bundle or certificate file path.',
        'CSC_LINK is not valid base64 or a local certificate path',
        'Set CSC_LINK to a base64-encoded Developer ID Application certificate bundle, or to a local certificate file path available on the release runner.',
      )
    }
    if (!pathLikeSecret(env.CSC_LINK) && isPlaceholderInlineCertificateBundle(env.CSC_LINK)) {
      return fail(
        'code-signing-identity',
        'Production builds require a real Developer ID Application certificate bundle.',
        'CSC_LINK is base64-encoded placeholder text',
        'Set CSC_LINK to a base64-encoded Developer ID Application certificate bundle, or to a local certificate file path available on the release runner.',
      )
    }
    if (!configuredEnvValue(env.CSC_KEY_PASSWORD?.trim())) {
      return fail(
        'code-signing-identity',
        'Production builds require the password for the Developer ID Application certificate bundle.',
        'CSC_LINK is set but CSC_KEY_PASSWORD is missing or looks like a placeholder',
        'Configure CSC_KEY_PASSWORD with the password for the Developer ID Application certificate bundle.',
      )
    }
    return pass('code-signing-identity', 'A code signing identity is configured for the release environment.', 'CSC_LINK is set')
  }

  const cscName = env.CSC_NAME?.trim() ?? ''
  if (isDeveloperIdApplicationIdentity(cscName)) {
    return pass('code-signing-identity', 'A Developer ID Application signing identity is configured for the release environment.', `CSC_NAME=${cscName}`)
  }
  if (configuredEnvValue(cscName) && /^Developer ID Application:/i.test(cscName)) {
    return fail(
      'code-signing-identity',
      'Production builds require a Developer ID Application signing identity with a Team ID.',
      `CSC_NAME=${cscName}`,
      'Set CSC_NAME to the exact keychain identity including its 10-character Team ID, for example: Developer ID Application: Example Corp (ABCDE12345).',
    )
  }

  return fail(
    'code-signing-identity',
    'Production builds require a Developer ID Application signing identity.',
    cscName ? `CSC_NAME=${cscName}` : 'CSC_LINK and CSC_NAME are not set or look like placeholders',
    'Configure CSC_LINK with a Developer ID Application certificate, or set CSC_NAME to a Developer ID Application identity in CI/release environment.',
  )
}

export function checkReleaseWorkflowAutomation(releaseWorkflow) {
  if (!releaseWorkflow?.trim()) {
    return fail(
      'release-ci-automation',
      'Production releases need a signed release CI workflow.',
      '.github/workflows/desktop-release.yml is missing or empty',
      'Add a macOS release workflow that runs bun run desktop:release-ci with signing and notarization secrets.',
    )
  }

  let workflow
  try {
    workflow = parseYaml(releaseWorkflow)
  } catch (error) {
    return fail(
      'release-ci-automation',
      'Production releases need a parseable signed release CI workflow.',
      error instanceof Error ? error.message : String(error),
      'Fix .github/workflows/desktop-release.yml so production readiness can validate the release job.',
    )
  }

  const jobEntries = Object.entries(workflow?.jobs ?? {})
  const releaseJobEntry = jobEntries.find(([, job]) => {
    const steps = Array.isArray(job?.steps) ? job.steps : []
    return steps.some(step => String(step?.run ?? '').includes('bun run desktop:release-ci'))
  })
  const releaseJob = releaseJobEntry?.[1]
  const releaseJobName = releaseJobEntry?.[0]
  if (!releaseJob) {
    return fail(
      'release-ci-automation',
      'Production releases need a signed release CI workflow.',
      '.github/workflows/desktop-release.yml does not contain a job step that runs bun run desktop:release-ci',
      'Add a macOS release workflow that runs bun run desktop:release-ci with signing and notarization secrets.',
    )
  }
  const publishJobEntry = jobEntries.find(([, job]) => {
    const steps = Array.isArray(job?.steps) ? job.steps : []
    return steps.some(step => String(step?.uses ?? '').trim() === 'softprops/action-gh-release@v2')
  })
  const publishJob = publishJobEntry?.[1]
  const publishJobName = publishJobEntry?.[0]
  const productionGateJobEntry = jobEntries.find(([, job]) => {
    const steps = Array.isArray(job?.steps) ? job.steps : []
    return steps.some(step => String(step?.run ?? '').includes('bun run desktop:production-gate'))
  })
  const productionGateJob = productionGateJobEntry?.[1]
  const productionGateJobName = productionGateJobEntry?.[0]
  const publicReleaseJobEntry = jobEntries.find(([, job]) => {
    const steps = Array.isArray(job?.steps) ? job.steps : []
    return steps.some(step => {
      const run = String(step?.run ?? '')
      return run.includes('gh release edit "$release_tag"') &&
        run.includes('--draft=false') &&
        run.includes('--prerelease=false')
    })
  })
  const publicReleaseJob = publicReleaseJobEntry?.[1]

  const failures = []
  const requireCheckedOutBunRuntimeBeforeDesktopScripts = (job, label) => {
    const steps = Array.isArray(job?.steps) ? job.steps : []
    const firstDesktopScriptIndex = steps.findIndex(step => String(step?.run ?? '').includes('bun run desktop:'))
    if (firstDesktopScriptIndex === -1) return

    const checkoutIndex = steps.findIndex(step => String(step?.uses ?? '').trim() === 'actions/checkout@v4')
    const resolveBunIndex = steps.findIndex(step => {
      const run = String(step?.run ?? '')
      return String(step?.id ?? '').trim() === 'bun-version' &&
        run.includes("require('./package.json').packageManager") &&
        run.includes('GITHUB_OUTPUT')
    })
    const setupBunIndex = steps.findIndex(step =>
      String(step?.uses ?? '').trim() === 'oven-sh/setup-bun@v2' &&
      String(step?.with?.['bun-version'] ?? '').trim() === '${{ steps.bun-version.outputs.version }}'
    )

    if (
      checkoutIndex === -1 ||
      resolveBunIndex === -1 ||
      setupBunIndex === -1 ||
      checkoutIndex > firstDesktopScriptIndex ||
      resolveBunIndex > firstDesktopScriptIndex ||
      setupBunIndex > firstDesktopScriptIndex ||
      checkoutIndex > resolveBunIndex ||
      resolveBunIndex > setupBunIndex
    ) {
      failures.push(`${label} job must checkout source and setup Bun before running desktop release scripts`)
    }
  }
  const triggers = workflow?.on
  const dispatchInputs = triggers?.workflow_dispatch?.inputs
  const versionInput = dispatchInputs?.version
  const uxEvidenceInput = dispatchInputs?.ux_validation_evidence_base64
  if (
    !triggers?.workflow_dispatch ||
    !dispatchInputs ||
    versionInput?.required !== true ||
    String(versionInput?.type ?? '').trim() !== 'string'
  ) {
    failures.push('release workflow must define workflow_dispatch with a required string version input')
  }
  if (!uxEvidenceInput || String(uxEvidenceInput?.type ?? '').trim() !== 'string') {
    failures.push('release workflow workflow_dispatch must include a string ux_validation_evidence_base64 input')
  }
  const releaseTags = asArray(triggers?.push?.tags ?? []).map(value => String(value ?? '').trim())
  if (!releaseTags.includes('desktop-v*')) {
    failures.push('release workflow must run on desktop-v* tag pushes')
  }

  const concurrency = workflow?.concurrency
  const concurrencyGroup = String(concurrency?.group ?? '')
  if (!concurrency || typeof concurrency !== 'object') {
    failures.push('release workflow must define concurrency to serialize releases by version or tag')
  } else {
    if (
      !concurrencyGroup.includes('desktop-release') ||
      !concurrencyGroup.includes('inputs.version') ||
      !concurrencyGroup.includes('github.ref_name')
    ) {
      failures.push('release workflow concurrency group must include desktop-release, inputs.version, and github.ref_name')
    }
    if (concurrency['cancel-in-progress'] !== false) {
      failures.push('release workflow concurrency cancel-in-progress must be false so in-flight release evidence is retained')
    }
  }

  const runsOn = asArray(releaseJob['runs-on']).map(value => String(value ?? ''))
  if (!runsOn.some(value => value.startsWith('macos-'))) {
    failures.push(`release job must run on macOS; runs-on=${runsOn.join(', ') || '<missing>'}`)
  }
  if (String(releaseJob.environment ?? '').trim() !== 'desktop-release') {
    failures.push('release job must use the protected desktop-release environment for signing and notarization secrets')
  }
  const timeoutMinutes = Number(releaseJob['timeout-minutes'])
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 30 || timeoutMinutes > 120) {
    failures.push(`release job timeout-minutes must be set between 30 and 120; timeout-minutes=${releaseJob['timeout-minutes'] ?? '<missing>'}`)
  }
  const permissions = releaseJob.permissions
  if (!permissions || typeof permissions !== 'object') {
    failures.push('release job must set minimal GitHub token permissions with contents: read')
  } else {
    if (String(permissions.contents ?? '').trim() !== 'read') {
      failures.push('release job permissions must set contents: read')
    }
    const writePermissions = Object.entries(permissions)
      .filter(([, value]) => String(value ?? '').trim() === 'write')
      .map(([name]) => name)
    if (writePermissions.length > 0) {
      failures.push(`release job permissions must not include write access: ${writePermissions.join(', ')}`)
    }
  }

  const requiredSecretEnv = {
    CSC_LINK: 'DESKTOP_MAC_CSC_LINK',
    CSC_KEY_PASSWORD: 'DESKTOP_MAC_CSC_KEY_PASSWORD',
    CSC_NAME: 'DESKTOP_MAC_CSC_NAME',
    APPLE_API_KEY: 'DESKTOP_APPLE_API_KEY',
    APPLE_API_KEY_ID: 'DESKTOP_APPLE_API_KEY_ID',
    APPLE_API_ISSUER: 'DESKTOP_APPLE_API_ISSUER',
    APPLE_ID: 'DESKTOP_APPLE_ID',
    APPLE_APP_SPECIFIC_PASSWORD: 'DESKTOP_APPLE_APP_SPECIFIC_PASSWORD',
    APPLE_TEAM_ID: 'DESKTOP_APPLE_TEAM_ID',
    APPLE_KEYCHAIN: 'DESKTOP_APPLE_KEYCHAIN',
    APPLE_KEYCHAIN_PROFILE: 'DESKTOP_APPLE_KEYCHAIN_PROFILE',
  }
  const missingSecretEnv = Object.entries(requiredSecretEnv)
    .filter(([envName, secretName]) => !envValueUsesSecret(releaseJob.env, envName, secretName))
    .map(([envName, secretName]) => `${envName}->${secretName}`)
  if (missingSecretEnv.length > 0) {
    failures.push(`release job is missing secret env mappings: ${missingSecretEnv.join(', ')}`)
  }

  if (!String(releaseJob.env?.DESKTOP_RELEASE_VERSION ?? '').trim()) {
    failures.push('release job must set DESKTOP_RELEASE_VERSION')
  }

  const steps = Array.isArray(releaseJob.steps) ? releaseJob.steps : []
  const requiredActions = [
    'actions/checkout@v4',
    'oven-sh/setup-bun@v2',
    'actions/setup-node@v4',
    'actions/upload-artifact@v4',
  ]
  for (const action of requiredActions) {
    if (!steps.some(step => String(step?.uses ?? '').trim() === action)) {
      failures.push(`release job must pin ${action}`)
    }
  }
  const floatingActionRefs = steps
    .map(step => String(step?.uses ?? '').trim())
    .filter(Boolean)
    .filter(action => {
      const ref = action.split('@')[1] ?? ''
      return !/^v\d+$/.test(ref) && !/^[0-9a-f]{40}$/i.test(ref)
    })
  if (floatingActionRefs.length > 0) {
    failures.push(`release job action refs must use pinned major tags or full SHAs: ${floatingActionRefs.join(', ')}`)
  }

  const releaseOutputs = releaseJob.outputs
  if (
    !releaseOutputs ||
    !String(releaseOutputs.version ?? '').includes('steps.release-version.outputs.version') ||
    !String(releaseOutputs['artifact-suffix'] ?? '').includes('steps.release-version.outputs.artifact-suffix')
  ) {
    failures.push('release job must expose normalized version and artifact-suffix outputs for the publish job')
  }

  const checkoutStepIndex = steps.findIndex(step => String(step?.uses ?? '').trim() === 'actions/checkout@v4')
  const setupBunStepIndex = steps.findIndex(step => String(step?.uses ?? '').trim() === 'oven-sh/setup-bun@v2')
  const setupNodeStepIndex = steps.findIndex(step => String(step?.uses ?? '').trim() === 'actions/setup-node@v4')
  const installStepIndex = steps.findIndex(step => String(step?.run ?? '').includes('bun install --frozen-lockfile'))
  const releaseCiStepIndex = steps.findIndex(step => String(step?.run ?? '').includes('bun run desktop:release-ci'))
  const archiveAppBundleStepIndex = steps.findIndex(step => {
    const run = String(step?.run ?? '')
    return run.includes('Claude Code Desktop.app') &&
      run.includes('tar -czf') &&
      run.includes('app-bundle.tar.gz')
  })
  const bunVersionStepIndex = steps.findIndex(step => String(step?.run ?? '').includes('BUN_VERSION=') && String(step?.run ?? '').includes('packageManager'))
  const nodeVersionStepIndex = steps.findIndex(step => String(step?.run ?? '').includes('NODE_VERSION=') && String(step?.run ?? '').includes('engines') && String(step?.run ?? '').includes('node'))
  if (checkoutStepIndex < 0) {
    failures.push('release job must checkout source with actions/checkout before installing dependencies or running desktop:release-ci')
  } else if (
    (installStepIndex >= 0 && checkoutStepIndex > installStepIndex) ||
    (releaseCiStepIndex >= 0 && checkoutStepIndex > releaseCiStepIndex)
  ) {
    failures.push('release job checkout step must run before dependency installation and desktop:release-ci')
  }
  const tagNormalizationStepIndex = steps.findIndex(step => String(step?.run ?? '').includes('${version#desktop-v}'))
  if (tagNormalizationStepIndex < 0) {
    failures.push('release job must normalize desktop-v tag versions before running desktop:release-ci')
  } else if (releaseCiStepIndex >= 0 && tagNormalizationStepIndex > releaseCiStepIndex) {
    failures.push('release job must normalize desktop-v tag versions before running desktop:release-ci')
  } else {
    const tagNormalizationRun = String(steps[tagNormalizationStepIndex]?.run ?? '')
    if (
      !tagNormalizationRun.includes('uuidgen') ||
      !tagNormalizationRun.includes('DESKTOP_RELEASE_VERSION<<%s') ||
      !tagNormalizationRun.includes('version<<%s') ||
      !tagNormalizationRun.includes('printf \'%s\\n\' "$version"') ||
      !tagNormalizationRun.includes('GITHUB_ENV') ||
      !tagNormalizationRun.includes('GITHUB_OUTPUT')
    ) {
      failures.push('release job must expose the normalized desktop release version with delimiter-safe GITHUB_ENV and GITHUB_OUTPUT writes')
    }
    if (
      tagNormalizationRun.includes('echo "DESKTOP_RELEASE_VERSION=$version"') ||
      tagNormalizationRun.includes('echo "version=$version"')
    ) {
      failures.push('release job must not write the raw release version to GITHUB_ENV or GITHUB_OUTPUT with single-line echo')
    }
    if (!tagNormalizationRun.includes('artifact-suffix=$version') || !tagNormalizationRun.includes('artifact-suffix=invalid-${GITHUB_RUN_ID}')) {
      failures.push('release job must expose an artifact-safe suffix for release artifact names when version preflight fails')
    }
  }
  if (
    installStepIndex >= 0 &&
    (
      (setupBunStepIndex >= 0 && setupBunStepIndex > installStepIndex) ||
      (setupNodeStepIndex >= 0 && setupNodeStepIndex > installStepIndex) ||
      (releaseCiStepIndex >= 0 && installStepIndex > releaseCiStepIndex)
    )
  ) {
    failures.push('release job dependency installation must run after toolchain setup and before desktop:release-ci')
  }
  if (bunVersionStepIndex < 0) {
    failures.push('release job must resolve BUN_VERSION from package.json packageManager')
  } else if (setupBunStepIndex >= 0 && bunVersionStepIndex > setupBunStepIndex) {
    failures.push('release job version resolution must run before toolchain setup')
  } else {
    const bunVersionRun = String(steps[bunVersionStepIndex]?.run ?? '')
    if (!bunVersionRun.includes('GITHUB_OUTPUT') || !bunVersionRun.includes('version=$bun_version')) {
      failures.push('release job must expose the pinned Bun version as steps.bun-version.outputs.version')
    }
    if (bunVersionRun.includes('tee -a "$GITHUB_ENV" >> "$GITHUB_OUTPUT"')) {
      failures.push('release job must not pipe toolchain resolver output into both GITHUB_ENV and GITHUB_OUTPUT because that pollutes the runner environment with generic output names')
    }
  }
  if (nodeVersionStepIndex < 0) {
    failures.push('release job must resolve NODE_VERSION from package.json engines.node')
  } else if (setupNodeStepIndex >= 0 && nodeVersionStepIndex > setupNodeStepIndex) {
    failures.push('release job version resolution must run before toolchain setup')
  } else {
    const nodeVersionRun = String(steps[nodeVersionStepIndex]?.run ?? '')
    if (!nodeVersionRun.includes('GITHUB_OUTPUT') || !nodeVersionRun.includes('version=$node_version')) {
      failures.push('release job must expose the pinned Node version as steps.node-version.outputs.version')
    }
    if (nodeVersionRun.includes('tee -a "$GITHUB_ENV" >> "$GITHUB_OUTPUT"')) {
      failures.push('release job must not pipe toolchain resolver output into both GITHUB_ENV and GITHUB_OUTPUT because that pollutes the runner environment with generic output names')
    }
  }
  if (!steps.some(step => String(step?.uses ?? '').startsWith('oven-sh/setup-bun@') && String(step?.with?.['bun-version'] ?? '').includes('steps.bun-version.outputs.version'))) {
    failures.push('release job must install the pinned Bun version from steps.bun-version.outputs.version')
  }
  if (!steps.some(step => String(step?.uses ?? '').startsWith('actions/setup-node@') && String(step?.with?.['node-version'] ?? '').includes('steps.node-version.outputs.version'))) {
    failures.push('release job must install the pinned Node version from steps.node-version.outputs.version')
  }
  if (steps.some(step => String(step?.with?.['bun-version'] ?? '').trim() === 'latest')) {
    failures.push('release job must not use bun-version: latest')
  }
  if (steps.some(step => {
    const nodeVersion = String(step?.with?.['node-version'] ?? '').trim()
    return nodeVersion === 'latest' || /^\d+$/.test(nodeVersion)
  })) {
    failures.push('release job must not use a floating node-version')
  }
  if (!steps.some(step => String(step?.run ?? '').includes('bun install --frozen-lockfile'))) {
    failures.push('release job must install dependencies with bun install --frozen-lockfile')
  }
  if (!String(releaseJob.env?.DESKTOP_UX_VALIDATION_EVIDENCE_BASE64 ?? '').trim()) {
    failures.push('release job must set DESKTOP_UX_VALIDATION_EVIDENCE_BASE64')
  }
  if (archiveAppBundleStepIndex < 0) {
    failures.push('release job must archive the signed .app bundle into a tarball before GitHub artifact upload so macOS bundle permissions and symlinks are preserved for the final production gate')
  } else {
    const archiveRun = String(steps[archiveAppBundleStepIndex]?.run ?? '')
    if (
      releaseCiStepIndex < 0 ||
      archiveAppBundleStepIndex <= releaseCiStepIndex ||
      !archiveRun.includes('cd desktop/release') ||
      !archiveRun.includes("find . -maxdepth 2 -type d -name 'Claude Code Desktop.app'") ||
      !archiveRun.includes('test -n "$app_bundle"') ||
      !archiveRun.includes('Claude Code Desktop-${{ steps.release-version.outputs.version }}-app-bundle.tar.gz') ||
      !archiveRun.includes('tar -czf')
    ) {
      failures.push('release job app bundle archive step must run after desktop:release-ci and tar the signed app bundle from desktop/release with the normalized versioned name')
    }
  }
  if (steps.some((step, index) => {
    const run = String(step?.run ?? '')
    return index < releaseCiStepIndex &&
      (
        run.includes('desktop/release/ux-validation-evidence.md') ||
        run.includes('DESKTOP_UX_VALIDATION_EVIDENCE_BASE64') ||
        run.includes('desktop:prepare-ux-validation')
      )
  })) {
    failures.push('release job must leave UX validation evidence materialization and checks to release-ci preflight so failures are recorded in release-evidence.json')
  }
  const uploadStepEntries = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => String(step?.uses ?? '').startsWith('actions/upload-artifact@'))
  const uploadSteps = uploadStepEntries.map(({ step }) => step)
  const firstUploadStepIndex = uploadStepEntries[0]?.index ?? steps.length
  const evidenceUploadSteps = uploadSteps.filter(step => String(step?.with?.name ?? '').includes('claude-code-desktop-macos-evidence'))
  const diagnosticUploadSteps = uploadSteps.filter(step => String(step?.with?.name ?? '').includes('claude-code-desktop-macos-diagnostics'))
  const artifactUploadSteps = uploadSteps.filter(step => String(step?.with?.name ?? '').includes('claude-code-desktop-macos-artifacts'))
  const ignoredPreUploadSteps = steps
    .slice(0, firstUploadStepIndex)
    .filter(step => step?.['continue-on-error'] === true)
  if (ignoredPreUploadSteps.length > 0) {
    failures.push('release job must not set continue-on-error before release artifact upload')
  }
  if (uploadStepEntries.length === 0) {
    failures.push('release artifact upload must archive release evidence and artifacts after desktop:release-ci')
  } else if (
    releaseCiStepIndex < 0 ||
    uploadStepEntries.some(({ index }) => index < releaseCiStepIndex) ||
    !uploadStepEntries.some(({ index }) => index > releaseCiStepIndex)
  ) {
    failures.push('release artifact upload must run after desktop:release-ci so generated release evidence and artifacts are archived')
  }
  if (!uploadSteps.some(step => String(step?.if ?? '').trim() === 'always()')) {
    failures.push('release artifact upload must run with if: always() so failed release evidence is archived')
  }
  if (evidenceUploadSteps.length === 0) {
    failures.push('release workflow must upload release evidence as a dedicated artifact')
  }
  if (diagnosticUploadSteps.length === 0) {
    failures.push('release workflow must upload supplemental release diagnostics as a dedicated artifact')
  }
  if (artifactUploadSteps.length === 0) {
    failures.push('release workflow must upload signed app, DMG, and ZIP artifacts as a dedicated artifact')
  }
  if (!evidenceUploadSteps.some(step => String(step?.if ?? '').trim() === 'always()')) {
    failures.push('release evidence upload must run with if: always() so failed release candidates retain diagnostics')
  }
  if (!diagnosticUploadSteps.some(step => String(step?.if ?? '').trim() === 'always()')) {
    failures.push('supplemental release diagnostics upload must run with if: always() so failed release candidates retain available diagnostics')
  }
  if (!artifactUploadSteps.some(step => ['', 'success()'].includes(String(step?.if ?? '').trim()))) {
    failures.push('signed release artifact upload must run only after desktop:release-ci succeeds so failed candidates do not archive unverified app bundles')
  }
  if (!evidenceUploadSteps.some(step => String(step?.with?.['if-no-files-found'] ?? '').trim() === 'error')) {
    failures.push('release evidence upload must use if-no-files-found: error so missing core evidence cannot be skipped silently')
  }
  if (!diagnosticUploadSteps.some(step => String(step?.with?.['if-no-files-found'] ?? '').trim() === 'ignore')) {
    failures.push('supplemental release diagnostics upload must use if-no-files-found: ignore because early preflight failures may not produce UX evidence, checksums, or screenshots')
  }
  if (!artifactUploadSteps.some(step => String(step?.with?.['if-no-files-found'] ?? '').trim() === 'error')) {
    failures.push('signed release artifact upload must use if-no-files-found: error so missing app, DMG, or ZIP outputs cannot be skipped silently')
  }
  if (!evidenceUploadSteps.some(step => Number(step?.with?.['retention-days']) >= 30)) {
    failures.push('release evidence upload must set retention-days to at least 30 so diagnostics remain available for review and rollback')
  }
  if (!diagnosticUploadSteps.some(step => Number(step?.with?.['retention-days']) >= 30)) {
    failures.push('supplemental release diagnostics upload must set retention-days to at least 30 so available diagnostics remain available for review and rollback')
  }
  if (!artifactUploadSteps.some(step => Number(step?.with?.['retention-days']) >= 30)) {
    failures.push('signed release artifact upload must set retention-days to at least 30 so signed artifacts remain available for review and rollback')
  }
  if (!evidenceUploadSteps.some(step => {
    const name = String(step?.with?.name ?? '')
    return name.includes('claude-code-desktop-macos-evidence') && name.includes('steps.release-version.outputs.artifact-suffix')
  })) {
    failures.push('release evidence upload name must include claude-code-desktop-macos-evidence and steps.release-version.outputs.artifact-suffix so archived diagnostics are stable and artifact-safe')
  }
  if (!artifactUploadSteps.some(step => {
    const name = String(step?.with?.name ?? '')
    return name.includes('claude-code-desktop-macos-artifacts') && name.includes('steps.release-version.outputs.artifact-suffix')
  })) {
    failures.push('signed release artifact upload name must include claude-code-desktop-macos-artifacts and steps.release-version.outputs.artifact-suffix so archived artifacts are stable and artifact-safe')
  }
  if (!diagnosticUploadSteps.some(step => {
    const name = String(step?.with?.name ?? '')
    return name.includes('claude-code-desktop-macos-diagnostics') && name.includes('steps.release-version.outputs.artifact-suffix')
  })) {
    failures.push('supplemental release diagnostics upload name must include claude-code-desktop-macos-diagnostics and steps.release-version.outputs.artifact-suffix so archived diagnostics are stable and artifact-safe')
  }
  const requiredEvidenceUploads = [
    'desktop/release/release-evidence.json',
    'desktop/release/release-notes-evidence.md',
  ]
  const requiredDiagnosticUploads = [
    'desktop/release/ux-validation-evidence.md',
    'desktop/release/SHA256SUMS',
    'desktop/release/ux-screenshots/**/*.png',
  ]
  const requiredArtifactUploads = [
    'desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-app-bundle.tar.gz',
    'desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-*.dmg',
    'desktop/release/Claude Code Desktop-${{ steps.release-version.outputs.version }}-*-mac.zip',
  ]
  const evidenceUploadPaths = evidenceUploadSteps.map(step => String(step?.with?.path ?? '')).join('\n')
  const diagnosticUploadPaths = diagnosticUploadSteps.map(step => String(step?.with?.path ?? '')).join('\n')
  const artifactUploadPaths = artifactUploadSteps.map(step => String(step?.with?.path ?? '')).join('\n')
  const missingEvidenceUploads = requiredEvidenceUploads.filter(path => !evidenceUploadPaths.includes(path))
  const missingDiagnosticUploads = requiredDiagnosticUploads.filter(path => !diagnosticUploadPaths.includes(path))
  const missingArtifactUploads = requiredArtifactUploads.filter(path => !artifactUploadPaths.includes(path))
  const missingUploads = [
    ...missingEvidenceUploads,
    ...missingDiagnosticUploads,
    ...missingArtifactUploads,
  ]
  if (missingUploads.length > 0) {
    failures.push(`release artifact upload is missing paths: ${missingUploads.join(', ')}`)
  }
  if (artifactUploadPaths.includes('desktop/release/mac-*/*.app/**')) {
    failures.push('signed release artifact upload must not upload raw .app bundle contents because GitHub artifact download can lose macOS bundle permissions or symlinks; upload the versioned app-bundle tarball instead')
  }

  if (!publishJob) {
    failures.push('release workflow must publish verified desktop artifacts to a GitHub Release')
  } else {
    requireCheckedOutBunRuntimeBeforeDesktopScripts(publishJob, 'publish')
    const publishSteps = Array.isArray(publishJob.steps) ? publishJob.steps : []
    const publishNeeds = asArray(publishJob.needs).map(value => String(value ?? ''))
    const publishPermissions = publishJob.permissions
    const publishTimeoutMinutes = Number(publishJob['timeout-minutes'])
    const publishActionRefs = publishSteps
      .map(step => String(step?.uses ?? '').trim())
      .filter(Boolean)
    const publishFloatingActionRefs = publishActionRefs.filter(action => {
      const ref = action.split('@')[1] ?? ''
      return !/^v\d+$/.test(ref) && !/^[0-9a-f]{40}$/i.test(ref)
    })
    if (releaseJobName && !publishNeeds.includes(releaseJobName)) {
      failures.push(`publish job must depend on ${releaseJobName} so only verified artifacts are published`)
    }
    if (String(publishJob.if ?? '').trim() !== 'success()') {
      failures.push('publish job must run only after signed release generation succeeds')
    }
    if (!asArray(publishJob['runs-on']).map(value => String(value ?? '')).includes('ubuntu-latest')) {
      failures.push('publish job must run on ubuntu-latest because signing and notarization stay isolated in the macOS release job')
    }
    if (String(publishJob.environment ?? '').trim() !== 'desktop-release') {
      failures.push('publish job must use the protected desktop-release environment before publishing public release artifacts')
    }
    if (!Number.isFinite(publishTimeoutMinutes) || publishTimeoutMinutes < 5 || publishTimeoutMinutes > 60) {
      failures.push(`publish job timeout-minutes must be set between 5 and 60; timeout-minutes=${publishJob['timeout-minutes'] ?? '<missing>'}`)
    }
    if (!publishPermissions || typeof publishPermissions !== 'object') {
      failures.push('publish job must set GitHub token permissions with contents: write')
    } else {
      if (String(publishPermissions.contents ?? '').trim() !== 'write') {
        failures.push('publish job permissions must set contents: write')
      }
      const unexpectedWritePermissions = Object.entries(publishPermissions)
        .filter(([name, value]) => name !== 'contents' && String(value ?? '').trim() === 'write')
        .map(([name]) => name)
      if (unexpectedWritePermissions.length > 0) {
        failures.push(`publish job permissions must not include write access beyond contents: ${unexpectedWritePermissions.join(', ')}`)
      }
    }
    if (!publishActionRefs.includes('actions/download-artifact@v4')) {
      failures.push('publish job must pin actions/download-artifact@v4')
    }
    if (!publishActionRefs.includes('softprops/action-gh-release@v2')) {
      failures.push('publish job must pin softprops/action-gh-release@v2')
    }
    if (publishFloatingActionRefs.length > 0) {
      failures.push(`publish job action refs must use pinned major tags or full SHAs: ${publishFloatingActionRefs.join(', ')}`)
    }

    const publishDownloadSteps = publishSteps.filter(step => String(step?.uses ?? '').trim() === 'actions/download-artifact@v4')
    const publishReleaseStep = publishSteps.find(step => String(step?.uses ?? '').trim() === 'softprops/action-gh-release@v2')
    const publishChecksumStep = publishSteps.find(step => {
      const run = String(step?.run ?? '')
      return run.includes('sha256sum --check') && run.includes('../diagnostics/SHA256SUMS')
    })
    const publishEvidenceStep = publishSteps.find(step => {
      const run = String(step?.run ?? '')
      return run.includes('release-evidence.json') &&
        run.includes('EXPECTED_RELEASE_VERSION') &&
        run.includes('verify-release') &&
        run.includes('final-verify-release')
    })
    const publishScreenshotArchiveStep = publishSteps.find(step => {
      const run = String(step?.run ?? '')
      return run.includes('zip -X -q ux-screenshots.zip -@ < ux-screenshots.files') && run.includes('ux-screenshots')
    })
    const publishedAssetVerificationStep = publishSteps.find(step => {
      const run = String(step?.run ?? '')
      return run.includes('gh release view') &&
        run.includes('github-release.json') &&
        run.includes('release.tagName') &&
        run.includes('ux-screenshots.zip')
    })
    const publishedDownloadVerificationStep = publishSteps.find(step => {
      const run = String(step?.run ?? '')
      return run.includes('gh release download') &&
        run.includes('desktop/release/publish/downloaded') &&
        run.includes('downloaded release assets mismatch') &&
        run.includes('downloaded SHA-256')
    })
    const postPublishEvidenceStep = publishSteps.find(step => {
      const run = String(step?.run ?? '')
      return run.includes('published-release-evidence.json') &&
        run.includes('bun run desktop:write-published-release-evidence') &&
        run.includes('bun run desktop:verify-published-release') &&
        run.includes('gh release upload "$release_tag"') &&
        run.includes('downloaded-evidence')
    })
    const publishDownloadNames = publishDownloadSteps.map(step => String(step?.with?.name ?? '')).join('\n')
    for (const artifactName of [
      'claude-code-desktop-macos-artifacts-${{ needs.macos-release.outputs.artifact-suffix }}',
      'claude-code-desktop-macos-evidence-${{ needs.macos-release.outputs.artifact-suffix }}',
      'claude-code-desktop-macos-diagnostics-${{ needs.macos-release.outputs.artifact-suffix }}',
    ]) {
      if (!publishDownloadNames.includes(artifactName)) {
        failures.push(`publish job must download ${artifactName}`)
      }
    }
    const releaseWith = publishReleaseStep?.with ?? {}
    const releaseFiles = String(releaseWith.files ?? '')
    const publishChecksumStepIndex = publishChecksumStep
      ? publishSteps.indexOf(publishChecksumStep)
      : -1
    const publishEvidenceStepIndex = publishEvidenceStep
      ? publishSteps.indexOf(publishEvidenceStep)
      : -1
    const publishScreenshotArchiveStepIndex = publishScreenshotArchiveStep
      ? publishSteps.indexOf(publishScreenshotArchiveStep)
      : -1
    const publishReleaseStepIndex = publishReleaseStep
      ? publishSteps.indexOf(publishReleaseStep)
      : -1
    const publishedAssetVerificationStepIndex = publishedAssetVerificationStep
      ? publishSteps.indexOf(publishedAssetVerificationStep)
      : -1
    const publishedDownloadVerificationStepIndex = publishedDownloadVerificationStep
      ? publishSteps.indexOf(publishedDownloadVerificationStep)
      : -1
    const postPublishEvidenceStepIndex = postPublishEvidenceStep
      ? publishSteps.indexOf(postPublishEvidenceStep)
      : -1
    const lastPublishDownloadStepIndex = Math.max(...publishDownloadSteps.map(step => publishSteps.indexOf(step)))
    if (!publishChecksumStep) {
      failures.push('publish job must verify downloaded DMG and ZIP checksums before creating the GitHub Release')
    } else {
      const checksumRun = String(publishChecksumStep.run ?? '')
      if (publishChecksumStepIndex <= lastPublishDownloadStepIndex || (publishReleaseStepIndex >= 0 && publishChecksumStepIndex >= publishReleaseStepIndex)) {
        failures.push('publish job checksum verification must run after artifact downloads and before GitHub Release publishing')
      }
      if (
        !checksumRun.includes('cd desktop/release/publish/artifacts') ||
        !checksumRun.includes('sha256sum --check ../diagnostics/SHA256SUMS --strict') ||
        !checksumRun.includes('Claude Code Desktop-${{ needs.macos-release.outputs.version }}-*.dmg') ||
        !checksumRun.includes('Claude Code Desktop-${{ needs.macos-release.outputs.version }}-*-mac.zip')
      ) {
        failures.push('publish job checksum verification must check SHA256SUMS against downloaded current-version DMG and ZIP files')
      }
    }
    if (!publishEvidenceStep) {
      failures.push('publish job must verify downloaded release evidence before creating the GitHub Release')
    } else {
      const evidenceRun = String(publishEvidenceStep.run ?? '')
      const evidenceEnv = publishEvidenceStep.env ?? {}
      if (publishEvidenceStepIndex <= lastPublishDownloadStepIndex || (publishReleaseStepIndex >= 0 && publishEvidenceStepIndex >= publishReleaseStepIndex)) {
        failures.push('publish job release evidence verification must run after artifact downloads and before GitHub Release publishing')
      }
      if (String(evidenceEnv.EXPECTED_RELEASE_VERSION ?? '').trim() !== '${{ needs.macos-release.outputs.version }}') {
        failures.push('publish job release evidence verification must compare against the normalized release version output')
      }
      for (const [envName, expectedValue] of [
        ['EXPECTED_REPOSITORY', '${{ github.repository }}'],
        ['EXPECTED_REF_NAME', '${{ github.ref_name }}'],
        ['EXPECTED_REF_TYPE', '${{ github.ref_type }}'],
        ['EXPECTED_EVENT_NAME', '${{ github.event_name }}'],
        ['EXPECTED_COMMIT', '${{ github.sha }}'],
        ['EXPECTED_RUN_ID', '${{ github.run_id }}'],
        ['EXPECTED_RUN_ATTEMPT', '${{ github.run_attempt }}'],
        ['EXPECTED_RUN_URL', '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}/attempts/${{ github.run_attempt }}'],
      ]) {
        if (String(evidenceEnv[envName] ?? '').trim() !== expectedValue) {
          failures.push(`publish job release evidence verification must compare ${envName} against ${expectedValue}`)
        }
      }
      if (
        !evidenceRun.includes('desktop/release/publish/evidence/release-evidence.json') ||
        !evidenceRun.includes('createHash') ||
        !evidenceRun.includes('evidence.releaseVersion !== expectedVersion') ||
        !evidenceRun.includes("evidence.evidencePurpose === 'preflight-only'") ||
        !evidenceRun.includes("requireSourceField(source, 'repository', process.env.EXPECTED_REPOSITORY)") ||
        !evidenceRun.includes("requireSourceField(source, 'refName', process.env.EXPECTED_REF_NAME)") ||
        !evidenceRun.includes("requireSourceField(source, 'refType', process.env.EXPECTED_REF_TYPE)") ||
        !evidenceRun.includes("requireSourceField(source, 'eventName', process.env.EXPECTED_EVENT_NAME)") ||
        !evidenceRun.includes("requireSourceField(source, 'commit', process.env.EXPECTED_COMMIT)") ||
        !evidenceRun.includes("requireSourceField(source, 'ciRunId', process.env.EXPECTED_RUN_ID)") ||
        !evidenceRun.includes("requireSourceField(source, 'ciRunAttempt', process.env.EXPECTED_RUN_ATTEMPT)") ||
        !evidenceRun.includes("requireSourceField(source, 'ciRunUrl', process.env.EXPECTED_RUN_URL)") ||
        !evidenceRun.includes("['verify-release', 'final-verify-release']") ||
        !evidenceRun.includes("['mac-app-notarization', 'mac-dmg-notarization', 'mac-app-gatekeeper', 'mac-dmg-gatekeeper']") ||
        !evidenceRun.includes('evidence.checksumManifest') ||
        !evidenceRun.includes('desktop/release/publish/diagnostics/SHA256SUMS') ||
        !evidenceRun.includes('evidence.releaseNotesEvidence') ||
        !evidenceRun.includes('desktop/release/publish/evidence/release-notes-evidence.md') ||
        !evidenceRun.includes('evidence.uxValidationEvidence') ||
        !evidenceRun.includes('desktop/release/publish/diagnostics/ux-validation-evidence.md') ||
        !evidenceRun.includes('verifyScreenshotEvidence(evidence.uxScreenshots)') ||
        !evidenceRun.includes('desktop/release/publish/diagnostics/ux-screenshots')
      ) {
        failures.push('publish job release evidence verification must reject stale/preflight evidence, require current CI source metadata and final signed artifact verification checks, and verify checksum, evidence attachment, and screenshot metadata')
      }
    }
    if (!publishScreenshotArchiveStep) {
      failures.push('publish job must archive verified UX screenshots before creating the GitHub Release')
    } else {
      const archiveRun = String(publishScreenshotArchiveStep.run ?? '')
      if (
        publishScreenshotArchiveStepIndex <= Math.max(lastPublishDownloadStepIndex, publishChecksumStepIndex, publishEvidenceStepIndex) ||
        (publishReleaseStepIndex >= 0 && publishScreenshotArchiveStepIndex >= publishReleaseStepIndex)
      ) {
        failures.push('publish job UX screenshot archive creation must run after downloaded evidence verification and before GitHub Release publishing')
      }
      if (
        !archiveRun.includes('cd desktop/release/publish/diagnostics') ||
        !archiveRun.includes('test -d ux-screenshots') ||
        !archiveRun.includes("find ux-screenshots -type f -name '*.png'") ||
        !archiveRun.includes('LC_ALL=C sort') ||
        !archiveRun.includes('test -s ux-screenshots.files') ||
        !archiveRun.includes('zip -X -q ux-screenshots.zip -@ < ux-screenshots.files')
      ) {
        failures.push('publish job UX screenshot archive creation must fail on missing screenshots and create a deterministic ux-screenshots.zip from verified PNG files')
      }
    }
    if (!String(releaseWith.tag_name ?? '').includes('desktop-v${{ needs.macos-release.outputs.version }}')) {
      failures.push('GitHub Release tag must use desktop-v plus the normalized release version output')
    }
    if (!String(releaseWith.name ?? '').includes('Claude Code Desktop ${{ needs.macos-release.outputs.version }}')) {
      failures.push('GitHub Release name must include the normalized release version output')
    }
    if (releaseWith.draft !== true) {
      failures.push('GitHub Release must be created as a draft until the final production-gate job passes')
    }
    if (releaseWith.prerelease !== false) {
      failures.push('GitHub Release must explicitly set prerelease: false')
    }
    if (String(releaseWith.body_path ?? '').trim() !== 'desktop/release/publish/evidence/release-notes-evidence.md') {
      failures.push('GitHub Release body must come from release-notes-evidence.md')
    }
    if (releaseWith.fail_on_unmatched_files !== true) {
      failures.push('GitHub Release publishing must fail when expected release files are missing')
    }
    for (const releaseFile of [
      'desktop/release/publish/artifacts/Claude Code Desktop-${{ needs.macos-release.outputs.version }}-*.dmg',
      'desktop/release/publish/artifacts/Claude Code Desktop-${{ needs.macos-release.outputs.version }}-*-mac.zip',
      'desktop/release/publish/diagnostics/SHA256SUMS',
      'desktop/release/publish/evidence/release-evidence.json',
      'desktop/release/publish/evidence/release-notes-evidence.md',
      'desktop/release/publish/diagnostics/ux-validation-evidence.md',
      'desktop/release/publish/diagnostics/ux-screenshots.zip',
    ]) {
      if (!releaseFiles.includes(releaseFile)) {
        failures.push(`GitHub Release publishing is missing file: ${releaseFile}`)
      }
    }
    if (!publishedAssetVerificationStep) {
      failures.push('publish job must verify the published GitHub Release asset list after uploading release files')
    } else {
      const assetRun = String(publishedAssetVerificationStep.run ?? '')
      const assetEnv = publishedAssetVerificationStep.env ?? {}
      if (publishedAssetVerificationStepIndex <= publishReleaseStepIndex) {
        failures.push('published GitHub Release asset verification must run after GitHub Release publishing')
      }
      if (String(assetEnv.GH_TOKEN ?? '').trim() !== '${{ github.token }}') {
        failures.push('published GitHub Release asset verification must authenticate gh with github.token')
      }
      if (String(assetEnv.EXPECTED_RELEASE_VERSION ?? '').trim() !== '${{ needs.macos-release.outputs.version }}') {
        failures.push('published GitHub Release asset verification must compare against the normalized release version output')
      }
      if (
        !assetRun.includes('gh release view "$release_tag"') ||
        !assetRun.includes('--repo "${{ github.repository }}"') ||
        !assetRun.includes('--json tagName,name,databaseId,url,isDraft,isPrerelease,assets') ||
        !assetRun.includes('desktop/release/publish/github-release.json') ||
        !assetRun.includes('release.tagName !== expectedTag') ||
        !assetRun.includes('release.name !== expectedName') ||
        !assetRun.includes('!release.isDraft || release.isPrerelease') ||
        !assetRun.includes('duplicateAssetNames') ||
        !assetRun.includes('Claude Code Desktop-${escapedVersion}-.+\\\\.dmg') ||
        !assetRun.includes('Claude Code Desktop-${escapedVersion}-.+-mac\\\\.zip') ||
        !assetRun.includes('SHA256SUMS') ||
        !assetRun.includes('release-evidence.json') ||
        !assetRun.includes('release-notes-evidence.md') ||
        !assetRun.includes('ux-validation-evidence.md') ||
        !assetRun.includes('ux-screenshots.zip')
      ) {
        failures.push('draft GitHub Release asset verification must check the release identity, draft state, duplicate asset names, and every required release asset after upload')
      }
    }
    if (!publishedDownloadVerificationStep) {
      failures.push('publish job must download the published GitHub Release assets and compare them with the verified local files')
    } else {
      const downloadRun = String(publishedDownloadVerificationStep.run ?? '')
      const downloadEnv = publishedDownloadVerificationStep.env ?? {}
      if (publishedDownloadVerificationStepIndex <= publishedAssetVerificationStepIndex) {
        failures.push('published GitHub Release download verification must run after published asset list verification')
      }
      if (String(downloadEnv.GH_TOKEN ?? '').trim() !== '${{ github.token }}') {
        failures.push('published GitHub Release download verification must authenticate gh with github.token')
      }
      if (String(downloadEnv.EXPECTED_RELEASE_VERSION ?? '').trim() !== '${{ needs.macos-release.outputs.version }}') {
        failures.push('published GitHub Release download verification must compare against the normalized release version output')
      }
      if (
        !downloadRun.includes('rm -rf desktop/release/publish/downloaded') ||
        !downloadRun.includes('mkdir -p desktop/release/publish/downloaded') ||
        !downloadRun.includes('gh release download "$release_tag"') ||
        !downloadRun.includes('--repo "${{ github.repository }}"') ||
        !downloadRun.includes('--dir desktop/release/publish/downloaded') ||
        !downloadRun.includes('--clobber') ||
        !downloadRun.includes('createHash') ||
        !downloadRun.includes('findOneFile') ||
        !downloadRun.includes('Claude Code Desktop-${escapedVersion}-.+\\\\.dmg') ||
        !downloadRun.includes('Claude Code Desktop-${escapedVersion}-.+-mac\\\\.zip') ||
        !downloadRun.includes('downloaded release assets mismatch') ||
        !downloadRun.includes('statSync(localPath).size') ||
        !downloadRun.includes('statSync(downloadedPath).size') ||
        !downloadRun.includes('downloaded SHA-256') ||
        !downloadRun.includes('release-evidence.json') ||
        !downloadRun.includes('release-notes-evidence.md') ||
        !downloadRun.includes('ux-validation-evidence.md') ||
        !downloadRun.includes('ux-screenshots.zip') ||
        !downloadRun.includes('SHA256SUMS')
      ) {
        failures.push('published GitHub Release download verification must download every asset and compare downloaded names, sizes, and SHA-256 hashes against the verified local files')
      }
    }
    if (!postPublishEvidenceStep) {
      failures.push('publish job must publish machine-readable post-publish release evidence and verify it downloads unchanged')
    } else {
      const evidenceRun = String(postPublishEvidenceStep.run ?? '')
      const evidenceEnv = postPublishEvidenceStep.env ?? {}
      if (postPublishEvidenceStepIndex <= publishedDownloadVerificationStepIndex) {
        failures.push('post-publish release evidence must be generated after published asset download verification')
      }
      for (const [envName, expectedValue] of [
        ['GH_TOKEN', '${{ github.token }}'],
        ['EXPECTED_RELEASE_VERSION', '${{ needs.macos-release.outputs.version }}'],
        ['EXPECTED_REPOSITORY', '${{ github.repository }}'],
        ['EXPECTED_REF_NAME', '${{ github.ref_name }}'],
        ['EXPECTED_REF_TYPE', '${{ github.ref_type }}'],
        ['EXPECTED_EVENT_NAME', '${{ github.event_name }}'],
        ['EXPECTED_COMMIT', '${{ github.sha }}'],
        ['EXPECTED_RUN_ID', '${{ github.run_id }}'],
        ['EXPECTED_RUN_ATTEMPT', '${{ github.run_attempt }}'],
        ['EXPECTED_RUN_URL', '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}/attempts/${{ github.run_attempt }}'],
      ]) {
        if (String(evidenceEnv[envName] ?? '').trim() !== expectedValue) {
          failures.push(`post-publish release evidence must set ${envName} to ${expectedValue}`)
        }
      }
      if (
        !evidenceRun.includes('published-release-evidence.json') ||
        !evidenceRun.includes('bun run desktop:write-published-release-evidence') ||
        !evidenceRun.includes('gh release upload "$release_tag"') ||
        !evidenceRun.includes('--clobber') ||
        !evidenceRun.includes('--pattern published-release-evidence.json') ||
        !evidenceRun.includes('desktop/release/publish/downloaded-evidence') ||
        !evidenceRun.includes('bun run desktop:verify-published-release')
      ) {
        failures.push('post-publish release evidence must record release identity, CI source, verified asset hashes, upload the evidence file, and verify the uploaded evidence download by size, SHA-256, schema, release metadata, CI metadata, timestamp, and asset metadata')
      }
    }
    const publishedEvidenceUploadStep = publishSteps.find(step =>
      String(step?.uses ?? '').trim() === 'actions/upload-artifact@v4' &&
      String(step?.with?.name ?? '').includes('claude-code-desktop-published-evidence') &&
      String(step?.with?.path ?? '').includes('desktop/release/publish/published-release-evidence.json')
    )
    if (!publishedEvidenceUploadStep) {
      failures.push('publish job must upload published-release-evidence.json as a retained artifact for the final production gate')
    } else {
      if (!String(publishedEvidenceUploadStep.with?.name ?? '').includes('needs.macos-release.outputs.artifact-suffix')) {
        failures.push('published release evidence artifact name must include needs.macos-release.outputs.artifact-suffix')
      }
      if (String(publishedEvidenceUploadStep.with?.['if-no-files-found'] ?? '').trim() !== 'error') {
        failures.push('published release evidence artifact upload must use if-no-files-found: error')
      }
      if (Number(publishedEvidenceUploadStep.with?.['retention-days']) < 30) {
        failures.push('published release evidence artifact upload must set retention-days to at least 30')
      }
    }
  }

  if (!productionGateJob) {
    failures.push('release workflow must run a final production-gate job after publishing')
  } else {
    const productionGateSteps = Array.isArray(productionGateJob.steps) ? productionGateJob.steps : []
    const productionGateNeeds = asArray(productionGateJob.needs).map(value => String(value ?? ''))
    const productionGatePermissions = productionGateJob.permissions
    const productionGateActionRefs = productionGateSteps
      .map(step => String(step?.uses ?? '').trim())
      .filter(Boolean)
    const productionGateFloatingActionRefs = productionGateActionRefs.filter(action => {
      const ref = action.split('@')[1] ?? ''
      return !/^v\d+$/.test(ref) && !/^[0-9a-f]{40}$/i.test(ref)
    })
    const productionGateRunsOn = asArray(productionGateJob['runs-on']).map(value => String(value ?? ''))
    const productionGateTimeoutMinutes = Number(productionGateJob['timeout-minutes'])
    const productionGateDownloads = productionGateSteps.filter(step => String(step?.uses ?? '').trim() === 'actions/download-artifact@v4')
    const productionGateSignedArtifactDownloadStep = productionGateDownloads.find(step =>
      String(step?.with?.name ?? '').includes('claude-code-desktop-macos-artifacts'),
    )
    const productionGateDownloadNames = productionGateDownloads.map(step => String(step?.with?.name ?? '')).join('\n')
    const productionGateDownloadPaths = productionGateDownloads.map(step => String(step?.with?.path ?? '')).join('\n')
    const restoreAppBundleStep = productionGateSteps.find(step => {
      const run = String(step?.run ?? '')
      return run.includes('app-bundle.tar.gz') &&
        run.includes('tar -xzf') &&
        run.includes('Claude Code Desktop.app')
    })
    const publishedAssetsDownloadStep = productionGateSteps.find(step => {
      const run = String(step?.run ?? '')
      return run.includes('gh release download') &&
        run.includes('desktop/release/publish/downloaded') &&
        run.includes('desktop/release/publish/downloaded-evidence') &&
        run.includes('published-release-evidence.json')
    })
    const productionGateRunStep = productionGateSteps.find(step => String(step?.run ?? '').includes('bun run desktop:production-gate'))
    const productionGateEvidenceVerifyStep = productionGateSteps.find(step => {
      const run = String(step?.run ?? '')
      return run.includes('node desktop/scripts/production-gate.mjs verify') &&
        run.includes('--evidence desktop/release/production-gate-evidence.json')
    })
    const productionGateEvidenceUploadStep = productionGateSteps.find(step =>
      String(step?.uses ?? '').trim() === 'actions/upload-artifact@v4' &&
      String(step?.with?.name ?? '').includes('claude-code-desktop-production-gate-evidence') &&
      String(step?.with?.path ?? '').includes('desktop/release/production-gate-evidence.json')
    )
    const lastProductionGateDownloadIndex = Math.max(
      -1,
      ...productionGateDownloads.map(step => productionGateSteps.indexOf(step)),
      restoreAppBundleStep ? productionGateSteps.indexOf(restoreAppBundleStep) : -1,
      publishedAssetsDownloadStep ? productionGateSteps.indexOf(publishedAssetsDownloadStep) : -1,
    )
    const productionGateRunIndex = productionGateRunStep
      ? productionGateSteps.indexOf(productionGateRunStep)
      : -1

    if (releaseJobName && !productionGateNeeds.includes(releaseJobName)) {
      failures.push(`production-gate job must depend on ${releaseJobName}`)
    }
    if (publishJobName && !productionGateNeeds.includes(publishJobName)) {
      failures.push(`production-gate job must depend on ${publishJobName}`)
    }
    if (String(productionGateJob.if ?? '').trim() !== 'success()') {
      failures.push('production-gate job must run only after signed release publishing succeeds')
    }
    if (!productionGateRunsOn.includes('macos-14')) {
      failures.push(`production-gate job must run on macos-14 so codesign, spctl, stapler, and notarytool verification match release artifacts; runs-on=${productionGateRunsOn.join(', ') || '<missing>'}`)
    }
    if (String(productionGateJob.environment ?? '').trim() !== 'desktop-release') {
      failures.push('production-gate job must use the protected desktop-release environment for signing and notarization preflight secrets')
    }
    if (!Number.isFinite(productionGateTimeoutMinutes) || productionGateTimeoutMinutes < 10 || productionGateTimeoutMinutes > 60) {
      failures.push(`production-gate job timeout-minutes must be set between 10 and 60; timeout-minutes=${productionGateJob['timeout-minutes'] ?? '<missing>'}`)
    }
    if (!productionGatePermissions || typeof productionGatePermissions !== 'object') {
      failures.push('production-gate job must set minimal GitHub token permissions with contents: read')
    } else {
      if (String(productionGatePermissions.contents ?? '').trim() !== 'read') {
        failures.push('production-gate job permissions must set contents: read')
      }
      const productionGateWritePermissions = Object.entries(productionGatePermissions)
        .filter(([, value]) => String(value ?? '').trim() === 'write')
        .map(([name]) => name)
      if (productionGateWritePermissions.length > 0) {
        failures.push(`production-gate job permissions must not include write access: ${productionGateWritePermissions.join(', ')}`)
      }
    }
    if (productionGateFloatingActionRefs.length > 0) {
      failures.push(`production-gate job action refs must use pinned major tags or full SHAs: ${productionGateFloatingActionRefs.join(', ')}`)
    }
    for (const action of [
      'actions/checkout@v4',
      'oven-sh/setup-bun@v2',
      'actions/setup-node@v4',
      'actions/download-artifact@v4',
    ]) {
      if (!productionGateActionRefs.includes(action)) {
        failures.push(`production-gate job must pin ${action}`)
      }
    }
    const missingProductionGateSecretEnv = Object.entries(requiredSecretEnv)
      .filter(([envName, secretName]) => !envValueUsesSecret(productionGateJob.env, envName, secretName))
      .map(([envName, secretName]) => `${envName}->${secretName}`)
    if (missingProductionGateSecretEnv.length > 0) {
      failures.push(`production-gate job is missing secret env mappings: ${missingProductionGateSecretEnv.join(', ')}`)
    }
    if (String(productionGateJob.env?.DESKTOP_RELEASE_VERSION ?? '').trim() !== '${{ needs.macos-release.outputs.version }}') {
      failures.push('production-gate job must set DESKTOP_RELEASE_VERSION from needs.macos-release.outputs.version')
    }
    if (String(productionGateJob.env?.DESKTOP_UX_VALIDATION_EVIDENCE_PATH ?? '').trim() !== 'desktop/release/ux-validation-evidence.md') {
      failures.push('production-gate job must point DESKTOP_UX_VALIDATION_EVIDENCE_PATH at the downloaded UX validation evidence')
    }
    if (!productionGateSteps.some(step => String(step?.run ?? '').includes('bun install --frozen-lockfile'))) {
      failures.push('production-gate job must install dependencies with bun install --frozen-lockfile')
    }
    if (!restoreAppBundleStep) {
      failures.push('production-gate job must restore the signed .app bundle from the downloaded app-bundle tarball before running desktop:production-gate')
    } else {
      const restoreRun = String(restoreAppBundleStep.run ?? '')
      const restoreIndex = productionGateSteps.indexOf(restoreAppBundleStep)
      const signedArtifactDownloadIndex = productionGateSignedArtifactDownloadStep
        ? productionGateSteps.indexOf(productionGateSignedArtifactDownloadStep)
        : -1
      if (signedArtifactDownloadIndex < 0 || restoreIndex <= signedArtifactDownloadIndex) {
        failures.push('production-gate job must restore the signed .app bundle after downloading signed release artifacts')
      }
      for (const snippet of [
        'cd desktop/release',
        'Claude Code Desktop-${{ needs.macos-release.outputs.version }}-app-bundle.tar.gz',
        'test -n "$app_bundle_archive"',
        'tar -xzf "$app_bundle_archive"',
        "find . -maxdepth 2 -type d -name 'Claude Code Desktop.app'",
        'test -n "$restored_app"',
      ]) {
        if (!restoreRun.includes(snippet)) {
          failures.push(`production-gate app bundle restore step is missing ${snippet}`)
        }
      }
    }
    for (const artifactName of [
      'claude-code-desktop-macos-artifacts-${{ needs.macos-release.outputs.artifact-suffix }}',
      'claude-code-desktop-macos-evidence-${{ needs.macos-release.outputs.artifact-suffix }}',
      'claude-code-desktop-macos-diagnostics-${{ needs.macos-release.outputs.artifact-suffix }}',
      'claude-code-desktop-published-evidence-${{ needs.macos-release.outputs.artifact-suffix }}',
    ]) {
      if (!productionGateDownloadNames.includes(artifactName)) {
        failures.push(`production-gate job must download ${artifactName}`)
      }
    }
    for (const artifactPath of [
      'desktop/release',
      'desktop/release/publish',
    ]) {
      if (!productionGateDownloadPaths.includes(artifactPath)) {
        failures.push(`production-gate job must download release artifacts into ${artifactPath}`)
      }
    }
    if (!publishedAssetsDownloadStep) {
      failures.push('production-gate job must download published GitHub Release assets and published-release-evidence.json before running desktop:production-gate')
    } else {
      const downloadRun = String(publishedAssetsDownloadStep.run ?? '')
      const downloadEnv = publishedAssetsDownloadStep.env ?? {}
      if (String(downloadEnv.GH_TOKEN ?? '').trim() !== '${{ github.token }}') {
        failures.push('production-gate published asset download must authenticate gh with github.token')
      }
      if (String(downloadEnv.EXPECTED_RELEASE_VERSION ?? '').trim() !== '${{ needs.macos-release.outputs.version }}') {
        failures.push('production-gate published asset download must use needs.macos-release.outputs.version')
      }
      for (const snippet of [
        'release_tag="desktop-v${EXPECTED_RELEASE_VERSION}"',
        'rm -rf desktop/release/publish/downloaded desktop/release/publish/downloaded-evidence',
        'mkdir -p desktop/release/publish/downloaded desktop/release/publish/downloaded-evidence',
        'Claude Code Desktop-${EXPECTED_RELEASE_VERSION}-*.dmg',
        'Claude Code Desktop-${EXPECTED_RELEASE_VERSION}-*-mac.zip',
        'SHA256SUMS',
        'release-evidence.json',
        'release-notes-evidence.md',
        'ux-validation-evidence.md',
        'ux-screenshots.zip',
        '--dir desktop/release/publish/downloaded',
        '--pattern published-release-evidence.json',
        '--dir desktop/release/publish/downloaded-evidence',
      ]) {
        if (!downloadRun.includes(snippet)) {
          failures.push(`production-gate published asset download is missing ${snippet}`)
        }
      }
    }
    if (!productionGateRunStep) {
      failures.push('production-gate job must run bun run desktop:production-gate')
    } else if (productionGateRunIndex <= lastProductionGateDownloadIndex) {
      failures.push('production-gate job must run bun run desktop:production-gate after restoring signed artifacts, evidence, diagnostics, and published Release downloads')
    }
    if (!productionGateEvidenceVerifyStep) {
      failures.push('production-gate job must verify production-gate-evidence.json before upload')
    } else {
      const verifyIndex = productionGateSteps.indexOf(productionGateEvidenceVerifyStep)
      const verifyRun = String(productionGateEvidenceVerifyStep.run ?? '')
      if (String(productionGateEvidenceVerifyStep.if ?? '').trim() !== 'always()') {
        failures.push('production-gate evidence verification must run with if: always()')
      }
      if (productionGateRunIndex >= 0 && verifyIndex <= productionGateRunIndex) {
        failures.push('production-gate evidence verification must run after bun run desktop:production-gate')
      }
      if (!verifyRun.includes('--published-evidence desktop/release/publish/downloaded-evidence/published-release-evidence.json')) {
        failures.push('production-gate evidence verification must compare production-gate-evidence.json to published-release-evidence.json source metadata')
      }
    }
    if (!productionGateEvidenceUploadStep) {
      failures.push('production-gate job must upload production-gate-evidence.json as a retained artifact')
    } else {
      const uploadWith = productionGateEvidenceUploadStep.with ?? {}
      const uploadIndex = productionGateSteps.indexOf(productionGateEvidenceUploadStep)
      if (String(productionGateEvidenceUploadStep.if ?? '').trim() !== 'always()') {
        failures.push('production-gate evidence upload must run with if: always()')
      }
      if (productionGateRunIndex >= 0 && uploadIndex <= productionGateRunIndex) {
        failures.push('production-gate evidence upload must run after bun run desktop:production-gate')
      }
      if (productionGateEvidenceVerifyStep && uploadIndex <= productionGateSteps.indexOf(productionGateEvidenceVerifyStep)) {
        failures.push('production-gate evidence upload must run after production-gate evidence verification')
      }
      if (!String(uploadWith.name ?? '').includes('claude-code-desktop-production-gate-evidence-${{ needs.macos-release.outputs.artifact-suffix }}')) {
        failures.push('production-gate evidence artifact name must include needs.macos-release.outputs.artifact-suffix')
      }
      if (String(uploadWith['if-no-files-found'] ?? '').trim() !== 'error') {
        failures.push('production-gate evidence artifact upload must use if-no-files-found: error')
      }
      if (Number(uploadWith['retention-days']) < 30) {
        failures.push('production-gate evidence artifact upload must set retention-days to at least 30')
      }
    }
  }

  if (!publicReleaseJob) {
    failures.push('release workflow must publish the draft GitHub Release publicly only after the final production-gate job passes')
  } else {
    requireCheckedOutBunRuntimeBeforeDesktopScripts(publicReleaseJob, 'public release')
    const publicReleaseSteps = Array.isArray(publicReleaseJob.steps) ? publicReleaseJob.steps : []
    const publicReleaseNeeds = asArray(publicReleaseJob.needs).map(value => String(value ?? ''))
    const publicReleasePermissions = publicReleaseJob.permissions
    const publicReleaseTimeoutMinutes = Number(publicReleaseJob['timeout-minutes'])
    const publicReleaseStep = publicReleaseSteps.find(step => {
      const run = String(step?.run ?? '')
      return run.includes('gh release edit "$release_tag"') &&
        run.includes('--draft=false') &&
        run.includes('--prerelease=false')
    })
    const publicReleaseEvidenceUploadStep = publicReleaseSteps.find(step =>
      String(step?.uses ?? '').trim() === 'actions/upload-artifact@v4' &&
      String(step?.with?.path ?? '').includes('public-release-evidence.json')
    )
    const productionGateEvidenceDownloadStep = publicReleaseSteps.find(step =>
      String(step?.uses ?? '').trim() === 'actions/download-artifact@v4' &&
      String(step?.with?.name ?? '').includes('claude-code-desktop-production-gate-evidence') &&
      String(step?.with?.path ?? '').includes('public-release-input')
    )
    const publishedEvidenceDownloadStep = publicReleaseSteps.find(step =>
      String(step?.uses ?? '').trim() === 'actions/download-artifact@v4' &&
      String(step?.with?.name ?? '').includes('claude-code-desktop-published-evidence') &&
      String(step?.with?.path ?? '').includes('public-release-input/published-evidence')
    )
    const productionGateEvidenceVerifyStep = publicReleaseSteps.find(step =>
      String(step?.run ?? '').trim() === 'node desktop/scripts/production-gate.mjs verify --evidence public-release-input/production-gate-evidence.json --published-evidence public-release-input/published-evidence/published-release-evidence.json'
    )
    if (releaseJobName && !publicReleaseNeeds.includes(releaseJobName)) {
      failures.push(`public release job must depend on ${releaseJobName} for the normalized release version output`)
    }
    if (productionGateJobName && !publicReleaseNeeds.includes(productionGateJobName)) {
      failures.push(`public release job must depend on ${productionGateJobName} so assets are not public before the final production gate passes`)
    }
    if (String(publicReleaseJob.if ?? '').trim() !== 'success()') {
      failures.push('public release job must run only after the final production gate succeeds')
    }
    if (!asArray(publicReleaseJob['runs-on']).map(value => String(value ?? '')).includes('ubuntu-latest')) {
      failures.push('public release job must run on ubuntu-latest because it only flips the already verified draft Release public')
    }
    if (String(publicReleaseJob.environment ?? '').trim() !== 'desktop-release') {
      failures.push('public release job must use the protected desktop-release environment before making assets public')
    }
    if (!Number.isFinite(publicReleaseTimeoutMinutes) || publicReleaseTimeoutMinutes < 5 || publicReleaseTimeoutMinutes > 30) {
      failures.push(`public release job timeout-minutes must be set between 5 and 30; timeout-minutes=${publicReleaseJob['timeout-minutes'] ?? '<missing>'}`)
    }
    if (!publicReleasePermissions || typeof publicReleasePermissions !== 'object') {
      failures.push('public release job must set GitHub token permissions with contents: write')
    } else if (String(publicReleasePermissions.contents ?? '').trim() !== 'write') {
      failures.push('public release job permissions must set contents: write')
    }
    if (!productionGateEvidenceDownloadStep) {
      failures.push('public release job must download production-gate-evidence.json before uploading it as a GitHub Release asset')
    } else {
      const downloadWith = productionGateEvidenceDownloadStep.with ?? {}
      if (!String(downloadWith.name ?? '').includes('claude-code-desktop-production-gate-evidence-${{ needs.macos-release.outputs.artifact-suffix }}')) {
        failures.push('public release production-gate evidence download must use needs.macos-release.outputs.artifact-suffix')
      }
    }
    if (!publishedEvidenceDownloadStep) {
      failures.push('public release job must download published-release-evidence.json before validating production-gate-evidence.json')
    } else {
      const downloadWith = publishedEvidenceDownloadStep.with ?? {}
      if (!String(downloadWith.name ?? '').includes('claude-code-desktop-published-evidence-${{ needs.macos-release.outputs.artifact-suffix }}')) {
        failures.push('public release published evidence download must use needs.macos-release.outputs.artifact-suffix')
      }
    }
    if (!productionGateEvidenceVerifyStep) {
      failures.push('public release job must verify downloaded production-gate-evidence.json against published-release-evidence.json before GitHub Release upload')
    } else {
      const verifyIndex = publicReleaseSteps.indexOf(productionGateEvidenceVerifyStep)
      const downloadIndex = productionGateEvidenceDownloadStep
        ? publicReleaseSteps.indexOf(productionGateEvidenceDownloadStep)
        : -1
      const publishedDownloadIndex = publishedEvidenceDownloadStep
        ? publicReleaseSteps.indexOf(publishedEvidenceDownloadStep)
        : -1
      const publishIndex = publicReleaseStep
        ? publicReleaseSteps.indexOf(publicReleaseStep)
        : -1
      if (downloadIndex >= 0 && verifyIndex <= downloadIndex) {
        failures.push('public release job must verify downloaded production-gate-evidence.json after artifact download')
      }
      if (publishedDownloadIndex >= 0 && verifyIndex <= publishedDownloadIndex) {
        failures.push('public release job must verify downloaded production-gate-evidence.json after published evidence download')
      }
      if (publishIndex >= 0 && verifyIndex >= publishIndex) {
        failures.push('public release job must verify downloaded production-gate-evidence.json before GitHub Release upload')
      }
    }
    if (!publicReleaseStep) {
      failures.push('public release job must undraft the verified GitHub Release with gh release edit --draft=false --prerelease=false')
    } else {
      const publicRun = String(publicReleaseStep.run ?? '')
      const publicEnv = publicReleaseStep.env ?? {}
      const finalPublicDownloadIndex = publicRun.indexOf('rm -rf public-release-output/downloaded-public-release')
      const publicReleaseAssetSetRun = finalPublicDownloadIndex >= 0
        ? publicRun.slice(0, finalPublicDownloadIndex)
        : publicRun
      if (String(publicEnv.GH_TOKEN ?? '').trim() !== '${{ github.token }}') {
        failures.push('public release job must authenticate gh with github.token')
      }
      if (String(publicEnv.EXPECTED_RELEASE_VERSION ?? '').trim() !== '${{ needs.macos-release.outputs.version }}') {
        failures.push('public release job must use needs.macos-release.outputs.version')
      }
      if (!/gh release upload "\$release_tag"\s+\\\s+public-release-input\/production-gate-evidence\.json\s+\\/.test(publicRun)) {
        failures.push('public release job must upload public-release-input/production-gate-evidence.json as a GitHub Release asset before undrafting')
      }
      if (
        !publicRun.includes('node desktop/scripts/published-release-evidence.mjs verify-public') ||
        !publicRun.includes('--evidence public-release-evidence.json') ||
        !publicRun.includes('--production-gate-evidence public-release-input/production-gate-evidence.json') ||
        !publicRun.includes('--published-evidence public-release-input/published-evidence/published-release-evidence.json')
      ) {
        failures.push('public release job must compare public-release-evidence.json to production-gate-evidence.json source metadata and published-release-evidence.json Release identity')
      }
      for (const assetName of [
        'SHA256SUMS',
        'release-evidence.json',
        'release-notes-evidence.md',
        'ux-validation-evidence.md',
        'ux-screenshots.zip',
        'production-gate-evidence.json',
        'published-release-evidence.json',
      ]) {
        if (!publicReleaseAssetSetRun.includes(`'${assetName}',`)) {
          failures.push(`public release job verification is missing ${assetName}`)
        }
      }
      if (
        !publicRun.includes('rm -rf public-release-output/downloaded-public-release') ||
        !publicRun.includes('mkdir -p public-release-output/downloaded-public-release') ||
        !publicRun.includes('--dir public-release-output/downloaded-public-release')
      ) {
        failures.push('public release job must download final public Release assets after undrafting')
      }
      if (
        !publicRun.includes('publishedEvidence.verifiedAssets') ||
        !publicRun.includes("expectedAssets.set('production-gate-evidence.json'") ||
        !publicRun.includes("expectedAssets.set('published-release-evidence.json'") ||
        !publicRun.includes('final public release assets mismatch') ||
        !publicRun.includes('final public asset size') ||
        !publicRun.includes('final public asset SHA-256')
      ) {
        failures.push('public release job must compare final public Release asset names, sizes, and SHA-256 hashes')
      }
      for (const [envName, expectedValue] of [
        ['EXPECTED_REPOSITORY', '${{ github.repository }}'],
        ['EXPECTED_REF_NAME', '${{ github.ref_name }}'],
        ['EXPECTED_REF_TYPE', '${{ github.ref_type }}'],
        ['EXPECTED_EVENT_NAME', '${{ github.event_name }}'],
        ['EXPECTED_COMMIT', '${{ github.sha }}'],
        ['EXPECTED_RUN_ID', '${{ github.run_id }}'],
        ['EXPECTED_RUN_ATTEMPT', '${{ github.run_attempt }}'],
        ['EXPECTED_RUN_URL', '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}/attempts/${{ github.run_attempt }}'],
      ]) {
        if (String(publicEnv[envName] ?? '').trim() !== expectedValue) {
          failures.push(`public release job must record ${envName} in public-release-evidence.json`)
        }
      }
      for (const snippet of [
        'release_tag="desktop-v${EXPECTED_RELEASE_VERSION}"',
        'gh release upload "$release_tag"',
        'public-release-input/production-gate-evidence.json',
        'rm -rf public-release-output/downloaded-gate-evidence',
        'mkdir -p public-release-output/downloaded-gate-evidence',
        'gh release download "$release_tag"',
        '--pattern production-gate-evidence.json',
        '--dir public-release-output/downloaded-gate-evidence',
        'public-release-output/downloaded-gate-evidence/production-gate-evidence.json',
        'uploaded production-gate-evidence.json size',
        'uploaded production-gate-evidence.json SHA-256',
        'gh release edit "$release_tag"',
        '--repo "${{ github.repository }}"',
        '--draft=false',
        '--prerelease=false',
        'gh release view "$release_tag"',
        '--json tagName,name,databaseId,url,isDraft,isPrerelease,assets',
        'release.isDraft || release.isPrerelease',
        "'published-release-evidence.json',",
        'rm -rf public-release-output/downloaded-public-release',
        '--dir public-release-output/downloaded-public-release',
        'publishedEvidence.verifiedAssets',
        'final public release assets mismatch',
        'final public asset SHA-256',
        'Claude Code Desktop-${escapedVersion}-.+\\\\.dmg',
        'Claude Code Desktop-${escapedVersion}-.+-mac\\\\.zip',
        'SHA256SUMS',
        'release-evidence.json',
        'release-notes-evidence.md',
        'ux-validation-evidence.md',
        'ux-screenshots.zip',
        'production-gate-evidence.json',
        'bun run desktop:write-public-release-evidence',
        'bun run desktop:verify-public-release',
        'node desktop/scripts/published-release-evidence.mjs verify-public',
        '--evidence public-release-evidence.json',
        '--production-gate-evidence public-release-input/production-gate-evidence.json',
        '--published-evidence public-release-input/published-evidence/published-release-evidence.json',
      ]) {
        if (!publicRun.includes(snippet)) {
          failures.push(`public release job verification is missing ${snippet}`)
        }
      }
    }
    if (!publicReleaseEvidenceUploadStep) {
      failures.push('public release job must upload public-release-evidence.json as a retained artifact')
    } else {
      const uploadWith = publicReleaseEvidenceUploadStep.with ?? {}
      if (!String(uploadWith.name ?? '').includes('claude-code-desktop-public-release-evidence-${{ needs.macos-release.outputs.artifact-suffix }}')) {
        failures.push('public release evidence artifact name must include needs.macos-release.outputs.artifact-suffix')
      }
      if (String(uploadWith['if-no-files-found'] ?? '').trim() !== 'error') {
        failures.push('public release evidence artifact upload must use if-no-files-found: error')
      }
      if (Number(uploadWith['retention-days']) < 30) {
        failures.push('public release evidence artifact upload must set retention-days to at least 30')
      }
    }
  }

  if (failures.length > 0) {
    return fail(
      'release-ci-automation',
      'Production releases need a signed macOS release CI workflow.',
      failures.join('; '),
      'Keep .github/workflows/desktop-release.yml on a macOS runner with desktop:release-ci, signing/notarization secrets, release artifact uploads, an isolated draft GitHub Release publish job, a final production-gate job with retained production-gate evidence, a post-gate public release job, and retained public-release evidence.',
    )
  }

  return pass(
    'release-ci-automation',
    'A signed desktop release workflow is configured.',
    '.github/workflows/desktop-release.yml runs desktop:release-ci after tag version normalization and frozen install after toolchain setup with pre-upload fail-fast steps from workflow_dispatch or desktop-v* tag releases with pinned action refs on checked-out source on macOS in the desktop-release environment with a bounded job timeout, minimal token permissions, serialized release concurrency, signing/notarization secrets, always uploads retained artifact-safe core release evidence plus available supplemental diagnostics, tars the signed app bundle before GitHub artifact upload, uploads retained artifact-safe signed app bundle tarball/DMG/ZIP artifacts only after release generation succeeds, restores the app bundle tarball for final artifact verification, rechecks downloaded DMG/ZIP checksums and downloaded release evidence, including current CI source metadata, archives verified UX screenshots, publishes verified DMG/ZIP, checksum, release evidence, release notes evidence, UX validation evidence, and UX screenshot archive to a draft desktop-v versioned GitHub Release from an isolated contents: write job with checked-out source and pinned Bun setup before desktop release scripts, verifies the draft Release identity and asset list, downloads every draft release asset and compares it with the verified local files, publishes and verifies post-publish release evidence, uploads that evidence as a workflow artifact, runs a protected macos-14 production-gate job over the signed artifacts and downloaded draft GitHub Release assets, verifies and uploads retained production-gate evidence, then verifies the downloaded production-gate-evidence.json artifact against retained published-release-evidence.json before uploading it to the verified Release, downloads it back and compares size/SHA-256, makes the verified draft Release public from a checked-out source job with pinned Bun setup, downloads the final public asset set and compares names, sizes, and SHA-256 hashes, and uploads retained public-release evidence with CI source ref/event/commit metadata',
  )
}

async function main() {
  const packageJson = await readJson('package.json')
  const builder = await readJson('desktop/electron-builder.json')
  const releasePolicy = existsSync(join(root, 'desktop/release-policy.json'))
    ? await readJson('desktop/release-policy.json')
    : undefined
  const indexHtml = await readText('desktop/renderer/index.html')
  const mainTs = await readText('desktop/main/main.ts')
  const ipcTs = await readText('desktop/main/ipc.ts')
  const preloadTs = await readText('desktop/preload/preload.ts')
  const buildCliTs = existsSync(join(root, 'desktop/scripts/build-cli.mjs'))
    ? await readText('desktop/scripts/build-cli.mjs')
    : ''
  const buildDesktopTs = existsSync(join(root, 'desktop/scripts/build-desktop.mjs'))
    ? await readText('desktop/scripts/build-desktop.mjs')
    : ''
  const diagnosticsTs = existsSync(join(root, 'desktop/main/diagnostics.ts'))
    ? await readText('desktop/main/diagnostics.ts')
    : ''
  const navigationTs = existsSync(join(root, 'desktop/main/navigation.ts'))
    ? await readText('desktop/main/navigation.ts')
    : ''
  const workspaceTs = existsSync(join(root, 'desktop/main/workspace.ts'))
    ? await readText('desktop/main/workspace.ts')
    : ''
  const deepLinkTs = existsSync(join(root, 'desktop/main/deepLink.ts'))
    ? await readText('desktop/main/deepLink.ts')
    : ''
  const workspaceDirectoryTs = existsSync(join(root, 'desktop/main/workspaceDirectory.ts'))
    ? await readText('desktop/main/workspaceDirectory.ts')
    : ''
  const configTs = existsSync(join(root, 'desktop/main/config.ts'))
    ? await readText('desktop/main/config.ts')
    : ''
  const workspaceTasksTs = existsSync(join(root, 'desktop/main/workspaceTasks.ts'))
    ? await readText('desktop/main/workspaceTasks.ts')
    : ''
  const releaseCiTs = existsSync(join(root, 'desktop/scripts/release-ci.mjs'))
    ? await readText('desktop/scripts/release-ci.mjs')
    : ''
  const productionGateTs = existsSync(join(root, 'desktop/scripts/production-gate.mjs'))
    ? await readText('desktop/scripts/production-gate.mjs')
    : ''
  const smokePackagedTs = existsSync(join(root, 'desktop/scripts/smoke-packaged.mjs'))
    ? await readText('desktop/scripts/smoke-packaged.mjs')
    : ''
  const verifyReleaseTs = existsSync(join(root, 'desktop/scripts/verify-release-artifacts.mjs'))
    ? await readText('desktop/scripts/verify-release-artifacts.mjs')
    : ''
  const publishedReleaseEvidenceTs = existsSync(join(root, 'desktop/scripts/published-release-evidence.mjs'))
    ? await readText('desktop/scripts/published-release-evidence.mjs')
    : ''
  const uxValidationTs = existsSync(join(root, 'desktop/scripts/ux-validation-evidence.mjs'))
    ? await readText('desktop/scripts/ux-validation-evidence.mjs')
    : ''
  const releaseWorkflow = existsSync(join(root, '.github/workflows/desktop-release.yml'))
    ? await readText('.github/workflows/desktop-release.yml')
    : ''
  const ipcSecurityReviewPath = 'docs/desktop-ipc-security-review.md'
  const ipcSecurityReview = existsSync(join(root, ipcSecurityReviewPath))
    ? await readText(ipcSecurityReviewPath)
    : ''

  const checks = []
  const version = String(packageJson.version ?? '')
  const releaseVersion = process.env.DESKTOP_RELEASE_VERSION?.trim()
  const releaseEnvFailures = validateReleaseEnvironment(process.env)
  const packageManager = String(packageJson.packageManager ?? '')
  const nodeEngine = String(packageJson.engines?.node ?? '')
  checks.push(
    releaseVersion && isSemver(releaseVersion)
      ? pass('release-version', 'A production release version override is configured.', `DESKTOP_RELEASE_VERSION=${releaseVersion}`)
      : !version || version === '999.0.0-local' || version.includes('local')
      ? fail(
        'release-version',
        'Desktop production releases must not use the local snapshot version.',
        `package.json version is ${version || '<missing>'}; DESKTOP_RELEASE_VERSION=${releaseVersion || '<missing>'}`,
        'Set DESKTOP_RELEASE_VERSION to a semver production version during release, for example 1.0.0.',
      )
      : pass('release-version', 'Package version is production-shaped.', version),
  )

  checks.push(
    /^bun@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageManager)
      ? pass(
        'release-toolchain-version',
        'Release builds pin the Bun toolchain version.',
        `packageManager=${packageManager}`,
      )
      : fail(
        'release-toolchain-version',
        'Production releases must pin the Bun toolchain version.',
        `packageManager=${packageManager || '<missing>'}`,
        'Set package.json packageManager to bun@x.y.z and keep the release workflow using that pinned version.',
      ),
  )

  checks.push(
    existsSync(join(root, 'bun.lock'))
      ? pass(
        'release-lockfile',
        'Release dependency resolution is locked.',
        'bun.lock exists and release workflow uses bun install --frozen-lockfile',
      )
      : fail(
        'release-lockfile',
        'Production releases require a committed Bun lockfile.',
        'bun.lock is missing',
        'Commit bun.lock and keep release CI using bun install --frozen-lockfile.',
      ),
  )

  checks.push(
    /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nodeEngine)
      ? pass(
        'release-node-toolchain-version',
        'Release builds pin the Node toolchain version.',
        `engines.node=${nodeEngine}`,
      )
      : fail(
        'release-node-toolchain-version',
        'Production releases must pin the Node toolchain version.',
        `engines.node=${nodeEngine || '<missing>'}`,
        'Set package.json engines.node to an exact x.y.z version and keep the release workflow using that pinned version.',
      ),
  )

  checks.push(
    releaseEnvFailures.length === 0
      ? pass(
        'release-env-preflight',
        'Release environment passes the same credential preflight used by desktop:release-ci.',
        'validateReleaseEnvironment passed',
      )
      : fail(
        'release-env-preflight',
        'Production readiness must use the same release environment preflight as desktop:release-ci.',
        releaseEnvFailures.join('; '),
        'Fix DESKTOP_RELEASE_VERSION, Developer ID signing, and Apple notarization environment variables before running the signed release pipeline.',
      ),
  )

  checks.push(
    packageJson.scripts?.build?.includes('desktop/scripts/build-cli.mjs') &&
      packageJson.scripts?.['desktop:build']?.includes('desktop/scripts/build-desktop.mjs') &&
      buildCliTs.includes('DESKTOP_RELEASE_VERSION') &&
      buildCliTs.includes('MACRO.VERSION') &&
      buildDesktopTs.includes('packageJsonForRelease') &&
      buildDesktopTs.includes('writeFileSync(packageJsonPath') &&
      buildDesktopTs.includes('buildVersion')
      ? pass(
        'release-version-build',
        'Release version is wired into CLI and Electron desktop build scripts.',
        'build-cli uses DESKTOP_RELEASE_VERSION for MACRO.VERSION; build-desktop temporarily injects package version and Electron buildVersion',
      )
      : fail(
        'release-version-build',
        'Release version override must affect actual build artifacts, not only readiness checks.',
        'Could not prove package scripts, CLI macro version, and Electron metadata use DESKTOP_RELEASE_VERSION',
        'Use release-aware build scripts for CLI and Electron packaging.',
      ),
  )

  checks.push(
    packageJson.main === 'desktop/dist/main/main.js' &&
      builder.extraMetadata?.main === packageJson.main
      ? pass(
        'electron-main-metadata',
        'Package and Electron Builder metadata point to the desktop main process bundle.',
        `package.main=${packageJson.main}; extraMetadata.main=${builder.extraMetadata.main}`,
      )
      : fail(
        'electron-main-metadata',
        'Desktop packaging metadata must point to the built Electron main process bundle.',
        `package.main=${packageJson.main ?? '<missing>'}; extraMetadata.main=${builder.extraMetadata?.main ?? '<missing>'}`,
        'Set package.json main and electron-builder extraMetadata.main to desktop/dist/main/main.js.',
      ),
  )

  const builderFiles = asArray(builder.files ?? []).map(value => String(value ?? '').trim())
  const requiredPackageFilePatterns = [
    'desktop/dist/**/*',
    'desktop/release-policy.json',
    'package.json',
    '!node_modules/**/*',
    'node_modules/node-pty/**/*',
  ]
  const forbiddenPackageFilePatterns = [
    'desktop/release/**/*',
    'desktop/tests/**/*',
    'desktop/scripts/**/*',
    'src/**/*',
    'node_modules/**/*',
  ]
  const missingPackageFilePatterns = requiredPackageFilePatterns
    .filter(pattern => !builderFiles.includes(pattern))
  const forbiddenPackageFileMatches = forbiddenPackageFilePatterns
    .filter(pattern => builderFiles.includes(pattern))
  const broadPackageFilePatterns = builderFiles.filter(pattern =>
    pattern === '**/*' ||
    pattern === 'desktop/**/*' ||
    pattern === 'src/**' ||
    (pattern.startsWith('desktop/') &&
      !pattern.startsWith('desktop/dist/') &&
      pattern !== 'desktop/release-policy.json'),
  )
  checks.push(
    missingPackageFilePatterns.length === 0 &&
      forbiddenPackageFileMatches.length === 0 &&
      broadPackageFilePatterns.length === 0
      ? pass(
        'packaging-scope',
        'Desktop packaging only includes runtime bundles and required native resources.',
        'electron-builder files allowlist desktop/dist/**/*, desktop/release-policy.json, package.json, !node_modules/**/*, and node_modules/node-pty/**/*; excludes desktop/release/**/*, desktop/tests/**/*, desktop/scripts/**/*, src/**/*, and full node_modules/**/*',
      )
      : fail(
        'packaging-scope',
        'Production desktop packaging must not include local source, tests, scripts, release evidence, or full node_modules.',
        [
          missingPackageFilePatterns.length > 0
            ? `missing required package patterns: ${missingPackageFilePatterns.join(', ')}`
            : '',
          forbiddenPackageFileMatches.length > 0
            ? `forbidden package patterns present: ${forbiddenPackageFileMatches.join(', ')}`
            : '',
          broadPackageFilePatterns.length > 0
            ? `broad package patterns present: ${broadPackageFilePatterns.join(', ')}`
            : '',
        ].filter(Boolean).join('; '),
        'Keep electron-builder files scoped to built desktop assets, release policy metadata, package metadata, and node-pty runtime resources only.',
      ),
  )

  const appId = String(builder.appId ?? '')
  checks.push(
    !appId || appId.startsWith('local.')
      ? fail(
        'app-id',
        'Production builds need a stable non-local appId.',
        `electron-builder appId is ${appId || '<missing>'}`,
        'Use an owned reverse-DNS app id such as com.example.claude-code-desktop.',
      )
      : pass('app-id', 'App id is non-local.', appId),
  )

  checks.push(
    builder.mac?.hardenedRuntime === true
      ? pass('mac-hardened-runtime', 'macOS hardened runtime is enabled.', 'mac.hardenedRuntime=true')
      : fail(
        'mac-hardened-runtime',
        'Production macOS builds must enable hardened runtime.',
        `mac.hardenedRuntime is ${String(builder.mac?.hardenedRuntime)}`,
        'Set mac.hardenedRuntime=true and add reviewed entitlements.',
      ),
  )

  checks.push(
    Boolean(builder.mac?.entitlements) &&
      Boolean(builder.mac?.entitlementsInherit) &&
      existsSync(join(root, builder.mac.entitlements)) &&
      existsSync(join(root, builder.mac.entitlementsInherit))
      ? pass(
        'mac-entitlements',
        'macOS entitlements are configured.',
        `entitlements=${builder.mac.entitlements}; entitlementsInherit=${builder.mac.entitlementsInherit}`,
      )
      : fail(
        'mac-entitlements',
        'Production macOS builds need explicit entitlements.',
        `entitlements=${builder.mac?.entitlements ?? '<missing>'}; entitlementsInherit=${builder.mac?.entitlementsInherit ?? '<missing>'}`,
        'Add minimal entitlements plist files and wire them into electron-builder.',
      ),
  )

  checks.push(checkCodeSigningIdentity(process.env))

  checks.push(
    builder.mac?.forceCodeSigning === true || builder.forceCodeSigning === true
      ? pass(
        'code-signing-enforced',
        'Packaging fails if macOS code signing is skipped.',
        builder.mac?.forceCodeSigning === true ? 'mac.forceCodeSigning=true' : 'forceCodeSigning=true',
      )
      : fail(
        'code-signing-enforced',
        'Production macOS builds must fail when code signing cannot be completed.',
        `mac.forceCodeSigning=${String(builder.mac?.forceCodeSigning)}; forceCodeSigning=${String(builder.forceCodeSigning)}`,
        'Set mac.forceCodeSigning=true or top-level forceCodeSigning=true.',
      ),
  )

  const notarizationStrategy = notarizationCredentialStrategy()
  checks.push(
    notarizationStrategy
      ? pass('mac-notarization-credentials', 'macOS notarization credentials are present.', `strategy=${notarizationStrategy}`)
      : fail(
        'mac-notarization-credentials',
        'Production macOS releases require notarization credentials.',
        'Required Apple notarization environment variables are missing or look like placeholders',
        'Configure APPLE_API_KEY, APPLE_API_KEY_ID, and APPLE_API_ISSUER; or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD or APPLE_ID_PASSWORD, and APPLE_TEAM_ID; or APPLE_KEYCHAIN_PROFILE with optional APPLE_KEYCHAIN.',
      ),
  )

  checks.push(
    builder.mac?.notarize === true
      ? pass(
        'mac-notarization-enabled',
        'Electron Builder notarization integration is explicitly enabled.',
        'mac.notarize=true',
      )
      : fail(
        'mac-notarization-enabled',
        'Production macOS builds must explicitly enable Electron Builder notarization.',
        `mac.notarize is ${String(builder.mac?.notarize)}`,
        'Set mac.notarize=true so signed release builds submit to Apple notarization before artifact verification.',
      ),
  )

  const macTargets = Array.isArray(builder.mac?.target)
    ? builder.mac.target.map(target => typeof target === 'string' ? target : target?.target).filter(Boolean)
    : []
  checks.push(
    macTargets.includes('dmg') && macTargets.includes('zip')
      ? pass(
        'mac-release-targets',
        'macOS release builds produce DMG and ZIP artifacts.',
        `mac.target=${macTargets.join(', ')}`,
      )
      : fail(
        'mac-release-targets',
        'macOS production releases need DMG and ZIP artifacts for installer distribution and update metadata.',
        `mac.target=${macTargets.join(', ') || '<missing>'}`,
        'Set electron-builder mac.target to include dmg and zip.',
      ),
  )

  checks.push(
    builder.publish ||
      process.env.DESKTOP_UPDATE_PROVIDER ||
      releasePolicy?.updatePolicy === 'manual'
      ? pass(
        'update-policy',
        'A release update channel or explicit manual update policy is configured.',
        builder.publish
          ? 'electron-builder publish is configured'
          : process.env.DESKTOP_UPDATE_PROVIDER
            ? 'DESKTOP_UPDATE_PROVIDER is set'
            : 'desktop/release-policy.json declares updatePolicy=manual',
      )
      : fail(
        'update-policy',
        'Production desktop releases need an update channel or explicit no-update policy.',
        'No electron-builder publish config, DESKTOP_UPDATE_PROVIDER, or manual release policy is configured',
        'Configure electron-builder publish metadata or document and enforce a manual update policy in desktop/release-policy.json.',
      ),
  )

  const csp = cspContent(indexHtml)
  checks.push(
    csp && !csp.includes("'unsafe-eval'") && csp.includes("default-src 'self'")
      ? pass('renderer-csp', 'Renderer CSP blocks eval and defaults to self.', csp)
      : fail(
        'renderer-csp',
        'Renderer must have a restrictive CSP without unsafe eval.',
        csp ?? '<missing>',
        'Keep default-src self and avoid unsafe-eval in packaged renderer.',
      ),
  )

  checks.push(
    mainTs.includes('nodeIntegration: false') && mainTs.includes('contextIsolation: true')
      ? pass('electron-isolation', 'Renderer has Node integration disabled and context isolation enabled.', 'nodeIntegration=false; contextIsolation=true')
      : fail(
        'electron-isolation',
        'Renderer isolation settings are not production safe.',
        'Expected nodeIntegration=false and contextIsolation=true in BrowserWindow webPreferences',
        'Set nodeIntegration=false and contextIsolation=true.',
      ),
  )

  checks.push(
    mainTs.includes('sandbox: true')
      ? pass('electron-sandbox', 'BrowserWindow sandbox is enabled.', 'sandbox=true')
      : fail(
        'electron-sandbox',
        'Production renderer sandbox is not enabled.',
        'BrowserWindow currently does not set sandbox=true',
        'Enable sandbox=true in BrowserWindow webPreferences.',
      ),
  )

  checks.push(
    ipcTs.includes("case 'preview:openExternal'") &&
      ipcTs.includes('expectHttpUrl') &&
      mainTs.includes('will-navigate') &&
      mainTs.includes('setWindowOpenHandler') &&
      mainTs.includes('navigationActionForUrl') &&
      mainTs.includes('normalizeRendererEntryUrl') &&
      navigationTs.includes('containsControlCharacters') &&
      navigationTs.includes('parsed.username || parsed.password') &&
      navigationTs.includes('isHtmlEntryDocument(parsed)') &&
      navigationTs.includes('isRendererResourceDocument(parsed)') &&
      navigationTs.includes('js|mjs|cjs|css|map|json|wasm') &&
      navigationTs.includes('url: parsed.href')
      ? pass(
        'external-url-validation',
        'External preview, window navigation, and renderer entry URLs are allowlisted.',
        'preview:openExternal uses expectHttpUrl; will-navigate and window.open use navigationActionForUrl; navigation blocks control characters and credentialed URLs before returning normalized hrefs; renderer entry validation requires HTML file entries and rejects JS/CSS/map/runtime resources',
      )
      : fail(
        'external-url-validation',
        'External browser opens and renderer entries must validate URL schemes and unsafe URL forms.',
        'Could not prove preview IPC, will-navigate, window.open, and renderer entry loading all use allowlisted URL validation with normalized external hrefs and resource-document rejection',
        'Validate every shell.openExternal input with an allowlisted URL parser that blocks control characters and credentialed URLs, and keep renderer entry loading restricted to HTML documents instead of JS/CSS/map/runtime resources.',
      ),
  )

  checks.push(
    ipcSecurityReview.includes('desktop/main/ipc.ts') &&
      ipcSecurityReview.includes('desktopChannels') &&
      ipcSecurityReview.includes('validateIpcArgs') &&
      ipcSecurityReview.includes('desktop/preload/preload.ts') &&
      ipcSecurityReview.includes('assertWorkspaceDirectory') &&
      ipcSecurityReview.includes('workspaceCwd') &&
      ipcSecurityReview.includes('assertWorkspaceFileTarget') &&
      ipcSecurityReview.includes('shell.openExternal') &&
      ipcSecurityReview.includes('shell.openPath') &&
      ipcSecurityReview.includes('Terminal channels') &&
      ipcSecurityReview.includes('Process, plugin, MCP, agent, team, scheduled-task, git, and terminal channels') &&
      ipcSecurityReview.includes('desktop/tests/ipc.test.ts') &&
      ipcSecurityReview.includes('bun run desktop:test')
      ? pass(
        'ipc-security-review',
        'Privileged IPC channels have a production security review checklist.',
        `${ipcSecurityReviewPath} covers allowlisted channels, payload validation, typed preload, workspace boundaries, shell URL/path validation, terminal/process ownership, and required tests`,
      )
      : fail(
        'ipc-security-review',
        'Privileged IPC channels need a maintained security review checklist.',
        `${ipcSecurityReviewPath} is missing required IPC security review coverage`,
        'Document the IPC allowlist, validateIpcArgs payload checks, typed preload boundary, workspace and symlink validation, shell URL/path validation, terminal/process ownership, and required IPC tests.',
      ),
  )

  checks.push(
    deepLinkTs.includes('MAX_CWD_LENGTH') &&
      deepLinkTs.includes('isAbsoluteLocalPath') &&
      deepLinkTs.includes('containsControlCharacters') &&
      deepLinkTs.includes('isSafeSessionId')
      ? pass(
        'deep-link-validation',
        'Desktop resume deep links validate local cwd and session id inputs.',
        'desktop/main/deepLink.ts requires absolute local cwd values, bounds cwd/session lengths, and rejects control characters',
      )
      : fail(
        'deep-link-validation',
        'Desktop resume deep links must reject unsafe cwd and session id values before session creation.',
        'Could not prove desktop/main/deepLink.ts validates absolute cwd paths, length bounds, and control characters',
        'Keep claude://resume parsing side-effect free, but reject relative/non-local cwd values and control characters before handleDeepLink creates or resumes sessions.',
      ),
  )

  const workspaceDirectoryUseCount = mainTs.match(/assertWorkspaceDirectory/g)?.length ?? 0
  const workspaceIpcCwdUseCount = mainTs.match(/await workspaceCwd\(cwd\)/g)?.length ?? 0
  checks.push(
      workspaceDirectoryTs.includes('lstat(cwd)') &&
      workspaceDirectoryTs.includes('info.isDirectory()') &&
      workspaceDirectoryTs.includes('Workspace folder must not be a symlink') &&
      workspaceDirectoryTs.includes('assertWorkspaceFileTarget') &&
      workspaceDirectoryTs.includes('Workspace file target must not be a symlink') &&
      workspaceTs.includes('lstat') &&
      workspaceTs.includes('isSymbolicLink()') &&
      configTs.includes('assertWorkspaceFileTarget') &&
      configTs.includes('addOrUpdateProjectMcpServer') &&
      workspaceTasksTs.includes('assertWorkspaceFileTarget') &&
      workspaceTasksTs.includes('writeTaskRecords') &&
      mainTs.includes("import { assertWorkspaceDirectory } from './workspaceDirectory'") &&
      mainTs.includes('async function workspaceCwd') &&
      workspaceDirectoryUseCount >= 4 &&
      workspaceIpcCwdUseCount >= 20
      ? pass(
        'workspace-directory-validation',
        'Session creation and workspace IPC validate folders without following symlink roots, project config writes reject symlink targets, and file tree traversal does not follow symlinks.',
        `desktop/main/workspaceDirectory.ts checks lstat/isDirectory and rejects workspace/file target symlinks; main.ts uses assertWorkspaceDirectory ${workspaceDirectoryUseCount} times and workspaceCwd ${workspaceIpcCwdUseCount} times before workspace IPC; project MCP/tasks use assertWorkspaceFileTarget; workspace tree uses lstat/isSymbolicLink`,
      )
      : fail(
        'workspace-directory-validation',
        'Session creation and workspace IPC must reject missing paths/files/symlinked workspace roots, project config writes must reject symlink targets, and workspace tree must not follow symlink escapes.',
        'Could not prove session creation paths and cwd-based workspace IPC validate cwd with lstat/isDirectory/symlink rejection, project MCP/tasks validate file targets, or workspace tree uses lstat/isSymbolicLink',
        'Route picker, default workspace, IPC sessions:create, deep-link session creation, cwd-based workspace IPC, and project config writes through shared workspace validation, and keep Files tree traversal from following symlinks.',
      ),
  )

  checks.push(
    ipcTs.includes("'diagnostics:export'") &&
      preloadTs.includes('exportDiagnostics') &&
      builder.files?.includes('desktop/release-policy.json') &&
      diagnosticsTs.includes('buildDiagnosticsBundle') &&
      diagnosticsTs.includes('redactDiagnosticText') &&
      diagnosticsTs.includes('failedUpdateEventCount') &&
      mainTs.includes('loadDesktopReleasePolicy') &&
      mainTs.includes('render-process-gone') &&
      mainTs.includes('unresponsive')
      ? pass(
        'diagnostic-export',
        'Local diagnostic export captures operational events and redacted support data.',
        'diagnostics:export IPC, preload API, redaction, packaged release policy, failed update event summary, renderer gone, and unresponsive handlers are present',
      )
      : fail(
        'diagnostic-export',
        'Production builds need a user-triggered redacted diagnostic export.',
        'Could not prove diagnostics IPC, redaction, and renderer crash/unresponsive handlers are wired',
        'Add local diagnostic export with redaction, session summaries, and renderer/main operational events.',
      ),
  )

  const requiredScripts = [
    'check',
    'desktop:check',
    'desktop:test',
    'desktop:smoke-electron',
    'desktop:smoke-packaged',
    'desktop:build',
    'desktop:verify-release',
    'desktop:write-published-release-evidence',
    'desktop:verify-published-release',
    'desktop:write-public-release-evidence',
    'desktop:verify-public-release',
    'desktop:prepare-ux-validation',
    'desktop:release-preflight',
    'desktop:release-ci',
    'desktop:production-gate',
    'desktop:verify-production-gate-evidence',
    'desktop:prod-check',
  ]
  const expectedScriptCommands = new Map([
    ['desktop:release-preflight', 'node desktop/scripts/release-ci.mjs preflight:all'],
    ['desktop:write-published-release-evidence', 'node desktop/scripts/published-release-evidence.mjs generate --release-json desktop/release/publish/github-release.json --downloaded-dir desktop/release/publish/downloaded --output desktop/release/publish/published-release-evidence.json'],
    ['desktop:verify-published-release', 'node desktop/scripts/published-release-evidence.mjs verify --local desktop/release/publish/published-release-evidence.json --evidence desktop/release/publish/downloaded-evidence/published-release-evidence.json --downloaded-dir desktop/release/publish/downloaded'],
    ['desktop:write-public-release-evidence', 'node desktop/scripts/published-release-evidence.mjs generate-public --release-json public-release.json --output public-release-evidence.json'],
    ['desktop:verify-public-release', 'node desktop/scripts/published-release-evidence.mjs verify-public --evidence public-release-evidence.json --production-gate-evidence public-release-input/production-gate-evidence.json --published-evidence public-release-input/published-evidence/published-release-evidence.json'],
    ['desktop:production-gate', 'node desktop/scripts/production-gate.mjs'],
    ['desktop:verify-production-gate-evidence', 'node desktop/scripts/production-gate.mjs verify --evidence desktop/release/production-gate-evidence.json --published-evidence desktop/release/publish/downloaded-evidence/published-release-evidence.json'],
    ['desktop:prod-check', 'node desktop/scripts/production-readiness.mjs'],
  ])
  const missingScripts = requiredScripts.filter(script => !hasScript(packageJson, script))
  const mismatchedScripts = Array.from(expectedScriptCommands.entries())
    .filter(([script]) => hasScript(packageJson, script))
    .filter(([script, expected]) => packageJson.scripts[script].trim() !== expected)
    .map(([script, expected]) => `${script}=${packageJson.scripts[script]}; expected=${expected}`)
  checks.push(
    missingScripts.length === 0 && mismatchedScripts.length === 0
      ? pass('verification-scripts', 'Desktop verification scripts are present.', `${requiredScripts.join(', ')}; exact=${Array.from(expectedScriptCommands.keys()).join(', ')}`)
      : fail(
        'verification-scripts',
        'Desktop production verification scripts are missing.',
        [
          ...(missingScripts.length > 0 ? [`Missing scripts: ${missingScripts.join(', ')}`] : []),
          ...(mismatchedScripts.length > 0 ? [`Mismatched scripts: ${mismatchedScripts.join(', ')}`] : []),
        ].join('; '),
        'Add the missing package.json scripts and keep release preflight/prod-check scripts pointed at their release gate entrypoints.',
      ),
  )

  checks.push(
    productionGateTs.includes('desktop:prod-check') &&
      productionGateTs.includes('releasePreflightRecords') &&
      productionGateTs.includes('desktop:verify-release') &&
      productionGateTs.includes('desktop:verify-published-release') &&
      productionGateTs.includes('buildProductionGateEvidence') &&
      productionGateTs.includes('validateProductionGateEvidence') &&
      productionGateTs.includes('production-gate-evidence.json') &&
      productionGateTs.includes('production-gate-verification') &&
      productionGateTs.includes("command === 'verify'") &&
      productionGateTs.includes('productionGateSteps')
      ? pass(
        'production-gate',
        'A final production release gate composes readiness, runner, artifact, published-release verification, and retained gate evidence.',
        'desktop:production-gate runs desktop:prod-check, non-destructive release preflight records, desktop:verify-release, desktop:verify-published-release, validates production gate evidence against published release evidence, and writes production-gate-evidence.json',
      )
      : fail(
        'production-gate',
        'Production release must have one final gate that verifies all release evidence before approval.',
        'desktop/scripts/production-gate.mjs is missing required release verification steps',
        'Keep desktop:production-gate running prod-check, non-destructive release preflight records, verify-release, verify-published-release, and retained production-gate evidence in order.',
      ),
  )

  checks.push(
    publishedReleaseEvidenceTs.includes('publicAssets') &&
      publishedReleaseEvidenceTs.includes('releaseDatabaseId') &&
      publishedReleaseEvidenceTs.includes('releaseUrl') &&
      publishedReleaseEvidenceTs.includes('invalid GitHub Release database id') &&
      publishedReleaseEvidenceTs.includes('invalid GitHub Release URL') &&
      publishedReleaseEvidenceTs.includes('sizeBytes: asset.size') &&
      publishedReleaseEvidenceTs.includes("asset.url.startsWith('https://')") &&
      publishedReleaseEvidenceTs.includes('isExpectedGitHubReleaseAssetUrl') &&
      publishedReleaseEvidenceTs.includes('/^\\d+$/.test(assetId)') &&
      publishedReleaseEvidenceTs.includes("parsed.search === ''") &&
      publishedReleaseEvidenceTs.includes("parsed.hash === ''") &&
      publishedReleaseEvidenceTs.includes('asset URL outside expected repository') &&
      publishedReleaseEvidenceTs.includes('invalid GitHub Release asset URL') &&
      publishedReleaseEvidenceTs.includes('duplicate public asset URLs') &&
      publishedReleaseEvidenceTs.includes('public asset metadata must match sorted asset names') &&
      publishedReleaseEvidenceTs.includes('public-release-evidence.json has invalid public asset details') &&
      publishedReleaseEvidenceTs.includes('production-gate-evidence.json') &&
      publishedReleaseEvidenceTs.includes('published-release-evidence.json') &&
      publishedReleaseEvidenceTs.includes('comparePublicReleaseEvidenceToPublishedReleaseEvidence') &&
      publishedReleaseEvidenceTs.includes('public asset size does not match published-release-evidence.json') &&
      publishedReleaseEvidenceTs.includes('is missing published verified asset metadata') &&
      publishedReleaseEvidenceTs.includes('releaseDatabaseId') &&
      publishedReleaseEvidenceTs.includes("'refName'") &&
      publishedReleaseEvidenceTs.includes("'refType'") &&
      publishedReleaseEvidenceTs.includes("'eventName'") &&
      publishedReleaseEvidenceTs.includes("'commit'")
      ? pass(
        'public-release-evidence',
        'Final public release evidence records asset metadata.',
        'desktop:write-public-release-evidence records stable GitHub Release identity plus sorted public asset names including production-gate-evidence.json plus size/URL metadata and CI source ref/event/commit metadata, and desktop:verify-public-release rejects missing, unsorted, duplicated, draft, prerelease, wrong-version, stale-source, missing-metadata, non-uploaded public assets, duplicate/cross-repository/non-canonical/malformed GitHub asset URLs, invalid release identity, production-gate source mismatches, published-release identity mismatches, or published verified asset size mismatches',
      )
      : fail(
        'public-release-evidence',
        'Public release evidence must prove final public asset metadata.',
        'desktop/scripts/published-release-evidence.mjs does not prove public Release id/URL, public asset size/URL metadata, same-repository canonical GitHub asset URLs with numeric ids, production-gate-evidence.json presence, published-release-evidence.json identity and verified asset size binding, and CI source ref/event/commit metadata',
        'Record and validate releaseDatabaseId, releaseUrl, and publicAssets in public-release-evidence.json after the Release is undrafted.',
      ),
  )

  checks.push(checkReleaseWorkflowAutomation(releaseWorkflow))

  checks.push(
    verifyReleaseTs.includes("'--no-install', 'asar'") &&
      verifyReleaseTs.includes('extract-file') &&
      verifyReleaseTs.includes('desktop/dist/renderer/index.html') &&
      verifyReleaseTs.includes('SHA256SUMS') &&
      verifyReleaseTs.includes('mac-dmg-checksum') &&
      verifyReleaseTs.includes('mac-zip-checksum') &&
      verifyReleaseTs.includes('release-evidence.json') &&
      verifyReleaseTs.includes('mac-release-evidence-identity') &&
      verifyReleaseTs.includes('schemaVersion') &&
      verifyReleaseTs.includes('generatedAt') &&
      verifyReleaseTs.includes('mac-release-evidence-purpose') &&
      verifyReleaseTs.includes('preflight-only') &&
      verifyReleaseTs.includes('mac-release-evidence-version') &&
      verifyReleaseTs.includes('mac-release-evidence-target') &&
      verifyReleaseTs.includes('mac-release-evidence-source') &&
      verifyReleaseTs.includes('source.ciRunUrl') &&
      verifyReleaseTs.includes('expectedRunPath') &&
      verifyReleaseTs.includes('expectedRunUrl') &&
      verifyReleaseTs.includes('https://github.com') &&
      verifyReleaseTs.includes('eventName') &&
      verifyReleaseTs.includes('refType') &&
      verifyReleaseTs.includes('expected=tag for push release') &&
      verifyReleaseTs.includes('mac-release-evidence-artifacts') &&
      verifyReleaseTs.includes("refName.startsWith('desktop-v')") &&
      verifyReleaseTs.includes('expected=desktop-v') &&
      verifyReleaseTs.includes("'appPath', 'dmgPath', 'zipPath'") &&
      verifyReleaseTs.includes('codesignIdentityCheck') &&
      verifyReleaseTs.includes('Authority=Developer ID Application:') &&
      verifyReleaseTs.includes(".startsWith('Authority=Developer ID Application:')") &&
      verifyReleaseTs.includes('Developer ID Certification Authority') &&
      verifyReleaseTs.includes('Apple Root CA') &&
      verifyReleaseTs.includes('missing Developer ID certificate chain authority') &&
      verifyReleaseTs.includes('authorityTeamId') &&
      verifyReleaseTs.includes("Authority team=${identity.authorityTeamId ?? '<missing>'}") &&
      verifyReleaseTs.includes('mac-signing-identity-consistency') &&
      verifyReleaseTs.includes('TeamIdentifier=') &&
      verifyReleaseTs.includes('mac-dmg-evidence-checksum') &&
      verifyReleaseTs.includes('mac-zip-evidence-checksum') &&
      verifyReleaseTs.includes('artifactDigests.${digestKey}.path') &&
      verifyReleaseTs.includes('mac-release-evidence-checksum-manifest') &&
      verifyReleaseTs.includes('checksumManifest.path=') &&
      verifyReleaseTs.includes('mac-release-evidence-toolchain') &&
      verifyReleaseTs.includes('toolchain.lockfile') &&
      verifyReleaseTs.includes('expectedLockfilePath') &&
      verifyReleaseTs.includes('toolchain.lockfile.path=') &&
      verifyReleaseTs.includes('bun.lock') &&
      verifyReleaseTs.includes('mac-release-evidence-tooling') &&
      verifyReleaseTs.includes('requiredReleaseToolingPaths') &&
      verifyReleaseTs.includes('releaseTooling') &&
      verifyReleaseTs.includes('mac-release-evidence-credentials') &&
      verifyReleaseTs.includes('allowedCredentialKeys') &&
      verifyReleaseTs.includes('signingSourcesByStrategy') &&
      verifyReleaseTs.includes('notarizationSourcesByStrategy') &&
      verifyReleaseTs.includes('releaseCredentials.${scope}.${key}') &&
      verifyReleaseTs.includes('mac-release-evidence-sensitive-content') &&
      verifyReleaseTs.includes('mac-release-notes-sensitive-content') &&
      verifyReleaseTs.includes('sensitiveContentCheck') &&
      verifyReleaseTs.includes('privateKey') &&
      verifyReleaseTs.includes('*password') &&
      verifyReleaseTs.includes('placeholder certificate material') &&
      verifyReleaseTs.includes('mac-release-evidence-verification-checks') &&
      verifyReleaseTs.includes('staleIds') &&
      verifyReleaseTs.includes('recorded?.status !== current.status') &&
      verifyReleaseTs.includes('recorded?.message !== current.message') &&
      verifyReleaseTs.includes('recorded?.evidence !== current.evidence') &&
      verifyReleaseTs.includes('mac-release-evidence-pipeline-steps') &&
      verifyReleaseTs.includes('release-ux-validation') &&
      verifyReleaseTs.includes('mac-release-evidence-smoke-summary') &&
      verifyReleaseTs.includes('missing smoke summary flags') &&
      verifyReleaseTs.includes('terminalMode') &&
      verifyReleaseTs.includes('mac-release-evidence-ux-screenshots') &&
      verifyReleaseTs.includes('uxScreenshotsDir') &&
      verifyReleaseTs.includes('expected prefix=') &&
      verifyReleaseTs.includes('expected directory=') &&
      verifyReleaseTs.includes('requiredSmokeScreenshots') &&
      verifyReleaseTs.includes('missing required UX screenshots') &&
      verifyReleaseTs.includes('relative(uxScreenshotsDir') &&
      verifyReleaseTs.includes('hasPngSignature') &&
      verifyReleaseTs.includes('invalid PNG') &&
      verifyReleaseTs.includes('too small PNG') &&
      verifyReleaseTs.includes('minimumScreenshotWidth') &&
      verifyReleaseTs.includes('minimumScreenshotHeight') &&
      verifyReleaseTs.includes('minimumScreenshotBytes') &&
      verifyReleaseTs.includes('mac-release-evidence-ux-validation') &&
      verifyReleaseTs.includes('uxValidationEvidence.path=') &&
      verifyReleaseTs.includes('uxValidationEvidence') &&
      verifyReleaseTs.includes('uxValidationSummary') &&
      verifyReleaseTs.includes('expectedVersion: evidence?.releaseVersion') &&
      verifyReleaseTs.includes('expectedCommit: evidence?.commit') &&
      verifyReleaseTs.includes('summarizeUxValidationEvidenceContents') &&
      uxValidationTs.includes('requiredUxValidationManualTasks') &&
      uxValidationTs.includes('missingRequiredManualTasks') &&
      uxValidationTs.includes('does not match releaseVersion') &&
      uxValidationTs.includes('does not match release commit') &&
      uxValidationTs.includes('UX validation evidence must include required manual tasks') &&
      uxValidationTs.includes('UX validation evidence must record representative user validation') &&
      verifyReleaseTs.includes('representativeUserValidation') &&
      verifyReleaseTs.includes('mac-release-notes-evidence') &&
      verifyReleaseTs.includes('releaseNotesEvidence.path=') &&
      verifyReleaseTs.includes('releaseNotesEvidence') &&
      verifyReleaseTs.includes('## Artifact Verification') &&
      verifyReleaseTs.includes('## UX Validation') &&
      verifyReleaseTs.includes('releaseNotesEvidenceDetailCheckIds') &&
      verifyReleaseTs.includes('releaseNotesEvidenceDetail') &&
      verifyReleaseTs.includes('releaseNotesUxScreenshotLine') &&
      verifyReleaseTs.includes('Evidence:') &&
      verifyReleaseTs.includes('releaseCredentials') &&
      verifyReleaseTs.includes('Signing:') &&
      verifyReleaseTs.includes('Notarization:') &&
      verifyReleaseTs.includes('Ref type:') &&
      verifyReleaseTs.includes('Event:') &&
      verifyReleaseTs.includes('Generated at:') &&
      verifyReleaseTs.includes('Toolchain:') &&
      verifyReleaseTs.includes('Lockfile:') &&
      verifyReleaseTs.includes('Release tooling:') &&
      verifyReleaseTs.includes('## Release Tooling') &&
      verifyReleaseTs.includes('step.durationMs') &&
      verifyReleaseTs.includes('requiredReleaseEvidenceArtifactCheckIds') &&
      verifyReleaseTs.includes('requiredReleaseEvidenceStepIds') &&
      verifyReleaseTs.includes('source-check') &&
      verifyReleaseTs.includes('verify-release') &&
      verifyReleaseTs.includes('final-verify-release') &&
      verifyReleaseTs.includes('DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_VERIFY_STEP') &&
      verifyReleaseTs.includes('DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_FINAL_VERIFY_STEP') &&
      verifyReleaseTs.includes('allowMissingVerifyReleaseStep') &&
      verifyReleaseTs.includes('requiredReleaseEvidenceStepCommands') &&
      verifyReleaseTs.includes('commandMismatchIds') &&
      verifyReleaseTs.includes('requiredReleaseEvidenceStepEnv') &&
      verifyReleaseTs.includes('DESKTOP_SMOKE_SCREENSHOT_DIR') &&
      verifyReleaseTs.includes('out of order') &&
      verifyReleaseTs.includes("requiredStepIds.join(' -> ')") &&
      verifyReleaseTs.includes('timingMismatches') &&
      verifyReleaseTs.includes('isoTimestampValue') &&
      verifyReleaseTs.includes('durationMs=${durationMs') &&
      verifyReleaseTs.includes('contradictoryPassIds') &&
      verifyReleaseTs.includes("step?.status === 'pass'") &&
      verifyReleaseTs.includes('failures=${failureCount}') &&
      verifyReleaseTs.includes("?.status !== 'pass'") &&
      verifyReleaseTs.includes('skipReleaseEvidenceChecks') &&
      packageJson.devDependencies?.['@electron/asar']
      ? pass(
        'release-artifact-inspection',
        'Release artifact inspection uses local deterministic tooling.',
        'desktop:verify-release inspects app.asar with explicit @electron/asar via npx --no-install, verifies Electron bundle contents, SHA256SUMS, leaf Developer ID Application code signing identity with required authority team, app/DMG signing TeamIdentifier consistency, release evidence identity and purpose metadata, target platform/architecture, artifact paths, digest paths and checksums, checksum manifest path and metadata, internally consistent GitHub HTTPS CI source metadata with event/ref type, desktop-v tag/version matching, toolchain lockfile path and metadata, release tooling path and metadata, mandatory redacted credential strategy/source combinations without raw credential fields, raw secret sensitive-content checks for release evidence and notes including JSON privateKey/password fields and placeholder certificate material, passed artifact verification check coverage with stale check detail detection, ordered passed release preflight and pipeline step command/env/timing coverage including verify-release and final-verify-release proof, rejects pass pipeline steps with non-zero exit codes or failure records, required Electron smoke summary feature flags and PTY terminal mode, UX screenshot path, directory, required screenshot names, metadata, PNG signature, and reviewable screenshot dimensions, completed UX validation evidence path, metadata, release version/commit match, required manual tasks, and approval summary, release notes evidence path and metadata including generation timestamp, event/ref type, credential strategy, artifact verification summary with signing/notarization evidence details, pipeline step summary, smoke summary, release tooling summary, UX validation summary, UX screenshot summaries, and Toolchain/Lockfile summary, and exposes a generation-safe evidence skip path',
      )
      : fail(
        'release-artifact-inspection',
        'Release artifact inspection must not download tools at verification time.',
        'Could not prove desktop:verify-release uses explicit @electron/asar with npx --no-install, verifies SHA256SUMS plus leaf Developer ID Application code signing identity with required authority team, app/DMG signing TeamIdentifier consistency, release evidence identity and purpose metadata, target platform/architecture, artifact paths and checksums, checksum manifest path and metadata, internally consistent GitHub HTTPS CI source metadata with event/ref type, desktop-v tag/version matching, toolchain lockfile path and metadata, release tooling path and metadata, mandatory redacted credential strategy/source combinations without raw credential fields, raw secret sensitive-content checks for release evidence and notes including JSON privateKey/password fields and placeholder certificate material, passed artifact verification check coverage with stale check detail detection, ordered passed release preflight and pipeline step command/env/timing coverage including verify-release and final-verify-release proof, pass pipeline step contradiction detection, required Electron smoke summary feature flags and PTY terminal mode, UX screenshot path, directory, required screenshot names, metadata, PNG signature, and reviewable screenshot dimensions, completed UX validation evidence path, metadata, required manual tasks, and approval summary, release notes evidence path and metadata including generation timestamp, event/ref type, credential strategy, artifact verification summary with signing/notarization evidence details, pipeline step summary, smoke summary, release tooling summary, UX validation summary, UX screenshot summaries, and Toolchain/Lockfile summary, and supports generation-safe evidence checks',
        'Declare @electron/asar as a devDependency and use only locally installed, lockfile-managed tools when verifying release artifacts.',
      ),
  )

  checks.push(
    releaseCiTs.includes('buildReleaseEvidence') &&
      releaseCiTs.includes('release-evidence.json') &&
      releaseCiTs.includes('sha256') &&
      releaseCiTs.includes('sizeBytes') &&
      releaseCiTs.includes('artifactVerificationChecks') &&
      releaseCiTs.includes('artifactVerificationLines') &&
      releaseCiTs.includes('releaseNotesEvidenceDetailCheckIds') &&
      releaseCiTs.includes('releaseNotesArtifactVerificationLines') &&
      releaseCiTs.includes('Evidence:') &&
      releaseCiTs.includes('releaseSourceMetadata') &&
      releaseCiTs.includes('GITHUB_EVENT_NAME') &&
      releaseCiTs.includes('GITHUB_REF_TYPE') &&
      releaseCiTs.includes('describeReleaseToolchain') &&
      releaseCiTs.includes('toolchain') &&
      releaseCiTs.includes('bun.lock') &&
      releaseCiTs.includes('describeReleaseTooling') &&
      releaseCiTs.includes('releaseTooling') &&
      releaseCiTs.includes('desktop/scripts/release-ci.mjs') &&
      releaseCiTs.includes('desktop/scripts/verify-release-artifacts.mjs') &&
      releaseCiTs.includes('.github/workflows/desktop-release.yml') &&
      releaseCiTs.includes('releasePreflightRecords') &&
      releaseCiTs.includes('releasePreflightRecordsForPhase') &&
      releaseCiTs.includes('preflight:') &&
      releaseCiTs.includes('preflightBuildOptions') &&
      releaseCiTs.includes("evidencePurpose: 'preflight-only'") &&
      releaseCiTs.includes('artifactDigests: {}') &&
      releaseCiTs.includes('artifactVerificationChecks: []') &&
      releaseCiTs.includes('cleanReleaseOutputDirectory') &&
      releaseCiTs.includes("entry.endsWith('.dmg')") &&
      releaseCiTs.includes("entry.endsWith('.zip')") &&
      releaseCiTs.includes("entry.endsWith('.blockmap')") &&
      releaseCiTs.includes("entry.startsWith('mac-')") &&
      releaseCiTs.includes('rmSync(checksumPath)') &&
      releaseCiTs.includes('releaseCredentialMetadata') &&
      releaseCiTs.includes('releaseCredentials') &&
      releaseCiTs.includes("'openssl'") &&
      releaseCiTs.includes("'pkcs12'") &&
      releaseCiTs.includes("'pkey'") &&
      releaseCiTs.includes('env:CSC_KEY_PASSWORD') &&
      releaseCiTs.includes('CSC_LINK certificate bundle could not be opened') &&
      releaseCiTs.includes('APPLE_API_KEY private key could not be opened') &&
      releaseCiTs.includes('validateUxValidationEvidenceFile') &&
      releaseCiTs.includes('release-ux-validation') &&
      releaseCiTs.includes('failures') &&
      releaseCiTs.includes('buildReleaseChecksumManifest') &&
      releaseCiTs.includes('checksumManifest') &&
      releaseCiTs.includes('uxScreenshots') &&
      releaseCiTs.includes('extractSmokeSummaryFromOutput') &&
      releaseCiTs.includes('summarizeSmokeSummary') &&
      releaseCiTs.includes('missingSmokeSummaryFlags') &&
      releaseCiTs.includes('smokeSummary') &&
      releaseCiTs.includes('terminalMode') &&
      releaseCiTs.includes('uxValidationEvidence') &&
      releaseCiTs.includes('uxValidationSummary') &&
      releaseCiTs.includes('representativeUserValidation') &&
      releaseCiTs.includes('summarizeUxValidationEvidenceContents') &&
      releaseCiTs.includes('## UX Validation') &&
      releaseCiTs.includes('buildReleaseNotesEvidence') &&
      releaseCiTs.includes('releaseNotesEvidence') &&
      releaseCiTs.includes('release-notes-evidence.md') &&
      releaseCiTs.includes('skipReleaseEvidenceChecks: true') &&
      releaseCiTs.includes('releaseEvidenceVerifyOptions') &&
      releaseCiTs.includes('env: step.env') &&
      releaseCiTs.includes('SHA256SUMS') &&
      releaseCiTs.includes('source-check') &&
      releaseCiTs.includes("args: ['run', 'check']") &&
      releaseCiTs.includes('desktop:check') &&
      releaseCiTs.includes('final-verify-release') &&
      releaseCiTs.includes('DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_VERIFY_STEP') &&
      releaseCiTs.includes('DESKTOP_VERIFY_RELEASE_ALLOW_MISSING_FINAL_VERIFY_STEP') &&
      releaseWorkflow.includes('desktop/release/release-evidence.json') &&
      releaseWorkflow.includes('desktop/release/release-notes-evidence.md') &&
      releaseWorkflow.includes('desktop/release/ux-validation-evidence.md') &&
      releaseWorkflow.includes('desktop/release/SHA256SUMS') &&
      releaseWorkflow.includes('retention-days')
      ? pass(
        'release-evidence',
        'Release CI produces auditable release evidence.',
        'desktop:release-ci records environment, runner, UX validation, and pipeline failures, validates CSC_LINK certificate bundles with openssl pkcs12 without exposing CSC_KEY_PASSWORD in command arguments, validates APPLE_API_KEY private keys with openssl pkey, cleans stale release output artifacts before writing current evidence, marks and isolates preflight-only evidence from stale release artifacts, runs bun run check and desktop:check, writes release-evidence.json with source metadata including GitHub event/ref type, redacted credential strategy metadata, artifact sha256/size metadata, toolchain and bun.lock metadata, release tooling metadata, checksum manifest metadata, UX screenshot metadata, UX validation evidence metadata and approval summary, release notes evidence metadata, writes SHA256SUMS and release-notes-evidence.md with release tooling and UX validation summaries, validator/date, representative user/date, observed representative user validation, and approver/date, records artifact verification without stale release evidence or checksum manifest self-checks, records verify-release proof, reruns final artifact verification against the final evidence, and the release workflow uploads retained core evidence plus available supplemental diagnostics separately from success-only signed artifacts',
      )
      : fail(
        'release-evidence',
        'Production releases need archived evidence for release review and rollback.',
        'Could not prove release-evidence.json, release-notes-evidence.md, ux-validation-evidence.md, and SHA256SUMS are generated with environment, runner, UX validation, full TypeScript checking, CSC_LINK openssl pkcs12 validation, APPLE_API_KEY openssl pkey validation, and pipeline preflight records, stale release output cleanup, failure reasons, redacted credential strategy metadata, marked preflight-only artifact isolation, artifact digests, toolchain and bun.lock metadata, release tooling metadata, checksum manifest metadata, UX screenshot metadata, UX validation evidence metadata and approval summary, release notes evidence metadata with release tooling and UX validation summaries, validator/date, representative user/date, and approver/date, generation-safe verification checks isolated from stale evidence/manifests, verify-release proof, final evidence verification, and uploaded as a retained diagnostics artifact',
        'Generate a redacted release evidence JSON file from release CI and upload it with diagnostics evidence.',
      ),
  )

  checks.push(
    releaseCiTs.includes('DESKTOP_SMOKE_SCREENSHOT_DIR') &&
      smokePackagedTs.includes('DESKTOP_SMOKE_SCREENSHOT_DIR: screenshotDir') &&
      smokePackagedTs.includes('requiredSmokeScreenshots') &&
      smokePackagedTs.includes('chat-streaming.png') &&
      smokePackagedTs.includes('settings-narrow.png') &&
      smokePackagedTs.includes('agents-selected.png') &&
      smokePackagedTs.includes('teams.png') &&
      smokePackagedTs.includes('unsaved-files-pane-switch-dialog.png') &&
      smokePackagedTs.includes('unsaved-diff-pane-switch-dialog.png') &&
      smokePackagedTs.includes('command-palette.png') &&
      smokePackagedTs.includes('composer-actions.png') &&
      smokePackagedTs.includes('terminal.png') &&
      smokePackagedTs.includes('Invalid PNG') &&
      smokePackagedTs.includes('Too small PNG') &&
      smokePackagedTs.includes('minimumScreenshotWidth') &&
      smokePackagedTs.includes('minimumScreenshotHeight') &&
      smokePackagedTs.includes('minimumScreenshotBytes') &&
      smokePackagedTs.includes('desktop/release/ux-screenshots') &&
      releaseCiTs.includes('ux-screenshots') &&
      releaseWorkflow.includes('desktop/release/ux-screenshots/**/*.png')
      ? pass(
        'release-ux-screenshots',
        'Release CI archives packaged desktop UX screenshots.',
        'desktop:smoke-packaged defaults screenshots to desktop/release/ux-screenshots and fails if required PNG screenshots are missing, invalid, or too small for visual review, including streaming chat, responsive settings, MCP management, Skills management, Command Palette, selected-agent actions, scheduled tasks, teams management, composer actions, permission review, Files, Editor, Diff, unsaved editor guards, terminal, and preview; desktop:release-ci captures packaged smoke screenshots there and the workflow uploads them',
      )
      : fail(
        'release-ux-screenshots',
        'Production releases need archived UX screenshots for visual review.',
        'Could not prove packaged smoke screenshots are generated and uploaded',
        'Set DESKTOP_SMOKE_SCREENSHOT_DIR for packaged smoke and upload the screenshots with release artifacts.',
      ),
  )

  const requirementsAuditPath = 'docs/desktop-user-requirements-audit.md'
  const mvpDocPath = 'docs/desktop-mvp.md'
  const requirementsAudit = existsSync(join(root, requirementsAuditPath))
    ? await readText(requirementsAuditPath)
    : ''
  const mvpDoc = existsSync(join(root, mvpDocPath))
    ? await readText(mvpDocPath)
    : ''
  const readinessDocEvidence = `${requirementsAudit}\n${mvpDoc}`
  const requiredReadinessDocSnippets = [
    'Settings stays fixed in the left rail footer when sessions collapse and uses grouped Codex-style settings navigation.',
    'settingsFirstClassPage',
    'settingsInLeftFooter',
    'groupedSettingsNavigation',
    'settingsSidebarNavigation',
    'settingsSearchFiltering',
    'settingsSectionRestored',
    'selectedSettingsDetailStateRestored',
    'settingsMcpSkillsInlineSections',
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
    'selectedAgentStateRestored',
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
    'teamDeleteFeedback',
    'rapidTeamDeleteGuard',
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
    'MCP management supports add/update/remove for user and project `.mcp.json`',
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
    'projectMcpInspect',
    'projectMcpApprovalLifecycle',
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
    'rapidDiagnosticsExportGuard',
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
    'runtimeFailureVisible',
    'deepLinkedSession',
    'rapidCancelGuard',
    'rapidCloseSessionGuard',
    'workspaceRefreshFeedback',
    'staleSessionStatusCleared',
    'chatCopyFeedback',
    'chatMarkdownExternalLink',
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
  ]
  const missingReadinessDocSnippets = requiredReadinessDocSnippets
    .filter(snippet => !readinessDocEvidence.includes(snippet))
  checks.push(
    missingReadinessDocSnippets.length === 0
      ? pass(
        'readiness-docs',
        'Desktop requirements and MVP docs prove the requested production UX scope.',
        'docs cover grouped Codex-style Settings, first-class Agents/Teams/Tasks, Skills/MCP management, and Codex-style command palette/composer interactions with smoke evidence fields',
      )
      : fail(
        'readiness-docs',
        'Production readiness requires current requirements and implementation docs for the requested desktop scope.',
        `Missing readiness doc evidence: ${missingReadinessDocSnippets.join(', ')}`,
        'Update desktop requirements and MVP docs with the grouped Settings, first-class lifecycle pages, Skills/MCP management, and Codex-style interaction evidence.',
      ),
  )

  const releaseNotesTemplate = existsSync(join(root, 'docs/desktop-release-notes-template.md'))
    ? await readText('docs/desktop-release-notes-template.md')
    : ''
  const releaseRunbook = existsSync(join(root, 'docs/desktop-release-runbook.md'))
    ? await readText('docs/desktop-release-runbook.md')
    : ''
  const requiredReleaseNotesSnippets = [
    'bun run check',
    'bun run desktop:release-preflight',
    'bun run desktop:prod-check',
    'bun run desktop:production-gate',
    'production-gate-evidence.json',
    'bun run desktop:verify-production-gate-evidence',
    'bun run desktop:verify-release',
    'published-release-evidence.json',
    'public-release-evidence.json',
    'public asset sizes/URLs',
    'draft GitHub Release asset verification',
    'Final public Release verification',
    'bun run desktop:write-published-release-evidence',
    'bun run desktop:verify-published-release',
    'public-release-input/published-evidence/published-release-evidence.json',
    '--published-evidence',
    'Known Limitations',
    'manual tasks pass',
    'blocking issues none',
    'known limitations accepted',
    'native Help menu support actions',
    'Help menu Command Palette',
    'Help menu Refresh Settings',
    'Help menu Export Diagnostics',
    'Support intake channel',
    'Rollback Procedure',
    'Release Approval',
  ]
  const requiredReleaseRunbookSnippets = [
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
    'public asset metadata',
    'bun run desktop:write-published-release-evidence',
    'bun run desktop:verify-published-release',
    'public-release-input/published-evidence/published-release-evidence.json',
    '--published-evidence',
    'Failure Handling',
  ]
  const missingReleaseNotesSnippets = requiredReleaseNotesSnippets
    .filter(snippet => !releaseNotesTemplate.includes(snippet))
  const missingReleaseRunbookSnippets = requiredReleaseRunbookSnippets
    .filter(snippet => !releaseRunbook.includes(snippet))
  checks.push(
    releaseNotesTemplate && missingReleaseNotesSnippets.length === 0 &&
      releaseRunbook && missingReleaseRunbookSnippets.length === 0
      ? pass(
        'release-support-docs',
        'Release notes, UX approval gates, support, rollback template, and release runbook exist.',
        'docs/desktop-release-notes-template.md covers source check, release preflight, production readiness, artifact verification, manual task pass gates, native Help menu support actions, no blocking issues, accepted known limitations, observed representative user validation, support intake, rollback, and approvals; docs/desktop-release-runbook.md covers release inputs, protected signing/notarization secrets, observed representative user validation, native Help menu support actions, preflight commands, release workflow, required evidence, post-publish evidence verification, and failure handling',
      )
      : fail(
        'release-support-docs',
        'Production releases need release notes, runbook, known limitations, support, and rollback documentation.',
        [
          releaseNotesTemplate
            ? missingReleaseNotesSnippets.length > 0
              ? `docs/desktop-release-notes-template.md missing: ${missingReleaseNotesSnippets.join(', ')}`
              : ''
            : 'docs/desktop-release-notes-template.md is missing',
          releaseRunbook
            ? missingReleaseRunbookSnippets.length > 0
              ? `docs/desktop-release-runbook.md missing: ${missingReleaseRunbookSnippets.join(', ')}`
              : ''
            : 'docs/desktop-release-runbook.md is missing',
        ].filter(Boolean).join('; '),
        'Add desktop release documentation with verification evidence, native Help menu support actions, support intake, rollback steps, signing/notarization inputs, required evidence, post-publish verification, and failure handling.',
      ),
  )

  const uxChecklist = existsSync(join(root, 'docs/desktop-ux-validation-checklist.md'))
    ? await readText('docs/desktop-ux-validation-checklist.md')
    : ''
  const requiredUxChecklistSnippets = [
    'Manual Task Script',
    'Validator: `[name, role, YYYY-MM-DD]`',
    'Representative user',
    'Representative user validation: `[observed, facilitator, YYYY-MM-DD]`',
    'UX release approval',
    'Every screenshot row must be `pass` or `n/a` before release approval.',
    'Every required manual task row below must be present and `pass` before release',
    'Use Command Palette and native View menu navigation.',
    'Use native Help menu support actions.',
    'Help menu Command Palette opens the searchable command palette.',
    'Help menu Refresh Settings reports refreshed configuration.',
    'Help menu Export Diagnostics writes a redacted bundle.',
    'Blocking issues filed: `[none]`',
    'Known limitations accepted: `[yes, approver]`',
  ]
  const missingUxChecklistSnippets = requiredUxChecklistSnippets
    .filter(snippet => !uxChecklist.includes(snippet))
  checks.push(
    uxChecklist && missingUxChecklistSnippets.length === 0
      ? pass(
        'ux-validation-checklist',
        'Manual UX validation checklist is available for release approval.',
        'docs/desktop-ux-validation-checklist.md covers representative user, manual task script, native Help support actions, screenshot/manual pass requirements, no blocking issues, accepted known limitations, and approval',
      )
      : fail(
        'ux-validation-checklist',
        'Production releases need a manual UX validation checklist.',
        uxChecklist
          ? `docs/desktop-ux-validation-checklist.md missing: ${missingUxChecklistSnippets.join(', ')}`
          : 'docs/desktop-ux-validation-checklist.md is missing',
        'Add a checklist covering screenshots, representative user validation, core tasks, and release approval.',
      ),
  )

  const failures = checks.filter(check => check.status === 'fail')
  for (const check of checks) {
    const marker = check.status === 'pass' ? 'PASS' : 'FAIL'
    console.log(`${marker} ${check.id}: ${check.message}`)
    console.log(`  evidence: ${check.evidence}`)
    if (check.nextAction) console.log(`  next: ${check.nextAction}`)
  }
  console.log('')
  console.log(`${checks.length - failures.length}/${checks.length} production readiness checks passed.`)

  if (failures.length > 0) {
    console.log('Production release is blocked.')
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exit(1)
  })
}
