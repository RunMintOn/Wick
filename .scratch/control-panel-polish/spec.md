# 后台连接、浏览器入口与 LocalDeck Skill

Status: resolved

## Scope

- 顶部展示后台连接状态：Connected / Connecting / Unavailable，使用低饱和度小圆点和文字，适配浅色与深色外观。
- Connecting 只用于初次连接与用户主动重连，日常轮询不闪动。
- 后台不可用时提供 Reconnect，尝试重新连接或按现有机制拉起后台。正常时保留 Refresh，不提供整个后台停止/重启按钮。
- 配置错误与后台连接状态分开：后台可查询但 YAML 错误时仍显示 Connected，另外展示配置错误。未知服务状态不伪装成 Stopped。
- Start / Stop / Restart 保留在服务操作区。Open 改为 Address 行上的蓝色 Open in Browser ↗，复用已有默认浏览器操作。
- 不修改地址文本为链接，不识别或复用已有浏览器标签页，不调整其他详情结构。
- 编写中文 LocalDeck Skill，安装到用户的共享 Agent Skills 目录。涵盖登记服务、接管已运行进程、日常操作、自启与异常恢复、后台连接排错、停止及移除登记。
- Skill 引用并保留现有操作文档。记录已观察到的 SQLite/WAL 与异步停止约束，避免重复此前的迁移操作问题。
- 本次不实现发行、捆绑 Process Compose、自动更新或新管理框架。

## Acceptance

- Electron E2E 验证真实后台：正常为 Connected；断开为 Unavailable；Reconnect 后恢复；配置损坏时 Connected 且显示配置错误。
- Address 中有独立 Open in Browser 入口，启停操作区没有 Open；打开请求使用现有默认浏览器接口。测试拦截系统浏览器启动副作用，不模拟后台。
- 确认浅色、深色 UI；颜色克制，文字不依赖颜色辨认。
- Skill 可被当前 Agent 平台发现，中文说明与实际命令一致；原操作文档仍在。
- 更新 App 前后，日常 Memos 的 PID 不变且 HTTP 仍正常。
- 检查完整测试、生成 App、审查要提交的文件，再在新建本地 Git 仓库提交。不推送远端。

## Result

已实现并更新本机 App。11 项集成测试、3 项 Electron E2E 与类型检查通过。Skill 已安装，原操作文档保留。日常 Memos 的 PID 与访问状态未受界面更新影响。截图、完整日志与顺序审查结果保留在本功能 evidence 中。
