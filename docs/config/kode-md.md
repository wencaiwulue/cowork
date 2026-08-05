# `KODE.md` 与指令文件参考

> 对照源: `src/utils/kodemd.ts`(加载逻辑、`@./include` 指令、`MAX_INCLUDE_DEPTH`)、`src/utils/markdownConfigLoader.ts`(commands/agents/skills 等 markdown 文件加载)、`src/utils/frontmatterParser.ts`(frontmatter 解析)。
> **本文件手工维护,以源码为准。**

---

## 一、文件位置与加载顺序

Kode 在每个会话启动时把多个 KODE.md 文件拼装为系统提示词的一部分。加载逻辑在 `getMemoryFiles()`(`src/utils/kodemd.ts:790`)。

### 1.1 加载顺序(低 → 高,后加载的优先级更高)

| 顺序 | 类型 (MemoryType) | 文件位置 | 是否 checked-in | 可被 `claudeMdExcludes` 排除 |
|---|---|---|---|---|
| 1 | `Managed` | `/etc/kode-code/KODE.md`(Linux)或 `/Library/Application Support/KodeCode/KODE.md`(macOS)或 `C:\Program Files\KodeCode\KODE.md`(Windows)。还加载 `<managed>/.kode/rules/*.md` | 否(管理员) | 否 |
| 2 | `User` | `~/.kode/KODE.md`。还加载 `~/.kode/rules/*.md` | 否(用户全局) | 是 |
| 3 | `Project` | 从当前目录向上遍历到 git root(或 home):每个目录的 `KODE.md`、`.kode/KODE.md`、`.kode/rules/*.md`。**越靠近 CWD 优先级越高**(后加载) | 是(checked-in) | 是 |
| 4 | `Local` | 每个目录的 `KODE.local.md`(gitignore,不提交) | 否 | 是 |
| 5 | `AutoMem` | `getAutoMemEntrypoint()`(`~/.kode/projects/<sanitized-cwd>/memory/`) | 否 | 否 |
| 6 | `TeamMem` | `getTeamMemEntrypoint()`(仅 `feature('TEAMMEM')` 启用) | 否 | 否 |

### 1.2 向上遍历规则

- 从 `getOriginalCwd()` 向上遍历到根目录(不含根),收集每层目录。
- 遍历顺序:**从 root 向 CWD**(这样 CWD 层后加载,优先级最高)。
- 默认在 git root 处停止;worktree 场景有特殊处理(见 `kodemd.ts:855-934`)。

### 1.3 Setting source 启用门控

- `Managed`:始终加载(policy)
- `User`:仅 `isSettingSourceEnabled('userSettings')` 为 true 时加载
- `Project`:仅 `isSettingSourceEnabled('projectSettings')` 为 true 时加载
- `Local`:仅 `isSettingSourceEnabled('localSettings')` 为 true 时加载

可通过 `--setting-sources` flag 控制(详见 [cli.md](./cli.md))。

### 1.4 额外目录

`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` 真值时,也加载 `--add-dir` 指定目录中的 `KODE.md`/`.kode/KODE.md`/`.kode/rules/*.md`。

### 1.5 文件大小上限

`MAX_MEMORY_CHARACTER_COUNT = 40000`(`kodemd.ts:92`)。超过此长度的文件会被 `getLargeMemoryFiles()` 标记。

---

## 二、Frontmatter 字段

来源:`FrontmatterData`(`src/utils/frontmatterParser.ts:10-59`)。frontmatter 是文件开头的 `---` 分隔 YAML 块,由 `parseFrontmatter()`(`frontmatterParser.ts:130-175`)解析。

### 2.1 KODE.md 专用字段

KODE.md 主要使用 `paths` 字段做条件激活:

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `paths` | string \| string[] | — | glob pattern(逗号分隔字符串或 YAML 列表,支持 `{a,b}` brace 展开) | 该 KODE.md 仅在模型触碰匹配路径时激活。无 `paths` = 全局适用;全 `**` = 全局适用 | 否 | | `["src/**", "test/**"]` 或 `"src/**"` |

`paths` 处理细节:
- `splitPathInFrontmatter()`(`frontmatterParser.ts:189-232`)按逗号分隔(brace 内除外),并展开 brace pattern。
- `/**` 后缀被去掉(`ignore` 库把 `path` 视为匹配 path 本身和其中所有文件)。
- 全空或全 `**` 等价于无 `paths`(全局适用)。
- 仅 `.kode/rules/*.md` 中的 conditional rule 用此机制;KODE.md 自身的 frontmatter 也支持但语义相同。
- 仅对 User/Project/Local 类型生效;Managed/AutoMem/TeamMem 不参与条件匹配。

### 2.2 通用 frontmatter 字段(用于 commands/agents/skills/output-styles)

这些字段在 `.kode/commands/`、`.kode/agents/`、`.kode/skills/`、`.kode/output-styles/` 等 markdown 文件中使用(由 `markdownConfigLoader.ts` 加载),不用于 KODE.md 本身:

| 字段名 | 类型 | 默认值 | 取值范围/枚举 | 作用描述 | 必填 | 废弃/内部标记 | 示例 |
|---|---|---|---|---|---|---|---|
| `description` | string \| null | — | 字符串 | 描述(缺失时取首行非空文本) | 否 | | |
| `allowed-tools` | string \| string[] \| null | — | 工具规则(逗号或空格分隔字符串,或数组) | slash command 允许的工具列表(仅 commands) | 否 | | `"Bash(git:*)"` |
| `argument-hint` | string \| null | — | 字符串 | 参数提示 | 否 | | `"<file>"` |
| `when_to_use` | string \| null | — | 字符串 | 何时使用(skill/agent) | 否 | | |
| `version` | string \| null | — | semver | 版本 | 否 | | |
| `hide-from-slash-command-tool` | string \| null | — | env-var-like 字符串 | 是否对 SlashCommand 工具隐藏(仅 commands) | 否 | | |
| `model` | string \| null | — | 模型 alias/名/`'inherit'` | 该 component 使用的模型 | 否 | | `"sonnet"` |
| `skills` | string \| null | — | 逗号分隔 skill 名列表 | 预加载的 skill(仅 agents) | 否 | | `"reviewer,formatter"` |
| `user-invocable` | string \| null | commands 默认 `true`;skills 默认 `false` | `"true"` \| `"false"` | 用户是否可 `/skill-name` 调用 | 否 | | |
| `hooks` | object \| null | — | 见 `HooksSchema` | 该 skill 调用时注册的 hooks(仅 skills) | 否 | | |
| `effort` | string \| null | — | `low`\|`medium`\|`high`\|`max` 或整数 | 该 agent 的 thinking effort(仅 agents) | 否 | | `"high"` |
| `context` | enum \| null | `inline` | `inline` \| `fork` | skill 执行上下文(`inline`=内联展开,`fork`=子 agent) | 否 | | |
| `agent` | string \| null | — | agent 类型 | 当 `context: fork` 时使用的 agent 类型 | 否 | | `"Bash"` |
| `paths` | string \| string[] \| null | — | glob pattern | 该 skill 仅在触碰匹配文件时激活(同 KODE.md `paths`) | 否 | | |
| `shell` | string \| null | `bash` | `bash` \| `powershell` | 该文件内 `!`cmd`` 和 ```!``` 块使用的 shell(file-scoped) | 否 | | `"bash"` |
| `type` | string \| null | — | `'user'`\|`'feedback'`\|`'project'`\|`'reference'` 等 | memory 类型(仅 memory 文件,由 `parseMemoryType` 收窄) | 否 | | |

---

## 三、`@./include` 指令

来源:`kodemd.ts:18-26` 注释 + `extractIncludePathsFromTokens()`(`kodemd.ts:451-535`)。

### 3.1 语法

```
@path
@./relative/path
@~/home/path
@/absolute/path
```

- `@path`(无前缀)= 相对路径(等价于 `@./path`)
- `@./path` = 相对路径(相对当前文件所在目录)
- `@~/path` = home 目录路径
- `@/path` = 绝对路径
- 支持 fragment:`@./file.md#section`(fragment 被剥离,只用于 include 整个文件)
- 支持转义空格:`@./my\ file.md`

### 3.2 行为

- **仅在 leaf text node 中工作**——不在 code block 或 code span 内(`element.type === 'code'` / `'codespan'` 被跳过)。
- HTML 注释 `<!-- @./file.md -->` 中的 `@path` 会被解析:先剥离注释 span,再扫描残余文本。
- 被包含的文件作为 **单独条目** 添加到包含文件 **之前**(父在前,子在后)。
- 循环引用通过 `processedPaths` Set 防止(规范化路径比较)。
- 不存在的文件被静默忽略。
- 外部 include(不在 CWD 内)仅在 `includeExternal=true` 时生效:User memory 始终允许外部 include;Project/Local 需要 `hasClaudeMdExternalIncludesApproved` 或 `forceIncludeExternal`。

### 3.3 最大深度

```
MAX_INCLUDE_DEPTH = 5
```

来源:`kodemd.ts:537`。include 嵌套深度超过 5 时,该路径不再递归处理。

### 3.4 支持的扩展名

`TEXT_FILE_EXTENSIONS`(`kodemd.ts:96-227`)白名单约 80+ 种文本扩展名。非文本文件(图片、PDF 等)被静默跳过(`parseMemoryFileContent` 第 350-354 行)。包括:

- Markdown / 文本:`.md`、`.txt`、`.text`
- 数据格式:`.json`、`.yaml`、`.yml`、`.toml`、`.xml`、`.csv`
- Web:`.html`、`.htm`、`.css`、`.scss`、`.sass`、`.less`
- JS/TS:`.js`、`.ts`、`.tsx`、`.jsx`、`.mjs`、`.cjs`、`.mts`、`.cts`
- Python:`.py`、`.pyi`、`.pyw`
- Ruby/Go/Rust/Java/Kotlin/Scala/C/C++/C#/Swift/Shell 等
- 完整列表见 `kodemd.ts:96-227`

### 3.5 外部 include 提示

`hasExternalClaudeMdIncludes()`(`kodemd.ts:1416-1418`)检测 include 是否引用 CWD 外文件。若是,首次启动会显示警告 dialog,用户需 approve(记录到 `ProjectConfig.hasClaudeMdExternalIncludesApproved`)。

---

## 四、与 AGENTS.md 的关系

Kode Code 是 Claude Code 的 fork(已完成 kode 重命名)。

- **历史名称**:Claude Code 用 `CLAUDE.md`、`AGENTS.md` 等文件名;Kode 重命名后用 `KODE.md`。
- **当前权威名称**:`KODE.md`(`isMemoryFilePath` 检查 `KODE.md`/`KODE.local.md`,`kodemd.ts:1438-1440`)。
- **AGENTS.md 的处理**:本仓库 `CLAUDE.md` / `AGENTS.md` 是 **项目自身的开发规约**(给 agent team 执行策略用),不是 Kode 的运行时指令文件。运行时指令文件名为 `KODE.md`。
- 仓库根的 `CLAUDE.md`/`AGENTS.md` 描述的是项目贡献者的工作流(强制 agent team、设计文档先行、auto-commit 等),与 Kode 的配置加载逻辑无关。
- 项目内的 `.kode/rules/*.md` 文件也被加载为 Project 类型指令。

---

## 五、Markdown 配置目录(`.kode/<subdir>/`)

`KODE_CONFIG_DIRECTORIES`(`markdownConfigLoader.ts:29-36`):

| 子目录 | 内容 | 加载顺序 |
|---|---|---|
| `commands` | 自定义 slash commands | managed → user → project |
| `agents` | 自定义 agent 定义 | managed → user → project |
| `output-styles` | 自定义 output style | managed → user → project |
| `skills` | 自定义 skill | managed → user → project |
| `workflows` | 自定义 workflow | managed → user → project |
| `templates`(仅 `feature('TEMPLATES')`) | 自定义模板 | managed → user → project |

加载优先级:managed(policy)> user > project(低 → 高,project 最高)。每层都从 CWD 向上遍历到 git root。

去重:通过 device ID + inode 检测(同物理文件被多路径发现时去重,见 `markdownConfigLoader.ts:159-172`)。

文件搜索默认用 ripgrep(`--files --hidden --follow --no-ignore --glob *.md`),native 实现作为 fallback(可由 `CLAUDE_CODE_USE_NATIVE_FILE_SEARCH=1` 强制)。

---

## 六、Schema 缺口

1. **frontmatter 字段无 zod schema**:`FrontmatterData` 是 plain TypeScript type,不是 zod schema。解析失败时静默退化(frontmatter 为空对象),错误仅 `logForDebugging`。无运行时校验意味着 typo(如 `descripton:`)会被忽略。
2. **`paths` 字段类型不一致**:在 settings.json schema(`SettingsSchema`)中无对应字段;在 frontmatter 中支持 string 和 string[]。两套解析逻辑(`splitPathInFrontmatter` 与 settings 层的 `claudeMdExcludes` 用 picomatch)不同——`paths` 用 `ignore` 库,`claudeMdExcludes` 用 `picomatch`。
3. **`MAX_MEMORY_CHARACTER_COUNT` 仅警告不截断**:KODE.md 超长不会被自动截断,只在 `getLargeMemoryFiles()` 中标记。
4. **`MAX_INCLUDE_DEPTH = 5` 是硬编码**:无配置覆盖,文档中需明确说明。
5. **`TEXT_FILE_EXTENSIONS` 白名单无 schema**:扩展名列表硬编码,新增文件类型需改代码。
6. **include directive 语法无 schema 校验**:`@path` 解析失败(如无效路径)被静默忽略,用户难以发现 typo。
7. **`AutoMem` / `TeamMem` 类型不参与条件匹配**(`isClaudeMdExcluded` 只对 User/Project/Local 生效)——文档需说明哪些类型可被 `claudeMdExcludes` 影响。
