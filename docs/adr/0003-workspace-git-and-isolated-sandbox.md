# ADR 0003：Workspace、Git 与 Sandbox 分离

- 状态：accepted
- 日期：2026-08-25

## 决策

- Workspace 是项目文件和 Git 操作的唯一入口。
- Git commit 是代码版本事实来源。
- 用户代码只在隔离 Sandbox 中安装和运行。
- Agent 成功验证后才更新项目稳定版本。

## 原因

Control Plane 直接运行用户代码会暴露宿主密钥、内部网络和其他租户数据。将持久代码、版本历史和临时运行环境分离，可以独立恢复、扩缩容和替换 Sandbox Provider。

## 用户影响

生成失败不会覆盖最后一个稳定版本；历史版本可以恢复；Sandbox 异常退出不会丢失项目代码。

## 实现方向

失败修改使用 Git worktree 或等价隔离工作区保存 Diff。回滚通过生成新的 restore commit 完成，不删除已有历史。
