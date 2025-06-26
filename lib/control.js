import fs from 'fs';
import path from 'path';

/**
 * Get the most recent matching file from captures directory
 * @param {string} propertyKey - The property key from config
 * @param {string} urlKey - The URL key from config
 * @param {string} viewport - The viewport name
 * @param {string} capturesDir - Captures directory path
 * @returns {object|null} Paths to the most recent matching files or null if none found
 */
function findLatestCapture(propertyKey, urlKey, viewport, capturesDir = './captures') {
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
 * Copy a capture to the controls directory
 * @param {string} sourcePath - Path to the source file
 * @param {string} propertyKey - The property key from config
 * @param {string} urlKey - The URL key from config
 * @param {string} viewport - The viewport name
 * @param {string} controlsDir - Controls directory path
 */
function copyToControls(sourcePath, propertyKey, urlKey, viewport, controlsDir = './controls') {
	const controlName = `${propertyKey}-${urlKey}-${viewport}.png`;
	const destPath = path.join(controlsDir, controlName);
	fs.copyFileSync(sourcePath, destPath);
	console.log(`Created control: ${controlName}`);
}

/**
 * Process a single URL for controls
 * @param {string} propertyKey - The property key from config
 * @param {string} urlKey - The URL key
 * @param {object} config - Configuration object
 * @param {string} capturesDir - Captures directory path
 * @param {string} controlsDir - Controls directory path
 */
function processUrl(propertyKey, urlKey, config, capturesDir = './captures', controlsDir = './controls') {
	const htmlControlsDir = path.join(controlsDir, 'html');
	
	// Create controls directories if they don't exist
	if (!fs.existsSync(controlsDir)) {
		fs.mkdirSync(controlsDir);
	}
	if (!fs.existsSync(htmlControlsDir)) {
		fs.mkdirSync(htmlControlsDir, { recursive: true });
	}

	const defaults = config.defaults;
	const property = config[propertyKey];
	const viewports = property.viewports || defaults.viewports;

	// Process each viewport
	for (const viewport of viewports) {
		const latestCapture = findLatestCapture(
			propertyKey,
			urlKey,
			viewport.name,
			capturesDir
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
 * Set controls for a property
 * @param {string} propertyKey - The property key to process
 * @param {string} specificUrl - Optional specific URL key to process
 * @param {object} config - Configuration object
 * @param {string} capturesDir - Captures directory path
 * @param {string} controlsDir - Controls directory path
 */
function setControls(propertyKey, specificUrl, config, capturesDir = './captures', controlsDir = './controls') {
	if (!config[propertyKey]) {
		throw new Error(`Property "${propertyKey}" not found in config.`);
	}

	const property = config[propertyKey];

	if (specificUrl) {
		// Process single URL
		if (!property.urls[specificUrl]) {
			throw new Error(
				`URL key "${specificUrl}" not found in property "${propertyKey}"`
			);
		}
		processUrl(propertyKey, specificUrl, config, capturesDir, controlsDir);
	} else {
		// Process all URLs for the property
		Object.keys(property.urls).forEach((urlKey) => {
			processUrl(propertyKey, urlKey, config, capturesDir, controlsDir);
		});
	}
}

export { setControls, processUrl, findLatestCapture, copyToControls };