# Atoms

Atoms 是一个面向 Web 的 AI 应用生成平台。用户通过自然语言描述需求，Agent 在隔离工作区中读取、生成和修改代码，并将运行结果以实时网页 Preview 的形式展示。

产品体验参考 Dyad，但本项目从一开始按多用户 Web 系统设计，将控制面、项目工作区和用户代码执行环境分离。

## 当前状态

第一阶段 Builder 内核已交付并通过对抗式审查加固：Monorepo 与三平面骨架（Web/API/Worker）、运行时 Contract 与状态机、SQLite 元数据与可重放事件流、本地 Git Workspace、结构化工具 Agent 主链（每轮自动 commit、非破坏性回滚）、预览网关与账号会话隔离均已可用；`pnpm check`（格式/类型/测试/构建）全绿。

第二阶段 Demo 轨道已交付：自有路径发布与秒级回退、Dyad 前端移植（Manus 主题）、预览生命周期加固（空闲回收、失败重试、打开即唤醒），以及 Docker Compose + Caddy 部署产物。剩余：Supabase 全栈生成（M-B1，等凭据）与线上部署验收。笔试评估请先读 [SUBMISSION.md](SUBMISSION.md)，部署见 [docs/deployment.md](docs/deployment.md)。

当前 SQLite、Demo Model 和 Local Development Sandbox 只用于本地开发与 Contract 验证。真实远程隔离 Sandbox、PostgreSQL/持久队列、GitHub 同步和托管数据库接入仍未完成；Demo 部署形态与企业级演进路径见 [ADR 0005](docs/adr/0005-demo-runtime-topology.md) 与 [ADR 0006](docs/adr/0006-generated-app-data-and-publish.md)。

第一阶段目标是完成 Builder 内核：

1. 创建项目与初始化模板。
2. 通过 Chat 驱动 Agent 修改代码。
3. 在远程 Sandbox 中安装依赖并运行项目。
4. 在浏览器中实时预览和查看日志。
5. 自动生成 Git 版本，支持继续修改和安全回滚。

详细范围、里程碑和验收标准见 [第一阶段开发计划](docs/phase-1-development-plan.md)。

第二阶段将在第一阶段验收完成后，把闭环扩展到官方全栈模板、托管数据库、GitHub 同步和生产发布。规划见 [第二阶段开发计划](docs/phase-2-development-plan.md)。

## 快速开始

环境要求：Node.js 24 或更高版本、pnpm 10。

```bash
pnpm install
pnpm dev
```

- Web：`http://localhost:5173`
- API 健康检查：`http://localhost:3000/health`

默认开发命令显式使用 `ATOMS_MODEL_PROVIDER=demo` 和本地 Preview Provider，便于离线演示；接入真实模型时设置 `ATOMS_MODEL_API_KEY`，可选 `ATOMS_MODEL_BASE_URL` 和 `ATOMS_MODEL_NAME`。本地 Preview 只用于开发，不是生产 Sandbox。

开发前请先阅读：

- [项目协作规则](AGENTS.md)
- [文档目录说明](docs/README.md)
- [第一阶段开发计划](docs/phase-1-development-plan.md)
- [第二阶段开发计划](docs/phase-2-development-plan.md)
- [笔试交付说明](SUBMISSION.md) / [部署手册](docs/deployment.md)

## 目录结构

```text
Atoms/
├── AGENTS.md                         # AI 开发助手的项目约束
├── PRODUCT.md                        # 产品用户、体验原则与无障碍基线
├── README.md                         # 项目定位、状态与目录说明
├── SUBMISSION.md                     # 笔试交付说明（思路/取舍/完成度）
├── Dockerfile                        # 多阶段构建（runtime 应用 + web 静态）
├── docker-compose.yml                # atoms + caddy 两服务编排
├── Caddyfile                         # 反向代理、自动 HTTPS、SSE 不缓冲
├── docker-entrypoint.sh              # 容器内同时运行 API 与 Worker
├── .env.example                      # 环境变量清单（密钥只进 .env）
├── package.json                      # Monorepo 命令与统一开发依赖
├── pnpm-workspace.yaml               # pnpm 工作区定义
├── tsconfig.base.json                # 共享 TypeScript 严格配置
├── apps/                             # 可独立启动和部署的应用
│   ├── web/                          # React + Vite Builder 前端
│   ├── api/                          # Fastify Control Plane API
│   └── agent-worker/                 # 后台 Agent Run Worker
├── packages/                         # 跨运行单元共享的领域内核
│   ├── contracts/                    # Zod 协议与状态机
│   ├── db/                           # 本地持久层与可替换存储边界
│   ├── workspace-sdk/                # Workspace 接口、Git 实现与安全边界
│   └── sandbox-sdk/                  # Sandbox 接口与受控本地实现
├── templates/
│   └── react-vite/                   # 生成应用的起步模板
├── docs/                             # 架构、计划和开发文档
│   ├── README.md                     # 文档目录维护约定
│   ├── adr/                          # 架构决策记录
│   ├── phase-1-development-plan.md   # Builder 内核第一阶段开发计划
│   ├── phase-2-development-plan.md   # 全栈交付与生产发布第二阶段开发计划
│   └── deployment.md                 # 笔试 Demo 生产部署手册
└── dyad/                             # 本地参考仓库，已忽略，不属于项目交付物
```
