import fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import path from 'path';
import crypto from 'crypto';

// Read config file
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const reportDomain = config.defaults.report_domain;

// Get command line arguments
const [, , input] = process.argv;

// Check if input is provided
if (!input) {
	console.error('Please provide either a slug or property key.');
	console.error('Usage: node compare.js <slug|property>');
	console.error('Example: node compare.js pcouncil-single-desktop');
	console.error('Example: node compare.js pcouncil');
	process.exit(1);
}

// Function to check if input is a property key
function isPropertyKey(input) {
	return config[input] !== undefined;
}

// Function to get viewports for a property, falling back to defaults
function getViewports(property) {
	return config[property]?.viewports || config.defaults.viewports;
}

// Function to generate index.html for a property
function generatePropertyIndex(property, reports) {
	const viewports = getViewports(property);
	const urls = config[property].urls;

	// Read the diff viewer template
	const diffViewerTemplate = fs.readFileSync('diff-viewer.html', 'utf8');

	let indexContent = `
<!DOCTYPE html>
<html>
<head>
	<title>${property} - Visual Regression Reports</title>
	<style>
		body { font-family: sans-serif; margin: 2rem; }
		table { border-collapse: collapse; width: 100%; }
		th, td { padding: 0.5rem; border: 1px solid #ddd; text-align: left; }
		th { background: #f5f5f5; }
		tr:hover { background: #f9f9f9; }
		a { color: #0066cc; text-decoration: none; }
		a:hover { text-decoration: underline; }
		.diff-percentage { font-weight: bold; }
		.diff-percentage.high { color: #d32f2f; }
		.diff-percentage.medium { color: #f57c00; }
		.diff-percentage.low { color: #388e3c; }
	</style>
</head>
<body>
	<h1>${property} - Visual Regression Reports</h1>
	<table>
		<thead>
			<tr>
				<th>URL</th>
				<th>Viewport</th>
				<th>Difference</th>
				<th>Report</th>
				<th>Diff</th>
			</tr>
		</thead>
		<tbody>
	`;

	// Sort reports by difference percentage (highest first)
	reports.sort((a, b) => b.diffPercentage - a.diffPercentage);

	// Prepare diff data for JavaScript
	const diffData = reports.map(report => ({
		property: property,
		urlKey: Object.entries(urls).find(([_, url]) => url === report.url)?.[0] || 'unknown',
		viewport: report.viewport,
		diffUrl: report.diffUrl,
		diffPercentage: report.diffPercentage
	}));

	for (const [index, report] of reports.entries()) {
		const urlKey = Object.entries(urls).find(([_, url]) => url === report.url)?.[0] || 'unknown';
		const diffClass = report.diffPercentage > 1 ? 'high' :
			report.diffPercentage > 0.1 ? 'medium' : 'low';

		indexContent += `
			<tr>
				<td>${report.url}</td>
				<td>${report.viewport.name} (${report.viewport.width}x${report.viewport.height})</td>
				<td class="diff-percentage ${diffClass}">${report.diffPercentage.toFixed(2)}%</td>
				<td><a href="${report.reportUrl}">View Report</a></td>
				<td><a href="#" onclick="openModal(window.diffData, ${index}); return false;">View Diff</a></td>
			</tr>
		`;
	}

	indexContent += `
		</tbody>
	</table>
	${diffViewerTemplate}
	<script>
		window.diffData = ${JSON.stringify(diffData)};
	</script>
</body>
</html>
	`;

	return indexContent;
}

// Function to pad an image to a specific height
function padImage(img, targetHeight) {
	const paddedImg = new PNG({ width: img.width, height: targetHeight });
	PNG.bitblt(img, paddedImg, 0, 0, img.width, img.height, 0, 0);
	return paddedImg;
}

/**
 * Generate a report for a comparison
 * @param {string} originalPath - Path to the original image
 * @param {string} secondPath - Path to the second image
 * @param {string} diffPath - Path to the diff image
 * @param {string} property - The property key
 * @param {string} urlKey - The URL key
 * @param {Object} viewport - The viewport configuration
 * @param {number} diffPercentage - The percentage of pixels that differ
 * @returns {Promise<{reportPath: string, reportUrl: string, diffUrl: string}>}
 */
async function generateReport(originalPath, secondPath, diffPath, property, urlKey, viewport, diffPercentage) {
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

	// Add diff image path for the toggle functionality
	template = template.replaceAll('{diffImage}', relativeDiff);

	// Add diff percentage to the template
	template = template.replaceAll('{diffPercentage}', diffPercentage.toFixed(2));

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
 * Generate a SHA-256 hash of a string
 * @param {string} str - The string to hash
 * @returns {Promise<string>} The hexadecimal hash
 */
async function sha256(str) {
	const encoder = new TextEncoder();
	const data = encoder.encode(str);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Function to compare a single slug
async function compareSlug(slug) {
	const image1 = path.join('controls', `${slug}.png`);
	const image2 = path.join('captures', `${slug}.png`);

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
	const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, maxHeight, {
		threshold: 0.1,
	});

	// Calculate percentage difference
	const totalPixels = img1.width * maxHeight;
	const diffPercentage = (numDiffPixels / totalPixels) * 100;

	// Extract property, URL key, and viewport from slug
	const parts = slug.split('-');
	const property = parts[0];
	const viewportName = parts[parts.length - 1];
	const urlKey = parts.slice(1, -1).join('-');

	// Find the viewport configuration
	let viewport = null;
	if (config[property]?.viewports) {
		viewport = config[property].viewports.find(v => v.name === viewportName);
	}

	if (!viewport && config.defaults.viewports) {
		viewport = config.defaults.viewports.find(v => v.name === viewportName);
	}

	if (!viewport) {
		console.error(`Could not find viewport configuration for ${viewportName} in property ${property}`);
		console.error('Available viewports:');
		if (config[property]?.viewports) {
			console.error(`Property ${property} viewports:`, config[property].viewports.map(v => v.name));
		}
		console.error('Default viewports:', config.defaults.viewports.map(v => v.name));
		return null;
	}

	const diffPath = path.join(comparesDir, `${slug}-diff.png`);
	fs.writeFileSync(diffPath, PNG.sync.write(diff));

	const reportPath = await generateReport(image1, image2, diffPath, property, urlKey, viewport, diffPercentage);
	return {
		reportPath,
		reportUrl: reportPath.reportUrl,
		diffUrl: reportPath.diffUrl,
		diffPercentage,
		numDiffPixels,
		totalPixels
	};
}

// Function to compare all URLs for a property
async function compareProperty(property) {
	const propertyConfig = config[property];
	if (!propertyConfig || !propertyConfig.urls) {
		console.error(`No URLs configured for property: ${property}`);
		return;
	}

	const viewports = getViewports(property);
	console.log(`Using viewports for ${property}:`, viewports.map(v => v.name));

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

			const result = await compareSlug(slug);
			if (result) {
				reports.push({
					url: url,
					viewport: viewport,
					...result
				});
			}
		}
	}

	// Generate index file
	const indexContent = generatePropertyIndex(property, reports);
	const indexPath = path.join(propertyReportsDir, 'index.html');
	fs.writeFileSync(indexPath, indexContent);

	console.log(`\nProperty comparison complete for ${property}`);
	console.log(`Index file generated at: ${reportDomain}/${path.relative(process.cwd(), indexPath)}`);
}

// Main function
async function main() {
	if (isPropertyKey(input)) {
		await compareProperty(input);
	} else {
		const result = await compareSlug(input);
		if (result) {
			console.log(`\nComparison complete for ${input}`);
			console.log(`Report generated at: ${result.reportUrl}`);
			console.log(`Diff image saved as: ${result.diffUrl}`);
		}
	}
}

// Create reports and compares directories if they don't exist
const reportsDir = 'reports';
const comparesDir = 'compares';
if (!fs.existsSync(reportsDir)) {
	fs.mkdirSync(reportsDir);
}
if (!fs.existsSync(comparesDir)) {
	fs.mkdirSync(comparesDir);
}

// Call the main function
main().catch(console.error);
