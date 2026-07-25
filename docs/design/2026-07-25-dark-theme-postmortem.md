# Dark Theme 覆盖度排查 — 复盘文档

**日期**: 2026-07-25
**任务**: 为 Claude Code Desktop 实现全量暗色主题覆盖
**问题**: 初版实现后，Agents/Settings 等页面仍有大量浅色硬编码未覆盖，经过 3 轮迭代才修复完毕

---

## 问题现象

初版暗色主题（commit `b95a380`）覆盖了主要表面（sidebar、chat、composer、菜单、activity），但用户截图显示：

1. **Agents 页面**: 内容区出现白色横条（tab 栏、section 间隙），agent 卡片之间的分隔线为白色
2. **Settings 页面**: sidebar 仍是浅灰 `#e8e6df` + 蓝色渐变，导航 hover 态是半透明白，sticky header 是半透明白，表单/选择框背景白色
3. 多个组件（plan approval bar buttons、command palette、status banners、todo states、diff/preview 等）也有遗漏

---

## 根因分析

### 1. 搜索策略缺陷：按色值字符串 grep，而不是按视图/组件逐页排查

**错误做法**:
```bash
grep -n '#fff\b\|#fffdfa\|#fbfaf7\|#f6f4ef' styles.css
```
这只能命中"最典型的白底"，遗漏了：
- `#e8e6df`（settings sidebar 浅灰底）
- `rgba(255,255,255,0.72)`（半透明白色 hover 态）
- `rgba(255,255,255,0.42)`（半透明白色输入框）
- `rgba(255,253,250,0.96)`（sticky header 米白半透明）
- `linear-gradient(120deg, rgba(67,95,199,0.06), transparent 38%), #e8e6df`（渐变+底色组合）
- `#f4f6ff`（蓝色高亮态）
- `#fff8f2`、`#eef1ff`、`#edf7f0`、`#fff1ef`（彩色状态背景）
- `color: #8f6b43`（硬编码的棕色文字）

**正确做法**: 按页面视图（primary-chat / primary-agents / primary-settings / primary-teams / primary-tasks / primary-mcp / primary-skills）逐一检查，从每个视图的最外层容器开始，沿 DOM 层级确认每个元素的 background/color/border。

### 2. 过度信任 CSS 变量覆盖机制

大部分组件用 `var(--surface)` / `var(--bg)` / `var(--text)` 等变量，在 `[data-theme="dark"]` 块里重写变量值即可批量生效。但实际代码中存在大量"绕过变量直接写死颜色值"的样式，这些是历史遗留，不会因为变量重写而自动变色。

**遗漏模式**:
```css
/* 这个能被变量覆盖生效 */
.something { background: var(--surface); }

/* 这个不会，需要单独写 [data-theme="dark"] 覆盖 */
.something-else { background: #fbfaf7; }
.another-thing { background: rgba(255,255,255,0.48); }
```

### 3. 缺少"未定义 CSS 变量"的检测

排查中发现多个 CSS 变量被使用但从未定义：
- `--border`、`--bg-subtle`、`--bg-hover`、`--bg-selected`
- `--text-muted`、`--accent-contrast`

这些变量在 light 模式下 fallback 为 `initial`（通常是透明/黑色），碰巧和周围样式"看起来还行"；在 dark 模式下它们也是 undefined，导致使用这些变量的组件（filter-tabs、resource-row、config-list）背景透明或颜色错误。

**应当在 `:root` 中定义所有被引用的变量，再在 `[data-theme="dark"]` 中覆盖。**

### 4. 双栏布局的两个面板需要独立检查

Settings 页面是 `settings-sidebar` + `settings-content` 双栏结构；Agents 页面也有 pane-toolbar + content。初版只覆盖了通用的 `.settings-section`，但遗漏了：
- sidebar 自身的背景和内部元素
- sticky header 的半透明背景
- content 区域的背景（当 section cards 之间有间隙时露出白色）

### 5. 没有视觉验证手段

纯靠静态代码扫描无法发现"运行时白色间隙"这类问题。应在每轮 CSS 修改后启动应用逐页视觉检查。

---

## 修复策略（最终采用）

经过 3 轮迭代，最终的修复方法是：

1. **定义全部未定义变量**: 在 `:root` 中补充 `--border`、`--bg-subtle`、`--bg-hover`、`--bg-selected`、`--text-muted`、`--accent-contrast`，在 `[data-theme="dark"]` 中分别覆盖为暗色值
2. **按视图分组写覆盖规则**: 不是按色值扫描，而是按 `.agents-pane`、`.settings-sidebar`、`.settings-content` 等容器分组，覆盖容器和所有子元素的硬编码颜色
3. **使用 `!important` 兜底**: 对组合背景（`linear-gradient(...) , #fffdfa`）需要 `!important` 才能完全覆盖
4. **全量色值扫描兜底**: 最后 grep 所有 hex/rgb/rgba/hsl 颜色值，逐个确认是否已在 dark block 中覆盖

---

## 经验教训 / Checklist

### 实现主题切换前

- [ ] 审计现有 CSS：`grep -n '#[0-9a-fA-F]\{3,6\}\|rgb\|rgba\|hsl' styles.css` 列出所有硬编码颜色
- [ ] 确认所有 `var(--xxx)` 引用都有定义（在 `:root` 中搜索）
- [ ] 列出所有页面/视图（非组件），建立覆盖率检查表

### 实现主题时

- [ ] 先把所有色彩相关的值抽成 CSS 变量（如果技术债允许），而不是直接用 hex
- [ ] 在 `[data-theme="dark"]` 中覆盖所有变量，再为硬编码值写单独 override
- [ ] 注意 `background` 简写属性（含 gradient + color 双重背景）需要完整覆盖
- [ ] 注意半透明颜色（rgba white）不会被 solid color 变量自动覆盖
- [ ] sticky/fixed 元素的半透明背景要单独处理

### 验证

- [ ] 逐页视觉检查（Chat / Agents / Teams / Tasks / MCP / Skills / Settings）
- [ ] 检查 hover/active/focus/disabled/empty/error/success 等所有状态
- [ ] 检查 sticky headers、modal backdrops、context menus、tooltips
- [ ] 切换主题不需要 reload（属性选择器即时生效）
- [ ] 缩放窗口测试 container queries
- [ ] TypeScript 编译 + Vite build 通过

---

## 文件变更记录

| 轮次 | 行范围 | 覆盖内容 |
|------|--------|----------|
| 第1轮 (初始) | L3759-3886 | 基础 token、shell、sidebar、chat、composer、message、menu、activity |
| 第2轮 | L3888-4149 | status banners、plan buttons、forms、cards、command palette、tree、config-list、jumpbar、terminal、resize handle、scrollbar |
| 第3轮 | L4151-4444 | 补充缺失 CSS 变量定义、primary panes 背景、filter tabs、pane toolbar、agent cards、search inputs、message bubbles、diff/preview、editor placeholder、title bar、activity card |
| 第4轮 | L4508-4594 | Settings sidebar 全量覆盖（search input、nav buttons、nav-empty、sticky header、content bg、section cards、forms、team member select/empty、config list active、grid items、proxy inputs、toggles） |
