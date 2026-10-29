# Third-party software

Packaged Wick includes the unmodified macOS arm64 binary of
[Process Compose 1.122.0](https://github.com/F1bonacc1/process-compose/releases/tag/v1.122.0),
copyright its contributors, licensed under Apache License 2.0.

The upstream LICENSE and README are included in
`Wick.app/Contents/Resources/licenses/process-compose/`.
The build downloads the official release archive and verifies its pinned SHA-256.
Source code: https://github.com/F1bonacc1/process-compose/tree/v1.122.0

Wick uses [MyGo 0.7.3](https://github.com/egoist/mygo/tree/v0.7.3), licensed
under MIT, and the system WKWebView on macOS. No Electron, Chromium, Node.js
or Bun runtime is included.

The Go modules linked into Wick are listed in
`Wick.app/Contents/Resources/licenses/go/modules.txt`, with their upstream
license, copyright, notice and patent files in the corresponding directories.
Wick's MIT license does not replace these third-party licenses.
