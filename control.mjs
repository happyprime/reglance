import fs from 'fs';
import path from 'path';

// Read config file
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// Create controls directory if it doesn't exist
const capturesDir = './captures';
const controlsDir = './controls';
const htmlControlsDir = path.join(controlsDir, 'html');
if (!fs.existsSync(controlsDir)) {
	fs.mkdirSync(controlsDir);
}
if (!fs.existsSync(htmlControlsDir)) {
	fs.mkdirSync(htmlControlsDir, { recursive: true });
}

/**
 * Get the most recent matching file from captures directory
 *
 * @param {string} propertyKey - The property key from config
 * @param {string} urlKey - The URL key from config
 * @param {string} viewport - The viewport name
 * @returns {object} - Paths to the most recent matching files or null if none found
 */
function findLatestCapture(propertyKey, urlKey, viewport) {
	if (!fs.existsSync(capturesDir)) {
		return null;
	}

	const files = fs
		.readdirSync(capturesDir)
		.filter((file) => {
			// Match format: {property key}-{url key}-{viewport}.png
			const pattern = new RegExp(
				`${propertyKey}-${urlKey}-${viewport}\\.png$`
			);
			return pattern.test(file);
		})
		.sort()
		.reverse(); // Most recent first

	if (files.length === 0) {
		return null;
	}

	const latestFile = files[0];
	const htmlFile = latestFile.replace('.png', '.html');

	return {
		image: path.join(capturesDir, latestFile),
		html: path.join(capturesDir, 'html', htmlFile),
	};
}

/**
 * Process a single URL for controls
 *
 * @param {string} propertyKey - The property key from config
 * @param {string} urlKey - The URL key
 */
function processUrl(propertyKey, urlKey) {
	const defaults = config.defaults;

	const property = config[propertyKey];

	const viewports = property.viewports || defaults.viewports;

	// Process each viewport
	for (const viewport of viewports) {
		const latestCapture = findLatestCapture(
			propertyKey,
			urlKey,
			viewport.name
		);

		if (latestCapture) {
			// Move image file
			const imageDest = path.join(
				controlsDir,
				path.basename(latestCapture.image)
			);
			fs.renameSync(latestCapture.image, imageDest);
			console.log(`Moved ${latestCapture.image} to ${imageDest}`);

			// Move HTML file if it exists
			if (fs.existsSync(latestCapture.html)) {
				const htmlDest = path.join(
					htmlControlsDir,
					path.basename(latestCapture.html)
				);
				fs.renameSync(latestCapture.html, htmlDest);
				console.log(`Moved ${latestCapture.html} to ${htmlDest}`);
			}
		} else {
			console.warn(
				`No capture found for ${propertyKey}-${urlKey}-${viewport.name}`
			);
		}
	}
}

/**
 * Main execution function
 *
 * @param {string} propertyKey - The property key to process
 * @param {string} specificUrl - Optional specific URL key to process
 */
function main(propertyKey, specificUrl) {
	if (!config[propertyKey]) {
		console.error(`Property "${propertyKey}" not found in config.`);
		process.exit(1);
	}

	const property = config[propertyKey];

	if (specificUrl) {
		// Process single URL
		if (!property.urls[specificUrl]) {
			console.error(
				`URL key "${specificUrl}" not found in property "${propertyKey}"`
			);
			process.exit(1);
		}
		processUrl(propertyKey, specificUrl);
	} else {
		// Process all URLs for the property
		Object.keys(property.urls).forEach((urlKey) => {
			processUrl(propertyKey, urlKey);
		});
	}
}

// Get command line arguments
const [, , propertyKey, urlKey] = process.argv;

// Check if property key is provided
if (!propertyKey) {
	console.error('Please provide a property key.');
	console.error('Usage: node control.mjs <property_key> [url_key]');
	process.exit(1);
}

// Run the control process
main(propertyKey, urlKey);
