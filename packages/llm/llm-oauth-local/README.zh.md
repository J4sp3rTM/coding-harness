# dsh-llm-oauth-local

[English](README.md) | 中文

[订阅登录 seam](../llm-oauth/README.md) 的文件后端提供方。它拥有两件东西：持久化的令牌文档，以及它运行的登录流程。

## 令牌文档

令牌组存放于 `$DSH_HOME/.oauth.json`，每条供应商路由一个条目，在 `0700` 的 home 内以 `0600` 创建与替换。权限更宽的文档在读取其内容之前就被拒绝——它除机密外别无他物，从一个所有人可读的文件里供出机密，会让那个权限位形同虚设。仅限 POSIX：Windows 没有可检查的 mode，因此该检查被跳过而非伪造。

每次读取都落到文件，每次写入都是写入者跨进程锁下的「读—渲染—提交」循环。这不是对并发的泛泛谨慎：令牌轮换本身就是一次读—改—写，第二个 harness 进程或第二个请求可能在同一刻进入它，而供应商交回的刷新令牌是一次性的——用片刻之前还是当前的那一个覆盖它，就再没有可以交换的东西了，用户就此被永久登出。进程内的写入者在争抢文件锁之前先在每条路由一条的 promise 链上排队，于是常见情形从不支付文件系统重试。

文档声明格式版本。由其他版本写入的文档被拒绝而非迁移，诊断会说移除它并重新登录——重新挣得一个令牌只花一次浏览器往返，而对未知格式的猜测代价是账户。

缺字段的条目读作未登录而不是失败：被截断或手工编辑过的条目由一次登录修复，另一种选择是让一个形似令牌的值抵达供应商请求。

## 流程

流程不在此处实现。已安装 pi-ai 目录中每个具备 OAuth 能力的供应商都已自带一份——授权端点、PKCE 交换、回环回调服务器、「把重定向地址粘回来」后备，以及刷新授权——而同一份目录还拥有把已存令牌变成各供应商所期望的身份请求头的那条请求路径。在它旁边重新实现一遍流程，会留下同一套协议的两份描述，而其中只有一份是请求真正走的那条。

因此提供哪些路由是目录的答案，pi-ai 升级新增一家订阅供应商时，这里无需改动即可提供它。按当前安装，那是 `anthropic`（Claude Pro/Max）、`openai-codex`（ChatGPT Plus/Pro）、`github-copilot`、`kimi-coding`、`openrouter`、`radius` 与 `xai`。

## Config

```yaml
- id: llm-oauth
  name: '@deepseek-ai/dsh-llm-oauth-local'
  config:
    # Token document; defaults to `.oauth.json` under the harness home.
    path: /run/secrets/dsh-oauth.json
    # Harness home used when `path` is omitted; defaults to $DSH_HOME or ~/.dsh.
    dshHome: /var/lib/dsh
    # Offer only these routes; omit to offer every catalog route that can be
    # signed into. A route the catalog cannot sign into fails at load rather
    # than being skipped, so a typo names itself instead of quietly removing
    # the option someone meant to keep.
    providers:
      - anthropic
      - openai-codex
```

## 使用订阅

登录会存下一个令牌组；随后 pi-ai 适配器用订阅认证该路由，并在该存储自己的锁下轮换令牌。该路由的模型要出现在选择器里，仍需在 `llm-pi-ai` 设置分节中拥有一份 profile——登录认证一条路由，并不创建它——而 `auth` 字段，以及「已存登录」与「已配置 key」之间的优先级，归[那个包的 README](../llm-pi-ai/README.md) 所有。

退出登录把令牌组从这台机器上移除。它不会结束供应商侧的会话；这里也做不到，授权在供应商自己的账户页面上吊销。

订阅计划各自带有关于哪些客户端可以使用它的条款。这里的登录会呈现供应商自己的编码代理客户端身份，因为 OAuth 路径要求如此；某个计划是否允许这样做，是账户持有人与供应商之间的事。

## Model Experience

间接地，经由消费方适配器，它拥有全部模型可见面；本包只保存为其请求授权的那份凭据。

#### KV Cache effect

无；本包既不组装也不发送供应商请求。

## Known Limitations and Deferred Work

- **回环流程仅限 Node** —— 目录流程会在 Host 上打开一个 HTTP 回调服务器，因此当 Host 所在处的 `127.0.0.1:53692` 对用户浏览器不可达时，登录依赖「粘回重定向地址」这条提示。
- **没有孤儿锁回收** —— 被杀死的进程遗留的写入者锁由运维移除，因为文件的年龄无法证明其持有者已经停止。
- **每条路由一个令牌组** —— 在同一供应商上拥有两个账户的用户无法同时保留两者。
