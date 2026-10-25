# AGENTS.md

Quick guide for AI coding agents working in `dnd-manager`.

## Project Purpose

- `dnd-manager` is a lightweight, data-driven drag-and-drop library for vanilla JS and frameworks.
- Core package code lives in `src/`.
- Demo app (React + Vite) lives in `demo/` and serves as usage reference.
- Canonical docs are `README.md` (human) and `llms.md` (LLM-oriented API reference).

## Repository Layout

- `src/drag-drop-manager.ts`: main drag-and-drop engine.
- `src/drag-preview-controller.ts`: preview helper for cursor-following clones.
- `src/index.ts`: public exports.
- `tests/unit/`: unit tests for core classes.
- `tests/e2e/`: browser smoke tests (Vitest browser mode + Playwright provider).
- `demo/src/`: demo UI and integration examples.

## Toolchain

- Package manager: `pnpm` (workspace includes `demo`).
- Language: TypeScript (`strict` mode).
- Build: `tsdown`.
- Unit/E2E tests: `vitest`.
- Formatting: `oxfmt`.

## Setup

- Install deps: `pnpm install`
- Run demo dev server: `pnpm dev`

## Common Commands

- Build library: `pnpm build`
- Build demo: `pnpm build:demo`
- Build all: `pnpm build:all`
- Type-check: `pnpm typecheck`
- Unit tests: `pnpm test:unit`
- E2E tests: `pnpm test:e2e`
- Full tests: `pnpm test`
- Coverage: `pnpm test:coverage`
- Format: `pnpm format`
- Check formatting: `pnpm format:check`
- Release: `pnpm release:version <x.y.z> [--dry-run]`

## Releases

- Versions follow semver; commits follow Conventional Commits (`feat:`, `fix:`, `perf:`, `!` or a
  `BREAKING CHANGE:` footer for breaking ones), which become the changelog.
- `pnpm release:version <x.y.z>` (`scripts/release.ts`) runs the checks, sets `package.json`'s
  version, prepends the release's `CHANGELOG.md` section from the commits since the last `v*` tag,
  commits `chore(release): vX.Y.Z` and tags it. It pushes nothing; never bump the version or edit
  `CHANGELOG.md` sections by hand.
- Pushing the tag runs `.github/workflows/release.yml`: it publishes to npm through trusted
  publishing (provenance unless the repository variable `NPM_PROVENANCE` is `false`) and creates the
  GitHub release from the changelog section. Every `v*` tag push publishes; a manual run of the
  workflow is a dry run.
- Agents do not tag, push or publish unless the user asks.

## Coding Expectations

- Keep the package framework-agnostic in `src/` (no React-specific logic in core library code).
- Preserve public API stability unless explicitly asked to make breaking changes.
- Favor small, focused edits over broad refactors.
- Keep imports at file top (no inline imports).
- Use clear, explicit TypeScript types and maintain strict-mode compatibility.
- Follow existing callback and data-attribute conventions (`data-kind`, `data-empty`, etc.).

## Testing Expectations

- For core behavior changes, run at least:
  - `pnpm typecheck`
  - `pnpm test:unit`
- If interaction behavior/UI contract changes, also run:
  - `pnpm test:e2e`
- If demo code is touched, ensure demo still builds:
  - `pnpm build:demo`

## Change Guidelines

- Update docs (`README.md` and/or `llms.md`) when public behavior or API changes.
- Keep examples aligned with real API usage.
- Avoid introducing new dependencies unless needed and justified.
- Do not commit secrets or local-only config.

## Drag-and-Drop Domain Notes

- `DragDropManager` coordinates pointer lifecycle, thresholds, hover state, and drop/cancel flow.
- `onDrop` and `onDragEnd` semantics are important; preserve callback ordering/meaning.
- `onDragEnd(null)` represents cancelled/invalid drops.
- `DragPreviewController` should remain optional convenience, not a hard dependency for core usage.

## Pre-PR Checklist (Agent)

- [ ] Changes are scoped to requested task.
- [ ] Type-check passes.
- [ ] Relevant tests pass.
- [ ] Docs/examples updated if needed.
- [ ] Formatting is clean.
- [ ] No unrelated files were modified intentionally.
