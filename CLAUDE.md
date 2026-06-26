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
- `src/image-cache.mjs` — Opt-in disk cache for image responses during capture
  (`imageCache` in `reglance.json`). Keyed by full URL including query string,
  with in-flight coalescing; capture intercepts image requests via
  `context.route()` and fulfills repeats locally instead of hitting the origin.
- `src/compare.mjs` — pixelmatch comparison + HTML diffing. Exports
  `compare(config, options)`; opens the generated report via `file://`.
- `src/downscale.mjs` — area-filter image downscaling. `compare` uses it to
  produce browser-safe display copies of captures that exceed the ~32,767px
  decode limit, while pixelmatch still runs against the full-res originals.
- `src/report.mjs` — Assembles the report data and writes the single-page
  report. `buildHtmlDiff` turns two HTML snapshots into changed-line counts and
  unified-diff hunk JSON; `generateReport` groups the per-slug results into one
  entry per page and embeds them as `window.REGLANCE` in `templates/index.html`.

Command modules take the normalized `config` object and an `options` object;
they never read `process.argv` or the config file themselves.

## Configuration

Each consuming project has its own `reglance.json` (see `README.md` and
`reglance.example.json`). Paths are stored relative to a `domain` so a shared
config works across developers who each run against their own local domain.

## Output

All artifacts are written under the configured output directory (`.reglance` by
default), which gets a generated `.gitignore` so nothing is committed to the host
project. Subdirectories: `captures/`, `controls/`, `compares/` (diff PNGs only),
`display/` (downscaled copies of any capture too large for a browser to render),
`reports/`, `assets/`, and `image-cache/` when the image cache is enabled.

## Templates

`templates/` ships with the package (listed in `package.json` `files`):

- `index.html` — The single-page report shell. Two placeholders: `{title}` (the
  escaped site name) and `{data}` (the script-safe `window.REGLANCE` JSON blob),
  both replaced via `String.replaceAll`.
- `assets/reglance.css` — The report stylesheet (the "Quiet" design direction:
  system font stack, indigo accent, auto light/dark via `light-dark()`).
- `assets/app.js` — Vanilla (no framework, no network) renderer. Reads
  `window.REGLANCE`, routes on the location hash, and renders the overview,
  comparison (five modes), and HTML-diff views with full keyboard triage.

The design source lives in `design_handoff_reglance_report/` — React/Babel
prototypes kept for reference only (ignored by eslint); production is the
vanilla code above.

## File naming

Captures, controls, and diffs are named `{pathKey}-{viewport}` (e.g.
`home-desktop`; diffs add a `-diff` suffix). There is no project prefix; each
project has its own output directory. The report itself is a single
`reports/index.html`.

## Development Notes

- ES modules throughout (`"type": "module"`); `.cjs` for CommonJS config files.
- Uses `@happyprime/eslint-config`; tabs for JS, spaces for YAML.
- `npm run lint` / `npm run fix` for style.
- Playwright runs with certificate errors ignored for local `.test` domains.
- `postinstall` downloads headless Chromium.
