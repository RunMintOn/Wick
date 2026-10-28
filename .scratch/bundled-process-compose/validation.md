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

## Follow-up: daily App updated — 2026-10-28

After the user authorized proceeding, rebuilt source commit `3c8fed9` into `/tmp/wick-final-local` and reran both packaged tests (2 passed) and the source typecheck. This build includes the final Skill edits and README memory observations.

Replaced only `dist/Wick-darwin-arm64/Wick.app`, at its existing location. Opened the new App with a hidden window against the real background, queried its state, then closed the window.

- Exactly one real Wick manager remained; its PID and executable were unchanged (existing Homebrew Process Compose).
- All 11 service entries, including component PIDs and autostart settings, matched the pre-update snapshot.
- Source configuration, generated runtime and login plist hashes were unchanged.
- The normal App startup updated `bootstrap.sh` to use the bundled Process Compose on the next background startup. No current background/service restart was performed.
- All observed console processes exited after window close.
- Installed README and Skill hashes match the source files.
- The existing `~/.agents/skills/wick` source symlink was left unchanged.

Old App, bootstrap and source configuration are preserved locally in `evidence/backups/wick-before-bundled.Utw1BX/` (gitignored, contains private local configuration). Before/after observations and a hidden-window screenshot are in `evidence/local-update-before.json`, `evidence/local-update-after.json` and `evidence/local-updated-console.png`. No existing service actions or full business-level HTTP checks were performed during the real-environment probe.

No relogin, dependency upgrades, push, DMG or Release in this follow-up. The user's normal App path still lives under `dist/`; do not remove or move that directory. A future default build overwrites this App, so use an independent `WICK_BUILD_OUT` for further verification.

## Follow-up: bundled background activated — 2026-10-28

The user explicitly accepted stopping and restarting all managed services to switch to the App's bundled Process Compose immediately.

- Recorded all running/stopped states, component PIDs, autostart settings and HTTP response codes before shutdown.
- Validated configuration with the bundled binary, normally shut down the old Homebrew manager, and waited for its process and the observed service descendants to exit.
- Started the bundled manager through the existing `dev.wick.manager` login job, without unloading or changing its definition.
- Restored the previous running set, including services with login autostart disabled. All 6 previously running services are running; all 5 previously stopped services remain stopped.
- All 6 running service entry points returned the same HTTP response codes as before (five 200s and one 307 redirect). This is an entry-point check, not a full business/data audit.
- Confirmed exactly one real manager, now using `dist/Wick-darwin-arm64/Wick.app/Contents/Resources/bin/process-compose` version 1.122.0; launchd supervises that PID.
- Source configuration, login definition and bootstrap hashes were unchanged. Generated runtime was regenerated as part of normal background startup.
- Opened the new console in a hidden window, confirmed it connected, then closed it. All service/component PIDs stayed unchanged across that window-close check, and only the bundled manager remained.

Detailed before/after observations: `evidence/background-switch.json` (local, gitignored). Homebrew Process Compose remains installed but is no longer the running Wick manager. Actual logout/re-login was still not performed.
