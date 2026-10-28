# Wick 0.1.1

Wick 是一个管理本机服务的 macOS 控制台。服务由 Process Compose 管理，关闭窗口后继续运行。

## 下载与安装

- 支持 **macOS 12+、Apple Silicon（arm64）**，不支持 Intel Mac。
- 下载 `Wick-0.1.1-darwin-arm64.dmg`，打开后把 Wick 拖到 Applications。附带的 `.sha256` 文件可用于校验下载。
- **本版本未签名、未公证。** 确认下载来源后，首次打开前移除隔离标记：

```bash
xattr -dr com.apple.quarantine /Applications/Wick.app
```

App 已内置 Process Compose 1.122.0、Agent 命令和 Skill，不需要安装 Node、npm、Homebrew 或保留源码。

## 这一版

- 内置服务管理器，打通普通安装后的 Agent 操作流程。
- 支持登记、查询、启停、日志、登录自启和多进程服务。
- 更新 Agent 操作说明，补齐更新与移除流程。
- Electron 升级到 43.8.4，并修复依赖审计报告的已知漏洞。

把 [仓库链接](https://github.com/RunMintOn/Wick) 给 Agent，按 README 操作即可。Skill 软链接默认不创建，Agent 应先询问用户；可选位置是 `~/.agents/skills/wick`。支持 `disable-model-invocation: true` 的 Agent 需用户显式调用该 Skill。

## 更新已有安装

更新前保留旧版，关闭控制台后替换原固定位置的 App，再重新打开。不要为了替换窗口而停止整个后台。切换运行中的后台版本会中断托管服务，需单独安排。

## 已知限制

- 实际注销 macOS 再登录的完整流程尚未验证。
- 内存数字是特定场景的观测，不是固定占用保证。
- 没有进行现有服务的数据迁移。
