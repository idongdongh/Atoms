# Database

Control Plane 元数据的持久化边界。当前使用 Node.js SQLite 作为零配置开发实现，保存项目、默认 Chat、版本索引和可重放 Agent Event；用户项目代码仍以 Workspace Git 仓库为事实来源。

SQLite Provider 仅用于本地开发和笔试 Demo。部署到多实例环境前必须在相同 Store Contract 下替换为 PostgreSQL。
