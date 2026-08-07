import { cpSync, existsSync, mkdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { logForDebugging } from '../utils/debug.js'
import { getKodeGlobalFile } from '../utils/env.js'
import { getKodeConfigHomeDir } from '../utils/envUtils.js'

/**
 * One-shot first-run migration: copy the legacy user-level Claude config
 * (`~/.claude.json` + `~/.claude/`) into the Kode paths (`~/.kode.json` +
 * `~/.kode/`). Only runs when `~/.kode.json` does NOT exist (ENOENT), so it
 * is safe to call on every launch. Old directories are preserved (copy-only,
 * no deletion) so users can still downgrade to upstream Claude Code.
 *
 * Honors `CLAUDE_CONFIG_DIR` for the source home dir (custom installs / test
 * harnesses). The source global file is intentionally NOT env-overridable —
 * matching upstream Claude Code behavior, it always lives at
 * `homedir()/.claude.json`.
 *
 * Idempotent: the existence guard short-circuits on every launch after the
 * first successful copy. Never throws — a failure here just means the user
 * starts with a default config; subsequent in-chain migrations still run.
 *
 * MUST execute before any `getGlobalConfig()` call: `getConfig()` memoizes
 * `createDefault()` when `~/.kode.json` is missing, which would shadow the
 * migrated file. See docs/design/2026-08-06-claude-to-kode-migration.md §2.2.
 */
export function migrateFromClaudeToKode(): void {
  const oldHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const oldGlobalFile = join(homedir(), '.claude.json')
  const newHome = getKodeConfigHomeDir()
  const newGlobalFile = getKodeGlobalFile()

  // Guard: Kode config already exists → not a first run → no-op.
  if (existsSync(newGlobalFile)) return
  // Guard: nothing to migrate → no-op silently.
  if (!existsSync(oldGlobalFile) && !existsSync(oldHome)) {
    logForDebugging('migrateFromClaudeToKode: no legacy claude config found, skipping', {
      level: 'debug',
    })
    return
  }

  try {
    // 1. Copy ~/.claude.json → ~/.kode.json (if present).
    if (existsSync(oldGlobalFile) && statSync(oldGlobalFile).isFile()) {
      // Ensure parent dir exists (homedir always does, but be defensive).
      mkdirSync(dirname(newGlobalFile), { recursive: true })
      cpSync(oldGlobalFile, newGlobalFile, { force: false, errorOnExist: false })
    }
    // 2. Recursively copy ~/.claude/ → ~/.kode/ (if present).
    if (existsSync(oldHome) && statSync(oldHome).isDirectory()) {
      mkdirSync(dirname(newHome), { recursive: true })
      cpSync(oldHome, newHome, {
        force: false, // never overwrite existing files in newHome
        recursive: true,
        // Skip stale lock files (e.g. claude.json.lock from a running
        // upstream process) — a copied lock would cause a phantom
        // "another instance running" error under Kode.
        filter: src => !src.endsWith('.lock'),
      })
    }
    logForDebugging('migrateFromClaudeToKode: copied legacy claude config to kode paths', {
      level: 'debug',
    })
  } catch (err) {
    // Best-effort: log and swallow. A partial/missing copy just means the
    // user starts with a default config; subsequent migrations still run.
    logForDebugging(
      `migrateFromClaudeToKode failed: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'debug' },
    )
  }
}
