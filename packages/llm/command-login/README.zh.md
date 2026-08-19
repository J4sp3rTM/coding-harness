# dsh-command-login

[English](README.md) | 中文

面向人的 `/login` 与 `/logout`，建立在[订阅登录 seam](../llm-oauth/README.md) 之上。

登录是一次对话，不是一张表单：流程给出授权 URL 或设备代码、等待提供方，并从用户处取得所需的重定向 URL 或选择。若 Host 有可用的桌面路径，命令会在本机默认浏览器中打开 HTTPS 授权页与设备验证页。每次交互也会经由 [`ctx.userQuestions`](../../interaction/user-questions/README.md)，因此可见 URL 仍是无头或远程 Host 的后备路径，任何界面都不必自备登录页面。

## 命令

- `/login` —— 登录唯一提供的路由；提供多条时先问是哪一条。选择器逐条列出路由、其订阅标签与当前状态。
- `/login <provider>` —— 直接前往该路由。
- `/logout <provider>` —— 移除这台机器上该路由的已存令牌组。

流程事件会被带进需要它们的那个问题里。授权 URL 显示为提供方下一个提示的辅助文本。设备代码会立即出现在确认问题中，同时提供方继续轮询；流程完成后该问题自动关闭，选择“取消”则中止流程。浏览器启动失败不会导致登录失败，因为同一 URL 与代码仍会显示。

`/login` 成功后会说明哪条路由现在走订阅，以及如何撤销。在 Web dashboard 中，每个带文本的 `/login` 结果还会在提交它的浏览器中显示为瞬态全局 toast，包括会话尚无任何 chat 历史时。`/logout` 会说明令牌已从这台机器上消失，而授权本身在供应商自己的账户页面上吊销。

预期内的失败作为命令错误汇报而非抛出：部署未提供的路由（并点名它确实提供的那些）、被取消的登录，以及未能完成的流程。未组合登录服务的部署会直说，而不是给出一个空的选择器。

## 组合

```yaml
- id: command-login
  name: '@deepseek-ai/dsh-command-login'
```

需要 `commands`、`llmOAuth` 与 `userQuestions`。两处注册都是 effect，因此销毁 fiber 会撤回两条命令；已经开始的登录会在拆卸完成之前先行排空。

`/login` 声明的是可选命令输入：裸调用会立即执行并打开路由选择器，输入空格或明确的提供方则进入参数路径。`/logout` 声明的提供方输入是必需的。

## Model Experience

无，因为两条命令都针对接收方 agent 执行，不向模型发送任何东西，其结果文本仅面向人。

#### KV Cache effect

无直接影响；两条命令都不触碰请求前缀。被切换到订阅上的路由，其下一次请求可能呈现不同的 system prompt，那归[适配器](../llm-pi-ai/README.md) 所有。

## Known Limitations and Deferred Work

- **没有账户状态命令** —— `accounts()` 在 seam 上，而状态行归渲染它的那个界面所有；提供多条路由时的 `/login` 会顺带展示它。
