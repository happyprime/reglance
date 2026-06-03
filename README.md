# Reglance

Visual regression at a glance.

Reglance captures full-page screenshots of a site across multiple viewports,
compares them against a baseline, and generates an interactive HTML report that
highlights both visual and HTML differences. It's installed per-project as a
dev dependency and configured with a small `reglance.json` file.

## Installation

```bash
npm install happyprime/reglance --save-dev
```

Reglance uses [Playwright](https://playwright.dev/) and downloads a headless
Chromium build on install.

## Configuration

Add a `reglance.json` file to your project root. Paths are listed relative to a
domain so the same config works for everyone on the team — each developer can
point it at their own local domain.

```json
{
	"name": "My Site",
	"domain": "https://site.test",
	"paths": {
		"home": "/",
		"blog": "/blog",
		"single-post": "/blog/single-post"
	},
	"viewports": [
		{ "name": "desktop", "width": 1920, "height": 1080 },
		{ "name": "mobile", "width": 390, "height": 844 }
	],
	"pixelmatchOptions": {
		"threshold": 0.1
	}
}
```

| Field               | Required | Description                                                                 |
| ------------------- | -------- | --------------------------------------------------------------------------- |
| `domain`            | no\*     | Default domain. A bare host (`site.test`) is treated as `https://`.         |
| `paths`             | yes      | Map of path keys to paths. A value may also be a full URL to a 2nd domain.  |
| `name`              | no       | Label shown in reports. Defaults to the domain host.                        |
| `viewports`         | no       | Viewports to capture. Defaults to `desktop` (1920×1080) and `mobile` (390×844). |
| `output`            | no       | Output directory. Defaults to `.reglance`.                                  |
| `pixelmatchOptions` | no       | [pixelmatch](https://github.com/mapbox/pixelmatch) comparison options.      |

\* `domain` is required for `capture` only — provide it in the config or with
the `--domain` flag. `control` and `compare` operate on already-captured files.

A starting point is available in [`reglance.example.json`](reglance.example.json).

### Overriding the domain

Your local site might be `site.test` while a teammate uses `site2.test`. Set a
default `domain` in the config and override it per-run:

```bash
npx reglance capture --domain=site2.test
```

## Usage

Add scripts to your project's `package.json`:

```json
{
	"scripts": {
		"visual:capture": "reglance capture",
		"visual:control": "reglance control",
		"visual": "reglance capture && reglance compare"
	}
}
```

The typical workflow:

```bash
# 1. Capture a baseline against the known-good state, then promote it.
npx reglance capture
npx reglance control

# 2. Make your changes, then capture and compare against the baseline.
npx reglance capture
npx reglance compare
```

`compare` opens the generated report in your browser when it finishes (pass
`--no-open` to skip that). The report is a plain HTML file under
`.reglance/reports/index.html`, so you can also reopen it any time.

### Commands

| Command             | Description                                                              |
| ------------------- | ------------------------------------------------------------------------ |
| `reglance capture`  | Screenshot every path across all viewports into `captures/`.             |
| `reglance control`  | Promote the latest captures to `controls/` (the comparison baseline).    |
| `reglance compare`  | Compare the latest captures to the controls and build an HTML report.    |

Pass one or more path keys after a command to limit it to those paths:

```bash
npx reglance capture home blog
```

### Options

| Flag                | Applies to | Description                                              |
| ------------------- | ---------- | ------------------------------------------------------- |
| `--domain=<host>`   | capture    | Override the configured domain.                         |
| `--config=<path>`   | all        | Path to the config file (default: `reglance.json`).     |
| `--concurrency=<n>` | capture    | Parallel browser contexts (default: 4).                 |
| `--stagger=<ms>`    | capture    | Delay between starting contexts (default: 500).         |
| `--skip-reload`     | capture    | Reuse the page between viewports instead of reloading.  |
| `--no-open`         | compare    | Don't open the report automatically.                    |

## Output

Everything is written under the output directory (`.reglance` by default), which
reglance keeps out of version control with its own `.gitignore`:

```
.reglance/
	captures/   The latest screenshots and HTML snapshots.
	controls/   The baseline screenshots and HTML.
	compares/   Generated diff images and HTML diffs.
	reports/    The interactive HTML report (index.html + per-page reports).
	assets/     CSS/JS for the report UI.
```

## Development

```bash
npm run lint   # Check code style.
npm run fix    # Auto-fix style issues.
```
