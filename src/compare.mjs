import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { diffLines } from 'diff';
import open from 'open';
import { filterTargets } from './config.mjs';
import { readManifest, detectStaleControls } from './manifest.mjs';
import {
	copyAssets,
	generateHtmlDiff,
	generateIndex,
	generateReport,
} from './report.mjs';

/**
 * Pad an image with transparent pixels to a target height.
 *
 * @param {PNG}    img          - The image to pad.
 * @param {number} targetHeight - The desired height.
 * @returns {PNG} The padded image.
 */
export function padImage(img, targetHeight) {
	const padded = new PNG({ width: img.width, height: targetHeight });
	PNG.bitblt(img, padded, 0, 0, img.width, img.height, 0, 0);
	return padded;
}

/**
 * Compare a single control/capture pair for one target and viewport.
 *
 * @param {object} config   - The normalized config.
 * @param {object} target   - The target ({ key, url }).
 * @param {object} viewport - The viewport definition.
 * @returns {object|null} The comparison result, or null when it can't run.
 */
export function compareSlug(config, target, viewport) {
	const { dirs, pixelmatchOptions } = config;
	const slug = `${target.key}-${viewport.name}`;

	const controlImage = path.join(dirs.controls, `${slug}.png`);
	const captureImage = path.join(dirs.captures, `${slug}.png`);

	if (!fs.existsSync(controlImage)) {
		console.warn(`No control for ${slug} — run "reglance control" first.`);
		return null;
	}
	if (!fs.existsSync(captureImage)) {
		console.warn(`No capture for ${slug} — run "reglance capture" first.`);
		return null;
	}

	let img1 = PNG.sync.read(fs.readFileSync(controlImage));
	let img2 = PNG.sync.read(fs.readFileSync(captureImage));

	if (img1.width !== img2.width) {
		console.warn(`Width mismatch for ${slug}, skipping.`);
		return null;
	}

	// Pad the shorter image so both are the same height.
	const maxHeight = Math.max(img1.height, img2.height);
	if (img1.height < maxHeight) {
		img1 = padImage(img1, maxHeight);
	}
	if (img2.height < maxHeight) {
		img2 = padImage(img2, maxHeight);
	}

	const diff = new PNG({ width: img1.width, height: maxHeight });
	const numDiffPixels = pixelmatch(
		img1.data,
		img2.data,
		diff.data,
		img1.width,
		maxHeight,
		pixelmatchOptions
	);

	const diffImage = path.join(dirs.compares, `${slug}-diff.png`);
	fs.writeFileSync(diffImage, PNG.sync.write(diff));

	const totalPixels = img1.width * maxHeight;
	const diffPercentage = (numDiffPixels / totalPixels) * 100;

	// Compare the captured HTML snapshots when both exist.
	const controlHtml = path.join(dirs.controlsHtml, `${slug}.html`);
	const captureHtml = path.join(dirs.capturesHtml, `${slug}.html`);
	let htmlResult = { hasChanges: false, html: '' };
	if (fs.existsSync(controlHtml) && fs.existsSync(captureHtml)) {
		htmlResult = generateHtmlDiff(
			fs.readFileSync(controlHtml, 'utf8'),
			fs.readFileSync(captureHtml, 'utf8'),
			{ name: config.name, urlKey: target.key, viewport },
			diffLines
		);
	}

	const htmlDiffPath = path.join(dirs.compares, `${slug}-html-diff.html`);
	fs.writeFileSync(htmlDiffPath, htmlResult.html);

	const report = {
		url: target.url,
		urlKey: target.key,
		viewport,
		controlImage,
		captureImage,
		diffImage,
		diffPercentage,
		htmlDiffPath,
		htmlHasChanges: htmlResult.hasChanges,
	};

	report.reportPath = generateReport(config, report);

	return report;
}

/**
 * Warn when the controls being compared were promoted across more than one
 * `control` run, which means the baseline mixes captures from different times.
 *
 * @param {object} config  - The normalized config.
 * @param {Array}  targets - The targets being compared.
 */
function warnOnStaleControls(config, targets) {
	const slugs = targets.flatMap((target) =>
		config.viewports.map((viewport) => `${target.key}-${viewport.name}`)
	);
	const manifest = readManifest(config.dirs);
	const { runs, oldest } = detectStaleControls(manifest, slugs);

	if (oldest) {
		console.warn(
			`⚠️  Baseline mixes controls from ${runs.length} different ` +
				`control runs (oldest: ${oldest.slug} @ ${oldest.promotedAt}). ` +
				'Diffs may reflect baseline age, not real changes. Re-promote a ' +
				'full set with "reglance control" for a coherent baseline.'
		);
	}
}

/**
 * Compare every captured target against its control and build the report.
 *
 * @param {object}  config            - The normalized config.
 * @param {object}  [options]         - Compare options.
 * @param {Array}   [options.only]    - Limit to these target keys.
 * @param {boolean} [options.open]    - Open the report when finished.
 */
export async function compare(config, options = {}) {
	const { dirs } = config;
	const { open: openReport = true } = options;

	fs.mkdirSync(dirs.compares, { recursive: true });
	fs.mkdirSync(dirs.reports, { recursive: true });
	copyAssets(config);

	const targets = filterTargets(config.targets, options.only);

	warnOnStaleControls(config, targets);

	const reports = [];
	for (const target of targets) {
		for (const viewport of config.viewports) {
			console.log(`Comparing ${target.key}-${viewport.name}...`);
			const result = compareSlug(config, target, viewport);
			if (result) {
				reports.push(result);
			}
		}
	}

	if (reports.length === 0) {
		console.error('\nNothing to compare. Capture and set controls first.');
		return;
	}

	const indexPath = generateIndex(config, reports);
	const reportUrl = pathToFileURL(indexPath).href;

	console.log(`\n✅ Comparison complete (${reports.length} comparisons)`);
	console.log(`Report: ${reportUrl}`);

	if (openReport) {
		await open(reportUrl).catch(() => {
			// Couldn't launch a browser; the path is printed above.
		});
	}
}
