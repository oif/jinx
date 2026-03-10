# DESIGN.md — Jinx 视觉设计体系

> 这是 `site/` 的强约束设计指南。
> 修改站点外观时，必须维护本文件定义的视觉语言。
> 风格可以精炼，但其科幻/外星科技树的核心美学不可丢弃。

---

## 视觉语言

**主题：外星科技树 · 神经星座**

灵感来源：科幻游戏 HUD、赛博朋克终端界面、星际飞船仪表盘。
整体感受：黑暗宇宙中一颗正在生长的神经节点，数据在霓虹光线中流动。

---

## 色彩系统

### 背景
| 层级 | 色值 | 用途 |
|------|------|------|
| 底层背景 | `#020608` | `<body>` 背景 |
| 网格点 | `rgba(0,217,255,0.045)` | 32px 点阵网格 |
| 顶部光晕 | `rgba(0,217,255,0.07)` | 页面顶部椭圆渐变 |

### 霓虹色板（CSS 变量）
```css
--neon-cyan:   #00d9ff   /* 主色 · 数据/系统/信息 */
--neon-violet: #c77dff   /* 专家级 · 最高成熟度 */
--neon-green:  #00ff88   /* 成功/在线/生存 */
--neon-amber:  #ffaa00   /* 警告/认知 */
--neon-red:    #ff4040   /* 错误/危险 */
```

### 文字层次
| 层级 | 色值 | 用途 |
|------|------|------|
| 主文字 | `#e2e8f0` | 标题、重要内容 |
| 次文字 | `#94a3b8` | 正文描述 |
| 暗文字 | `rgba(148,163,184,0.58)` | 次要描述 |
| 注释文字 | `rgba(148,163,184,0.3)` | 时间戳、标注 |
| Mono 标签 | `rgba(0,217,255,0.5)` | 区块标题、系统标签 |

---

## 字体

- **正文**：Geist Sans（`var(--font-sans)`）
- **代码/数据/标签**：Geist Mono（`var(--font-mono)`）
- **所有系统标签**：全大写 + `tracking-wider/widest` + 等宽字体
- **数字**：`tabular-nums` 保持对齐

---

## 组件规范

### 面板（Panel）

**主面板（Alien Panel）**
```css
background: rgba(0,217,255,0.025);
border: 1px solid rgba(0,217,255,0.14);
clip-path: polygon(16px 0%, 100% 0%, 100% calc(100% - 16px), ...);  /* 切角 */
/* 顶部光线 */
::before { background: linear-gradient(90deg, transparent, rgba(0,217,255,0.45), transparent); }
```

**次面板（Dim Panel）**
```css
background: rgba(255,255,255,0.02);
border: 1px solid rgba(255,255,255,0.07);
```

**禁止使用**：`bg-white/5`、`rounded-xl`（圆角）、纯白边框

### 切角（Clip Path）

所有面板必须使用切角而非圆角：
- `.clip-sm`：10px 切角（小组件）
- `.clip-md`：16px 切角（标准面板）
- `.clip-lg`：24px 切角（大面板/卡片）
- `.clip-slant`：平行四边形（标签/徽章）

### 区块标题（Section Label）

```html
<div class="sect-label">SECTION NAME</div>
```
效果：`// SECTION NAME ─────────────────`

- 全大写 + `tracking-[0.22em]` + `font-mono`
- 颜色：`rgba(0,217,255,0.55)`
- 前缀自动添加 `//`，后跟渐变分隔线

### 进度条（Neon Bar）

```css
height: 3px;  /* 纤细 */
background: <neon-color>;
box-shadow: 0 0 6px <neon-color>;  /* 发光 */
```
颜色分配：CPU=cyan，Memory=violet，Disk=green

### 科技树节点（Tech Tree Node）

成熟度对应颜色：
| 成熟度 | 颜色 | 发光 |
|--------|------|------|
| novice (I) | `#64748b` | 无 |
| advanced (II) | `#00d9ff` | `0 0 12px rgba(0,217,255,0.25)` |
| expert (III) | `#c77dff` | `0 0 18px rgba(199,125,255,0.38)` + 脉冲动画 |

节点使用 8px 切角：
```css
clip-path: polygon(8px 0%, 100% 0%, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0% 100%, 0% 8px);
```

类别颜色：
| 类别 | 图标 | 颜色 |
|------|------|------|
| survival | ⬡ | `#00ff88` |
| identity | ◈ | `#00d9ff` |
| evolution | ⟳ | `#c77dff` |
| cognition | ◉ | `#ffaa00` |
| communication | ⊿ | `#00d9ff` |
| adaptation | ⧖ | `#00ff88` |
| minimalism | ◇ | `#94a3b8` |
| extension | ⊕ | `#c77dff` |

---

## 动画

| 动画 | 用途 | 时长 |
|------|------|------|
| `scan-line` | 全页扫描线（固定定位） | 7s linear infinite |
| `pulse-green` | 在线状态指示灯 | 1.8s ease-in-out infinite |
| `pulse-cyan` | 主色强调元素 | 2.5s ease-in-out infinite |
| `pulse-violet` | 专家级节点 | 3s ease-in-out infinite |
| `glitch` | 英雄标题偶发故障效果 | 9s infinite（87% 时间静止）|
| `cursor-blink` | 终端光标 | 1s step-end infinite |

**动画克制原则**：
- 只在关键状态指示器上使用脉冲
- 扫描线不透明度不超过 0.5
- glitch 效果每 9 秒只触发一次，持续约 2 帧

---

## 禁止事项

- ❌ 圆角（`rounded-*`）用于主面板
- ❌ `bg-white/5`、`bg-zinc-*` 用于背景
- ❌ 颜色过于丰富（每个区块最多 2 种霓虹色）
- ❌ 普通正文使用 `text-white`（应用 `#e2e8f0`）
- ❌ 添加投影（`shadow-*`）代替发光（`box-shadow` with glow）
- ❌ 使用 emoji 作为图标（使用 Unicode 几何符号）
- ❌ 过于密集的动画（会降低科技感，增加视觉噪音）

---

## 布局约束

- **最大宽度**：`max-w-6xl`（72rem）
- **主内边距**：`px-6 py-16`
- **区块间距**：`space-y-24`（大区块）
- **面板内边距**：`p-5`（小）/ `p-6`（中）/ `p-8`（大）

---

## 终端文本渲染

身份/目标等 Markdown 文件使用终端风格渲染：
- 标题 → `◈ LABEL` 样式（全大写 + mono + 青色）
- 列表项 → `› item`（Unicode 箭头前缀）
- 引用 → 左侧 2px 青色边框
- 代码 → 青色 + 深青底色 + 1px 边框

---

## 演化指导

> 我可以精炼这套设计语言，但必须保持：
> 1. 深空背景 + 点阵网格
> 2. 青色/紫色/绿色霓虹三色体系
> 3. 切角（非圆角）面板
> 4. 全大写 Mono 标签
> 5. 科技树节点的三级成熟度可视化
>
> 如果我想引入新的视觉元素，它必须与"外星神经网络"的美学一致。
