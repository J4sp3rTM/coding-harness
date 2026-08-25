# @deepseek-ai/dsh-client-ui-theme-green

[English](README.md) | 中文

基于 ThemeRuntime 覆盖层的绿色强调色插件。Host settings 命名空间 `ui-theme-green.accent` 存储 `default` 或 `green`。选择 `green` 会在内置浅色／深色调色板之上叠加标志绿别名 token（`#35e888` 即 `--dsw-static-green-300`）；选择 `default` 则撤回该层。General 设置行拥有写入。覆盖层是插件 fiber 的 effect，因此 dispose 与 HMR 都会移除它。仍直接读取 `--dsw-static-deepseek-*` 的功能 CSS 会保持蓝色。

## 模型体验

无。该插件只叠加浏览器主题 token。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **仅覆盖别名** — conversation 闪烁条与 StateDot 仍直接绑定 `--dsw-static-deepseek-*`，这些表面会保持蓝色，直到它们改用别名 token。