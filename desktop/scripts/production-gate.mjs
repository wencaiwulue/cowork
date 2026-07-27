import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  releasePreflightFailureHeading,
  releasePreflightRecords,
} from './release-ci.mjs'
import {
  compareReleaseEvidenceSource,
  validatePublishedReleaseEvidence,
} from './published-release-evidence.mjs'

const productName = 'Claude Code Desktop'
const evidenceKind = 'production-gate-verification'
const defaultEvidencePath = 'desktop/release/production-gate-evidence.json'

export const productionGateSteps = [
  {
    id: 'prod-check',
    command: 'bun',
    args: ['run', 'desktop:prod-check'],
  },
  {
    id: 'release-preflight',
    kind: 'preflight',
  },
  {
    id: 'verify-release',
    command: 'bun',
    args: ['run', 'desktop:verify-release'],
  },
  {
    id: 'verify-published-release',
    command: 'bun',
    args: ['run', 'desktop:verify-published-release'],
  },
]

function ciRunUrl(env) {
  if (env.EXPECTED_RUN_URL) return env.EXPECTED_RUN_URL
  if (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID && env.GITHUB_RUN_ATTEMPT) {
    return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`
  }
  return undefined
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

export function buildProductionGateEvidence(options = {}) {
  const {
    generatedAt = new Date().toISOString(),
    env = process.env,
    status,
    steps,
    failure,
  } = options

  return {
    schemaVersion: 1,
    product: productName,
    evidenceKind,
    generatedAt,
    releaseVersion: env.EXPECTED_RELEASE_VERSION || env.DESKTOP_RELEASE_VERSION,
    repository: env.EXPECTED_REPOSITORY || env.GITHUB_REPOSITORY,
    refName: env.EXPECTED_REF_NAME || env.GITHUB_REF_NAME,
    refType: env.EXPECTED_REF_TYPE || env.GITHUB_REF_TYPE,
    eventName: env.EXPECTED_EVENT_NAME || env.GITHUB_EVENT_NAME,
    ciRunId: env.EXPECTED_RUN_ID || env.GITHUB_RUN_ID,
    ciRunAttempt: env.EXPECTED_RUN_ATTEMPT || env.GITHUB_RUN_ATTEMPT,
    ciRunUrl: ciRunUrl(env),
    commit: env.EXPECTED_COMMIT || env.GITHUB_SHA,
    status,
    ...(failure ? { failure } : {}),
    steps,
  }
}

export function validateProductionGateEvidence(evidence, options = {}) {
  const failures = []
  if (evidence?.schemaVersion !== 1 || evidence?.product !== productName || evidence?.evidenceKind !== evidenceKind) {
    failures.push('production-gate-evidence.json has invalid identity metadata')
  }
  if (Number.isNaN(Date.parse(evidence?.generatedAt))) {
    failures.push('production-gate-evidence.json has invalid generatedAt metadata')
  }
  if (!evidence?.releaseVersion || typeof evidence.releaseVersion !== 'string') {
    failures.push('production-gate-evidence.json has invalid release metadata')
  }
  for (const field of ['repository', 'refName', 'refType', 'eventName', 'ciRunId', 'ciRunAttempt', 'ciRunUrl', 'commit']) {
    if (!evidence?.[field] || typeof evidence[field] !== 'string') {
      failures.push(`production-gate-evidence.json has invalid CI source metadata: ${field}`)
    }
  }
  if (
    typeof evidence?.releaseVersion === 'string' &&
    evidence.releaseVersion &&
    typeof evidence?.refName === 'string' &&
    (evidence.eventName === 'push' || evidence.refType === 'tag')
  ) {
    const expectedRefName = `desktop-v${evidence.releaseVersion}`
    if (evidence.refName !== expectedRefName) {
      failures.push('production-gate-evidence.json has invalid CI source metadata: refName')
    }
  }
  if (evidence?.eventName === 'push' && evidence.refType !== 'tag') {
    failures.push('production-gate-evidence.json has invalid CI source metadata: refType')
  }
  if (typeof evidence?.eventName === 'string' && evidence.eventName !== 'push' && evidence.eventName !== 'workflow_dispatch') {
    failures.push('production-gate-evidence.json has invalid CI source metadata: eventName')
  }
  if (typeof evidence?.ciRunUrl === 'string' && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+\/attempts\/\d+$/.test(evidence.ciRunUrl)) {
    failures.push('production-gate-evidence.json has invalid CI source metadata: ciRunUrl')
  }
  if (evidence?.status !== 'pass' && evidence?.status !== 'fail') {
    failures.push('production-gate-evidence.json has invalid status')
  }
  if (evidence?.status === 'pass' && evidence.failure) {
    failures.push('production-gate-evidence.json pass gates must not record failure')
  }
  if (evidence?.status === 'fail' && (!evidence.failure || typeof evidence.failure !== 'string')) {
    failures.push('production-gate-evidence.json failed gates must record failure')
  }
  if (!Array.isArray(evidence?.steps) || evidence.steps.length === 0) {
    failures.push('production-gate-evidence.json has invalid step records')
    return failures
  }

  const expectedOrder = productionGateSteps.map(step => step.id)
  const stepIds = evidence.steps.map(step => step?.id)
  const isPrefix = stepIds.every((id, index) => id === expectedOrder[index])
  if (!isPrefix) {
    failures.push('production-gate-evidence.json step order is invalid')
  }
  if (evidence.status === 'pass' && stepIds.length !== expectedOrder.length) {
    failures.push('production-gate-evidence.json pass gates must include every step')
  }

  let failedStepCount = 0
  let firstFailedStepIndex = -1
  for (const [index, step] of evidence.steps.entries()) {
    if (!step || typeof step.id !== 'string' || (step.status !== 'pass' && step.status !== 'fail')) {
      failures.push('production-gate-evidence.json has invalid step records')
      break
    }
    const expectedStep = productionGateSteps[index]
    if (expectedStep?.kind === 'preflight') {
      if (!Array.isArray(step.records)) {
        failures.push('production-gate-evidence.json preflight step must record preflight records')
      } else {
        const hasFailedRecord = step.records.some(record => record?.status === 'fail')
        if (step.status === 'pass' && hasFailedRecord) {
          failures.push(`production-gate-evidence.json has invalid pass preflight records`)
        }
        if (step.status === 'fail' && !hasFailedRecord) {
          failures.push(`production-gate-evidence.json has invalid fail preflight records`)
        }
      }
    } else {
      if (step.command !== expectedStep?.command || JSON.stringify(step.args) !== JSON.stringify(expectedStep?.args)) {
        failures.push(`production-gate-evidence.json has invalid command for ${step.id}`)
      }
      const hasExitCode = Number.isInteger(step.exitCode) && step.exitCode >= 0
      const hasStartError = step.status === 'fail' && typeof step.error === 'string' && step.error.length > 0
      if (!hasExitCode && !hasStartError) {
        failures.push(`production-gate-evidence.json has invalid exit code for ${step.id}`)
      }
      if (step.status === 'pass' && (step.exitCode !== 0 || step.error)) {
        failures.push(`production-gate-evidence.json has invalid pass exit code for ${step.id}`)
      }
      if (step.status === 'fail' && hasExitCode && step.exitCode === 0) {
        failures.push(`production-gate-evidence.json has invalid fail exit code for ${step.id}`)
      }
    }
    if (step.status === 'fail') {
      if (firstFailedStepIndex === -1) {
        firstFailedStepIndex = index
      }
      failedStepCount += 1
    }
  }

  if (evidence.status === 'pass' && failedStepCount > 0) {
    failures.push('production-gate-evidence.json status is pass but includes failed steps')
  }
  if (evidence.status === 'fail' && failedStepCount === 0) {
    failures.push('production-gate-evidence.json status is fail but no failed step is recorded')
  }
  if (firstFailedStepIndex >= 0 && firstFailedStepIndex < evidence.steps.length - 1) {
    failures.push('production-gate-evidence.json failed gates must stop at the first failed step')
  }
  if (options.publishedReleaseEvidence) {
    failures.push(...validatePublishedReleaseEvidence(options.publishedReleaseEvidence, {
      releaseVersion: evidence.releaseVersion,
      repository: evidence.repository,
      refName: evidence.refName,
      refType: evidence.refType,
      eventName: evidence.eventName,
      commit: evidence.commit,
      ciRunId: evidence.ciRunId,
      ciRunAttempt: evidence.ciRunAttempt,
      ciRunUrl: evidence.ciRunUrl,
    }))
    failures.push(...compareReleaseEvidenceSource(
      evidence,
      'production-gate-evidence.json',
      options.publishedReleaseEvidence,
      'published-release-evidence.json',
    ))
  }

  return failures
}

function writeProductionGateEvidence(path, evidence) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`)
}

export function runProductionGate(options = {}) {
  const {
    run = spawnSync,
    stdio = 'inherit',
    env = process.env,
    preflightRecords = () => releasePreflightRecords({ env }),
    now = () => new Date().toISOString(),
    evidencePath = defaultEvidencePath,
    writeEvidence = evidence => writeProductionGateEvidence(evidencePath, evidence),
  } = options
  const stepRecords = []

  const finish = (status, exitCode, failure) => {
    const evidence = buildProductionGateEvidence({
      generatedAt: now(),
      env,
      status,
      failure,
      steps: stepRecords,
    })
    const validationFailures = validateProductionGateEvidence(evidence)
    if (validationFailures.length > 0) {
      for (const validationFailure of validationFailures) {
        console.error(validationFailure)
      }
      return 1
    }
    try {
      writeEvidence(evidence)
    } catch (error) {
      console.error(`production-gate: failed to write evidence: ${error.message}`)
      return 1
    }
    return exitCode
  }

  for (const step of productionGateSteps) {
    if (step.kind === 'preflight') {
      console.error('production-gate: running release-preflight: non-destructive release preflight check')
      const records = preflightRecords()
      const failedPreflight = records.find(record => record.status === 'fail')
      if (failedPreflight) {
        stepRecords.push({
          id: step.id,
          status: 'fail',
          records,
        })
        console.error(releasePreflightFailureHeading(failedPreflight))
        for (const failure of failedPreflight.failures ?? []) console.error(`- ${failure}`)
        return finish('fail', 1, `${step.id} failed`)
      }
      stepRecords.push({
        id: step.id,
        status: 'pass',
        records,
      })
      continue
    }

    console.error(`production-gate: running ${step.id}: ${step.command} ${step.args.join(' ')}`)
    const result = run(step.command, step.args, {
      env,
      shell: false,
      stdio,
    })
    if (result.error) {
      stepRecords.push({
        id: step.id,
        status: 'fail',
        command: step.command,
        args: step.args,
        error: result.error.message,
      })
      console.error(`production-gate: ${step.id} failed to start: ${result.error.message}`)
      return finish('fail', 1, `${step.id} failed to start`)
    }
    if (result.status !== 0) {
      const exitCode = typeof result.status === 'number' ? result.status : 1
      stepRecords.push({
        id: step.id,
        status: 'fail',
        command: step.command,
        args: step.args,
        exitCode,
      })
      console.error(`production-gate: ${step.id} failed with exit code ${result.status ?? '<signal>'}`)
      return finish('fail', exitCode, `${step.id} failed`)
    }
    stepRecords.push({
      id: step.id,
      status: 'pass',
      command: step.command,
      args: step.args,
      exitCode: 0,
    })
  }

  console.error('production-gate: all release gates passed')
  return finish('pass', 0)
}

function runVerify(options) {
  const evidencePath = options.evidence || defaultEvidencePath
  const evidence = JSON.parse(String(readFileSync(evidencePath, 'utf8')))
  const failures = validateProductionGateEvidence(evidence, {
    ...(options.publishedEvidence ? {
      publishedReleaseEvidence: JSON.parse(String(readFileSync(options.publishedEvidence, 'utf8'))),
    } : {}),
  })
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure)
    }
    return 1
  }
  return 0
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (!command) {
    process.exit(runProductionGate())
  }
  if (command === 'verify') {
    process.exit(runVerify(options))
  }
  throw new Error(`Unknown command: ${command}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
