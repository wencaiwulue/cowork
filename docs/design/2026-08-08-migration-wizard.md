# Design Document: First-Run Migration Wizard (Claude / Codex / Skip)

- **Date**: 2026-08-08
- **Author**: Architect
- **Status**: Draft
- **Related Issues/PRs**: Supersedes/extends `docs/design/2026-08-06-claude-to-kode-migration.md`

---

## 1. Summary

Add a browser-style first-run migration wizard that prompts the user to import settings from **Claude** (`~/.claude.json` + `~/.claude/`) or **Codex** (`~/.codex/`), or **Skip**. In the CLI the wizard is a terminal `readline` single-select prompt; in the Desktop app it is a modal component reached over IPC. All migration logic lives in one shared, node-builtin-only module (`src/migrations/importConfig.ts`) that the Desktop main process reuses by spawning the CLI with hidden flags.

---

## 2. Problem / Motivation

- **Current behavior**: `migrateFromClaudeToKode()` (`src/migrations/migrateFromClaudeToKode.ts:28`) silently and unconditionally copies `~/.claude.json` + `~/.claude/` into `~/.kode.json` + `~/.kode/` on the first launch where `~/.kode.json` is absent. There is no Codex path, no user choice, and no discoverable record of what was imported.
- **Desired behavior**: On first run (no `~/.kode.json`), present a choice: import from Claude, import from Codex, or Skip. Record the decision so the prompt never re-appears. Codex config is migrated conservatively (only safe file aliases; never blindly remap `config.toml` into Kode's config schema).
- **Business/user impact**: Users coming from Codex get a one-click path into Kode; users who want a clean start can Skip; users always retain the ability to downgrade to their original tool because migration is copy-only and original dirs are preserved.
- **Architectural constraint (verified)**: Desktop main **cannot** `import` from `src/` — `desktop/vite.main.config.ts` only externalizes Node builtins, and no `desktop/main/*.ts` file imports `../src`. Therefore the migration core must be pure-Node-builtin code reachable by the CLI, and Desktop reuses it by spawning the CLI binary with hidden flags.

---

## 3. Proposed Solution

### 3.1 Overview

A single module `src/migrations/importConfig.ts` owns all detection and import logic, depending only on Node builtins (`fs`, `os`, `path`). Two public functions — `detectMigrationSources()` and `performMigration(source)` — plus path constants and a Codex→Kode file map.

The **first-run gate** is: `~/.kode.json` does **not** exist (`getKodeGlobalFile()`, `src/utils/env.ts:14-18`) **and** at least one migration source is detectable. The gate fires from two entry points:

1. **CLI** — a new `src/migrations/migrationPrompt.ts` renders a `readline` single-select (Claude / Codex / Skip). It is invoked inside `runMigrations()` (`src/main.tsx:327`) **before** the existing `migrateFromClaudeToKode()` and **before** `getGlobalConfig()` (`src/main.tsx:329`), so the memoized default config never shadows a freshly written `~/.kode.json`.
2. **Desktop** — `desktop/main/main.ts` spawns the CLI with hidden flags `--list-migration-sources` / `--perform-migration <source>` to reuse `importConfig.ts` without a forbidden `src/` import. The renderer shows a `MigrationWizard` modal over IPC and the main process blocks `createWindow()` until the user decides, so no session starts against a half-migrated config.

Both paths write two new config fields (`migrationPromptSeen`, `migratedFrom`) into `~/.kode.json`, which makes the gate idempotent: after the first decision `~/.kode.json` exists and `migrateFromClaudeToKode()`'s `existsSync(newGlobalFile)` guard (`migrateFromClaudeToKode.ts:35`) is a no-op.

### 3.2 Architecture / Flow

```
                       ┌─────────────────────────────────────────────┐
                       │  src/migrations/importConfig.ts              │
                       │  (node builtins only)                        │
                       │  - CLAUDE_*/CODEX_* path constants           │
                       │  - detectMigrationSources(): Source[]        │
                       │  - performMigration(source): Result         │
                       │  - CODEX_FILE_MAP (conservative)            │
                       └───────────────┬─────────────────────────────┘
                                       │ reused two ways
            ┌──────────────────────────┴───────────────────────────────┐
            │                                                          │
   CLI path (direct import)                       Desktop path (spawn)
            │                                                          │
  src/migrations/                            desktop/main/main.ts
  migrationPrompt.ts                         (spawns CLI hidden flags)
  (readline prompt)                                    │
            │                                          │ desktop/main/ipc.ts
            │                                          │ 3 new IPC channels
  src/main.tsx                                         │
  runMigrations() ─────────────┐                       │
  (preAction, src/main.tsx:952)│                       ▼
            │                  │           desktop/renderer/src/App.tsx
            ▼                  │           + MigrationWizard.tsx
  migrateFromClaudeToKode() ◄──┘           (modal-backdrop pattern)
  getGlobalConfig() ...
```

**First-run timeline (Desktop + CLI do not double-trigger):**

```
Desktop first launch          CLI invoked later (or spawned by desktop)
─────────────────────          ─────────────────────────────────────────
whenReady (main.ts:1463)       preAction hook (main.tsx:909)
  → detect via CLI flag          ~/.kode.json now EXISTS (desktop wrote it)
  → block createWindow           → migrateFromClaudeToKode guard
  → user picks Codex               existsSync(newGlobalFile) → return (no-op)
  → performMigration('codex')     → getGlobalConfig() reads real file
  → write ~/.kode.json            → runMigrations remaining steps run
    (migrationPromptSeen=true,
     migratedFrom='codex')
  → createWindow()
```

Because Desktop always writes `~/.kode.json` (even on **Skip** it writes a minimal file with `migrationPromptSeen=true`), any subsequent CLI launch sees the file and the gate never fires twice.

### 3.3 Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where migration core lives | `src/migrations/importConfig.ts`, node-builtin-only deps | Desktop main cannot import `src/`; a spawn-reusable CLI flag is the only bridge. Keeping deps to `fs`/`os`/`path` guarantees the module loads in both contexts. |
| How Desktop reuses logic | spawn CLI with hidden flags `--list-migration-sources` / `--perform-migration <source>` | Mirrors existing `sessionHost.ts` spawn pattern (`resolveCliRuntime` L76, packaged binary L95, `spawn` L157). No new build plumbing. |
| Where hidden flags short-circuit | In `src/main.tsx` **before** Commander `preAction` runs — i.e. right after the `isNonInteractive` detection at `src/main.tsx:801-805`, before `program` is built/run | `runMigrations()` lives inside `preAction` (`src/main.tsx:952`). A `--perform-migration` must not enter the full init/init/telemetry sequence; it must `process.exit(0)` first. |
| Codex config mapping | **Conservative**: alias `~/.codex/AGENTS.md` → `~/.kode/AGENTS.md` mapped to `KODE.md`; archive `config.toml` + any `instructions` file into `~/.kode/imported-codex/` verbatim; **skip** `~/.codex/sessions/` and `~/.codex/auth.json` | Codex `config.toml` has no clean 1:1 into Kode's config schema; forcing a mapping risks corrupting user settings. Archiving is lossless and discoverable. Sessions/auth are tool-specific and must not be copied. |
| First-run gate predicate | `!existsSync(~/.kode.json) && detectMigrationSources().length > 0` | Mirrors Claude's onboarding "show at least once" pattern (`src/interactiveHelpers.tsx:111` `!config.hasCompletedOnboarding`) and the existing migration guard (`migrateFromClaudeToKode.ts:35`). |
| Persistence of decision | Two new fields on `~/.kode.json`: `migrationPromptSeen: boolean`, `migratedFrom?: 'claude'\|'codex'\|'skip'` | `migrationPromptSeen` is the hard gate even if migration failed; `migratedFrom` is the audit record. Analogous to `hasCompletedOnboarding` + `lastOnboardingVersion` (`config.ts:199,201`, `configSchema.ts:58,59`). |
| Skip behavior | Write a minimal `~/.kode.json` `{ migrationPromptSeen: true, migratedFrom: 'skip', migrationVersion: 0, ...defaults }` | Ensures the gate never re-fires and `getGlobalConfig()` memoizes the real file instead of `createDefault()`. |
| Order inside `runMigrations()` | (1) detect+prompt+perform+write-minimal-config, then (2) existing `migrateFromClaudeToKode()`, then (3) `getGlobalConfig().migrationVersion` block | `migrateFromClaudeToKode()` is the Claude-path importer; the wizard's "Claude" choice delegates to it, while "Codex"/"Skip" bypass it. All must precede `getGlobalConfig()` (memoization hazard, `migrateFromClaudeToKode.ts:24-27`). |
| Desktop blocking | `whenReady` awaits the migration sub-process before `createWindow()` (`main.ts:1463-1468`) | Prevents a session from starting against a half-migrated config. |

---

## 4. Affected Files

### New Files

- `src/migrations/importConfig.ts` — Shared migration core (path constants, `detectMigrationSources`, `performMigration`, `CODEX_FILE_MAP`). Node-builtin-only deps.
- `src/migrations/migrationPrompt.ts` — CLI `readline` single-select prompt (Claude / Codex / Skip). Non-TTY → auto-Skip.
- `desktop/renderer/src/components/MigrationWizard.tsx` — Desktop modal component (reuses `modal-backdrop` + `confirmation-modal` pattern from `App.tsx:14000-14029`).
- `desktop/renderer/src/migrationWizard.css` — Styles for the wizard modal.

### Modified Files

- `src/main.tsx`
  - Around `L801-805` (`isNonInteractive` detection): add hidden-flag short-circuit (`--list-migration-sources` → print JSON, `process.exit(0)`; `--perform-migration <source>` → run `performMigration`, `process.exit(0)`).
  - In `runMigrations()` (`L327-354`): insert wizard two-phase call at the very top — detect/prompt/perform + write minimal `~/.kode.json` with `migrationPromptSeen`/`migratedFrom` — before `migrateFromClaudeToKode()` (`L328`) and before `getGlobalConfig()` (`L329`).
- `src/migrations/migrateFromClaudeToKode.ts` — No logic change; update doc comment to note that the wizard may have already written `~/.kode.json` (Codex/Skip path), so its `existsSync(newGlobalFile)` guard (`L35`) correctly no-ops.
- `src/utils/configSchema.ts` — Add `migrationPromptSeen: z.boolean().optional()` and `migratedFrom: z.enum(['claude','codex','skip']).optional()` near `hasCompletedOnboarding` (`L58-59`).
- `src/utils/config.ts` — Add the two fields to the `GlobalConfig` type near `hasCompletedOnboarding` (`L199`) / `lastOnboardingVersion` (`L201`).
- `desktop/main/main.ts` — In `whenReady` (`L1463-1468`): before `createWindow()`, spawn CLI `--list-migration-sources`; if sources exist, block until the renderer answers over IPC, then spawn `--perform-migration <source>`. Reuse `resolveCliRuntime`/spawn helpers from `sessionHost.ts`.
- `desktop/main/ipc.ts` — Add 3 channels to `desktopChannels` (`L1-85`): `migration:getSources`, `migration:perform`, `migration:skip`; add arity validation in `validateIpcArgs` (`L98`).
- `desktop/main/main.ts` `registerIpc()` (`L522`) — Register the 3 new `handleIpc` handlers (`L1354-1363`).
- `desktop/preload/preload.ts` — Expose `claudeDesktop.migration.{getSources,perform,skip}` via `contextBridge.exposeInMainWorld` (`L351`).
- `desktop/renderer/src/App.tsx` — Add `MigrationWizard` render slot near the confirm modal (`L14000-14029`); add `migrationState` state near `confirmRequest` (`L2082`); wire into `trapModalFocus` (`L2483`) and the keyboard guard (`L6642`,`L6651`).

### Deleted Files

- None.

---

## 5. Interface / API Changes

### 5.1 Function Signatures

```typescript
// src/migrations/importConfig.ts  (node-builtin-only deps)

export type MigrationSourceId = 'claude' | 'codex';

export interface MigrationSource {
  id: MigrationSourceId;
  label: string;                       // "Claude" | "Codex"
  /** Absolute paths that exist and triggered detection. */
  detectedPaths: string[];
}

export interface MigrationResult {
  source: MigrationSourceId;
  /** Files actually copied (absolute dest paths). */
  copied: string[];
  /** Files archived verbatim into ~/.kode/imported-codex/ (codex only). */
  archived: string[];
  /** Non-fatal errors; migration never throws. */
  warnings: string[];
}

/** Pure detection — no fs writes. Returns [] when nothing to import. */
export function detectMigrationSources(): MigrationSource[];

/**
 * Perform the import for one source. Never throws: returns warnings.
 * - 'claude' delegates to migrateFromClaudeToKode() semantics (copy-only).
 * - 'codex' applies CODEX_FILE_MAP (see 5.2).
 */
export function performMigration(source: MigrationSourceId): MigrationResult;

/** Write a minimal ~/.kode.json so the gate never re-fires. Used by Skip
 *  and after any performMigration to stamp decision fields. */
export function writeMigrationDecision(
  decision: 'claude' | 'codex' | 'skip',
): void;
```

```typescript
// src/migrations/migrationPrompt.ts  (CLI only)

/** Returns the user's choice, or 'skip' when non-TTY / no sources. */
export async function promptMigrationChoice(
  sources: MigrationSource[],
): Promise<'claude' | 'codex' | 'skip'>;
```

### 5.2 Data Structures

```typescript
// src/migrations/importConfig.ts

export const CLAUDE_GLOBAL_FILE = join(homedir(), '.claude.json');        // ~ L30 of migrateFromClaudeToKode.ts
export const CLAUDE_HOME_DIR    = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
export const CODEX_HOME_DIR    = join(homedir(), '.codex');
export const KODE_GLOBAL_FILE  = getKodeGlobalFile();                      // src/utils/env.ts:14
export const KODE_HOME_DIR    = getKodeConfigHomeDir();                   // src/utils/envUtils.ts:7

/**
 * Conservative Codex → Kode file map.
 *  - AGENTS.md is aliased to KODE.md (Kode's recognized memory file).
 *  - config.toml and any `instructions` file are archived verbatim into
 *    ~/.kode/imported-codex/ — NOT mapped into the Kode config schema.
 *  - sessions/ and auth.json are explicitly NOT migrated.
 */
export const CODEX_FILE_MAP: ReadonlyArray<{
  codexPath: string;            // relative to ~/.codex
  kodePath: string;             // relative to ~/.kode
  action: 'alias' | 'archive';
}> = [
  { codexPath: 'AGENTS.md',     kodePath: 'KODE.md',                 action: 'alias'   },
  { codexPath: 'config.toml',   kodePath: 'imported-codex/config.toml',   action: 'archive' },
  { codexPath: 'instructions',  kodePath: 'imported-codex/instructions', action: 'archive' },
];
```

```typescript
// src/utils/config.ts  (GlobalConfig additions, near L199)

export interface GlobalConfig {
  // ...existing fields...
  hasCompletedOnboarding?: boolean;        // L199
  lastOnboardingVersion?: string;          // L201
  firstStartTime?: string;                 // L374
  /** Hard gate: the migration wizard has been shown once. */
  migrationPromptSeen?: boolean;
  /** Audit record of which source was imported, or 'skip'. */
  migratedFrom?: 'claude' | 'codex' | 'skip';
}
```

### 5.3 IPC Endpoints (Desktop)

| Channel | Direction | Request args | Response |
|---|---|---|---|
| `migration:getSources` | renderer → main | (none) | `MigrationSource[]` (empty array = nothing to do, wizard hidden) |
| `migration:perform` | renderer → main | `[source: 'claude' \| 'codex']` | `MigrationResult` |
| `migration:skip` | renderer → main | (none) | `{ ok: true }` |

Preload API (`desktop/preload/preload.ts`, exposed at `claudeDesktop.migration`):

```typescript
export interface ClaudeDesktopApi {
  // ...existing...
  migration: {
    getSources: () => Promise<MigrationSource[]>;
    perform: (source: 'claude' | 'codex') => Promise<MigrationResult>;
    skip: () => Promise<{ ok: true }>;
  };
}
```

### 5.4 CLI Hidden Flags

| Flag | Behavior |
|---|---|
| `--list-migration-sources` | Print `JSON.stringify(detectMigrationSources())` to stdout, then `process.exit(0)`. Must short-circuit **before** Commander `preAction` (`src/main.tsx:952`) — i.e. at the `isNonInteractive` detection block (`L801-805`). |
| `--perform-migration <source>` | Run `performMigration(source)` + `writeMigrationDecision(source)`, print `JSON.stringify(result)`, then `process.exit(0)`. Same short-circuit point. |

Both flags are intentionally undocumented (not in `--help`).

---

## 6. Testing Plan

### 6.1 Unit Tests

- [ ] `detectMigrationSources()` returns `[]` when neither `~/.claude.json` nor `~/.codex/` exists (use `os.tmpdir()` + `KODE_CONFIG_DIR`/`CLAUDE_CONFIG_DIR` isolation).
- [ ] `detectMigrationSources()` returns exactly `[{id:'claude',...}]` when only `~/.claude.json` exists.
- [ ] `detectMigrationSources()` returns exactly `[{id:'codex',...}]` when only `~/.codex/AGENTS.md` exists.
- [ ] `detectMigrationSources()` returns both when both exist.
- [ ] `performMigration('codex')` copies `~/.codex/AGENTS.md` → `~/.kode/KODE.md` and archives `config.toml` → `~/.kode/imported-codex/config.toml`; never creates `~/.kode/auth.json`; result `copied`/`archived` populated; `warnings` empty on clean input.
- [ ] `performMigration('codex')` with missing optional files only omits them from results (no throw).
- [ ] `performMigration('claude')` is equivalent to `migrateFromClaudeToKode()` (copy-only, `force:false`, skips `*.lock`).
- [ ] `performMigration` never throws on any fs error — captures into `warnings`.
- [ ] `writeMigrationDecision('skip')` writes `~/.kode.json` with `migrationPromptSeen:true, migratedFrom:'skip'`; re-call is idempotent.
- [ ] `writeMigrationDecision('codex')` writes `migratedFrom:'codex'` and preserves any pre-existing fields.
- [ ] `promptMigrationChoice` returns `'skip'` when `!process.stdout.isTTY`.
- [ ] `promptMigrationChoice` returns the selected id when stdin answers `1`/`2`/`3`.

### 6.2 Integration Tests

- [ ] CLI: with `KODE_CONFIG_DIR=tmpdir` and a seeded `~/.codex/AGENTS.md`, running the CLI binary the first time prints the readline prompt, accepting "2" produces `~/.kode/KODE.md` and `~/.kode.json` with `migratedFrom:'codex'`.
- [ ] CLI: second launch with the file present does **not** prompt and proceeds straight to onboarding.
- [ ] CLI: `--list-migration-sources` prints valid JSON and exits 0 before any init/telemetry (assert no side-effect files created).
- [ ] CLI: `--perform-migration codex` writes the expected files and exits 0 before `preAction`.
- [ ] Desktop: mock-spawn the CLI `--list-migration-sources` → renderer receives sources via IPC; selecting Codex triggers `migration:perform`; window is created only after `performMigration` resolves.

### 6.3 Manual Verification

1. `rm -rf ~/.kode.json ~/.kode && cp ~/.codex/AGENTS.md /tmp/agents.bak` then run the CLI; confirm the wizard appears, pick Codex, confirm `~/.kode/KODE.md` matches `~/.codex/AGENTS.md` and `~/.kode/imported-codex/config.toml` exists.
2. Run the CLI again; confirm no wizard and onboarding proceeds.
3. Repeat with a fresh `~/.kode.json` removal but choose Skip; confirm a minimal `~/.kode.json` exists with `migrationPromptSeen:true, migratedFrom:'skip'` and no `~/.kode/` copy happened.
4. In Desktop, delete `~/.kode.json`, launch the app; confirm the wizard modal appears before the main window is interactive; pick Claude; confirm `~/.kode.json` and `~/.kode/` are populated.
5. Verify the wizard never appears on the second Desktop launch.

### 6.4 Edge Cases

- `~/.kode.json` exists but `migrationPromptSeen` is missing/false (e.g. user deleted it by hand) → re-show wizard; never silently re-import.
- `~/.codex/` exists but `AGENTS.md`, `config.toml`, `instructions` are all missing → `detectMigrationSources()` still returns the codex entry (dir presence is enough) but `performMigration` copies/archives nothing and reports empty arrays.
- Both Claude and Codex present → wizard lists both; user picks one; the other is untouched (copy-only, originals preserved).
- `~/.claude.json.lock` present → excluded by `*.lock` filter (existing behavior, `migrateFromClaudeToKode.ts:60`).
- Hidden flag passed together with a normal command (e.g. `--perform-migration codex -p ...`) → short-circuit wins, exits before `preAction`, normal command never runs.

---

## 7. Risks & Alternatives

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Desktop spawns CLI for migration while the user's CLI binary is from a different Kode version | Migration semantics drift | `resolveCliRuntime` already resolves the bundled binary (`sessionHost.ts:95`); reuse the same resolver so the spawned binary matches the Desktop build. |
| Hidden flag short-circuit at `L801-805` races with early-input capture (`stopCapturingEarlyInput`) | Captured keystrokes lost on `--perform-migration` | Call the short-circuit before any input capture; on the flag path, never invoke `stopCapturingEarlyInput`. |
| Codex `config.toml` format changes | Archived file unreadable | We only archive verbatim — no parsing — so format changes are inert; the archive is a reference, not active config. |
| `~/.kode.json` written by Desktop, then user launches an older CLI that doesn't know `migrationPromptSeen` | Field ignored, but `existsSync` guard still no-ops | Safe: older CLIs ignore unknown fields; the existence guard (`migrateFromClaudeToKode.ts:35`) is the hard stop. |
| User runs both Desktop and CLI concurrently on first launch | Both detect no `~/.kode.json` | The file write is `force:false`/atomic-ish; worst case one path's copy is skipped (guard) and only the decision fields win. Acceptable: originals are never deleted. |
| `performMigration` partially fails (disk full mid-copy) | Half-migrated state | `force:false` prevents overwrites; `warnings` recorded; `migrationPromptSeen` is still set so we don't loop. User can re-run manually. |

### Alternatives Considered

1. **Direct `import` of `src/migrations/importConfig.ts` from `desktop/main`.** Rejected: `desktop/vite.main.config.ts` only externalizes Node builtins; adding `src/` to the desktop bundle would require build-plumbing changes and blur the CLI/desktop boundary that the current architecture enforces.
2. **Embed migration logic in the renderer process.** Rejected: the renderer is sandboxed and cannot touch `~/.kode/` directly; it would still need an IPC bridge to the main process, which would then need fs access — equivalent complexity with worse separation.
3. **Auto-import without prompting (status quo, extended to Codex).** Rejected by the requirement: the user must be able to choose Skip, and Codex import must be opt-in because its `config.toml` cannot be safely auto-mapped.
4. **A single combined `--migration-wizard` flag that does detect+prompt+perform in one CLI invocation.** Rejected: Desktop needs to render its own UI, so detection and perform must be separate RPCs. The CLI prompt is a third composition of the same two functions.

---

## 8. Open Questions

None — all questions resolved.

- Confirmed Desktop cannot import `src/` (verified `desktop/main/*.ts` has no `../src` imports; `desktop/vite.main.config.ts` externalizes only Node builtins).
- Confirmed short-circuit point: the hidden flags must exit before Commander `preAction` (`src/main.tsx:952`); the existing `isNonInteractive` block at `L801-805` is the right insertion site.
- Confirmed Codex layout (`~/.codex/`): `AGENTS.md`, `config.toml`, `instructions`, `sessions/`, `auth.json` all observed on the reference machine.
- Confirmed reuse points: `resolveCliRuntime`/`spawn` (`sessionHost.ts:76,95,157`), `handleIpc` (`main.ts:1354`), `registerIpc` (`main.ts:522`), `contextBridge.exposeInMainWorld('claudeDesktop', api)` (`preload.ts:351`), modal pattern (`App.tsx:14000-14029`, state at `L2082`, focus trap at `L2483`).
