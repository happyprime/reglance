# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Reglance is a visual regression tool built with Node.js and Playwright,
distributed as an npm package and installed per-project as a dev dependency. It
captures full-page screenshots across viewports, compares them against a
baseline (controls) with pixelmatch, and generates an interactive HTML report
highlighting visual and HTML differences. The report is a plain HTML file that
`compare` opens via `file://` — there is no report server.

It is published to npm as `@happyprime/reglance` and installed with
`npm install @happyprime/reglance --save-dev`, which exposes a `reglance`
binary.

## Architecture

The package is a thin CLI over a set of focused modules:

- `bin/reglance.mjs` — CLI entry point. Parses the command + flags with
  `node:util` `parseArgs`, loads the config, and dispatches to a command module.
- `src/config.mjs` — Loads and normalizes `reglance.json`. Resolves the domain
  (config or `--domain` flag), builds the list of capture targets
  (`{ key, path, url }`), and derives output directory paths. The domain is
  optional here because `control`/`compare` work on files; `capture` enforces it.
- `src/capture.mjs` — Playwright capture with parallel contexts, retries,
  auto-scroll, and network-idle waiting. Exports `capture(config, options)`.
- `src/control.mjs` — Moves the latest captures into `controls/`.
- `src/compare.mjs` — pixelmatch comparison + HTML diffing. Exports
  `compare(config, options)`; opens the generated report via `file://`.
- `src/report.mjs` — All HTML/report generation and asset copying, driven by the
  templates in `templates/`.

Command modules take the normalized `config` object and an `options` object;
they never read `process.argv` or the config file themselves.

## Configuration

Each consuming project has its own `reglance.json` (see `README.md` and
`reglance.example.json`). Paths are stored relative to a `domain` so a shared
config works across developers who each run against their own local domain.

## Output

All artifacts are written under the configured output directory (`.reglance` by
default), which gets a generated `.gitignore` so nothing is committed to the host
project. Subdirectories: `captures/`, `controls/`, `compares/`, `reports/`,
`assets/`.

## Templates

`templates/` ships with the package (listed in `package.json` `files`):

- `report.html` — Per-comparison visual report with a before/after slider.
- `index.html` — Report index with filtering, sorting, and a diff modal.
- `diff-viewer.html` — Diff modal markup/JS injected into the index.
- `html-diff.html` — HTML diff report for a single comparison.
- `assets/` — `style.css`, `index-style.css`, `script.js`, copied into the
  output directory at compare time.

Placeholders use `{name}` style tokens replaced via `String.replaceAll`.

## File naming

Captures, controls, diffs, and reports are named `{pathKey}-{viewport}` (e.g.
`home-desktop`). There is no project prefix; each project has its own output
directory.

## Development Notes

- ES modules throughout (`"type": "module"`); `.cjs` for CommonJS config files.
- Uses `@happyprime/eslint-config`; tabs for JS, spaces for YAML.
- `npm run lint` / `npm run fix` for style.
- Playwright runs with certificate errors ignored for local `.test` domains.
- `postinstall` downloads headless Chromium.
