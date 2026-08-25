# Agent Note：绿色强调色主题插件

状态：已实现

[English](2026-08-25-green-accent-theme-plugin.md) | 中文

## 问题

Web GUI 只附带一套蓝色品牌调色板。第二套标志绿强调色必须作为独立的客户端插件存在，与现有的 light/dark/system 偏好组合，并在 dispose 时撤回。若内存开关在 HMR 后泄漏 `overrideTokens`，后续主题工作会被卡住。

## 决策

`@deepseek-ai/dsh-client-ui-theme-green` 拥有 Host settings 命名空间 `ui-theme-green.accent`（`default` | `green`）以及 General 设置行。`green` 通过 `ThemeRuntime.overrideTokens` 叠加别名 token 覆盖；`default` 撤回它们。存活 disposer 是插件 fiber 的 effect，因此禁用与 HMR 都会移除该层。token 值使用主题包拥有的 CSS 变量（`--dsw-static-green-300` 即标志色 `#35e888`）；插件不复制 RGB 字面量。light/dark/system 仍归 `ui-theme`。仍读取 `--dsw-static-deepseek-*` 的功能样式表保持蓝色。

## 后果

强调色与其他由 Host 支撑的偏好一起在回环上持久化，在远程浏览器中仅保留在进程内。第三方主题仍是覆盖层，而不是 Appearance 的第四个方块。后续强调色可以复用“命名空间 + 覆盖层”模式，而无需扩大 `ThemePreference`。

## 测试

Host 规格注册并拒绝无效强调色。客户端 apply 规格叠加并撤回该层、采纳 Host 更新、让远程浏览器保持进程本地，并在 General 项声明折叠后恢复。行与 store 规格覆盖选择与 revision 守卫。

## 考虑过的替代方案

将 `green` / `green-dark` 注册为 ThemeRuntime 主题被拒绝，因为 `ThemePreference` 是持久化的内置集合，Appearance 会因此分叉 light/dark。扩大 `ui-theme.preference` 被拒绝，因为缺失插件时不能留下无法解析的持久 id。把 RGB 字面量复制进功能插件被拒绝，因为静态尺度归 `ui-theme` 所有。