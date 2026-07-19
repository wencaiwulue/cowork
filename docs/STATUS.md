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

### Tasks (定时任务)
- [x] 项目级定时任务
- [x] 全局定时任务
- [x] Cron表达式支持

### @ Mentions 和 / Commands
- [x] @ 分组提及菜单（Agents/Teams/Files/Skills/MCP）
- [x] @自动路由到agent/team发送
- [x] / 斜杠命令分组（Prompt/Navigation/Create/Settings）
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

