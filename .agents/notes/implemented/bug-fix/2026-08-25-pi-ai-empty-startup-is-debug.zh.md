# Agent Note: Empty pi-ai startup is debug, not stderr

Status: implemented

[English](2026-08-25-pi-ai-empty-startup-is-debug.md) | 中文

## 问题

随附的 `dsh` 二进制会在 info 级别把例行的首次启动事实写到 stderr：`llm-pi-ai: subscription sign-ins: (none)` 以及 `llm-pi-ai: no provider routes registered — sign in with /login, or add a provider on the Models settings page`。把 stderr 当作错误通道的消费方——包括无密钥 badge 快照的 `expect(disabled.stderr).toBe('')`——于是会在一次没有凭据、本身成功的启动上失败。

## 决策

[`reportRoutes()`](../../../../packages/llm/llm-pi-ai/src/index.ts) 把普通的空状态记到 `debug`。已配置的路由仍记 `info`，已登录但没有模型的订阅仍记 `warn`，因为那些才是用户可见的症状。首次运行的空默认不是错误，也不是 stderr 消费方在问的问题。

## Alternatives considered

**保持 info 并放宽 badge 快照。** 否决：空 stderr 断言正是抓住这次泄漏的契约。把首次运行的空状态当作面向用户的错误通道，会继续打断每一个其他 stderr 消费方。

**完全静默空状态。** 否决：把日志级别调高的运维者仍需要一种方式确认适配器已挂载且没有路由。

**单独的面向用户界面。** 暂缓：`/login` 和 Models 页面已经拥有这个问题；在启动时再重复一遍是噪音。

## Consequences

无密钥启动在 stderr 上保持静默。debug 日志仍能看到空报告。路由存在、以及已登录但目录为空，仍在 info/warn 可见。
