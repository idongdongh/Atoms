# ADR 0005：Demo 运行时拓扑（单机受控执行）

- 状态：accepted
- 日期：2026-08-26

## 决策

- 平台以单机长驻形态部署：一台腾讯云香港轻量服务器（2C2G，Ubuntu 24.04 LTS，密钥对登录，防火墙仅放行 22/80/443），Docker Compose 编排，Caddy 反代并自动签发 HTTPS。香港节点免 ICP 备案；生产化迁移境内区域前必须先完成备案。
- API 与 Agent Worker 同进程运行；平台元数据使用 SQLite 文件；任务队列使用进程内实现。事件仍先持久化再推送，保留 Run 内 sequence 重放，不因单机形态放松。
- Sandbox 降级：远程隔离 Sandbox 由部署机受控子进程替代——每项目独立目录、受控脚本白名单（不开放任意 Shell）、独立进程生命周期与超时。`SandboxProvider` 与 Workspace 契约不变。
- 预览网关：API 按项目代理子进程 dev server；端口按项目确定性分配；预览 URL 稳定不变（避免 origin 漂移导致 localStorage 与登录态丢失）；访问携带短期签名 token；预览使用独立 Origin 与主站分域。文件变更默认依赖 HMR，重启仅由用户或 Agent 显式触发。
- 发布网关：受控构建产出静态制品到 `/data/published/<projectId>/<releaseId>/`（只增不改）；数据库保存各项目"当前激活 release"指针；发布为原子切换指针，回退为指回历史 release，均秒级生效。Caddy 通过泛解析与 on-demand TLS 服务 `app-x.<域名>` 子域。
- 容量与稳定性：常驻内存约 0.6-0.8GB；每个预览沙箱约 250-350MB，2C2G 支持同时活跃预览 2-3 个；预览沙箱空闲自动回收，构建串行复用项目写锁，演示前清场重启。规格可一键升配至 2C4G。

## 原因

完整形态（远程隔离 Sandbox、持久队列、PostgreSQL）在笔试交付窗口内不可用。以部署机受控子进程替换 Sandbox Provider 的实现，可以在 48 小时内交付真实闭环，同时不修改任何契约。单机 Demo 与企业级部署的差别是资源拓扑与隔离强度，不是架构形状。

## 演进路径

```text
单机 VM（本 ADR）
→ 容器拆分：api / agent-worker / 网关独立容器，多实例与负载均衡
→ 有状态外移：SQLite → 托管 PostgreSQL，本地 Git → 对象存储与独立 Git 服务，引入持久队列
→ 执行面专门化：受控子进程 → Firecracker microVM / gVisor 沙箱集群（替换 SandboxProvider 实现）
```

每一步只替换 Provider 实现，三平面边界、共享契约与状态机不变。

## 用户影响与风险

- 用户获得真实可用的生成、预览、发布与回退闭环，无伪进度。
- 风险：单机为单故障域（缓解：提前一天部署冒烟、`docker compose restart` 秒级拉起、定期快照）；多租户隔离强度弱于远程沙箱（缓解：目录隔离、脚本白名单、签名授权，Demo 信任级别下可接受）；境内访问依赖香港链路（典型 30-80ms）。
