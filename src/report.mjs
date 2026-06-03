import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates', import.meta.url));

/**
 * Read a template file that ships with the package.
 *
 * @param {string} name - The template filename.
 * @returns {string} The template contents.
 */
function readTemplate(name) {
	return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
}

/**
 * Copy the report assets (CSS/JS) into the output directory.
 *
 * @param {object} config - The normalized config.
 */
export function copyAssets(config) {
	fs.mkdirSync(config.dirs.assets, { recursive: true });
	fs.cpSync(path.join(TEMPLATES_DIR, 'assets'), config.dirs.assets, {
		recursive: true,
	});
}

/**
 * Escape HTML special characters.
 *
 * @param {string} str - The string to escape.
 * @returns {string} The escaped string.
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
 * Build an HTML diff report comparing two HTML snapshots.
 *
 * @param {string} html1    - The control HTML.
 * @param {string} html2    - The latest HTML.
 * @param {object} context  - Report context ({ name, urlKey, viewport }).
 * @param {Function} diffLines - The diffLines function from the diff package.
 * @returns {{ hasChanges: boolean, html: string }}
 */
export function generateHtmlDiff(html1, html2, context, diffLines) {
	const { name, urlKey, viewport } = context;
	const changes = diffLines(html1, html2);
	let hasChanges = false;

	// Build the diff via an array join rather than repeated `+=` so a large
	// document doesn't reallocate an ever-growing string per line.
	const parts = [];
	for (const part of changes) {
		const cls = part.added
			? 'diff-added'
			: part.removed
				? 'diff-removed'
				: 'diff-unchanged';
		const marker = part.added ? '+' : part.removed ? '-' : ' ';
		if (part.added || part.removed) {
			hasChanges = true;
		}
		parts.push(
			`<div class="${cls}"><span class="line-number">${marker}</span><span class="line-content">${escapeHtml(part.value)}</span></div>`
		);
	}
	const diffContent = parts.join('');

	const template = readTemplate('html-diff.html');
	const html = template
		.replaceAll('{name}', name)
		.replaceAll('{urlKey}', urlKey)
		.replaceAll('{viewportName}', viewport.name)
		.replaceAll('{viewportWidth}', String(viewport.width))
		.replaceAll('{viewportHeight}', String(viewport.height))
		.replaceAll('{status}', hasChanges ? 'Changes detected' : 'No changes')
		.replaceAll('{diffContent}', diffContent);

	return { hasChanges, html };
}

/**
 * Generate a single visual comparison report.
 *
 * @param {object} config  - The normalized config.
 * @param {object} report  - The report data for one slug.
 * @returns {string} Path to the written report.
 */
export function generateReport(config, report) {
	const { dirs, name, pixelmatchOptions } = config;
	const { urlKey, viewport, controlImage, captureImage, diffImage } = report;

	let template = readTemplate('report.html');

	// Paths in the report are relative to the reports directory.
	const rel = (target) => path.relative(dirs.reports, target);

	template = template
		.replaceAll('{name}', name)
		.replaceAll('{urlKey}', urlKey)
		.replaceAll('{viewportName}', viewport.name)
		.replaceAll('{viewportWidth}', String(viewport.width))
		.replaceAll('{viewportHeight}', String(viewport.height))
		.replaceAll('{originalImage}', rel(controlImage))
		.replaceAll('{secondImage}', rel(captureImage))
		.replaceAll('{diffImage}', rel(diffImage))
		.replaceAll('{controlWidth}', String(report.controlWidth ?? ''))
		.replaceAll('{controlHeight}', String(report.controlHeight ?? ''))
		.replaceAll('{captureWidth}', String(report.captureWidth ?? ''))
		.replaceAll('{captureHeight}', String(report.captureHeight ?? ''))
		.replaceAll('{diffPercentage}', report.diffPercentage.toFixed(2))
		.replaceAll('{threshold}', String(pixelmatchOptions.threshold))
		.replaceAll('{includeAA}', pixelmatchOptions.includeAA ? 'Yes' : 'No')
		.replaceAll('{alpha}', String(pixelmatchOptions.alpha));

	const filename = `${urlKey}-${viewport.name}-compare.html`;
	const reportPath = path.join(dirs.reports, filename);
	fs.writeFileSync(reportPath, template);

	return reportPath;
}

/**
 * Generate the index page summarizing every comparison.
 *
 * @param {object} config  - The normalized config.
 * @param {Array}  reports - The comparison results.
 * @returns {string} Path to the written index file.
 */
export function generateIndex(config, reports) {
	const { dirs, name, viewports, pixelmatchOptions } = config;
	const diffViewer = readTemplate('diff-viewer.html');

	// Sort reports by visual difference, highest first.
	const sorted = [...reports].sort(
		(a, b) => b.diffPercentage - a.diffPercentage
	);

	const rel = (target) => path.relative(dirs.reports, target);

	const diffData = sorted.map((report) => ({
		name,
		urlKey: report.urlKey,
		viewport: report.viewport,
		diffUrl: rel(report.diffImage),
		htmlDiffUrl: rel(report.htmlDiffPath),
		diffPercentage: report.diffPercentage,
		htmlHasChanges: report.htmlHasChanges,
		diffWidth: report.diffWidth,
		diffHeight: report.diffHeight,
	}));

	const rows = sorted
		.map((report, index) => {
			const diffClass =
				report.diffPercentage > 1
					? 'high'
					: report.diffPercentage > 0.1
						? 'medium'
						: 'low';
			const htmlDiffClass = report.htmlHasChanges ? 'high' : 'low';

			return `
			<tr data-url="${report.url}" data-viewport="${report.viewport.name}" data-diff="${report.diffPercentage}" data-index="${index}">
				<td class="url-cell" title="${report.url}">${report.url}</td>
				<td>${report.viewport.name} (${report.viewport.width}x${report.viewport.height})</td>
				<td class="diff-percentage ${diffClass}"><span class="visually-hidden">${diffClass} difference: </span>${report.diffPercentage.toFixed(2)}%</td>
				<td class="diff-percentage ${htmlDiffClass}">${report.htmlHasChanges ? 'Yes' : 'No'}</td>
				<td><a href="${rel(report.reportPath)}">View Report</a></td>
				<td><a href="#" onclick="openModal(window.diffData, ${index}); return false;">View Diff</a></td>
				<td><a href="${rel(report.htmlDiffPath)}">View HTML Diff</a></td>
			</tr>`;
		})
		.join('');

	const viewportOptions = viewports
		.map(
			(v) =>
				`<option value="${v.name}">${v.name} (${v.width}x${v.height})</option>`
		)
		.join('\n\t\t\t\t');

	const template = readTemplate('index.html');
	const indexHtml = template
		.replaceAll('{name}', name)
		.replaceAll('{threshold}', String(pixelmatchOptions.threshold))
		.replaceAll('{includeAA}', pixelmatchOptions.includeAA ? 'Yes' : 'No')
		.replaceAll('{alpha}', String(pixelmatchOptions.alpha))
		.replaceAll('{diffColor}', pixelmatchOptions.diffColor.join(','))
		.replaceAll('{viewportOptions}', viewportOptions)
		.replaceAll('{rows}', rows)
		.replaceAll('{diffViewer}', diffViewer)
		.replaceAll('{diffData}', JSON.stringify(diffData));

	const indexPath = path.join(dirs.reports, 'index.html');
	fs.writeFileSync(indexPath, indexHtml);

	return indexPath;
}
