# ADR 0001：采用 Vite SPA 与独立 Fastify API

- 状态：accepted
- 日期：2026-08-25

## 决策

浏览器端使用 React + Vite SPA，Control Plane 使用独立 Fastify API。Agent Worker 是第三个独立运行单元。

## 原因

- 用户代码 Preview 和长时间 Agent Run 天然需要独立后端服务，Next.js 一体化 Server 并不能减少关键系统数量。
- SPA 可以专注 Builder 交互，API 可以独立扩缩容和部署。
- Fastify 提供明确的 HTTP 边界、运行时 Schema 集成和低额外复杂度。

## 用户影响

前端页面不会因 Agent Worker 或 Sandbox 扩容方式改变而重写；长任务连接也不受页面渲染框架约束。

## 替代方案

Next.js 适合内容型页面和轻量 BFF，但在本项目中仍需额外 Worker、Workspace 与 Sandbox 服务，不能替代独立 Control Plane。
