# Local CLI Build Changes

本文档记录为了把 `/Users/fengcaiwen/test/claude-code` 源码快照构建成可执行 CLI 所做的改动。

## 目标

- 生成本地可执行文件：`dist/claude-local`
- 保留核心 CLI 启动、帮助、doctor、非交互 print 路径。
- 对无法恢复的私有依赖和缺失源码快照模块使用本地 stub，相关功能运行时返回空能力或明确不可用。

## 工程配置

系统级准备：

- 通过 `npm install -g bun` 安装 Bun，使当前机器可以执行 `bun install`、`bun run build`。

新增项目构建配置：

- `package.json`
  - 新增 `build`、`start`、`check` scripts。
  - 新增 `claude-local` bin 指向 `./dist/claude-local`。
  - 配置 Bun/TypeScript/运行时依赖。
  - 将私有 `@ant/*` 包映射到本地 `file:./stubs/...`。
  - 构建时通过 `--define` 注入 `MACRO.*`：
    - `MACRO.VERSION = "999.0.0-local"`
    - `MACRO.BUILD_TIME = "1970-01-01T00:00:00.000Z"`
    - `MACRO.PACKAGE_URL = "@anthropic-ai/claude-code"`
    - `MACRO.NATIVE_PACKAGE_URL = "@anthropic-ai/claude-code"`
    - `MACRO.FEEDBACK_CHANNEL`
    - `MACRO.ISSUES_EXPLAINER`
    - `MACRO.VERSION_CHANGELOG = []`
- `tsconfig.json`
  - 配置 ESM、React JSX、Bundler module resolution。
  - 配置 `src/*` 路径别名。
  - 配置 `bun:bundle`、`bun:ffi` 到本地 shim。
- `bunfig.toml`
  - 禁用 peer 自动安装。
  - 声明 `@ant` scope registry 兜底配置。
- `bun.lock`
  - 由 `bun install` 生成。

## 本地 Stub 依赖

新增 `stubs/` 下的本地包，用于替代当前 registry 无法获取的私有依赖：

- `stubs/ant-claude-for-chrome-mcp`
  - 导出空 `BROWSER_TOOLS`。
  - `createClaudeForChromeMcpServer()` 调用时报不可用。
- `stubs/ant-computer-use-mcp`
  - 导出空 computer-use tool 列表。
  - 导出最小 `DEFAULT_GRANT_FLAGS`、`API_RESIZE_PARAMS`、类型声明。
  - `createComputerUseMcpServer()` 调用时报不可用。
  - 提供 `types` 和 `sentinelApps` 子路径。
- `stubs/ant-computer-use-input`
  - 输入控制函数调用时报不可用。
- `stubs/ant-computer-use-swift`
  - 提供空默认导出和类型声明。

逐文件清单：

```text
stubs/ant-claude-for-chrome-mcp/index.d.ts
stubs/ant-claude-for-chrome-mcp/index.js
stubs/ant-claude-for-chrome-mcp/package.json
stubs/ant-computer-use-input/index.d.ts
stubs/ant-computer-use-input/index.js
stubs/ant-computer-use-input/package.json
stubs/ant-computer-use-mcp/index.d.ts
stubs/ant-computer-use-mcp/index.js
stubs/ant-computer-use-mcp/package.json
stubs/ant-computer-use-mcp/sentinelApps.d.ts
stubs/ant-computer-use-mcp/sentinelApps.js
stubs/ant-computer-use-mcp/types.d.ts
stubs/ant-computer-use-mcp/types.js
stubs/ant-computer-use-swift/index.d.ts
stubs/ant-computer-use-swift/index.js
stubs/ant-computer-use-swift/package.json
```

## Bun Shim

新增本地 Bun 专用模块 shim：

- `src/local-shims/bun-bundle.ts`
  - `feature()` 固定返回 `false`，让 feature-gated 内部功能默认关闭。
- `src/local-shims/bun-ffi.ts`
  - 提供最小导出，实际调用时报不可用。

逐文件清单：

```text
src/local-shims/bun-bundle.ts
src/local-shims/bun-ffi.ts
```

## 源码快照缺口补齐

新增缺失源码模块的最小实现，避免 bundle 解析失败：

- `src/utils/protectedNamespace.ts`
- `src/types/connectorText.ts`
- `src/components/agents/SnapshotUpdateDialog.tsx`
- `src/assistant/AssistantSessionChooser.tsx`
- `src/commands/assistant/assistant.ts`
- `src/commands/agents-platform/index.ts`
- `src/services/compact/snipCompact.ts`
- `src/services/compact/cachedMicrocompact.ts`
- `src/tools/TungstenTool/TungstenTool.ts`
- `src/tools/TungstenTool/TungstenLiveMonitor.tsx`
- `src/entrypoints/sdk/coreTypes.generated.ts`
- `src/entrypoints/sdk/runtimeTypes.ts`
- `src/entrypoints/sdk/toolTypes.ts`
- `src/utils/filePersistence/types.ts`
- `src/services/contextCollapse/index.ts`
- `src/tools/WorkflowTool/constants.ts`
- `src/ink/devtools.ts`
- `src/ink/global.d.ts`
- `src/utils/ultraplan/prompt.txt`
- `src/skills/bundled/verify/SKILL.md`
- `src/skills/bundled/verify/examples/cli.md`
- `src/skills/bundled/verify/examples/server.md`
- `src/tools/REPLTool/REPLTool.ts`
- `src/tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.ts`
- `src/tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.ts`

这些文件都是恢复构建所需的最小 stub；不代表对应功能已完整恢复。

逐文件清单：

```text
src/assistant/AssistantSessionChooser.tsx
src/commands/agents-platform/index.ts
src/commands/assistant/assistant.ts
src/components/agents/SnapshotUpdateDialog.tsx
src/entrypoints/sdk/coreTypes.generated.ts
src/entrypoints/sdk/runtimeTypes.ts
src/entrypoints/sdk/toolTypes.ts
src/ink/devtools.ts
src/ink/global.d.ts
src/services/compact/cachedMicrocompact.ts
src/services/compact/snipCompact.ts
src/services/contextCollapse/index.ts
src/skills/bundled/verify/SKILL.md
src/skills/bundled/verify/examples/cli.md
src/skills/bundled/verify/examples/server.md
src/tools/REPLTool/REPLTool.ts
src/tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.ts
src/tools/TungstenTool/TungstenLiveMonitor.tsx
src/tools/TungstenTool/TungstenTool.ts
src/tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.ts
src/tools/WorkflowTool/constants.ts
src/types/connectorText.ts
src/utils/filePersistence/types.ts
src/utils/protectedNamespace.ts
src/utils/ultraplan/prompt.txt
```

## 运行时兼容修复

修改 `src/main.tsx`：

- 将隐藏选项 `-d2e, --debug-to-stderr` 改为仅 `--debug-to-stderr`。
- 原因：当前安装的 Commander 版本不接受多字符短选项 `-d2e`，会导致 `--help` 初始化阶段直接抛错。
- 影响：`--debug-to-stderr` 仍可用；旧隐藏别名 `-d2e` 不再可用。

逐文件清单：

```text
src/main.tsx
```

## 生成产物

构建命令：

```bash
bun run build
```

Linux arm64 交叉编译命令：

```bash
bun build ./src/entrypoints/cli.tsx --compile --outfile ./dist/claude-local-linux-arm64 --target=bun-linux-arm64 --define MACRO.VERSION='"999.0.0-local"' --define MACRO.BUILD_TIME='"1970-01-01T00:00:00.000Z"' --define MACRO.PACKAGE_URL='"@anthropic-ai/claude-code"' --define MACRO.NATIVE_PACKAGE_URL='"@anthropic-ai/claude-code"' --define MACRO.FEEDBACK_CHANNEL='"https://github.com/anthropics/claude-code/issues"' --define MACRO.ISSUES_EXPLAINER='"open an issue at https://github.com/anthropics/claude-code/issues"' --define MACRO.VERSION_CHANGELOG='[]'
```

生成文件：

```text
dist/claude-local
dist/claude-local.js
dist/claude-local-linux-arm64
```

- `dist/claude-local` 是 macOS arm64 Mach-O 可执行文件。
- `dist/claude-local.js` 是 Bun bundle 输出文件。
- `dist/claude-local-linux-arm64` 是 Linux arm64/aarch64 ELF 可执行文件。

## 完整改动清单

本次为了恢复 CLI 构建，涉及以下文件和目录：

```text
BUILD_CHANGES.md
bun.lock
bunfig.toml
package.json
tsconfig.json
dist/claude-local
dist/claude-local.js
dist/claude-local-linux-arm64
src/assistant/AssistantSessionChooser.tsx
src/commands/agents-platform/index.ts
src/commands/assistant/assistant.ts
src/components/agents/SnapshotUpdateDialog.tsx
src/entrypoints/sdk/coreTypes.generated.ts
src/entrypoints/sdk/runtimeTypes.ts
src/entrypoints/sdk/toolTypes.ts
src/ink/devtools.ts
src/ink/global.d.ts
src/local-shims/bun-bundle.ts
src/local-shims/bun-ffi.ts
src/main.tsx
src/services/compact/cachedMicrocompact.ts
src/services/compact/snipCompact.ts
src/services/contextCollapse/index.ts
src/skills/bundled/verify/SKILL.md
src/skills/bundled/verify/examples/cli.md
src/skills/bundled/verify/examples/server.md
src/tools/REPLTool/REPLTool.ts
src/tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.ts
src/tools/TungstenTool/TungstenLiveMonitor.tsx
src/tools/TungstenTool/TungstenTool.ts
src/tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.ts
src/tools/WorkflowTool/constants.ts
src/types/connectorText.ts
src/utils/filePersistence/types.ts
src/utils/protectedNamespace.ts
src/utils/ultraplan/prompt.txt
stubs/ant-claude-for-chrome-mcp/index.d.ts
stubs/ant-claude-for-chrome-mcp/index.js
stubs/ant-claude-for-chrome-mcp/package.json
stubs/ant-computer-use-input/index.d.ts
stubs/ant-computer-use-input/index.js
stubs/ant-computer-use-input/package.json
stubs/ant-computer-use-mcp/index.d.ts
stubs/ant-computer-use-mcp/index.js
stubs/ant-computer-use-mcp/package.json
stubs/ant-computer-use-mcp/sentinelApps.d.ts
stubs/ant-computer-use-mcp/sentinelApps.js
stubs/ant-computer-use-mcp/types.d.ts
stubs/ant-computer-use-mcp/types.js
stubs/ant-computer-use-swift/index.d.ts
stubs/ant-computer-use-swift/index.js
stubs/ant-computer-use-swift/package.json
```

未计入上面清单但由依赖安装产生：

```text
node_modules/
```

## 验证结果

已通过：

```bash
./dist/claude-local --version
```

输出：

```text
999.0.0-local (Claude Code)
```

已通过 Linux arm64 静态架构校验：

```bash
file dist/claude-local-linux-arm64
```

结果：`ELF 64-bit LSB executable, ARM aarch64`。

已通过 Docker arm64 容器运行验证：

```bash
docker run --rm --platform linux/arm64 -v "$PWD/dist:/dist:ro" debian:bookworm-slim /dist/claude-local-linux-arm64 --version
```

输出：

```text
999.0.0-local (Claude Code)
```

已通过：

```bash
./dist/claude-local --help
```

结果：正常输出 CLI 帮助信息和命令列表。

已验证可启动：

```bash
./dist/claude-local doctor
```

结果：进入诊断 UI。诊断中发现本机/项目配置问题：

- `~/.claude/settings.json` 中 `permissions.defaultMode` 值不在当前允许范围内。
- 项目 `.mcp.json` 中 `mcpServers.机器人消息` 不符合 MCP server 配置 schema。

已验证进入 API 请求阶段：

```bash
./dist/claude-local -p "hello" --output-format text --bare --debug-to-stderr
```

结果：

- CLI 启动成功。
- 命令、工具、插件、MCP 配置加载流程执行。
- 进入 `/api/anthropic/v1/messages` 请求。
- 最终在 `ANTHROPIC_BASE_URL=https://idealab.alibaba-inc.com/api/anthropic` 上出现 `Connection error` 重试。

该错误属于外部 API/网络连接问题，不是构建或模块加载问题。

## 未通过项

```bash
bun run check
```

当前未通过。主要原因：

- 源码快照缺大量 generated/type-only 文件。
- 部分类型引用在快照中不完整，例如 SDK control/runtime/message 类型。
- 当前恢复安装的公开依赖版本与该源码快照的原始构建环境不完全一致。
- 部分源码是编译后/转换后的形态，TypeScript 静态检查会暴露大量非运行时阻塞问题。

当前结论：`bun run check` 未恢复到干净状态，但 `bun run build` 已通过，`dist/claude-local` 已可执行并通过基础 CLI 验证。

## 当前限制

- Chrome MCP、Computer Use、Tungsten、部分 ant-only/feature-gated 功能是 stub，不是完整实现。
- 非交互 print 的实际模型调用依赖当前环境的 API base URL、网络和认证配置。
- 该目录不是 git 仓库，因此没有提交记录或 git diff 可追踪。
