# Agent Note: 提供方订阅登录

Status: implemented

[English](2026-08-19-provider-subscription-sign-in.md) | 中文

## Problem

harness 原本只能持有 API key。凭据 seam 正是为此设计：配置命名引用，提供方拥有值，消费方在每次操作时重新解析。提供方订阅（Claude Pro/Max、ChatGPT Plus/Pro）不符合这套模型。配置没有可命名的稳定值；凭据是一组由提供方 SDK 按自身节奏在 harness 外部轮换的令牌；获取令牌还需要浏览器往返，配置文件无法表达。

因此，已经购买套餐的用户无法在这里使用它。适配器也明确体现了这一点：`llm-pi-ai` 曾从可配置提供方目录中完全隐藏 `openai-codex`，因为该路由只提供 OAuth，而 harness 无法产生 OAuth 凭据。

## Decision

订阅登录是与凭据 seam 并列的独立 capability seam，而不是对后者的扩展。

`ctx.llmOAuth`（[`dsh-llm-oauth`](../../../../packages/llm/llm-oauth/README.md)）拥有相关类型：可登录的路由、可安全展示的非秘密账户事实、流程用于报告与提问的 interaction，以及单独的令牌存储。这个拆分很重要：`status()` 与 `accounts()` 不携带秘密，可以交给任何界面；`tokens()` 只有 LLM 适配器这一位调用方，因为令牌轮换不是 harness 自己执行的操作。

[`dsh-llm-oauth-local`](../../../../packages/llm/llm-oauth-local/README.md) 通过跨进程写锁，将令牌保存在仅所有者可访问的 `$DSH_HOME/.oauth.json` 中，并运行已安装 pi-ai catalog 自带的登录流程，而不重新实现任何流程。

[`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) 在读取该 seam 的凭据存储上构建 `Models` 集合。每次请求会解析三种姿态之一：profile 固定 `auth: subscription`、profile 固定 `auth: api-key`，或默认情况下由已存登录接管路由并以下层 key 路径作为后备。

[`dsh-command-login`](../../../../packages/llm/command-login/README.md) 是面向用户的一半，通过 `ctx.userQuestions` 提供 `/login` 与 `/logout`。

提供方提示直接映射为问题。报告的授权 URL 会被带入紧随其后的提示。报告的设备代码之后没有提示，因为提供方会独立轮询，所以命令立即打开确认问题，并让它与提供方流程竞速：流程完成时关闭问题，用户取消时中止轮询流程。若命令 Host 有桌面路径，[本机浏览器移交](../feature/2026-08-19-automatic-provider-login-browser.md)会打开同一 HTTPS 目标；对于远程与无头 Host，显示的问题仍是权威路径。

命令描述符把 `/login` 输入标记为可选。因此 Web 中的裸调用会执行并打开路由选择器，而明确提供方时仍使用普通参数路径。

### 为什么不自行实现流程

已安装 pi-ai catalog 中每个支持 OAuth 的提供方都携带完整流程：授权端点、PKCE 交换、回环回调服务器、粘贴重定向的后备路径和刷新授权。同一个 catalog 还拥有把已存令牌转成提供方所需身份请求头的请求路径。这两部分必须一致：Anthropic 的 OAuth 路径发送特定的 `anthropic-beta` 选项、CLI user agent 和身份前言；即使令牌来自我们自己的流程，仍必须沿该路径发送。另写一套流程会产生两份协议描述，而只有一份真正承载行为。

因此，可提供的路由由 catalog 决定，而不是由这里维护列表。pi-ai 升级若加入新的订阅提供方，无需修改即可提供；当前提供七条路由，而不只是最初促成此工作的两条。

### 存储序列化不是泛化的谨慎措施

`modify` 是唯一写路径，并在后端存储可见的所有写方之间按路由串行化。刷新令牌只能使用一次：若用片刻前的值覆盖已经轮换的值，就再也没有可交换的令牌，用户会永久退出登录。两个 harness 进程、两个浏览器标签页和两个并发请求都可能进入同一次读改写，因此每条路由的进程内 promise 链位于 `withFileLock` 周期之前。

### 应用归因遵循各提供方的 OAuth 身份要求

Anthropic 订阅请求是[强制归因规则](2026-06-21-mandatory-app-attribution-headers.md)唯一有意的例外。harness 最后把自己的 `user-agent` 合并进 pi-ai 请求头，而 Anthropic OAuth 路径恰好也在这里放置端点要求的 CLI 身份。发送归因会替换该身份，端点会拒绝请求，因此该请求头被省略。

其他订阅提供方保留 harness 归因。OpenAI Codex 随后会用自己的 `User-Agent` 与 `originator` 替换它，所以请求保留提供方 SDK 的身份。xAI 不提供冲突身份，因此省略归因只会丢失事实。

## Alternatives considered

**通过凭据 seam 存储令牌组。** `CredentialRef` 可以命名 JSON blob，但轮换会失败：该 seam 的提供方拥有存储，却不提供串行化读改写，所以两个并发刷新会竞态，并有一个丢失只能使用一次的令牌。它也不符合 `describe()` 的语义；后者回答“是否配置、来自哪一层、是否可写”，无法说明订阅是否已登录或访问令牌何时到期。两个 seam 回答不同问题，只是都涉及“凭据”。

**把登录流程和令牌存储放进 `llm-pi-ai`。** 包更少，而且 catalog 流程已经在那里。否决原因是该 seam 随后无法独立于一个适配器存在：第二个适配器系列、keyring 后端存储或代表浏览器客户端登录的 Host 都必须深入 pi-ai 包内部。存储还是令牌唯一写入点，应该由请求路径无法越过的所有者负责。

**让登录 seam 成为 `llm-pi-ai` 的必需注入。** 否决原因是仅 API key 的部署不组合登录服务；为了加入没人要求的功能而让适配器等待该服务，会使每条已配置路由都不可用。该 seam 在每次请求时通过 `ctx.get('llmOAuth')` 读取，因此在适配器之后挂载的登录服务也能覆盖已经注册的路由。

**使用已存登录前先要求 `auth: subscription`。** 这很明确，也符合仓库偏好显式行为的原则。作为默认值被否决，因为它会让 `/login` 本身不够用：用户登录后看不到任何变化，还必须编辑 `settings.yaml` 才能完成。该模式仍可明确命名；命名它会关闭后备路径，而隐式行为在这个方向才真正有代价，因为静默后备会把请求计费到另一个无关账户的 key 上。

**要求用户手动打开每个登录 URL。** [本机浏览器移交](../feature/2026-08-19-automatic-provider-login-browser.md)取代了这项展示选择，但不假定每个 Host 都有显示界面：只有检测到本机 GUI 路径时才移交；显示的 URL、回环回调与粘贴后备仍保留远程 Host 行为。

## Consequences

拥有 Claude Pro/Max 或 ChatGPT 套餐的用户可以通过 `/login` 使用它，无需编辑配置；`/logout` 会让该路由回到 key 路径。`openai-codex` 首次成为可配置提供方，另外六条 catalog 路由也获得了无需逐一列举的登录能力。

代价是每条路由多出第三种认证姿态，适配器必须在每次请求前做出决定，README 也必须在 `apiKeyEnv` 之外解释它。Anthropic 订阅流量不携带 harness 归因，因为其端点要求 OAuth 客户端的 CLI 身份；其他订阅路由保留归因，除非提供方 SDK 自行替换。

退出登录只影响本机：这里无法撤销授权，授权归提供方账户页面管理。订阅套餐各自规定允许哪些客户端使用；登录流程展示提供方自己的 coding-agent 身份，因为 OAuth 路径要求如此。套餐是否允许由账户持有人与提供方决定，harness 不作判断。

## Testing

`packages/llm/llm-oauth-local/tests/store.spec.ts` 固定存储序列化、权限拒绝、格式版本拒绝和部分条目容错。seam 的提交事件隔离和提供方流程编排各有测试。命令套件与真实 Loader 组合固定设备代码的即时展示、取消行为以及仅面向人的输出。`packages/llm/llm-pi-ai/tests/subscription.spec.ts` 针对本地端点驱动三种请求姿态并断言提供方特定的归因行为，其中也验证已退出登录的 `auth: subscription` 路由完全不发送请求，而不是回退。
