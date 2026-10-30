# Wick 0.2.0

Wick 是一个管理本机服务的 macOS 控制台。服务由 Process Compose 管理，关闭窗口后继续运行。

## 下载与安装

- 支持 **macOS 13+、Apple Silicon（arm64）**，不支持 Intel Mac。仍在用 macOS 12 的用户请继续使用 [0.1.1](https://github.com/RunMintOn/Wick/releases/tag/v0.1.1)。
- 下载 `Wick-0.2.0-darwin-arm64.dmg`，打开后把 Wick 拖到 Applications。附带的 `.sha256` 文件可用于校验下载。
- **本版本未签名、未公证。** 确认下载来源后，首次打开前移除隔离标记：

```bash
xattr -dr com.apple.quarantine /Applications/Wick.app
```

App 已内置 Process Compose 1.122.0、Agent 命令和 Skill，不需要安装 Node、npm、Homebrew 或保留源码。

## 这一版

- 用 Go + MyGo 和系统 WKWebView 取代 Electron，打包体积从 158 MB 降到 23.4 MB。
- 界面、命令行、配置文件格式和 `~/Library/Application Support/Wick` 目录位置保持不变，不需要迁移数据。
- 服务管理、登录后台和 CLI 改为单个 Go 可执行文件；内置的 Process Compose 1.122.0 以及组件依赖、日志、登录自启、异常恢复行为保持原样。
- 支持 macOS 13+，原因是 MyGo 依赖的 Go 1.27 不再支持 macOS 12。

把 [仓库链接](https://github.com/RunMintOn/Wick) 给 Agent，按 README 操作即可。Skill 软链接默认不创建，Agent 应先询问用户。

## 更新已有安装

数据目录 `~/Library/Application Support/Wick` 沿用原内容，`services.yaml`、日志和服务数据都不需要转换。关闭控制台后替换原固定位置的 App，再重新打开即可，不要为了替换窗口而停止服务。

已在运行的后台管理器在下一次登录或重新加载登录任务之前，仍执行旧版本的可执行文件；两个版本使用同一个 Process Compose 二进制，服务不受影响。要立即切换后台版本需要单独安排。

## 已知限制

- 实际注销 macOS 再登录的完整流程尚未验证。
- 只在 macOS 15.7.9 arm64 上直接验证，未在 macOS 13、14 实机测试。
- 内存数字是特定场景的观测，不是固定占用保证。
- 未签名、未公证，浏览器下载后需要手动移除隔离标记。
