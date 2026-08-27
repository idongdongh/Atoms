# ADR 0006：生成应用的数据与发布（Demo 形态）

- 状态：accepted
- 日期：2026-08-26

## 决策

- 生成应用的数据使用 Supabase PostgreSQL。Demo lite 形态：平台自有 Supabase 项目内为每个生成应用创建独立 schema；应用前端通过 supabase-js 以 anon key 与行级安全策略（RLS）直连；`service_role` 凭据仅平台服务端持有，不进入浏览器 Bundle、日志或模型上下文。
- Agent 通过受控工具（建表/迁移、RLS 策略窄接口）在服务端以 `service_role` 执行 Schema 变更，保持 ADR 0002 的结构化工具协议。完整形态（Supabase for Platforms Management API 按需创建项目与分支）归第二阶段 P2-M2。
- 生成应用的发布采用自有子域静态托管（机制见 [ADR 0005](0005-demo-runtime-topology.md) 发布网关）。发布产物为纯静态包：应用数据经 Supabase 直连获取，不依赖平台运行时常驻进程，可在任何静态托管环境运行。
- Vercel 保留为第二阶段 P2-M5 的候选 Runtime Provider：用户 PAT 授权、从 GitHub 仓库 gitSource 触发 production deployment、部署 URL 回填应用记录。Demo 不实现。

## 原因

Supabase 是同类产品的事实标准选择（同类产品普遍采用）。anon key + RLS 的直连模式使发布产物保持纯静态、可移植，与 Atoms、Lovable 的自有子域发布模式吻合；平台自身不托管用户生产后端，单机资源模型（ADR 0005）因此成立。

## 用户影响与风险

- 用户生成的应用自带真实持久数据，发布后获得独立公网 URL，可回退任意历史版本。
- 风险：Supabase 免费档项目约一周无活动会休眠，演示前需激活或执行冒烟测试；若部署环境（香港/境内）到 Supabase 的链路实测不达标，Demo 退化为每应用 SQLite，`AppDatabaseProvider` 契约不变。
