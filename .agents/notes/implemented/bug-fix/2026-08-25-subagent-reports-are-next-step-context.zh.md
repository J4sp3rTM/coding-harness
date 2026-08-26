# Agent Note: Child-to-parent mail is next-step context, not a queued prompt

Status: implemented

[English](2026-08-25-subagent-reports-are-next-step-context.md) | 中文

## 问题

可继续子级的 `report` 与运行时结算通知都是面向模型的上下文。认领之后，它们本来就会渲染为上下文注入行。默认唤醒路径却仍使用 `Agent.followup()`，把同一条消息放进 `next-turn`。Web 队列坞把每条 next-turn 项都当成用户提示词，于是报告或结算在父级认领之前会显示为可编辑、可删除、可 steer 的排队消息。

单靠 `inject()` 救不了停驻的父级。空闲时的 `inject()` 只暂存 next-step 上下文，不会开启轮次，因此已经启动后台子级并进入 idle 的协调者永远读不到这些邮件。

## 决策

子到父的 report 与结算通知使用 next-step 投递，绝不调用 `followup()`。

空闲父级上的唤醒投递调用 `parent.steer()`。消息是 next-step 上下文。Host 队列快照因此给它 `placement: 'context'`，QueueDock 会隐藏它，ChatView 也不会画出 steering 气泡。认领之后，它仍渲染为上下文注入行。`steer()` 会开启一个轮次，这正是停驻协调者需要的唤醒。

正在运行的父级，包括轮次已被 abort 的父级，改为 `parent.inject()`。`Agent.send()` 会在 abort 尚未排空时把每条唤醒发送改投到 `next-turn`，而这正是本改动要禁止的队列 FIFO。在线驱动会自己认领 next-step；用户刚 Stop 的父级会把通知留到下一条提示词，而不是立刻重启。

静默 report 与拆卸中的结算仍调用 `parent.inject()`。父到子的 `followup()` 不变：那个方向仍是子级的后续轮次。

[report 工具](../feature/2026-07-30-continuable-subagent-report-tool.md)、[report 义务](../feature/2026-08-06-continuable-child-report-obligation.md) 与 [结算投递](../feature/2026-08-06-manager-owned-subagent-settlement-delivery.md) 仍保留那些决策的其余部分，并改写为这条发送路径。

## 考虑过的替代方案

**保留 `followup()`，只在队列投影里隐藏非用户 next-turn 项。** 坞里不再显示报告，但它们仍占用用户的后续轮次 FIFO，并仍可通过队列 RPC 编辑。缺陷在发送目标，不只在投影。

**把唤醒投递改成 `inject()`。** 这在 inbox 里符合「只有上下文」，但会让停驻的父级保持沉默。`steer()` 是既有的、同时是 next-step 又会唤醒的发送。

**改 `inject()`，让空闲上下文唤醒驱动。** 其他所有 inject 调用方——hooks、工作区指令、时间上下文——都会开启未经请求的轮次。空闲 inject 的约定是上下文等待。

## 后果

- 报告或结算绝不会出现在 Web 队列坞中。子级上报或结算时，父级仍会继续工作。
- 父级已经在运行时，多个子级同时上报或结算会共享一次 next-step 认领。
- 包测试固定唤醒报告进入 `next-step`，并仍要求一次父级模型请求。结算的空闲父级轮次与繁忙父级批次测试保持原有观察；被拒发送测试改为监视 `steer`。父级轮次正在 abort 时发送的唤醒报告与结算通知留在 `next-step`，`next-turn` 为空。
