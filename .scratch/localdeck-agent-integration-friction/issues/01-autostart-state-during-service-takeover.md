# 01: 登录自启状态与接管流程中的配置落差

**Type:** task
**Status:** resolved

## 背景

2026-10-17，Agent 按 LocalDeck Skill 将三个已有 launchd 服务接管到 LocalDeck：

- `dsh-web`：`127.0.0.1:3080`
- `dsh-proxy`：`127.0.0.1:3081`
- `phrasevault-mobile`：`127.0.0.1:8787`

接管顺序是先登记为 `disabled: true` 并 `npm run apply`，确认旧进程停止后通过 Process Compose 启动，最后将唯一源配置 `services.yaml` 改为 `disabled: false` 并再次 `npm run apply`。

服务最终都由 LocalDeck 管理且运行正常；但接管最后一步的行为不直观，Agent 没有清楚区分“登录自启持久设置已保存”和“当前 runtime 已同步”。源配置中的新设置会在下次后台启动时读取，当前 runtime 不立即同步。

## 复现与证据

源配置：

```yaml
processes:
  dsh-web:
    disabled: false
```

应用后，生成的 `runtime.yaml` 仍是：

```yaml
processes:
  dsh-web:
    disabled: true
```

代码位于 `src/services.cjs`：

```js
// Startup policy must not restart a running service when configuration is applied.
config.disabled = previous.processes?.[name]?.disabled ?? source.disabled ?? false;
```

`apply()` 走 `prepare(true)`，优先保留旧 `runtime.yaml` 中的 `disabled`。后台启动路径 `config.cjs --boot` 走 `prepare(false)`，重新从源配置生成 runtime。

已在隔离的 `LOCALDECK_HOME` 中运行 `node scripts/config.cjs --boot` 验证：源配置中的三个 `disabled: false` 会被写入新 runtime。没有实际注销再登录。

## 摩擦与风险

1. **配置状态分成两份且暂时不同**：用户/Agent 编辑的 `services.yaml` 是唯一源配置，但应用后的 `runtime.yaml` 可以保留旧的登录自启值。只看 runtime 会误以为修改失败；只看源文件又不能说明当前后台实际采用什么值。
2. **接管流程容易留下误会**：Agent 按 Skill 将新登记先设为 `disabled: true`，启动服务后改成 `false` 并 `npm run apply`。命令成功，但 runtime 不变；用户可能以为下次登录会自启，也可能为了确认而重复应用或误重启服务。
3. **技能说明没有解释 runtime 差异**：LocalDeck Skill 已说明修改 `disabled` 只影响下次后台启动，但没强调 Apply 会保留已登记服务在旧 runtime 中的值。控制台 `Start at login` 开关同样只修改源配置；Agent 无需额外调用控制台接口。
4. **`runtime.yaml` 的来源及权威性不明显**：新 Agent 容易把它当作另一个需要直接编辑的配置文件，或把旧值当作源配置没生效。

本次没有造成运行中断。服务 PID 在修改自启配置和 `npm run apply` 后未变化。三个服务实际的下次登录启动行为尚未通过真实注销/登录验证。

## 原始待处理问题

- 明确 `disabled` 的语义和权威来源：它是只在下次后台启动时读取的声明，还是希望 Apply 后更新后台策略？
- 如果有意延迟生效，应在控制台或 Agent 可读状态中显示「下次后台启动生效」，并记录源配置值与当前 runtime 值，避免把两者混为一谈。
- 如果要立即应用，应确认更新 Process Compose 配置中的 `disabled` 是否能在不重启运行中服务的前提下完成；不能只根据注释推断，需写回归测试验证 PID 和登录策略。
- 更新 LocalDeck Skill：覆盖“关闭自启登记 → 启动并验证 → 开启自启”的完整接管流程；说明不能假设 `npm run apply` 会传播已有服务的 `disabled` 变更，并给出经验证的操作路径。
- 为“启用自启后当前运行服务保持原 PID，但下一次后台启动会自启”增加隔离测试。不要以只检查 YAML 字符串的测试代替行为测试。

## 验收建议

- 文档明确区分唯一源配置、当前运行时配置和下次后台启动策略。
- Agent 按官方 Skill 接管一个已运行服务时，可以明确确认：服务由谁管理、当前是否运行、下次后台启动是否会运行。
- 修改登录自启状态不会意外重启正在运行的服务。
- 隔离测试验证关闭/开启自启后的实际后台启动行为；未做真实注销登录时明确标记这一限制。

## 处理结果

本次保留 Apply 的现有行为，修正 Skill 的说明并补充行为测试，不增加控制台状态展示。

- 权威来源已明确：`services.yaml` 保存登录自启的持久设置；Apply 保留当前 runtime 的旧值；下次后台启动重新读取源配置。当前 runtime 未同步不表示持久设置保存失败。
- `skills/localdeck/SKILL.md` 增加“登录自启”小节，说明控制台开关与 Agent 编辑源配置的生效时机，提供“记录状态与 PID → 修改源配置 → 校验与应用 → 重新读取并检查状态”的确认步骤。
- 接管流程补充按用户要求开启自启的收尾步骤，并要求分别报告当前运行状态和下次后台启动策略。
- `tests/autostart.test.cjs` 增加源配置编辑与 Apply 路径的隔离测试，使用真实 Process Compose：开启、关闭自启均保持运行中服务的 PID 和 HTTP 可访问性；重新启动隔离后台后分别验证自动启动和保持停止。测试通过公开管理接口执行和检查，不只比较 YAML。

验证结果：

- `node --test tests/autostart.test.cjs`：2 项通过。
- `npm test`：12 项通过。
- `npm run check`：通过。

验证仅针对隔离数据目录中的真实后台启停，未执行真实注销登录，也未重启用户现有后台或三个已接管服务。
