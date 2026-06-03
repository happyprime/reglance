import fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import path from 'path';
import open from 'open';
import { diffLines } from 'diff';

// Read config file
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const port = config.defaults.port || 3000;
const serveOrigin = `http://localhost:${port}`;

// Default pixelmatch options
const defaultPixelmatchOptions = {
	threshold: 0.1,
	includeAA: false,
	alpha: 0.1,
	diffColor: [255, 0, 0], // Red for differences
	diffColorAlt: [0, 0, 255], // Blue for anti-aliased differences
	diffMask: false,
};

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
/**
 *
 * @param input
 */
function isPropertyKey(input) {
	return config[input] !== undefined;
}

// Function to get viewports for a property, falling back to defaults
/**
 *
 * @param property
 */
function getViewports(property) {
	return config[property]?.viewports || config.defaults.viewports;
}

// Function to escape HTML special characters
/**
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

// Function to compare HTML content
/**
 *
 * @param html1
 * @param html2
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

// Function to generate HTML diff report
/**
 *
 * @param originalHTML
 * @param secondHTML
 * @param property
 * @param urlKey
 * @param viewport
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

// Function to generate index.html for a property
/**
 *
 * @param property
 * @param reports
 */
function generatePropertyIndex(property, reports) {
	const viewports = getViewports(property);
	const urls = config[property].urls;

	// Read the diff viewer template
	const diffViewerTemplate = fs.readFileSync('diff-viewer.html', 'utf8');

	// Get the pixelmatch options for this property
	const pixelmatchOptions =
		config[property]?.pixelmatchOptions || defaultPixelmatchOptions;

	// Compute path from index location to assets
	const assetsRelPath = path.relative(
		path.join(reportsDir, property),
		'assets'
	);

	let indexContent = `
<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${property} - Visual Regression Reports</title>
	<link rel="stylesheet" href="${assetsRelPath}/index-style.css">
</head>
<body>
	<h1>${property} - Visual Regression Reports</h1>

	<div class="settings">
		<h2>Comparison Settings</h2>
		<div class="settings-grid">
			<div class="setting-item">
				<span class="setting-label">Threshold</span>
				<span class="setting-value">${pixelmatchOptions.threshold}</span>
			</div>
			<div class="setting-item">
				<span class="setting-label">Include Anti-Aliasing</span>
				<span class="setting-value">${pixelmatchOptions.includeAA ? 'Yes' : 'No'}</span>
			</div>
			<div class="setting-item">
				<span class="setting-label">Alpha Threshold</span>
				<span class="setting-value">${pixelmatchOptions.alpha}</span>
			</div>
			<div class="setting-item">
				<span class="setting-label">Diff Color</span>
				<span class="setting-value" style="color: rgb(${pixelmatchOptions.diffColor.join(',')})">RGB(${pixelmatchOptions.diffColor.join(',')})</span>
			</div>
		</div>
	</div>

	<div class="filter-bar">
		<label>Search: <input type="text" id="filterSearch" placeholder="Filter by URL..."></label>
		<label>Viewport:
			<select id="filterViewport">
				<option value="">All</option>
				${viewports.map((v) => `<option value="${v.name}">${v.name} (${v.width}x${v.height})</option>`).join('\n\t\t\t\t')}
			</select>
		</label>
		<label>Differences:
			<select id="filterDiff">
				<option value="">All</option>
				<option value="has">Has differences</option>
				<option value="none">No differences</option>
			</select>
		</label>
	</div>

	<div class="table-wrapper">
	<table id="reportsTable">
		<thead>
			<tr>
				<th data-sort="url">URL <span class="sort-indicator"></span></th>
				<th data-sort="viewport">Viewport <span class="sort-indicator"></span></th>
				<th data-sort="diff">Visual Difference <span class="sort-indicator"></span></th>
				<th data-sort="html">HTML Changes <span class="sort-indicator"></span></th>
				<th>Report</th>
				<th>Visual Diff</th>
				<th>HTML Diff</th>
			</tr>
		</thead>
		<tbody>
	`;

	// Sort reports by difference percentage (highest first)
	reports.sort((a, b) => b.diffPercentage - a.diffPercentage);

	// Index lives at reports/<property>/index.html — compute paths relative to that
	const indexDir = path.join(reportsDir, property);

	// Prepare diff data for JavaScript
	const diffData = reports.map((report) => ({
		property: property,
		urlKey:
			Object.entries(urls).find(([_, url]) => url === report.url)?.[0] ||
			'unknown',
		viewport: report.viewport,
		diffUrl: path.relative(indexDir, report.diffPath),
		htmlDiffUrl: path.relative(indexDir, report.htmlDiffPath),
		diffPercentage: report.diffPercentage,
		htmlHasChanges: report.htmlHasChanges,
	}));

	for (const [index, report] of reports.entries()) {
		const urlKey =
			Object.entries(urls).find(([_, url]) => url === report.url)?.[0] ||
			'unknown';
		const diffClass =
			report.diffPercentage > 1
				? 'high'
				: report.diffPercentage > 0.1
					? 'medium'
					: 'low';
		const htmlDiffClass = report.htmlHasChanges ? 'high' : 'low';

		const relativeReportPath = path.relative(indexDir, report.reportPath);
		const relativeHtmlDiffPath = path.relative(
			indexDir,
			report.htmlDiffPath
		);

		indexContent += `
			<tr data-url="${report.url}" data-viewport="${report.viewport.name}" data-diff="${report.diffPercentage}" data-index="${index}">
				<td class="url-cell" title="${report.url}">${report.url}</td>
				<td>${report.viewport.name} (${report.viewport.width}x${report.viewport.height})</td>
				<td class="diff-percentage ${diffClass}">${report.diffPercentage.toFixed(2)}%</td>
				<td class="diff-percentage ${htmlDiffClass}">${report.htmlHasChanges ? 'Yes' : 'No'}</td>
				<td><a href="${relativeReportPath}">View Report</a></td>
				<td><a href="#" onclick="openModal(window.diffData, ${index}); return false;">View Diff</a></td>
				<td><a href="${relativeHtmlDiffPath}">View HTML Diff</a></td>
			</tr>
		`;
	}

	indexContent += `
		</tbody>
	</table>
	</div>
	${diffViewerTemplate}
	<script>
		window.diffData = ${JSON.stringify(diffData)};
	</script>
	<script>
	(function() {
		const search = document.getElementById('filterSearch');
		const viewport = document.getElementById('filterViewport');
		const diff = document.getElementById('filterDiff');
		const tbody = document.querySelector('#reportsTable tbody');

		function filterRows() {
			const q = search.value.toLowerCase();
			const vp = viewport.value;
			const d = diff.value;
			const rows = tbody.querySelectorAll('tr');
			rows.forEach(function(row) {
				const url = row.getAttribute('data-url').toLowerCase();
				const rv = row.getAttribute('data-viewport');
				const dp = parseFloat(row.getAttribute('data-diff'));
				let show = true;
				if (q && url.indexOf(q) === -1) show = false;
				if (vp && rv !== vp) show = false;
				if (d === 'has' && dp === 0) show = false;
				if (d === 'none' && dp > 0) show = false;
				row.style.display = show ? '' : 'none';
			});
		}

		search.addEventListener('input', filterRows);
		viewport.addEventListener('change', filterRows);
		diff.addEventListener('change', filterRows);

		// Sorting
		let currentSort = { col: null, asc: true };
		document.querySelectorAll('th[data-sort]').forEach(function(th) {
			th.addEventListener('click', function() {
				const col = th.getAttribute('data-sort');
				if (currentSort.col === col) {
					currentSort.asc = !currentSort.asc;
				} else {
					currentSort.col = col;
					currentSort.asc = true;
				}
				const rows = Array.from(tbody.querySelectorAll('tr'));
				rows.sort(function(a, b) {
					let va, vb;
					if (col === 'url') {
						va = a.getAttribute('data-url');
						vb = b.getAttribute('data-url');
					} else if (col === 'viewport') {
						va = a.getAttribute('data-viewport');
						vb = b.getAttribute('data-viewport');
					} else if (col === 'diff') {
						va = parseFloat(a.getAttribute('data-diff'));
						vb = parseFloat(b.getAttribute('data-diff'));
						return currentSort.asc ? va - vb : vb - va;
					} else if (col === 'html') {
						va = a.children[3].textContent;
						vb = b.children[3].textContent;
					}
					if (va < vb) return currentSort.asc ? -1 : 1;
					if (va > vb) return currentSort.asc ? 1 : -1;
					return 0;
				});
				rows.forEach(function(r) { tbody.appendChild(r); });
				document.querySelectorAll('th .sort-indicator').forEach(function(s) { s.textContent = ''; });
				th.querySelector('.sort-indicator').textContent = currentSort.asc ? '\\u25B2' : '\\u25BC';
			});
		});
	})();
	</script>
</body>
</html>
	`;

	return indexContent;
}

// Function to pad an image to a specific height
/**
 *
 * @param img
 * @param targetHeight
 */
function padImage(img, targetHeight) {
	const paddedImg = new PNG({ width: img.width, height: targetHeight });
	PNG.bitblt(img, paddedImg, 0, 0, img.width, img.height, 0, 0);
	return paddedImg;
}

/**
 * Generate a report for a comparison
 *
 * @param {string} originalPath - Path to the original image
 * @param {string} secondPath - Path to the second image
 * @param {string} diffPath - Path to the diff image
 * @param {string} property - The property key
 * @param {string} urlKey - The URL key
 * @param {object} viewport - The viewport configuration
 * @param {number} diffPercentage - The percentage of pixels that differ
 * @param {object} pixelmatchOptions - The options used for pixelmatch
 * @returns {Promise<{reportPath: string, diffPath: string}>}
 */
async function generateReport(
	originalPath,
	secondPath,
	diffPath,
	property,
	urlKey,
	viewport,
	diffPercentage,
	pixelmatchOptions
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

	// Add diff image path for the toggle functionality
	template = template.replaceAll('{diffImage}', relativeDiff);

	// Add context placeholders
	template = template.replaceAll('{property}', property);
	template = template.replaceAll('{urlKey}', urlKey);
	template = template.replaceAll('{viewportName}', viewport.name);
	template = template.replaceAll('{viewportWidth}', viewport.width);
	template = template.replaceAll('{viewportHeight}', viewport.height);

	// Add diff percentage and options to the template
	template = template.replaceAll(
		'{diffPercentage}',
		diffPercentage.toFixed(2)
	);
	template = template.replaceAll('{threshold}', pixelmatchOptions.threshold);
	template = template.replaceAll(
		'{includeAA}',
		pixelmatchOptions.includeAA ? 'Yes' : 'No'
	);
	template = template.replaceAll('{alpha}', pixelmatchOptions.alpha);

	// Create a more unique filename
	const filename = `${timestamp}-${property}-${urlKey}-${viewport.name}-compare.html`;
	const reportPath = path.join(reportsDir, filename);

	// Save the report
	fs.writeFileSync(reportPath, template);

	return { reportPath, diffPath };
}

// Function to compare a single slug
/**
 *
 * @param slug
 */
async function compareSlug(slug) {
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
		console.error(
			`Could not find viewport configuration for ${viewportName} in property ${property}`
		);
		console.error('Available viewports:');
		if (config[property]?.viewports) {
			console.error(
				`Property ${property} viewports:`,
				config[property].viewports.map((v) => v.name)
			);
		}
		console.error(
			'Default viewports:',
			config.defaults.viewports.map((v) => v.name)
		);
		return null;
	}

	const diffPath = path.join(comparesDir, `${slug}-diff.png`);
	fs.writeFileSync(diffPath, PNG.sync.write(diff));

	// Compare HTML content
	let htmlDiffResult = { hasChanges: false, htmlDiffTemplate: '' };
	if (fs.existsSync(html1) && fs.existsSync(html2)) {
		const html1Content = fs.readFileSync(html1, 'utf8');
		const html2Content = fs.readFileSync(html2, 'utf8');
		htmlDiffResult = generateHTMLDiffReport(
			html1Content,
			html2Content,
			property,
			urlKey,
			viewport
		);
	}

	// Save HTML diff report
	const htmlDiffPath = path.join(comparesDir, `${slug}-html-diff.html`);
	fs.writeFileSync(htmlDiffPath, htmlDiffResult.htmlDiffTemplate);

	const report = await generateReport(
		image1,
		image2,
		diffPath,
		property,
		urlKey,
		viewport,
		diffPercentage,
		pixelmatchOptions
	);
	return {
		reportPath: report.reportPath,
		diffPath: report.diffPath,
		htmlDiffPath,
		htmlHasChanges: htmlDiffResult.hasChanges,
		diffPercentage,
		numDiffPixels,
		totalPixels,
		pixelmatchOptions,
	};
}

// Function to compare all URLs for a property
/**
 *
 * @param property
 */
async function compareProperty(property) {
	const propertyConfig = config[property];
	if (!propertyConfig || !propertyConfig.urls) {
		console.error(`No URLs configured for property: ${property}`);
		return;
	}

	const viewports = getViewports(property);
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

			const result = await compareSlug(slug);
			if (result) {
				reports.push({
					url: url,
					viewport: viewport,
					...result,
				});
			}
		}
	}

	// Generate index file
	const indexContent = generatePropertyIndex(property, reports);
	const indexPath = path.join(propertyReportsDir, 'index.html');
	fs.writeFileSync(indexPath, indexContent);

	const reportUrl = `${serveOrigin}/${path.relative(process.cwd(), indexPath)}`;
	console.log(`\nProperty comparison complete for ${property}`);
	console.log(`Index file generated at: ${reportUrl}`);

	// Open the report in the default browser
	await open(reportUrl);
}

// Main function
/**
 *
 */
async function main() {
	if (isPropertyKey(input)) {
		await compareProperty(input);
	} else {
		const result = await compareSlug(input);
		if (result) {
			console.log(`\nComparison complete for ${input}`);
			const reportUrl = `${serveOrigin}/${result.reportPath}`;
			console.log(`Report generated at: ${reportUrl}`);
			console.log(`Diff image saved as: ${result.diffPath}`);

			// Open the report in the default browser
			await open(reportUrl);
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
