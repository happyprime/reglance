import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { loadConfig } from '../src/config.mjs';
import { padImage, compareSlug } from '../src/compare.mjs';

/**
 * Build a solid-color PNG.
 *
 * @param {number} width  - Image width.
 * @param {number} height - Image height.
 * @param {Array}  rgba   - The [r, g, b, a] fill color.
 * @returns {PNG} The filled image.
 */
function solidPng(width, height, rgba) {
	const [r, g, b, a] = rgba;
	const png = new PNG({ width, height });
	for (let i = 0; i < png.data.length; i += 4) {
		png.data[i] = r;
		png.data[i + 1] = g;
		png.data[i + 2] = b;
		png.data[i + 3] = a;
	}
	return png;
}

/**
 * Build a normalized config plus prepared comparison directories.
 *
 * @returns {object} The normalized config.
 */
function tempConfig() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reglance-test-'));
	const configPath = path.join(dir, 'reglance.json');
	fs.writeFileSync(
		configPath,
		JSON.stringify({
			domain: 'site.test',
			paths: { home: '/' },
			output: path.join(dir, '.reglance'),
		})
	);
	const config = loadConfig({ configPath });
	for (const key of ['controls', 'captures', 'compares', 'reports']) {
		fs.mkdirSync(config.dirs[key], { recursive: true });
	}
	return config;
}

/**
 * Write control and capture PNGs for the home-desktop slug.
 *
 * @param {object} config  - The normalized config.
 * @param {PNG}    control - The baseline image.
 * @param {PNG}    capture - The latest image.
 */
function writePair(config, control, capture) {
	fs.writeFileSync(
		path.join(config.dirs.controls, 'home-desktop.png'),
		PNG.sync.write(control)
	);
	fs.writeFileSync(
		path.join(config.dirs.captures, 'home-desktop.png'),
		PNG.sync.write(capture)
	);
}

const VIEWPORT = { name: 'desktop', width: 10, height: 10 };
const TARGET = { key: 'home', url: 'https://site.test/' };

test('padImage grows an image onto a larger canvas', () => {
	const padded = padImage(solidPng(4, 2, [0, 0, 0, 255]), 6, 5);
	assert.equal(padded.width, 6);
	assert.equal(padded.height, 5);
});

test('padImage returns the original when dimensions already match', () => {
	const img = solidPng(4, 2, [0, 0, 0, 255]);
	assert.equal(padImage(img, 4, 2), img);
});

test('compareSlug reports zero difference for identical images', () => {
	const config = tempConfig();
	const black = solidPng(10, 10, [0, 0, 0, 255]);
	writePair(config, black, solidPng(10, 10, [0, 0, 0, 255]));

	const result = compareSlug(config, TARGET, VIEWPORT);
	assert.equal(result.diffPercentage, 0);
	assert.ok(fs.existsSync(result.diffImage));
});

test('compareSlug reports full difference for opposite images', () => {
	const config = tempConfig();
	writePair(
		config,
		solidPng(10, 10, [0, 0, 0, 255]),
		solidPng(10, 10, [255, 255, 255, 255])
	);

	const result = compareSlug(config, TARGET, VIEWPORT);
	assert.equal(result.diffPercentage, 100);
});

test('compareSlug pads a height mismatch instead of failing', () => {
	const config = tempConfig();
	writePair(
		config,
		solidPng(10, 10, [0, 0, 0, 255]),
		solidPng(10, 20, [0, 0, 0, 255])
	);

	const result = compareSlug(config, TARGET, VIEWPORT);
	// The extra rows differ from the padded (transparent) baseline.
	assert.ok(result.diffPercentage > 0);
});

test('compareSlug returns null when the control is missing', () => {
	const config = tempConfig();
	fs.writeFileSync(
		path.join(config.dirs.captures, 'home-desktop.png'),
		PNG.sync.write(solidPng(10, 10, [0, 0, 0, 255]))
	);

	assert.equal(compareSlug(config, TARGET, VIEWPORT), null);
});

test('compareSlug reports a width mismatch as a large diff, not a drop', () => {
	const config = tempConfig();
	// Same color, different width: the extra columns differ from the padded
	// (transparent) baseline, so the slug must appear with a non-zero diff
	// rather than being silently omitted from the report.
	writePair(
		config,
		solidPng(10, 10, [0, 0, 0, 255]),
		solidPng(20, 10, [0, 0, 0, 255])
	);

	const result = compareSlug(config, TARGET, VIEWPORT);
	assert.notEqual(result, null);
	assert.ok(result.diffPercentage > 0);
	assert.ok(fs.existsSync(result.diffImage));
});
