# 第二阶段开发计划：全栈交付与生产发布

- 文档状态：planned
- 更新时间：2026-08-26
- 前置阶段：[第一阶段开发计划](phase-1-development-plan.md)

## 0. Demo 落地声明与执行状态（2026-08-26）

第二阶段面向长期产品演进。笔试交付运行形态见 [ADR 0005](adr/0005-demo-runtime-topology.md) 与 [ADR 0006](adr/0006-generated-app-data-and-publish.md)。

### 0.1 已交付（第一阶段效果 + Demo 薄切片）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Builder 内核主链 | ✅ | 项目创建（模板+Git 初始版本）→ Chat 驱动 Agent（结构化工具）→ 持久事件流/SSE → 每轮自动 commit → 版本列表与非破坏性回滚 |
| 对抗式审查与加固 | ✅ | 事件序列原子化、状态迁移事务化、写锁 stale 修正、模型超时、对话历史入上下文、环境白名单、进程组回收 |
| 自有子域发布 | ✅ | 受控构建 → 不可变 release 目录 → 激活指针 → `/published/<id>/` 公网访问 + 秒级回退 |
| 账号与会话隔离 | ✅ | 注册/登录/登出（scrypt + 会话 Cookie）、全资源按用户隔离、变更操作客户端头防护、`/published` 与 `/p/` 公开 |
| 预览网关 | ✅ | 本地直连 dev server（跨源）；生产走 `ATOMS_PREVIEW_PUBLIC_ORIGIN` + 公开 `/p/<id>/*` 路由（HTML 注入 base） |
| 前端体验 | ✅ | 移植 Dyad 前端栈（Tailwind v4 token 全套 + shadcn 组件 + 双状态主页/分栏 + 面板与侧栏展开收起），Manus 暖纸主题 |

### 0.2 剩余里程碑（按优先级）

1. **M-B1 全栈生成（Supabase lite）**：模板集成 supabase-js（anon key + RLS 直连）；Agent 增加建表/迁移、RLS 策略受控工具（服务端 service_role）。验收：一句话生成带数据库 CRUD 的应用，刷新数据仍在。**前置：平台 Supabase 项目三项凭据（URL / anon key / service_role key）。**
2. **M-B0 交付物**：笔试说明文档（思路/取舍/完成度/扩展优先级，引用本计划）；Dockerfile、docker-compose.yml、Caddyfile（主站 + `/api` + `/p` 预览源 + `/published`）、环境变量清单。
3. **M-部署验收**：腾讯云香港轻量 2C2G 上线、域名泛解析、DeepSeek 真模型接入（`ATOMS_MODEL_*` 三项）、演示前冒烟（含 Supabase 免费档休眠激活）。
4. **M-运行加固（部署前完成）**：预览沙箱空闲回收（2C2G 内存约束）；预览失败自动重试一次；（可选）`run_typecheck/run_build` 工具与浏览器 E2E 冒烟。

### 0.3 明确不在笔试 Demo 实现

GitHub 同步（P2-M3）、Vercel 发布（P2-M5 候选）、配额与滥用防护（P2-M8）、自定义域名/TLS（P2-M6）、完整制品库与 Staging 流量切换（P2-M4/M5）、Beta 门禁（P2-M9）。Demo 轨道实现不标记对应里程碑完成。

## 1. 阶段定位

第一阶段解决“Agent 能否安全、持续地生成和修改一个可预览的前端应用”。第二阶段只解决下一个核心问题：

> 用户能否把生成结果变成一个有后端、有数据、可连接 GitHub、可发布并可长期运行的真实应用。

第二阶段不是扩展功能清单，而是把产品闭环从 Preview 延伸到 Production：

```text
创建或导入项目
→ Agent 修改前端、API 和数据库 Schema
→ 在隔离 Preview 环境验证
→ 配置环境变量与密钥
→ 同步 GitHub
→ 构建不可变 Release
→ 发布到正式域名
→ 查看健康状态与日志
→ 继续修改、重新发布或回滚
```

本阶段完成后，Atoms 应能支撑受控公开 Beta；它仍不是任意技术栈的通用云平台。

## 2. 进入条件

第二阶段可以提前完成 ADR 和 Contract 设计，但不得在第一阶段关键边界未闭合时大规模实现。正式进入开发前必须满足：

- 第一阶段 M0-M10 的成功标准全部通过。
- 创建项目、Agent 修改、Preview、Git commit 和 restore 的端到端主链稳定。
- 真实远程 Sandbox、持久队列、事件重放和项目写锁已投入使用。
- 路径逃逸、Preview 分域、日志脱敏和跨项目访问的安全测试通过。
- 生产环境已有数据库迁移、备份、告警和基础事故处理流程。
- 关键指标已建立第一阶段基线，包括 Run 成功率、Preview Ready 延迟和 Sandbox 故障率。

若上述条件未满足，优先完成第一阶段，不以第二阶段功能掩盖内核缺陷。

Demo 执行轨道例外：允许在 Demo 运行形态（部署机受控子进程 Sandbox、SQLite、进程内队列，见 [ADR 0005](adr/0005-demo-runtime-topology.md)）上并行实现第 0 节列出的薄切片用于产品验证。该例外不改变本节进入条件对完整第二阶段开发的约束，也不将 Demo 轨道实现计入里程碑完成状态。

## 3. 阶段成功标准

### 3.1 产品闭环

- 用户可从一个官方全栈模板创建项目，或从满足约束的 GitHub 仓库导入项目。
- Agent 可在同一轮 Run 中安全修改前端、API、依赖和数据库迁移。
- Preview 与 Production 使用隔离的运行配置、密钥和数据库。
- 用户可将任意稳定 commit 构建为不可变 Release，并先验证后发布。
- 每次 Production 发布都可追溯到唯一 commit、构建产物和部署记录。
- 用户可在 GitHub 与 Atoms 之间进行显式、可审计的代码同步，冲突不会被静默覆盖。
- 用户可查看构建日志、运行日志、健康状态和当前线上版本。
- 用户可在不重写 Git 历史的情况下回滚应用代码。
- 发布失败不会影响当前线上稳定版本。

### 3.2 质量门槛

- 官方模板在参考环境中的首次部署成功率达到 95% 以上。
- 已构建 Release 的流量切换或代码回滚在 2 分钟内完成。
- Control Plane 不执行用户构建脚本或生产应用代码。
- Production Runtime 无法访问控制面数据库、队列、内部服务或其他项目网络。
- 密钥不会出现在模型上下文、Git、构建产物、前端 Bundle、事件 Payload 或日志明文中。
- 重复发布、GitHub Webhook 重投和数据库任务重试不会产生重复副作用。
- Runtime、数据库、构建分钟数和模型用量均可按用户与项目计量和限额。
- 核心交付闭环具备真实浏览器端到端测试和故障恢复测试。

95% 是进入公开 Beta 的最低门槛，不是长期 SLO。统计口径必须排除用户代码自身无法通过确定性校验的情况，并在指标文档中固定。

## 4. 设计原则

### 4.1 一次只支持一条经过验证的全栈路径

第二阶段只新增一个官方全栈模板和一个受支持的生产运行拓扑。框架、Node.js 版本、包管理器、构建命令、端口和健康检查均由模板 Contract 明确定义，不开放任意 Dockerfile 或任意启动命令。

这会限制技术栈选择，但能让生成、Preview、发布和故障恢复真正可预测。

### 4.2 Git、Release 和运行数据各自有唯一事实来源

- Git commit 是代码版本事实来源。
- Release Manifest 是构建产物与部署配置事实来源。
- 托管 PostgreSQL 是用户应用运行数据事实来源。
- Control Plane 数据库只保存资源索引、状态、审计和计量，不复制用户业务数据。

代码回滚不得自动回滚数据库。数据库迁移必须采用向前兼容策略，破坏性变更需要显式确认和备份门槛。

### 4.3 Preview、Production 与控制面彻底分离

- Preview 可短期存在，可随 Sandbox 回收。
- Production Runtime 使用不可变 Release，不挂载可写 Workspace，也不运行 Agent。
- Preview 数据库和 Production 数据库使用独立凭据与网络边界。
- 正式应用、Preview 和 Builder 使用不同 Origin。

### 4.4 发布是可恢复状态机，不是一个 Shell 命令

构建、制品保存、迁移检查、部署、健康检查、流量切换和回滚都必须有持久状态、幂等键、超时、审计和恢复规则。

### 4.5 外部集成不得改变现有安全边界

GitHub、数据库和部署 Provider 均通过显式 Adapter 接入。业务层依赖 Contract，不直接依赖厂商 SDK；Provider Token 只由对应服务读取。

### 4.6 数据库采用托管基础设施，自建控制层

第二阶段首个 App Database Provider 选择 Supabase。Atoms 不自行搭建 PostgreSQL 集群，也不把 Supabase 的资源模型直接暴露给用户，而是自己实现数据库控制层：

- Supabase 负责 PostgreSQL 进程、存储、计算、基础备份能力和底层可用性。
- Atoms 负责资源编排、环境隔离、凭据、Migration、配额、审计、对账和用户体验。
- 业务层只依赖 `AppDatabaseProvider`；Supabase Management API、SDK、Token、错误码和内部资源 ID 只能存在于 Supabase Adapter 内。
- Supabase Auth、Storage、Realtime 和 Edge Functions 不进入第二阶段范围；本阶段只使用托管 PostgreSQL、项目管理和数据库分支能力。

Beta 阶段采用以下默认映射：

```text
Atoms Project
  → Supabase Project
      ├── production       → Production Database
      └── preview branch   → Ephemeral Preview Database
```

Preview 默认只继承 Schema，不复制 Production 业务数据。不同环境使用独立数据库角色和凭据；删除 Preview 时同步回收对应分支、角色和 Secret 引用。环境收敛为 preview 与 production 两类：Web 产品中用户代码只在 Preview 与 Production 运行时执行，Workspace 不是运行环境，独立的 development 数据库语义不成立。

Atoms 使用 Supabase Management API 管理 Project 和 Branch，使用标准 PostgreSQL 连接执行 Migration 和业务查询，不依赖供应商专属的数据库 Migration 接口。浏览器不得获得数据库密码或 `service_role` Key，仍然只能通过生成应用的服务端 API 访问数据。

选择 Supabase 的原因是它同时提供标准 PostgreSQL、API 化项目管理和隔离的 Preview Branch，能够覆盖第二阶段的数据库生命周期；未来若需要 Auth、Storage 或 Realtime，也有清晰的扩展路径。代价是第二阶段依赖单一供应商，因此 Provider Contract、标准 SQL Migration、数据导出和恢复演练必须在接入时完成，不能把供应商锁定留给未来处理。

P2-M0 的 Supabase 技术验证必须额外覆盖：Supabase for Platforms 白标计划的商业条款与配额、Management API 限流与重试策略、部署环境（香港轻量服务器）到 Supabase 的网络可达性与延迟基线。若链路实测不达标，Demo lite 按 ADR 0006 退化为每应用 SQLite，`AppDatabaseProvider` 契约不变。

### 4.7 Demo 阶段的发布形态：自有子域静态托管

完整发布链（隔离 Build Provider、Artifact Registry、Staging/Production Slot、流量切换）在 Demo 阶段不实现。Demo 发布形态为：

```text
稳定 commit
→ 部署机内受控 vite build
→ 静态制品写入 /data/published/<projectId>/<releaseId>/（只增不改）
→ 更新数据库"当前激活 release"指针（原子切换）
→ Caddy 泛子域 + on-demand TLS 对外服务
→ 回退 = 指针指回历史 release（秒级生效）
```

发布产物为纯静态包：应用数据经 Supabase anon key + RLS 直连，不依赖平台运行时常驻进程。Vercel（用户 PAT、GitHub gitSource 模式）保留为 P2-M5 的候选 Runtime Provider。详见 [ADR 0006](adr/0006-generated-app-data-and-publish.md)。

## 5. 范围

### 5.1 必须实现

- 一个官方 TypeScript 全栈模板，包含 React 前端、受控 Node.js API 和 PostgreSQL 迁移。
- 全栈项目 Manifest、运行时 Schema 和模板升级策略。
- Preview API 与 Preview Database 生命周期管理。
- Supabase App Database Provider，支持项目与分支创建、迁移、备份、恢复和删除。
- Preview、Production 两类环境配置。
- 加密 Secret 存储、最小范围注入、轮换和审计。
- GitHub App 安装、仓库导入、推送和拉取。
- 同步前的分支、锁、基线和冲突检查。
- 一个 Production Build Provider 和一个 Runtime Provider。
- 不可变构建产物、Release Manifest、制品保留和来源追踪。
- Staging 验证、Production 发布、健康检查、流量切换和代码回滚。
- 平台子域名和一个自定义域名的绑定、验证与证书状态。
- 构建日志、部署日志、运行日志和最小健康指标。
- 资源计量、项目配额、滥用防护和成本上限。
- 用户可理解的发布、同步、冲突、失败和恢复界面。
- 单元、Contract、集成、端到端、安全和故障注入测试。

### 5.2 明确不实现

- 多人实时协作、组织空间和复杂 RBAC。
- 付费订阅、发票、优惠券和复杂套餐；本阶段只做计量与硬限额。
- 多 Agent、子 Agent、MCP、插件市场和第三方 Tool 市场。
- 任意 Dockerfile、任意语言、任意框架或常驻后台 Worker。
- Kubernetes 等底层基础设施对用户暴露。
- 多云、多区域主动容灾和全球边缘计算。
- 多数据库引擎或用户自带数据库的完整兼容矩阵。
- 自建 PostgreSQL 集群、其他数据库 Provider 和企业 BYOC；后续通过 `AppDatabaseProvider` 单独接入。
- 平台托管的生成应用终端用户认证；应用可通过服务端 API 自行接入外部认证服务。
- GitHub 之外的 Git Provider。
- 可视化点选编辑和设计稿转代码。
- 自动生成完整端到端测试。
- 自动执行破坏性数据库迁移或自动回滚生产数据。
- 应用市场、模板市场和社区发布。

这些能力应在公开 Beta 数据证明其价值后分别规划，不作为第二阶段延期的理由。

## 6. 目标架构增量

第二阶段在现有三个平面上增加发布和托管运行能力，不改变第一阶段边界：

```text
Web Client
  ├── Builder / Code / Preview
  ├── Git Sync
  ├── Environments / Secrets
  └── Releases / Domains / Logs

Control Plane
  ├── Project / Run / Version Metadata
  ├── Environment / Secret References
  ├── Git Installation / Sync State
  ├── Build / Release / Deployment State
  ├── Usage / Quota / Audit
  └── Durable Events / Job Queue

Workspace Plane
  ├── Project Files and Git
  ├── Remote Tracking Refs
  ├── Import / Fetch / Push
  └── Release Source Snapshot

Execution Plane
  ├── Preview Sandbox
  ├── Isolated Build Sandbox
  ├── Artifact Registry
  ├── Production Runtime
  ├── App Database Provider / Supabase Adapter
  └── App / Domain Gateway
```

### 6.1 构建与发布主链

```text
stable commit
→ 创建 Build
→ 在全新 Build Sandbox 检出精确 commit
→ 注入允许用于构建的非敏感配置
→ 安装锁定依赖并运行校验
→ 生成不可变 Artifact + Manifest
→ 创建 Release
→ 部署到 Staging Slot
→ 执行健康检查和固定 Smoke Test
→ 原子切换 Production 流量
→ 保留上一稳定 Release 供回滚
```

构建过程不复用用户的 Preview Sandbox，避免残留文件、缓存或临时密钥影响可复现性。

### 6.2 全栈应用运行边界

官方模板至少划分：

```text
Browser
  → App Gateway
      ├── Static Web Artifact
      └── App API Runtime
              → Project-scoped PostgreSQL
```

浏览器不得获得数据库连接串或服务端 Secret。所有需要密钥的第三方调用必须经过 App API Runtime。

### 6.3 数据库迁移边界

```text
Agent 生成 migration
→ Preview Database 应用并验证
→ Release 记录 migration digest
→ Production 发布前执行兼容性检查
→ 备份或恢复点就绪
→ 迁移任务使用项目级锁执行一次
→ 成功后继续流量切换
```

删除表、删除列、不可逆类型转换等破坏性操作默认阻止自动发布，并要求用户明确处理方案。代码回滚只切换 Release，不自动逆向执行 migration。

## 7. 需要先固化的 ADR

P2-M0 必须完成以下决策；在 ADR accepted 前，业务代码只能依赖占位 Contract：

1. 官方全栈模板的目录、运行时、健康检查和兼容版本策略。
2. Build Artifact 格式、Registry、来源证明和保留策略。
3. Production Runtime Provider 及 CPU、内存、网络、伸缩和隔离模型。
4. Supabase 的项目/分支映射、租户隔离、区域、连接、备份、恢复、删除和成本策略。
5. Secret 加密、密钥管理、环境隔离和注入边界。
6. GitHub App 权限、导入、推送、拉取和冲突策略。
7. Release、Deployment、流量切换和代码回滚模型。
8. 数据库迁移兼容性规则及“代码可回滚、数据不自动回滚”的产品表达。
9. 平台域名、自定义域名、TLS 和应用网关路由。
10. 用量计量、Beta 配额和超限行为。

每项 ADR 必须说明用户影响、最简单替代方案、退出成本和故障恢复方式。

## 8. 核心数据模型增量

以下字段为领域草案，最终以运行时 Schema 和数据库迁移为准。

### project_templates

```text
id
version
runtime_contract_version
source_commit
status
created_at
```

### environments

```text
id
project_id
kind                 # preview | production
status
current_release_id
created_at
updated_at
```

### environment_variables

```text
id
environment_id
key
value_ciphertext     # secret 时加密保存
is_secret
scope                # build | runtime
version
created_at
updated_at
```

API 和事件不得返回 Secret 明文，只返回 key、scope、版本和更新时间。

### git_installations

```text
id
user_id
provider
provider_installation_id
status
created_at
updated_at
```

### project_remotes

```text
id
project_id
git_installation_id
repository_external_id
repository_full_name
default_branch
last_synced_commit
last_synced_at
status
```

### builds

```text
id
project_id
environment_id
source_commit
status
idempotency_key
artifact_digest
manifest_json
error_code
started_at
completed_at
created_at
```

### releases

```text
id
project_id
build_id
source_commit
artifact_digest
migration_digest
status
created_at
```

### deployments

```text
id
project_id
environment_id
release_id
previous_release_id
status
idempotency_key
provider_deployment_id
health_status
started_at
completed_at
created_at
```

### app_databases

```text
id
project_id
environment_id
provider
provider_database_id
status
schema_version
last_backup_at
created_at
updated_at
```

### database_migrations

```text
id
app_database_id
release_id
name
checksum
status
started_at
completed_at
created_at
```

### domains

```text
id
project_id
environment_id
hostname
kind                 # platform | custom
verification_status
tls_status
created_at
updated_at
```

### usage_records

```text
id
user_id
project_id
resource_type
quantity
unit
source_id
idempotency_key
recorded_at
```

## 9. 共享协议增量

### 9.1 持久事件

第二阶段事件继续复用第一阶段的 `runId/sequence/timestamp` 设计原则。非 Agent 长任务使用对应资源 ID 和单调递增 sequence：

```text
git.import.started
git.import.completed
git.sync.conflict
git.push.completed

database.provisioning
database.ready
database.migration.started
database.migration.completed
database.migration.blocked

build.started
build.log
build.completed
build.failed

deployment.started
deployment.health_check
deployment.ready
deployment.failed
deployment.rolled_back

domain.verification.updated
quota.warning
quota.exceeded
```

日志事件只携带脱敏后的有界片段；完整日志存入有保留期限的日志存储。

### 9.2 Provider Contract

至少建立以下边界：

```ts
interface BuildProvider {
  build(input: CreateBuildInput): Promise<BuildHandle>;
  getBuild(input: GetBuildInput): Promise<BuildInfo>;
  streamLogs(input: StreamBuildLogsInput): AsyncIterable<BuildLog>;
  cancel(input: CancelBuildInput): Promise<void>;
}

interface RuntimeProvider {
  deploy(input: DeployReleaseInput): Promise<DeploymentHandle>;
  getDeployment(input: GetDeploymentInput): Promise<DeploymentInfo>;
  switchTraffic(input: SwitchTrafficInput): Promise<void>;
  stop(input: StopDeploymentInput): Promise<void>;
}

interface AppDatabaseProvider {
  create(input: CreateDatabaseInput): Promise<AppDatabaseInfo>;
  createBackup(input: CreateBackupInput): Promise<BackupInfo>;
  applyMigrations(input: ApplyMigrationsInput): Promise<MigrationResult>;
  restore(input: RestoreBackupInput): Promise<AppDatabaseInfo>;
  destroy(input: DestroyDatabaseInput): Promise<void>;
}

interface GitRemoteProvider {
  importRepository(input: ImportRepositoryInput): Promise<ImportResult>;
  fetch(input: FetchRemoteInput): Promise<FetchResult>;
  push(input: PushRemoteInput): Promise<PushResult>;
  getCompare(input: CompareRemoteInput): Promise<RemoteCompare>;
}
```

具体 Provider 的 Token、内部 ID 和错误格式不得泄漏到上层领域模型。

### 9.3 状态机

Build：

```text
queued → preparing → installing → validating → packaging → succeeded
   └────────────── 任意执行态 ──────────────→ failed | cancelled
```

Deployment：

```text
queued → provisioning → migrating → deploying → checking → ready
   └────────────── 任意执行态 ──────────────→ failed | cancelled
ready → superseded | rolling_back → rolled_back
```

所有状态转换必须由共享 reducer 校验；数据库记录不能被任意更新为终态。

## 10. 里程碑

### P2-M0：阶段门禁、基线与 ADR

#### 工作内容

- 对第一阶段成功标准执行完整验收并记录基线。
- 固化第 7 节的 ADR。
- 建立 Build、Release、Deployment、Environment、Git Remote 和 App Database Contract。
- 建立状态机、Fake Provider 和协议测试。
- 定义官方全栈模板 Contract 和支持矩阵。
- 完成 Supabase 技术验证：资源创建与删除、Data-less Preview Branch、独立凭据、连接池、备份恢复、Management API 限流和失败重试。
- 验证 Supabase 的平台接入权限、目标区域、数据驻留、商业条款、项目配额和成本模型满足 Beta 要求。
- 为第二阶段指标建立 Dashboard 与告警占位。

#### 验收

- 第一阶段未完成项有明确负责人和阻断状态，不被误标为 P2 工作。
- 所有外部 Provider 均可由 Fake 实现驱动完整状态机测试。
- 相同幂等键不会创建重复 Build、Deployment、Migration 或 Git Push。
- Supabase 验证结果形成 accepted ADR；若任何硬门槛不满足，先更新计划和 ADR，不在业务代码中临时绕过。
- ADR、Contract、数据模型和用户流程没有互相冲突。

### P2-M1：官方全栈模板与本地闭环

#### 工作内容

- 建立唯一官方全栈模板和版本化 Manifest。
- 增加受控 App API Runtime、健康检查和固定启动协议。
- 增加数据库 Schema 与 migration 目录约定。
- 扩展 Repo Map，使 Agent 理解前端、API、数据库和环境变量边界。
- 增加受控工具：创建 migration、运行 migration 检查、执行 API 测试。
- 在 Fake Database 下完成全栈 Agent 修改闭环。

#### 验收

- 用户可以生成一个包含持久数据读写的应用。
- 浏览器代码无法读取服务端 Secret 或数据库连接串。
- Agent 不通过任意 Shell 启动 API 或执行 migration。
- 模板 Manifest 不兼容时会明确拒绝，而不是尝试猜测启动方式。
- 每次模板升级有迁移说明和旧版本兼容测试。
- 在选定模型（DeepSeek）上建立"生成含数据库读写应用"的成功率基线，并记录失败模式分类。

### P2-M2：Preview Database、环境与 Secret

#### 工作内容

- 实现 Supabase Adapter，并保持 Supabase SDK、Management API 与错误类型不越过 `AppDatabaseProvider` 边界。
- 为 Atoms Project 创建 Supabase Project，为 Preview 和 Production 管理独立环境、分支与凭据。
- Preview 默认使用 Data-less Branch 和测试 Seed，不复制 Production 业务数据。
- Migration 通过项目专属 PostgreSQL 连接执行，不把 Supabase 专属 Migration API 写入领域 Contract。
- 建立 Preview 与 Production 数据库的独立生命周期。
- 实现 Preview、Production 环境配置。
- 使用平台密钥管理系统加密 Secret，建立版本和审计。
- 按 build/runtime scope 注入变量；禁止默认注入全部变量。
- 实现日志、错误、事件和模型上下文的 Secret 脱敏检测。
- 增加数据库备份、恢复和安全删除任务。

#### 验收

- Preview 中可以创建、迁移和访问项目专属数据库。
- Control Plane 中只保存 Supabase 资源索引和加密凭据，不复制用户应用数据。
- Preview 凭据无法连接 Production 数据库，反向亦然。
- 浏览器 Bundle、日志和 Agent 上下文中不包含数据库密码或 Supabase `service_role` Key。
- 创建、回收和重试 Preview 不会泄漏 Supabase Branch、凭据或计算资源。
- 删除项目会进入可审计的资源清理流程，失败可重试。
- 修改 Secret 后不会把明文返回浏览器，运行环境可使用新版本。
- 在前端 Bundle、Git、Artifact、日志和 Agent 上下文中扫描不到测试 Secret。

### P2-M3：GitHub 导入与双向同步

#### 工作内容

- 接入 GitHub App，使用最小仓库权限。
- 支持导入符合模板 Contract 的仓库。
- 为 Atoms 创建或绑定远端仓库。
- 支持 fetch/compare/push，记录 remote tracking baseline。
- Webhook 只触发同步检查，不直接覆盖 Workspace。
- 定义脏工作区、活动 Run、分叉历史和冲突处理。
- 所有 Git 同步经过 Workspace Plane、项目写锁和审计。

#### 同步规则

```text
远端未变化 + 本地领先 → 允许 push
本地未变化 + 远端领先 → 允许显式 pull
两端均变化           → 进入 conflict，不自动 merge
存在写入型 Agent Run  → 排队或拒绝同步
存在未提交修改        → 拒绝同步并说明处理方式
```

#### 验收

- 用户能导入一个受支持仓库并保留完整提交历史。
- 相同 Webhook 重投不会重复导入、提交或推送。
- 分叉历史不会静默覆盖任何一端。
- 撤销 GitHub App 权限后，系统进入可理解的重新授权状态。
- Provider Token 不进入 Workspace、Worker 日志或浏览器。

### P2-M4：可复现构建与 Artifact

#### 工作内容

- 接入隔离 Build Provider。
- 每次从精确 commit 和锁文件开始全新构建。
- 运行类型检查、测试、前端 Bundle Secret 扫描和固定 Smoke Test。
- 生成不可变 Artifact、内容 digest 和 Release Manifest。
- 记录模板版本、Node.js 版本、依赖锁摘要和构建配置摘要。
- 建立 Artifact 保留、引用计数和清理任务。

#### 验收

- 相同 commit 与相同构建输入得到等价 Manifest 和可验证 digest。
- Preview 中的未提交文件不会进入 Production Artifact。
- 构建失败保留脱敏日志，不创建可部署 Release。
- 重试相同构建不会产生多个逻辑 Release。
- Artifact 无法被构建后原地修改。

### P2-M5：Staging、Production 与安全发布

#### 工作内容

- 接入首个 Runtime Provider。
- 建立 Staging Slot 和 Production Slot。
- 实现资源限制、网络出口策略、健康检查和应用网关。
- 在发布前执行 migration 兼容性检查、备份门槛和项目级迁移锁。
- 实现部署、固定 Smoke Test、流量切换和失败清理。
- 保留当前与上一稳定 Release。
- 实现代码回滚，并明确数据库不自动回滚。

#### 验收

- 发布失败时线上流量继续指向上一稳定 Release。
- 相同 Deployment 重试不会重复执行已完成 migration。
- 健康检查失败的 Release 不会接收 Production 流量。
- 回滚可在 2 分钟内恢复上一代码 Release。
- Runtime 不能访问控制面或其他项目网络与数据。
- Runtime 重启后应用仍可恢复到目标 Release。

### P2-M6：域名、日志与运行可观测性

#### 工作内容

- 为每个 Production Environment 分配平台子域名。
- 支持一个自定义域名的所有权验证、TLS 和状态更新。
- 提供构建、部署和运行日志的查询与流式查看。
- 提供当前 Release、健康状态、重启次数和请求错误摘要。
- 为日志建立脱敏、大小限制、速率限制和保留期限。
- 记录 Provider 故障与用户代码故障的不同错误码。

#### 验收

- 用户无需理解底层 Provider 即可判断应用是否在线。
- DNS 或证书配置错误会给出具体记录值和下一步操作。
- 日志不能跨项目读取，不能通过日志注入执行脚本。
- 超量日志不会拖垮控制面或形成无限成本。
- 平台域名与 Builder、Preview 使用不同 Origin。

### P2-M7：交付体验

#### 页面与入口

```text
/projects/new
/projects/import
/projects/:projectId/settings/environments
/projects/:projectId/settings/git
/projects/:projectId/releases
/projects/:projectId/deployments/:deploymentId
/projects/:projectId/settings/domains
```

#### 必要交互

- 新建全栈应用与 GitHub 导入二选一。
- 环境变量和 Secret 的分环境编辑。
- Preview Database 状态和 migration 风险提示。
- Git ahead/behind/diverged 状态与显式同步操作。
- 发布前检查、实时阶段、取消、重试和失败建议。
- 当前线上版本、来源 commit、发布时间和回滚入口。
- 域名验证和证书状态。
- 配额用量、临界提醒和超限后的明确操作。

#### 验收

- 新用户可在不阅读运维文档的情况下完成首次发布。
- UI 不把 Build 成功误报为 Deployment 成功。
- 数据库破坏性变更、Production 发布和代码回滚均有准确影响说明。
- 刷新或断网后，发布和同步状态可从持久事件恢复。
- 所有失败状态至少提供一种可执行下一步。

### P2-M8：配额、审计与滥用防护

#### 工作内容

- 计量 Build 分钟、Runtime 资源、数据库存储、日志、网络和模型用量。
- 建立用户级与项目级硬限额、并发限制和速率限制。
- 接近限额时提前提醒；超过限额时保护稳定 Production 流量。
- 建立资源创建、Secret 修改、Git 同步、发布、回滚和删除审计。
- 增加恶意依赖、挖矿、端口扫描、出站攻击和资源耗尽检测。
- 建立孤儿 Runtime、Database、Artifact 和 Domain 的对账与回收任务。

#### 验收

- 每条用量记录可追溯到唯一资源操作且可幂等重算。
- 超限不会产生无限重试或继续扩大成本。
- 限制新构建时不应直接下线已稳定运行的应用。
- 关键变更可按用户、项目、资源和时间查询。
- Provider 资源与控制面索引不一致时能告警并安全对账。

### P2-M9：安全、恢复与公开 Beta 门禁

#### 必做测试

- 构建脚本读取控制面环境变量。
- 浏览器 Bundle 包含 Server Secret。
- Preview 凭据访问 Production Database。
- Preview 分支意外包含 Production 业务数据。
- Supabase Management API 超时、限流、部分成功和资源已存在。
- Runtime 访问控制面、Metadata 服务或其他项目。
- GitHub Webhook 伪造、重放和越权仓库访问。
- 依赖安装执行恶意 lifecycle script。
- Migration 重复执行、执行中 Worker 退出和锁过期。
- Artifact 篡改或 digest 不匹配。
- 日志注入、Secret 泄漏和超大日志洪泛。
- 自定义域名抢占、验证失效和证书异常。
- Provider API 超时、限流、部分成功和状态丢失。
- 发布成功但控制面写回失败。
- 流量切换后新 Release 立即失去健康。

#### Beta 门禁

- 完成威胁模型和外部安全评审。
- 完成数据库备份恢复演练和 Provider 故障演练。
- 完成 Project 删除与用户数据导出验证。
- 为 Build、Deployment、Database 和 Domain 建立值班手册。
- 达到第 3 节质量门槛并连续观察一个稳定窗口。
- 所有严重级别 P0/P1 缺陷关闭，P2 缺陷有明确规避方案。

#### 验收

- 自动化测试能证明跨项目、跨环境和跨平面的隔离。
- 任一 Worker 在关键步骤退出后，任务能恢复或进入明确终态。
- 控制面数据库从备份恢复后能与 Provider 实际资源完成对账。
- 公开 Beta 可以按开关逐用户开放并随时停止新增资源。

## 11. 依赖与推进顺序

推荐顺序：

```text
P2-M0  阶段门禁 + ADR + Contract
  → P2-M1  全栈模板
  → P2-M2  Database + Environment + Secret
      ├→ P2-M3  GitHub Sync
      └→ P2-M4  Reproducible Build
             → P2-M5  Staging + Production
             → P2-M6  Domain + Logs
             → P2-M7  Delivery UX
             → P2-M8  Quota + Audit
             → P2-M9  Security + Beta Gate
```

- P2-M3 可在 P2-M2 Contract 稳定后与 P2-M4 并行。
- P2-M6 的平台域名可与 P2-M5 并行，自定义域名在网关稳定后接入。
- P2-M7 先使用 Fake Provider 验证流程，但不得用伪事件替代真实发布状态。
- P2-M8 的计量埋点应随各资源能力同步加入，里程碑只负责形成完整配额闭环。
- P2-M9 的威胁建模从 P2-M0 开始，不能留到阶段末一次补做。

本计划不直接给出日历工期。排期取决于第一阶段遗留、Supabase 技术与商业验证、团队人数和安全评审周期；这些输入确定后，再把里程碑拆成可独立验收的双周增量。

## 12. 首批垂直切片

实现时优先交付端到端薄切片，避免先分别堆满前端、数据库或 Provider 封装：

1. **全栈 Preview 切片**：官方模板 → Agent 增加一个数据表和 API → Preview Database → 页面完成增删改查。
2. **首次发布切片**：稳定 commit → 全新 Build → Artifact → 平台子域名 → 固定 Smoke Test → Production Ready。
3. **安全配置切片**：添加一个 Server Secret → Preview 使用 → Production 独立配置 → Bundle 与日志泄漏测试。
4. **GitHub 切片**：导入仓库 → Agent 修改 → commit → push → 远端变化 → 显式 pull。
5. **恢复切片**：发布含向前兼容 migration 的新版本 → 健康检查失败 → 流量保持旧版本 → 修复并重发。

每个切片都必须同时包含 Contract、持久状态、权限、审计、UI 反馈和自动化测试。

## 13. 阶段完成定义

第二阶段只有在下面的真实用户旅程完整通过时才算完成：

1. 用户创建一个官方全栈项目。
2. 用户要求 Agent 创建一个带持久数据读写的任务应用。
3. Agent 修改前端、API 和 migration，并在 Preview 中验证。
4. 用户分别配置 Preview 与 Production Secret。
5. 用户把项目连接并推送到 GitHub。
6. 用户从稳定 commit 创建 Release。
7. 系统在全新环境构建、部署、迁移并通过健康检查。
8. 用户通过平台域名操作 Production 应用并查看运行日志。
9. 用户绑定自定义域名。
10. 用户继续修改并发布第二个 Release。
11. 第二个 Release 健康检查失败，线上仍保持第一版。
12. 用户修复后重新发布成功。
13. 用户执行代码回滚，系统保留完整 Git、Release、Deployment 和 migration 历史。
14. 页面刷新、Webhook 重投、Worker 重启和重复操作均不产生丢失或重复副作用。

演示脚本、Fake Provider 或人工修改数据库不能替代上述验收。
