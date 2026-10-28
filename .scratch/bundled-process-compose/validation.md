# Verification — 2026-10-28

Base: `8ead7fcaec627b651ec2909c1436f4a982c743f4`.
Requirements: [spec.md](spec.md).

## Results

- Copied a clean source snapshot (without node_modules, build outputs or download caches) into `/tmp/wick-clean-source.k8ZwrI`. `npm install`, `npm run build` and `npm run check` succeeded.
- Built separately with `WICK_BUILD_OUT=/tmp/wick-bundled-validation`, leaving the user's daily `dist/` App untouched. Confirmed custom-output builds do not bundle the repository's existing `dist/`.
- Full integration suite: 25 passed, 0 skipped.
- Hidden Electron E2E suite: 9 passed.
- After final packaging/report fixes, reran both packaged tests: 2 passed.
- Final source typecheck and `git diff --check` passed.

## Fresh-install simulation

The packaged test copies only the App into a temporary user's `Applications/`, at a path containing spaces. Its CLI runs with PATH `/usr/bin:/bin:/usr/sbin:/sbin` and without `WICK_PC`. It reads and executes the installed Skill's setup instructions. Neither the Agent commands nor the test service require source files, system Node/npm or Homebrew.

Verified:

- Actual background executable is the installed App's bundled Process Compose.
- Default startup does not create a Skill symlink.
- Validate, apply, start, list, stop and restart work; HTTP response is checked.
- Native window close exits all four observed console processes; the service remains reachable with unchanged PID.
- Explicit Skill linking targets the App, is idempotent, and preserves another user's existing Skill.
- Process Compose and Electron license files accompany the App.
- A separate unique-label launchd test starts the bundled Process Compose using packaged Electron.

Latest machine-readable observations: [evidence/packaged-agent.json](evidence/packaged-agent.json) (local, gitignored). Test backgrounds were stopped after verification. The final temporary installed App remains available for inspection.

## Review

Reviewed the complete change against repository instructions and the spec in the current context, without subagents.

- Standards: no remaining blocking findings. CLI dispatch reuses existing service/configuration implementations rather than duplicating management behavior.
- Spec: no remaining blocking findings. Review caught and fixed missing App-only Electron licenses, nested `dist/` inclusion in custom builds, and results being overwritten by Playwright's output cleanup.

## Limits and unrelated observations

- No actual logout/re-login, Gatekeeper download/quarantine test, DMG or GitHub Release.
- This is an automated, isolated simulation of the documented Agent workflow, not a separate model/session independently interpreting the GitHub page.
- The user's real login plist and bootstrap hashes were identical before/after the main test run. Existing services retained their running/stopped states and PIDs.
- `npm install` / `npm audit` reported two existing high-severity dependency entries: Electron and transitive undici. Dependency manifests/lockfile were not upgraded as part of this task; assess these separately before public release.
