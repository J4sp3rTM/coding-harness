# @deepseek-ai/dsh-web-search-duckduckgo

[English](README.md) | 中文

一个免凭据的 DuckDuckGo `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它以表单 POST 查询 DuckDuckGo 的 HTML 端点（`html.duckduckgo.com/html/`），把服务端渲染的结果解析为 seam 的规范化来源。它不需要任何凭据，因此可以作为 [`dsh-web-search-deepseek`](../web-search-deepseek/README.md) 这类需要凭据的搜索提供方之后的有序回退。

这是一个**实现**包：它向 `ctx.web` 注册提供方，不拥有任何密钥，也不注册面向模型的工具。它是函数／命名空间插件（`inject: ['web']`）。

## 职责拆分

提供方拥有传输与解析：表单编码的 POST、重定向拒绝、响应字节上限、UTF-8 解码，以及把 HTML 标记解析为 `WebSearchSource[]`。`@deepseek-ai/dsh-tool-web` 拥有呈现；`ctx.web` 拥有选择（包括本包通常排在第二位的有序偏好列表）、`maxResults` 截断与错误词表。

即使请求不携带机密，客户端也拒绝重定向（`redirect: 'error'`，表现为 `WEB_PROVIDER_ERROR`）：按照 web 包的重定向规则，配置的端点是唯一的请求目标。非 200 状态——包括该端点的 202 异常／质询页——以 `WEB_PROVIDER_ERROR` 失败；200 页面上的空结果集是合法的空结果。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `https://html.duckduckgo.com/html/` | HTML 端点基 URL；搜索表单 POST 到这里。 |
| `maxResponseBytes` | `2_000_000` | 响应字节上限（含）。声明或流式读取超过上限的主体以 `WEB_FETCH_TOO_LARGE` 失败，而不是解析被截断的标记。 |

插件应用时会对这两个字段重新验证：配置错误在加载时抛出异常，不会注册一个每次搜索都会失败的提供方。

## 模型体验

### 免凭据的 web_search 结果

#### 模型看到的内容

模型的 `web_search` 调用返回可引用的 `url`/`title`/`snippet` 来源以及端点提供的 `publishedAt` 日期。与 DeepSeek 路线不同，这里没有辅助模型调用：一次搜索就是一次 HTTP 抓取。

#### Token 影响

无直接影响——本包不发起任何模型请求；结果只经由 [`dsh-tool-web`](../tool-web/README.md) 的工具输出进入对话。

#### KV Cache 影响

无影响；请求前缀变更由消费方负责。

## 已知限制与暂缓事项

- **标记抓取没有契约**：HTML 端点未公开文档化，其标记可能随时变化；解析失效会在运行时表现为字段缺失或为空。解析器以录制的真实端点页面（`tests/fixtures/`）做回归，上游改动会先在测试中失败，但重新录制夹具是手工工作。
- **反爬质询是硬失败**：数据中心 IP 经常收到 202 质询页而非结果；提供方以 `WEB_PROVIDER_ERROR` 报告状态码，不会重试或绕过质询。
- **点击路由 URL 尽力还原**：结果链接经 `duckduckgo.com/l/?uddg=…` 路由；无法还原目标的条目会被静默跳过，不做猜测。
- **发布日期只有日期部分**：端点的附加信息区只带裸日历日期；没有可保留的时刻或时区。
