#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadConfig, ensureOutputDir } from '../src/config.mjs';
import { capture } from '../src/capture.mjs';
import { control } from '../src/control.mjs';
import { compare } from '../src/compare.mjs';

const HELP = `reglance — visual regression at a glance

Usage:
  reglance <command> [paths...] [options]

Commands:
  capture    Screenshot every configured path across all viewports.
  control    Promote the latest captures to controls (the baseline).
  compare    Compare the latest captures against the controls and build a report.

The compare command opens the generated report in your browser when it finishes.

Pass one or more path keys after a command to limit it to those paths,
e.g. "reglance capture home blog".

Options:
  --domain=<host>     Override the domain from reglance.json (e.g. site.test).
  --config=<path>     Path to the config file (default: reglance.json).
  --concurrency=<n>   Parallel browser contexts for capture (default: 4).
  --stagger=<ms>      Delay between starting capture contexts (default: 500).
  --skip-reload       Reuse the page between viewports during capture.
  --no-open           Don't open the report automatically after compare.
  -h, --help          Show this help.

Examples:
  reglance capture --domain=mysite.test
  reglance control
  reglance compare
`;

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		domain: { type: 'string' },
		config: { type: 'string' },
		concurrency: { type: 'string' },
		stagger: { type: 'string' },
		'skip-reload': { type: 'boolean' },
		'no-open': { type: 'boolean' },
		help: { type: 'boolean', short: 'h' },
	},
});

const [command, ...only] = positionals;

if (values.help || !command) {
	console.log(HELP);
	process.exit(command ? 0 : 1);
}

/**
 * Parse an integer flag, exiting with an error when it is not a number.
 *
 * @param {string} value - The raw flag value.
 * @param {string} name  - The flag name, for error messages.
 * @returns {number} The parsed integer.
 */
function toInt(value, name) {
	const parsed = parseInt(value, 10);
	if (Number.isNaN(parsed)) {
		console.error(`Invalid value for --${name}: ${value}`);
		process.exit(1);
	}
	return parsed;
}

/**
 *
 */
async function main() {
	const config = loadConfig({
		configPath: values.config,
		domain: values.domain,
	});

	ensureOutputDir(config);

	switch (command) {
		case 'capture':
			if (!config.domain) {
				console.error(
					'No domain configured. Set "domain" in reglance.json or pass --domain=site.test.'
				);
				process.exit(1);
			}
			await capture(config, {
				only,
				concurrency: values.concurrency
					? toInt(values.concurrency, 'concurrency')
					: undefined,
				staggerDelay: values.stagger
					? toInt(values.stagger, 'stagger')
					: undefined,
				skipReload: values['skip-reload'],
			});
			break;

		case 'control':
			control(config, { only });
			break;

		case 'compare':
			await compare(config, { only, open: !values['no-open'] });
			break;

		default:
			console.error(`Unknown command: ${command}\n`);
			console.log(HELP);
			process.exit(1);
	}
}

main().catch((error) => {
	console.error(error.message || error);
	process.exit(1);
});
