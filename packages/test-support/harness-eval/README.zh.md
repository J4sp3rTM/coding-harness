# `@deepseek-ai/dsh-harness-eval`

[English](README.md) | 中文

这是用于确定性 A/B 评估的私有支持基础设施。它拥有 seed/oracle fixture 目录、托管进程执行、基于完成事实的验证分类器、真实的 Codex 与 DeepSeek Harness 适配器、带版本的比较产物和 CLI。默认模式只复制 fixture 并运行验证命令，不调用模型。

## 无密钥评估

使用 `node --import tsx/esm packages/test-support/harness-eval/src/cli.ts --out <dir>` 运行源 CLI。加入 `--oracle` 可在验证前覆盖通过验证的源文件，加入 `--repetitions N` 可重复 A/B 矩阵，加入 `--concurrency N` 可并行执行隔离的 run。concurrency 默认为一，以保持 latency 测量可直接比较。`--suite baseline` 是包含四项任务的默认 smoke suite；`medium`、`difficult` 和 `stress` 分别选择三项逐步增加难度的任务，`all` 则选择全部十三项任务。CLI 将 run、workspace、agent、validation 和 completion 进度写入 stderr，并在 stdout 保持最终 JSON 摘要。比较结果写入 `comparison.json`，验证 stdout 和 stderr 分别保留在证据文件中。

验证状态只根据已确认的进程完成事实得出。`passed` 必须有零退出码；超时、取消、缺少状态和终止信号分别分类。输出文本（包括 `PASS` 行）不会改变状态。

产物包含 `schemaVersion: 1`。usage 和 cost 使用规范化的可空字段：缺少提供方元数据时使用 `null`，不会伪造估算值。产品结果、进程完成和 fixture 验证是独立字段，因此受控 app-server teardown 不会覆盖已完成的模型结果。可观察的 executor 时间拆分为 startup、agent 和 teardown 三段。`runAbEval` 接受 executor 回调，并向其提供已复制的 workspace 与 variant；回调可以返回独立分类的 executor 进程证据和提供方元数据。非跳过 executor 之后始终独立运行 fixture 验证。executor 可以返回跳过原因；该运行保留为 `inconclusive`，比较继续进行。它不会根据 API key 推断 live 运行。

## Codex 与 DeepSeek Harness 对比

使用 `node --import tsx/esm packages/test-support/harness-eval/src/cli.ts --out <dir> --live` 运行真实比较。Variant A 通过隔离的 `CODEX_HOME`、OpenRouter Responses 提供方以及由一次性 fixture 工作区限制的 `danger-full-access` 运行官方 Codex app-server。Variant B 通过 preset 服务挂载随产品发布的 `code` preset，并运行 DeepSeek Harness 源码 CLI。两个 variant 都使用 reasoning effort 为 `high` 的 `stealth/ox-alpha`，并接收同一份不含仓库指令文件的 fixture 副本。

Codex 需要显式的 `OPENROUTER_API_KEY`。其隔离配置会禁用 plugin、plugin 推荐、远程 plugin 目录、更新检查和 shell snapshot，避免无关的首次运行设置进入 agent 时间。在 Windows 上，适配器优先使用 Codex Desktop 本地应用数据目录中随附的可执行文件，否则使用常规 PATH 启动器。DeepSeek Harness 从所选 Harness OAuth 文档读取现有 OpenRouter 订阅，但评估 session 和设置使用临时 `DSH_HOME`。凭证只在进程边界传递，不会写入结果产物。缺少凭证时，该侧会记录为 skipped，绝不会成为通过结果。每次完成的模型运行之后都会独立执行 fixture 验证命令，正确性只由其已确认的退出事实决定。

## 模型体验

无，因为评估器只提交 fixture 的普通用户任务，并将系统指令和工具组合交给所选的 Codex 或 DeepSeek Harness runtime。

#### KV Cache 影响

不同运行之间没有影响。每个 fixture variant 都在隔离进程和复制的 workspace 中启动，因此评估器不会在样本之间保留模型请求前缀或会话状态。

## 已知限制和延期工作

目录包含四个 baseline fixture，以及各三个 medium、difficult 和 stress fixture。stress 组覆盖异步生命周期回滚、持久化崩溃恢复和租户隔离的工具执行。它不生成任务，也不使用模型 judge。当适配器无法提供权威测量时，usage 和 cost 保持为 `null`；完整 A/B 结果同时需要供 Codex 使用的 OpenRouter API key 和供 DeepSeek Harness 使用的 OpenRouter OAuth 订阅。
