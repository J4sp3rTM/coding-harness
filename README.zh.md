# Conduit

[English](README.md) | 中文

Conduit 是面向 coding agent（编程智能体）的开源 agent harness（智能体框架）。它是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 fork。

Conduit 中的一切都是插件。插件系统是 [Cordis](https://github.com/cordiverse/cordis)。

## 为何选择 Conduit

- **成本更低。** Conduit 通过在上一次请求上追加内容来构建每次请求。请求前缀保持稳定，因此提供方缓存能命中大部分输入 token。在我们自己的流量上测得：95.6% 的 token 来自缓存。
- **结果更好。** 在我们的基准测试套件上，Conduit 完成了 79.5% 的任务。Codex harness 完成了 59.0%。盲评评审人对 Conduit 结果的评分也更高：85.7 对 74.8（满分 100）。
- **运行更快。** Conduit 上任务的中位耗时为 5.0 分钟，Codex harness 为 8.9 分钟。

详情见 [BENCHMARKS.md](BENCHMARKS.md)。

## 状态

Conduit 处于早期开发阶段。版本发布可能破坏兼容性。

## 从源码运行

安装 Node.js 22.19 或更高版本（或 Node.js 24 或更高版本）以及 pnpm。

```sh
git clone https://github.com/J4sp3rTM/coding-harness.git conduit
cd conduit
pnpm install
pnpm run build
pnpm dsh web
```

该命令会在 `http://127.0.0.1:3080` 启动 Web UI。详见 [Web UI 指南](docs/user/guide/index.md)。

## 文档

- 架构：[docs/architecture.md](docs/architecture.md)
- 开发指南：[docs/development.md](docs/development.md)
- 面向 coding agent 的说明：[AGENTS.md](AGENTS.md)

## 参与贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
