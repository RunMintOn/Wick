# Wick v0.2.0 release

The user authorized publishing 0.2.0 on GitHub. Scope is GitHub only: no promo
video, no external video platform, no social posts. The launch film stays
untracked in `promo/` and out of the README.

## Done

- README drops the "0.2.0 not published yet" banner and installs 0.2.0:
  release tag and asset URLs, macOS 13+, Package size table describing the
  published release instead of a local build.
- Rebuild the release DMG from the committed source, then record its size and
  SHA-256. A rebuild is expected to change the hash; the previously verified
  local build stays only as history in `.scratch/mygo-migration/`.
- Re-run `go vet ./...`, `go test ./...` and `npm run test:e2e` against that DMG.
- Write Chinese release notes covering the MyGo/WKWebView replacement, the
  unchanged UI/CLI/configuration format, and the new macOS 13+ floor. Disclose
  unsigned/unnotarized status, untested logout/re-login, and that 0.1.1 stays
  available for macOS 12.
- Commit the pending `.gitignore`, `AGENTS.md` and `agent-skills/` work, push
  reviewed commits, add an annotated `v0.2.0` tag, then publish the DMG and its
  `.sha256` sidecar.
- Download the published assets and verify their hashes, then check that the
  README install commands resolve against the published release.
- Do not replace the user's `/Applications/Wick.app`, restart the background or
  touch services; it already runs this build.
