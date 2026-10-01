# 03: Agent 登记与配置更新

**What to build:** Agent 登记与配置更新，完成从用户或 Agent 操作到真实本机服务行为的闭环。范围以父 spec 为准，不增加新的平台或管理器。

**Blocked by:** 01

**Status:** resolved

- [x] 固定唯一 YAML 配置格式，提供登记与校验流程。
- [x] 新增服务并应用配置后，未修改服务的 PID 和可用性不变。
- [x] 错误配置不影响正在运行的服务。
- [x] 提供与实际命令一致的 Agent 接入说明，覆盖工作目录和数据目录。

## Comments

已完成唯一 YAML、校验/应用脚本与 Agent 接入说明。真实测试确认新增服务、标题修改和自启设置修改不改变原有 PID；无效 YAML/未知字段被拒绝且已有 HTTP 服务继续工作。发现当前 CLI project update 会更新未修改服务，改用已有服务端 reload 接口。runtime.yaml 仅为可重新生成的运行配置，不能独立编辑。
