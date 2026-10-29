---
name: wick
description: 在 macOS 上操作和维护 Wick：登记本机服务、接管已有进程、查询与启停服务、查看日志、设置登录自启、排障、异常恢复、移除登记，以及更新 Wick。
compatibility: macOS 13+ Apple Silicon；打包 Wick 自带 Process Compose 和 Go CLI，界面使用系统 WKWebView。直接运行源码另需 Go 与 Process Compose。
disable-model-invocation: true
---

# Wick 服务管理

Wick 的控制台只负责展示和发送操作。Process Compose 管理本机服务，用户级 launchd 管理后台启动。退出控制台后服务继续运行。

将后台程序接入 Wick，指的是登记启动信息并交给现有管理器运行；服务仍是本机进程，网页仍通过浏览器访问。登记本身不包含安装程序、依赖或迁移数据，这些操作按用户的实际请求处理。

## 找到实际环境

将当前 Skill 所在目录赋给 `SKILL_DIR`，先解析真实目录，再定位配套命令：

```bash
PROJECT="$(cd -P "$SKILL_DIR" && cd ../.. && pwd -P)"
HOME_DIR="${WICK_HOME:-$HOME/Library/Application Support/Wick}"
SOCKET="$HOME_DIR/control.sock"
wick() { /bin/sh "$PROJECT/bin/wick" "$@"; }
```

确认 `PROJECT/package.json` 的 `name` 是 `wick`，并执行 `wick --help`。打包版命令直接运行 App 内的 Go 可执行文件，使用内置 Process Compose，不需要 Node、npm、Homebrew 或源码。直接运行源码时需要 Go 与外部 Process Compose，默认 `/opt/homebrew/bin/process-compose`；`WICK_PC` 可覆盖两种运行方式的二进制。`WICK_HOME` 用于覆盖数据目录，例如隔离测试；使用时保持为绝对路径。

服务查询与启停使用 `wick list`、`wick start|stop|restart`；配置修改使用 `wick validate`、`wick apply`；异常恢复使用 `wick recover`。参数以 `wick --help` 为准。更新 App 和移除登记没有专用 CLI 子命令，按下文对应流程执行。

唯一配置是 `$HOME_DIR/services.yaml`，默认位于 `~/Library/Application Support/Wick/services.yaml`。`runtime.yaml` 是生成的 Process Compose 配置，不是另一份配置来源。保留现有服务和设置，只改本次任务涉及的内容。

完成条件：明确本次使用的项目、唯一配置文件、socket 与目标服务；涉及已有进程时，已查明实际 PID、命令、端口和数据位置。

## 登记一个新服务

1. 确认程序或启动脚本能在 macOS 本机运行，使用固定位置的程序、工作目录和数据。已有运行环境可以复用，例如项目里的 Python 虚拟环境。通过绝对路径启动，避免依赖交互式 shell、fnm 激活、自动发现 `.env` 或某个终端的激活状态。
2. 检查目标端口是否被占用。已有服务的接管按下一节处理。
3. 在唯一配置的 `processes` 中增加稳定标识，按下面的格式填写启动信息和展示地址，并按“可用性检查”决定是否配置真实检查。登录自启默认关闭，用户要求时开启。
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
    x-wick:
      title: Memos
      url: http://localhost:5231
```

- `disabled` 必须显式设置。`true` 关闭登录自启，仍允许手动启动；`false` 开启登录自启。修改它只影响下次后台启动，不立即启停服务。
- `x-wick` 是展示信息，`title` 是名称，`url` 是访问地址。
- 每个组成进程须作为非交互式前台程序运行。不要使用 `is_disabled`、交互式/foreground 配置、定时任务、replicas、提权进程或关闭整个项目的设置。
- 未显式配置时，Wick 提供 `on_failure` 恢复策略：最多重试 3 次，间隔 2 秒；每个服务有独立日志，按 1 MiB 轮转并保留 2 份备份，内存日志缓冲为 500 行。
- 可选的 `availability`、`log_location`、`log_configuration`、`shutdown` 和健康检查字段沿用 Process Compose 语法。重试次数和日志大小应有明确上限。

### 可用性检查

单进程与多进程使用同一个 `readiness_probe` 配置，不是由控制台自动检查网页。登记或接管时：

1. 查明服务实际提供的健康接口，或能验证业务可用性的本机命令。HTTP 检查应使用真实地址、端口和路径，先实际请求并确认响应能代表目标服务已可用；exec 检查应在未就绪时失败、就绪时成功。不能编造 `/health`，不能用 PID 存在、端口占用或恒定成功的命令冒充业务检查。
2. 有可靠检查方式时，按 Process Compose 语法配置 HTTP 或 exec `readiness_probe`。依据真实启动时长设置延迟、超时和失败阈值。检查失败可能触发进程恢复；为已有运行服务补检查之前，说明这一行为变化并取得授权，不批量补配。
3. 找不到可靠方式时，省略检查，并向用户明确“只监测进程是否运行，没有持续检查业务可用性”。如果其他组成进程依赖它，须先解决检查方式，不能用假检查绕过 `process_healthy` 的要求。
4. 应用后查询结构化状态中的 `hasProbe`、`is_ready` 和 `displayStatus`，并验证实际入口与日志。单进程 Start 返回只表示进程操作完成，不代表检查已通过；多进程整体 Start 等待各进程就绪，等待规则见下一节。

控制台只在配置了检查且进程正在运行时显示 `Health check`：`Passed` 表示最近检查通过，`Failed` 表示检查未通过，`Checking` 表示尚无结果。没有配置检查或进程已停止时不显示这一项。配置了检查的运行进程可能显示 Starting 或 Unhealthy；未配置检查时，Running 只表示进程活着。检查通过不保证所有业务功能正常。

完成条件：检查方式经过实际验证，或已明确说明没有可靠检查；登记、后台状态、控制台结果的含义一致。没有实际执行的失败与恢复验证，不得声称已验证。

### 多进程服务

一个服务包含多个组成进程时，用顶层 `x-wick.services` 声明归属，原有 `processes` 继续保存启动信息。未归组的进程仍作为原来的单进程服务展示，不需迁移。

```yaml
version: "0.5"
x-wick:
  services:
    neko:
      title: Neko Master
      url: http://127.0.0.1:13000
      disabled: true
      processes: [neko-collector, neko-page]
processes:
  neko-collector:
    command: 'exec "/absolute/path/to/collector"'
    working_dir: /absolute/path/to/neko
    readiness_probe:
      http_get:
        host: 127.0.0.1
        port: 13001
        path: /health
      initial_delay_seconds: 1
      period_seconds: 1
      timeout_seconds: 1
      failure_threshold: 20
    x-wick:
      title: Collector
      ready_timeout_seconds: 30
  neko-page:
    command: 'exec "/absolute/path/to/page"'
    working_dir: /absolute/path/to/neko
    depends_on:
      neko-collector:
        condition: process_healthy
```

这是格式示例，不代表 Neko Master 存在 `/health`。检查方式的选择与验证见上节“可用性检查”。

- 服务标识与进程标识不能冲突，一个进程只属于一个服务。组成进程不设置 `disabled`，服务级开关是唯一自启策略。
- 依赖必须在同一服务内，使用 `process_healthy`，被依赖进程必须提供 `readiness_probe`；未知依赖与环会被拒绝。
- 整体启动等待依赖就绪，失败跳过下游但继续其他独立分支，保留已经运行的进程；再次启动只补齐缺失进程。等待单个进程就绪默认 30 秒，可用进程 `x-wick.ready_timeout_seconds` 设置为 1–300 秒。超时不是自动停止或回滚。
- 整体停止按依赖逆序逐个等待退出，失败继续尝试其他进程并报告错误；整体重启先停止，停止失败则不执行启动。
- 运行中故障按各进程恢复策略处理，不自动连带停止其他进程。控制台展示整体状态与组成进程的就绪状态、退出详情和各自日志；历史失败不会因停止其他进程而清除。
- 自启开启表示下次后台启动按依赖尝试启动全部组成进程，不保证全部成功；关闭整个服务自启不改变当前任何进程的运行状态。

#### 单独操作组成进程

CLI 在服务标识后增加进程标识；控制台详情提供相同操作：

```bash
wick start neko neko-page
wick stop neko neko-page
wick restart neko neko-collector
```

单独启动会自动满足依赖，但不启动无关组成进程。停止只停目标，不连带停止依赖或依赖方。单独重启只重启目标：依赖未就绪时拒绝操作，使用 Start 才会补齐依赖。

停止或重启被其他运行中进程依赖的目标时，控制台提示影响并要求确认；CLI 默认拒绝并列出受影响进程。向用户确认后，才加 `--confirm-impact` 重试。明确授权的操作无需重复确认，但不能用该参数绕过未说明的影响。操作不会改变自启设置。

#### 接管多个旧登记

将同一个服务的全部旧进程纳入同一次盘点和切换，记录依赖与就绪条件。旧自启不一致时向用户展示每项旧设置，确认一个服务级最终策略。切换先按依赖逆序停用旧登记并等待全部旧写入者退出，再按依赖顺序启动 Wick 服务。部分启动失败也不自动重新启用旧登记；保留已运行组成进程、日志和数据，由用户决定修复或授权回退。

### 校验与应用

使用上面定义的 `wick` 命令，校验失败时停止后续应用：

```bash
wick validate && wick apply
```

这些集成脚本使用配套 Process Compose 校验配置，并通过已有接口重新加载生成的 runtime 配置。无效配置在触及运行中服务之前被拒绝。

展示信息和登录自启的修改不会重启服务；启动命令变化或移除登记可能停止或重启受影响的服务。没有自动监听源配置文件的机制，编辑后需要应用。登录自启的生效时机和确认方式见下文“登录自启”。

不要直接执行 `process-compose project update -f services.yaml`：它会绕过 Wick 默认值，且在已测试版本中可能重启已有服务。

### 启动与检查

GUI 与 CLI 使用同一个私有 Unix socket。以下命令中的 `memos` 替换为目标服务标识：

```bash
wick list
wick start memos
```

后台未运行时，先打开一次 Wick。应用配置不会启动未连接的管理器。集成 CLI 返回结构化状态，失败返回非零退出码。不要仅凭 stderr 判断失败；Process Compose 的 config-home debug 信息可能早于日志参数初始化出现。Wick 为子进程显式指定自己的配置目录，避免该无关诊断，不提高服务日志级别。直接调用 PC 时可设置 `PROC_COMP_CONFIG="$HOME_DIR"`。

启动后重新查询结构化状态，用 `curl` 检查实际 URL，并读取近期日志。有检查时确认检查结果；无检查时不能仅凭 Running 声称业务已就绪，验证与报告规则见“可用性检查”。

完成条件：目标服务由 Wick 后台管理，实际入口可访问，程序与数据不依赖临时目录，其他服务未被重启。向用户说明打开方式和自启设置。

## 接管一个已经运行的进程

接管会停止旧实例并按登记命令重新启动，需要用户授权该服务的接管。

1. **盘点与选择**：用监听端口定位所有目标 PID，确认所有者、完整启动参数、工作目录、环境、监听范围、所有数据位置和依赖关系。查明旧管理器与准确登记标识，保存其配置及恢复命令。记录旧登录自启状态：launchd 要结合 plist 的 `RunAtLoad`、`KeepAlive` 及 `launchctl print-disabled gui/$(id -u)`，不能把“当前已加载/正在运行”等同登录自启。无法确认则明确标为未知。展示旧状态，让用户选择最终保留或关闭；用户已明确要求保留原行为时不重复询问。旧进程设置不一致时，说明差异并确认整个服务的最终选择。记录其他已运行服务 PID，作为后续比较基准。
2. **准备**：保留原版本、端口、监听范围和数据路径；没有必要不迁移数据。先将 Wick 登记临时设为不自启，校验并应用，暂不启动新实例。这只是切换保护，不是最终自启选择。保存最终选择及原配置，确保中途失败仍可诊断。
3. **切换**：正常停止并停用已确认的旧管理器登记，避免 `KeepAlive` 重新拉起；launchd 仅处理授权的准确 label，使用 bootout 卸载当前 job，并用 disable 停用以后登录的加载，保留 plist 和原禁用状态作为恢复依据。不默认删除旧登记。等待所有旧 PID 退出、目标端口释放，再交给 Wick。某一步失败就停止推进，不自动拉起旧实例。需要搬移数据时，先等所有写入者退出再一致复制并检查，保留旧目录，不覆盖已有数据。
4. **验证与收尾**：启动 Wick 服务，检查全部组成进程、唯一监听实例、实际访问、采集或业务状态及日志；有数据库则检查完整性与已有数据可用性，不只检查端口。失败时保留现场与日志，不自动回切；若用户授权回退，先停止所有新实例并确认端口释放，有新写入时保留并区分数据，不能直接用旧副本覆盖。成功后按最终选择保存自启设置，校验、应用、重新读取确认；比较无关服务的 PID。

SQLite 的有效数据可能仍在 `-wal` 中，运行中只复制 `.db` 会遗漏数据。使用数据库的一致备份能力，或在正常退出、检查点完成后复制整个数据目录。

完成条件：旧实例已退出，目标端口只有已登记实例监听，实际入口和数据可用，未修改服务 PID 不变。分别报告：①当前运行状态（包括部分运行及失败原因）；②登录自启开启/关闭，下次后台启动生效，包括同会话后台重启；③旧管理器登记是否已停用、恢复信息保留位置。没有实际注销登录就不能声称已验证重新登录。

## 日常操作

查询与启动使用上面的 CLI，停止与重启使用：

```bash
wick stop memos
wick restart memos
```

无需打开控制台，也无需模拟 TUI 按键。

- 手动停止只影响当前运行，不修改登录自启，不触发异常恢复。
- stop 返回时，应用可能仍在退出清理。等待原 PID 消失、监听端口释放后，再离线复制数据或把端口交给另一个实例。
- 修改登录自启按下一节操作。
- 控制台的 Address 行提供 Open in Browser，调用默认浏览器，不保证复用同网址的已有标签页。

完成条件：检查操作后的实际状态；停止时确认进程退出和端口释放，启动时确认入口可访问。涉及自启时，分别说明当前状态和持久设置。

### 登录自启

`services.yaml` 中的 `disabled` 是持久设置：`false` 开启，`true` 关闭。单进程服务设置在进程上，多进程服务设置在 `x-wick.services` 的服务上。下次后台启动时会按此设置生成 runtime 并决定启动哪些服务，包括下次登录和同会话内的后台重新启动。

Apply 会保留已登记服务在旧 `runtime.yaml` 中的 `disabled`，避免修改自启设置影响当前运行状态。因此，Apply 成功后两个文件的值仍可能不同。`runtime.yaml` 用于当前后台运行，不能用它的旧值判断持久设置是否保存成功。控制台的 `Start at login` 开关也只修改源配置，不同步当前 runtime。

1. 记录目标服务当前是否运行及 PID。
2. 编辑 `services.yaml` 中目标服务的 `disabled`（多进程服务只改服务级开关），执行上文的校验与应用命令。
3. 重新读取源配置，确认目标值已保存；查询 socket 中的服务状态，确认当前启停状态未变，运行中的服务保持原 PID。
4. 报告“当前运行/停止；登录自启开启/关闭，下次后台启动生效”。只把实际执行的后台启动检查或注销登录检查称为已验证。

完成条件：源配置的自启设置符合用户要求，当前运行状态未变。runtime 保留旧值时无需重复应用、直接编辑 runtime 或重启后台来消除差异。

### 日志

近期日志 REST 接口使用同一个 socket，路径中的 `memos` 是 `processes` 下的进程标识。多进程服务先用 `wick list` 查看 `components`，逐个查询组成进程（例如 `neko-collector`），不使用分组服务名 `neko`：

```bash
curl --unix-socket "$SOCKET" 'http://localhost/process/logs/memos/0/200'
```

已测试的 Process Compose 版本通过 UDS 使用 CLI 日志流会失败，使用上述接口、控制台的 Show logs，或 `$HOME_DIR/logs` 下的轮转文件。

`$HOME_DIR/startup.log` 保存最近一次 launchd bootstrap 诊断，每次后台启动都会替换。Process Compose 不轮转的内部 debug 日志被送到 `/dev/null`；服务日志使用其原生轮转。日志和配置中的秘密信息保持在本地，不发送到公开位置。

### 异常恢复

自动重试预算按服务当前注册实例累计，不是滑动时间窗口计数器。在 Process Compose v1.122.0 中，普通 CLI start/restart 不会重置已耗尽的预算。

先根据状态、重试次数和日志修复原因，再执行：

```bash
wick recover memos
```

该脚本与控制台 Start 使用相同机制：必要时仅改变目标服务生成的 runtime revision，通过已有服务端重载接口重新登记它。未修改服务保持原 PID，唯一源配置不变。

信号结束的进程可能报告 exit code `-1`，需要结合状态、重试次数和日志判断原因。

## 排查后台连接与服务失败

顶部的 Connected / Connecting / Unavailable 表示后台连接，不表示服务健康。后台可连接但配置有错时，应保留 Connected，并单独显示配置错误。

1. 先查询该 socket 的管理接口。能查询时，查看目标服务状态和日志；配置报错时检查源 YAML。
2. 不能查询时，检查用户级 launchd job `dev.wick.manager` 和最近的 `startup.log`。Unavailable 提供 Reconnect，重新连接并在必要时按现有机制拉起后台。
3. 后台重新启动会按登录自启设置决定启动哪些服务。它不能保证恢复崩溃前的运行列表。
4. 端口冲突时重新核对监听进程。如果是旧实例残留，只在用户授权的目标范围内处理；不要用模糊进程名批量结束进程。

完成条件：明确是后台连接、配置、启动命令、端口还是服务本身的问题。只把实际完成的恢复和检查称为已验证。实际注销再登录与同会话的 launchd 启动验证分开记录。

## 移除登记

移除服务前先确认用户要停止服务还是连同登记一起移除。移除登记会影响该服务的运行；程序、依赖和数据默认保留。应用移除后确认其他服务未受影响。登记本身不授权删除笔记、迁移数据、卸载 OrbStack 或移除 Docker 容器。

1. 用 `wick list` 确认后台可连接，定位目标服务及全部组成进程，记录目标和其他运行中服务的 PID，保存源配置副本。
2. 只需停止时执行 `wick stop <服务标识>`，不修改登记。需要移除时，先停止目标，等待全部目标 PID 退出和端口释放；停止失败则先排查，不继续删除登记。
3. 从 `services.yaml` 的 `processes` 中移除目标登记；多进程服务同时移除对应的 `x-wick.services` 条目及其全部组成进程，不改其他服务。不直接编辑生成的 `runtime.yaml`。
4. 执行 `wick validate && wick apply`。失败时保留配置副本和错误信息，修复后再继续，不声称移除成功。
5. 重新执行 `wick list`，确认目标已不在列表中、旧进程未重新出现，其他服务保持原状态和 PID。程序与数据继续保留在原位置。

完成条件：操作范围与用户要求一致；未授权的数据、程序和其他服务保持不动。报告最终状态，不把配置写入成功当作服务接入成功。

## 更新 Wick

更新控制台与重启后台是不同操作。替换 App 不表示正在运行的 Process Compose 已升级；不要为了更新窗口而停止整个后台。

1. 确认实际运行的 App 或源码位置、目标版本及 `WICK_PC` 是否覆盖了包内版本。记录服务状态、PID、自启设置，保留旧 App 和源配置副本。更新已有授权时不重复询问。
2. 有对应发布包时取得新 App；需要源码构建时，按目标版本 README 构建。使用独立目录或 `WICK_BUILD_OUT` 准备产物，不直接覆盖正在使用的 `dist/`，不覆盖源码中的用户改动。
3. 准备完成后关闭旧控制台，不停止后台。替换固定安装位置的 App，保留数据目录和现有登录任务；不默认移动 App 或改写 LaunchAgent 定义。需要改变安装位置时，先说明对后台启动路径的影响。
4. 从固定位置打开新 App，重新定位配套 CLI，检查 `wick --help`、`wick list`、目标服务实际入口及日志，比较更新前后的状态和 PID。正常打开 App 会更新其后台启动脚本；出现错误时保留旧版本和诊断信息，不用重启整个后台掩盖问题。
5. 若更新要求切换后台版本，先核对当前后台进程的实际路径及版本依据，说明重启将影响全部托管服务；下次启动按登录自启设置运行，不保证恢复当前运行列表。取得这部分影响的授权后再单独安排，不把重启后台当成控制台更新的默认步骤。

完成条件：新控制台和配套 CLI 可用，未授权重启的服务保持原状态和 PID，源配置及数据保留。分别报告控制台是否更新、运行中的后台是否切换；未实际注销再登录时，不声称登录自启已验证。
