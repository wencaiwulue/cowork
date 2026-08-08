import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { logForDebugging } from '../utils/debug.js'
import { getKodeGlobalFile } from '../utils/env.js'
import { getKodeConfigHomeDir } from '../utils/envUtils.js'

/**
 * First-run migration wizard core. Node-builtin-only deps (fs/os/path) plus
 * the project's path helpers (getKodeGlobalFile / getKodeConfigHomeDir) and
 * logForDebugging. The Desktop main process reuses this module by spawning
 * the CLI with the hidden flags --list-migration-sources / --perform-migration
 * (see docs/design/2026-08-08-migration-wizard.md §3.1).
 *
 * Two public functions:
 *  - detectMigrationSources(): pure detection, no fs writes.
 *  - performMigration(source): copy-only import, never throws.
 *
 * Migration is always copy-only and never deletes the source directory, so
 * users can downgrade back to their original tool at any time.
 */

export type MigrationSource = 'claude' | 'codex'

export interface MigrationItem {
  description: string
  sourcePath: string
  destPath: string
  /** Files contained in the source (1 for a file, recursive count for a dir). */
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

/** Recursive count of files under a directory (1 for a file). 0 if missing. */
function countFiles(p: string): number {
  if (!existsSync(p)) return 0
  const st = statSync(p)
  if (st.isFile()) return 1
  if (!st.isDirectory()) return 0
  let n = 0
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const child = join(p, entry.name)
    if (entry.isDirectory()) n += countFiles(child)
    else if (entry.isFile()) n += 1
    // symlinks/other: skip to avoid following links into unrelated trees
  }
  return n
}

/** cpSync filter that excludes stale lock files (e.g. claude.json.lock). */
function excludeLock(src: string): boolean {
  return !src.endsWith('.lock')
}

interface CodexSkipped {
  codexPath: string
  reason: string
}

/** Paths under ~/.codex that are intentionally NOT migrated. */
const CODEX_SKIPPED: ReadonlyArray<CodexSkipped> = [
  { codexPath: 'sessions', reason: 'format incompatible' },
  { codexPath: 'auth.json', reason: 'format incompatible' },
]

function buildClaudeItems(
  home: string,
  globalFile: string,
  destHome: string,
  destGlobal: string,
): MigrationItem[] {
  const items: MigrationItem[] = []
  if (existsSync(globalFile) && statSync(globalFile).isFile()) {
    items.push({
      description: 'Global config (~/.claude.json)',
      sourcePath: globalFile,
      destPath: destGlobal,
      itemCount: 1,
    })
  }
  if (existsSync(home) && statSync(home).isDirectory()) {
    items.push({
      description: 'Memories & settings (~/.claude/)',
      sourcePath: home,
      destPath: destHome,
      itemCount: countFiles(home),
    })
  }
  return items
}

function buildCodexItems(home: string, destHome: string): MigrationItem[] {
  const items: MigrationItem[] = []
  const archiveDir = join(destHome, 'imported-codex')

  const agentsMd = join(home, 'AGENTS.md')
  if (existsSync(agentsMd) && statSync(agentsMd).isFile()) {
    items.push({
      description: 'AGENTS.md → KODE.md memory',
      sourcePath: agentsMd,
      destPath: join(destHome, 'KODE.md'),
      itemCount: 1,
    })
  }

  const configToml = join(home, 'config.toml')
  if (existsSync(configToml) && statSync(configToml).isFile()) {
    items.push({
      description: 'config.toml (archived verbatim)',
      sourcePath: configToml,
      destPath: join(archiveDir, 'config.toml'),
      itemCount: 1,
    })
  }

  const instructions = join(home, 'instructions')
  if (existsSync(instructions)) {
    const st = statSync(instructions)
    if (st.isFile() || st.isDirectory()) {
      items.push({
        description: 'instructions (archived verbatim)',
        sourcePath: instructions,
        destPath: join(archiveDir, 'instructions'),
        itemCount: countFiles(instructions),
      })
    }
  }

  return items
}

/**
 * Pure detection — no fs writes. Returns one entry per known source (claude,
 * codex), with `exists` and `items` populated by stat'ing the expected paths.
 * Always returns [claude, codex] in that order; callers filter on
 * `exists && totalItemCount > 0`.
 */
export function detectMigrationSources(): MigrationSourceInfo[] {
  const destGlobal = getKodeGlobalFile()
  const destHome = getKodeConfigHomeDir()

  // --- Claude ---
  const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const claudeGlobal = join(homedir(), '.claude.json')
  const claudeItems = buildClaudeItems(claudeHome, claudeGlobal, destHome, destGlobal)
  const claudeExists = existsSync(claudeHome) || existsSync(claudeGlobal)
  const claudeInfo: MigrationSourceInfo = {
    source: 'claude',
    label: 'Claude',
    homeDir: claudeHome,
    globalFile: claudeGlobal,
    exists: claudeExists,
    items: claudeItems,
    totalItemCount: claudeItems.reduce((n, it) => n + it.itemCount, 0),
  }

  // --- Codex ---
  const codexHome = join(homedir(), '.codex')
  const codexItems = buildCodexItems(codexHome, destHome)
  const codexInfo: MigrationSourceInfo = {
    source: 'codex',
    label: 'Codex',
    homeDir: codexHome,
    exists: existsSync(codexHome),
    items: codexItems,
    totalItemCount: codexItems.reduce((n, it) => n + it.itemCount, 0),
  }

  return [claudeInfo, codexInfo]
}

function copyItem(item: MigrationItem, result: MigrationResult): void {
  try {
    if (!existsSync(item.sourcePath)) {
      result.skippedItems.push({ path: item.sourcePath, reason: 'source missing' })
      return
    }
    mkdirSync(dirname(item.destPath), { recursive: true })
    const st = statSync(item.sourcePath)
    cpSync(item.sourcePath, item.destPath, {
      force: false, // never overwrite existing destination files
      errorOnExist: false,
      recursive: st.isDirectory(),
      filter: excludeLock,
    })
    result.migratedItems.push(item.destPath)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    result.skippedItems.push({ path: item.sourcePath, reason })
  }
}

function performClaudeMigration(result: MigrationResult): void {
  const home = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const globalFile = join(homedir(), '.claude.json')
  const destHome = getKodeConfigHomeDir()
  const destGlobal = getKodeGlobalFile()
  const items = buildClaudeItems(home, globalFile, destHome, destGlobal)
  for (const item of items) copyItem(item, result)
}

function performCodexMigration(result: MigrationResult): void {
  const home = join(homedir(), '.codex')
  const destHome = getKodeConfigHomeDir()
  const items = buildCodexItems(home, destHome)
  for (const item of items) copyItem(item, result)

  // Explicitly skipped paths (sessions/, auth.json) — never copied, recorded
  // so the user can see why they were left behind.
  for (const skipped of CODEX_SKIPPED) {
    const p = join(home, skipped.codexPath)
    if (existsSync(p)) {
      result.skippedItems.push({ path: p, reason: skipped.reason })
    }
  }
}

/**
 * Perform the copy-only import for one source. Never throws — fs errors are
 * captured into `skippedItems` / `warnings`.
 *
 * Guard: if `~/.kode.json` already exists this is a no-op (the gate already
 * fired), returning `ok: true` with empty arrays. This matches the existing
 * `migrateFromClaudeToKode()` guard so callers can safely invoke both.
 */
export function performMigration(source: MigrationSource): MigrationResult {
  const result: MigrationResult = {
    source,
    ok: true,
    migratedItems: [],
    skippedItems: [],
    warnings: [],
  }

  // Hard guard: Kode global config already exists → not a first run → no-op.
  if (existsSync(getKodeGlobalFile())) {
    logForDebugging(
      `performMigration(${source}): ~/.kode.json exists, skipping (no-op)`,
      { level: 'debug' },
    )
    return result
  }

  try {
    if (source === 'claude') {
      performClaudeMigration(result)
    } else if (source === 'codex') {
      performCodexMigration(result)
    } else {
      // Unknown source — exhaustive fallback, never throws.
      result.warnings.push(`unknown migration source: ${String(source)}`)
    }
    logForDebugging(
      `performMigration(${source}): migrated=${result.migratedItems.length} skipped=${result.skippedItems.length}`,
      { level: 'debug' },
    )
  } catch (err) {
    // Defensive: copyItem already catches, but wrap the whole flow so the
    // contract "never throws" is guaranteed even for unexpected errors.
    const msg = err instanceof Error ? err.message : String(err)
    result.warnings.push(`unexpected error: ${msg}`)
    logForDebugging(`performMigration(${source}) failed: ${msg}`, {
      level: 'debug',
    })
  }

  return result
}
