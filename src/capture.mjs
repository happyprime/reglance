import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

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
 * @param {import('playwright').Browser} browser     - The shared browser.
 * @param {object}                       target      - The target ({ key, url }).
 * @param {Array}                        viewports   - Viewport definitions.
 * @param {object}                       dirs        - Output directory paths.
 * @param {object}                       options     - Capture options.
 */
async function captureTarget(browser, target, viewports, dirs, options) {
	const { skipReload = false, retryCount = 2 } = options;
	const context = await browser.newContext();
	const page = await context.newPage();

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
				} catch {
					attempts++;
					if (attempts > retryCount) {
						console.log(
							`  Timed out after ${retryCount + 1} attempts, continuing anyway...`
						);
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
		console.error(`Error capturing ${target.url}:`, error);
	} finally {
		await context.close();
	}
}

/**
 * Capture screenshots for every configured target.
 *
 * @param {object} config              - The normalized config.
 * @param {object} [options]           - Capture options.
 * @param {number} [options.concurrency] - Parallel browser contexts.
 * @param {number} [options.staggerDelay] - Delay (ms) between context starts.
 * @param {boolean}[options.skipReload]   - Reuse the page between viewports.
 * @param {Array}  [options.only]         - Limit to these target keys.
 */
export async function capture(config, options = {}) {
	const { concurrency = 4, staggerDelay = 500, skipReload = false } = options;

	fs.mkdirSync(config.dirs.captures, { recursive: true });
	fs.mkdirSync(config.dirs.capturesHtml, { recursive: true });

	let targets = config.targets;
	if (options.only?.length) {
		targets = targets.filter((target) => options.only.includes(target.key));
		if (targets.length === 0) {
			console.error(`No matching paths for: ${options.only.join(', ')}`);
			return;
		}
	}

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

	try {
		// Clamp to a positive step so a stray non-positive concurrency can
		// never stall this loop. The CLI already rejects such values.
		const step = Math.max(1, concurrency);
		for (let i = 0; i < targets.length; i += step) {
			const batch = targets.slice(i, i + step);
			console.log(
				`Processing batch ${Math.floor(i / step) + 1} of ${Math.ceil(targets.length / step)}`
			);

			await Promise.all(
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
		}
	} finally {
		await browser.close();
	}

	console.log('\n✅ Capture complete');
}
