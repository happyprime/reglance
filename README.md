# Reglance

Visual regression at a glance. Reglance screenshots a site across viewports,
compares each page against a saved baseline, and opens an HTML report of the
visual and HTML differences. It installs per-project and is configured with one
`reglance.json` file.

## Quick start

1. Install (downloads a headless Chromium on install):

   ```bash
   npm install @happyprime/reglance --save-dev
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
| `viewports`         | no       | `[{ name, width, height, deviceScaleFactor? }]`. Defaults to `desktop` (1920×1080), `mobile` (390×844). |
| `output`            | no       | Output directory. Defaults to `.reglance`.                                         |
| `pixelmatchOptions` | no       | [pixelmatch](https://github.com/mapbox/pixelmatch) options, e.g. `{ "threshold": 0.1 }`. |
| `timeouts`          | no       | `{ goto, settle }` in ms. Navigation and post-scroll network-idle waits. Defaults `{ goto: 15000, settle: 8000 }`. Raise `settle` for slow, lazy-loading pages. |
| `blockHosts`        | no       | Hostnames to block requests to during capture, e.g. `["challenges.cloudflare.com"]`. Each entry also blocks its subdomains. |

`domain` is only needed by `capture`; `control` and `compare` work on the files
already captured. See [`reglance.example.json`](reglance.example.json) for a full
example.

`blockHosts` aborts every request to the listed hosts (and their subdomains)
before it leaves the browser. Use it for third-party embeds that keep the
network busy and stall capture — CAPTCHA widgets like Cloudflare Turnstile,
ad tech, analytics — or that render differently on every load and pollute
diffs. Captures wait for the network to go idle, so a widget that polls or
retries indefinitely will otherwise time out every viewport on pages that
embed it. Entries are bare hostnames; `"kit.com"` blocks `kit.com` and
`pinchofyum.kit.com` alike.

A viewport's optional `deviceScaleFactor` (device pixel ratio) renders the page
as it would appear on a higher-density display — use `2` for a retina capture,
`3` for some phones. It defaults to `1`. Captures sharing a DPR run in one
browser context; a new DPR opens a fresh context, so prefer grouping retina and
non-retina variants rather than scattering them. Note that a `2×` screenshot is
twice the pixel dimensions of its `1×` counterpart, so changing the
`deviceScaleFactor` of an existing viewport will diff against its controls as
fully changed until you re-run `reglance control`.

A `paths` value may be a full URL pointing at a different host than `domain`.
This is supported, but `capture` prints a warning listing such paths so
off-domain navigation is a conscious choice — keep configs from trusted
sources, since the report renders captured content.

## Commands

| Command             | Description                                                          |
| ------------------- | ------------------------------------------------------------------- |
| `reglance capture`  | Screenshot every path across all viewports into `.reglance/captures`. |
| `reglance control`  | Promote the latest captures to the baseline (`.reglance/controls`).   |
| `reglance compare`  | Diff the latest captures against the baseline and open an HTML report. |

Append path keys to limit a command to specific pages:
`npx reglance capture home blog`.

## Options

| Flag                       | Command | Description                                                                       |
| -------------------------- | ------- | --------------------------------------------------------------------------------- |
| `--domain=<host>`          | capture | Override the configured domain for this run.                                      |
| `--concurrency=<n>`        | capture | Parallel browser contexts (default: 4). Must be a positive integer.               |
| `--stagger=<ms>`           | capture | Delay between starting contexts (default: 500). `0` disables staggering.          |
| `--skip-reload`            | capture | Reuse the page between viewports instead of reloading.                            |
| `--fail-on-degraded`       | capture | Exit non-zero if any page failed to load cleanly (for CI). Default: warn, exit 0. |
| `--insecure`               | capture | Ignore TLS certificate errors for non-local hosts (already ignored for `.test`/localhost). |
| `--compare-concurrency=<n>`| compare | Parallel diff workers (default: CPU count − 1). Lower it for very tall pages.      |
| `--no-open`                | compare | Don't open the report when finished.                                              |
| `--config=<path>`          | any     | Path to the config file (default: `reglance.json`).                               |

### Per-developer domains

`domain` is the shared default; override it per run so teammates can point at
their own local site without editing the config:

```bash
npx reglance capture --domain=site2.test
```

### Trustworthy baselines

A baseline is only useful if it reflects pages that actually loaded. reglance
guards against silently baselining bad data:

- If a page never loads cleanly (after retries), `capture` reports it as
  degraded instead of treating it as a success. Add `--fail-on-degraded` to
  make the run exit non-zero in CI.
- `control` records each promotion in `.reglance/controls/manifest.json` and
  warns when it promoted fewer captures than expected (so the untouched
  controls are now stale). `compare` warns when the baseline mixes controls
  from more than one `control` run.

## Output

```
.reglance/
	captures/   Latest screenshots + HTML snapshots
	controls/   Baseline screenshots + HTML (+ manifest.json)
	compares/   Diff images and HTML diffs
	reports/    The report — open reports/index.html
```

## Development

```bash
npm run lint   # check style
npm run fix    # auto-fix style
```
