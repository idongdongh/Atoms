# ADR 0004：持久事件流与 Preview 分域

- 状态：accepted
- 日期：2026-08-25

## 决策

- Agent 与构建事件先持久化，再通过 SSE 推送。
- 事件使用 Run 内单调递增 sequence，客户端通过 `Last-Event-ID` 恢复。
- Preview 使用独立 Origin 和短期签名 URL。
- 交互终端仅在确有双向字节流需求时使用 WebSocket。

## 原因

浏览器连接是临时展示通道，不能成为任务事实来源。Preview 分域可以阻止生成应用读取主站 Cookie、Storage 和 DOM。

## 用户影响

刷新页面或短暂断网不会丢失 Agent 进度；生成应用的问题不会污染主产品会话。
