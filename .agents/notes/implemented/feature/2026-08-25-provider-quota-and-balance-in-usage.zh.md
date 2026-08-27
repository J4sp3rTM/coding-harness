# Agent Note: Provider quota and balance reporting in /usage

Status: implemented

[English](2026-08-25-provider-quota-and-balance-in-usage.md) | 中文

## 问题

`/usage` 只能报告会话日志已经计价的内容：最近一次调用的 token 计数与当前上下文压力。一个即将耗尽限流窗口或预付费余额的用户，在会话内没有任何途径看到这两个数字，而 harness 甚至根本没有捕获它们——提供方的响应在线路上披露了配额，但每个适配器都把这些标头丢在了地上。

## 决策

[`dsh-provider-status`](../../../../packages/llm/provider-status/README.md) 是按提供商路由保存最近一次状态观察的宿主进程内临时存储（`ctx.providerStatus`）。[`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) 把 pi-ai 的 `onResponse` 回调穿透到自己的流式调用中，从白名单标头发布两条互相独立的度量轴：API key 路由由 OpenAI `x-ratelimit-*` 与 Anthropic `anthropic-ratelimit-<axis>-*` 字段得到经过校验的 limit/remaining 计数维度；订阅路由则由 Anthropic 的 `anthropic-ratelimit-unified-*` 利用率分数与 Codex 的 `x-codex-*` 已用百分比字段得到套餐窗口，每个窗口携带提供方自己的窗口标签与重置时间。取值全部不可解析时记录显式的不可用状态；未识别的标头哪儿也不去。[`dsh-llm-deepseek`](../../../../packages/llm/llm-deepseek/README.md) 发布可选的 `deepseekAccount` 能力，每次询问执行一次实时的 `GET {base}/user/balance`，并拒绝重定向（`redirect: 'error'` 加显式的 3xx 检查）。[`dsh-command-usage`](../../../../packages/llm/command-usage/README.md) 把 `/usage` 渲染成一行提供方额度：套餐窗口与计数维度作为整百分比余量段落，外加提供方暴露时的账户余额。会话 token 计数与上下文压力被省略；采集与渲染契约由[按需 `/usage` 采集](2026-08-26-on-demand-usage-harvest.md)拥有。这些段落按会话最近一次已记录请求头的 provider 归属，而不是代理创建时的选项——在合成器里切换过模型的会话仍保留着旧选项，否则就会报出另一条路由的额度。

三条边界撑起了整个设计：

- **计数维度与套餐窗口是两种度量。** 计数维度报告限流窗口的绝对余量；套餐窗口报告订阅额度周期已消耗的比例。二者分开存储、分开呈现，绝不混用或相加。快照里的 `remaining` 是提供方为收到该响应的那份凭据保留的窗口余量——不是已消耗量、不是账单，并且在凭据轮换之后、没有新观察之前绝不跨凭据有效。记录携带非机密的 `credentialIdentity` 标签，让诊断能区分不同配置；任何密钥材料都不会进入存储。
- **宿主内的临时状态。** 服务只在内存里保存每个路由一条最新记录：所属 fiber 释放即丢弃，其他进程永远看不到，也不存在新鲜度截止——任何截止值都是被发明出来的可调参数。消费者根据 `observedAt` 和重置时间戳自行决定如何呈现时效。
- **通过 `ctx.get` 保持可选。** 两个消费者都没有把服务声明为注入。未挂载它们的组合报告 `no quota observed`。随附的基础 bundle 挂载 `dsh-provider-status`，以便 `/usage` 能报告最近观察到的配额；省略该行的自定义组合仍保持不变。

## Alternatives considered

**持久化快照或并入会话日志。** 否决：配额数字是参考性、按凭据的观察，把它们写进持久存储不会带来任何可重构收益，还会把与模型可见相邻的数据塞进 durable 层，而时效策略也会泄漏到读取这些行的地方。

**把余额做成 dsh-llm 暴露的通用 LlmAdapter 方法。** 此阶段否决：这会为一个提供方文档化的端点扩张共享 seam，而该 seam 的注册表刻意只暴露元数据而非适配器实例。出现第二个支持余额的提供方时，才是把该能力提升进 seam 的触发条件。

**在命令处理器里实时拉取配额。** 作为 HTTP 传输的默认策略否决：配额免费地随会话已经在发的响应而来。普通传输无法发布标头、或订阅百分比在单独账单端点上的路由，由 `/usage` 采集一次——见[按需 `/usage` 采集](2026-08-26-on-demand-usage-harvest.md)。

## Consequences

随附的基础组合无需离开会话即可看到发布限流头路由的配额百分比与重置倒计时、Anthropic OAuth、Codex OAuth 与 SuperGrok 账单的订阅套餐余量，以及 DeepSeek 的剩余美元余额。省略该存储或 DeepSeek 适配器的组合看不到任何变化。Codex 套餐窗口不在 WebSocket 推理传输上；`/usage` 从 Codex OAuth usage 端点读取它们，不启动推理。代价是 llm 组多出的一个小包、命令处理器里的可选读取加一次可选采集，以及一条长期义务：保持归一化器白名单封闭——新提供方的标头在被文档化并加入白名单之前保持不可见。
