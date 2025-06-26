import fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import path from 'path';
import crypto from 'crypto';
import open from 'open';
import { diffLines } from 'diff';

// Default pixelmatch options
const defaultPixelmatchOptions = {
	threshold: 0.1,
	includeAA: false,
	alpha: 0.1,
	diffColor: [255, 0, 0], // Red for differences
	diffColorAlt: [0, 0, 255], // Blue for anti-aliased differences
	diffMask: false,
};

/**
 * Check if input is a property key
 * @param {string} input - Input string to check
 * @param {object} config - Configuration object
 * @returns {boolean} True if input is a property key
 */
function isPropertyKey(input, config) {
	return config[input] !== undefined;
}

/**
 * Get viewports for a property, falling back to defaults
 * @param {string} property - Property name
 * @param {object} config - Configuration object
 * @returns {Array} Array of viewport configurations
 */
function getViewports(property, config) {
	return config[property]?.viewports || config.defaults.viewports;
}

/**
 * Escape HTML special characters
 * @param {string} str - The string to escape
 * @returns {string} The escaped string
 */
function escapeHtml(str) {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/**
 * Compare HTML content
 * @param {string} html1 - First HTML content
 * @param {string} html2 - Second HTML content
 * @returns {object} Comparison result with hasChanges and diffContent
 */
function compareHTML(html1, html2) {
	const changes = diffLines(html1, html2);
	let hasChanges = false;
	let diffContent = '';

	changes.forEach((part) => {
		if (part.added) {
			hasChanges = true;
			diffContent += `<div class="diff-added"><span class="line-number">+</span><span class="line-content">${escapeHtml(part.value)}</span></div>`;
		} else if (part.removed) {
			hasChanges = true;
			diffContent += `<div class="diff-removed"><span class="line-number">-</span><span class="line-content">${escapeHtml(part.value)}</span></div>`;
		} else {
			diffContent += `<div class="diff-unchanged"><span class="line-number"> </span><span class="line-content">${escapeHtml(part.value)}</span></div>`;
		}
	});

	return { hasChanges, diffContent };
}

/**
 * Generate HTML diff report
 * @param {string} originalHTML - Original HTML content
 * @param {string} secondHTML - Second HTML content
 * @param {string} property - Property name
 * @param {string} urlKey - URL key
 * @param {object} viewport - Viewport configuration
 * @returns {object} HTML diff report data
 */
function generateHTMLDiffReport(
	originalHTML,
	secondHTML,
	property,
	urlKey,
	viewport
) {
	const { hasChanges, diffContent } = compareHTML(originalHTML, secondHTML);

	const htmlDiffTemplate = `
<!DOCTYPE html>
<html>
<head>
	<title>HTML Diff - ${property} - ${urlKey} - ${viewport.name}</title>
	<style>
		body { font-family: 'Menlo', 'Monaco', 'Courier New', monospace; margin: 2rem; line-height: 1.5; }
		.diff-content { background: #f8f8f8; padding: 1rem; border-radius: 4px; overflow-x: auto; }
		.diff-added { background-color: #e6ffec; }
		.diff-removed { background-color: #ffeef0; }
		.diff-unchanged { color: #666; }
		.line-number {
			display: inline-block;
			width: 2rem;
			text-align: center;
			color: #999;
			user-select: none;
		}
		.line-content {
			display: inline-block;
			white-space: pre;
			tab-size: 4;
		}
		pre { margin: 0; }
		.tag { color: #22863a; }
		.attr { color: #6f42c1; }
		.string { color: #032f62; }
		.comment { color: #6a737d; }
	</style>
</head>
<body>
	<h1>HTML Diff Report</h1>
	<p>Property: ${property}</p>
	<p>URL: ${urlKey}</p>
	<p>Viewport: ${viewport.name} (${viewport.width}x${viewport.height})</p>
	<p>Status: ${hasChanges ? 'Changes detected' : 'No changes'}</p>
	<div class="diff-content">
		<pre>${diffContent}</pre>
	</div>
</body>
</html>
	`;

	return { hasChanges, htmlDiffTemplate };
}

/**
 * Pad image to target height
 * @param {object} img - PNG image object
 * @param {number} targetHeight - Target height
 * @returns {object} Padded PNG image object
 */
function padImage(img, targetHeight) {
	const newImg = new PNG({ width: img.width, height: targetHeight });
	
	// Copy original image data
	img.data.copy(newImg.data, 0, 0, img.data.length);
	
	// Fill remaining area with white
	const pixelsPerRow = img.width * 4; // 4 bytes per pixel (RGBA)
	const originalBytes = img.height * pixelsPerRow;
	const totalBytes = targetHeight * pixelsPerRow;
	
	for (let i = originalBytes; i < totalBytes; i += 4) {
		newImg.data[i] = 255;     // Red
		newImg.data[i + 1] = 255; // Green
		newImg.data[i + 2] = 255; // Blue
		newImg.data[i + 3] = 255; // Alpha
	}
	
	return newImg;
}

/**
 * Generate visual comparison report
 * @param {string} originalPath - Path to original image
 * @param {string} secondPath - Path to second image
 * @param {string} diffPath - Path to diff image
 * @param {string} property - Property name
 * @param {string} urlKey - URL key
 * @param {object} viewport - Viewport configuration
 * @param {number} diffPercentage - Difference percentage
 * @param {object} pixelmatchOptions - Pixelmatch options
 * @param {string} reportsDir - Reports directory
 * @param {string} reportDomain - Report domain
 * @returns {object} Report paths and URLs
 */
async function generateReport(
	originalPath,
	secondPath,
	diffPath,
	property,
	urlKey,
	viewport,
	diffPercentage,
	pixelmatchOptions,
	reportsDir,
	reportDomain
) {
	// Read the template
	let template = fs.readFileSync('report.html', 'utf8');

	// Generate timestamp for filename
	const now = new Date();
	const timestamp = now
		.toISOString()
		.replace(/[-:]/g, '')
		.replace('T', '-')
		.replace(/\..+/, '');

	// Calculate relative paths from report location to images
	const relativeOriginal = path.relative(reportsDir, originalPath);
	const relativeSecond = path.relative(reportsDir, secondPath);
	const relativeDiff = path.relative(reportsDir, diffPath);

	// Update image sources in the template
	template = template.replaceAll('{originalImage}', relativeOriginal);
	template = template.replaceAll('{secondImage}', relativeSecond);
	template = template.replaceAll('{diffImage}', relativeDiff);
	template = template.replaceAll('{diffPercentage}', diffPercentage.toFixed(2));
	template = template.replaceAll('{threshold}', pixelmatchOptions.threshold);
	template = template.replaceAll('{includeAA}', pixelmatchOptions.includeAA ? 'Yes' : 'No');
	template = template.replaceAll('{alpha}', pixelmatchOptions.alpha);

	// Create a more unique filename
	const filename = `${timestamp}-${property}-${urlKey}-${viewport.name}-compare.html`;
	const reportPath = path.join(reportsDir, filename);

	// Save the report
	fs.writeFileSync(reportPath, template);

	// Generate full URLs
	const reportUrl = `${reportDomain}/${path.relative(process.cwd(), reportPath)}`;
	const diffUrl = `${reportDomain}/${path.relative(process.cwd(), diffPath)}`;

	return { reportPath, reportUrl, diffUrl };
}

/**
 * Get the basename of a filepath
 * @param {string} filepath - The filepath to process
 * @returns {string} The basename without extension
 */
function getBasename(filepath) {
	return filepath
		.split('/')
		.pop()
		.replace(/\.[^/.]+$/, '');
}

/**
 * Compare a single slug
 * @param {string} slug - Slug to compare
 * @param {object} config - Configuration object
 * @param {string} reportsDir - Reports directory
 * @param {string} comparesDir - Compares directory
 * @returns {object|null} Comparison result or null if failed
 */
async function compareSlug(slug, config, reportsDir = 'reports', comparesDir = 'compares') {
	const reportDomain = config.defaults.report_domain;
	const image1 = path.join('controls', `${slug}.png`);
	const image2 = path.join('captures', `${slug}.png`);
	const html1 = path.join('controls', 'html', `${slug}.html`);
	const html2 = path.join('captures', 'html', `${slug}.html`);

	if (!fs.existsSync(image1) || !fs.existsSync(image2)) {
		console.error(`One or both images do not exist for slug: ${slug}`);
		return null;
	}

	let img1 = PNG.sync.read(fs.readFileSync(image1));
	let img2 = PNG.sync.read(fs.readFileSync(image2));

	if (img1.width !== img2.width) {
		console.error(`Images must have the same width for slug: ${slug}`);
		return null;
	}

	const maxHeight = Math.max(img1.height, img2.height);
	if (img1.height < maxHeight) {
		img1 = padImage(img1, maxHeight);
	}
	if (img2.height < maxHeight) {
		img2 = padImage(img2, maxHeight);
	}

	const diff = new PNG({ width: img1.width, height: maxHeight });

	// Get property-specific options or use defaults
	const parts = slug.split('-');
	const property = parts[0];
	const propertyConfig = config[property] || {};
	const pixelmatchOptions = {
		...defaultPixelmatchOptions,
		...propertyConfig.pixelmatchOptions,
	};

	const numDiffPixels = pixelmatch(
		img1.data,
		img2.data,
		diff.data,
		img1.width,
		maxHeight,
		pixelmatchOptions
	);

	// Calculate percentage difference
	const totalPixels = img1.width * maxHeight;
	const diffPercentage = (numDiffPixels / totalPixels) * 100;

	// Extract URL key and viewport from slug
	const viewportName = parts[parts.length - 1];
	const urlKey = parts.slice(1, -1).join('-');

	// Find the viewport configuration
	let viewport = null;
	if (config[property]?.viewports) {
		viewport = config[property].viewports.find(
			(v) => v.name === viewportName
		);
	}

	if (!viewport && config.defaults.viewports) {
		viewport = config.defaults.viewports.find(
			(v) => v.name === viewportName
		);
	}

	if (!viewport) {
		viewport = { name: viewportName, width: 0, height: 0 };
	}

	// Save diff image
	const diffPath = path.join(comparesDir, `${slug}-diff.png`);
	fs.writeFileSync(diffPath, PNG.sync.write(diff));

	// Generate report
	const result = await generateReport(
		image1,
		image2,
		diffPath,
		property,
		urlKey,
		viewport,
		diffPercentage,
		pixelmatchOptions,
		reportsDir,
		reportDomain
	);

	// Generate HTML diff if HTML files exist
	if (fs.existsSync(html1) && fs.existsSync(html2)) {
		const originalHTML = fs.readFileSync(html1, 'utf8');
		const secondHTML = fs.readFileSync(html2, 'utf8');
		const htmlDiffReport = generateHTMLDiffReport(
			originalHTML,
			secondHTML,
			property,
			urlKey,
			viewport
		);

		if (htmlDiffReport.hasChanges) {
			const htmlDiffPath = path.join(
				reportsDir,
				`${slug}-html-diff.html`
			);
			fs.writeFileSync(htmlDiffPath, htmlDiffReport.htmlDiffTemplate);
		}
	}

	return result;
}

/**
 * Compare all URLs for a property
 * @param {string} property - Property name
 * @param {object} config - Configuration object
 * @param {string} reportsDir - Reports directory
 * @param {string} comparesDir - Compares directory
 */
async function compareProperty(property, config, reportsDir = 'reports', comparesDir = 'compares') {
	const propertyConfig = config[property];
	if (!propertyConfig || !propertyConfig.urls) {
		console.error(`No URLs configured for property: ${property}`);
		return;
	}

	const viewports = getViewports(property, config);
	console.log(
		`Using viewports for ${property}:`,
		viewports.map((v) => v.name)
	);

	const reports = [];

	// Create property-specific directories
	const propertyReportsDir = path.join(reportsDir, property);
	const propertyComparesDir = path.join(comparesDir, property);
	if (!fs.existsSync(propertyReportsDir)) {
		fs.mkdirSync(propertyReportsDir, { recursive: true });
	}
	if (!fs.existsSync(propertyComparesDir)) {
		fs.mkdirSync(propertyComparesDir, { recursive: true });
	}

	for (const [urlKey, url] of Object.entries(propertyConfig.urls)) {
		for (const viewport of viewports) {
			const slug = `${property}-${urlKey}-${viewport.name}`;
			console.log(`Comparing ${slug}...`);
			const result = await compareSlug(slug, config, reportsDir, comparesDir);
			if (result) {
				reports.push({
					...result,
					property,
					urlKey,
					viewport,
					slug,
				});
			}
		}
	}

	console.log(`Comparison complete for property: ${property}`);
	console.log(`Generated ${reports.length} reports`);
}

export { 
	compareSlug, 
	compareProperty, 
	isPropertyKey, 
	getViewports,
	compareHTML,
	generateHTMLDiffReport,
	defaultPixelmatchOptions 
};