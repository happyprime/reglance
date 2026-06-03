import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_NAME = 'manifest.json';

/**
 * Path to the controls manifest.
 *
 * @param {object} dirs - The normalized config's directory paths.
 * @returns {string} The manifest path.
 */
export function manifestPath(dirs) {
	return path.join(dirs.controls, MANIFEST_NAME);
}

/**
 * Read the controls manifest, returning an empty manifest when absent or
 * unreadable so callers never have to special-case a first run.
 *
 * @param {object} dirs - The normalized config's directory paths.
 * @returns {{ updatedAt: string|null, slugs: object }} The manifest.
 */
export function readManifest(dirs) {
	const file = manifestPath(dirs);

	if (!fs.existsSync(file)) {
		return { updatedAt: null, slugs: {} };
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
		return {
			updatedAt: parsed.updatedAt ?? null,
			slugs: parsed.slugs ?? {},
		};
	} catch {
		return { updatedAt: null, slugs: {} };
	}
}

/**
 * Write the controls manifest.
 *
 * @param {object} dirs     - The normalized config's directory paths.
 * @param {object} manifest - The manifest to persist.
 */
export function writeManifest(dirs, manifest) {
	fs.writeFileSync(
		manifestPath(dirs),
		`${JSON.stringify(manifest, null, 2)}\n`
	);
}

/**
 * Detect a baseline assembled from more than one `control` run.
 *
 * When the controls being compared carry different promotion timestamps, the
 * baseline mixes captures from different times (the classic symptom of a
 * partial promotion), which compare should warn about.
 *
 * @param {object}   manifest - The controls manifest.
 * @param {string[]} slugs    - The slugs being compared.
 * @returns {{ runs: string[], oldest: { slug: string, promotedAt: string }|null }}
 */
export function detectStaleControls(manifest, slugs) {
	const entries = slugs
		.map((slug) => ({
			slug,
			promotedAt: manifest.slugs?.[slug]?.promotedAt,
		}))
		.filter((entry) => entry.promotedAt);

	const runs = [...new Set(entries.map((entry) => entry.promotedAt))].sort();

	if (runs.length <= 1) {
		return { runs, oldest: null };
	}

	const oldest = entries.reduce((a, b) =>
		a.promotedAt < b.promotedAt ? a : b
	);
	return { runs, oldest };
}
