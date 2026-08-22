# @deepseek-ai/dsh-tool-development-workflow

[English](README.md) | 中文

面向模型的 `delegate_work` 工具通过 `ctx.workflowEngine` 执行经过计划的最小开发工作单元。工具使用固定且受信任的编排脚本；模型只能提供目标、计划、工作单元和并行独立性声明，不能替换编排或报告格式。

只有标记了 `repetitive` 的简单低风险工作才使用 T3。仅 `simple` + `low` 会落到 T2，而不是 T3。普通或复杂的实现、检查和验证默认使用 T2。T1 仅用于 `exceptional: true` 的单元（架构、困难诊断、例外风险或高价值最终审查）。模型不能自行选择层级。如果一次调用的每个单元都是细小且非重复的 1–2 个文件改动，工具会拒绝该调用，改由父 agent 完成；`refuseTinyNonRepetitive`（默认 true）和 `tinyMaxFiles`（默认 2）可配置该行为。宿主设置命名空间 `development-workflow` 可以为每个层级覆盖 provider、model 和该模型专属的推理等级；省略字段时继承调用方路由，或采用所选模型的提供方默认等级。成员 start 事件会记录该配置或继承的路由，包括推理等级是显式传入还是沿用提供方默认。设置变化作用于下一次调用，正在运行的工作流保留开始时捕获的路由。默认顺序执行；`parallel: true` 要求每个单元声明不重叠的作用域（包括父子路径），但生成文件或其他共享状态仍可能冲突。

实现 Worker 只能编辑声明的作用域。检查、验证和审查 Worker 明确为只读；验证必须报告准确的相关检查，审查必须报告具体缺陷。Worker 返回 `summary`、`changedFiles`、`validationEvidence`、`risks` 和 `followUps`。报告只是交给父 agent 的证据，不是认证；父 agent 必须检查 diff、运行权威验证、修复问题，并决定是否再次委派。顶层运行和成员通过共享的 `tool-workflow/*` 持久事件记录。

## 配置

| 键 | 默认值 | 含义 |
|---|---:|---|
| `maxWorkUnits` | `8` | 每次调用和部署的工作单元上限。 |
| `maxHandoffChars` | `16384` | 序列化工作流结果上限。 |
| `maxResultChars` | `16384` | 面向父 agent 的渲染上限。 |
| `refuseTinyNonRepetitive` | `true` | 拒绝每个单元都是细小且非重复的 1–2 个文件改动的调用。 |
| `tinyMaxFiles` | `2` | 拒绝时仍视为细小改动的声明作用域上限。 |

## 模型体验

### 系统提示

#### 模型看到的内容

工具添加简短指导：先制定计划，跳过细小且非重复的 1–2 个文件改动，仅对重复工作使用 T3，并审查和验证每个结果。

##### delegate_work 指导

```markdown
Use delegate_work only after planning work that needs workers: repetitive mechanical edits, multi-file implementation, or exceptional review. Do not delegate a tiny non-repetitive 1-2 file change. T3 requires repetitive work; T2 is the default for ordinary implementation; T1 only when exceptional. Always inspect diffs and run authoritative validation.
```

#### Token 影响

工具处于作用域内时，每个请求都会产生少量固定的指导成本。

#### KV Cache 影响

只要工具指导不变，前缀就保持稳定；启用、dispose（资源释放）或文本变更可能使该章节起的复用失效。

### 工具参数和结果

#### 模型看到的内容

模型提交 `objective`、`plan`、`workUnits` 和可选的 `parallel`；共享工作流包络见生成的 [`workflow` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-workflow)。成功结果包含工作流运行 id、agent 数量和结构化报告。取消和引擎错误会作为错误返回。

#### Token 影响

每次调用都会向父级上下文加入有界的工作单元 schema 和结构化结果。

#### KV Cache 影响

定义和可见性不变时，schema 与指导的前缀保持稳定；调用和结果会在其后追加。

## 已知限制和后续工作

- Worker 共享工作区；即使作用域声明完整性由调用方保证，显式并行仍可能与生成文件或共享状态冲突。
- 路由继承在运行时遵循父 agent；此工具不保证 provider/model/推理等级组合的质量或可用性。
- 如果宿主挂载了设置提供方，可以在“设置 → 模型”中配置层级路由；没有该命名空间的部署会让所有层级继承父级路由。
