# 01: CLI 结果与诊断清晰可判断

**What to build:** 查询、启停使用 Wick 统一入口，诊断与失败分开；消除能消除的无关输出，不隐藏实际错误。查询支持结构化结果。

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] 验证 debug 输出来源，采用有依据的抑制或诊断处理。
- [x] 成功含 stderr 不误报失败，真实失败保留操作上下文。
- [x] 启停检查操作后状态，服务就绪与命令成功分开。

验证：真实 PC CLI 集成测试通过，类型检查通过。v1.122.0 源码与实测确认 config-home 查找发生在日志初始化前；使用 `PROC_COMP_CONFIG`，不调整全局日志级别。
