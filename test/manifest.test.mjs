import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStaleControls } from '../src/manifest.mjs';

test('detectStaleControls finds no staleness for a single-run baseline', () => {
	const manifest = {
		slugs: {
			'home-desktop': { promotedAt: '2026-06-03T00:00:00.000Z' },
			'home-mobile': { promotedAt: '2026-06-03T00:00:00.000Z' },
		},
	};
	const { runs, oldest } = detectStaleControls(manifest, [
		'home-desktop',
		'home-mobile',
	]);
	assert.equal(runs.length, 1);
	assert.equal(oldest, null);
});

test('detectStaleControls flags a baseline mixing two runs and names the oldest', () => {
	const manifest = {
		slugs: {
			'home-desktop': { promotedAt: '2026-01-01T00:00:00.000Z' },
			'blog-desktop': { promotedAt: '2026-06-03T00:00:00.000Z' },
		},
	};
	const { runs, oldest } = detectStaleControls(manifest, [
		'home-desktop',
		'blog-desktop',
	]);
	assert.equal(runs.length, 2);
	assert.equal(oldest.slug, 'home-desktop');
	assert.equal(oldest.promotedAt, '2026-01-01T00:00:00.000Z');
});

test('detectStaleControls ignores slugs missing from the manifest', () => {
	const manifest = {
		slugs: { 'home-desktop': { promotedAt: '2026-06-03T00:00:00.000Z' } },
	};
	const { oldest } = detectStaleControls(manifest, [
		'home-desktop',
		'never-promoted',
	]);
	assert.equal(oldest, null);
});
