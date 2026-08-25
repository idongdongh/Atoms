# Atoms

Atoms 是一个面向 Web 的 AI 应用生成平台。用户通过自然语言描述需求，Agent 在隔离工作区中读取、生成和修改代码，并将运行结果以实时网页 Preview 的形式展示。

产品体验参考 Dyad，但本项目从一开始按多用户 Web 系统设计，将控制面、项目工作区和用户代码执行环境分离。

## 当前状态

项目已进入第一阶段开发。当前已交付第一批可运行内核：Monorepo 与 Web/API/Worker 骨架、运行时 Contract 与状态机、Fake Sandbox，以及带路径隔离、原子写入、Git 版本和项目写锁的本地 Workspace。尚未接入数据库、队列、真实远程 Sandbox 和模型服务，因此第一阶段还没有完成。

第一阶段目标是完成 Builder 内核：

1. 创建项目与初始化模板。
2. 通过 Chat 驱动 Agent 修改代码。
3. 在远程 Sandbox 中安装依赖并运行项目。
4. 在浏览器中实时预览和查看日志。
5. 自动生成 Git 版本，支持继续修改和安全回滚。

详细范围、里程碑和验收标准见 [第一阶段开发计划](docs/phase-1-development-plan.md)。

## 快速开始

环境要求：Node.js 24 或更高版本、pnpm 10。

```bash
pnpm install
pnpm dev
```

- Web：`http://localhost:5173`
- API 健康检查：`http://localhost:3000/health`

开发前请先阅读：

- [项目协作规则](AGENTS.md)
- [文档目录说明](docs/README.md)
- [第一阶段开发计划](docs/phase-1-development-plan.md)

## 目录结构

```text
Atoms/
├── AGENTS.md                         # AI 开发助手的项目约束
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
│   ├── workspace-sdk/                # Workspace 接口、Git 实现与安全边界
│   └── sandbox-sdk/                  # Sandbox 接口与 Fake 实现
├── docs/                             # 架构、计划和开发文档
│   ├── README.md                     # 文档目录维护约定
│   ├── adr/                          # 架构决策记录
│   └── phase-1-development-plan.md   # Builder 内核第一阶段开发计划
└── dyad/                             # 本地参考仓库，已忽略，不属于项目交付物
```
