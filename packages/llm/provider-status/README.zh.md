# @deepseek-ai/dsh-provider-status

[English](README.md) | 中文

宿主进程内的临时存储，保存每个路由最近一次观察到的提供商状态（`ctx.providerStatus`）。适配器一侧的观察者发布从提供商响应的限流头解析出的配额快照，或显式的不可用状态；[`/usage`](../command-usage/README.md) 等只读消费者按提供商路由查询最新记录。

## 服务契约

`ctx.providerStatus` 由 `@deepseek-ai/dsh-provider-status` 插件提供，每个路由只保留一条最新记录；每次发布都会替换上一条记录，所属 fiber 释放时全部状态随之丢弃。记录是冻结的分离副本：

```yaml
- id: provider-status
  name: '@deepseek-ai/dsh-provider-status'
```

该插件不接受任何配置。将其视为可选服务的消费者通过 `ctx.get('providerStatus')` 读取，因此未挂载它的组合保持原样工作。

- `recordSnapshot({ routeId, credentialIdentity?, dimensions?, windows? })` 提交一份快照，其中至少有一个配额测量值。维度（`requests`、`tokens`、`inputTokens`、`outputTokens`）报告限流计数器，携带正有限数的 `limit`、有限非负数的 `remaining`，以及可选的纪元毫秒 `reset`。计划窗口报告订阅额度消耗，携带非空标签、0 到 100 的 `usedPercent`，以及可选的纪元毫秒 `reset`。这是两种不同的测量，不能混合或相加。每个值都在这个发布点校验；被拒绝的发布不会影响已在服务的旧记录。
- `recordUnavailable({ routeId, credentialIdentity?, reason })` 提交显式的不可用状态，用于响应带有可识别状态字段但取值全部不可用的情况。响应不含任何可识别字段时干脆不发布。
- `lookup(routeId)` 返回 `{ kind: 'snapshot', ... }` 或 `{ kind: 'unavailable', ... }`，并附带提交时间 `observedAt`。快照记录始终包含 `dimensions` 和 `windows` 数组，其中任一数组或两者都可以为空。
- `registerRefresh(fn)` 安装唯一的按需采集函数；后一次注册会替换前一次，释放器只忘记它自己装上的那个函数。`refresh(routeId, signal)` 调用该采集，未注册时为空操作。`recordSnapshot` 省略 `dimensions` 或 `windows` 时保留上一条快照该轴的值，以便一次响应头观察与一次账单采集共享同一条记录。

`credentialIdentity` 是非机密标签（例如凭据引用名称）；密钥材料绝不进入记录。维度的缺失与零值不同：提供方未上报的地方不会伪造 `0`。计划窗口的 `usedPercent` 表示订阅消耗，而不是限流剩余容量。

## Model Experience

### Provider status report

#### What the model sees

无。该存储只服务于面向人类的投影；没有提示词段落、工具模式或请求字段读取它。

#### Token effect

向 `ctx.providerStatus` 发布或读取不会执行任何提供商调用。`refresh` 在适配器注册了采集函数时可能发起探测：该探测由适配器拥有，不属于本存储。

#### KV Cache effect

模型可见面不变，因此没有影响。

## Known Limitations and Deferred Work

- **是最近一次观察，不是账本** —— 存储只在宿主内存中为每个路由保留一条参考性记录：没有历史、没有跨进程可见性，也不是账户级用量或账单数字。限流 `remaining` 是提供方自身窗口的余量，不是已消耗量。
- **没有新鲜度策略** —— 记录携带 `observedAt`，但存储不施加时效截止；渲染陈旧记录的消费者必须自行决定如何呈现其时间。
- **被动响应头加可选采集** —— 适配器发布响应已经携带的内容，`/usage` 可以再请求一次 `refresh` 采集。既没有限流头也没有注册采集的提供商会保持未被观察。
