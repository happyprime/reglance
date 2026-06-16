import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffLines } from 'diff';
import {
	generateReport,
	buildHtmlDiff,
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
		domain: 'https://site.test',
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
			controls: path.join(outputDir, 'controls'),
			captures: path.join(outputDir, 'captures'),
		},
	};
}

/**
 * A single comparison report record for the index.
 *
 * @param {object} config The config stub (for path bases).
 * @param {object} [over] Field overrides.
 * @returns {object} The report record.
 */
function sampleReport(config, over = {}) {
	return {
		url: 'https://site.test/',
		urlKey: 'home',
		path: '/',
		viewport: { name: 'desktop', width: 1920, height: 1080 },
		controlImage: path.join(config.dirs.controls, 'home-desktop.png'),
		captureImage: path.join(config.dirs.captures, 'home-desktop.png'),
		diffImage: path.join(config.dirs.compares, 'home-desktop-diff.png'),
		diffPercentage: 2.5,
		htmlAdd: 12,
		htmlDel: 4,
		htmlHunks: [{ gap: 3 }],
		htmlNote: '',
		...over,
	};
}

/**
 * Parse the `window.REGLANCE = {...}` blob out of a generated report.
 *
 * @param {string} html The report HTML.
 * @returns {object} The parsed data blob.
 */
function readData(html) {
	const match = html.match(/window\.REGLANCE = (.*?);<\/script>/s);
	assert.ok(match, 'report should embed a window.REGLANCE blob');
	return JSON.parse(match[1]);
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

test('buildHtmlDiff counts added and removed lines', () => {
	const { add, del } = buildHtmlDiff('a\nb\nc\n', 'a\nB\nc\nd\n', diffLines);
	// b → B is one removed + one added; d is one more added.
	assert.equal(add, 2);
	assert.equal(del, 1);
});

test('buildHtmlDiff reports no change for identical snapshots', () => {
	const result = buildHtmlDiff('a\nb\n', 'a\nb\n', diffLines);
	assert.deepEqual(result, { add: 0, del: 0, hunks: [] });
});

test('buildHtmlDiff collapses unchanged runs into gap markers', () => {
	// A change near the top, then many unchanged lines, then a change at the
	// bottom: the middle run should collapse to a single gap.
	const lines = (label) =>
		[label]
			.concat(Array.from({ length: 30 }, (_, i) => `line ${i}`))
			.concat(['tail'])
			.join('\n') + '\n';
	const { hunks } = buildHtmlDiff(lines('OLD'), lines('NEW'), diffLines);
	assert.ok(
		hunks.some((hunk) => typeof hunk.gap === 'number' && hunk.gap > 0),
		'expected a collapsed gap marker'
	);
	// Hunks carry old/new start lines and a lines array.
	const firstHunk = hunks.find((hunk) => hunk.lines);
	assert.ok(firstHunk.o >= 1 && firstHunk.n >= 1);
	assert.ok(Array.isArray(firstHunk.lines));
});

test('buildHtmlDiff finds the nearest enclosing tag for a hunk header', () => {
	const before = '<main id="content">\n\t<p>hello</p>\n</main>\n';
	const after = '<main id="content">\n\t<p>world</p>\n</main>\n';
	const { hunks } = buildHtmlDiff(before, after, diffLines);
	const hunk = hunks.find((x) => x.lines);
	assert.equal(hunk.ctx, '<main id="content">');
});

test('generateReport embeds a window.REGLANCE blob grouped by page', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateReport(config, [sampleReport(config)], {
			comparedAt: 'Jun 12, 2026 · 10:41 AM',
			baselineAt: 'Jun 10, 2026 · 4:03 PM',
			duration: '48s',
		}),
		'utf8'
	);
	const data = readData(html);

	assert.equal(data.name, 'My Site');
	assert.equal(data.domain, 'site.test');
	assert.equal(data.comparedAt, 'Jun 12, 2026 · 10:41 AM');
	assert.equal(data.duration, '48s');
	assert.equal(data.pages.length, 1);

	const page = data.pages[0];
	assert.equal(page.key, 'home');
	assert.equal(page.add, 12);
	assert.equal(page.del, 4);
	assert.equal(page.max, 2.5);

	const result = page.results.desktop;
	assert.equal(result.diff, 2.5);
	assert.equal(result.add, 12);
	assert.equal(result.del, 4);
	// Image paths are relative to the reports directory and forward-slashed.
	assert.equal(result.img.diff, '../compares/home-desktop-diff.png');
	assert.equal(result.img.control, '../controls/home-desktop.png');
	assert.deepEqual(result.htmlDiff, [{ gap: 3 }]);
});

test('generateReport emits viewport metadata with the device pixel ratio', () => {
	const config = tempConfig();
	config.viewports = [
		{ name: 'desktop', width: 1920, height: 1080 },
		{ name: 'retina', width: 1920, height: 1080, deviceScaleFactor: 2 },
	];
	const html = fs.readFileSync(
		generateReport(config, [
			sampleReport(config),
			sampleReport(config, {
				viewport: {
					name: 'retina',
					width: 1920,
					height: 1080,
					deviceScaleFactor: 2,
				},
				diffImage: path.join(
					config.dirs.compares,
					'home-retina-diff.png'
				),
			}),
		]),
		'utf8'
	);
	const data = readData(html);
	assert.deepEqual(data.viewports, [
		{ name: 'desktop', width: 1920, height: 1080, dpr: 1 },
		{ name: 'retina', width: 1920, height: 1080, dpr: 2 },
	]);
});

test('generateReport carries pixelmatch settings for the popover', () => {
	const config = tempConfig();
	const html = fs.readFileSync(
		generateReport(config, [sampleReport(config)]),
		'utf8'
	);
	const data = readData(html);
	assert.deepEqual(data.settings, {
		threshold: 0.1,
		includeAA: 'No',
		alpha: 0.1,
		diffColor: '255, 0, 0',
	});
});

test('generateReport surfaces the too-large note only when present', () => {
	const config = tempConfig();
	const withNote = readData(
		fs.readFileSync(
			generateReport(config, [
				sampleReport(config, { htmlNote: 'too big' }),
			]),
			'utf8'
		)
	);
	assert.equal(withNote.pages[0].results.desktop.note, 'too big');

	const without = readData(
		fs.readFileSync(generateReport(config, [sampleReport(config)]), 'utf8')
	);
	assert.equal(without.pages[0].results.desktop.note, undefined);
});

test('generateReport escapes the page title and hardens the data sink', () => {
	const config = tempConfig();
	config.name = '<img src=x onerror=alert(1)>';
	const html = fs.readFileSync(
		generateReport(config, [
			sampleReport(config, {
				urlKey: '</script><script>alert(1)</script>',
			}),
		]),
		'utf8'
	);
	// The <title> escapes the config name.
	assert.match(
		html,
		/<title>&lt;img src=x onerror=alert\(1\)&gt; — Reglance<\/title>/
	);
	// The embedded JSON neutralizes </script> rather than emitting it raw.
	assert.ok(!html.includes('</script><script>alert(1)'));
	assert.ok(html.includes('\\u003c/script>\\u003cscript>alert(1)'));
});
