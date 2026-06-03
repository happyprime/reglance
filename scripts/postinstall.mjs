#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

// reglance is installed as a dev dependency, so this hook runs inside every
// consuming project's install. It must never fail that install: a blocked CDN,
// an air-gapped runner, or a proxy should degrade gracefully, not abort
// `npm ci` for the whole project.

// Honor the standard Playwright skip flag (CI that doesn't capture, or that
// provisions Chromium separately). The explicit `playwright install` command
// ignores this variable, so we check it ourselves.
if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
	process.exit(0);
}

const result = spawnSync('playwright', ['install', 'chromium'], {
	stdio: 'inherit',
	// shell:true so the `playwright` bin resolves on Windows (.cmd) too.
	shell: true,
});

if (result.status !== 0) {
	console.error(
		'\n⚠️  reglance: Chromium download failed. reglance is installed, but ' +
			'`reglance capture` needs a browser — run `npx playwright install ' +
			'chromium` before capturing.'
	);
}

// Always succeed: a missing browser is recoverable and is reported again at
// capture time; it must not break the consumer's install.
process.exit(0);
