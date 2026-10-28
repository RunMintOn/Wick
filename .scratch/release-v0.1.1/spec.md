# Wick v0.1.1 release

The user authorized completing the remaining release steps and publishing without further approval, unless blocked on credentials or a material decision.

## Done

- Version 0.1.1 in package manifest, lockfile and App metadata; leave v0.1.0 unchanged.
- Reproducible DMG creation using macOS tools, containing Wick.app and an Applications shortcut, plus a SHA-256 sidecar.
- README prioritizes downloading the release; source builds remain optional.
- Test the actual DMG by mounting without opening Finder, copying the App to a temporary install location, unmounting, then exercising the packaged Agent workflow without Node/Homebrew in PATH.
- Final audit, typecheck, integration tests and hidden-window tests pass. Preserve current services.
- Update the daily App at its existing location with the tested release; retain a backup, do not restart the background or services.
- Push reviewed commits and an annotated v0.1.1 tag, publish DMG and checksum, then download the public assets and verify their hashes.
- Clearly disclose Apple Silicon/macOS 12+, unsigned/unnotarized status and untested actual logout/re-login. Do not perform relogin.
