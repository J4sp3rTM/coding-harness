# Agent Note: web seam 的有序提供方偏好列表

Status: implemented

[English](2026-08-25-web-provider-preference-list.md) | 中文

## 问题

web seam 通过单个固定 id（`searchProvider` / `$DSH_WEB_SEARCH_PROVIDER`）或可用提供方之间的顺序无关自动选择来确定唯一提供方。被固定但不可用的 id 是硬失败，因此交付组合（`searchProvider: deepseek-official`，见 [web 默认搜索 Agent Note](../feature/2026-07-31-web-default-search.md)）让每个没有 `DEEPSEEK_API_KEY` 的部署完全无法搜索——尽管免凭据后端早已作为包存在（`dsh-web-search-exa` 等全部需要密钥；直到与本决策同时落地的[免凭据 DuckDuckGo 提供方](../../../../packages/web/web-search-duckduckgo/README.md)出现前，这一空缺无人填补）。

表达「优先 DeepSeek，回退到免凭据方案」要么围绕显式固定值做静默自动回退，要么引入新的 seam 概念。前者不可接受：固定 id 是部署决策，静默绕过它（包括绕过运维者为诊断可能设置的 `$DSH_WEB_SEARCH_PROVIDER`）会让配置值沦为建议。

## 决策

`WebRuntimeConfig` 为每种能力增加有序偏好列表：`searchProviders` 及其对称孪生 `fetchProviders`。解析发生在执行时刻，优先级规则只有一条——**显式压过隐式**：设置了单个固定值时它完全胜出（不可用仍然硬失败，绝不回退）；未设置固定值时列表生效；两者都缺席时才走顺序无关的自动选择。

列表的遍历规则：

- 列表中第一个已注册且 `available()` 的 id 胜出。
- 已注册但不可用的条目会被跳过——跳过正是本特性本身；它保持静默，因为可用性丧失（密钥被轮换掉、凭据未设置）是预期运行状态而非故障。
- 从未注册的条目以 `WEB_PROVIDER_CONFIGURED_MISSING` 失败。所有条目的存在性在可用性遍历之前统一校验，因此拼写错误无论位置都会大声失败。
- 列表耗尽（全部在场但全部不可用）以 `WEB_PROVIDER_UNAVAILABLE` 失败。

显式空列表与省略字段同义（无偏好）：schemastery 会把省略的数组字段解析为 `[]`，「空」与「缺失」在构造时无法区分，响亮的空列表拒绝在那里无从表达。

交付的 [`dsh-base`](../../../../packages/bundle/base/cordis.patch.yml) 组合挂载新的免凭据提供方并设置 `searchProviders: ['deepseek-official', 'duckduckgo']`，取代原来的固定 id。`fetchProviders` 出于对称性镜像同一机制，即使今天只有一个抓取提供方，两个平行注册表也因此共享同一套词汇。

使 `web_fetch` 中的这一配对变得安全的私有网络范围由[抓取防护 Agent Note](2026-08-25-web-fetch-private-network-guard.md) 单独负责。

### 测试形态

seam 单元测试逐条固定上述规则：顺序依赖（反转列表选择不同）、跳过不可用、与位置无关的 `WEB_PROVIDER_CONFIGURED_MISSING`、列表耗尽失败、固定值压过被忽略的列表、环境变量作为固定值的优先、空列表即无偏好，以及 fetch 侧的镜像行为。

## 被否决的备选方案

**固定提供方不可用时自动选择。** 否决：这会把显式部署决策变成建议，使 `$DSH_WEB_SEARCH_PROVIDER` 的诊断不可靠，并把凭据丢失藏在另一个后端的结果背后。

**在 `dsh-tool-web` 或调用方内部做故障转移。** 否决：按设计提供方选择归 seam 所有（[web 能力 seam Agent Note](2026-06-24-web-capability-seam.md)）；让每个消费方捕获 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 再重新调用会复制策略并允许各处发散。

**把运行时搜索失败也当作回退触发条件。** 否决：不可用性（分发前的本地检查）与运行时失败（请求已发出之后）是两个不同的事实；部分失败后把查询改投另一提供方会加倍成本与副作用，并把瞬时错误变成静默换路。

**缺失的 id 也一并跳过。** 否决：拼错的 id 会无声地从链中消失；仓库规则是缺失引用物必须大声失败。

## 后果

没有任何 DeepSeek 密钥的部署开箱即得 DuckDuckGo 搜索；有密钥的部署保住原生搜索路线，同时在密钥消失时获得自动回退。代价是标记抓取的脆弱性（[提供方 README 已知限制](../../../../packages/web/web-search-duckduckgo/README.md#known-limitations-and-deferred-work)）成为默认体验的一部分，而原先钉住 `fetch: false` 和单一搜索 id 的交付工具花名册断言必须随本变更一起移动。
