# Shared Packages

本目录保存跨运行单元共享的协议和领域内核。

- `contracts/`：运行时 Schema、状态和传输类型。
- `db/`：Control Plane 元数据与持久事件的开发存储实现。
- `workspace-sdk/`：Workspace 抽象及测试用 Fake 实现。
- `sandbox-sdk/`：Sandbox 抽象及测试用 Fake 实现。

共享包不得依赖 `apps/` 中的实现。
