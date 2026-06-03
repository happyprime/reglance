# Reglance

Visual regression at a glance. Reglance screenshots a site across viewports,
compares each page against a saved baseline, and opens an HTML report of the
visual and HTML differences. It installs per-project and is configured with one
`reglance.json` file.

## Quick start

1. Install (downloads a headless Chromium on install):

   ```bash
   npm install happyprime/reglance --save-dev
   ```

2. Add a `reglance.json` to the project root. List page paths relative to a
   default `domain`:

   ```json
   {
   	"name": "My Site",
   	"domain": "https://site.test",
   	"paths": {
   		"home": "/",
   		"blog": "/blog",
   		"single-post": "/blog/sample-post"
   	}
   }
   ```

3. Run the workflow:

   ```bash
   npx reglance capture   # screenshot every path (against the good state)
   npx reglance control   # save those captures as the baseline
   # ...make your changes...
   npx reglance capture   # screenshot again
   npx reglance compare   # diff against the baseline and open the report
   ```

`control` is run once to set the baseline; `capture` + `compare` are repeated to
check changes against it. Output (captures, baseline, report) goes to a
self-ignored `.reglance/` directory — nothing to add to `.gitignore`.

## `reglance.json`

| Field               | Required | Description                                                                       |
| ------------------- | -------- | --------------------------------------------------------------------------------- |
| `paths`             | yes      | Map of `key` → path. A value may be a full URL to point at a different domain.     |
| `domain`            | capture  | Default domain. A bare host (`site.test`) becomes `https://site.test`.             |
| `name`              | no       | Label shown in the report. Defaults to the domain host.                           |
| `viewports`         | no       | `[{ name, width, height }]`. Defaults to `desktop` (1920×1080), `mobile` (390×844). |
| `output`            | no       | Output directory. Defaults to `.reglance`.                                         |
| `pixelmatchOptions` | no       | [pixelmatch](https://github.com/mapbox/pixelmatch) options, e.g. `{ "threshold": 0.1 }`. |

`domain` is only needed by `capture`; `control` and `compare` work on the files
already captured. See [`reglance.example.json`](reglance.example.json) for a full
example.

## Commands

| Command             | Description                                                          |
| ------------------- | ------------------------------------------------------------------- |
| `reglance capture`  | Screenshot every path across all viewports into `.reglance/captures`. |
| `reglance control`  | Promote the latest captures to the baseline (`.reglance/controls`).   |
| `reglance compare`  | Diff the latest captures against the baseline and open an HTML report. |

Append path keys to limit a command to specific pages:
`npx reglance capture home blog`.

## Options

| Flag                | Command | Description                                            |
| ------------------- | ------- | ------------------------------------------------------ |
| `--domain=<host>`   | capture | Override the configured domain for this run.           |
| `--concurrency=<n>` | capture | Parallel browser contexts (default: 4).                |
| `--stagger=<ms>`    | capture | Delay between starting contexts (default: 500).        |
| `--skip-reload`     | capture | Reuse the page between viewports instead of reloading. |
| `--no-open`         | compare | Don't open the report when finished.                   |
| `--config=<path>`   | any     | Path to the config file (default: `reglance.json`).    |

### Per-developer domains

`domain` is the shared default; override it per run so teammates can point at
their own local site without editing the config:

```bash
npx reglance capture --domain=site2.test
```

## Output

```
.reglance/
	captures/   Latest screenshots + HTML snapshots
	controls/   Baseline screenshots + HTML
	compares/   Diff images and HTML diffs
	reports/    The report — open reports/index.html
```

## Development

```bash
npm run lint   # check style
npm run fix    # auto-fix style
```
