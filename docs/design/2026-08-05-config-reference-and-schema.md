# Design Document: Config Reference Docs + GlobalConfig Schema

- **Date**: 2026-08-05
- **Author**: architect
- **Status**: Draft
- **Related Issues/PRs**: follows `docs/design/2026-08-05-kode-config-rename.md`

---

## 1. Summary

Deliver a complete configuration reference for the Kode CLI by (A) authoring six Markdown docs under `docs/config/` covering all five configuration surfaces (`.kode/settings.json`, `.kode.mcp.json`, `~/.kode.json`, `KODE.md`, and CLI flags), and (B) adding a non-breaking zod schema for `GlobalConfig` plus filling in missing `.describe()` on `SettingsSchema` fields. No user-visible behavior changes.

---

## 2. Problem / Motivation

- **No configuration reference exists.** The repo has `docs/design/2026-08-05-kode-config-rename.md` (rename log) but no user-facing reference enumerating every field, its type, default, allowed values, and source. Users grep source to configure Kode.
- **`GlobalConfig` has no zod validation.** `src/utils/config.ts` (1817 lines) does not import zod; `getConfig` (lines 1421-1462) loads `~/.kode.json` via `jsonParse` and returns `{ ...createDefault(), ...parsedConfig }` (line ~1440) with no shape check. Unknown/malformed keys are silently merged.
- **`SettingsSchema` descriptions are incomplete and defaults are implicit.** `src/utils/settings/types.ts` (1148 lines) defines `SettingsSchema` via `lazySchema` starting at line 255, with `.passthrough()` at lines 84 and 1072. Audit confirms **0** `.default()` calls and **121** `.describe()` calls — many fields lack descriptions, and where defaults exist they live in `createDefaultGlobalConfig` / loader defaults rather than the schema, so `--help`-style introspection is impossible.
- **Enum/default drift.** Permission modes (`src/types/permissions.ts:16-22`) and CLI choices (`src/main.tsx:968-1006`) are stringly typed; docs risk divergence without a concrete cross-check.

**Desired behavior:** a single navigable reference, plus schema-backed validation that surfaces corruption without breaking startup.

---

## 3. Proposed Solution

### 3.1 Overview

Two workstreams:

- **A. Docs** — new `docs/config/` directory with six Markdown files (README index + five topical pages), each field table cross-checked against the named source file.
- **B. Schema** — new `src/utils/configSchema.ts` exporting `GlobalConfigSchema` (a `lazySchema`), wired into `getConfig` with **fail-open** semantics; and conservative `.describe()` additions to `src/utils/settings/types.ts`.

### 3.2 Architecture / Flow

```
~/.kode.json ─┐
              ├─ getConfig() ─ jsonParse ─ GlobalConfigSchema().safeParse (log-only) ─ merge with createDefault() ─ GlobalConfig
settings sources ─ SettingsSchema (passthrough) ─ merge by source (plugin→user→project→local→policy→flag)
CLI flags ─ commander → bootstrap/state.ts → flagSettings layer (highest precedence)
```

Docs are purely additive; the schema call sits between `jsonParse` and the existing spread merge, with `safeParse` so failures never throw.

### 3.3 Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Doc layout | Six files under `docs/config/`, indexed by `README.md` | One page per surface stays scannable; index enables discoverability from `docs/README.md` |
| Field table columns | 8 columns: field \| type \| default \| enum/range \| description \| required \| deprecated/internal \| example | Matches the existing richness of `SettingsSchema` (types, deprecation markers) without losing the example column users actually want |
| `GlobalConfig` validation | `safeParse`, log via `logForDebugging`, return original `parsedConfig` on failure | A corrupted `~/.kode.json` must NOT break startup; validation is diagnostic only. Mirrors the existing `ConfigParseError`-only-on-JSON-syntax policy |
| Unknown keys in `GlobalConfigSchema` | `.passthrough()` on the outer object | `~/.kode.json` historically accepts plugin-injected keys; strict stripping would be a behavior change |
| Settings `.default()` | Do NOT add any `.default()` | Adding defaults changes multi-source merge semantics (defaults would shadow higher-precedence sources in some branches). Only add `.describe()` |
| Deprecation marking | Prefix description with `[已废弃]` / `[DEPRECATED]` in both schema description and docs table | Single source of truth, surfaced wherever descriptions render |
| Doc/code consistency | Hand-maintained docs + optional grep-based check script (not auto-generated) | Source strings are human-curated; auto-generation would lose prose context. The check script greps field names against the schema to catch additions |
| Hidden CLI flags | Separate "Internal / hidden flags" subsection in `cli.md` | `.hideHelp()` flags are real and documented for internal use; hiding them entirely from docs causes more confusion than it solves |

### 3.4 Detailed Solution

#### A. Documentation deliverables (`docs/config/`)

All field tables use **8 columns**: `字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例`.

**A1. `docs/config/README.md`** — Index page.
- Configuration sources overview table (file path, scope, persisted, editable via `/config`, link to detail page).
- Merge precedence diagram: `flag > policy > local > project > user > plugin` (cross-reference `SettingSource` values from `src/types/permissions.ts:50+`).
- "User-configurable vs internal" explainer pointing to `GLOBAL_CONFIG_KEYS` whitelist (`src/utils/config.ts:627-667`).
- Deep links into the five topical pages.

**A2. `docs/config/settings.md`** — `.kode/settings.json`.
- Cross-reference `src/utils/settings/types.ts` `SettingsSchema` (lines 255-1072, ~80 fields after nested expansion).
- File location table (managed/user/project/local/policy) and merge semantics (`.passthrough()` at types.ts:84,1072 preserves unknown keys).
- Full field table grouped by section (permissions, env, hooks, mcp, etc.).
- Detailed callouts for `permissions.defaultMode`, `permissions.allow/deny`, `hooks`, `env`, `model`, `apiKeyHelper`.

**A3. `docs/config/mcp.md`** — `.kode.mcp.json`.
- Cross-reference `src/services/mcp/types.ts`.
- Transport union enumeration (types.ts:23-26 base enum + per-config schemas at types.ts:28, 58, 69, 79, 89, 99, 108, 116):
  - `stdio`, `sse`, `sse-ide`, `http`, `ws`, `sdk`, `claudeai-proxy`
  - Note: `ws-ide` exists in `McpWebSocketIDEServerConfigSchema` (types.ts:79-88) but is not in the base `TransportSchema` enum — document as a per-schema variant.
- Scope enum (`ConfigScopeSchema`, types.ts:10-19): `local | user | project | dynamic | enterprise | claudeai | managed`.
- Per-server approve/reject lifecycle (project scope servers from `.kode.mcp.json`).

**A4. `docs/config/global.md`** — `~/.kode.json`.
- Cross-reference `src/utils/config.ts` `GlobalConfig` type (lines 183-260+) and `createDefaultGlobalConfig` (lines 585-623).
- Explicitly mark each field "user-configurable" (appears in `GLOBAL_CONFIG_KEYS`, types.ts:627-667) vs "internal/runtime-state" (e.g. `numStartups`, `cachedStatsigGates`, `tipsHistory`, `oauthAccount`).
- Recommend `/config` slash command as the preferred edit path; warn that hand-editing runtime-state fields can corrupt session tracking.
- Note deprecated fields: `apiKeyHelper`, `customNotifyCommand`, `env` (point to `settings.apiKeyHelper`, Notification hook, `settings.env`).

**A5. `docs/config/kode-md.md`** — `KODE.md`.
- Cross-reference `kodemd.ts`, `markdownConfigLoader.ts`, `frontmatterParser.ts`.
- Load order: managed → user → project → local.
- Frontmatter fields (`paths`, `description`, etc.) and `@./path` include directive with max include depth of 5 (from `markdownConfigLoader.ts`).

**A6. `docs/config/cli.md`** — CLI command-line args.
- Cross-reference `src/main.tsx` flags (lines 968-1006 main options, 3817-1006 secondary) and subcommand tree (lines 3900+).
- ~50-flag table, grouped: session, model, permissions, I/O, MCP, debug, IDE, plugin.
- Subcommand table: `mcp` (serve/add/remove/list/get/add-json/add-from-claude-desktop/reset-project-choices), `server`, `ssh`, `open`, `auth` (login/status/logout), `plugin`/`plugins` (validate/list/marketplace/install/uninstall/enable/disable/update), `agents`, `auto-mode` (defaults/config/critique), `remote-control`, `assistant`, `doctor`, `update`.
- Flag → settings mapping table (e.g. `--model` → `settings.model`, `--agent` → `settings.agent`, `--setting-sources` → setting source filter).
- **Key enums (must be exact):**
  - `--permission-mode` = `acceptEdits | bypassPermissions | default | dontAsk | plan` (from `EXTERNAL_PERMISSION_MODES`, `src/types/permissions.ts:16-22`); `auto` is added at runtime only when `feature('TRANSCRIPT_CLASSIFIER')` is enabled (`permissions.ts:30-33`); `bubble` is internal-only and NOT user-addressable (`permissions.ts:25`).
  - `--output-format` = `text | json | stream-json` (main.tsx:976).
  - `--input-format` = `text | stream-json` (main.tsx:983).
  - `--effort` = `low | medium | high | max` (main.tsx:993-999).
  - `--thinking` = `enabled | adaptive | disabled` (main.tsx, hidden via `.hideHelp()`).
- **Deprecated flags subsection:** `--mcp-debug` (use `--debug`), `--max-thinking-tokens` (use `--thinking`), `--dangerously-skip-permissions-with-classifiers` (alias for `--permission-mode auto`), `--afk` (alias for `--permission-mode auto`).
- **Internal / hidden flags subsection** (flags marked `.hideHelp()`): `--init`, `--init-only`, `--maintenance`, `--thinking`, `--max-thinking-tokens`, `--max-turns`, `--max-budget-usd`, `--permission-prompt-tool`, `--system-prompt-file`, `--append-system-prompt-file`, `--prefill`, `--deep-link-origin`, `--deep-link-repo`, `--deep-link-last-fetch`, `--resume-session-at`, `--rewind-files`, `--workload`, `--advisor`, `--delegate-permissions`, `--tasks`, `--enable-auto-mode`, `--assistant`, `--brief`, `--messaging-socket-path`, `--proactive`. Document with a clear "internal — not stable API" banner.
- **ANT-ONLY flags subsection:** `--delegate-permissions`, `--dangerously-skip-permissions-with-classifiers`, `--afk`, `--tasks`, `--agent-teams`, `--enable-auto-mode`, `--assistant`, `--proactive`, `--brief` (guarded behind the `ANT_*` build flag in main.tsx:3819+).

#### B. Code schema deliverables

**B1. `src/utils/configSchema.ts` (new file).**
- Export `GlobalConfigSchema` as a `lazySchema(() => z.object({...}))`.
- Map every field of `GlobalConfig` (`src/utils/config.ts:183-260+`):
  - Primitive scalars → `z.string()/.boolean()/.number().optional()`.
  - `Record<string,string>` (`env`, `tipsHistory`) → `z.record(z.string(), z.string()).optional()`.
  - Nested objects (`customApiKeyResponses`, `oauthAccount`, `projects`, `mcpServers`, `cachedStatsigGates`, etc.) → either a recursive sub-schema or `z.unknown()` / `.passthrough()` to avoid over-constraining complex shapes.
- Every field `.optional()` — do NOT use `.default()`. The merge with `createDefaultGlobalConfig()` already supplies defaults; schema defaults would shadow real values.
- Outer object uses `.passthrough()` to preserve unknown/plugin-injected keys (consistent with `SettingsSchema` policy at types.ts:1072).
- Re-export `GlobalConfigSchema` from `src/utils/config.ts` for callers that want to validate external input.

**B2. Wire into `getConfig` (`src/utils/config.ts:1421-1462`).**
- After `const parsedConfig = jsonParse(stripBOM(fileContent))` (line ~1440), before the `return { ...createDefault(), ...parsedConfig }`:
  ```ts
  const result = GlobalConfigSchema().safeParse(parsedConfig)
  if (!result.success) {
    logForDebugging({ message: 'GlobalConfig validation failed', issues: result.error.issues }, { isError: false })
  }
  return { ...createDefault(), ...parsedConfig }
  ```
- `safeParse`, never `parse`. Return the original `parsedConfig` even on failure — zero behavior change, only diagnostics.
- Add a unit test asserting a malformed `~/.kode.json` (e.g. `numStartups: "not-a-number"`) still loads and logs.

**B3. `src/utils/settings/types.ts` description completion.**
- For each field in `SettingsSchema` (lines 255-1072) that lacks `.describe()`, add one.
- Update `permissions.defaultMode` description to enumerate `EXTERNAL_PERMISSION_MODES` values and note the `auto` feature gate.
- For deprecated fields, prefix description with `[DEPRECATED] <reason>` (e.g. `apiKeyHelper` → "[DEPRECATED] use settings.apiKeyHelper").
- Do NOT add `.default()` anywhere (preserves merge semantics).
- Do NOT remove `.passthrough()` (lines 84, 1072).

**B4. `docs/README.md` navigation.**
- Add a `## Configuration` section linking to `docs/config/README.md` and the five topical pages.

---

## 4. Affected Files

### New Files
- `docs/config/README.md` — config source index + merge precedence overview.
- `docs/config/settings.md` — `.kode/settings.json` field reference.
- `docs/config/mcp.md` — `.kode.mcp.json` transport/scope reference.
- `docs/config/global.md` — `~/.kode.json` reference with user/internal markers.
- `docs/config/kode-md.md` — `KODE.md` load order and frontmatter reference.
- `docs/config/cli.md` — CLI flags + subcommands + enum reference.
- `src/utils/configSchema.ts` — `GlobalConfigSchema` (lazySchema, fail-open validation).

### Modified Files
- `src/utils/config.ts` — import `GlobalConfigSchema`, add `safeParse` + `logForDebugging` in `getConfig` (lines 1421-1462); re-export `GlobalConfigSchema`.
- `src/utils/settings/types.ts` — fill missing `.describe()` on `SettingsSchema` fields (lines 255-1072); prefix deprecated fields with `[DEPRECATED]`; no `.default()`, no `.passthrough()` removal.
- `docs/README.md` — add `## Configuration` navigation block.

### Deleted Files
- None.

---

## 5. Interface / API Changes

### 5.1 New exports

```typescript
// src/utils/configSchema.ts
import { lazySchema } from './lazySchema.js'
import { z } from 'zod/v4'

export const GlobalConfigSchema = lazySchema(() =>
  z.object({
    // every GlobalConfig field, all .optional(), no .default()
    numStartups: z.number().optional(),
    installMethod: z.string().optional(),
    autoUpdates: z.boolean().optional(),
    theme: z.string().optional(),
    preferredNotifChannel: z.string().optional(),
    verbose: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
    customApiKeyResponses: z
      .object({
        approved: z.array(z.string()).optional(),
        rejected: z.array(z.string()).optional(),
      })
      .optional(),
    // ... remaining fields, nested shapes via z.unknown() or sub-schemas
  }).passthrough(),
)
```

```typescript
// src/utils/config.ts (re-export)
export { GlobalConfigSchema } from './configSchema.js'
```

### 5.2 Behavioral contract

- `getConfig` (`src/utils/config.ts:1421`) continues to return `{ ...createDefault(), ...parsedConfig }` unchanged on success AND on schema failure. The only new observable side effect is a debug log entry.
- `SettingsSchema` field descriptions change; `z.infer` type is unaffected (descriptions are runtime metadata only).

### 5.3 No API removals / renames

No public function signatures change. No settings keys are renamed. No CLI flags are added, removed, or renamed.

---

## 6. Testing Plan

### 6.1 Unit Tests
- [ ] `GlobalConfigSchema().safeParse(createDefaultGlobalConfig())` succeeds.
- [ ] `GlobalConfigSchema().safeParse({ numStartups: 'bad', theme: 'dark' })` returns `success: false` with an issue on `numStartups`.
- [ ] `GlobalConfigSchema().passthrough()` preserves an unknown key (e.g. `customPluginData`).
- [ ] `getConfig` on a `~/.kode.json` containing `numStartups: "bad"` returns a merged config (still has `numStartups: "bad"` as-is) and emits exactly one `logForDebugging` entry — does not throw.

### 6.2 Type / Build Tests
- [ ] `tsc --noEmit` passes (new file + re-export typecheck).
- [ ] `bun build src/main.tsx` (or repo-equivalent build) succeeds.
- [ ] Existing settings/config tests pass unchanged.

### 6.3 Manual Verification
1. Run `kode --help` — confirm no flag regressions, descriptions render where added.
2. Run `kode mcp --help`, `kode plugin --help`, `kode auth --help` — subcommand tree intact.
3. Construct a `~/.kode.json` with an unknown key, e.g. `{ "numStartups": 5, "myPluginFoo": true }` — confirm startup succeeds, unknown key is preserved on next `saveGlobalConfig`.
4. Construct a `~/.kode.json` with a malformed value, e.g. `{ "numStartups": "oops" }` — confirm startup succeeds, debug log records the validation issue.
5. Grep `docs/config/settings.md` field names against `SettingsSchema` — every documented field exists in source; report mismatches.

### 6.4 Documentation Cross-Checks
- [ ] `docs/config/cli.md` enum for `--permission-mode` matches `EXTERNAL_PERMISSION_MODES` (`src/types/permissions.ts:16-22`) exactly.
- [ ] `docs/config/mcp.md` transport list matches `TransportSchema` enum + `McpClaudeAIProxyServerConfigSchema` literal (types.ts:23, 116-118).
- [ ] `docs/config/global.md` "user-configurable" column matches `GLOBAL_CONFIG_KEYS` (config.ts:627-667) exactly.

---

## 7. Risks & Alternatives

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `GlobalConfigSchema` rejects a valid legacy `~/.kode.json` and throws, breaking startup | High — blocks all users | Use `safeParse` (never `parse`); on failure log and return original `parsedConfig`. Add unit test for malformed-file startup. |
| Adding `.default()` to settings would silently change multi-source merge semantics | Medium — wrong tool calls / model selection | Strict rule: only add `.describe()`, never `.default()`. Code review checklist item. |
| `.passthrough()` on `GlobalConfigSchema` hides typos in user config | Low — same as today | Acceptable; validation is diagnostic-only. Future hardening can flip to `.strict()` behind a flag. |
| Doc drift after future schema edits | Medium — stale reference | Add grep-based check script in CI (optional, future PR); require docs update in PR template checklist. |
| Documenting hidden/internal flags leaks unstable API | Low — internal users already know them | Mark section with "internal — not stable API" banner; no behavioral commitment. |
| `lazySchema` / zod version mismatch | Low | Mirror `zod/v4` import path used by `src/services/mcp/types.ts:6` and `src/utils/settings/types.ts`. |

### Alternatives Considered
1. **Auto-generate docs from zod schema.** Rejected: human-curated prose (examples, gotchas, deprecation context) is the value; auto-gen would produce a flat field dump and lose the "why". A grep-based check script captures drift without forcing auto-gen.
2. **Add `.default()` to settings for richer `--help`.** Rejected: changes merge semantics (defaults shadow higher-precedence sources in the `SettingsSchema` merge path). Risk > benefit; defer until a merge-semantics audit exists.
3. **Make `GlobalConfigSchema` strict (`.strict()` / no `.passthrough()`).** Rejected: `~/.kode.json` historically accepts plugin/feature-injected keys; strict would break real user files. `.passthrough()` keeps behavior identical.
4. **Fold all docs into a single `docs/configuration.md`.** Rejected: ~80 settings fields + ~50 CLI flags + MCP + global + KODE.md would produce a 2000-line page; six-page split with index is more navigable.

---

## 8. Open Questions

None — all questions resolved. Confirmations:

- Validation failure handling: **log-only, never throw** (decided in §3.3).
- Settings `.default()`: **not added** (decided in §3.3).
- Hidden flags: **documented under a clearly-marked internal section** (decided in §3.3).
- Doc format: **hand-maintained Markdown, grep cross-checked** (decided in §3.3).

Implementation agents should reference this doc (`docs/design/2026-08-05-config-reference-and-schema.md`) and the cross-check source files listed in §3.4.
