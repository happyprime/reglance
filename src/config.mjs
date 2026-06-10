import fs from 'node:fs';
import path from 'node:path';

/**
 * The default viewports used when a config does not define its own.
 */
const DEFAULT_VIEWPORTS = [
	{ name: 'desktop', width: 1920, height: 1080 },
	{ name: 'mobile', width: 390, height: 844 },
];

/**
 * The default pixelmatch options used for image comparison.
 */
export const DEFAULT_PIXELMATCH_OPTIONS = {
	threshold: 0.1,
	includeAA: false,
	alpha: 0.1,
	diffColor: [255, 0, 0], // Red for differences.
	diffColorAlt: [0, 0, 255], // Blue for anti-aliased differences.
	diffMask: false,
};

const DEFAULT_OUTPUT_DIR = '.reglance';

/**
 * Default capture timeouts (ms). `goto` bounds initial navigation; `settle`
 * bounds the post-scroll network-idle wait that lets lazy assets load.
 */
export const DEFAULT_TIMEOUTS = { goto: 15000, settle: 8000 };

/**
 * Normalize a domain into an origin with a scheme and no trailing slash.
 *
 * Accepts bare hosts ("site.test"), hosts with a scheme
 * ("https://site.test"), and trailing slashes, returning a consistent
 * origin like "https://site.test".
 *
 * @param {string} domain The domain to normalize.
 * @returns {string} The normalized origin.
 */
export function normalizeDomain(domain) {
	if (typeof domain !== 'string' || !domain.trim()) {
		throw new Error(
			'❌ Invalid domain: expected a non-empty string.\n' +
				'💡 Set "domain" in reglance.json or pass --domain=site.test.'
		);
	}

	let value = domain.trim();

	if (!/^https?:\/\//i.test(value)) {
		value = `https://${value}`;
	}

	value = value.replace(/\/+$/, '');

	// Surface a malformed domain here rather than letting it fail deep in
	// capture with a cryptic Playwright navigation error.
	try {
		new URL(value);
	} catch {
		throw new Error(
			`❌ Invalid domain: "${domain}" is not a valid URL.\n` +
				'💡 Use a host like "site.test" or a full origin like "https://site.test".'
		);
	}

	return value;
}

// Path keys and viewport names become part of output filenames (the
// `${key}-${viewport}` slug), so they must not contain path separators or
// traversal sequences that could redirect a write outside the output dir.
const SAFE_SLUG_PART = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Assert a value is safe to use as part of an output filename.
 *
 * @param {string} value The value to check.
 * @param {string} kind  A label for the error message (e.g. "path key").
 */
function assertSafeSlugPart(value, kind) {
	if (
		typeof value !== 'string' ||
		!SAFE_SLUG_PART.test(value) ||
		value.includes('..')
	) {
		throw new Error(
			`❌ Invalid ${kind} ${JSON.stringify(value)}: it becomes part of an ` +
				'output filename, so use only letters, numbers, dashes, dots, ' +
				'and underscores (no slashes or "..").'
		);
	}
}

/**
 * Validate a pixelmatch color option is an [r, g, b] triple of 0–255 integers.
 *
 * Without this, a non-array value (e.g. `null`) crashes report generation with
 * a `.join` TypeError at the very end of a compare run, and a crafted array
 * would be interpolated into the report's CSS.
 *
 * @param {*}      color The configured color value.
 * @param {string} name  The option name, for the error message.
 */
function validateColor(color, name) {
	const valid =
		Array.isArray(color) &&
		color.length === 3 &&
		color.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);

	if (!valid) {
		throw new Error(
			`❌ Invalid "pixelmatchOptions.${name}": expected [r, g, b] integers 0–255, ` +
				`got ${JSON.stringify(color)}.`
		);
	}
}

/**
 * Validate the viewports defined in a config, throwing on the first problem.
 *
 * A malformed viewport otherwise flows untouched into Playwright's
 * setViewportSize() and fails mid-capture with an opaque error, so it is
 * cheaper to catch it up front with an actionable message.
 *
 * @param {Array} viewports The viewport definitions to validate.
 */
export function validateViewports(viewports) {
	if (!Array.isArray(viewports) || viewports.length === 0) {
		throw new Error(
			'❌ Invalid "viewports": expected a non-empty array.\n' +
				'💡 Use entries like { "name": "desktop", "width": 1920, "height": 1080 }.'
		);
	}

	viewports.forEach((viewport, index) => {
		const label = viewport?.name
			? `"${viewport.name}"`
			: `at index ${index}`;

		if (!viewport || typeof viewport !== 'object') {
			throw new Error(
				`❌ Invalid viewport ${label}: expected an object.\n` +
					'💡 Use { "name": "desktop", "width": 1920, "height": 1080 }.'
			);
		}

		if (typeof viewport.name !== 'string' || !viewport.name.trim()) {
			throw new Error(
				`❌ Invalid viewport ${label}: missing a "name".\n` +
					'💡 Give each viewport a unique name like "desktop" or "mobile".'
			);
		}

		assertSafeSlugPart(viewport.name, 'viewport name');

		for (const dimension of ['width', 'height']) {
			const value = viewport[dimension];
			if (!Number.isInteger(value) || value <= 0) {
				throw new Error(
					`❌ Invalid viewport "${viewport.name}": ${dimension} must be a positive integer, got ${JSON.stringify(value)}.\n` +
						'💡 Use numeric pixel values like { "width": 1920, "height": 1080 }.'
				);
			}
		}

		// Optional. Maps to Playwright's deviceScaleFactor (the page's
		// devicePixelRatio); fractional ratios like 1.5 are valid, so this is a
		// positive number rather than an integer. Defaults to 1 when omitted.
		const { deviceScaleFactor } = viewport;
		if (
			deviceScaleFactor !== undefined &&
			(typeof deviceScaleFactor !== 'number' ||
				!Number.isFinite(deviceScaleFactor) ||
				deviceScaleFactor <= 0)
		) {
			throw new Error(
				`❌ Invalid viewport "${viewport.name}": deviceScaleFactor must be a positive number, got ${JSON.stringify(deviceScaleFactor)}.\n` +
					'💡 Use a device pixel ratio like 1 (default), 2 (retina), or 3.'
			);
		}
	});
}

/**
 * Normalize and validate the `blockHosts` config value.
 *
 * Entries are bare hostnames; each blocks the host itself and all of its
 * subdomains during capture (a leading `*.` is accepted and equivalent).
 * Anything with a scheme, path, or port is rejected up front — silently
 * matching nothing would read as "the block isn't working".
 *
 * @param {*} blockHosts The raw config value.
 * @returns {string[]} Lowercased hostnames with any `*.` prefix removed.
 */
export function normalizeBlockHosts(blockHosts) {
	if (blockHosts === undefined) {
		return [];
	}

	if (!Array.isArray(blockHosts)) {
		throw new Error(
			'❌ Invalid "blockHosts": expected an array of hostnames.\n' +
				'💡 Use entries like ["captcha.example.com"].'
		);
	}

	return blockHosts.map((entry) => {
		if (typeof entry !== 'string' || !entry.trim()) {
			throw new Error(
				`❌ Invalid "blockHosts" entry ${JSON.stringify(entry)}: expected a non-empty string.\n` +
					'💡 Use a bare hostname like "captcha.example.com".'
			);
		}

		const host = entry.trim().toLowerCase().replace(/^\*\./, '');

		if (/[/:\s]/.test(host)) {
			throw new Error(
				`❌ Invalid "blockHosts" entry ${JSON.stringify(entry)}: expected a bare hostname (no scheme, port, or path).\n` +
					'💡 Use "captcha.example.com", not "https://captcha.example.com/".'
			);
		}

		return host;
	});
}

/**
 * Join a domain origin and a path into a full URL.
 *
 * A path that is already an absolute URL is returned untouched so that a
 * config can point individual entries at a different domain.
 *
 * @param {string} domain   The normalized domain origin.
 * @param {string} pathname The path or absolute URL.
 * @returns {string} The full URL.
 */
export function buildUrl(domain, pathname) {
	if (/^https?:\/\//i.test(pathname)) {
		return pathname;
	}

	return `${domain}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
}

/**
 * Narrow the target list to a set of requested path keys.
 *
 * Throws when none of the requested keys match, so a typo'd key on
 * `control`/`compare` surfaces an actionable error instead of silently
 * doing nothing and printing a success-looking summary.
 *
 * @param {Array}    targets The configured targets.
 * @param {string[]} [only]  Path keys to keep. Falsy/empty keeps all.
 * @returns {Array} The filtered targets.
 */
export function filterTargets(targets, only) {
	if (!only?.length) {
		return targets;
	}

	const filtered = targets.filter((target) => only.includes(target.key));

	if (filtered.length === 0) {
		throw new Error(
			`No matching paths for: ${only.join(', ')}. ` +
				`Known keys: ${targets.map((target) => target.key).join(', ')}.`
		);
	}

	return filtered;
}

/**
 * Load and normalize a reglance config file.
 *
 * @param {object} [options]            Loader options.
 * @param {string} [options.configPath] Path to the config file.
 * @param {string} [options.domain]     Domain override (e.g. from a flag).
 * @returns {object} The normalized config.
 */
export function loadConfig({ configPath = 'reglance.json', domain } = {}) {
	const resolvedPath = path.resolve(configPath);

	if (!fs.existsSync(resolvedPath)) {
		throw new Error(
			`Config file not found at ${resolvedPath}.\n` +
				'Create a reglance.json in your project root. ' +
				'See https://github.com/happyprime/reglance for the expected structure.'
		);
	}

	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
	} catch (error) {
		throw new Error(`Could not parse ${resolvedPath}: ${error.message}`);
	}

	if (!raw.paths || Object.keys(raw.paths).length === 0) {
		throw new Error('No "paths" configured in reglance.json.');
	}

	for (const key of Object.keys(raw.paths)) {
		assertSafeSlugPart(key, 'path key');
	}

	// The domain is only required for capture; control and compare operate on
	// already-captured files, so a missing domain is allowed here.
	const resolvedDomain = domain ?? raw.domain;
	const origin = resolvedDomain ? normalizeDomain(resolvedDomain) : null;

	const viewports = raw.viewports?.length ? raw.viewports : DEFAULT_VIEWPORTS;
	validateViewports(viewports);

	const outputDir = path.resolve(raw.output || DEFAULT_OUTPUT_DIR);

	// Build the list of targets to capture and compare.
	const targets = Object.entries(raw.paths).map(([key, pathname]) => ({
		key,
		path: pathname,
		url: origin ? buildUrl(origin, pathname) : pathname,
	}));

	const pixelmatchOptions = {
		...DEFAULT_PIXELMATCH_OPTIONS,
		...raw.pixelmatchOptions,
	};
	validateColor(pixelmatchOptions.diffColor, 'diffColor');
	validateColor(pixelmatchOptions.diffColorAlt, 'diffColorAlt');

	return {
		name: raw.name || (origin ? new URL(origin).host : 'reglance'),
		domain: origin,
		outputDir,
		viewports,
		targets,
		pixelmatchOptions,
		blockHosts: normalizeBlockHosts(raw.blockHosts),
		timeouts: {
			...DEFAULT_TIMEOUTS,
			...raw.timeouts,
		},
		// Directory paths derived from the output directory.
		dirs: {
			captures: path.join(outputDir, 'captures'),
			capturesHtml: path.join(outputDir, 'captures', 'html'),
			controls: path.join(outputDir, 'controls'),
			controlsHtml: path.join(outputDir, 'controls', 'html'),
			compares: path.join(outputDir, 'compares'),
			reports: path.join(outputDir, 'reports'),
			assets: path.join(outputDir, 'assets'),
		},
	};
}

/**
 * Ensure the output directory exists and is ignored by git.
 *
 * Writes a self-contained .gitignore inside the output directory so that
 * captures, diffs, and reports never get committed to the host project.
 *
 * @param {object} config The normalized config.
 */
export function ensureOutputDir(config) {
	fs.mkdirSync(config.outputDir, { recursive: true });

	// Fail fast with a clear message on a read-only or unwritable output dir,
	// rather than partway through a run with an opaque fs error.
	try {
		fs.accessSync(config.outputDir, fs.constants.W_OK);
	} catch {
		throw new Error(
			`Output directory is not writable: ${config.outputDir}. ` +
				'Check the permissions on the directory and available disk space.'
		);
	}

	const gitignorePath = path.join(config.outputDir, '.gitignore');
	if (!fs.existsSync(gitignorePath)) {
		fs.writeFileSync(gitignorePath, '*\n');
	}
}
