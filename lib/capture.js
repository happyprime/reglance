import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

/**
 * Capture full page screenshot of a URL
 * @param {string} url - The URL to capture
 * @param {string} outputPath - Path to save the screenshot
 * @param {number} viewportWidth - Viewport width
 * @param {number} viewportHeight - Viewport height
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

		// Capture HTML content
		const capturesDir = path.dirname(outputPath);
		const htmlCapturesDir = path.join(capturesDir, 'html');
		if (!fs.existsSync(htmlCapturesDir)) {
			fs.mkdirSync(htmlCapturesDir, { recursive: true });
		}
		
		const htmlPath = path.join(
			htmlCapturesDir,
			path.basename(outputPath).replace('.png', '.html')
		);
		const htmlContent = await page.content();
		fs.writeFileSync(htmlPath, htmlContent);

		console.log(`Full screenshot saved to ${outputPath}`);
		console.log(`HTML content saved to ${htmlPath}`);
	} catch (error) {
		console.error('An error occurred:', error);
	} finally {
		await browser.close();
	}
}

/**
 * Auto scroll page to load all content
 * @param {object} page - Playwright page object
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
 * Generate filename for screenshot
 * @param {string} propertyKey - Property key from config
 * @param {string} urlKey - URL key from config
 * @param {string} viewportName - Viewport name
 * @returns {string} Generated filename
 */
function generateFileName(propertyKey, urlKey, viewportName) {
	return `${propertyKey}-${urlKey}-${viewportName}.png`;
}

/**
 * Capture screenshots for all URLs in a property
 * @param {string} propertyKey - The property key to capture
 * @param {object} config - Configuration object
 * @param {string} capturesDir - Directory to save captures
 */
async function captureProperty(propertyKey, config, capturesDir = './captures') {
	if (!config[propertyKey]) {
		throw new Error(`Property "${propertyKey}" not found in config.`);
	}

	// Create captures directory if it doesn't exist
	if (!fs.existsSync(capturesDir)) {
		fs.mkdirSync(capturesDir);
	}

	const defaults = config.defaults;
	const property = config[propertyKey];

	// Capture all URLs for the property
	for (const [urlKey, url] of Object.entries(property.urls)) {
		const viewports = property.viewports || defaults.viewports;

		for (const viewport of viewports) {
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

export { captureProperty, captureFullPageScreenshot, generateFileName };