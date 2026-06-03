import fs from 'node:fs';
import path from 'node:path';

/**
 * Promote the latest captures to controls (the comparison baseline).
 *
 * Moves each captured image and its HTML snapshot from the captures
 * directory into the controls directory, overwriting any existing
 * baseline for that slug.
 *
 * @param {object} config        - The normalized config.
 * @param {object} [options]     - Control options.
 * @param {Array}  [options.only] - Limit to these target keys.
 */
export function control(config, options = {}) {
	const { dirs, viewports } = config;

	fs.mkdirSync(dirs.controls, { recursive: true });
	fs.mkdirSync(dirs.controlsHtml, { recursive: true });

	let targets = config.targets;
	if (options.only?.length) {
		targets = targets.filter((target) => options.only.includes(target.key));
	}

	let moved = 0;

	for (const target of targets) {
		for (const viewport of viewports) {
			const slug = `${target.key}-${viewport.name}`;
			const imageSrc = path.join(dirs.captures, `${slug}.png`);
			const htmlSrc = path.join(dirs.capturesHtml, `${slug}.html`);

			if (!fs.existsSync(imageSrc)) {
				console.warn(`No capture found for ${slug}`);
				continue;
			}

			const imageDest = path.join(dirs.controls, `${slug}.png`);
			fs.renameSync(imageSrc, imageDest);
			console.log(`Moved ${slug}.png to controls`);

			if (fs.existsSync(htmlSrc)) {
				const htmlDest = path.join(dirs.controlsHtml, `${slug}.html`);
				fs.renameSync(htmlSrc, htmlDest);
			}

			moved++;
		}
	}

	console.log(`\n✅ Promoted ${moved} capture(s) to controls`);
}
