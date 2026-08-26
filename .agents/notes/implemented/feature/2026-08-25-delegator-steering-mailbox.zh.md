# Agent Note: 委派工作流的轮次中途 steering

Status: implemented

[English](2026-08-25-delegator-steering-mailbox.md) | 中文

## Problem

用户在 `delegate_work` 或 `workflow` 运行期间发送的消息，在该次运行结束前不会产生任何反应。输入既没有丢失也没有路由错误：`Agent.steer` 会把它插入 `next-step` inbox（收件箱）目标，插入也是持久的，但 loop（循环）只在 step（步骤）边界读取已领取的批次，而前台委派占满了两个边界之间的全部时间——`executeToolCalls` 会等待每次分发，两个委派工具也都在自身工具体内等待整次运行结束。唤醒一个已在运行的 driver 不会留下任何 latch。

取消是当时唯一能在运行中途生效的外部输入，因为它中止两个工具都桥接到 `run.cancel()` 的活动 signal。它能回答「停止」，却无法回答「改向」：被取消的运行会丢弃部分产出。用户的实际体验就是：对正在干活的 agent（智能体）做 steering（中途引导）毫无动静。

## Decision

operator（操作者）输入通过一条 host→worker 的 steering mailbox（信箱）抵达运行中的脚本，同时父级对同一条消息的领取完全不受影响。

`WorkflowRun.steer(text)` 属于该 seam。worker-thread 引擎发送新增的 `steer` 协议消息；worker 侧执行把它追加到每次运行独有的 mailbox，脚本通过 `steering()` 钩子取走——该钩子返回自上次调用以来收到的消息，且从不等待消息到达。`steer()` 返回运行是否接受该消息以交给 worker。已取消、已结算或 worker 已消失的运行会丢弃该消息，worker 侧已取消的执行同样丢弃。

转发是**不消费的**。`forwardSteering`（位于 `@deepseek-ai/dsh-tool-workflow/steering`，两个委派工具共用）在运行存续期间监听调用方 agent 的 `agent/inbox/inserted`，只转发 `source.kind === 'user'` 的插入；消息仍留在父级 inbox 中，并在父级平常的下一个 step 边界被领取。每次接受的转发还会追加不含消息文本的 `tool-workflow/steering` 持久回执元数据。该回执只说明运行接受了消息，不表示任何 Worker 已据此行动；无论脚本是否取走过副本，transcript（文本记录）都完全相同。参见[工作流 steering 回执 note](2026-08-26-workflow-run-steering-record.md)。

mailbox 由引擎的 `maxSteeringMessages`（默认 16）限界。达到上限时丢弃最旧的未取走消息，并通过 `log` 叙述该丢弃，因此从不取走消息的脚本不会让内存无界增长，这次丢失也依然可见。

`delegate_work` 会自主消费 steering：其固定脚本在每个剩余单元前取走消息，并把取走的指导前置到后续 Worker 提示词中，作为与计划冲突时优先于计划的指令。其结果携带 `steering.applied` 与 `steering.unapplied`，渲染文本会同时说明两者，因此父 agent 既不会重复 Worker 已经收到的指导，也不会悄悄丢弃对任何 Worker 都来得太晚的指导。通用 `workflow` 脚本则自行调用 `steering()` 选择加入。

## Alternatives considered

**消费式转发（把消息从父级 inbox 中移除）。** 这样脚本会完全拥有该消息，避免父级重复读到 Worker 已经应用的指导。被否决的原因是：这样一来转发副本就成了一条持久用户消息的唯一路径，为保持「模型可见 ⟺ 已记录」为真就必须新增会话事件，而一次投递失败也会真正丢失用户输入。在结果中说明哪些指导已生效，无需触碰日志即可解决重复问题。

**为运行中的脚本做 checkpoint 与 resume。** 在收到 steering 时挂起、带新指令恢复，可以让任意脚本在任何位置作出反应。但 vm 堆不可序列化，且封闭的 `WorkflowStopReason` 联合类型以及两个 Consumer（消费方）都必须新增一个 suspended 变体。

**把工作流子 agent 注册为可延续 agent，让 `send_message` 能触达它们。** 这会复用既有的延续机制而不必新增协议消息，但它破坏一次性子 agent 生命周期、子 RPC 依赖的 `callId` 键隔离，以及脚本的结果汇聚路径。

**只在工具结果中报告 steering，不做 worker 侧 mailbox。** 成本低且对日志安全，但要等到运行结束才有任何交付——正是本次要修复的失效模式。

**让 `steering()` 阻塞或轮询直到有消息到达。** 会等待的钩子在阶段之间读起来更自然，但脚本在空 mailbox 上轮询会让没有其他工作的运行停住，该钩子也会成为第二种把工作流卡死的方式。立即 resolve 让取走保持为一次纯读取。

## Testing

- `session.spec.ts` 通过 MessageChannel 驱动真实 worker session：按到达顺序取走、第二次取走为空、达到上限时丢弃最旧一条及其叙述，以及已取消的运行丢弃后续 steering、`steering()` 与其他钩子一样抛出 `CANCELLED`。
- `workflow-worker-thread.spec.ts` 覆盖跨真实 worker thread 的宿主行为：`steer()` 抵达运行中的脚本，以及对已结算或已取消的运行做 steering 只会被丢弃而不是报错。
- 两个委派 Consumer 都覆盖转发、来源过滤、空文本跳过、其他 agent 的插入，以及结算时监听器的释放。
- `tool-development-workflow/tests/integration.spec.ts` 组合真实引擎、真实 subagent 提供方与真实父级 inbox：在单元 1 启动时注入的消息不出现在第一个 Worker 的提示词中，出现在第二个 Worker 的提示词中，并被报告为 `applied`。

## Consequences

- 用户可以改向已委派的工作，而不必取消它并丢失部分产出；指导只会抵达尚未开始的单元。
- 已经在运行的单元无法被改向，`parallel: true` 下也只有整批开始前的那次取走生效。结果对此明确说明，而不是暗示指导已经落地。
- 父 agent 可能读到 Worker 已经应用过的指导；结果会把它标记为 applied，以免父 agent 重新下达。
- 每个 `WorkflowRun` 实现（包括测试替身）都必须提供 `steer`。
- `delegate_work` 结果现在要求带有 `steering` 记录；缺少它的脚本返回值会按格式错误拒绝，与 `objective`／`reports` 字段既有的严格程度一致。
- 一次性工作流子 agent 仍然无法通过 `send_message` 和 `interrupt_agent` 触达；对不存在的目标，`interrupt_agent` 仍返回 `{ accepted: true }`，这正是其服务约定所记载的统一 no-op。改变这一点属于 subagent seam 的另一项决策，而不是 steering 的决策。
