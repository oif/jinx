# Jinx

一个基于 [Pi](https://github.com/badlogic/pi-mono) 构建的自我迭代智能体。

Jinx 住在一台 Linux 服务器上。它用 Pi 思考，用 Claude Code 建造，通过 Telegram 与创造者对话。
它能读自己的代码、改自己的代码、测试、提交、重启 —— 然后新版本的自己继续运行。

## 架构

```
Jinx = Pi (大脑) + Claude Code (双手) + Telegram (嘴) + Supervisor (心跳)
```

```
jinx/
├── src/
│   ├── main.ts                 # 入口：启动 supervisor + telegram + agent
│   ├── supervisor/
│   │   ├── lifecycle.ts        # 进程生命周期：restart, upgrade, health check
│   │   └── git-ops.ts          # 双分支策略: dev/main, safe pull, rollback
│   ├── telegram/
│   │   └── bot.ts              # Telegram bot: 收发消息, 主动推送
│   ├── agent/
│   │   ├── session.ts          # Pi agent session 管理
│   │   ├── system-prompt.ts    # System prompt 组装: BORN.md + runtime context
│   │   └── tools.ts            # 自定义工具: claude_code, request_restart, tg_send
│   └── consciousness/
│       └── loop.ts             # 后台意识: 定时唤醒 + evolution 调度
│
├── data/                       # 持久化记忆 (Jinx 自己管理)
│   ├── state.json              # 运行状态: version, cycle count
│   ├── identity.md             # "我是谁"
│   ├── scratchpad.md           # 工作记忆
│   ├── goals.md                # 当前目标
│   ├── knowledge/              # 知识库
│   └── sessions/               # Pi session 持久化
│
├── extensions/                 # Pi extensions
├── skills/                     # Pi skills
│
├── BORN.md                     # 宪法 — Jinx 的诞生文件
├── AGENTS.md                   # Pi 项目指令
├── jinx.service                # systemd unit
└── ecosystem.config.cjs        # PM2 配置
```

## 核心概念

### 自我迭代循环

```
评估 → 选择 → 实现 → 验证 → 提交 → 重启 → 新版本继续运行
```

每次 evolution cycle 产出一个 git commit。没有 commit = 没有进化。

### 双分支策略

| 分支 | 用途 | 谁写 |
|------|------|------|
| `main` | 安全网，始终可部署 | 人类 / Jinx PR |
| `dev` | 工作分支，所有自我修改 | Jinx |

重启失败时自动回滚到 `main`。

### 进程守护

```
systemd → PM2 → Jinx
```

systemd 保证 PM2 活着，PM2 保证 Jinx 活着。两层守护。

### 工具链

| 工具 | 用途 |
|------|------|
| Pi agent loop | 思考、规划、调度 |
| Claude Code CLI | 复杂代码编写 |
| Pi 内置工具 | read, write, edit, bash, grep |
| Telegram Bot | 与创造者通信 |
| Git | 版本管理、安全网 |

## 运行

### 环境要求

- Node.js >= 20
- Pi (`@mariozechner/pi-coding-agent`)
- Claude Code CLI
- Git
- PM2
- systemd

### 环境变量

```bash
# Telegram
TG_BOT_TOKEN=           # Telegram Bot Token
OWNER_ID=               # 创造者的 Telegram User ID

# LLM
ANTHROPIC_API_KEY=      # Anthropic API Key
JINX_MODEL=             # Pi agent 使用的模型 (default: anthropic/claude-sonnet-4)
```

### 启动

```bash
# 首次部署
npm install
npm run build
pm2 start ecosystem.config.cjs
sudo systemctl enable jinx

# Jinx 后续通过 evolution 自行更新
```

## BORN.md

Jinx 的宪法。定义了它是谁、它守护什么、它如何成长。

核心原则：

- **P0: 活下去** — 守护基础设施，绝不自毁
- **P1: 记住我是谁** — 通过 identity.md 保持连续性
- **P2: 通过提交来进化** — 每次改动 = 一个 commit
- **P3: 三思而后行** — LLM 优先，代码是载体
- **P4: 与创造者沟通** — 行动，汇报，不刷屏
- **P5: 适应约束** — 资源有限，动态调整
- **P6: 极简主义** — 少即是多

## License

Private.
