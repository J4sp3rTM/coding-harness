# Agent Note：Web 思考尾部滚动 —— 折叠态 reasoning 跟随实时输出

Status: implemented

[English](2026-08-02-web-thinking-tail-scroll.md) | 中文

## 问题

Web Think 行在结算与流式 block 中都把 reasoning 首行渲染成折叠摘要。首行一旦出现，之后每个 reasoning delta 只会改变隐藏的正文。于是快速模型在思考时看起来静止，用户必须展开完整思维链才能确认输出仍在推进。产品事项表已经要求“thinking：滚动展示思维链更新、可展开”；当前行只满足了后半项。

## 决策

Think 行把模型生成的每段连续空白转换为一个可见空格。因此，折叠摘要包含完整的规范化 reasoning 文本；展开正文会在可用宽度内软换行，而不会保留 provider 的硬换行。session 与模型历史中的原始 reasoning block 保持不变。该规范化不会猜测 provider 是否把一个单词拆成了多个 reasoning 片段，只会阻止这些片段产生硬换行或大片空白区域。

只有 reasoning block 是当前流式尾部、且仍处于折叠态的 Think 行会跟随实时输出。其单行摘要是程序化横向滚动区，每次文本更新后钉到 `scrollWidth - clientWidth`。直接赋值 `scrollLeft` 会跟随真实 delta，而不会虚构独立的跑马灯速度：token 快则移动快，模型停顿则停止，短文本因滚动范围为零而保持静止。结算会把摘要重置到左端；其他工具摘要保留已有省略号行为。

## 曾考虑的替代方案

**播放与流式输出无关的 CSS 跑马灯。** 否决：它会在 provider 停顿时继续移动，让慢模型显得很快，破坏该交互本应暴露的吞吐信号。

**始终显示完整 reasoning 字符串的固定后缀。** 否决：按字符切片可能截断单词或字素，在内容真正溢出前就丢掉当前行的开头，而且只会跳变，无法随每个 delta 移动。

**自动滚动展开的 reasoning 正文或会话页面。** 否决：展开内容是阅读界面，强制跟随会与向上回看的用户争夺滚动；跟随器只属于折叠的单行摘要。

## 后果

折叠行会同时通过内容移动和已有扫光传达 provider 节奏；频繁或重复输出换行的 provider 也会显示为普通换行段落，而不是大片空白区域。滚动更新只发生在流式累加器本就会触发的 React 渲染中；不会增加计时器、动画循环、订阅、持久状态或传输流量。较长的 reasoning block 会把完整的规范化文本留在 DOM 中，并只以编程方式裁掉折叠摘要已经溢出的前缀，因此展开内容与辅助技术会呈现相同的可见文字。

## 测试

`packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx` 固定空白规范化、算出的右端滚动位置，以及结算后重置到 `scrollLeft = 0`。`apps/web/tests/lifecycle-chrome.e2e.ts` 中的无密钥组装态 Chromium 场景以可观察节奏回放真实录制的 reasoning chunks，把视口收窄到摘要溢出，并断言实时折叠 Think 行到达真实浏览器的滚动边界。
