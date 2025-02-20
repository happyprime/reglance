import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
 * @param tag
 * @param url
 */
function generateFileName(propertyKey, urlKey, tag, url) {
	const date = new Date();
	const dateStr = date
		.toLocaleDateString('en-US', {
			year: '2-digit',
			month: '2-digit',
			day: '2-digit',
		})
		.replace(/\//g, '');

	// If no urlKey provided, generate one from the URL
	if (!urlKey) {
		const hash = crypto
			.createHash('md5')
			.update(url)
			.digest('hex')
			.slice(0, 8);
		urlKey = `url-${hash}`;
	}

	// Use 'original' as default tag if none provided
	tag = tag || 'original';

	return `${dateStr}-${propertyKey}-${urlKey}-${tag}.png`;
}

/**
 *
 * @param propertyKey
 * @param tag
 * @param specificUrl
 */
async function captureProperty(propertyKey, tag, specificUrl) {
	if (!config[propertyKey]) {
		console.error(`Property "${propertyKey}" not found in config.`);
		process.exit(1);
	}

	const property = config[propertyKey];

	if (specificUrl) {
		// Capture single URL
		const outputPath = path.join(
			capturesDir,
			generateFileName(propertyKey, null, tag, specificUrl)
		);
		await captureFullPageScreenshot(specificUrl, outputPath);
	} else {
		// Capture all URLs for the property
		for (const [urlKey, url] of Object.entries(property.urls)) {
			const outputPath = path.join(
				capturesDir,
				generateFileName(propertyKey, urlKey, tag, url)
			);
			await captureFullPageScreenshot(url, outputPath);
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
	let tag = null;
	let url = null;

	for (const arg of args) {
		if (arg.startsWith('--url=')) {
			url = arg.split('=')[1];
		} else if (!propertyKey) {
			propertyKey = arg;
		} else {
			tag = arg;
		}
	}

	return { propertyKey, tag, url };
}

// Get and validate arguments
const { propertyKey, tag, url } = parseArgs();

// Check if property key is provided
if (!propertyKey) {
	console.error('Please provide a property key.');
	console.error(
		'Usage: node capture.js <property_key> [tag] [--url=specific_url]'
	);
	console.error('Example: node capture.js pinchofyum feature123');
	console.error(
		'Example: node capture.js pinchofyum --url=https://example.com'
	);
	console.error(
		'Example: node capture.js pinchofyum feature123 --url=https://example.com'
	);
	process.exit(1);
}

// Run the capture process
captureProperty(propertyKey, tag, url);
