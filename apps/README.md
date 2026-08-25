# Applications

本目录保存可独立启动和部署的产品进程。

- `web/`：浏览器端 Builder。
- `api/`：Control Plane HTTP API。
- `agent-worker/`：执行持久化 Agent Run 的后台进程。

应用只通过 `packages/contracts` 定义的协议协作，不直接导入其他应用内部代码。
