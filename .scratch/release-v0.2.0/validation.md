# Wick v0.2.0 release verification — 2026-10-30

## Artifact

- Built from commit `7613cbb` plus the release README changes with `npm run dmg`.
- Image: `Wick-0.2.0-darwin-arm64.dmg`, 23,379,589 bytes (23.38 MB decimal).
- SHA-256: `ed683b8ff10fbc6e1efa7558582e45653d6fbe3c10143c3d20bec360db2d9f6d`.
- App, files expanded: 56,323,655 bytes (56.32 MB). `du` reports 54 MiB because
  it counts allocated blocks, not file sizes.
- Mounted read-only without Finder: contains `Wick.app` and an `Applications`
  shortcut. `CFBundleShortVersionString` and `CFBundleVersion` are both 0.2.0,
  `LSMinimumSystemVersion` is 13.0, the executable is thin arm64, and no
  Electron framework is present.
- `hdiutil verify` reports a valid checksum. The App is unsigned
  (`codesign -dv` shows the ad-hoc `a.out` identity), as disclosed in the notes.

The DMG hash differs from the earlier local build recorded in
`.scratch/mygo-migration/validation.md` because DMG creation is not
bit-reproducible; that file stays as the migration's own record.

## Tests

- `go vet ./...`: passed.
- `go test -count=1 ./...`: passed (`internal/wick`, 19.48s, real bundled
  Process Compose).
- `npm run test:e2e`: 2 passed — the DMG mount/copy/unmount install flow with
  no Node or Homebrew in PATH, and the hidden WKWebView test that starts a
  service, reads logs, persists autostart and leaves the service running after
  the window closes.

Logs: `/tmp/wick-dmg-020.log`, `/tmp/wick-tests-020.log` (session-temporary).

## Limits

- Verified on macOS 15.7.9 arm64 only; macOS 13 and 14 were not run.
- Actual logout/re-login and browser-download Gatekeeper interaction remain
  untested, matching 0.1.1's limits.
- The user's `/Applications/Wick.app` already runs this build and was not
  replaced again; no background restart or service change was performed here.
- Promo video, external hosting and social posts are out of scope for this
  release and were not touched.
