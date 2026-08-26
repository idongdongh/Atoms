# Agent Worker

后台 Agent Run 执行进程。它轮询并原子领取本地持久队列，通过结构化 Tool Calling 调用 Workspace，记录工具与事件，并在成功修改后提交 Git 版本。可选的 Local Development Sandbox 只用于本地 Vite Preview；生产环境必须替换为远程隔离 Provider。

模型配置：

- `ATOMS_MODEL_PROVIDER=demo`：本地可重复演示，不代表真实模型。
- `ATOMS_MODEL_API_KEY`、`ATOMS_MODEL_BASE_URL`、`ATOMS_MODEL_NAME`：OpenAI-compatible Provider。
