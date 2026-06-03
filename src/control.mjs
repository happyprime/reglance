import fs from 'node:fs';
import path from 'node:path';
import { filterTargets } from './config.mjs';
import { readManifest, writeManifest } from './manifest.mjs';

/**
 * Promote the latest captures to controls (the comparison baseline).
 *
 * Moves each captured image and its HTML snapshot from the captures
 * directory into the controls directory, overwriting any existing baseline
 * for that slug. Records each promotion in a `controls/manifest.json` so
 * compare can detect a baseline assembled from more than one run, and warns
 * when a run promotes fewer captures than expected (leaving older controls in
 * place for the rest).
 *
 * @param {object} config         - The normalized config.
 * @param {object} [options]      - Control options.
 * @param {Array}  [options.only] - Limit to these target keys.
 * @param {string} [options.now]  - ISO timestamp override (for tests).
 * @returns {{ moved: number, expected: number }} Promotion counts.
 */
export function control(config, options = {}) {
	const { dirs, viewports } = config;

	fs.mkdirSync(dirs.controls, { recursive: true });
	fs.mkdirSync(dirs.controlsHtml, { recursive: true });

	const targets = filterTargets(config.targets, options.only);
	const promotedAt = options.now ?? new Date().toISOString();
	const manifest = readManifest(dirs);

	let moved = 0;
	const expected = targets.length * viewports.length;

	for (const target of targets) {
		for (const viewport of viewports) {
			const slug = `${target.key}-${viewport.name}`;
			const imageSrc = path.join(dirs.captures, `${slug}.png`);
			const htmlSrc = path.join(dirs.capturesHtml, `${slug}.html`);

			if (!fs.existsSync(imageSrc)) {
				console.warn(`No capture found for ${slug}`);
				// Drop an orphan HTML snapshot so it can't later be mispaired
				// with an unrelated fresh PNG.
				if (fs.existsSync(htmlSrc)) {
					fs.rmSync(htmlSrc);
				}
				continue;
			}

			const imageDest = path.join(dirs.controls, `${slug}.png`);
			fs.renameSync(imageSrc, imageDest);

			if (fs.existsSync(htmlSrc)) {
				const htmlDest = path.join(dirs.controlsHtml, `${slug}.html`);
				fs.renameSync(htmlSrc, htmlDest);
			}

			console.log(`Moved ${slug} to controls`);
			manifest.slugs[slug] = { promotedAt };
			moved++;
		}
	}

	manifest.updatedAt = promotedAt;
	writeManifest(dirs, manifest);

	console.log(`\n✅ Promoted ${moved} of ${expected} capture(s) to controls`);

	if (moved < expected) {
		console.warn(
			`⚠️  ${expected - moved} expected capture(s) were missing; their ` +
				'existing controls are unchanged and may now be STALE relative ' +
				'to the ones just promoted. Re-capture and promote a full set, ' +
				'or expect mixed-era diffs in the next compare.'
		);
	}

	return { moved, expected };
}
