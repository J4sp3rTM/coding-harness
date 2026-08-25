# Agent Note: Goal Round 暂时性请求恢复

[English](2026-08-25-goal-transient-request-recovery.md) | 中文

状态：已实现

## 问题

只要模型请求到达 `agent/error`，Goal Round 驱动器就会停用活跃 Goal。接入的 pi-ai 路由可能报告可恢复的 `PI_AI_ERROR` 失败，却不带提供方重试策略，因此活跃 Goal 会在一次请求失败后停止，并需要人工唤醒。

## 决策

`dsh-llm-retry` 暴露进程本地贡献注册表，同时继续作为唯一的 `agent/request-error` listener 和执行器。Goal Round 驱动器只为确切的已准入 Goal revision 注册一项贡献。有限提供方策略先消耗其预算，然后运行下游恢复，最后由 Goal 回退处理已配置的暂时性失败；它保留已准入 Goal 消息，并在不消耗另一 Goal Round 的情况下重复同一模型步骤。提供方 `always` 策略仍是唯一重试所有者。

重试服务会为提供方策略和贡献策略记录 `llm/retry` 与 `llm/retry-started` 会话事实。贡献者 id 是持久策略 key 的一部分，因此提供方重新路由和贡献变更会开始独立的重试链。Goal 回退使用共享重试策略解析器处理指数退避、提供方 retry-after 上限和 jitter，并默认采用暂时性提供方类别。身份验证、配额、无效请求与上下文溢出失败保持终止性，除非显式加入配置。

请求 signal、重试服务生命周期与 Goal 贡献信号都会取消等待。竞争的 inbox 消息、Goal phase 或 revision 变更、会话重启、取消和 teardown 会阻止下一次尝试，包括提供方自有的退避期间。teardown 会移除贡献、取消活跃 Goal 工作，并让重试服务在释放 agent 前排空其自有等待。

## 后果

暂时性模型失败不会消耗 Goal Round，也不需要人工唤醒。提供方重试层和 Goal 回退可以同时出现在一次请求中，但不同的策略 key 与重试身份会分离各自的持久历史。只要确切 Round 仍获准入，Goal 回退就没有次数上限，因此取消是独立的成本与墙钟时间控制。持久化失败和终止性模型失败仍会停用续行。

## 测试

真实 AgentLoop 回归测试覆盖无需人工唤醒的 `PI_AI_ERROR` 恢复、提供方优先的 429 恢复、提供方 `always` 所有权、提供方或回退退避期间的 Goal 与 steering 取消、对提供方重新路由安全的策略链、dispose，以及终止性 AUTH／请求／最大 token 结果。真实 Loader 组合和 keyless 组装 Headless 快照覆盖交付插件图与持久重试 transcript。包 invariant 会把贡献策略 key 绑定到已准入的当前 Goal Round。

## 考虑过的替代方案

我们否决了在 `agent/error` 后直接推进到新的 Goal Round，因为它会消耗 Goal 预算，并可能持续冲击受限速的提供方。我们否决了在 Goal 包内增加第二个 `agent/request-error` 执行器，因为它会重复拥有退避、事件、重试链与 teardown，并与提供方 `always` mode 冲突。我们否决了更改 `agent-loop`，因为其现有恢复扩展点已经足够。
