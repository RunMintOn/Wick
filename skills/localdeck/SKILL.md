---
name: localdeck
description: 在 macOS 上操作 LocalDeck：登记本机服务、接管已运行的后台进程、查询与启停服务、查看日志、设置登录自启、排查后台连接和异常恢复，以及移除登记。用户希望把终端里的 Web 或后端程序纳入图形管理时使用。
compatibility: macOS，已安装 LocalDeck 与 Process Compose；本地源码提供配置应用与恢复脚本。
disable-model-invocation: true
---

# LocalDeck 服务管理

LocalDeck 的控制台只负责展示和发送操作。Process Compose 管理本机服务，用户级 launchd 管理后台启动。退出控制台后服务继续运行。

将后台程序接入 LocalDeck，指的是登记启动信息并交给现有管理器运行；服务仍是本机进程，网页仍通过浏览器访问。登记本身不包含安装程序、依赖或迁移数据，这些操作按用户的实际请求处理。

## 找到实际环境

此 Skill 随 LocalDeck 源码保存，安装时通过目录软链接供 Agent 发现。将系统给出的 Skill 所在目录赋给 `SKILL_DIR`，先解析真实目录，再定位项目：

```bash
PROJECT="$(cd -P "$SKILL_DIR" && cd ../.. && pwd -P)"
HOME_DIR="${LOCALDECK_HOME:-$HOME/Library/Application Support/LocalDeck}"
SOCKET="$HOME_DIR/control.sock"
PC="${LOCALDECK_PC:-/opt/homebrew/bin/process-compose}"
```

确认项目的 `package.json` 是 LocalDeck，所需脚本存在，且 `PC` 可执行。`LOCALDECK_HOME` 用于覆盖数据目录，例如隔离测试；使用时保持为绝对路径。

唯一配置是 `$HOME_DIR/services.yaml`，默认位于 `~/Library/Application Support/LocalDeck/services.yaml`。`runtime.yaml` 是生成的 Process Compose 配置，不是另一份配置来源。保留现有服务和设置，只改本次任务涉及的内容。

完成条件：明确本次使用的项目、唯一配置文件、socket 与目标服务；涉及已有进程时，已查明实际 PID、命令、端口和数据位置。

## 登记一个新服务

1. 确认程序或启动脚本能在 macOS 本机运行，使用固定位置的程序、工作目录和数据。已有运行环境可以复用，例如项目里的 Python 虚拟环境。通过绝对路径启动，避免依赖交互式 shell、fnm 激活、自动发现 `.env` 或某个终端的激活状态。
2. 检查目标端口是否被占用。已有服务的接管按下一节处理。
3. 在唯一配置的 `processes` 中增加稳定标识，按下面的格式填写启动信息和展示地址。登录自启默认关闭，用户要求时开启。
4. 校验成功后应用配置。使用下面的集成脚本，避免直接用源配置启动第二个管理器。
5. 启动目标服务，检查结构化状态、实际访问地址和近期日志。确认未修改服务的 PID 不变。

### 配置格式

标识使用字母、数字、点、下划线和连字符。可执行文件与工作目录使用绝对路径，程序及数据不要放在临时目录。配置保持 YAML 格式。

```yaml
version: "0.5"
processes:
  memos:
    command: 'exec "/absolute/path/to/memos" --data "/absolute/persistent/data" --port 5231'
    working_dir: /absolute/persistent/directory
    disabled: true
    environment:
      - TZ=Asia/Shanghai
    x-localdeck:
      title: Memos
      url: http://localhost:5231
```

- `disabled` 必须显式设置。`true` 关闭登录自启，仍允许手动启动；`false` 开启登录自启。修改它只影响下次后台启动，不立即启停服务。
- `x-localdeck` 是展示信息，`title` 是名称，`url` 是访问地址。
- 当前版本支持能独立运行的前台程序。不要使用 `is_disabled`、交互式/foreground 配置、定时任务、replicas、提权进程或关闭整个项目的设置。
- 未显式配置时，LocalDeck 提供 `on_failure` 恢复策略：最多重试 3 次，间隔 2 秒；每个服务有独立日志，按 1 MiB 轮转并保留 2 份备份，内存日志缓冲为 500 行。
- 可选的 `availability`、`log_location`、`log_configuration`、`shutdown` 和健康检查字段沿用 Process Compose 语法。重试次数和日志大小应有明确上限。

### 校验与应用

从项目目录执行，校验失败时停止后续应用：

```bash
cd "$PROJECT" && npm run validate && npm run apply
```

这些集成脚本使用已安装的 Process Compose 校验配置，并通过已有接口重新加载生成的 runtime 配置。无效配置在触及运行中服务之前被拒绝。

展示信息和登录自启的修改不会重启服务；启动命令变化或移除登记可能停止或重启受影响的服务。没有自动监听源配置文件的机制，编辑后需要应用。登录自启的生效时机和确认方式见下文“登录自启”。

不要直接执行 `process-compose project update -f services.yaml`：它会绕过 LocalDeck 默认值，且在已测试版本中可能重启已有服务。

### 启动与检查

GUI 与 CLI 使用同一个私有 Unix socket。以下命令中的 `memos` 替换为目标服务标识：

```bash
"$PC" -U -u "$SOCKET" process list -o json
"$PC" -U -u "$SOCKET" process start memos
```

后台未运行时，先打开一次 LocalDeck。应用配置不会启动未连接的管理器。启动后重新查询结构化状态，用 `curl` 检查实际 URL，并读取近期日志。Running 只表示进程状态，不保证 HTTP 已就绪。

完成条件：目标服务由 LocalDeck 后台管理，实际入口可访问，程序与数据不依赖临时目录，其他服务未被重启。向用户说明打开方式和自启设置。

## 接管一个已经运行的进程

接管会停止旧实例并按登记命令重新启动，需要用户授权该服务的接管。

1. 用监听端口定位 PID，确认所有者、完整启动参数和数据目录。保留原版本和监听范围；准备固定路径的新配置，关闭自启，校验并应用，暂不启动新实例。
2. 正常停止已确认的旧实例，按下文的停止要求等待退出。需要搬移数据时，等所有写入者退出后再一致复制并检查，保留旧目录，不覆盖已有数据；空实例跳过数据搬移。
3. 前面的步骤成功后才启动登记后的服务，检查状态、唯一监听实例、实际访问结果和日志。停止、复制或检查失败时，保留数据并停止后续切换；回退前先停止新实例，有新写入时保留并区分两份数据。
4. 用户要求登录自启时，按下文“登录自启”将目标服务设为开启，完成校验、应用和确认。用户未要求时保持关闭。

SQLite 的有效数据可能仍在 `-wal` 中，运行中只复制 `.db` 会遗漏数据。使用数据库的一致备份能力，或在正常退出、检查点完成后复制整个数据目录。

完成条件：旧实例已退出，目标端口只有一个已登记实例监听，实际入口可访问；有数据时完成必要的一致性检查。分别报告当前运行状态与下次后台启动时的自启设置。

## 日常操作

查询与启动使用上面的 CLI，停止与重启使用：

```bash
"$PC" -U -u "$SOCKET" process stop memos
"$PC" -U -u "$SOCKET" process restart memos
```

无需打开控制台，也无需模拟 TUI 按键。

- 手动停止只影响当前运行，不修改登录自启，不触发异常恢复。
- stop 返回时，应用可能仍在退出清理。等待原 PID 消失、监听端口释放后，再离线复制数据或把端口交给另一个实例。
- 修改登录自启按下一节操作。
- 控制台的 Address 行提供 Open in Browser，调用默认浏览器，不保证复用同网址的已有标签页。

完成条件：检查操作后的实际状态；停止时确认进程退出和端口释放，启动时确认入口可访问。涉及自启时，分别说明当前状态和持久设置。

### 登录自启

`services.yaml` 中的 `disabled` 是持久设置：`false` 开启，`true` 关闭。下次后台启动时会按此设置生成 runtime 并决定启动哪些服务，包括下次登录和同会话内的后台重新启动。

Apply 会保留已登记服务在旧 `runtime.yaml` 中的 `disabled`，避免修改自启设置影响当前运行状态。因此，Apply 成功后两个文件的值仍可能不同。`runtime.yaml` 用于当前后台运行，不能用它的旧值判断持久设置是否保存成功。控制台的 `Start at login` 开关也只修改源配置，不同步当前 runtime。

1. 记录目标服务当前是否运行及 PID。
2. 编辑 `services.yaml` 中目标服务的 `disabled`，执行上文的校验与应用命令。
3. 重新读取源配置，确认目标值已保存；查询 socket 中的服务状态，确认当前启停状态未变，运行中的服务保持原 PID。
4. 报告“当前运行/停止；登录自启开启/关闭，下次后台启动生效”。只把实际执行的后台启动检查或注销登录检查称为已验证。

完成条件：源配置的自启设置符合用户要求，当前运行状态未变。runtime 保留旧值时无需重复应用、直接编辑 runtime 或重启后台来消除差异。

### 日志

近期日志 REST 接口使用同一个 socket：

```bash
curl --unix-socket "$SOCKET" 'http://localhost/process/logs/memos/0/200'
```

已测试的 Process Compose 版本通过 UDS 使用 CLI 日志流会失败，使用上述接口、控制台的 Show logs，或 `$HOME_DIR/logs` 下的轮转文件。

`$HOME_DIR/startup.log` 保存最近一次 launchd bootstrap 诊断，每次后台启动都会替换。Process Compose 不轮转的内部 debug 日志被送到 `/dev/null`；服务日志使用其原生轮转。日志和配置中的秘密信息保持在本地，不发送到公开位置。

### 异常恢复

自动重试预算按服务当前注册实例累计，不是滑动时间窗口计数器。在 Process Compose v1.122.0 中，普通 CLI start/restart 不会重置已耗尽的预算。

先根据状态、重试次数和日志修复原因，再执行：

```bash
cd "$PROJECT" && npm run recover -- memos
```

该脚本与控制台 Start 使用相同机制：必要时仅改变目标服务生成的 runtime revision，通过已有服务端重载接口重新登记它。未修改服务保持原 PID，唯一源配置不变。

信号结束的进程可能报告 exit code `-1`，需要结合状态、重试次数和日志判断原因。

## 排查后台连接与服务失败

顶部的 Connected / Connecting / Unavailable 表示后台连接，不表示服务健康。后台可连接但配置有错时，应保留 Connected，并单独显示配置错误。

1. 先查询该 socket 的管理接口。能查询时，查看目标服务状态和日志；配置报错时检查源 YAML。
2. 不能查询时，检查用户级 launchd job `dev.localdeck.manager` 和最近的 `startup.log`。Unavailable 提供 Reconnect，重新连接并在必要时按现有机制拉起后台。
3. 后台重新启动会按登录自启设置决定启动哪些服务。它不能保证恢复崩溃前的运行列表。
4. 端口冲突时重新核对监听进程。如果是旧实例残留，只在用户授权的目标范围内处理；不要用模糊进程名批量结束进程。

完成条件：明确是后台连接、配置、启动命令、端口还是服务本身的问题。只把实际完成的恢复和检查称为已验证。实际注销再登录与同会话的 launchd 启动验证分开记录。

## 移除登记或更新控制台

移除服务前先确认用户要停止服务还是连同登记一起移除。移除登记会影响该服务的运行；程序、依赖和数据默认保留。应用移除后确认其他服务未受影响。登记本身不授权删除笔记、迁移数据、卸载 OrbStack 或移除 Docker 容器。

更新控制台只重建和重新打开 App。比较更新前后的服务 PID 与访问情况，避免为了替换界面去停止整个后台。安装位置改变后，启动固定位置的 App 更新其后台启动路径。

完成条件：操作范围与用户要求一致；未授权的数据、程序和其他服务保持不动。报告最终状态，不把配置写入成功当作服务接入成功。
