# Claude Code Desktop — 全面交互审计报告

**日期**: 2026-07-25
**审计方法**: 代码静态分析 + CSS 色值扫描（未做实时 GUI 测试，因沙箱环境 GUI 启动受限）
**代码版本**: master 分支，暗色主题实现后

---

## 校准说明 (2026-07-25)

> 本报告经第二轮交叉验证，发现以下条目已在代码中实现，与原报告描述不符：**P0-3、P1-3、P1-5、P1-7、P1-8**。已分别标注为 **【已校准：实际已实现】**。行号引用以本次校准为准。
>
> 另在校准过程中发现新增候选项 **P2-13**（mention popup 缺 `role="listbox"`）经核实同样已实现，一并标注为 **【已校准：实际已实现】**，未计入修复队列。
>
> **P1-5 校准补充**: ⌘K Command palette 已包含 Chat/Agents/Teams/Tasks/MCP/Skills/Settings 七条导航命令（`App.tsx:3993-4050`），原"缺少导航命令"描述不成立。仅保留分组/分隔符、加载期间不禁用等小改进建议，归入 **P1-1 loadingLabel 拆分** 的连带改动处理，不再作为独立缺陷计入修复队列。详见 `docs/design/2026-07-25-interaction-fixes.md` 第 26 行及 §3.5。
>
> 本次校准同时新增以下真实缺陷：**P1-10 / P1-11 / P1-12 / P1-13 / P2-14**，并对 **P1-1** 补充了具体证据。

---

## 严重级别定义

| 级别 | 含义 |
|------|------|
| **P0** | 功能缺陷 — 按钮无响应、数据丢失、崩溃 |
| **P1** | 交互问题 — 无 loading/error 反馈、快捷键失效、状态不一致 |
| **P2** | 视觉/美感 — 暗色遗漏、间距不一致、对比度不足 |

---

## P0 — 功能缺陷

### P0-1: 暗色主题仍有 127 处硬编码浅色未覆盖
- **位置**: `desktop/renderer/src/styles.css` 全文
- **问题**: 经过 4 轮修补后，仍有 127 行硬编码颜色（hex/rgb）不在任何 `[data-theme="dark"]` 块内。涉及的组件包括：
  - `.inline-status.success` 绿色成功背景 `#edf7f0` / 文字 `#2f6f46`
  - `.conversation-status` 蓝色信息背景 `#eef1ff`
  - `.plan-approval-bar` 绿色渐变 `#e8f5e9→#f1f8e9`、边框 `#c8e6c9`、文字 `#2e7d32`/`#43a047`、reject 红色 `#c62828`
  - `.goal-bar` 琥珀色渐变 `#fff3e0→#fef9e7`、边框 `#ffe0b2`
  - `.message-user` 气泡 `#f0ede7`、`.message-plain`/`.message-markdown` 气泡 `#fff`
  - `.settings-form` 表单背景 `#fbfaf7`
  - `.config-list article.active` 蓝色高亮 `#f4f6ff`
  - `.command-palette-hint` 金色高亮 `#fff8e8`/`#735225`/`#e1b365`
  - `.composer-menu` popup 背景 `#fffdfa`
  - `.team-member-select` 背景 `#fbfaf7`、hover `#f4f6ff`
  - `.activity-card` 背景 `#fbfaf7`
  - `.pane-status.success` `#edf7f0`/`.pane-status.error` `#fff1ef`
  - `.diff-inline-status` 同上
  - `.preview-status` 同上
  - `.tree-row.active` `#eef1ff`
  - `.todo-state`（in_progress/completed）蓝色/绿色背景
  - Code block 容器背景 `#f6f4ef`
  - Message copy button success `#edf7f0`
  - Editor placeholder 背景 `#fff`
  - 多处 `color: #8f6b43`（棕色 accent 文字）
  - Skill empty state `#fff8f2`
  - Mention chips 的 color-mix 颜色在暗色背景上对比度低
- **根因**: 历史代码大量直接使用 hex 值，未抽成 CSS 变量；之前的修补是"哪里亮了改哪里"的 whack-a-mole 方式
- **建议修复**: 一次性写一个完整的 `[data-theme="dark"]` 覆盖块，包含所有剩余选择器

### P0-2: IDE Pane 中 Editor/Terminal/Preview 的生产环境加载路径问题
- **位置**: `desktop/main/main.ts`
- **问题**: 生产构建（`desktop:build`）下 Monaco editor 的 worker 路径、xterm.js 资源路径可能有 CSP 或路径问题，已发现 CSP 头限制 `worker-src` 未包含
- **影响**: Editor 可能空白或报错；Terminal 可能无法渲染
- **建议**: 验证打包后 Monaco workers 加载、xterm CSS 加载

### P0-3: 会话错误状态只显示不消失  【已校准：实际已实现】
- **位置**: `desktop/renderer/src/App.tsx:11060`（原报告误记为 10988，已更正）
- **原描述**: `activeSession?.lastError` 渲染为 `.inline-error`，但没有 dismiss 按钮或自动消失机制
- **校准结果**: **已实现，原描述不准确。** 代码已包含按 session 维度的关闭机制：
  - `dismissedSessionErrors` Set state（`App.tsx:1920`）记录已关闭错误的 session id
  - 渲染条件 `{activeSession?.lastError && !dismissedSessionErrors.has(activeSession.id)}`（`App.tsx:11060`）
  - `.error-dismiss` 关闭按钮 + `aria-label="Dismiss error"`（`App.tsx:11063`），点击后把当前 session id 加入 `dismissedSessionErrors`
  - 容器 class 为 `inline-error dismissible-error`（`App.tsx:11061`）
- **备注**: 仅 `activeSession.lastError` 有关闭机制；通用 `error` state 的 `.inline-error`（`App.tsx:11068`）仍无关闭按钮，详见新增 **P1-10**。



---

## P1 — 交互问题

### P1-1: 全局加载状态 `loadingLabel` 粒度太粗
- **位置**: `desktop/renderer/src/App.tsx:1918`（全局单一 `loadingLabel` state），被 30+ 处 `disabled={!!loadingLabel}` / `readOnly: !!loadingLabel` / `tabIndex: loadingLabel ? -1 : 0` 引用
- **问题**: 任何异步操作（diagnose、refresh、select agent、send message）都会设置同一个 `loadingLabel`，导致整个页面多处按钮被 disable，哪怕这些按钮和当前操作无关。典型"操作 A 卡住操作 B"案例：
  - 刷新 MCP servers 时同时 disable composer 发送按钮和 session 关闭按钮
  - 关闭 session 进行中会 disable 所有 task 创建/删除按钮（`App.tsx:10735` 的 "Remove scheduled task"、`App.tsx:11936` 的 agent 删除）
  - 导出 diagnostics 时会把 Monaco 编辑器设为只读（`App.tsx:4564` / `4589`）并把所有 listbox 的 `tabIndex` 设为 -1（`App.tsx:6437` / `6473` / `6501` / `6525`）
- **建议修复**: 拆为 per-action loading flags（如 `loadingDiagnostics`、`loadingRefresh`、`loadingSessionAction` 等），让每个 `disabled` 判定只绑定与之相关的 flag

### P1-2: 错误通知没有 stack trace 或 retry 按钮
- **位置**: `desktop/renderer/src/App.tsx` 的 `runAction()` 函数
- **问题**: catch 到错误后只调用 `setError(message)` 显示文字，没有 retry 按钮，没有 "Show details" 展开 stack trace
- **建议**: 在错误 banner 上添加 "Retry" 和 "Details" 按钮

### P1-3: Plan approval bar 的 Approve/Reject 没有 keyboard shortcut  【已校准：实际已实现】
- **位置**: `desktop/renderer/src/App.tsx:6204-6218`
- **原描述**: 当 plan approval bar 出现时，用户必须用鼠标点击 Approve/Reject，没有键盘快捷键
- **校准结果**: **已实现，原描述不准确。** 已有 keydown 监听（`App.tsx:6205-6218`）：
  - `Enter`（无 Shift、非 composing）→ `event.preventDefault()` + `approvePlan()`
  - `Escape` → `event.preventDefault()` + `rejectPlan()`
  - 监听仅在 `planApprovalPending` 为真时挂载，卸载时清理


### P1-4: Session 列表没有重命名快捷键
- **问题**: 重命名 session 需要右键菜单 → Rename，没有双击或 F2 快捷键
- **建议**: 支持双击 session 行进入重命名

### P1-5: ⌘K Command palette 中没有 settings/agents 快速跳转  【已校准：实际已实现】
- **位置**: `desktop/renderer/src/App.tsx:3993-4050`
- **原描述**: Command palette 目前主要是文件/slash 命令，不能快速跳转到 Agents/MCP/Settings 等页面
- **校准结果**: **已实现，原描述不准确。** Command palette 已包含完整的页面导航命令（`App.tsx:3993-4050`）：
  - `Go to Chat` / `Go to Agents` / `Go to Teams` / `Go to Tasks` / `Go to MCP` / `Go to Skills` / `Go to Settings` 七条 `primary:*` 导航命令已存在
  - 每条命令通过 `run: () => setActivePrimary('xxx')` 切换主视图，行为正确
  - 设计文档 `docs/design/2026-07-25-interaction-fixes.md` 第 26 行亦确认此点："The command palette already contains navigation commands for Chat/Agents/Teams/Tasks/MCP/Skills/Settings (`App.tsx:3993-4050`)."
- **备注**: 功能已存在，但仍有改进空间（见 `2026-07-25-interaction-fixes.md` §3.5）：
  - 导航命令与 slash 命令混排，缺少分组/分隔符（建议增加 `'Navigate'` 分组标题）
  - 导航命令当前受 `disabled: !!loadingLabel` 约束，加载期间不应被禁用（应移除该 `disabled` 绑定，导航始终可用）
  - 缺少快捷键提示（如 `detail: 'Open the conversation (⌘1)'`）
  - 这些改进属于 **P1-1 loadingLabel 拆分** 的连带改动，不再作为独立缺陷计入修复队列

### P1-6: 多 session 并行回复时没有区分 UI
- **问题**: 如果多个 session 同时有流式响应，UI 中没有明显区分哪个 session 在回复
- **建议**: sidebar session row 增加流式动画指示

### P1-7: File attachment 只支持图片  【已校准：实际已实现】
- **位置**: `desktop/renderer/src/App.tsx:1808`（`handleFileInputChange`）
- **原描述**: 拖入 PDF、代码文件、文本文件等都被忽略
- **校准结果**: **已实现，原描述不准确。** 接受的 MIME 类型已扩展为三类：
  ```ts
  if (file.type.startsWith('image/') || file.type === 'application/pdf' || file.type.startsWith('text/'))
  ```
  覆盖图片、PDF、以及所有 `text/*` 文本类附件。


### P1-8: Composer 没有自动增高（textarea auto-resize）  【已校准：实际已实现】
- **位置**: `desktop/renderer/src/App.tsx:4871-4878`（`autoResizeComposer`）
- **原描述**: 多行输入时 textarea 出现滚动条而不是自动增高
- **校准结果**: **已实现，原描述不准确。** `autoResizeComposer` 已实现：
  - 先设 `height = 'auto'`，再取 `scrollHeight` 与 `maxHeight = 200` 取较小值
  - `scrollHeight > maxHeight` 时 `overflowY = 'auto'`，否则 `overflowY = 'hidden'`


### P1-9: 右键 context menu 没有键盘导航
- **问题**: session 右键菜单不支持方向键选择 + Enter 确认

### P1-10: 通用 error 不可恢复（无 retry / 无详情 / 无自动消失）
- **位置**: `desktop/renderer/src/App.tsx:2119, 2126, 11068`
- **问题**: `runAction` catch 到错误后只调用 `setError(message)`，渲染为 `.inline-error`（`App.tsx:11068`），但：
  - 无 retry 按钮、无 "Show details" 展开 stack trace
  - 无自动消失定时器，错误一直停留在页面上
  - 只在下一次 `runAction` 开始时通过 `setError(undefined)`（`App.tsx:2119`）清除
- **对比**: `conversationNotice` 有 3-8s timeout 自动清理（`App.tsx:2682-2687`，error=8s / info=5s / success=3s），`activeSession.lastError` 有 dismiss 按钮（见 P0-3），唯独通用 `error` 既无 timeout 也无 dismiss
- **建议**: 为通用 error 增加 retry 入口、可展开的详情区（stack trace），或至少加一个 dismiss 按钮 / 自动消失定时器，与 `conversationNotice` 行为对齐

### P1-11: session 右键菜单无 focus trap
- **位置**: `desktop/renderer/src/App.tsx:11001-11044`（`sessionMenu`）、`App.tsx:10966+`（`sessionCreateMenu`）
- **问题**: `sessionMenu` / `sessionCreateMenu` 打开后：
  - 焦点不转移到菜单容器，关闭后也不还原到触发元素
  - Tab 可逃逸到背后 UI，键盘用户难以到达菜单项
  - ArrowDown 只切 `sessionMenuActiveIndex` / `sessionCreateMenuActiveIndex` 索引，不调用 `focus()` 聚焦菜单项
- **对比**: modal / permission / command palette 已有完整 focus trap（`trapModalFocus` 在 `App.tsx:2235-2327`，被 `confirmModal` / `permissionModal` / `commandPalette` 三处复用，`App.tsx:2610-2659` / `85105` / `85723` / `86661`），但 session 菜单未接入
- **建议**: 把 `trapModalFocus` 推广到 session 菜单，或抽出独立的 `trapMenuFocus` 工具函数；打开时 `focus()` 到首项，关闭时还原到触发按钮

### P1-12: 无 F2 重命名 session，command palette 也无 "Rename session" 命令
- **位置**: 全文搜索 `F2` / `rename` 在 `App.tsx` 中无任何匹配
- **问题**: 快捷键体系覆盖 ⌘K / ⌘N / ⌘W / ⌘1-7 / ⌘, / Enter / Esc，但缺 F2 重命名；command palette 也没有 "Rename session" 命令项，用户只能通过右键菜单 → Rename
- **建议**: 增加 F2 快捷键触发当前选中 session 的重命名；在 command palette 增加 "Rename session" 命令

### P1-13: 多数空状态无 CTA 引导按钮
- **位置**: 多处空状态仅有 icon + 文字，缺少引导操作按钮
- **已实现 CTA（对照）**: session 空状态有 CTA（`App.tsx:11116-11121`，"Quick session" + "Choose folder" 两个按钮）
- **缺失 CTA 的空状态**:
  - agents 列表空状态（`App.tsx:11863-11876`）：仅 "No agents loaded" 文字
  - teams 列表空状态（`App.tsx:12656-12660`）：仅 "No teams found" 文字
  - teammates 列表空状态（`App.tsx:12635-12639`）：仅 "No teammates reported" 文字
  - project scheduled tasks 空状态（`App.tsx:10635-10639`）：仅 "No project scheduled tasks" 文字
  - global scheduled tasks 空状态（`App.tsx:10742-10746`）：仅 "No global scheduled tasks" 文字
- **建议**: 在上述空状态增加主操作 CTA 按钮（如 agents 空 → "Refresh agents"、teams 空 → "Create team"、tasks 空 → "Add task"），与 session 空状态风格一致

---

## P2 — 视觉/设计美感

### P2-1: 色板不一致 — 存在两套色彩系统
- **问题**: CSS 中混用两套变量名：
  - 新系统：`--bg`, `--surface`, `--surface-2`, `--surface-3`, `--hairline`, `--muted`
  - 旧系统：`--border`, `--bg-subtle`, `--bg-hover`, `--bg-selected`, `--text-muted`, `--accent-contrast`
- 旧变量虽然我在修复中补了定义，但两套命名让维护困难
- **建议**: 统一为一套变量名，移除旧别名

### P2-2: 圆角不一致
- **问题**: 按钮用 6px/7px/8px/10px 不等，卡片用 6px/8px，composer 用不同值
- **建议**: 定义 `--radius-sm: 6px`, `--radius-md: 8px`, `--radius-lg: 12px`, `--radius-xl: 16px` token 并统一使用

### P2-3: 间距/spacing 无 token
- **问题**: padding/margin/gap 使用 4px/6px/7px/8px/10px/12px/14px/16px 随机混用
- **建议**: 定义 `--space-1` 到 `--space-8` (4px-32px) 间距 token

### P2-4: 暗色主题下 mention chips 颜色对比度不足
- **位置**: L3405-3431，使用 `color-mix(in srgb, #4ade80 15%, transparent)` 作为背景
- **问题**: 15% 透明度的绿色在 `--surface` 深灰背景上几乎不可见
- **建议**: 暗色下提高到 25-30% 或直接用 `var(--green)` 等 token

### P2-5: Typography scale 不统一
- **问题**: font-size 使用 10px/11px/12px/13px/14px/15px 混用，没有明确的层级
- **建议**: 定义 `--text-xs/sm/base/lg/xl` 字号 token

### P2-6: Activity tab 的 JSON-RPC timeline 间距太密
- **问题**: activity item 之间间距只有 1-2px，时间戳和方法名混在一起，难以快速 scan
- **建议**: 增加 padding，方法名用 monospace 加粗

### P2-7: 左侧 rail 中新 chat 按钮 "+" 和下方 session 列表视觉层级不清晰
- **问题**: "+ New chat" 按钮和 session row 使用相似的背景色，区分度不够
- **建议**: "+ New chat" 用实心 accent 背景（类似 ChatGPT），session row 用透明背景

### P2-8: 暗色模式下 scrollbar 颜色偏亮
- **位置**: `--scrollbar-thumb: rgba(154, 147, 136, 0.35)`
- **问题**: 在深灰背景上灰色滚动条显得突兀
- **建议**: 降低 opacity 或使用更暗的颜色

### P2-9: Plan approval bar 和 Goal bar 的渐变在暗色下过于饱和
- **问题**: `linear-gradient(135deg, #1a2e1a, #1f2e17)` 绿色渐变在暗色背景上显得太重
- **建议**: 用 `var(--surface-2)` + 左边框 accent 色代替渐变

### P2-10: Message bubble 样式 — 用户消息和助手消息区分度不够
- **问题**: 暗色下用户消息 `background: var(--surface-2)` 和助手消息 `background: var(--surface)` 差异不明显
- **建议**: 用户消息用更明显的 accent-tinted 背景

### P2-11: 空状态图标/文字不够友好
- **问题**: 多处空状态只用一个 icon + 一句话，没有引导操作（如 "Create your first agent" 按钮）
- **建议**: 在空状态添加 CTA 按钮

### P2-12: Toolbar buttons (Files/Diff/Editor/Terminal/Preview) 在暗色下 icon 和文字没有对齐
- **问题**: 之前修复 tab 大小后，icon 和 text label 的 baseline 可能不对齐

### P2-13: mention popup 未标注 role="listbox"  【已校准：实际已实现】
- **位置**: `desktop/renderer/src/App.tsx:11353-11363`
- **原描述**: mention popup 未标注 `role="listbox"`，可访问性瑕疵
- **校准结果**: **已实现，原描述不准确。** `composer-menu` popup（`App.tsx:11354-11363`）已设置：
  - `id="composer-menu-listbox"`
  - `role="listbox"`（`App.tsx:11357`）
  - `aria-label` 根据 trigger 动态切换：`'@'` 时为 "Mention resources"，`'/'` 时为 "Composer actions"（`App.tsx:11358`）
  - `aria-activedescendant` 指向当前高亮项（`App.tsx:11359-11363`）
- **备注**: 该 popup 同时承载 mention 和 slash 命令，共用 `composerMenuItems` 的行为见新增 **P2-14**

### P2-14: mention popup 与 slash popup 共用 `composerMenuItems`，混合输入行为不直观
- **位置**: `desktop/renderer/src/App.tsx:3600`（`if (currentComposerTrigger.kind === '@')`）及 `composerMenuItems` state
- **问题**: mention（`@`）和 slash 命令（`/`）两个触发器共用同一份 `composerMenuItems` state 和同一个 popup 渲染路径（`App.tsx:11353+`）。当用户混合输入 `@agent/something` 时，trigger 切换逻辑可能导致菜单内容突变或意外关闭，行为不直观
- **建议**: 评估是否拆为独立的 `mentionItems` / `slashItems` state，或在 trigger 切换时给用户更明确的视觉反馈

---

## 视图专项问题

### Chat 视图
- **P2-10**: 消息气泡区分度
- ~~**P1-8**: composer textarea 不自动增高~~ 【已校准：`autoResizeComposer` 已实现，`App.tsx:4871-4878`】
- ~~**P1-3**: plan approval 无键盘快捷键~~ 【已校准：Enter/Escape 已实现，`App.tsx:6204-6218`】
- ~~**P1-7**: attachment 只支持图片~~ 【已校准：已支持 image/ + application/pdf + text/*，`App.tsx:1808`】
- **P1-10**: 通用 error 无 retry / 无详情 / 无自动消失（`App.tsx:11068`）
- **P2**: code block 中复制按钮的 success 态颜色未暗化（L942-943）

### Agents 视图
- **P0-1**: agent 卡片背景暗色未覆盖（已通过 `.config-list article` 部分修复，但 hover/active 态仍有问题）
- **P1-1**: 全局 loadingLabel 导致 Diagnose 时不该 disable 的按钮也被 disable
- **P2-12**: filter-tabs 在暗色下 active 态的 accent 色对比度需要确认

### Settings 视图
- **P0-1**: settings-sidebar 背景已修复，但 `.settings-content-header` sticky 背景、`.settings-form` 背景、`.team-member-select` 背景需要确认
- **P2**: settings 中 radio button（主题选择）在暗色下用原生样式可能不协调

### IDE Pane
- **P0-2**: Monaco/xterm 生产路径问题
- **P0-1**: `.diff-viewer` 背景 `#fff`、`.preview-frame` 背景 `#fff` 未暗化

### 全局
- **P1-1**: 全局 loadingLabel 粒度太粗（`App.tsx:1918`，30+ 处 disable 引用，详见条目）
- **P1-2**: 错误通知无 retry/details（与 **P1-10** 重叠，P1-10 描述更完整，建议合并处理）
- **P1-10**: 通用 error 不可恢复（无 retry / 无 stack trace / 无自动消失）
- **P1-11**: session 右键菜单无 focus trap（`App.tsx:11001-11044`）
- **P1-12**: 无 F2 / command palette 重命名 session
- ~~**P1-5**: ⌘K palette 缺少导航命令~~ 【已校准：`App.tsx:3993-4050` 已实现 Chat/Agents/Teams/Tasks/MCP/Skills/Settings 七条导航命令；分组/分隔符与加载期间不禁用的改进建议归入 P1-1 连带处理】
- **P2-1**: 色板双系统不一致
- **P2-2/3/5**: 无 design tokens（圆角/间距/字号硬编码）
- **P2-14**: mention / slash popup 共用 `composerMenuItems`（`App.tsx:3600`）

---

## 修复优先级建议

> 已校准条目（P0-3 / P1-3 / P1-5 / P1-7 / P1-8 / P2-13）已从修复队列中移除，详见各条目"已校准"标注。

1. **第一批 (P0)**: 写完剩余 127 行暗色覆盖（预计 ~150 行 CSS，一次性写完）+ 验证 IDE pane 资源加载
   - ~~session lastError dismiss~~ 【已校准：`App.tsx:11060-11066` 已实现 dismiss 按钮】
2. **第二批 (P1)**:
   - 拆分 `loadingLabel` 为 per-action state（**P1-1**，影响面最广，30+ 处 disable 引用）
   - 通用 error 增加 retry / details / dismiss（**P1-10**，与 **P1-2** 合并处理）
   - session 右键菜单接入 focus trap（**P1-11**，复用现有 `trapModalFocus`）
   - F2 重命名 + command palette "Rename session" 命令（**P1-12**）
   - 补齐 agents / teams / teammates / tasks 空状态 CTA（**P1-13**）
   - ~~⌘K palette 缺导航命令~~ 【已校准：`App.tsx:3993-4050` 已实现七条导航命令，仅分组/分隔符与 `loadingLabel` 期间禁用改进需随 P1-1 一并处理，见 `2026-07-25-interaction-fixes.md` §3.5】
   - ~~composer auto-resize~~ 【已校准：`App.tsx:4871-4878`】
   - ~~plan approval 键盘快捷键~~ 【已校准：`App.tsx:6204-6218`】
   - ~~attachment 扩展 MIME~~ 【已校准：`App.tsx:1808`】
3. **第三批 (P2)**: 抽取 design tokens（颜色/间距/圆角/字号）→ 统一替换 → 视觉打磨
   - 评估 mention / slash popup 共用 `composerMenuItems` 的拆分（**P2-14**）
   - ~~mention popup role="listbox"~~ 【已校准：`App.tsx:11357` 已标注】

---

## 附录：未覆盖的硬编码颜色完整列表

（按行号排列，来自 `awk` 扫描结果）

```
90,297,309,640,641,691,702,715,724,757,758,798,804,881,942,943,
952,991,997,1003,1004,1019,1113,1127,1134,1139,1140,1153,1154,
1168,1169,1179,1209,1243,1275,1284,1312,1382,1403,1566,1575,
1589,1595,1596,1612,1617,1618,1622,1623,1630,1712,1739,1855,
1903,1912,1913,1921,1922,1942,1977,1993,2001,2005,2024,2031,
2047,2049,2050,2058,2069,2080,2121,2178,2289,2352,2395,2427,
2436,2453,2611,2652,2660,2687,2725,2732,2839,2858,2859,3184,
3185,3221,3222,3267,3268,3272,3273,3405,3406,3407,3411,3412,
3413,3417,3418,3419,3423,3424,3425,3429,3430,3431,3541,3601,
3625,3626,3627,3636,3643,3660,3664,3696,3697,3698,3713,3728,
3735,3751
```
