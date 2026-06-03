import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { filterTargets } from './config.mjs';

/**
 * Wait for the network to be idle, with a hard cap on how long to wait.
 *
 * @param {import('playwright').Page} page          - The page to watch.
 * @param {number}                    [idleTime]    - Quiet time (ms) that counts as idle.
 * @param {number}                    [maxWaitTime] - Maximum time (ms) to wait.
 */
async function waitForNetworkIdle(page, idleTime = 500, maxWaitTime = 3000) {
	const startTime = Date.now();
	let lastActivity = Date.now();
	let pendingRequests = 0;

	const onRequest = () => {
		pendingRequests++;
		lastActivity = Date.now();
	};
	const onSettled = () => {
		pendingRequests = Math.max(0, pendingRequests - 1);
		lastActivity = Date.now();
	};

	page.on('request', onRequest);
	page.on('response', onSettled);
	page.on('requestfailed', onSettled);

	try {
		while (Date.now() - startTime < maxWaitTime) {
			if (
				pendingRequests === 0 &&
				Date.now() - lastActivity >= idleTime
			) {
				break;
			}
			await page.waitForTimeout(100);
		}
	} finally {
		page.off('request', onRequest);
		page.off('response', onSettled);
		page.off('requestfailed', onSettled);
	}
}

/**
 * Scroll the full height of the page and back to the top.
 *
 * This triggers lazy-loaded images and other on-scroll behavior so the
 * screenshot captures the page as a visitor would see it.
 *
 * @param {import('playwright').Page} page - The page to scroll.
 */
async function autoScroll(page) {
	await page.evaluate(async () => {
		await new Promise((resolve) => {
			let totalHeight = 0;
			const distance = 500;
			const timer = setInterval(() => {
				const scrollHeight = document.body.scrollHeight;
				window.scrollBy(0, distance);
				totalHeight += distance;

				if (totalHeight >= scrollHeight) {
					clearInterval(timer);
					window.scrollTo(0, 0);
					resolve();
				}
			}, 100);
		});
	});
}

/**
 * Capture screenshots for a single target across all viewports.
 *
 * Returns the list of slugs that did not capture cleanly so the caller can
 * report them. A degraded capture is still written (best effort) but is
 * recorded as a failure rather than silently treated as success.
 *
 * @param {import('playwright').Browser} browser   - The shared browser.
 * @param {object}                       target    - The target ({ key, url }).
 * @param {Array}                        viewports - Viewport definitions.
 * @param {object}                       dirs      - Output directory paths.
 * @param {object}                       options   - Capture options.
 * @returns {Promise<Array<{ slug: string, url: string, reason: string }>>} Failed slugs.
 */
async function captureTarget(browser, target, viewports, dirs, options) {
	const { skipReload = false, retryCount = 2 } = options;
	const context = await browser.newContext();
	const page = await context.newPage();
	const failures = [];
	let currentSlug = target.key;

	const failedResources = new Set();
	page.on('requestfailed', (request) => {
		const type = request.resourceType();
		if (type === 'stylesheet' || type === 'script') {
			failedResources.add(request.url());
			console.warn(`⚠️  Failed to load ${type}: ${request.url()}`);
		}
	});

	try {
		for (let i = 0; i < viewports.length; i++) {
			const viewport = viewports[i];
			const slug = `${target.key}-${viewport.name}`;
			currentSlug = slug;

			console.log(`Capturing ${slug}...`);

			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});

			failedResources.clear();

			let attempts = 0;
			let success = false;

			while (attempts <= retryCount && !success) {
				try {
					if (i === 0 || !skipReload) {
						if (attempts > 0) {
							console.log(`  Retry attempt ${attempts}...`);
							await page.waitForTimeout(1000);
						}

						const gotoOptions = {
							waitUntil: 'networkidle',
							timeout: 15000,
						};

						if (i === 0 || attempts > 0) {
							await page.goto(target.url, gotoOptions);
						} else {
							await page.reload(gotoOptions);
						}

						if (failedResources.size > 0 && attempts < retryCount) {
							throw new Error(
								'Critical resources failed to load'
							);
						}
					}
					success = true;
				} catch (error) {
					attempts++;
					if (attempts > retryCount) {
						// Retries exhausted. Screenshot best-effort below, but
						// record the slug as degraded rather than faking success.
						const reason = error.message || String(error);
						console.error(
							`  ⚠️  ${slug} did not load cleanly after ${retryCount + 1} attempts: ${reason}`
						);
						failures.push({ slug, url: target.url, reason });
						success = true;
					}
				}
			}

			await autoScroll(page);
			await waitForNetworkIdle(page, 500, 3000);

			const imagePath = path.join(dirs.captures, `${slug}.png`);
			await page.screenshot({ path: imagePath, fullPage: true });

			const htmlPath = path.join(dirs.capturesHtml, `${slug}.html`);
			fs.writeFileSync(htmlPath, await page.content());

			console.log(`✓ Captured ${slug}`);
		}
	} catch (error) {
		// A failure outside the retry loop (e.g. screenshot or HTML write).
		const reason = error.message || String(error);
		console.error(
			`Error capturing ${currentSlug} (${target.url}): ${reason}`
		);
		failures.push({ slug: currentSlug, url: target.url, reason });
	} finally {
		await context.close();
	}

	return failures;
}

/**
 * Decide whether a capture run should exit non-zero.
 *
 * Degraded captures are always reported loudly, but the non-zero exit is
 * opt-in (so existing best-effort/partial workflows keep working) — see the
 * D-004 decision.
 *
 * @param {Array}   failures        - The degraded-slug records.
 * @param {boolean} [failOnDegraded] - Whether degraded captures fail the run.
 * @returns {boolean} True when the run should signal failure.
 */
export function shouldFailRun(failures, failOnDegraded = false) {
	return Boolean(failOnDegraded) && failures.length > 0;
}

/**
 * Capture screenshots for every configured target.
 *
 * @param {object} config              - The normalized config.
 * @param {object} [options]           - Capture options.
 * @param {number} [options.concurrency] - Parallel browser contexts.
 * @param {number} [options.staggerDelay] - Delay (ms) between context starts.
 * @param {boolean}[options.skipReload]   - Reuse the page between viewports.
 * @param {boolean}[options.failOnDegraded] - Exit non-zero if any capture is degraded.
 * @param {Array}  [options.only]         - Limit to these target keys.
 * @returns {Promise<{ failures: Array }>} The degraded-slug records.
 */
export async function capture(config, options = {}) {
	const {
		concurrency = 4,
		staggerDelay = 500,
		skipReload = false,
		failOnDegraded = false,
	} = options;

	fs.mkdirSync(config.dirs.captures, { recursive: true });
	fs.mkdirSync(config.dirs.capturesHtml, { recursive: true });

	const targets = filterTargets(config.targets, options.only);

	const totalShots = targets.length * config.viewports.length;
	console.log(`Domain: ${config.domain}`);
	console.log(`Targets: ${targets.length}`);
	console.log(`Viewports per target: ${config.viewports.length}`);
	console.log(`Total screenshots: ${totalShots}`);
	console.log(`Concurrency: ${concurrency} parallel contexts`);

	const browser = await chromium.launch({
		args: ['--ignore-certificate-errors'],
		ignoreHTTPSErrors: true,
	});

	const failures = [];

	try {
		// Clamp to a positive step so a stray non-positive concurrency can
		// never stall this loop. The CLI already rejects such values.
		const step = Math.max(1, concurrency);
		for (let i = 0; i < targets.length; i += step) {
			const batch = targets.slice(i, i + step);
			console.log(
				`Processing batch ${Math.floor(i / step) + 1} of ${Math.ceil(targets.length / step)}`
			);

			const batchResults = await Promise.all(
				batch.map(async (target, j) => {
					// Stagger context starts to avoid a thundering herd.
					if (staggerDelay > 0 && j > 0) {
						await new Promise((resolve) =>
							setTimeout(resolve, j * staggerDelay)
						);
					}
					return captureTarget(
						browser,
						target,
						config.viewports,
						config.dirs,
						{ skipReload }
					);
				})
			);

			for (const targetFailures of batchResults) {
				failures.push(...targetFailures);
			}
		}
	} finally {
		await browser.close();
	}

	if (failures.length) {
		console.error(
			`\n⚠️  ${failures.length} capture(s) did not load cleanly:`
		);
		failures.forEach((failure) => {
			console.error(`  - ${failure.slug}: ${failure.reason}`);
		});
		console.error(
			'These captures may be blank or show an error page. ' +
				'Review them before running "reglance control".'
		);
		if (shouldFailRun(failures, failOnDegraded)) {
			process.exitCode = 1;
		}
		return { failures };
	}

	console.log('\n✅ Capture complete');
	return { failures: [] };
}
