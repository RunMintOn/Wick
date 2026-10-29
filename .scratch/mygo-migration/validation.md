# MyGo migration verification

## Result

Wick 0.2.0 now uses MyGo 0.7.3 and the system WKWebView. The service manager,
CLI and login bootstrap are Go; Process Compose 1.122.0 remains bundled.
The web interface and existing configuration format are retained.

| Artifact | Bytes | Decimal MB |
|---|---:|---:|
| Published 0.1.1 DMG | 158,078,498 | 158.08 |
| Local 0.2.0 DMG | 23,379,558 | 23.38 |
| Local 0.2.0 App, files expanded | 56,323,596 | 56.32 |

Download size decreased **85.21%**, exceeding the agreed <=50 MB target.
These are disk sizes, not RAM measurements.

- App: `build/Wick-darwin-arm64/Wick.app`
- DMG: `build/Wick-0.2.0-darwin-arm64.dmg`
- Checksum: `build/Wick-0.2.0-darwin-arm64.dmg.sha256`
- SHA-256: `891ee6a6fe4f08ea5d573eea75fa2e248a144e32bff8eec6bfaeaac1c567f261`

## Verification performed

- `go test -count=1 ./...`: passed. Real isolated Process Compose exercises
  lifecycle, unchanged-PID configuration apply, source comments and edit tokens,
  login policy, grouped/component actions and impact confirmation, finite recovery
  and target-only retry-budget reset, configuration errors and health states.
- `go vet ./...`: passed.
- An isolated launchd job ran the Go bootstrap, started enabled services, left
  manual-only services stopped and preserved a manual stop on repeated setup.
- Final `npm run dmg` and `npm run test:e2e`: passed, 2 E2E tests.
- DMG checksum checked; mounted without Finder, App copied to a path containing
  spaces and DMG unmounted before launching the installed App.
- Installed release App and CLI worked with no Node/Homebrew in PATH, using the
  bundled Process Compose and a compiled HTTP fixture service.
- CLI start/stop/restart and optional Skill linking worked. An unrelated existing
  Skill was preserved. No Skill was installed in the user's real home.
- Actual hidden WKWebView rendered the interface, invoked Go bindings, started
  a service, displayed logs, persisted autostart without changing its PID,
  and exercised the confirmation dialog.
- Closing the WebView left the HTTP service reachable with the same PID.
  The WebView test uses an E2E-only automation build; the installed-release test
  uses the release executable. The production executable excludes automation.
- Info.plist minimum and executable `LC_BUILD_VERSION` both declare macOS 13.0.
- `git diff --check`: passed.

Logs, installation observations and a WebView screenshot are in `evidence/`
(gitignored). Go tests were completed before the final metadata/dialog-only
changes; the affected installation and WebView tests were rerun on the final DMG.

## Limits and delivery

Verification ran on macOS 15.7.9 arm64, Go 1.27.3. macOS 13 and 14 were not
directly tested. The user approved macOS 13+ after the Go 1.27 compatibility
constraint was discovered. Actual logout/re-login and browser-download
Gatekeeper interaction were not tested. The App remains unsigned/unnotarized.

No commit, push or GitHub Release publication was performed.
The published 0.1.1 Release remains unchanged; 0.2.0 is a local build.

## Daily installation replaced (2026-10-30)

After the migration was verified, the user asked to replace their own install.
The console was quit, the new App copied to `/Applications/Wick.app`, the old
Electron bundle moved to Trash, and the stale Dock entry repointed.

- Seven services kept running with unchanged PIDs throughout.
- `~/Library/Application Support/Wick` was reused as-is: same `services.yaml`,
  logs and service data; no migration step was needed.
- Launching the new App rewrote `bootstrap.sh` and the `dev.wick.manager` plist
  to the `/Applications` path. Re-running `bootstrap.sh` exited 0 without
  starting a second manager.
- The live console showed 6 of 12 services running with the same PIDs as the
  Process Compose API reported before the swap (`evidence/live-console.png`).
- The already-running manager keeps its old executable image until the next
  login; the same Process Compose 1.122.0 binary is used either way.
