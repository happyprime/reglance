import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Read config file
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// Create captures directory if it doesn't exist
const capturesDir = './captures';
if (!fs.existsSync(capturesDir)) {
	fs.mkdirSync(capturesDir);
}

/**
 *
 * @param url
 * @param outputPath
 * @param viewportWidth
 * @param viewportHeight
 */
async function captureFullPageScreenshot(
	url,
	outputPath,
	viewportWidth = 1920,
	viewportHeight = 1080
) {
	const browser = await chromium.launch({
		args: ['--ignore-certificate-errors'],
		ignoreHTTPSErrors: true,
	});
	const context = await browser.newContext();
	const page = await context.newPage();

	try {
		await page.setViewportSize({
			width: viewportWidth,
			height: viewportHeight,
		});

		await page.goto(url, {
			waitUntil: 'networkidle',
			timeout: 60000,
		});

		// Scroll to bottom and back up
		await autoScroll(page);

		// Wait a bit for any final loading
		await page.waitForTimeout(2000);

		// Capture full page screenshot
		await page.screenshot({
			path: outputPath,
			fullPage: true,
		});

		console.log(`Full screenshot saved to ${outputPath}`);
	} catch (error) {
		console.error('An error occurred:', error);
	} finally {
		await browser.close();
	}
}

/**
 *
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
 *
 * @param propertyKey
 * @param urlKey
 * @param viewportName
 */
function generateFileName(propertyKey, urlKey, viewportName) {
	return `${propertyKey}-${urlKey}-${viewportName}.png`;
}

/**
 *
 * @param propertyKey
 */
async function captureProperty(propertyKey) {
	if (!config[propertyKey]) {
		console.error(`Property "${propertyKey}" not found in config.`);
		process.exit(1);
	}

	const property = config[propertyKey];

	// Capture all URLs for the property
	for (const [urlKey, url] of Object.entries(property.urls)) {
		for (const viewport of property.viewports) {
			const outputPath = path.join(
				capturesDir,
				generateFileName(propertyKey, urlKey, viewport.name)
			);
			await captureFullPageScreenshot(
				url,
				outputPath,
				viewport.width,
				viewport.height
			);
		}
	}
}

// Update command line argument handling
/**
 *
 */
function parseArgs() {
	const args = process.argv.slice(2);
	let propertyKey = null;

	for (const arg of args) {
		if (!propertyKey) {
			propertyKey = arg;
		}
	}

	return { propertyKey };
}

// Get and validate arguments
const { propertyKey } = parseArgs();

// Check if property key is provided
if (!propertyKey) {
	console.error('Please provide a property key.');
	console.error(
		'Usage: node capture.js <property_key>'
	);
	console.error('Example: node capture.js pinchofyum');
	process.exit(1);
}

// Run the capture process
captureProperty(propertyKey);
