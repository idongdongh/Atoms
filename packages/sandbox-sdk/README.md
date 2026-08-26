# Sandbox SDK

定义不可信用户代码的运行边界。当前提供确定性的 Fake Provider 和明确标注为开发用途的 `LocalDevelopmentSandboxProvider`，后者负责受控依赖安装与本地 Vite Preview；它不提供生产隔离，真实远程 Provider 仍是第一阶段生产验收的前置条件。
