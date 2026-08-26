# Atoms

Atoms 是一个面向 Web 的 AI 应用生成平台。用户通过自然语言描述需求，Agent 在隔离工作区中读取、生成和修改代码，并将运行结果以实时网页 Preview 的形式展示。

产品体验参考 Dyad，但本项目从一开始按多用户 Web 系统设计，将控制面、项目工作区和用户代码执行环境分离。

## 当前状态

项目已进入第一阶段开发，并已交付可运行的本地纵向切片：Monorepo 与 Web/API/Worker 骨架、运行时 Contract 与状态机、本地持久化元数据和事件序列、固定 React/Vite 模板、项目创建与文件/版本 API，以及带路径隔离、原子写入、Git 版本和项目写锁的本地 Workspace。Builder 可以提交自然语言需求，Worker 通过结构化工具修改文件、提交版本、回放 SSE 活动，并在启用本地 Preview Provider 后启动 Vite iframe。真实模型可通过 OpenAI-compatible 环境变量接入；本地默认开发命令使用显式标注的 Demo Model。

当前 SQLite、Demo Model 和 Local Development Sandbox 只用于本地开发与 Contract 验证。真实远程隔离 Sandbox、Preview Gateway、PostgreSQL/持久队列、临时工作树回滚和完整故障恢复仍未接入，因此第一阶段的生产验收尚未完成。

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

## 目录结构

```text
Atoms/
├── AGENTS.md                         # AI 开发助手的项目约束
├── PRODUCT.md                        # 产品用户、体验原则与无障碍基线
├── README.md                         # 项目定位、状态与目录说明
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
│   └── sandbox-sdk/                  # Sandbox 接口与 Fake 实现
├── templates/
│   └── react-vite/                   # 第一阶段固定项目模板
├── docs/                             # 架构、计划和开发文档
│   ├── README.md                     # 文档目录维护约定
│   ├── adr/                          # 架构决策记录
│   ├── phase-1-development-plan.md   # Builder 内核第一阶段开发计划
│   └── phase-2-development-plan.md   # 全栈交付与生产发布第二阶段开发计划
└── dyad/                             # 本地参考仓库，已忽略，不属于项目交付物
```
