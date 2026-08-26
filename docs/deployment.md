# 部署手册（腾讯云轻量 + Docker Compose + Caddy）

本文说明如何把 Atoms Demo 部署到一台 2C2G 的腾讯云香港轻量应用服务器（Ubuntu 24.04）。运行形态的架构决策见 [ADR 0005](adr/0005-demo-runtime-topology.md)。

## 运行形态

```text
                    ┌─────────────────────────────┐
  浏览器 ── 443 ──▶ │ caddy 容器                   │
                    │  /            → /srv/web 静态 │  (builder SPA，多阶段构建产物)
                    │  /api/*       → atoms:3000   │  (strip /api 前缀)
                    │  /health      → atoms:3000   │  (存活探测，绕过 SPA fallback)
                    │  /p/*         → atoms:3000   │  (公开预览网关)
                    │  /published/* → atoms:3000   │  (已发布应用静态服务)
                    └──────────────┬──────────────┘
                                   ▼
                    ┌─────────────────────────────┐
                    │ atoms 容器 (node:24-slim)    │
                    │  apps/api/dist/server.js     │
                    │  apps/agent-worker/dist/...  │  (docker-entrypoint.sh 双进程)
                    │  持久卷 /data:                │
                    │    control-plane.sqlite      │
                    │    workspaces/<projectId>    │  (Git 裸工作区)
                    │    published/<projectId>/... │  (不可变 release)
                    └─────────────────────────────┘
```

- 平台元数据全部在 `/data` 卷的 SQLite 文件里；生成应用的代码在 `/data/workspaces` 的本地 Git 仓库里。
- 预览 dev server 由 worker 作为受控子进程启动，空闲 10 分钟（`ATOMS_PREVIEW_IDLE_MS`）自动停止，打开项目时自动唤醒。
- 模型走 OpenAI 兼容 API（DeepSeek），密钥只进 `.env`，不进镜像和 Git。

## 前置条件

1. 服务器：腾讯云香港轻量 2C2G，Ubuntu 24.04 系统镜像，密钥对登录。防火墙/安全组只放行 22、80、443。
2. 域名：任一已实名的域名（.top/.xyz 即可），在 DNSPod 添加 A 记录：`@` 和 `www`（或你选的主机名，如 `build`）指向服务器公网 IP。香港节点无需 ICP 备案。
3. DeepSeek API Key。
4. 服务器已安装 Docker Engine 与 Docker Compose 插件（`curl -fsSL https://get.docker.com | sh`）。

## 部署步骤

```bash
# 1. 在服务器上拉取代码（或 scp 上传）
git clone <你的仓库地址> atoms && cd atoms

# 2. 准备环境变量（所有密钥只写在这里）
cp .env.example .env
vim .env
#   ATOMS_DOMAIN=你的域名        例：build.example.top
#   ACME_EMAIL=你的邮箱
#   ATOMS_MODEL_API_KEY=sk-...   （DeepSeek）
#   ATOMS_PREVIEW_PUBLIC_ORIGIN=https://你的域名

# 3. 构建并启动（首次构建需拉取基础镜像 + pnpm install，约 3-6 分钟）
docker compose up -d --build

# 4. 确认健康
docker compose ps          # atoms 应为 healthy
curl -fsS https://你的域名/health
```

浏览器打开 `https://你的域名`，注册账号，发一条 prompt 即可验证主链。

## 日常运维

### 更新版本

```bash
cd atoms && git pull
docker compose up -d --build
```

发布（release）目录与 SQLite 都在卷里，重建容器不丢数据。

### 备份与恢复

```bash
# 备份（建议 crontab 每日）
docker compose exec atoms tar czf - -C /data . > atoms-data-$(date +%F).tgz

# 恢复
docker compose down
docker compose run --rm --entrypoint sh atoms -c \
  "mkdir -p /data && tar xzf - -C /data" < atoms-data-<日期>.tgz
docker compose up -d
```

### 容量与调优（2C2G）

- 每个预览 dev server 约占 150-300MB 内存。空闲回收默认 10 分钟，可用 `ATOMS_PREVIEW_IDLE_MS` 调小。
- 建议加 2G swap 兜底：`fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`（并写入 /etc/fstab）。
- 同时活跃预览建议不超过 4-5 个；正式演示前重启一次容器清空残留。
- 若持续内存吃紧，腾讯云控制台可一键升配 4G，架构不变。

## 常见问题

| 现象                               | 处置                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 证书签发失败                       | 确认 80/443 已放行、DNS 已生效（`dig 你的域名`）；看 `docker compose logs caddy`                                         |
| 预览一直"正在启动"                 | `docker compose logs atoms` 看 worker 日志；首次启动会在工作区跑 `pnpm install`，需访问 npm registry，香港节点通常无压力 |
| 生成很慢/报模型错误                | 检查 `.env` 的 `ATOMS_MODEL_*`；DeepSeek 偶发超时会自动按运行级重试（run 级手动点重试）                                  |
| Supabase 应用数据连不上（M-B1 后） | 免费档一周无活动会休眠，演示前先访问一次 Supabase 控制台或发一条请求激活                                                 |
| 想彻底重置                         | `docker compose down -v` 会连数据卷一起删除，慎用                                                                        |

## 安全清单

- `.env` 权限设为 600；泄露的 DeepSeek key 立即在平台吊销。
- SSH 只用密钥登录，禁用密码（镜像默认即如此）。
- 容器以 root 运行是 Demo 权衡（Git 工作区属主简单）；对外暴露面只有 Caddy 的 80/443。
- 平台自身接口除 `/health`、`/auth/*`、`/p/*`、`/published/*` 外均需会话；写操作额外要求 `x-atoms-client` 头。
- 公开的 `/p/*` 只读代理：其 upstream 失败不会触发预览重启（只有登录后的构建器路径会），互联网流量无法强制本机重启 dev server。
