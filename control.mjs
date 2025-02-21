import fs from 'fs';
import path from 'path';

// Read config file
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// Create controls directory if it doesn't exist
const capturesDir = './captures';
const controlsDir = './controls';
if (!fs.existsSync(controlsDir)) {
	fs.mkdirSync(controlsDir);
}

/**
 * Get the most recent matching file from captures directory
 *
 * @param {string} propertyKey - The property key from config
 * @param {string} urlKey - The URL key from config
 * @param {string} viewport - The viewport name
 * @returns {string|null} - Path to the most recent matching file or null if none found
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

	return files.length > 0 ? path.join(capturesDir, files[0]) : null;
}

/**
 * Copy a capture to the controls directory
 *
 * @param {string} sourcePath - Path to the source file
 * @param {string} propertyKey - The property key from config
 * @param {string} urlKey - The URL key from config
 * @param {string} viewport - The viewport name
 */
function copyToControls(sourcePath, propertyKey, urlKey, viewport) {
	const controlName = `${propertyKey}-${urlKey}-${viewport}.png`;
	const destPath = path.join(controlsDir, controlName);
	fs.copyFileSync(sourcePath, destPath);
	console.log(`Created control: ${controlName}`);
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
			copyToControls(latestCapture, propertyKey, urlKey, viewport.name);
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
