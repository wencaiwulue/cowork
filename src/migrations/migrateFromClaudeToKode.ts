import { performMigration } from './importConfig.js'

/**
 * One-shot first-run migration: copy the legacy user-level Claude config
 * (`~/.claude.json` + `~/.claude/`) into the Kode paths (`~/.kode.json` +
 * `~/.kode/`). Only runs when `~/.kode.json` does NOT exist, so it is safe to
 * call on every launch. Old directories are preserved (copy-only, no deletion)
 * so users can still downgrade to upstream Claude Code.
 *
 * NOTE: As of the first-run migration wizard (see
 * docs/design/2026-08-08-migration-wizard.md), this is a thin wrapper around
 * `performMigration('claude')`. The wizard may have already written
 * `~/.kode.json` (Codex / Skip path); `performMigration`'s existence guard
 * (`existsSync(~/.kode.json)`) then makes this call a no-op, so the wizard
 * and this legacy entry point never double-import.
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
  performMigration('claude')
}
