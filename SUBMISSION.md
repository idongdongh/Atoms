# Atoms Demo — 笔试交付说明

> 一个 Web AI 应用生成平台：用自然语言描述想法，Agent 在隔离工作区生成/修改代码，实时预览运行效果，一键发布到公网并支持秒级回退。

- 在线体验：<http://119.28.133.244>（注册任意邮箱即可；演示账号 `demo@atoms.test` / `demo-password`）
- 代码仓库：<https://github.com/idongdongh/Atoms>
- 已验证的生成样例：[待办事项（数据库版）](http://119.28.133.244/published/f8d2b1a1-388c-4499-bcb8-d7006ed577f5/)（一句话生成，数据存 Supabase，刷新后仍在）
- 部署形态与操作手册：[docs/deployment.md](docs/deployment.md)

## 1. 五分钟走查（覆盖笔试要求的完整流程）

1. **注册/登录**：主页注册（scrypt 口令 + HttpOnly 会话 Cookie，7 天），所有资源按账号隔离。
2. **初始化与核心主流程**：主页输入框描述想法（如"做一个番茄钟计时器"）→ 自动创建应用（模板 + Git 初始提交）→ Agent 通过 7 个结构化工具读写文件 → SSE 实时看到工具调用/文件变更事件 → 每轮成功自动 commit 形成版本 → 右侧预览面板直接运行 dev server（可看文件树和代码）。
3. **持续迭代**：继续发消息修改；任意历史版本可非破坏性回滚（restore 生成新提交，不丢历史）。
4. **延展能力一：发布与回退**：点发布 → 受控 `vite build`（固定 `--base`）→ 不可变 release 目录 → 数据库激活指针原子切换 → 获得 `/published/<id>/` 公网 URL；任意历史 release 一键激活即秒级回退。
5. **延展能力二：全栈生成（数据库）**：说"做一个待办事项应用，数据存数据库"→ Agent 调 `db_create_table` 在共享 Supabase 项目里建项目隔离的表（标识符/类型白名单 + 行级安全）→ 生成的前端用预配置 supabase client（anon key）直连读写 → 刷新页面数据仍在。
6. **稳定性（演示时可现场触发）**：预览 dev server 空闲 10 分钟自动回收（2C2G 内存友好），再次打开项目自动唤醒；预览启动失败自动重试一次。

模型默认接 DeepSeek（OpenAI 兼容协议，密钥走环境变量）；无密钥时可退化内置 demo 模型本地跑通全流程。

## 2. 实现思路与关键取舍

### 2.1 架构：三平面映射到单机，保留演进路径

按产品定位拆成 Control Plane（API）/ Workspace Plane（Git 工作区）/ Execution Plane（Agent Worker + Sandbox），契约先行（Zod Schema 双端校验，不只靠 TS 类型）。笔试交付用**单机 Demo 拓扑**（[ADR 0005](docs/adr/0005-demo-runtime-topology.md)）：API + Worker 双进程、SQLite 元数据、本地 Git 裸仓库、受控子进程 Sandbox；每个取舍都对应文档里的企业级演进路径（容器拆分 → 状态外移 → Firecracker/gVisor 沙箱集群）。

### 2.3 关键设计决策

- **Git 是代码事实来源，数据库只存元数据**：项目、消息、运行状态、版本索引、release 指针全部可从工作区 + 事件流重建审计。
- **单写者 + 幂等**：每项目同一时刻最多一个写 Run（claim 事务）；所有写请求带幂等键；预览/构建与 Agent 共用工作区写锁。
- **事件持久化 + 可重放**：Agent 事件按序列号入 SQLite，SSE 断线用 `Last-Event-ID` 续传，长任务不丢进度。
- **安全边界**：Agent 只能用 Schema 校验的结构化工具（无 shell）；预览子进程环境变量白名单（模型密钥绝不进生成代码进程）；发布静态服务做路径穿越/符号链接防护；写操作要求 `x-atoms-client` 头防同源发布页 CSRF。
- **取舍**：Demo 用 SQLite/本地文件而非 Postgres/S3（形态见 ADR 0005，契约不变可平滑替换）；`/p/` 预览路由未做签名鉴权（预览 URL 只在登录后的构建器内出现，发布走独立 `/published/` 静态链路）。

## 3. 完成度

| 模块                              | 状态 | 说明                                                                                                                |
| --------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| 账号/会话/多用户隔离              | ✅   | 注册/登录/登出、全资源按用户过滤、客户端头防护                                                                      |
| 项目创建 + 模板 + Git 版本链      | ✅   | react-vite 模板、初始提交、每轮自动 commit、版本列表与回滚                                                          |
| Agent 主链（结构化工具 + 事件流） | ✅   | 7 工具 Zod 双端校验、SSE 实时事件、失败自动 discard                                                                 |
| 模型接入                          | ✅   | OpenAI 兼容（DeepSeek 已配置就绪）+ 离线 demo 模型；120s 超时                                                       |
| 预览网关 + 生命周期               | ✅   | dev server 子进程、跨源/网关两种模式、启动重试、空闲回收、打开即唤醒（公网 `/p/` 只读，不能触发重启）               |
| 发布与回退                        | ✅   | 受控构建、不可变 release、激活指针、公网 URL、秒级回退                                                              |
| 前端体验                          | ✅   | 双状态流（主页 → 分栏工作台）、面板展开收起、暖纸主题                                                               |
| 部署产物                          | ✅   | Dockerfile（多阶段）+ compose + Caddy（自动 HTTPS、SSE 不缓冲）+ `.env.example` + [部署手册](docs/deployment.md)    |
| 生成应用数据后端（Supabase lite） | ✅   | 已上线并验收：一句话生成带数据库 CRUD 的待办应用（实测 24 秒），数据真实持久化，刷新后仍在                          |
| 在线环境                          | ✅   | 腾讯云香港 2C2G，Docker Compose + Caddy，`http://119.28.133.244`（无域名 IP 直连形态；DeepSeek 真模型全链路已冒烟） |

**质量**：65 个单元/集成测试全绿（`pnpm check` = 格式 + 类型 + 测试 + 构建），核心路径（API 隔离、发布回退、预览生命周期、建表 SQL 注入防护）均有测试覆盖；两轮对抗式审查累计修复 15+ 项并发/安全/部署问题（记录在 Git 历史）。

## 4. 如果继续投入（按优先级）

1. ~~M-B1 全栈生成~~：已完成（`db_create_table` 受控建表 + RLS + 预配置 client，实测 24 秒生成可用数据库应用）。
2. **M-部署验收**：~~上线 + 真模型冒烟~~ 已完成（首次实测：DeepSeek 一句话生成番茄钟约 80 秒、预览自动就绪、发布 1.5 秒）；基线数据待积累。
3. **GitHub 双向同步 / Vercel 发布**（PAT + gitSource 路径已调研）。
4. **规模化前必要项**：配额与滥用防护、预览签名授权、制品库与 Staging 流量切换、Sandbox 容器化。

## 5. 本地运行

```bash
pnpm install
pnpm dev          # API :3000 + Web :5173 + Worker（demo 模型，无需任何密钥）
# 打开 http://localhost:5173
pnpm check        # 格式 + 类型检查 + 全部测试 + 构建
```

生产部署见 [docs/deployment.md](docs/deployment.md)。

## 6. 目录速览

```text
apps/api            Control Plane：HTTP API、预览/发布网关、会话与隔离
apps/agent-worker   Execution Plane：Agent 运行器、结构化工具、预览生命周期对账
apps/web            构建器前端（React SPA + 暖纸主题）
packages/contracts  全部共享契约（Zod Schema，运行时校验）
packages/db         SQLite 元数据存储（node:sqlite, WAL）
packages/workspace-sdk  工作区 Git 操作、写锁、模板实例化
packages/sandbox-sdk    受控子进程 Provider（预览 dev server、受控构建）
templates/react-vite   生成应用的起步模板
docs/               ADR、开发计划、部署手册
```
