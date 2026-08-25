# Workspace SDK

项目文件和 Git 操作的唯一抽象入口。当前包括：

- `FakeWorkspace`：纯内存协议测试实现。
- `LocalGitWorkspace`：面向 Workspace Plane 持久卷的真实文件与 Git 实现。
- `WorkspaceWriteLock`：基于原子锁文件的单项目写锁。
- `createProjectWorkspace`：从可信模板创建并初始化 Git 项目。

Fake 不是生产实现，不得用于运行不可信用户代码。
