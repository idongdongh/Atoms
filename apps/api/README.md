# API

Control Plane HTTP API。负责身份、项目元数据和 Agent Run 调度，不读取项目磁盘，也不执行用户代码。

项目文件请求通过 `@atoms/workspace-sdk` 进入 Workspace Plane；API 不直接使用文件系统修改项目。开发环境默认把元数据写入 `.atoms-data/control-plane.sqlite`，Workspace 写入 `.atoms-data/workspaces/`。

## 开发

```bash
pnpm --filter @atoms/api dev
```
