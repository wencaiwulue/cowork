# Mini Design Doc: First-Run Claude → Kode User-Level Config Migration

- **Date**: 2026-08-06
- **Type**: Small Change
- **Severity**: High (touches user data on first run)

---

## 1. Root Cause / Motivation

This project is a Claude Code CLI fork that has already renamed every configuration path from `claude` to `kode`:

- `~/.claude` → `~/.kode` (`getKodeConfigHomeDir`, `src/utils/envUtils.ts:7-14`, honors `KODE_CONFIG_DIR`, else `homedir()/.kode`)
- `~/.claude.json` → `~/.kode.json` (`getKodeGlobalFile`, `src/utils/env.ts:14-18`, honors `KODE_CONFIG_DIR`, else `homedir()`, filename `.kode.json`)
- `CLAUDE_CONFIG_DIR` → `KODE_CONFIG_DIR`

At that time **all backward-compatible fallback reads of the old paths were removed** (see the explicit comment at `src/utils/env.ts:15`: "Legacy .config.json fallback REMOVED — no backward-compat with upstream"). As a consequence, existing Claude Code users upgrading to this fork lose their global config on first launch: `getKodeGlobalFile()` points at `~/.kode.json`, which does not exist, so `getConfig()` (`src/utils/config.ts:1424-1475`) returns `createDefault()` (the `ENOENT` branch at line 1465-1474). Users see a blank config — no OAuth, no MCP, no preferences — even though `~/.claude.json` is still on disk.

We need a one-shot, first-run migration that copies the old user-level Claude config into the new Kode paths, **without** reintroducing permanent fallback reads and **without** deleting the old directories (so users can still downgrade).

---

## 2. Fix / Proposed Solution

### 2.1 Decision (confirmed)

- **Full copy**, not selective: `~/.claude.json` → `~/.kode.json` **and** recursive `~/.claude/` → `~/.kode/`.
- **User-level only**. No project-level `.claude/` → `.kode/` migration, no `.mcp.json` handling.
- **Keep old directories** intact (no deletion, no rename). Migration is copy-only.
- **"Empty" guard = `~/.kode.json` does not exist (`ENOENT`)**. Any other state (parse error, backup, partial) is left untouched.
- Integrate into the existing `runMigrations()` mechanism (`src/main.tsx:326-352`) and bump `CURRENT_MIGRATION_VERSION` from `11` → `12` (`src/main.tsx:325`).

### 2.2 Critical timing — must run before `getGlobalConfig()`

`runMigrations()` currently begins at `src/main.tsx:327` with:

```ts
if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) { ... }
```

`getGlobalConfig()` (`src/utils/config.ts`) is memoized via `getConfig()`. When `~/.kode.json` is missing, `getConfig` hits the `ENOENT` branch (line 1465-1474) and **returns + memoizes `createDefault()`** with `migrationVersion` absent/`0`. Once memoized, the default object is cached; any subsequent `saveGlobalConfig()` that writes the migrated file will not be reflected because the memo cache still holds the pre-migration default. Therefore:

> **The new migration function MUST execute at the very top of `runMigrations()`, BEFORE the `getGlobalConfig()` call on line 327.**

After the copy, `~/.kode.json` exists on disk with the old `migrationVersion` (≤ 11 < 12). The subsequent `getGlobalConfig()` then reads the freshly-copied file (memoized with the real contents), the `!== CURRENT_MIGRATION_VERSION` guard is true, and the normal migration chain runs to bump it to 12. This makes the new migration self-reentrant-safe: on second launch `~/.kode.json` exists, the guard short-circuits, and nothing is copied again.

### 2.3 New file: `src/migrations/migrateFromClaudeToKode.ts`

```ts
import { cpSync, existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getKodeConfigHomeDir } from '../utils/envUtils.js'
import { getKodeGlobalFile } from '../utils/env.js'
import { logForDebugging } from '../utils/log.js' // adjust import path to actual symbol

/**
 * One-shot first-run migration: copy the legacy user-level Claude config
 * (~/.claude.json + ~/.claude/) into the Kode paths. Only runs when
 * ~/.kode.json does NOT exist (ENOENT). Old directories are preserved.
 * Idempotent: second launch short-circuits on the existence guard.
 * Never throws — a failure here just means the user starts with a default config.
 */
export function migrateFromClaudeToKode(): void {
  const oldHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  const oldGlobalFile = join(homedir(), '.claude.json')
  const newHome = getKodeConfigHomeDir()
  const newGlobalFile = getKodeGlobalFile()

  // Guard: Kode config already exists → not a first run → no-op.
  if (existsSync(newGlobalFile)) return
  // Guard: nothing to migrate → no-op silently.
  if (!existsSync(oldGlobalFile) && !existsSync(oldHome)) return

  try {
    // 1. Copy ~/.claude.json → ~/.kode.json (if present).
    if (existsSync(oldGlobalFile) && statSync(oldGlobalFile).isFile()) {
      cpSync(oldGlobalFile, newGlobalFile, { force: false, errorOnExist: false })
    }
    // 2. Recursively copy ~/.claude/ → ~/.kode/ (if present).
    if (existsSync(oldHome) && statSync(oldHome).isDirectory()) {
      cpSync(oldHome, newHome, {
        force: false,           // never overwrite existing files in newHome
        recursive: true,
        filter: (src) => !src.endsWith('.lock'), // skip stale lock files
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
```

Key properties:

- **Idempotent** — `existsSync(newGlobalFile)` short-circuits on every launch after the first successful copy.
- **No-throw** — every failure path is logged via `logForDebugging` and swallowed. A failed migration degrades to "default config", not "crash on startup".
- **`force: false`** — never overwrites anything already present in `~/.kode/` (defensive: if the user hand-created files they are preserved).
- **`*.lock` excluded** — a stale `claude.json.lock` from a running upstream process must not be copied as a Kode lock and cause a phantom "another instance running" error.
- **Old paths preserved** — copy-only, no `rmSync`.
- **Honors `CLAUDE_CONFIG_DIR`** for the source home dir so test harnesses and custom installs are covered. The source global file `~/.claude.json` is intentionally **not** env-overridable, matching upstream Claude Code behavior (it always lives at `homedir()/.claude.json`).

### 2.4 Wiring into `runMigrations()` (`src/main.tsx`)

```ts
const CURRENT_MIGRATION_VERSION = 12              // was 11 (line 325)
function runMigrations(): void {
  migrateFromClaudeToKode()                       // NEW — MUST precede getGlobalConfig()
  if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
    // ... existing migration chain unchanged ...
  }
  migrateChangelogFromConfig().catch(() => {})
}
```

Because the copied `~/.kode.json` carries the old `migrationVersion` (≤ 11), the `if` block on line 327 is entered and the existing chain naturally upgrades it to 12. No additional version-bookkeeping is needed inside the new migration.

---

## 3. Files Changed

| File | Change |
|---|---|
| `src/migrations/migrateFromClaudeToKode.ts` | **Create.** Implement `migrateFromClaudeToKode()` per §2.3. |
| `src/main.tsx:325` | Bump `CURRENT_MIGRATION_VERSION` from `11` → `12`. |
| `src/main.tsx:326-327` | Add `import { migrateFromClaudeToKode } from './migrations/migrateFromClaudeToKode.js'` (top of file imports). Insert `migrateFromClaudeToKode()` call as the **first statement** inside `runMigrations()`, before the `getGlobalConfig()` call on line 327. |
| `src/migrations/__tests__/migrateFromClaudeToKode.test.ts` | **Create.** Test plan per §4. |

No changes to `src/utils/env.ts`, `src/utils/envUtils.ts`, or `src/utils/config.ts` — we deliberately do **not** reintroduce fallback reads.

---

## 4. Interface / API Changes

New exported function (no API removals, no signature changes elsewhere):

```ts
// src/migrations/migrateFromClaudeToKode.ts
export function migrateFromClaudeToKode(): void
```

- No parameters (reads env + filesystem only).
- No return value.
- Side effect: may create `~/.kode.json` and `~/.kode/` tree on first run.
- Pure best-effort: never throws.

`CURRENT_MIGRATION_VERSION` constant bump (`11` → `12`) is internal to `src/main.tsx` and not part of any external API.

---

## 5. Testing Plan

All tests in new file `src/migrations/__tests__/migrateFromClaudeToKode.test.ts`. Use a real temp dir per test, set `KODE_CONFIG_DIR` + `CLAUDE_CONFIG_DIR` and `os.homedir()` stubbing (or `KODE_CONFIG_DIR` only, plus a stubbed `homedir()`) to point at the temp tree. Clear the `getKodeConfigHomeDir` / `getKodeGlobalFile` memoize caches between tests (`memoize.cache.clear()` or `.cache.delete(key)`).

- [ ] **Migrate scenario**: pre-seed `~/.claude.json` (with `{"oauthAccount": {...}, "migrationVersion": 5}`) and `~/.claude/` (containing `settings.json`, a `projects/` subdir, and a `claude.json.lock` file). Run `migrateFromClaudeToKode()`. Assert `~/.kode.json` exists and is byte-equal (or JSON-deep-equal) to the source; `~/.kode/` tree equals source minus any `*.lock` files; `~/.claude/` and `~/.claude.json` are unchanged (still present, still byte-equal).
- [ ] **Idempotent (second run no-op)**: after the first migration, run `migrateFromClaudeToKode()` again. Assert no file modification times change and no extra writes occur (e.g. wrap `cpSync` with a spy and assert zero calls on the second run).
- [ ] **No-op when nothing to migrate**: empty home dir, `~/.kode.json` absent, `~/.claude.json` absent, `~/.claude/` absent. Assert function returns without creating `~/.kode.json` or `~/.kode/`.
- [ ] **No-op when kode config already exists**: pre-create `~/.kode.json` with custom content; also pre-create `~/.claude.json`. Run migration. Assert `~/.kode.json` content is **unchanged** (existence guard fires), `~/.claude.json` untouched, and `cpSync` is **not** called for the global file.
- [ ] **Partial source — only `~/.claude.json` exists** (no `~/.claude/` dir): assert `~/.kode.json` is created and `~/.kode/` is **not** created (or is created only if it already existed).
- [ ] **Partial source — only `~/.claude/` exists** (no `~/.claude.json`): assert `~/.kode/` tree is copied; `~/.kode.json` is **not** created.
- [ ] **Lock-file exclusion**: source tree contains `~/.claude/foo.lock` and `~/.claude/bar.json`. Assert `~/.kode/foo.lock` does **not** exist and `~/.kode/bar.json` does.
- [ ] **Fault injection — copy throws**: stub `cpSync` to throw `EACCES`. Assert `migrateFromClaudeToKode()` returns normally (no throw), a debug log is emitted, and `~/.kode.json` may be partially created (acceptable) — i.e. process does not crash.
- [ ] **Fault injection — source file unreadable**: `chmod 000 ~/.claude.json`. Assert no throw, graceful skip.
- [ ] **`CLAUDE_CONFIG_DIR` honored**: set `CLAUDE_CONFIG_DIR=/tmp/xxx/.claude-custom`; assert source home dir resolves to that path (not `~/.claude`).
- [ ] **Timing invariant (integration)**: in a test that exercises `runMigrations()` (or a small wrapper) with `~/.claude.json` present and `~/.kode.json` absent, assert that `getGlobalConfig()` called **after** `runMigrations()` returns the migrated contents (e.g. the `oauthAccount` from the source), not `createDefault()`. This validates the "must run before `getGlobalConfig`" ordering.
- [ ] **`tsc` / build**: `npx tsc --noEmit` passes with the new file and the bumped version constant.
- [ ] **Existing config tests still green**: `npm test -- src/utils/config.test.ts` (or repo equivalent) passes unchanged.
- [ ] **Manual smoke**: on a clean machine with `~/.claude.json` + `~/.claude/` from upstream Claude Code, run the built CLI once. Verify `~/.kode.json` + `~/.kode/` appear with expected contents, `~/.claude*` unchanged, OAuth session is preserved (no re-login prompt), and a second launch performs no migration work (check debug logs).

---

## 6. Risks & Alternatives

**Risks:**

1. **Memoize staleness** if the migration is accidentally placed **after** `getGlobalConfig()` — the default-config cache would shadow the migrated file. Mitigated by §2.2 (must be the first statement in `runMigrations()`) and the integration test in §5 that asserts the post-`runMigrations` `getGlobalConfig()` returns migrated data.
2. **Partial copy on crash** mid-`cpSync` (e.g. disk full). On next launch the existence guard (`~/.kode.json` exists) skips re-migration, leaving a half-populated config. Acceptable: worst case is some missing `~/.kode/` files; the JSON config itself is copied first (small, atomic-ish) so OAuth is preserved. Alternative (write to temp + atomic rename) is rejected as over-engineering for a one-shot migration.
3. **`*.lock` files** copied from a concurrently-running upstream Claude would create a phantom lock under `~/.kode/`. Mitigated by the `filter: (src) => !src.endsWith('.lock')` clause.
4. **Permission errors** on source read or dest write. Mitigated by the try/catch + `logForDebugging` no-throw contract; worst case is default config.
5. **Version constant drift**: if another migration is added in the same release, both must coordinate on `CURRENT_MIGRATION_VERSION`. The new migration is version-agnostic (it only checks `~/.kode.json` existence, not `migrationVersion`), so ordering relative to other in-chain migrations is not load-bearing — only its position relative to `getGlobalConfig()` matters.
6. **Schema drift**: the copied `~/.claude.json` may contain keys no longer in `GlobalConfigSchema`. `getConfig()` (`src/utils/config.ts:1442-1455`) already strips/ignores unknown keys via `{ ...createDefault(), ...parsedConfig }` and logs-only schema validation, so this is handled by existing infrastructure.

**Alternatives considered:**

- **Selective key copy** (only OAuth + a few prefs). Rejected: full copy is simpler, less likely to miss user data, and the existing merge semantics in `getConfig` already discard invalid keys. Selective copy would require maintaining a allowlist that drifts.
- **Reintroduce permanent fallback reads** of `~/.claude*` in `env.ts`/`envUtils.ts`. Rejected: it re-couples the fork to upstream paths forever and was explicitly removed. Migration is one-shot and self-documenting.
- **Delete old dirs after copy**. Rejected: users may downgrade back to upstream Claude; deletion is irreversible. Copy-only keeps the operation safe.
- **Migrate project-level `.claude/` → `.kode/`**. Out of scope per requirements; project-level config is recreated lazily on `cd` and migrating it would require scanning every project.
- **Atomic write (temp + rename)** for `~/.kode.json`. Rejected as over-engineering; `cpSync` of a single small JSON file is effectively atomic at the filesystem level for our crash-recovery needs.

---

## 7. Open Questions

All questions resolved at design time. Specifically confirmed:

- Full copy (not selective). ✅
- User-level only (no project-level). ✅
- Keep old directories (no deletion). ✅
- "Empty" = `~/.kode.json` ENOENT. ✅
- Integrate via `runMigrations` + bump version `11` → `12`. ✅
- Migration must precede `getGlobalConfig()` call to avoid memoize staleness. ✅

No blocking open questions remain.
