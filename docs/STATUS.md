# 功能完成状态 (Feature Status)

参考: [anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts)

---

## ✅ 已完成功能

### 核心UI和导航
- [x] 7个一级导航（Chat/Agents/Teams/Tasks/MCP/Skills/Settings）快捷键⌘1-⌘7
- [x] Codex风格侧边栏和会话列表
- [x] 命令面板（⌘K）
- [x] 深色/浅色模式自适应

### 会话和工作区
- [x] 多会话创建/切换/关闭
- [x] Files文件树浏览
- [x] Diff查看器（git diff）
- [x] Monaco编辑器
- [x] 终端集成（xterm.js）
- [x] Preview预览面板

### Agents & Teams
- [x] Agent目录浏览（built-in/user/project/local/managed/flag/plugin）
- [x] **10个内置Agent模板**：general-purpose, code-reviewer, test-writer, bug-finder, refactor, document-writer, browser-agent, computer-agent等
- [x] 自定义Agent创建/编辑/删除
- [x] Agent诊断（readiness检查）
- [x] Agent任务启动/停止/输出预览
- [x] Team创建/成员管理/群组消息
- [x] 运行中Agent任务监控

### MCP & Skills
- [x] MCP服务器独立页面（用户/项目scope）
- [x] MCP增删改、健康检查
- [x] MCP项目服务器审批流程
- [x] MCP健康检查独立section（Servers/Health Check双tab）
- [x] Skills独立页面（已安装列表）
- [x] **Skills创建/编辑器（SKILL.md完整textarea）**
- [x] Skill详情查看和"Edit in form"跳转
- [x] 本地Skill安装
- [x] Skill详情查看/编辑

### A2UI 声明式界面
- [x] MCP 工具返回 `application/a2ui+json` 资源时拦截并内联渲染（Phase 1）
- [x] 内置 `RenderUI` 工具（turn 暂停等待用户交互，Phase 2）
- [x] 双向 action 回传：`sessions:submitA2uiAction` / `sessions:reportA2uiError` 两个 IPC 通道
- [x] **Basic Catalog 18 组件**：使用官方 `@a2ui/react@0.10.2` + `@a2ui/web_core@0.10.6` + `@a2ui/markdown-it@0.1.1`
- [x] 主题桥（`themeBridge.ts`）：Desktop CSS token → `--a2ui-*` 变量映射，深色模式自动同步 `a2ui-dark`/`a2ui-light` class
- [x] `DesktopMessage` 扩展三个可选字段：`a2uiMessages`、`a2uiToolUseId`、`a2uiSource`
- [x] 渲染器模块 `desktop/renderer/src/a2ui/`（4个模块：`A2uiSessionProcessor.ts`、`A2uiSurfaceHost.tsx`、`extract.ts`、`themeBridge.ts`）
- [x] **43 个官方一致性 fixture 全部通过**（jsdom 环境，`a2uiConformance.test.tsx`）
- [x] 功能开关：`CLAUDE_CODE_FEATURE_A2UI` feature flag，默认关闭

### Tasks (定时任务)
- [x] 项目级定时任务
- [x] 全局定时任务
- [x] Cron表达式支持

### @ Mentions 和 / Commands
- [x] @ 分组提及菜单（Agents/Teams/Files/Skills/MCP）
- [x] @自动路由到agent/team发送
- [x] / 斜杠命令分组（Prompt/Navigation/Create/Settings）
- [x] **实时@提及检测和可视化chips**：输入时实时解析所有@mentions并显示彩色标签
- [x] **自动同步chatTarget下拉**：检测到@agent/@team时自动更新发送目标选择器
- [x] **/@skill和@mcp正确处理**：提及skill/mcp/file时从文本中剥离并添加上下文标注
- [x] **/ 命令自动发送**：Prompt组斜杠命令选择后自动发送
- [x] **路由可视化**：chips区域显示消息将路由到哪个Agent/Team
- [x] **8个Prompt斜杠命令**：/review-diff, /explain-file, /write-tests, /run-tests, /fix-bugs, /refactor, /document, /plan
- [x] Tab/Enter确认，Esc关闭
- [x] Prompt命令展开为完整提示词
- [x] Action命令直接执行

### JSON-RPC活动追踪
- [x] 全量入站JSON-RPC消息捕获
- [x] 出站消息捕获（用户发送/agent launch/team send）
- [x] Runtime stderr捕获
- [x] 实时时间线（方向箭头、工具高亮）
- [x] 过滤器（All/Tools/Messages/System）
- [x] Raw JSON详情查看器
- [x] 自动滚动、复制、导出JSON
- [x] 导航徽章计数

### Settings
- [x] General分组（Runtime路径、诊断导出）
- [x] Configuration分组（Proxy设置）
- [x] Plugins管理
- [x] 分组设置搜索

---

## 📦 Stubs (占位包，非功能缺失)

以下是npm stubs用于提供类型定义，在生产构建中由实际包替换：

| Stub包 | 用途 | 状态 |
|--------|------|------|
| `@ant/claude-for-chrome-mcp` | 浏览器控制MCP服务器 | 有完整Playwright实现 |
| `@ant/computer-use-mcp` | 计算机使用MCP服务器 | 类型stub，运行时加载真实模块 |
| `@ant/computer-use-input` | 鼠标键盘输入模拟 | 有完整nut.js实现 |
| `@ant/computer-use-swift` | macOS原生API桥接 | 类型stub |

这些stub不影响桌面端功能，它们是CLI运行时的依赖。

---

## 📋 参考 Claude Quickstarts 的模式

Claude Quickstarts仓库包含以下参考实现模式：

1. **Agent类模式** (`agents/agent.py`): 系统提示词、工具列表、MCP服务器配置、消息历史管理
   - ✅ 已在desktop通过AgentDraft编辑器支持所有字段

2. **自主编码Agent** (`autonomous-coding/`): SDK客户端循环、工具执行、安全hook
   - ✅ 底层由CLI SDK提供，desktop提供UI监控

3. **Computer Use Demo**: 截图、鼠标键盘控制
   - ✅ 通过stubs中`@ant/computer-use-input`实现

4. **Browser Use Demo**: Playwright浏览器自动化
   - ✅ 通过stubs中`@ant/claude-for-chrome-mcp`提供完整MCP工具

5. **Customer Support Agent**: Web UI + API路由 + 多轮对话
   - 这是Next.js示例模式，desktop本身就是完整UI

6. **Financial Data Analyst**: 图表生成
   - 不在desktop核心范围内

---

## 🔧 可能的后续增强

非核心必需，生产可用无需：

- [ ] 内置Agent模板（如code-reviewer、test-writer）快速创建
- [ ] Skill模板库
- [ ] Agent任务输出实时流式查看
- [ ] 会话分支/对比视图
- [ ] 插件市场UI
- [ ] MCP服务器市场浏览
- [ ] A2UI Phase 3：MCP 来源 surface 的 action 回传（需先决策合成回合中继 vs main 进程独立 MCP 客户端，见设计文档 Section 8）
- [ ] A2UI Phase 4：放宽 CSP 或实现 main 进程媒体代理（`sessions:fetchA2uiMedia`），以支持 A2UI `Image`/`MediaPlayer` 组件加载远程资源


---

## Stub Audit (2026-07-24)

参考 [anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts) 完成审计：

### 已验证完成项
- [x] 所有4个npm stubs全部实现（chrome-mcp, computer-use-mcp, computer-use-input, computer-use-swift）
- [x] **@ant/computer-use-swift完整实现**：screencapture截图、system_profiler显示器、AppleScript应用管理、TCC权限检测
- [x] **Desktop自动启用Computer Use**：`applyDesktopRuntimeEnv`注入`CLAUDE_CODE_ENABLE_COMPUTER_USE=1`和`CLAUDE_CODE_ENABLE_CFC=1`
- [x] 全部65个IPC channel都有handler实现
- [x] 所有依赖已安装（playwright, nut-js, screenshot-desktop, clipboardy）
- [x] quickstarts中的Agent/MCP/Browser/Computer Use模式全部由CLI SDK层提供
- [x] 新增7个内置Agent模板（code-reviewer, test-writer, bug-finder, refactor, document-writer, browser-agent, computer-agent）
- [x] 新增3个Prompt斜杠命令（/write-tests, /document, /plan）

> **注（2026-08-21）**：以上「65个IPC channel」和「81处handleIpc」是 2026-07-24 审计时点的历史快照，在该审计完成后仍有通道陆续新增。截至 2026-08-21 实测为 **85 个 channel**、**85 处 `handleIpc`**；新增通道中有 2 个来自 A2UI 接入（`sessions:submitA2uiAction`、`sessions:reportA2uiError`），其余增长发生在本次 A2UI 接入之前。这两个数字是时点快照，不应被当作当前值读取。
