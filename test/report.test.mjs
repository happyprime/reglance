import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	generateIndex,
	generateReport,
	generateHtmlDiff,
	escapeHtml,
	dprLabel,
} from '../src/report.mjs';

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
		controlWidth: 1920,
		controlHeight: 3800,
		captureWidth: 1920,
		captureHeight: 4000,
		diffWidth: 1920,
		diffHeight: 4000,
		...over,
	};
}

test('escapeHtml escapes all five HTML metacharacters', () => {
	assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#039;');
	// & is escaped first so it doesn't double-escape the entities.
	assert.equal(escapeHtml('a&b'), 'a&amp;b');
	assert.equal(escapeHtml('plain'), 'plain');
});

test('dprLabel annotates only non-default device scale factors', () => {
	assert.equal(dprLabel({ name: 'desktop' }), '');
	assert.equal(dprLabel({ name: 'desktop', deviceScaleFactor: 1 }), '');
	assert.equal(dprLabel({ name: 'retina', deviceScaleFactor: 2 }), ' @2x');
	assert.equal(dprLabel({ name: 'frac', deviceScaleFactor: 1.5 }), ' @1.5x');
});

test('generateIndex shows the DPR suffix in the row and viewport filter', () => {
	const config = tempConfig();
	config.viewports = [
		{ name: 'desktop', width: 1920, height: 1080 },
		{ name: 'retina', width: 1920, height: 1080, deviceScaleFactor: 2 },
	];
	const report = sampleReport(config, {
		viewport: {
			name: 'retina',
			width: 1920,
			height: 1080,
			deviceScaleFactor: 2,
		},
	});
	const html = fs.readFileSync(generateIndex(config, [report]), 'utf8');

	// The row's viewport cell carries the suffix.
	assert.match(html, /retina \(1920x1080\) @2x/);
	// The filter <option> for the retina viewport is annotated, while the
	// default-DPR desktop option is left clean.
	assert.match(
		html,
		/<option value="retina">retina \(1920x1080\) @2x<\/option>/
	);
	assert.match(
		html,
		/<option value="desktop">desktop \(1920x1080\)<\/option>/
	);
});

test('generateReport shows the DPR suffix in the meta only when non-default', () => {
	const config = tempConfig();
	const retina = sampleReport(config, {
		viewport: {
			name: 'retina',
			width: 1920,
			height: 1080,
			deviceScaleFactor: 2,
		},
	});
	const retinaHtml = fs.readFileSync(generateReport(config, retina), 'utf8');
	assert.match(retinaHtml, /retina \(1920&times;1080\) @2x/);

	// A default 1x viewport gets no suffix.
	const plainHtml = fs.readFileSync(
		generateReport(config, sampleReport(config)),
		'utf8'
	);
	assert.match(plainHtml, /desktop \(1920&times;1080\)<\/span>/);
});

test('generateIndex picks the severity class at the threshold boundaries', () => {
	const config = tempConfig();
	const cue = (pct) =>
		fs
			.readFileSync(
				generateIndex(config, [
					sampleReport(config, { diffPercentage: pct }),
				]),
				'utf8'
			)
			.match(/class="visually-hidden">(\w+) difference:/)[1];

	// Thresholds are `> 1` high and `> 0.1` medium.
	assert.equal(cue(0.1), 'low'); // not > 0.1
	assert.equal(cue(0.5), 'medium');
	assert.equal(cue(1), 'medium'); // not > 1
	assert.equal(cue(1.5), 'high');
});

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

test('generateIndex escapes config/URL values and hardens the diffData sink', () => {
	const config = tempConfig();
	config.name = '<img src=x onerror=alert(1)>';
	const report = sampleReport(config, {
		url: 'https://site.test/?a=1&b=</script>',
		urlKey: '</script><script>alert(1)</script>',
	});
	const html = fs.readFileSync(generateIndex(config, [report]), 'utf8');

	// Config name is escaped in HTML contexts.
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	// The URL's & and angle brackets are escaped in the row.
	assert.match(
		html,
		/data-url="https:\/\/site\.test\/\?a=1&amp;b=&lt;\/script&gt;"/
	);
	// The diffData JSON sink neutralizes </script> rather than emitting it raw.
	assert.ok(!html.includes('</script><script>alert(1)'));
	assert.ok(html.includes('\\u003c/script>\\u003cscript>alert(1)'));
});

test('generateIndex renders View Diff as a button passing its trigger', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateIndex(config, [sampleReport(config)]),
		'utf8'
	);
	assert.match(
		html,
		/<button type="button" class="link-button" onclick="openModal\(window\.diffData, 0, this\)">View Diff<\/button>/
	);
	// The old fake anchor is gone.
	assert.doesNotMatch(html, /<a href="#" onclick="openModal/);
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

test('generateReport announces the toggle and gives descriptive image alts', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateReport(config, sampleReport(config)),
		'utf8'
	);
	// The right-hand label is a live status region so the toggle is announced.
	assert.match(
		html,
		/id="rightLabel"[^>]*role="status"[^>]*aria-live="polite"/
	);
	// Alts describe the content (which page, which viewport), not the slot.
	assert.match(html, /alt="Second capture of home at desktop"/);
	assert.match(html, /alt="Original \(control\) capture of home at desktop"/);
});

test('generateReport escapes config-derived values in image alts', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateReport(config, sampleReport(config, { urlKey: 'a"b<c' })),
		'utf8'
	);
	// The quote/angle bracket are escaped, not injected raw into the attribute.
	assert.match(html, /alt="Second capture of a&quot;b&lt;c at desktop"/);
});

test('generateReport escapes name/urlKey in the per-comparison template', () => {
	const config = tempConfig();
	config.name = '<b>site</b>';
	const html = fs.readFileSync(
		generateReport(config, sampleReport(config, { urlKey: '<x>' })),
		'utf8'
	);
	assert.match(html, /&lt;b&gt;site&lt;\/b&gt;/);
	assert.match(html, /&lt;x&gt;/);
	assert.doesNotMatch(html, /<h1>[^<]*<b>site<\/b>/);
});

test('generateHtmlDiff escapes the name and urlKey metadata', () => {
	const { html } = generateHtmlDiff(
		'a\n',
		'b\n',
		{
			name: '<img onerror=x>',
			urlKey: '<k>',
			viewport: { name: 'desktop', width: 1, height: 1 },
		},
		(x, y) => [
			{ removed: true, value: x },
			{ added: true, value: y },
		]
	);
	assert.match(html, /&lt;img onerror=x&gt;/);
	assert.match(html, /&lt;k&gt;/);
});

test('generateReport declares image dimensions and async decoding', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateReport(config, sampleReport(config)),
		'utf8'
	);
	// baseImage = the capture; overlay = the control. Both carry intrinsic
	// dimensions so the browser reserves the box (no layout shift).
	assert.match(
		html,
		/id="baseImage"[^>]*width="1920"[^>]*height="4000"[^>]*decoding="async"/
	);
	assert.match(html, /width="1920"[^>]*height="3800"[^>]*decoding="async"/);
});

test('generateIndex carries diff image dimensions for the modal', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateIndex(config, [sampleReport(config)]),
		'utf8'
	);
	assert.match(html, /"diffWidth":1920/);
	assert.match(html, /"diffHeight":4000/);
});

test('generateIndex adds a non-color severity cue to the diff percentage', () => {
	const config = tempConfig();
	// diffPercentage 2.5 → "high" severity class.
	const html = fs.readFileSync(
		generateIndex(config, [sampleReport(config, { diffPercentage: 2.5 })]),
		'utf8'
	);
	assert.match(
		html,
		/<span class="visually-hidden">high difference: <\/span>2\.50%/
	);
});

test('generateIndex includes a live empty-state row for filtered results', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateIndex(config, [sampleReport(config)]),
		'utf8'
	);
	assert.match(html, /<tr id="emptyRow" hidden>/);
	assert.match(
		html,
		/aria-live="polite">No comparisons match your filters\./
	);
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

test('generateIndex renders the diff modal as a labelled dialog', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateIndex(config, [sampleReport(config)]),
		'utf8'
	);
	assert.match(
		html,
		/<div id="diffModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" hidden>/
	);
	// The counter is a live region so navigation between diffs is announced.
	assert.match(html, /id="modalCounter" aria-live="polite"/);
	// The title uses a real field, not the missing `property` (which rendered
	// "undefined").
	assert.doesNotMatch(html, /currentDiff\.property/);
	assert.match(html, /\$\{currentDiff\.name\}/);
});
