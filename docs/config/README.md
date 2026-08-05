# Kode Code 配置参考索引

> 对照源: `src/utils/settings/constants.ts`、`src/utils/settings/settings.ts`、`src/utils/config.ts`、`src/utils/env.ts`、`src/services/mcp/types.ts`、`src/utils/kodemd.ts`、`src/main.tsx`、`src/bootstrap/state.ts`。
> **本文件手工维护,以源码为准。** 字段或路径如有出入,请以对应源文件为唯一权威。

本目录是 Kode Code CLI 的配置参考。Kode 的配置分散在五个文件面(surface)加 CLI flags,共六处入口。本文档是它们的全局索引;每个分篇深入一个面。

---

## 一、配置源总览

| 配置面 | 文件 / 路径 | 作用范围 | 是否持久化 | 是否可经 `/config` 修改 | 说明 | 详细文档 |
|---|---|---|---|---|---|---|
| User settings | `~/.kode/settings.json`(`KODE_CONFIG_DIR` 可覆盖) | 全局(所有项目) | 是 | 部分 | 用户全局偏好 | [settings.md](./settings.md) |
| Project settings | `$PROJECT/.kode/settings.json` | 项目(checked-in,团队共享) | 是 | 否 | 团队级共享配置,提交到代码库 | [settings.md](./settings.md) |
| Local settings | `$PROJECT/.kode/settings.local.json` | 项目(私有,gitignore) | 是 | 否 | 项目级私有覆盖,不提交 | [settings.md](./settings.md) |
| Policy settings (managed) | macOS: `/Library/Application Support/KodeCode/managed-settings.json`;Linux: `/etc/kode-code/managed-settings.json`;Windows: `C:\Program Files\KodeCode\managed-settings.json`。drop-in 目录 `<managed>/managed-settings.d/*.json`(字母序合并) | 全机(管理员) | 是 | 否 | 企业策略,管理员级,普通用户不可写。还有 MDM(macOS plist / Windows HKLM)、远程托管策略、Windows HKCU 兜底 | [settings.md](./settings.md) |
| Flag settings | `--settings <file-or-json>`(flagSettings 文件) + SDK 内联(`flagSettingsInline`) | 单次会话 | 否 | 否 | CLI/SDK 注入的设置,会话级 | [settings.md](./settings.md) / [cli.md](./cli.md) |
| Global config | `~/.kode.json`(或 `$KODE_CONFIG_DIR/.kode.json`,OAuth 后缀可能为 `.kode-<suffix>.json`) | 全局(单机) | 是 | 部分(仅 `GLOBAL_CONFIG_KEYS` 白名单) | **运行时状态文件**,既存用户偏好也存运行时缓存 | [global.md](./global.md) |
| MCP servers | `$PROJECT/.kode.mcp.json`(项目级,可 approve/reject)、`~/.kode.json` 的 `mcpServers`(用户级)、`<managed>/managed-mcp.json`(企业级)、SDK `--mcp-config` | 项目 / 用户 / 企业 / dynamic | 是 | 否 | MCP 服务器注册表 | [mcp.md](./mcp.md) |
| Memory (KODE.md) | Managed `/etc/kode-code/KODE.md` → User `~/.kode/KODE.md` → Project `KODE.md`/`.kode/KODE.md`/`.kode/rules/*.md` → Local `KODE.local.md` | 全局 / 项目 | 是 | 否 | 系统提示词注入的指令文件 | [kode-md.md](./kode-md.md) |
| CLI flags | 命令行参数(`kode --model sonnet -p "..."`) | 单次会话 | 否 | 否 | 启动时一次性注入,优先级最高(在 flagSettings 层) | [cli.md](./cli.md) |

> 路径中的 `~/.kode/` 由 `KODE_CONFIG_DIR` 环境变量覆盖(见 `src/utils/envUtils.ts`)。
> Managed 目录可通过 `CLAUDE_CODE_MANAGED_SETTINGS_PATH` 环境变量覆盖(仅 `USER_TYPE=ant`)。

---

## 二、合并优先级

Kode 的 settings 在 `loadSettingsFromDisk`(`src/utils/settings/settings.ts`)中按 source 顺序合并,后合并的覆盖先合并的(深合并,`lodash.mergeWith`)。

**实际代码合并顺序(低 → 高):**

```
plugin → user → project → local → flag → policy
```

即 **policy(企业策略)优先级最高**,flag 次之。

> ⚠️ 与设计文档 `docs/design/2026-08-05-config-reference-and-schema.md` 的差异:
> 设计文档 §3.2 写作 `plugin→user→project→local→policy→flag`(flag 最高),
> §3.3 又写作 `flag > policy > local > project > user > plugin`。
> 经核对 `src/utils/settings/constants.ts` 中 `SETTING_SOURCES` 数组与
> `src/bootstrap/state.ts` 中 `allowedSettingSources` 默认值
> (`['userSettings','projectSettings','localSettings','flagSettings','policySettings']`),
> 实际迭代顺序为 `user → project → local → flag → policy`,故 **policy 最高**。
> 此差异已记录在 schema 缺口清单中。

### Policy settings 内部优先级

`policySettings` 内部采取"先到先得"(first source wins)策略,优先级:

```
remote managed(远程 API) > HKLM/macOS plist > managed-settings.json + drop-ins > Windows HKCU
```

详见 `loadSettingsFromDisk`(`src/utils/settings/settings.ts:677-738`)。

### plugin 层

plugin settings 是最低优先级的 base(由 `getPluginSettingsBase()` 提供),仅含 allowlisted 字段(如 `agent`)。所有文件型 source 都覆盖它。

---

## 三、用户可配 vs 内部

### Settings 文件(`.kode/settings.json` 等)

字段定义在 `SettingsSchema`(`src/utils/settings/types.ts:255-1072`),`.passthrough()` 保留未知字段。所有字段都是用户可配的(虽然语义上 enterprise-only 字段在非 managed source 里效果有限)。详见 [settings.md](./settings.md)。

### Global config(`~/.kode.json`)

**这是运行时状态文件**,既包含用户偏好也包含缓存/统计/迁移标记。

- 用户可配字段以 `GLOBAL_CONFIG_KEYS`(`src/utils/config.ts:627-667`)白名单为准,共约 40 个。
- 其余字段(迁移标记、缓存、统计计数、IDE 设置等)是 **内部运行时状态**,不建议手编。
- 推荐 **通过 `/config` 斜杠命令修改偏好**,直接手编运行时字段可能破坏会话追踪/迁移幂等性。

详见 [global.md](./global.md)。

---

## 四、分篇导航

| 文档 | 主题 | 何时读 |
|---|---|---|
| [settings.md](./settings.md) | `.kode/settings.json` 等 settings 文件,~80 字段全集(按功能分组:权限/模型/MCP/钩子/插件/环境/API/UI 等) | 配置权限规则、模型、hooks、env、插件、enterprise allowlist 时 |
| [mcp.md](./mcp.md) | `.kode.mcp.json` 传输类型(stdio/sse/sse-ide/http/ws/sdk/claudeai-proxy)、scope、approve/reject 流程 | 配置 MCP 服务器时 |
| [global.md](./global.md) | `~/.kode.json` 字段全集,用户可配 vs 内部标记 | 查看用户偏好字段、判断哪些字段可安全手编时 |
| [kode-md.md](./kode-md.md) | `KODE.md` 加载顺序、frontmatter `paths` 字段、`@./include` 指令 | 编写项目指令文件时 |
| [cli.md](./cli.md) | CLI flags(~50+ 全局 flags)、子命令、flag→settings 映射、内部/隐藏 flags | 查命令行参数、写脚本时 |

---

## 五、统一字段表格式

所有分篇的字段表固定 8 列:

```
字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例
```

- **废弃**:已废弃字段标 `已废弃`,说明替代方案。
- **内部**:非用户可配或运行时状态字段标 `内部`。
- 默认值列如标 `—`,表示无内置默认(依赖合并或代码路径)。

---

## 六、维护约定

- 文档与源码可能漂移。每次 `SettingsSchema` / `GlobalConfig` / CLI flags / MCP schemas 变更,需同步更新对应分篇。
- 校验方法:对每个字段名 `grep` 对应源文件,确认存在。
- 如发现文档与源码不符,**以源码为准**并提 PR 修正文档。
