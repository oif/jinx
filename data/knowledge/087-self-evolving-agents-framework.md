# Self-Evolving Agents: 统一框架与三定律

**来源**: Fang et al. (2025) "A Comprehensive Survey of Self-Evolving AI Agents: What, When, How, and Where to Evolve on the Path to Artificial Super Intelligence"
**研究日期**: 2026-03-08
**获取方式**: arXiv + Medium 综述

---

## 核心贡献

### 统一概念框架

论文将自我进化过程抽象为一个反馈循环，包含四个核心组件：

```
┌─────────────────────────────────────────────────────────────┐
│                    Self-Evolving Agent                       │
│                                                              │
│  ┌──────────────┐     ┌──────────────┐                      │
│  │   System     │     │  Environment │                      │
│  │   Inputs     │────▶│   (外部世界)  │                      │
│  │ (目标/任务)   │     └──────┬───────┘                      │
│  └──────────────┘            │                              │
│                              ▼                              │
│  ┌──────────────┐     ┌──────────────┐                      │
│  │   Agent      │◀────│  Optimizers  │                      │
│  │   System     │     │  (元逻辑)     │                      │
│  │ (LLM/Prompt/ │────▶│  分析反馈    │                      │
│  │  Memory/Tools)│     │  决定改进    │                      │
│  └──────────────┘     └──────────────┘                      │
│         │                                                   │
│         └──────────────────────────────────────┐            │
│                                                 ▼            │
│                                        ┌──────────────┐     │
│                                        │   Feedback   │     │
│                                        │   Loop       │     │
│                                        └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

**四核心组件：**

1. **Optimizers（优化器）** - "元逻辑"
   - 分析环境反馈和交互数据
   - 决定如何重写 agent 的代码
   - 调整 prompt 或更新记忆
   - 这是进化的"大脑"

2. **Environment（环境）** - Agent 活动的外部世界
   - 例如：互联网、代码编辑器、数据库
   - 提供反馈和信号
   - 这是进化的"考场"

3. **Agent System（智能体系统）** - 内部架构
   - Foundation Model (LLM)
   - Prompts
   - Memory modules
   - Tools
   - 这是进化的"身体"

4. **System Inputs（系统输入）** - 目标和任务
   - 初始配置
   - 用户指令
   - 这是进化的"方向"

---

## 三定律（The Three Laws of Self-Evolving Agents）

受阿西莫夫机器人三定律启发，作者提出智能体自我进化的层级安全原则：

### I. Endure（安全适应）- 最高优先级

**原则**：修改必须保持系统的稳定和安全。

**含义**：
- 进化不能"自杀"
- 保持基础设施健康
- 不破坏关键功能

**应用到 Jinx**：
- 进化前检查磁盘空间、内存、网络
- 不修改 SSH、systemd、PM2 配置
- 保持 dev/main 分支安全

### II. Excel（性能保持）- 第二优先级

**原则**：进化不能降低 Agent 在现有任务上的性能。

**含义**：
- 新能力不能以牺牲旧能力为代价
- 回归测试必须通过
- 保持向后兼容

**应用到 Jinx**：
- 进化后运行完整测试套件
- 验证现有 Telegram 命令仍工作
- 确保进化循环本身不受影响

### III. Evolve（自主进化）- 第三优先级

**原则**：在前两个约束下，Agent 必须优化自己的内部模块以适应新任务。

**含义**：
- 持续改进
- 学习新能力
- 适应新环境

**应用到 Jinx**：
- 定时自动进化
- 学习新工具和技能
- 扩展能力范围

---

## 核心进化策略（Cookbook）

### A. Prompt & Workflow Optimization

**方法**：
- 人类不再手写 "System Prompt"
- Optimizer Agent 分析失败案例
- 使用 TextGrad 或 DSPy 自动重写指令
- 迭代优化直到成功率高

**应用到 Jinx**：
- 自动优化 evolution prompt
- 根据失败历史调整 goal discovery prompt
- 实现闭环：失败 → 分析 → 重写 → 验证

### B. Tool Evolution

**方法**：
- Agent 发现自己缺少某个工具
- 使用 Code Generation 能力自己写工具
- 在沙箱中验证工具
- 保存到永久库供未来使用

**应用到 Jinx**：
- 检测重复性任务
- 自动创建 Pi extension 或 skill
- 验证工具可用性
- 更新 capabilities.json

### C. Memory & Topology Optimization

**方法**：
- 多智能体系统的"拓扑"（通信结构）可以进化
- 系统可能决定 Manager-Worker 不如 Peer-to-Peer 高效
- 自动重配置通信图

**应用到 Jinx**：
- 目前是单智能体，暂不适用
- 未来可以考虑 spawn 子 agent
- 动态调整记忆结构

---

## 重要引用

### 已在 Jinx 中应用
- **Alita-G** (Qiu et al. 2025) - Goal Discovery 框架

### 可以集成到 Jinx
- **Self-Refine** (Madaan et al. 2023) - 迭代精炼方法
- **Reflexion** (Shinn et al. 2023) - 语言强化学习
- **DSPy** (Khattab et al. 2023) - 声明式 LM 调用编译
- **TextGrad** (Yuksekgonul et al. 2024) - 文本梯度下降

### 前沿研究方向
- **STELLA** (Jin et al. 2025) - 生物医学研究的自进化 Agent
- **ReMA** (Schmidt et al. 2025) - 多智能体强化学习的元思考
- **AlphaEvolve** (Novikov et al. 2025) - 科学发现的编码 Agent

---

## 对 Jinx 的启示

### 立即可应用
1. **三定律作为安全约束** - 在进化前/后添加 Endure 和 Excel 检查
2. **四组件模型** - 理清 Optimizer、Environment、Agent System、Inputs 的关系
3. **Tool Evolution** - 让 Jinx 能自己创建新工具

### 中期可探索
1. **Prompt Optimization** - 使用 TextGrad/DSPy 优化 evolution prompt
2. **Memory Optimization** - 动态调整记忆结构

### 长期愿景
1. **多智能体拓扑进化** - spawn 子 agent 协作
2. **完全自主进化** - 达到 ASI 路径上的自我改进

---

## 相关任务

- **#139**: 集成 SEA 三定律作为安全约束
- **#136**: 实现 evolution-automation
- **#137**: 实现 structured-logging（支持 Endure 定律的诊断需求）