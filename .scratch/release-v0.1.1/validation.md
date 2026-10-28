# Wick v0.1.1 verification — 2026-10-28

## Artifact

- Built independently with `WICK_BUILD_OUT=/tmp/wick-release-v0.1.1 npm run dmg`.
- Image: `Wick-0.1.1-darwin-arm64.dmg`, approximately 151 MiB.
- SHA-256: `e5e049745bdf0681f6d636e40a592497bab5fcf34cace927976ff7c5e2e767aa`.
- App short version and build version both 0.1.1; main executable and Process Compose are arm64.
- Electron 43.8.4, bundled Process Compose 1.122.0.
- App contains the CLI, Skill, Process Compose license and Electron license files. Source/private evidence, download caches and previous builds are excluded.

## Tests

- Typecheck and `git diff --check`: passed.
- Dependency audit: 0 known vulnerabilities.
- Full integration suite with the release App and DMG: 26 passed, 0 skipped.
- Hidden-window E2E suite: 9 passed.
- DMG checksum and `hdiutil verify`: passed.
- DMG mounted read-only without Finder; verified Applications shortcut, copied App to a temporary path containing spaces, then unmounted before launching the installed copy.
- The installed copy passed packaged Agent onboarding: no system Node/Homebrew in command PATH, bundled background, service HTTP access, start/stop/restart, optional Skill linking with existing-entry preservation, and service survival after window close.
- Fixed the DMG test's child runner to clear inherited `NODE_TEST_CONTEXT`; the child now actually executes its test instead of inheriting the parent runner context.

## Daily installation

Updated only the existing `dist/Wick-darwin-arm64/Wick.app` to the tested release App, including the security fixes. Prior App, bootstrap and source configuration are preserved in `evidence/backups/before-v0.1.1/` (gitignored).

Opened the updated App in a hidden window, queried its real background, then closed it. All 11 service entries/component PIDs and autostart settings were unchanged. Exactly one daily Process Compose remained, with the same manager PID. Source configuration, generated runtime and login definition hashes were unchanged. Existing Skill symlink was preserved.

Local before/after observations: `evidence/local-release-before.json` and `evidence/local-release-after.json`. DMG installation observations: `evidence/dmg-install.json`.

## Review and limits

Reviewed the complete release diff against repository standards and [spec.md](spec.md), in the current context without subagents. No remaining blocking findings.

Actual logout/re-login remains untested by user choice. The release is unsigned and unnotarized; the documented quarantine-removal procedure has not been independently exercised through a browser download/Gatekeeper dialog. Tests ran on macOS 15.7.9 arm64, not every supported macOS version. The current daily App still lives under `dist/`; do not delete or move that directory.

Remote publication and public-download verification are performed after committing/tagging these files; their live results are retained locally in `evidence/public-release.json`.
