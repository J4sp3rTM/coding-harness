# Agent Note: 自动打开提供方登录浏览器

Status: implemented

[English](2026-08-19-automatic-provider-login-browser.md) | 中文

## Problem

`/login` 会显示授权 URL 或设备验证 URL，但用户仍需点击。这个额外动作会增加本机桌面上的阻力；若无条件打开每个 URL，又会在远程或无头 Host 上打开用户看不到的浏览器。

## Decision

[`dsh-command-login`](../../../../packages/llm/command-login/README.md) 会把每个报告的 HTTPS 授权 URL 或设备验证 URL 交给命令 Host 的默认浏览器。macOS 使用 `open`，Windows 与 WSL 使用已注册的 URL 处理器，Linux 桌面使用 `xdg-open`。所有启动器都通过无 shell 的 native-command 运行器以 argv 形式执行。

命令只启动绝对 `https:` 目标。Linux 仅在存在显示服务器或 WSL 桌面路径时启动。无头 Host、不支持的平台或启动器失败时，登录会继续运行，并通过 `ctx.userQuestions` 保持 URL 与设备代码可见；自动打开只是优化，绝不是唯一路径。

浏览器移交归一次操作所有。同一 URL 的重复通知只启动一次，取消会传递给正在运行的启动器，命令拆卸会等待已启动的启动器结束。

这项展示决策部分取代了[订阅登录架构](../architecture/2026-08-19-provider-subscription-sign-in.md)中的仅手动打开方案；该说明仍保持活跃，因为它拥有能力拆分、令牌存储、提供方流程与请求认证姿态。

## Alternatives considered

**始终在命令 Host 上启动。** 否决，因为远程或无头 Host 可能没有用户可见的桌面。显示服务器与 WSL 检测会在这些环境中保留可见链接路径。

**让 pi-ai 打开浏览器。** 否决，因为 pi-ai 通过 interaction API 报告 URL，不拥有 Harness Host 策略或远程 Host 后备行为。

**接受流程报告的任意 URL scheme。** 否决，因为操作系统 URL 处理器可以分派本机文件或其他高权限 scheme。提供方授权与验证目标必须使用 HTTPS。

## Consequences

本机桌面登录通常无需点击即可打开，包括 xAI 的设备代码页面。用户仍会看到准确 URL 与代码，因此启动器失败和远程部署继续保留可恢复流程。命令包增加一个本机子进程依赖，并以平台专项测试固定每种启动选择与 HTTPS 拒绝行为。
