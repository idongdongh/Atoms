# Atoms

Atoms 是一个开源的 Web AI 应用生成平台：用一句话描述想法，Agent 在隔离工作区里把它变成可运行、可发布的应用——实时预览、版本化迭代、可选数据库、一键发布。

[![演示](assets/demo-v2.gif)](http://119.28.133.244)

## 🚀 特性

- ⚡️ **对话式生成** — 自然语言驱动，Agent 通过结构化工具读写代码，回复逐 token 流式呈现，每轮自动形成 Git 版本
- 🗄️ **全栈生成** — 一句话即可生成带数据库 CRUD 的应用：受控建表 + 行级安全，前端直连托管数据库
- 🖥️ **实时预览** — 生成过程中右侧实时运行 dev server，发消息到预览就绪实测约 17 秒
- 🌍 **一键发布** — 不可变版本 + 激活指针原子切换，任意历史版本秒级回退，扫码即可分享
- 🔒 **多用户隔离** — 账号体系与资源隔离，模型密钥与用户代码执行环境严格分离
- 🧹 **应用管理** — 侧栏集中管理，悬停即删，活跃生成中的项目受保护

## 📦 在线体验

无需安装：打开 <http://119.28.133.244>，用任意邮箱注册即可（演示账号 `demo@atoms.test` / `demo-password`）。

## 🛠️ 本地运行

```bash
git clone https://github.com/idongdongh/Atoms.git && cd Atoms
pnpm install
pnpm dev   # API :3000 + Web :5173 + Worker（离线 demo 模型，无需任何密钥）
```

接入真实模型与数据库只需在 `.env` 填三组环境变量（模板见 `.env.example`）；生产部署手册见 [docs/deployment.md](docs/deployment.md)。

## 📄 文档

- [交付说明](SUBMISSION.md) — 实现思路、关键取舍、完成度与扩展优先级
- [架构](docs/architecture.md) — 三平面拓扑与仓库结构
- [架构决策记录](docs/adr/) — 每个重大取舍的来龙去脉
- [产品定义](PRODUCT.md) / [安全](SECURITY.md)

## License

本项目基于 [MIT License](LICENSE) 开源；第三方组件见 [NOTICE](NOTICE)。
