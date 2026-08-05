# Design Document: Kode Config Path & File Rename

- **Date**: 2026-08-05
- **Author**: Architect
- **Status**: Draft
- **Related Issues/PRs**: none

---

## 1. Summary

Rename every Claude Code user-facing configuration path, directory, and file name in this fork to the `kode` naming scheme (e.g. `~/.claude` → `~/.kode`, `CLAUDE.md` → `KODE.md`, `.mcp.json` → `.kode.mcp.json`, `CLAUDE_CONFIG_DIR` → `KODE_CONFIG_DIR`). No backward-compatibility fallbacks to old paths are retained; this is a clean break to decouple the fork from the upstream Claude Code product.

## 2. Problem / Motivation

- **Current behavior**: The CLI reads and writes user/project configuration using Claude-branded paths (`~/.claude`, `CLAUDE.md`, `.mcp.json`, `~/.claude.json`, `CLAUDE_CONFIG_DIR`, managed `ClaudeCode` platform dirs, etc.). These names leak the upstream product identity into the fork's on-disk footprint.
- **Desired behavior**: All configuration artifacts use the `kode` brand so the fork is a self-contained product with its own config namespace, its own user home dir, and its own env var. Users of the fork will not collide with any upstream Claude Code installation.
- **Business/user impact**: A forked CLI must not share state (auth tokens, settings, history, sessions, agent memory, plans, cron tasks, uploads) with the upstream product. Renaming the roots achieves full isolation in one stroke. The user has explicitly confirmed: (a) no compat fallback to old paths; (b) engineering/build config files are not in scope.

### 2.1 Scope Boundaries (explicit)

**In scope** — on-disk configuration paths and names visible to users:
- User-level config home dir `~/.claude` → `~/.kode`
- Project-level config dir `.claude/` (inside a project) → `.kode/`
- Global config file `~/.claude.json` / `.claude-{suffix}.json` → `~/.kode.json` / `.kode-{suffix}.json`
- Legacy fallback file `.config.json` inside the config home → removed (no compat)
- Memory files `CLAUDE.md` / `CLAUDE.local.md` → `KODE.md` / `KODE.local.md`
- MCP config file `.mcp.json` → `.kode.mcp.json`
- Managed rules subdir `<managed>/.claude/rules` → `<managed>/.kode/rules`
- Env var `CLAUDE_CONFIG_DIR` → `KODE_CONFIG_DIR`
- MDM/managed platform directory base name `ClaudeCode` → `KodeCode` (macOS `/Library/Application Support/KodeCode`, Windows `C:\Program Files\KodeCode`, Linux `/etc/kode-code`)

**Out of scope** — explicitly NOT renamed:
- **`CLAUDE_CODE_*` environment variables** (866 occurrences). These are runtime behavior flags (e.g. `CLAUDE_CODE_SIMPLE`, `CLAUDE_CODE_MANAGED_SETTINGS_PATH`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), not configuration *file paths/names*. Renaming them is a separate, much larger task. Exception: `CLAUDE_CONFIG_DIR` is renamed because it directly names the config home.
- **Engineering/build config files**: `tsconfig.json`, `package.json`, `desktop/vite.*.config.ts`, `electron-builder.json`, `bunfig.toml`, `.gitignore`, etc.
- **`.claude-plugin/` directory** (plugin manifest packaging convention used by plugin marketplaces: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`). This is an external packaging format analogous to `node_modules/` for npm, not a user config file. Renaming it would break interop with any existing plugin marketplace repos and is intentionally excluded.
- **Analytics event/proto types** such as `src/types/generated/events_mono/claude_code/v1/...` — generated telemetry schema, not config.
- **OAuth URLs** (`beacon.claude-ai.staging.ant.dev`) and VS Code extension IDs (`anthropic.claude-code`) — these are service endpoints / marketplace IDs, not config file paths.
- **`cowork_settings.json` and similar internal filenames inside `~/.kode/`** — per the user's mapping table, only the *directory prefix* changes; internal file names stay as-is.

## 3. Proposed Solution

### 3.1 Overview

The codebase already centralizes most path derivation behind three functions. Renaming at these chokepoints propagates to ~150+ callers automatically:

1. `getClaudeConfigHomeDir()` (`src/utils/envUtils.ts`) — returns `~/.claude`. This is the root for the vast majority of user-level paths (history, projects, plans, debug, ide, uploads, keybindings, agent-memory user scope, workflows user scope, skills user scope, release-notes cache, paste store, auto-updater lock, etc.).
2. `getGlobalClaudeFile()` (`src/utils/env.ts`) — returns `~/.claude{suffix}.json` (with a legacy `.config.json` fallback).
3. `getManagedFilePath()` (`src/utils/settings/managedPath.ts`) — returns the MDM platform dir (`/Library/Application Support/ClaudeCode` etc.). Managed rules/skills/settings live under `<managed>/.claude/...`.

Layered on top of these are the **project-level `.claude/` segments** and the **memory/MCP filename literals** (`CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json`), which are passed as string literals to `join()` at ~25 call sites. These cannot be fixed by changing a single function — they must each be edited, but they are low-risk mechanical replacements.

### 3.2 Implementation Strategy

**Step A — Rename the three source functions (batch effect):**

| Function | File | Current | New |
|---|---|---|---|
| `getClaudeConfigHomeDir` | `src/utils/envUtils.ts:7-14` | `process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')` | `process.env.KODE_CONFIG_DIR ?? join(homedir(), '.kode')` |
| `getGlobalClaudeFile` | `src/utils/env.ts:14-26` | legacy `.config.json` fallback + `.claude{suffix}.json` under `CLAUDE_CONFIG_DIR \|\| homedir()` | drop legacy `.config.json` branch; filename `.kode{suffix}.json`; env var `KODE_CONFIG_DIR` |
| `getManagedFilePath` | `src/utils/settings/managedPath.ts:8-25` | `ClaudeCode` / `/etc/claude-code` | `KodeCode` / `/etc/kode-code` |

The function **names** (`getClaudeConfigHomeDir`, `getGlobalClaudeFile`, `getManagedFilePath`) may be kept as-is to limit churn, OR renamed to `getKodeConfigHomeDir` / `getKodeGlobalFile` / `getKodeManagedFilePath`. **Recommended: rename them** for consistency and to make grep for the new brand effective; the rename is mechanical across all importers. (See Key Decisions.)

The memoization key in `getClaudeConfigHomeDir` must change from `() => process.env.CLAUDE_CONFIG_DIR` to `() => process.env.KODE_CONFIG_DIR`.

`src/utils/swarm/spawnUtils.ts:105` passes `'CLAUDE_CONFIG_DIR'` to child processes — must be updated to `'KODE_CONFIG_DIR'` so swarm children resolve the same home dir.

`desktop/main/agents.ts:815` reads `env.CLAUDE_CONFIG_DIR` directly — change to `KODE_CONFIG_DIR`.

`src/utils/secureStorage/macOsKeychainHelpers.ts:33` checks `!process.env.CLAUDE_CONFIG_DIR` to detect default dir — change to `KODE_CONFIG_DIR`.

Test files `desktop/tests/workflowCommand.test.ts` and `desktop/tests/agents.test.ts` set/restore `CLAUDE_CONFIG_DIR` — update to `KODE_CONFIG_DIR`.

**Step B — Introduce a central project-dir constant (recommended):**

Project-level `.claude` is scattered as the literal `'.claude'` argument to `join()` across ~15 files. To prevent future drift, introduce:

```typescript
// src/utils/envUtils.ts (or a new src/utils/configPaths.ts)
export const KODE_PROJECT_DIR_NAME = '.kode'
export const KODE_MANAGED_SUBDIR = '.kode'   // inside getManagedFilePath()
export function getProjectConfigDir(cwd: string = getCwd()): string {
  return join(cwd, KODE_PROJECT_DIR_NAME)
}
```

Then replace `join(cwd, '.claude', ...)` / `join(getCwd(), '.claude', ...)` call sites with `join(getProjectConfigDir(cwd), ...)`. The literal `.claude` strings inside `markdownConfigLoader.ts` (lines 253, 304, 324, 330) and `loadSkillsDir.ts:84` (managed `.claude` subdir) become `KODE_MANAGED_SUBDIR` / `KODE_PROJECT_DIR_NAME`.

**Step C — Memory filename literals (`CLAUDE.md` / `CLAUDE.local.md`):**

Replace every string literal `'CLAUDE.md'` and `'CLAUDE.local.md'` with the kode equivalents. Define constants in `src/utils/markdownConfigLoader.ts` (or `configPaths.ts`):

```typescript
export const KODE_MD = 'KODE.md'
export const KODE_LOCAL_MD = 'KODE.local.md'
```

Affected logic includes:
- `src/projectOnboardingState.ts:21,35` — `join(getCwd(), 'CLAUDE.md')` and `/init` prompt text.
- `src/utils/markdownConfigLoader.ts` — directory walk reads `CLAUDE.md` per dir; user memory `~/.kode/KODE.md`; managed `~/.kode/KODE.md`.
- `src/utils/claudemd.ts` — the core memory loader; `endsWith('CLAUDE.md')` checks at FileEditTool/FileWriteTool (`src/tools/FileEditTool/FileEditTool.ts:528`, `src/tools/FileWriteTool/FileWriteTool.ts:340`, `src/tools/FileReadTool/FileReadTool.ts`).
- `src/utils/memoryFileDetection.ts:129,274` — exclusion lists and doc comments.
- `src/utils/settings/types.ts:1060` — zod `.describe()` examples string.
- Prompt strings in `src/tools/AgentTool/built-in/*.ts`, `src/commands/init.ts:46,54,133`, `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts:77`.

**Important**: `CLAUDE.md` also appears in **comments and prompt text** throughout. These must be updated for consistency (a grep for `CLAUDE.md` after the change should return zero results outside of `.claude-plugin` and historical/git references). The CLAUDE.md / CLAUDE.local.md that exist in the *repo itself* (project instructions) are not source files of the rename; they are content the user can rename separately — but `src/CLAUDE.md` referenced in code comments (e.g. `src/bridge/replBridge.ts:189`, `src/utils/fileHistory.ts:210`, `src/utils/sessionStorage.ts:5`) should be updated to `KODE.md` since the codebase's own instruction file is being rebranded.

**Step D — MCP filename literal (`.mcp.json` → `.kode.mcp.json`):**

Replace the literal `'.mcp.json'` everywhere it is used as a path segment:

| File | Line | Context |
|---|---|---|
| `src/services/mcp/config.ts` | 89 | `writeMcpjsonFile`: `join(getCwd(), '.mcp.json')` |
| `src/services/mcp/utils.ts` | 268, 287 | `describeMcpConfigFilePath` scope=project |
| `src/utils/permissions/filesystem.ts` | 66 | filesystem permission allowlist entry |
| `src/utils/plugins/mcpPluginIntegration.ts` | 140 | plugin MCP file lookup (`'.mcp.json'` in plugin dir) |
| `src/utils/settings/types.ts` | 406-422, 544 | zod descriptions mentioning `.mcp.json` |
| `src/components/MCPServerMultiselectDialog.tsx` | 73 | UI text |
| `src/components/MCPServerApprovalDialog.tsx` | 63 | UI text |
| `src/commands/init.ts` | 46, 54, 86, 90 | `/init` survey + MCP setup prompts |
| `src/commands/init-verifiers.ts` | 54, 86, 90 | verifier instructions |
| `src/commands/plugin/BrowseMarketplace.tsx` | 687 | comment |
| `src/commands/plugin/PluginErrors.tsx` | 79 | error message |
| `src/cli/handlers/mcp.tsx` | 102, 361 | CLI output text |
| `src/main.tsx` | 1812, 2797, 3930, 3936, 3959, 4356 | CLI option/command descriptions and `--bare` doc |
| `src/utils/plugins/schemas.ts` | 541, 547 | zod descriptions |
| `src/utils/json.ts` | 22 | comment |
| `src/interactiveHelpers.tsx` | 155 | comment |

Note: the **managed MCP** file `managed-mcp.json` (inside `getManagedFilePath()`) keeps its internal filename; only the enclosing managed dir name changes via Step A. `managed-mcp.json` is not a `.mcp.json` variant.

**Step E — Global config filename `.claude.json` / `.claude-{suffix}.json`:**

Handled by Step A (`getGlobalClaudeFile` returns `.kode{suffix}.json`). Doc/comment references to `~/.claude.json` in the following files must be updated to `~/.kode.json`:
- `src/migrations/resetAutoModeOptInForDefaultOffer.ts:15`
- `src/tools/ConfigTool/prompt.ts:62`
- `src/utils/managedEnv.ts:133`
- `src/utils/json.ts:27`
- `src/utils/caCertsConfig.ts:31,55`
- `src/utils/auth.ts:690,768,958,1952`
- `src/utils/config.ts:880,1219`

**Step F — Permission patterns and dangerous-dir lists:**

`src/tools/FileEditTool/constants.ts:5,8` defines:
```typescript
export const CLAUDE_FOLDER_PERMISSION_PATTERN = '/.claude/**'
export const GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN = '~/.claude/**'
```
Rename constants to `KODE_FOLDER_PERMISSION_PATTERN` / `GLOBAL_KODE_FOLDER_PERMISSION_PATTERN` and values to `'/.kode/**'` / `'~/.kode/**'`. Update all importers.

`src/utils/permissions/filesystem.ts` lines 110, 114, 230, 610, 1276, 1307 contain `.claude/skills`, `.claude/commands`, `.claude/agents` literals in permission prefix matching and docs — update to `.kode`.

`src/utils/sandbox/sandbox-adapter.ts:247-249` references `.claude/skills`, `.claude/commands`, `.claude/agents` as dangerous dirs — update to `.kode`.

`src/utils/skills/skillChangeDetector.ts:175,186` reference `~/.claude/skills` and `~/.claude/commands` in comments — update (these paths come from `getClaudeConfigHomeDir` already, so only comments need fixing).

`src/utils/hooks/skillImprovement.ts:197` comment — update.

### 3.3 Architecture / Flow

```
                    KODE_CONFIG_DIR (env, optional)
                              │
                              ▼
                 getKodeConfigHomeDir()  ──┐
                   (was getClaudeConfigHomeDir)  │ returns ~/.kode
                              │              │
       ┌──────────────────────┼──────────────┼──────────────┐
       ▼                      ▼              ▼              ▼
  history.jsonl          projects/       plans/         uploads/
  keybindings.json       (sessions)     debug/         teams/ tasks/
  agent-memory/          releaseNotes    ide/           .update.lock
  workflows/             cache/          pasteStore     ...
  skills/  commands/  agents/  rules/  (all derived from home dir)
                              │
                              ▼
                    getKodeGlobalFile()
                   (was getGlobalClaudeFile)
                      → ~/.kode{suffix}.json
                      (legacy .config.json branch removed)

          Project-level paths (literal '.kode' segment):
            join(cwd, '.kode', 'workflows'|'agent-memory'|...)
            join(cwd, '.kode', 'scheduled_tasks.json'|'.lock')
            join(repoRoot, '.kode', 'worktrees')

          Memory files: KODE.md / KODE.local.md  (per project dir + ~/.kode/)
          MCP file:     .kode.mcp.json           (per project dir)

          Managed (MDM):
            getKodeManagedFilePath() → /Library/Application Support/KodeCode
            <managed>/.kode/rules|skills|managed-settings.json|managed-mcp.json
```

### 3.4 Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Rename the three source function names? | **Yes** — `getClaudeConfigHomeDir`→`getKodeConfigHomeDir`, `getGlobalClaudeFile`→`getKodeGlobalFile`, `getManagedFilePath`→`getKodeManagedFilePath` | Keeps grep-ability of the new brand; avoids a "claude" name surviving in the API surface. Mechanical rename across importers. |
| Introduce a central `configPaths` module? | **Yes** — add `KODE_PROJECT_DIR_NAME`, `KODE_MANAGED_SUBDIR`, `KODE_MD`, `KODE_LOCAL_MD`, `getProjectConfigDir()` in `src/utils/configPaths.ts`, re-export from `envUtils.ts`. | ~15 sites use the literal `'.claude'` in `join()`. A constant prevents future drift and gives one grep target. Cheap to introduce; the alternative (pure find/replace of literals) leaves the same drift risk that caused this task in the first place. |
| Keep legacy `.config.json` fallback in `getGlobalClaudeFile`? | **No — remove it.** | User explicitly required no backward-compat with upstream. The `.config.json` branch is a pre-`~/.claude.json` legacy; removing it is a clean break. |
| Rename `CLAUDE_CODE_*` env vars? | **No.** | 866 occurrences; these are runtime behavior flags, not config file paths/names. Out of scope per the user's explicit boundary. Renaming them is a separate large task with its own risk profile. |
| Rename `.claude-plugin/` plugin manifest dir? | **No.** | It is an external plugin packaging convention (like `node_modules`), not a user config file. Renaming breaks interop with any existing plugin marketplace repos without benefit to config isolation. |
| Rename managed platform dir `ClaudeCode`→`KodeCode`? | **Yes.** | Full decoupling from upstream; MDM-managed settings (`managed-settings.json`, `managed-mcp.json`, `managed-settings.d/`, `.kode/rules`, `.kode/skills`) must not collide with an upstream install's managed dir. Since the fork does not need to read upstream-managed settings, a clean rename is safe. |
| Update `CLAUDE.md` references in comments/prompt text? | **Yes.** | A grep for `CLAUDE.md` post-change must return zero results (excluding `.claude-plugin` and git history). Mixed branding in docs/prompts is confusing and would re-introduce the old name into generated output. |
| Rename the project's own `CLAUDE.md` / `CLAUDE.local.md` files in the repo? | **Yes**, rename repo-level instruction files to `KODE.md` / `KODE.local.md` so the dogfooded fork uses its own convention. | Consistency; the code loads `KODE.md` going forward, so the repo's instruction file must match. |

## 4. Affected Files

> Representative paths grouped by module. "Source-fn" = changes to the central source function (high blast radius). "Literal" = mechanical literal replacement.

### New Files
- `src/utils/configPaths.ts` — central constants (`KODE_PROJECT_DIR_NAME`, `KODE_MANAGED_SUBDIR`, `KODE_MD`, `KODE_LOCAL_MD`, `getProjectConfigDir`).

### Source-fn renames (highest leverage)
- `src/utils/envUtils.ts` — `getClaudeConfigHomeDir`→`getKodeConfigHomeDir`; `.claude`→`.kode`; `CLAUDE_CONFIG_DIR`→`KODE_CONFIG_DIR` (return + memoize key).
- `src/utils/env.ts` — `getGlobalClaudeFile`→`getKodeGlobalFile`; drop `.config.json` legacy; filename `.kode{suffix}.json`; env var `KODE_CONFIG_DIR`.
- `src/utils/settings/managedPath.ts` — `getManagedFilePath`→`getKodeManagedFilePath`; `ClaudeCode`→`KodeCode`, `/etc/claude-code`→`/etc/kode-code`.

### Env var usages (CLAUDE_CONFIG_DIR → KODE_CONFIG_DIR)
- `src/utils/envUtils.ts`, `src/utils/env.ts`, `src/memdir/paths.ts`, `src/utils/swarm/spawnUtils.ts:105`, `src/utils/secureStorage/macOsKeychainHelpers.ts:33`, `src/utils/localInstaller.ts:17`, `src/utils/sessionStorage.ts:491`, `src/utils/concurrentSessions.ts:197`, `src/utils/model/modelCapabilities.ts:60`, `src/hooks/fileSuggestions.ts`, `src/commands/insights.ts:419`, `src/services/analytics/firstPartyEventLoggingExporter.ts:43`, `desktop/main/agents.ts:815`, `desktop/tests/workflowCommand.test.ts`, `desktop/tests/agents.test.ts`.

### Markdown config loader & memory (CLAUDE.md → KODE.md, .claude → .kode)
- `src/utils/markdownConfigLoader.ts` (lines 253, 304, 324, 330 — `.claude` segment; `CLAUDE_CONFIG_DIRECTORIES` constant name optionally kept, comment-only)
- `src/utils/claudemd.ts` (~25 occurrences; core memory loader; consider renaming module to `kodemd.ts` — optional, recommend yes for brand consistency)
- `src/projectOnboardingState.ts:21,35`
- `src/utils/memoryFileDetection.ts:129,274`
- `src/utils/attachments.ts` (comments referencing CLAUDE.md)
- `src/utils/hooks.ts:4323-4324`
- `src/tools/FileEditTool/FileEditTool.ts:528`, `src/tools/FileWriteTool/FileWriteTool.ts:340`
- `src/tools/FileReadTool/FileReadTool.ts` (CLAUDE.md log/comment refs)
- `src/utils/doctorContextWarnings.ts:57-58`
- `src/utils/settings/types.ts:1060` (zod example string)
- Prompt/comment references in `src/tools/AgentTool/built-in/{claudeCodeGuideAgent,planAgent,exploreAgent,verificationAgent}.ts`, `src/tools/AgentTool/{loadAgentsDir,runAgent}.ts`, `src/commands/init.ts`, `src/commands/init-verifiers.ts`, `src/constants/prompts.ts`, `src/memdir/memoryTypes.ts`, `src/utils/sideQuestion.ts`, `src/utils/analyzeContext.ts`, `src/utils/fileHistory.ts`, `src/bootstrap/state.ts`, `src/bridge/*`, `src/utils/log.ts`.

### MCP config (.mcp.json → .kode.mcp.json)
- `src/services/mcp/config.ts:89`, `src/services/mcp/utils.ts:268,287`, `src/utils/permissions/filesystem.ts:66`, `src/utils/plugins/mcpPluginIntegration.ts:140`, `src/utils/settings/types.ts:406-422,544`, `src/components/MCPServerMultiselectDialog.tsx:73`, `src/components/MCPServerApprovalDialog.tsx:63`, `src/cli/handlers/mcp.tsx:102,361`, `src/commands/init.ts`, `src/commands/init-verifiers.ts`, `src/commands/plugin/{BrowseMarketplace,PluginErrors}.tsx`, `src/utils/plugins/schemas.ts:541,547`, `src/utils/json.ts:22`, `src/interactiveHelpers.tsx:155`, `src/main.tsx` (option/command descriptions at 1812, 2797, 3930, 3936, 3959, 4356).

### Global config file comments (~/.claude.json → ~/.kode.json)
- `src/migrations/resetAutoModeOptInForDefaultOffer.ts:15`, `src/tools/ConfigTool/prompt.ts:62`, `src/utils/managedEnv.ts:133,140`, `src/utils/json.ts:27`, `src/utils/caCertsConfig.ts:31,55,56,63`, `src/utils/auth.ts:690,768,958,1952`, `src/utils/config.ts:880,1219`, `src/utils/caCertsConfig.ts`.

### Project-level `.claude` literal segments → `.kode` (via `getProjectConfigDir` / `KODE_PROJECT_DIR_NAME`)
- `src/tools/WorkflowTool/createWorkflowCommand.ts:66`
- `src/tools/AgentTool/agentMemory.ts:43,59,80,97`
- `src/tools/AgentTool/agentMemorySnapshot.ts:32`
- `src/utils/cronTasks.ts:74,170`, `src/utils/cronTasksLock.ts:23`
- `src/utils/worktree.ts:205`
- `src/utils/completionCache.ts:27` (this is `join(home,'.claude')` — replace with `getKodeConfigHomeDir()`)
- `src/skills/loadSkillsDir.ts:84` (managed `.claude` subdir → `KODE_MANAGED_SUBDIR`)
- `src/utils/markdownConfigLoader.ts:253,304,324,330`
- `src/utils/permissions/filesystem.ts:110,114,230,610,1276,1307`
- `src/tools/FileEditTool/constants.ts:5,8` (permission pattern constants)
- `src/utils/sandbox/sandbox-adapter.ts:247-249`
- `src/utils/hooks/skillImprovement.ts:197`, `src/utils/skills/skillChangeDetector.ts:175,186`

### User-level derived dirs (auto-fixed by Step A; comment-only touch-ups)
- `src/history.ts:115,299` (history.jsonl — via `getKodeConfigHomeDir`)
- `src/keybindings/loadUserBindings.ts:116` (keybindings.json)
- `src/bridge/inboundAttachments.ts:61` (uploads)
- `src/utils/releaseNotes.ts:38` (cache/changelog.md)
- `src/utils/asciicast.ts:36,57,87` (projects)
- `src/utils/sessionStoragePortable.ts:326,390` (projects)
- `src/utils/plans.ts:94,100` (plans)
- `src/utils/debug.ts:234,240` (debug)
- `src/utils/ide.ts:463` (ide)
- `src/utils/autoUpdater.ts:169,232` (.update.lock)
- `src/utils/pasteStore.ts:14` (paste store)
- `src/utils/fileHistory.ts:734,954`
- `src/utils/memoryFileDetection.ts:43,189,216`
- `src/memdir/paths.ts:89`
- `src/tools/FileReadTool/FileReadTool.ts:198,208,216` (session memory/projects)
- `src/tools/WorkflowTool/createWorkflowCommand.ts:67` (user workflows)
- `src/server/types.ts:43` (server-sessions.json comment)

### Repo-level instruction files (rename)
- `CLAUDE.md` → `KODE.md`
- `CLAUDE.local.md` → `KODE.local.md` (if present)
- `AGENTS.md` reference to `CLAUDE.md` should be updated.

## 5. Interface / API Changes

### 5.1 Function Signatures

```typescript
// src/utils/envUtils.ts  (renamed export)
export const getKodeConfigHomeDir = memoize(
  (): string => (process.env.KODE_CONFIG_DIR ?? join(homedir(), '.kode')).normalize('NFC'),
  () => process.env.KODE_CONFIG_DIR,
)

// src/utils/env.ts  (renamed export)
export const getKodeGlobalFile = memoize((): string => {
  // Legacy .config.json fallback REMOVED — no backward compat.
  const filename = `.kode${fileSuffixForOauthConfig()}.json`
  return join(process.env.KODE_CONFIG_DIR || homedir(), filename)
})

// src/utils/settings/managedPath.ts  (renamed export)
export const getKodeManagedFilePath = memoize(function (): string {
  if (process.env.USER_TYPE === 'ant' && process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH) {
    return process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
  }
  switch (getPlatform()) {
    case 'macos':  return '/Library/Application Support/KodeCode'
    case 'windows': return 'C:\\Program Files\\KodeCode'
    default: return '/etc/kode-code'
  }
})

// src/utils/configPaths.ts  (NEW)
export const KODE_PROJECT_DIR_NAME = '.kode'
export const KODE_MANAGED_SUBDIR  = '.kode'
export const KODE_MD              = 'KODE.md'
export const KODE_LOCAL_MD        = 'KODE.local.md'
export function getProjectConfigDir(cwd: string = getCwd()): string {
  return join(cwd, KODE_PROJECT_DIR_NAME)
}
```

### 5.2 Data Structures

No data-structure shape changes. `GlobalConfig` / `ProjectConfig` / `SettingsJson` schemas are unchanged; only the *file paths* they load from change.

### 5.3 Config / Environment Variables

| Old | New | Notes |
|---|---|---|
| `CLAUDE_CONFIG_DIR` | `KODE_CONFIG_DIR` | Honored by `getKodeConfigHomeDir`, `getKodeGlobalFile`, swarm spawn env, keychain default-dir check, tests. |
| `~/.claude` | `~/.kode` | Default config home. |
| `~/.claude.json` / `.claude-{suffix}.json` | `~/.kode.json` / `.kode-{suffix}.json` | Global config (auth/state). |
| `~/.claude/.config.json` (legacy) | (removed) | No backward-compat. |
| `<project>/.claude/` | `<project>/.kode/` | Project config dir. |
| `CLAUDE.md` / `CLAUDE.local.md` | `KODE.md` / `KODE.local.md` | Per-dir memory files + `~/.kode/KODE.md`. |
| `.mcp.json` | `.kode.mcp.json` | Project MCP config. |
| `~/.claude/rules/`, `<project>/.claude/rules/`, `<managed>/.claude/rules/` | `~/.kode/rules/`, `<project>/.kode/rules/`, `<managed>/.kode/rules/` | Managed rules. |
| Managed base dirs `ClaudeCode` / `/etc/claude-code` | `KodeCode` / `/etc/kode-code` | MDM platform dirs. |

### 5.4 User-visible CLI behavior

- `--bare` / `--print` etc. CLI option descriptions that mention `.mcp.json`, `CLAUDE.md`, `~/.claude` in their help text are updated to the kode names. No flag semantics change.
- The `claude mcp list|get|reset-project-choices` and `claude doctor` descriptions referencing `.mcp.json` are updated.
- `claude up` (ant-only) description referencing `CLAUDE.md` updated.

## 6. Testing Plan

### 6.1 Grep residue verification (automatable, mandatory gate)

After implementation, the following greps must return **zero** results (excluding `node_modules`, `.git`, and the `.claude-plugin` manifest dir which is intentionally out of scope):

```bash
# No old config home / project dir literals (excluding .claude-plugin and comments about it)
grep -rn "\.claude\b" --include="*.ts" --include="*.tsx" src desktop \
  | grep -v node_modules | grep -v "\.claude-plugin"
# → expect 0

# No old env var
grep -rn "CLAUDE_CONFIG_DIR" --include="*.ts" --include="*.tsx" src desktop | grep -v node_modules
# → expect 0

# No old memory filenames
grep -rn "CLAUDE\.md\|CLAUDE\.local\.md" --include="*.ts" --include="*.tsx" src desktop | grep -v node_modules
# → expect 0

# No old MCP filename
grep -rn "\.mcp\.json" --include="*.ts" --include="*.tsx" src desktop | grep -v node_modules | grep -v managed-mcp
# → expect 0

# No old global config filename (excluding .claude-plugin and .claude-{suffix} plugin naming)
grep -rn "\.claude\.json\|\.claude-" --include="*.ts" --include="*.tsx" src desktop | grep -v node_modules | grep -v "\.claude-plugin"
# → expect 0

# New names present
grep -rn "getKodeConfigHomeDir\|KODE_CONFIG_DIR\|KODE_MD\|\.kode\b" --include="*.ts" --include="*.tsx" src | head
# → expect non-empty
```

### 6.2 Unit / existing tests

- Update `desktop/tests/workflowCommand.test.ts` and `desktop/tests/agents.test.ts` to set/restore `KODE_CONFIG_DIR` instead of `CLAUDE_CONFIG_DIR`. Tests must pass unchanged in semantics.
- `src/utils/sessionStorage.ts:491` comment about tests with different `CLAUDE_CONFIG_DIR` values — update env var name; existing test isolation logic still works via the new env var.
- Run the existing test suite: `bun test` (or the project's configured test command). All tests that exercise `getKodeConfigHomeDir` via a temp `KODE_CONFIG_DIR` must still pass.

### 6.3 Build verification

- `bun run build` (or `bun build` / the repo's build script) must succeed with no type errors from the renames.
- `tsc --noEmit` (if configured) passes.

### 6.4 Smoke tests (manual)

1. **Clean slate**: with no `KODE_CONFIG_DIR` set, run the CLI in a temp cwd. Verify `~/.kode/` is created (not `~/.claude`). Verify `~/.kode.json` (or `.kode-{suffix}.json`) is the global config file.
2. **Project config**: in a temp project, create `<cwd>/.kode/settings.json` and confirm the CLI reads it. Confirm `<cwd>/.claude/settings.json` is **not** read.
3. **KODE.md**: place a `KODE.md` in a temp project; run `--print "what conventions exist?"` and confirm its content is injected. A leftover `CLAUDE.md` must be ignored.
4. **MCP**: create `<cwd>/.kode.mcp.json` with a stdio server; run `claude mcp list` and confirm it is discovered. A `.mcp.json` must not be discovered.
5. **KODE_CONFIG_DIR**: set `KODE_CONFIG_DIR=/tmp/kode-home` and confirm all user-level state (history, sessions, plans) lands there.
6. **Env var isolation**: confirm launching without `KODE_CONFIG_DIR` and without `CLAUDE_CONFIG_DIR` yields identical behavior (no fallback read of `CLAUDE_CONFIG_DIR`).
7. **Managed path**: on macOS, confirm `/Library/Application Support/KodeCode` is the managed base (requires appropriate permissions / ant mode for the `CLAUDE_CODE_MANAGED_SETTINGS_PATH` override path to still work — that env var stays as-is per boundary).

### 6.5 Edge cases

- Symlinks pointing at old `~/.claude` paths: out of scope; user must migrate manually (documented in release notes — not part of code).
- Existing user `~/.claude` data is not auto-migrated (explicit no-compat decision). Document in user-facing release notes.
- `getClaudeConfigHomeDir` memoize key must use the new env var; verify tests that change the env var still get a fresh value.

## 7. Risks & Alternatives

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Missed literal `'.claude'` / `'CLAUDE.md'` / `'.mcp.json'` in some file | Path still resolves to old name; partial migration breaks config isolation | Enforce the grep gates in §6.1 in CI as a hard-fail check before merge. |
| `CLAUDE_CODE_*` env vars retained while config renamed → user confusion about which "claude" vars still apply | Mild user surprise | Document explicitly in release notes: only `CLAUDE_CONFIG_DIR`→`KODE_CONFIG_DIR` changed; all `CLAUDE_CODE_*` runtime flags are unchanged. |
| Managed platform dir rename (`ClaudeCode`→`KodeCode`) means MDM-deployed settings under the old path are ignored | Enterprise users lose managed settings until redeployed | Acceptable for a fork with no-compat requirement. Document in release notes. The `CLAUDE_CODE_MANAGED_SETTINGS_PATH` ant-only override still works and is unchanged. |
| Renaming function exports (`getClaudeConfigHomeDir`→`getKodeConfigHomeDir`) touches ~60 import sites | Larger diff, but purely mechanical | Low risk; grep-driven rename. A codemod or IDE rename handles it in one pass. |
| `.claude-plugin/` deliberately left as-is | Brand inconsistency in plugin repos | Accepted trade-off: it is a packaging format, not a user config file. Documented in §2.1. |
| Code comments / prompt strings still mentioning `CLAUDE.md` could re-inject the old name into LLM output | Brand leakage in agent prompts | §3.2 Step C requires updating prompt/comment occurrences; the grep gate in §6.1 catches stragglers. |
| `src/utils/claudemd.ts` module name retains "claude" | Minor brand leak in source tree | Recommend renaming module to `kodemd.ts` and updating importers. Optional but consistent with the function-rename decision. |

### Alternatives Considered

1. **Pure find/replace of literals without a central `configPaths` module.** Rejected as the primary approach: it solves the immediate rename but leaves the same scattered-literal pattern that caused drift risk. Instead, the central `configPaths.ts` module is introduced for the project-level segment while still doing literal replacement where literals are unavoidable (e.g. `endsWith('CLAUDE.md')`). For the home dir, the existing `getKodeConfigHomeDir` chokepoint already provides centralization.
2. **Keep backward-compat read of old paths.** Explicitly rejected by the user. No fallback logic is added; the legacy `.config.json` branch in `getGlobalClaudeFile` is removed.
3. **Rename `CLAUDE_CODE_*` env vars too.** Rejected: out of scope (866 occurrences, runtime flags not config paths), and a separate task with its own risk profile.
4. **Rename `.claude-plugin/` manifest dir.** Rejected: external packaging convention, not a user config file; renaming breaks plugin marketplace interop without benefiting config isolation.

## 8. Open Questions

All questions resolved at design time:

- [x] Keep function names or rename? → **Rename** (`getKodeConfigHomeDir` / `getKodeGlobalFile` / `getKodeManagedFilePath`).
- [x] Introduce `configPaths.ts`? → **Yes**, for project-level `.kode` segment + memory/MCP filename constants.
- [x] Keep legacy `.config.json` fallback? → **No**, removed per no-compat requirement.
- [x] Rename managed platform dir? → **Yes**, `ClaudeCode`→`KodeCode`.
- [x] Rename `CLAUDE_CODE_*` env vars? → **No**, out of scope.
- [x] Rename `.claude-plugin/`? → **No**, out of scope (external packaging format).
- [x] Rename `src/utils/claudemd.ts` module? → **Yes, recommended** (`kodemd.ts`), for brand consistency; implementation agent should update all importers.
- [x] Auto-migrate existing `~/.claude` user data? → **No**, no-compat; documented in release notes.

No blocking open questions remain.
