# 第一阶段开发计划：Web AI App Builder 内核

## 实施进度

更新时间：2026-08-25

| 里程碑 | 状态   | 已完成                                                                                                | 待完成                                   |
| ------ | ------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| M0     | 进行中 | pnpm Monorepo、Web/API/Worker 骨架、统一 format/typecheck/test/build、核心 ADR                        | PostgreSQL/Redis/对象存储开发环境、CI    |
| M1     | 进行中 | Zod Contract、Agent Run/Sandbox 状态机、Workspace/Sandbox Fake Provider                               | 持久事件存储与 sequence 重放             |
| M2     | 进行中 | 安全路径解析、符号链接防护、原子写入、Patch、Git diff/commit/restore、项目写锁、模板复制与 Git 初始化 | 项目元数据/API、文件审计、搜索与版本列表 |
| M3-M10 | 未开始 | —                                                                                                     | 按下文里程碑实施                         |

本表只记录已通过仓库检查的能力，不以目录或占位文件视为里程碑完成。

## 1. 阶段目标

第一阶段交付一个可持续演进的 Web AI App Builder 内核。用户应当能够完成以下闭环：

```text
创建项目
→ 输入自然语言需求
→ Agent 读取并修改项目代码
→ Sandbox 安装依赖并运行项目
→ 浏览器实时预览
→ 查看工具活动、构建日志和代码差异
→ 继续对话修改
→ 自动保存 Git 版本
→ 查看历史并安全回滚
```

第一阶段完成后，系统应具备长期产品的正确边界，而不是只能执行一次生成流程的演示原型。

## 2. 成功标准

阶段只有同时满足以下条件才算完成：

- 用户可以从固定模板创建项目并生成可运行的 React 应用。
- 生成过程由真实 Agent 工具调用驱动，不使用伪进度。
- 用户代码只在隔离远程 Sandbox 中运行。
- Preview 与主站安全分域。
- 用户可以继续对话修改已有项目。
- 每轮成功修改对应一个 Git commit。
- 用户可以查看文件、Diff、日志和版本历史。
- 回滚会产生新的恢复 commit，不破坏历史。
- 页面刷新和 SSE 重连后可以恢复正在进行的 Run。
- 重复请求不会重复执行，同一项目不会发生并发写冲突。
- Worker 异常退出后，Run 能够恢复或进入明确的失败状态。
- 失败修改不会覆盖当前稳定版本。
- 关键闭环具备自动化端到端测试。

## 3. 范围

### 3.1 必须实现

- 最小用户身份与项目归属。
- 项目创建和 React/Vite 模板初始化。
- Chat、消息和 Agent Run 持久化。
- 结构化 Agent Tool Calling。
- 文件读取、搜索、写入、删除和 Patch。
- 受控依赖安装、类型检查和构建。
- 远程隔离 Sandbox。
- 开发服务器生命周期管理。
- 实时 Preview、构建日志和错误反馈。
- 每轮成功修改自动 Git commit。
- 版本历史与安全回滚。
- Agent 取消、失败重试和幂等执行。
- 项目级并发写锁。
- 持久化事件流与 SSE 断线恢复。
- 路径、命令、网络、密钥和 Preview 基础安全。
- 单元测试、集成测试和端到端测试。

### 3.2 暂不实现

- 多人实时协作和复杂 RBAC。
- 计费、套餐和额度管理。
- 多 Agent 协作与子 Agent。
- MCP 和插件系统。
- Supabase、Neon 等数据库自动管理。
- GitHub 双向同步。
- Vercel 等生产部署。
- 可视化点选编辑。
- 自动生成端到端测试。
- 任意语言、任意框架和任意运行时。

第一阶段只支持经过验证的 TypeScript、React 和 Vite 模板。Sandbox 与 Workspace 接口仍需保持对未来模板和运行时的扩展能力。

## 4. 总体架构

系统划分为三个平面：

### 4.1 Control Plane

负责：

- 用户身份和项目授权。
- 项目、Chat、消息和 Agent Run 元数据。
- Agent 调度、事件流和任务队列。
- 模型路由和密钥引用。
- 审计、指标和错误追踪。

Control Plane 不得执行用户生成代码。

### 4.2 Workspace Plane

负责：

- 项目文件读写。
- 路径安全和原子写入。
- 文件搜索和 Repo Map。
- Git status、diff、commit 和 restore。
- 项目级写锁。
- Workspace 快照和恢复。

Workspace 是项目文件和 Git 操作的唯一入口。

### 4.3 Execution Plane

负责：

- 创建和销毁 Sandbox。
- 同步 Workspace 文件。
- 安装依赖和启动开发服务器。
- 执行类型检查、构建和受控脚本。
- 输出 stdout、stderr 和运行状态。
- 提供隔离 Preview 地址。
- CPU、内存、磁盘、网络和生命周期控制。

### 4.4 系统关系

```text
Web Client
  ├── HTTP ──────────────> API / Control Plane
  ├── SSE ───────────────> Agent Events / Build Logs
  ├── WebSocket ─────────> Interactive Terminal（按需）
  └── iframe ────────────> Preview Gateway

API / Control Plane
  ├── PostgreSQL
  ├── Redis / Job Queue
  ├── Agent Worker
  └── Secret Manager

Agent Worker
  ├── Model Provider
  ├── Workspace Service
  └── Sandbox Manager

Workspace Service
  ├── Project Files
  ├── Git Repository
  └── Object Storage Backup

Sandbox Manager
  ├── Isolated Sandbox
  ├── Dev Server
  └── Preview Gateway
```

## 5. 建议工程结构

采用 TypeScript Monorepo，各运行单元保持独立部署能力：

```text
atoms/
├── apps/
│   ├── web/                  # 浏览器端 Builder
│   ├── api/                  # Control Plane API
│   └── agent-worker/         # Agent 长任务 Worker
├── services/
│   ├── workspace/            # 文件、Git、项目锁
│   ├── sandbox-manager/      # Sandbox 生命周期
│   └── preview-gateway/      # Preview 访问代理
├── packages/
│   ├── contracts/            # API、事件和工具 Schema
│   ├── db/                   # PostgreSQL 与 Drizzle Schema
│   ├── agent-core/           # Agent 循环和上下文工程
│   ├── workspace-sdk/        # Workspace 接口与客户端
│   ├── sandbox-sdk/          # Sandbox Provider 接口
│   ├── git/                  # Git 操作封装
│   ├── security/             # 路径、命令和密钥安全
│   ├── observability/        # 日志、Tracing 和 Metrics
│   └── ui/                   # 共享 UI 组件
├── templates/
│   └── react-vite/           # 第一阶段项目模板
└── tests/
    └── e2e/                  # 浏览器端到端测试
```

实际创建这些目录时，必须同步更新根 `README.md`，并为有实质内容的新目录添加 `README.md`。

## 6. 推荐技术栈

| 层           | 推荐技术                                      |
| ------------ | --------------------------------------------- |
| Web          | React、Next.js 或 Vite SPA、TanStack Query    |
| 客户端状态   | Zustand 或 Jotai                              |
| 代码编辑     | Monaco Editor                                 |
| 日志/终端    | xterm.js                                      |
| API          | TypeScript + Fastify、Hono 或 NestJS 中的一种 |
| Agent        | Vercel AI SDK、Zod                            |
| 数据库       | PostgreSQL、Drizzle ORM                       |
| 队列与锁     | Redis、BullMQ 或等价持久任务队列              |
| 文件版本     | Git                                           |
| 附件与快照   | S3 兼容对象存储                               |
| 流式通信     | SSE；终端场景按需使用 WebSocket               |
| 可观测性     | OpenTelemetry                                 |
| 用户代码运行 | 统一 `SandboxProvider` 接入远程隔离环境       |

技术选型在 M0 通过 ADR 固化。在选型完成前，业务层只能依赖 Contract，不能直接依赖具体 Sandbox 或模型供应商。

## 7. 数据模型

### 7.1 核心实体

#### users

```text
id
email
name
created_at
```

#### projects

```text
id
user_id
name
slug
template_id
default_branch
current_commit
status
created_at
updated_at
```

#### chats

```text
id
project_id
title
created_at
updated_at
```

#### messages

```text
id
chat_id
role
content
source_commit
result_commit
model
run_id
created_at
```

`source_commit` 表示 Agent 开始工作时的版本，`result_commit` 表示该轮成功完成后的版本。

#### agent_runs

```text
id
project_id
chat_id
user_message_id
status
idempotency_key
base_commit
result_commit
model
error_code
error_message
started_at
completed_at
created_at
```

状态：

```text
queued
preparing
running
waiting_approval
validating
committing
succeeded
failed
cancelled
```

#### agent_events

```text
id
run_id
sequence
type
payload_json
created_at
```

`sequence` 是客户端断线恢复和事件重放的依据。

#### tool_calls

```text
id
run_id
sequence
tool_name
input_json
output_json
status
started_at
completed_at
```

#### workspaces

```text
id
project_id
repository_path
active_commit
status
lock_owner_run_id
updated_at
```

#### sandbox_sessions

```text
id
project_id
workspace_id
provider
provider_sandbox_id
status
preview_url
preview_port
last_active_at
expires_at
```

#### project_versions

```text
id
project_id
commit_hash
parent_commit_hash
message
run_id
created_at
```

Git 是代码版本的事实来源，`project_versions` 只保存产品查询所需的索引。

## 8. 共享协议

### 8.1 Agent Event

所有事件至少包含：

```ts
type BaseAgentEvent = {
  runId: string;
  sequence: number;
  timestamp: string;
};
```

第一阶段事件类型：

```text
run.started
message.delta
tool.started
tool.progress
tool.completed
tool.failed
files.changed
validation.started
validation.completed
build.log
preview.starting
preview.ready
run.completed
run.failed
run.cancelled
```

事件必须先持久化再尝试推送，不能以浏览器连接状态作为任务状态来源。

### 8.2 Workspace Contract

```ts
interface Workspace {
  listFiles(input: ListFilesInput): Promise<FileEntry[]>;
  readFile(input: ReadFileInput): Promise<FileContent>;
  search(input: SearchInput): Promise<SearchResult[]>;
  writeFile(input: WriteFileInput): Promise<FileMutationResult>;
  applyPatch(input: ApplyPatchInput): Promise<FileMutationResult>;
  deleteFile(input: DeleteFileInput): Promise<FileMutationResult>;
  getDiff(): Promise<ProjectDiff>;
  commit(input: CommitInput): Promise<CommitResult>;
  restore(input: RestoreInput): Promise<CommitResult>;
}
```

### 8.3 Sandbox Contract

```ts
interface SandboxProvider {
  create(input: CreateSandboxInput): Promise<SandboxInfo>;
  syncFiles(input: SyncFilesInput): Promise<void>;
  exec(input: ExecInput): Promise<ExecResult>;
  streamLogs(input: StreamLogsInput): AsyncIterable<SandboxLog>;
  restart(input: RestartSandboxInput): Promise<SandboxInfo>;
  getPreview(input: GetPreviewInput): Promise<PreviewInfo>;
  stop(input: StopSandboxInput): Promise<void>;
  destroy(input: DestroySandboxInput): Promise<void>;
}
```

## 9. 里程碑

### M0：架构决策与工程骨架

#### 工作内容

- 创建 Monorepo 和基础应用/服务。
- 建立共享 TypeScript、lint、format、typecheck、test 和 build 配置。
- 建立 PostgreSQL、Redis 和对象存储的本地开发环境。
- 建立 CI。
- 编写 ADR：
  - 用户代码必须运行在独立 Sandbox。
  - Git 作为代码版本事实来源。
  - Agent 使用结构化 Tool Calling。
  - SSE 与 WebSocket 的职责边界。
  - Preview 分域和授权策略。
  - Workspace 与 Sandbox 的同步关系。

#### 验收

- 所有运行单元可以独立启动和构建。
- CI 能执行 lint、typecheck、test 和 build。
- 服务之间只通过共享 Contract 通信。
- Web、API 和 Worker 不直接引用其他服务内部实现。

### M1：共享协议与状态模型

#### 工作内容

- 建立 API、Agent Event、Workspace 和 Sandbox Schema。
- 建立 Agent Run 和 Sandbox 的显式状态机。
- 实现事件持久化与按 sequence 重放。
- 为 Workspace 和 Sandbox 提供 Fake Provider。

#### 验收

- 所有外部输入通过 Zod 等运行时 Schema 校验。
- 前后端从同一 Contract 获取类型。
- Agent Event 能从任意 sequence 重放。
- 不连接真实 Sandbox 也能运行完整协议测试。

### M2：项目与 Workspace 内核

#### 工作内容

- 创建项目元数据、Workspace 和默认 Chat。
- 复制 React/Vite 模板并初始化 Git。
- 实现文件读取、搜索、写入、Patch 和删除。
- 实现 status、diff、commit、log 和 restore。
- 实现项目级读写锁和文件审计。
- 实现路径校验、原子写入和符号链接防护。

#### 安全回滚

回滚不执行破坏历史的硬重置，而是：

```text
读取目标 commit
→ 恢复文件到工作区
→ 创建新的 restore commit
```

#### 验收

- API 可以创建项目和初始 commit。
- 刷新或重启服务后项目文件仍存在。
- 每次修改可以获取准确 Diff。
- 路径穿越和符号链接逃逸测试全部被阻止。
- 同一项目两个并发写操作不会同时执行。
- 任意历史版本均可恢复，同时保留完整历史。

### M3：Sandbox 与 Preview

#### Sandbox 生命周期

```text
absent
→ provisioning
→ syncing
→ installing
→ starting
→ running
→ stopping
→ stopped
```

异常进入 `failed`，但保留最近日志和可重试信息。

#### 工作内容

- 实现首个真实 Sandbox Provider。
- 同步 Workspace 文件。
- 安装依赖并启动 Vite Dev Server。
- 实时采集 stdout 和 stderr。
- 探测 Preview 端口。
- 实现 Preview Gateway、签名 URL 和 HMR 转发。
- 实现 Sandbox 资源限制、空闲回收和销毁。

#### 验收

- 模板项目可以在 Sandbox 启动。
- Preview 可以在 iframe 和新窗口中访问。
- HMR 正常工作。
- stdout 和 stderr 实时到达浏览器。
- Sandbox 退出后 UI 收到明确状态。
- 用户代码无法访问宿主文件和其他项目。
- Preview 无法读取主站 Cookie、Storage 或 DOM。

### M4：Agent 内核与工具系统

#### 第一阶段工具

```text
list_files
read_file
search_files
write_file
apply_patch
delete_file
add_dependency
get_diff
run_typecheck
run_build
read_logs
restart_app
```

不开放任意 Shell。需要执行项目命令时，通过受控脚本名调用：

```ts
runScript({ script: "build" | "test" | "typecheck" });
```

#### Agent 循环

```text
加载聊天和项目上下文
→ 生成 Repo Map
→ 模型请求工具
→ 校验并执行工具
→ 将工具结果反馈给模型
→ 重复直到满足完成条件
→ 类型检查和构建验证
→ Git commit
→ 更新 Preview
→ 完成 Run
```

#### 终止条件

- 模型明确完成。
- 达到工具步数限制。
- 用户取消。
- 连续重复相同失败。
- Sandbox 不可恢复。
- Token、模型或工具调用失败。
- 项目写锁失效。

#### 验收

- Agent 能从模板生成完整页面。
- Agent 能修改现有文件而不是每轮重写项目。
- 错误工具输入会被拒绝并反馈给模型。
- 用户取消后不会执行后续写操作。
- 构建失败时 Agent 能读取错误并尝试修复。
- 成功 Run 生成唯一 Git commit。
- 失败 Run 不会被标记为成功。

### M5：上下文工程

#### Repo Map

至少包含：

- 目录结构。
- 应用入口。
- `package.json` scripts 和依赖。
- 路由和主要组件。
- 导出符号。
- 最近修改文件。
- 当前 Git Diff。

#### 默认上下文

每轮默认提供：

- 项目规则文件。
- `package.json`。
- 应用入口和路由结构。
- 最近修改文件。
- 用户明确提到的文件。
- 上一轮结果摘要。

其余文件由 Agent 通过搜索和读取工具按需获取。

#### 验收

- 小项目不需要把完整仓库发送给模型。
- Agent 可以主动找到未预加载文件。
- `.env` 和密钥不会进入模型上下文。
- 聊天压缩后仍可继续正确修改项目。
- 每次模型请求都能追踪实际包含了哪些文件。

### M6：Chat、队列与流式事件

#### 首批 API

```text
POST   /projects
GET    /projects/:projectId
GET    /projects/:projectId/files
GET    /projects/:projectId/files/content
GET    /projects/:projectId/versions

POST   /chats
GET    /chats/:chatId/messages

POST   /chats/:chatId/runs
GET    /runs/:runId
GET    /runs/:runId/events
POST   /runs/:runId/cancel
POST   /runs/:runId/retry

POST   /projects/:projectId/restore
GET    /projects/:projectId/preview
```

#### 幂等与恢复

- 创建 Run 必须携带 `idempotencyKey`。
- 相同请求返回已有 Run，不重复插入消息或执行 Agent。
- SSE 重连使用 `Last-Event-ID`，从下一条 sequence 开始回放。
- 同一项目写请求进入串行队列。

#### 验收

- 浏览器刷新后能恢复正在执行的 Run。
- SSE 断开重连不会丢失工具事件。
- 重复点击发送不会启动两个 Agent。
- 同一项目后续请求按顺序执行。
- Cancel 能中止模型请求和后续工具调用。

### M7：核心 Builder UI

#### 页面

```text
/projects
/projects/:projectId
/projects/:projectId/chat/:chatId
```

#### Builder 布局

```text
┌────────────────┬──────────────────────────────────┐
│ 项目、文件与 Chat│ Preview / Code / Diff / Logs    │
│                │                                  │
│ Agent Activity │                                  │
│                │                                  │
│ Prompt Input   │                                  │
└────────────────┴──────────────────────────────────┘
```

#### 必要交互

- 创建项目和示例 Prompt。
- 流式消息和工具活动卡片。
- 当前真实阶段、取消和重试。
- Preview 刷新和新窗口打开。
- 文件树和 Monaco 编辑器。
- Git Diff 和运行日志。
- 版本历史和回滚确认。
- 错误的明确下一步操作。

#### 验收

- 新用户不阅读说明也能生成第一个应用。
- 所有长任务都有真实可见状态。
- 页面刷新不会丢失项目、消息和 Run 状态。
- 切换 Preview、Code、Diff、Logs 不会中断 Agent。
- 失败时用户能判断应该重试、修改需求还是查看日志。

### M8：版本与失败恢复

Agent 修改采用临时工作树或等价隔离：

```text
base_commit
→ 创建隔离工作区
→ Agent 修改
→ 执行验证
→ 成功：commit 并更新 current_commit
→ 失败：保留失败 Diff，但不更新 current_commit
```

#### 必须覆盖的故障场景

- Worker 在模型调用中退出。
- Worker 在文件写入后退出。
- Worker 在 commit 前或后退出。
- Sandbox 启动失败。
- SSE 断开。
- 用户刷新和取消。
- 项目锁超时。
- 数据库成功但事件推送失败。
- commit 成功但数据库更新失败。

#### 验收

- Worker 重启后能识别未完成 Run。
- 成功 commit 不会因推送失败而丢失。
- 失败 Run 不覆盖当前稳定版本。
- 过期项目锁可以安全回收。
- 所有恢复动作具备幂等性。

### M9：安全加固

#### 必做项

- Workspace 路径防穿越和符号链接防逃逸。
- Sandbox 非 root 运行。
- 主站与 Preview 分域。
- Preview Token 短期有效。
- 禁止 Sandbox 访问控制面内网。
- npm 生命周期脚本策略。
- 命令白名单。
- Secret 加密和按需注入。
- 日志脱敏。
- 请求体、附件和文件大小限制。
- 用户、项目和工具级授权检查。
- 所有写操作审计。
- HTML、Markdown 和日志输出防 XSS。

#### 安全测试

至少覆盖：

- `../../etc/passwd`。
- 绝对路径写入。
- 符号链接逃逸。
- 读取其他项目。
- Preview 读取主站 Cookie。
- Sandbox 访问控制面数据库和 Redis。
- 日志输出密钥。
- 超大文件和无限子进程。
- 恶意 npm lifecycle script。

### M10：测试与可观测性

#### 单元测试

- 路径安全。
- Event reducer。
- Agent 与 Sandbox 状态机。
- 工具 Schema。
- Git 操作。
- Repo Map。
- SSE replay。
- Run 幂等。

#### Contract 测试

- Web 与 API。
- API 与 Worker。
- Worker 与 Workspace。
- Worker 与 Sandbox。
- Preview Gateway 与 Sandbox。

#### 集成测试

- 创建项目到初始 commit。
- Agent 修改文件到 commit。
- Sandbox 启动到 Preview Ready。
- Restore 到新 commit。
- Agent 失败恢复和取消。

#### 端到端测试

真实浏览器至少验证：

1. 登录并创建项目。
2. 输入“创建一个任务管理应用”。
3. 等待 Agent 完成。
4. Preview 可操作。
5. 输入“增加深色模式”。
6. Preview 发生变化。
7. 查看文件和 Diff。
8. 刷新页面后状态保持。
9. 查看版本历史。
10. 恢复到第一版并生成新的 restore commit。

#### 指标

- Project creation success rate。
- Agent run success rate。
- Time to first token。
- Time to first tool call。
- Time to preview ready。
- Tool failure rate。
- Build failure rate。
- Agent repair success rate。
- Sandbox provision latency 和 crash rate。
- SSE reconnect rate。
- Token usage per successful run。
- User cancellation rate。

所有日志统一携带：

```text
user_id
project_id
chat_id
run_id
tool_call_id
sandbox_id
request_id
```

## 10. 推荐推进顺序

```text
M0  架构与工程骨架
→ M1 共享协议与状态模型
→ M2 Workspace + Git
→ M3 Sandbox + Preview
→ M4 Agent Tools
→ M5 上下文工程
→ M6 Chat + Queue + SSE
→ M7 Builder UI
→ M8 Version + Recovery
→ M9 Security
→ M10 E2E + Observability
```

M2 和 M3 可以在 M1 完成后并行，但在 Workspace、Sandbox、Agent Run 三条主链通过集成测试前，不进入大规模 UI 开发。

## 11. 首要技术决策

进入 M0 时优先完成以下决策，不允许在业务代码中隐式选择：

1. Web 使用 Next.js 还是独立 Vite SPA。
2. API 使用 Fastify、Hono 还是 NestJS。
3. 首个 Sandbox Provider 及其隔离、安全、日志、Preview 和快照能力。
4. Workspace 的持久卷、Git 仓库和对象存储方案。
5. Redis 队列实现和项目写锁算法。
6. Preview 域名、路由和短期授权方式。
7. 第一阶段默认模型和 Provider 适配方式。
8. 失败修改采用 Git worktree、临时 branch 还是 Sandbox snapshot。

每项决策都要说明：解决什么问题、为什么选择、对用户的影响、替代方案以及未来替换成本。
