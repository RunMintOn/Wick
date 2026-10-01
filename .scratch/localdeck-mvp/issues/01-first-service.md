# 01: 第一个服务跑通

**What to build:** 第一个服务跑通，完成从用户或 Agent 操作到真实本机服务行为的闭环。范围以父 spec 为准，不增加新的平台或管理器。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 英文 macOS 风格双栏控制台读取真实服务配置。
- [x] 通过真实 Process Compose 启动、停止、重启临时 HTTP 服务。
- [x] 退出控制台后后台继续运行，重新打开不启动重复实例。
- [x] 自动测试使用独立配置、socket 和随机端口，不接管现有 Memos。

## Comments

已完成。真实 Process Compose 集成测试与 Electron E2E 均通过：启停、CLI 共用状态、退出界面后存活、重新打开不生成重复服务。使用独立临时服务，未接管 Memos。
