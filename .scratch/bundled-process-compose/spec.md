# Bundled Process Compose and Agent onboarding

## Goal

A new Agent given the GitHub URL can install Wick and register, validate, start and inspect a service without a separate Process Compose, Node, npm or source checkout for normal packaged use.

## Requirements

- Bundle pinned Process Compose 1.122.0 for macOS arm64, verify its download checksum and include its license and attribution.
- Ship an Agent CLI and Skill in the App. Source development may continue using Homebrew or `WICK_PC`.
- Preserve closing-the-window behavior: Electron exits, manager and services continue.
- Default installation is `/Applications/Wick.app`; document the fixed-location requirement.
- Skill linking is optional, never automatic. Ask the user before linking to `~/.agents/skills/wick`; preserve existing unrelated entries.
- Explain `disable-model-invocation: true` conditionally on Agent support, without promising file invisibility.
- Simulate packaged onboarding using an isolated home, no Homebrew/Node in PATH, and only the installed App's CLI and Skill. Retain results.
- Do not replace the user's current App, alter their login job or stop their services. No DMG, Release, signing or relogin in this task.

## Verification boundaries

Packaged CLI and hidden packaged window; real isolated Process Compose and HTTP service; optional Skill installer. Existing tests protect the shared service-management behavior.
