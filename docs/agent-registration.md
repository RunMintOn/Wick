# Agent service registration

LocalDeck manages installed native programs on this Mac. It does not install programs, dependencies, or migrate data. Use this guide when a user asks you to register an already prepared service.

## One configuration

The authoritative file is `~/Library/Application Support/LocalDeck/services.yaml`. `LOCALDECK_HOME` overrides this directory for isolated testing. Do not edit `runtime.yaml`: it is a generated Process Compose configuration, not another source of truth.

Add a named entry to `processes`. Keep all existing entries and settings. Identifiers use letters, digits, dots, underscores and hyphens. Use absolute executable and working-directory paths. Do not depend on an interactive shell, fnm activation, `.env` discovery, or a temporary directory.

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

`disabled: true` means login autostart is off, not that manual start is forbidden. `false` means login autostart is on. Set the field explicitly. Changing it affects the next background startup, not the current service state. `x-localdeck` is display metadata. Do not use `is_disabled`, interactive/foreground processes, schedules, replicas, elevated processes or settings that shut down the whole project. First-version services should be independently runnable foreground programs.

When absent, LocalDeck supplies an `on_failure` restart policy with 3 retries and 2-second backoff, a per-service log file, 1 MiB rotation with 2 backups, and a 500-line in-memory log buffer. Optional explicit `availability`, `log_location`, `log_configuration`, `shutdown` and health-check fields use Process Compose syntax; keep retry and log limits finite. Configuration is YAML; do not convert it to a second format.

## Validate and apply

From the LocalDeck project directory:

```bash
npm run validate
npm run apply
```

These small integration scripts validate with the installed Process Compose and reload its generated runtime configuration through its existing interface. They are not a new command framework. Invalid configuration is rejected before touching running services.

Do not use `process-compose project update -f services.yaml` directly: it would bypass LocalDeck's defaults and can restart existing services in the tested version. Display-only changes and login-autostart changes do not restart services when applied through LocalDeck. Changed startup commands or removed registrations can stop/restart the affected service. There is no automatic source-file watcher.

## Start and check

GUI and CLI use the same private Unix socket:

```bash
PC=/opt/homebrew/bin/process-compose
SOCKET="$HOME/Library/Application Support/LocalDeck/control.sock"
"$PC" -U -u "$SOCKET" process list -o json
"$PC" -U -u "$SOCKET" process start memos
"$PC" -U -u "$SOCKET" process stop memos
"$PC" -U -u "$SOCKET" process restart memos
```

Open LocalDeck once to start its background manager if it is not running. Applying configuration does not start a disconnected manager. After registration, verify the structured state and the service's actual URL with `curl`. Running is a process state, not a guarantee of HTTP readiness. Check for existing owners of the requested port before moving an already-running service under management; do not silently stop unrelated processes.

## Logs and failures

The recent-log REST endpoint works over the same socket:

```bash
curl --unix-socket "$SOCKET" 'http://localhost/process/logs/memos/0/200'
```

The tested Process Compose release's CLI log streaming failed over UDS; use the endpoint or the rotated files under the LocalDeck `logs` directory. The control panel shows recent logs too. Its top indicator reports background connectivity, separately from configuration errors and service health; Unavailable offers Reconnect. Open in Browser is beside the service Address. `startup.log` holds the latest launchd bootstrap diagnostics and is replaced on each background startup. Process Compose's unrotated internal debug log is sent to `/dev/null`; service logs use its native rotation. Never send secrets from logs or configuration to a public destination.

Automatic retries use Process Compose's per-incarnation restart budget, not a time-window counter. In v1.122.0 ordinary CLI start/restart does not reset an exhausted budget. LocalDeck's Start changes only that service's generated runtime revision and uses the existing server-side reload interface to re-register it when needed. Unchanged services keep their PID. Agents can use `npm run recover -- memos` after fixing the cause; this small integration script performs the same operation. A new runtime revision is generated, not a change to the authoritative configuration. Manual stop does not trigger automatic recovery. A signal-terminated process may report exit code `-1`; inspect the status, retry count and logs together.

A stop command may return before the application finishes its shutdown. Wait for the original PID to disappear and the port to be released before offline data copying or handing the port to another instance. Existing-process takeover is described in the Chinese LocalDeck Skill.

Removing a registration does not remove executable files or user data. Apply removal only when requested. Registration alone does not authorize deleting notes, migrating data, uninstalling OrbStack or removing Docker containers. Treat an explicitly requested takeover or data move as a separate operation.
