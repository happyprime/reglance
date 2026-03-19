import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Read config file
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// Create captures directory if it doesn't exist
const capturesDir = './captures';
const htmlCapturesDir = path.join(capturesDir, 'html');
if (!fs.existsSync(capturesDir)) {
	fs.mkdirSync(capturesDir);
}
if (!fs.existsSync(htmlCapturesDir)) {
	fs.mkdirSync(htmlCapturesDir, { recursive: true });
}

/**
 * Wait for network to be idle with custom timeout
 * @param page
 * @param idleTime - Time in ms to wait for no network activity
 * @param maxWaitTime - Maximum time to wait in ms
 */
async function waitForNetworkIdle(page, idleTime = 500, maxWaitTime = 3000) {
	const startTime = Date.now();
	let lastRequestTime = Date.now();
	let pendingRequests = 0;

	// Track network requests
	const onRequest = () => {
		pendingRequests++;
		lastRequestTime = Date.now();
	};

	const onResponse = () => {
		pendingRequests--;
		lastRequestTime = Date.now();
	};

	page.on('request', onRequest);
	page.on('response', onResponse);
	page.on('requestfailed', onResponse);

	try {
		// Wait until network is idle or max time is reached
		while (Date.now() - startTime < maxWaitTime) {
			if (pendingRequests === 0 && Date.now() - lastRequestTime >= idleTime) {
				console.log(`Network idle after ${Date.now() - startTime}ms`);
				break;
			}
			await page.waitForTimeout(100);
		}

		if (Date.now() - startTime >= maxWaitTime) {
			console.log(`Max wait time (${maxWaitTime}ms) reached, continuing...`);
		}
	} finally {
		page.off('request', onRequest);
		page.off('response', onResponse);
		page.off('requestfailed', onResponse);
	}
}

/**
 * Auto scroll through the page
 * @param page
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
 * Capture screenshots for a single URL across all viewports
 * @param browser
 * @param url
 * @param urlKey
 * @param propertyKey
 * @param viewports
 * @param skipReload - Skip page reload between viewport changes
 * @param retryCount - Number of retries for failed page loads
 */
async function captureUrlAllViewports(browser, url, urlKey, propertyKey, viewports, skipReload = false, retryCount = 2) {
	const context = await browser.newContext();
	const page = await context.newPage();

	// Track failed CSS loads
	const failedResources = new Set();
	page.on('requestfailed', request => {
		if (request.resourceType() === 'stylesheet' || request.resourceType() === 'script') {
			failedResources.add(request.url());
			console.warn(`⚠️  Failed to load ${request.resourceType()}: ${request.url()}`);
		}
	});

	try {
		for (let i = 0; i < viewports.length; i++) {
			const viewport = viewports[i];
			const outputPath = path.join(
				capturesDir,
				`${propertyKey}-${urlKey}-${viewport.name}.png`
			);

			console.log(`Capturing ${propertyKey}-${urlKey}-${viewport.name}...`);

			// Set viewport
			await page.setViewportSize({
				width: viewport.width,
				height: viewport.height,
			});

			// Clear failed resources tracker
			failedResources.clear();

			let attempts = 0;
			let success = false;

			while (attempts <= retryCount && !success) {
				try {
					// Load page on first viewport or reload for subsequent ones (unless skipReload is true)
					if (i === 0 || !skipReload) {
						if (attempts > 0) {
							console.log(`  Retry attempt ${attempts}...`);
							// Wait a bit before retry to let server recover
							await page.waitForTimeout(1000);
						}

						const gotoOptions = {
							waitUntil: 'networkidle',
							timeout: 15000, // Increased timeout for loaded servers
						};

						if (i === 0 || attempts > 0) {
							await page.goto(url, gotoOptions);
						} else {
							await page.reload(gotoOptions);
						}

						// Check if critical resources loaded
						if (failedResources.size > 0) {
							console.warn(`  ⚠️  ${failedResources.size} resources failed to load`);
							if (attempts < retryCount) {
								throw new Error('Critical resources failed to load');
							}
						}

						success = true;
					} else {
						success = true; // Skip reload case
					}
				} catch (error) {
					attempts++;
					if (attempts > retryCount) {
						console.log(`  Network timeout after ${retryCount + 1} attempts, continuing anyway...`);
						success = true; // Continue anyway after all retries
					}
				}
			}

			// Scroll to bottom and back up
			await autoScroll(page);

			// Wait for network to be idle with smart timeout
			await waitForNetworkIdle(page, 500, 3000);

			// Capture full page screenshot
			await page.screenshot({
				path: outputPath,
				fullPage: true,
			});

			// Capture HTML content
			const htmlPath = path.join(
				htmlCapturesDir,
				`${propertyKey}-${urlKey}-${viewport.name}.html`
			);
			const htmlContent = await page.content();
			fs.writeFileSync(htmlPath, htmlContent);

			console.log(`✓ Captured ${propertyKey}-${urlKey}-${viewport.name}`);
		}
	} catch (error) {
		console.error(`Error capturing ${url}:`, error);
	} finally {
		await context.close();
	}
}

/**
 * Process URLs in parallel batches
 * @param urls - Array of {key, url} objects
 * @param propertyKey
 * @param viewports
 * @param concurrency - Number of parallel browser contexts
 * @param skipReload - Skip page reload between viewport changes
 * @param staggerDelay - Delay in ms between starting each context
 */
async function processUrlsInParallel(urls, propertyKey, viewports, concurrency = 4, skipReload = false, staggerDelay = 500) {
	const browser = await chromium.launch({
		args: ['--ignore-certificate-errors'],
		ignoreHTTPSErrors: true,
	});

	try {
		// Process URLs in batches
		for (let i = 0; i < urls.length; i += concurrency) {
			const batch = urls.slice(i, i + concurrency);
			const promises = [];

			console.log(`Processing batch ${Math.floor(i / concurrency) + 1} of ${Math.ceil(urls.length / concurrency)}`);

			// Start each context with stagger delay to avoid overwhelming server
			for (let j = 0; j < batch.length; j++) {
				const { key, url } = batch[j];

				promises.push((async () => {
					// Stagger the start to reduce server load spike
					if (staggerDelay > 0 && j > 0) {
						await new Promise(resolve => setTimeout(resolve, j * staggerDelay));
						console.log(`  Starting ${key} after ${j * staggerDelay}ms delay...`);
					}
					return captureUrlAllViewports(browser, url, key, propertyKey, viewports, skipReload);
				})());
			}

			await Promise.all(promises);
		}
	} finally {
		await browser.close();
	}
}

/**
 * Generate fileName
 * @param propertyKey
 * @param urlKey
 * @param viewportName
 */
function generateFileName(propertyKey, urlKey, viewportName) {
	return `${propertyKey}-${urlKey}-${viewportName}.png`;
}

/**
 * Capture all URLs for a property
 * @param propertyKey
 * @param options
 */
async function captureProperty(propertyKey, options = {}) {
	if (!config[propertyKey]) {
		console.error(`Property "${propertyKey}" not found in config.`);
		process.exit(1);
	}

	const defaults = config.defaults;
	const property = config[propertyKey];
	const viewports = property.viewports || defaults.viewports;

	// Convert URLs object to array for batch processing
	const urls = Object.entries(property.urls).map(([key, url]) => ({
		key,
		url,
	}));

	// Auto-adjust concurrency based on total load
	const totalResources = urls.length * viewports.length;
	let recommendedConcurrency = options.concurrency || 4;

	// Warn if high concurrency with many resources
	if (recommendedConcurrency >= 8 && totalResources > 50) {
		console.log(`⚠️  Warning: High concurrency (${recommendedConcurrency}) with ${totalResources} total captures`);
		console.log(`   May cause resource loading issues. Consider using --concurrency 4 or 6`);
	}

	console.log(`Starting capture for ${propertyKey}`);
	console.log(`Total URLs: ${urls.length}`);
	console.log(`Viewports per URL: ${viewports.length}`);
	console.log(`Total screenshots to capture: ${totalResources}`);
	console.log(`Concurrency: ${recommendedConcurrency} parallel contexts`);
	if (options.skipReload) {
		console.log('Skip reload between viewports: enabled');
	}
	if (options.staggerDelay !== undefined) {
		console.log(`Stagger delay: ${options.staggerDelay}ms between context starts`);
	}

	const startTime = Date.now();

	await processUrlsInParallel(
		urls,
		propertyKey,
		viewports,
		recommendedConcurrency,
		options.skipReload || false,
		options.staggerDelay !== undefined ? options.staggerDelay : 500
	);

	const duration = ((Date.now() - startTime) / 1000).toFixed(1);
	console.log(`\n✅ Capture complete for ${propertyKey} in ${duration} seconds`);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
	const args = process.argv.slice(2);
	let propertyKey = null;
	const options = {
		concurrency: 4,
		skipReload: false,
		staggerDelay: undefined, // Default 500ms set in processUrlsInParallel
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === '--concurrency' || arg === '-c') {
			options.concurrency = parseInt(args[++i], 10);
			if (isNaN(options.concurrency) || options.concurrency < 1) {
				console.error('Concurrency must be a positive number');
				process.exit(1);
			}
		} else if (arg === '--skip-reload' || arg === '--no-reload') {
			options.skipReload = true;
		} else if (arg === '--stagger' || arg === '-s') {
			options.staggerDelay = parseInt(args[++i], 10);
			if (isNaN(options.staggerDelay) || options.staggerDelay < 0) {
				console.error('Stagger delay must be a non-negative number');
				process.exit(1);
			}
		} else if (!propertyKey) {
			propertyKey = arg;
		}
	}

	return { propertyKey, options };
}

// Get and validate arguments
const { propertyKey, options } = parseArgs();

// Check if property key is provided
if (!propertyKey) {
	console.error('Please provide a property key.');
	console.error('Usage: node capture-optimized.mjs <property_key> [options]');
	console.error('Options:');
	console.error('  --concurrency, -c <number>  Number of parallel browser contexts (default: 4)');
	console.error('  --stagger, -s <ms>         Delay between starting contexts (default: 500ms)');
	console.error('  --skip-reload, --no-reload  Skip page reload between viewport changes');
	console.error('');
	console.error('Examples:');
	console.error('  node capture-optimized.mjs pinchofyum');
	console.error('  node capture-optimized.mjs pinchofyum --concurrency 6');
	console.error('  node capture-optimized.mjs pinchofyum -c 8 --stagger 1000');
	console.error('');
	console.error('Recommended settings:');
	console.error('  Small properties (<10 URLs):    --concurrency 4-6');
	console.error('  Medium properties (10-20 URLs): --concurrency 4 --stagger 500');
	console.error('  Large properties (20+ URLs):    --concurrency 4 --stagger 1000');
	process.exit(1);
}

// Run the capture process
captureProperty(propertyKey, options);