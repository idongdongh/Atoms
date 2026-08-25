# Agent Worker

后台 Agent Run 执行进程。它消费持久队列，通过 Workspace 和 Sandbox Contract 完成工具调用，不直接向浏览器维护临时状态。

当前 M0 骨架仅暴露进程身份；队列接入将在后续里程碑实现。
