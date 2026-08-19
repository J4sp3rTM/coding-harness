# dsh-llm-oauth

[English](README.md) | 中文

订阅登录 Service Definition（`ctx.llmOAuth`）。供应商订阅——Claude Pro/Max、ChatGPT Plus/Pro，以及已安装供应商目录附带的其余几家——用会轮换的 OAuth 令牌组认证，而不是 API key。正因如此它无法走[凭据引用 seam](../../credentials/credentials/README.md)：配置没有稳定的值可以点名，令牌会在 harness 背后轮换，而拿到令牌本身就需要一次浏览器往返。

三条规则约束该 seam 的每个提供方：

**令牌不离开 Host。** 状态界面读到的是 `LlmOAuthAccount`，其中不含任何机密——路由键、显示名、是否已登录，以及已存访问令牌的到期时刻。只有 LLM（大语言模型）适配器接触 `tokens()`，且仅为把存储交给负责轮换它的供应商 SDK。

**登录是可交互、可取消的。** 流程通过调用方的 `LlmOAuthInteraction` 汇报步骤、提出问题，于是同一份实现可服务终端、斜杠命令与浏览器页面，而它们谁都不必自备登录界面。

**已存令牌组拥有它的路由。** 只要存有令牌组，适配器就用订阅认证该路由，绝不回落到环境里的 API key——静默回落会让用户本想记在自己订阅上的请求，去计费到一个毫不相干的账户。

## 接口

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { LlmOAuthInteraction } from '@deepseek-ai/dsh-llm-oauth'

declare const ctx: Context
declare const surface: LlmOAuthInteraction

ctx.llmOAuth.providers()                       // [{ provider, displayName, loginLabel }]
await ctx.llmOAuth.accounts()                  // the same, plus signedIn / expiresAt
await ctx.llmOAuth.status('anthropic')         // one route's account facts
await ctx.llmOAuth.login('anthropic', surface) // runs the flow, stores the token set
await ctx.llmOAuth.logout('anthropic')         // removes it from this machine
ctx.llmOAuth.tokens()                          // the store, for the LLM adapter alone
```

`surface` 实现 `notify(event)` 与 `prompt(question)`。事件描述正在发生什么——要打开的 `auth-url`、要输入的 `device-code`、一行 `progress`、一条 `info`——绝不携带流程需要回收的值。流程真正需要的输入一律经由问题到达：`text`、`secret`、`select`，以及 `manual-code`，即流程与自身回环回调赛跑时那条「把重定向地址粘回来」的后备。带 `signal` 的问题会在赛跑以另一侧收尾时被放弃，因此界面必须结算这样的问题，而不能让它一直悬着。

`llm-oauth/updated (provider)` 在已存令牌组发生已提交变更后触发——登录完成、退出登录，或一次轮换。消费方不需要该事件（适配器按请求读取存储）；它服务于状态界面刷新「已登录」徽标。它的声明住在 client-safe 的 `./types` 子路径出口，与其点名的账户与交互类型同处一处，于是 Host 编译面之外的消费方读到的正是 Host 发射的那一份签名。

`LlmOAuthError` 的 code：`UNKNOWN_PROVIDER` 表示实现未提供该路由，`LOGIN_ABORTED` 表示用户取消，`LOGIN_FAILED` 表示流程自身失败。

## 令牌存储

`LlmOAuthTokenStore` 之所以存在，是因为轮换并非 harness 自己的操作：供应商 SDK 用过期的访问令牌换回新的，并把结果写回。`modify` 是唯一的写入路径，且在后端存储可见的所有写入者之间按路由串行化，因为正确的写入都依赖当前值——轮换不得让退出登录刚刚移除的令牌组复活，而两个观察到同一个过期令牌的请求必须只产生一次刷新。刷新令牌是一次性的，因此这里丢失一次更新就等于永久退出登录。

## 提供方

[`dsh-llm-oauth-local`](../llm-oauth-local/README.md) 把令牌组保存在仅属主可读的 `$DSH_HOME/.oauth.json`，并运行已安装 pi-ai 目录附带的登录流程。该 seam 的形态为基于系统钥匙串或凭据代理的提供方留有余地；其中没有任何一处假定本地文件或回环回调。

## 消费方

[`dsh-llm-pi-ai`](../llm-pi-ai/README.md) 在该存储之上构建供应商集合，于是已登录路由用订阅认证。[`dsh-command-login`](../command-login/README.md) 是面向人的另一半：在已组合的任意界面上提供 `/login` 与 `/logout`。

## Model Experience

间接地，经由消费该 seam 的 LLM（大语言模型）适配器：解析出的令牌为其请求授权，而适配器拥有全部模型可见面。

#### KV Cache effect

无直接失效；令牌绝不进入请求前缀。把一条路由在 key 路径与订阅路径之间切换，确实会在要求自带身份前置语的供应商上改变请求的 system prompt，从而使该路由的前缀失效一次。

## Known Limitations and Deferred Work

- **同一供应商下无法枚举多个账户** —— 每条路由只有一个令牌组，因此在同一供应商上持有两份订阅的用户无法同时保留两者。
- **退出登录只在本地生效** —— 这里无法吊销授权本身；那件事在供应商自己的账户页面上。
- **没有到期通知** —— 状态界面在自身导航时，或在 `llm-oauth/updated` 上重新读取 `accounts()`。
