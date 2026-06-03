import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
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

// Skip the inline HTML line-diff above this snapshot size; line-diffing a
// multi-MB (often minified) document is slow and produces no useful result.
const HTML_DIFF_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Write a comparison artifact, surfacing the path and error code on failure
 * (e.g. a full disk or a read-only output dir) instead of an opaque stack.
 *
 * @param {string}        file - The destination path.
 * @param {string|Buffer} data - The contents to write.
 */
function writeArtifact(file, data) {
	try {
		fs.writeFileSync(file, data);
	} catch (error) {
		throw new Error(
			`Failed to write ${file}: ${error.code || error.message}`
		);
	}
}

/**
 * Pad an image with transparent pixels onto a larger transparent canvas.
 *
 * Returns the image unchanged when it already matches the target dimensions,
 * avoiding a needless full-buffer copy.
 *
 * @param {PNG}    img         - The image to pad.
 * @param {number} targetWidth  - The desired width.
 * @param {number} targetHeight - The desired height.
 * @returns {PNG} The padded image (or the original when no padding is needed).
 */
export function padImage(img, targetWidth, targetHeight) {
	if (img.width === targetWidth && img.height === targetHeight) {
		return img;
	}

	const padded = new PNG({ width: targetWidth, height: targetHeight });
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

	// Remember each image's natural size before padding so the report can
	// declare width/height and reserve the box (no layout shift on decode).
	const controlWidth = img1.width;
	const controlHeight = img1.height;
	const captureWidth = img2.width;
	const captureHeight = img2.height;

	// Pad both onto a common canvas so width changes (a real layout
	// regression) surface as a large diff instead of dropping the slug from
	// the report. Height was already handled this way; width is too now.
	const maxWidth = Math.max(img1.width, img2.width);
	const maxHeight = Math.max(img1.height, img2.height);
	img1 = padImage(img1, maxWidth, maxHeight);
	img2 = padImage(img2, maxWidth, maxHeight);

	const diff = new PNG({ width: maxWidth, height: maxHeight });
	const numDiffPixels = pixelmatch(
		img1.data,
		img2.data,
		diff.data,
		maxWidth,
		maxHeight,
		pixelmatchOptions
	);

	const diffImage = path.join(dirs.compares, `${slug}-diff.png`);
	writeArtifact(diffImage, PNG.sync.write(diff));

	const totalPixels = maxWidth * maxHeight;
	const diffPercentage = (numDiffPixels / totalPixels) * 100;

	// Compare the captured HTML snapshots when both exist.
	const controlHtml = path.join(dirs.controlsHtml, `${slug}.html`);
	const captureHtml = path.join(dirs.capturesHtml, `${slug}.html`);
	let htmlResult = { hasChanges: false, html: '' };
	if (fs.existsSync(controlHtml) && fs.existsSync(captureHtml)) {
		// Guard pathological inputs: a multi-MB (often minified) document can
		// grind through the line diff for no useful result.
		const tooBig =
			fs.statSync(controlHtml).size > HTML_DIFF_MAX_BYTES ||
			fs.statSync(captureHtml).size > HTML_DIFF_MAX_BYTES;

		if (tooBig) {
			htmlResult = {
				hasChanges: false,
				html: `<!doctype html><meta charset="utf-8"><title>${slug}</title><p>HTML snapshot too large to diff inline (over ${Math.round(HTML_DIFF_MAX_BYTES / 1024 / 1024)}MB). Compare the captured HTML files directly.</p>`,
			};
		} else {
			htmlResult = generateHtmlDiff(
				fs.readFileSync(controlHtml, 'utf8'),
				fs.readFileSync(captureHtml, 'utf8'),
				{ name: config.name, urlKey: target.key, viewport },
				diffLines
			);
		}
	}

	const htmlDiffPath = path.join(dirs.compares, `${slug}-html-diff.html`);
	writeArtifact(htmlDiffPath, htmlResult.html);

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
		controlWidth,
		controlHeight,
		captureWidth,
		captureHeight,
		diffWidth: maxWidth,
		diffHeight: maxHeight,
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
 * Run every comparison across a pool of worker threads.
 *
 * Each comparison decodes two PNGs and runs pixelmatch — CPU-bound work on
 * the synchronous pngjs API that would otherwise block the main thread and
 * run one slug at a time. Workers are reused and pulled from a shared queue,
 * so a slow slug never gates the others. Peak memory is bounded by the pool
 * size (each in-flight comparison holds large RGBA buffers), which is why the
 * concurrency is capped and configurable.
 *
 * @param {object} config      - The normalized config.
 * @param {Array}  jobs        - `{ target, viewport }` work items.
 * @param {number} concurrency - Maximum workers to run at once.
 * @returns {Promise<Array>} The comparison reports (in completion order).
 */
async function runComparisons(config, jobs, concurrency) {
	const workerUrl = new URL('./compare-worker.mjs', import.meta.url);
	const reports = [];
	let next = 0;

	const runOne = (worker, job) =>
		new Promise((resolve, reject) => {
			const onMessage = (message) => {
				cleanup();
				if (message.ok) {
					resolve(message.result);
				} else {
					reject(new Error(message.error));
				}
			};
			const onError = (error) => {
				cleanup();
				reject(error);
			};
			const cleanup = () => {
				worker.off('message', onMessage);
				worker.off('error', onError);
			};
			worker.on('message', onMessage);
			worker.on('error', onError);
			worker.postMessage({
				config,
				target: job.target,
				viewport: job.viewport,
			});
		});

	const runWorker = async () => {
		const worker = new Worker(workerUrl);
		try {
			while (next < jobs.length) {
				const job = jobs[next++];
				console.log(
					`Comparing ${job.target.key}-${job.viewport.name}...`
				);
				const result = await runOne(worker, job);
				if (result) {
					reports.push(result);
				}
			}
		} finally {
			await worker.terminate();
		}
	};

	const poolSize = Math.max(1, Math.min(concurrency, jobs.length));
	await Promise.all(Array.from({ length: poolSize }, runWorker));
	return reports;
}

/**
 * Compare every captured target against its control and build the report.
 *
 * @param {object}  config                  - The normalized config.
 * @param {object}  [options]               - Compare options.
 * @param {Array}   [options.only]          - Limit to these target keys.
 * @param {boolean} [options.open]          - Open the report when finished.
 * @param {number}  [options.concurrency]   - Parallel diff workers.
 */
export async function compare(config, options = {}) {
	const { dirs } = config;
	const { open: openReport = true } = options;
	const concurrency =
		options.concurrency ?? Math.max(1, availableParallelism() - 1);

	fs.mkdirSync(dirs.compares, { recursive: true });
	fs.mkdirSync(dirs.reports, { recursive: true });
	copyAssets(config);

	const targets = filterTargets(config.targets, options.only);

	warnOnStaleControls(config, targets);

	const jobs = targets.flatMap((target) =>
		config.viewports.map((viewport) => ({ target, viewport }))
	);

	const reports =
		jobs.length === 0
			? []
			: await runComparisons(config, jobs, concurrency);

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
