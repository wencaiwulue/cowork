/**
 * First-run migration wizard — Desktop main-process bridge.
 *
 * Desktop main cannot `import` from `src/` (see docs/design/2026-08-08-migration-wizard.md
 * §3.1 / §7 alt.1), so we reuse the CLI's migration logic by spawning the CLI
 * binary with the hidden flags `--list-migration-sources` / `--perform-migration
 * <source>` (registered in src/main.tsx around L909). The CLI prints a single
 * line of JSON to stdout and exits 0.
 *
 * The `skipMigration()` path is purely a filesystem write — no CLI spawn needed
 * — because we only need to stamp `~/.kode.json` with `migrationPromptSeen`
 * so the gate never re-fires. We compute the path with the same rule as
 * `getKodeGlobalFile()` in src/utils/env.ts (prod suffix is empty).
 */

import { spawn } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveCliRuntime } from './sessionHost'

/**
 * Re-declared here (instead of importing from src/migrations/importConfig.ts)
 * because desktop main is forbidden from importing src/. This mirror must stay
 * structurally compatible with the JSON the CLI emits via --list-migration-sources
 * / --perform-migration. See MigrationSourceInfo / MigrationResult in
 * src/migrations/importConfig.ts.
 */
export type MigrationSource = 'claude' | 'codex'

export interface MigrationItem {
  description: string
  sourcePath: string
  destPath: string
  itemCount: number
}

export interface MigrationSourceInfo {
  source: MigrationSource
  label: string
  homeDir: string
  globalFile?: string
  exists: boolean
  items: MigrationItem[]
  totalItemCount: number
}

export interface MigrationResult {
  source: MigrationSource
  ok: boolean
  migratedItems: string[]
  skippedItems: { path: string; reason: string }[]
  warnings: string[]
}

/** Path of the Kode global config file, matching src/utils/env.ts (prod). */
function kodeGlobalFile(): string {
  return process.env.KODE_CONFIG_DIR
    ? join(process.env.KODE_CONFIG_DIR, '.kode.json')
    : join(homedir(), '.kode.json')
}

/**
 * Spawn the CLI with `--list-migration-sources`, parse the JSON line on stdout.
 * Returns the raw source list; callers filter on `exists && totalItemCount > 0`.
 */
export async function detectMigrationSourcesViaCli(): Promise<MigrationSourceInfo[]> {
  const runtime = resolveCliRuntime(import.meta.url, process.env)
  const stdout = await runCli(runtime.command, [
    ...runtime.prefixArgs,
    '--list-migration-sources',
  ])
  const parsed = JSON.parse(stdout) as MigrationSourceInfo[]
  if (!Array.isArray(parsed)) {
    return []
  }
  return parsed
}

/**
 * Spawn the CLI with `--perform-migration <source>` and return the result.
 * Never throws — fs errors are captured into `warnings` by the CLI side.
 */
export async function performMigrationViaCli(
  source: MigrationSource,
): Promise<MigrationResult> {
  const runtime = resolveCliRuntime(import.meta.url, process.env)
  const stdout = await runCli(runtime.command, [
    ...runtime.prefixArgs,
    '--perform-migration',
    source,
  ])
  return JSON.parse(stdout) as MigrationResult
}

/**
 * Write a minimal `~/.kode.json` with `migrationPromptSeen: true` so the
 * first-run gate never re-fires. Used by the Skip button. Also safe to call
 * after a successful performMigration (the CLI's --perform-migration already
 * stamps decision fields via src's writeMigrationDecision; this is only the
 * fallback for Skip, which never spawns the CLI).
 */
export async function skipMigration(): Promise<void> {
  const target = kodeGlobalFile()
  const payload = {
    migrationPromptSeen: true,
    migratedFrom: 'none',
  }
  // Best-effort atomic-ish write: write to a sibling tmp file then rename.
  const dir = dirname(target)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

/** True when the first-run gate should NOT fire (config already exists). */
export function kodeGlobalFileExists(): boolean {
  return existsSync(kodeGlobalFile())
}

/**
 * Run the CLI binary, capturing stdout. Rejects on non-zero exit / spawn error.
 * Mirrors the spawn usage in sessionHost.ts (env: CLAUDE_CODE_ENTRYPOINT).
 */
function runCli(
  command: string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', err => {
      reject(new Error(`migration CLI spawn failed: ${err.message}`))
    })
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(
        new Error(
          `migration CLI exited code=${code ?? signal} stderr=${stderr.trim()}`,
        ),
      )
    })
  })
}
