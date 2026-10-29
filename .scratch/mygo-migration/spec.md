# Wick MyGo migration

## Agreed scope

- Replace Electron with MyGo's system WebView; retain the web UI.
- Port the service manager, CLI and login bootstrap to Go.
- Keep bundled Process Compose 1.122.0 and existing registration format and commands.
- DMG at most 50 MB (decimal); report installed size as well.
- No Node/Homebrew or first-launch downloads for installed users.
- Apple Silicon, macOS 13+. Existing functionality and service lifetime remain unchanged.
- Build separately from the daily `dist/Wick-darwin-arm64/Wick.app`. Do not replace the daily installation, change its services, install a Skill, or publish a release.

## Acceptance

- Build a self-contained App and DMG with licenses, CLI and Skill.
- Exercise real Process Compose with isolated data: registration, configuration apply without restarting unchanged services, lifecycle, grouped/component actions, autostart and recovery.
- Test CLI from an installed DMG copy without Node/Homebrew in PATH.
- Exercise the actual WebView without opening visible windows, including service survival after closing it.
- Exercise a separately labelled launchd job. Do not log out.
- Report macOS compatibility limits honestly; verification uses macOS 15.7.9, not every supported version.

## Compatibility decision

The user approved raising the minimum from macOS 12 to macOS 13 after inspection
showed that all available MyGo versions require Go 1.27, whose supported minimum
is macOS 13. The App's Info.plist and executable deployment target must agree.
Do not override the Mach-O header to imply unsupported macOS 12 compatibility.

Source: https://go.dev/doc/go1.27#darwin
