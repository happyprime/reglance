import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateIndex, generateReport } from '../src/report.mjs';

/**
 * Build a minimal normalized-config shape with a real reports directory.
 *
 * @returns {object} The config stub.
 */
function tempConfig() {
	const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reglance-test-'));
	const reports = path.join(outputDir, 'reports');
	fs.mkdirSync(reports, { recursive: true });
	return {
		name: 'My Site',
		viewports: [{ name: 'desktop', width: 1920, height: 1080 }],
		pixelmatchOptions: {
			threshold: 0.1,
			includeAA: false,
			alpha: 0.1,
			diffColor: [255, 0, 0],
		},
		dirs: {
			reports,
			compares: path.join(outputDir, 'compares'),
		},
	};
}

/**
 * A single comparison report record for the index.
 *
 * @param {object} config - The config stub (for path bases).
 * @param {object} [over] - Field overrides.
 * @returns {object} The report record.
 */
function sampleReport(config, over = {}) {
	return {
		url: 'https://site.test/',
		urlKey: 'home',
		viewport: { name: 'desktop', width: 1920, height: 1080 },
		controlImage: path.join(
			config.dirs.compares,
			'home-desktop-control.png'
		),
		captureImage: path.join(
			config.dirs.compares,
			'home-desktop-capture.png'
		),
		diffImage: path.join(config.dirs.compares, 'home-desktop-diff.png'),
		htmlDiffPath: path.join(
			config.dirs.compares,
			'home-desktop-html-diff.html'
		),
		reportPath: path.join(config.dirs.reports, 'home-desktop-compare.html'),
		diffPercentage: 2.5,
		htmlHasChanges: true,
		imageWidth: 1920,
		imageHeight: 4000,
		...over,
	};
}

test('generateReport gives the reveal slider ARIA slider semantics', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateReport(config, sampleReport(config)),
		'utf8'
	);
	assert.match(html, /role="slider"/);
	assert.match(html, /aria-label="Reveal amount/);
	assert.match(html, /aria-valuemin="0"/);
	assert.match(html, /aria-valuemax="100"/);
	assert.match(html, /aria-valuenow="50"/);
});

test('generateIndex makes sortable headers keyboard-operable with sort state', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateIndex(config, [sampleReport(config)]),
		'utf8'
	);

	// Each sortable header carries an initial aria-sort and a real button.
	assert.match(html, /<th data-sort="url" aria-sort="none">/);
	assert.match(html, /<button type="button" class="th-sort">/);
	// The decorative arrow is hidden from assistive tech.
	assert.match(html, /class="sort-indicator" aria-hidden="true"/);
});

test('generateIndex labels the modal close/prev/next buttons', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateIndex(config, [sampleReport(config)]),
		'utf8'
	);
	assert.match(html, /aria-label="Close diff viewer"/);
	assert.match(html, /aria-label="Previous diff"/);
	assert.match(html, /aria-label="Next diff"/);
});
